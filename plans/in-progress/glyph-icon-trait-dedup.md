---
depends-on: []
touches-shared:
  - packages/lib/src/typescript/lib/core/StyleTraits.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Glyph Icon Trait Dedup — Implementation Plan

## Overview

[`plans/implemented/glyph-icon-size-scale.md`](implemented/glyph-icon-size-scale.md) gave the framework five named icon-size steps (`glyphXs`/`glyphSm`/`glyphMd`/`glyphLg`/`glyphXl`) on `Theme.scale`, so sites that used to hardcode an icon's pixel size, or agree on one only by coincidence, now read the same named step when they mean the same design intent. [`plans/implemented/cross-class-style-groups.md`](implemented/cross-class-style-groups.md) then shipped a `StyleTrait` mechanism — a declared style bag any number of unrelated component classes, or a single instance, can opt into, sharing one generated CSS rule. That plan's own `## Non-Goals` named this exact follow-up: "once several sites compute from one named step, they become good candidates for the trait mechanism... deferred deliberately, not forgotten."

This plan applies that trait mechanism to the two glyph-icon clusters where two or more component classes, with no useful common ancestor, now compute their icon size from the identical `ThemeManager.getResolvedScale()` accessor:

- **`glyphXs`** — [`SpinButton.ts:120-121`](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L120) and [`TabButton.ts:342-343`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L342) each pin their chevron glyph to `glyphXs`, then opt that glyph into its own `styleGroup` token (`"spin-glyph"`, `"tab-close-glyph"`) so at least same-owner instances share a rule. The two tokens still produce two separate CSS rules for the same declared size.
- **`glyphMd`** — [`WindowHeader.ts:56-80`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L56) and [`ComboBox.ts:539-564`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L539) each construct a dedicated `Glyph` subclass (`WindowHeaderTitleGlyph`, `ComboBoxCaretGlyph`) whose own class-tier default is `glyphMd`. Two classes, two CSS rules, byte-identical content.

Both clusters move onto a new trait constant in [`core/StyleTraits.ts`](packages/lib/src/typescript/lib/core/StyleTraits.ts), which today holds one constant (`INPUT_CHROME_TRAIT`) from the border-migration plan. The other three icon-size steps — `glyphSm`, `glyphLg`, `glyphXl` — are investigated below and excluded: none currently has two unrelated classes duplicating the same declared CSS (see `## Non-Goals`).

---

## Architecture Decisions

### Only `glyphXs` and `glyphMd` qualify; `glyphSm`/`glyphLg`/`glyphXl` do not

`glyphSm` (`AbstractCalendarDropdown.ts:53`) and `glyphXl` (`Notification.ts:30`) each have exactly one non-framework consumer today — a single class can't duplicate CSS across classes, so there is nothing for a trait to dedupe.

`glyphLg` has six consumers (`MenuItem`, `Dialog`, `SplitButton`, `table/cell/Header`, `list/renderer/Glyph`, `tree/renderer/IconLabel`), but each constructs a **bare** `new Glyph(name)` and then calls `glyph.setPreferredSize({width, height})` with the `glyphLg` value. `Glyph`'s own constructor already defaults every unsized instance's `preferredSize`/`minSize`/`maxSize` to `glyphLg` (`glyphDefaultSize()`, [`Glyph.ts:180`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L180)), so this explicit call writes an authored instance value that **matches** the base `.Glyph` class rule exactly — `flushStyleBag`'s per-key diff finds no deviation and writes nothing, and all six sites already share the one `.Glyph` class rule for free. There is no duplication to fix; introducing a trait here would just rename an already-solved problem.[^glyphlg-verified]

### `glyphXs`: instance-level opt-in, not class-level

`SpinButton`'s and `TabButton`'s chevrons are both `ButtonIconGlyph` instances — the one glyph class every `Button`-family leading icon goes through (`Button.setGlyph`, per [`glyph-icon-size-dedup.md`](implemented/glyph-icon-size-dedup.md)). Declaring `ownStyleTraits` on `ButtonIconGlyph` itself would hand the trait to every other `ButtonIconGlyph` in the app too — a plain `Button`'s leading icon, `PickerButton`, `MenuButton`, `WindowControlButton`, none of which are `glyphXs`-sized. Only these two specific instances share this design intent, so this cluster uses the trait's **instance-level** surface: `this.getGlyph()?.setStyleTrait(GLYPH_XS_INK_TRAIT)` replaces `this.getGlyph()?.setStyleGroup("spin-glyph")` (and the `TabButton` equivalent), with no change to `ButtonIconGlyph` or to `Button.setGlyph`.

`TabBar.ts:2536-2547`'s `positionCloseButtons` re-applies `pinGlyphSize` to the *same* close-button instance `TabButton.buildCloseButton` already trait-tagged, every layout pass — exactly the same "no change needed" relationship `glyph-icon-size-dedup.md` already established for `styleGroup`. It is unaffected by this plan.

