---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# NumberRenderer Text-Align Class-Default Hoist — Implementation Plan

## Overview

The in-app Style Audit panel (`#/style-audit`) reported a live duplicate-rule
group attributed to `Text`, body `{ text-align: right; }`, at 246 instances /
5.26 KB, with several table demo windows open. That count is demo-data-
dependent, not a fixed number — this plan did not attempt to reproduce it
exactly (see `## Verification`'s manual step for what to check instead: the
row's absence, not a byte figure). The cause is
[`NumberRenderer`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L34),
which builds an internal `SelectableText` and, in its constructor, calls
`this._text.setTextAlign(align)` — a raw runtime setter, imperative and
per-instance — where `align: "left" | "right" = "right"` is a constructor
parameter.
[`CellText.ts`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L36)'s
`buildCellRenderer` constructs `new NumberRenderer(numberAlign)` for every
typed `number` column, defaulting `numberAlign` to `"right"`;
[`DynamicCell.ts`](packages/lib/src/typescript/lib/component/table/cell/Dynamic.ts#L226)
is the one caller that passes `"left"` explicitly, since its number row sits
next to left-aligned string/date/combo rows in the same column.

`setTextAlign` writes through `setElementCSSRule`
([Text.ts:853-857](packages/lib/src/typescript/lib/component/input/Text.ts#L853-L857)),
which queues straight into the component's own dirty style bag
([Component.ts:1714-1722](packages/lib/src/typescript/lib/core/Component.ts#L1714-L1722))
with no comparison against the class-tier default. A probe against this
branch's current code confirms the consequence directly: **both** alignments
write a real per-instance `#id` declaration today — `{textAlign: "right",
...}` for the default case and `{textAlign: "left", ...}` for
`DynamicCell`'s case, with every other declaration already `null`.[^probe-before]
The Style Audit's 246-instance figure is the dominant case (most number
columns are typed, not `DynamicCell`), not the only one.

This plan fixes both, by registering `textAlign` as a class-tier default the
same way
[`checkboxbox-borderradius-hoist.md`](plans/implemented/checkboxbox-borderradius-hoist.md)
and
[`glyph-preferredsize-reconciled-write-path.md`](plans/implemented/glyph-preferredsize-reconciled-write-path.md)
already fixed the identical class of bug (a composing parent's raw
imperative setter call defeating the class tier) for `CheckboxBox` and
`CheckboxCheckGlyph`/`RadioButtonDot`. `styleGroup`
([`shared-instance-style-groups.md`](plans/implemented/shared-instance-style-groups.md)),
the option this plan's brief originally proposed, turns out not to apply
here — see `## Architecture Decisions`. Only
[`packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts)
changes; `core/Component.ts` and `core/ClassStyleRules.ts` are read, not
modified.

---

## Architecture Decisions

### `styleGroup` does not cover `textAlign` — confirmed from the shipped code, not assumed

`styleGroup`'s shared content comes from
[`resolveInstanceStyleDeclarations`](packages/lib/src/typescript/lib/core/Component.ts#L307-L320),
whose own doc comment states it is "Scoped to the same fields the class tier
hoists via `ClassStyleDefaults`, minus `backgroundImage`/`borderRadius`/
`visible`/`displayed`/`font`, **which a `styleGroup` does not cover**." The
function only reads `getBackgroundColor()`, `getBorder()`, `getCursor()`,
`getForegroundColor()`, `getOutline()`, `getUserSelect()`, `getShadow()`,
`getMinSizeConstraint()`, `getMaxSizeConstraint()`, `getOverflow()` — no font
getter. `textAlign` lives under `ClassStyleDefaults.font`
([ClassStyleRules.ts:48](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L48)),
so a `_styleGroupBag` built from that function never contains a `textAlign`
key, and
[`matchesClassStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4839-L4846)'s
group check (`this._styleGroupBag[key] === value`) can never match on it.
Applying `styleGroup` to `_text` as shipped would be a no-op for this bug —
the `#id` write would persist exactly as today.[^styleGroup-widen-rejected]

### Use the class tier's `ownClassStyleDefaults`, the established fix for this exact bug shape

The same "composing parent's raw imperative setter call bypasses the class
tier" bug was already fixed twice on this branch, for `CheckboxBox`'s
`border-radius` and for `CheckboxCheckGlyph`'s/`RadioButtonDot`'s fixed
size — both by moving the literal into a `_default<Name>Options` bag (so the
instance's own resolved value agrees with the class default) and registering
a matching `protected static readonly ownClassStyleDefaults`
([ARCHITECTURE.md](ARCHITECTURE.md), *The class tier is hierarchy-aware*).
This plan applies the identical fix shape to `NumberRenderer`'s `_text`.

The one structural difference: `CheckboxCheckGlyph` (always 12×12) and
`RadioButtonDot` (always 8×8) are each a single owner with a single fixed
value, so each gets one dedicated subclass.
[`NumberRenderer`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L34)
is one owner with **two** fixed values selected by a constructor argument —
not a value that "genuinely varies per instance" in the sense that rules out
a class default, but a closed choice between two constants. The fix mirrors
`CheckboxCheckGlyph`/`RadioButtonDot`'s "two owners, two dedicated
subclasses" shape, generalised to "one owner, two dedicated concrete
classes, one per constant": a new `NumberRendererText` class carries the
`"right"` default; the existing `SelectableText` — already used for `"left"`
today — needs no subclass at all, because `"left"` already **is** `Text`'s
own base default
([Text.ts:64](packages/lib/src/typescript/lib/component/input/Text.ts#L64)).
`NumberRenderer`'s constructor picks between the two concrete classes
instead of calling `setTextAlign` on either.

### `NumberRendererText`'s class default must spread `Text`'s whole font bag, not declare `textAlign` alone

The hierarchy walk merges a level's own `ownClassStyleDefaults` over its
parent's with a **shallow** spread
([`mergeClassStyleDefaults`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L321-L326):
"a subclass that redeclares `border` or `font` replaces the whole
sub-value"). If `NumberRendererText.ownClassStyleDefaults.font` declared only
`{ textAlign: "right" }`, that object would **replace** `Text`'s entire font
bag at `NumberRendererText`'s level — losing `fontFamily`/`fontSize`/
`fontWeight`/etc., which would then stop matching the instance's own resolved
values and start writing real per-instance declarations for all of them,
trading one duplicate for several. The fix spreads `Text.ownClassStyleDefaults.font`
(a `protected static` field `NumberRendererText` can read directly, since it
descends from `Text` through `SelectableText`[^protected-static-access]) and
overrides only `textAlign`. A probe with this exact shape confirms the
result: the generated `.NumberRendererText` rule carries `{ textAlign:
"right" }` alone — the hierarchy walk's own diff-against-parent step already
reduces the full spread down to the one genuine deviation, so no other font
property is affected.[^probe-after]

### Two distinct alignments, confirmed not to collapse into one group

`DynamicCell`'s left-aligned row and a typed column's right-aligned row must
keep rendering differently in the same table. They do, because they resolve
to two different concrete classes with two different DOM class lists — never
one shared group a second instance could accidentally match into:

| `align` | Concrete class of `_text` | Class rule(s) that supply `text-align` |
|---|---|---|
| `"right"` (default) | `NumberRendererText` | `.NumberRendererText { text-align: right; }` |
| `"left"` (`DynamicCell`) | `SelectableText` | `.Text { text-align: left; ...}` (inherited; `SelectableText` itself declares no font) |

Confirmed live against a recording sink: a `NumberRenderer()` instance's
`_text.constructor.name` is `"NumberRendererText"`; a `NumberRenderer("left")`
instance's is `"SelectableText"` — genuinely different classes, not the same
class compared against two values.[^probe-after]

---

## Internal Structure

`Number.ts`, in full (new class inserted before `NumberRenderer`; only the
marked lines in `NumberRenderer` itself change):

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { ComponentOptions } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
import { SelectableText, SelectableTextOptions } from "~/component/input/SelectableText.js";
import { callable } from "~/core/Callable.js";
import type { ClassStyleDefaults } from "~/core/ClassStyleRules.js";

const _defaultNumberRendererOptions: Partial<ComponentOptions> = { cursor: "text", userSelect: "text" };

// NumberRenderer's own right-aligned convention (see its constructor doc,
// below) — shared by the class default and the instance default bag so the
// two can never drift apart.
const NUMBER_RENDERER_TEXT_ALIGN = "right";

const _defaultNumberRendererTextOptions: Partial<SelectableTextOptions> = {
    textAlign: NUMBER_RENDERER_TEXT_ALIGN,
};

/**
 * The value text for a right-aligned {@link NumberRenderer} — every typed
 * `number` column renders with this alignment by default, so without a
 * shared class rule, every cell would carry an identical `text-align: right`
 * declaration on its own `#id` rule. Registers `textAlign` as a class
 * default, spread over `Text`'s own font declarations so every other font
 * property still resolves through the inherited `.Text` rule instead of
 * being duplicated too — see `## Architecture Decisions`. Mirrors
 * `SelectableText`'s own `cursor`/`userSelect` deviation from `Text`, one
 * class further down the same chain.
 *
 * {@link DynamicCell}'s left-aligned number row uses plain `SelectableText`
 * instead — `"left"` already matches `Text`'s own class default, so it needs
 * no dedicated class; see `NumberRenderer`'s constructor.
 */
class NumberRendererText extends SelectableText {

    protected static readonly ownClassStyleDefaults: ClassStyleDefaults = {
        font: {
            ...Text.ownClassStyleDefaults.font,
            textAlign: NUMBER_RENDERER_TEXT_ALIGN,
        },
    };

    constructor() {
        super(undefined, undefined, _defaultNumberRendererTextOptions);
    }
}

/**
 * A read-only renderer for numeric cell values.
 *
 * Displays the value via a {@link Text}, right-aligned by default. Caches
 * the last value passed to {@link setValue} so {@link getValue} returns the
 * exact `Number | null` that was rendered — never the result of re-parsing
 * the DOM text, which silently coerces an empty cell back to `0`.
 *
 * @category Components
 */
class NumberRenderer extends CellRenderer<Number | null> {

    private _text:    Text;
    private _value:   Number | null = null;
    private _display: string        = "";

    /**
     * @param align - The text alignment to render with. Defaults to
     *   `"right"`, the convention for a homogeneous numeric column;
     *   {@link DynamicCell} passes `"left"` instead, since it renders a
     *   number row alongside left-aligned rows of other types in the same
     *   column.
     */
    constructor(align: "left" | "right" = "right") {
        super(_defaultNumberRendererOptions);

        // "right" gets its own class default (NumberRendererText); "left"
        // already matches Text's own class default, so a plain
        // SelectableText needs no setTextAlign call either.
        this._text = align === "right" ? new NumberRendererText() : new SelectableText();
        this._text.setPointerEvents("none");
        this._text.setText("");
        this._text.setAutoMeasure(false);

        this.addComponent(this._text);
    }

    // getValue / setValue / getDisplayText: unchanged.
}

const NumberRendererCallable = callable(NumberRenderer);
type NumberRendererCallable = NumberRenderer;
export {
    NumberRenderer         as _NumberRenderer,
    NumberRendererCallable as NumberRenderer
};
```

`NumberRendererText` is module-private (not exported, not wrapped in
`callable()`) — the same treatment `CheckboxBox`/`CheckboxCheckGlyph`/
`RadioButtonDot` get in `Checkbox.ts`/`RadioButton.ts`.

---

## Ordered Implementation Steps

1. **Write the new tests first**, in
   [`packages/lib/tests/component/table/CellTextSelection.test.ts`](packages/lib/tests/component/table/CellTextSelection.test.ts),
   inside the existing `describe('selectable text resolves through the class
   rule, not a per-instance rule', ...)` block (after the `SelectableText`
   test at [lines 241-260](packages/lib/tests/component/table/CellTextSelection.test.ts#L241-L260),
   reusing that file's `declarationsDuring`/`idSelector` helpers and its
   already-imported `NumberRenderer` and `_ruleCacheHas`):
   ```typescript
   it("a right-aligned NumberRenderer's Text writes no per-instance declarations at all", () => {
       const sink = DOM.sink as RecordingDOMSink;

       new NumberRenderer().getElement(true);

       const r    = new NumberRenderer();
       const text = (r as any)._text;

       const declarations = declarationsDuring(sink, idSelector(text), () => r.getElement(true));

       expect(Object.keys(declarations)).toEqual([]);
       expect(_ruleCacheHas('.NumberRendererText')).toBe(true);
   });

   it("a left-aligned NumberRenderer (DynamicCell's alignment) keeps sharing Text's own default", () => {
       const sink = DOM.sink as RecordingDOMSink;

       new NumberRenderer('left').getElement(true);

       const r    = new NumberRenderer('left');
       const text = (r as any)._text;

       const declarations = declarationsDuring(sink, idSelector(text), () => r.getElement(true));

       expect(Object.keys(declarations)).toEqual([]);
       expect(text.constructor.name).toBe('SelectableText');
   });
   ```
   *Check:* `npx vitest run tests/component/table/CellTextSelection.test.ts` from
   `packages/lib` — both new cases fail against the current (unfixed) source
   (`declarations` holds a real `textAlign` entry; `_ruleCacheHas('.NumberRendererText')`
   is `false` since the class doesn't exist yet).

2. **Add a registry row to
   [`default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts).**
   Add `import { NumberRenderer } from '~/component/table/cell/renderer/Number';`
   near the `StringCell` import ([line 60](packages/lib/tests/component/default-options-fallback.test.ts#L60)).
   Add, immediately after the `'SelectableText cursor'` row
   ([line 429](packages/lib/tests/component/default-options-fallback.test.ts#L429)):
   ```typescript
   { label: 'NumberRenderer _text textAlign (default, right)', resolve: () => (new NumberRenderer() as any)._text.getTextAlign(), expected: 'right' },
   ```
   This row is expected to pass both before and after the source change — it
   guards the *getter*, per [ARCHITECTURE.md](ARCHITECTURE.md)'s "Class-level
   defaults must survive the getter" registry mandate, not the dedup itself
   (the dedup is what step 1's new tests pin).
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — passes immediately.

3. **Apply the source fix in
   [`Number.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts).**
   Replace the file's contents exactly as shown in `## Internal Structure`:
   add the `NUMBER_RENDERER_TEXT_ALIGN` constant, `_defaultNumberRendererTextOptions`,
   and the new `NumberRendererText` class; change `_text`'s field declaration
   to drop its initializer; replace the constructor's `this._text.setTextAlign(align)`
   line with the `align === "right" ? ... : ...` construction. Leave
   `getValue`/`setValue`/`getDisplayText` untouched.
   *Check:* `npm run typecheck`. `grep -n 'setTextAlign' packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts` — zero matches.

4. **Re-run the tests touched in steps 1-2.**
   `npx vitest run tests/component/table/CellTextSelection.test.ts tests/component/default-options-fallback.test.ts`
   from `packages/lib` — all green now.

5. **Run the full suite for regressions elsewhere.** `npm test` from
   `packages/lib`. The pre-existing alignment-value assertions in
   [`renderer.test.ts`](packages/lib/tests/component/table/cell/renderer.test.ts#L115-L118),
   [`CellText.test.ts`](packages/lib/tests/component/table/cell/CellText.test.ts#L32-L39),
   and
   [`DynamicCell.test.ts`](packages/lib/tests/component/table/cell/DynamicCell.test.ts#L96-L106)
   all read `_text.getTextAlign()`, which resolves identically before and
   after this fix (confirmed during drafting — see `## Notes`); none of them
   need edits. Treat any other new failure as a genuine regression to
   investigate, not something to paper over.

6. **Add the changelog entry.** See `## Documentation Impact`.

7. **Full verification.** See `## Verification`.

8. **Verify live in a browser.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts` |
| Modify | `packages/lib/tests/component/table/CellTextSelection.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-5 are unit-testable against the recording DOM sink (steps 1-2 add or
pin them). Rows 6-7 need a live browser.

| # | Case | Expected | Testable |
|---|---|---|---|
| 1 | `new NumberRenderer()` (default, right-aligned) renders for the first time | Its `_text` writes no declaration at all to its own `#id` rule — `textAlign` (and every other key) is absent, not an explicit `null` removal | Unit (`CellTextSelection.test.ts`, new) |
| 2 | `new NumberRenderer('left')` (DynamicCell's alignment) renders for the first time | Same as row 1: `_text` writes no declaration at all | Unit (`CellTextSelection.test.ts`, new) |
| 3 | `.NumberRendererText` shared class rule, after any right-aligned `NumberRenderer` has rendered | Exists, body `{ text-align: right; }` — nothing else | Unit (`_ruleCacheHas`, `CellTextSelection.test.ts`) / Manual (Style Audit body column) |
| 4 | A second, third, … right-aligned `NumberRenderer` | Each also writes nothing to its own `#id` rule — all share the one `.NumberRendererText` rule from row 3 | Unit (row 1's test already primes with one throwaway instance before measuring the second — the same sharing) / Manual (Style Audit count across many real rows) |
| 5 | `(new NumberRenderer() as any)._text.getTextAlign()` on a bare, unrendered instance | `'right'` — unchanged before and after this plan | Unit (registry row) |
| 6 | Manual — live app, `#/style-audit`, after opening a table with a typed `number` column (`#/misc` → "Show window with table (slow)!", `col3`) | The `Text` / `{ text-align: right; }` duplicate-rule row is gone entirely | Manual |
| 7 | Manual — the "Property Grid" demo (`PropertyGridPanel`, `main.ts`'s nav section of the same name), whose `value` column is `type: 'auto'` and renders through `DynamicCell` for mixed row types including numbers | The `DynamicCell` number row still reads left-aligned next to its left-aligned string/date/combo neighbours; a typed `number` column elsewhere (row 6's table) still reads right-aligned — no visual change either way | Manual |

The pre-existing `getTextAlign()`-based assertions in `renderer.test.ts`,
`CellText.test.ts`, and `DynamicCell.test.ts` (cited in `## Ordered
Implementation Steps` step 5) continue to hold unmodified — they assert the
*value* `getTextAlign()` reports, which this plan does not change, only
*which CSS rule delivers it*.

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariant:

```
grep -n 'setTextAlign' packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts   # zero matches
```

**Manual browser verification (rows 6-7 of `## Expected Behaviour`) is
required.** The offline harness records writes; it does not run a CSS
cascade or reproduce the Style Audit panel's own stylesheet scan. Start a
dev server on a spare port from *this worktree*, not the user's existing one
(confirm with `readlink /proc/<pid>/cwd` that it resolves here). Navigate to
`#/misc`, click "Show window with table (slow)!" (its `col3` is a typed
`number` column, reproducing the original bug report's scenario), then
"Style Audit", then "Refresh". Confirm the `Text` / `{ text-align: right; }`
row is gone. Then open the "Property Grid" demo (`PropertyGridPanel`) —
its `value` column is `type: 'auto'` and renders through `DynamicCell` for
mixed row types including numbers — and confirm the number row still reads
left-aligned next to its string/date/combo neighbours, unchanged from before
this fix.

---

## Documentation Impact

No exported symbol changes — `NumberRendererText` is module-private, and
`NumberRenderer`'s public constructor signature (`align: "left" | "right" =
"right"`) is unchanged. One changelog entry in
`packages/lib/docs/reference/changelog/next.md`, under `## Changed` →
`### Components`, appended as a new bullet **after the last existing bullet
in that list** (currently the `Text` `setLineHeight`/`centerInHeight` entry,
[next.md:194-201](packages/lib/docs/reference/changelog/next.md#L194-L201)),
immediately before the `### Table` heading
([next.md:203](packages/lib/docs/reference/changelog/next.md#L203)) — kept
as one small, self-contained bullet since two sibling plans
(`label-text-class-defaults-followups`, `glyph-size-registration-gap-followups`)
edit this same file concurrently:

> **[`NumberRenderer`](/api/component/table/classes/NumberRenderer)'s
> value text no longer duplicates its text alignment on every instance's own
> CSS rule.** Its right-aligned value text (the default for a typed `number`
> column) now shares one CSS rule across every instance in the app;
> [`DynamicCell`](/api/component/table/classes/DynamicCell)'s left-aligned
> instances already share `Text`'s own default and are unaffected. Nothing
> changes visually; no consumer action needed.

Run `npm run docs:api` — zero warnings.

---

## Potential Challenges

- **The shallow `font` merge (`## Architecture Decisions`) is easy to get
  wrong.** Declaring `NumberRendererText.ownClassStyleDefaults.font` as just
  `{ textAlign: "right" }` compiles fine but silently un-dedupes every other
  font property. Mitigated by giving the exact code in `## Internal
  Structure`, verified against a live probe (`## Notes`).
- **`_text`'s field declaration loses its inline initializer.** A reviewer
  skimming the diff might read the bare `private _text: Text;` as an
  oversight. It is required — the concrete class now depends on the
  constructor's `align` parameter, which a field initializer cannot see.
  TypeScript's definite-assignment analysis accepts the unconditional
  ternary assignment in the constructor body with no `!`/`declare` needed
  (confirmed directly against this project's own `tsc` settings during
  drafting — see `## Notes`).

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts` | The file being changed — full replacement given in `## Internal Structure` |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | `ownClassStyleDefaults` (126-141) — the exact bag `NumberRendererText` spreads; `setTextAlign`/`getTextAlign` (842-859) — the raw-setter write path this plan routes around; `applySubclassStyles`/`writeFontDeclaration` (1502-1537) — the render-time reconciled path that already dedupes `textAlign` once the class default matches |
| `packages/lib/src/typescript/lib/component/input/SelectableText.ts` | The direct base class for the new `NumberRendererText`, and the precedent for a leaf-level `ownClassStyleDefaults` deviation (cursor/userSelect) that this plan's `font` deviation mirrors |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | Read, not modified — `mergeClassStyleDefaults` (321-326, the shallow-merge gotcha), `resolveClassLevel`/`chainParticipates`/`ownDefaultsOf` (342-431), `ensureClassStyleRule` (589-635) — confirms the hierarchy walk and diff-against-parent behaviour this plan's `NumberRendererText` relies on |
| `packages/lib/src/typescript/lib/core/Component.ts` | Read, not modified — `resolveInstanceStyleDeclarations` (295-320, why `styleGroup` doesn't cover `font`), `matchesClassStyle` (4839-4846), `writeRuleDeclaration` (4915-4937), `applyStyle`'s `_styleGroupBag` resolution (5019-5024) |
| `ARCHITECTURE.md` | *The class tier is hierarchy-aware* — the precedent this plan's fix shape follows |
| `plans/implemented/checkboxbox-borderradius-hoist.md` | Direct precedent: identical bug shape (a composing parent's raw imperative setter defeating class-tier dedup), identical fix shape (move the literal into a class default, delete the imperative call) |
| `plans/implemented/glyph-preferredsize-reconciled-write-path.md` | Precedent for "two owners, two dedicated subclasses, one fixed value each" (`CheckboxCheckGlyph` 12×12, `RadioButtonDot` 8×8) and for the named-constant drift-prevention pattern this plan reuses |
| `plans/implemented/shared-instance-style-groups.md` | The `styleGroup` mechanism this plan's brief proposed and this plan found inapplicable — read to confirm `## Architecture Decisions`' reasoning, not because this plan uses it |
| `packages/lib/tests/component/table/CellTextSelection.test.ts` | The `declarationsDuring`/`idSelector` helpers and the `describe` block the new tests are added to (163-261) |
| `packages/lib/tests/component/default-options-fallback.test.ts` | The registry the new row extends (see the `SelectableText`/`StringCell` rows around 425-429 for the existing shape) |

---

## Non-Goals

- **Widening `styleGroup` to cover `font`/`textAlign`.** Would require a
  virtual, per-class-overridable resolution point on `Component` (base
  `resolveInstanceStyleDeclarations` has no access to `Text`-only getters
  like `getFontFamily()`), plus resolving the `ClassStyleDefaults.font`
  namespacing hazard the type itself already documents for `Glyph`/`TabBar`/
  `TextInput`. A real, separate design question — not attempted here.
- **Other `CellRenderer` subclasses in `cell/renderer/`.** Checked
  `String.ts`, `Date.ts`, `DateTime.ts`, `Time.ts`, `Combo.ts`, `Link.ts`,
  `Glyph.ts`, `Filter.ts`, `TreeCell.ts` — `Number.ts` is the only one that
  calls `setTextAlign` at all (`grep -rn 'TextAlign' packages/lib/src/typescript/lib/component/table/cell/renderer/*.ts`
  returns exactly the one match this plan fixes). No shared pattern to
  extract.
- **`NumberEditor`'s `this._textField.setTextAlign("right")`**
  ([`table/cell/editor/Number.ts:52`](packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts#L52)).
  A different directory (`cell/editor/`, not `cell/renderer/`), a different
  base class (`TextField`/`TextInput`, not `Text`), and out of this plan's
  requested scope.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

- **The `## Ordered Implementation Steps` step 3 / `## Verification` grep
  invariant (`grep -n 'setTextAlign' Number.ts` — zero matches) does not
  literally hold against the exact code this plan's own `## Internal
  Structure` prescribes.** `NumberRenderer`'s constructor comment (`"...a
  plain SelectableText needs no setTextAlign call either."`) contains the
  substring `setTextAlign`, so the plain-text grep reports one match — that
  comment line — not zero. The invariant's actual intent, that no raw
  `.setTextAlign(...)` call remains, is satisfied: `grep -n
  '\.setTextAlign('` returns zero matches, and the new
  `CellTextSelection.test.ts` cases pin the resulting behaviour directly.
  Implemented the file exactly as `## Internal Structure` specifies rather
  than reword the comment to dodge the plain-text grep, since the comment's
  wording is correct and useful; noting the discrepancy here so a future
  re-run of the literal `## Verification` command isn't mistaken for a
  regression.

- **Manual browser verification (`## Ordered Implementation Steps` step 8,
  `## Verification` rows 6-7) performed and recorded here**, per
  `implement/worker.md`'s requirement that non-automatable behaviour get a
  documented manual-verify step. Ran `npx vite --port 8021 --strictPort`
  from `packages/lib` in this worktree; confirmed via `readlink
  /proc/<pid>/cwd` that the server resolved to this worktree, not the main
  tree or another worktree. Row 6: navigated to `#/misc`, clicked "Show
  window with table (slow)!" (its `col3` is a typed `number` column), then
  "Style Audit", then "Refresh" — the resulting audit table (Total rules:
  527, per-instance rules: 438) carries no `Text` / `{ text-align: right;
  }` row; a script probe found 57 live elements with class `...
  NumberRendererText ...` in that table, every one resolving computed
  `text-align: right`. Row 7: navigated to `#/property-grid` — the
  `DynamicCell`-rendered "Count" row's value text (`"5"`) resolves to class
  `ts-ui-component Text SelectableText lh20px` (no `NumberRendererText`)
  with computed `text-align: left`, confirming `DynamicCell`'s left-aligned
  number row is unaffected and still shares `Text`'s own default. Server
  stopped and the extra browser tab closed after verification.

- **`## Architecture Decisions`' "Use the class tier's `ownClassStyleDefaults`"
  section (lines 78-87) overclaims what its two cited precedents did.**
  Neither `checkboxbox-borderradius-hoist.md` nor
  `glyph-preferredsize-reconciled-write-path.md` registered a
  `protected static readonly ownClassStyleDefaults` field — both fixed their
  bug via the *other*, flat/pre-hierarchy mechanism instead: moving the
  literal into a `_default<Name>Options` bag consulted by the class's plain
  `getClassStyleDefaults()` override, with no ancestor in the chain
  declaring `ownClassStyleDefaults` at all
  (`checkboxbox-borderradius-hoist.md:28`). The Glyph plan is explicit that
  this was a deliberate choice, not an oversight: it considered and
  *rejected* opting `Glyph` into `ownClassStyleDefaults`
  (`glyph-preferredsize-reconciled-write-path.md:285`, footnote
  `^why-not-hierarchy`), specifically because doing so on `Glyph` alone
  (without also touching `CheckboxCheckGlyph`/`RadioButtonDot`) would have
  regressed dedup that already worked. `grep -rn "ownClassStyleDefaults"
  packages/lib/src/typescript/lib/component/input/Checkbox.ts
  packages/lib/src/typescript/lib/component/input/RadioButton.ts
  packages/lib/src/typescript/lib/component/display/Glyph.ts` returns zero
  matches today, confirming neither class carries the field this plan's
  prose attributes to them. This does **not** implicate `NumberRendererText`'s
  own use of `ownClassStyleDefaults`, which is independently correct on its
  own terms: unlike `CheckboxBox`/`Glyph` (which extend `Component`
  directly, with no ancestor already on the hierarchy-walk branch),
  `NumberRendererText`'s ancestors `SelectableText` and `Text` **already**
  declare `ownClassStyleDefaults` (`SelectableText.ts:43`, `Text.ts:126`),
  so the class is already on the hierarchy-walk branch of
  `ensureClassStyleRule` regardless of what `NumberRendererText` itself
  does — per ARCHITECTURE.md's *The class tier is hierarchy-aware*, a
  participating leaf registers its own `ownClassStyleDefaults` rather than
  falling back to `getClassStyleDefaults()`, which the hierarchy-walk
  branch ignores once any ancestor participates. The code is unaffected;
  only the plan's precedent citation is corrected here.

---

## Notes

[^probe-before]: Verified directly against this branch's current (unfixed)
    code with a recording-sink probe: constructing a `NumberRenderer()` and a
    `NumberRenderer('left')`, priming each class's shared rule with a first
    throwaway instance, then rendering a second instance and recording every
    `setRuleStyles` call for its `_text`'s own `#id` selector. Right:
    `{"whiteSpace":null,"overflowX":null,"overflowY":null,"textOverflow":null,"textAlign":"right","visibility":null,"minWidth":null,"minHeight":null,"maxWidth":null,"maxHeight":null,"userSelect":null,"lineHeight":null}`.
    Left: identical except `"textAlign":"left"`. Every key already resolves
    to `null` (matching the class tier) except `textAlign`, confirming the
    raw `setTextAlign` call — not the render-time reconciled path — is the
    sole source of the duplicate, for **both** alignments, not only the
    default.

[^styleGroup-widen-rejected]: The alternative — teaching `styleGroup` to also
    hoist `font` fields — was considered and rejected for this plan
    specifically because it would touch `core/Component.ts`'s shared
    resolution helper for every component in the framework, not just table
    cell renderers, and would need to resolve the exact namespacing hazard
    `ClassStyleDefaults.font`'s own doc comment already flags (`Glyph`/
    `TabBar`/`TextInput` each have differently-typed, same-named font
    options that would collide in a naive flat resolution). That is a
    framework-wide design decision on its own, out of proportion to fixing
    one renderer's duplicate rule, and belongs in its own plan if ever
    pursued — see `## Non-Goals`.

[^protected-static-access]: Confirmed directly against this project's own
    `tsc` (via a scratch file compiled with `npx tsc --noEmit --strict`
    against `packages/lib`'s toolchain): a class two levels below the
    declaring class in the `extends` chain (mirroring `NumberRendererText
    extends SelectableText extends Text`) can reference the topmost
    ancestor's `protected static readonly` field directly by the ancestor's
    own name (`Text.ownClassStyleDefaults`) from within its own static field
    initializer, with zero compiler errors. `Text.getClassStyleDefaults()`
    (an instance method) already does the analogous same-class self-reference;
    this is the cross-subclass case, verified separately since it wasn't
    already proven elsewhere in this codebase.

[^probe-after]: Verified by temporarily applying this plan's exact `Number.ts`
    change (as given in `## Internal Structure`) in this worktree, then
    reverting once confirmed (the worktree's `git status` shows no diff).
    With the fix applied: `_text`'s own `#id` rule for both a right- and a
    left-aligned `NumberRenderer` shows zero recorded declarations (`{}`),
    confirmed with the same probe method as
    [^probe-before]. `npx vitest run` against every existing test file
    touching `NumberRenderer` (`renderer.test.ts`, `CellText.test.ts`,
    `DynamicCell.test.ts`, `CellTextSelection.test.ts`,
    `default-options-fallback.test.ts` — 262 tests total) passed unchanged
    with the fix applied, with no test edits. `npx tsc --noEmit -p .`
    reported zero new errors (the only errors present are pre-existing,
    in unrelated files, from other in-progress work on this branch). A
    separate probe recording every `setRuleStyles` call across both
    constructions confirmed the three relevant rules' exact bodies:
    `.Text` carries the full font bag with `textAlign: "left"` (unchanged);
    `.SelectableText` carries only `{userSelect: "text", cursor: "text"}`
    (unchanged); `.NumberRendererText` carries exactly `{textAlign:
    "right"}` — and that a right-aligned instance's `_text.constructor.name`
    is `"NumberRendererText"` while a left-aligned instance's is
    `"SelectableText"`, two genuinely distinct classes.
