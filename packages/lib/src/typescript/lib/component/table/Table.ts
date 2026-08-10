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
import { ColumnSpec, normalizeComboOptions } from "~/component/table/ColumnConfig.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { TableExporter, ExportOptions } from "~/component/table/TableExporter.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import { chainRoom, distributeDragChain, DRAG_DISTRIBUTION_EPSILON } from "~/core/DragChain.js";

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

// Column-width policy constants. See plans/implemented/table-generated-column-widths.md
// for the derivation of each value.
const MIN_COLUMN_WIDTH_PX   = 30;   // Absolute floor. No policy minimum ever falls below it.
const CHECKBOX_WIDTH_PX     = 16;   // The checkbox box edge (Checkbox.ts).
const GLYPH_WIDTH_PX        = 20;   // One icon-font glyph square at the default body font, plus slack.
const MIN_NUMBER_DIGITS     = 4;    // Digits a number column must always fit.
const DEFAULT_NUMBER_DIGITS = 8;    // Digits assumed for a number column with neither a sample nor a hint.
const MIN_STRING_CHARS      = 8;    // Characters a string column must always fit.
const STRING_WIDTH_PX       = 100;  // Starting width for a flex column that needs a concrete number.
const HEADER_CHROME_PX      = 21;   // 4px cell padding + 5px resize-handle gutter + 12px sort indicator.
const CELL_CHROME_PX        = 6;    // 4px cell padding + 2px so the last glyph isn't flush against the border.
const AUTO_WIDTH_CAP_PX     = 400;  // Ceiling for a measured width when the column declares no maxWidth.
const SAMPLE_ROWS           = 50;   // Records read per derivation.
const WIDEST_CANDIDATES     = 3;    // Strings measured per sampled column (the longest by character count).
const HINT_SAMPLE_MAX_CHARS = 60;   // Cap on the maxContentLength probe string.
// Formatted to measure the width of a date/time/datetime column; a fixed
// instant so the measurement is deterministic across runs.
const REFERENCE_DATE = new Date(2000, 11, 31, 23, 59, 59);

// Sub-pixel tolerance below which a resize-drag-grown column total is treated
// as equal to the available width (`_columnWidthTarget` collapses to 0
// instead of recording a target the layout would treat as already-grown).
// The same 0.5 the file's existing width comparisons use (see setColumnVisible).
const WIDTH_TARGET_EPSILON_PX = 0.5;

/**
 * The floor and starting width a column's field type implies, before any
 * declared `minWidth`/`maxWidth`/`width` override is applied.
 */
interface WidthPolicy {
    min: number;
    /** `null` = flex: no definite width, share the leftover space. */
    preferred: number | null;
}

