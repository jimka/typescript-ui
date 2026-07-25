// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Table as TableLayout } from "~/layout/Table.js";
import { TableHeader } from "~/component/table/Header.js";
import { Body } from "~/component/table/Body.js";
import type { CellClickEvent } from "~/component/table/Body.js";
import { FooterRow } from "~/component/table/Footer.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { MemoryStore } from "~/data/MemoryStore.js";
import { Model } from "~/data/Model.js";
import type { Field } from "~/data/Field.js";
import { Insets } from "~/primitive/Insets.js";
import { Menu } from "~/overlay/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { Column } from "~/component/table/Column.js";
import type { CellType, ColumnConfig, ComboOption } from "~/component/table/ColumnConfig.js";
import { ColumnSpec } from "~/component/table/ColumnConfig.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { TableExporter, ExportOptions } from "~/component/table/TableExporter.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";

/** Events emitted by {@link Table}. */
export type TableEvent = "selection" | "cellclick";

/** Which presentation a Table renders: record-per-row, or one record as key/value rows. */
export type TableDisplayMode = "normal" | "rotated";

// The model backing the rotated key/value projection: one record per source
// field, `field` holding the field name and `value` holding that field's value
// on the displayed record. `value` is declared `'auto'` because the projection
// carries every source field's native type (string, number, boolean, Date, …)
// in the same column. `filler` is a blank, unbounded spacer column that soaks
// up leftover table width so `field` / `value` stay compact on a wide table.
const ROTATED_MODEL = new Model([
    { name: 'field',  type: 'string', order: 0 },
    { name: 'value',  type: 'auto',   order: 1 },
    { name: 'filler', type: 'string', order: 2 },   // blank spacer column; absorbs leftover width
]);

/**
 * Construction-time options for {@link Table}.
 *
 * Table's primary configuration is the positional `(store, spec)` constructor
 * pair; this options bag carries only inherited Component styling. Defined
 * here so `this._options` is typed at the leaf class and Phase 6 has a place
 * to grow if Table starts accepting an options object.
 *
 * @category Components
 */
export interface TableOptions extends ComponentOptions {
}

/**
 * A data-bound table component rendered as an HTML `<table>` element.
 *
 * Composes a {@link TableHeader}, a virtual-scrolling {@link Body}, and an optional
 * {@link FooterRow}. Exposes CRUD and sync operations that delegate to the underlying
 * {@link AbstractStore}.
 *
 * An optional {@link ColumnSpec} controls which columns appear, their display
 * constraints (`minWidth`, `maxWidth`), and initial visibility. When no spec is
 * supplied the table auto-generates one column per model field — identical to the
 * pre-spec behaviour.
 *
 * {@link setDisplayMode | Rotated mode} (`"normal"` | `"rotated"`) swaps the
 * presentation to psql `\x`-style key/value rows: one `field`/`value` row per
 * source field of the selected record, built from a two-field
 * [`Model`](/api/data/classes/Model) projection and driven through the same
 * header and body — including per-field cell variants via
 * {@link ColumnConfig}'s `cellType` / `cellValues`. The projection is
 * read-only; see {@link setDisplayMode} for details.
 *
 * @example
 * ```typescript
 * import { Model, MemoryStore } from '@jimka/typescript-ui/data';
 * import { Table } from '@jimka/typescript-ui/component/table';
 *
 * const PersonModel = new Model([
 *     { name: 'id',   type: 'number' },
 *     { name: 'name', type: 'string' },
 *     { name: 'age',  type: 'number' },
 * ]);
 *
 * const store = new MemoryStore(PersonModel, [
 *     { id: 1, name: 'Alice', age: 30 },
 *     { id: 2, name: 'Bob',   age: 25 },
 * ]);
 * await store.load();
 *
 * const table = new Table(store);
 * panel.addComponent(table);
 * ```
 *
 * @category Components
 */
class Table extends Component<TableOptions> {

    private _store            : AbstractStore;
    private _spec             : ColumnSpec | undefined;
    private _resolvedColumns  : Column[] = [];
    private _hiddenColumns    : Set<string> = new Set();
    private _columnContextMenu: Menu = new Menu();
    private _headerVisible    : boolean;
    private _header           : TableHeader;
    private _body             : Body;
    private _bodyVisible      : boolean;
    private _footer           : FooterRow;
    private _footerVisible    : boolean;
    private _columnWidths     : number[] = [];
    private _resizeOriginClientX: number = 0;
    private _resizeOriginW0    : number = 0;
    private _resizeOriginW1    : number = 0;
    private _savedColumnWidths: Map<string, number> = new Map();
    private _columnConfigs    : Map<string, ColumnConfig> = new Map();
    private _exportMenuEnabled: boolean = false;
    private _listeners        : ListenerBag<TableEvent> = new ListenerBag<TableEvent>();
    private _displayMode      : TableDisplayMode = "normal";
    private _rotatedRecord    : ModelRecord | null = null;
    private _rotatedStore     : MemoryStore | null = null;
    private _rotatedColumns   : Column[] = [];
    private _rotatedConfigs   : Map<string, ColumnConfig> = new Map();
    private _rotatedFieldByName: Map<string, Field> = new Map();
    private _sourceRefresh    : (() => void) | null = null;
    private _suppressSelectionForward: boolean = false;

