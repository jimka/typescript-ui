// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Row } from "~/component/table/Row.js";
import { AbstractModel } from "~/data/AbstractModel.js";
import { AbstractStore, SortDescriptor } from "~/data/AbstractStore.js";
import { Field } from "~/data/Field.js";
import { Column } from "~/component/table/Column.js";
import { HeaderCell } from "~/component/table/cell/Header.js";
import { ParentHeaderCell } from "~/component/table/cell/ParentHeader.js";
import { computeColumnWindow } from "~/component/table/Body.js";
import { CellGeometryCache } from "~/component/table/CellGeometry.js";
import type { ColumnWindow } from "~/component/table/Body.js";
import { callable } from "~/core/Callable.js";

// The header surface, themed via `--ts-ui-table-header-bg`. The value is
// applied as BOTH a background-color and a background-image because the token
// is a flat colour in some themes (e.g. ModernTheme) and a gradient in others
// (e.g. ClassicTheme): a colour is invalid as a background-image (resolves to
// `none`) and a gradient is invalid as a background-color (resolves to
// transparent), so setting both lets whichever form the active theme supplies
// paint while the other harmlessly drops out. Setting only background-image —
// the previous behaviour — left the surface transparent under a flat-colour
// theme, which surfaced as a see-through scrollbar-cover band.
const TABLE_HEADER_BG = "var(--ts-ui-table-header-bg, var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))))";

/**
 * String-literal union of the events emitted by the table {@link TableHeader}.
 *
 * @category Components
 */
export type TableHeaderEvent = "columnresizestart" | "columnresize" | "columncontextmenu";

/**
 * The geometry the table layout supplies to the header on each pass. Cached
 * by {@link TableHeader.renderColumnWindow} so a scroll-driven pass can
 * re-run with no argument.
 *
 * @category Components
 */
export interface HeaderColumnGeometry {
    /** Width per visible column, in display order. May be shorter than the column list. */
    columnWidths   : number[];
    /** The width the columns are windowed against — the table's available column width. */
    viewportWidth  : number;
    /** Height of the column-header row, in pixels. */
    columnHeight   : number;
    /** Height of the parent-header row, in pixels; `0` when it is collapsed. */
    parentRowHeight: number;
}

/**
 * The header section of a table, rendered as a `<thead>` element.
 *
 * Builds one {@link HeaderCell} per column in its current column window —
 * the horizontally-visible range plus a small buffer, mirroring the body's
 * own column virtualization — rather than one per visible field up front.
 * Each cell is wired with a sort-click callback (cycles asc → desc → clear), a
 * resize-drag callback (forwarded to the owner via the `"columnresize"`
 * event), and a context-menu callback (forwarded via the
 * `"columncontextmenu"` event); see {@link TableHeader.on}.
 *
 * Re-exported as `TableHeader` from the package barrel.
 *
 * @category Components
 */
class TableHeader extends Component {

    private _model: AbstractModel;
    private _store: AbstractStore;
    private _hiddenColumns: Set<string> = new Set();
    private _columns: Column[] = [];
    private _listeners: ListenerBag<TableHeaderEvent> = new ListenerBag<TableHeaderEvent>();
    private _scrollbarCover: Handle | null = null;

    // Non-hidden fields, in display order — the full column list the
    // rendered window is carved out of. Populated by `rebuildCells`.
    private _visibleFields: Field[] = [];
    // Visible-column index of slot 0. The rendered columns are always a
    // contiguous run, so slot `s` holds column `_windowFirst + s`.
    private _windowFirst  : number = 0;
    private _scrollX      : number = 0;
    private _focusedCol   : number | null = null;
    // Set by `rebuildCells` so the next `renderColumnWindow` reconciles even
    // when the requested range happens to match the current one — a
    // column-set change can leave the range unchanged while the cells
    // behind it need to change.
    private _columnsDirty : boolean = true;
    private _geometry      : HeaderColumnGeometry = { columnWidths: [], viewportWidth: 0, columnHeight: 0, parentRowHeight: 0 };
    // Geometry last written to each header cell, shared with the body's rows;
    // see `CellGeometryCache` for the invariant it rests on.
    private _cellGeom     : CellGeometryCache = new CellGeometryCache();

