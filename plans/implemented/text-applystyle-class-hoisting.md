---
depends-on: [style-rule-materialization-reduction]
touches-shared: [packages/lib/src/typescript/lib/core/ClassStyleRules.ts, packages/lib/src/typescript/lib/core/Component.ts]
---

# Text `applyStyle` Class-Rule Hoisting — Implementation Plan

## Overview

`Text.applyStyle` ([packages/lib/src/typescript/lib/component/input/Text.ts:1245-1273](packages/lib/src/typescript/lib/component/input/Text.ts#L1245-L1273)) writes twelve font/text CSS declarations — `fontFamily`, `textAlign`, `textShadow`, `fontKerning`, `fontSize`, `fontSizeAdjust`, `fontStretch`, `fontStyle`, `fontVariant`, `fontWeight`, `lineHeight`, `textOverflow` — through `this.setElementCSSRules({...})`, which queues straight onto the component's own per-instance `#id` rule ([Component.ts:1601-1612](packages/lib/src/typescript/lib/core/Component.ts#L1601-L1612)) on every render, for every `Text` instance, regardless of whether the resolved value is the class's own default. That `setElementCSSRules` route is a different code path from `Component.writeRuleDeclaration` ([Component.ts:4621-4627](packages/lib/src/typescript/lib/core/Component.ts#L4621-L4627)), which compares a value against a per-class-constructor-cached bag (`ensureClassStyleRule`, [ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts)) and skips the write when it matches. Every other declaration `Component`'s own `applyStyle` phases write — border, cursor, outline, color, background — already goes through `writeRuleDeclaration` and benefits from that skip. `Text` never adopted the pattern, because `writeRuleDeclaration` is `private`, so a subclass cannot call it.

`Text` is the single most-instantiated component class in the library — every button label, menu item, dialog message, table cell, and header title constructs one. This plan routes all twelve declarations through the same compare-and-skip mechanism, so a `Text` with no per-instance font override contributes nothing to its own `#id` rule and instead relies on a shared `.Text` (or `.Link`/`.Label`/`.SelectableText`/…) class rule — exactly the three-tier split `border`/`cursor`/`outline`/`userSelect`/`foregroundColor` already use.

This plan depends on [`style-rule-materialization-reduction.md`](style-rule-materialization-reduction.md) landing first: both plans edit the same functions in `ClassStyleRules.ts`/`Component.ts`, and this plan's Internal Structure below is written against the state that plan leaves behind (a widened `ClassStyleBag`/`ClassStyleDefaults` that already allows `null` values and already hoists `userSelect`/`outline`/`foregroundColor`/`border`). Implementing both concurrently would produce a direct merge conflict on the same object literals.

---

## Architecture Decisions

### Extend `ensureClassStyleRule`'s mechanism — but namespace the new keys, don't add them flat

The precedent this plan follows is `ensureClassStyleRule`/`resolveDeclarations` in `ClassStyleRules.ts`, extended by the depended-upon plan to hoist `userSelect`, `outline`, and `foregroundColor` as flat, explicitly-named keys on `ClassStyleDefaults`. This plan does **not** copy that flat shape for the twelve `Text` properties. Instead it adds one new field, `font?: TextClassStyleDefaults | null`, and nests all twelve inside it.[^collision-evidence] `Text.getClassStyleDefaults()` (a new override, see below) is the only code that ever populates `font`; every other class's defaults bag leaves it `undefined`.

A fully generic "walk `_defaultOptions` and hoist every key that looks CSS-shaped" helper — the alternative this plan considered — is not built. Two of the twelve properties — `fontSize` and `lineHeight` — do not resolve from `_defaultOptions` at all; their real DOM-written value lives in private fields (`_fontSizeCSSRule`, `_lineHeightCSSRule`) that a generic reader cannot see, so a "no escape hatches" version is not achievable regardless of how the other ten are handled.[^generic-rejected] With two properties needing bespoke code no matter what, a generic helper would only replace the other ten's explicit `if (font?.x) …` lines with a lookup table mapping option keys to CSS keys — the same hand-maintained list, moved rather than removed.

### `writeRuleDeclaration` becomes `protected`; `Text` calls it directly

The single blocker to reusing the existing skip-on-match comparison from `Text` is visibility: `writeRuleDeclaration` is `private` to `Component`. Widening it to `protected` is a one-line change with no other effect — `Component`'s own twenty-plus call sites are unaffected, and only subclasses gain the ability to call it. No parallel "Text's own equivalent" helper is written; `Text.applyStyle` calls `this.writeRuleDeclaration(key, value)` for all twelve properties, the same call every `Component` phase already makes for `cursor`/`outline`/`color`/etc.[^guard-shape]

### `Component` gains a `getClassStyleDefaults()` hook

`Component.applyStyle` currently calls `ensureClassStyleRule(this.constructor, this._defaultOptions)` directly. This plan replaces that with `ensureClassStyleRule(this.constructor, this.getClassStyleDefaults())`, a new `protected` method whose base implementation is `return this._defaultOptions;` — a bare reference, zero allocation, identical behaviour for every class that doesn't override it. `Text` overrides it to layer the `font` bag on top:

```typescript
protected getClassStyleDefaults(): ClassStyleDefaults {
    return { ...super.getClassStyleDefaults(), font: { /* … */ } };
}
```

This is the seam that lets `fontSize`/`lineHeight` (sourced from private fields, not `_defaultOptions`) and `textOverflow` (derived from `truncate`) join the same per-constructor-cached comparison without widening `_defaultOptions`'s own type or touching `TextOptions`'s public shape.[^allocation-cost]

### `fontSize` and `lineHeight` resolve from `Text`'s own constants, not `_defaultOptions`

`_fontSizeCSSRule`'s field initializer and `_lineHeightCSSRule`'s field initializer are fixed literals (`"var(--ts-ui-font-size, 14px)"`, `ADDITIVE_LINE_HEIGHT_RULE`) that do not depend on `_defaultOptions.fontSize`/`.lineHeight` at all — confirmed by reading the constructor: `applyOptions`'s cascade only dispatches `setFontSize`/`setLineHeight` when the **caller** passes an explicit option ([Text.ts:179](packages/lib/src/typescript/lib/component/input/Text.ts#L179), and `lineHeight` is never in `_defaultTextOptions` to begin with), never for the class default. So every current `Text`-family class — `Text`, `Link`, `Label`, `Legend`, and (after the depended-upon plan) `SelectableText` — starts every fresh instance at the exact same two literal strings, regardless of `_defaultOptions`. `Text.getClassStyleDefaults()` supplies them as fixed constants:

```typescript
const DEFAULT_FONT_SIZE_RULE = "var(--ts-ui-font-size, 14px)";
// ADDITIVE_LINE_HEIGHT_RULE already exists (Text.ts:84)
```

`_fontSizeCSSRule`'s field initializer is changed to reference `DEFAULT_FONT_SIZE_RULE` instead of repeating the literal, so the two can never drift apart.

### `textOverflow` derives from `truncate`, the same way `display` already derives from `displayed`

`resolveDeclarations` already computes `display: (defaults.displayed ?? true) ? "block" : "none"` — a boolean class default transformed into a CSS keyword, entirely inside the generic function, no per-caller special case. `textOverflow` fits the same shape: `getTextOverflow()`'s real logic is `_options.textOverflow !== undefined ? that : (isTruncate() ? "ellipsis" : null)`. `Text.getClassStyleDefaults()` pre-resolves the class-level half of that (`(this._defaultOptions.truncate ?? true) ? "ellipsis" : null`) and hands the already-computed string to `font.textOverflow` — `ClassStyleRules.ts` itself stays CSS-shaped and knows nothing about `truncate`.[^truncate-uniform]

### `Text.applyStyle` flushes twice

`Text.applyStyle` currently calls `super.applyStyle(element)` first — which, per `Component.applyStyle`'s own structure, ends with `materialiseStyleRule()` (flushing everything `Component`'s own phases queued). `Text`'s remaining code then runs **after** that flush. `writeRuleDeclaration` only queues (`this._styleRule.queue(key, value)`); it never flushes. So a naive port would queue the twelve declarations and never write them. `Text.applyStyle` must call `this.materialiseStyleRule()` (already `protected`, [Component.ts:4906](packages/lib/src/typescript/lib/core/Component.ts#L4906)) a second time, at the end of its own body, to flush whatever it queued. The method is idempotent — it no-ops when nothing is queued — so this is safe on the common (nothing-diverges) path.

### `fontFamily`'s getter-fallback carve-out is unchanged; the class-rule tier is what finally honours its intent

The comment at [Text.ts:53-58](packages/lib/src/typescript/lib/component/input/Text.ts#L53-L58) explains that `_defaultOptions.fontFamily` is never dispatched through `setFontFamily` during construction, on purpose, "so a literal value is never forced into `_options`... blocking a parent's `font-family` override from cascading through." Today this protection is largely moot: `applyStyle` writes the resolved literal to the per-instance `#id` rule unconditionally regardless of whether `_options.fontFamily` was ever set, and `#id` always wins on specificity — nothing can override it short of `!important`. After this plan, a `Text` with no explicit `fontFamily` skips the `#id` write entirely and relies on `.Text`'s class rule (specificity `0,1,0`) instead — the first point at which an equal-or-higher-specificity consumer selector can actually win. The carve-out itself needs no code change (`_options.fontFamily` still should never be dispatched, so an explicit runtime override still correctly diverges and stays per-instance); only the comment's justification is now fully accurate rather than aspirational, and is reworded to say so.

### `''` becomes `null`

`Text.applyStyle` today falls back to `''` for every unset value (`this.getFontFamily() ?? ''`, etc.), not `null`. `writeRuleDeclaration`'s comparison is against `_inheritedStyleBag[key]`, which — per the depended-upon plan's convention — holds `null` or is absent (`undefined`) for "no declaration," never `''`. All twelve fallbacks change from `?? ''` to a guard that skips the call entirely when falsy (see Internal Structure), matching how `Component`'s own phases already handle "no value": `if (outline) { this.writeRuleDeclaration("outline", outline); }`. At the DOM layer this is behaviourally identical — `DOM.ts`'s `writeDeclaration` ([DOM.ts:304-316](packages/lib/src/typescript/lib/core/DOM.ts#L304-L316)) clears a camelCase property the same way for `null` and `''` — so this is a pure internal normalization, not a rendering change.

---

## Internal Structure

### `ClassStyleRules.ts`: the new `font` field

```typescript
/**
 * The class-uniform font/text declarations a `Text`-family class produces
 * from its own defaults alone. Namespaced under `ClassStyleDefaults.font`
 * rather than added as flat keys: `Glyph` (component/display/Glyph.ts),
 * `TabBar` (component/container/TabBar.ts), and `TextInput`
 * (component/input/TextInput.ts) each declare their own, differently-typed
 * `fontSize`/`lineHeight`/`textAlign` options — flat keys of the same name
 * would silently leak their unrelated defaults into this bag, since
 * `Component.applyStyle`'s default `getClassStyleDefaults()` passes
 * `_defaultOptions` through verbatim for every class that doesn't override
 * it. Only `Text.getClassStyleDefaults()` ever sets `font`.
 */
interface TextClassStyleDefaults {
    fontFamily?:     string | null;
    fontKerning?:    string | null;
    fontSize?:       string | null;   // CSS-ready value, e.g. "var(--ts-ui-font-size, 14px)"
    fontSizeAdjust?: string | null;
    fontStretch?:    string | null;
    fontStyle?:      string | null;
    fontVariant?:    string | null;
    fontWeight?:     string | null;
    textAlign?:      string | null;
    textShadow?:     string | null;
    lineHeight?:     string | null;   // CSS-ready value, e.g. "calc(1em + var(--ts-ui-line-padding, 2px))"
    textOverflow?:   string | null;   // pre-resolved from `truncate`; see Text.getClassStyleDefaults
}

interface ClassStyleDefaults {
    // ...existing fields from the depended-upon plan (visible, displayed,
    // minSize, maxSize, overflow, cursor, userSelect, outline,
    // foregroundColor)...
    font?: TextClassStyleDefaults | null;   // NEW
}
```

`resolveDeclarations` gains one block, appended after the existing `outline`/`color` conditionals:

```typescript
    const font = defaults.font;
    if (font?.fontFamily)     declarations.fontFamily     = font.fontFamily;
    if (font?.fontKerning)    declarations.fontKerning    = font.fontKerning;
    if (font?.fontSize)       declarations.fontSize       = font.fontSize;
    if (font?.fontSizeAdjust) declarations.fontSizeAdjust = font.fontSizeAdjust;
    if (font?.fontStretch)    declarations.fontStretch    = font.fontStretch;
    if (font?.fontStyle)      declarations.fontStyle      = font.fontStyle;
    if (font?.fontVariant)    declarations.fontVariant    = font.fontVariant;
    if (font?.fontWeight)     declarations.fontWeight     = font.fontWeight;
    if (font?.textAlign)      declarations.textAlign      = font.textAlign;
    if (font?.textShadow)     declarations.textShadow     = font.textShadow;
    if (font?.lineHeight)     declarations.lineHeight     = font.lineHeight;
    if (font?.textOverflow)   declarations.textOverflow   = font.textOverflow;
```

`classDeviations`'s existing loop (`for (const key of Object.keys(resolved))`) needs no change — it already treats any key present in `resolved` but absent from `FRAMEWORK_DECLARATIONS` as a deviation, which covers all twelve automatically. `ClassStyleDefaults` and `TextClassStyleDefaults` are both declared `export`ed (`ClassStyleDefaults` needs it so `Component.ts` can name it in `getClassStyleDefaults`'s return type; `TextClassStyleDefaults` stays unexported — `Text.ts`'s object literal for `font` is checked structurally through `ClassStyleDefaults` without needing to import it by name).

### `Component.ts`: `getClassStyleDefaults` and the widened `applyStyle` call

```typescript
import { COMPONENT_CLASS, ensureClassStyleRule, type ClassStyleDefaults } from "~/core/ClassStyleRules.js";

// ...

/**
 * The class-comparison bag `ensureClassStyleRule` resolves for this class.
 * Base implementation is a bare reference to `_defaultOptions` — the same
 * value `applyStyle` has always passed. Override when a subclass needs to
 * contribute a comparison value that doesn't live in `_defaultOptions`
 * (e.g. `Text`, whose `fontSize`/`lineHeight` resolve through private
 * derived fields).
 */
protected getClassStyleDefaults(): ClassStyleDefaults {
    return this._defaultOptions;
}
```

`applyStyle`'s existing line becomes:

```typescript
this._inheritedStyleBag = ensureClassStyleRule(this.constructor, this.getClassStyleDefaults());
```

And `writeRuleDeclaration`'s modifier changes from `private` to `protected`; its body and doc comment are unchanged.

### `Text.ts`: `applyStyle` and `getClassStyleDefaults`

```typescript
const DEFAULT_FONT_SIZE_RULE = "var(--ts-ui-font-size, 14px)";

// ADDITIVE_LINE_HEIGHT_RULE already exists at Text.ts:84.

// ... inside class Text ...

private _fontSizeCSSRule: string | null = DEFAULT_FONT_SIZE_RULE;   // was the inline literal

/**
 * Supplies the class-level font/text defaults `ClassStyleRules.ts` cannot
 * see in `_defaultOptions`: `fontSize`/`lineHeight` resolve through private
 * derived fields (`_fontSizeCSSRule`, `_lineHeightCSSRule`), not the raw
 * numeric options, and `textOverflow` is pre-resolved from `truncate` here
 * rather than inside the generic resolver. Every value below is the literal
 * a *fresh, non-customized* instance of this concrete class would produce —
 * verified true for every current Text-family class (Link, Label, Legend),
 * none of which touch these fields in their own defaults.
 */
protected getClassStyleDefaults(): ClassStyleDefaults {
    return {
        ...super.getClassStyleDefaults(),
        font: {
            fontFamily:     this._defaultOptions.fontFamily     ?? null,
            fontKerning:    this._defaultOptions.fontKerning    ?? null,
            fontSize:       DEFAULT_FONT_SIZE_RULE,
            fontSizeAdjust: this._defaultOptions.fontSizeAdjust ?? null,
            fontStretch:    this._defaultOptions.fontStretch    ?? null,
            fontStyle:      this._defaultOptions.fontStyle      ?? null,
            fontVariant:    this._defaultOptions.fontVariant    ?? null,
            fontWeight:     this._defaultOptions.fontWeight     ?? null,
            textAlign:      this._defaultOptions.textAlign      ?? null,
            textShadow:     this._defaultOptions.textShadow     ?? null,
            lineHeight:     ADDITIVE_LINE_HEIGHT_RULE,
            textOverflow:   (this._defaultOptions.truncate ?? true) ? "ellipsis" : null,
        },
    };
}

/** Writes one font/text declaration only when it has a value — mirrors the
 *  `if (x) { this.writeRuleDeclaration(...) }` shape every Component phase
 *  uses for an optional property (see applyChromeStyles's outline/color). */
private writeFontDeclaration(key: string, value: string | null): void {
    if (value) {
        this.writeRuleDeclaration(key, value);
    }
}

applyStyle(element: Handle): this {
    super.applyStyle(element);

    const fontSize   = this.getFontSize();
    const lineHeight = this.getLineHeight();

    this.writeFontDeclaration("fontFamily",     this.getFontFamily());
    this.writeFontDeclaration("textAlign",      this.getTextAlign());
    this.writeFontDeclaration("textShadow",     this.getTextShadow());
    this.writeFontDeclaration("fontKerning",    this.getFontKerning());
    this.writeFontDeclaration("fontSize",       this._fontSizeCSSRule   ?? (fontSize !== null ? `${fontSize}px` : null));
    this.writeFontDeclaration("fontSizeAdjust", this.getFontSizeAdjust());
    this.writeFontDeclaration("fontStretch",    this.getFontStretch());
    this.writeFontDeclaration("fontStyle",      this.getFontStyle());
    this.writeFontDeclaration("fontVariant",    this.getFontVariant());
    this.writeFontDeclaration("fontWeight",     this.getFontWeight());
    this.writeFontDeclaration("lineHeight",     this._lineHeightCSSRule ?? (lineHeight !== null ? `${lineHeight}px` : null));
    this.writeFontDeclaration("textOverflow",   this.getTextOverflow());

    this.materialiseStyleRule();

    return this;
}
```

Every getter call is unchanged from today's `applyStyle` — only the destination (`writeFontDeclaration`/`writeRuleDeclaration`, comparison-gated) and the null-vs-`''` fallback change.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`** — add the `TextClassStyleDefaults` interface and the `font` field on `ClassStyleDefaults` (export both `ClassStyleDefaults`; keep `TextClassStyleDefaults` unexported), per [Internal Structure](#internal-structure). Add the twelve-line conditional block to `resolveDeclarations`, after its existing `outline`/`color` conditionals.
   Check: `npx tsc --noEmit` from `packages/lib` — no new errors from this file alone (Component.ts's import comes next).

2. **`packages/lib/src/typescript/lib/core/Component.ts`**:
   - Add `type ClassStyleDefaults` to the existing `ClassStyleRules.js` import.
   - Add the `getClassStyleDefaults()` method (see Internal Structure), placed immediately before `applyStyle`.
   - Change `applyStyle`'s `ensureClassStyleRule(this.constructor, this._defaultOptions)` to `ensureClassStyleRule(this.constructor, this.getClassStyleDefaults())`.
   - Change `writeRuleDeclaration`'s modifier from `private` to `protected`.
   Check: `npx tsc --noEmit` — `Component.ts` compiles; `grep -n "private writeRuleDeclaration" packages/lib/src/typescript/lib/core/Component.ts` returns zero matches.

3. **`packages/lib/src/typescript/lib/component/input/Text.ts`**:
   - Add `import type { ClassStyleDefaults } from "~/core/ClassStyleRules.js";`.
   - Add the `const DEFAULT_FONT_SIZE_RULE = "var(--ts-ui-font-size, 14px)";` module constant, near `ADDITIVE_LINE_HEIGHT_RULE` ([Text.ts:84](packages/lib/src/typescript/lib/component/input/Text.ts#L84)).
   - Change `_fontSizeCSSRule`'s field initializer ([Text.ts:98](packages/lib/src/typescript/lib/component/input/Text.ts#L98)) from the inline literal to `DEFAULT_FONT_SIZE_RULE`.
   - Add the `getClassStyleDefaults()` override and the private `writeFontDeclaration` helper (see Internal Structure), placed near `applyStyle`.
   - Replace `applyStyle`'s body ([Text.ts:1245-1273](packages/lib/src/typescript/lib/component/input/Text.ts#L1245-L1273)) with the version in Internal Structure.
   - Reword the doc comment at [Text.ts:53-58](packages/lib/src/typescript/lib/component/input/Text.ts#L53-L58): keep everything through "...never dispatched through `setFontFamily(...)`", and replace the reason clause that follows the em-dash ("doing so would write the literal `var(--ts-ui-font-family, …)` onto every Text's CSS rule, blocking a parent's `font-family` override from cascading through.") with: "this is what lets an instance with no override skip its `#id` write entirely and resolve `font-family` from `.Text`'s class rule instead, which a higher- or equal-specificity consumer selector can still beat."
   Check: `npx tsc --noEmit`; `grep -n "setElementCSSRules" packages/lib/src/typescript/lib/component/input/Text.ts` returns zero matches (the only call site was `applyStyle`, now removed).

4. **`packages/lib/tests/core/ClassStyleRules.test.ts`** — add one case verifying the generic `font` mechanism in isolation (a bare `Component` subclass, not `Text`): see [Expected Behaviour](#expected-behaviour).
   Check: new case passes; all existing cases (1-22, or however many the depended-upon plan leaves numbered) pass unmodified.

5. **Create `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts`** — the full behavioural suite for the twelve declarations, per [Expected Behaviour](#expected-behaviour). Mirrors `tests/core/ClassStyleRules.test.ts`'s `declarationsDuring`/`idSelector` helpers (copy them locally, per that file's own established convention — see its case-18 commentary in the depended-upon plan) rather than importing them.
   Check: every new `it(...)` passes; each "must fail against current code" case (see Expected Behaviour) is confirmed to fail before step 3 and pass after.

6. **Documentation** — apply the single edit in [Documentation Impact](#documentation-impact).

7. Run the full [Verification](#verification) pass.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/tests/core/ClassStyleRules.test.ts` |
| Create | `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Expected impact, by consumer

The twelve declarations do not all diverge at the same rate. Grepping every `setFontFamily`/`setTextAlign`/`setTextShadow`/`setFontKerning`/`setFontSize`/`setFontSizeAdjust`/`setFontStretch`/`setFontStyle`/`setFontVariant`/`setFontWeight`/`setLineHeight`/`setTextOverflow` call site across `packages/lib/src/typescript/lib/` finds real per-instance overrides for `fontWeight`, `textAlign`, `fontSize`, `fontFamily`, `textShadow`, `lineHeight`, and `textOverflow`(via `truncate`) — but never for `fontKerning`, `fontSizeAdjust`, `fontStretch`, `fontStyle`, or `fontVariant`, which are set only by `Text`'s own constructor and `display/Header.ts`'s conditional (caller-option-only) forwarding. The comparison mechanism handles both cases correctly without any per-property special-casing — a divergent instance keeps writing exactly as it does today; a non-divergent one starts skipping — so the win is concentrated wherever a `Text` never overrides these fields, not uniform across every call site:

| Consumer | Diverges on (of the twelve) | Written per render | Skipped |
|---|---|---|---|
| A `Text`/`Link`/`Label`/`Legend` with no font setter ever called (most dialog/menu/docs-app text, after the depended-upon plan also most table-cell `SelectableText` instances' non-`lineHeight` properties) | none | 0 | 12 |
| A table-cell renderer's `_text` (`StringRenderer`, `NumberRenderer`, …) | `lineHeight` only — `CellRenderer.doLayout` ([CellRenderer.ts:120](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L120)) syncs it to the cell's live height every layout pass | 1 | 11 |
| `component/display/Header.ts`'s inner `_text` (a section header bar, default options) | `fontWeight` ("bold"), `fontSize` (`--ts-ui-header-font-size`) | 2 | 10 |
| `ParentHeaderCell` / `GroupSeparatorCell` / `HeaderCell`'s renderer text | `fontWeight`, `fontSize`, plus `textAlign` ("center") for `ParentHeaderCell` only | 2-3 | 9-10 |
| `NumberRenderer`'s renderer text (right-aligned numeric cell) | `textAlign` ("right") + `lineHeight` (table cell) | 2 | 10 |

`lineHeight` diverges more broadly than only table cells: `setLineHeight` is also called, on every layout pass, by the Tree and List row renderers (`component/tree/renderer/Label.ts`, `component/tree/renderer/IconLabel.ts`, `component/list/renderer/Label.ts`, `component/list/renderer/Glyph.ts`), `ComboBox`'s selected-item label, `AccordionIndicator`, and `AbstractCalendarDropdown`'s header/month/day cells — anywhere a `Text`/`Label` sits inside a row or cell whose height is set at layout time. None of these need special handling: the comparison mechanism already treats a synced pixel line-height as a genuine divergence from the class default and keeps writing it, the same way it already does for the table-cell case.

No live profiling was run for this plan (unlike the depended-upon plan's `Table.setDisplayMode` session). Given `Text`'s instantiation volume, a before/after profiling pass on a `Text`-heavy scenario (a wide table switching display mode, or a large `Tree`/`List`) is worth running once this lands, but is not a blocker — the win here is structurally the same class of fix as the depended-upon plan's, just against a different, larger set of declarations.

### Class-rule / instance-rule split

- A fresh `Text` (or `Link`/`Label`/`Legend`/`SelectableText`) with no font/text setter called writes **none** of the twelve declarations to its own `#id` rule at render. Unit-testable.
- That same fresh instance's concrete class gets a `.Text` (or `.Link`/…) class rule carrying all twelve, at the values `_defaultTextOptions` and the two hardcoded constants (`DEFAULT_FONT_SIZE_RULE`, `ADDITIVE_LINE_HEIGHT_RULE`) resolve to: `fontFamily: "var(--ts-ui-font-family, system-ui, sans-serif)"`, `fontKerning: "auto"`, `fontSize: "var(--ts-ui-font-size, 14px)"`, `fontSizeAdjust: "none"`, `fontStretch: "normal"`, `fontStyle: "normal"`, `fontVariant: "normal"`, `fontWeight: "normal"`, `textAlign: "left"`, `lineHeight: "calc(1em + var(--ts-ui-line-padding, 2px))"`, `textOverflow: "ellipsis"`. `textShadow` is absent (no class default anywhere today). Unit-testable.
- A constructor-time override (`new Text('x', { fontWeight: 'bold' })`) lands on `#id`, not the class rule. Unit-testable.
- A post-construction setter call (`text.setTextAlign('center')`) before any render is honoured at the next render, landing on `#id` — mirrors the existing `cursor` case ("a pre-render setCursor call is honoured by the render-time rule write").
- `Text`'s own `#id` rule is **not** empty even when all twelve are skipped — `Legend`'s `applyStyle` override still writes `marginLeft` via `setElementCSSRule` (unrelated to this plan, unchanged), and any `Text` subclass with its own chrome (border, background, …) still materializes its `#id` rule for those. A test must assert the *absence of the twelve keys*, never the absence of the rule.[^rule-still-exists]

### `lineHeight` on a table-cell renderer

- Two renders of the same `StringRenderer`-style `_text`, each preceded by a `setLineHeight(h)` call with a different `h` (mirroring `CellRenderer.doLayout`), both write `lineHeight` to `#id` with the matching `"${h}px"` value; the other eleven keys stay absent both times. This must fail against current code only in the sense that today the *other eleven* also appear on `#id` every time — write the test to assert on the eleven's absence, which is the actual regression this plan fixes for that call site.

### `fontSize` via a custom CSS var

- `new Text('x'); text.setFontSize('--ts-ui-header-font-size');` then rendering writes `fontSize: 'var(--ts-ui-header-font-size, 14px)'` to `#id` (the `14px` fallback comes from `_defaultOptions.fontSize`, resolved live inside `setFontSize`'s string branch) — diverges from the class default's `var(--ts-ui-font-size, 14px)` string, so it correctly does not get skipped. Confirm the exact fallback value empirically against the test DOM's `themeVars: {}` config when writing this test; the mechanism, not the literal px number, is what this case is pinning.

### Manual verification (not unit-testable offline)

- Visual: button labels, menu item titles, dialog and notification messages, table headers, and table cell text all render with unchanged font, weight, size, and alignment in a real browser.
- Visual: a table's row/column headers stay bold and centered; a rotated table's parent-header band is unaffected.
- Visual: table cell text stays vertically centered after a column resize or row-height change (confirms the `lineHeight` per-render write still works for the pooled-cell path).
- Re-run (or approximate) the depended-upon plan's `Table.setDisplayMode` profiling scenario and confirm `#id`-rule materialization drops further; compare call counts, not milliseconds (CDP-attached timings are not directly comparable across sessions).
- **New, added during the audit loop (see Implementation Notes, "Audit round 2"): visual — `PickerColumn`'s date/time column headers and `AbstractCalendarDropdown`'s header cells now render at their configured 12px `fontSize`, not the theme's base size.** This is a genuine, previously-silent rendering fix (not a regression this plan introduces), pinned at the CSS-declaration level by `TextClassStyleHoisting.test.ts`, but not visually confirmed in a real browser as part of this implementation — do this before merge, alongside the other visual items above.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test` from `packages/lib` — zero new errors.
- `npm run lint` from `packages/lib` — clean against the existing baseline.
- `npm test` (vitest) from `packages/lib` — full suite green, with particular attention to:
  - `tests/core/ClassStyleRules.test.ts` (existing cases plus the new `font`-mechanism case).
  - `tests/component/input/TextClassStyleHoisting.test.ts` (new suite).
  - `tests/component/input/TextThemeReflow.test.ts`, `tests/component/input/TextTruncateOption.test.ts`, `tests/component/input/TextIntrinsicHeight.test.ts`, `tests/core/TextDispose.test.ts` (existing `Text` behavioural suites — must pass unmodified; none assert on stylesheet write ops today, so none should need edits).
  - `tests/component/table/CellTextSelection.test.ts` (constructs every renderer heavily; must pass unmodified).
  - `tests/component/input/Link.test.ts`, `tests/component/input/Label.test.ts`, `tests/component/container/leaves.smoke.test.ts` (constructs `Legend` and other leaf `Text` subclasses; must pass unmodified).
  - `tests/component/table/cell/CellText.test.ts`, `tests/component/table/cell/DynamicCell.test.ts`, `tests/component/table/HeaderColumnWindow.test.ts`, `tests/component/table/HeaderParentCellMerge.test.ts` (exercise cell/header pooling and text rendering).
  - `tests/overlay/Dialog.test.ts`, `tests/overlay/Notification.test.ts`, `tests/overlay/Menu.test.ts`, `tests/component/container/MenuRow.test.ts`, `tests/component/button/Button.test.ts` (construct `Text` with font overrides — `fontWeight`, `textAlign` — that must keep landing on `#id`).
  - `tests/component/display/Markdown.test.ts`, `tests/component/display/Header.test.ts` (bold-by-default section header text).
- `grep -n "setElementCSSRules" packages/lib/src/typescript/lib/component/input/Text.ts` — zero matches.
- `grep -n "private writeRuleDeclaration" packages/lib/src/typescript/lib/core/Component.ts` — zero matches.
- Manual smoke test: open the docs app, exercise a Button, a Dialog, a Notification, a Menu, a table with sortable/grouped columns, a Tree, and a List — confirm no visual change to any text's font, weight, size, alignment, or vertical centering.

---

## Documentation Impact

No public API changes — `writeRuleDeclaration` and `getClassStyleDefaults` are both `protected` (excluded from the TypeDoc build per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s public-JSDoc rule), and `ClassStyleRules.ts` is not exported from `core/index.ts`. One changelog line: add to `packages/lib/docs/reference/changelog/next.md`'s *Changed* section, noting that `Text`'s font/text declarations (`font-family`, `text-align`, `font-weight`, etc.) now resolve through the shared class-rule tier for instances that don't override them — a consumer stylesheet targeting `.Text`/`.Link`/`.Label`/`.Legend`/`.SelectableText` by class now ties on specificity with the generated class rule, where the framework's `#id` rule previously always won. This mirrors the same note the depended-upon plan already added for `userSelect`/`outline`/`border`/`color`.

---

## Potential Challenges

- **A future `Text`-family subclass overriding `_fontSizeCSSRule`'s field initializer directly**, bypassing `DEFAULT_FONT_SIZE_RULE`. Safe, not a correctness bug: the comparison would correctly detect the string mismatch and keep writing per-instance for that subclass — it just loses the hoisting optimization until `getClassStyleDefaults()` is also overridden there.
- **A future unrelated `ComponentOptions`-derived interface adding a field literally named `font`.** Grepped today — none exist. If one appeared, its default would be silently exposed to `resolveDeclarations`'s new block. Low risk (no such field exists anywhere in the codebase today, unlike `fontSize`/`lineHeight`/`textAlign`, which do), and any reviewer adding `font?:` to an options interface would collide visibly with a widely-used name.
- **The two-`materialiseStyleRule()`-calls ordering.** If `Text.applyStyle` is edited later and the final `this.materialiseStyleRule()` call is accidentally moved before the `writeFontDeclaration` calls, every one of the twelve declarations would silently stop reaching the DOM (queued but never flushed) with no compile-time signal. Mitigated by the inline comment on the call and by `TextClassStyleHoisting.test.ts` covering exactly this (a divergent case that must land on `#id`).

---

## Critical Files

- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — the mechanism this plan extends; read in the state the depended-upon plan leaves it in, not today's.
- [packages/lib/src/typescript/lib/core/Component.ts:4608-4928](packages/lib/src/typescript/lib/core/Component.ts#L4608-L4928) — `writeRuleDeclaration` through `materialiseDeferredRules`, the full `applyStyle` phase sequence this plan's `getClassStyleDefaults` hook and `Text.applyStyle`'s second flush both fit into.
- [packages/lib/src/typescript/lib/component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts) — full file; read the constructor (options-cascade dispatch, lines ~118-231) alongside `applyStyle` (1245-1273) before editing either.
- [plans/style-rule-materialization-reduction.md](style-rule-materialization-reduction.md) — the precedent this plan mirrors and depends on; its Architecture Decisions and Internal Structure sections show the exact shape (`userSelect`/`outline`/`foregroundColor`/`border`) this plan's `font` field follows.
- [packages/lib/src/typescript/lib/component/display/Glyph.ts:127-160](packages/lib/src/typescript/lib/component/display/Glyph.ts#L127-L160) — `GlyphOptions`, the concrete evidence for the namespacing decision: an unrelated `Component` subclass with its own `fontSize`/`lineHeight`/`textAlign` fields.
- [packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts:105-122](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L105-L122) — `doLayout`'s per-render `setLineHeight` sync, the reason `lineHeight` must keep writing unconditionally for table cells.
- [packages/lib/tests/core/ClassStyleRules.test.ts](packages/lib/tests/core/ClassStyleRules.test.ts) — existing helper shapes (`declarationsDuring`, `idSelector`, `ensureStyleRuleOpsFor`) to copy into the new test file rather than reinvent.
- [packages/lib/tests/component/input/TextThemeReflow.test.ts](packages/lib/tests/component/input/TextThemeReflow.test.ts) — sibling convention for a focused, single-concern `Text` test file living outside a monolithic `Text.test.ts` (which does not exist).
- [packages/lib/tests/dom/TestDOM.ts:387-475](packages/lib/tests/dom/TestDOM.ts#L387-L475) — `RecordingDOMSink`, what the offline harness can observe about stylesheet-rule writes.

---

## Non-Goals

- **A fully generic, reflection-based auto-hoist helper** ("walk `_defaultOptions`, hoist anything CSS-shaped"). Rejected — `fontSize`/`lineHeight` resolve outside `_defaultOptions` entirely, so a no-escape-hatch version cannot exist; see [Architecture Decisions](#architecture-decisions).
- **Applying the same hoisting to `Glyph`'s own `fontSize`/`lineHeight`/`textAlign`.** `Glyph` is not a `Text` subclass and has entirely different derivation logic for these fields (no `_fontSizeCSSRule`/`ADDITIVE_LINE_HEIGHT_RULE` machinery). A separate investigation, not part of this plan.
- **Backfilling `Text`/`Link`/`Label`/`Legend`'s pre-existing gap in `tests/component/default-options-fallback.test.ts`.** Their font/text getters already fold `_defaultOptions` today, unrelated to this plan (which changes only *where* the resolved value is written, not how it's resolved) — `Link` already has three unrelated rows there; adding rows for fields whose getter logic isn't changing is out of scope.
- **Widening `writeRuleDeclaration` further, or exposing it publicly.** `protected` is exactly what `Text` needs; there is no present case for a non-subclass caller.
- **A before/after profiling session as part of this plan's implementation.** Recommended as a follow-up (see Expected Behaviour), not a gate — this plan has no live profiling data of its own, unlike the depended-upon plan.

---

## Notes

[^collision-evidence]: Confirmed by reading each interface directly: `GlyphOptions` ([Glyph.ts:127-160](packages/lib/src/typescript/lib/component/display/Glyph.ts#L127-L160)) declares `fontSize?: number`, `lineHeight?: number | string`, and `textAlign?: string` on `Glyph extends Component<GlyphOptions>` — not a `Text` subclass, with its own independent derivation (SVG-mode glyphs ignore `fontSize` entirely; char-mode glyphs default `textAlign` to `"center"`). `TabBarOptions` ([TabBar.ts:185](packages/lib/src/typescript/lib/component/container/TabBar.ts#L185)) and `TabOptions` declare `textAlign?: AxisPosition` (`"start" | "center" | "end"`, [Axis.ts:32](packages/lib/src/typescript/lib/primitive/Axis.ts#L32)) — a different type entirely, describing where the tab strip anchors along its axis, not a CSS `text-align` intention. `TextInputOptions` ([TextInput.ts:48](packages/lib/src/typescript/lib/component/input/TextInput.ts#L48)) declares `textAlign?: string | null`, forwarded to an inner `<input>`, also independent of `Text`. Any of these three classes' `_defaultOptions` reaching `resolveDeclarations` through a flat `textAlign`/`fontSize`/`lineHeight` key — which `Component.applyStyle`'s default `getClassStyleDefaults()` would do automatically, since it passes `_defaultOptions` through unchanged for any class that doesn't override the hook — would silently inject a wrong-typed or wrong-meaning declaration onto that class's shared `.ClassName` rule. Namespacing under `font` closes this off entirely: none of `GlyphOptions`/`TabBarOptions`/`TabOptions`/`TextInputOptions` declares a field named `font`.

[^generic-rejected]: Beyond `fontSize`/`lineHeight`, `Component`'s own `_options`/`_defaultOptions` mix CSS-representable values with non-CSS state on every class — `tag`, `interactive`, `truncate` itself, `text`, `listeners`, `layoutManager` (already explicitly excluded from the sibling `resolveClassDefaults` cache key, [ComponentDefaults.ts:83](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L83), for the same reason). A generic walker would need an exclusion list at least as long as this plan's explicit inclusion list, with none of the derivation `fontSize`/`lineHeight`/`textOverflow` need. The project's own coding guidelines (`CLAUDE.md`, *Simplicity First*) weigh against building a new reflection abstraction to save roughly a dozen near-identical lines this plan already has to write by hand for the two derived properties regardless.

[^guard-shape]: `Component`'s own `applyChromeStyles`/`applyBoxAndVisibilityStyles`/`applyMiscInlineStyles` never call `writeRuleDeclaration(key, null)` for an unset optional value — they guard with `if (value) { this.writeRuleDeclaration(key, value); }` and skip the call entirely, letting "absent from the instance" and "absent from the class/framework rule" line up naturally. `Text.applyStyle`'s `writeFontDeclaration` helper reproduces exactly that shape for all twelve properties, rather than calling `writeRuleDeclaration(key, value ?? null)` unconditionally (which would compare `undefined` — an absent class-bag key — against an explicit `null`, never matching, and defeat the skip for every property with no class-level default, e.g. `textShadow`).

[^allocation-cost]: `Text.getClassStyleDefaults()`'s object-literal spread runs on every `Text` render, but its result is only ever consulted by `ensureClassStyleRule` on the *first* render of a given concrete class (`_bags.get(ctor)` short-circuits every later call before `defaults` is touched again). The wasted allocation on renders 2..N is one small object literal — negligible next to a stylesheet mutation, and not worth a second caching layer duplicating `ensureClassStyleRule`'s own per-constructor cache.

[^truncate-uniform]: No current `Text`-family class sets a class-level `truncate: false` default. `Button`'s label (`this._text = new Text();`, [Button.ts:624](packages/lib/src/typescript/lib/component/button/Button.ts#L624)) constructs a plain, option-less `Text` — `TextOptions`'s own doc comment for `truncate` references a Button use case, but no current call site sets it, imperatively or via defaults. Every existing `setTruncate` call happens exactly once, from `Text`'s own constructor cascade ([Text.ts:226](packages/lib/src/typescript/lib/component/input/Text.ts#L226)), dispatching `options.truncate ?? this._defaultOptions.truncate!` — an explicit per-instance `truncate: false` option would still correctly diverge at `getTextOverflow()` and land on `#id`, unaffected by this class-level default.

[^rule-still-exists]: Mirrors the depended-upon plan's own corrected finding for `SelectableText`: a `Text` (or any subclass) always materializes *some* `#id` rule in practice — at minimum whenever a divergent property (like a table cell's synced `lineHeight`) is present, or whenever any of `Component`'s own chrome/geometry phases have something to write. A test asserting the *rule* never materializes would be wrong; assert on the *absence of the twelve keys* instead.

---

## Implementation Notes

- **A redundant constructor write defeated `lineHeight`'s skip; removed.** `Text`'s constructor called `this.setElementCSSRule("lineHeight", this._lineHeightCSSRule)` directly (predating this plan), unconditionally pre-queuing `lineHeight` onto the instance's `_styleRule` before any render. `writeRuleDeclaration`'s compare-and-skip only prevents *adding* a redundant queue entry — it has no way to retract one a different, unconditional call already queued — so this pre-write silently defeated the skip for every `Text` instance, even though the queued value was always identical to what `applyStyle` now re-derives itself. The line was redundant even before this plan (the same value was always overwritten by the unconditional pre-plan `applyStyle` at first render); with `applyStyle` now deriving `lineHeight` itself via `writeFontDeclaration`, deleting it is a pure no-op for the rendered DOM and lets the skip take effect. Confirmed safe by the full test suite (unaffected) and by the new `TextClassStyleHoisting.test.ts` cases pinning the exact `"${h}px"` value across two instances.
- **`textOverflow` does not achieve the same skip as the other eleven, and that optimization gap is not fixable within this plan's scope** (the *correctness* half of this note was wrong as first written — see "Audit rounds 2-3" below, which found and fixed a real bug here). `Text`'s constructor unconditionally dispatches `setTruncate(options.truncate ?? this._defaultOptions.truncate!)` (pre-existing, required so `whiteSpace`/`overflow` — which have no render-time fallback — are always set; see the plan's own `[^truncate-uniform]`). For the common (`truncate: true`) case, `setTruncate` calls the public `setTextOverflow`, which queues its write directly via `setElementCSSRule`, bypassing `writeRuleDeclaration`'s comparison the same way the deleted `lineHeight` line did — except here the write is load-bearing for `whiteSpace`/`overflow`'s own correctness and for `setTruncate`'s public, general-purpose runtime contract (a caller invoking `setTruncate` after render must see an immediate DOM update), so it cannot simply be deleted. A byte-for-byte identical, already-shipped instance of the same *optimization* gap was verified empirically for `whiteSpace`/`overflowX`/`overflowY` under the depended-upon plan (`class-scoped-style-rules.md`'s mechanism) — no test in that plan's suite exercised these against a real `Text`, so the gap went unnoticed there too. Fixing the optimization properly would mean either changing `setTruncate`'s shared dispatch semantics (also touching `whiteSpace`/`overflow`, well beyond this plan's file scope) or adding an "un-queue" capability to `StyleTarget`'s `_dirty` queue (shared infrastructure, also out of scope). Left as a documented, tested limitation: `textOverflow` still resolves to the correct value on every path (constructor-time, render-time, and runtime `setTruncate`/`clearTextOverflow` — see below), and the class-rule tier still carries it correctly (`.Text`'s class rule has `textOverflow: "ellipsis"`) — it's a missed optimization for this one property (it always writes something, where the other eleven often write nothing), not a correctness bug, not anymore. `TextClassStyleHoisting.test.ts` and `CellTextSelection.test.ts` both pin this explicitly (`textOverflow` present, correct value) rather than silently weakening their "eleven of twelve skip" assertions.
- **Two plan verification greps were stale.** Step 3's and the Verification section's `grep -n "setElementCSSRules" .../Text.ts` — zero matches` check assumed the only call site was `applyStyle`'s (now removed). Two unrelated, pre-existing call sites remain in `setLineClamp`/`clearLineClamp` (webkit line-clamp properties, untouched by this plan) — the actual, correct result is one fewer match (3 → 2), not zero. Left as-is per *Surgical Changes*: those two setters are out of this plan's scope.
- **Two pre-existing tests encoded the old "font block always writes" assumption and needed updating**, despite the plan's Verification section claiming both would pass unmodified: `tests/core/TextDispose.test.ts` (didn't anticipate `.Text` gaining its first class-level deviation, hence its first-ever `.Text` class rule, once a real `Text` renders) and `tests/component/table/CellTextSelection.test.ts` (asserted `fontFamily` was always written to `#id`, the exact optimization this plan removes). Both updated to assert the new, correct behaviour; see their diffs for the reasoning inline.

### Audit round 1 — three additional fixes

The first audit round found three real defects beyond the four notes above, all now fixed and covered by new tests in `TextClassStyleHoisting.test.ts`:

- **A constructor-time numeric/CSS-var `fontSize` desynchronised rendering from measurement.** `applyOptions`'s cascade dispatches `setFontSize`/`setLineHeight` for an explicit `options.fontSize`/`.lineHeight` *during* `super()`, but `Text`'s own field initializers (`_fontSizeCSSVar`, `_fontSizeCSSRule`, `_lineHeightCSSVar`, `_lineHeightCSSRule`) run immediately after `super()` returns and unconditionally reset those four fields back to their var-binding defaults — undoing the dispatch. This is a pre-existing bug (confirmed by probing the depended-upon plan's tip directly), but it used to be *masked*: the old, unconditional `applyStyle` also re-derived `fontSize`/`lineHeight` from those same (wrongly-reset) fields on every render, so the rendered CSS was consistently wrong in the same direction as `getFontSize()` — silently ignoring a constructor-time literal, but at least self-consistent. This plan's skip logic broke that consistency: the constructor's *own* `setFontSize`/`setLineHeight` call had already queued the caller's correct literal directly (bypassing `writeRuleDeclaration`), and once `applyStyle`'s re-derived value matched the (wrongly-reset) class default, it now *skipped* re-queuing — so the caller's originally-queued, correct value survived to the stylesheet while `getFontSize()` kept reporting the wrong (reset) one. Concretely: `new Text('x', { fontSize: 20 })` rendered `20px` but `getFontSize()` returned `14` — a real render/measurement mismatch, affecting `PickerColumn.ts:76` and `AbstractCalendarDropdown.ts:142`, both of which construct a `Text` with `{ fontSize: 12 }`. Fixed by re-dispatching `setFontSize`/`setLineHeight` in `Text`'s constructor, immediately after the field initializers, whenever the caller passed `options.fontSize`/`.lineHeight` — the same setters, just re-run once more so the field-initializer reset doesn't get the last word. `lineHeight` was unaffected in practice (`getLineHeight()` reads `_options.lineHeight` directly, never the CSS-rule fields), but the same fix applies there too for symmetry and to stop relying on the skip's incidental non-interference.
- **`truncate: false` silently inherited the class rule's `ellipsis`.** `writeFontDeclaration`'s "only write if truthy" guard (mirroring `Component`'s own `if (outline) { … }` shape) cannot represent "the instance actively wants no value," only "the instance has nothing to say" — for the other eleven declarations that's harmless (nothing ever needs to un-set a non-null class default back to null), but `textOverflow` is the one property where it does: `.Text`'s class rule always carries `textOverflow: "ellipsis"` today (every current class defaults `truncate: true`), so a `truncate: false` instance's `getTextOverflow() === null` needs to actively override that, and the guard silently swallowed the write instead. This directly contradicted the plan's own `[^truncate-uniform]` footnote, which claimed the opposite. Fixed by writing `textOverflow` unconditionally via `writeRuleDeclaration` (no truthy guard) instead of through `writeFontDeclaration` — mirroring `Component.applyChromeStyles`'s unconditional `this.writeRuleDeclaration("border", null)`, not its guarded `outline`/`color` writes, since (unlike those two) `textOverflow` is effectively always present and non-null in the class bag for every current class.
- **The changelog, a deleted constructor comment, and one test scenario needed correcting.** The changelog claimed a `Text` "no longer writes any of them," which was never literally true given the `textOverflow` exception documented above — reworded to say eleven of twelve. A now-orphaned eight-line comment explaining the field-initializer-clobbers-the-cascade mechanism was deleted from the constructor without being recorded as a deviation; its content is now covered more precisely by the comment on the re-dispatch fix above, which explains the exact mechanism at the point that now matters. And the `lineHeight`-tracking test originally used two fresh instances instead of "two renders of the same `_text`" as the plan's Expected Behaviour specifies — replaced with a test that drives a second `applyStyle` pass on the same instance directly (the plan's literal scenario doesn't occur via `CellRenderer.doLayout`, which calls `setLineHeight` as a pure setter write that never re-triggers `applyStyle` — the new test is a stress-test of the mechanism, not a reproduction of that call site, and says so).

### Audit round 2 — three more fixes, two of them to round 1's own fixes

The second audit round found three real defects, two of them in round 1's fixes themselves:

- **The `textOverflow` fix (round 1, bullet 2) was itself incomplete: writing `null` removes a declaration, it does not override one.** `DOM.ts`'s `writeDeclaration` treats `value === null` as removing the property from `#id`'s rule (`style.removeProperty`/`style[key] = ""`), not asserting an empty value. Since `.Text`'s class rule still declares `textOverflow: "ellipsis"`, an `#id` rule that no longer declares the property doesn't beat the class rule — it simply stops competing with it, so the cascade still resolved to "ellipsis". The comment, the test, and this file's round-1 note all asserted the write op instead of checking the actual resolved value, so the gap passed review. Fixed by substituting the CSS initial value `"clip"` for a `null` `getTextOverflow()` before the `writeRuleDeclaration` call — an explicit, higher-specificity override that reads as "no ellipsis," the same outcome `getTextOverflow() === null` represents. (It was inert in practice either way, because `setTruncate(false)` also sets `overflow: visible`, which suppresses ellipsis rendering regardless of `text-overflow`'s value — but that's a coincidence of this one property's neighbours, not something to rely on.)
- **The `fontSize`/`lineHeight` re-dispatch fix (round 1, bullet 1) violated CODE_CONVENTIONS.md's "Fields written during the `super()` cascade must use `declare`" rule.** That rule gives two sanctioned shapes for a field a cascade-dispatched setter writes: a bare `declare` field (no initializer), or — when the field genuinely needs a real initializer, as `_fontSizeCSSVar`/`_fontSizeCSSRule`/`_lineHeightCSSVar`/`_lineHeightCSSRule` do (their defaults are the var-binding literals, not derivable from the setter alone) — **defer the dispatch to the constructor body instead of `applyOptions`**, not both. Round 1's fix left the `options.fontSize`/`.lineHeight` dispatch in `applyOptions` *and* added a second, constructor-body dispatch, so the setter now ran twice per construction (two `scheduleLayout()` calls, two measurement invalidations) in a plan about removing redundant work. Fixed by deleting the two blocks from `Text.applyOptions` entirely and keeping only the constructor-body dispatch — `Component.applyOptions` is invoked exclusively from the constructor codebase-wide (verified: every other call site is either `super.applyOptions(...)` inside another `applyOptions` override, or a same-constructor `this.applyOptions(...)` call, never a later runtime re-application), so nothing depended on the `applyOptions`-time dispatch.
- **The user-visible consequence of the `fontSize`/`lineHeight` fix (`PickerColumn`'s and `AbstractCalendarDropdown`'s header text now actually rendering at their configured `fontSize: 12`, not the theme's base size) had no changelog entry and no manual-verification note.** Added a `## Fixed` entry to `next.md` and a bullet to this plan's own *Manual verification* list (see above) — the CSS-declaration-level fix is pinned by `TextClassStyleHoisting.test.ts`, but an actual browser check of those two components was not performed as part of this implementation and is called out explicitly for the user's pre-merge pass rather than silently assumed.

### Audit round 3 — the `clip` fix (round 2) only covered one of two write paths, plus a changelog inaccuracy

- **Round 2's `"clip"` substitution fixed `applyStyle`'s render-time `textOverflow` write, but `clearTextOverflow()` — called by `setTruncate(false)` at *runtime*, after render — still wrote a bare `null`, reopening the identical cascade hole.** `clearTextOverflow()` is a normal imperative setter: like every other setter, it writes directly via `setElementCSSRule`, bypassing `applyStyle` entirely (per `writeRuleDeclaration`'s own doc comment — "a runtime setter... always reaches `#id`... regardless of what the... class rule already holds" — the framework's general contract is that a setter's write is unconditional, not that it's automatically *correct* against a lower-tier rule it doesn't know about). Probed and confirmed: `new Text('x'); .getElement(true); .setTruncate(false)` wrote `#id { text-overflow: null }` (a removal) both before this fix and — separately — still would have after round 2's `applyStyle`-only fix, since `setTruncate(false)` never re-invokes `applyStyle`. Fixed by applying the same substitution inside `clearTextOverflow()` itself: write `this.getTextOverflow() ?? "clip"` instead of the previous hardcoded `null`, so the one place both the constructor path and the runtime path ultimately share (this method, `setTruncate`'s only caller for it) can't diverge again. This also makes `clearTextOverflow()`'s write track its own resolved value rather than assuming the value is always `null` — more correct in the general case, not just this one.
- **The changelog's `## Fixed` entry claimed both `getFontSize()` and `getLineHeight()` "reported the caller's value correctly" pre-fix — true only for `getLineHeight()`.** `getFontSize()` took the bound-CSS-var branch (`_fontSizeCSSVar` was also wrongly reset by the field initializer), so it returned the theme's base size, the same wrong value the rendered CSS showed — consistent with the earlier "Audit round 1" note, which this changelog entry contradicted. Reworded to state the getter split accurately: `getLineHeight()` was already correct pre-fix (only the CSS was wrong); `getFontSize()` was wrong in the same direction as the CSS (both sides silently ignored the caller's option).

### Audit round 4 — a fourth call site had the same cascade hole; round 1's "out of scope" dismissal was wrong for one of the two

- **`clearLineClamp()` reopens the exact `textOverflow` cascade hole rounds 2 and 3 fixed elsewhere.** Audit round 1's note above ("Two plan verification greps were stale") dismissed `setLineClamp`/`clearLineClamp` as pre-existing, unrelated call sites "out of this plan's scope" — correct for `setLineClamp` (its `textOverflow: "ellipsis"` write needs no fix, it already matches the class default) but wrong for `clearLineClamp`: it writes `textOverflow: null` directly via `setElementCSSRules`, the identical removal-not-override hazard rounds 2 and 3 found and fixed in `applyStyle` and `clearTextOverflow()`. Before this plan, `.Text` carried no class-level `textOverflow` rule, so a removed `#id` declaration fell through to the CSS-initial `"clip"` — the value `clearLineClamp` intended. After this plan, `.Text`'s class rule carries a non-null `textOverflow: "ellipsis"`, so the same removal now falls through to that instead — a real, previously-latent regression this plan introduced, confirmed empirically (`new Text(..., { truncate: false })`, `setLineClamp(3)`, `clearLineClamp()` resolved to `"ellipsis"`, not `"clip"`). Fixed with the same substitution the other two sites use: `this.getTextOverflow() ?? "clip"` instead of a bare `null`. Currently latent in shipped code (`Notification.ts` calls `setLineClamp` but never `clearLineClamp`), but `clearLineClamp` is a public `Text` method reachable by any future consumer, and is now covered by a dedicated regression test in `TextClassStyleHoisting.test.ts`, verified to fail against the pre-fix code.
