# Checkbox / RadioButton Delegate Static Style Defaults — Implementation Plan

## Overview

[`Checkbox`](packages/lib/src/typescript/lib/component/input/Checkbox.ts) and [`RadioButton`](packages/lib/src/typescript/lib/component/input/RadioButton.ts) each build small internal visual pieces in their constructor — `Checkbox` builds `_box` (a plain `Component`, the 16×16 box), `_check` (a `Glyph`, the 12×12 check mark), and `_dash` (a plain `Component`, the 8×2 indeterminate bar); `RadioButton` builds `_ring` (a plain `Component`, the 16×16 ring) and `_dot` (a `Glyph`, the 8×8 filled dot). None of the five is its own class — each is constructed as a bare `new Component()` or `new Glyph(name)`, styled entirely by imperative setter calls (`setPreferredSize`, `setMinSize`, `setMaxSize`, `setCursor`, `setBackgroundColor`, `setForegroundColor`, …) with literals that are identical across every `Checkbox` / `RadioButton` instance in the app.

Because they share the plain `Component` / `Glyph` constructor with every other unrelated use of those two classes throughout the library, `Component.getClassStyleDefaults()`'s automatic per-class CSS hoisting ([core/ClassStyleRules.ts:222](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L222)) has no distinct class to key a shared rule on — each of these five pieces writes its own full set of declarations to its own `#id` rule, on every instance, forever. The in-app Style Audit panel confirms this costs real bytes: with the demo gallery's checkbox-heavy tabs open, `_box`'s size + colour rows run roughly 35 KB per state, `_check`'s roughly 20 KB, `_dash`'s roughly 16 KB — over 100 KB combined, scaling linearly with checkbox/radio count.

This plan gives each of the five pieces its own small, module-private `Component` / `Glyph` subclass — `CheckboxBox`, `CheckboxCheckGlyph`, `CheckboxDash`, `RadioButtonRing`, `RadioButtonDot` — and moves every **static** (construction-time-constant, never rewritten after construction) property into a `_default<Name>Options` bag forwarded through the existing `subclassDefaults` constructor parameter, exactly the way [`table-cell-class-style-defaults.md`](table-cell-class-style-defaults.md) does for `Cell`. Once a property is a registered class default, the *already-shipped* `ensureClassStyleRule` / `getClassStyleDefaults` mechanism (`component-chrome-base-tier-hoisting`, `state-style-rule-auto-dedup` — both merged into `master`) dedupes it onto one shared `.CheckboxBox` / `.CheckboxCheckGlyph` / etc. rule automatically, with no further code needed.

`_box` and `_ring`'s `backgroundColor` / `border` are **not** touched here — those two properties are rewritten on every checked/selected transition, not just once at construction, and dedupe safely only once the state-tier isolation mechanism exists. That half is [`checkbox-radio-delegate-state-style-defaults.md`](checkbox-radio-delegate-state-style-defaults.md), a separate, dependent plan.[^why-split] This plan is self-contained and has no dependency on unmerged work.

---

## Architecture Decisions

### Each delegate gets its own small, module-private subclass — not an exported reusable component, not a hand-rolled module-level rule

`_box` / `_check` / `_dash` / `_ring` / `_dot` become five `class`es declared directly inside `Checkbox.ts` / `RadioButton.ts`, never exported. This mirrors [`AbstractCalendarDropdown.ts`](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts)'s own `PickerDayHeader` / `PickerBlankCell` / `PickerNavButton` / `PickerMonthLabel` / `PickerDay` ([AbstractCalendarDropdown.ts:135-330](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L135-L330)) — small, single-purpose visual pieces of one bigger control, with exactly one call site each, that the codebase already solves the identical problem for.[^option-b-rejected]

### Each delegate's static properties move into a `_default<Name>Options` bag passed as `subclassDefaults`, not as `options`

The bag is the constructor's **second** argument (`super(undefined, _defaultCheckboxBoxOptions)`), not the first. Passing it as `options` (the first argument) would write it into the per-instance `_options` bag — invisible to `getClassStyleDefaults()`, which only ever reads `_defaultOptions` — and would silently defeat the whole point: no class rule would ever see these values.[^options-vs-subclassdefaults] This is the exact shape `Cell`, `PopupPanel`, and `SortPriorityBadge` already use.

None of the five delegate classes forwards its own `subclassDefaults` parameter to a further subclass. ARCHITECTURE.md's *Constructors forward `subclassDefaults`* rule asks every constructor to accept and forward one "even when no subclass exists yet" — but `PickerDayHeader` / `PickerNavButton` / `PickerBlankCell`, the established precedent for this exact "module-private, single-call-site delegate" shape, do not accept the parameter either. These five classes are never meant to be subclassed (they are private implementation detail of one file each), so adding the parameter would be speculative flexibility with no caller, which CODE_CONVENTIONS rules out directly.

### Which properties move, per delegate

Only properties whose imperative call is a true one-time construction constant — never re-invoked with a different value after the constructor returns — move. `_box` / `_ring`'s `backgroundColor` / `border` are re-written on every checked/selected transition (`Checkbox.applySelected`, `RadioButton.applySelected`) and are excluded — see the Overview.

