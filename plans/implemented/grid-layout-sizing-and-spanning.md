# Grid Layout — Flexible Sizing, Cell Spanning, and Clip — Implementation Plan

## Overview

Three related enhancements to the [`Grid`](../src/typescript/lib/layout/Grid.ts) layout manager, which today tiles children into a grid of *uniform* equal-sized cells ([Grid.ts:408](../src/typescript/lib/layout/Grid.ts#L408) divides the inner rect by `cols`/`rows`) and sequences children left-to-right then top-to-bottom with no per-cell addressing or spanning.

- **Item A — flexible row/column sizing.** Replace the single per-axis equal-share divisor with per-track sizing where each row and each column independently uses one of three modes: a proportional `weight`, a fixed pixel size, or `"content"` (size to the children placed in that track, honouring preferred *and* min size). Tracks are declared on the `Grid` manager via a new `GridTrack[]` API.
- **Item B — cell spanning and explicit placement.** Let a child added to the grid declare `rowSpan` / `colSpan` via a new `GridConstraints` subclass of [`LayoutConstraints`](../src/typescript/lib/layout/LayoutConstraints.ts), so the child occupies a rectangular block of cells. The same `GridConstraints` carries optional `col` / `row` for explicit per-cell placement — a child may name the exact cell it lands in, and un-positioned children auto-flow around it. Spanning and explicit placement together force an occupancy grid instead of the current implicit row-major counter.
- **Item C — clip instead of spill.** Today [`resolveBounds`](../src/typescript/lib/layout/LayoutManager.ts#L202) floors a child's size at its `minSize` even when that exceeds the cell, so an oversized child spills past its cell edge. Instead, when a child's min size exceeds its assigned cell block, the child must be clamped to the cell and clipped (`overflow: hidden`) rather than overflowing into neighbours.

All work is confined to the `layout/` subtree plus the demo panel [`GridPanel.ts`](../src/typescript/GridPanel.ts); no theme tokens or DOM-element changes to `Component` are needed (the clip uses the existing `setOverflow`).

---

## Architecture Decisions

### Tracks live on the manager; spans live on the constraint

Per-track sizing is a property of the **grid** (the developer says "column 0 is 120px, column 1 is weight 1, column 2 is content"), so it belongs on the `Grid` manager as `setColumnTracks` / `setRowTracks`. Per-cell spanning is a property of the **child** (the developer says "this button spans 2 columns"), so it belongs on a `GridConstraints` passed through `addComponent(child, constraints)` — mirroring how [`Border`](../src/typescript/lib/layout/Border.ts#L77) reads `placement` and how `HBox` reads `weight` off the constraint. This split keeps each concern where its data naturally originates.

### `GridTrack` is a discriminated descriptor, not three setters

A track is one of three modes, so model it as a small typed object `{ mode: "weight" | "fixed" | "content", value?: number }` rather than parallel arrays. `value` carries the weight (for `"weight"`) or pixel size (for `"fixed"`) and is ignored for `"content"`. This is the minimal shape that expresses the requirement without a class hierarchy.

### Explicit occupancy grid replaces the row-major counter

Spanning makes the current `idx → (row, col)` counter ([Grid.ts:416-438](../src/typescript/lib/layout/Grid.ts#L416)) unworkable: a 2×2-spanning child leaves holes that later children must skip. The new `doLayout` builds a `boolean[rows][cols]` occupancy map and, for each child in order, scans for the next free top-left cell that fits its span, marks the covered cells occupied, and places the child across the summed track extents. This is the standard grid auto-placement algorithm and is the smallest correct approach.

### Explicit placement is a two-pass, explicit-first-then-autoflow model

`col` / `row` on `GridConstraints` let a developer pin a child to an exact cell, so the occupancy pass over the `boolean[rows][cols]` map (above) splits into **two passes** over the children, mirroring CSS Grid's "place the explicitly-positioned items, then auto-place the rest":

- **Pass 1 — reserve explicit.** Every child that declares a position is placed at its declared origin and its full span block is marked occupied in the map. This happens before any auto-flow so pinned children own their cells regardless of document order.
- **Pass 2 — auto-flow the rest.** Every remaining (un-positioned) child runs the existing next-free-cell scan against the already-reserved map, exactly as the occupancy decision above describes. Auto-flow children therefore flow *around* the explicit reservations.

**Partial position rule.** A child counts as explicitly placed if **either** `col` or `row` is provided; the missing axis defaults to `0`. So `{ col: 2 }` means "column 2, row 0" and `{ row: 1 }` means "column 0, row 1". A child with neither field auto-flows.

**Bounds clamping.** `col` and `row` clamp to the grid's column/row count at read time — the same point and the same way `colSpan` / `rowSpan` clamp (see _Span overflow past grid bounds_ in Potential Challenges). A `col` past the last column clamps to the last valid column index; `row` past the last row clamps to the last valid row index. Clamping happens before the span block is computed, so a clamped origin still reserves a valid block.

**Collision policy — later explicit wins, and warn.** Two auto-flow children never collide because the scan only ever takes free cells. The *only* collision case is explicit-vs-explicit: when a Pass-1 child's span block overlaps cells already reserved by an earlier Pass-1 child, the later child (document order) overwrites the occupancy map at the overlapping cells, and a `console.warn` is emitted naming the conflict — the overlapping cell and the two component ids. The earlier child keeps its placement geometry (it was already placed); only the map ownership flips, so a subsequent auto-flow child will not be steered into the contested cells. Explicit-vs-explicit overlap is the sole warned case.

### Content-track sizing asks a min-inclusive question, distinct from `getPreferredSize`

A `"content"` track's job is "be wide (or tall) enough to show its children without clipping them," so it measures `max(preferred, min)` per child — taking each child's preferred size where it has one and never dropping below its min size. Concretely, a `"content"` column sizes to `max(max(preferred.width, min.width))` over the children whose span starts in or covers that column.

This is a deliberately *broader* query than the grid's own `getPreferredSize` walk ([Grid.ts:213-221](../src/typescript/lib/layout/Grid.ts#L213-L221)), which correctly skips children whose `getPreferredSize()` returns `null` — a child that only called `setMinSize` genuinely has no preferred size, so it cannot contribute to a *preferred*-size aggregate. Content sizing is not that aggregate: its goal is min-inclusive, so it must consult min too, and a min-only child therefore still widens its track. (This is also why a min-only child in a `content` track is never clipped — the track grows to fit it; clipping only arises in `fixed`/`weight` tracks whose extent is decided independently of the child.) Spanning children contribute their size only to single-track spans (a child spanning N content columns does not get divided across them in v1 — see Non-Goals).

### Clip is applied at commit time via the child's own overflow, only when it overflows

`resolveBounds` keeps flooring at `minSize` (other layouts rely on it). The grid instead computes each cell block's pixel rect, and when a child's `minSize` exceeds the block on either axis it (a) hard-clamps the committed width/height to the block (not the min) and (b) calls `child.setOverflow("hidden")` so the child's own content is clipped to the cell. When the child fits, the grid clears the clip it set (`setOverflow("visible")`) so toggling track sizes at runtime doesn't leave a stale clip. Because this bypasses the `resolveBounds` min-floor, the grid calls `commitBounds` directly for the clipped path — `commitBounds` is already `protected` and documented for exactly this "bypass the cell clamp" case ([LayoutManager.ts:320-348](../src/typescript/lib/layout/LayoutManager.ts#L320)).

### No convention violations

New per-axis track state gets typed setters with cached `_columnTracks` / `_rowTracks` backing fields and matching `GridOptions` fields (`columnTracks?`, `rowTracks?`). `GridConstraints` adds `col` / `row` / `rowSpan` / `colSpan` as optional typed fields. No new DOM property is added to `Component` (clip reuses `setOverflow`), so no `XOptions` field is needed there. No CSS custom properties, so `Theme.ts` is untouched.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/layout/GridTrack.ts  (new)
export type GridTrackMode = "weight" | "fixed" | "content";

export interface GridTrack {
    mode:   GridTrackMode;
    value?: number;          // weight (mode "weight") or pixels (mode "fixed"); ignored for "content"
}
```

```typescript
// src/typescript/lib/layout/GridConstraints.ts  (new) — extends LayoutConstraints
export class GridConstraints extends LayoutConstraints {
    col?:     number;        // 0-based explicit column index; clamped to grid bounds at read time
    row?:     number;        // 0-based explicit row index; clamped to grid bounds at read time
    rowSpan?: number;        // defaults to 1
    colSpan?: number;        // defaults to 1
}
```

```typescript
// src/typescript/lib/layout/Grid.ts  (modified)
export interface GridOptions extends LayoutManagerOptions {
    rows?:         number;
    columns?:      number;
    spacing?:      number;
    stretching?:   boolean;
    columnTracks?: GridTrack[];   // NEW
    rowTracks?:    GridTrack[];    // NEW
}

class Grid extends LayoutManager {
    // NEW typed setters + cached backing fields:
    //   private _columnTracks: GridTrack[] = [];
    //   private _rowTracks:    GridTrack[] = [];
    setColumnTracks(tracks: GridTrack[]): this;
    getColumnTracks(): GridTrack[];
    setRowTracks(tracks: GridTrack[]): this;
    getRowTracks(): GridTrack[];
}
```

Both new symbols are re-exported from the layout barrel ([src/typescript/lib/layout/index.ts](../src/typescript/lib/layout/index.ts)) alongside `LayoutConstraints` and `FillType`.

---

## Internal Structure

Track resolution (per axis) given an available extent and a track list:

```
resolveTracks(tracks: GridTrack[], count: number, available: number, spacing: number): number[]
  // count = cols (or rows). When tracks.length < count, missing tracks default to { mode: "weight", value: 1 }.
  // 1. inner = available - (count-1)*spacing
  // 2. fixedSum   = sum of "fixed" track values
  //    contentSum = sum of measured content sizes for "content" tracks   // from the occupancy pass
  //    weightSum  = sum of "weight" track values  (floor each weight at 0)
  // 3. remaining = max(0, inner - fixedSum - contentSum)
  // 4. each weight track gets remaining * (value / weightSum); fixed/content keep their measured size
  // returns number[count] of pixel extents
```

The content measurement for step 2 is gathered while building the occupancy map: for each child whose colSpan === 1, fold its `max(preferred.width, min.width)` into its column's content max (and symmetrically for rows with rowSpan === 1). Cell `x` for column `c` is `insets.left + sum(colExtents[0..c-1]) + c*spacing`; cell width for a child spanning `[c0..c1]` is `sum(colExtents[c0..c1]) + (c1-c0)*spacing`. Rows are symmetric.

Placement runs in two passes (replacing the [Grid.ts:411-499](../src/typescript/lib/layout/Grid.ts#L411) body). A shared `placeAt(child, r, c, span)` helper does the per-cell clip-vs-place decision so both passes reuse it unchanged:

```
occupancy = boolean[rows][cols]   // all false

# Pass 1 — reserve explicitly-positioned children
for each child (document order):
    cons = constraints
    if cons.col == null and cons.row == null: continue      // un-positioned → Pass 2
    span = (rowSpan/colSpan, default 1, clamped to grid bounds)
    c = clamp(cons.col ?? 0, 0, cols-1)                     # missing axis defaults to 0
    r = clamp(cons.row ?? 0, 0, rows-1)
    for each cell in block (r..r+span.rows-1, c..c+span.cols-1):
        if occupancy[cell]:                                 # explicit-vs-explicit overlap
            console.warn("Grid: ", thisChild.id, " overlaps ", priorChild.id, " at cell (r,c)")
        occupancy[cell] = true                              # later wins: overwrite ownership
    placeAt(child, r, c, span)

# Pass 2 — auto-flow the remaining children into free cells
for each child (document order):
    cons = constraints
    if cons.col != null or cons.row != null: continue       # already placed in Pass 1
    span = (rowSpan/colSpan, default 1, clamped to grid bounds)
    (r, c) = next free top-left cell whose span block is fully unoccupied
    mark block occupied
    placeAt(child, r, c, span)

# Shared per-cell clip-vs-place (unchanged from before)
placeAt(child, r, c, span):
    cellRect = { x, y, w, h } summed from track extents as above
    min = child.getMinSize()
    if min && (min.width > cellRect.w || min.height > cellRect.h):
        child.setOverflow("hidden")
        commitBounds(child, cellRect.x, cellRect.y, cellRect.w, cellRect.h)   // hard clamp, no min-floor
    else:
        child.setOverflow("visible")                                          // clear any prior clip
        placeComponent(child, cellRect.x, cellRect.y, cellRect.w, cellRect.h, fill)  // existing path
```

`fill` stays `FillType.BOTH` when stretching, matching today; the non-stretching baseline-alignment branch is preserved for the *single-row-height* case but is out of scope to re-derive per content-row — see Non-Goals.

The `getColRowCount` ([Grid.ts:160](../src/typescript/lib/layout/Grid.ts#L160)) auto-calc is reused unchanged to fix `rows`/`cols`; tracks index into that count. `getPreferredSize` / `getMinSize` / `getMaxSize` / `computeTotalMinSize` keep their current "max child × count" arithmetic; fixed/content tracks make these slightly conservative but the universal-scroll path still works (covered in Potential Challenges).

---

## Ordered Implementation Steps

1. **Create [`src/typescript/lib/layout/GridTrack.ts`](../src/typescript/lib/layout/GridTrack.ts)** — the `GridTrackMode` type and `GridTrack` interface with JSDoc, `@category Layouts`.
2. **Create [`src/typescript/lib/layout/GridConstraints.ts`](../src/typescript/lib/layout/GridConstraints.ts)** — `GridConstraints extends LayoutConstraints` with optional `col` / `row` (0-based cell indices, clamped at read time) and `rowSpan` / `colSpan`, JSDoc, `@category Layouts`.
3. **Export both** from [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — verify with `grep -n GridTrack src/typescript/lib/layout/index.ts`.
4. **Grid.ts — state + options.** Add `_columnTracks` / `_rowTracks` cached fields, `setColumnTracks` / `getColumnTracks` / `setRowTracks` / `getRowTracks` typed setters, and dispatch `columnTracks` / `rowTracks` in `applyOptions` after the existing fields.
5. **Grid.ts — track resolver.** Add a private `resolveTracks(tracks, count, available, spacing, contentSizes)` returning `number[]`, plus a private `measureContent(components, cols, rows)` that returns per-column and per-row content maxima (using `max(preferred, min)` per child so a min-only child still sizes its track).
6. **Grid.ts — two-pass occupancy placement.** Rewrite `doLayout`'s stretching branch to: build the occupancy grid, run `measureContent`, call `resolveTracks` for each axis, then run the two passes from _Internal Structure_ — Pass 1 reserves every child with an explicit `col`/`row` (missing axis defaults to 0, both clamped to grid bounds, later-wins-plus-`console.warn` on explicit overlap), Pass 2 auto-flows the remaining children via the next-free-cell scan. Both passes call the shared `placeAt` helper carrying the clip-vs-place decision. Keep the non-stretching baseline branch behind the existing `this._stretching === false` guard (unchanged for the no-track / no-span / no-explicit case).
7. **GridPanel.ts — verification harness.** Rebuild the demo to exercise all three items (see Verification). Replace the inherited `LayoutTestPanel` children with an explicit 3-column grid: column 0 `{mode:"fixed", value:120}`, column 1 `{mode:"weight", value:1}`, column 2 `{mode:"content"}`; add a child with `new GridConstraints()` setting `colSpan:2, rowSpan:2`; add a child with an explicit `{col, row}` (e.g. `col:2, row:0`) plus several un-positioned children to prove auto-flow routes around the pinned cell; add a child given a large `setMinSize` placed in the fixed 120px column to prove clipping. Keep one commented-out (or dev-only) pair of overlapping explicit children to trip the collision `console.warn`.
8. **Typecheck + docs build** per Verification.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | src/typescript/lib/layout/GridTrack.ts |
| Create | src/typescript/lib/layout/GridConstraints.ts |
| Modify | src/typescript/lib/layout/index.ts |
| Modify | src/typescript/lib/layout/Grid.ts |
| Modify | src/typescript/GridPanel.ts |

---

## Verification

- **Typecheck:** `npm run build` (or the project's `tsc` task) — 0 errors.
- **Barrel export:** `grep -n 'GridTrack\|GridConstraints' src/typescript/lib/layout/index.ts` — both present.
- **No spill regression on other layouts:** `grep -rn 'setOverflow' src/typescript/lib/layout/Grid.ts` — the only overflow writes are inside the clip branch; HBox/VBox/Border untouched.
- **Manual smoke (GridPanel demo, `npm run dev` → http://localhost:8015, navigate to the Grid panel):**
  - The 3-column grid renders: column 0 is exactly 120px, column 2 hugs its content width, and column 1 absorbs the remaining width. Resizing the window keeps columns 0 and 2 fixed/content while column 1 grows/shrinks.
  - The `colSpan:2, rowSpan:2` child visibly occupies a 2×2 block; neighbouring children flow around the occupied cells (no overlap, no gap collapse).
  - The child given an explicit `{col:2, row:0}` lands at exactly column 2 / row 0, and the un-positioned children auto-flow into the remaining free cells around it (none overlaps the pinned cell).
  - Enabling the overlapping-explicit pair fires a single `console.warn` naming the conflicting cell and the two component ids (check the DevTools console); with the pair disabled, the console stays clean.
  - The oversized-min child stays inside its 120px cell with its content clipped at the cell edge — it does **not** spill into the adjacent column.
  - Chrome DevTools MCP screenshot confirms the three behaviours in one frame.
- **Theme toggle:** flip light/dark — layout geometry unchanged (no tokens added; this is a sanity check, not a token test).
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc "unsupported TypeScript version" is the lone acceptable warning).

---

## Documentation Impact

- `GridTrack`, `GridConstraints`, and the four new `Grid` setters are public and exported from `src/typescript/lib/layout/index.ts` — the layout subpath barrel.
- Update the curated layout page under `docs/layout/` that covers `Grid` (its catalog `index.md`) to mention track sizing and spanning; add `GridTrack` / `GridConstraints` to the layout sidebar in `docs/.vitepress/config.mts`.
- `GridOptions` JSDoc cross-references to `GridTrack` and `GridConstraints` use `{@link}` (same bucket, so `{@link}` is fine — no cross-bucket markdown link needed).

---

## Potential Challenges

- **`getPreferredSize`/`getMinSize` still assume uniform cells.** They multiply the max child size by the count; with fixed/content tracks the true preferred size is the sum of track sizes. v1 keeps the conservative estimate — mitigate by noting it only affects the host's *preferred* request, not the actual `doLayout` geometry, and the universal-scroll path uses `computeTotalMinSize` which remains a lower bound. Flag for a follow-up if a host visibly under/over-sizes the grid.
- **Weight sum of zero.** If every track is fixed/content (no weight), `remaining` has no claimant and is left unused (cells pack to the left/top). Guard the weight division against `weightSum === 0`.
- **Span overflow past grid bounds.** A `colSpan` larger than the column count must clamp to the remaining columns so the occupancy scan terminates — clamp at read time. Explicit `col` / `row` clamp at the same read point: a value past the last column/row resolves to the last valid index before the span block is computed.
- **Clip toggling leaves stale overflow.** Always write `setOverflow("visible")` on the non-clipped branch so a child that previously clipped (then the track grew) recovers — covered in the placement pseudocode.
- **`commitBounds` runs `doLayout` with the just-set size.** Per the MEMORY note "commitBounds runs doLayout with stale DOM", the clip path commits width/height before recursing — this is already how `commitBounds` orders its writes, so nested layouts see the clamped cell size, which is the intended behaviour.

---

## Critical Files

- [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — primary target; `doLayout`, `getColRowCount`, the size-hint trio.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `resolveBounds` (the min-floor that causes today's spill), `placeComponent`, `commitBounds` (the documented bypass for the clip path), `getLayoutConstraints`.
- [`src/typescript/lib/layout/LayoutConstraints.ts`](../src/typescript/lib/layout/LayoutConstraints.ts) — base class for `GridConstraints`; note the existing `weight` field precedent.
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts#L77) — precedent for reading a per-child constraint (`placement`) in a layout manager.
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts#L525) — precedent for weight-cell resolution and an `options.mode`-style typed field with cached backing.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts#L2377) — `setOverflow` (clip mechanism), `addComponent(component, constraints)` routing.
- [`src/typescript/GridPanel.ts`](../src/typescript/GridPanel.ts) / [`src/typescript/LayoutTestPanel.ts`](../src/typescript/LayoutTestPanel.ts) — the demo screen where success is verified.

---

## Non-Goals

- **Distributing a spanning child's content size across multiple content tracks.** A child spanning N content columns contributes nothing to those tracks' content measurement in v1 (only colSpan === 1 children measure). Reason: correct distribution is an iterative constraint solve; out of scope for the first cut.
- **Per-content-row baseline alignment in the non-stretching branch.** The existing baseline-aligned non-stretching path is preserved only for the uniform (no-track, no-span) case; combining content-row heights with baseline alignment is deferred.
- **Pixel-coordinate placement.** `col` / `row` are 0-based *cell indices*, not pixel offsets — a child cannot be pinned to an arbitrary x/y; it lands on the grid's cell lattice.
- **Reflowing auto-flow children to backfill holes left of explicit items.** Auto-flow keeps the existing next-free-cell scan order; it does not reorder children or perform a denser pack to fill cells that sit before an explicitly-placed reservation. This matches the plan's existing single-pass scan behaviour.
- **New `Component` DOM properties or theme tokens.** Clipping reuses the existing `setOverflow`; no visual styling is added.
- **Changing `getPreferredSize`/`getMinSize`/`getMaxSize` to sum tracks.** Left conservative (max × count) to keep the change surgical; revisit only if a host mis-sizes.
