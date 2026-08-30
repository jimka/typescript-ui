// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { Table as TableComponent } from "~/component/table/Table.js";
import { Column } from "~/component/table/Column.js";
import { Component } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { Size, UNBOUNDED } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { TRACK_WIDTH } from "~/component/container/Scrollbar.js";
import { tableRowHeight } from "~/component/table/RowMetrics.js";

/**
 * Construction-time options for the {@link Table} layout manager.
 *
 * @category Layouts
 */
interface TableLayoutOptions extends LayoutManagerOptions {
}

// The filter row's height is the filter input's own single-line box, not an
// offset from `columnHeight`: the input's chrome (TextField's default 3px
// top+bottom padding, `_defaultTextFieldOptions.padding`; zero border, since
// FilterCellRenderer zeroes the input's border) is independent of the
// table's own `theme.table.cell.padding`, which sizes columnHeight instead —
// a non-default cell padding would make an offset-from-columnHeight formula
// wrong in either direction.
const FILTER_INPUT_PADDING = new Insets(3, 3, 3, 3);
const NO_INSETS            = new Insets(0, 0, 0, 0);

/** A plain rectangle — the geometry `commit` writes to a section band. */
interface Rect {
    x     : number;
    y     : number;
    width : number;
    height: number;
}

/**
 * The pure result of {@link Table.calculate} — every value the write phase
 * ({@link Table.commit}) needs, computed without touching a single component
 * setter. `header`/`footer` are `null` when that section is not both visible
 * and displayed, mirroring the same gate `commit` used to check inline.
 */
interface TableGeometry {
    columnWidths   : number[];
    availableWidth : number;
    header         : { band: Rect; columnHeight: number; parentRowHeight: number; filterRowHeight: number } | null;
    footer         : { band: Rect; columnHeight: number } | null;
    bodyVisible    : boolean;
    containerInsets: Insets;
    containerSize  : Size;
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
 * `boolean` / `number` / `date` columns keep their width unchanged, and so does any
 * column declaring `preserveWidth`, regardless of type; every other column
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
        const geometry = this.calculate();