### `glyphMd`: class-level opt-in on the two dedicated subclasses

`WindowHeaderTitleGlyph` and `ComboBoxCaretGlyph` are each a leaf with no subclasses of their own, and their **entire** own default bag is `minSize`/`maxSize`. Declaring `protected static readonly ownStyleTraits: readonly StyleTrait[] = [GLYPH_MD_INK_TRAIT]` on each, and deleting `minSize`/`maxSize` from their own default bags, is a direct mirror of the border-migration precedent (`TextInput`/`AbstractPickerField`/`ComboBox`/`FieldSet` each opting into `INPUT_CHROME_TRAIT`).

### No `applyChromeOptions`-style dispatch fold is needed

The border migration needed a third fallback in `applyChromeOptions` because `getBorderSize()` — the method layout actually calls — reads a **separate** parsed cache (`_border`) populated only when `setBorder()` is dispatched, bypassing `resolveStyleValue` entirely; deleting a class's `border` default without that fold left `getBorderSize()` reading zero. `minSize`/`maxSize` have no such bypass: `getMinSizeConstraint()` / `getMaxSizeConstraint()` — the methods `getMinSize()`/`getMaxSize()`/`clampWidth`/`clampHeight` (the actual JS-side layout consumers) go through — call `this.resolveStyleValue("minSize"/"maxSize")` directly ([`Component.ts:3267-3280`](packages/lib/src/typescript/lib/core/Component.ts#L3267)), the same layered-style-bag path a trait layer joins. Once `GLYPH_XS_INK_TRAIT`/`GLYPH_MD_INK_TRAIT` are in `styleLayers()`/`layersBelowInstance()` (already true for every trait, shipped by `cross-class-style-groups.md`), both getters resolve through the trait automatically. No fold, no new code in `Component.ts`.[^minsize-is-paint-and-layout]

### A trait's declared value is a frozen number, not a live CSS variable — accepted, and already the status quo

`INPUT_CHROME_TRAIT.declarations.border` is a CSS custom-property reference (`var(--ts-ui-input-border)`), so it tracks a theme change through the browser's own cascade with no JS involved. A glyph size is a JS-resolved pixel number (`ThemeManager.getResolvedScale().glyphXs`), and `StyleTrait.declarations` must be "a plain object literal, fixed at the point it is written in source" — it cannot call `ThemeManager` at all. `GLYPH_XS_INK_TRAIT`/`GLYPH_MD_INK_TRAIT` therefore bake in the shipped default theme's numbers (8, 14) as literals.

This is not a new limitation. The class defaults these traits replace were **already** frozen the same way: `WindowHeaderTitleGlyph`'s `_default...Options` bag is computed once, from whatever theme is live, by whichever instance of that class constructs *first* in the process — and `ensureClassStyleRule`'s cache-and-insert-once pattern means that first instance's snapshot is what `.WindowHeaderTitleGlyph`'s CSS rule keeps for the rest of the process regardless of any later `setTheme` call. A trait has the identical "frozen at first use" lifetime, just keyed by trait name instead of by class. The one narrow case that changes: a custom theme with a different `scale.base`, active **before the very first instance of either migrated consumer is ever constructed**, would previously seed the class default with the correct custom number; after this plan, the trait is always seeded with the shipped default (8/14). This does not produce incorrect rendering — `WindowHeader.setGlyph`/`resolveTitleGlyphInk()` and `ComboBoxCaret`'s own constructor still read the *live* theme on every construction and dispatch it through `Glyph.setPreferredSize()`, which writes `minSize`/`maxSize` as a genuine authored instance value; if that value differs from the trait's frozen 8/14, `flushStyleBag`'s existing per-key diff still writes a correct real per-instance deviation. Only the dedup — not the correctness — degrades in that one narrow, already-documented scenario (`glyph-icon-size-scale.md`'s own `## Potential Challenges`: "re-pinning existing instances on a theme change" is out of scope for that plan and unaffected here).[^self-correcting-precedent]

### No state-tier conflict

