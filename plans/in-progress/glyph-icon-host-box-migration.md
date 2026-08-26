---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/Checkbox.ts
  - packages/lib/src/typescript/lib/component/input/RadioButton.ts
---

# Glyph Icon Host-Box Migration — Implementation Plan

## Overview

[`plans/implemented/glyph-icon-size-scale.md`](implemented/glyph-icon-size-scale.md) put every free icon-size decision in the framework onto one of five theme-relative `glyphXs`/`glyphSm`/`glyphMd`/`glyphLg`/`glyphXl` steps, but deliberately left four sites alone because each sizes its ink against a *host* that was itself still a fixed pixel constant: `Checkbox`'s check mark, `RadioButton`'s dot, `Scrollbar`'s arrow glyph, and `TableHeader`'s menu-button glyph.

This plan closes that gap for two of the four. `Checkbox`'s 16×16 box ([component/input/Checkbox.ts:19-27](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L19-L27)) and `RadioButton`'s 16×16 ring ([component/input/RadioButton.ts:18-26](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L18-L26)) move onto `glyphLg`; their check/dot ink moves onto `glyphSm`/`glyphXs`, the same steps their pixel values already equal at the shipped base; and the hardcoded centring offsets that place the ink inside the box become a computed function of box size, ink size, and the box's own fixed 1px border, so they stay correct at any `scale.base`.

The other two — `Scrollbar`'s arrow and `TableHeader`'s menu-button glyph — are investigated and left exactly as they are. Both already size their ink directly off `Scrollbar`'s `TRACK_WIDTH` constant ([component/container/Scrollbar.ts:38](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L38)), not off a separate hardcoded literal, so there is no ink-sizing fix needed at either site. The open question this plan resolves is whether `TRACK_WIDTH` itself should become theme-relative. It should not: `TRACK_WIDTH` also sizes the scrollbar's own track, thumb, and arrow-button geometry, and Table's column-width reservation — real interactive/layout dimensions unrelated to icon decoration, only coincidentally equal to `glyphSm` today. `TRACK_WIDTH` stays a fixed pixel constant, documented as a deliberate, investigated decision so the question does not reopen.

---

## Architecture Decisions

### `TRACK_WIDTH` stays a fixed pixel constant — it is not a glyph-icon-size step