        if (geometry) {
            this.commit(geometry);
        }
    }

    /**
     * Pure resolution phase: computes every value {@link Table.commit} needs
     * to write, touching no component setter and calling neither
     * `renderWindow` nor `renderColumnWindow`.
     *
     * @returns The resolved geometry, or `null` when there is no container to
     *   lay out, or its size has not resolved yet (see the remarks on the
     *   `containerSize` check below).
     */
    private calculate(): TableGeometry | null {
        const container = <TableComponent>this.getContainer();

        if (!container) {
            return null;
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
            return null;
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
        } else {
            columnWidths = this.rescaleWidths(container, columns, columnWidths, targetWidth);
        }

        const headerComponent = container.getHeader();
        const footerComponent = container.getFooter();
        const bodyComponent   = container.getBody();

        // A section is laid out only when it is both visible (the Table's own
        // header/body/footer visibility flag) AND displayed (the core
        // `setDisplayed` flag). The two are reconciled, not substituted: a
        // `setDisplayed(false)` part drops out of the layout exactly like a
        // `setHeaderVisible(false)` one, and the body reflows to reclaim its band.
        let header: TableGeometry["header"] = null;

        if (container.isHeaderVisible() && headerComponent && headerComponent.isDisplayed()) {
            // Row height derivation lives in `RowMetrics.tableRowHeight`.
            const columnHeight = tableRowHeight();

            // Parent header row uses the same arithmetic — same font, same
            // padding — so a theme swap re-runs `doLayout` and the two
            // rows stay aligned. Collapses to zero when no visible
            // column declares a `group`, so no-group tables are
            // byte-identical at runtime.
            const hasParentRow    = headerComponent.hasParentRow();
            const parentRowHeight = hasParentRow ? columnHeight : 0;

            // Same "does this row apply" gate as the parent row, but the
            // height itself is NOT columnHeight-derived — the filter row
            // holds a TextField, whose own chrome differs from the column
            // row's plain text. See FILTER_INPUT_PADDING's comment.
            const filterRowHeight = headerComponent.hasFilterRow()
                ? Util.singleLineBoxHeight(NO_INSETS, FILTER_INPUT_PADDING, { top: 0, bottom: 0 })
                : 0;

            // The band's bottom border is chrome outside the rows, so the
            // outer height is what the rows need PLUS the header's own
            // perimeter — the same "children plus the container perimeter"
            // sum every other manager's size report uses. Taking it out of a
            // row instead would make a header cell shorter than the body row
            // it heads, by an amount the theme's border width decides.
            const headerPerimeter  = headerComponent.getPerimeterSize();
            const headerBandHeight = parentRowHeight + columnHeight + filterRowHeight
                                   + headerPerimeter.top + headerPerimeter.bottom;

            header = {
                band: {
                    x:      containerInsets.getLeft(),
                    y:      containerInsets.getTop(),
                    width:  containerSize.width,
                    height: headerBandHeight,
                },
                columnHeight,
                parentRowHeight,
                filterRowHeight,
            };
        }

        let footer: TableGeometry["footer"] = null;

        if (container.isFooterVisible() && footerComponent && footerComponent.isDisplayed()) {
            // Row height derivation lives in `RowMetrics.tableRowHeight`.
            const columnHeight = tableRowHeight();

            // Same "children plus perimeter" sum as the header band above:
            // the footer's own top border is chrome outside the row, so the
            // outer height grows by it instead of the row shrinking inside it.
            const footerPerimeter  = footerComponent.getPerimeterSize();
            const footerBandHeight = columnHeight + footerPerimeter.top + footerPerimeter.bottom;

            footer = {
                band: {
                    x:      containerInsets.getLeft(),
                    y:      containerInsets.getTop() + containerSize.height - footerBandHeight,
                    width:  containerSize.width,
                    height: footerBandHeight,
                },
                columnHeight,
            };
        }

        const bodyVisible = container.isBodyVisible() && !!bodyComponent && bodyComponent.isDisplayed();

        return {
            columnWidths,
            availableWidth,
            header,
            footer,
            bodyVisible,
            containerInsets,
            containerSize,
        };
    }

    /**
     * Write phase: performs every write {@link Table.calculate} resolved,
     * in the same order the fused `doLayout` used to.
     *
     * @param geometry - The resolved geometry from {@link Table.calculate}.
     *
     * @remarks The header's inner content box (`headerBox`) and the body
     * band's header/footer height deductions are computed here, not in
     * `calculate`, because both read back *committed* state —
     * `header.getContentBounds()` and `header.getHeight()`/`footer.getHeight()`
     * — which can differ from the requested value whenever `setHeight`'s
     * clamp bites.
     */
    private commit(geometry: TableGeometry): void {
        const container = <TableComponent>this.getContainer();

        if (!container) {
            return;
        }

        container.setColumnWidths(geometry.columnWidths);

        const header = container.getHeader();
        const footer = container.getFooter();
        const body   = container.getBody();

        if (geometry.header && header) {
            const { band, columnHeight, parentRowHeight, filterRowHeight } = geometry.header;

            header.setBounds(band.x, band.y, band.width, band.height);

            // The rows are the header's own children, so their frame is the
            // header's content box, not the band: a row placed at the band's
            // origin and sized to the band starts inside the border and
            // overruns the far edge.
            const headerBox = header.getContentBounds()
                ?? { x: 0, y: 0, width: geometry.containerSize.width, height: band.height };

            // Rows stay at least as wide as the visible content box, and
            // wider when the columns overflow it, so cells off the right
            // edge can translate into view — because `Row`'s default
            // `overflow: hidden` would otherwise clip cells at the row's
            // right edge and prevent them from coming into view when the
            // inner rows translate left during a horizontal scroll.
            const columnSum = geometry.columnWidths.reduce((s, w) => s + w, 0);
            const innerRowW = Math.max(headerBox.width, columnSum);

            // Parent row is sized + positioned first so its `spanFrom`
            // / `spanTo` constraints translate to x/width sums over the
            // column-width array beneath. When `hasParentRow` is false
            // the parent row stays collapsed at zero height and its
            // cell pool is empty anyway — `header.renderColumnWindow`
            // below skips positioning it.
            const parentRow = header.getParentRow();
            parentRow.setBounds(headerBox.x, headerBox.y, innerRowW, parentRowHeight);

            // Column row sits beneath the parent row. The cell y-coords
            // are relative to the column row's element, so they stay at
            // y=0 — only the row itself shifts down by `parentRowHeight`.
            const columnRow = header.getComponents()[1];
            columnRow.setBounds(headerBox.x, headerBox.y + parentRowHeight, innerRowW, columnHeight);

            // Filter row sits beneath the column row, collapsing to zero
            // height (and zero cells, via `header.hasFilterRow()`) exactly
            // like the parent row above when it has nothing to show.
            const filterRow = header.getFilterRow();
            filterRow.setBounds(headerBox.x, headerBox.y + parentRowHeight + columnHeight, innerRowW, filterRowHeight);

            // Reconciles the header's rendered cells to the
            // horizontally-visible column range and positions every
            // rendered cell in all three rows — the header-side counterpart
            // of `body.renderWindow` below.
            header.renderColumnWindow({
                columnWidths:   geometry.columnWidths,
                viewportWidth:  geometry.availableWidth,
                columnHeight,
                parentRowHeight,
                filterRowHeight,
            });

            // Positions the column-menu button over the vertical-scrollbar
            // reservation band at the header's right edge, spanning it the
            // full band width and height (top to bottom, parent-header row
            // included when one is present) — the button carries the
            // header's own background and a divider (see the `TableHeader`
            // constructor), so it alone keeps cells scrolled horizontally
            // appearing to clip at the trackW boundary and the band visually
            // continuous with the header's gradient. Placed from `headerBox`,
            // the same rectangle the rows above are positioned against.
            //
            // Both axes are pinned via `setPreferredSize` rather than left to
            // the button's own glyph-derived size: `Button.setPreferredSize`
            // permanently opts it out of its own auto-sizing pipeline (see
            // its doc comment), which is what keeps this size from being
            // undone the next time `Absolute` (`TableHeader`'s own layout
            // manager) re-commits every child at `preferredSize ?? size` on
            // a header-level layout.
            //
            // `trackW` is the custom `Scrollbar`'s fixed track width, not the
            // native probe — the band must match what `Body`'s
            // `VirtualScroller` actually renders its own `Scrollbar` at.
            const trackW      = TRACK_WIDTH;
            const menuButton  = header.getMenuButton();
            const buttonSize  = { width: trackW, height: headerBox.height };

            menuButton.setPreferredSize(buttonSize);
            // `Absolute.doLayout`'s own `commitBounds` is what normally
            // cascades a freshly-positioned child into its own `doLayout()`
            // (see `LayoutManager.commitBounds`); this button is instead
            // positioned directly by this layout manager, mirroring how the
            // header/body/footer/rows above are positioned, so it needs the
            // same cascade `applyBounds` provides rather than `Absolute`'s.
            // Without it, the button's own `Fit` layout never runs and its
            // glyph is never actually placed — present in the DOM, sized,
            // but with no committed position, so nothing paints.
            menuButton.applyBounds(headerBox.x + headerBox.width - trackW, headerBox.y, buttonSize.width, buttonSize.height);
        }

        if (geometry.footer && footer) {
            const { band, columnHeight } = geometry.footer;

            footer.setBounds(band.x, band.y, band.width, band.height);

            // The footer's inner row is the footer's own child, so its cells
            // are sized from the footer's content box, not the band.
            const footerBox = footer.getContentBounds()
                ?? { x: 0, y: 0, width: geometry.containerSize.width, height: columnHeight };

            let x = 0;

            footer.getColumns().forEach((col, i) => {
                col.applyBounds(x, 0, geometry.columnWidths[i], footerBox.height);

                x += geometry.columnWidths[i];
            });
        }

        if (geometry.bodyVisible && body) {
            const headerHeight = geometry.header && header ? header.getHeight() : 0;
            const footerHeight = geometry.footer && footer ? footer.getHeight() : 0;

            body.setBounds(
                geometry.containerInsets.getLeft(),
                geometry.containerInsets.getTop() + headerHeight,
                geometry.containerSize.width,
                geometry.containerSize.height - headerHeight - footerHeight,
            );

            body.renderWindow(geometry.availableWidth, geometry.columnWidths);
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
     * keeping fixed-type columns and any column declaring `preserveWidth` at
     * their current size, and clamping all other columns to their per-column
     * constraints.
     *
     * @param container      - The Table component whose columns are being sized.
     * @param columns        - The visible resolved columns.
     * @param columnWidths   - The existing width array from the previous layout.
     * @param availableWidth - Total available pixel width for columns.
     * @returns The updated width array, or the original if no rescaling was needed.
     */
    private rescaleWidths(container: TableComponent, columns: Column[], columnWidths: number[], availableWidth: number): number[] {
        const isFixed = columns.map(col => this.isFixedColumn(col));

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
     * instead of leaving dead space at the right edge — never a fixed-type or
     * `preserveWidth` column. A no-op when the columns already fill the width
     * (the common case: no flexible column is capped) or overflow it.
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
            const isFlex = !this.isFixedColumn(col);

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
     * Returns whether a column is excluded from resize-driven
     * proportional rescaling: its width stays exactly as it is on every
     * container resize, and it never receives absorbed slack. True for
     * every `boolean` / `number` / `date` column (their content has a
     * fixed shape) and for any column declaring `preserveWidth`,
     * regardless of type.
     *
     * @param col - The column to classify.
     * @returns `true` when {@link Table.rescaleWidths} and
     *   {@link Table.absorbSlackIntoGreedy} should leave this column alone.
     */
    private isFixedColumn(col: Column): boolean {
        const t = col.getField().getType();

        return t === 'boolean' || t === 'number' || t === 'date' || col.isWidthPreserved();
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