`ensureTraitLayer` throws only when a class's own unguarded top-priority `ownStyleStates` entry shares a CSS property with a trait it uses. Neither `Glyph`, `ButtonIconGlyph`, `WindowHeaderTitleGlyph`, nor `ComboBoxCaretGlyph` declares its own `ownStyleStates`, so all four inherit `Component`'s own single entry, `.invisible` ([`Component.ts:426-431`](packages/lib/src/typescript/lib/core/Component.ts#L426)), whose `extract` returns only `{ visible: false }`. `{visible}` shares no key with either trait's `{minSize, maxSize}`, so `traitTopStateConflictKeys` returns empty for every consumer this plan touches — verified directly against the current declaration, not assumed.

### `WindowHeaderTitleGlyph`'s and `ComboBoxCaretGlyph`'s own CSS class rule disappears

Once `minSize`/`maxSize` are their **only** own declarations and both move to the trait, each class's own default bag becomes empty. `ensureClassStyleRule`'s no-hierarchy-participation branch (neither class, nor `Glyph`, declares `ownClassStyleDefaults`) explicitly skips inserting a rule for an empty deviation set: *"An empty body would insert a rule that declares nothing, so skip it"* ([`ClassStyleRules.ts:935-937`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L935)). So after this plan, `_ruleCacheHas('.WindowHeaderTitleGlyph')` and `_ruleCacheHas('.ComboBoxCaretGlyph')` both become `false` — a real, testable change from today, where both are `true`. This is the one place this migration's behaviour genuinely differs in shape (not just mechanism) from the border migration, where every migrated class kept *other* own declarations and so kept its own (smaller) class rule.

---

## Public API

`core/StyleTraits.ts` gains two more exported constants, same shape as the existing one:

```typescript
export const GLYPH_XS_INK_TRAIT: StyleTrait;
export const GLYPH_MD_INK_TRAIT: StyleTrait;
```

| Trait `name` | DOM class token | CSS selector | Declares |
|---|---|---|---|
| `glyph-xs-ink` | `ts-ui-trait-glyph-xs-ink` | `.ts-ui-component.ts-ui-trait-glyph-xs-ink` | `minSize`/`maxSize`: `{width:8,height:8}` |
| `glyph-md-ink` | `ts-ui-trait-glyph-md-ink` | `.ts-ui-component.ts-ui-trait-glyph-md-ink` | `minSize`/`maxSize`: `{width:14,height:14}` |

Neither is re-exported from `core/index.ts` (`INPUT_CHROME_TRAIT` isn't either — confirmed by grep). No public constructor, options bag, or getter/setter signature changes on any consumer.

---

## Internal Structure

### `core/StyleTraits.ts` — append after `INPUT_CHROME_TRAIT`

```typescript
/**
 * The min/max square-size pair shared by every icon pinned to the theme's
 * compact-control `glyphXs` icon step — a `SpinButton`'s chevron and a
 * `TabButton`'s close-button (✕) chevron. Both are `ButtonIconGlyph`
 * instances (the same class `Button.setGlyph` constructs for every
 * Button-family leading icon), so a class-level opt-in on `ButtonIconGlyph`
 * would also hand this size to every other leading icon in the app — a
 * plain `Button`, `PickerButton`, `MenuButton`, none of which are
 * `glyphXs`-sized. Only these two specific instances opt in, via
 * `setStyleTrait`, replacing the two separate `styleGroup` tokens
 * (`"spin-glyph"`, `"tab-close-glyph"`) plans/implemented/glyph-icon-size-
 * dedup.md gave them back when their shared 8px size was still a
 * coincidence of two unrelated formulas. See plans/glyph-icon-trait-dedup.md.
 */
export const GLYPH_XS_INK_TRAIT: StyleTrait = {
    name: "glyph-xs-ink",
    declarations: {
        minSize: { width: 8, height: 8 },
        maxSize: { width: 8, height: 8 },
    },
};

/**
 * The min/max square-size pair shared by every icon matched to the theme's
 * text-matched `glyphMd` icon step — `WindowHeaderTitleGlyph`'s title icon
 * and `ComboBoxCaretGlyph`'s chevron. The two have no useful common
 * ancestor beyond `Glyph` itself, which every other differently-sized
 * glyph in the framework also extends. See plans/glyph-icon-trait-dedup.md.
 */
export const GLYPH_MD_INK_TRAIT: StyleTrait = {
    name: "glyph-md-ink",
    declarations: {
        minSize: { width: 14, height: 14 },
        maxSize: { width: 14, height: 14 },
    },
};
```

### `component/input/SpinButton.ts` — lines 120-121

```typescript
this.pinGlyphSize(ThemeManager.getResolvedScale().glyphXs);
this.getGlyph()?.setStyleTrait(GLYPH_XS_INK_TRAIT);
```

Add `import { GLYPH_XS_INK_TRAIT } from "~/core/StyleTraits.js";`.

### `component/button/TabButton.ts` — lines 342-343, inside `buildCloseButton`

```typescript
closeButton.pinGlyphSize(closeScale.glyphXs);
closeButton.getGlyph()?.setStyleTrait(GLYPH_XS_INK_TRAIT);
```

Add `import { GLYPH_XS_INK_TRAIT } from "~/core/StyleTraits.js";`.

### `component/container/WindowHeader.ts` — lines 48-80

Delete the `windowHeaderTitleGlyphSize()` function (lines 48-60) — its only caller is removed below. Replace the `WindowHeaderTitleGlyph` class (lines 62-80):

```typescript
/**
 * The leading icon inside a {@link WindowHeader}'s title row. Opts into
 * `GLYPH_MD_INK_TRAIT`, so every window's title icon shares one CSS rule
 * with `ComboBoxCaretGlyph`'s chevron instead of each repeating the same
 * theme-matched size on its own class rule.
 */
class WindowHeaderTitleGlyph extends Glyph {
    protected static readonly ownStyleTraits: readonly StyleTrait[] = [GLYPH_MD_INK_TRAIT];

    /**
     * @param name - The glyph to render.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this constant.
     */
    constructor(name: string, subclassDefaults?: Partial<GlyphOptions>) {
        super(name, undefined, subclassDefaults);
    }
}
```

Add `import type { StyleTrait } from "~/core/ClassStyleRules.js";` and `import { GLYPH_MD_INK_TRAIT } from "~/core/StyleTraits.js";`. `setGlyph` (line 293-295) and `resolveTitleGlyphInk`/`updatePreferredSize` (lines 219-236) are unchanged — they remain the authoritative per-instance re-pin the trait reconciles against.

### `component/input/ComboBox.ts` — lines 539-564

Delete the `comboBoxCaretGlyphSize()` function (lines 539-551). Replace the `ComboBoxCaretGlyph` class (lines 553-564):

```typescript
/**
 * The chevron glyph inside a {@link ComboBoxCaret}. Opts into
 * `GLYPH_MD_INK_TRAIT`, so every ComboBox's chevron shares one CSS rule
 * with `WindowHeaderTitleGlyph`'s title icon instead of each repeating the
 * same theme-matched size on its own class rule.
 */
class ComboBoxCaretGlyph extends Glyph {
    protected static readonly ownStyleTraits: readonly StyleTrait[] = [GLYPH_MD_INK_TRAIT];

    constructor() {
        super("chevron-down");
    }
}
```

Widen the existing `import { INPUT_CHROME_TRAIT } from "~/core/StyleTraits.js";` (line 23) to `import { GLYPH_MD_INK_TRAIT, INPUT_CHROME_TRAIT } from "~/core/StyleTraits.js";`. The existing `import type { StyleBag, StyleTrait } from "~/core/ClassStyleRules.js";` (line 22) already imports `StyleTrait` — no change needed there. `ComboBoxCaret`'s own constructor (lines 577-595, its own box sizing and the `this._glyph.setPreferredSize(...)` re-pin) is unchanged.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/StyleTraits.ts`** — add `GLYPH_XS_INK_TRAIT` and `GLYPH_MD_INK_TRAIT`, per `## Internal Structure`.
   *Check:* `npm run typecheck` passes with no other file changed.

2. **`packages/lib/src/typescript/lib/component/input/SpinButton.ts`** — swap the `setStyleGroup("spin-glyph")` call for `setStyleTrait(GLYPH_XS_INK_TRAIT)`, add the import.
   *Check:* `npm run typecheck`.

3. **`packages/lib/src/typescript/lib/component/button/TabButton.ts`** — swap the `setStyleGroup("tab-close-glyph")` call for `setStyleTrait(GLYPH_XS_INK_TRAIT)`, add the import.
   *Check:* `npm run typecheck`.

4. **`packages/lib/src/typescript/lib/component/container/WindowHeader.ts`** — delete `windowHeaderTitleGlyphSize()`, add `ownStyleTraits` to `WindowHeaderTitleGlyph`, simplify its constructor, add the two imports, per `## Internal Structure`.
   *Check:* `npm run typecheck`.

5. **`packages/lib/src/typescript/lib/component/input/ComboBox.ts`** — delete `comboBoxCaretGlyphSize()`, add `ownStyleTraits` to `ComboBoxCaretGlyph`, simplify its constructor, widen the `StyleTraits.js` import, per `## Internal Structure`.
   *Check:* `npm run typecheck`.

6. **Regression grep.** `grep -rn 'windowHeaderTitleGlyphSize\|comboBoxCaretGlyphSize' packages/lib/src/typescript/lib` — expect zero matches. `grep -n 'setStyleGroup' packages/lib/src/typescript/lib/component/input/SpinButton.ts packages/lib/src/typescript/lib/component/button/TabButton.ts` — expect zero matches in both.

7. **`packages/lib/tests/component/input/SpinButton.test.ts`** — update the `describe('SpinButton chevron glyph style hoisting', ...)` block (the leading comment at lines 146-149 and the assertion at line 182): the trait replaces the styleGroup token, so the final assertion becomes `expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-xs-ink')).toBe(true);` and the `it(...)` description's "group rule" becomes "shared trait rule."
   *Check:* `npx vitest run tests/component/input/SpinButton.test.ts` from `packages/lib` — green.

8. **`packages/lib/tests/component/button/TabButton.test.ts`** — same treatment for the `describe('TabButton close-button glyph style hoisting', ...)` block (leading comment at lines 194-198, assertion at line 239).
   *Check:* `npx vitest run tests/component/button/TabButton.test.ts` — green.

9. **`packages/lib/tests/component/container/WindowHeader.test.ts`** — in the existing test (lines 57-68), change `expect(_ruleCacheHas('.WindowHeaderTitleGlyph')).toBe(true);` to `expect(_ruleCacheHas('.WindowHeaderTitleGlyph')).toBe(false);` (the class rule no longer exists — see `## Architecture Decisions`) and add `expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-md-ink')).toBe(true);`. Update the `it(...)` description to name the trait rule instead of the class rule.
   *Check:* `npx vitest run tests/component/container/WindowHeader.test.ts` — green.

10. **`packages/lib/tests/component/input/ComboBox.test.ts`** — same treatment for the test at lines 285-297: `_ruleCacheHas('.ComboBoxCaretGlyph')` becomes `false`, add `_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-md-ink')` as `true`. The neighbouring `'row 4'` test (lines 271-283, about `.ComboBoxCaret` — the caret **box**, not its glyph) is untouched.
    *Check:* `npx vitest run tests/component/input/ComboBox.test.ts` — green.

11. **Create `packages/lib/tests/component/GlyphIconTraitDedup.test.ts`** — proves genuine cross-class sharing (the behaviour this plan actually adds, beyond swapping one mechanism for another), per the test shape given below and `## Expected Behaviour` rows 1-2. Written after steps 1-5, so it should pass immediately; to confirm it is testing the right thing, temporarily revert steps 2-5 and confirm it fails (no shared trait rule exists without them), then reapply.
    *Check:* `npx vitest run tests/component/GlyphIconTraitDedup.test.ts` — green.

12. **`packages/lib/docs/reference/changelog/next.md`** — rewrite the existing bullet at lines 413-424 (added by `glyph-icon-size-dedup.md`), per `## Documentation Impact`.

13. **Full verification.** See `## Verification`.

---

## Test shape for step 11

`packages/lib/tests/component/GlyphIconTraitDedup.test.ts`, copying each touched file's own local `idSelector`/`declarationsFor`/`declarationsDuring` helper shape (no shared test utility exists for this — every file in this area defines its own, per existing convention):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpinButton } from '~/component/input/SpinButton';
import { TabButton } from '~/component/button/TabButton';
import { WindowHeader } from '~/component/container/WindowHeader';
import { ComboBox } from '~/component/input/ComboBox';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;
beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => DOM.reset());

function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

function declarationsFor(writes: RecordingDOMSink['writes'], selector: string): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const w of writes) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) continue;
        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) out[key] = styles[key];
    }
    return out;
}