    /**
     * Constructs a Table bound to the given store, optionally constrained by a
     * column presentation spec.
     *
     * @param store - The data store to bind to this table.
     * @param spec  - Optional column spec; omit to auto-generate all columns.
     * @param bodyFactory - Optional. Closure that constructs the body
     *   component. Used by [`TreeTable`](/api/component/table/classes/TreeTable)
     *   to install a [`TreeBody`](/api/component/table/classes/TreeBody)
     *   in place of the default flat-list body. A closure (not a
     *   subclass-overridable method) avoids the class-field super-trap
     *   that would otherwise read tree-spec fields before they are
     *   initialised.
     */
    constructor(store: AbstractStore, spec?: ColumnSpec, bodyFactory?: (store: AbstractStore) => Body) {
        super({ tag: "table" });

        this.setLayoutManager(new TableLayout());
        this.getAria().setRole("grid");
        this.setBorder({ border: "1px solid var(--ts-ui-border-color, black)" });
        this.setInsets(new Insets(0, 0, 0, 0));
        this.setOverflow("hidden");
        this.setMinSize({ width: 100, height: 100 });

        this._store = store;
        this._spec = spec;
        this._headerVisible = true;
        this._bodyVisible = true;
        this._footerVisible = false;

        this.bindSourceStore(store);

        this._resolvedColumns = Column.resolve(store.model.getFields(), spec);
        this.initHiddenFromSpec();

        this._header = new TableHeader(store.model, store);
        this._header.on("columnresizestart",  (i, clientX) => this.onColumnResizeStart(i, clientX));
        this._header.on("columnresize",        (i, clientX) => this.onColumnResize(i, clientX));
        this._header.on("columncontextmenu",  (_, x, y) => this.showColumnMenu(x, y));
        // The header is the permanent target of horizontal scroll mirroring (see the
        // scroll listener below), so promote it to its own compositor layer for the
        // Table's lifetime. One hint per Table is well under the per-page threshold.
        this._header.setWillChange("transform");
        this.addComponent(this._header);
        this._header.setColumns(this._resolvedColumns);

        this._body = bodyFactory ? bodyFactory(store) : new Body(store);
        this._body.setHeader(this._header);
        this.addComponent(this._body);
        this._body.setColumns(this._resolvedColumns);

        this._footer = new FooterRow();
        this.addComponent(this._footer);

        const effectiveHidden = this.getEffectiveHiddenSet();

        if (effectiveHidden.size > 0) {
            this._header.setHiddenColumns(effectiveHidden);
            this._body.setHiddenColumns(effectiveHidden);
        }

        if (spec) {
            this._columnConfigs = this.buildColumnConfigs(spec);
            this._body.setColumnConfigs(this._columnConfigs);
        }

        this._body.setRowReadOnly(spec?.rowReadOnly ?? null);

        this.getAria().setColCount(this.getColumns().length);

        // Sync header horizontal scroll with body. The body uses
        // transform-based virtual scroll (via `VirtualScroller`), so the
        // native DOM `scroll` event never fires; hook the body's
        // `on("horizontalscroll")` listener instead. Translate the header's
        // two inner rows (parent row + column row) rather than the header
        // element itself — the header band stays pinned to the viewport
        // width so its background covers the vertical-scrollbar reserve
        // band on the right edge, and only the cells inside scroll with
        // the body.
        this._body.on("horizontalscroll", scrollLeft => {
            this._header.getParentRow().setTranslate(-scrollLeft, 0);
            this._header.getComponents()[1].setTranslate(-scrollLeft, 0);
        });

        // Surface the body's selection changes on the Table's own event so
        // consumers can react (e.g. enabling a delete action) without reaching
        // into the private body. Suppressed during a bindView re-bind (whose
        // transient `_body.selectRecord(null)` would otherwise leak a spurious
        // empty selection) and while rotated, where selection is driven by
        // `_rotatedRecord` instead of the body's own selection state.
        this._body.on("selection", records => {
            if (this._suppressSelectionForward || this._displayMode === "rotated") {
                return;
            }

            this.emit("selection", records);
        });

        // Forward the body's column-aware cell-click on the Table's own event,
        // mirroring the selection forward above so consumers can react to a
        // click on a specific cell (record + column) without inferring the
        // column from a selection change.
        this._body.on("cellclick", e => this.emit("cellclick", e));
    }