    constructor(model: AbstractModel, store: AbstractStore) {
        super({ tag: "thead" });

        this.getAria().setRole("rowgroup");
        this.setBorder({ borderBottom: "1px solid var(--ts-ui-table-header-border, black)" });
        this.setBackgroundColor(TABLE_HEADER_BG);
        this.setBackgroundImage(TABLE_HEADER_BG);
        // Clip cells that would otherwise extend past the header's right
        // edge when the inner rows are translated horizontally.
        this.setOverflow("hidden");

        this._model = model;
        this._store = store;

        // Two `Row` children — parent row at index 0, column row at index 1.
        // The parent row collapses to zero height when no visible column
        // declares a group; existing no-group tables remain byte-identical
        // at runtime because `rebuildParentCells` produces no cells in
        // that case and the layout manager zeroes the parent-row height.
        const parentRow = new Row();
        const row       = new Row();
        this.addRow(parentRow);
        this.addRow(row);

        this.rebuildCells();
        this.rebuildParentCells();

        // Drops the records so the next layout pass re-fits every cell against
        // the new theme; see `CellGeometryCache` for why a theme change needs
        // that and geometry alone cannot detect it.
        //
        // Re-rendering from inside this callback, as
        // `VirtualRowView.onThemeReflow` does for the body, would run too
        // early: each cell renderer holds its own theme subscription that
        // rewrites the insets the pass has to fit against, and those renderers
        // subscribe after this header does, so the re-render would fit against
        // the outgoing theme's padding.
        this.subscribeTheme(() => this._cellGeom.clear());
    }

    /**
     * Returns the model driving this header's columns.
     *
     * @returns The {@link AbstractModel} currently bound to this header.
     */
    getModel() {
        return this._model;
    }

    /**
     * Swaps the store whose sort state this header drives and displays.
     *
     * @param store - The new store to bind to this header.
     *
     * @remarks Internal wiring called by the owning {@link Table} when its
     * bound store or display mode changes. Not for consumer use.
     */
    setStore(store: AbstractStore): this {
        this._store = store;

        return this;
    }

    /**
     * Replaces the model, rebuilding header cells only when the visible field list changes.
     *
     * @param model - The new model to bind to the header.
     *
     * @remarks If the new model has the same visible fields in the same order as the current
     * model, the existing cells are left in place and sort indicators are re-synced.
     */
    setModel(model: AbstractModel): this {
        const toNames = (model: AbstractModel) =>
            model.getFields()
                 .slice()
                 .filter(f => !this._hiddenColumns.has(f.getName()))
                 .sort((a, b) => a.getOrder() - b.getOrder())
                 .map(f => f.getName());

        const oldNames = toNames(this._model);
        const newNames = toNames(model);

        const same = oldNames.length === newNames.length
                     && oldNames.every((n, i) => n === newNames[i]);

        if (!same) {
            this._model = model;
            this.rebuildCells();
            this.rebuildParentCells();
        }

        this.syncSortIndicators();

        return this;
    }

    /**
     * Updates the set of hidden column field names, rebuilding the parent row
     * immediately and marking the column row's cells for reconciliation.
     *
     * The column row renders no cells until the next {@link renderColumnWindow},
     * which every caller reaches through the table's own layout pass.
     *
     * Field names belonging to {@link Column.isUnhideable} columns are stripped
     * from the set so a direct caller cannot bypass the unhideable contract.
     *
     * @param hidden - The new set of field names to hide.
     */
    setHiddenColumns(hidden: Set<string>): this {
        const filtered = new Set<string>();

        for (const name of hidden) {
            const col = this._columns.find(c => c.getField().getName() === name);

            if (!col || !col.isUnhideable()) {
                filtered.add(name);
            }
        }

        this._hiddenColumns = filtered;

        this.rebuildCells();
        this.rebuildParentCells();

        return this;
    }

