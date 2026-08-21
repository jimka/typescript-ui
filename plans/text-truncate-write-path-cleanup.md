---
depends-on:
  - component-chrome-base-tier-hoisting
  - reconciled-write-path-widening
  - text-applystyle-class-hoisting
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/component/input/Text.ts
  - packages/lib/docs/reference/changelog/next.md
---

# `Text` truncate write-path cleanup — Implementation Plan

## Overview

Every `Text` instance in the framework writes two redundant declarations to its own `#id` CSS rule: `white-space: nowrap` and `text-overflow: ellipsis`. Every instance, not most — the pair comes from `truncate`'s default of `true`, and no component in the library opts out. Both values are already delivered by a lower, shared tier — `white-space: nowrap` by the framework-wide `:where(.ts-ui-component)` rule ([core/ClassStyleRules.ts:91](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L91)), `text-overflow: ellipsis` by the shared `.Text` class rule ([core/ClassStyleRules.ts:229](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L229), fed by [Text.ts:139](packages/lib/src/typescript/lib/component/input/Text.ts#L139)) — so neither ever needs to reach an instance's own rule. A recording-sink probe confirms the two are the *only* real declarations a default `new Text('x')` produces; everything else it queues is a `null` removal.

The cause is a write-path mismatch. [`Text.applyOptions`](packages/lib/src/typescript/lib/component/input/Text.ts#L300) calls `setTruncate(...)` unconditionally on every construction — not gated on `options.truncate !== undefined` like the options above it. [`setTruncate(true)`](packages/lib/src/typescript/lib/component/input/Text.ts#L1366), the default path, calls [`setWhiteSpace("nowrap")`](packages/lib/src/typescript/lib/core/Component.ts#L4733) and [`setTextOverflow("ellipsis")`](packages/lib/src/typescript/lib/component/input/Text.ts#L1310). Both setters write through the raw, unconditional `setElementCSSRule`, which queues straight onto the instance rule with no comparison against the class tier. The render pass then *skips* its own matching write (`writeRuleDeclaration` at [Component.ts:5209](packages/lib/src/typescript/lib/core/Component.ts#L5209) and [Text.ts:1560](packages/lib/src/typescript/lib/component/input/Text.ts#L1560)) instead of clearing it — and skipping cannot retract what the setter already queued.

This plan routes both properties onto the clear-on-match write path the framework already uses for its chrome, size-constraint, overflow, and visibility properties: the setters call `setReconciledCSSRules`, and the two render-phase writes call `reconcileRuleDeclaration`. Two files change (`core/Component.ts`, `component/input/Text.ts`) plus tests and the changelog. `core/ClassStyleRules.ts` is untouched — it already publishes both comparison values.

The saving is one whole stylesheet rule per plain `Text` — those two declarations are the only real content such a rule has, so with both deduped the rule is never inserted at all. That is roughly 85 bytes of stylesheet per instance (`#` + a 36-character UUID + a 48-character body), and a `Text` that keeps its rule for a genuine override — a `Button` label, a table header cell — still sheds the ~46-byte body fragment.[^impact] `Text` is embedded in nearly every labelled control in the framework, so the instance count on a busy screen runs to the hundreds; step 13 records the real before/after figures from the in-app Style Audit panel.

That write path is not on `master`. It arrives with the plans named in this plan's `depends-on` frontmatter, and every mechanism named below — `setReconciledCSSRules`, `reconcileRuleDeclaration`, `matchesClassStyle`, the class-tier bag itself — exists only once those have landed.

---

## Architecture Decisions

### Route both properties through the reconciled write path

`setWhiteSpace` (base `Component`) and `setTextOverflow` / `clearTextOverflow` (`Text`) change from the raw `setElementCSSRule` primitive to `setReconciledCSSRules`; the two render-phase writes for the same properties change from `writeRuleDeclaration` to `reconcileRuleDeclaration`. This is the same pair of changes [`reconciled-write-path-widening`](plans/implemented/reconciled-write-path-widening.md) made for seven properties and [`component-borderradius-visibility-write-path-cleanup`](plans/implemented/component-borderradius-visibility-write-path-cleanup.md) made for two more; [`Component.setOverflowX`](packages/lib/src/typescript/lib/core/Component.ts#L4127) is the nearest already-migrated example.[^both-halves]

The setter half alone is not enough, and neither is the render half alone. A setter that fires during construction runs before the class-tier bag exists, so `setReconciledCSSRules` is inert there and still queues the raw value — only a render-phase write that clears on match can overwrite it. A setter that fires after render has no render pass behind it — only the reconciled setter can dedupe it.

| Call | Class tier says | Reconciled result on `#id` | Rendered value |
|---|---|---|---|
| `setWhiteSpace("nowrap")` | `nowrap` (framework rule, every class) | removal | `nowrap`, from the framework rule |
| `setWhiteSpace("normal")` | `nowrap` | real `white-space: normal` | `normal` |
| `setTextOverflow("ellipsis")` on a `Text` | `ellipsis` (`.Text` rule) | removal | `ellipsis`, from `.Text` |
| `setTextOverflow("clip")` on a `Text` | `ellipsis` | real `text-overflow: clip` | `clip` |
| `clearTextOverflow()` with `truncate: true` | `ellipsis` | removal | `ellipsis`, from `.Text` |
| `clearTextOverflow()` with `truncate: false` | `ellipsis` | real `text-overflow: clip` | `clip` |

### `clearTextOverflow` keeps its `"clip"` substitution

`clearTextOverflow` today writes `this.getTextOverflow() ?? "clip"` rather than `null`, because a bare removal on `#id` stops competing with `.Text`'s `text-overflow: ellipsis` instead of beating it. Routing the call through `setReconciledCSSRules` keeps that expression exactly as it is — the substitution still decides *which value* is written, and the reconciled path then decides whether that value needs to be on `#id` at all.[^clip-still-needed] The same holds for `Text.applyStyle`'s own `textOverflow ?? "clip"` write.

### `setTruncate(false)` routes its `white-space` removal through `clearWhiteSpace`

[`setTruncate`](packages/lib/src/typescript/lib/component/input/Text.ts#L1374)'s `false` branch currently calls the raw `this.setElementCSSRule("whiteSpace", null)` directly. It becomes `this.clearWhiteSpace()`, the typed setter that already exists for exactly this write. The rendered result is unchanged; what changes is that `getWhiteSpace()` now reports `null` after `setTruncate(false)` instead of the stale `"nowrap"` it reports today.[^cleared-whitespace-cache]

### `clearWhiteSpace` itself is left alone

`clearWhiteSpace` writes an unconditional `null` removal. Routing it through `setReconciledCSSRules` would produce the identical write, because the class tier's value for `whiteSpace` is `"nowrap"` and never `null`, so the comparison can never match. It is left untouched as pure churn.[^clear-whitespace-noop]

### `core/ClassStyleRules.ts` needs no change

Both comparison values already exist. `resolveDeclarations` writes `whiteSpace: "nowrap"` unconditionally for every class ([ClassStyleRules.ts:184](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L184)), and `textOverflow` is already registered through the `font` sub-bag that `Text.getClassStyleDefaults()` supplies ([ClassStyleRules.ts:229](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L229), [Text.ts:1491](packages/lib/src/typescript/lib/component/input/Text.ts#L1491)). This plan changes no file under `core/ClassStyleRules.ts`.

### `RESTING_ISOLATION_KEYS` needs no change

`RESTING_ISOLATION_KEYS` ([Component.ts:368](packages/lib/src/typescript/lib/core/Component.ts#L368)) holds the three chrome properties a component's resting style must keep isolated from its state-tier rules. `whiteSpace` and `textOverflow` are written by no state-tier rule anywhere in the library, so adding them would change nothing.[^isolation-keys]

### Every other call site of these setters is covered by the same change

Besides `setTruncate`, seven other sites call `setWhiteSpace` and three call `setTextOverflow`. Two of them — `MenuItem` ([MenuItem.ts:296](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L296), [:298](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L298)) and `Dialog` ([Dialog.ts:224](packages/lib/src/typescript/lib/overlay/Dialog.ts#L224), [:225](packages/lib/src/typescript/lib/overlay/Dialog.ts#L225)) — re-set the same `nowrap` / `ellipsis` pair on a `Text` child that `setTruncate` already set, so they queue the same two redundant declarations a second time; the setter change covers them with no per-call-site edit. The rest pass a genuinely deviating value (`"normal"`, `"pre-wrap"`) and keep writing a real declaration exactly as today.[^other-call-sites]

---

## Ordered Implementation Steps

1. **Write the new test file first.** Create `packages/lib/tests/component/input/TextTruncateWritePath.test.ts` covering `## Expected Behaviour` rows 1-10. Copy the `declarationsDuring` / `idSelector` helpers verbatim from [`tests/component/input/TextClassStyleHoisting.test.ts`](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L69) rather than importing them, for the module-state reason that file's own header gives. Note the observation rule those files share: a removal is only *recorded* when the `#id` rule materialises, which needs at least one real, deviating declaration in the same batch — so any test asserting a removal must first give the instance a real override (e.g. `{ fontWeight: 'bold' }`).
   *Check:* `npx vitest run tests/component/input/TextTruncateWritePath.test.ts` from `packages/lib` — every case fails for the expected reason (the raw write path is still in place).

2. **`core/Component.ts` — route `setWhiteSpace` through the reconciled path.** Change line [4736](packages/lib/src/typescript/lib/core/Component.ts#L4736) from `this.setElementCSSRule("whiteSpace", value);` to `this.setReconciledCSSRules({ whiteSpace: value });`. Leave the `_whiteSpace` field write and the method's doc comment untouched. Do **not** touch `clearWhiteSpace` ([4746](packages/lib/src/typescript/lib/core/Component.ts#L4746)-[4755](packages/lib/src/typescript/lib/core/Component.ts#L4755)).
   *Check:* `grep -n 'this.setElementCSSRule("whiteSpace", value)' packages/lib/src/typescript/lib/core/Component.ts` — zero matches. `grep -n 'this.setElementCSSRule("whiteSpace", null)' packages/lib/src/typescript/lib/core/Component.ts` — one match (`clearWhiteSpace`, deliberately unchanged).

3. **`core/Component.ts` — route `applyMiscInlineStyles`'s `whiteSpace` write through `reconcileRuleDeclaration`.** Change line [5209](packages/lib/src/typescript/lib/core/Component.ts#L5209) from `this.writeRuleDeclaration("whiteSpace", this._whiteSpace);` to `this.reconcileRuleDeclaration("whiteSpace", this._whiteSpace);`. Keep the surrounding `if (this._whiteSpace) { ... }` guard exactly as it is.
   *Check:* `grep -n 'writeRuleDeclaration("whiteSpace"' packages/lib/src/typescript/lib/core/Component.ts` — zero matches. `grep -n 'reconcileRuleDeclaration("whiteSpace"' packages/lib/src/typescript/lib/core/Component.ts` — one match.

4. **`component/input/Text.ts` — route `setTextOverflow` and `clearTextOverflow` through the reconciled path.** Change line [1313](packages/lib/src/typescript/lib/component/input/Text.ts#L1313) to `this.setReconciledCSSRules({ textOverflow: value });` and line [1338](packages/lib/src/typescript/lib/component/input/Text.ts#L1338) to `this.setReconciledCSSRules({ textOverflow: this.getTextOverflow() ?? "clip" });`. Keep `clearTextOverflow`'s early-return guard and its `_options.textOverflow = undefined` write unchanged.
   *Check:* `grep -n 'setElementCSSRule("textOverflow"' packages/lib/src/typescript/lib/component/input/Text.ts` — zero matches.

5. **`component/input/Text.ts` — route `applyStyle`'s `textOverflow` write through `reconcileRuleDeclaration`.** Change line [1560](packages/lib/src/typescript/lib/component/input/Text.ts#L1560) from `this.writeRuleDeclaration("textOverflow", textOverflow ?? "clip");` to `this.reconcileRuleDeclaration("textOverflow", textOverflow ?? "clip");`. Leave `writeFontDeclaration` ([1501](packages/lib/src/typescript/lib/component/input/Text.ts#L1501)) and the ten font writes that route through it unchanged.
   *Check:* `grep -n 'writeRuleDeclaration("textOverflow"' packages/lib/src/typescript/lib/component/input/Text.ts` — zero matches. `grep -n 'reconcileRuleDeclaration("textOverflow"' packages/lib/src/typescript/lib/component/input/Text.ts` — one match.

6. **`component/input/Text.ts` — route `setTruncate`'s `false` branch through `clearWhiteSpace`.** Change line [1374](packages/lib/src/typescript/lib/component/input/Text.ts#L1374) from `this.setElementCSSRule("whiteSpace", null);` to `this.clearWhiteSpace();`. The other two lines of that branch (`setOverflow("visible")`, `clearTextOverflow()`) are unchanged.
   *Check:* `grep -n 'setElementCSSRule("whiteSpace"' packages/lib/src/typescript/lib/component/input/Text.ts` — zero matches.

7. **`component/input/Text.ts` — update the two stale doc comments.** In `clearTextOverflow`'s `@remarks` ([1324](packages/lib/src/typescript/lib/component/input/Text.ts#L1324)-[1330](packages/lib/src/typescript/lib/component/input/Text.ts#L1330)) and in the block comment above `applyStyle`'s `textOverflow` write ([1543](packages/lib/src/typescript/lib/component/input/Text.ts#L1543)-[1558](packages/lib/src/typescript/lib/component/input/Text.ts#L1558)), keep the whole "why `clip` and not `null`" explanation — it is still the reason for the substitution — and change only the mechanism named: the write now goes through `setReconciledCSSRules` / `reconcileRuleDeclaration`, which turns the resolved value into a removal exactly when the class rule already supplies that same value. `clearLineClamp`'s `@remarks` ([1456](packages/lib/src/typescript/lib/component/input/Text.ts#L1456)-[1461](packages/lib/src/typescript/lib/component/input/Text.ts#L1461)) stays as written; it describes a hazard this change does not alter.
   *Check:* `npm run docs:api` from the repo root — must finish with zero warnings.

8. **Run the new test file.** `npx vitest run tests/component/input/TextTruncateWritePath.test.ts` — all green.

9. **Update the two pre-existing test files that pin the old behaviour.** Both changes reflect the intended new behaviour, not a regression — confirm each against `## Expected Behaviour` before editing. Both follow one rule, which is worth writing into the first file's header:

   > After this change, `whiteSpace`, `textOverflow`, and `lineHeight` are the three keys the render phase reconciles to an explicit removal instead of skipping. On an instance whose `#id` rule materialises — something real is queued for it in the same batch — each reads `null`. On an instance whose rule never materialises, no write is recorded at all and each reads `undefined`. Every other font key is skipped outright and reads `undefined` either way.

   - [`tests/component/input/TextClassStyleHoisting.test.ts`](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts): redefine `SKIPPABLE_FONT_KEYS` ([61](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L61)) as `FONT_KEYS` minus **both** `lineHeight` and `textOverflow` (today it excludes `textOverflow` only, and each of its seven loops hand-skips `lineHeight`); the six bare `if (key === 'lineHeight') continue;` lines can then go, and the one `if (key === 'fontSize' || key === 'lineHeight') continue;` line loses its `lineHeight` half. Replace the file header's `textOverflow` exception paragraph ([18](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L18)-[26](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L26)) and the `SKIPPABLE_FONT_KEYS` doc comment with the rule above. Replace the "documented `setTruncate` exception" test ([140](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L140)-[149](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L149)) with `## Expected Behaviour` row 1. Then apply the rule to the seven `lineHeight).toBeNull()` assertions: two sit on an instance that still materialises a rule and keep `toBeNull()` — the `Legend` case ([280](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L280), whose `applyStyle` override always re-asserts `marginLeft`) and the custom-`fontSize` case ([372](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L372)); the other five ([137](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L137), [251](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L251), [294](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L294), [306](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L306), [336](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L336)) sit on instances that now materialise no rule at all and become `toBeUndefined()`. Add a matching `textOverflow` assertion beside each of the seven, with the same expectation as its `lineHeight` neighbour.
   - [`tests/component/table/CellTextSelection.test.ts`](packages/lib/tests/component/table/CellTextSelection.test.ts#L230): the `SelectableText` case ([230](packages/lib/tests/component/table/CellTextSelection.test.ts#L230)-[260](packages/lib/tests/component/table/CellTextSelection.test.ts#L260)) asserts `declarations.textOverflow` is `'ellipsis'` and `declarations.userSelect` is `null`. Both become `undefined`. `whiteSpace` and `textOverflow` are that child's only two real declarations today, so once both reconcile away it materialises no `#id` rule at all — the same outcome the `StringRenderer` case just above it ([228](packages/lib/tests/component/table/CellTextSelection.test.ts#L228)) already asserts for the renderer itself.[^selectabletext-empty] Rewrite the test's comment to say that, and rename it — "keeping only textOverflow" is no longer true.

10. **Run the full suite and sweep for anything else pinned to the old behaviour.** `npx vitest run --no-file-parallelism` from `packages/lib`. `grep -rln "whiteSpace\|white-space\|textOverflow\|text-overflow" packages/lib/tests` lists the candidate files; the two in step 9 are the only ones expected to fail, since the rest assert on getters (`getWhiteSpace()`, `getTextOverflow()`), which this plan does not change — except `getWhiteSpace()` after `setTruncate(false)`, covered by `## Expected Behaviour` row 10.

11. **Add the changelog entry and amend the stale one.** See `## Documentation Impact`.

12. **Full verification.** See `## Verification`.

13. **Verify live in a browser, and record the Style Audit before/after numbers.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/input/TextTruncateWritePath.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts` |
| Modify | `packages/lib/tests/component/table/CellTextSelection.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-10 are unit-testable against the recording DOM sink. Rows 11-12 need a live browser.

Observation rule for every row that expects a removal: the `#id` rule is only inserted when something real is queued for it in the same batch, so a test asserting a recorded removal must give the instance a real deviating declaration first (`{ fontWeight: 'bold' }` is the cheapest). A row that expects *nothing at all* asserts `toBeUndefined()`, because no `setRuleStyles` write for that selector is ever recorded.

| # | Case | Expected |
|---|---|---|
| 1 | `new Text('x')` renders | No `#id` rule is written at all — `declarationsDuring(sink, idSelector(text), …)` is `{}`. Both `whiteSpace` and `textOverflow` are absent, and so is every other key |
| 2 | `new Text('x', { fontWeight: 'bold' })` renders | The `#id` rule materialises and carries `fontWeight: 'bold'`; its `whiteSpace` and `textOverflow` entries are `null` (explicit removals), not the old real values |
| 3 | `new Text('x', { truncate: false })` renders | `#id` carries a real `textOverflow: 'clip'` — unchanged from today. `getTextOverflow()` is `null` |
| 4 | An already-rendered `new Text('x', { fontWeight: 'bold' })` calls `setTruncate(false)` | Writes a real `textOverflow: 'clip'` to `#id` — unchanged from today |
| 5 | An already-rendered `new Text('x', { fontWeight: 'bold' })` calls `setWhiteSpace('nowrap')` | Writes a `whiteSpace` **removal** to `#id`; the framework rule supplies `nowrap` |
| 6 | The same instance calls `setWhiteSpace('normal')` | Writes a real `whiteSpace: 'normal'` to `#id` — unchanged from today |
| 7 | The same instance calls `setTextOverflow('ellipsis')`, then `setTextOverflow('clip')` | First call writes a `textOverflow` **removal**; second writes a real `textOverflow: 'clip'` |
| 8 | An already-rendered `Text` with `truncate: true` and a real override calls `clearTextOverflow()` after an earlier `setTextOverflow('clip')` | Writes a `textOverflow` **removal** — the resolved value `'ellipsis'` matches `.Text`, which supplies it |
| 9 | A bare `new Component()` renders | No `whiteSpace` entry is recorded for `#id` — a stock component materialises no rule at all, before or after this change — and `white-space: nowrap` still comes from the framework rule. A control, confirming the base-class change costs a non-`Text` component nothing |
| 10 | `new Text('x', { truncate: false })` then `getWhiteSpace()` | Returns `null`. Today it returns the stale `'nowrap'`, because `setTruncate`'s raw write bypassed the field's own setter |
| 11 | Manual — live app, `#/style-audit`, on a screen with many `Text`-bearing components (`#/buttons`, `#/tables`, `#/menus`) | No duplicate-rule row's body contains `white-space: nowrap` or `text-overflow: ellipsis` any more. Record the panel's total-rules / per-instance-rules / wasted-KB summary before and after |
| 12 | Manual — live app, computed styles on a `Text`, a `Button` label, a table cell renderer, a `MenuItem` title, a `Dialog` title, and a `Tooltip` | `white-space` and `text-overflow` resolve to the same values as before the change; ellipsis truncation still renders on a narrowed label; the `Tooltip`'s `pre-wrap` and `Notification`'s `normal` wrapping are unaffected |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants (reproduced from the per-step checks):

```
grep -n 'this.setElementCSSRule("whiteSpace", value)'  packages/lib/src/typescript/lib/core/Component.ts          # zero matches
grep -n 'writeRuleDeclaration("whiteSpace"'            packages/lib/src/typescript/lib/core/Component.ts          # zero matches
grep -n 'reconcileRuleDeclaration("whiteSpace"'        packages/lib/src/typescript/lib/core/Component.ts          # one match
grep -n 'setElementCSSRule("textOverflow"'             packages/lib/src/typescript/lib/component/input/Text.ts     # zero matches
grep -n 'setElementCSSRule("whiteSpace"'               packages/lib/src/typescript/lib/component/input/Text.ts     # zero matches
grep -n 'writeRuleDeclaration("textOverflow"'          packages/lib/src/typescript/lib/component/input/Text.ts     # zero matches
grep -n 'reconcileRuleDeclaration("textOverflow"'      packages/lib/src/typescript/lib/component/input/Text.ts     # one match
```

**Manual browser verification (rows 11-12) is required.** The offline harness records writes; it does not run a CSS cascade.

- Start a dev server on a spare port from *this worktree*, not the user's existing server, and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Exercise `#/buttons`, `#/tables`, `#/menus`, a `Dialog`, and a `Tooltip`, then `#/style-audit`.
- Read **computed styles**, not screenshots, for row 12.

---

## Documentation Impact

No exported symbol changes: `setWhiteSpace`, `clearWhiteSpace`, `setTextOverflow`, `clearTextOverflow`, and `setTruncate` keep their signatures, and the write helpers are `protected`. No API page, barrel, or sidebar entry changes.

Two edits to `packages/lib/docs/reference/changelog/next.md`, both under `## Changed` → `### Core`:

1. **Amend the existing `Text` hoisting bullet.** It currently ends "(`text-overflow` is the one exception — it keeps writing per-instance for now)" and "for every declaration but that one". Both clauses become false; remove them so the bullet covers all twelve declarations.

2. **Add a new bullet** after the `border-radius`/`visibility` one:

> **`white-space` and `text-overflow` now dedupe against the shared tier too, which removes the per-instance CSS rule from most `Text` instances entirely.** Every `Text` used to write `white-space: nowrap; text-overflow: ellipsis` to its own `#id` rule, even though the framework rule and the shared `.Text` rule already supply both — a `Text` with no per-instance font override now writes no rule of its own at all. As with the earlier hoisting notes, a consumer stylesheet rule that sets `white-space` or `text-overflow` on a component by class now ties with the generated class rule (or beats the framework rule outright) where the framework's per-instance rule previously always won. Raise the selector's specificity, or target the component's id, if a consumer rule starts winning where it should not. One small behaviour change: `getWhiteSpace()` now returns `null` rather than `"nowrap"` after `setTruncate(false)`, matching what that call actually writes.

---

## Potential Challenges

- **A `Text` that materialises no `#id` rule is a new state for this class**, and several existing assertions read `null` (a recorded removal) where they will now read `undefined` (no write at all). Step 9 names each one; step 10 sweeps for the rest.
- **The impact is broad by construction** — `setWhiteSpace` lives on `Component`, so every component's render pass now queues a `whiteSpace` removal instead of skipping. That is inert for a component whose rule never materialises and a harmless `null` entry for one whose rule does, matching what `visibility` / `minWidth` / `userSelect` already do.
- **`setLineClamp` still writes `text-overflow: ellipsis` raw**, so a `Text` with a line clamp keeps a redundant real declaration. Out of scope (see `## Non-Goals`); it renders identically either way, and a later `applyStyle` pass now reconciles that key away without changing the rendered value.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Component.ts` | `setWhiteSpace` (4733), `clearWhiteSpace` (4746), `applyMiscInlineStyles` (5207), plus the mechanism this plan uses: `matchesClassStyle` (4840), `writeRuleDeclaration` (4931), `reconcileRuleDeclaration` (4945), `setReconciledCSSRules` (4961), `materialiseWhenNeeded` (5282) |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | `ownClassStyleDefaults` (126), `applyOptions`'s ungated `setTruncate` dispatch (300), `setTextOverflow` (1310), `clearTextOverflow` (1332), `setTruncate` (1366), `getClassStyleDefaults` (1491), `applyStyle` (1512) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `FRAMEWORK_DECLARATIONS.whiteSpace` (91) and `resolveDeclarations` (174) — the comparison values this plan relies on, unchanged |
| `plans/implemented/reconciled-write-path-widening.md` | The precedent this plan follows: the setter-plus-render-phase pair, and its Implementation Notes on pre-existing tests needing a removal-assertion update |
| `plans/implemented/component-borderradius-visibility-write-path-cleanup.md` | The second application of the same recipe, and the source of the changelog wording this plan's entry mirrors |
| `plans/implemented/text-applystyle-class-hoisting.md` | Where `.Text`'s class-tier `text-overflow` comes from, and where the `setTruncate` exception this plan closes was first documented |
| `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts` | Owns the behaviour that changes; also the source of the `declarationsDuring` / `idSelector` helpers and the module-state caveat the new test file inherits |
| `packages/lib/tests/component/table/CellTextSelection.test.ts` | The other pre-existing test pinned to the old behaviour (230-260) |

---

## Non-Goals

- **`setLineClamp` / `clearLineClamp`.** They write `textOverflow` raw inside a five-key bag, but they are called from exactly one place in the library (`Notification.ts:200`) and only on explicit opt-in, never from a constructor cascade the way `setTruncate` is. Their other four keys (`display`, `webkitBoxOrient`, `webkitLineClamp`, `overflow`) are genuine per-instance deviations that must reach `#id`, so raw-write-always-wins is correct for them. Migrating them would touch five keys to dedupe one declaration on a handful of instances.
- **`setWordBreak`.** `wordBreak` is not a hoistable key — `resolveDeclarations` never emits it — so the comparison could never match and reconciling it would be a literal no-op.
- **The ten other font declarations `writeFontDeclaration` handles.** Their setters also write raw, but `Text.applyOptions` dispatches each one only when the caller passed it, so a redundant declaration only lands when a caller passes a value exactly equal to the class default. No such call site exists, and the live audit found no duplication from them.
- **Registering `whiteSpace` as a `ClassStyleDefaults` field.** `resolveDeclarations` hardcodes `nowrap` for every class because no class deviates. Letting a class default its own `white-space` is a separate feature with no current caller.
- **Gating `setTruncate`'s dispatch on `options.truncate !== undefined`.** Rejected — see the footnote on the write-path decision.[^gating-rejected]
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^both-halves]: `reconciled-write-path-widening.md`'s own Architecture Decision "Nine matching render-phase writes must also switch to `reconcileRuleDeclaration`" states the general form of this argument: skipping is only safe when nothing can already be queued for that key, and a setter that can run before the first render breaks that assumption. `whiteSpace` and `textOverflow` are the strongest instance of it in the library, because `setTruncate`'s dispatch is *unconditional* — it fires on every `Text` construction, not only when a caller passes the option — so the queued value is present on every single instance rather than on the rare one that passed a value equal to the class default. Verified against the current code with a recording-sink probe: a default `new Text('x')` writes exactly `{ whiteSpace: "nowrap", textOverflow: "ellipsis" }` as real declarations to its `#id` rule, with every other queued key a `null` removal.

[^impact]: The byte figures are arithmetic on the rendered rule text, not a measurement: `white-space: nowrap; text-overflow: ellipsis; ` is 46 characters, and the `#<uuid> { … }` wrapper adds 39 more (a one-character `#`, a 36-character UUID, and the ` { ` / `}` delimiters). The count of affected instances is what a live measurement has to supply, since it depends entirely on which screen is open — hence step 13 rather than a number asserted here. The claim that these two are a plain `Text`'s *only* real declarations is a measurement, though, and is recorded in the write-path decision's own footnote.

[^clip-still-needed]: The substitution and the reconciliation answer different questions, and both are still needed. `getTextOverflow() ?? "clip"` answers "what value does this instance mean"; a `truncate: false` instance means "no ellipsis", which as CSS is `text-overflow: clip`, not "no declaration" — because `.Text` still declares `ellipsis`, and a `#id` rule that stops declaring the property loses to `.Text` rather than beating it. `setReconciledCSSRules` then answers "does that value need to be on `#id` at all", and for `"clip"` against `.Text`'s `"ellipsis"` the answer is yes. The two compose without interfering: the only case the reconciliation converts to a removal is the one where the resolved value already equals what the class rule supplies, so the cascade lands on the same value either way.

[^cleared-whitespace-cache]: The raw write at line 1374 sets no field, so `_whiteSpace` keeps the `"nowrap"` the `Component` constructor assigned at [line 593](packages/lib/src/typescript/lib/core/Component.ts#L593) while the DOM declaration has been removed — a cache that disagrees with what was written, which ARCHITECTURE.md's "Always cache in memory" rule exists to prevent. The rendered result is identical before and after the fix: with `_whiteSpace` left at `"nowrap"`, `applyMiscInlineStyles` writes `nowrap`, which matches the framework tier and is dropped; with `_whiteSpace` at `null`, the phase's `if` guard skips the write entirely. Either way the element resolves `white-space: nowrap` from the framework rule. Only `getWhiteSpace()`'s answer changes, and no framework code reads it — `applyMiscInlineStyles` reads the `_whiteSpace` field directly, and the sole other reader is a test assertion on a `truncate: true` instance.

[^clear-whitespace-noop]: `matchesClassStyle("whiteSpace", null)` compares `null` against the class-tier bag's value for the key, which `resolveDeclarations` sets to the string `"nowrap"` for every class without exception. The comparison can therefore never be true, so `setReconciledCSSRules({ whiteSpace: null })` resolves to `setElementCSSRules({ whiteSpace: null })` — byte-for-byte the write `clearWhiteSpace` already performs. `clearWhiteSpace` had no call site in the library before this plan; step 6 gives it one.

[^isolation-keys]: `RESTING_ISOLATION_KEYS` exists so a component's resting chrome does not sit on a bare `#id` rule that outranks the shared `.ClassName.pressed` / `.ClassName:hover` rules. The keys that can collide are the ones a state-tier extractor emits, and every extractor in the library emits only `color`, `backgroundColor`, `backgroundImage`, and `boxShadow` (see `Button.extractPressedClassDeclarations`, [Button.ts:616](packages/lib/src/typescript/lib/component/button/Button.ts#L616)). No state rule anywhere sets `white-space` or `text-overflow`, confirmed by grepping both property names across `packages/lib/src`. Separately, `Text` and its subclasses never override `getRestingExclusionSuffixes`, so `isRestingChromeIsolated()` is `false` for them and the isolation branch is not even reached.

[^other-call-sites]: Full enumeration, from `grep -rn 'setWhiteSpace(\|setTextOverflow(' packages/lib/src`. `setWhiteSpace`: `Markdown.ts:609` (`"normal"`, on itself), `MenuItem.ts:296` (`"nowrap"`, on a `Text` child), `Notification.ts:201` (`"normal"`), `Notification.ts:513` (`"pre-wrap"`), `Tooltip.ts:169` (`"pre-wrap"`), `Dialog.ts:225` (`"nowrap"`, on a `Text` child), `Dialog.ts:631` (`"normal"`). `setTextOverflow`: `Header.ts:137` (option-gated pass-through), `MenuItem.ts:298` (`"ellipsis"`), `Dialog.ts:224` (`"ellipsis"`). Every call passing `"nowrap"` or `"ellipsis"` targets a plain `Text` instance whose `.Text` class rule already carries the value, so all four become removals; every call passing `"normal"` / `"pre-wrap"` / an explicit `Header` option deviates from the class tier and keeps writing a real declaration.

[^selectabletext-empty]: Confirmed against the current code with a recording-sink probe: for `new StringRenderer()`, the `SelectableText` child's `#id` declarations are exactly `{ whiteSpace: "nowrap", overflowX: null, overflowY: null, textOverflow: "ellipsis", visibility: null, minWidth: null, minHeight: null, maxWidth: null, maxHeight: null, userSelect: null, lineHeight: null }` — two real values, nine removals. Turning those two into removals leaves nothing that would make `materialiseWhenNeeded` insert the rule, so no `setRuleStyles` write is recorded for that selector and every key reads `undefined`.

[^gating-rejected]: Gating `Text.applyOptions`'s `setTruncate` call on `options.truncate !== undefined` would also stop the constructor-time queue, and the render path would still produce the right CSS (`getTextOverflow()` already folds `truncate` in; `_whiteSpace` already defaults to `"nowrap"`; the class tier already resolves `overflow` to `hidden` for `Text`). It is rejected for two reasons. It changes the observable API — `new Text('x').getOverflow()` would return `null` instead of `"hidden"`, and `getWhiteSpace()` would stop reflecting the truncation mode — and it fixes only this one caller: `MenuItem` and `Dialog` set the same two properties on their `Text` children directly, and would keep writing both to those children's instance rules. The write-path fix covers every caller at once and matches the two precedent plans.
