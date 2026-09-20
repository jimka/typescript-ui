---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/layout/LayoutManager.ts
---

# NaN sentinels that escape into the DOM — Implementation Plan

## Overview

`Component` seeds its four geometry fields with `NaN` to mean "never assigned"
([core/Component.ts:601-604](packages/lib/src/typescript/lib/core/Component.ts#L601)).
Three bugs in the render-review correctness register — **C6, C22 and C27** —
are the same escape of that sentinel: a getter hands it out, an `===` guard
cannot reject it (`NaN === NaN` is false), and it lands in a DOM write the
browser then discards.

This plan closes the escape in three places: the layout seam that computes
with an unset position, the three setters that would otherwise write a
non-finite number into CSS, and `Markdown`'s own restore write. The accessors
keep returning the sentinel.

| # | What escapes | Where it lands |
|---|---|---|
| C22 | `_left` / `_top` of a child no layout manager ever positioned | `transform: translate3d(NaNpx,NaNpx,0)` on every `ComboBox` caret glyph, every pass, plus a permanent `will-change: transform` |
| C27 | `_height` before the first `setHeight` | `height: NaNpx` on a `Markdown`'s first commit |
| C6 | a caller's `NaN` line height, fed from a layout box | a permanent `.Text.lhNaNpx { line-height: NaNpx }` shared class rule |

Source files touched: [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts),
[layout/LayoutManager.ts](packages/lib/src/typescript/lib/layout/LayoutManager.ts),
[component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts),
[component/input/ComboBox.ts](packages/lib/src/typescript/lib/component/input/ComboBox.ts),
[component/display/Markdown.ts](packages/lib/src/typescript/lib/component/display/Markdown.ts).

**Nothing in this plan may change where anything is painted.** That is the
soundness gate for the whole render-review campaign, and it is satisfiable
here because every write being removed is a declaration the browser already
discards as invalid — see *Every removed write is one the browser already
discards*.

---

## Architecture Decisions

### The fix goes at the layout seam and at the setters, not at the accessors

[`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L581)
has a *fast path*: when a child's size did not change, it carries the move as a
compositor `transform` instead of rewriting `left` / `top`. That fast path now
takes a finite current position as a precondition, and
[`Component.setTranslate`](packages/lib/src/typescript/lib/core/Component.ts#L5069)
refuses a non-finite argument. `getX()`, `getY()`, `getWidth()` and
`getHeight()` keep returning the sentinel unchanged.[^why-not-accessors]

| Candidate | Stops the `translate3d(NaNpx,…)` write | Releases `will-change: transform` | Stops the fast path re-running every pass | Risk |
|---|---|---|---|---|
| Accessors coalesce `NaN` → `0` | yes | yes | yes | 43 `getX`/`getY` and 158 `getWidth`/`getHeight` call sites; changes `sizeUnchanged` and `positionUnchanged` for every first commit |
| `setTranslate` refuses non-finite | yes | **no** — `setWillChange("transform")` runs one line earlier | no | none |
| `canFastPath` requires a finite position | yes | yes | yes | none: the gate cannot change a case where all four numbers are real |

The plan takes rows 2 and 3 together. Row 2 alone leaves half of C22 standing:
a compositor layer promoted per combo box and never demoted. Row 3 alone fixes
C22, and row 2 is what stops any other caller re-opening it — the second
`transform` write site,
[`replayGeometryStyles`](packages/lib/src/typescript/lib/core/Component.ts#L6956),
reads the `_translateX` / `_translateY` cache, so a setter that never stores a
non-finite value is what keeps that site safe too.[^replay-not-touched]

The precedent is
[layout/Table.ts:162](packages/lib/src/typescript/lib/layout/Table.ts#L162):
a never-sized container reports `NaN` dimensions rather than `null`, and the
manager rejects them with `Number.isFinite` and defers the pass, rather than
the accessor being changed. Its regression tests are at
[tests/component/table/ColumnWidths.test.ts:957-1000](packages/lib/tests/component/table/ColumnWidths.test.ts#L957).

### Every removed write is one the browser already discards

Geometry is unchanged because each suppressed write produces an invalid CSS
declaration today, and an invalid declaration is dropped: the property keeps
the value it already had.

| Case | Written today | Written after | What paints |
|---|---|---|---|
| Never-positioned child, size settled | `transform: translate3d(NaNpx,NaNpx,0)`, every pass | nothing | computed transform is `none` either way |
| …its `will-change` | `transform`, pinned forever | `null` | `will-change` has no geometric effect |
| …its `left` / `top` | never written — `writeHorizontalGeometry` skips a `NaN` `_left` | never written — same guard, now reached from the slow path | its static position (where the element would sit with no `left` / `top` at all), unchanged |
| Any child with a finite target and a finite current position | fast path | fast path, bit-identical | unchanged |
| `Markdown`'s first commit | `height: NaNpx` | nothing | the box stays at `height: auto` until `commitBounds`' own `setHeight` lands, in both cases |
| First `setLineHeight(NaN)` on a `Text` | `.Text.lhNaNpx { line-height: NaNpx }`, plus a class token added then swapped | nothing | the real `setLineHeight(16)` later in the same pass is what paints, in both cases |

### `Number.isFinite` for an incoming argument, `Number.isNaN` for the framework's own sentinel

The codebase already carries both idioms. The rule that picks between them:
a guard reading a `Component` geometry field tests for the exact sentinel that
field is seeded with; a guard reading a number from outside tests that it is
usable in arithmetic at all.

| Site | Reads | Test | Existing precedent in the same file or package |
|---|---|---|---|
| `Component.writeHorizontalGeometry` (existing) | `this._left` | `Number.isNaN` | itself, [Component.ts:4761](packages/lib/src/typescript/lib/core/Component.ts#L4761) |
| `Markdown.measureContentHeight` (new) | `this.getHeight()` | `Number.isNaN` | [Component.ts:4780](packages/lib/src/typescript/lib/core/Component.ts#L4780), the guard on the same field |
| `Component.setTranslate` (new) | the `x` / `y` arguments | `Number.isFinite` | [DiagramView.setZoom:1155](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1155) — the library's existing setter that refuses a non-finite argument outright |
| `Text.setLineHeight` (new) | the `value` argument | `Number.isFinite` | as above |
| `ComboBoxLabel.setLineHeight` (new) | the `value` argument | `Number.isFinite` | as above |
| `LayoutManager.commitBounds` (new) | `x`, `y` and `getX()` / `getY()` | `Number.isFinite` | [Table.ts:162](packages/lib/src/typescript/lib/layout/Table.ts#L162), [VFlow.ts:289](packages/lib/src/typescript/lib/layout/VFlow.ts#L289), [LayoutSizes.ts:36](packages/lib/src/typescript/lib/layout/LayoutSizes.ts#L36) — the `layout/` package's own idiom |

### `setTranslate` refuses a non-finite argument instead of coercing it

The guard is a first-statement early return that leaves `_translateX` /
`_translateY` holding their last real value. It copies
[`DiagramView.setZoom`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1155),
whose own JSDoc already states the rule — a non-finite request is rejected
outright rather than clamped — and it takes the same position in the method
body as wave 1's guards in
[`component-setter-guards`](plans/implemented/component-setter-guards.md).
Refusing keeps the cache and the DOM in agreement, which coercing to `0` would
not.[^refuse-not-coerce]

### Both `setLineHeight` entries that publish a shared value rule refuse a non-finite number

[`Text.setLineHeight`](packages/lib/src/typescript/lib/component/input/Text.ts#L1174)
and
[`ComboBoxLabel.setLineHeight`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L521)
are two independent implementations that both route a numeric value into
`Component.setValueStyleState`, which mints a permanent shared class rule keyed
on the value. A non-finite value therefore mints permanent garbage from either
one. `Glyph.setLineHeight` is left alone.[^glyph-line-height]

### `Markdown` suppresses the restore write it cannot express

[`Markdown.measureContentHeight`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1043)
collapses its box to `height: auto`, reads `scrollHeight`, then restores the
laid-out height. On a component's first commit there is no laid-out height to
restore, because
[`commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L608)
calls `setWidth` before `setHeight` and `Markdown.setWidth` measures
synchronously. The restore write is skipped for that one pass, leaving the box
at `height: auto` — which is exactly where today's discarded `NaNpx` write
leaves it.

### The accessors' JSDoc is corrected instead of their behaviour

[`getWidth`](packages/lib/src/typescript/lib/core/Component.ts#L4454) and
[`getHeight`](packages/lib/src/typescript/lib/core/Component.ts#L4605) each
promise the extent "in pixels, or 0 if the size is unavailable". That fallback is
unreachable: [`getSize`](packages/lib/src/typescript/lib/core/Component.ts#L3617)
returns an object unconditionally, so the `else` branch never runs. Believing
that promise is what produced C27. The JSDoc is corrected to state the
sentinel and the test for it; the return values do not move.[^docs-not-code]

---

## Internal Structure

`commitBounds`' guard block, after the change. Only the `positionKnown`
declaration and the `positionKnown &&` prefix on `canFastPath` are new;
`sizeUnchanged`, `positionUnchanged` and `mayBeUnchanged` keep their current
bodies.

```typescript
const sizeUnchanged = component.getWidth() === width && component.getHeight() === height;
const beforeTranslateX = component.getTranslateX();
const beforeTranslateY = component.getTranslateY();
const positionUnchanged = x === component.getX() + beforeTranslateX && y === component.getY() + beforeTranslateY;
const transition = component.getTransition();
// NEW: the fast path writes `x - getX()` as a translate, so all four operands
// must be real numbers. A child no layout manager ever positioned still holds
// getX()/getY()'s "never assigned" NaN seed, which makes `positionUnchanged`
// false forever and the translate NaN — so without this the fast path engages
// on every settled pass and never releases the promotion it takes.
const positionKnown = Number.isFinite(x) && Number.isFinite(y)
    && Number.isFinite(component.getX()) && Number.isFinite(component.getY());
// NEW: `positionKnown &&` prepended; the rest is unchanged.
const canFastPath = positionKnown && sizeUnchanged && !positionUnchanged && (transition === null || transition === "none");
const mayBeUnchanged = sizeUnchanged && positionUnchanged;
```

For a child no layout manager ever positioned, the `else` branch then runs:
`setX(NaN)` and `setY(NaN)` are absorbed by `writeHorizontalGeometry` /
`writeVerticalGeometry`'s existing `Number.isNaN` guards, `setTranslate(0, 0)`
removes the `transform`, and `setWillChange(null)` demotes the layer. That
branch does not call `markPassOwedAbove()`, so such a child stops re-dirtying
its ancestors on every pass.[^pass-owed]

---

## Ordered Implementation Steps

Each step is test-first: add the case, watch it fail, then make the change.

1. **`Component.setTranslate` — refuse a non-finite argument.** In
   [core/Component.ts:5069](packages/lib/src/typescript/lib/core/Component.ts#L5069),
   add a first statement before the existing same-value guard:
   `if (!Number.isFinite(x) || !Number.isFinite(y)) { return this; }`. Extend
   the method's `@remarks` with one sentence saying a non-finite argument is
   refused and why. Tests: a new `describe` block in
   [tests/component/Component.test.ts](packages/lib/tests/component/Component.test.ts),
   next to *Component — will-change survives applyStyle*, which already reads
   recorded inline styles the way these cases need. Covers behaviours 1–3.

2. **`LayoutManager.commitBounds` — gate the fast path on a finite position.**
   In [layout/LayoutManager.ts:589](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L589),
   insert `positionKnown` exactly as in `## Internal Structure` and prepend it
   to `canFastPath`. Do not touch `positionUnchanged` or `mayBeUnchanged`.
   Extend the method's existing doc comment with one sentence naming the
   never-positioned child. Tests: behaviours 4–6 in
   [tests/component/layout/Absolute.test.ts](packages/lib/tests/component/layout/Absolute.test.ts)
   (the manager that produces the case) and behaviour 7 in
   [tests/component/layout/LayoutManager.commitBounds.test.ts](packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts).

3. **Checkpoint.** `npm run test` — the seven existing cases in
   `LayoutManager.commitBounds.test.ts` and the three in `Absolute.test.ts`
   must pass unmodified. If any needs editing, stop: the `positionKnown` gate
   has changed a finite path, which it must not.

4. **`Text.setLineHeight` — refuse a non-finite number.** In
   [component/input/Text.ts:1174](packages/lib/src/typescript/lib/component/input/Text.ts#L1174),
   add as the first statement of the method:
   `if (typeof value === "number" && !Number.isFinite(value)) { return this; }`.
   Tests: behaviours 8–9 in
   [tests/component/input/TextLineHeightValueClassSharing.test.ts](packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts),
   which already owns the shared-rule-per-value mechanism and has the
   `declarationsDuring` / `classToggleWrites` helpers these cases need.

5. **`ComboBoxLabel.setLineHeight` — the same guard.** In
   [component/input/ComboBox.ts:521](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L521),
   add the identical first statement, before `const numeric`. Tests:
   behaviours 10–11 in
   [tests/component/input/ComboBox.test.ts](packages/lib/tests/component/input/ComboBox.test.ts).

6. **`Markdown.measureContentHeight` — skip an unexpressible restore.** In
   [component/display/Markdown.ts:1080](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1080),
   wrap the restore write and its `commitElementStyle()` in
   `if (!Number.isNaN(restoreHeight)) { … }`, and add a comment naming
   `commitBounds`' `setWidth`-before-`setHeight` order as the reason the first
   measure has no height to restore. Leave the `height: "auto"` write and the
   two earlier `commitElementStyle()` calls alone. Tests: behaviours 12–13 in
   [tests/component/display/Markdown.test.ts](packages/lib/tests/component/display/Markdown.test.ts),
   in the existing *Markdown content-height measurement* block.

7. **Correct the accessor JSDoc.** In `core/Component.ts`, replace the
   unreachable `0` promise on
   [`getWidth`](packages/lib/src/typescript/lib/core/Component.ts#L4454) and
   [`getHeight`](packages/lib/src/typescript/lib/core/Component.ts#L4605) with
   the sentinel and the `Number.isNaN` test, and add the same one-line note to
   [`getX`](packages/lib/src/typescript/lib/core/Component.ts#L4673),
   [`getY`](packages/lib/src/typescript/lib/core/Component.ts#L4715) and
   [`getSize`](packages/lib/src/typescript/lib/core/Component.ts#L3617), whose
   doc comments say nothing about the unset case at all. Describe the
   behaviour in prose — no `{@link}` to a private member, per
   [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md). No code changes in this step.

8. **Correct the layout-system doc.**
   [packages/lib/docs/concepts/layout-system.md:148](packages/lib/docs/concepts/layout-system.md#L148)
   says `getSize()` returns `null` for a component not yet laid out. It never
   returns `null`. Rewrite the bullet to say it returns `NaN` extents and that
   a caller must test with `Number.isNaN` before doing arithmetic.

9. **Changelog.** Add the entries described in `## Documentation Impact` to
   [packages/lib/docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md).

10. **Full verification.** Run everything in `## Verification`. Grep check:
    `grep -rn 'translate3d' packages/lib/src/typescript/lib/core/Component.ts`
    — expect exactly two sites (`setTranslate`, `replayGeometryStyles`), both
    now unreachable with a non-finite value.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/Component.test.ts` |
| Modify | `packages/lib/tests/component/layout/Absolute.test.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts` |
| Modify | `packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts` |
| Modify | `packages/lib/tests/component/input/ComboBox.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable unless marked otherwise. Every case must be written and seen to
fail before the corresponding source change lands — a case that passes against
today's code is measuring the wrong thing.[^vacuous-test]

**`Component.setTranslate`**

1. `setTranslate(NaN, 0)` on a rendered component writes no `transform`
   declaration and leaves `getTranslateX()` / `getTranslateY()` at the values
   they held before the call.
2. `setTranslate(Infinity, 0)` behaves identically to case 1.
3. `setTranslate(5, 6)` on the same component still writes
   `transform: translate3d(5px,6px,0)` and reports `getTranslateX() === 5`.

**`Absolute` over a child that was never positioned** — the host is built like
`Absolute.test.ts`'s existing `hostAbsolute`, the child is added with a
`preferredSize` and **no** `setX` / `setY`, and `host.doLayout()` runs three
times.

4. No `transform` declaration is ever written to the child's element across all
   three passes.
5. `child.getWillChange()` is `null` after every pass, and
   `child.getTranslateX()` / `getTranslateY()` are `0` after every pass.
6. `Number.isNaN(child.getX())` and `Number.isNaN(child.getY())` are still
   `true` after all three passes — the fix must not invent a position for a
   child nobody placed.

**`LayoutManager.commitBounds`, finite path unchanged**

7. The existing seven cases in `LayoutManager.commitBounds.test.ts` pass
   unmodified. Add one case pinning the gate's boundary: a child given a real
   `setX` / `setY`, then displaced by a sibling resize with its own size
   unchanged, still takes the fast path — `getTranslateX()` is the displacement
   and `getWillChange()` is `"transform"`.

**`Text.setLineHeight` / `ComboBoxLabel.setLineHeight`**

8. `setLineHeight(18)` then `setLineHeight(NaN)` on a rendered `Text`: no
   stylesheet rule is written for any selector containing `NaN`, no class
   token containing `NaN` is added to the element, and `getLineHeight()`
   still reports `18`.
9. `setLineHeight(Infinity)` behaves identically to case 8.
10. The same two cases on a `ComboBoxLabel`, asserted through its own
    `getLineHeight()`, which reports the normalised `"18px"` string.
11. Constructing a `ComboBox`, rendering it and laying it out twice produces no
    `ensureStyleRule` / `setRuleStyles` op whose selector contains `NaN`,
    counted over that construct-and-layout window only.

**`Markdown.measureContentHeight`**

12. A `Markdown` whose width is set before any height was ever committed
    writes no inline `height` value failing `/^-?\d+(\.\d+)?px$/`, and leaves
    the element at `height: auto` for that pass.
13. A `Markdown` given `setHeight(300)` first, then a width change: the restore
    write still lands as `height: 300px`. The guard must not suppress a real
    restore.

**Manual verification** (geometry and visual output, which the offline harness
cannot express — never run without the user's explicit go-ahead; see
`## Verification`)

14. A `ComboBox`'s chevron renders in the same place, at the same size, before
    and after the change.
15. A `Markdown` preview reports the same content height and scrolls the same
    way as before.

---

## Verification

Automated, from the repository root:

```sh
npm run typecheck        # 0 errors (use this, not a bare tsc -p packages/lib/tsconfig.json)
npm run lint
npm run test
npm run docs:api         # must finish with zero warnings
```

Grep invariants:

```sh
grep -rn 'translate3d' packages/lib/src/typescript/lib/core/Component.ts   # exactly 2 sites
grep -rn 'Number.isFinite' packages/lib/src/typescript/lib/layout/LayoutManager.ts  # 4 hits, all the new gate
```

**Manual, and only with the user's explicit go-ahead.** Every `packages/qa` run
opens a full-screen window on the user's desktop. **Do not start one, and do not
leave an agent to start one, unattended.** The recipe, when the user asks for
it, is a two-arm comparison per
[packages/qa/README.md](packages/qa/README.md): build this branch and the base
commit as separate arms, then run the same panel against each and diff the
reports.

| Panel and parameters | What it shows |
|---|---|
| `form-flat`, `passes=combo&seam=1&geom=1` | The C22 repro. M25 pins `seam.sink.apply` at 7 per settled `ComboBox` pass; that total must not move, because the caret's `apply` survives as an empty patch — what changes is the patch's content. `geometry.form` and `geometry.header` must be identical in every unit across both arms. |
| `form-nested`, `passes=combo&seam=1` | The same repro under the nested tree, where the inspector `Table` puts combo cells under a `Cell` — the one ancestor class whose `canSkipUnchangedLayout` opt-in the per-pass `markPassOwedAbove` currently defeats. |
| `markdown-doc`, `drive=passes&geom=1` (its default drive is `drag`, so `drive=` is required here) | C27. M13 pins `seam.source.getElementRect` at 2.00 per pass; `geometry.viewer` and `geometry.side` must be identical in every unit across both arms. |

`table-rows` is **not** a witness for this plan: its 12-field model declares no
combo column, so it mounts no `ComboBox`. `form-nested` is the second combo
panel.

---

## Documentation Impact

- **[packages/lib/docs/concepts/layout-system.md:148](packages/lib/docs/concepts/layout-system.md#L148)** —
  the *Querying size before render* bullet claims `getSize()` returns `null`
  before layout. Correct it to the truth: the extents are `NaN`, and a caller
  must test them.
- **[packages/lib/docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md)** —
  one *Changed → Core* entry and one *Fixed* entry, in the existing
  bold-lead-sentence style. The *Changed* entry states that `setTranslate` and
  `Text.setLineHeight` now ignore a non-finite number instead of writing an
  invalid declaration, and that `getSize()` / `getWidth()` / `getHeight()` are
  documented as reporting `NaN` before the first commit rather than `0` — a
  documentation correction, not a behaviour change. The *Fixed* entry names the
  `ComboBox` caret's per-pass `transform` write and its pinned
  `will-change`, and the `Markdown` first-commit `height` write.
- **No migration note.** No signature changes and no observable end state
  changes, so `packages/lib/docs/reference/migration/next.md` is untouched.
- **[packages/lib/llms.txt](packages/lib/llms.txt)** needs no change: it
  indexes classes, and no class is added or removed.

---

## Potential Challenges

- **A vacuous `Absolute` test.** If the never-positioned child has no element,
  `setTranslate` early-returns for an unrelated reason and cases 4–6 pass
  against today's code. Watch them fail first; if they do not, realise the
  child's element the way `Absolute.test.ts`'s existing cases do.
- **Module-state leakage between cases in one test file.** The `.ClassName`
  and state-rule registries in `core/ClassStyleRules.ts` survive `DOM.reset()`
  within a file — `TextLineHeightValueClassSharing.test.ts` documents this in
  its header. A "no NaN selector was ensured" assertion must therefore scope
  itself to the writes the case itself produced (the `declarationsDuring`
  shape), not to the whole recording.
- **`ComboBoxLabel` is not a `Text` subclass.** It extends `Component` and
  carries its own parallel `setLineHeight` / `_lineHeight` implementation
  ([ComboBox.ts:439](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L439)).
  Guarding `Text` alone leaves `ComboBoxLabel` free to mint the same permanent
  rule.
- **`markPassOwedAbove` stops firing for a never-positioned child.** That is
  the intended win. The call can only withhold a pass owed because of a move,
  and a never-positioned child never moves.[^pass-owed]
- **Three of the five source files are shared with other Phase 2 plans.**
  Keep the diff to the four guards, one gate and the doc comments; do not
  tidy adjacent code.

---

## Critical Files

| File | Why |
|---|---|
| [packages/lib/src/typescript/lib/core/Component.ts:4760-4784](packages/lib/src/typescript/lib/core/Component.ts#L4760) | `writeHorizontalGeometry` / `writeVerticalGeometry` — the existing `Number.isNaN` write-suppression this plan extends to `transform`. |
| [packages/lib/src/typescript/lib/core/Component.ts:6956-6982](packages/lib/src/typescript/lib/core/Component.ts#L6956) | `replayGeometryStyles` — the second `transform` write site, and the `_inlineStyle` twins of the same four guards. |
| [packages/lib/src/typescript/lib/core/Component.ts:408-412](packages/lib/src/typescript/lib/core/Component.ts#L408) | `roundedExtent` — the library already coalesces an unset origin to `0` at the write, not at the accessor. |
| [packages/lib/src/typescript/lib/layout/Table.ts:149-163](packages/lib/src/typescript/lib/layout/Table.ts#L149) | The precedent this plan mirrors: a `Number.isFinite` rejection of a never-sized container's `NaN` extents, at the consumer. |
| [packages/lib/src/typescript/lib/component/diagram/DiagramView.ts:1140-1164](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1140) | `setZoom` — the library's existing non-finite-argument refusal, and the JSDoc wording the three new guards copy. |
| [plans/implemented/component-setter-guards.md](plans/implemented/component-setter-guards.md) | Wave 1's setter-guard shapes, and what it deliberately left out. |
| [packages/lib/tests/component/table/ColumnWidths.test.ts:944-1000](packages/lib/tests/component/table/ColumnWidths.test.ts#L944) | The regression tests for that precedent, and the shape this plan's tests follow. |
| [packages/lib/src/typescript/lib/core/Component.ts:6742-6767](packages/lib/src/typescript/lib/core/Component.ts#L6742) | `setValueStyleState` — the shared-rule mechanism both `setLineHeight` guards protect. |
| [packages/qa/README.md](packages/qa/README.md) | The panel table, the validated figures, and the rule that no run starts without the user's go-ahead. |

---

## Non-Goals

- **Changing `getX` / `getY` / `getWidth` / `getHeight` / `getSize` return
  values.** Rejected in `## Architecture Decisions`; only their doc comments
  move.
- **`Absolute.doLayout` coalescing `getX()` / `getY()` to `0`.** The original
  slice report proposed it. It commits a never-positioned child at `left: 0;
  top: 0` instead of leaving it at its static position, which is a geometry
  change this plan's gate forbids.[^absolute-coalesce]
- **`Absolute.doLayout`'s `preferredSize?.width ?? size?.width ?? 0` falling
  through to `NaN`.** The `??` catches `null` and `undefined`, not a `NaN`
  member, so a never-sized child is committed at width `NaN`. Same family, same
  geometry objection: changing that fallback writes `width: 0px` where nothing
  is written today. It belongs with the `ComboBox` layout plan.
- **Giving `ComboBoxCaret` a `Fit()` layout manager.** F16.3's local fix. It
  changes the caret glyph's committed rectangle from "unpositioned at its
  preferred size" to "filling the caret's content box" — a deliberate geometry
  change that needs its own visual check.
- **`ComboBox.doLayout`'s double layout of the label subtree** (F16.4a) and
  **[`component/list/renderer/Label.ts:106`](packages/lib/src/typescript/lib/component/list/renderer/Label.ts#L106)'s object-only `??` fallback**
  (F16.4b). The double pass is a layout-economy fix. The fallback's failure to
  catch a `NaN` member is real, but its only sink is `setLineHeight`, which this
  plan now guards. Both belong with the `ComboBox` layout plan.
- **`Glyph.setLineHeight`.** It writes to the instance layer only, so a
  non-finite value is a discarded declaration, not an unbounded
  leak.[^glyph-line-height]
- **`ClassStyleRules._stateBags` gaining a delete path.** C6's register entry
  names the missing delete path as what makes the junk rule permanent. Refusing
  to mint it is the fix; a general eviction path for shared class rules is a
  separate design question.
- **The empty-`apply` floor.** One content-free `apply` per component survives
  a settled pass. That is a `StyleTarget` issue, already out of scope in wave 1,
  and it is why the QA check above asserts on patch content rather than on
  `apply` totals.

---

## Notes

[^why-not-accessors]: Three things go wrong if `getX()` / `getY()` /
    `getWidth()` / `getHeight()` coalesce the sentinel to `0`. First, the
    reported value would stop matching the element: `writeHorizontalGeometry`
    reads `this._left`, not `getX()`, so it would still skip the `left` write
    while `getX()` claimed `0` — a read that does not return the component's
    committed state, against ARCHITECTURE.md's second non-negotiable DOM-write
    rule. Second, `commitBounds` reads `getWidth()` / `getHeight()` for
    `sizeUnchanged` and `getX()` / `getY()` for `positionUnchanged`; a first
    commit of a `0 × 0` box at `(0, 0)` would flip from "changed" to
    "unchanged", and for the three classes that opt into
    `canSkipUnchangedLayout` — `Cell`, `ToolBar`, `MenuBar` — that withholds
    the subtree's first `doLayout()` entirely. Third, the blast radius: 43
    `getX()` / `getY()` reads and 158 `getWidth()` / `getHeight()` reads across
    the library, several of which sum the value into an extent
    (`LayoutManager.reserveContentFrame` at
    [LayoutManager.ts:337](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L337))
    or feed it to an axis resolver as a prior origin
    ([Anchor.ts:168](packages/lib/src/typescript/lib/layout/Anchor.ts#L168)),
    where `NaN` today means "this child contributes nothing" and `0` would mean
    "this child sits at the origin". Seeding `_left` / `_top` to `0` instead
    fails for a fourth reason, recorded in the fields' own comment
    ([Component.ts:598-600](packages/lib/src/typescript/lib/core/Component.ts#L598)):
    the sentinel exists so that the first `setX(0)` is not short-circuited by
    the setter's own equality guard and does reach the DOM.

[^replay-not-touched]: `replayGeometryStyles`
    ([Component.ts:6975-6981](packages/lib/src/typescript/lib/core/Component.ts#L6975))
    re-emits the cached translate whenever `_translateX !== 0 || _translateY
    !== 0`, and `NaN !== 0` is true — so it is a second route to the same
    invalid write today. Once `setTranslate` refuses a non-finite argument,
    `_translateX` / `_translateY` can never hold one, and the site is safe with
    no edit. Adding a finiteness test there as well would be guarding a state
    the code can no longer reach, which CLAUDE.md's *Simplicity First* rules
    out.

[^refuse-not-coerce]: Coercing a non-finite argument to `0` would write
    `transform: null` and record `_translateX = 0`, which for a component that
    already carries a real translate silently cancels it. Returning early
    leaves both the cache and the element exactly as the last good call left
    them. `DiagramView.setZoom` made the same call for the same reason, and
    says so in its own doc comment: `Math.max` / `Math.min` propagate `NaN`
    instead of resolving it, so a clamp is not a repair. The caller passing a
    non-finite number has a bug of its own; the setter's job is not to invent
    a position for it.

[^glyph-line-height]: `Glyph.setLineHeight`
    ([Glyph.ts:412](packages/lib/src/typescript/lib/component/display/Glyph.ts#L412))
    stores the value in `_options` and calls `writeStyle`, which lands on the
    instance's own `#id` rule. A non-finite value there produces one discarded
    declaration on a rule that already exists and is disposed with the
    component — no shared rule, no unbounded growth, and nothing that outlives
    the instance. C6 is specifically about the permanent shared rule, so `Glyph`
    is out of scope; if a later plan wants the guard for uniformity it costs one
    line.

[^docs-not-code]: Making `getSize()` actually return `null` before the first
    commit — which is what
    [docs/concepts/layout-system.md:148](packages/lib/docs/concepts/layout-system.md#L148)
    already claims — would make `getWidth()` / `getHeight()`'s documented `0`
    fallback reachable, and so fixes the doc and the promise in one move. It is
    rejected for the same reason as the accessor change: 158 reads of
    `getWidth()` / `getHeight()` across the library would silently move from
    `NaN` to `0`, and `NaN` is load-bearing in at least
    `LayoutManager.reserveContentFrame`, `layout/Table.ts`'s own
    `Number.isFinite` rejection, and `Text.measuredHeight`
    ([Text.ts:653](packages/lib/src/typescript/lib/component/input/Text.ts#L653)),
    each of which uses "not a number" to mean "not sized yet". The doc is the
    cheaper thing to move, and moving it is what stops the next reader
    repeating C27.

[^pass-owed]: `markPassOwedAbove`
    ([Component.ts:4414](packages/lib/src/typescript/lib/core/Component.ts#L4414))
    walks the ancestor chain and marks every ancestor that opted into
    `canSkipUnchangedLayout` as owing a pass. It exists so the fold-back that
    releases a fast-path promotion is not withheld by a skipping ancestor.
    Today a `ComboBox` caret glyph inside a table cell calls it on every settled
    pass, so the `Cell` above it is re-dirtied every frame and its skip never
    takes effect. After the fix the child takes the slow path, which calls
    neither `setWillChange("transform")` nor `markPassOwedAbove()`, so there is
    no promotion to release and nothing is withheld. This is the "fixes the
    repeated work as well as the write" half of the layout-seam decision, and
    it is why `form-nested` — whose inspector `Table` puts combo cells under
    `Cell` — is the second QA witness.

[^absolute-coalesce]: An absolutely positioned element with no `left` / `top`
    declaration renders at its static position — where it would have sat in
    normal flow. For `ComboBoxCaretGlyph` inside `ComboBoxCaret` that happens
    to be `(0, 0)`, because the caret carries no padding, so coalescing to `0`
    would look identical there. It is not provably identical for every
    `Absolute` container in the library, let alone in a consumer's app, and the
    campaign's gate is "geometry does not change", not "geometry probably does
    not change on the one case we looked at". The `ComboBox` layout plan is
    where that change can be made deliberately and checked visually, together
    with F16.3's `Fit()` on the caret.

[^vacuous-test]: The whole family hides from a test that asserts an end state,
    because the browser discards every one of these writes — the rendered
    result is already correct, which is why C22 survived a full test suite and
    a review campaign. Each case therefore asserts on what reached the sink,
    and each must be seen red before the guard lands. A case that is green
    against today's code is asserting something other than the bug.
