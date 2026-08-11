// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";

/** Geometry last written to one cell, kept so an identical rewrite can be skipped. */
interface CellGeometry {
    /** The cell's x offset within its row, in pixels. */
    x: number;
    /** The cell's width, in pixels. */
    w: number;
    /** The cell's height, in pixels. */
    h: number;
}

/**
 * Remembers the geometry last written to each table cell so a pass that would
 * rewrite the same values skips both the write and the `doLayout` behind it.
 *
 * Shared by the table body's row cells and the header's own two rows, which
 * position their cells identically: an x offset inside a row that is itself
 * translated by the scroll offset, at the row's height. Because the offsets are
 * content-absolute, a cell keeps its geometry for as long as it keeps its
 * column, and a horizontal scroll leaves most of them untouched.
 *
 * **Records are keyed on the cell, not on its position.** A column-window slide
 * renumbers the slots while the surviving cells stay on their own columns, so a
 * position-keyed cache would miss on every survivor and lay out the whole row
 * again — which is most of the work a slide could avoid.
 *
 * **Geometry is the only layout input this cache writes**, so anything else
 * that moves a cell's layout has to deal with it, by laying the cell out itself
 * or by calling {@link clear}. The writes that do, framework-side:
 *
 * - `Cell.setActiveRenderer` — a `DynamicCell` swapping the child the layout
 *   is fitted around.
 * - `Cell.startEdit` / `detachEditor` — the same swap, for the editor
 *   (`detachEditor` is private, reached from `commitEdit` and `cancelEdit`).
 * - `TreeCellRenderer.setTreeState` — a depth change moves the indent.
 * - `HeaderCell.setHeaderGlyph` — a glyph shifts the renderer's left inset.
 * - `FilterCell.selectOperator` / `setFilterState` — an operator change
 *   enables/disables the text input, which moves layout without moving
 *   geometry.
 * - `GlyphRenderer.setValue` — replaces its child outright.
 * - A theme change, which rewrites the padding and border every cell is fitted
 *   against; both consumers {@link clear} on it.
 *
 * `Cell.wrapRenderer` also replaces the visible child without laying out, and
 * is public — it is safe only because its one caller wraps a cell it has just
 * built, which has no record yet.
 *
 * **A value write is usually not one of them**, which is what makes the skip
 * worth having: a renderer that only writes text moves nothing, because cell
 * renderers run with `setAutoMeasure(false)`. A renderer whose `setValue` adds,
 * removes or replaces a child is the exception — see `GlyphRenderer` — and owes
 * itself the layout. That applies to consumer renderers installed through
 * `ColumnConfig.renderer` as much as to the framework's own.
 *
 * @internal
 */
export class CellGeometryCache {

    private _geometry: WeakMap<Component, CellGeometry> = new WeakMap();

    /**
     * Drops every record, so the next pass re-applies and re-lays-out every
     * cell even where its geometry is unchanged.
     */
    clear(): void {
        this._geometry = new WeakMap();
    }

    /**
     * Writes `x` / `width` / `height` to `cell` and lays it out, unless the
     * cell already holds those exact values.
     *
     * @param cell - The cell to position.
     * @param x - The cell's x offset within its row, in pixels.
     * @param w - The cell's width, in pixels.
     * @param h - The cell's height, in pixels.
     */
    apply(cell: Component, x: number, w: number, h: number): void {
        const previous = this._geometry.get(cell);

        if (previous && previous.x === x && previous.w === w && previous.h === h) {
            return;
        }

        cell.setAutoCommitStyle(false);
        cell.setX(x);
        cell.setY(0);
        cell.setWidth(w);
        cell.setHeight(h);
        cell.setAutoCommitStyle(true);

        // A geometry change needs a full layout pass so the cell's renderer
        // re-fits the new width.
        cell.doLayout();

        // Recorded only once the cell has an element. Without one the layout
        // above could not do its job: the layout manager fits the renderer
        // against `getInnerSize()`, which is element-gated, so an unrendered
        // cell keeps a full-width box around an unsized renderer. Recording
        // that would make every later pass at this same geometry skip the cell
        // and leave it that way. Reachable from the header, which renders no
        // cells until its first layout pass and so can be driven through
        // `renderColumnWindow` before the table is realized; the body's pooled
        // rows are realized as they are built, so there the guard never fires.
        //
        // What is recorded is what was requested rather than what the setters
        // committed, which agree because a table cell carries no min/max and
        // does not clamp to its content.
        if (cell.getElement()) {
            this._geometry.set(cell, { x: x, w: w, h: h });
        }
    }
}