describe('glyph-xs-ink trait: cross-class sharing between SpinButton and TabButton', () => {
    it("a TabButton's close-button glyph, rendered after a SpinButton has already rendered, writes no size declaration to its own #id rule", () => {
        new SpinButton('▲').getElement(true);

        // TabButton.buildCloseButton renders the close button eagerly inside
        // the outer TabButton's own constructor — capture the construction
        // itself, per TabButton.test.ts's own close-button test.
        const start  = sink.writes.length;
        const tab    = new TabButton('A', { closeable: true });
        const writes = sink.writes.slice(start);

        const glyph        = tab.getCloseButton()!.getGlyph()!;
        const declarations = declarationsFor(writes, idSelector(glyph));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-xs-ink')).toBe(true);
    });
});

describe('glyph-md-ink trait: cross-class sharing between WindowHeader and ComboBox', () => {
    it("a ComboBox's caret chevron, rendered after a WindowHeader has already rendered, writes no size declaration to its own #id rule", () => {
        new WindowHeader('Title').getElement(true);

        const combo = new ComboBox() as any;
        const glyph = combo._caret.getGlyph();

        const start = sink.writes.length;
        combo.getElement(true);
        const writes = sink.writes.slice(start);

        const declarations = declarationsFor(writes, idSelector(glyph));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-md-ink')).toBe(true);
    });
});
```

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/StyleTraits.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/SpinButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/tests/component/input/SpinButton.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.test.ts` |
| Modify | `packages/lib/tests/component/container/WindowHeader.test.ts` |
| Modify | `packages/lib/tests/component/input/ComboBox.test.ts` |
| Create | `packages/lib/tests/component/GlyphIconTraitDedup.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

`packages/lib/tests/component/default-options-fallback.test.ts` is deliberately **not** in this table — see `## Expected Behaviour` row 6.

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink. Row 7 needs a browser.

