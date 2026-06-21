# Flow Line Cross-Alignment & Inter-Item Distribution — Implementation Plan

## Overview

Two new capabilities for the wrapping flow layouts, added through the shared
[`FlowLayout`](../src/typescript/lib/layout/FlowLayout.ts) base so both
[`HFlow`](../src/typescript/lib/layout/HFlow.ts) and
[`VFlow`](../src/typescript/lib/layout/VFlow.ts) inherit them:

1. **Within-line cross-axis item alignment.** Today each cell is placed at the
   line's leading cross-edge using the cell's *own* cross extent, so a short
   item in a tall line top-aligns (HFlow) / left-aligns (VFlow). A new
   `itemAlign?: FlowItemAlign` (`"start" | "center" | "end" | "baseline"`)
   positions each cell within the *line's* cross extent (row height for HFlow,
   column width for VFlow). The placement helper lives on the base; HFlow/VFlow
   feed it their axis-swapped numbers.

2. **Inter-item main-axis distribution.** The existing `align: FlowAlign`
   (`"start" | "center" | "end"`) moves each line's content as a block via
   [`alignLead`](../src/typescript/lib/layout/FlowLayout.ts#L299). A new
   `justify?: FlowJustify` (`"start" | "between" | "around"`) instead spreads
   the line's items across the inner main extent by growing the inter-item gaps.
   `justify` and `align` are mutually layered: when `justify` is anything but
   `"start"` it owns the residual and `align` is ignored (a `justify` line by
   definition fills the inner extent, so there is no block to align).

Both treatments compose with — do not replace — `uniform` cell sizing and each
child's own [`AnchorType`](../src/typescript/lib/layout/AnchorType.ts) (which
positions the child *inside* its cell). `itemAlign` positions the *cell* within
the line; the anchor positions the *child* within the cell.

---

## Architecture Decisions

### Two new options, not one extended type — `itemAlign` (cross) and `justify` (main)

The cross-axis item alignment and the main-axis distribution are orthogonal
concerns on perpendicular axes, so they get separate options rather than being
folded together. The main-axis distribution is **not** folded into the existing
`FlowAlign`: `align` moves a content block and `justify` grows gaps, and on an
over-long or single-item line the two want different fallbacks. Keeping them
separate also keeps `getAlign`/`setAlign` and `FlowAlign` backward-compatible —
no existing call site or doc breaks.

`justify` is a **new** type `FlowJustify = "start" | "between" | "around"`
rather than extending `FlowAlign` with `"between"`/`"around"`, because those
values are meaningless to the block-moving `alignLead` path and would force a
runtime guard there. A distinct type makes the two axes' value sets
non-overlapping at compile time.

### Cross-axis placement helper on the base — `crossOffset`

