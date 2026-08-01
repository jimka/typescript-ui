// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { Table as TableComponent } from "~/component/table/Table.js";
import { Column } from "~/component/table/Column.js";
import { Component } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { UNBOUNDED } from "~/primitive/Size.js";
import { DOM } from "~/core/DOM.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for the {@link Table} layout manager.
 *
 * @category Layouts
 */
interface TableLayoutOptions extends LayoutManagerOptions {
}

/**
 * A layout manager dedicated to the [`Table`](/api/component/table/classes/Table) component.
 * Positions the header, body, and footer sections within the container and
 * triggers virtual-scroll rendering on the body after each layout pass.
 *
 * Per-column widths are stored on the [`Table`](/api/component/table/classes/Table) component. On first render (or after
 * a model swap) widths are initialized from the container's
 * [`getIntrinsicColumnWidths`](/api/component/table/classes/Table#getIntrinsicColumnWidths) —
 * a per-type width policy, refined by any `minWidth` / `maxWidth` / `width` declared in the
 * column spec: compact types (`boolean`, `glyph`, `date`, `time`, `datetime`, `number`)
 * receive a type-derived width floored at the header text width; string and auto columns
 * either share the remaining space equally or, under `autoSizeColumns`, size to their
 * sampled content, clamped to their constraints either way. On container resize
 * `boolean` / `number` / `date` columns keep their width unchanged; every other column
 * (including `glyph`, `time`, and `datetime`) scales proportionally like a flexible
 * column, again clamped to their per-column constraints. Every per-column minimum
 * is read through [`getColumnMinWidth`](/api/component/table/classes/Table#getColumnMinWidth),
 * so a column never squeezes below the floor its type or spec implies.
 */
class Table extends LayoutManager {

    /**
     * Constructs a Table layout manager.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TableLayoutOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Attaches to a container, throwing if it is not a [`Table`](/api/component/table/classes/Table)
     * or a [`TreeTable`](/api/component/table/classes/TreeTable) component.
     *
     * @param container - The container component to attach to.
     *
     * @remarks This layout manager is valid for containers whose class
     * name is `"Table"` or `"TreeTable"`. `TreeTable` extends `Table`
     * and reuses the entire header / body / footer geometry pipeline,
     * so it shares the same layout manager.
     */
    attach(container: Component) : this {
        const name = container.getClassName();

        if (name != "Table" && name != "TreeTable") {
            throw new Error("Container must be a Table or TreeTable.");
        }

        super.attach(container);

        return this;
    }

