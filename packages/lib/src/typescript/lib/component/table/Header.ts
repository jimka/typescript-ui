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
 * The header section of a table, rendered as a `<thead>` element.
 *
 * Builds one {@link HeaderCell} per visible field from the supplied model. Each cell is
 * wired with a sort-click callback (cycles asc → desc → clear), a resize-drag
 * callback (forwarded to the owner via the `"columnresize"` event), and a
 * context-menu callback (forwarded via the `"columncontextmenu"` event); see
 * {@link TableHeader.on}.
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
     * Updates the set of hidden column field names and rebuilds both header
     * rows immediately.
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
     * Returns the header cell components in column order. The column row
     * lives at child index 1 — the parent-header row sits at index 0.
     *
     * @returns An array of cell components from the column-header row.
     */
    getColumns() {
        return this.getComponents()[1].getComponents();
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
     * Reorders header cells by field order using their layout constraints.
     */
    sortColumns() {
        const row = this.getComponents()[1];

        row.sortComponents((c1, c2) => {
            const lc1 = row.getLayoutConstraints(c1);
            const lc2 = row.getLayoutConstraints(c2);

            if (!lc1) {
                return -1;
            }

            if (!lc2) {
                return 1;
            }

            return (lc1.data as Field).getOrder() - (lc2.data as Field).getOrder();
        });
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
     * Sets the header width and propagates it to both the parent and
     * column rows so the full header band shares the same width.
     *
     * @param width - The width in pixels.
     *
     * @returns This component, for method chaining.
     */
    setWidth(width: number): this {
        super.setWidth(width);

        const rows = this.getComponents();
        rows[0].setWidth(width);
        rows[1].setWidth(width);

        return this;
    }

    /**
     * Sets the header height. Row-level heights (parent row + column row)
     * are set independently by the table layout manager — `TableHeader` itself
     * just stores the total band height. The per-row height assignments
     * live in `layout/Table.doLayout` because the split depends on
     * {@link hasParentRow}.
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
     * Reconciles the column-row's header cells against the current
     * model's visible fields. Surviving cells (whose field is still
     * visible) keep their sort indicator, resize-handle wiring,
     * tooltip, theme listener, and `setColumnFocused` state; cells for
     * newly-visible fields are constructed and wired; cells for
     * now-hidden fields are removed.
     *
     * Operates on the column row at child index 1; the parent row at
     * index 0 is rebuilt separately in {@link rebuildParentCells}.
     */
    private rebuildCells(): void {
        const row = this.getComponents()[1] as Row;

        const targetFields = this._model.getFields()
                                       .slice()
                                       .filter(f => !this._hiddenColumns.has(f.getName()))
                                       .sort((a, b) => a.getOrder() - b.getOrder());

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

        const targetNames = new Set(targetFields.map(f => f.getName()));

        for (const cell of existing) {
            const lc    = row.getLayoutConstraints(cell);
            const field = lc?.data as Field | undefined;

            if (!field || !targetNames.has(field.getName())) {
                row.removeComponent(cell);
            }
        }

        for (let i = 0; i < targetFields.length; i++) {
            const field = targetFields[i];
            const col   = columnMap.get(field.getName());
            let   cell  = byName.get(field.getName());

            if (!cell) {
                const glyph = col?.getHeaderGlyph() ?? null;

                cell = new HeaderCell(field.getName(), field.getName(), glyph);
                cell.setTooltip(field.getDescription());

                row.addComponent(cell, { data: field });

                // Wire exactly once, at creation. The resize/sort/context
                // closures resolve the cell's visible-column index live (via
                // getColumns) at emit time, so a later hide/show that shifts
                // indices needs no re-wiring. Re-wiring a surviving cell would
                // stack duplicate listeners on its ListenerBag — making a
                // single drag emit `columnresize` several times with mismatched
                // indices, and a single header click cycle the sort twice.
                this.wireCell(cell);
            }

            // Tint the column header with the group's `groupColor` so
            // the header band reads as one visual group above the
            // matching body-cell tint applied in Row.ts. `Cell`'s
            // theme-change listener only re-applies the border, so
            // this background survives a theme swap. Re-applied on
            // every sync so a config swap that changed the tint also
            // takes effect.
            const groupColor = col?.getGroupColor();

            if (groupColor) {
                cell.setBackgroundColor(groupColor);
            }

            // Re-applied on every sync (unconditionally, not gated on
            // an `isRequired()` truthy check) so a config swap that
            // clears `required` also clears the asterisk on a
            // surviving cell — mirrors the group-tint cadence above.
            cell.setRequired(col?.isRequired() ?? false);
        }

        // Re-order children to the new visible-field display order so
        // sibling iteration (e.g. `syncSortIndicators`) matches the
        // visible-field list index.
        row.sortComponents((c1, c2) => {
            const f1 = (row.getLayoutConstraints(c1)?.data as Field).getOrder();
            const f2 = (row.getLayoutConstraints(c2)?.data as Field).getOrder();

            return f1 - f2;
        });

        this.syncSortIndicators();
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
     * index by looking it up live through {@link getColumns} when the event
     * fires, rather than capturing an index at wiring time. This keeps the
     * index correct after a hide/show/reorder shuffles the columns without
     * re-wiring — re-wiring would stack duplicate listeners on the surviving
     * cell's `ListenerBag`.
     */
    private wireCell(cell: HeaderCell): void {
        cell.on("sortclick",   (fieldName, shiftKey) => this.handleSortClick(fieldName, shiftKey));
        cell.on("resizestart", (clientX) => this.emit("columnresizestart", this.getColumns().indexOf(cell), clientX));
        cell.on("resizedrag",  (clientX) => this.emit("columnresize", this.getColumns().indexOf(cell), clientX));
        cell.on("contextmenu", (fieldName, x, y) => this.emit("columncontextmenu", fieldName, x, y));
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
     * Refreshes every visible header cell's sort arrow and priority badge
     * to match the store's current `activeSorters` list.
     */
    private syncSortIndicators(): void {
        const cells         = this.getColumns() as HeaderCell[];
        const visibleFields = this._model.getFields()
                                        .slice()
                                        .filter(f => !this._hiddenColumns.has(f.getName()))
                                        .sort((a, b) => a.getOrder() - b.getOrder());

        const sorters       = this._store.getActiveSorters();
        const fieldToSorter = new Map(sorters.map((s, i) => [s.field, { dir: s.dir, priority: i + 1 }]));
        const showPriority  = sorters.length > 1;

        cells.forEach((cell, i) => {
            const fieldName = visibleFields[i]?.getName();
            const entry     = fieldName ? fieldToSorter.get(fieldName) : undefined;

            if (entry) {
                cell.setSortState(entry.dir, showPriority ? entry.priority : null);
            } else {
                cell.clearSortState();
            }
        });
    }
}

const TableHeaderCallable = callable(TableHeader);
type TableHeaderCallable = TableHeader;
export {
    TableHeader         as _TableHeader,
    TableHeaderCallable as TableHeader
};