    /**
     * Supplies the resolved {@link Column} list so that per-column header metadata
     * (e.g. `headerGlyph`, `group`) is available when cells are rebuilt.
     *
     * @param columns - The resolved columns in display order.
     * @returns This header, for method chaining.
     */
    setColumns(columns: Column[]): this {
        this._columns = columns;

        this.rebuildCells();
        this.rebuildParentCells();

        return this;
    }

    /**
     * Registers a listener for one of this header's events.
     *
     * @param event - `"columnresizestart"` fires on mousedown over a column
     *   resize handle, receiving the zero-based column index and the absolute
     *   pointer `clientX` at the moment the drag began; `"columnresize"` fires
     *   when the user drags a column resize handle, receiving the zero-based
     *   column index and the absolute pointer `clientX`; `"columncontextmenu"`
     *   fires on a right-click anywhere in the header band, receiving the field
     *   name (empty string when the click landed on a parent-header cell) and
     *   the viewport x/y coordinates.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This header, for method chaining.
     */
    on(event: "columnresizestart", listener: (colIndex: number, clientX: number) => void): this;
    on(event: "columnresize",      listener: (colIndex: number, clientX: number) => void): this;
    on(event: "columncontextmenu", listener: (fieldName: string, x: number, y: number) => void): this;
    on(event: TableHeaderEvent,         listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This header, for method chaining.
     */
    off(event: TableHeaderEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "columnresizestart", colIndex: number, clientX: number): void;
    protected emit(event: "columnresize",      colIndex: number, clientX: number): void;
    protected emit(event: "columncontextmenu", fieldName: string, x: number, y: number): void;
    protected emit(event: TableHeaderEvent,         ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Returns the rendered header cell components, in slot order. The column row
     * lives at child index 1 — the parent-header row sits at index 0.
     *
     * A slot maps to a visible-column index by adding
     * {@link getColumnWindowStart}: only the horizontally-visible column
     * window (plus a small buffer) is rendered, so this is no longer every
     * visible column.
     *
     * @returns An array of the rendered cell components from the column-header row.
     */
    getColumns() {
        return this.getComponents()[1].getComponents();
    }

    /**
     * Returns the visible-column index of the first rendered header cell.
     *
     * @returns The visible-column index slot `0` currently renders.
     */
    getColumnWindowStart(): number {
        return this._windowFirst;
    }

    /**
     * Returns the parent-header row hosting the {@link ParentHeaderCell}
     * instances. Always present, even when no visible column declares a
     * group — in that case the row has zero cells and the layout manager
     * collapses it to zero height.
     *
     * @returns The parent row.
     */
    getParentRow(): Row {
        return this.getComponents()[0] as Row;
    }

    /**
     * Returns `true` when at least one visible column declares a group —
     * i.e. the parent-header row is rendered with non-zero height.
     * Driven by {@link Column.getGroup} across the resolved visible
     * column list.
     *
     * @returns `true` when the parent row should be laid out, `false`
     *   when it should collapse.
     */
    hasParentRow(): boolean {
        return this._columns
            .filter(c => !this._hiddenColumns.has(c.getField().getName()))
            .some(c => c.getGroup() !== null);
    }

    /**
     * Returns the cover element that masks the vertical-scrollbar reservation
     * band at the header's right edge. Created lazily on first access; sized
     * and positioned by the table layout. Carries the same gradient as the
     * header so cells translated horizontally appear to clip at the trackW
     * boundary while the reservation band stays visually continuous with
     * the rest of the header.
     */
    getScrollbarCover(): Handle {
        if (this._scrollbarCover === null) {
            // `cover` is a raw presentational `<div>` owned by this header, not a
            // Component, so the Component style setters don't apply and direct
            // `.style` writes are correct here.
            const cover = DOM.sink.createElement("div");
            DOM.sink.apply(cover, { style: {
                "position":   "absolute",
                "top":        "0",
                "boxSizing":  "border-box",
                // Inner rows are Components with `z-index: 0`, which creates a
                // stacking context that paints AFTER positioned siblings with
                // `z-index: auto`. Without an explicit z-index here the cover
                // would be painted beneath the rows and cells could be seen
                // bleeding into the scrollbar-reservation band.
                "zIndex":     "1",
                // Presentational only; don't intercept pointer events so column
                // resize handles whose cells happen to be horizontally scrolled
                // under the cover still receive clicks.
                "pointerEvents":   "none",
                "backgroundColor": TABLE_HEADER_BG,
                "backgroundImage": TABLE_HEADER_BG,
                // Left border matches the column-cell right border so the cover
                // reads as a visual continuation of the column separators
                // rather than a seam in the gradient.
                "borderLeft": "1px solid var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))",
            } });
            DOM.sink.appendChild(this.getElement(true)!, cover);
            // Track the header-owned cover so it is released with the header
            // (on destructor or GC), not left pinned in the registry.
            this.trackHandle(cover);
            this._scrollbarCover = cover;
        }

        return this._scrollbarCover;
    }

    /**
     * Appends a row to the header.
     *
     * @param row - The row to append.
     */
    addRow(row: Row) : this {
        this.addComponent(row);

        return this;
    }

    /**
     * Adds a row as a child component of the header.
     *
     * @param row - The row component to add.
     *
     * @returns This component, for method chaining.
     */
    addComponent(row: Row): this {
        super.addComponent(row);

        return this;
    }

    /**
     * Sets the header height. Row-level widths, heights, and positions
     * are set independently by the table layout manager — `TableHeader` itself
     * just stores the total band height. The per-row assignments
     * live in `layout/Table.doLayout` because the split depends on
     * {@link hasParentRow} and on the header's own content box.
     *
     * @param height - The total header band height in pixels.
     *
     * @returns This component, for method chaining.
     */
    setHeight(height: number): this {
        super.setHeight(height);

        return this;
    }

    /**
     * Recomputes the visible-field list from the current model and hidden
     * set, marks the rendered cell set dirty, and re-syncs the sort
     * indicators. Builds no cells itself: the column row renders nothing
     * until the next {@link renderColumnWindow}, which reconciles against
     * the window the table layout hands it — mirroring `Body`, which
     * renders no rows until its first `renderWindow`.
     */
    private rebuildCells(): void {
        this._visibleFields = this.computeVisibleFields(this._model);
        this._columnsDirty  = true;

        this.syncSortIndicators();
    }

    /**
     * Filters and orders `model`'s fields to the currently-visible set:
     * every field not in `_hiddenColumns`, sorted by {@link Field.getOrder}.
     * Called by {@link rebuildCells} to populate `_visibleFields`, the
     * single derivation `syncSortIndicators` and {@link reconcileColumnCells}
     * both read from instead of re-deriving it themselves.
     *
     * @param model - The model whose fields to filter and order.
     * @returns The visible fields, in display order.
     */
    private computeVisibleFields(model: AbstractModel): Field[] {
        return model.getFields()
                    .slice()
                    .filter(f => !this._hiddenColumns.has(f.getName()))
                    .sort((f1, f2) => f1.getOrder() - f2.getOrder());
    }

    /**
     * Reconciles the column-row's rendered header cells to the
     * horizontally-visible column range `[firstCol, lastCol]`. A header
     * cell carries no per-kind identity — unlike the body's cell
     * reconciler — so any leftover cell can serve any entering column:
     *
     * 1. A column keeps the cell that already holds its field, matched by
     *    field name.
     * 2. Every other column in the range recycles a leftover cell, or
     *    builds a fresh one when none remains.
     * 3. Every per-column property (label, tooltip, glyph, group tint,
     *    required marker, ARIA column index) is re-applied to every
     *    rendered cell, whether or not it was re-targeted, so a recycled
     *    cell never shows a trace of its previous column.
     *
     * Cells left over after the window is filled are removed and disposed.
     * Called from {@link renderColumnWindow}, which positions the returned
     * cells afterward.
     *
     * @param firstCol - The first visible-column index to render, inclusive.
     * @param lastCol - The last visible-column index to render, inclusive.
     * @returns `true` when the rendered cell set changed.
     */
    private reconcileColumnCells(firstCol: number, lastCol: number): boolean {
        const row = this.getComponents()[1] as Row;

        if (!this._columnsDirty
            && firstCol === this._windowFirst
            && lastCol === this._windowFirst + row.getComponents().length - 1) {
            return false;
        }

        const columnMap = new Map(this._columns.map(c => [c.getField().getName(), c]));
        const existing  = row.getComponents().slice() as HeaderCell[];
        const byName    = new Map<string, HeaderCell>();

        for (const cell of existing) {
            const lc    = row.getLayoutConstraints(cell);
            const field = lc?.data as Field | undefined;

            if (field) {
                byName.set(field.getName(), cell);
            }
        }

        const slotCount = lastCol - firstCol + 1;
        const assigned: (HeaderCell | undefined)[] = new Array(slotCount).fill(undefined);

        // Pass 1 — keep a cell for its own field.
        for (let col = firstCol; col <= lastCol; col++) {
            const name = this._visibleFields[col].getName();
            const cell = byName.get(name);

            if (cell) {
                assigned[col - firstCol] = cell;
                byName.delete(name);
            }
        }

        const free = Array.from(byName.values());

        // Pass 2 — recycle a leftover, else build.
        for (let col = firstCol; col <= lastCol; col++) {
            const slot = col - firstCol;

            if (assigned[slot] !== undefined) {
                continue;
            }

            const field = this._visibleFields[col];
            let   cell  = free.pop();

            if (cell) {
                row.setLayoutConstraints(cell, { data: field });
            } else {
                cell = new HeaderCell(field.getName(), field.getName(), null);

                row.addComponent(cell, { data: field });

                // Wire exactly once, at creation. The resize/sort/context
                // closures resolve the cell's visible-column index live (via
                // columnIndexOf) at emit time, so a later hide/show/scroll
                // that shifts indices needs no re-wiring. Re-wiring a
                // surviving cell would stack duplicate listeners on its
                // ListenerBag — making a single drag emit `columnresize`
                // several times with mismatched indices, and a single header
                // click cycle the sort twice.
                this.wireCell(cell);
            }

            assigned[slot] = cell;
        }

        // Pass 3 — per-column state, re-applied to every rendered cell so a
        // recycled cell never shows a trace of its previous column.
        for (let col = firstCol; col <= lastCol; col++) {
            const cell   = assigned[col - firstCol]!;
            const field  = this._visibleFields[col];
            const column = columnMap.get(field.getName());

            cell.setFieldName(field.getName());
            cell.setHeaderText(column?.getHeaderText() ?? field.getName());

            const description = field.getDescription();

            if (cell.getTooltip() !== description) {
                cell.setTooltip(description);
            }

            const headerGlyph = column?.getHeaderGlyph() ?? null;

            if (cell.getHeaderGlyph() !== headerGlyph) {
                cell.setHeaderGlyph(headerGlyph);
            }

            cell.setBaseBackground(column?.getGroupColor() ?? null);
            cell.setRequired(column?.isRequired() ?? false);
            cell.getAria().setColIndex(col + 1);
        }

        // Discard what is left over.
        for (const cell of free) {
            row.removeComponent(cell);
            cell.dispose();
        }

        // Re-order children to the window's display order so sibling
        // iteration (e.g. `syncSortIndicators`) matches slot order.
        //
        // The order comes from `assigned`, which this reconciler just built in
        // slot order — not from re-sorting on `Field.getOrder()`. A model that
        // declares no `order` returns the -1 sentinel for every field, so an
        // order-based comparison ties throughout, the sort is a stable no-op,
        // and a recycled cell keeps whatever index it already held. That
        // desynchronises slot from column: `getColumns()[s]` stops being the
        // cell for column `_windowFirst + s`, which silently misplaces
        // geometry, resize indices, sort arrows and the focus underline.
        const slotOf = new Map(assigned.map((cell, slot) => [cell, slot]));

        row.sortComponents((c1, c2) =>
            (slotOf.get(c1 as HeaderCell) ?? 0) - (slotOf.get(c2 as HeaderCell) ?? 0));

        this._windowFirst  = firstCol;
        this._columnsDirty = false;

        return true;
    }

    /**
     * Removes all existing parent-header cells and recreates one
     * {@link ParentHeaderCell} per contiguous run of visible columns
     * sharing the same group key. Ungrouped columns each produce a
     * blank spanning cell so the parent row's surface stays continuous.
     *
     * The visible-column order is read from `_columns` filtered by
     * `_hiddenColumns` and sorted by {@link Field.getOrder} — same
     * resolution path used by {@link rebuildCells}. Each cell's
     * `spanFrom` / `spanTo` indices are stored in its layout constraints'
     * `data` slot; the table layout manager reads them to position the
     * cell as the sum of underlying column widths.
     */
    private rebuildParentCells(): void {
        const row = this.getParentRow();

        row.removeAllComponents();

        if (!this.hasParentRow()) {
            return;
        }

        const visibleCols = this._columns
            .filter(c => !this._hiddenColumns.has(c.getField().getName()))
            .sort((a, b) => a.getField().getOrder() - b.getField().getOrder());

        if (visibleCols.length === 0) {
            return;
        }

        let runStart = 0;
        let runKey   = visibleCols[0].getGroup();
        let runColor = visibleCols[0].getGroupColor();

        const flush = (endExclusive: number): void => {
            const cell = new ParentHeaderCell(runKey ?? "", runColor);

            // Field names spanned by this cell — drives the tooltip
            // and is also useful context if a future column-toggle
            // menu wants to operate on a whole group.
            const fieldNames = visibleCols
                .slice(runStart, endExclusive)
                .map(c => c.getField().getName());

            if (runKey !== null && fieldNames.length > 0) {
                cell.setTooltip(`${runKey}: ${fieldNames.join(", ")}`);
            }

            cell.on("contextmenu", (x, y) => {
                this.emit("columncontextmenu", "", x, y);
            });

            row.addComponent(cell, { data: { spanFrom: runStart, spanTo: endExclusive - 1 } });
        };

        for (let i = 1; i < visibleCols.length; i++) {
            const nextKey = visibleCols[i].getGroup();
            // Ungrouped columns (group === null) each get their own blank
            // span — they never merge with adjacent ungrouped columns.
            // A run continues only when both sides share the same
            // non-null group key.
            const runContinues = runKey !== null && nextKey === runKey;

            if (!runContinues) {
                flush(i);

                runStart = i;
                runKey   = nextKey;
                runColor = visibleCols[i].getGroupColor();
            } else if (runColor === null && visibleCols[i].getGroupColor() !== null) {
                // First non-null `groupColor` in a run wins; pick it up
                // when an earlier column omitted the field and a later
                // one supplied it.
                runColor = visibleCols[i].getGroupColor();
            }
        }

        flush(visibleCols.length);
    }

    /**
     * Wires the sort, resize, and context-menu callbacks for one cell. Called
     * exactly once per cell, at creation.
     *
     * @param cell - The header cell whose listeners are being attached.
     *
     * @remarks The resize callbacks report the cell's *current* visible-column
     * index by looking it up live through {@link columnIndexOf} when the event
     * fires, rather than capturing an index at wiring time. This keeps the
     * index correct after a hide/show/reorder/scroll shuffles the columns
     * without re-wiring — re-wiring would stack duplicate listeners on the
     * surviving cell's `ListenerBag`.
     */
    private wireCell(cell: HeaderCell): void {
        cell.on("sortclick",   (fieldName, shiftKey) => this.handleSortClick(fieldName, shiftKey));
        cell.on("resizestart", (clientX) => this.emit("columnresizestart", this.columnIndexOf(cell), clientX));
        cell.on("resizedrag",  (clientX) => this.emit("columnresize", this.columnIndexOf(cell), clientX));
        cell.on("contextmenu", (fieldName, x, y) => this.emit("columncontextmenu", fieldName, x, y));
    }

    /**
     * Converts a rendered cell to its visible-column index — the slot it
     * occupies in the column row plus the window's start offset.
     *
     * @param cell - The header cell to resolve.
     * @returns The visible-column index, or `-1` when the cell is not currently rendered.
     */
    private columnIndexOf(cell: HeaderCell): number {
        const slot = this.getColumns().indexOf(cell);

        return slot === -1 ? -1 : this._windowFirst + slot;
    }

    /**
     * Handles a click on a header cell, cycling sort state on the underlying store.
     *
     * @param fieldName - The field associated with the clicked column.
     * @param shiftKey - Whether the shift key was held; toggles multi-column sort composition.
     *
     * @remarks
     * Without shift, behaviour is asc → desc → cleared on the clicked column.
     * With shift, the column is appended/toggled within the existing sort list:
     * not present → append asc; asc → flip to desc; desc → remove from the list.
     */
    private handleSortClick(fieldName: string, shiftKey: boolean): void {
        if (shiftKey) {
            const sorters = this._store.getActiveSorters();
            const idx     = sorters.findIndex(s => s.field === fieldName);
            let next: SortDescriptor[];

            if (idx === -1) {
                next = [...sorters, { field: fieldName, dir: 'asc' }];
            } else if (sorters[idx].dir === 'asc') {
                next = sorters.map((s, i) =>
                    i === idx ? { field: s.field, dir: 'desc' } : s
                );
            } else {
                next = sorters.filter((_, i) => i !== idx);
            }

            if (next.length === 0) {
                this._store.clearSort();
            } else {
                this._store.sort(next);
            }
        } else {
            const sorters = this._store.getActiveSorters();
            const current = sorters.length === 1 && sorters[0].field === fieldName
                ? sorters[0] : null;

            if (!current) {
                this._store.sort(fieldName, 'asc');
            } else if (current.dir === 'asc') {
                this._store.sort(fieldName, 'desc');
            } else {
                this._store.clearSort();
            }
        }

        this.syncSortIndicators();
    }

    /**
     * Refreshes every rendered header cell's sort arrow and priority badge
     * to match the store's current `activeSorters` list.
     */
    private syncSortIndicators(): void {
        const cells         = this.getColumns() as HeaderCell[];
        const sorters       = this._store.getActiveSorters();
        const fieldToSorter = new Map(sorters.map((s, i) => [s.field, { dir: s.dir, priority: i + 1 }]));
        const showPriority  = sorters.length > 1;

        cells.forEach((cell, slot) => {
            const field = this._visibleFields[this._windowFirst + slot];
            const entry = field ? fieldToSorter.get(field.getName()) : undefined;

            if (entry) {
                cell.setSortState(entry.dir, showPriority ? entry.priority : null);
            } else {
                cell.clearSortState();
            }
        });
    }

    /**
     * Reconciles the rendered header cells to the horizontally-visible column
     * range and positions every rendered cell in both rows.
     *
     * @param geometry - Replaces the cached geometry when supplied; the cached
     *   value is reused when omitted.
     * @returns This header, for method chaining.
     */
    renderColumnWindow(geometry?: HeaderColumnGeometry): this {
        if (geometry) {
            this._geometry = geometry;
        }

        const g       = this._geometry;
        const widths  = this._visibleFields.map((_, i) => g.columnWidths[i] ?? 0);
        const win     = computeColumnWindow(widths, this._scrollX, g.viewportWidth);
        const changed = this.reconcileColumnCells(win.firstCol, win.lastCol);

        if (changed) {
            this.syncSortIndicators();
            this.applyFocusedColumn();
        }

        this.positionColumnCells(win, g.columnHeight);
        this.positionParentCells(win, g.parentRowHeight);

        return this;
    }

    /**
     * Positions every rendered column-row cell from the window's `lefts`
     * and `widths` arrays — the same geometry {@link reconcileColumnCells}
     * just reconciled the cell set against.
     *
     * @param win - The column window computed by {@link renderColumnWindow}.
     * @param columnHeight - The column row's height in pixels.
     */
    private positionColumnCells(win: ColumnWindow, columnHeight: number): void {
        const cells = this.getColumns();

        for (let slot = 0; slot < cells.length; slot++) {
            const col = win.firstCol + slot;

            this._cellGeom.apply(cells[slot], win.lefts[col] ?? 0, win.widths[col] ?? 0, columnHeight);
        }
    }

    /**
     * Positions every parent-row cell from the window's `lefts` / `widths`
     * arrays in constant time: a cell's x is the left offset of its
     * `spanFrom` column, and its width is the sum of every column across
     * its span.
     *
     * @param win - The column window computed by {@link renderColumnWindow}.
     * @param parentRowHeight - The parent row's height in pixels; `0` when collapsed.
     */
    private positionParentCells(win: ColumnWindow, parentRowHeight: number): void {
        const row = this.getParentRow();

        for (const cell of row.getComponents()) {
            const lc   = row.getLayoutConstraints(cell);
            const span = lc?.data as { spanFrom: number, spanTo: number } | undefined;
            const from = span?.spanFrom ?? 0;
            const to   = span?.spanTo   ?? 0;
            const x    = win.lefts[from] ?? 0;
            const w    = (win.lefts[to] ?? 0) + (win.widths[to] ?? 0) - x;

            this._cellGeom.apply(cell, x, w, parentRowHeight);
        }
    }

    /**
     * Mirrors the body's horizontal scroll offset onto the header's two inner
     * rows and re-renders the column window.
     *
     * Translates the two inner rows (parent row + column row) rather than the
     * header element itself — the header band stays pinned to the viewport
     * width so its background covers the vertical-scrollbar reserve band on
     * the right edge, and only the cells inside scroll with the body.
     *
     * @param scrollLeft - The new horizontal scroll offset, in pixels.
     * @returns This header, for method chaining.
     */
    setScrollX(scrollLeft: number): this {
        if (scrollLeft === this._scrollX) {
            return this;
        }

        this._scrollX = scrollLeft;

        this.getParentRow().setTranslate(-scrollLeft, 0);
        this.getComponents()[1].setTranslate(-scrollLeft, 0);

        this.renderColumnWindow();

        return this;
    }

    /**
     * Returns the horizontal scroll offset last applied.
     *
     * @returns The scroll offset in pixels.
     */
    getScrollX(): number {
        return this._scrollX;
    }

    /**
     * Paints the column-focus underline on the rendered cell for `colIndex`
     * and clears it everywhere else. `null` clears every cell.
     *
     * @param colIndex - The visible-column index to focus, or `null` to clear.
     * @returns This header, for method chaining.
     */
    setFocusedColumn(colIndex: number | null): this {
        this._focusedCol = colIndex;

        this.applyFocusedColumn();

        return this;
    }

    /**
     * Re-applies `_focusedCol` to the currently-rendered cells. Called
     * directly from {@link setFocusedColumn} and again at the end of every
     * reconcile that changed the rendered set, so a cell recycled into the
     * focused column picks up the underline without waiting for the next
     * explicit `setFocusedColumn` call.
     */
    private applyFocusedColumn(): void {
        const cells = this.getColumns() as HeaderCell[];

        for (let slot = 0; slot < cells.length; slot++) {
            cells[slot].setColumnFocused(this._windowFirst + slot === this._focusedCol);
        }
    }
}

const TableHeaderCallable = callable(TableHeader);
type TableHeaderCallable = TableHeader;
export {
    TableHeader         as _TableHeader,
    TableHeaderCallable as TableHeader
};