    /**
     * Positions the header, body, and footer sections and triggers body virtual scroll rendering.
     *
     * @remarks Per-column widths are read from the Table component. If the stored widths do not
     * match the current column count (first render or model swap) they are re-initialized using
     * type-aware sizing clamped to each column's `minWidth` / `maxWidth`. On a container resize
     * the existing widths are scaled proportionally, again clamped to per-column constraints —
     * toward the container's available width, or toward a wider total a resize drag grew the
     * table to, whichever is larger, so a drag-widened table is not rescaled back down.
     */
    doLayout() {
        const container = <TableComponent>this.getContainer();

        if (!container) {
            return;
        }

        const containerSize = container.getInnerSize();

        // A table whose size has not been resolved yet reports NaN dimensions
        // rather than `null` — `getInnerSize` subtracts the perimeter from an
        // unset `_width`/`_height`. That happens whenever a layout is driven by
        // something other than the parent's sizing pass: a store load that
        // re-derives column widths fires one from the store event, which for a
        // generated table typically lands before the table has ever been sized.
        // Laying out against NaN would poison the width array — `availableWidth`
        // is NaN, and the slack arithmetic downstream compares NaN (every
        // comparison is false, so no early return catches it) — so the widths
        // are left alone and the next properly-sized pass derives them.
        if (!containerSize || !Number.isFinite(containerSize.width) || !Number.isFinite(containerSize.height)) {
            return;
        }

        const containerInsets = container.getContentInsets();
        const columns         = container.getColumns();
        const columnCount     = container.getColumns().length;
        const availableWidth  = container.getAvailableColumnWidth();
        // A resize drag may have grown the table's total column width past
        // `availableWidth`; rescaling toward the target instead of the raw
        // available width is what keeps `rescaleWidths` from squeezing a
        // drag-widened table back to the container's width on the next pass.
        const targetWidth     = Math.max(availableWidth, container.getColumnWidthTarget());

        let columnWidths = container.getColumnWidths();

        if (columnWidths.length !== columnCount) {
            columnWidths = this.initializeWidths(container, columns, availableWidth);
            container.setColumnWidths(columnWidths);
        } else {
            columnWidths = this.rescaleWidths(container, columns, columnWidths, targetWidth);
            container.setColumnWidths(columnWidths);
        }

        const header = container.getHeader();
        const body   = container.getBody();
        const footer = container.getFooter();

        // A section is laid out only when it is both visible (the Table's own
        // header/body/footer visibility flag) AND displayed (the core
        // `setDisplayed` flag). The two are reconciled, not substituted: a
        // `setDisplayed(false)` part drops out of the layout exactly like a
        // `setHeaderVisible(false)` one, and the body reflows to reclaim its band.
        if (container.isHeaderVisible() && header && header.isDisplayed()) {
            // Header cells render their text in the shared px line box, so the
            // row height is that line box plus the cell padding.
            const theme        = ThemeManager.getTheme();
            // Cells render at the root font size, so the line box is the
            // additive `font-size + --ts-ui-line-padding` value `Util` derives
            // (the same line box the cell text is laid out at).
            const lineHeight   = Util.lineHeightPx();
            const padding      = theme.table.cell.padding          ?? 2;
            const columnHeight = lineHeight + 2 * padding;

            // Parent header row uses the same arithmetic — same font, same
            // padding — so a theme swap re-runs `doLayout` and the two
            // rows stay aligned. Collapses to zero when no visible
            // column declares a `group`, so no-group tables are
            // byte-identical at runtime.
            const hasParentRow    = header.hasParentRow();
            const parentRowHeight = hasParentRow ? columnHeight : 0;
            const headerBandHeight = parentRowHeight + columnHeight;

            // The header element stays pinned to the viewport width so the
            // gradient (and the scrollbar-cover band) covers the full
            // band, but the inner rows are sized to fit all cells —
            // including ones that overflow the viewport horizontally —
            // because `Row`'s default `overflow: hidden` would otherwise
            // clip cells at the row's right edge and prevent them from
            // coming into view when the inner rows translate left during
            // a horizontal scroll.
            const columnSum    = columnWidths.reduce((s, w) => s + w, 0);
            const innerRowW    = Math.max(containerSize.width, columnSum);

            header.setAutoCommitStyle(false);
            header.setX(containerInsets.getLeft());
            header.setY(containerInsets.getTop());
            header.setWidth(containerSize.width);
            header.setHeight(headerBandHeight);
            header.setAutoCommitStyle(true);

            // Parent row is sized + positioned first so its `spanFrom`
            // / `spanTo` constraints translate to x/width sums over the
            // column-width array beneath. When `hasParentRow` is false
            // the parent row stays collapsed at zero height and its
            // cell pool is empty anyway — `header.renderColumnWindow`
            // below skips positioning it.
            const parentRow = header.getParentRow();
            parentRow.setAutoCommitStyle(false);
            parentRow.setX(0);
            parentRow.setY(0);
            parentRow.setWidth(innerRowW);
            parentRow.setHeight(parentRowHeight);
            parentRow.setAutoCommitStyle(true);

            // Column row sits beneath the parent row. The cell y-coords
            // are relative to the column row's element, so they stay at
            // y=0 — only the row itself shifts down by `parentRowHeight`.
            const columnRow     = header.getComponents()[1];
            columnRow.setAutoCommitStyle(false);
            columnRow.setX(0);
            columnRow.setY(parentRowHeight);
            columnRow.setWidth(innerRowW);
            columnRow.setHeight(columnHeight);
            columnRow.setAutoCommitStyle(true);

            // Reconciles the header's rendered cells to the
            // horizontally-visible column range and positions every
            // rendered cell in both rows — the header-side counterpart
            // of `body.renderWindow` below.
            header.renderColumnWindow({
                columnWidths,
                viewportWidth: availableWidth,
                columnHeight,
                parentRowHeight,
            });

            // Cover the vertical-scrollbar reservation at the header's
            // right edge so cells scrolled horizontally appear to clip at
            // the trackW boundary while the band stays continuous with the
            // rest of the header's gradient. Sits on top of the inner rows
            // by DOM order, beneath the scrollbar widget which lives in
            // the body.
            const trackW = DOM.source.getScrollBarWidth();
            const cover  = header.getScrollbarCover();
            DOM.sink.apply(cover, {
                style: {
                    left: (containerSize.width - trackW) + "px",
                    width: trackW + "px",
                    height: headerBandHeight + "px",
                },
            });
        }

        if (container.isFooterVisible() && footer && footer.isDisplayed()) {
            // Footer cells render their text in the shared px line box, so the
            // row height is that line box plus the cell padding.
            const theme         = ThemeManager.getTheme();
            // Same additive line box as the header/body: the root font size plus
            // the `--ts-ui-line-padding` leading, via `Util`.
            const lineHeight    = Util.lineHeightPx();
            const padding       = theme.table.cell.padding         ?? 2;
            const columnHeight  = lineHeight + 2 * padding;
            const footerColumns = footer.getColumns();

            footer.setAutoCommitStyle(false);
            footer.setX(containerInsets.getLeft());
            footer.setY(containerInsets.getTop() + containerSize.height - columnHeight);
            footer.setWidth(containerSize.width);
            footer.setHeight(columnHeight);
            footer.setAutoCommitStyle(true);

            let x = 0;

            footerColumns.forEach((col, i) => {
                col.setAutoCommitStyle(false);
                col.setX(x);
                col.setY(0);
                col.setWidth(columnWidths[i]);
                col.setHeight(columnHeight);
                col.setAutoCommitStyle(true);
                col.doLayout();

                x += columnWidths[i];
            });
        }

        if (container.isBodyVisible() && body && body.isDisplayed()) {
            const headerHeight = container.isHeaderVisible() && header && header.isDisplayed() ? header.getHeight() : 0;
            const footerHeight = container.isFooterVisible() && footer && footer.isDisplayed() ? footer.getHeight() : 0;

            body.setAutoCommitStyle(false);
            body.setX(containerInsets.getLeft());
            body.setY(containerInsets.getTop() + headerHeight);
            body.setWidth(containerSize.width);
            body.setHeight(containerSize.height - headerHeight - footerHeight);
            body.setAutoCommitStyle(true);

            body.renderWindow(availableWidth, columnWidths);
        }
    }

