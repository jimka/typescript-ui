---
touches-shared:
  - src/typescript/lib/core/Theme.ts
  - src/typescript/lib/core/Component.ts
---

# Border Model Consolidation — Implementation Plan

## Overview

The framework currently models borders with a three-type primitive: the `Border` class, the per-side `BorderLine` class, and the `BorderOptions` / `BorderSideOptions` option bags ([primitive/Border.ts](../src/typescript/lib/primitive/Border.ts), [primitive/BorderLine.ts](../src/typescript/lib/primitive/BorderLine.ts)). These decompose every border into width/style/color triplets, which forces consumers to translate CSS strings (the thing they actually have, almost always a `var(...)` token) into and out of the triplet form. `Component.setBorder` already has a `var(...)`-string branch and a `fromString` parser bolted on to bridge the gap, and `Button`/`ToggleButton` grew temporary `string` overloads — evidence the triplet model is fighting its consumers.

This plan replaces all of that with **one** string-based interface holding five optional full-CSS-border-string fields (`border` plus `borderTop`/`borderRight`/`borderBottom`/`borderLeft`), deletes `Border` and `BorderLine`, and migrates every consumer. The single cached field becomes the source that [`Component.applyStyle`](../src/typescript/lib/core/Component.ts#L2939) replays at render (expanded to four longhands), fixing the bug where per-side borders written outside the replay path get clobbered. The end goal lands on branch `feature/modern-tab-button-states`, where it enables per-side tab-button theme tokens so the Modern theme can paint left/right-only tab borders.

`Border`/`BorderOptions`/`BorderSideOptions`/`BorderLine` are exported from the `primitive` subpath barrel ([primitive/index.ts](../src/typescript/lib/primitive/index.ts)), so this is a public-API change touching the barrel and docs.

---

## Architecture Decisions

### Keep the name `BorderOptions`, drop `Border` / `BorderLine` / `BorderSideOptions`

The single canonical type stays named **`BorderOptions`** (an `interface`, not a class). Rationale: it is the type already referenced by `ComponentOptions.border`, `ButtonOptions.hoverBorder`/`pressedBorder`, and every option bag — keeping the name minimises the option-field churn and matches the project's `XOptions` naming convention. The decided design has *no per-instance behaviour beyond conversion*, so a class would be ceremony; free helper functions operate on the plain interface. The class `Border` and `BorderLine` are deleted outright (no alias kept — this is a breaking primitive change and the barrel is the only export surface). `BorderSideOptions` is deleted; per-side config is now just another string field on `BorderOptions`.

There is a naming collision to be aware of but not resolve here: `layout/Border.ts` also exports an unrelated `BorderOptions` (the Border *layout manager*'s options). They live in different subpath barrels (`primitive` vs `layout`) and never co-import, so no rename is needed; the plan only touches the `primitive` one.

### Fully expand to four longhands in the to-CSS helper

The conversion helper emits `{ borderTop, borderRight, borderBottom, borderLeft }` (camelCase longhand keys, the form `StyleRule.setMany` consumes — verified at [StyleTarget.ts:43](../src/typescript/lib/core/StyleTarget.ts#L43)), **not** the `border` shorthand plus overrides. Two reasons: (1) the shorthand `border` resets the longhands in the CSS cascade, so emitting both risks order-dependent clobbering; (2) `applyStyle` replays by calling `setMany` with these four keys, and a pure-longhand map replays deterministically regardless of what else touched the rule. Each side resolves via the precedence rule `side ?? border ?? "none"`.

### Helpers live in `primitive/Border.ts` as free functions

`Border.ts` is rewritten to export the `BorderOptions` interface plus two free functions:
- `borderToStyle(border: BorderOptions): Record<string, string | null>` — the to-CSS expander above.
- `borderSideWidth(value: string | undefined): number` — px-parser: parse a leading `<n>px` (integer or decimal) from a value; return `0` for `undefined`, `none`, `0`, `var(...)`, or any non-`px` leading token. Used in two places: parsing the always-`<n>px` values that `getComputedStyle` returns (authoritative, post-render), and a best-effort estimate from the spec strings before an element exists (pre-render).

Keeping them in `primitive/Border.ts` means the barrel export line barely changes and `BorderStyle` (the enum, still used elsewhere) is untouched.

### Layout border widths are browser-measured, deferred, and cached

Layout needs the *numeric* per-side width for content-box insets, but the spec values are opaque CSS strings that may be `var(...)`. Rather than statically parse them (which can't resolve a `var()`), **ask the browser after the values are applied** — exactly the pattern the framework already uses for text/baseline measurement. Once the element is rendered, `getComputedStyle(el).borderTopWidth` (etc.) returns the resolved *used* width in px with `var()`, `none`, and keywords all resolved. `Component.getBorderSize` reads those, parses them with `borderSideWidth`, and **caches** the result in a new `_borderWidths: PerimeterSize | null` field.

Cache lifecycle (mirrors the project's "setters defer DOM work" rule and the `Text`/`Button` `onThemeChange` recompute precedent):
- **Defer:** `setBorder` may run before render, so measurement happens lazily on the first `getBorderSize` call that finds an element — not at set time. Before any element exists, fall back to `borderSideWidth` over the spec strings (best-effort literal estimate; `var()` ⇒ 0 only in the pre-render window).
- **Invalidate** `_borderWidths` on `setBorder`/`clearBorder`, and on theme change — a theme can swap a border to a different width. Register a `ThemeManager.onThemeChange` invalidation listener **lazily, only when a border is first set**, so the listener count is bounded to bordered components (and torn down with the component). 
- **Perf:** never call `getComputedStyle` inside a hot layout loop unguarded — the cache makes the read once-per-(border-or-theme)-change, not once-per-layout. This matters for the MiscPanel slow-table stress test.

This supersedes the earlier idea of treating `var()` as `0` for layout: var widths are now measured correctly once rendered.

### `setBorder(options: BorderOptions | string)` — string is sugar for `{ border }`

`Component.setBorder` keeps accepting `BorderOptions | string`. A bare string is normalised to `{ border: <string> }` and stored in the single cached field. The current special `var(...)` branch — which writes the shorthand directly *and* eagerly calls `getComputedStyle` at set-time to resolve the var — is **removed**; set-time DOM reads are a layout-timing hazard and the element may not exist yet. The resolved width is instead obtained lazily at layout time per the browser-measurement decision above.

### One cached field `_border: BorderOptions | null`, replayed by `applyStyle`

`Component`'s two fields `_border: Border | null` and `_borderCSS: string | null` collapse into a single `_border: BorderOptions | null`. `applyStyle` replays it by `this._styleRule.setMany(borderToStyle(this._border))` when set, and `this._styleRule.set("border", null)` when null. This is the single source of truth the constraint requires.

### Button/ToggleButton per-state borders cache `BorderOptions` and gain a replay branch

`Button._hoverBorder` / `_pressedBorder` become `BorderOptions | null`. Today these are written straight into the lazy `hoverStyleRule`/`pressedStyleRule` and are **not** replayed by an `applyStyle` override — the style rules persist across renders so replay isn't structurally required, but writing them through `borderToStyle(...)` (four longhands) instead of the current shorthand keeps them consistent with the base border and lets a per-side hover border survive. `ToggleButton.setSelectedBorder` likewise routes through `borderToStyle` into `selectedStyleRule`. The temporary `setHoverBorder(string)` overload and `ToggleButton.setSelectedBorder(string)` are folded into the unified `BorderOptions | string` signature (string ⇒ `{ border }`).

### Per-side tab tokens: uniform token AS the fallback, plus per-side override tokens

The `Theme.tab.button` block keeps a uniform `border` string per state (normal/hover/selected) and **adds four optional per-side fields** (`borderTop`/`borderRight`/`borderBottom`/`borderLeft`). `buildTabEntry` builds each side's CSS with a nested-var fallback so the uniform token is the default and a per-side token overrides it:

```
border-top: var(--ts-ui-tab-button-border-top, var(--ts-ui-tab-button-border, none))
```

This keeps existing themes (which only set the uniform `border`) working unchanged while letting the Modern theme set left/right-only borders. Rejected "per-side only": it would force every theme to spell out four sides even for the common uniform case and break the existing uniform tokens that other code/themes may read.

---

## Public API (TypeScript Signatures)

### `primitive/Border.ts` (rewritten)

```typescript
/**
 * A border specification built from complete CSS border strings.
 * `border` is the all-sides fallback; each per-side field overrides it for
 * that side. An unspecified side falls back to `border`, then to `"none"`.
 *
 * @category Util
 */
export interface BorderOptions {
    /** CSS `border` shorthand applied to all four sides (e.g. `"1px solid rgb(...)"`, `"none"`, `"var(--x)"`). */
    border?: string;
    /** CSS `border-top` value; overrides `border` for the top side. */
    borderTop?: string;
    /** CSS `border-right` value; overrides `border` for the right side. */
    borderRight?: string;
    /** CSS `border-bottom` value; overrides `border` for the bottom side. */
    borderBottom?: string;
    /** CSS `border-left` value; overrides `border` for the left side. */
    borderLeft?: string;
}

/** Expands a {@link BorderOptions} into the four camelCase longhand style keys for `StyleRule.setMany`. */
export function borderToStyle(border: BorderOptions): Record<string, string | null>;

/** Best-effort leading-`<n>px` width of one side's CSS value; `0` for `none`/`var()`/non-px/empty. */
export function borderSideWidth(value: string | undefined): number;
```

### `core/Component.ts`

```typescript
// field: private _border: BorderOptions | null = null;        // replaces _border + _borderCSS
// field: private _borderWidths: PerimeterSize | null = null;   // cached browser-measured widths
getBorder(): BorderOptions | null;          // return type changes from Border | null
setBorder(options: BorderOptions | string): this;   // invalidates _borderWidths
clearBorder(): this;                                 // invalidates _borderWidths
getBorderSize(): PerimeterSize;             // browser-measured + cached (see Internal Structure)
// ComponentOptions.border?: BorderOptions | string;       // unchanged shape
```

### `component/button/Button.ts`

```typescript
// fields: _hoverBorder, _pressedBorder: BorderOptions | null
getHoverBorder():   BorderOptions | null;
getPressedBorder(): BorderOptions | null;
setHoverBorder(options?: BorderOptions | string): this;     // single signature; string ⇒ { border }
setPressedBorder(options?: BorderOptions | string): this;
// ButtonOptions.hoverBorder / pressedBorder?: BorderOptions | string;
```

### `component/button/ToggleButton.ts`

```typescript
setSelectedBorder(options: BorderOptions | string): this;   // string ⇒ { border }
```

---

## Theme Tokens

Per-side tab-button override tokens. The existing uniform tokens stay as fallbacks.

| CSS Custom Property | Default | Dark | Modern | Purpose |
|---|---|---|---|---|
| `--ts-ui-tab-button-border` | `none` | `none` | `none` | Uniform fallback, normal state |
| `--ts-ui-tab-button-border-left` | — | — | `1px solid rgb(214,217,222)` | Per-side override, normal |
| `--ts-ui-tab-button-border-right` | — | — | `1px solid rgb(214,217,222)` | Per-side override, normal |
| `--ts-ui-tab-button-hover-border` | `none` | `none` | `none` | Uniform fallback, hover |
| `--ts-ui-tab-button-hover-border-left` | — | — | `1px solid rgb(206,210,216)` | Per-side override, hover |
| `--ts-ui-tab-button-hover-border-right` | — | — | `1px solid rgb(206,210,216)` | Per-side override, hover |
| `--ts-ui-tab-button-selected-border` | `none` | `none` | `none` | Uniform fallback, selected |
| `--ts-ui-tab-button-selected-border-left` | — | — | `1px solid rgb(214,217,222)` | Per-side override, selected |
| `--ts-ui-tab-button-selected-border-right` | — | — | `1px solid rgb(214,217,222)` | Per-side override, selected |

Top/bottom are intentionally left to fall through to the uniform `none` (no `-top`/`-bottom` tokens needed). Default/Dark set no per-side fields, so they keep flat/gradient borderless tabs. Modern demonstrates left/right hairline with `none` top/bottom.

`Theme` block change (`tab.button` and its `.hover`/`.selected` sub-objects): add optional `borderLeft?`, `borderRight?`, `borderTop?`, `borderBottom?` alongside the existing `border: string`. Entries needed in: `Theme` interface ([Theme.ts:174](../src/typescript/lib/core/Theme.ts#L174)), `DefaultTheme`, `DarkTheme`, `ModernTheme`, and `themeToVars` ([Theme.ts:555](../src/typescript/lib/core/Theme.ts#L555)) — emit each per-side var only when the theme field is present (or always emit, with `undefined` omitted from the var map; match how `themeToVars` handles other optional fields).

---

## Internal Structure

`borderToStyle` precedence and expansion:

```typescript
export function borderToStyle(b: BorderOptions): Record<string, string | null> {
    const all = b.border ?? "none";
    return {
        borderTop:    b.borderTop    ?? all,
        borderRight:  b.borderRight  ?? all,
        borderBottom: b.borderBottom ?? all,
        borderLeft:   b.borderLeft   ?? all,
    };
}
```

`borderSideWidth`:

```typescript
export function borderSideWidth(value: string | undefined): number {
    if (!value) return 0;
    const m = value.trim().match(/^([\d.]+)px\b/i);
    return m ? parseFloat(m[1]) : 0;
}
```

`Component.getBorderSize` ([Component.ts:1800](../src/typescript/lib/core/Component.ts#L1800)) rewrite — browser-measure once rendered (resolves `var()`), cache, fall back to a literal estimate pre-render:

```typescript
getBorderSize(): PerimeterSize {
    if (!this._border) {
        return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    if (this._borderWidths) {
        return this._borderWidths;
    }

    const element = this.getElement();

    if (element) {
        // Authoritative: getComputedStyle resolves var()/none/keywords to "<n>px".
        const cs = getComputedStyle(element);

        this._borderWidths = {
            top:    borderSideWidth(cs.borderTopWidth),
            right:  borderSideWidth(cs.borderRightWidth),
            bottom: borderSideWidth(cs.borderBottomWidth),
            left:   borderSideWidth(cs.borderLeftWidth),
        };

        return this._borderWidths;
    }

    // Pre-render estimate from the spec strings (var() ⇒ 0 until rendered).
    const all = this._border.border;

    return {
        top:    borderSideWidth(this._border.borderTop    ?? all),
        right:  borderSideWidth(this._border.borderRight  ?? all),
        bottom: borderSideWidth(this._border.borderBottom ?? all),
        left:   borderSideWidth(this._border.borderLeft   ?? all),
    };
}
```

Invalidation: `setBorder`/`clearBorder` set `this._borderWidths = null`; a lazily-registered `ThemeManager.onThemeChange` handler (added on first `setBorder`, torn down on dispose) also nulls it so a theme-driven width change is re-measured on the next layout.

`buildTabEntry` per-side composition (replaces the three `setBorder`/`setHoverBorder`/`setSelectedBorder` calls):

```typescript
tabButton.setBorder({
    borderTop:    "var(--ts-ui-tab-button-border-top,    var(--ts-ui-tab-button-border, none))",
    borderRight:  "var(--ts-ui-tab-button-border-right,  var(--ts-ui-tab-button-border, none))",
    borderBottom: "var(--ts-ui-tab-button-border-bottom, var(--ts-ui-tab-button-border, none))",
    borderLeft:   "var(--ts-ui-tab-button-border-left,   var(--ts-ui-tab-button-border, none))",
});
// hover/selected: same shape with -hover- / -selected- token segments
```

---

## Ordered Implementation Steps

1. **Rewrite `primitive/Border.ts`** to the new `BorderOptions` interface + `borderToStyle` + `borderSideWidth` free functions. Delete the `Border` class, `BorderSideOptions`, and `BorderLine` references. → verify: file no longer imports `BorderLine` or `BorderStyle`.
2. **Delete `primitive/BorderLine.ts`.** → verify: `grep -rn 'BorderLine' src/` — expect zero matches.
3. **Update `primitive/index.ts`**: remove `Border`/`BorderLine` value exports and `BorderSideOptions` type export; keep `export type { BorderOptions }` and the `BorderStyle` export. Add `export { borderToStyle, borderSideWidth }` if any cross-module consumer needs them (Button/ToggleButton do — they import from `~/primitive/Border.js` directly, so the barrel only needs the type).
4. **`core/Component.ts`**: replace `_border`/`_borderCSS` fields with `_border: BorderOptions | null`; add `_borderWidths: PerimeterSize | null` cache. Rewrite `setBorder` (string ⇒ `{ border }`, object stored as-is, no `getComputedStyle`/`fromString`; null `_borderWidths`; lazily register a `ThemeManager.onThemeChange` handler that nulls `_borderWidths` on first border set), `clearBorder` (`_border = null`, null `_borderWidths`), `getBorder` (return `BorderOptions | null`); rewrite `getBorderSize` per Internal Structure (browser-measure + cache); rewrite the `applyStyle` replay block ([~2939](../src/typescript/lib/core/Component.ts#L2939)) to `setMany(borderToStyle(this._border))` / `set("border", null)`. Tear down the theme listener in the component's dispose/remove path. Update the `Border` import to the new helpers + type. → verify: typecheck.
5. **`component/button/Button.ts`**: change `_hoverBorder`/`_pressedBorder` to `BorderOptions | null`; collapse `setHoverBorder` overloads into one `BorderOptions | string` signature writing `borderToStyle(...)` via `setMany`; same for `setPressedBorder`; update `getHoverBorder`/`getPressedBorder` return types and the `_clearChrome` comments if they reference the old shorthand. Update option-bag forwarding ([362](../src/typescript/lib/component/button/Button.ts#L362)/[369](../src/typescript/lib/component/button/Button.ts#L369)/[603](../src/typescript/lib/component/button/Button.ts#L603)/[610](../src/typescript/lib/component/button/Button.ts#L610)) — signatures already accept the union, no change to call lines. Update `ButtonOptions` field types. Fix the `_clearChrome` `clearBorder` interaction comment ([339](../src/typescript/lib/component/button/Button.ts#L339)).
6. **`component/button/ToggleButton.ts`**: `setSelectedBorder(options: BorderOptions | string)` routing through `borderToStyle` into `selectedStyleRule`.
7. **`Theme` interface + three theme files + `themeToVars`**: add per-side optional fields to `tab.button[/hover/selected]`; emit the per-side vars in `themeToVars`; populate Modern's left/right hairline values; leave Default/Dark per-side fields unset.
8. **`layout/Tab.ts` `buildTabEntry`** ([352](../src/typescript/lib/layout/Tab.ts#L352)/[360](../src/typescript/lib/layout/Tab.ts#L360)/[366](../src/typescript/lib/layout/Tab.ts#L366)): replace the three string `setBorder`/`setHoverBorder`/`setSelectedBorder` calls with the per-side nested-var `BorderOptions` objects. The toolbar `setBorder` ([120](../src/typescript/lib/layout/Tab.ts#L120)) migrates from `{ style, width, color }` to `{ border: "1px solid var(--ts-ui-tab-toolbar-border, #e1e1e8)" }`.
9. **Migrate all object-form `setBorder({...})` call sites** from `{ style, width, color, top/right/bottom/left }` to the new string fields. Full list in Files table. Pattern translations:
   - `{ style: SOLID, width: 1, color: C }` → `{ border: "1px solid " + C }` (or a template literal).
   - `{ style: NONE }` → `{ border: "none" }`.
   - `{ top: { style: SOLID, width: 1, color: C } }` → `{ borderTop: "1px solid " + C }`.
   - `{ style: SOLID, width: 1, color: C, top: { ... transparent } }` (ProgressSpinner) → `{ border: "...", borderTop: "..." }` using `ARC_BORDER_WIDTH` interpolated into the string. Keep `ARC_BORDER_WIDTH`/`STATUS_BAR_BORDER_TOP_WIDTH` numeric constants (StatusBar's height calc at [133](../src/typescript/lib/component/container/StatusBar.ts#L133) still needs the number).
   - Validation-error / dynamic-string borders (Checkbox [416](../src/typescript/lib/component/input/Checkbox.ts#L416), RadioButton [368](../src/typescript/lib/component/input/RadioButton.ts#L368), `getDefaultBorder` implementers) already pass strings → unchanged (string ⇒ `{ border }`).
   - `NumberSpinner.options.border`, `AbstractCustomList.options.border`, `Button.options.border` (`{ style: RIDGE, width: 2, color }`), `Window.options.border`, `SpinButton.options.border`, `ComplexUIPanel` demo — translate the option literals too.
10. **Drop now-dead `BorderStyle` imports** from files whose only use was constructing `BorderOptions` triplets. → verify: per-file typecheck; `grep -n 'BorderStyle' <file>` after editing each.
11. **Docs**: update `docs/guide/mental-model.md:41` triplet example to a string border; regenerate typedoc.
12. **Regression greps** (all expect zero): `grep -rn 'new Border\b\|BorderLine\|BorderSideOptions\|\.fromString\|Border\.fromString' src/`; `grep -rn '_borderCSS' src/`; `grep -rn 'getTop()\.getWidth\|\.getStyleString\|\.getColor()' src/`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Rewrite | src/typescript/lib/primitive/Border.ts |
| Delete | src/typescript/lib/primitive/BorderLine.ts |
| Modify | src/typescript/lib/primitive/index.ts |
| Modify | src/typescript/lib/core/Component.ts |
| Modify | src/typescript/lib/component/button/Button.ts |
| Modify | src/typescript/lib/component/button/ToggleButton.ts |
| Modify | src/typescript/lib/layout/Tab.ts |
| Modify | src/typescript/lib/core/Theme.ts |
| Modify | src/typescript/lib/core/themes/DefaultTheme.ts |
| Modify | src/typescript/lib/core/themes/DarkTheme.ts |
| Modify | src/typescript/lib/core/themes/ModernTheme.ts |
| Modify | src/typescript/lib/core/Popover.ts |
| Modify | src/typescript/lib/core/Dialog.ts (3 sites: 158, 178, 330) |
| Modify | src/typescript/lib/core/Menu.ts (2 sites: 485, 504) |
| Modify | src/typescript/lib/core/Tooltip.ts (2 sites: 93, 305) |
| Modify | src/typescript/lib/core/Notification.ts (125, 146) |
| Modify | src/typescript/lib/core/Window.ts (options.border, 111) |
| Modify | src/typescript/lib/core/component/DragFeedback.ts |
| Modify | src/typescript/lib/core/component/DragGhost.ts |
| Modify | src/typescript/lib/component/container/StatusBar.ts |
| Modify | src/typescript/lib/component/display/ProgressSpinner.ts |
| Modify | src/typescript/lib/component/input/AbstractPickerField.ts (440) |
| Modify | src/typescript/lib/component/input/NumberSpinner.ts (79, 110, 122, 124) |
| Modify | src/typescript/lib/component/input/SpinButton.ts (49) |
| Modify | src/typescript/lib/component/menubar/ToolBar.ts (194, 196) |
| Modify | src/typescript/lib/component/table/Header.ts (48) |
| Modify | src/typescript/lib/component/table/Footer.ts (22) |
| Modify | src/typescript/lib/component/table/Table.ts (107) |
| Modify | src/typescript/lib/component/table/cell/editor/{String,Number,Date,Time,DateTime}.ts |
| Modify | src/typescript/lib/component/list/AbstractCustomList.ts (70) |
| Modify | src/typescript/ComplexUIPanel.ts (34) |
| Modify | docs/guide/mental-model.md (41) |

(`setBorder("string")` / `getDefaultBorder()` string consumers — AutoCompleteField, AutoCompleteDropdown, ComboBox, Cell, Checkbox, RadioButton, Slider, Toggle's radius-only, DateField/TimeField/DateTimeField — need no edit; bare strings are accepted as-is.)

---

## Verification

- `npm run typecheck` (or `tsc --noEmit`) clean across the repo.
- Regression greps from step 12 all empty.
- `grep -rln 'new Border\|BorderLine\|BorderSideOptions' src/` — zero.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). Confirm `docs/api/primitive/classes/Border.md`, `BorderLine.md`, and `interfaces/BorderSideOptions.md` are no longer generated (typedoc drops them automatically) and that `docs/api/primitive/interfaces/BorderOptions.md` regenerates with the five string fields.
- Manual smoke (`npm run dev`, app on http://localhost:8015):
  - **Tabs**: switch the active theme (Default → Dark → Modern). Modern tabs show left/right hairline borders with no top/bottom; Default/Dark stay borderless. Demo screen: any panel with a `Tab` layout (the ComplexUIPanel tabbed area).
  - **Per-side border survives render**: a component with a per-side border (StatusBar top, table Header bottom, NumberSpinner divider) renders the border after a resize/relayout (the applyStyle replay) — this is the bug-fix the consolidation targets.
  - **Buttons**: hover/pressed/selected borders still apply (Dialog close button borderless; ToggleButton selected state).
  - **Inputs**: validation-error red border on a picker field; checkbox/radio selected borders.

---

## Documentation Impact

- **Barrel**: `BorderOptions` (type) remains exported from `src/typescript/lib/primitive/index.ts`; `Border`, `BorderLine` (values) and `BorderSideOptions` (type) are removed from it. `BorderStyle` stays.
- **Generated API** (`docs/api/primitive/`): typedoc regenerates on `docs:build`; the deleted symbols' pages disappear and `BorderOptions.md` updates to the new fields. No manual edit, but verify the sidebar (`docs/api/typedoc-sidebar.json`) regenerates without the dead entries.
- **Curated pages**: `docs/guide/mental-model.md:41` shows the old triplet `border: { style: BorderStyle.SOLID, width: 1, color: "black" }` — update to `border: "1px solid black"`. No other curated page references the `Border` primitive class directly (the `Border` mentions in `docs/concepts/sizing.md`, `glossary.md`, `layouts/Border.md` are the unrelated *layout manager*; the `*.border` rows in `docs/concepts/theming.md` are color tokens, unchanged).
- **JSDoc cross-refs**: the new `BorderOptions` JSDoc and the `Theme.tab.button.border` doc comment ([Theme.ts:83/176](../src/typescript/lib/core/Theme.ts#L83)) stay accurate; verify no `{@link Border}` / `{@link BorderLine}` / `{@link BorderSideOptions}` links survive (`grep -rn '{@link Border\b\|{@link BorderLine\|{@link BorderSideOptions' src/`). `Component.setBorder` JSDoc must drop the "style, width, color" phrasing.
- **Renames/removals audit**: `grep -rln '\bBorderLine\b\|\bBorderSideOptions\b' docs/ src/` after the change — only `/dist/` build artefacts (stale, rebuilt) may match.

---

## Potential Challenges

- **Border-width cache staleness / timing.** Widths are browser-measured once an element exists and cached; a stale cache would mis-size content. Mitigation: invalidate on `setBorder`/`clearBorder` and on theme change (lazy `onThemeChange` listener). Pre-render `getBorderSize` returns a literal estimate (`var()` ⇒ 0) until the first post-render call re-measures — acceptable because layout re-runs after attach; verify a bordered component that sizes before attach (e.g. an auto-sizing `Button`) still lands correctly after first layout.
- **`getComputedStyle` cost.** A naive measure-every-layout would thrash style recalc on large UIs. The `_borderWidths` cache makes it once-per-(border/theme)-change; confirm no layout path bypasses the cache (grep `getBorderSize` call sites) and re-check the MiscPanel slow-table.
- **Theme listener lifecycle.** The lazily-registered `onThemeChange` invalidation must be torn down when the component is removed/disposed, or it leaks (same contract as the `Text` theme listener). Register at most once per component.
- **Shorthand-vs-longhand cascade.** Emitting four longhands (not the `border` shorthand) avoids a shorthand reset wiping a per-side write. Any consumer that previously set the `border` shorthand and a longhand in separate writes is now uniformly longhand — consistent, but confirm no CSS rule elsewhere sets the `border` shorthand expecting to override these (grep `_styleRule.set("border"` — only the replay path and the removed branches touch it).
- **`themeToVars` optional-field emission.** Per-side tab vars must be omitted (not emitted as the string `"undefined"`) when a theme leaves them unset; mirror the existing optional-field handling in `themeToVars` rather than unconditionally interpolating.
- **`Button._clearChrome` lacks `clearHoverBorder`/`clearPressedBorder`.** Pre-existing gap (comments at [570](../src/typescript/lib/component/button/Button.ts#L570)/[580](../src/typescript/lib/component/button/Button.ts#L580)); out of scope — keep the comments accurate to the new model, don't add the clears.

---

## Critical Files

- [primitive/Border.ts](../src/typescript/lib/primitive/Border.ts) / [primitive/BorderLine.ts](../src/typescript/lib/primitive/BorderLine.ts) — the types being replaced/deleted.
- [core/Component.ts](../src/typescript/lib/core/Component.ts) — `setBorder`/`clearBorder`/`getBorder` (~1209-1257), `getBorderSize` (~1800), `applyStyle` replay (~2939), `_border`/`_borderCSS` fields (~229), `ComponentOptions.border` (~115).
- [core/StyleTarget.ts:43](../src/typescript/lib/core/StyleTarget.ts#L43) — `setMany` signature (camelCase keys, string|null values) the helper must produce.
- [component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — hover/pressed border fields, setters, option forwarding, `_clearChrome`.
- [component/button/ToggleButton.ts:188](../src/typescript/lib/component/button/ToggleButton.ts#L188) — `setSelectedBorder` + `.selected` rule.
- [layout/Tab.ts:340](../src/typescript/lib/layout/Tab.ts#L340) — `buildTabEntry`, the per-side token consumer.
- [core/Theme.ts:174](../src/typescript/lib/core/Theme.ts#L174) (interface), [:553](../src/typescript/lib/core/Theme.ts#L553) (`themeToVars`) + the three theme files' `tab.button` blocks (~90-100 each).

---

## Non-Goals

- **Renaming `layout/Border.ts`'s `BorderOptions`** — different subpath barrel, no collision in practice; touching it is scope creep.
- **Adding `clearHoverBorder`/`clearPressedBorder` to Button** — pre-existing gap, not required by this consolidation.
- **Per-side tokens for top/bottom tab borders** — not needed for the Modern left/right design; the nested-var fallback already supports them if a future theme wants them, but no token is added now.