`TRACK_WIDTH` is read throughout `Scrollbar.ts`, and imported into `Table.ts`, `Header.ts`, and `layout/Table.ts` besides. Only two of its uses size a glyph: `_defaultScrollArrowGlyphOptions`'s `minSize`/`maxSize` and `ScrollArrowButton`'s own `setPreferredSize` call ([Scrollbar.ts:130-131](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L130-L131), [:234](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L234)). Every other use sizes real widget geometry: `ScrollArrowButton`'s own hit-target width/height ([:213-214](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L213-L214)), the `Scrollbar` component's own width/height ([:576](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L576), [:578](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L578)), the thumb's cross-axis size ([:591](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L591), [:595](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L595)), the arrow-region math in `setMetrics`/`getTrackLength`/`getTrackOrigin`/`_onTrackClick` ([:869](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L869), [:1008](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L1008), [:1021](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L1021), [:1213](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L1213)), the public `getTrackWidth()` accessor ([:905](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L905)), `Table`'s column-width reservation ([component/table/Table.ts:790](packages/lib/src/typescript/lib/component/table/Table.ts#L790)), and `layout/Table.ts`'s header menu-button band width ([layout/Table.ts:388](packages/lib/src/typescript/lib/layout/Table.ts#L388)).

Redefining `TRACK_WIDTH` in terms of a glyph step would move all of that geometry too — the scrollbar's touch target, the table's column width, and the header's reserved band — for a reason (icon decoration) that has nothing to do with any of it.[^track-width-not-icon] `TRACK_WIDTH` stays exactly as it is: `export const TRACK_WIDTH = 12;` ([Scrollbar.ts:38](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L38)), unedited.

### Scrollbar's arrow and TableHeader's menu glyph need no code change

Both already read their size directly off `TRACK_WIDTH` — `ScrollArrowGlyph`'s `minSize`/`maxSize` and `ScrollArrowButton`'s `setPreferredSize({width: TRACK_WIDTH, height: TRACK_WIDTH})`, and `TableHeaderMenuButton`'s `this.pinGlyphSize(Math.max(1, TRACK_WIDTH - MENU_BUTTON_CHROME_PX))` ([component/table/Header.ts:144](packages/lib/src/typescript/lib/component/table/Header.ts#L144)) — not off an independently hardcoded literal. `plans/implemented/glyph-icon-size-scale.md`'s Non-Goals footnote read this as "ink fitted inside a fixed host graphic" needing a future fix; the fix it imagined (putting the *host* on the scale) turns out to be the same decision as the `TRACK_WIDTH` question above, which this plan answers no. Since the ink already tracks its host exactly, nothing at either site needs to change.

A one-time doc comment on `TRACK_WIDTH`'s declaration records this so a future reader does not reopen the question without new information. See `## Ordered Implementation Steps` step 1.

### Checkbox's box and RadioButton's ring move onto `glyphLg`; their ink onto `glyphSm`/`glyphXs`

Both boxes are 16×16 today ([Checkbox.ts:19-22](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L19-L22), [RadioButton.ts:18-21](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L18-L21)) — the exact px `glyphLg` resolves to at the shipped base. The check glyph is 12×12 (`glyphSm`) and the radio dot is 8×8 (`glyphXs`). Because every glyph step is a ratio of the same `scale.base`, the box-to-ink ratio (`glyphSm`/`glyphLg` = 0.75, `glyphXs`/`glyphLg` = 0.5) holds at any base, so no shipped theme's rendered pixels change — the same "recover current px at base 14" invariant the parent plan established.[^ratio-invariant]

### The hardcoded centring offset becomes a computed function of box, border, and ink size

`Checkbox`'s check sits at `setX(1)`/`setY(1)` today, justified in the file's own comment as `(14 − 12) / 2`, where 14 is the box's 14×14 padding box (16×16 outer minus the box's own 1px border on each side) and 12 is the check's ink size ([Checkbox.ts:231-234](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L231-L234)). `RadioButton`'s dot at `setX(3)`/`setY(3)` is the same formula with an 8px dot. Both literals are correct only because box size, border, and ink size are all fixed today; once the box and ink both move onto theme-relative steps, a literal offset would miscentre the ink the moment `scale.base` changes.

The fix generalises the formula the comment already states: `offset = (boxSize − 2 × borderPx − inkSize) / 2`, computed once per construction from the same live theme snapshot that resolves `boxSize` and `inkSize`, so the three numbers can never disagree. The border stays a fixed 1px regardless of theme — it is a decorative line width embedded in `_defaultCheckboxBoxOptions.border`'s `"1px solid …"` string, not an icon-scale concept — so it becomes a named constant (`CHECKBOX_BOX_BORDER_PX` / `RADIO_RING_BORDER_PX`, both `1`) rather than a step.

| Quantity | Source | @ base 14 | @ base 28 |
|---|---|---|---|
| Box / ring edge | `glyphLg` | 16 | 32 |
| Border (fixed, not a step) | `CHECKBOX_BOX_BORDER_PX` / `RADIO_RING_BORDER_PX` | 1 | 1 |
| Check ink | `glyphSm` | 12 | 24 |
| Dot ink | `glyphXs` | 8 | 16 |
| Check offset `(box−2·border−check)/2` | — | 1 | 3 |
| Dot offset `(ring−2·border−dot)/2` | — | 3 | 7 |

Both columns reproduce the existing hardcoded values at base 14 exactly, and stay centred at base 28 with no clipping (ink always fits inside the padding box because the ratios are fixed).

### `CheckboxDash` keeps its own fixed size, but its position must still be recomputed

`CheckboxDash` (the indeterminate-state bar, 8×2, positioned at `setX(3)`/`setY(6)`) is not a glyph icon — it is a plain decorative `Component`, not a `Glyph` — so its own width and height stay fixed pixels, the same call the parent plan made for `Notification`'s badge box and paddings.[^dash-not-an-icon] But it lives inside the same box `CheckboxBox` now resolves theme-relatively, and its `x`/`y` offsets are the same "centre inside the padding box" formula as the check glyph's, just against its own fixed 8×2 size. Leaving those two literals unchanged would silently miscentre the dash the instant a theme raises `scale.base` — the exact class of correctness risk this plan exists to close. Both offsets are recomputed alongside the check glyph's, from the same `boxSize` read.

| Quantity | @ base 14 | @ base 28 |
|---|---|---|
| Dash size (fixed) | 8 × 2 | 8 × 2 |
| Dash x-offset `(box−2·border−8)/2` | 3 | 11 |
| Dash y-offset `(box−2·border−2)/2` | 6 | 14 |

### Per-construction resolution, file-local functions — same shape as `glyph-icon-size-scale.md`

`_defaultCheckboxBoxOptions`/`_defaultCheckboxCheckGlyphOptions`/`_defaultRadioButtonRingOptions`/`_defaultRadioButtonDotOptions` are module-level object literals, evaluated once when the module loads — before any application `setTheme()` call. Freezing a theme-relative size into one would pin every checkbox/radio button in the process to whatever theme was active at import time. Each becomes a file-local function called fresh at each construction, exactly the conversion `plans/implemented/glyph-icon-size-scale.md` already applied to `Glyph`'s own `GLYPH_DEFAULT_SIZE` and to `ComboBoxCaret`/`WindowHeader`'s title glyph.[^glyph-precedent] No shared cross-file helper is introduced — each file keeps its own small functions, matching how `CHECKBOX_CHECK_SIZE` and `RADIO_DOT_SIZE` were already separate, parallel constants rather than one shared one.

`CheckboxBox`/`CheckboxCheckGlyph`/`RadioButtonRing`/`RadioButtonDot` each compute their own size via their own function, independently of `Checkbox`'s/`RadioButton`'s own constructor (which also calls the same functions for its imperative `setSize`/`setPreferredSize`/offset calls). `ThemeManager.getResolvedScale()` returns one live, memoized snapshot between `setTheme()` calls, so two independent reads inside the same synchronous `new Checkbox()` call are always identical — the exact pattern `Scrollbar.ts` already relies on for `TRACK_WIDTH` (read independently in `_defaultScrollArrowGlyphOptions` and in `ScrollArrowButton`'s own constructor, ten lines apart).

---

## Internal Structure

### `Checkbox.ts` — new file-local functions (replacing the frozen constants)

```typescript
// Physical width of `_box`'s own border on every side — fixed regardless of
// theme, matching the "1px" embedded in `_defaultCheckboxBoxOptions.border`
// below. Named so the ink-centring formula in the constructor states its
// intent instead of repeating a bare "1".
const CHECKBOX_BOX_BORDER_PX = 1;

/**
 * Square edge length of `_box` — the theme's `glyphLg` icon step (16px at
 * the shipped base). Resolved per construction, not frozen in a module
 * constant, so a `setTheme` that runs before the box is built is honoured —
 * mirrors `Glyph`'s own `glyphDefaultSize()` (component/display/Glyph.ts).
 */
function checkboxBoxSizePx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

/**
 * Square edge length of the check glyph's ink — the theme's `glyphSm` icon
 * step (12px at the shipped base), fitted inside `_box`'s `glyphLg` padding
 * box.
 */
function checkboxCheckSizePx(): number {
    return ThemeManager.getResolvedScale().glyphSm;
}
```

`_defaultCheckboxBoxOptions` drops its `preferredSize`/`minSize`/`maxSize` keys (moved to `CheckboxBox`'s own constructor); `_defaultCheckboxCheckGlyphOptions` drops `minSize`/`maxSize` the same way, keeping only `foregroundColor`.

### `CheckboxBox` / `CheckboxCheckGlyph` constructors

```typescript
class CheckboxBox extends Component {
    // … ownStyleStates unchanged …

    constructor() {
        const size = checkboxBoxSizePx();

        super(undefined, {
            ..._defaultCheckboxBoxOptions,
            preferredSize: { width: size, height: size },
            minSize:       { width: size, height: size },
            maxSize:       { width: size, height: size },
        });
    }
    // … applyState/render unchanged …
}

class CheckboxCheckGlyph extends Glyph {
    constructor() {
        const size = checkboxCheckSizePx();

        super("check", undefined, {
            ..._defaultCheckboxCheckGlyphOptions,
            minSize: { width: size, height: size },
            maxSize: { width: size, height: size },
        });
    }
}
```

### `Checkbox`'s own constructor — box/check/dash setup

Replace the box/check/dash block (current [Checkbox.ts:222-245](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L222-L245)) with:

```typescript
const boxSize   = checkboxBoxSizePx();
const checkSize = checkboxCheckSizePx();

this._box = new CheckboxBox();
// Min = preferred = max so the outer HBox shrink-on-overallocation
// can't collapse the box graphic when the checkbox sits next to
// flexible siblings.
this._box.setSize({ width: boxSize, height: boxSize });

this._check = new CheckboxCheckGlyph();
this._check.setPreferredSize({ width: checkSize, height: checkSize });
this._check.setMaxSize({ width: checkSize, height: checkSize });
// With box-sizing: border-box and the CHECKBOX_BOX_BORDER_PX box border,
// absolute children are positioned relative to the box's padding edge —
// centring an inkSize graphic inside a boxSize box means
// (boxSize − 2 × CHECKBOX_BOX_BORDER_PX − inkSize) / 2. `boxSize` and
// `checkSize` both come from the same live theme snapshot, so this stays
// correct at any `scale.base`.
const checkOffset = (boxSize - 2 * CHECKBOX_BOX_BORDER_PX - checkSize) / 2;
this._check.setX(checkOffset);
this._check.setY(checkOffset);
this._check.setOpacity(0);
// Pass-through so clicks on the glyph still hit the box underneath.
this._check.setPointerEvents("none");

this._dash = new CheckboxDash();
this._dash.setSize({ width: 8, height: 2 });
// Same centring formula as `_check`, against the dash's own fixed 8×2 size
// — the dash is a decorative bar, not a glyph icon, so its size stays a
// fixed pixel constant even though its position must still track the
// now-theme-relative box.
this._dash.setX((boxSize - 2 * CHECKBOX_BOX_BORDER_PX - 8) / 2);
this._dash.setY((boxSize - 2 * CHECKBOX_BOX_BORDER_PX - 2) / 2);
this._dash.setOpacity(0);
this._dash.setPointerEvents("none");
```

### `RadioButton.ts` — the mirrored conversion

Same shape as `Checkbox.ts`, one level shallower (no dash equivalent):

```typescript
// Physical width of `_ring`'s own border on every side — fixed regardless
// of theme; mirrors `Checkbox.ts`'s `CHECKBOX_BOX_BORDER_PX`.
const RADIO_RING_BORDER_PX = 1;

/**
 * Square edge length of `_ring` — the theme's `glyphLg` icon step (16px at
 * the shipped base). Resolved per construction; mirrors `Checkbox.ts`'s
 * `checkboxBoxSizePx()`.
 */
function radioRingSizePx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

/**
 * Square edge length of the dot's ink — the theme's `glyphXs` icon step
 * (8px at the shipped base), fitted inside `_ring`'s `glyphLg` padding box.
 */
function radioDotSizePx(): number {
    return ThemeManager.getResolvedScale().glyphXs;
}
```

`_defaultRadioButtonRingOptions` drops its `preferredSize`/`minSize`/`maxSize` keys; `_defaultRadioButtonDotOptions` drops `minSize`/`maxSize`, keeping only `foregroundColor` — same trims as `Checkbox.ts`.

```typescript
class RadioButtonRing extends Component {
    // … ownStyleStates unchanged …

    constructor() {
        const size = radioRingSizePx();

        super(undefined, {
            ..._defaultRadioButtonRingOptions,
            preferredSize: { width: size, height: size },
            minSize:       { width: size, height: size },
            maxSize:       { width: size, height: size },
        });
    }
    // … applyState/render unchanged …
}

class RadioButtonDot extends Glyph {
    constructor() {
        const size = radioDotSizePx();

        super("circle", undefined, {
            ..._defaultRadioButtonDotOptions,
            minSize: { width: size, height: size },
            maxSize: { width: size, height: size },
        });
    }
}
```

Replace the ring/dot setup block in `RadioButton`'s own constructor (current [RadioButton.ts:170-183](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L170-L183)) with:

```typescript
const ringSize = radioRingSizePx();
const dotSize  = radioDotSizePx();

this._ring = new RadioButtonRing();
// Min = preferred = max so the outer HBox shrink-on-overallocation
// can't collapse the ring graphic when the radio is packed into a
// tight container with siblings that have flexible widths.
this._ring.setSize({ width: ringSize, height: ringSize });

this._dot = new RadioButtonDot();
this._dot.setPreferredSize({ width: dotSize, height: dotSize });
this._dot.setMaxSize({ width: dotSize, height: dotSize });
// Centres the dot inside `_ring`'s padding box — same formula as
// `Checkbox.ts`'s `_check` offset. `ringSize` and `dotSize` come from the
// same live theme snapshot, so this stays correct at any `scale.base`.
const dotOffset = (ringSize - 2 * RADIO_RING_BORDER_PX - dotSize) / 2;
this._dot.setX(dotOffset);
this._dot.setY(dotOffset);
this._dot.setOpacity(0);
// Pass-through so clicks on the dot still hit the ring underneath.
this._dot.setPointerEvents("none");
```

### `Scrollbar.ts` — documenting the decision, no functional change

Append to the comment above `export const TRACK_WIDTH = 12;` ([Scrollbar.ts:30-38](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L30-L38)):

```typescript
//
// Deliberately not one of `Theme["scale"]`'s `glyph*` icon-size steps
// (plans/implemented/glyph-icon-size-scale.md), even though it numerically
// equals `glyphSm` in every shipped theme today. This value sizes the
// scrollbar's own physical track/thumb/arrow-button geometry — an
// ergonomic touch-target width, not a decorative icon size — and also sets
// Table's column-width reservation (Table.ts:getAvailableColumnWidth) and
// the header menu-button band width (layout/Table.ts). The arrow glyph
// (ScrollArrowGlyph, below) and the table header's menu-button glyph
// already size their ink directly off this constant, so both would follow
// automatically if it ever became theme-relative — but that is a distinct
// decision from the icon scale, investigated and rejected in
// plans/glyph-icon-host-box-migration.md.
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`** — append the doc comment from `## Internal Structure` above `export const TRACK_WIDTH = 12;` (line 38). No code change. *Check:* `npm run typecheck` — unaffected.

2. **`packages/lib/tests/component/GlyphIconScale.test.ts`** — update ahead of the source change, so the new assertions fail first:
   - In the file's header comment (lines 3-9), change "the sites deliberately left off the scale (a fixed-host fit, or Button's own per-instance derivation)" to name only `Scrollbar`'s arrow, `TableHeader`'s menu glyph, and `Button`'s own icon as staying off the scale.
   - In `describe('glyph icon steps after scale.base is raised to 28', …)` (line 84), add:
     ```typescript
     it("a Checkbox's box and check glyph grow together (32 box, 24 ink, centred)", () => {
         const checkbox = track(new Checkbox()) as unknown as { _box: Component; _check: Component };

         expect(checkbox._box.getWidth()).toBe(32);
         expect(checkbox._box.getHeight()).toBe(32);
         expect(checkbox._check.getPreferredSize()).toEqual({ width: 24, height: 24 });
         expect(checkbox._check.getX()).toBe(3);
         expect(checkbox._check.getY()).toBe(3);
     });

     it("a Checkbox's indeterminate dash stays centred as the box grows", () => {
         const checkbox = track(new Checkbox()) as unknown as { _dash: Component };

         expect(checkbox._dash.getX()).toBe(11);
         expect(checkbox._dash.getY()).toBe(14);
     });

     it("a RadioButton's ring and dot grow together (32 ring, 16 ink, centred)", () => {
         const radio = track(new RadioButton()) as unknown as { _ring: Component; _dot: Component };

         expect(radio._ring.getWidth()).toBe(32);
         expect(radio._ring.getHeight()).toBe(32);
         expect(radio._dot.getPreferredSize()).toEqual({ width: 16, height: 16 });
         expect(radio._dot.getX()).toBe(7);
         expect(radio._dot.getY()).toBe(7);
     });
     ```
   - In `describe('glyph icon steps at the default base (14)', …)` (line 64), add two regression guards for the pre-existing centring offsets:
     ```typescript
     it("a Checkbox's check glyph is centred at the historical (1,1) offset", () => {
         const checkbox = track(new Checkbox()) as unknown as { _check: Component };

         expect(checkbox._check.getX()).toBe(1);
         expect(checkbox._check.getY()).toBe(1);
     });

     it("a RadioButton's dot is centred at the historical (3,3) offset", () => {
         const radio = track(new RadioButton()) as unknown as { _dot: Component };

         expect(radio._dot.getX()).toBe(3);
         expect(radio._dot.getY()).toBe(3);
     });
     ```
   - In `describe('fixed-host icons stay off the scale at base 28', …)` (line 115): delete the two `it(...)` blocks for the Checkbox check glyph (lines 118-124) and the RadioButton dot (lines 126-132) — they move to the "grows with the scale" block above. Keep the Scrollbar-arrow and TableHeader-menu-glyph cases unchanged. Update the block's leading comment (lines 112-114) to say "The two fixed-host icons and Button's own per-instance icon" instead of "four", and add one sentence: both remaining cases are pinned to `Scrollbar`'s `TRACK_WIDTH`, an ergonomic track-width constant distinct from the icon scale (see `plans/glyph-icon-host-box-migration.md`), not a fixed-host argument of their own.
   *Check:* `npx vitest run tests/component/GlyphIconScale.test.ts` from `packages/lib` — the three new base-28 cases fail (`Checkbox`/`RadioButton` still hardcode 16/12/8); the two new base-14 regression guards and the untouched Scrollbar/TableHeader cases pass.

3. **`packages/lib/src/typescript/lib/component/input/Checkbox.ts`**:
   - Add `import { ThemeManager } from "~/core/Theme.js";` near the other `~/core/*` imports.
   - Apply the `CHECKBOX_BOX_BORDER_PX` / `checkboxBoxSizePx()` / `checkboxCheckSizePx()` conversion from `## Internal Structure`, trimming `preferredSize`/`minSize`/`maxSize` out of `_defaultCheckboxBoxOptions` and `minSize`/`maxSize` out of `_defaultCheckboxCheckGlyphOptions`.
   - Update `CheckboxBox`'s and `CheckboxCheckGlyph`'s constructors per `## Internal Structure`.
   - Replace the box/check/dash setup block in `Checkbox`'s own constructor (lines 222-245) per `## Internal Structure`.
   - Reword the "16 × 16 graphic" comment (line 262) to "the visible box graphic" — it is no longer always 16×16.
   *Check:* `npm run typecheck`.

4. **`packages/lib/src/typescript/lib/component/input/RadioButton.ts`** — apply the conversion from `## Internal Structure`'s "`RadioButton.ts` — the mirrored conversion" subsection verbatim: add the `ThemeManager` import; add `RADIO_RING_BORDER_PX`, `radioRingSizePx()`, `radioDotSizePx()`; trim `_defaultRadioButtonRingOptions` and `_defaultRadioButtonDotOptions`; update `RadioButtonRing`'s and `RadioButtonDot`'s constructors; replace the ring/dot setup block in `RadioButton`'s own constructor (lines 170-183); reword the "16 × 16 graphic" comment (line 198) to "the visible ring graphic".
   *Check:* `npm run typecheck`; `npx vitest run tests/component/GlyphIconScale.test.ts` — every case from step 2 now passes.

5. **Regression greps.**
   ```
   grep -n 'CHECKBOX_CHECK_SIZE\|RADIO_DOT_SIZE' packages/lib/src/typescript/lib/component/input/Checkbox.ts packages/lib/src/typescript/lib/component/input/RadioButton.ts   # zero
   grep -n 'width: 16, height: 16' packages/lib/src/typescript/lib/component/input/Checkbox.ts packages/lib/src/typescript/lib/component/input/RadioButton.ts   # zero
   ```

6. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib` — every existing size/CSS-dedup assertion for `Checkbox`/`RadioButton` (`tests/component/input/Checkbox.test.ts`, `tests/component/input/RadioButton.test.ts`, `tests/component/default-options-fallback.test.ts`'s `Checkbox`/`RadioButton` rows) stays green unedited, since the default theme resolves every step to the exact value each site hardcoded before.

7. **`packages/lib/docs/reference/changelog/next.md`** — see `## Documentation Impact`.

8. **Manual browser verification.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/tests/component/GlyphIconScale.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-7 are unit-testable offline, following the same recording-DOM-sink harness `GlyphIconScale.test.ts` already uses. Row 8 needs a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `new Checkbox()`'s `_box` size at the default base | `16×16` — unchanged from before this plan |
| 2 | Same, after `setTheme` raises `scale.base` to 28 | `32×32` |
| 3 | `new Checkbox()`'s `_check` preferred size and `(x, y)` at the default base | `12×12` at `(1, 1)` — unchanged |
| 4 | Same, at base 28 | `24×24` at `(3, 3)` |
| 5 | `new Checkbox()`'s `_dash` `(x, y)` at base 28 | `(11, 14)` |
| 6 | `new RadioButton()`'s `_ring` size and `_dot` preferred size / `(x, y)` at the default base | `16×16` ring, `8×8` dot at `(3, 3)` — unchanged |
| 7 | Same, at base 28 | `32×32` ring, `16×16` dot at `(7, 7)` |
| 8 | Manual — a `Scrollbar` arrow glyph and a `TableHeader` menu-button glyph at both bases | Unchanged pixel size at every base — `TRACK_WIDTH` never moves |
| 9 | Manual — live app: checkboxes and radio buttons in a form, a `Tree`'s row checkboxes, a menu's `CheckboxMenuRow`/`RadioMenuRow` | Every check/dot renders centred inside its box at the shipped theme; after `setTheme` with `scale.base: 28`, newly-constructed instances render a proportionally larger box with a centred, proportionally larger check/dot |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants — step 5's two greps, each expecting zero matches.

**Manual browser verification (row 9) is required.** The offline harness records writes; it does not run a CSS cascade, so nothing in it can show a clipped or off-centre check mark or dot.

- Start a dev server on a spare port from *this worktree* (symlink `node_modules` to the repo root first if this worktree has none), and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Visit a screen with checkboxes and radio buttons (e.g. a form demo), a `Tree` with row checkboxes, and a menu with a `CheckboxMenuRow`/`RadioMenuRow`. Read computed `width`/`height` on one checkbox box and one radio ring, and confirm each matches its pre-change value (16×16).
- From the browser console, `ThemeManager.setTheme(defineTheme(ModernTheme, { scale: { base: 28 } }))`, then construct or re-render fresh checkboxes/radio buttons (existing instances built before the call keep their old size — see `## Potential Challenges`). Confirm the box/ring is 32×32, the check/dot is centred with no clipping, and the indeterminate dash (toggle a checkbox to indeterminate) stays centred too.

---

## Documentation Impact

No exported symbol, signature, or public API changes. `packages/lib/docs/reference/changelog/next.md`'s "Changed → Components" section already carries a bullet from `plans/implemented/glyph-icon-size-scale.md` (lines 436-443) whose final sentence reads:

> The icons still sized against a fixed host graphic — a checkbox's check, a radio button's dot, a scrollbar arrow, a table header's menu icon — and a `Button`'s leading icon, which tracks its own label's line box, are deliberately not on the scale.

That sentence is the only part to edit — the bullet's opening ("Every framework icon that previously hardcoded its pixel size now reads one of five named icon steps…") stays as it is. Replace just the quoted sentence to drop the two items this plan migrates and explain why the remaining two are different in kind, not just still pending:

> The icons still sized against a fixed host graphic — a scrollbar arrow and a table header's menu icon, both pinned to `Scrollbar`'s `TRACK_WIDTH` track-width constant, an ergonomic touch-target quantity investigated and confirmed independent of the icon scale — and a `Button`'s leading icon, which tracks its own label's line box, are deliberately not on the scale.

Add one new bullet to the same "### Components" section:

> **A `Checkbox`'s box and check mark, and a `RadioButton`'s ring and dot, now read the `glyphLg`/`glyphSm`/`glyphXs` icon steps** instead of hardcoded 16/12/8px literals, so both grow under a raised `scale.base`. The ink-centring offset that places the check/dot (and, for `Checkbox`, its indeterminate dash) inside the box is now computed from the box and ink sizes rather than a fixed pixel, so it stays centred at any base. Sizes under the shipped themes are unchanged.

---

## Potential Challenges

- **Existing instances don't follow a live theme change.** Like every site the parent plan converted, `Checkbox`/`RadioButton` read their step at construction time, with no re-pin on `setTheme`. A checkbox built before a runtime `setTheme` call keeps its old size until reconstructed. Mitigation: the manual check constructs fresh instances after switching themes rather than judging stale ones (see `## Verification`).
- **`GlyphIconScale.test.ts`'s existing "fixed-host" block must move in lockstep with the source change**, or the moved test cases either fail against the still-unconverted code (if edited first, intentional — this is the test-first step) or silently pass against dead code (if the block isn't pruned). Step 2 makes the deletion explicit so nothing is left duplicated between the two `describe` blocks.
- **A future, much larger `scale.base` could shrink the padding box toward the ink size.** The ratios (`glyphSm`/`glyphLg` = 0.75, `glyphXs`/`glyphLg` = 0.5) keep ink comfortably inside the box at every base a shipped theme uses; no shipped theme sets an extreme `scale.base`, and this plan adds no clamp, matching how the parent plan left the same class of edge case unhandled elsewhere.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/component/input/Checkbox.ts`](packages/lib/src/typescript/lib/component/input/Checkbox.ts) | `_defaultCheckboxBoxOptions` (19-27), `CheckboxBox` (52-118), `CHECKBOX_CHECK_SIZE`/`_defaultCheckboxCheckGlyphOptions` (120-129), `CheckboxCheckGlyph` (145-149), `CheckboxDash` (151-162), and the constructor's box/check/dash setup (222-245) — every site this plan edits. |
| [`packages/lib/src/typescript/lib/component/input/RadioButton.ts`](packages/lib/src/typescript/lib/component/input/RadioButton.ts) | The mirrored structure: `_defaultRadioButtonRingOptions` (18-26), `RadioButtonRing` (42-78), `RADIO_DOT_SIZE`/`_defaultRadioButtonDotOptions` (80-89), `RadioButtonDot` (103-107), and the constructor's ring/dot setup (170-183). |
| [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) | `TRACK_WIDTH` (38) and every one of its uses — the evidence for why it stays fixed; `_defaultScrollArrowGlyphOptions`/`ScrollArrowButton` (129-165, 210-257) — the precedent for reading one canonical source independently from two constructors. |
| [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) | `TableHeaderMenuButton`'s `pinGlyphSize(Math.max(1, TRACK_WIDTH - MENU_BUTTON_CHROME_PX))` (144) — confirms the menu glyph already tracks `TRACK_WIDTH` directly. |
| [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) | `getAvailableColumnWidth()` (787-791) — one of `TRACK_WIDTH`'s non-glyph consumers, evidence for the Architecture Decision. |
| [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) | The header menu-button band width math (360-402) — another non-glyph `TRACK_WIDTH` consumer. |
| [`packages/lib/src/typescript/lib/component/display/Glyph.ts`](packages/lib/src/typescript/lib/component/display/Glyph.ts) | `glyphDefaultSize()` (172-183) and the constructor (262-283) — the precedent this plan's per-construction functions mirror exactly. |
| [`plans/implemented/glyph-icon-size-scale.md`](implemented/glyph-icon-size-scale.md) | The scale mechanism, the five steps' ratios, and the Non-Goal this plan resolves — read in full before this plan, not re-derived here. |
| [`packages/lib/tests/component/GlyphIconScale.test.ts`](packages/lib/tests/component/GlyphIconScale.test.ts) | The existing end-to-end coverage this plan edits in place, including the harness (`installTestDOM`, `track`/`constructed` disposal, the `ModernTheme` restore in `afterEach`). |

---

## Non-Goals

- **Moving `Scrollbar`'s arrow ink or `TableHeader`'s menu-button ink onto a glyph step.** Investigated and rejected — both already track `TRACK_WIDTH` directly, and `TRACK_WIDTH` itself stays fixed (see `## Architecture Decisions`).
- **`CheckboxDash`'s own width/height joining the icon scale.** It is a decorative bar, not a `Glyph`, the same category as `Notification`'s badge box and paddings, which the parent plan also left fixed. Only its position is fixed by this plan, not its size.
- **`Toggle`'s or `Slider`'s thumb geometry**, both also hardcoded at 16×16. Neither is a glyph-icon-inside-a-host-box case — the thumb *is* the control's whole moving part, not ink fitted inside a separate host — and neither was named in `glyph-icon-size-scale.md`'s Non-Goals list this plan follows up on.
- **Re-pinning existing `Checkbox`/`RadioButton` instances on a live theme change.** A step is read once, at construction — matching every other site the parent plan converted. Adding a theme listener to every checkbox/radio button is a separate change with its own listener-teardown cost.
- **The cross-class CSS-trait dedup a parallel plan (`glyph-icon-trait-dedup.md`) may propose** for `Checkbox`/`RadioButton`/`Scrollbar`/`TableHeader` now that some of them share real theme-relative sizes. That plan is a follow-on to this one, not a prerequisite; this plan only changes what number each site computes.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

**`CheckboxBox`/`RadioButtonRing` needed an explicit `setMinSize`/`setMaxSize` call the plan's `## Internal Structure` snippets didn't show.** The plan's constructor snippets for `Checkbox`/`RadioButton` call only `this._box.setSize(...)` / `this._ring.setSize(...)` after constructing the box/ring. The mandatory manual browser verification (`## Verification`, row 9) surfaced a real rendering bug this left in place: `CheckboxBox`'s and `RadioButtonRing`'s `minSize`/`maxSize` are declared only via constructor-time `subclassDefaults`, and `ClassStyleRules.ts`'s `ensureClassStyleRule` caches the resulting `.CheckboxBox`/`.RadioButtonRing` class-level CSS rule once per constructor, keyed in a module-level `_bags` map (`if (existing !== undefined) return existing;`) — permanently, from whichever instance is constructed first in the page's lifetime. Since CSS `max-width`/`max-height` clamp `width`/`height` regardless of specificity, any box/ring instance constructed *after* a `setTheme` call raises `scale.base` still rendered at the stale first-cached size, even though its own `getPreferredSize()`/`_width`/`_height` fields correctly reported the new value — a silent mismatch between logical and rendered size the offline test harness cannot see, because it only reads those JS fields and never runs a real CSS cascade.

The fix mirrors the pattern the same two constructors already use for `_check`/`_dot`: an explicit `setPreferredSize`/`setMaxSize` call on the already-constructed child populates an instance-level style bag that correctly overrides a stale class-cached default (this is why `_check`/`_dot`, both `Glyph` subclasses, never exhibited the bug — `Checkbox`'s/`RadioButton`'s own constructors already call `setPreferredSize`/`setMaxSize` on them). Added `this._box.setMinSize(...)`/`this._box.setMaxSize(...)` in `Checkbox`'s constructor and the mirrored `this._ring.setMinSize(...)`/`this._ring.setMaxSize(...)` in `RadioButton`'s constructor, immediately after each one's existing `setSize(...)` call, each passed the same `boxSize`/`ringSize` already in scope. Verified live in a real browser (dev server serving this worktree): before the fix, a `Checkbox`/`RadioButton` constructed after `setTheme({scale:{base:28}})` rendered its box/ring clamped at 16×16 despite `getPreferredSize()` reporting 32×32; after the fix, `getBoundingClientRect()` on the real DOM element reports 32×32 for box/ring, 24×24/16×16 for check/dot ink, with centring offsets (3,3)/(7,7) and the indeterminate dash at (11,14) — matching `## Expected Behaviour` rows 4/5/7 exactly, with base-14 defaults (rows 1/3/6) unchanged.

**Manual verification (`## Verification`, rows 8-9) was performed**, not skipped: a dev server was started from this worktree (`packages/lib`, confirmed via `readlink /proc/<pid>/cwd`), and fresh `Checkbox`/`RadioButton`/`Scrollbar` instances were constructed through the real component tree and mounted via `DOM.sink.mountView` for direct DOM measurement. Row 8 (`Scrollbar` arrow, unaffected by `scale.base`) was confirmed at 12×12 at base 28. Row 9's centring/no-clipping checks are the same measurements described above.

---

## Notes

[^track-width-not-icon]: Enumerated from `Scrollbar.ts` directly: `_defaultScrollArrowGlyphOptions` (130-131) and `ScrollArrowButton`'s own `setPreferredSize` call on its glyph (234) are the only two glyph-sizing uses. Every other use sizes the scrollbar's own physical geometry, none of it decorative: `ScrollArrowButton`'s own hit-target `setWidth`/`setHeight` (213-214), `Scrollbar`'s own `setWidth`/`setHeight` (576, 578), `_thumb.setWidth`/`setHeight` (591, 595), `setMetrics`'s `endPos` (869), `getTrackLength`'s inset (1008), `getTrackOrigin` (1021), `_onTrackClick`'s click-region test (1213), and the public `getTrackWidth()` accessor (905). `Table.ts:790`'s `getAvailableColumnWidth()` and `layout/Table.ts:388`'s header-band `trackW` read the same exported constant for column-width and header-band math with no glyph involved at all. A theme-relative `TRACK_WIDTH` would resize a table's columns and a scrollbar's touch target every time an icon-scale designer wanted a different icon size — coupling two design axes (ergonomic touch-target sizing and decorative icon sizing) that only coincide at 12px today by accident, the exact class of coincidence this whole thread of work has been correcting elsewhere.

[^ratio-invariant]: `glyphLg` = `{scale: 16/14}`, `glyphSm` = `{scale: 12/14}`, `glyphXs` = `{scale: 8/14}` ([core/themes/BaseTheme.ts](packages/lib/src/typescript/lib/core/themes/BaseTheme.ts)) — each a ratio of the same `scale.base`, so `glyphSm / glyphLg` and `glyphXs / glyphLg` are constant (0.75 and 0.5) at any base. Verified at base 28: `glyphLg` → 32, `glyphSm` → 24, `glyphXs` → 16 — the same 0.75/0.5 ratios as at base 14 (16/12/8).

[^dash-not-an-icon]: `plans/implemented/glyph-icon-size-scale.md`'s own `## Non-Goals` left `Notification`'s 320×64 body, its paddings, and its 12px `badgeY` as fixed pixels alongside the (then-fixed) 20px badge icon itself, reasoning that "sizing the whole toast is out of scope." `CheckboxDash` is the same shape: a plain `Component` bar, not a `Glyph`, whose size is a decorative constant rather than an icon-scale decision. This plan follows that precedent for the dash's *size*; its *position*, unlike the toast's paddings, is addressed here because it is a direct, mechanical consequence of the box becoming theme-relative — a bug this plan would otherwise introduce, not a pre-existing fixed quantity it chooses to leave alone.

[^glyph-precedent]: `plans/implemented/glyph-icon-size-scale.md`'s `## Architecture Decisions` ("Each migrated file replaces its constant with a file-local function") and `## Internal Structure` ("The file-local accessor shape") establish the pattern verbatim: a module-level `const` reading the theme freezes at import time, so every migrated site instead gets a small function called at each use, named for what it sizes. `Glyph.ts`'s own `GLYPH_DEFAULT_SIZE` → `glyphDefaultSize()` conversion (Glyph.ts:172-183, applied in the constructor at 262-283) is the closest precedent, since it is also a size fed through the `subclassDefaults`/options-bag construction path rather than read at layout time.