| Delegate | Class | Moves into `_default<Name>Options` | Stays imperative, untouched |
|---|---|---|---|
| `_box` | `CheckboxBox extends Component` | `preferredSize`, `minSize`, `maxSize` (all `{16,16}`), `cursor: "pointer"` | `backgroundColor`, `border` (state-tier plan), `borderRadius` (see below), `setSize({16,16})` |
| `_check` | `CheckboxCheckGlyph extends Glyph` | `foregroundColor`, `preferredSize`, `minSize`, `maxSize` (all `{12,12}`) | `setX(1)`, `setY(1)`, `setOpacity(0)`, `setPointerEvents("none")`, `setTransition(...)` |
| `_dash` | `CheckboxDash extends Component` | `backgroundColor`, `preferredSize` / `maxSize` (`{8,2}`) — no `minSize`, matching today | `setSize({8,2})`, `setX(3)`, `setY(6)`, `setOpacity(0)`, `setPointerEvents("none")`, `setTransition(...)` |
| `_ring` | `RadioButtonRing extends Component` | `preferredSize`, `minSize`, `maxSize` (all `{16,16}`), `cursor: "pointer"` | `backgroundColor`, `border` (state-tier plan), `borderRadius`, `setSize({16,16})` |
| `_dot` | `RadioButtonDot extends Glyph` | `foregroundColor`, `preferredSize`, `minSize`, `maxSize` (all `{8,8}`) | `setX(3)`, `setY(3)`, `setOpacity(0)`, `setPointerEvents("none")`, `setTransition(...)` |

Opacity is excluded from every delegate: it is the one property that genuinely varies per instance (it encodes which of unchecked/checked/indeterminate/selected is currently showing), not a class-wide constant — moving it would be a correctness bug, not a cleanup.

### The matching imperative call is deleted, not left alongside the new default

