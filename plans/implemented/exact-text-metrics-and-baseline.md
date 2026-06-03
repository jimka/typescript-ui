# Exact Text Metrics and Self-Determined Baseline — Implementation Plan

## Overview

Text-bearing controls currently derive their height and baseline from **two
divergent measurement models** that both lean on browser/UA values, so a
native `<input>`'s text does not sit on the same baseline as a `Text`/`Label`
in the same `HBox` row:

- `Text`/`Label`/`ComboBox` measure against the unitless theme line-height
  `--ts-ui-line-height` (`1.2` → a fractional `16.8px` line box at `14px`).
  `Label`/`ComboBox` baselines come from [`Util.measureLabelBaseline`](../src/typescript/lib/core/Util.ts#L219), which passes `lineHeight: var(--ts-ui-line-height, 1.2)` into [`measureTextMetrics`](../src/typescript/lib/core/Util.ts#L69).
- Native inputs measure against `line-height: "normal"` (UA) for the baseline
  via [`Util.measureInputBaseline`](../src/typescript/lib/core/Util.ts#L186) / [`remeasureInputBaseline`](../src/typescript/lib/core/Util.ts#L250), and size their box height by probing a bare UA `<input>` in [`Util.measureInputHeight`](../src/typescript/lib/core/Util.ts#L146). The framework sets **no** `line-height`, padding, or box height on the rendered `<input>` ([TextInput constructor only writes font-family/size](../src/typescript/lib/component/input/TextInput.ts#L92)), so the live box is whatever the UA chose (≈22px = 14px text + 3+3 padding + 1+1 border).

The HBox/Grid placement math that consumes `getBaseline()` is correct and is
**out of scope** — only the *inputs* (per-component baseline + height) are
wrong. This plan makes those inputs **self-determined and exact**: one
integer-pixel line-height used for both rendering and measurement, an
input box height the framework computes itself (no UA probe), and a single
canvas-ascent baseline with one final round.

The work centres on [`Util.ts`](../src/typescript/lib/core/Util.ts), [`Text.ts`](../src/typescript/lib/component/input/Text.ts), [`TextInput.ts`](../src/typescript/lib/component/input/TextInput.ts), and the six height-setting call sites of `measureInputHeight`. It also re-types the theme `font.lineHeight` token.

---

## Architecture Decisions

### Integer-pixel line-height, replacing the unitless multiplier

`--ts-ui-line-height` becomes an explicit **integer pixel** value (`20px` at
the `14px` default font), not a unitless `1.2`. A unitless multiplier produces
a fractional line box (`14 * 1.2 = 16.8px`) that is rounded in two different
places at two different stages — the root cause of the sub-pixel drift. An
integer px line-height renders identically on the input and on `Text`, makes
the line box height a known constant the framework can add to padding/border
to derive box height arithmetically, and removes all rounding from the
height path. `20px` (not `17px`) is chosen so the input box height
(`20 + padding 6 + border 2 = 28px`) stays visually close to the current UA
≈22–24px control height without a separate control-height token (that cosmetic
idea is a **Non-Goal**).

Because the value is now pixels, the CSS `var()` fallbacks and the JS
resolution change: `Text` currently treats the token as a multiplier
(`fontSize * parsed` in [`readThemeLineHeightPx`](../src/typescript/lib/component/input/Text.ts#L252)) and writes `var(--ts-ui-line-height, 1.2)` as the rendered rule. Both switch to reading/rendering the px value directly (`var(--ts-ui-line-height, 20px)`), so a unitless theme value is no longer valid input.

### Unify the line-height base across inputs and labels

Every text-bearing control — `Text`, `Label`, `ComboBox` label, and the native
`<input>`/`<textarea>` backed controls — renders **and** measures at the same
`--ts-ui-line-height` px value. `TextInput` gains an explicit
`line-height` write on its element (joining the font-family/size it already
sets), so the live input no longer inherits UA `normal`. Measurement uses the
identical px value, so `measureLabelBaseline` and the input baseline collapse
to the *same* computation — there is no longer a label model vs an input model.

### Canvas `TextMetrics.fontBoundingBoxAscent` for the baseline, replacing the DOM line-box-centering probe

The baseline (offset from the top of the line box to the text baseline) is
computed from the canvas 2D `measureText` metrics rather than the DOM probe:

```
ascent   = fontBoundingBoxAscent          // font-intrinsic, sub-pixel, deterministic
lineGap  = lineHeightPx - (fontBoundingBoxAscent + fontBoundingBoxDescent)
baseline = Math.round(lineGap / 2 + ascent)   // single, final round
```

Rationale:
- **Deterministic & UA-independent.** `fontBoundingBoxAscent/Descent` come from
  the font file via the canvas font metrics API, not from how a browser lays
  out and vertically-centres an `<input>`'s line box. `measureInputBaseline`'s
  comment already notes the DOM `vertical-align: baseline` against an `<input>`
  is "inconsistently resolved" by browsers; canvas sidesteps that entirely.
- **No double round.** Today [`measureTextMetrics`](../src/typescript/lib/core/Util.ts#L122) rounds the baseline once, then [`remeasureInputBaseline`](../src/typescript/lib/core/Util.ts#L284) rounds a second time over a fractional `(contentHeight - textHeight)/2` centre. The canvas formula rounds exactly once, at the end.
- **Same model for line-box centring.** A CSS line box centres the font's
  ascent+descent within `line-height`; `lineGap/2 + ascent` reproduces that
  centring with the *known* px line-height, so the measured baseline matches
  where the browser actually paints the glyph in both the input and the `Text`.
- **`fontBoundingBoxAscent` over `actualBoundingBoxAscent`.** The former is the
  font's intrinsic ascent (stable across strings); the latter is glyph-ink
  specific and would shift the baseline per measured string. Baseline must be
  text-content-independent, so `fontBoundingBox*` is correct. The probe string
  stays `"X"` only as a `measureText` argument; the result no longer depends on
  it.

A `font` shorthand string (`"normal normal 14px system-ui, sans-serif"`) is
built from the theme tokens for `ctx.font`. The canvas/context is created once
and cached at module scope alongside the baseline caches.

### Input box height computed by the framework, not probed

`measureInputHeight` is **removed**. The box height an input-backed control
reports as its preferred/max height is computed in JS:

```
boxHeight = lineHeightPx + paddingTop + paddingBottom + borderTop + borderBottom
```

The padding/border are the control's *own* framework values (e.g. `TextField`'s
`Insets(3,3,3,3)` default + the 1px `--ts-ui-input-border`), not a UA probe's.
A single new helper [`Util.lineHeightPx()`](../src/typescript/lib/core/Util.ts) reads `--ts-ui-line-height` and returns the integer px line box; each control's `updateHeight` adds its own padding+border via the existing `getPadding()`/`getBorderSize()` accessors already used by [`wrapInnerBaseline`](../src/typescript/lib/core/Component.ts#L2271). This keeps the box height exact and removes the last UA dependency. The line box itself is the inner content height inputs are measured against, so `wrapInnerBaseline` (which re-adds the control's border+padding) keeps composing correctly.

### Keep `wrapInnerBaseline` and the per-control delegation chain

`wrapInnerBaseline` and every delegating override (`AbstractPickerField`,
`NumberSpinner`, `AutoCompleteField` → inner input; `Button`,
`Checkbox`/`RadioButton`/`Toggle` → inner `Text`/`Label`; `ComboBox` → label)
already compose a content-relative inner baseline with the control's chrome.
Those stay; they automatically inherit the corrected inner baseline once
`Util.measureInputBaseline` / `measureLabelBaseline` return the unified value.
This is the minimal-surface choice — the chrome arithmetic is correct, only its
input changes.

### Optical vertical centering of single-line button text

A single-line `Button` ("Save") centres badly today: its content row is added
with `anchor: AnchorType.CENTER, fill: FillType.NONE` ([Button constructor](../src/typescript/lib/component/button/Button.ts#L336)), so the **geometric** centring in [`LayoutManager.resolveBounds`](../src/typescript/lib/layout/LayoutManager.ts#L370) (`y += (maxHeight - height) / 2`, with `height` = the inner `Text`'s line box) centres the *line box*. But the visible glyphs of a label occupy cap-top→baseline; the descender band below the baseline (≈`descent`) is empty ink, so the ink's visual centre sits **above** the geometric centre and the label reads as too high. The remedy is a small **downward** offset so the label's optical centre (≈ cap-height midpoint) lands on the button's centre.

**Choice.** Compute the offset from the *same* unified font metrics the baseline path already introduces — no new measurement infrastructure. With the canvas `fontBoundingBoxAscent`/`fontBoundingBoxDescent` (and, for accuracy, the cap-top via `actualBoundingBoxAscent`) the optical-centre correction is:

```
// "X" cap-height ink top measured above the baseline:
capTop  = actualBoundingBoxAscent          // glyph-ink ascent of "X" (cap height)
// glyph-box centre vs. ink centre, both measured from the baseline:
inkMid  = capTop / 2                        // visual centre of cap-top→baseline band
boxMid  = (asc - desc) / 2                  // centre of the font box about the baseline
offsetY = Math.round(boxMid - inkMid)       // downward shift to align them
```

i.e. roughly **half the unused descender space** (`≈ round(descent / 2)` when cap-top ≈ ascent), a 1–2px downward nudge at the `14px`/`20px` line-height. The offset is computed once from the cached metrics, not per-button.

**Application site.** Apply it in `Button`, not in `Fit`/`LayoutManager`. The generic anchor logic is correct and shared by every `Fit`/anchored consumer; baking an optical fudge into it would mis-shift non-text content (glyph-only buttons, arbitrary `Fit` children). Instead `Button` carries the offset on the content row it owns — the cleanest seam is a top inset on `_content` (it already sets `Insets(0,0,0,0)` at [Button.ts:327](../src/typescript/lib/component/button/Button.ts#L327)) of `offsetY` top / `0` bottom, or equivalently nudging the row's placement via that inset. This rides through the existing `Fit` centring unchanged: `_content`'s own top inset shifts the `Text` down within the already-centred row.

**Single-line gate.** The offset applies **only** when there is a non-empty rendered label and no description. `_rebuildContentRow` ([Button.ts:614](../src/typescript/lib/component/button/Button.ts#L614)) builds a two-line stack (`_titleColumn`/`_outerColumn` VBox holding `_text` + `_description`) whenever `renderDesc = this._description !== null && this._isShowDescription()` ([Button.ts:626](../src/typescript/lib/component/button/Button.ts#L626)) is true; a stacked title+description centres as a block and must not be nudged. A glyph-only button (`_text` empty) is already box-centred and must not be shifted either. So the optical inset is set inside `_rebuildContentRow` (which already runs on every text/glyph/description/flag mutation) gated on `!renderDesc && this._text.getText() !== ""`, and cleared to `0` otherwise. Multi-line optical centring is a **Non-Goal**.

---

## Public API (TypeScript Signatures)

### `Util` (`src/typescript/lib/core/Util.ts`)

```typescript
namespace Util {
    /** Active theme line box height in integer px (reads --ts-ui-line-height). Cached; invalidated on theme change. */
    export function lineHeightPx(): number;

    /** Content-relative text baseline for the unified line-height model, via canvas font metrics. Cached. */
    export function measureTextBaseline(): number;   // replaces measureInputBaseline + measureLabelBaseline

    /**
     * Downward pixel offset that moves a single line of text from line-box
     * (geometric) centre to optical (cap-height) centre. Derived from the same
     * cached canvas metrics as `measureTextBaseline` — round(boxMid − inkMid).
     * Consumed by `Button` for single-line content centring. Cached.
     */
    export function opticalCenterOffset(): number;

    export function invalidateTextMetricsCache(): void;  // replaces the two invalidate* fns + clears opticalCenterOffset cache

    // REMOVED: measureInputHeight, measureInputBaseline, remeasureInputBaseline,
    //          measureLabelBaseline, invalidateInputBaselineCache, invalidateLabelBaselineCache
}
```

`measureTextMetrics` keeps its signature; its default `lineHeight` changes from
`"50px"` to `var(--ts-ui-line-height, 20px)` so callers that omit it get the
unified value. (`Text.calculateSize` already passes an explicit `lineHeight`,
so this only affects defaulted callers.)

### `Text` (`src/typescript/lib/component/input/Text.ts`) — no new public setter

`setLineHeight(value: number | string)` and `centerInHeight` keep their
signatures. The **string** branch's rendered rule changes from
`var(${value}, 1.2)` to `var(${value}, 20px)`, and [`readThemeLineHeightPx`](../src/typescript/lib/component/input/Text.ts#L252) returns the px token value directly instead of `fontSize * parsed`. No new typed setter, backing field, or `XOptions` field is introduced — the existing `lineHeight?: number | string` option already routes through `setLineHeight`, and that one setter is now the uniform line-height entry point for every text control via `Text`/`Label`/`ComboBox` and the new `TextInput` line-height write.

### `TextInput` (`src/typescript/lib/component/input/TextInput.ts`)

No new public setter; the constructor's existing `setElementCSSRules` block
gains `lineHeight: "var(--ts-ui-line-height, 20px)"` so the rendered input
matches the measurement model. (A dedicated `setLineHeight` on inputs is a
Non-Goal — inputs render a single fixed line and never need per-instance
line-height control.)

### `Button` (`src/typescript/lib/component/button/Button.ts`) — internal, no new public surface

The optical centring is fully internal: `_rebuildContentRow` sets `_content`'s
top inset from `Util.opticalCenterOffset()` in the single-line branch and to `0`
in the description branch. No new `ButtonOptions` field, typed setter, or
backing state — the offset is read live from the cached metric, so it
re-derives automatically on theme/font change via the existing
`invalidateTextMetricsCache` and the constructor's `recomputePreferredSize`
theme hook.

`opticalCenterOffset` reuses the canvas context, `font` shorthand, and
`asc`/`desc` already computed for `measureTextBaseline`; the only extension to
the metrics helper is reading `actualBoundingBoxAscent` (cap top of `"X"`)
alongside the `fontBoundingBox*` values in the single `ctx.measureText("X")`
call — no second measurement.

### Theme (`src/typescript/lib/core/Theme.ts`)

```typescript
font: {
    family    : string;
    size      : string;
    /** Line box height as an integer-pixel CSS length string, e.g. "20px". */
    lineHeight: string;   // was: number (unitless multiplier)
}
```

`themeToVars` already emits `String(theme.font.lineHeight)`; with `lineHeight`
now a px string this writes `"20px"` directly. The `document.documentElement.style.lineHeight = String(theme.font.lineHeight)` write at [Theme.ts:814](../src/typescript/lib/core/Theme.ts#L814) likewise carries the px value.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-line-height` | `20px` | `20px` | Integer-pixel line box shared by every text control for rendering **and** measurement. Replaces the prior unitless `1.2` multiplier. |

Blocks to change:
- `Theme` interface `font.lineHeight`: `number` → `string` ([Theme.ts:37](../src/typescript/lib/core/Theme.ts#L37); update the doc comment that currently describes a unitless multiplier).
- `ModernTheme` `font` ([ModernTheme.ts:15](../src/typescript/lib/core/themes/ModernTheme.ts#L15)): `lineHeight: 1.2` → `lineHeight: '20px'`.
- `DarkTheme` `font` ([DarkTheme.ts:12](../src/typescript/lib/core/themes/DarkTheme.ts#L12)): `lineHeight: 1.2` → `lineHeight: '20px'`.
- `ClassicTheme` — verify whether it defines `font.lineHeight` separately; the `Theme` interface default lives inline. Update wherever `ClassicTheme` is constructed (it is exported from `Theme.ts:524`) to the px string.
- `themeToVars` ([Theme.ts:557](../src/typescript/lib/core/Theme.ts#L557)) and `setTheme` ([Theme.ts:814](../src/typescript/lib/core/Theme.ts#L814)) need no structural change — they already stringify the value.

---

## Ordered Implementation Steps

1. **Theme token type + values.** In [`Theme.ts`](../src/typescript/lib/core/Theme.ts) change `font.lineHeight: number` → `string` and fix its doc comment. In [`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts), [`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts), and the `ClassicTheme` literal, set `lineHeight: '20px'`.
   - Checkpoint: `grep -rn "lineHeight: 1.2\|lineHeight:1.2" src/ — expect zero matches`.

2. **`Util` line-height helper + canvas baseline.** In [`Util.ts`](../src/typescript/lib/core/Util.ts):
   - Add module-scope caches: `lineHeightCache = -1`, `textBaselineCache = -1`, and a lazily-created canvas 2D context.
   - Add `lineHeightPx()`: read `getComputedStyle(document.documentElement).getPropertyValue('--ts-ui-line-height')`, `parseFloat`, cache; fall back to `20`.
   - Add `measureTextBaseline()`: build the `ctx.font` shorthand from `--ts-ui-font-*`, call `ctx.measureText("X")`, compute `baseline = Math.round((lineHeightPx() - (asc + desc)) / 2 + asc)` per the Architecture Decision; cache.
   - Add `opticalCenterOffset()`: from the same cached `ctx.measureText("X")` metrics read `actualBoundingBoxAscent` (cap top) and compute `Math.round((asc - desc) / 2 - actualBoundingBoxAscent / 2)`, clamped to `>= 0`; cache. Reuse the canvas/context already created for `measureTextBaseline`.
   - Add `invalidateTextMetricsCache()` resetting all three caches (line-height, baseline, optical offset).
   - Change `measureTextMetrics` default `lineHeight` from `"50px"` to `"var(--ts-ui-line-height, 20px)"`.
   - Delete `measureInputHeight`, `measureInputBaseline`, `remeasureInputBaseline`, `measureLabelBaseline`, `invalidateInputBaselineCache`, `invalidateLabelBaselineCache` and the `inputBaseline`/`labelBaseline` module vars.

3. **Theme invalidation.** In [`Theme.setTheme`](../src/typescript/lib/core/Theme.ts#L818) replace the two `invalidate*BaselineCache()` calls with one `Util.invalidateTextMetricsCache()`.

4. **`TextInput` renders the unified line-height.** In the [`TextInput` constructor `setElementCSSRules`](../src/typescript/lib/component/input/TextInput.ts#L92) block add `lineHeight: "var(--ts-ui-line-height, 20px)"`. Also align the stray `fontSize: "var(--ts-ui-font-size, 12px)"` fallback to `14px` so the input's font matches `Text` when the var is somehow absent.

5. **`TextInput.getBaseline` → unified baseline.** Change [`getBaseline`](../src/typescript/lib/component/input/TextInput.ts#L375) to `return this.wrapInnerBaseline(Util.measureTextBaseline())`.

6. **`ComboBox` → unified baseline + computed height.** Change [`ComboBox.getBaseline`](../src/typescript/lib/component/input/ComboBox.ts#L657) to `Util.measureTextBaseline()`, and rewrite [`updateHeight`](../src/typescript/lib/component/input/ComboBox.ts#L601) to compute `boxHeight = Util.lineHeightPx() + padding + border` from its own `getPadding()`/`getBorderSize()`.

7. **Computed box height at every former `measureInputHeight` call site.** Rewrite `updateHeight`/`updateSize` in [`TextField`](../src/typescript/lib/component/input/TextField.ts#L56), [`PasswordField`](../src/typescript/lib/component/input/PasswordField.ts#L51), [`AbstractPickerField`](../src/typescript/lib/component/input/AbstractPickerField.ts#L254), [`NumberSpinner`](../src/typescript/lib/component/input/NumberSpinner.ts#L202), and [`SpinButton`](../src/typescript/lib/component/input/SpinButton.ts#L123) to derive height from `Util.lineHeightPx()` + the control's own padding/border instead of `Util.measureInputHeight()`. `SpinButton` keeps its half-height (`floor((fullHeight-2)/2)`) and `AutoCompleteField.syncSizeFromTextField` is unchanged (it mirrors the inner `TextField`, which is now correct transitively).
   - Checkpoint: `grep -rn 'measureInputHeight' src/ — expect zero matches`.

8. **`Text` px line-height resolution.** In [`Text.ts`](../src/typescript/lib/component/input/Text.ts): update the `_lineHeightCSSRule` initial value and the `setLineHeight` string branch from `var(..., 1.2)` to `var(..., 20px)`, and change [`readThemeLineHeightPx`](../src/typescript/lib/component/input/Text.ts#L252) to return the parsed px token value directly (no `fontSize *`). Update the now-stale doc comments on `readThemeLineHeightPx` and `setLineHeight` that describe a unitless multiplier.
   - Checkpoint: `grep -rn '1.2' src/typescript/lib/component/input/Text.ts — expect zero matches` (the `fs * 1.2` fallback also goes).

9. **`Button` single-line optical centring.** In [`_rebuildContentRow`](../src/typescript/lib/component/button/Button.ts#L614), after computing `renderDesc`, compute `offset = (!renderDesc && this._text.getText() !== "") ? Util.opticalCenterOffset() : 0` and apply it as `_content`'s top inset only — `this._content.setInsets(new Insets(offset, 0, 0, 0))`. Leave the `anchor`/`fill` of the content row untouched. No change to `Fit`/`LayoutManager`.
   - Checkpoint: `grep -rn 'opticalCenterOffset' src/typescript/lib/component/button/Button.ts — expect one match`.

10. **Global grep sweep.** `grep -rn 'measureInputHeight\|measureInputBaseline\|measureLabelBaseline\|lineHeight: "normal"\|, 1.2)\|: 1.2' src/ — expect zero matches`.

11. **Typecheck + build.** `npm run build` (or the project's tsc check) to catch the `font.lineHeight` `number`→`string` fallout and any missed `Util` consumer.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Util.ts` (add `lineHeightPx`, `measureTextBaseline`, `invalidateTextMetricsCache`, canvas cache; delete 4 fns + 2 vars; retune `measureTextMetrics` default) |
| Modify | `src/typescript/lib/core/Theme.ts` (`font.lineHeight` type + doc; `setTheme` invalidation; `ClassicTheme` literal) |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` (`lineHeight: '20px'`) |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` (`lineHeight: '20px'`) |
| Modify | `src/typescript/lib/component/input/TextInput.ts` (render line-height; `getBaseline`; 12px→14px fallback) |
| Modify | `src/typescript/lib/component/input/Text.ts` (`readThemeLineHeightPx`, `setLineHeight` rule, field init, doc) |
| Modify | `src/typescript/lib/component/input/TextField.ts` (`updateHeight`) |
| Modify | `src/typescript/lib/component/input/PasswordField.ts` (`updateHeight`) |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` (`updateHeight`, `getBaseline`) |
| Modify | `src/typescript/lib/component/input/AbstractPickerField.ts` (`updateHeight`) |
| Modify | `src/typescript/lib/component/input/NumberSpinner.ts` (`updateHeight`) |
| Modify | `src/typescript/lib/component/input/SpinButton.ts` (`updateSize`) |
| Modify | `src/typescript/lib/component/button/Button.ts` (`_rebuildContentRow` sets `_content` top inset from `Util.opticalCenterOffset()`, single-line only) |
| Modify | `src/typescript/lib/core/Util.ts` — covered above: also adds `opticalCenterOffset` (no new file) |

No files created or deleted.

---

## Verification

- **Typecheck/build:** `npm run build` passes with zero errors (the `font.lineHeight` type change is the canary).
- **Grep invariants:** the sweeps in steps 1, 7, 8, 10 return zero matches; step 9's `opticalCenterOffset` check returns one match in `Button.ts`.
- **BaselinePanel smoke (primary):** run the app (`npm run dev`, http://localhost:8015) and open the screen rendering [`BaselinePanel`](../src/typescript/BaselinePanel.ts). After the fix, every single-line control — `Text`, `Label`, `TextField`, `ComboBox`, `AutoCompleteField`, `DateField`/`TimeField`/`DateTimeField`, `NumberSpinner`, `Checkbox`, `RadioButton`, `Toggle`, `Button`, `ToggleButton` — must have its text sitting **on** the red baseline ruler (`rowAscent`), and all of them must fall **between the same two blue** top/bottom bracket lines (the `TextArea` is excluded from the bottom bracket by design, and `Slider`/`Glyph`/`ProgressBar`/`ProgressSpinner` legitimately report `null`/non-text baselines). Before the fix the input-backed controls' text floats off the red line relative to `Text`/`Label`; after, they coincide.
- **Optical centring (single-line buttons):** on the same [`BaselinePanel`](../src/typescript/BaselinePanel.ts) row (which includes a `Button` and a `ToggleButton`), the single-line label text must look **optically centred** — not sitting visibly high in the button face. Quick visual check: place a single-line `Button` ("Save") beside a tall sibling in an `HBox` and confirm the label's cap-height band looks vertically centred in the button, with the small downward nudge applied (compare before/after by temporarily forcing `opticalCenterOffset()` to `0`). Confirm a `Button` *with* a description (two-line) is unaffected — its title+description block stays block-centred (offset `0`), and a glyph-only `Button` (empty `_text`) is not visibly shifted.
- **Theme toggle:** switch ModernTheme ↔ DarkTheme on the BaselinePanel screen; `invalidateTextMetricsCache` must re-measure so the alignment **and** the optical offset hold in both (no stale baseline/offset). Optionally bump `--ts-ui-font-size` to confirm the px line-height still renders/measures consistently and the optical nudge scales.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice is the only acceptable warning), since `Util`'s exported surface changed.

---

## Documentation Impact

The removed/renamed `Util` functions and the `Theme.font.lineHeight` type are
consumer-visible:

- **Barrel:** `Util` is exported from `src/typescript/lib/core/index.ts` (the per-subpath `core` barrel; there is no root barrel). Confirm the removed function names aren't individually re-exported.
- **Curated pages:** check `docs/core/` for any page documenting `Util` text-measurement helpers or the theme `font` token; update its prose and the catalog `docs/core/index.md`, plus the sidebar in `docs/.vitepress/config.mts` if a page is added/renamed. The line-height token's new px semantics should be noted wherever theming/`Theme.font` is documented.
- **JSDoc:** update the `Util` function docblocks (already in scope) and the `Theme.font.lineHeight` comment; any cross-bucket reference to the deleted `measure*Baseline` functions must become a markdown link or be removed (`{@link}` across buckets is disallowed — see `_shared/docs-conventions.md`).
- **Rename/removal sweep:** `grep -rln 'measureInputHeight\|measureInputBaseline\|measureLabelBaseline\|invalidateInputBaselineCache\|invalidateLabelBaselineCache' docs/` — update or remove every hit (ignore `docs/.vitepress/dist/` build output).

---

## Potential Challenges

- **Canvas font metrics availability.** `fontBoundingBoxAscent`/`Descent` are widely supported in modern Chromium/Firefox/Safari but were historically behind `actualBoundingBox*`; guard with a `typeof m.fontBoundingBoxAscent === "number"` check and fall back to `actualBoundingBoxAscent + actualBoundingBoxDescent` (acceptable since `"X"` has stable ink) if absent.
- **`ctx.font` must resolve the CSS vars to concrete values.** `ctx.font` does not accept `var(...)`; build the shorthand from the *computed* `--ts-ui-font-size`/`--ts-ui-font-family` read off `document.documentElement`, mirroring how `lineHeightPx()` resolves the token.
- **Height delta changes layouts.** Moving from the UA ≈22–24px input box to the computed `20 + padding + border` may shift control heights by a pixel or two; the `20px` token is tuned to stay close, but re-check any screen with tight vertical packing (the BaselinePanel bottom bracket makes regressions visible).
- **`measureTextMetrics` default consumers.** Anything that called it *without* a `lineHeight` previously got `"50px"` (a deliberately oversized box for pure width); now it gets the unified token. Grep `measureTextMetrics(` / `measureTextSize(` / `measureTextWidth(` call sites and confirm none relied on the 50px box for width-only measurement (width is line-height-independent, so this should be safe — verify).
- **SpinButton odd-height assumption.** Its comment assumes an odd UA height; with the computed even-ish height the `floor((h-2)/2)` math still holds but re-check the chevron centring visually.
- **Font-dependent cap height.** `actualBoundingBoxAscent` is glyph-ink specific; measuring `"X"` gives a stable cap height for Latin fonts but the offset will differ across the theme font stack. It's recomputed on theme/font change (shared metrics cache), so this is correct, not a bug — but verify the nudge looks right in each shipped theme rather than hard-coding a px value.
- **`ToggleButton` and other `Button` subclasses.** `ToggleButton`, `MenuBarButton`, `PickerButton`, `AccordionHeader`, `TabCloseButton`, `SpinButton` all extend `Button` and inherit `_rebuildContentRow`; the offset applies to each. Subclasses that re-anchor `_content` (e.g. `WEST`-anchored menubar buttons) keep the *top* inset regardless of horizontal anchor, which is correct — the optical nudge is purely vertical. Re-check any subclass that overrides `_rebuildContentRow` so the inset isn't dropped.
- **Glyph-only / empty-label buttons.** When `_text` is empty (icon-only button), the optical nudge would shift a glyph that is already box-centred. Gate the inset on a non-empty rendered label (e.g. only apply when `_text.getText()` is non-empty *and* `!renderDesc`); a bare glyph keeps offset `0`. Confirm this with the glyph-only buttons in `PaginationBar`.

---

## Critical Files

- [`src/typescript/lib/core/Util.ts`](../src/typescript/lib/core/Util.ts) — the measurement model being unified; read `measureTextMetrics`, the deleted fns, and the module caches.
- [`src/typescript/lib/core/Component.ts:2271`](../src/typescript/lib/core/Component.ts#L2271) — `wrapInnerBaseline`, the chrome composition every override relies on (unchanged but load-bearing).
- [`src/typescript/lib/component/input/Text.ts`](../src/typescript/lib/component/input/Text.ts) — `readThemeLineHeightPx`, `setLineHeight`, `calculateSize`, the `_lineHeightCSS*` fields.
- [`src/typescript/lib/component/input/TextInput.ts`](../src/typescript/lib/component/input/TextInput.ts) — input render block + `getBaseline`; parent of `TextField`/`PasswordField`/`TextArea`.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) and [`themes/ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts)/[`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts) — the token definitions and `setTheme` invalidation.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — read the constructor's `_content` setup (`Insets(0,0,0,0)`, `anchor`/`fill` add) and `_rebuildContentRow` (`renderDesc`, the title/description topologies) before adding the single-line optical inset.
- [`src/typescript/lib/layout/LayoutManager.ts:370`](../src/typescript/lib/layout/LayoutManager.ts#L370) — `resolveBounds` geometric vertical centring (`y += (maxHeight - height) / 2`); read to confirm the optical offset rides on top via `_content`'s inset, not by editing this loop.
- [`src/typescript/BaselinePanel.ts`](../src/typescript/BaselinePanel.ts) — the verification harness; its `positionRulers` is the success oracle, and its row includes the `Button`/`ToggleButton` for the optical-centring check.
- [`src/typescript/lib/layout/LayoutManager.ts:483`](../src/typescript/lib/layout/LayoutManager.ts#L483) (`nullChildY`, `computeRowMetrics`) — read only to confirm the placement loop is untouched.

---

## Non-Goals

- **HBox/Grid placement loops.** `computeRowMetrics`/`nullChildY` and the row-ascent alignment math are correct; only the per-component baseline/height inputs change.
- **A separate control-height token.** Sizing inputs via an explicit `--ts-ui-control-height` (decoupled from line-height) is a distinct cosmetic feature; here box height is derived from line-height + the control's own padding/border.
- **A per-input `setLineHeight`.** Inputs render one fixed line; no per-instance line-height setter is added. The `Text.setLineHeight` surface stays as-is.
- **Unitless line-height support.** After this change `--ts-ui-line-height` is strictly an integer-px length; the multiplier semantics are removed, not kept as an alternative.
- **`TextArea` multi-line baseline.** `TextArea.getBaseline` returns `null` (replaced-element behaviour) and stays that way; only its line-height rendering inherits the unified token via `TextInput`.
- **Multi-line / description buttons.** Optical centring is single-line only. A `Button` with a rendered description stacks title + description as a block whose centring is left as-is; nudging it would mis-position the two-line group. Glyph-only buttons are likewise excluded.
- **Reworking `Fit`/anchor generally.** The optical offset is confined to `Button`'s own content-row inset. `Fit.doLayout`, `placeComponent`, and `LayoutManager.resolveBounds`'s generic geometric centring are untouched — they remain correct for all non-text anchored content.