    /**
     * Computes initial column widths from the container's per-type width
     * policy and column constraints.
     *
     * Fixed-shape columns (boolean, glyph, date, time, datetime, number) get a
     * type-derived width clamped to any declared min/max. Flexible columns
     * (string, auto) with no definite width share the remaining space equally,
     * each clamped to its own min/max; a `string`/`auto` column with a definite
     * width — either declared or, under `autoSizeColumns`, sampled from content —
     * uses that width like a fixed-shape column instead of sharing space.
     *
     * @param container      - The Table component whose columns are being sized.
     * @param columns        - The visible resolved columns.
     * @param availableWidth - Total available pixel width for columns.
     * @returns The computed width for each column.
     */
    private initializeWidths(container: TableComponent, columns: Column[], availableWidth: number): number[] {
        const intrinsic = container.getIntrinsicColumnWidths();

        const fixedTotal = intrinsic.reduce((s: number, w) => s + (w ?? 0), 0);
        const flexCount  = intrinsic.filter(w => w === null).length;
        const rawFlex    = flexCount > 0
            ? (availableWidth - fixedTotal) / flexCount
            : 0;

        const widths = intrinsic.map((w, i) => {
            if (w !== null) {
                return w;
            }

            const col = columns[i];
            const min = container.getColumnMinWidth(col);
            const max = col.getMaxWidth() ?? UNBOUNDED;

            return Util.clamp(rawFlex, min, max);
        });

        return this.absorbSlackIntoGreedy(columns, widths, availableWidth);
    }