The cell-within-line offset math (`start`/`center`/`end`) is identical for both
subclasses once expressed as (cellExtent, lineExtent) → leading offset, so it
belongs on `FlowLayout` as a `protected crossOffset(...)`, mirroring how
`alignLead` already centralises the main-axis block offset. The `"baseline"`
mode additionally needs the line's baseline metrics, so the helper takes the
already-computed `rowAscent`/`rowDescent` plus the cell's own baseline and
height — the same shape HBox's
[`rowChildY`](../src/typescript/lib/layout/HBox.ts#L588) uses. We mirror that
helper rather than reuse it verbatim because `rowChildY` is `private` to HBox
and bakes in a `top` inset; the flow version returns a pure offset.

### `"baseline"` only meaningful for HFlow; VFlow degrades to `"start"`

A wrapped HFlow row *is* a horizontal text line, so `"baseline"` aligns items on
their shared text baseline exactly as HBox does. A VFlow column is a vertical
stack — its cross axis is width, which has no text baseline. For VFlow,
`itemAlign: "baseline"` therefore degrades to `"start"` (left-align within the
column width). This is documented, not an error: it keeps the option uniform
across both classes without a VFlow-specific type.

### `justify` owns the residual; `align` applies only when `justify === "start"`

When `justify` is `"between"` or `"around"` the line is stretched to fill the
inner main extent, so there is no leftover block for `align` to move — `align`
is ignored. When `justify === "start"` (the default) nothing changes and
`alignLead` runs exactly as today. This precedence is stated in the `justify`
setter JSDoc and the docs page.

### No new geometry in `getPreferredSize`/`getMinSize`/`getMaxSize`

Both features are pure placement (phase 2 / `placeRows`/`placeColumns`); they
change *where* cells sit, never the line's content extent or the wrap decision.
The size-hint methods and `groupIntoRows`/`groupIntoColumns` are therefore
untouched except that `groupIntoRows` must additionally record the per-cell
**baseline** so `"baseline"` cross-alignment can run in phase 2 without
re-reading `getBaseline()`.

---

## Public API (TypeScript Signatures)

In [`FlowLayout.ts`](../src/typescript/lib/layout/FlowLayout.ts):

```ts
/**
 * Cross-axis alignment of an item within its wrapped line's cross extent —
 * the row height for HFlow, the column width for VFlow.
 *
 * - "start"    — leading cross-edge (HFlow top, VFlow left). The current behaviour.
 * - "center"   — centred in the line's cross extent.
 * - "end"      — trailing cross-edge (HFlow bottom, VFlow right).
 * - "baseline" — HFlow only: text-baseline-aligned across the row; null-baseline
 *                items centre in the text line. VFlow degrades to "start".
 */
export type FlowItemAlign = "start" | "center" | "end" | "baseline";

/**
 * Main-axis distribution of a wrapped line's items across the inner main extent.
 *
 * - "start"   — items packed with fixed `spacing`; residual handled by `align`.
 * - "between" — first/last items flush to the line's edges; equal extra gap
 *               between the interior items.
 * - "around"  — equal gap around every item, so the end half-gaps are half the
 *               interior gaps (CSS `space-around` semantics).
 */
export type FlowJustify = "start" | "between" | "around";

export interface FlowLayoutOptions extends LayoutManagerOptions {
    spacing?:     number;
    lineSpacing?: number;
    uniform?:     FlowUniformity;
    align?:       FlowAlign;
    itemAlign?:   FlowItemAlign;   // new
    justify?:     FlowJustify;     // new
}

export abstract class FlowLayout extends LayoutManager {
    protected _itemAlign: FlowItemAlign = "start";   // new backing field
    protected _justify:   FlowJustify   = "start";   // new backing field

    getItemAlign(): FlowItemAlign;
    setItemAlign(itemAlign: FlowItemAlign): this;

    getJustify(): FlowJustify;
    setJustify(justify: FlowJustify): this;

    /**
     * Leading cross-axis offset for a cell within its line's cross extent.
     * For "baseline" pass the line's rowAscent/rowDescent (from
     * computeRowMetrics) and the cell's own baseline; non-baseline modes ignore
     * them. A graphical cell (baseline === null) centres in the text line when
     * the line has a baseline, else falls back to "start".
     */
    protected crossOffset(
        cellExtent: number,
        lineExtent: number,
        baseline:   number | null,
        rowAscent:  number | null,
        rowDescent: number,
    ): number;

    /**
     * Per-gap main-axis spacing for a line under the active `justify` mode.
     * Returns { lead, gap } where `lead` is the offset before the first item
     * and `gap` is the spacing between successive items. Degrades to the fixed
     * `spacing` (and lead 0) for "start", single-item lines, and over-long lines.
     */
    protected justifyGaps(
        itemCount:   number,
        contentMain: number,   // sum of cell main-extents only (no spacing)
        innerMain:   number,
        spacing:     number,
    ): { lead: number; gap: number };
}
```

`HFlowOptions` / `VFlowOptions` stay empty extends of `FlowLayoutOptions`, so
both new fields flow through automatically. No new options on the subclasses.

---

## Internal Structure

### `crossOffset` body (base)

```ts
protected crossOffset(cellExtent, lineExtent, baseline, rowAscent, rowDescent): number {
    switch (this._itemAlign) {
        case "center":
            return Math.max(0, (lineExtent - cellExtent) / 2);
        case "end":
            return Math.max(0, lineExtent - cellExtent);
        case "baseline":
            // VFlow passes rowAscent === null always → "start" fallback.
            if (rowAscent === null) {
                return 0;
            }
            return baseline !== null
                ? rowAscent - baseline
                : this.nullChildY(cellExtent, rowAscent, rowDescent);
        case "start":
        default:
            return 0;
    }
}
```

`nullChildY` and the `rowAscent - baseline` form are exactly HBox's `rowChildY`
logic, minus the `top` term (callers add the line's leading cross-edge).

### `justifyGaps` body (base)

```ts
protected justifyGaps(itemCount, contentMain, innerMain, spacing): { lead, gap } {
    // Degrade to fixed spacing: start mode, <2 items, or content already
    // exceeds the inner extent (no positive residual to distribute).
    const fixedTotal = contentMain + spacing * Math.max(0, itemCount - 1);
    if (this._justify === "start" || itemCount < 2 || fixedTotal >= innerMain) {
        return { lead: 0, gap: spacing };
    }

    const free = innerMain - contentMain;            // > 0, total gap budget

    if (this._justify === "between") {
        return { lead: 0, gap: free / (itemCount - 1) };
    }

    // "around": one whole gap per item, split as half-gaps at the two ends.
    const unit = free / itemCount;
    return { lead: unit / 2, gap: unit };
}
```

For `"start"` the result is identical to today's fixed-`spacing` walk, and the
caller still applies `alignLead` for the block move. For the distribution modes
the caller must **skip** `alignLead` (lead is already baked into the returned
`lead`, and the line fills the inner extent).

---

## Per-axis insertion points

### HFlow — cross axis is the **row height**, main axis is **x**

`HFlowRow.cells` already stores `{ component, width, height }`. **Add a
`baseline: number | null` field** to each recorded cell so `"baseline"`
cross-alignment runs without re-querying. In
[`groupIntoRows`](../src/typescript/lib/layout/HFlow.ts#L272) push
`baseline: component.getBaseline()` alongside the existing fields.

[`placeRows`](../src/typescript/lib/layout/HFlow.ts#L319) becomes:

```ts
private placeRows(rows, leftInset, innerWidth, spacing): void {
    for (const row of rows) {
        // Row text metrics for "baseline" itemAlign (cheap; only used then).
        const heights   = row.cells.map(c => c.height);
        const baselines = row.cells.map(c => c.baseline);
        const { rowAscent, rowDescent } = this.computeRowMetrics(heights, baselines);

        const { lead, gap } = this.justifyGaps(
            row.cells.length, this.cellsMainExtent(row), innerWidth, spacing);

        // Block move only when justify === "start"; otherwise lead owns it.
        const blockLead = this._justify === "start"
            ? this.alignLead(row.contentWidth, innerWidth)
            : 0;

        let x = leftInset + blockLead + lead;

        for (const cell of row.cells) {
            const y = row.y + this.crossOffset(
                cell.height, row.rowHeight, cell.baseline, rowAscent, rowDescent);

            this.placeComponent(cell.component, x, y, cell.width, cell.height, FillType.NONE);

            x += cell.width + gap;
        }
    }
}
```

`cellsMainExtent(row)` = sum of `cell.width` over the row (no spacing). Compute
inline (`row.cells.reduce(...)`) or derive as `row.contentWidth - spacing *
(count - 1)` — prefer the explicit reduce for clarity since `contentWidth` was
accumulated with spacing baked in.

`row.y` stays the row's top; the per-cell `crossOffset` shifts each cell down
within `row.rowHeight`. With `itemAlign: "start"` (default) `crossOffset`
returns 0 and placement is byte-identical to today.

### VFlow — cross axis is the **column width**, main axis is **y**

Mirror exactly. **Add `baseline: number | null` to `VFlowColumn.cells`** in
[`groupIntoColumns`](../src/typescript/lib/layout/VFlow.ts#L266) — but a column
has no shared text baseline, so VFlow records `baseline: null` for every cell
(or omits the read and passes `null` straight through). `crossOffset` is then
called with `rowAscent === null`, so `"baseline"` degrades to `"start"` for free
— no VFlow-specific branch needed.

[`placeColumns`](../src/typescript/lib/layout/VFlow.ts#L313) becomes:

```ts
private placeColumns(columns, topInset, innerHeight, spacing): void {
    for (const column of columns) {
        const { lead, gap } = this.justifyGaps(
            column.cells.length, this.cellsMainExtent(column), innerHeight, spacing);

        const blockLead = this._justify === "start"
            ? this.alignLead(column.contentHeight, innerHeight)
            : 0;

        let y = topInset + blockLead + lead;

        for (const cell of column.cells) {
            // rowAscent null → "baseline" degrades to "start"; cross axis is width.
            const x = column.x + this.crossOffset(cell.width, column.columnWidth, null, null, 0);

            this.placeComponent(cell.component, x, y, cell.width, cell.height, FillType.NONE);

            y += cell.height + gap;
        }
    }
}
```

---

## Edge cases (degradations)

| Case | `justify` behaviour | `itemAlign` behaviour |
|---|---|---|
| Single-item line (`count < 2`) | `justifyGaps` returns `{lead:0, gap:spacing}` → identical to `start`; `align` block move still applies. | Cross-align as normal (a single short cell still centres/end-aligns in a tall line). |
| Line exactly fills (`fixedTotal === innerMain`) | `fixedTotal >= innerMain` true → no extra gap; flush already. | Unaffected. |
| Over-long line (`fixedTotal > innerMain`, e.g. a clamped wide first cell) | Guard clamps to `start` gaps — **no negative gaps**. | Cross extent is the line's own `rowHeight`/`columnWidth`, always ≥ each cell, so `crossOffset` never goes negative (guarded by `Math.max(0, …)`). |
| `between`, 2 items | One interior gap = whole `free`; ends flush. | — |
| `around`, N items | End half-gaps = `unit/2`; interior gaps = `unit`; total = `free`. | — |
| `itemAlign: "baseline"`, no item reports a baseline (`rowAscent === null`) | — | Falls back to `"start"` (leading cross-edge), matching HBox's same fallback. |
| `itemAlign: "baseline"` on VFlow | — | Always `"start"` (column passes `rowAscent === null`). |
| `uniform: "height"`/`"both"` (HFlow) | unaffected | Every cell == `rowHeight`, so `crossOffset` returns 0 — visually a no-op, as expected (the uniform cell already fills the line; the child's anchor still positions it within the cell). |

---

## Ordered Implementation Steps

1. **`FlowLayout.ts` — types.** Add `FlowItemAlign` and `FlowJustify` type
   aliases with JSDoc (next to `FlowAlign`). Export both.
   → verify: `grep -n 'FlowItemAlign\|FlowJustify' src/typescript/lib/layout/FlowLayout.ts`.
2. **`FlowLayout.ts` — options + fields.** Add `itemAlign?`/`justify?` to
   `FlowLayoutOptions`; add `_itemAlign`/`_justify` protected fields (default
   `"start"`); dispatch both in `applyOptions`.
3. **`FlowLayout.ts` — getters/setters.** `getItemAlign`/`setItemAlign`,
   `getJustify`/`setJustify` (chainable `this`, JSDoc noting the `justify`-owns-
   residual precedence and the VFlow `"baseline"` degradation).
4. **`FlowLayout.ts` — helpers.** Add `protected crossOffset(...)` and
   `protected justifyGaps(...)` per the bodies above.
   → verify: typecheck after this step (helpers compile against `nullChildY`/
   `computeRowMetrics` already inherited).
5. **`HFlow.ts` — record baseline.** Add `baseline: number | null` to the
   `HFlowRow.cells` element type and push `component.getBaseline()` in
   `groupIntoRows`.
6. **`HFlow.ts` — `placeRows`.** Rewrite per the snippet: compute row metrics,
   call `justifyGaps`, gate `alignLead` on `justify === "start"`, apply
   `crossOffset` to each cell's y, walk with `gap`. Add a private
   `cellsMainExtent(row)` helper (or inline the reduce).
7. **`VFlow.ts` — mirror.** Add `baseline` (always `null`) to `VFlowColumn.cells`;
   rewrite `placeColumns` symmetrically (cross axis = width, main axis = y).
8. **Barrel.** In `src/typescript/lib/layout/index.ts` add `FlowItemAlign` and
   `FlowJustify` to the existing `export type { … } from '~/layout/FlowLayout.js'`.
   → verify: `grep -n 'FlowItemAlign\|FlowJustify' src/typescript/lib/layout/index.ts`.
9. **Default-behaviour regression check.** Confirm that with neither option set
   (`itemAlign`/`justify` both `"start"`) the placement math is identical to the
   pre-change code (crossOffset → 0, justifyGaps → `{0, spacing}`, alignLead path
   intact).
10. **Demo wiring** (see Verification) — extend `HFlowPanel`/`VFlowPanel` or add a
    sibling demo exercising mixed-height items with `itemAlign` and `justify`.
11. **Typecheck + docs build.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/FlowLayout.ts` |
| Modify | `src/typescript/lib/layout/HFlow.ts` |
| Modify | `src/typescript/lib/layout/VFlow.ts` |
| Modify | `src/typescript/lib/layout/index.ts` (barrel re-export) |
| Modify | `src/typescript/HFlowPanel.ts` / `src/typescript/VFlowPanel.ts` (demo) |
| Modify | `docs/layouts/HFlow.md`, `docs/layouts/VFlow.md` |
| Modify | `docs/layouts/index.md` (catalog), `docs/.vitepress/config.mts` (sidebar, if anchors added) |

---

## Verification

- **Typecheck:** `npm run build` (or the project's `tsc` task) — 0 errors.
- **Barrel invariant:** `grep -n 'FlowItemAlign\|FlowJustify' src/typescript/lib/layout/index.ts` — both present.
- **Default-behaviour invariant:** with no new option set, `HFlow`/`VFlow`
  output is unchanged — eyeball the existing `HFlowPanel`/`VFlowPanel`
  (uniform: "both") screens; cells must sit exactly as before.
- **Demo screen.** The flow demos are
  [`HFlowPanel`](../src/typescript/HFlowPanel.ts) and
  [`VFlowPanel`](../src/typescript/VFlowPanel.ts) (both extend
  `LayoutTestPanel`, registered via `src/typescript/main.ts`). For a meaningful
  test of the **non-uniform** case, add a variant constructed with
  `new HFlow({ uniform: "none", itemAlign: "center", justify: "between" })`
  holding deliberately mixed-height children, so a short item visibly centres in
  a tall row and the items spread edge-to-edge. Repeat axis-swapped for VFlow
  (`itemAlign: "center"` → cells centre horizontally in the column;
  `justify: "around"` → even vertical gaps). Confirm:
  - mixed-height row: short item vertically centred / end-aligned per `itemAlign`;
  - `justify: "between"`: first/last flush to edges, even interior gaps;
  - `justify: "around"`: equal gaps with half-gaps at the ends;
  - over-long line: no overlap, no negative gap (degrades to `start`);
  - `itemAlign: "baseline"` (HFlow, text children): text baselines aligned.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (the typedoc
  "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

- **Barrel:** the new types are re-exported from
  `src/typescript/lib/layout/index.ts` (the per-subpath layout barrel; there is
  no root barrel) alongside `FlowAlign`/`FlowUniformity`.
- **Curated pages:** [`docs/layouts/HFlow.md`](../docs/layouts/HFlow.md) and
  [`docs/layouts/VFlow.md`](../docs/layouts/VFlow.md) each have a **Line
  alignment** section (`align`) and a **Common methods** table — add:
  - an **Item alignment** subsection documenting `itemAlign` (cross-axis,
    `FlowItemAlign`), explicitly noting HFlow's `"baseline"` mode and VFlow's
    degradation to `"start"`;
  - a **Distribution** subsection documenting `justify` (`FlowJustify`,
    `between`/`around`, the `justify`-owns-residual precedence over `align`, and
    the single-item/over-long degradations);
  - rows in the Common methods table for `setItemAlign(...)` and
    `setJustify(...)`;
  - update the `HFlowOptions`/`VFlowOptions` "Inherits every flow field" prose
    (in the source JSDoc and the docs) to mention the two new fields.
  HFlow.md's **Baseline alignment** section should reference the new
  `itemAlign: "baseline"` mode (it currently says HFlow has none).
- **Catalog & sidebar:** add the two new type links to
  [`docs/layouts/index.md`](../docs/layouts/index.md)'s flow entries; update
  [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) only if new
  page anchors are introduced (section anchors don't usually need a sidebar
  entry).
- **JSDoc cross-bucket links:** all referenced symbols (`AnchorType`,
  `FlowAlign`, the new types) live in the same `layout` bucket, so `{@link}` is
  fine — no markdown-link requirement triggered.

---

## Critical Files

- [`src/typescript/lib/layout/FlowLayout.ts`](../src/typescript/lib/layout/FlowLayout.ts)
  — base: `_align`/`alignLead`/`clampedPreferredSize`, the option dispatch
  pattern to mirror.
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) —
  `rowChildY` (L588) and the `computeRowMetrics`-driven baseline placement loop;
  the model `crossOffset` mirrors.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts)
  — `computeRowMetrics` (L502), `nullChildY` (L486), `computeRowHeight` (L535);
  the inherited baseline helpers `crossOffset` reuses.
- [`src/typescript/lib/layout/HFlow.ts`](../src/typescript/lib/layout/HFlow.ts) /
  [`VFlow.ts`](../src/typescript/lib/layout/VFlow.ts) — the `groupIntoRows`/
  `placeRows` (and column mirror) edit sites.

---

## Non-Goals

- **No per-line cross-axis stretch** (growing a short cell to the line's cross
  extent). Flow keeps `FillType.NONE`; alignment moves cells, never resizes
  them. Stretch belongs to the box layouts.
- **No `space-evenly`.** Only `between`/`around` are requested; a third mode is
  trivial to add later but unrequested.
- **No interaction rework of `AnchorType`.** The per-child anchor keeps
  positioning the child within its cell, unchanged; the new line-level
  alignment is strictly additive (cell-within-line vs child-within-cell).
- **No size-hint changes.** `getPreferredSize`/`getMinSize`/`getMaxSize` and the
  wrap thresholds are untouched — both features are placement-only.