| # | Case | Expected |
|---|---|---|
| 1 | A `TabButton`'s closeable ✕ glyph renders after a `SpinButton`'s chevron has already rendered | The ✕ glyph's own `#id` rule carries no `minWidth`/`minHeight`/`maxWidth`/`maxHeight`; `.ts-ui-component.ts-ui-trait-glyph-xs-ink` exists and was not re-inserted |
| 2 | A `ComboBox`'s caret chevron renders after a `WindowHeader`'s title glyph has already rendered | Same; `.ts-ui-component.ts-ui-trait-glyph-md-ink` |
| 3 | A second `SpinButton`'s chevron, or a second closeable `TabButton`'s ✕, renders after a first of the *same* kind | Its own `#id` rule carries no size declaration; the shared trait rule exists (unchanged from today's `styleGroup` behaviour, just a different selector) |
| 4 | Checking `.WindowHeaderTitleGlyph`'s and `.ComboBoxCaretGlyph`'s own class rule | Neither exists in the rule cache any more — their only own declarations moved to the trait and neither class has any other |
| 5 | `new WindowHeader('Title').getGlyph()!.getMinSizeConstraint()` / `(new ComboBox() as any)._caret.getGlyph().getMinSizeConstraint()` | Both still `{width:14,height:14}` at the default theme — unchanged from before this plan; only which CSS rule supplies the value changes |
| 6 | The `'ComboBoxCaretGlyph minSize'` / `'WindowHeaderTitleGlyph minSize'` rows in `default-options-fallback.test.ts` | Still pass unedited: `getMinSizeConstraint()` resolves through `resolveStyleValue`, which now finds the value on the trait tier instead of the class tier, with the same result |
| 7 | Manual — live app under the shipped theme: a `NumberSpinner`'s arrows, a closeable tab's ✕, a `WindowHeader`'s title icon, a `ComboBox`'s chevron, and (from `#/style-audit`, after visiting screens with all four) the audit panel | Every icon renders at its existing size and position; the audit panel shows no new duplicate-rule row for any of the four |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants — step 6's two greps, each expecting zero matches.

**Manual browser verification (row 7) is required.** The offline harness records writes; it does not run a CSS cascade or reflect the Style Audit panel's own dedup grouping.

- Start a dev server on a spare port from *this worktree* (symlink `node_modules` to the repo root first if this worktree has none), and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Visit a screen with a `NumberSpinner`, a closeable tab strip, a window with a title glyph, and a `ComboBox`; read computed `width`/`height` on each icon and confirm it matches its pre-change size (8×8 for the spinner arrows and the tab ✕, 14×14 for the window title icon and the combo chevron).
- Open `#/style-audit` and Refresh — confirm no row attributes size duplication to `ButtonIconGlyph--spin-glyph`, `ButtonIconGlyph--tab-close-glyph`, `WindowHeaderTitleGlyph`, or `ComboBoxCaretGlyph` (the first two no longer exist as separate group rules; the last two no longer exist as class rules at all).

---

## Documentation Impact

No exported symbol is added: `GLYPH_XS_INK_TRAIT`/`GLYPH_MD_INK_TRAIT` are internal, matching `INPUT_CHROME_TRAIT` (neither is re-exported from `core/index.ts`, confirmed by grep). `npm run docs:api` must still finish with zero warnings.

**`packages/lib/docs/reference/changelog/next.md`** — rewrite the existing bullet at lines 413-424 (added by `glyph-icon-size-dedup.md`, now stale for the two migrated sites):

> **`Button`'s leading icon no longer repeats its fixed size on every instance's own CSS rule; a `NumberSpinner`'s arrows, a closeable tab's ✕, a `WindowHeader`'s title icon, and a `ComboBox`'s chevron no longer repeat theirs either.** The leading icon still shares one class-level rule (`.ButtonIconGlyph`). The spinner arrows and the tab ✕ now share one CSS rule across both — `.ts-ui-component.ts-ui-trait-glyph-xs-ink` — instead of each owning its own `styleGroup` rule (`.ButtonIconGlyph--spin-glyph`, `.ButtonIconGlyph--tab-close-glyph`); the window title icon and the combo chevron now share one CSS rule across both — `.ts-ui-component.ts-ui-trait-glyph-md-ink` — instead of each owning its own class rule (`.WindowHeaderTitleGlyph`, `.ComboBoxCaretGlyph`). A table's header menu icon is unchanged, still on its own `.ButtonIconGlyph--table-header-menu-glyph` `styleGroup` rule (its size comes from an unrelated, fixed-scrollbar-width formula, not a named icon step). Nothing changes visually. No consumer action is needed.

---

## Potential Challenges

- **`.WindowHeaderTitleGlyph`/`.ComboBoxCaretGlyph` disappearing from the rule cache is easy to miss when updating their tests.** A test that only adds the new trait-rule assertion without flipping the old `_ruleCacheHas(...)` expectation from `true` to `false` will pass for the wrong reason (the class rule genuinely still not existing was never checked). Mitigation: steps 9-10 spell out both edits explicitly.
- **A trait's declared size is frozen at the shipped default, unlike the per-construction functions it replaces.** Mitigation: `## Architecture Decisions` traces exactly why this cannot regress correctness (only a narrow dedup opportunity, in an already out-of-scope theme-timing scenario), not just asserts it.
- **Module state (`_traitBags`/`_owners` in `ClassStyleRules.ts`) survives `DOM.reset()` within one test file.** The new cross-class test file (step 11) and the four edited per-consumer test files are independent files, so no ordering dependency exists between them; within `GlyphIconTraitDedup.test.ts` itself, both describe blocks use distinct trait names and don't interfere.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/core/StyleTraits.ts`](packages/lib/src/typescript/lib/core/StyleTraits.ts) | Where the two new trait constants are added, mirroring `INPUT_CHROME_TRAIT`'s existing shape |
| [`plans/implemented/cross-class-style-groups.md`](implemented/cross-class-style-groups.md) | The trait mechanism's precedent — class-level vs. instance-level opt-in, the specificity table, the state-conflict check, and the border migration's exact shape this plan mirrors |
| [`plans/implemented/glyph-icon-size-scale.md`](implemented/glyph-icon-size-scale.md) | Why `glyphXs`/`glyphMd` are now genuine shared design intent, and why `glyphLg`/`glyphXl`/`glyphSm` and the fixed-host-graphic icons (`Checkbox`, `RadioButton`, `Scrollbar`, `TableHeader`) are excluded |
| [`plans/implemented/glyph-icon-size-dedup.md`](implemented/glyph-icon-size-dedup.md) | The `styleGroup`-based mechanism this plan replaces for `SpinButton`/`TabButton`, and why `TableHeader`'s menu glyph is excluded (unrelated `TRACK_WIDTH` formula) |
| [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) | `getMinSizeConstraint`/`getMaxSizeConstraint` (:3267-3280) resolving through `resolveStyleValue`, confirming no dispatch fold is needed; `ownStyleStates` (:426-431), confirming `.invisible` doesn't conflict |
| [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `ensureClassStyleRule`'s empty-deviation skip (:935-937) — why the two dedicated subclasses' own rules disappear entirely |
| [`packages/lib/tests/component/button/TabButton.test.ts`](packages/lib/tests/component/button/TabButton.test.ts) | The eager-construction capture pattern (`TabButton.buildCloseButton` renders during the outer constructor) the new cross-class test's `TabButton` case must copy |

---

## Non-Goals

- **`glyphSm`, `glyphLg`, `glyphXl`.** Re-verified against current source: `glyphSm`/`glyphXl` each have one non-framework consumer (no cross-class duplication possible); `glyphLg`'s six consumers already share the one `.Glyph` class rule for free, since their explicit size matches `Glyph`'s own default exactly. See `## Architecture Decisions`.
- **`TableHeader`'s menu-button glyph and `RadioButton`'s dot.** Re-verified: `TableHeader`'s menu glyph still sizes off `TRACK_WIDTH - MENU_BUTTON_CHROME_PX` ([`table/Header.ts:144`](packages/lib/src/typescript/lib/component/table/Header.ts#L144)), unrelated to any named icon step, still on its own `styleGroup` token. Left untouched, per this plan's brief and pending `glyph-icon-host-box-migration.md`'s separate investigation.
- **`ComboBoxCaret`'s own box size** (the caret's *container*, not its glyph) — set directly via constructor options (`{minSize:{glyphMd,glyphMd}, maxSize:...}`), always an authored instance value with no class-tier participation. Only one class constructs it, so there is no cross-class duplication to dedupe; a same-class fix (a class default) would be a different, unrelated change.
- **Re-pinning existing instances on a theme change.** Unaffected by this plan either way — `WindowHeader`/`TabBar` already re-pin per layout pass; `SpinButton`/`ComboBoxCaret` do not, matching `glyph-icon-size-scale.md`'s own scope.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

**`## Internal Structure`'s `WindowHeaderTitleGlyph`/`ComboBoxCaretGlyph` constructor snippets, as written, do not achieve `## Architecture Decisions`'s "own CSS class rule disappears" claim.** The plan calls for simply dropping the constructor's `{minSize: size, maxSize: size}` override and relying on `ownStyleTraits` alone. Doing exactly that left both classes' `_defaultOptions.minSize`/`maxSize` populated by `Glyph`'s own constructor default (`glyphDefaultSize()`, glyphLg — 16×16), which is not empty: `ensureClassStyleRule`'s `classDeviations` diffs `_defaultOptions` (via `getClassStyleDefaults()`) against `FRAMEWORK_DECLARATIONS` regardless of whether any class in the chain declares `ownClassStyleDefaults`, and glyphLg's 16px still deviates from the framework's `minWidth:"0px"`/`maxWidth:"none"` baseline. The result, confirmed by running the plan's own step-9/10 test edits before this fix: `.WindowHeaderTitleGlyph` and `.ComboBoxCaretGlyph` class rules were still inserted into the rule cache — just now carrying the *wrong* (glyphLg, not glyphMd) size, silently shadowed at render time only because `GLYPH_MD_INK_TRAIT`'s class-trait layer sits above the class layer in `styleLayers()`'s priority order. Rendering was never wrong (the trait layer and the per-instance `setPreferredSize` pin both still resolve to the correct 14×14), but the dedup goal — and the plan's own required manual-verification step ("no row attributes size duplication to ... `WindowHeaderTitleGlyph`, or `ComboBoxCaretGlyph`") — would have failed.

Fix: both constructors now merge in an explicit `NO_OWN_SIZE_DEFAULT` bag (`minSize: {width:0,height:0}`, `maxSize: {width:UNBOUNDED,height:UNBOUNDED}`) ahead of any caller-supplied `subclassDefaults`. These values resolve to exactly `FRAMEWORK_DECLARATIONS`'s own `minWidth`/`minHeight`/`maxWidth`/`maxHeight` ("0px"/"0px"/"none"/"none") — the class tier's own `classDeviations`/`resolveDeclarations` path, not `STYLE_WRITERS` directly — so `classDeviations` now genuinely returns `{}` for both classes, matching the plan's stated intent and letting `ensureClassStyleRule`'s empty-deviation skip apply for real. No public API or constructor signature changed; this is purely an internal default-bag fix local to the two migrated files.

**Manual browser verification (plan row 7), both pairs, run from a dev server serving this worktree (`readlink /proc/<pid>/cwd` confirmed):**

- **glyphMd pair:** `_ruleCacheHas('.WindowHeaderTitleGlyph')`/`'.ComboBoxCaretGlyph'` are `false`; the `WindowHeader`'s title glyph and both rendered `ComboBox` chevrons compute to 14×14 and carry the `ts-ui-trait-glyph-md-ink` class; `#/style-audit`, refreshed after visiting both screens, shows no row for either retired class name.
- **glyphXs pair:** on the Misc panel, all six `NumberSpinner`/`SpinButton` chevrons compute to 8×8 and carry `ButtonIconGlyph ts-ui-trait-glyph-xs-ink`; on the Tab panel, all four closeable tabs' ✕ chevrons compute to 8×8 with the same two classes (one unrelated leading-icon `ButtonIconGlyph` on that panel, with no trait class, correctly stays at its own 14×14 default); `#/style-audit` shows no row for `ButtonIconGlyph--spin-glyph` or `ButtonIconGlyph--tab-close-glyph` (both retired).

`npm run docs:api` finishes with 1 warning (`component/diagram.DiagramEdgeLayer.setEdges` → `Component.onFirstLayout`) — pre-existing and unrelated to this branch (reproduces identically on `feature/glyph-icon-size-scale` before this plan's changes), so the plan's "zero warnings" verification bar is not reachable on top of that pre-existing state.

---

## Notes

[^glyphlg-verified]: Confirmed by reading all six sites directly: `MenuItem.ts:289-292`, `Dialog.ts:305-308`, `SplitButton.ts:139-142`, `table/cell/Header.ts:365-366`, `list/renderer/Glyph.ts:106+156`, `tree/renderer/IconLabel.ts:104+141` each construct `new Glyph(name)` with no options bag, then call `.setPreferredSize({width: iconPx, height: iconPx})` where `iconPx = ThemeManager.getResolvedScale().glyphLg`. `Glyph.setPreferredSize` (`Glyph.ts:310-313`) also forwards to `super.setMinSize`/`super.setMaxSize`, so this writes an authored instance value equal to `Glyph`'s own already-`glyphLg`-sized class default (`glyphDefaultSize()`, `Glyph.ts:174-184`, resolved fresh per construction, before `super()`). `flushStyleBag`'s per-key diff finds the authored value matches the class tier's resolved value and writes nothing extra — confirmed as the general behaviour any matching authored-vs-tier value already produces throughout this layer stack, not something specific to this plan.

[^minsize-is-paint-and-layout]: `resolveInstanceStyleDeclarations` (`Component.ts:320-333`), the function that seeds a `styleGroup`'s cached content, itself calls `component.getMinSizeConstraint()`/`getMaxSizeConstraint()` to do so — direct confirmation that `minSize`/`maxSize` were already routed through the same getter this plan's trait migration relies on, even under the pre-existing `styleGroup` mechanism `SpinButton`/`TabButton` used before this plan.

[^self-correcting-precedent]: The same reasoning `cross-class-style-groups.md` used for its own `## Public API` `ensureTraitStyleRule` doc ("`null` on a name already owned by a different trait object") and for `styleGroup`'s pre-existing self-correction ("that instance's real resolved value no longer matches the cached content, so it falls back to a real per-instance `#id` write") — a JS/CSS layering mismatch never produces wrong *rendered* output in this framework, only a missed dedup opportunity, because `flushStyleBag` always compares the authored instance value against whatever the lower tiers currently resolve to and writes a real declaration on any mismatch.