    /**
     * Registers a listener for one of this table's events.
     *
     * @param event - `"selection"` fires whenever the selected-record set
     *   changes, receiving the current selection; `"cellclick"` fires when a
     *   data cell is clicked, carrying the clicked record, the column's field
     *   name and visible index, the cell value, the record's row index in the
     *   visible-records view, and the raw mouse event.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This table, for method chaining.
     */
    on(event: "selection", listener: (records: ModelRecord[]) => void): this;
    on(event: "cellclick",       listener: (e: CellClickEvent) => void): this;
    on(event: TableEvent,        listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This table, for method chaining.
     */
    off(event: TableEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event`, in registration order.
     *
     * @param event - The event to emit.
     * @param payload - The current selection (`"selection"`) or the
     *   cell-click detail (`"cellclick"`) forwarded to each listener.
     */
    protected emit(event: "selection", records: ModelRecord[]): void;
    protected emit(event: "cellclick", detail: CellClickEvent): void;
    protected emit(event: TableEvent, payload: ModelRecord[] | CellClickEvent): void {
        this._listeners.fire(event, payload);
    }

    /**
     * Returns the columns this table currently renders: the two-column
     * `field`/`value` projection while {@link getDisplayMode} is `"rotated"`,
     * otherwise the resolved, visible source columns in field display order.
     *
     * @returns The active {@link Column} instances in display order.
     */
    getColumns(): Column[] {
        return this._displayMode === "rotated" ? this._rotatedColumns : this.getSourceColumns();
    }

    /**
     * Returns the resolved, visible source columns in display order,
     * regardless of the active display mode.
     *
     * Excludes columns that are currently hidden (via runtime toggle or the spec's
     * `hidden` flag) and columns excluded by a strict spec (`appendUnlisted: false`).
     *
     * @returns Visible source {@link Column} instances in field display order.
     */
    private getSourceColumns(): Column[] {
        const effective = this.getEffectiveHiddenSet();

        return this._resolvedColumns.filter(c => !effective.has(c.getField().getName()));
    }

    /**
     * Returns the active display mode.
     *
     * @returns `"normal"` (one row per record) or `"rotated"` (one selected
     *   record shown as key/value rows). Defaults to `"normal"`.
     */
    getDisplayMode(): TableDisplayMode {
        return this._displayMode;
    }

    /**
     * Switches between the normal (record-per-row) and rotated (key/value)
     * presentations. No-op when already in `mode`.
     *
     * Entering `"rotated"` adopts the currently selected record as the
     * displayed record — falling back to the store's first record, then to
     * nothing — and re-points the header and body at a two-column `field`/
     * `value` projection built from it; see the [`Table` rotated record
     * view](/components/Table#rotated-record-view) docs. Returning to
     * `"normal"` restores the source columns and re-selects the record that
     * was displayed while rotated. The projection is read-only; sorting it
     * reorders the field rows without touching the source store's own sort.
     *
     * @param mode - The display mode to switch to.
     * @returns This table, for method chaining.
     */
    setDisplayMode(mode: TableDisplayMode): this {
        if (mode === this._displayMode) {
            return this;
        }

        this._displayMode = mode;

        if (mode === "rotated") {
            this._rotatedRecord = this._body.getSelectedRecord() ?? this._store.getRecords()[0] ?? null;

            const rotatedStore = this.ensureRotatedStore();

            this.rebuildRotatedStore();
            this.bindView(rotatedStore, this._rotatedColumns, this._rotatedConfigs, new Set(), () => true);
            this.emit("selection", this._rotatedRecord ? [this._rotatedRecord] : []);
        } else {
            this.bindView(this._store, this.getSourceColumns(), this._columnConfigs, this.getEffectiveHiddenSet(), this._spec?.rowReadOnly ?? null);
            this._body.selectRecord(this._rotatedRecord);
        }

        return this;
    }

    /**
     * Returns the data store this table is bound to.
     *
     * @returns The current {@link AbstractStore}.
     */
    getStore(): AbstractStore {
        return this._store;
    }

    /**
     * Returns the model associated with this table's store.
     *
     * @returns The model from the store.
     */
    getModel() {
        return this._store.model;
    }

    /**
     * Replaces the data store, re-resolves columns from the new model, and updates
     * the body and header to reflect the change. Leaves rotated mode first — the
     * projection is built from the outgoing store, and would sort/select the
     * wrong store otherwise.
     *
     * @param store - The new store to bind to the table.
     */
    setStore(store: AbstractStore): this {
        this.setDisplayMode("normal");

        this._header.setStore(store);
        this.unbindSourceStore(this._store);

        this._store = store;
        this._columnWidths = [];
        this._savedColumnWidths = new Map();
        this._resolvedColumns = Column.resolve(store.model.getFields(), this._spec);

        this.bindSourceStore(store);

        this._body.setStore(store);
        this._header.setModel(store.model);
        this._header.setColumns(this._resolvedColumns);
        this._body.setColumns(this._resolvedColumns);
        this._header.setHiddenColumns(this.getEffectiveHiddenSet());
        this.getAria().setColCount(this.getColumns().length);

        return this;
    }

    /**
     * Returns the per-column width array maintained by the layout manager.
     *
     * @returns The current column widths in pixels.
     */
    getColumnWidths(): number[] {
        return this._columnWidths;
    }

    /**
     * Stores the per-column width array (called by the layout manager on each layout pass).
     *
     * @param widths - The new column widths in pixels.
     * @remarks Also mirrors each width into `savedColumnWidths` keyed by field name so
     * that show/hide toggles can restore per-column widths without a full re-initialisation.
     */
    setColumnWidths(widths: number[]): this {
        this._columnWidths = widths;

        const visibleColumns = this.getColumns();

        widths.forEach((w, i) => {
            const col = visibleColumns[i];

            if (col) {
                this._savedColumnWidths.set(col.getField().getName(), w);
            }
        });

        return this;
    }

    /**
     * Shows or hides the column identified by the given field name.
     *
     * Only columns present in the resolved column list can be toggled; columns
     * excluded by a strict spec (`appendUnlisted: false`) are unaffected.
     *
     * Calls to hide a column marked `unhideable: true` in the spec are a no-op —
     * the column always remains visible. Calls to show any column run normally.
     *
     * Manually resized widths are preserved across visibility toggles. When showing
     * a column introduces extra width that would overflow the container, existing
     * columns are proportionally trimmed via `trimToTarget` to make room before
     * the layout manager runs.
     *
     * A no-op while {@link getDisplayMode} is `"rotated"` — the projection's
     * `field` and `value` columns are always both shown.
     *
     * @param fieldName - The model field name of the column to toggle.
     * @param visible   - `true` to show the column, `false` to hide it.
     */
    setColumnVisible(fieldName: string, visible: boolean): this {
        if (this._displayMode === "rotated") {
            return this;
        }

        if (!visible) {
            const col = this._resolvedColumns.find(c => c.getField().getName() === fieldName);

            if (col && col.isUnhideable()) {
                return this;
            }
        }

        if (visible) {
            this._hiddenColumns.delete(fieldName);
        } else {
            this._hiddenColumns.add(fieldName);
        }

        const newVisibleColumns = this.getColumns();
        const rawWidths = newVisibleColumns.map(col =>
            this._savedColumnWidths.get(col.getField().getName()) ?? this.defaultColumnWidth(col)
        );
        const savedTotal = this._columnWidths.reduce((s, w) => s + w, 0);
        const rawTotal   = rawWidths.reduce((s, w) => s + w, 0);

        this._columnWidths = (rawTotal > savedTotal + 0.5 && savedTotal > 0)
            ? this.trimToTarget(newVisibleColumns, rawWidths, savedTotal, fieldName)
            : rawWidths;

        const effectiveHidden = this.getEffectiveHiddenSet();

        this._header.setHiddenColumns(effectiveHidden);
        this._body.setHiddenColumns(effectiveHidden);
        this.getAria().setColCount(this.getColumns().length);
        this.doLayout();

        return this;
    }

    /**
     * Returns the table header component.
     *
     * @returns The {@link TableHeader} section of this table.
     */
    getHeader() {
        return this._header;
    }

    /**
     * Returns whether the header section is visible.
     *
     * @returns `true` if the header is visible.
     */
    isHeaderVisible() {
        return this._headerVisible;
    }

    /**
     * Returns the table body component.
     *
     * @returns The virtual-scrolling {@link Body} section of this table.
     */
    getBody() {
        return this._body;
    }

    /**
     * Returns whether the body section is visible.
     *
     * @returns `true` if the body is visible.
     */
    isBodyVisible() {
        return this._bodyVisible;
    }

    /**
     * Returns the table footer component.
     *
     * @returns The {@link FooterRow} section of this table.
     */
    getFooter() {
        return this._footer;
    }

    /**
     * Returns whether the footer section is visible.
     *
     * @returns `true` if the footer is visible.
     */
    isFooterVisible() {
        return this._footerVisible;
    }

    /**
     * Adds a new record to the store, scrolls to it, and selects it. While
     * rotated, the new record becomes the displayed record instead of
     * scrolling (there is no row to scroll to — see {@link selectRecord}).
     *
     * @param defaults - Optional initial field values for the new record.
     *
     * @returns The newly created {@link ModelRecord}.
     */
    addRow(defaults: Record<string, any> = {}): ModelRecord {
        const [record] = this._store.add(defaults);

        if (this._displayMode === "rotated") {
            this.selectRecord(record);

            return record;
        }

        this._body.scrollToRecord(record);
        this._body.selectRecord(record);

        return record;
    }

    /**
     * Removes the currently selected record from the store. While rotated,
     * removes the displayed record; the source-store listener then re-targets
     * the view to the store's next remaining record.
     */
    removeSelectedRow(): this {
        if (this._displayMode === "rotated") {
            if (this._rotatedRecord) {
                this._store.remove(this._rotatedRecord);
            }

            return this;
        }

        const record = this._body.getSelectedRecord();

        if (!record) {
            return this;
        }

        this._body.selectRecord(null);
        this._store.remove(record);

        return this;
    }

    /**
     * Selects the given record — or clears the selection when `null` — and
     * scrolls it into view, driving the selection programmatically without the
     * caller reaching into the private body. This is the read/write counterpart
     * to {@link getSelectedRecord}: use it to sync the table to an external
     * selection (a linked tree/diagram, a master/detail view). Fires the
     * `"selection"` event like a user click, so a caller that drives it in
     * response to its own `"selection"` handler must guard against re-entrancy.
     *
     * While {@link getDisplayMode} is `"rotated"`, this re-targets the
     * projection: `record` becomes the displayed record and its field/value
     * rows are rebuilt, instead of moving the normal-mode row selection.
     *
     * @param record - The record to select and reveal, or `null` to clear.
     *
     * @returns This table, for method chaining.
     */
    selectRecord(record: ModelRecord | null): this {
        if (this._displayMode === "rotated") {
            if (record === this._rotatedRecord) {
                return this;
            }

            this._rotatedRecord = record;
            this.rebuildRotatedStore();
            this.emit("selection", record ? [record] : []);

            return this;
        }

        if (record) {
            this._body.scrollToRecord(record);
        }

        this._body.selectRecord(record);

        return this;
    }

    /**
     * Persists all pending store changes to the server via the configured proxy.
     *
     * @returns A Promise that resolves when the sync operation completes.
     */
    async sync(): Promise<void> {
        return this._store.sync();
    }

    /**
     * Discards all unsynced store changes — reverts dirty records, drops new
     * ones, and restores pending removals.
     */
    reject(): void {
        this._store.reject();
    }

    /**
     * Returns the currently selected record, or null if none is selected.
     * While {@link getDisplayMode} is `"rotated"`, returns the displayed
     * source record — never a projection (`field`/`value`) record.
     *
     * @returns The selected {@link ModelRecord}, or null.
     */
    getSelectedRecord(): ModelRecord | null {
        if (this._displayMode === "rotated") {
            return this._rotatedRecord;
        }

        return this._body.getSelectedRecord();
    }

    /**
     * Returns all currently selected records. While {@link getDisplayMode}
     * is `"rotated"`, returns the single displayed source record (or an
     * empty array when none is displayed) — never projection records.
     *
     * @returns An array of selected {@link ModelRecord} instances.
     */
    getSelectedRecords(): ModelRecord[] {
        if (this._displayMode === "rotated") {
            return this._rotatedRecord ? [this._rotatedRecord] : [];
        }

        return this._body.getSelectedRecords();
    }

    /**
     * Adds a header, body, or footer section component, updating the stored reference.
     *
     * @param row         - The section component to add.
     * @param constraints - Optional layout constraints for the section.
     *
     * @returns This component, for method chaining.
     */
    addComponent(row: TableHeader | Body | FooterRow, constraints?: LayoutConstraints): this {
        if (row instanceof TableHeader) {
            this._header = row;
        } else if (row instanceof Body) {
            this._body = row;
        } else if (row instanceof FooterRow) {
            this._footer = row;
        }

        super.addComponent(row, constraints);

        return this;
    }

    /**
     * Returns a type-based default width for a column that has no saved width yet.
     *
     * @param col - The column to compute a default width for.
     * @returns A positive pixel width appropriate for the column's field type.
     */
    private defaultColumnWidth(col: Column): number {
        const f = col.getField();

        // Measure under the same font properties HeaderCell actually renders with
        // (bold + table-header font size). 4px cell padding + 5px resize-handle gutter
        // + 12px breathing room for the optional sort indicator (▲/▼).
        const textWidth = Util.measureTextWidth(f.getName(), {
            fontSize  : "var(--ts-ui-table-header-font-size, var(--ts-ui-font-size))",
            fontWeight: "bold",
        });
        const headerMin = textWidth + 21;

        switch (f.getType()) {
            case 'boolean': return Math.max(60,  headerMin);
            case 'number':  return Math.max(90,  headerMin);
            case 'date':    return Math.max(110, headerMin);
            default:        return Math.max(100, headerMin);
        }
    }

    /**
     * Proportionally reduces existing saved columns to bring the total down to `targetTotal`,
     * leaving `exemptField` and any unsaved columns at their assigned widths.
     *
     * Flex (string/auto) columns are reduced first so that `rescaleWidths` can restore them
     * automatically when the shown column is later hidden again. Fixed-type (boolean/number/date)
     * columns are only reduced if flex space is fully exhausted.
     *
     * @param columns     - The full new visible column list.
     * @param widths      - Raw width per column (saved or default).
     * @param targetTotal - The pixel budget the result must not exceed.
     * @param exemptField - Field name of the column being shown; never trimmed.
     * 
     * @returns Adjusted width array whose sum is at most `targetTotal`.
     */
    private trimToTarget(columns: Column[], widths: number[], targetTotal: number, exemptField: string): number[] {
        const result = [...widths];

        const isFixedType = (col: Column): boolean => {
            const t = col.getField().getType();

            return t === 'boolean' || t === 'number' || t === 'date';
        };

        const trim = (pool: { i: number; room: number }[], deficit: number): number => {
            const totalRoom = pool.reduce((s, c) => s + c.room, 0);

            if (totalRoom <= 0) {
                return deficit;
            }

            const toRemove = Math.min(deficit, totalRoom);

            for (const { i, room } of pool) {
                result[i] = Math.max(result[i] - (room / totalRoom) * toRemove, columns[i].getMinWidth() ?? 30);
            }

            return deficit - toRemove;
        };

        const pool = (fixedType: boolean) => columns
            .map((col, i) => ({
                i,
                room: (isFixedType(col) === fixedType
                    && col.getField().getName() !== exemptField
                    && this._savedColumnWidths.has(col.getField().getName()))
                    ? result[i] - (col.getMinWidth() ?? 30)
                    : 0
            }))
            .filter(c => c.room > 0.5);

        let deficit = result.reduce((s, w) => s + w, 0) - targetTotal;

        deficit = trim(pool(false), deficit);

        if (deficit > 0.5) {
            trim(pool(true), deficit);
        }

        return result;
    }

    /**
     * Populates `hiddenColumns` from columns declared `hidden: true` in the spec,
     * so they start hidden but remain user-toggleable via the context menu.
     */
    private buildColumnConfigs(spec: ColumnSpec): Map<string, ColumnConfig> {
        const map = new Map<string, ColumnConfig>();

        for (const col of spec.columns) {
            map.set(col.field, col);
        }

        return map;
    }

    private initHiddenFromSpec(): void {
        for (const col of this._resolvedColumns) {
            if (col.isInitiallyHidden() && !col.isUnhideable()) {
                this._hiddenColumns.add(col.getField().getName());
            }
        }
    }

    /**
     * Returns the union of runtime-hidden columns and columns excluded by the spec
     * (`appendUnlisted: false`). This is the set passed to the header and body renderers.
     *
     * @returns The effective set of field names that must not be rendered.
     */
    private getEffectiveHiddenSet(): Set<string> {
        const resolvedNames = new Set(this._resolvedColumns.map(c => c.getField().getName()));
        const result = new Set(this._hiddenColumns);

        for (const f of this._store.model.getFields()) {
            if (!resolvedNames.has(f.getName())) {
                result.add(f.getName());
            }
        }

        return result;
    }

    /**
     * Subscribes to the source store's mutation events so a rotated view
     * tracks the record it displays. Stores the callback in `_sourceRefresh`
     * so {@link unbindSourceStore} can remove exactly this registration later.
     *
     * @param store - The source store to subscribe to.
     */
    private bindSourceStore(store: AbstractStore): void {
        const refresh = () => this.onSourceStoreChange();

        this._sourceRefresh = refresh;

        store.on('load', refresh);
        store.on('add', refresh);
        store.on('remove', refresh);
        store.on('datachange', refresh);
    }

    /**
     * Unsubscribes the callback installed by {@link bindSourceStore} from `store`.
     *
     * @param store - The store to unsubscribe from.
     */
    private unbindSourceStore(store: AbstractStore): void {
        if (!this._sourceRefresh) {
            return;
        }

        (['load', 'add', 'remove', 'datachange'] as const).forEach(e =>
            store.off(e, this._sourceRefresh!)
        );
    }

    /**
     * Keeps the rotated projection in sync with the source store. A no-op
     * outside rotated mode. Re-targets `_rotatedRecord` to the store's first
     * record (firing `"selection"`) when the displayed record no longer
     * exists in the store — e.g. it was removed, or the store was reloaded —
     * then rebuilds the projection against the (possibly new) record.
     */
    private onSourceStoreChange(): void {
        if (this._displayMode !== "rotated") {
            return;
        }

        const records = this._store.getRecords();
        const stillPresent = this._rotatedRecord !== null && records.includes(this._rotatedRecord);

        if (!stillPresent) {
            const before = this._rotatedRecord;
            this._rotatedRecord = records[0] ?? null;

            if (this._rotatedRecord !== before) {
                this.emit("selection", this._rotatedRecord ? [this._rotatedRecord] : []);
            }
        }

        this.rebuildRotatedStore();
    }

    /**
     * Returns the lazily-built projection store, constructing it (and the
     * two resolved `field`/`value` columns and their configs) on first use.
     *
     * @returns The projection {@link MemoryStore}, reused across mode switches.
     */
    private ensureRotatedStore(): MemoryStore {
        if (this._rotatedStore) {
            return this._rotatedStore;
        }

        const spec: ColumnSpec = {
            columns: [
                { field: 'field', minWidth: 80, maxWidth: 200, unhideable: true },
                {
                    field: 'value',
                    minWidth: 120,
                    maxWidth: 360,
                    unhideable: true,
                    cellType:   (r) => this.rotatedCellType(r),
                    cellValues: (r) => this.rotatedCellValues(r),
                },
                { field: 'filler', headerText: '', minWidth: 0, unhideable: true },
            ],
            rowReadOnly: () => true,
        };

        this._rotatedStore   = new MemoryStore(ROTATED_MODEL, []);
        this._rotatedColumns = Column.resolve(ROTATED_MODEL.getFields(), spec);
        this._rotatedConfigs = this.buildColumnConfigs(spec);

        return this._rotatedStore;
    }

    /**
     * Rebuilds the projection store's records from `_rotatedRecord` — one row
     * per visible source field — and refreshes the `_rotatedFieldByName` map
     * used by {@link rotatedCellType} / {@link rotatedCellValues} to resolve
     * each row's source field. Resolution is by the row's own `field` value
     * (not by index), so it stays correct after the projection is sorted by
     * clicking a header.
     */
    private rebuildRotatedStore(): void {
        const store  = this.ensureRotatedStore();
        const fields = this.getSourceColumns().map(c => c.getField());
        const record = this._rotatedRecord;

        // Refresh the field lookup BEFORE loadData. loadData fires the store's
        // `load` event synchronously, and while the body is already bound to
        // the projection store (i.e. switching the displayed record) that
        // reraises straight into rotatedCellType / rotatedCellValues to rebind
        // each value cell. Building the lookup afterwards left that first
        // render resolving every value cell against a stale map: cellType fell
        // back to the column's `auto` type, the string renderer was swapped in
        // unlaid-out, and the value column stayed blank until the next scroll.
        this._rotatedFieldByName = new Map(fields.map(f => [f.getName(), f]));

        store.loadData(record
            ? fields.map(f => ({ field: f.getName(), value: record.get(f.getName()) }))
            : []);
    }

    /**
     * Per-row cell-variant resolver for the rotated `value` column
     * (`ColumnConfig.cellType`): a row whose source field declares `values`
     * in the table's own spec renders as a combo, otherwise it renders as
     * its source field's own type. O(1) and pure, as the `cellType` contract
     * requires.
     *
     * @param record - The projection record for one field/value row.
     * @returns The cell variant to render, or `null` if the row's source
     *   field cannot be resolved (should not happen for a row this table built).
     */
    private rotatedCellType(record: ModelRecord): CellType | null {
        const field = this._rotatedFieldByName.get(record.get('field') as string);

        if (!field) {
            return null;
        }

        const values = this._columnConfigs.get(field.getName())?.values;

        return (values && values.length > 0) ? 'combo' : field.getType();
    }

    /**
     * Per-row combo-option resolver for the rotated `value` column
     * (`ColumnConfig.cellValues`), consulted only for rows where
     * {@link rotatedCellType} resolves to `'combo'`. O(1) and pure, as the
     * `cellValues` contract requires.
     *
     * @param record - The projection record for one field/value row.
     * @returns The source field's declared `values`, or `undefined`.
     */
    private rotatedCellValues(record: ModelRecord): Array<ComboOption | string> | undefined {
        const field = this._rotatedFieldByName.get(record.get('field') as string);

        return field ? this._columnConfigs.get(field.getName())?.values : undefined;
    }

    /**
     * Re-points the header and body at `store` / `columns`, the shared
     * sequence behind both {@link setDisplayMode} and {@link setStore}.
     *
     * @param store - The store the header and body should render.
     * @param columns - The resolved columns to display.
     * @param configs - The column-config map (drives `cellType` / `cellValues` / etc).
     * @param hidden - The set of field names to hide.
     * @param rowReadOnly - The row-level read-only predicate, or `null`.
     *
     * @remarks `Body.setStore` re-renders with pool rows whose cells still
     * match the outgoing model; `setColumns` (called after `setStore`) is
     * what re-syncs those cells, so the order matters. `_body.selectRecord(null)`
     * transiently fires the body's own `"selection"` — `_suppressSelectionForward`
     * gates the Table-level forwarder for the duration of the re-bind so that
     * transient clear never reaches consumers. Clearing `_columnWidths` /
     * `_savedColumnWidths` is what makes the layout manager re-initialise
     * widths for the new column count on the next `doLayout`.
     *
     * `setStore` is called again at the end (re-assigning the same store) to
     * force a second full rebind after the column/config/hidden/read-only
     * state has settled: `Body`'s own per-slot metadata (read-only tint,
     * required-empty, ARIA) is only re-applied on a slot whose bound index
     * changes, and the first `setStore` call already consumed that "changed"
     * signal — on the model swap alone, before `setColumnConfigs` /
     * `setColumns` have synced the pool's cells to the new column shape. A
     * second `setStore` re-triggers the same store-change rebind, this time
     * over the fully-synced cells, so e.g. a rotated column's freshly-built
     * `DynamicCell` actually receives `setReadOnly(true)`.
     */
    private bindView(
        store:       AbstractStore,
        columns:     Column[],
        configs:     Map<string, ColumnConfig>,
        hidden:      Set<string>,
        rowReadOnly: ((record: ModelRecord) => boolean) | null,
    ): void {
        this._suppressSelectionForward = true;

        this._header.setStore(store);
        this._header.setModel(store.model);
        this._header.setColumns(columns);
        this._header.setHiddenColumns(hidden);

        this._body.selectRecord(null);
        this._body.setStore(store);
        this._body.setColumnConfigs(configs);
        this._body.setColumns(columns);
        this._body.setHiddenColumns(hidden);
        this._body.setRowReadOnly(rowReadOnly);
        this._body.setStore(store);

        this._suppressSelectionForward = false;

        this._columnWidths      = [];
        this._savedColumnWidths = new Map();

        this.getAria().setColCount(this.getColumns().length);
        this.doLayout();
    }

    /**
     * Displays the column visibility context menu, listing only columns present in
     * the resolved column list (excluded columns do not appear). While rotated,
     * shows only the export entries (when enabled) — there are no per-column
     * show/hide toggles for a two-column projection.
     *
     * @param x - Viewport x coordinate for the menu.
     * @param y - Viewport y coordinate for the menu.
     */
    private showColumnMenu(x: number, y: number): void {
        if (this._displayMode === "rotated") {
            if (!this._exportMenuEnabled) {
                return;
            }

            this._columnContextMenu.show(x, y, [
                { text: 'Export as CSV',  action: () => this.exportCSV()  },
                { text: 'Export as JSON', action: () => this.exportJSON() },
            ]);

            return;
        }

        const columns = this._resolvedColumns
            .slice()
            .sort((a, b) => a.getField().getOrder() - b.getField().getOrder());

        const items: MenuItemConfig[] = [];
        let lastGroup: string | null | undefined = undefined;

        // Walk in display order, emitting a disabled section header
        // each time the group changes. Ungrouped columns sit flush
        // (no section header above them); transitioning back to an
        // ungrouped column from a grouped run is treated as "end of
        // group" — the next ungrouped item just appears with no
        // preceding header. Field-list order matches the parent
        // header band above, so the menu reads as a vertical
        // restatement of what the user sees on screen.
        //
        // The indent uses non-breaking spaces (` `) because the
        // menu item renders text with the default `white-space: nowrap`
        // setting, which still collapses runs of ASCII spaces — regular
        // `'    '` would render as a single space.
        const GROUP_INDENT = "    ";

        columns.forEach(col => {
            const fieldName = col.getField().getName();
            const visible   = !this._hiddenColumns.has(fieldName);
            const group     = col.getGroup();

            if (group !== null && group !== lastGroup) {
                items.push({ text: group, enabled: false });
            }

            const indent = group !== null ? GROUP_INDENT : "";

            // An unhideable column is currently visible (since it
            // cannot be hidden) — the menu entry stays in the list so
            // the user sees the column's identity but is disabled to
            // signal it can't be toggled.
            const hideable = !col.isUnhideable();

            items.push({
                text:    indent + (visible ? '✓ ' : '  ') + fieldName,
                action:  () => this.setColumnVisible(fieldName, !visible),
                enabled: hideable,
            });

            lastGroup = group;
        });

        items.push(
            { separator: true },
            { text: 'Reset columns', action: () => this.resetColumns() }
        );

        if (this._exportMenuEnabled) {
            items.push(
                { separator: true },
                { text: 'Export as CSV',  action: () => this.exportCSV()  },
                { text: 'Export as JSON', action: () => this.exportJSON() }
            );
        }

        this._columnContextMenu.show(x, y, items);
    }

    /**
     * Enables or disables the "Export as CSV" / "Export as JSON" entries in
     * the column context menu.
     *
     * @param enabled - When true the export items are appended to the menu.
     */
    setExportMenuEnabled(enabled: boolean): this {
        this._exportMenuEnabled = enabled;

        return this;
    }

    /**
     * Triggers a CSV download of the current store view. Mode-independent:
     * always exports the source table's records and columns, never the
     * rotated field/value projection.
     *
     * @param options - Optional export options (e.g. include hidden columns, custom filename).
     */
    exportCSV(options?: ExportOptions): void {
        const columns = this.getExportColumns(options?.includeHidden ?? false);
        const records = this._store.getRecords();

        TableExporter.exportCSV(columns, records, this._columnConfigs, options);
    }

    /**
     * Triggers a JSON download of the current store view. Mode-independent:
     * always exports the source table's records and columns, never the
     * rotated field/value projection.
     *
     * @param options - Optional export options (e.g. include hidden columns, custom filename).
     */
    exportJSON(options?: ExportOptions): void {
        const columns = this.getExportColumns(options?.includeHidden ?? false);
        const records = this._store.getRecords();

        TableExporter.exportJSON(columns, records, this._columnConfigs, options);
    }

    /**
     * Returns the columns to include in an export.
     *
     * @param includeHidden - When true, all resolved columns are returned; otherwise only visible columns.
     * @returns The columns to export, in display order.
     */
    private getExportColumns(includeHidden: boolean): Column[] {
        return includeHidden ? this._resolvedColumns.slice() : this.getSourceColumns();
    }

    /**
     * Captures the resize origin when a column-resize drag begins: the absolute
     * pointer `clientX` and the current widths of the adjacent column pair.
     * {@link onColumnResize} derives the new widths from these origins so
     * over-travel past a column's `minWidth`/`maxWidth` is absorbed without the
     * edge decoupling from the cursor on reversal.
     *
     * @param colIndex - Zero-based index of the column whose right edge is being dragged.
     * @param clientX  - The absolute pointer `clientX` at the moment the drag began.
     */
    private onColumnResizeStart(colIndex: number, clientX: number): void {
        const n = this._columnWidths.length;

        if (n === 0 || colIndex >= n - 1) {
            return;
        }

        this._resizeOriginClientX = clientX;
        this._resizeOriginW0      = this._columnWidths[colIndex];
        this._resizeOriginW1      = this._columnWidths[colIndex + 1];
    }

    /**
     * Handles a column resize drag, clamping the adjacent column pair to their
     * per-column `minWidth` and `maxWidth` constraints.
     *
     * @param colIndex - Zero-based index of the column whose right edge is being dragged.
     * @param clientX  - The absolute pointer `clientX` for this move.
     *
     * @remarks The new widths are derived from the origin captured in
     * {@link onColumnResizeStart} as `originWidth ± (clientX − originClientX)`,
     * then clamped/redistributed against the pair's `minWidth`/`maxWidth`.
     * Clamping the absolute result (rather than accumulating per-move deltas)
     * makes dragging past a column's minimum idempotent: the edge stays at the
     * boundary until the pointer returns past the coordinate where the clamp
     * was hit.
     */
    private onColumnResize(colIndex: number, clientX: number): void {
        const n = this._columnWidths.length;

        if (n === 0 || colIndex >= n - 1) {
            return;
        }

        const columns = this.getColumns();
        const min0 = columns[colIndex]?.getMinWidth()     ?? 30;
        const max0 = columns[colIndex]?.getMaxWidth()     ?? Infinity;
        const min1 = columns[colIndex + 1]?.getMinWidth() ?? 30;
        const max1 = columns[colIndex + 1]?.getMaxWidth() ?? Infinity;

        const delta = clientX - this._resizeOriginClientX;

        let w0 = this._resizeOriginW0 + delta;
        let w1 = this._resizeOriginW1 - delta;

        if (w0 < min0) {
            w1 += w0 - min0;
            w0 = min0;
        }

        if (w1 < min1) {
            w0 += w1 - min1;
            w1 = min1;
        }

        if (w0 < min0 || w1 < min1 || w0 > max0 || w1 > max1) {
            return;
        }

        this._columnWidths[colIndex]     = w0;
        this._columnWidths[colIndex + 1] = w1;

        this.doLayout();
    }

    /**
     * Resets column visibility and widths to their initial spec-defined state.
     *
     * Columns marked `hidden: true` in the spec are re-hidden; all others are shown.
     * All manually resized widths are discarded and recomputed from defaults.
     */
    private resetColumns(): void {
        this._hiddenColumns = new Set();
        this.initHiddenFromSpec();
        this._savedColumnWidths = new Map();
        this._columnWidths = this.getColumns().map(col => this.defaultColumnWidth(col));

        const effectiveHidden = this.getEffectiveHiddenSet();

        this._header.setHiddenColumns(effectiveHidden);
        this._body.setHiddenColumns(effectiveHidden);
        this.doLayout();
    }
}

const TableCallable = callable(Table);
type TableCallable = Table;
export {
    Table         as _Table,
    TableCallable as Table
};