Once a property is a construction-time constant registered in `_default<Name>Options`, the render-time `applyStyle` phases ([core/Component.ts:4858](packages/lib/src/typescript/lib/core/Component.ts#L4858) onward) read it through the class's own folding getters (`getMinSizeConstraint`, `getMaxSizeConstraint`, `getPreferredSizeConstraint`, `getCursor`) and reconcile it against the class-tier bag automatically — an imperative call left in place would be provably dead code with two sources of truth for the same value. This is the same "delete the redundant call" decision [`table-cell-class-style-defaults.md`](table-cell-class-style-defaults.md) makes for `Cell`'s `border`.[^cursor-inline-detail]

### `CheckboxCheckGlyph` / `RadioButtonDot` need `minSize` spelled out explicitly, not left to `Glyph`'s own convenience wiring

`Glyph.setPreferredSize` overrides `Component.setPreferredSize` to *also* pin `minSize` and `maxSize` to the same value ([component/display/Glyph.ts:292-298](packages/lib/src/typescript/lib/component/display/Glyph.ts#L292-L298)) — but only when the **setter is actually called**. `getMinSizeConstraint()` / `getMaxSizeConstraint()` / `getPreferredSizeConstraint()` each independently fold their *own* key from `_defaultOptions` ([core/Component.ts:2937](packages/lib/src/typescript/lib/core/Component.ts#L2937), [:2948](packages/lib/src/typescript/lib/core/Component.ts#L2948), [:2808](packages/lib/src/typescript/lib/core/Component.ts#L2808)) with no cross-triggering between them — that cross-triggering is a *setter*-time side effect, not a getter-time one. Because this plan deletes the imperative `setPreferredSize` call entirely (relying purely on the folding getters), `Glyph`'s convenience pinning never fires. `_default<Name>Options` must therefore list `minSize` explicitly for both Glyph delegates — omitting it would silently regress `_check` / `_dot`'s effective minimum size from 12×12 / 8×8 today to unset.[^glyph-minsize-omission-risk] `_dash` needs no equivalent `minSize` entry: it is a plain `Component` (no such cross-triggering exists), and it never had an explicit `setMinSize` call before this plan either — the table above preserves that.

### `borderRadius`, `pointerEvents`, `setSize`, `setX`/`setY`, `setTransition` are untouched — not oversights

- **`borderRadius`** (`_box`, `_ring`): `component-chrome-base-tier-hoisting`'s own Non-Goals exclude it from the class-tier mechanism entirely — its runtime setter writes an *inline* style, not a CSS rule, so there is nothing for `ensureClassStyleRule` to dedupe regardless of whether it is a registered default. Moving it would touch code for zero byte savings.
- **`pointerEvents`** (`_check`, `_dash`, `_dot`): not a member of `ClassStyleDefaults` ([core/ClassStyleRules.ts:37-52](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L37-L52)), so the automatic mechanism cannot hoist it either way. A hand-rolled module-level rule (the pattern `ResizeHandle` / `SortPriorityBadge` use for their own non-`ClassStyleDefaults` geometry) is not worth building for one three-declaration-sized property — see the Non-Goals.
- **`setSize`**: writes committed width/height as an *inline* style ([core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts), `_inlineStyle`), which is inherently per-instance geometry, never a CSS-class-rule dedup target, regardless of the literal happening to be constant here.
- **`setX`/`setY`**: same — inline position, not a hoisting target.
- **`setTransition`**: not a member of `ClassStyleDefaults`, and conditionally applied (`!Animation.isReducedMotion()`), so it is not a pure construction constant in the same sense as the properties above.

### `Toggle.ts` has the identical, unfixed problem — explicitly out of scope

[`Toggle`](packages/lib/src/typescript/lib/component/input/Toggle.ts) builds `_track` and `_thumb` ([Toggle.ts:59-92](packages/lib/src/typescript/lib/component/input/Toggle.ts#L59-L92)) with the exact same shape as `_box`/`_check` — anonymous `Component` delegates, imperative literal setters, no class identity. It was not named in this plan's brief and is not touched here; see `## Non-Goals`.

---

## Internal Structure

### `component/input/Checkbox.ts` — three new module-private classes, placed above the `Checkbox` class

```typescript
import { ComponentOptions } from "~/core/Component.js";
import { GlyphOptions } from "~/component/display/Glyph.js";

const _defaultCheckboxBoxOptions: Partial<ComponentOptions> = {
    preferredSize: { width: 16, height: 16 },
    minSize:       { width: 16, height: 16 },
    maxSize:       { width: 16, height: 16 },
    cursor:        "pointer",
};

/**
 * The box graphic behind a {@link Checkbox} — the click + cursor surface.
 * Module-private: constructed only from `Checkbox`'s own constructor. Static
 * geometry and cursor are class defaults so every instance shares one
 * `.CheckboxBox` CSS rule instead of repeating them; the checked/indeterminate
 * background and border stay per-instance, per-state writes — see
 * plans/checkbox-radio-delegate-state-style-defaults.md.
 */
class CheckboxBox extends Component {
    constructor() {
        super(undefined, _defaultCheckboxBoxOptions);
    }
}

const _defaultCheckboxCheckGlyphOptions: Partial<GlyphOptions> = {
    foregroundColor: "var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))",
    preferredSize:   { width: 12, height: 12 },
    minSize:         { width: 12, height: 12 },
    maxSize:         { width: 12, height: 12 },
};

/**
 * The check-mark glyph inside a {@link Checkbox}'s box. `minSize` is listed
 * explicitly even though `Glyph.setPreferredSize` would normally pin it too —
 * that pinning is a setter-time side effect, and this class deliberately
 * never calls the setter, relying on the folding getters instead. Opacity
 * (which of unchecked/checked/indeterminate is showing) stays a per-instance
 * runtime write in `Checkbox.applySelected` — it is not a class constant.
 */
class CheckboxCheckGlyph extends Glyph {
    constructor() {
        super("check", undefined, _defaultCheckboxCheckGlyphOptions);
    }
}

const _defaultCheckboxDashOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))",
    preferredSize:   { width: 8, height: 2 },
    maxSize:         { width: 8, height: 2 },
};

/** The indeterminate-state bar inside a {@link Checkbox}'s box. */
class CheckboxDash extends Component {
    constructor() {
        super(undefined, _defaultCheckboxDashOptions);
    }
}
```

### `component/input/Checkbox.ts` — constructor, before → after

Before ([Checkbox.ts:75-113](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L75-L113)):

```typescript
        this._box = new Component();
        this._box.setPreferredSize({ width: 16, height: 16 });
        this._box.setMinSize({ width: 16, height: 16 });
        this._box.setMaxSize({ width: 16, height: 16 });
        this._box.setSize({ width: 16, height: 16 });
        this._box.setBackgroundColor("var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
        this._box.setBorder("1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");
        this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");
        this._box.setCursor("pointer");

        this._check = new Glyph("check");
        this._check.setForegroundColor("var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))");
        this._check.setPreferredSize({ width: 12, height: 12 });
        this._check.setMaxSize({ width: 12, height: 12 });
        this._check.setX(1);
        this._check.setY(1);
        this._check.setOpacity(0);
        this._check.setPointerEvents("none");

        this._dash = new Component();
        this._dash.setBackgroundColor("var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))");
        this._dash.setPreferredSize({ width: 8, height: 2 });
        this._dash.setMaxSize({ width: 8, height: 2 });
        this._dash.setSize({ width: 8, height: 2 });
        this._dash.setX(3);
        this._dash.setY(6);
        this._dash.setOpacity(0);
        this._dash.setPointerEvents("none");
```

After — every deleted line moved into the class defaults above; every kept line unchanged:

```typescript
        this._box = new CheckboxBox();
        this._box.setSize({ width: 16, height: 16 });
        this._box.setBackgroundColor("var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
        this._box.setBorder("1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");
        this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");

        this._check = new CheckboxCheckGlyph();
        this._check.setX(1);
        this._check.setY(1);
        this._check.setOpacity(0);
        this._check.setPointerEvents("none");

        this._dash = new CheckboxDash();
        this._dash.setSize({ width: 8, height: 2 });
        this._dash.setX(3);
        this._dash.setY(6);
        this._dash.setOpacity(0);
        this._dash.setPointerEvents("none");
```

The `_box: Component`, `_check: Glyph`, `_dash: Component` field declarations ([Checkbox.ts:54-56](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L54-L56)) keep their existing base types (`Component` / `Glyph`) — the fields hold instances of the new subclasses, but nothing outside the constructor needs the narrower type, and every existing method (`applySelected`, `setAnimated`) already calls only inherited `Component`/`Glyph` methods on them.

### `component/input/RadioButton.ts` — mirrors `Checkbox.ts` exactly

```typescript
import { ComponentOptions } from "~/core/Component.js";
import { GlyphOptions } from "~/component/display/Glyph.js";

const _defaultRadioButtonRingOptions: Partial<ComponentOptions> = {
    preferredSize: { width: 16, height: 16 },
    minSize:       { width: 16, height: 16 },
    maxSize:       { width: 16, height: 16 },
    cursor:        "pointer",
};

/** The ring graphic behind a {@link RadioButton}. See `CheckboxBox`'s doc comment for the shape this mirrors. */
class RadioButtonRing extends Component {
    constructor() {
        super(undefined, _defaultRadioButtonRingOptions);
    }
}

const _defaultRadioButtonDotOptions: Partial<GlyphOptions> = {
    foregroundColor: "var(--ts-ui-radio-dot-color, rgb(255, 255, 255))",
    preferredSize:   { width: 8, height: 8 },
    minSize:         { width: 8, height: 8 },
    maxSize:         { width: 8, height: 8 },
};

/** The filled dot inside a {@link RadioButton}'s ring. See `CheckboxCheckGlyph`'s doc comment for why `minSize` is explicit. */
class RadioButtonDot extends Glyph {
    constructor() {
        super("circle", undefined, _defaultRadioButtonDotOptions);
    }
}
```

Constructor, before → after ([RadioButton.ts:77-102](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L77-L102)):

```typescript
// Before:
        this._ring = new Component();
        this._ring.setPreferredSize({ width: 16, height: 16 });
        this._ring.setMinSize({ width: 16, height: 16 });
        this._ring.setMaxSize({ width: 16, height: 16 });
        this._ring.setSize({ width: 16, height: 16 });
        this._ring.setBackgroundColor("var(--ts-ui-radio-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
        this._ring.setBorder("1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");
        this._ring.setBorderRadius("50%");
        this._ring.setCursor("pointer");

        this._dot = new Glyph("circle");
        this._dot.setForegroundColor("var(--ts-ui-radio-dot-color, rgb(255, 255, 255))");
        this._dot.setPreferredSize({ width: 8, height: 8 });
        this._dot.setMaxSize({ width: 8, height: 8 });
        this._dot.setX(3);
        this._dot.setY(3);
        this._dot.setOpacity(0);
        this._dot.setPointerEvents("none");
```

```typescript
// After:
        this._ring = new RadioButtonRing();
        this._ring.setSize({ width: 16, height: 16 });
        this._ring.setBackgroundColor("var(--ts-ui-radio-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
        this._ring.setBorder("1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");
        this._ring.setBorderRadius("50%");

        this._dot = new RadioButtonDot();
        this._dot.setX(3);
        this._dot.setY(3);
        this._dot.setOpacity(0);
        this._dot.setPointerEvents("none");
```

The `_ring: Component`, `_dot: Glyph` field declarations ([RadioButton.ts:54-55](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L54-L55)) keep their existing base types, for the same reason as `Checkbox`.

---

## Ordered Implementation Steps

1. **`Checkbox.ts` — add the three module-private classes.** Insert `CheckboxBox`, `CheckboxCheckGlyph`, `CheckboxDash` and their `_default*Options` constants above the `Checkbox` class, exactly as given in `## Internal Structure`. Add the two new type-only imports (`ComponentOptions` from `~/core/Component.js`, `GlyphOptions` from `~/component/display/Glyph.js`); `Component` and `Glyph` are already imported as values.
   *Check:* `npm run typecheck` passes.

2. **`Checkbox.ts` — rewrite the constructor.** Replace `new Component()` / `new Glyph("check")` / the second `new Component()` with `new CheckboxBox()` / `new CheckboxCheckGlyph()` / `new CheckboxDash()`, and delete exactly the lines the `## Internal Structure` before/after block marks as removed (`setPreferredSize`, `setMinSize`, `setMaxSize`, `setCursor` on `_box`; `setForegroundColor`, `setPreferredSize`, `setMaxSize` on `_check`; `setBackgroundColor`, `setPreferredSize`, `setMaxSize` on `_dash`). Leave every other line (including `setSize`, `setBorder`, `setBorderRadius`, `setX`/`setY`, `setOpacity`, `setPointerEvents`, `setTransition`) untouched.
   *Check:* `npm run typecheck` passes. `grep -n 'this._box.setPreferredSize\|this._box.setMinSize\|this._box.setMaxSize\|this._box.setCursor\|this._check.setForegroundColor\|this._check.setPreferredSize\|this._check.setMaxSize\|this._dash.setBackgroundColor\|this._dash.setPreferredSize\|this._dash.setMaxSize' packages/lib/src/typescript/lib/component/input/Checkbox.ts` — zero matches.

3. **`RadioButton.ts` — add the two module-private classes.** Insert `RadioButtonRing`, `RadioButtonDot` and their `_default*Options` constants above the `RadioButton` class, mirroring step 1. Add the same two type-only imports.
   *Check:* `npm run typecheck` passes.

4. **`RadioButton.ts` — rewrite the constructor.** Same mechanical transformation as step 2, for `_ring` / `_dot`.
   *Check:* `npm run typecheck` passes. `grep -n 'this._ring.setPreferredSize\|this._ring.setMinSize\|this._ring.setMaxSize\|this._ring.setCursor\|this._dot.setForegroundColor\|this._dot.setPreferredSize\|this._dot.setMaxSize' packages/lib/src/typescript/lib/component/input/RadioButton.ts` — zero matches.

5. **`Checkbox.test.ts` / `RadioButton.test.ts` — add the no-duplication and class-rule-existence tests.** Add the tests from `## Expected Behaviour` rows 1-4 (Checkbox: `_box`, `_check`, `_dash`, then the class-rule-existence check) and 7-9 (RadioButton: `_ring`, `_dot`, then the class-rule-existence check) as new `describe` blocks. Rows 1-3 and 7-8 (an instance's own `#id` rule carries none of the hoisted declarations) copy `declarationsDuring` / `idSelector` from [`ClassChromeRules.test.ts`](packages/lib/tests/core/ClassChromeRules.test.ts); reach the private delegate fields the same way the `default-options-fallback.test.ts` registry rows do, via `(checkbox as any)._box` / `._check` / `._dash` and `(radioButton as any)._ring` / `._dot`. Rows 4 and 9 (the shared class rules exist) use `_ruleCacheHas` from `~/core/StyleTarget`, exactly as `ToggleButton.selectedClassHoisting.test.ts` does — **not** `declarationsDuring` against a `.ClassName` selector, which would only capture a real write from whichever test in the file happens to render the *first* `Checkbox`/`RadioButton` (`ensureClassStyleRule`'s cache is module-lifetime, the same order-dependency `table-cell-class-style-defaults.md`'s row 3 documents and marks manual instead of unit-tested). Both files currently import only `installTestDOM`; add `DOM`, `RecordingDOMSink` from `../../dom/TestDOM` and `_ruleCacheHas` from `~/core/StyleTarget` alongside it.
   *Check:* `npx vitest run tests/component/input/Checkbox.test.ts tests/component/input/RadioButton.test.ts` — new tests pass; every pre-existing test in both files still passes unmodified.

6. **`default-options-fallback.test.ts` — add the registry rows.** Add rows 5-6 (Checkbox) and 10-11 (RadioButton) from `## Expected Behaviour`, next to the existing `'Checkbox outline'` / `'RadioButton outline'` rows, reaching into the private delegate field via `as any` — the same technique the existing `'MarkdownEditor surface userSelect'` / `'MarkdownEditor surface cursor'` rows already use for `(new MarkdownEditor() as any)._wysiwyg`.
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — new rows pass.

7. **`next.md` — add the changelog bullet.** See `## Documentation Impact`.
   *Check:* `npm run docs:api` finishes with zero warnings.

8. **Full verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/tests/component/input/Checkbox.test.ts` |
| Modify | `packages/lib/tests/component/input/RadioButton.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-4 and 7-9 (per-instance emptiness and class-rule existence) are unit-testable against the recording DOM sink, as new `describe` blocks in the per-component test files. Rows 5-6 and 10-11 (`getCursor`/`getMinSizeConstraint`) are unit-testable `default-options-fallback.test.ts` registry rows. Row 12 is manual (Style Audit panel) and is also where the shared class rules' exact *content* — as opposed to mere existence, which rows 4/9 already cover — gets confirmed.

| # | Case | Expected | Testable |
|---|---|---|---|
| 1 | A rendered `Checkbox`'s `_box` element | Its own `#id` rule carries no `minWidth`/`minHeight`/`maxWidth`/`maxHeight`/`cursor` declaration | Unit |
| 2 | The same `Checkbox`'s `_check` element | Its own `#id` rule carries no `minWidth`/`minHeight`/`maxWidth`/`maxHeight`/`color` declaration | Unit |
| 3 | The same `Checkbox`'s `_dash` element | Its own `#id` rule carries no `minWidth`/`maxWidth`/`maxHeight`/`backgroundColor` declaration (no `minHeight` — `_dash` never had a registered `minSize`, matching today) | Unit |
| 4 | Two `Checkbox`es rendered in the same test | `_ruleCacheHas('.CheckboxBox')`, `_ruleCacheHas('.CheckboxCheckGlyph')`, `_ruleCacheHas('.CheckboxDash')` are all `true` after the first renders (confirms each shared rule was created; content is confirmed manually in the final row — see step 5's note on why `declarationsDuring` against a `.ClassName` selector is order-dependent across the file and therefore not used here) | Unit |
| 5 | A fresh `(new Checkbox() as any)._box.getCursor()` | `"pointer"` | Unit — registry row |
| 6 | A fresh `(new Checkbox() as any)._check.getMinSizeConstraint()` | `{ width: 12, height: 12 }` (proves the explicit `minSize` entry survives without `Glyph`'s setter-time pinning) | Unit — registry row |
| 7 | A rendered `RadioButton`'s `_ring` element | Its own `#id` rule carries no `minWidth`/`minHeight`/`maxWidth`/`maxHeight`/`cursor` declaration | Unit |
| 8 | The same `RadioButton`'s `_dot` element | Its own `#id` rule carries no `minWidth`/`minHeight`/`maxWidth`/`maxHeight`/`color` declaration | Unit |
| 9 | Two `RadioButton`s rendered in the same test | `_ruleCacheHas('.RadioButtonRing')`, `_ruleCacheHas('.RadioButtonDot')` are both `true` after the first renders | Unit |
| 10 | A fresh `(new RadioButton() as any)._dot.getMinSizeConstraint()` | `{ width: 8, height: 8 }` | Unit — registry row |
| 11 | A fresh `(new RadioButton() as any)._ring.getCursor()` | `"pointer"` | Unit — registry row |
| 12 | Style Audit panel, on a tab with several `Checkbox` / `RadioButton` instances, before/after | The size + cursor portion of the `_box`/`_ring`/`_check`/`_dot`/`_dash` duplicate-body rows is gone; `_check` and `_dash`'s rows disappear entirely (every one of their properties is now static and hoisted); the `.CheckboxBox`/`.RadioButtonRing`/etc. class rules carry the expected `min-width`/`min-height`/`max-width`/`max-height`/`cursor`/colour values (the content checks rows 4/9 defer to here); no visible appearance change anywhere | Manual |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants (all expect zero matches):

```
grep -n 'this._box.setPreferredSize\|this._box.setMinSize\|this._box.setMaxSize\|this._box.setCursor' packages/lib/src/typescript/lib/component/input/Checkbox.ts
grep -n 'this._check.setForegroundColor\|this._check.setPreferredSize\|this._check.setMaxSize' packages/lib/src/typescript/lib/component/input/Checkbox.ts
grep -n 'this._dash.setBackgroundColor\|this._dash.setPreferredSize\|this._dash.setMaxSize' packages/lib/src/typescript/lib/component/input/Checkbox.ts
grep -n 'this._ring.setPreferredSize\|this._ring.setMinSize\|this._ring.setMaxSize\|this._ring.setCursor' packages/lib/src/typescript/lib/component/input/RadioButton.ts
grep -n 'this._dot.setForegroundColor\|this._dot.setPreferredSize\|this._dot.setMaxSize' packages/lib/src/typescript/lib/component/input/RadioButton.ts
```

**Manual verification (the final row) is required.** The offline harness records writes; it cannot show what the Style Audit panel reports about total stylesheet duplication. Start a dev server on a spare port from *this worktree* (not the user's existing one), open `#/style-audit`, switch to a tab with several checkboxes/radio buttons, and confirm the size/cursor portion of the reported duplication is gone with no visual change anywhere (`#/inputs`, any form or table using `Checkbox`/`RadioButton`).

---

## Documentation Impact

No exported symbol changes — all five new classes are module-private, never exported, and `_default<Name>Options` constants are module-private too. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`:

> **`Checkbox` and `RadioButton`'s internal box/ring/check/dot/dash graphics no longer duplicate their fixed size and cursor on every instance's own CSS rule.** Each now shares one CSS rule per graphic across every `Checkbox`/`RadioButton` in the app. Nothing changes visually; no consumer action needed.

---

## Potential Challenges

- **Class-name collision with an unrelated class elsewhere in the app.** `ensureClassStyleRule`'s name-collision opt-out silently disables dedup for a class whose name another constructor already claimed — confirmed via `grep -rn "class CheckboxBox\|class CheckboxCheckGlyph\|class CheckboxDash\|class RadioButtonRing\|class RadioButtonDot" packages/lib/src` that none of these five names exists anywhere else in the tree today.
- **A future subclass of `Checkbox`/`RadioButton` overriding `_box`/`_ring` construction.** No such subclass exists in the tree today (confirmed: neither `Checkbox` nor `RadioButton` is extended anywhere in `packages/lib/src`); the delegate classes are constructed unconditionally in the base constructor, so this is not a live concern.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts` | The file being changed: delegate construction (75-123), `applySelected` (372-395) — untouched by this plan, confirms scope boundary |
| `packages/lib/src/typescript/lib/component/input/RadioButton.ts` | The file being changed: delegate construction (77-110), `applySelected` (338-349) — same scope boundary |
| `packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts` | The precedent this plan mirrors: `PickerDayHeader`/`PickerBlankCell`/`PickerNavButton`/`PickerMonthLabel`/`PickerDay` (135-330) — small, module-private, single-call-site delegate `Component`/`Text` subclasses |
| `packages/lib/src/typescript/lib/component/display/Glyph.ts` | `_defaultGlyphOptions` (171), constructor's `subclassDefaults` forwarding (249-262), `setPreferredSize`'s min/max pinning (292-298) — why the Glyph delegates need `minSize` spelled out explicitly |
| `packages/lib/src/typescript/lib/core/Component.ts` | `getMinSizeConstraint`/`getMaxSizeConstraint`/`getPreferredSizeConstraint` (2808, 2937, 2948) — the folding getters this plan relies on; `getCursor` (2425); `applySizeConstraintStyles`/`applyBoxAndVisibilityStyles` (4858-4960) — the render-time reconcile that dedupes automatically once a default is registered |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ClassStyleDefaults` (37), `ensureClassStyleRule` (222) — confirms `minSize`/`maxSize`/`cursor`/`foregroundColor`/`backgroundColor` are all members of the automatically-hoisted set this plan relies on with zero new mechanism |
| `plans/table-cell-class-style-defaults.md` | The direct precedent: same "unregistered class default" problem, same fix shape, for `Cell` |
| `plans/implemented/component-chrome-base-tier-hoisting.md` | The already-merged mechanism this plan supplies data to; explains why `borderRadius` is excluded (Non-Goals) |
| `packages/lib/tests/core/ClassChromeRules.test.ts` | Test conventions (`declarationsDuring`, `idSelector`, unique-per-file probe naming) this plan's new test cases copy |
| `packages/lib/tests/component/default-options-fallback.test.ts` | The registry this plan adds rows to; its existing `'MarkdownEditor surface userSelect'` row is the precedent for reaching into a private delegate field via `as any` |

---

## Non-Goals

- **`Toggle.ts`'s `_track`/`_thumb`.** Identical, unfixed instance of this exact problem — not named in this plan's brief. A follow-up plan can apply the same recipe (`ToggleTrack`, `ToggleThumb`) with no new design work.
- **`_box`/`_ring`'s `backgroundColor`/`border`.** State-dependent, rewritten on every transition — see [`checkbox-radio-delegate-state-style-defaults.md`](checkbox-radio-delegate-state-style-defaults.md).
- **`borderRadius`.** Writes an inline style, not a CSS rule; not part of the class-tier hoisting mechanism (see `component-chrome-base-tier-hoisting`'s own Non-Goals). No byte savings available.
- **A hand-rolled module-level `StyleRule({scope:"class"})` for `pointerEvents`** (the `ResizeHandle`/`SortPriorityBadge` pattern for properties outside `ClassStyleDefaults`). Not worth building for one three-declaration-sized property with no other non-`ClassStyleDefaults` static value alongside it on these delegates.
- **Changes to `core/ClassStyleRules.ts` or `core/Component.ts`.** The hoisting mechanism already shipped; this plan only supplies data to it.
- **Any change to rendered appearance.** Every value written is identical before and after; only which CSS rule carries it changes.

---

## Notes

[^why-split]: A single combined plan would force the state-tier half's real dependency (`state-chrome-isolation-generalization`, drafted but not yet implemented) onto this half's work too, even though this half needs nothing beyond what is already merged. `table-cell-class-style-defaults.md` demonstrates that the static half is a complete, valuable, low-risk unit of work on its own — the same reasoning applies here, more so, since half of this plan's five delegates (`_check`, `_dash`, `_dot`) have *no* state-tier component at all.

[^option-b-rejected]: The alternative investigated was `ResizeHandle.ts` / `SortPriorityBadge.ts`'s hand-rolled `new StyleRule({ scope: "class", name: "Foo" })` inside a module-singleton `ensureFooClassRule()`, cited by ARCHITECTURE.md's *Defer DOM work to render time* section as the correct path for a module-level shared class rule. Live investigation found this pattern only partially wired even in its own two reference implementations: `ResizeHandle`'s hand-rolled `.ResizeHandle` rule declares `cursor` nowhere, so its own `this.setCursor(RESIZE_HANDLE_CURSOR)` constructor call ([ResizeHandle.ts:102](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L102)) writes a full, undeduped `cursor` CSS-rule declaration to `#id` on every instance — `cursor` *is* a member of `ClassStyleDefaults` and could have been hoisted automatically via the `_defaultOptions` route (which `ResizeHandle` never uses at all — it has no `_default*Options` bag), the exact gap this plan closes for `Checkbox`/`RadioButton`. `ResizeHandle` also writes `z-index: 1` in both its hand-rolled class rule *and* its own constructor's `setZIndex(1)` call — genuinely redundant, though `zIndex` writes inline so it costs an inline attribute, not a stylesheet rule. `SortPriorityBadge` avoids both gaps only by combining the hand-rolled rule (for `position`/`top`/`right`/`fontSize`/`lineHeight`/`borderRadius`/`padding`/`pointerEvents` — properties outside `ClassStyleDefaults`) *with* a `_default*Options` bag (for `backgroundColor`/`foregroundColor` — properties inside it), passed through the ordinary `subclassDefaults` route ([SortPriorityBadge.ts:50-53](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L50-L53)). This plan's five delegates need only properties already inside `ClassStyleDefaults` (size, cursor, colour) — so the "hand-rolled rule" half of that combined pattern buys nothing here, and skipping it avoids the exact class of gap `ResizeHandle` demonstrates live.

[^options-vs-subclassdefaults]: A second precedent in the same neighbourhood, `PickerDayHeader`/`PickerNavButton`/`PickerBlankCell`, passes its literals as the constructor's *first* argument (`options`), not `subclassDefaults` — e.g. `super(text, { textAlign: "center", fontSize: 12, preferredSize: {...} })`. That means those literals land in `_options`, not `_defaultOptions`, so they are *not* hoisted by `ensureClassStyleRule` at all — each `PickerDayHeader`/`PickerNavButton` instance likely still duplicates its own size/font declarations on `#id` today. That is a separate, pre-existing gap in a different file, out of scope for this plan (not named in the brief) — it is noted here only because it shows *why* the `options` vs `subclassDefaults` distinction must be made deliberately and is easy to get backwards by copying the wrong half of a nearby-looking precedent.

[^cursor-inline-detail]: `Component.setCursor`'s own runtime write path is `this.setElementStyle("cursor", cursor)` — an *inline* style ([core/Component.ts:2441](packages/lib/src/typescript/lib/core/Component.ts#L2441)), separate from the render-time `applyBoxAndVisibilityStyles`'s CSS-*rule* write of the same property (`this.writeRuleDeclaration("cursor", cursor)`, reached through the folding `getCursor()` getter). Keeping the imperative `setCursor` call would not reintroduce a byte-duplication bug — the render-time rule write would still dedupe correctly, since `getCursor()` folds to the same value either way — but it would leave a redundant, provably-dead inline attribute alongside a now-authoritative class default, which is the same "keep vs delete" judgment `table-cell-class-style-defaults.md` already made for `Cell`'s `border`. Deleted for consistency with that precedent.

[^glyph-minsize-omission-risk]: Concretely: if `_defaultCheckboxCheckGlyphOptions` omitted `minSize`, `(new Checkbox() as any)._check.getMinSizeConstraint()` would return `null` post-plan instead of `{ width: 12, height: 12 }` today — a real, silent regression to the glyph's effective minimum size, not merely a missed optimisation. Row 6 of `## Expected Behaviour` exists specifically to catch this.

---

## Implementation Notes

**`preferredSize`/`minSize`/`maxSize` stay imperative on `CheckboxCheckGlyph` and `RadioButtonDot` — only `foregroundColor` moved into their `_default<Name>Options` bag.** The plan's Architecture Decision on this point (*`CheckboxCheckGlyph` / `RadioButtonDot` need `minSize` spelled out explicitly*) cited only `Glyph.setPreferredSize`'s own override ([component/display/Glyph.ts:292-298](packages/lib/src/typescript/lib/component/display/Glyph.ts#L292-L298)) as the setter-time pinning to route around, and concluded that listing `minSize` in the defaults bag was sufficient once the imperative `setPreferredSize` call was deleted. Test-first implementation (row 2's assertion that `_check`'s own `#id` rule carries no `minWidth`/`minHeight`/`maxWidth`/`maxHeight`) surfaced a second, independent mechanism the plan did not account for: `Glyph.applyOptions` ([component/display/Glyph.ts:645-659](packages/lib/src/typescript/lib/component/display/Glyph.ts#L645-L659)) unconditionally re-pins `minSize`/`maxSize` to `getPreferredSizeConstraint()`'s *resolved* value — folded default included — via a direct `setMinSize`/`setMaxSize` call, on every construction, whenever that resolved value is non-null. A setter call always writes straight to the instance's own `#id` rule (`Component.writeRuleDeclaration`'s documented behaviour: only a write issued from `applyStyle` itself consults the class-tier comparison; a runtime setter's `setElementCSSRule`/`setElementCSSRules` call never does). So giving `CheckboxCheckGlyph`/`RadioButtonDot` a defaulted `preferredSize` does not skip the per-instance write the plan intends to eliminate — `Glyph.applyOptions` re-issues it unconditionally regardless of whether the value came from an explicit option or a class default — and additionally produces a same-valued, permanently-outranked `minWidth`/`minHeight`/`maxWidth`/`maxHeight` on the new `.CheckboxCheckGlyph`/`.RadioButtonDot` class rule, which is strictly more bytes than today, not fewer.

There is no way to route around this without either (a) leaving `getPreferredSizeConstraint()` null for these two delegates — which would silently regress `_check`/`_dot`'s effective minimum size to unset, the exact regression the plan's own `[^glyph-minsize-omission-risk]` footnote warns against avoiding — or (b) changing `Glyph.applyOptions`'s re-pin logic itself, which is out of this plan's scope (`## Non-Goals` excludes changes to the hoisting mechanism's plumbing, and `Glyph.ts` has no other `_default*Options`-driven subclass in the tree to de-risk such a change against). Given neither is acceptable, `CheckboxCheckGlyph`/`RadioButtonDot` keep `this.setPreferredSize(...)` / `this.setMaxSize(...)` as imperative constructor calls, unchanged from before this plan, and their `_default<Name>Options` bag carries only `foregroundColor` — the one property on these two delegates that does dedupe correctly (confirmed via the row 2 / row 8 tests, and via `default-options-fallback.test.ts`'s new `_check`/`_dot` `getMinSizeConstraint()` rows, which still assert the unregressed `{12,12}`/`{8,8}` value, now reached through the setter path rather than a pure fallback). `CheckboxBox`, `CheckboxDash`, and `RadioButtonRing` are plain `Component` subclasses, unaffected by this `Glyph`-specific mechanism, and hoist `preferredSize`/`minSize`/`maxSize`/`cursor` exactly as the plan specifies. The `## Documentation Impact` changelog entry and the `## Expected Behaviour`-derived tests were adjusted to match: row 2 and row 8 assert only the `color` declaration is absent from `_check`/`_dot`'s own `#id` rule, not the size ones.

A follow-up plan wanting to close this remaining gap would need to change `Glyph.applyOptions`'s re-pin to distinguish "value came from an explicit option" from "value came from a class default" — e.g. skip the re-pin when `getPreferredSizeConstraint()`'s value traces to `_defaultOptions` rather than `_options` — which is a `Glyph`-wide behavioural change affecting every `Glyph` instance in the tree, not something scoped to these two delegates.
