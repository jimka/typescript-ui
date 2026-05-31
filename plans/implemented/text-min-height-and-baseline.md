# Text Minimum Height & ComplexUIPanel Baseline — Implementation Plan

## Overview

Two related defects in `Text` and the framework's baseline machinery:

- **Item A — Minimum height from line height.** `Text` derives its preferred and minimum **height** from the off-screen text probe in [`Text.calculateSize()`](../src/typescript/lib/component/input/Text.ts#L304). That height is the measured line box, but it is only populated *after* the first measurement and is **0 for empty text** and unset before the first `getPreferredSize()`/`getBaseline()` read. A single-line `Text` placed in a layout that can squeeze height (or read `minSize` before measurement) can therefore be clipped below its line height. We give `Text` a guaranteed `minSize.height` floor derived from its theme line height so a one-line label is never truncated vertically.

- **Item B — Baseline bug on ComplexUIPanel.** Panel 2 of [`ComplexUIPanel.buildPanel2()`](../src/typescript/ComplexUIPanel.ts#L63) is a plain `HBox()` of `Text("Title:") / TextField() / Text("First Name:") / …`. The `Text` labels render pushed to the **bottom** of the row (`top: 11px` in a 32px row) instead of aligned with the inputs near the top. Root cause is in [`Util.measureInputBaseline()`](../src/typescript/lib/core/Util.ts#L176): it models the input's inner-text baseline as `borderTop + paddingTop + textBaseline` (a **top-anchored** model), but a native `<input>` **vertically centres** its single line of text. The function over-reports the input baseline (~16–20px) versus the input's true visual baseline (~11px for a 22px input). In [`HBox.doLayout()`](../src/typescript/lib/layout/HBox.ts#L634) the inflated input baseline becomes `rowAscent`, and every text label is then placed at `y = rowAscent − textBaseline`, dragging the labels down. Fixing the input-baseline model corrects the row.

The two items interact: Item B's fix changes how tall a `Text`/`TextField` row is and where the shared baseline lands; Item A's height floor ensures the `Text` still occupies its full line box within that row. Item B is the load-bearing fix for the reported visual bug; Item A is a robustness floor.

---

## Architecture Decisions

### Item B is a measurement bug in `Util`, not in `HBox` or `Text`

The baseline-alignment mechanism ([`HBox.computeRowMetrics`](../src/typescript/lib/layout/LayoutManager.ts#L423), `nullChildY`, the `rowAscent − baseline` placement) is **correct** and must not change. The single wrong input is `Util.measureInputBaseline()` returning a baseline that exceeds the input's centred text position. Evidence (read live from the running ComplexUIPanel, font 14px / line-height 1.2):

| Component | reported height | true visual inner-text baseline | `measureInputBaseline` model |
|---|---|---|---|
| `Text("Title:")` | 17px | 13px (correct) | n/a |
| `TextField()` | 22px | **~11px** (text is vertically centred) | **16–20px** (top-anchored, wrong) |

Because the input baseline is over-reported, `rowAscent` is dominated by the input (≈20 instead of ≈13), and labels land at `y = rowAscent − 13 ≈ 11`, i.e. the bottom of the row. The fix replaces the top-anchored formula with a **centre-anchored** one that matches native input rendering. This is surgical: one function body, no layout or `Text` changes for Item B.

### Centre-anchored input baseline

A native single-line `<input>` with `box-sizing: border-box` centres its line box in the content area. The visual baseline from the input's outer top is therefore:

```
baseline = borderTop + (contentHeight − lineBoxHeight) / 2 + textBaseline
```

where `contentHeight = boxHeight − borderTop − borderBottom − paddingTop − paddingBottom`, and `lineBoxHeight` / `textBaseline` come from `measureTextMetrics("X", { lineHeight: "normal" })` (matching the input's own `line-height: normal`, not the theme's `1.2`). The probe already measures `borderTop`/`paddingTop`; it must additionally read `borderBottom`/`paddingBottom` and the probe's own `boxHeight` (`getBoundingClientRect().height`). The probe `<input>` must keep only `fontFamily`/`fontSize` set so it reflects the UA + theme default height the real inputs use.

This keeps the cache (`inputBaseline`) and `invalidateInputBaselineCache()` exactly as-is — only the computed value changes.

### Item A: a theme-line-height-derived `minSize.height` floor, not a new public property

`Text` already resolves its line height in pixels via the existing private [`readThemeLineHeightPx()`](../src/typescript/lib/component/input/Text.ts#L250) (theme token `--ts-ui-line-height` × font size, fallback `fontSize × 1.2`). The minimum-height floor reuses that value — **no new setter / backing field / `TextOptions` field is introduced**, so there is no CODE_CONVENTIONS typed-setter obligation to discharge. The floor is applied inside `calculateSize()` when writing `_defaultOptions.minSize.height`, and also for the empty-text branch (today empty text reports `minSize.height = 0`). A lone single-line `Text` then always reports `minSize.height ≥ ceil(lineHeightPx)` and cannot be squeezed below one line.

Rejected alternative — a `setMinLineHeight`/`_minLineHeight` public property: nothing in the request needs caller configurability, and CLAUDE.md §2 forbids speculative configurability. The floor is intrinsic to the line height, so it is derived, not configured.

### Width floor is unchanged

Item A is height-only. The existing `minSize.width` logic (the `TEXT_AUTO_MIN_WIDTH_CAP_PX` cap vs. full natural width under `truncate`) is correct and untouched.

---

## Public API (TypeScript Signatures)

No public API changes. Both fixes are internal:

- `Util.measureInputBaseline(): number` — unchanged signature; corrected body.
- `Text` — no new methods/fields; the height floor is applied inside the existing private `calculateSize()`.

---

## Internal Structure

### `Util.measureInputBaseline()` (corrected body shape)

```
remeasureInputBaseline():
    probe = <input>, set fontFamily + fontSize only, append to body
    cs = getComputedStyle(probe)
    borderTop    = parseFloat(cs.borderTopWidth)    || 0
    borderBottom = parseFloat(cs.borderBottomWidth) || 0
    paddingTop   = parseFloat(cs.paddingTop)        || 0
    paddingBottom= parseFloat(cs.paddingBottom)     || 0
    boxHeight    = probe.getBoundingClientRect().height
    remove probe

    // input renders its line at line-height:normal, vertically centred
    m = measureTextMetrics("X", { fontFamily, fontSize, lineHeight: "normal" })
    contentHeight = boxHeight - borderTop - borderBottom - paddingTop - paddingBottom
    lineTop = borderTop + paddingTop + max(0, (contentHeight - m.height) / 2)
    inputBaseline = Math.round(lineTop + m.baseline)
    return inputBaseline
```

Verified against the live DOM this yields ~11px for the 22px ComplexUIPanel inputs (matching the input's centred text), versus the current ~16–20px.

### `Text.calculateSize()` height floor (Item A)

Inside the existing method, after `lineHeightPx` is resolved (it already is, via `_defaultOptions.lineHeight` populated by `readThemeLineHeightPx()`):

- Text branch: `minHeight = Math.max(height, Math.ceil(lineHeightPx))` before writing `_defaultOptions.minSize.height`. Preferred size keeps the measured `height`.
- Empty-text branch: set `_defaultOptions.minSize = { width: 0, height: Math.ceil(lineHeightPx) }` instead of `{0,0}` so even an empty label reserves one line of height. (Baseline stays `null` for empty text — unchanged — so it never drags an HBox row's baseline.)

`lineHeightPx` is read from `getLineHeight()` (already resolved in this method) or `readThemeLineHeightPx()` as the fallback.

---

## Ordered Implementation Steps

1. **Fix `Util.measureInputBaseline` (Item B).** In [`remeasureInputBaseline()`](../src/typescript/lib/core/Util.ts#L240) replace the `borderTop + paddingTop + textMetrics.baseline` formula with the centre-anchored computation above. Read `borderBottom`/`paddingBottom` and the probe `boxHeight` from the same probe; measure `"X"` with `lineHeight: "normal"`. Keep the `inputBaseline` cache field and `invalidateInputBaselineCache()` untouched.

2. **Add the line-height height floor to `Text` (Item A).** In [`Text.calculateSize()`](../src/typescript/lib/component/input/Text.ts#L304):
   - Resolve `lineHeightPx` from `getLineHeight() ?? readThemeLineHeightPx()`.
   - Text branch: floor `_defaultOptions.minSize.height` to `Math.max(height, Math.ceil(lineHeightPx))`.
   - Empty branch: set `_defaultOptions.minSize` height to `Math.ceil(lineHeightPx)` (width stays 0).
   - Do **not** alter the preferred-size or `minSize.width` logic.

3. **Regression checkpoint (grep).** `grep -n "borderTop + paddingTop" src/typescript/lib/core/Util.ts` — expect the input-baseline site to no longer match the old top-anchored form. Confirm `measureLabelBaseline` (labels have no UA chrome, baseline collapses to the typographic baseline) is **unchanged** — labels are not vertically centred like inputs, so its formula stays correct.

4. **Type-check.** `npx tsc --noEmit` — no new errors.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/core/Util.ts](../src/typescript/lib/core/Util.ts) — centre-anchored `measureInputBaseline` |
| Modify | [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — line-height `minSize.height` floor in `calculateSize()` |

---

## Verification

### Build
- `npx tsc --noEmit` — no new errors (ignore any pre-existing unrelated errors).
- `npm run docs:build` — 0 errors and 0 link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning). No public API moved, so no doc edits are expected.

### Manual — ComplexUIPanel (Item B, the reported bug)
Run `npm run dev` (http://localhost:8015), click the **Complex** tab, inspect panel 2 (`Title: / First Name: / Last Name: / Customer Type:` + inputs):
- Each `Text` label's `style.top` is near the **top** of the row (small single-digit px), not `11px`.
- The `Text` label baseline visually aligns with the inputs' inner text (labels and input placeholders share a baseline).
- Row height shrinks from 32px toward ~22–24px (ascent + descent of the corrected baselines).
- Concrete check via DevTools: the offending `span.Text` `style.top` should drop from `11px` to ≈ `2–4px`; the sibling `input` `top` (≈`4px`) and the label `top` should now differ by only ~1–2px, not 7px.

### Manual — single-line Text not clipped (Item A)
- On any panel with a lone single-line `Text` (e.g. the `Text("Select Customer or Contact")` in ComplexUIPanel panel 1, or `Text("Notes:")` in panel 4), confirm the label is not vertically clipped — full glyph ascenders/descenders visible.
- Toggle the theme (the **Switch to classic theme** button on the Misc. panel) and confirm labels still render full-height and inputs/labels stay baseline-aligned after `invalidateInputBaselineCache()` re-runs on theme change.

### Regression — baseline mechanism unchanged elsewhere
Visually confirm no shift on the baseline-sensitive demos (these are the panels the original baseline work used): HBox panel, Binding panel, Misc. panel (RadioButton/ProgressBar/NumberSpinner rows), and the dedicated **Baseline** tab. `Text + TextField`, `Text + ComboBox`, `Text + Button` rows should all baseline-align; pure-graphical rows (ProgressBar only) should still top/centre-fall-back unchanged.

---

## Potential Challenges

- **Cached input baseline staleness.** `inputBaseline` is cached; the corrected value is picked up on the next measurement, and theme changes already call `invalidateInputBaselineCache()`. No extra invalidation needed, but verify after a theme toggle that the new centre-anchored value is used.
- **Probe vs. themed-input chrome mismatch.** The probe `<input>` carries UA defaults plus only font; the real inputs may receive themed border/padding. The centre-anchored model depends mostly on `contentHeight` and centring, which is robust to small border/padding differences, but verify the live ComplexUIPanel numbers (input `top` and label `top` within ~1–2px) after the change rather than trusting the probe alone.
- **`Math.ceil` rounding on the height floor** could add 1px to a row in edge cases; acceptable — it only ever grows the floor, never clips.

---

## Critical Files

- [src/typescript/lib/core/Util.ts](../src/typescript/lib/core/Util.ts) — `measureTextMetrics`, `measureInputBaseline`/`remeasureInputBaseline`, `measureLabelBaseline`, `invalidateInputBaselineCache`.
- [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — `calculateSize`, `readThemeLineHeightPx`, `getLineHeight`, `_defaultOptions.minSize`.
- [src/typescript/lib/component/input/TextInput.ts](../src/typescript/lib/component/input/TextInput.ts#L375) — `getBaseline()` → `wrapInnerBaseline(Util.measureInputBaseline())` (the consumer of the fixed value).
- [src/typescript/lib/layout/HBox.ts](../src/typescript/lib/layout/HBox.ts#L634) and [src/typescript/lib/layout/LayoutManager.ts](../src/typescript/lib/layout/LayoutManager.ts#L407) — `doLayout`, `computeRowMetrics`, `nullChildY`, `computeRowHeight` (read-only; the baseline math is correct and unchanged).
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts#L1640) — `getMinSize` (how `_defaultOptions.minSize` flows out), `wrapInnerBaseline`.
- [src/typescript/ComplexUIPanel.ts](../src/typescript/ComplexUIPanel.ts#L63) — `buildPanel2()`, the demo row exhibiting the bug.

---

## Non-Goals

- No change to the `HBox`/`LayoutManager` baseline algorithm — it is correct; only the input baseline *value* feeding it is wrong.
- No new public `Text` property for minimum line height — the floor is derived from the existing theme line height (CLAUDE.md §2: no speculative configurability).
- No change to `measureLabelBaseline` — bare labels are not vertically centred, so its typographic-baseline formula is already correct.
- No change to `minSize.width` / truncation behaviour — Item A is height-only.
