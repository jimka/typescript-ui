# Migrate Direct `rule.style.*` Writes To The `StyleRule` Buffer — Implementation Plan

## Overview

[ARCHITECTURE.md](../ARCHITECTURE.md) now forbids direct writes to `CSSStyleRule.style` (`rule.style.X = …`, `rule.style.setProperty(…)`, `rule.style.removeProperty(…)`, `rule.style.cssText = …`). The single allowed seam is the `StyleRule` deferred-write buffer in [core/StyleTarget.ts:128](../src/typescript/lib/core/StyleTarget.ts#L128). [SortPriorityBadge.ts](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts) and [ResizeHandle.ts](../src/typescript/lib/component/table/cell/ResizeHandle.ts) already follow the canonical pattern; the rest of the codebase has not been migrated.

`grep -rn 'rule\.style\.' src/typescript` currently returns hits across the files below. They cluster in four call-site shapes:

1. **Module-level shared class rules** — IIFE / `ensureXClassRule()` that writes static styling to a `.X` rule once at module load. Files: [Header.ts:51-57](../src/typescript/lib/component/table/cell/Header.ts#L51-L57), [TimeField.ts:60-65](../src/typescript/lib/component/input/TimeField.ts#L60-L65), [DateField.ts:50-55](../src/typescript/lib/component/input/DateField.ts#L50-L55), [DateTimeField.ts:60-65](../src/typescript/lib/component/input/DateTimeField.ts#L60-L65), [AccordionHeader.ts:44-62](../src/typescript/lib/component/container/AccordionHeader.ts#L44-L62) (different local name — `baseRule` / `expandedRule`).
2. **Module-level keyframe-class rules with `cssText` payloads** — `CSS.createClassRule(...)` followed by `rule.style.cssText = "animation: …"`. Files: [Glyph.ts:74-90](../src/typescript/lib/component/display/Glyph.ts#L74-L90) (`spinRule`, `pulseRule`, `beatRule`). ARCHITECTURE.md forbids `cssText` writes alongside `setProperty` — same `StyleRule.set` destination, just split the parsed `animation` declaration into a single `set("animation", "…")` per rule.
3. **Per-component `applyStyle` overrides** that materialise the rule and append additional declarations after `super.applyStyle()`. Files: [Input.ts:130-138](../src/typescript/lib/component/input/Input.ts#L130-L138), [TextInput.ts:388-395](../src/typescript/lib/component/input/TextInput.ts#L388-L395).
4. **The framework's own render-time flush** — [Component.applyStyle](../src/typescript/lib/core/Component.ts#L2613-L2759) materialises the per-component rule via `ensureCSSRule()` and writes ~25 properties directly. The matching `Border` / `BorderLine.applyOnCSSRule` cascade ([Border.ts:128-132](../src/typescript/lib/primitive/Border.ts#L128-L132), [BorderLine.ts:112-124](../src/typescript/lib/primitive/BorderLine.ts#L112-L124)) takes a raw `CSSStyleRule` and writes onto it the same way; it is called from `Component.applyStyle` and from Button's pressed/hover state rules ([Button.ts:433](../src/typescript/lib/component/button/Button.ts#L433), [Button.ts:631](../src/typescript/lib/component/button/Button.ts#L631)).

This plan migrates every site through `StyleRule.set` / `setMany`, retires the `applyOnCSSRule` path on `Border` / `BorderLine`, and locks the rule in with two grep checkpoints — the original (`grep -rn 'rule\.style\.' src/typescript → 0`) plus a broader sweep that catches local rule names that don't contain "rule" (`grep -rnE 'CSSStyleRule|CSS\.createClassRule|CSS\.createRule' src/typescript | xargs -I{} echo {}` followed by an audit of each match — see step 12).

---

## Architecture Decisions

### One pattern across all three call-site shapes

The shape that has worked twice already ([SortPriorityBadge.ts:27-43](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L27-L43), [ResizeHandle.ts:19-43](../src/typescript/lib/component/table/cell/ResizeHandle.ts#L19-L43)) is:

```typescript
const rule = new StyleRule(() =>
    (CSS.getClassRule(name) ?? CSS.createClassRule(name)) as CSSStyleRule);
rule.setMany({ /* camelCase keys */ });
rule.ensure();
```

Every module-level class-rule registration in this plan converges on it. No new helper, no factory — the inline pattern is short enough to stay at each call site, and ad-hoc helpers obscure the seam this plan is trying to expose.

### Drop the `applyStyle` overrides in `Input` / `TextInput`

Both subclasses today override `applyStyle` only to append two-or-three property writes after `super.applyStyle(...)`. That route exists because — historically — there was no queue-it-once-at-construction path. There is now: [Component.setElementCSSRules](../src/typescript/lib/core/Component.ts#L620) queues into `_styleRule`, and [Component.applyStyle](../src/typescript/lib/core/Component.ts#L2620) calls `ensureCSSRule()` → `_styleRule.ensure()`, which materialises **and flushes the dirty bag** before the framework's own writes land. So a constructor-time `setElementCSSRules({ fontFamily: …, fontSize: … })` lands on the rule in the same render tick the override used to fire.

For `Input.ts`: move both writes into the constructor as `setElementCSSRules({ fontFamily: …, fontSize: … })`. Delete the `applyStyle` override entirely.

For `TextInput.ts`: the value is per-instance (`this._options.textAlign`), so add a proper typed setter (`setTextAlign` / `clearTextAlign`) — the standard three-non-negotiables (typed setter + backing field + options field). The override goes away; `setTextAlign` is dispatched from `applyOptions(options)` like every other Component setter.

### Use `StyleRule.set` inside `Component.applyStyle`, not direct property writes

`applyStyle` already calls `this._styleRule.ensure()` (via `ensureCSSRule`) on line 2620, which materialises the rule. After `ensure()`, `StyleRule.set(key, value)` writes through directly (no queue). So each `rule.style.X = …` line converts mechanically:

```typescript
// Before:
rule.style.boxSizing = this._boxSizing;
// After:
this._styleRule.set("boxSizing", this._boxSizing);

// Before:
rule.style.setProperty('color', opts.foregroundColor);
// After:
this._styleRule.set("color", opts.foregroundColor);

// Before:
rule.style.removeProperty("border");
// After:
this._styleRule.set("border", null);
```

The `removeProperty` form maps to `set(key, null)`; `StyleTarget.write` already handles the null-to-`""` conversion ([StyleTarget.ts:102-106](../src/typescript/lib/core/StyleTarget.ts#L102-L106)). No new API on `StyleTarget` is needed.

The local `const rule = this.ensureCSSRule();` binding (line 2620) becomes dead after this migration — drop it.

### Retire `Border.applyOnCSSRule` / `BorderLine.applyOnCSSRule`

`BorderLine.applyOnCSSRule` writes via `rule.style.removeProperty` / `rule.style.setProperty`, which is exactly what this plan is migrating away from. The Style-map path (`toStyle()`) already exists alongside it, and the JSDoc remark at [BorderLine.ts:126-130](../src/typescript/lib/primitive/BorderLine.ts#L126-L130) already nominates it as the way "callers can batch the writes through `Component.setElementCSSRules` rather than mutating a live `CSSStyleRule`."

Three callers need migration:
- [Component.ts:2707](../src/typescript/lib/core/Component.ts#L2707) `this._border.applyOnCSSRule(rule)` → `this._styleRule.setMany(this._border.toStyle())`.
- [Button.ts:433](../src/typescript/lib/component/button/Button.ts#L433) `this._pressedBorder.applyOnCSSRule(this.pressedStyleRule.ensure())` → `this.pressedStyleRule.setMany(this._pressedBorder.toStyle())`.
- [Button.ts:631](../src/typescript/lib/component/button/Button.ts#L631) same shape for `hoverStyleRule` / `_hoverBorder`.

After the three callers move, delete `Border.applyOnCSSRule` and `BorderLine.applyOnCSSRule` outright. `Border.toStyle()` already exists (it's the path used at [Component.ts:1092](../src/typescript/lib/core/Component.ts#L1092) and elsewhere); no new method is needed.

### Element-`style` writes stay out of scope

[Component.applyStyle](../src/typescript/lib/core/Component.ts#L2613-L2759) also writes to `element.style.X` directly at seven lines (width/top/left/height/pointerEvents/zIndex/transition). ARCHITECTURE.md forbids those too — but the canonical seam for those writes is `InlineStyle`, not `StyleRule`, and `Component._inlineStyle` isn't attached to the element inside `applyStyle` (it materialises in `init()`). That migration deserves its own design pass on the materialisation ordering. Defer to a sibling plan; this plan's grep checkpoint is `rule.style.`, not `element.style.`.

### Leave the three `PickerButton` IIFEs duplicated

[TimeField.ts](../src/typescript/lib/component/input/TimeField.ts), [DateField.ts](../src/typescript/lib/component/input/DateField.ts), and [DateTimeField.ts](../src/typescript/lib/component/input/DateTimeField.ts) each register an identical `.PickerButton` class rule. The comments at each site explicitly note that two of the three registrations will see `CSS.createClassRule` return `null` (cached rule), and that this is intentional and safe. Deduplicating into a shared helper module is a separate concern; this plan only swaps the registration mechanism in each of the three files, preserving the existing structure. Each file converts independently to the `StyleRule` pattern. Flagging this so the implementer doesn't widen scope.

---

## Public API (TypeScript Signatures)

### `TextInput` — new typed setter

```typescript
// src/typescript/lib/component/input/TextInput.ts

export interface TextInputOptions extends InputOptions {
    textAlign?: string | null;   // already present
}

class _TextInput extends Input<TextInputOptions> {
    // New private field:
    declare private _textAlign: string | null;

    setTextAlign(value: string | null): this;
    getTextAlign(): string | null;
    clearTextAlign(): this;
}
```

`setTextAlign` routes through `setElementCSSRule("textAlign", value)`. `clearTextAlign` calls `setTextAlign(null)`. `applyOptions(options)` forwards `options.textAlign` to `setTextAlign` when defined.

The existing `textAlign` field on `TextInputOptions` is already typed; no interface change needed beyond accepting `null` as a clear value (was implicitly `string` before).

### `Border` / `BorderLine` — `applyOnCSSRule` removed

```typescript
// src/typescript/lib/primitive/Border.ts
// REMOVED:
applyOnCSSRule(rule: CSSStyleRule): void;

// src/typescript/lib/primitive/BorderLine.ts
// REMOVED:
applyOnCSSRule(rule: CSSStyleRule): void;
```

`toStyle()` remains the public surface; callers batch through `StyleRule.setMany`.

No other public-API changes. `Input.ts`'s `applyStyle` override removal is internal — the public class shape is unchanged.

---

## Internal Structure

### Canonical migration of a module-level class rule

The four module-level rules (`HeaderCellGlyph`, `PickerButton` ×3) all follow this template:

```typescript
// Before (Header.ts:44-58):
let _glyphClassRuleInjected = false;

function ensureHeaderCellGlyphClassRule(): void {
    if (_glyphClassRuleInjected) {
        return;
    }
    _glyphClassRuleInjected = true;
    const rule = CSS.createClassRule("HeaderCellGlyph");
    if (rule) {
        rule.style.setProperty("position", "absolute");
        rule.style.setProperty("left",     "var(--ts-ui-table-header-glyph-gap, 4px)");
        rule.style.setProperty("top",      "50%");
    }
}

// After:
let _glyphClassRule: StyleRule | null = null;

function ensureHeaderCellGlyphClassRule(): void {
    if (_glyphClassRule) {
        return;
    }
    const rule = new StyleRule(() =>
        (CSS.getClassRule("HeaderCellGlyph")
            ?? CSS.createClassRule("HeaderCellGlyph")) as CSSStyleRule);
    rule.setMany({
        position: "absolute",
        left:     "var(--ts-ui-table-header-glyph-gap, 4px)",
        top:      "50%",
    });
    rule.ensure();
    _glyphClassRule = rule;
}
```

The three `PickerButton` IIFEs collapse to:

```typescript
(() => {
    const rule = new StyleRule(() =>
        (CSS.getClassRule("PickerButton")
            ?? CSS.createClassRule("PickerButton")) as CSSStyleRule);
    rule.set("alignItems", "center");
    rule.ensure();
})();
```

### Canonical migration of `Component.applyStyle`'s flush

The 25 direct rule writes inside `applyStyle` ([Component.ts:2628-2749](../src/typescript/lib/core/Component.ts#L2628-L2749)) all convert to `this._styleRule.set(camelCaseKey, value)`. The local `const rule = this.ensureCSSRule();` binding (currently line 2620) becomes unused after migration — `ensureCSSRule` is still called for its side-effect (materialise the buffer so subsequent `set` calls write through), but the returned `CSSStyleRule` is not referenced. Replace the binding with a bare statement:

```typescript
// Before (line 2620):
const rule = this.ensureCSSRule();
// ...
if (this._boxSizing) {
    rule.style.boxSizing = this._boxSizing;
}

// After:
this.ensureCSSRule();           // materialise the buffer
// ...
if (this._boxSizing) {
    this._styleRule.set("boxSizing", this._boxSizing);
}
```

The kebab-cased `setProperty` calls (`'color'`, `'background-color'`, `'background-image'`, `'border'`, `'box-shadow'`) convert to camelCase keys (`color`, `backgroundColor`, `backgroundImage`, `border`, `boxShadow`) because `StyleTarget.write` writes via bracket-indexed property assignment, which only accepts camelCase on `CSSStyleDeclaration`.

### Border-cascade migration

```typescript
// Component.ts:2704-2710 — before:
if (this._borderCSS) {
    rule.style.setProperty('border', this._borderCSS);
} else if (this._border) {
    this._border.applyOnCSSRule(rule);
} else {
    rule.style.removeProperty("border");
}

// After:
if (this._borderCSS) {
    this._styleRule.set("border", this._borderCSS);
} else if (this._border) {
    this._styleRule.setMany(this._border.toStyle());
} else {
    this._styleRule.set("border", null);
}
```

For Button's state rules ([Button.ts:433](../src/typescript/lib/component/button/Button.ts#L433), [Button.ts:631](../src/typescript/lib/component/button/Button.ts#L631)):

```typescript
// Before:
this._pressedBorder.applyOnCSSRule(this.pressedStyleRule.ensure());

// After:
this.pressedStyleRule.setMany(this._pressedBorder.toStyle());
```

Same shape for `hoverStyleRule` / `_hoverBorder`.

---

## Ordered Implementation Steps

Each step ends with a grep checkpoint targeting just the file(s) it touched, so regressions surface immediately. The cumulative grep (`rule\.style\.` → 0 across `src/typescript`) is the final gate.

1. **Header.ts** — convert `ensureHeaderCellGlyphClassRule` to the `StyleRule` pattern. Replace the `_glyphClassRuleInjected` boolean with `_glyphClassRule: StyleRule | null`. **Verify:** `grep -n 'rule\.style\.' src/typescript/lib/component/table/cell/Header.ts` → 0.

2. **TimeField.ts / DateField.ts / DateTimeField.ts** — convert each `(() => { ... CSS.createClassRule("PickerButton") ... })()` IIFE to the `StyleRule` shape with `set("alignItems", "center")` + `ensure()`. All three files use identical bodies; copy verbatim. **Verify:** `grep -n 'rule\.style\.' src/typescript/lib/component/input/TimeField.ts src/typescript/lib/component/input/DateField.ts src/typescript/lib/component/input/DateTimeField.ts` → 0.

2a. **AccordionHeader.ts** — convert the static `createStyles()` helper to the `StyleRule` shape. The `.ts-accordion-indicator` rule (9 properties) becomes a `setMany({...})` call; the `.ts-accordion-indicator.expanded` rule (1 property) becomes a single `set("transform", "translateY(-50%) rotate(90deg)")`. Both materialise via `new StyleRule(() => CSS.getRule(selector) ?? CSS.createRule(selector)!)` — note the `.X.Y` selector needs `CSS.createRule`, not `CSS.createClassRule` (which only accepts a bare class name). Convert kebab keys (`pointer-events`, `font-size`, `line-height`) to camelCase (`pointerEvents`, `fontSize`, `lineHeight`). **Verify:** `grep -n 'rule\.style\.' src/typescript/lib/component/container/AccordionHeader.ts` → 0.

2b. **Glyph.ts** — convert the three keyframe-class rules (`spinRule`, `pulseRule`, `beatRule` at [Glyph.ts:74-90](../src/typescript/lib/component/display/Glyph.ts#L74-L90)) from `rule.style.cssText = "animation: …"` to the `StyleRule` shape with `set("animation", "…")`. Each rule holds a single `animation` shorthand declaration today; splitting `cssText` into a single typed `set` is mechanical (the value is the right-hand side after `animation:`, minus the trailing semicolon). **Verify:** `grep -n 'rule\.style\.' src/typescript/lib/component/display/Glyph.ts` → 0.

2c. **DateTimePickerDropdown.ts** — the module-level IIFE at [lines 22-79](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L22-L79) registers eight class rules (`DateTimePickerRoot`, `DateTimePickerGrid`, `DateTimePickerMonthLabel`, `DateTimePickerDayHeader`, `DateTimePickerDay`, `.DateTimePickerDay:hover` via `CSS.createRule`, `DateTimePickerTimeRow`, `DateTimePickerTimeLabel`) using `<rule>.style.setProperty("kebab-key", "value")` shapes — same forbidden write pattern, just local names that don't match the `rule\.style\.` grep. Convert each block to the `StyleRule` factory pattern (`new StyleRule(() => CSS.getClassRule(name) ?? CSS.createClassRule(name)!)` for class rules; `new StyleRule(() => CSS.getRule(selector) ?? CSS.createRule(selector)!)` for the `:hover` selector) and replace `setProperty` calls with `setMany({...})` using camelCase keys (`textAlign`, `fontSize`, `fontWeight`, `gridColumn`, `gridTemplateColumns`, `borderRadius`, `backgroundColor`, `alignItems`). **Verify:** `grep -nE '\.style\.setProperty|\.style\.removeProperty|\.style\.cssText' src/typescript/lib/component/input/DateTimePickerDropdown.ts` → 0.

2d. **ComboBox.ts** — same module-level pattern at [lines 198-220+](../src/typescript/lib/component/input/ComboBox.ts#L198) for `ComboBox`, `ComboBoxLabel`, `ComboBoxCaret`, `ComboBoxRow` class rules (and any further class rules in the IIFE block). Each `CSS.createClassRule(name)` followed by `.style.setProperty(...)` becomes the `StyleRule` factory + `setMany` pattern. CamelCase keys (`alignItems`, `userSelect`, `whiteSpace`, `textOverflow`). **Verify:** `grep -nE '\.style\.setProperty|\.style\.removeProperty|\.style\.cssText' src/typescript/lib/component/input/ComboBox.ts` → 0.

3. **Input.ts** — delete the `applyStyle` override at [Input.ts:130-138](../src/typescript/lib/component/input/Input.ts#L130-L138). In the constructor (after `super(...)`), add `this.setElementCSSRules({ fontFamily: "var(--ts-ui-font-family, sans-serif)", fontSize: "var(--ts-ui-font-size, 12px)" })`. **Verify:** `grep -n 'rule\.style\.' src/typescript/lib/component/input/Input.ts` → 0; `grep -n 'applyStyle' src/typescript/lib/component/input/Input.ts` → 0.

4. **TextInput.ts** — add private `declare _textAlign: string | null` field, typed `setTextAlign(value: string | null): this`, `clearTextAlign(): this`, `getTextAlign(): string | null`. Dispatch from `applyOptions(options)` when `options.textAlign !== undefined`. Delete the `applyStyle` override at [TextInput.ts:388-395](../src/typescript/lib/component/input/TextInput.ts#L388-L395). **Verify:** `grep -n 'rule\.style\.' src/typescript/lib/component/input/TextInput.ts` → 0; a `setTextAlign("right")` call updates the rendered cell on the slow-table demo.

5. **BorderLine.ts / Border.ts** — delete `applyOnCSSRule` on both classes. **Verify:** `grep -rn 'applyOnCSSRule' src/typescript` → 0 after step 6 lands; until then the method still has callers and removing it now would break the build. **So defer the deletion until step 6 completes** — keep the methods in place during steps 4-5, delete in step 6.

6. **Component.ts and Button.ts callers of `applyOnCSSRule`** — migrate the three callers:
   - [Component.ts:2707](../src/typescript/lib/core/Component.ts#L2707) `this._border.applyOnCSSRule(rule)` → `this._styleRule.setMany(this._border.toStyle())`.
   - [Button.ts:433](../src/typescript/lib/component/button/Button.ts#L433) → `this.pressedStyleRule.setMany(this._pressedBorder.toStyle())`.
   - [Button.ts:631](../src/typescript/lib/component/button/Button.ts#L631) → `this.hoverStyleRule.setMany(this._hoverBorder.toStyle())`.

   Then delete `Border.applyOnCSSRule` and `BorderLine.applyOnCSSRule`.

   **Verify:** `grep -rn 'applyOnCSSRule' src/typescript` → 0; `npx tsc --noEmit` → 0 errors.

7. **Component.ts `applyStyle` flush** — mechanically convert each `rule.style.X = …` and `rule.style.setProperty(…)` / `rule.style.removeProperty(…)` to `this._styleRule.set(camelCaseKey, value)` or `this._styleRule.set(key, null)`. Drop the now-unused `const rule = this.ensureCSSRule()` binding; keep `this.ensureCSSRule()` as a statement (the side effect of materialising the buffer is still required). **Verify:** `grep -n 'rule\.style\.' src/typescript/lib/core/Component.ts` → 0.

8. **Final grep gate** — `grep -rn 'rule\.style\.' src/typescript` → **0 matches**. Any non-zero output is a blocker for declaring step 7 done.

9. **Typecheck** — `npx tsc --noEmit` → 0 errors.

10. **Smoke verification** — open `http://localhost:8015`, navigate to the `MiscPanel` slow table; confirm:
    - Headers paint the glyph in the left-aligned position (HeaderCellGlyph rule).
    - Right-edge drag still resizes columns (ResizeHandle untouched, but worth a re-check after Component.ts change).
    - Multi-sort badges still appear with correct priorities (SortPriorityBadge untouched, same caveat).
    - Toolbar's `TimeField` / `DateField` / `DateTimeField` picker buttons centre their glyph vertically (PickerButton rule).
    - `TextInput` cells with `textAlign: "right"` align right.
    - All borders render correctly (the `Component.applyStyle` border cascade is the biggest behavioural risk).
    - Buttons show pressed-state and hover-state border changes (Button's state-rule path).

    Theme-toggle to dark mode; everything still renders.

11. **`graphify update .`** — refresh the graph; commit `graphify-out/**` as its own commit per the implement skill's three-commit structure.

---

## Files to Create / Modify / Delete

| Action | File                                                                                            |
|--------|-------------------------------------------------------------------------------------------------|
| Modify | `src/typescript/lib/component/table/cell/Header.ts`                                             |
| Modify | `src/typescript/lib/component/input/TimeField.ts`                                               |
| Modify | `src/typescript/lib/component/input/DateField.ts`                                               |
| Modify | `src/typescript/lib/component/input/DateTimeField.ts`                                           |
| Modify | `src/typescript/lib/component/container/AccordionHeader.ts`                                     |
| Modify | `src/typescript/lib/component/display/Glyph.ts`                                                 |
| Modify | `src/typescript/lib/component/input/DateTimePickerDropdown.ts`                                  |
| Modify | `src/typescript/lib/component/input/ComboBox.ts`                                                |
| Modify | `src/typescript/lib/component/input/Input.ts`                                                   |
| Modify | `src/typescript/lib/component/input/TextInput.ts`                                               |
| Modify | `src/typescript/lib/primitive/BorderLine.ts` — delete `applyOnCSSRule`                          |
| Modify | `src/typescript/lib/primitive/Border.ts` — delete `applyOnCSSRule`                              |
| Modify | `src/typescript/lib/component/button/Button.ts` — migrate the two `applyOnCSSRule` call sites   |
| Modify | `src/typescript/lib/core/Component.ts` — migrate `applyStyle` flush + border cascade            |

No files created, no files deleted. No new theme tokens. No new public components.

---

## Verification

- `grep -rn 'rule\.style\.' src/typescript` → **0 matches**.
- `grep -rn 'applyOnCSSRule' src/typescript` → **0 matches**.
- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- Manual smoke per step 10 in light and dark themes.
- `graphify update .` succeeds; `StyleRule` node's connectivity grows; `applyOnCSSRule` nodes disappear from `graphify-out/GRAPH_REPORT.md`.

---

## Documentation Impact

`Border.applyOnCSSRule` and `BorderLine.applyOnCSSRule` are public (export form `applyOnCSSRule(rule: CSSStyleRule): void` is a documented method). Their removal is a breaking API change for anyone subclassing `Border` or holding a `BorderLine` instance.

- Search for cross-bucket JSDoc references: `grep -rln '\bapplyOnCSSRule\b' docs/` (expect 0 hits after the implementation lands, since typedoc regenerates from source).
- The curated `docs/primitive/` catalog page for `Border` does not currently mention `applyOnCSSRule` by name; spot-check after `npm run docs:build` that the regenerated API page no longer lists it.
- No new exports — no per-subpath barrel changes required.
- `TextInput.setTextAlign` is a new public method; typedoc picks it up automatically. The curated `docs/component/input/TextInput.md` page (if one exists) should mention it; verify by skimming after `docs:build`.

---

## Potential Challenges

- **`Border.toStyle()` key casing.** [BorderLine.toStyle](../src/typescript/lib/primitive/BorderLine.ts#L133-L141) returns kebab-case keys (`"border-top-width"`). `StyleTarget.write` uses bracket-indexed property assignment ([StyleTarget.ts:104-106](../src/typescript/lib/core/StyleTarget.ts#L104-L106)), which only honours camelCase on `CSSStyleDeclaration`. The Border-cascade migration may need `toStyle` to return camelCase (`borderTopWidth`) instead. The existing call site at [Component.ts:1092](../src/typescript/lib/core/Component.ts#L1092) (`this.setElementCSSRules(this._border.toStyle())`) already uses kebab keys today — confirm by inspection whether that path currently works, and if it does **not**, switch `toStyle()` to camelCase as part of step 5. Mitigation: run a manual smoke check on a Component with a non-default `border` set; if the border disappears after the migration, the casing is the cause.

- **`applyStyle` order-sensitivity.** The framework's `applyStyle` runs *during render*, after `_styleRule.ensure()`. Constructor-time `setElementCSSRules` (used in step 3 for `Input.ts`) queues into the dirty bag; that bag flushes inside `ensure()`. The order: dirty bag flush → `applyStyle`'s subsequent writes. If `Input.ts`'s font defaults need to take precedence over base Component writes (they shouldn't — Component doesn't write `fontFamily`/`fontSize`), the queue-then-flush order is fine. Verify by inspecting `applyStyle`'s write list (no font-family / font-size today).

- **`TextInput.setTextAlign`'s `applyOptions` dispatch.** The current override reads `this._options.textAlign` directly. After migration, `applyOptions` should call `setTextAlign(options.textAlign)` when defined, and `setTextAlign` writes to `_textAlign` and `setElementCSSRule("textAlign", value)`. The existing `this._options.textAlign` reads elsewhere in `TextInput.ts` continue to work because `_options` is the options bag, but verify no other site assumes `_options.textAlign` is the single source of truth — `_textAlign` becomes authoritative.

- **The `setElementCSSRule` key for `'background-image'` vs `backgroundImage`.** The current code mixes both styles in `applyStyle` (kebab via `setProperty`, camel via assignment). The migration unifies on camelCase. The Component setters (`setBackgroundImage`, `setForegroundColor`, etc.) already pass camelCase to `setElementCSSRule`; the buffer's dirty bag is therefore camelCase-keyed today. Switching `applyStyle`'s direct-write kebab strings to camelCase aligns with the established convention.

- **Hot-reload semantics for the four module-level rules.** The new pattern uses `CSS.getClassRule(name) ?? CSS.createClassRule(name)` inside the factory, so on hot-reload (when the module re-runs but the document survives), the factory picks up the existing rule and re-flushes the dirty bag onto it. This is a strictly better outcome than the current boolean-guarded `if (rule) { … }` shape, which silently no-ops when `createClassRule` returns `null`. No mitigation needed; flag because the behavioural improvement is intentional.

- **`Component.applyStyle` materialisation contract.** After step 7, `this.ensureCSSRule()` is called for its side effect only (materialise the buffer so subsequent `_styleRule.set(...)` calls write through immediately). An implementer might be tempted to remove the call entirely; that would break the flush, because `set()` queues into the dirty bag until materialisation. Comment the call as `// materialise the buffer; subsequent .set() writes go through directly` so future readers don't strip it.

---

## Critical Files

- [src/typescript/lib/core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — `StyleRule`, `InlineStyle`, `StyleTarget` API. Read `set` / `setMany` / `ensure` / `materialize` / `write` before editing.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `_styleRule` declaration (line 204), `setElementCSSRule(s)` (lines 620, 641), `ensureCSSRule` (line 391), and the full `applyStyle` body (lines 2613-2759).
- [src/typescript/lib/core/CSS.ts](../src/typescript/lib/core/CSS.ts) — `getClassRule` / `createClassRule` caching behaviour; the factory pattern depends on the get-or-create handshake.
- [src/typescript/lib/component/table/cell/SortPriorityBadge.ts](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts) and [ResizeHandle.ts](../src/typescript/lib/component/table/cell/ResizeHandle.ts) — the canonical pattern, already in tree.
- [ARCHITECTURE.md](../ARCHITECTURE.md), section "CSS writes go through `StyleRule` / `InlineStyle`" — the binding rule this plan implements.
- [src/typescript/lib/primitive/Border.ts](../src/typescript/lib/primitive/Border.ts) and [BorderLine.ts](../src/typescript/lib/primitive/BorderLine.ts) — `toStyle()` (kept) and `applyOnCSSRule()` (retired).
- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — two state-rule callers of `applyOnCSSRule` at lines 433 and 631.

---

## Non-Goals

- **`element.style.X` writes inside `Component.applyStyle`.** Seven sites (width/top/left/height/pointerEvents/zIndex/transition) violate the same architectural rule but route through `InlineStyle`, not `StyleRule`. The materialisation timing for `_inlineStyle` inside `applyStyle` (which runs before `init()` attaches the buffer) is a separate design problem. Sibling plan.
- **Deduplicating the three `PickerButton` IIFEs.** The duplication exists because three sibling files all declare an internal `PickerButton`; extracting to a shared module is a small refactor but unrelated to the `StyleRule` migration. Keep scope tight.
- **Migrating the cell-renderer / cell-editor `style.cssText` writes** if any exist below `cell/` — `grep -rn 'rule\.style\.' src/typescript` is the authoritative scope, and currently returns the 37 sites listed above. No others.
- **Refactoring `applyStyle`'s overall shape.** The `removeAttribute("style") + full-redraw-from-options` flow is intentional and stays. This plan only swaps the seam each individual write passes through.
- **Adding a typed `setFontFamily` / `setFontSize` setter on `Component`.** `Input.ts`'s constructor-time `setElementCSSRules({ fontFamily, fontSize })` is enough for this single subclass. Promoting to first-class setters is a separate feature decision.
- **Touching `SortPriorityBadge.ts` or `ResizeHandle.ts`.** Both already use the canonical pattern. The plan's grep checkpoint already passes for those two files.