    /**
     * Rescales existing flexible column widths to fit the new available width,
     * keeping fixed-type columns at their current size and clamping all columns
     * to their per-column constraints.
     *
     * @param container      - The Table component whose columns are being sized.
     * @param columns        - The visible resolved columns.
     * @param columnWidths   - The existing width array from the previous layout.
     * @param availableWidth - Total available pixel width for columns.
     * @returns The updated width array, or the original if no rescaling was needed.
     */
    private rescaleWidths(container: TableComponent, columns: Column[], columnWidths: number[], availableWidth: number): number[] {
        const isFixed = columns.map(col => {
            const t = col.getField().getType();

            return t === 'boolean' || t === 'number' || t === 'date';
        });

        const fixedTotal    = columnWidths.reduce((s: number, w, i) => s + (isFixed[i] ? w : 0), 0);
        const prevFlexTotal = columnWidths.reduce((s: number, w, i) => s + (isFixed[i] ? 0 : w), 0);
        const newFlexTotal  = availableWidth - fixedTotal;

        // On a table with more columns than fit — the generated-table case this
        // sizing exists for — the fixed-shape columns alone can already exceed
        // the viewport, leaving `newFlexTotal` negative. There is no space for
        // the flex columns to share, and rescaling by a negative ratio would
        // collapse every one of them to its floor on the first re-layout, with
        // no resize involved. Keep the derived widths and let the table scroll
        // horizontally, which is what a column too wide for the viewport means.
        if (prevFlexTotal <= 0 || newFlexTotal <= 0 || Math.abs(prevFlexTotal - newFlexTotal) <= 0.5) {
            return columnWidths;
        }

        const ratio = newFlexTotal / prevFlexTotal;

        const rescaled = columnWidths.map((w, i) => {
            if (isFixed[i]) {
                return w;
            }

            return this.clamp(w * ratio, columns[i], container);
        });

        return this.absorbSlackIntoGreedy(columns, rescaled, availableWidth);
    }

    /**
     * Adds any positive leftover width — space freed when a flexible column
     * clamped to its `maxWidth` — to the flexible columns that declare no
     * `maxWidth`, so an unbounded "filler" column grows to fill the table
     * instead of leaving dead space at the right edge. A no-op when the columns
     * already fill the width (the common case: no flexible column is capped) or
     * overflow it.
     *
     * @param columns        - The visible resolved columns.
     * @param widths         - The per-column widths computed so far.
     * @param availableWidth - Total available pixel width for columns.
     * @returns The widths with any positive slack handed to unbounded flexible columns.
     */
    private absorbSlackIntoGreedy(columns: Column[], widths: number[], availableWidth: number): number[] {
        const slack = availableWidth - widths.reduce((s, w) => s + w, 0);

        if (slack <= 0.5) {
            return widths;
        }

        const greedy: number[] = [];

        columns.forEach((col, i) => {
            const t      = col.getField().getType();
            const isFlex = t !== 'boolean' && t !== 'number' && t !== 'date';

            if (isFlex && col.getMaxWidth() === undefined) {
                greedy.push(i);
            }
        });

        if (greedy.length === 0) {
            return widths;
        }

        const share  = slack / greedy.length;
        const result = [...widths];

        for (const i of greedy) {
            result[i] += share;
        }

        return result;
    }

    /**
     * Clamps a width value to the `[minWidth, maxWidth]` range declared on a column,
     * using the container's type-derived floor as the default minimum and no upper
     * bound when unconstrained.
     *
     * @param width     - The raw width to clamp.
     * @param column    - The column whose constraints apply.
     * @param container - The Table component whose columns are being sized.
     * @returns The clamped width.
     */
    private clamp(width: number, column: Column, container: TableComponent): number {
        const min = container.getColumnMinWidth(column);
        const max = column.getMaxWidth() ?? UNBOUNDED;

        return Util.clamp(width, min, max);
    }
}

const TableCallable = callable(Table);
type TableCallable = Table;
export {
    Table         as _Table,
    TableCallable as Table
};
