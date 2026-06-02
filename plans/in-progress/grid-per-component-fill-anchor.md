# Grid Per-Component Fill & Anchor — Implementation Plan

## Overview

Redesign the [`Grid`](../src/typescript/lib/layout/Grid.ts) layout manager's fill model so that fill ([`FillType`](../src/typescript/lib/layout/FillType.ts)) and anchor ([`AnchorType`](../src/typescript/lib/layout/AnchorType.ts)) are **per-component configurable** via [`GridConstraints`](../src/typescript/lib/layout/GridConstraints.ts), backed by a **grid-level default** that each child overrides. Today `Grid` hardcodes `FillType.BOTH` at two placement sites ([Grid.ts:602-609](../src/typescript/lib/layout/Grid.ts#L602) and [Grid.ts:801](../src/typescript/lib/layout/Grid.ts#L801)) and gates behaviour on a boolean `_stretching` ([Grid.ts:41](../src/typescript/lib/layout/Grid.ts#L41)) whose two states conflate "fill the cell" with "baseline-align the row".

Most per-component plumbing already exists downstream: [`LayoutConstraints`](../src/typescript/lib/layout/LayoutConstraints.ts#L16) declares `fill`/`anchor`, and [`LayoutManager.resolveBounds`](../src/typescript/lib/layout/LayoutManager.ts#L278) already prioritises the child's stored constraint over the passed-in fallback (`fill = (layoutConstraints?.fill || fill || FillType.NONE)`, [LayoutManager.ts:287-288](../src/typescript/lib/layout/LayoutManager.ts#L287)). The work is therefore concentrated in `Grid` itself: replace `_stretching` with a `_defaultFill` / `_defaultAnchor` model, pass those defaults (not `FillType.BOTH`) as the `placeComponent`/`resolveBounds` fallback, reconcile the clip-on-overflow branch with fill/anchor, and re-surface + document `fill`/`anchor` on `GridConstraints`.

This is a full redesign of the fill model, not a gap-fix. The clip-on-overflow behaviour at [Grid.ts:790-803](../src/typescript/lib/layout/Grid.ts#L790) (a child whose `minSize` exceeds its cell must overflow and clip via `setClipFrame` + `commitBounds`, bypassing `resolveBounds`) is a fixed requirement and must be preserved.

---

## Architecture Decisions

### Replace `_stretching` boolean with `_defaultFill` + `_defaultAnchor`

`_stretching` is removed and replaced by two grid-level defaults: `_defaultFill: FillType = FillType.BOTH` and `_defaultAnchor: AnchorType = AnchorType.CENTER`. These map onto the existing `resolveBounds` fallback parameters exactly — `resolveBounds(component, x, y, w, h, fill, anchor)` already treats them as fallbacks behind the child's own constraint. The default of `FillType.BOTH` preserves today's stretch-everything behaviour as the out-of-box experience (current `_stretching = true` default).

Rationale: `_stretching = true` is precisely `defaultFill = FillType.BOTH`, and `_stretching = false`'s "use preferred size, don't fill" is precisely `defaultFill = FillType.NONE`. The boolean was a coarse global switch; per-component `fill` on `GridConstraints` plus a grid default is strictly more expressive and aligns Grid with how `resolveBounds` already consumes fill/anchor.

### Baseline alignment becomes an explicit, separate concern — not a side effect of `fill`

The current `!_stretching` branch ([Grid.ts:559-615](../src/typescript/lib/layout/Grid.ts#L559)) does two things at once: (1) sizes each child to its preferred height instead of the cell height, and (2) baseline-aligns children within each row (`computeRowMetrics` / `nullChildY`). A per-component fill model cleanly expresses (1) — `fill` without a vertical component lets `resolveBounds` use the child's preferred height. It does **not** express (2): baseline alignment is a cross-child, per-row computation that `resolveBounds`'s per-child anchor cannot reproduce.

**Recommendation:** introduce a separate grid-level boolean `_baselineAlign: boolean = false` (option `baselineAlign`, setter `setBaselineAlign`/`isBaselineAlign`) that gates the per-row baseline path, decoupled from fill. The default-fill path (occupancy algorithm) handles all normal placement; when `baselineAlign` is on, the per-row baseline branch runs and uses each child's resolved fill/anchor for the *horizontal* axis while owning the *vertical* (baseline) placement. This keeps "fill vs preferred size" and "baseline-align the row" as orthogonal knobs, which is what the conflated boolean was hiding.

Rejected alternative: making `defaultFill = NONE` implicitly re-enable baseline alignment. This re-creates the original conflation under a new name and would surprise a user who wants un-stretched, anchor-positioned (not baseline-aligned) children — `NONE` + `CENTER` should center each child in its cell, which is a legitimate and distinct layout from baseline alignment.

### Migration: remove `stretching`, no deprecated shim

`Grid`'s `setStretching`/`isStretching`/`stretching` option has **zero external call sites** — verified that every `stretching:` / `setStretching` / `isStretching` hit in `src/` belongs to `VBox` or `HBox` (which keep their own independent `_stretching`), and no demo passes `stretching` to a `Grid`. `GridPanel` ([src/typescript/GridPanel.ts:22](../src/typescript/GridPanel.ts#L22)) and `BindingPanel` ([src/typescript/BindingPanel.ts:151](../src/typescript/BindingPanel.ts#L151)) construct `Grid` without `stretching`. Because the public surface is unused, remove `stretching` from `GridOptions`, drop `setStretching`/`isStretching`/`_stretching`, rather than carry a deprecated shim. (VBox/HBox `stretching` is untouched — out of scope.)

### Clip-on-overflow coexists with fill/anchor by resolving bounds first

The clip branch must remain, but its trigger changes. Today it clips whenever `min.width > w || min.height > h` ([Grid.ts:792](../src/typescript/lib/layout/Grid.ts#L792)), regardless of fill. After the redesign, `placeAt` resolves the child's effective bounds first via `resolveBounds` (honouring per-component fill/anchor + the grid defaults), then clips **only when the resolved box still cannot fit the cell** — i.e. the resolved `width > w || height > h`, which can only happen because the child's own `minSize` floored the resolved size above the cell. Otherwise it commits the resolved (fill/anchor-respecting) bounds normally. This makes clip a true overflow fallback rather than a fill override: a `FillType.NONE` child that fits is centered, a `FillType.BOTH` child fills, and only a child whose min exceeds the cell clips.

Concretely, `placeAt`'s non-clip path calls `resolveBounds(component, x, y, w, h, this._defaultFill, this._defaultAnchor)` and inspects the returned rect; the clip path keeps the existing `setClipFrame(x, y, w, h)` + `commitBounds(component, 0, 0, w, h)` exactly as-is (still bypassing the resolved anchor, since a clipped child parks at the cell origin). `clearClipFrame()` is still called on the non-clip path.

### Size hints and track sizing are unchanged

`getPreferredSize` / `getMinSize` / `getMaxSize` / `computeTotalMinSize` / `measureContent` / `resolveTracks` / `trackAxisExtent` measure children's intrinsic sizes and track extents; they never consulted `_stretching` and do not consult fill/anchor. Per-component fill only affects *placement within an already-sized cell*, so these remain untouched. State this explicitly in the plan's Non-Goals to forestall scope creep.

---

## Public API (TypeScript Signatures)

### `GridOptions` ([Grid.ts:17-28](../src/typescript/lib/layout/Grid.ts#L17))

```typescript
export interface GridOptions extends LayoutManagerOptions {
    rows?:          number;
    columns?:       number;
    spacing?:       number;
    /** Grid-wide fill applied to children that don't set their own `fill`. Default `FillType.BOTH`. */
    defaultFill?:   FillType;
    /** Grid-wide anchor applied to non-filling children that don't set their own `anchor`. Default `AnchorType.CENTER`. */
    defaultAnchor?: AnchorType;
    /** When `true`, children are baseline-aligned per row (cells stay uniform; children use preferred height). Default `false`. */
    baselineAlign?: boolean;
    columnTracks?:  GridTrack[];
    rowTracks?:     GridTrack[];
    // NOTE: `stretching?: boolean` is REMOVED.
}
```

### `Grid` — new/changed typed setters

Backing fields: `_defaultFill: FillType = FillType.BOTH`, `_defaultAnchor: AnchorType = AnchorType.CENTER`, `_baselineAlign: boolean = false`. Remove `_stretching`.

```typescript
getDefaultFill(): FillType;
setDefaultFill(fill: FillType): this;

getDefaultAnchor(): AnchorType;
setDefaultAnchor(anchor: AnchorType): this;

isBaselineAlign(): boolean;
setBaselineAlign(baselineAlign: boolean): this;

// REMOVED: isStretching(): boolean; setStretching(stretching: boolean): this;
```

### `GridConstraints` — re-surface inherited `fill` / `anchor`

No new fields (both already exist on [`LayoutConstraints`](../src/typescript/lib/layout/LayoutConstraints.ts#L16-L17)). Add JSDoc to the class `@remarks` documenting that `fill` and `anchor` override the grid's `defaultFill` / `defaultAnchor` per child, so they surface in the generated `GridConstraints` API page and TypeDoc inheritance section.

---

## Internal Structure

`placeAt` (inside `layoutOccupancy`, [Grid.ts:765-803](../src/typescript/lib/layout/Grid.ts#L765)) after redesign:

```typescript
const placeAt = (component, r, c, rowSpan, colSpan): void => {
    // ... existing x/y/w/h cell-rect computation unchanged ...

    const resolved = this.resolveBounds(component, x, y, w, h, this._defaultFill, this._defaultAnchor);

    if (resolved.width > w || resolved.height > h) {
        // Resolved box (min-floored) still overflows the cell — clip it.
        component.setClipFrame(x, y, w, h);
        this.commitBounds(component, 0, 0, w, h);
    } else {
        component.clearClipFrame();
        this.commitBounds(component, resolved.x, resolved.y, resolved.width, resolved.height);
    }
};
```

`doLayout` ([Grid.ts:553-557](../src/typescript/lib/layout/Grid.ts#L553)) replaces `if (this._stretching)` with `if (!this._baselineAlign)` guarding the `layoutOccupancy` call; the baseline branch ([Grid.ts:559-615](../src/typescript/lib/layout/Grid.ts#L559)) keeps its `computeRowMetrics`/`nullChildY` logic but swaps the hardcoded `FillType.BOTH` at [Grid.ts:608](../src/typescript/lib/layout/Grid.ts#L608) for `this._defaultFill` so the row-baseline path also honours the grid default (and per-child override, since `placeComponent` defers to `resolveBounds`).

---

## Ordered Implementation Steps

1. **`Grid.ts` fields** — remove `_stretching` ([Grid.ts:41](../src/typescript/lib/layout/Grid.ts#L41)); add `_defaultFill: FillType = FillType.BOTH`, `_defaultAnchor: AnchorType = AnchorType.CENTER`, `_baselineAlign: boolean = false`. Add the `AnchorType` import. → verify: `tsc` compiles after the setter edits below.
2. **`GridOptions`** — remove `stretching?`; add `defaultFill?`, `defaultAnchor?`, `baselineAlign?` with JSDoc ([Grid.ts:17-28](../src/typescript/lib/layout/Grid.ts#L17)).
3. **`applyOptions`** — drop the `options.stretching` dispatch ([Grid.ts:74-76](../src/typescript/lib/layout/Grid.ts#L74)); add `defaultFill`/`defaultAnchor`/`baselineAlign` dispatches mirroring the existing `if (options.X !== undefined) this.setX(...)` pattern.
4. **Setters** — replace `isStretching`/`setStretching` ([Grid.ts:87-107](../src/typescript/lib/layout/Grid.ts#L87)) with `getDefaultFill`/`setDefaultFill`, `getDefaultAnchor`/`setDefaultAnchor`, `isBaselineAlign`/`setBaselineAlign`, each with JSDoc, each returning `this` per the existing setter style.
5. **`doLayout` branch** — change `if (this._stretching)` to `if (!this._baselineAlign)` ([Grid.ts:553](../src/typescript/lib/layout/Grid.ts#L553)); in the baseline branch replace `FillType.BOTH` ([Grid.ts:608](../src/typescript/lib/layout/Grid.ts#L608)) with `this._defaultFill`, passing `this._defaultAnchor` as the new trailing `placeComponent` arg.
6. **`placeAt` clip reconciliation** — rewrite per *Internal Structure*: resolve bounds with `this._defaultFill`/`this._defaultAnchor`, clip only when the resolved box overflows the cell, else commit the resolved rect ([Grid.ts:790-802](../src/typescript/lib/layout/Grid.ts#L790)). Update the inline comment to describe min-floored-overflow clipping.
7. **`doLayout` JSDoc** — update the `@remarks` ([Grid.ts:511-518](../src/typescript/lib/layout/Grid.ts#L511)) to describe default-fill + baseline-align instead of "stretching".
8. **`GridConstraints` JSDoc** — extend the class `@remarks` to document `fill`/`anchor` overriding grid defaults ([GridConstraints.ts:5-19](../src/typescript/lib/layout/GridConstraints.ts#L5)).
9. **Regression checkpoint** — `grep -rn 'stretching' src/typescript/lib/layout/Grid.ts` → expect zero matches. `grep -rn 'setStretching\|isStretching' src/` → expect only VBox/HBox.
10. **Demo (optional, only if a per-component fill demo is wanted)** — `GridPanel` ([src/typescript/GridPanel.ts](../src/typescript/GridPanel.ts)) already exercises clip/track/span; optionally add one child with `cons.fill = FillType.NONE` to visually confirm per-component override. Keep surgical — do not restructure the panel.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/layout/Grid.ts` (fields, `GridOptions`, `applyOptions`, setters, `doLayout`, `placeAt`, JSDoc) |
| Modify | `src/typescript/lib/layout/GridConstraints.ts` (JSDoc only — re-surface `fill`/`anchor`) |
| Modify | `docs/layouts/Grid.md` (replace `setStretching` rows/sections with default-fill + baseline-align) |
| Modify (optional) | `src/typescript/GridPanel.ts` (per-component fill demo child) |

No new files. No barrel change — `Grid`, `GridOptions`, `GridConstraints`, `FillType`, `AnchorType` are already exported from [src/typescript/lib/layout/index.ts](../src/typescript/lib/layout/index.ts).

---

## Verification

- **Typecheck:** `npm run build` (or `tsc --noEmit`) — 0 errors.
- **Grep invariants:**
  - `grep -rn 'stretching\|FillType.BOTH' src/typescript/lib/layout/Grid.ts` → zero matches.
  - `grep -rn 'setStretching\|isStretching\|stretching:' src/` → matches only in `VBox.ts`/`HBox.ts` and VBox/HBox-using demos, none referencing `Grid`.
- **Manual smoke (demo screen: `GridPanel`, the "Grid" lazy tab — [main.ts:43](../src/typescript/main.ts#L43)):** dev server on http://localhost:8015.
  - Default (no `defaultFill` passed): every child fills its cell exactly as before (regression — `FillType.BOTH` default).
  - The oversized `wide` button still clips inside the 120px fixed column (clip-on-overflow preserved).
  - Add a child with `GridConstraints.fill = FillType.NONE`: it shrinks to preferred size and centers in its cell (per-component override + default anchor).
  - Construct a `Grid({ baselineAlign: true, columns: 2 })` with label/field rows: children use preferred height and baseline-align (former `stretching: false` behaviour, now under `baselineAlign`).
- **Docs:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc "unsupported TypeScript version" notice excepted). Confirm the generated `GridConstraints` page shows inherited `fill`/`anchor`.

---

## Documentation Impact

- **Barrel:** no change — every affected symbol is already exported from the `layout` subpath barrel ([src/typescript/lib/layout/index.ts:23-25](../src/typescript/lib/layout/index.ts#L23)).
- **Curated page** `docs/layouts/Grid.md`:
  - Replace the `setStretching(boolean)` row in the Common methods table ([Grid.md:87](../docs/layouts/Grid.md#L87)) with `setDefaultFill(FillType)`, `setDefaultAnchor(AnchorType)`, and `setBaselineAlign(boolean)` rows.
  - Rewrite the **Baseline alignment** section ([Grid.md:90-105](../docs/layouts/Grid.md#L90)) to use `baselineAlign: true` instead of `stretching: false`.
  - Update the `GridOptions` mention ([Grid.md:28](../docs/layouts/Grid.md#L28)) — drop `stretching`, add `defaultFill`/`defaultAnchor`/`baselineAlign`.
  - Expand the **Per-child constraints** section ([Grid.md:77-79](../docs/layouts/Grid.md#L77)) to state that `fill`/`anchor` override the grid defaults per child.
  - Adjust the "When to use it" bullets ([Grid.md:107-113](../docs/layouts/Grid.md#L107)) that say "(stretching mode)" / "(non-stretching mode)".
- **Constraints reference** `docs/layouts/Constraints.md` already documents `fill`/`anchor` generically ([Constraints.md:13-14](../docs/layouts/Constraints.md#L13)); add a one-line note under the `GridConstraints` bullet ([Constraints.md:26](../docs/layouts/Constraints.md#L26)) that the grid supplies `defaultFill`/`defaultAnchor` fallbacks.
- **Sidebar / catalog:** no new pages, so `docs/.vitepress/config.mts` and `docs/layouts/index.md` need no edits (Grid and Constraints already listed).
- **JSDoc cross-bucket:** `FillType`/`AnchorType` are in the same `layout` bucket as `Grid`/`GridConstraints`, so `{@link FillType}` / `{@link AnchorType}` resolve directly — no markdown-link form needed.

---

## Potential Challenges

- **Hidden coupling between fill and baseline alignment.** The original boolean fused them; splitting into `defaultFill` + `baselineAlign` is the core risk. Mitigation: keep the baseline branch's row-metrics math byte-for-byte and only swap its hardcoded fill — don't refactor the baseline algorithm.
- **Clip trigger regression.** Changing the clip condition from "min exceeds cell" to "resolved box exceeds cell" must still clip the `GridPanel` `wide` button. Mitigation: `resolveBounds` floors width to `minSize.width` ([LayoutManager.ts:313](../src/typescript/lib/layout/LayoutManager.ts#L313)), so a 400px-min child in a 120px cell resolves to width 400 > 120 and clips — verify on the demo screen.
- **`AnchorType` is a numeric enum** (no string values); `defaultAnchor` defaults must use the enum member `AnchorType.CENTER`, not a string. Mitigation: import and reference the enum, matching `resolveBounds`'s usage.

---

## Critical Files

- [src/typescript/lib/layout/Grid.ts](../src/typescript/lib/layout/Grid.ts) — the target; read in full.
- [src/typescript/lib/layout/LayoutManager.ts:251-424](../src/typescript/lib/layout/LayoutManager.ts#L251) — `placeComponent` / `resolveBounds` / `commitBounds`; confirms the fill/anchor fallback contract and the bypass path the clip branch uses.
- [src/typescript/lib/layout/GridConstraints.ts](../src/typescript/lib/layout/GridConstraints.ts) / [LayoutConstraints.ts](../src/typescript/lib/layout/LayoutConstraints.ts) — where `fill`/`anchor` live.
- [src/typescript/lib/layout/VBox.ts:38-122](../src/typescript/lib/layout/VBox.ts#L38) — the `stretching`/`applyOptions`/setter idiom to mirror (and the sibling whose `stretching` is intentionally left alone).
- [src/typescript/GridPanel.ts](../src/typescript/GridPanel.ts) — the demo/verification screen.

---

## Non-Goals

- **No change to VBox/HBox `stretching`.** Their `_stretching` is independent and out of scope; only `Grid`'s is removed.
- **No change to size hints or track sizing.** `getPreferredSize`/`getMinSize`/`getMaxSize`/`computeTotalMinSize`/`measureContent`/`resolveTracks`/`trackAxisExtent` never read fill/anchor and stay untouched.
- **No deprecated `stretching` shim on Grid.** The public surface has zero external callers, so it is removed outright rather than aliased.
- **No multi-track-span content distribution or new track modes.** The redesign is the fill/anchor model only.
- **No new `FillType`/`AnchorType` members.** The existing enums are sufficient.
