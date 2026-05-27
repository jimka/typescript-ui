// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Row } from "~/component/table/Row.js";
import { AbstractModel } from "~/data/AbstractModel.js";
import { AbstractStore, SortDescriptor } from "~/data/AbstractStore.js";
import { Field } from "~/data/Field.js";
import { Column } from "~/component/table/Column.js";
import { HeaderCell } from "~/component/table/cell/Header.js";
import { ParentHeaderCell } from "~/component/table/cell/ParentHeader.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { callable } from "~/core/Callable.js";

/**
 * A contiguous run of visible columns sharing a non-null group name (or a
 * single ungrouped column when {@link Column.getGroup} returns `null`).
 * Produced by walking the visible column list left-to-right; consumed by
 * the layout manager to position each {@link ParentHeaderCell}.
 */
export interface ParentSpan {
    /** Inclusive start index into the column-row's component list. */
    spanFrom: number;
    /** Inclusive end index into the column-row's component list. */
    spanTo:   number;
}

/**
 * The header section of a table, rendered as a `<thead>` element.
 *
 * Builds one {@link HeaderCell} per visible field from the supplied model. Each cell is
 * wired with a sort-click callback (cycles asc → desc → clear), a resize-drag
 * callback (forwarded to the owner via {@link Header.setOnColumnResize}), and a context-menu
 * callback (forwarded via {@link Header.setOnColumnContextMenu}).
 *
 * Re-exported as `TableHeader` from the package barrel.
 *
 * @category Components
 */
class Header extends Component {

    private _model: AbstractModel;
    private _store: AbstractStore;
    private _hiddenColumns: Set<string> = new Set();
    private _columns: Column[] = [];
    private _onResizeCallback: ((colIndex: number, delta: number) => void) | null = null;
    private _onColumnContextMenuCallback: ((fieldName: string, x: number, y: number) => void) | null = null;

    constructor(model: AbstractModel, store: AbstractStore) {
        super({ tag: "thead" });

        this.getAria().setRole("rowgroup");
        this.setBorder({ bottom: { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-table-header-border, black)" } });
        this.setBackgroundImage("var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))");

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
     * @param hidden - The new set of field names to hide.
     */
    setHiddenColumns(hidden: Set<string>): this {
        this._hiddenColumns = new Set(hidden);

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
     * Registers the callback invoked when the user drags a column resize handle.
     *
     * @param fn - Receives the zero-based column index and the pixel delta.
     */
    setOnColumnResize(fn: (colIndex: number, delta: number) => void): void {
        this._onResizeCallback = fn;
    }

    /**
     * Registers the callback invoked when the user right-clicks a header cell.
     *
     * @param fn - Receives the field name, and viewport x/y coordinates.
     */
    setOnColumnContextMenu(fn: (fieldName: string, x: number, y: number) => void): void {
        this._onColumnContextMenuCallback = fn;
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
     * are set independently by the table layout manager — `Header` itself
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
     * Removes all existing column-header cells and recreates them from the
     * visible fields of the current model, then re-syncs sort indicators.
     * Operates on the column row at child index 1; the parent row at
     * index 0 is rebuilt separately in {@link rebuildParentCells}.
     */
    private rebuildCells(): void {
        const row = this.getComponents()[1] as Row;

        row.removeAllComponents();

        const fields = this._model.getFields()
                                 .slice()
                                 .filter(f => !this._hiddenColumns.has(f.getName()))
                                 .sort((a, b) => a.getOrder() - b.getOrder());

        const columnMap = new Map(this._columns.map(c => [c.getField().getName(), c]));

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            const glyph = columnMap.get(field.getName())?.getHeaderGlyph() ?? null;
            const cell  = new HeaderCell(field.getName(), field.getName(), glyph);

            cell.setTooltip(field.getDescription());
            row.addComponent(cell, { data: field });
            this.wireCell(cell, i);
        }

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

            cell.setOnContextMenu((x, y) => {
                this._onColumnContextMenuCallback?.("", x, y);
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
     * Wires the sort, resize, and context-menu callbacks for one cell.
     *
     * @param cell - The header cell whose listeners are being attached.
     * @param idx - Zero-based column index used by the resize callback.
     */
    private wireCell(cell: HeaderCell, idx: number): void {
        cell.setOnSortClick((fieldName, shiftKey) => this.handleSortClick(fieldName, shiftKey));
        cell.setOnResizeDrag((delta) => this._onResizeCallback?.(idx, delta));
        cell.setOnContextMenu((fieldName, x, y) => this._onColumnContextMenuCallback?.(fieldName, x, y));
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

const HeaderCallable = callable(Header);
type HeaderCallable = Header;
export {
    Header         as _Header,
    HeaderCallable as Header
};