/** Cached reference measurements consulted by the cheap {@link Table.getColumnMinWidth} path. */
interface WidthReferences {
    /** Width of the widest digit glyph, "0" through "9". */
    digitPx: number;
    /**
     * Widest digit-substituted variant of `REFERENCE_DATE` formatted, keyed
     * by `${type}:${showSeconds}` — guards against a non-tabular font
     * rendering some digit wider than `REFERENCE_DATE`'s own digits.
     */
    datePx: Map<string, number>;
}

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
    // Index of the column whose right edge is being dragged; `null` when no
    // drag is live.
    private _dragEdgeIndex    : number | null = null;
    // Pointer x consumed so far — advanced only by applied travel (see
    // `onColumnResize`), never the raw `clientX`.
    private _dragLastClientX  : number = 0;
    // The total column width a resize drag grew the table to, or `0` when the
    // table sits at its available width. Backing field for `getColumnWidthTarget`.
    private _columnWidthTarget: number = 0;
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
    private _autoWidthsSampled: boolean = false;
    private _widthRefs        : WidthReferences | null = null;
    // Longest sampled candidate strings from the last content derivation,
    // keyed by field name. Populated by `collectCandidates`; consulted by
    // `sampledDigits` and `resolveContentCandidates`. A plain cache read —
    // never re-scans the store — so `getColumnMinWidth` can consult it
    // without violating its "never samples the store" contract.
    private _sampledCandidates: Map<string, string[]> = new Map();

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
        // `on("horizontalscroll")` listener instead.
        this._body.on("horizontalscroll", scrollLeft => {
            this._header.setScrollX(scrollLeft);
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
     * wrong store otherwise. Ends with a layout pass, so the header's new
     * columns render immediately — matching `setColumnVisible` / `resetColumns`
     * / `bindView`, which each end in a layout too.
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
        this._columnWidthTarget = 0;
        this._autoWidthsSampled = false;
        this._widthRefs = null;
        this._sampledCandidates = new Map();
        this._resolvedColumns = Column.resolve(store.model.getFields(), this._spec);

        this.bindSourceStore(store);

        this._body.setStore(store);
        this._header.setModel(store.model);
        this._header.setColumns(this._resolvedColumns);
        this._body.setColumns(this._resolvedColumns);
        this._header.setHiddenColumns(this.getEffectiveHiddenSet());
        this.getAria().setColCount(this.getColumns().length);

        // Matches setColumnVisible / resetColumns / bindView, which each end
        // in a layout too: the header now renders no cells until its first
        // renderColumnWindow, so without this a store swap on an
        // already-sized table would leave the header blank until something
        // else happened to trigger a layout. A no-op on an unsized table —
        // layout/Table.doLayout returns early when the container size isn't finite.
        this.doLayout();

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
     * The pixel width the columns are laid out against: the table's inner
     * width less the reserved vertical-scrollbar track. Shared by the
     * column-resize drag handler and the layout manager so both derive the
     * same number.
     *
     * @returns The available column width in pixels, or `0` before first render.
     */
    getAvailableColumnWidth(): number {
        const innerSize = this.getInnerSize();

        return innerSize ? innerSize.width - DOM.source.getScrollBarWidth() : 0;
    }

    /**
     * The total column width a resize drag grew the table to, or `0` when the
     * table sits at its available width. Called by the layout manager so a
     * drag-widened total survives the next layout pass instead of being
     * rescaled back to the container's width.
     *
     * @returns The drag-grown column width target in pixels, or `0`.
     */
    getColumnWidthTarget(): number {
        return this._columnWidthTarget;
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

        // The visible column set just changed; see the matching comment in
        // `resetColumns` / `bindView` for why `_widthRefs` must be cleared
        // whenever it does.
        this._widthRefs = null;

        const newVisibleColumns = this.getColumns();
        let intrinsic: Array<number | null> | null = null;

        const rawWidths = newVisibleColumns.map((col, i) => {
            const saved = this._savedColumnWidths.get(col.getField().getName());

            if (saved !== undefined) {
                return saved;
            }

            intrinsic ??= this.getIntrinsicColumnWidths();

            return intrinsic[i] ?? this.flexColumnWidth(col);
        });
        const savedTotal = this._columnWidths.reduce((s, w) => s + w, 0);
        const rawTotal   = rawWidths.reduce((s, w) => s + w, 0);

        this._columnWidths = (rawTotal > savedTotal + 0.5 && savedTotal > 0)
            ? this.trimToTarget(newVisibleColumns, rawWidths, savedTotal, fieldName)
            : rawWidths;

        // Keep a grown table's target in step with the new column set: showing a
        // column trims the others back to the same total, hiding one frees its width.
        if (this._columnWidthTarget > 0) {
            this._columnWidthTarget = this._columnWidths.reduce((s, w) => s + w, 0);
        }

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

            // The new record's field/value content may need a different width
            // than the old one's; re-derive from getIntrinsicColumnWidths
            // instead of leaving the next doLayout rescale the stale widths.
            this._columnWidths      = [];
            this._savedColumnWidths = new Map();
            this._columnWidthTarget = 0;
            this.doLayout();

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
                result[i] = Math.max(result[i] - (room / totalRoom) * toRemove, this.getColumnMinWidth(columns[i]));
            }

            return deficit - toRemove;
        };

        const pool = (fixedType: boolean) => columns
            .map((col, i) => ({
                i,
                room: (isFixedType(col) === fixedType
                    && col.getField().getName() !== exemptField
                    && this._savedColumnWidths.has(col.getField().getName()))
                    ? result[i] - this.getColumnMinWidth(col)
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
     * Keeps the rotated projection in sync with the source store. Also the
     * hook for the one-shot auto-size re-derive (see
     * {@link maybeResampleColumnWidths}), which runs regardless of display
     * mode. Outside rotated mode this is otherwise a no-op. Re-targets
     * `_rotatedRecord` to the store's first record (firing `"selection"`)
     * when the displayed record no longer exists in the store — e.g. it was
     * removed, or the store was reloaded — then rebuilds the projection
     * against the (possibly new) record.
     */
    private onSourceStoreChange(): void {
        this.maybeResampleColumnWidths();

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

        this._columnWidths      = [];
        this._savedColumnWidths = new Map();
        this._columnWidthTarget = 0;
        this.doLayout();
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
        this._columnWidthTarget = 0;
        // The visible column set just changed shape (source columns <->
        // rotated field/value/filler), and `_widthRefs`'s date/time/datetime
        // reference entries are derived from that set (`dateReferenceKeys`
        // walks `getColumns()`), so a cache built under the old mode would
        // answer for temporal types the new mode doesn't have — or miss ones
        // it does.
        this._widthRefs         = null;

        this.getAria().setColCount(this.getColumns().length);
        this.doLayout();
    }

    /**
     * Disposes the column context menu, then runs the inherited teardown.
     * `_columnContextMenu` is a LayerManager-mounted panel, never a
     * registered child (see Menu.ts's class comment), so
     * `super.destructor()`'s child recursion cannot reach it.
     */
    protected destructor(): void {
        this._columnContextMenu.dispose();

        super.destructor();
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
     * Captures the dragged edge when a column-resize drag begins: the index of
     * the column whose right edge is being dragged and the pointer's starting
     * `clientX`. {@link onColumnResize} distributes each subsequent frame's
     * travel from this state, nearest-first, across the columns fanning
     * outward from the edge.
     *
     * @param colIndex - Zero-based index of the column whose right edge is being dragged.
     * @param clientX  - The absolute pointer `clientX` at the moment the drag began.
     */
    private onColumnResizeStart(colIndex: number, clientX: number): void {
        if (colIndex < 0 || colIndex >= this._columnWidths.length) {
            return;
        }

        this._dragEdgeIndex   = colIndex;
        this._dragLastClientX = clientX;
    }

    /**
     * Handles a column resize drag: the dragged edge splits the visible
     * columns into a left chain `[colIndex, colIndex - 1, …, 0]` and a right
     * chain `[colIndex + 1, …, n - 1]`, each ordered nearest-first. This
     * frame's pointer travel is applied on top of the live widths — the
     * nearest column in the direction of travel absorbs it first, spilling to
     * the next only once it hits its `minWidth`/`maxWidth`.
     *
     * Scavenging from the right chain only happens while the columns still fit
     * the viewport. Moving right, the right chain gives up width first; once it
     * is exhausted, further travel grows the table's total column width instead
     * of stalling, and the table starts to scroll horizontally. From that point
     * on the right chain is left alone entirely — a table already wider than its
     * viewport grows and shrinks as a whole, so the dragged edge only moves the
     * columns left of it. Moving left, that accrued growth is given back first
     * — the total never falls below {@link getAvailableColumnWidth} — and only
     * travel past it, once the table fits again, regrows the right chain. The
     * grown-or-not total is recorded via `_columnWidthTarget` so the layout
     * manager preserves it instead of rescaling it away.
     *
     * The tracked pointer position advances only by the travel actually
     * applied, not the raw `clientX`. When every chain is exhausted the
     * applied travel is zero, so travel past the limit accrues a dead zone the
     * pointer must retrace before the edge moves again — keeping the cursor
     * glued to the handle on reversal instead of the handle jumping to meet a
     * far-off cursor.
     *
     * The pass is queued onto the animation-frame layout queue rather than run
     * synchronously, so every move dispatched within one frame collapses into a
     * single pass. No pass is needed between moves — the drag arithmetic reads
     * only state a layout pass does not produce.
     *
     * @param colIndex - Zero-based index of the column whose right edge is being dragged.
     * @param clientX  - The absolute pointer `clientX` for this move.
     */
    private onColumnResize(colIndex: number, clientX: number): void {
        if (this._dragEdgeIndex === null || colIndex !== this._dragEdgeIndex) {
            return;
        }

        const widths  = this._columnWidths;
        const columns = this.getColumns();
        const mins    = columns.map(col => col.getMinWidth() ?? MIN_COLUMN_WIDTH_PX);
        const maxs    = columns.map(col => col.getMaxWidth() ?? Number.POSITIVE_INFINITY);

        // Nearest-first chains fanning out from the dragged edge.
        const left : number[] = [];
        const right: number[] = [];

        for (let i = colIndex; i >= 0; i--) {
            left.push(i);
        }

        for (let i = colIndex + 1; i < widths.length; i++) {
            right.push(i);
        }

        const frameDelta = clientX - this._dragLastClientX;
        const sign       = frameDelta >= 0 ? 1 : -1;
        const available  = this.getAvailableColumnWidth();
        const total      = widths.reduce((s, w) => s + w, 0);
        // Growth already accrued, which a leftward drag gives back before the right
        // chain grows. Never negative: the total is floored at `available`.
        const growth     = Math.max(0, total - available);

        const delta = sign > 0
            ? Math.min(frameDelta, chainRoom(left, widths, 1, mins, maxs))
            : Math.min(-frameDelta, chainRoom(left, widths, -1, mins, maxs), chainRoom(right, widths, 1, mins, maxs) + growth);

        if (delta <= DRAG_DISTRIBUTION_EPSILON) {
            return;   // dead zone — the tracked pointer deliberately stays put
        }

        // Rightward: the right chain absorbs everything it can, the rest grows the
        // total — unless the table already overflows, in which case nothing is
        // scavenged and the whole travel grows the total. Leftward: the accrued
        // growth is given back first, and only travel past it (the table fits
        // again) is absorbed by the right chain.
        const absorbed = sign > 0
            ? (growth > WIDTH_TARGET_EPSILON_PX ? 0 : delta)
            : delta - Math.min(delta, growth);
        const out      = widths.slice();

        distributeDragChain(left,  widths, delta,    sign, mins, maxs, out);
        distributeDragChain(right, widths, absorbed, -sign, mins, maxs, out);

        this._dragLastClientX += sign * delta;
        this._columnWidths     = out;

        const newTotal = out.reduce((s, w) => s + w, 0);

        this._columnWidthTarget = newTotal > available + WIDTH_TARGET_EPSILON_PX ? newTotal : 0;

        this.scheduleLayout();
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
        this._columnWidthTarget = 0;
        // The visible column set may change shape (a spec-hidden temporal
        // column reappears, or vice versa), and `_widthRefs`'s date/time/
        // datetime entries are derived from `dateReferenceKeys`' walk of the
        // visible columns — see the same clear in `bindView`.
        this._widthRefs = null;

        const columns   = this.getColumns();
        const intrinsic = this.getIntrinsicColumnWidths();

        this._columnWidths = columns.map((col, i) => intrinsic[i] ?? this.flexColumnWidth(col));

        const effectiveHidden = this.getEffectiveHiddenSet();

        this._header.setHiddenColumns(effectiveHidden);
        this._body.setHiddenColumns(effectiveHidden);
        this.doLayout();
    }

    /**
     * Returns whether `string`/`auto` columns are sized from a sample of
     * the source store's cell values — the normal-mode auto-sizing opt-in.
     * Always `false` in rotated mode: the projection's `field`/`value`
     * columns are always sized from the displayed record's content,
     * independent of this flag; `filler` stays flex either way.
     *
     * @returns `true` when the spec declares `autoSizeColumns: true` AND
     *   the table is in normal (non-rotated) display mode.
     */
    isAutoSizeColumns(): boolean {
        return (this._spec?.autoSizeColumns ?? false) && this._displayMode !== "rotated";
    }

    /**
     * Returns the column's declared `minWidth`, or the floor its field type
     * implies. Cheap enough for the drag path — reads cached reference
     * measurements and a cached sample-candidate map, never the store or
     * the DOM.
     *
     * @param column - The column to compute a minimum width for.
     * @returns The minimum width in pixels.
     */
    getColumnMinWidth(column: Column): number {
        return column.getMinWidth() ?? this.columnWidthPolicy(column, 0, null).min;
    }

    /**
     * Computes one starting width per visible column, in display order,
     * from each column's field-type policy, any declared `width` /
     * `minWidth` / `maxWidth`, and content — for `string`/`auto` columns
     * under {@link isAutoSizeColumns}, a bounded sample of the store; for
     * the rotated `field`/`value` columns, the currently displayed record.
     *
     * @returns One entry per visible column. A number is a definite
     *   starting width; `null` means "no definite width — share the
     *   remaining space", which only happens for a `string`/`auto` column
     *   with no auto-sized content to measure.
     */
    getIntrinsicColumnWidths(): Array<number | null> {
        const columns   = this.getColumns();
        const headerPx  = this.measureHeaders(columns);
        const contentPx = this.measureContent(columns);

        return columns.map((col, i) => {
            const policy = this.columnWidthPolicy(col, headerPx[i], contentPx[i]);
            const raw    = col.getWidth() ?? policy.preferred;

            if (raw === null) {
                return null;
            }

            return this.clampColumnWidth(raw, col, policy);
        });
    }

    /**
     * Clamps a raw width into a column's `[minWidth, maxWidth]` envelope,
     * falling back to the policy floor and {@link AUTO_WIDTH_CAP_PX} when
     * the column declares no explicit bound.
     */
    private clampColumnWidth(w: number, col: Column, policy: WidthPolicy): number {
        return Util.clamp(w, col.getMinWidth() ?? policy.min, col.getMaxWidth() ?? AUTO_WIDTH_CAP_PX);
    }

    /**
     * Returns the width, in pixels, one column should start at when it
     * cannot share leftover space with its siblings — the fallback used by
     * {@link setColumnVisible} and {@link resetColumns} for a flex column
     * whose `getIntrinsicColumnWidths` entry is `null`. Measures only this
     * one column's header, so it is the one exception to the
     * three-batched-calls derivation budget; it runs only on that fallback
     * path.
     *
     * @param col - The flex column to compute a standalone width for.
     */
    private flexColumnWidth(col: Column): number {
        const headerPx = this.measureHeaders([col])[0];
        const policy   = this.columnWidthPolicy(col, headerPx, null);

        return this.clampColumnWidth(Math.max(STRING_WIDTH_PX, headerPx), col, policy);
    }

    /**
     * Returns the header text width in pixels, plus {@link HEADER_CHROME_PX},
     * for each column — one batched measurement under the header font.
     */
    private measureHeaders(columns: Column[]): number[] {
        const texts = columns.map(col => col.getHeaderText() ?? col.getField().getName());
        const widths = Util.measureTextWidths(texts, {
            fontSize  : "var(--ts-ui-table-header-font-size, var(--ts-ui-font-size))",
            fontWeight: "bold",
        });

        return widths.map(w => w + HEADER_CHROME_PX);
    }

    /**
     * Returns the sampled content width in pixels for each column — `null`
     * for every column the policy does not need content for. The only part
     * of the derivation that reads the store (via {@link collectCandidates}).
     * A single batched measurement covers every `string`/`auto` column with
     * something to measure.
     */
    private measureContent(columns: Column[]): Array<number | null> {
        this.collectCandidates(columns);

        const measurable = columns.map(col => this.resolveContentCandidates(col));

        const toMeasure: string[] = [];
        const owner: number[] = [];

        measurable.forEach((candidates, i) => {
            candidates?.forEach(text => {
                owner.push(i);
                toMeasure.push(text);
            });
        });

        const widths = Util.measureTextWidths(toMeasure);
        const contentPx: Array<number | null> = columns.map(() => null);

        widths.forEach((w, k) => {
            const i = owner[k];

            contentPx[i] = Math.max(contentPx[i] ?? 0, w);
        });

        return contentPx;
    }

    /**
     * Resolves the strings to measure for one `string`/`auto` column. In
     * rotated mode, delegates to {@link resolveRotatedContentCandidates}
     * unconditionally — {@link isAutoSizeColumns} does not apply to the
     * rotated projection. Otherwise falls back from sampled candidates to
     * `values` option labels, to a `maxContentLength` probe string, in that
     * order, gated by {@link isAutoSizeColumns}. Returns `null` for every
     * other field type, for every `string`/`auto` column when
     * {@link isAutoSizeColumns} is `false` in normal mode (the rest of the
     * normal-mode chain is gated by the flag, not just the store sample),
     * and for a `string`/`auto` column under auto-size with nothing to
     * measure (the column stays flex).
     */
    private resolveContentCandidates(col: Column): string[] | null {
        const type = col.getField().getType();

        if (type !== "string" && type !== "auto") {
            return null;
        }

        if (this._displayMode === "rotated") {
            return this.resolveRotatedContentCandidates(col);
        }

        // autoSizeColumns gates the rest of this normal-mode fallback chain,
        // not just the store sample: with the flag off a string/auto column
        // stays flex, exactly as before this feature, even when it declares
        // `values` or `maxContentLength`. Rotated mode is handled above,
        // unconditionally.
        if (!this.isAutoSizeColumns()) {
            return null;
        }

        const sampled = this._sampledCandidates.get(col.getField().getName());

        if (sampled && sampled.length > 0) {
            return sampled;
        }

        const config = this._columnConfigs.get(col.getField().getName());

        if (config?.values && config.values.length > 0) {
            return normalizeComboOptions(config.values)
                .map(o => o.label)
                .sort((a, b) => b.length - a.length)
                .slice(0, WIDEST_CANDIDATES);
        }

        const maxLen = col.getMaxContentLength();

        if (maxLen !== undefined) {
            return ["0".repeat(Math.min(maxLen, HINT_SAMPLE_MAX_CHARS))];
        }

        return null;
    }

    /**
     * Content candidates for the rotated `field`/`value` columns, measured
     * from the currently displayed record instead of a store sample — the
     * rotated store holds at most one row per visible source field, so every
     * row is used exactly, not a sampled subset.
     *
     * @param col - The rotated `field`, `value`, or `filler` column.
     * @returns Up to `WIDEST_CANDIDATES` distinct candidate strings, longest
     *   first, or `null` for `filler` (stays flex, absorbing the leftover
     *   width) or when there is nothing to measure (no displayed record).
     */
    private resolveRotatedContentCandidates(col: Column): string[] | null {
        const name = col.getField().getName();

        if (name !== 'field' && name !== 'value') {
            return null;
        }

        const records = this.ensureRotatedStore().getRecords();
        const sourceColumns = name === 'value'
            ? new Map(this.getSourceColumns().map(c => [c.getField().getName(), c]))
            : null;
        const list: string[] = [];

        for (const record of records) {
            const text = name === 'field'
                ? String(record.get('field') ?? '')
                : this.formatRotatedValueText(record, sourceColumns!);

            if (text !== null) {
                this.keepLongest(list, text);
            }
        }

        return list.length > 0 ? list : null;
    }

    /**
     * Formats one rotated `value` row's text the way its own resolved
     * `DynamicCell` renderer actually displays it — mirrors
     * {@link DynamicCell.bindRecord}'s variant resolution so the measured
     * string matches the rendered one.
     *
     * @param record - One projection record (`field`/`value` pair).
     * @param sourceColumns - Visible source columns keyed by field name.
     * @returns The display text, or `null` for `boolean`/`glyph` rows (a
     *   fixed-size control, not measurable text) or an unresolvable field.
     */
    private formatRotatedValueText(record: ModelRecord, sourceColumns: Map<string, Column>): string | null {
        const cellType = this.rotatedCellType(record);

        if (cellType === 'boolean' || cellType === 'glyph') {
            return null;
        }

        if (cellType === 'combo') {
            const labelByValue = new Map(normalizeComboOptions(this.rotatedCellValues(record) ?? []).map(o => [o.value, o.label]));
            const value        = String(record.get('value') ?? '');

            return labelByValue.get(value) ?? value;   // mirrors ComboRenderer.setValue
        }

        const sourceColumn = sourceColumns.get(record.get('field') as string);

        if (!sourceColumn) {
            return null;
        }

        // Empty configs map, not this._columnConfigs: the rotated `value`
        // DynamicCell's own config never threads `showSeconds` through
        // (ensureRotatedStore's spec doesn't set it on the `value` column), so
        // every time/datetime row renders without seconds today regardless of
        // the source column's own setting. Matching that here keeps the
        // measured text the same length as what actually renders.
        return String(TableExporter.formatValue(sourceColumn, record.get('value'), new Map()) ?? '');
    }

    /**
     * Reads at most {@link SAMPLE_ROWS} records by index and keeps, per
     * column that needs content (see {@link samplesRecordText}), the
     * {@link WIDEST_CANDIDATES} longest distinct formatted values. Stores
     * the result in `_sampledCandidates`, keyed by field name, for
     * {@link resolveContentCandidates} and {@link sampledDigits} to consult.
     * Reads by `store.getAt` rather than `store.getRecords()`, which
     * copies the entire filtered view.
     */
    private collectCandidates(columns: Column[]): void {
        const wanted = columns.map(col => this.samplesRecordText(col));
        const rows   = Math.min(SAMPLE_ROWS, this._store.getCount());
        const best   = new Map<string, string[]>();

        for (let r = 0; r < rows; r++) {
            const record = this._store.getAt(r)!;

            columns.forEach((col, i) => {
                if (!wanted[i]) {
                    return;
                }

                const name = col.getField().getName();
                const raw  = record.get(name);
                const text = String(TableExporter.formatValue(col, raw, this._columnConfigs) ?? "");
                const list = best.get(name) ?? [];

                this.keepLongest(list, text);
                best.set(name, list);
            });
        }

        if (rows > 0) {
            this._autoWidthsSampled = true;
        }

        this._sampledCandidates = best;
    }

    /**
     * Keeps `list` to at most {@link WIDEST_CANDIDATES} entries, longest
     * first, dropping an exact duplicate of a string already held.
     */
    private keepLongest(list: string[], text: string): void {
        if (list.includes(text)) {
            return;
        }

        list.push(text);
        list.sort((a, b) => b.length - a.length);

        if (list.length > WIDEST_CANDIDATES) {
            list.length = WIDEST_CANDIDATES;
        }
    }

    /**
     * Returns whether `collectCandidates` should read this column's values:
     * always for `number` (its sample feeds a digit count, not a
     * measurement), and for `string`/`auto` only under
     * {@link isAutoSizeColumns}. A column with a `renderer` is never
     * sampled — its rendered text is not derived from the raw value. Nor is
     * a column that declares `values`: it uses its option labels instead of
     * the store, never as well as it.
     */
    private samplesRecordText(col: Column): boolean {
        const config = this._columnConfigs.get(col.getField().getName());

        if (config?.renderer) {
            return false;
        }

        if (config?.values && config.values.length > 0) {
            return false;
        }

        const type = col.getField().getType();

        if (type === "number") {
            return true;
        }

        return (type === "string" || type === "auto") && this.isAutoSizeColumns();
    }

    /**
     * Returns the longest `String(value).length` seen for `col` during the
     * last {@link collectCandidates} pass, or `null` when the column was
     * not sampled. A length scan over the cached candidates, never a
     * measurement and never a store read.
     */
    private sampledDigits(col: Column): number | null {
        const candidates = this._sampledCandidates.get(col.getField().getName());

        if (!candidates || candidates.length === 0) {
            return null;
        }

        return Math.max(...candidates.map(s => s.length));
    }

    /** Reads `showSeconds` from this column's config, defaulting to `false`. */
    private showsSeconds(col: Column): boolean {
        return this._columnConfigs.get(col.getField().getName())?.showSeconds ?? false;
    }

    /**
     * Returns the per-type width policy for `col`: a `{min, preferred}`
     * pair derived from its field type, cached reference measurements, and
     * — for `number`/`string`/`auto` — sampled content. `headerPx` and
     * `contentPx` may be passed as `0`/`null` (as {@link getColumnMinWidth}
     * does) because no branch's `min` depends on either.
     */
    private columnWidthPolicy(col: Column, headerPx: number, contentPx: number | null): WidthPolicy {
        const refs = this.ensureWidthReferences();
        const type = col.getField().getType();

        switch (type) {
            case "boolean": {
                const min = CHECKBOX_WIDTH_PX + CELL_CHROME_PX;

                return { min, preferred: Math.max(min, headerPx) };
            }

            case "glyph": {
                const min = GLYPH_WIDTH_PX + CELL_CHROME_PX;

                return { min, preferred: Math.max(min, headerPx) };
            }

            case "date":
            case "time":
            case "datetime": {
                const key = `${type}:${this.showsSeconds(col)}`;
                const min = (refs.datePx.get(key) ?? 0) + CELL_CHROME_PX;

                return { min, preferred: Math.max(min, headerPx) };
            }

            case "number": {
                const min    = refs.digitPx * MIN_NUMBER_DIGITS + CELL_CHROME_PX;
                const digits = col.getMaxContentLength() ?? this.sampledDigits(col) ?? DEFAULT_NUMBER_DIGITS;

                return { min, preferred: Math.max(min, refs.digitPx * digits + CELL_CHROME_PX, headerPx) };
            }

            default: {   // "string" and "auto"
                const min = Math.max(MIN_COLUMN_WIDTH_PX, refs.digitPx * MIN_STRING_CHARS + CELL_CHROME_PX);

                if (contentPx === null) {
                    return { min, preferred: null };       // auto-size off, or nothing to measure — flex column
                }

                return { min, preferred: Math.max(min, contentPx + CELL_CHROME_PX, headerPx) };
            }
        }
    }

    /**
     * Returns the cached width-reference bundle, measuring it once (in one
     * batched call) the first time anything asks. `dateReferenceKeys` scans
     * only the currently visible columns, so this is cleared everywhere
     * that set can change: `setStore`, `maybeResampleColumnWidths`,
     * `bindView` (a display-mode switch), `setColumnVisible`, and
     * `resetColumns`.
     */
    private ensureWidthReferences(): WidthReferences {
        if (this._widthRefs) {
            return this._widthRefs;
        }

        const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
        const keys   = this.dateReferenceKeys();
        const widths = Util.measureTextWidths([...digits, ...keys.flatMap(k => k.texts)]);

        const datePx = new Map<string, number>();
        let offset = digits.length;

        for (const k of keys) {
            datePx.set(k.key, Math.max(...widths.slice(offset, offset + k.texts.length)));
            offset += k.texts.length;
        }

        this._widthRefs = {
            digitPx: Math.max(...widths.slice(0, digits.length)),
            datePx,
        };

        return this._widthRefs;
    }

    /**
     * Walks the visible columns and builds one `{key, texts}` reference pair
     * per distinct `(temporal type, showSeconds)` combination in use,
     * formatting {@link REFERENCE_DATE} the same way the matching cell
     * renderer would (via `TableExporter.formatValue`), then widening the
     * probe with every digit position substituted by each of 0-9 in turn —
     * guards against a non-tabular font rendering some other digit wider
     * than `REFERENCE_DATE`'s own digits, mirroring the per-digit-max
     * defense `digitPx` already applies to `number` columns. A no-op (all
     * variants equal) under a tabular font.
     */
    private dateReferenceKeys(): Array<{ key: string; texts: string[] }> {
        const digitChars = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
        const seen = new Map<string, string[]>();

        for (const col of this.getColumns()) {
            const type = col.getField().getType();

            if (type !== "date" && type !== "time" && type !== "datetime") {
                continue;
            }

            const key = `${type}:${this.showsSeconds(col)}`;

            if (!seen.has(key)) {
                const base = String(TableExporter.formatValue(col, REFERENCE_DATE, this._columnConfigs) ?? "");

                seen.set(key, [base, ...digitChars.map(d => base.replace(/\d/g, d))]);
            }
        }

        return Array.from(seen, ([key, texts]) => ({ key, texts }));
    }

    /**
     * Re-derives column widths once, the first time the source store's
     * `'load'` / `'add'` / `'remove'` / `'datachange'` events find records —
     * so a table built before its data arrives sizes itself against the
     * data once it shows up. A no-op when auto-size is off, when the store
     * is still empty, or after the first successful derivation for this
     * store (see {@link Table.setStore}, which resets the guard).
     */
    private maybeResampleColumnWidths(): void {
        if (!this.isAutoSizeColumns() || this._autoWidthsSampled || this._store.getCount() === 0) {
            return;
        }

        this._columnWidths      = [];
        this._savedColumnWidths = new Map();
        this._columnWidthTarget = 0;
        this._widthRefs         = null;

        this.doLayout();
    }
}

const TableCallable = callable(Table);
type TableCallable = Table;
export {
    Table         as _Table,
    TableCallable as Table
};
