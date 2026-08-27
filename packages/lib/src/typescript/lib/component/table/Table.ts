// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Table as TableLayout } from "~/layout/Table.js";
import { TableHeader } from "~/component/table/Header.js";
import { Body } from "~/component/table/Body.js";
import type { CellClickEvent } from "~/component/table/Body.js";
import { FooterRow } from "~/component/table/Footer.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import type { StoreUpdateEvent } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { MemoryStore } from "~/data/MemoryStore.js";
import { Model } from "~/data/Model.js";
import type { Field } from "~/data/Field.js";
import { Insets } from "~/primitive/Insets.js";
import { Menu } from "~/overlay/Menu.js";
import { Dialog, DialogButtons } from "~/overlay/Dialog.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { CheckboxMenuRow } from "~/component/container/CheckboxMenuRow.js";
import { TRACK_WIDTH } from "~/component/container/Scrollbar.js";
import { Glyph } from "~/component/display/Glyph.js";
import { table_columns } from "~/glyphs/solid/table_columns.js";
import { undo } from "~/glyphs/solid/undo.js";
import { file_csv } from "~/glyphs/solid/file_csv.js";
import { file_code } from "~/glyphs/solid/file_code.js";
import { file_lines } from "~/glyphs/solid/file_lines.js";
import { clipboard } from "~/glyphs/solid/clipboard.js";
import { Column } from "~/component/table/Column.js";
import type { CellType, ColumnConfig, ComboOption } from "~/component/table/ColumnConfig.js";
import { ColumnSpec, normalizeComboOptions } from "~/component/table/ColumnConfig.js";
import { columnFilterOperators } from "~/component/table/ColumnFilter.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { Util } from "~/core/Util.js";
import { TableExporter, ExportOptions } from "~/component/table/TableExporter.js";
import { CellTextResolver } from "~/component/table/cell/CellText.js";
import { DEFAULT_INDENT_PX } from "~/component/table/cell/renderer/TreeCell.js";
import { Checkbox } from "~/component/input/Checkbox.js";
import { Text } from "~/component/input/Text.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { chainRoom, distributeDragChain, DRAG_DISTRIBUTION_EPSILON } from "~/core/DragChain.js";

// Register the column context menu's item glyphs eagerly at module load —
// same pattern as PaginationBar's nav glyphs — so a consumer never has to
// pre-register them before the menu can open.
Glyph.register(table_columns, undo, file_csv, file_code, file_lines, clipboard);

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

// Column show/hide entries. At or below the threshold they live in a submenu of
// the header context menu; past it a leaf row opens a modal dialog instead,
// which lists far more rows comfortably and scrolls.
const COLUMN_MENU_DIALOG_THRESHOLD     = 20;   // Resolved columns above which the dialog replaces the submenu.
const COLUMN_DIALOG_MAX_PER_COLUMN     = 15;   // Checkboxes per dialog column before wrapping to another.
const COLUMN_DIALOG_COLUMN_GAP_PX      = 24;   // Horizontal gap between dialog columns.
const COLUMN_DIALOG_INSET_PX           = 16;   // Body inset, matching the padding Dialog gives its own message text.
const COLUMN_DIALOG_GROUP_INDENT_PX    = 16;   // One nesting level, matching the submenu's group indent.

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

/** The state behind one active {@link Table.setQuickSearch} call. */
interface QuickSearchState {
    /** Trimmed, lower-cased search text. Never `''` — a blank search is stored as `null` instead. */
    needle:    string;
    /** The `fields` argument exactly as passed, or `null` for the default column scope. */
    requested: readonly string[] | null;
    /** The field names actually searched, derived from `requested`. */
    fields:    string[];
    /**
     * Per-record searchable text: every searched field's cell text, lower-cased and
     * joined with `\n`. Built the first time a record is tested and reused on every
     * later render pass — `Body.getVisibleRecords()` re-runs the predicate over the
     * whole store on every frame, so formatting per pass is not affordable.
     */
    cache:     WeakMap<ModelRecord, string>;
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

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors what the
    // constructor below already writes imperatively. TreeTable (Table's
    // only subclass) declares no field of its own and shares this rule
    // outright.
    protected static readonly ownClassStyleDefaults: StyleBag = {
        border:  { border: "1px solid var(--ts-ui-border-color, black)" },
        minSize: { width: 100, height: 100 },
    };

    private _store            : AbstractStore;
    private _spec             : ColumnSpec | undefined;
    private _resolvedColumns  : Column[] = [];
    private _hiddenColumns    : Set<string> = new Set();
    private _columnContextMenu: Menu = new Menu();
    // The open column dialog, or null. A LayerManager-mounted overlay, never a
    // registered child, so `destructor()` disposes it explicitly.
    private _columnDialog     : Dialog | null = null;
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
    // Widths the user set by dragging a column edge, keyed by field name. A
    // pinned column is exempt from the data-driven re-sample: getIntrinsicColumnWidths
    // returns its entry verbatim. Framework-managed bookkeeping, never
    // consumer-configurable, so per ARCHITECTURE.md it gets no TableOptions field
    // and no public setter. Cleared only by resetColumns and setStore.
    private _pinnedColumnWidths: Map<string, number> = new Map();
    private _columnConfigs    : Map<string, ColumnConfig> = new Map();
    private _exportMenuEnabled: boolean = true;
    private _filterRowVisible : boolean = false;
    private _listeners        : ListenerBag<TableEvent> = this.registerListenerBag(new ListenerBag<TableEvent>());
    private _displayMode      : TableDisplayMode = "normal";
    private _rotatedRecord    : ModelRecord | null = null;
    private _rowVisible       : ((record: ModelRecord) => boolean) | null = null;
    private _quickSearch      : QuickSearchState | null = null;
    private _rotatedStore     : MemoryStore | null = null;
    private _rotatedColumns   : Column[] = [];
    private _rotatedConfigs   : Map<string, ColumnConfig> = new Map();
    private _rotatedFieldByName: Map<string, Field> = new Map();
    // Identity map from a projection record just loaded into `_rotatedStore`
    // to the group-separator label/color it represents — populated by
    // `rebuildRotatedStore`, consulted by `Body` (via the `rowSeparator`
    // predicate `bindView` forwards) to render that record as a
    // `GroupSeparatorCell` row instead of an ordinary field/value row.
    // Keyed by object identity (not by the record's `field` value) so a
    // real field named the same as a group can never false-match.
    private _rotatedSeparatorRecords: Map<ModelRecord, { label: string, color: string | null }> = new Map();
    // Identity set of every projection record whose underlying source
    // column has a non-null `getGroup()` — populated by
    // `rebuildRotatedStore` alongside `_rotatedSeparatorRecords`,
    // suppressed the same way while sorted, and consulted by `Body` (via
    // the `rowIndented` predicate `bindView` forwards) to indent that
    // row's `field`-name cell, visually nesting it under its group's
    // separator.
    private _rotatedIndentedRecords: Set<ModelRecord> = new Set();
    private _sourceRefresh    : (() => void) | null = null;
    private _sourceUpdate     : ((event: StoreUpdateEvent) => void) | null = null;
    private _suppressSelectionForward: boolean = false;
    private _widthRefs        : WidthReferences | null = null;
    // Longest sampled candidate strings from the last content derivation,
    // keyed by field name. Populated by `collectCandidates`; consulted by
    // `sampledDigits` and `resolveContentCandidates`. A plain cache read —
    // never re-scans the store — so `getColumnMinWidth` can consult it
    // without violating its "never samples the store" contract.
    private _sampledCandidates: Map<string, string[]> = new Map();
    // Owner-held pool of unmounted renderers this table formats non-cell
    // values through (export, quick search, width sampling). Disposed in
    // `destructor`; see `CellText.ts` — mirrors `CellEditorPool`.
    private _cellText         : CellTextResolver = new CellTextResolver();

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
        this._body.on("cellcontextmenu", (x, y) => this.showCellMenu(x, y));
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
            this._header.setColumnConfigs(this._columnConfigs);
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
            this.bindView(rotatedStore, this._rotatedColumns, this._rotatedConfigs, new Set(), () => true, null,
                (record) => this._rotatedSeparatorRecords.get(record) ?? null,
                (record) => this._rotatedIndentedRecords.has(record));
            this.emit("selection", this._rotatedRecord ? [this._rotatedRecord] : []);
        } else {
            this.bindView(this._store, this.getSourceColumns(), this._columnConfigs, this.getEffectiveHiddenSet(), this._spec?.rowReadOnly ?? null, this.composeRowVisible(), null, null);
            this._body.selectRecord(this._rotatedRecord);
        }

        return this;
    }

    /**
     * Sets a live predicate that hides non-matching rows without touching
     * the store — a client-side quick search over an already-loaded grid.
     * Cleared by passing `null`.
     *
     * Display-only: never touches {@link getStore}'s records,
     * {@link getSelectedRecords}, or any pending edit. The predicate is
     * re-applied automatically on every trigger that already re-renders the
     * body — scrolling, a store `'datachange'` / `'add'` / `'remove'` /
     * `'load'`, or a column show/hide — so calling this again is only
     * needed when the predicate itself changes.
     *
     * Neutralized while {@link getDisplayMode} is `"rotated"`: the
     * projection's rows are one per source field of a single displayed
     * record, not one per source record, so a predicate written against
     * source records cannot apply there. The last predicate set still
     * takes effect immediately on returning to `"normal"`, even if it was
     * set while rotated. Inherited by `TreeTable` as a documented no-op —
     * see the `TreeTable` docs non-goal.
     *
     * Composes with {@link setQuickSearch} via AND — a row renders only when
     * both agree — and setting one never clears the other.
     *
     * @param predicate - Returns `true` to keep the record's row rendered.
     *   Called for every loaded record on every render pass; must be O(1)
     *   and pure.
     * @returns This table, for method chaining.
     */
    setRowVisible(predicate: ((record: ModelRecord) => boolean) | null): this {
        this._rowVisible = predicate;
        this.applyRowVisible();

        return this;
    }

    /**
     * Hides every row whose displayed cell text does not contain `text`, matched
     * case-insensitively — a client-side quick search over an already-loaded
     * grid. Cleared by passing `null`, `''`, or blank text.
     *
     * Each searched field is resolved through {@link getCellText}, so the match
     * runs against what the cell actually shows — a combo column's option
     * label, a formatted date/time/datetime — not the raw stored value.
     *
     * With no `fields` argument the searched columns default to every resolved
     * column (including a hidden one) whose filter row would offer a
     * **Contains** operator: a `boolean` column is excluded, since its cell is
     * a checkbox with no text to match, and a column with `filterable: false`
     * is excluded, matching the filter row's own opt-out. Passing `fields`
     * overrides that default and searches exactly the named fields, verbatim —
     * even one whose column is `filterable: false` or offers no Contains
     * operator; an empty array searches nothing, so no row matches.
     *
     * Display-only: never touches {@link getStore}'s records,
     * {@link getSelectedRecords}, or any pending edit. Composes with
     * {@link setRowVisible} via AND — a row renders only when both agree — and
     * setting one never clears the other. Neutralized while
     * {@link getDisplayMode} is `"rotated"` and resumes on return to
     * `"normal"`, and is inherited by `TreeTable` as a documented no-op — both
     * for the same reasons {@link setRowVisible} is.
     *
     * Each record's searchable text is captured the first time that record is
     * tested against the current search, and reused on every later render
     * pass rather than rebuilt per frame. That cached text is refreshed when
     * the store reports the record changed (an in-grid edit), but a batch
     * committed through the store's own edit-batch API reports no per-record
     * identity, so those records keep the text they were cached with until
     * `setQuickSearch` is called again. Calling `setQuickSearch` always
     * rebuilds the cache from scratch, even for the same text.
     *
     * @param text - The search text, or `null`/blank to clear the search.
     * @param fields - Field names to search, verbatim. Omit for the default
     *   column scope described above.
     * @returns This table, for method chaining.
     */
    setQuickSearch(text: string | null, fields?: readonly string[] | null): this {
        const needle = (text ?? '').trim().toLowerCase();

        this._quickSearch = needle === '' ? null : {
            needle,
            requested: fields ?? null,
            fields:    this.resolveSearchFields(fields ?? null),
            cache:     new WeakMap(),
        };

        this.applyRowVisible();

        return this;
    }

    /**
     * Derives the field names {@link setQuickSearch} searches: `requested`
     * verbatim when given, otherwise every resolved column whose filter row
     * would offer a Contains operator.
     *
     * @param requested - The `fields` argument passed to `setQuickSearch`, or `null`.
     * @returns The field names to search.
     */
    private resolveSearchFields(requested: readonly string[] | null): string[] {
        if (requested) {
            return requested.slice();
        }

        return this._resolvedColumns
            .filter(c => c.isFilterable() && columnFilterOperators(c.getField().getType()).includes('contains'))
            .map(c => c.getField().getName());
    }

    /**
     * Tests one record against an active quick search, consulting (and
     * populating) its cached searchable text.
     *
     * @param search - The active quick-search state.
     * @param record - The record to test.
     * @returns `true` when the record's cached text contains the search needle.
     */
    private quickSearchMatches(search: QuickSearchState, record: ModelRecord): boolean {
        let text = search.cache.get(record);

        if (text === undefined) {
            text = search.fields.map(f => this.getCellText(f, record).toLowerCase()).join('\n');

            search.cache.set(record, text);
        }

        return text.includes(search.needle);
    }

    /**
     * Combines the active quick search and the consumer's own row-visible
     * predicate into the single predicate `Body` sees, via AND.
     *
     * @returns The composed predicate, or `null` when neither is active.
     */
    private composeRowVisible(): ((record: ModelRecord) => boolean) | null {
        const search = this._quickSearch;
        const custom = this._rowVisible;

        if (!search) {
            return custom;
        }

        const matches = (record: ModelRecord) => this.quickSearchMatches(search, record);

        return custom ? (record: ModelRecord) => matches(record) && custom(record) : matches;
    }

    /**
     * Pushes the composed row-visible predicate to `Body`, when not rotated.
     */
    private applyRowVisible(): void {
        if (this._displayMode === "normal") {
            this._body.setRowVisible(this.composeRowVisible());
        }
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
        this._pinnedColumnWidths = new Map();
        this._columnWidthTarget = 0;
        this._widthRefs = null;
        this._sampledCandidates = new Map();
        this._resolvedColumns = Column.resolve(store.model.getFields(), this._spec);

        this.bindSourceStore(store);

        this._body.setStore(store);
        this._header.setModel(store.model);
        this._header.setColumns(this._resolvedColumns);
        this._body.setColumns(this._resolvedColumns);
        this._header.setHiddenColumns(this.getEffectiveHiddenSet());
        this.refreshQuickSearch();
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
     * Re-derives the active quick search's field list against the current
     * `_resolvedColumns` and rebuilds its cache from scratch. A no-op when no
     * search is active. Called by {@link setStore}: a search built before a
     * store swap holds field names from the old model, which a different
     * model's columns may no longer have.
     */
    private refreshQuickSearch(): void {
        if (!this._quickSearch) {
            return;
        }

        this._quickSearch = {
            needle:    this._quickSearch.needle,
            requested: this._quickSearch.requested,
            fields:    this.resolveSearchFields(this._quickSearch.requested),
            cache:     new WeakMap(),
        };

        this.applyRowVisible();
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
     * width less the custom vertical `Scrollbar`'s fixed track width. Shared
     * by the column-resize drag handler and the layout manager so both
     * derive the same number.
     *
     * @returns The available column width in pixels, or `0` before first render.
     */
    getAvailableColumnWidth(): number {
        const innerSize = this.getInnerSize();

        return innerSize ? innerSize.width - TRACK_WIDTH : 0;
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
     * Returns whether the header's filter row is currently shown.
     *
     * @returns `true` when the filter row is visible.
     */
    isFilterRowVisible(): boolean {
        return this._filterRowVisible;
    }

    /**
     * Shows or hides the header's filter row. Also reachable from the
     * header's right-click context menu via its checkbox-style **Filter**
     * entry. Idempotent when `visible` already matches the current state.
     * Hiding the row also clears every filter it applied — a column filter
     * is only ever active while its control is visible and editable.
     *
     * @param visible - `true` to show the filter row, `false` to hide it.
     * @returns This table, for method chaining.
     */
    setFilterRowVisible(visible: boolean): this {
        if (visible === this._filterRowVisible) {
            return this;
        }

        this._filterRowVisible = visible;
        this._header.setFilterRowVisible(visible);
        this.doLayout();

        return this;
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
     * tracks the record it displays, and so an active quick search's cached
     * text for one edited record can be dropped without rebuilding the
     * whole cache. Stores the callbacks in `_sourceRefresh` / `_sourceUpdate`
     * so {@link unbindSourceStore} can remove exactly these registrations later.
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

        const invalidate = (event: StoreUpdateEvent) => this.onSourceRecordUpdate(event);

        this._sourceUpdate = invalidate;
        store.on('update', invalidate);
    }

    /**
     * Unsubscribes the callbacks installed by {@link bindSourceStore} from `store`.
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

        if (this._sourceUpdate) {
            store.off('update', this._sourceUpdate);
        }
    }

    /**
     * Keeps the rotated projection in sync with the source store. Also the
     * hook for the auto-size re-derive (see
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
     * Drops one record's cached quick-search text so it is re-tested against
     * fresh text on the next render pass. A no-op when no search is active.
     *
     * @param event - The `'update'` event payload; only `record` is read.
     */
    private onSourceRecordUpdate(event: StoreUpdateEvent): void {
        this._quickSearch?.cache.delete(event.record);
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
            // The projection has no per-column filterable field to filter on
            // (see `hasFilterRow`'s doc) — filterable now defaults to `true`,
            // so this must say so explicitly rather than relying on the
            // library-wide default.
            filterable:  false,
        };

        this._rotatedStore   = new MemoryStore(ROTATED_MODEL, []);
        // Group separators are dropped from `rebuildRotatedStore`'s next
        // rebuild whenever the projection is sorted, and restored once the
        // sort is cleared — both `sort()` and `clearSort()` emit this event.
        // `store.loadData` (called from inside `rebuildRotatedStore` itself)
        // fires `'load'`, never `'sortchange'`, so this cannot re-enter.
        this._rotatedStore.on('sortchange', () => this.rebuildRotatedStore());
        this._rotatedColumns = Column.resolve(ROTATED_MODEL.getFields(), spec);
        this._rotatedConfigs = this.buildColumnConfigs(spec);

        return this._rotatedStore;
    }

    /**
     * Rebuilds the projection store's records from `_rotatedRecord` — one row
     * per visible source field, plus one group-separator row immediately
     * before each contiguous grouped run (per {@link computeGroupRuns}) while
     * the projection is unsorted — and refreshes the `_rotatedFieldByName` map
     * used by {@link rotatedCellType} / {@link rotatedCellValues} to resolve
     * each row's source field. Resolution is by the row's own `field` value
     * (not by index), so it stays correct after the projection is sorted by
     * clicking a header. Also refreshes `_rotatedSeparatorRecords`, the
     * identity map `Body` consults (via the `rowSeparator` predicate
     * {@link bindView} forwards) to tell a separator record from a real
     * one, and `_rotatedIndentedRecords`, the identity set `Body` consults
     * (via the `rowIndented` predicate) to indent a group member's
     * `field`-name cell.
     */
    private rebuildRotatedStore(): void {
        const store   = this.ensureRotatedStore();
        const columns = this.getSourceColumns();
        const record  = this._rotatedRecord;

        // Refresh the field lookup BEFORE loadData. loadData fires the store's
        // `load` event synchronously, and while the body is already bound to
        // the projection store (i.e. switching the displayed record) that
        // reraises straight into rotatedCellType / rotatedCellValues to rebind
        // each value cell. Building the lookup afterwards left that first
        // render resolving every value cell against a stale map: cellType fell
        // back to the column's `auto` type, the string renderer was swapped in
        // unlaid-out, and the value column stayed blank until the next scroll.
        this._rotatedFieldByName = new Map(columns.map(c => [c.getField().getName(), c.getField()]));

        const rows: Array<{ field: string, value: unknown }> = [];
        const separatorInfo: Array<{ label: string, color: string | null } | null> = [];
        const indentInfo: boolean[] = [];

        if (record) {
            // Separators would scatter away from the group they label once
            // the projection is sorted (a plain store sort has no notion of
            // group adjacency) — suppressed entirely while a sort is active,
            // and restored by the `'sortchange'` listener `ensureRotatedStore`
            // wires once `sort()` / `clearSort()` rebuild this from scratch.
            // The member-row indent is suppressed the same way and for the
            // same reason — nesting rows under a label that no longer sits
            // next to them would misrepresent the grouping.
            const unsorted = store.getActiveSorters().length === 0;
            const runs = unsorted
                ? this.computeGroupRuns(columns)
                : new Map<number, { label: string, color: string | null }>();

            for (let i = 0; i < columns.length; i++) {
                const run = runs.get(i);

                if (run) {
                    rows.push({ field: run.label, value: null });
                    separatorInfo.push(run);
                    indentInfo.push(false);
                }

                const field = columns[i].getField();

                rows.push({ field: field.getName(), value: record.get(field.getName()) });
                separatorInfo.push(null);
                indentInfo.push(unsorted && columns[i].getGroup() !== null);
            }
        }

        store.loadData(rows);

        this._rotatedSeparatorRecords = new Map();
        this._rotatedIndentedRecords  = new Set();

        store.getRecords().forEach((r, i) => {
            const info = separatorInfo[i];

            if (info) {
                this._rotatedSeparatorRecords.set(r, info);
            }

            if (indentInfo[i]) {
                this._rotatedIndentedRecords.add(r);
            }
        });
    }

    /**
     * Finds each contiguous run of visible source columns sharing the same
     * non-null {@link Column.getGroup} name, mirroring the adjacency rule
     * {@link TableHeader}'s private `rebuildParentCells` uses for the
     * parent-header band: non-adjacent columns sharing a group name are two
     * separate runs, and a run's color is the first non-null
     * {@link Column.getGroupColor} encountered, not the last. Unlike
     * `rebuildParentCells`, which also emits a blank spanning cell for every
     * *ungrouped* run so the parent-header band has no gap, this emits
     * nothing for an ungrouped run — a rotated body row has no such
     * continuity requirement.
     *
     * @param columns - The visible source columns to scan, in display order
     *   (already sorted by field order — see {@link getSourceColumns}).
     *
     * @returns A map from a run's starting index into `columns` to its
     *   label/color.
     */
    private computeGroupRuns(columns: Column[]): Map<number, { label: string, color: string | null }> {
        const runs = new Map<number, { label: string, color: string | null }>();

        if (columns.length === 0) {
            return runs;
        }

        let runStart = 0;
        let runKey   = columns[0].getGroup();
        let runColor = columns[0].getGroupColor();

        const flush = (): void => {
            if (runKey !== null) {
                runs.set(runStart, { label: runKey, color: runColor });
            }
        };

        for (let i = 1; i < columns.length; i++) {
            const nextKey = columns[i].getGroup();
            const runContinues = runKey !== null && nextKey === runKey;

            if (!runContinues) {
                flush();
                runStart = i;
                runKey   = nextKey;
                runColor = columns[i].getGroupColor();
            } else if (runColor === null && columns[i].getGroupColor() !== null) {
                runColor = columns[i].getGroupColor();
            }
        }

        flush();

        return runs;
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
     * @param rowVisible - The row-visibility predicate, or `null`. Passed
     *   `null` on the rotated call site — a predicate written against
     *   source records cannot apply to the field/value projection.
     * @param rowSeparator - The group-separator predicate, or `null`.
     *   Passed `null` on the normal-mode call site — no separator concept
     *   exists outside the rotated projection.
     * @param rowIndented - The group-member indent predicate, or `null`.
     *   Passed `null` on the normal-mode call site, for the same reason
     *   as `rowSeparator`.
     *
     * @remarks The body is re-bound in one pass via `Body.bindViewState`,
     * which writes the store, columns, column configs, hidden-column set and
     * every row predicate before reconciling the pool and rendering once.
     * Installing the row predicates before that single render is what makes
     * freshly-built cells receive their read-only state on the same pass
     * they're built, rather than needing a second rebind afterward.
     * `_body.selectRecord(null)` transiently fires the body's own
     * `"selection"` — `_suppressSelectionForward` gates the Table-level
     * forwarder for the duration of the re-bind so that transient clear
     * never reaches consumers. Clearing `_columnWidths` /
     * `_savedColumnWidths` is what makes the layout manager re-initialise
     * widths for the new column count on the next `doLayout`.
     */
    private bindView(
        store:       AbstractStore,
        columns:     Column[],
        configs:     Map<string, ColumnConfig>,
        hidden:      Set<string>,
        rowReadOnly:  ((record: ModelRecord) => boolean) | null,
        rowVisible:   ((record: ModelRecord) => boolean) | null,
        rowSeparator: ((record: ModelRecord) => { label: string, color: string | null } | null) | null,
        rowIndented:  ((record: ModelRecord) => boolean) | null,
    ): void {
        this._suppressSelectionForward = true;

        this._header.setStore(store);
        this._header.setModel(store.model);
        this._header.setColumns(columns);
        this._header.setHiddenColumns(hidden);

        this._body.selectRecord(null);
        this._header.setColumnConfigs(configs);
        this._body.bindViewState({
            store,
            columns,
            columnConfigs: configs,
            hiddenColumns: hidden,
            rowReadOnly,
            rowVisible,
            rowSeparator,
            rowIndented,
        });

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
     * Unsubscribes from the source store (see {@link bindSourceStore}),
     * disposes the column context menu and the column dialog (if open), then
     * runs the inherited teardown. `_columnContextMenu` and `_columnDialog`
     * are both LayerManager-mounted panels, never registered children (see
     * Menu.ts's class comment), so `super.destructor()`'s child recursion
     * cannot reach either. The store subscription needs its own explicit
     * unbind for the same reason `Tooltip.attach` needed `onDestroy`: `_store`
     * is owned by the caller, not by this `Table`, and can outlive it — an
     * un-unsubscribed listener would pin this table in the store's own
     * `ListenerBag` for as long as the store itself lives.
     */
    protected destructor(): void {
        this.unbindSourceStore(this._store);
        this._columnDialog?.dispose();
        this._columnContextMenu.dispose();
        this._cellText.dispose();

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
                { text: 'Export as CSV',  glyph: 'file-csv',  action: () => this.exportCSV()  },
                { text: 'Export as JSON', glyph: 'file-code', action: () => this.exportJSON() },
                { text: 'Export as TSV',  glyph: 'file-lines', action: () => this.exportTSV() },
            ]);

            return;
        }

        const columns = this.columnsInMenuOrder();
        const items: MenuItemConfig[] = [];

        if (columns.length > 0) {
            items.push(
                columns.length > COLUMN_MENU_DIALOG_THRESHOLD
                    ? { text: 'Show/hide columns', glyph: 'table-columns', action: () => this.showColumnDialog() }
                    : {
                        text:    'Show/hide columns',
                        glyph:   'table-columns',
                        submenu: { label: 'Show/hide columns', items: this.buildColumnMenuItems(columns) },
                    }
            );
        }

        items.push(
            { separator: true },
            { text: 'Reset columns', glyph: 'undo', action: () => this.resetColumns() }
        );

        if (this._resolvedColumns.some(c => c.isFilterable())) {
            items.push(
                { separator: true },
                {
                    row: () => {
                        const row = new CheckboxMenuRow({ text: 'Filter', checked: this._filterRowVisible });

                        row.on('action', () => { this.setFilterRowVisible(row.isChecked()); });

                        return row;
                    },
                },
            );
        }

        if (this._exportMenuEnabled) {
            items.push(
                { separator: true },
                { text: 'Export as CSV',  glyph: 'file-csv',  action: () => this.exportCSV()  },
                { text: 'Export as JSON', glyph: 'file-code', action: () => this.exportJSON() },
                { text: 'Export as TSV',  glyph: 'file-lines', action: () => this.exportTSV() }
            );
        }

        this._columnContextMenu.show(x, y, items);
    }

    /**
     * Displays the body's right-click "Copy" menu over a data cell, reusing
     * the same rebuild-mode `Menu` instance {@link showColumnMenu} shows over
     * a header cell — a column-header right-click and a body-cell
     * right-click never happen at once, and `Menu.show()` fully rebuilds its
     * item list on every call, so there is nothing to reset between uses.
     *
     * @param x - Viewport x coordinate for the menu.
     * @param y - Viewport y coordinate for the menu.
     */
    private showCellMenu(x: number, y: number): void {
        this._columnContextMenu.show(x, y, [
            { text: 'Copy', glyph: 'clipboard', action: () => this._body.copyContextMenuSelection() },
        ]);
    }

    /**
     * Resolved columns in display order — the order the header and body
     * render them in, and the order both the show/hide submenu and dialog
     * list them in.
     *
     * @returns Resolved columns sorted by {@link Field.getOrder}.
     */
    private columnsInMenuOrder(): Column[] {
        return this._resolvedColumns
            .slice()
            .sort((a, b) => a.getField().getOrder() - b.getField().getOrder());
    }

    /**
     * Builds the show/hide submenu's item list: one checkable row per
     * `columns` entry, with a disabled section-header row and a preceding
     * separator at each group boundary.
     *
     * @param columns - Resolved columns in display order, from {@link columnsInMenuOrder}.
     * @returns The submenu's `MenuItemConfig` array.
     */
    private buildColumnMenuItems(columns: Column[]): MenuItemConfig[] {
        const items: MenuItemConfig[] = [];
        let lastGroup: string | null | undefined = undefined;

        // The indent uses non-breaking spaces (` `) because the
        // menu item renders text with the default `white-space: nowrap`
        // setting, which still collapses runs of ASCII spaces — regular
        // `'    '` would render as a single space.
        const GROUP_INDENT = "    ";

        for (const col of columns) {
            const fieldName = col.getField().getName();
            const visible   = !this._hiddenColumns.has(fieldName);
            const group     = col.getGroup();

            if (group !== lastGroup) {
                if (items.length > 0) {
                    items.push({ separator: true });
                }

                if (group !== null) {
                    items.push({ text: group, enabled: false });
                }
            }

            const label   = (group !== null ? GROUP_INDENT : "") + fieldName;
            const enabled = !col.isUnhideable();

            items.push({
                row: () => {
                    const row = new CheckboxMenuRow({ text: label, checked: visible, enabled });

                    row.on('action', () => { this.setColumnVisible(fieldName, row.isChecked()); });

                    return row;
                },
            });

            lastGroup = group;
        }

        return items;
    }

    /**
     * Opens the show/hide-columns dialog: a checkbox per resolved column,
     * staged in a local copy of `_hiddenColumns` and only written back to the
     * table on Apply. Cancel, the title-bar ×, Escape, and a dispose-while-open
     * all resolve without writing anything.
     */
    private showColumnDialog(): void {
        const columns  = this.columnsInMenuOrder();
        const snapshot = new Set(this._hiddenColumns);
        const staged   = new Set(snapshot);
        const body     = this.buildColumnDialogBody(columns, staged);

        // Sized from the body's own measured content — Dialog's width is fixed at
        // construction and never re-derived from content (unlike height, see
        // resizeToContent) — so a tight width here is the only way to avoid a
        // dialog wider than the checkbox columns actually need.
        const width = Math.ceil(body.getPreferredSize()?.width ?? 0);

        const dialog = new Dialog({
            title:            'Show/hide columns',
            contentComponent: body,
            width,
            buttons: [
                DialogButtons.Cancel,
                { ...DialogButtons.Confirm, text: 'Apply', primary: true },
            ],
        });

        this._columnDialog = dialog;

        void dialog.show().then(result => {
            this._columnDialog = null;

            if (result !== 'confirm') {
                return;
            }

            for (const col of columns) {
                const fieldName = col.getField().getName();

                if (staged.has(fieldName) !== snapshot.has(fieldName)) {
                    this.setColumnVisible(fieldName, !staged.has(fieldName));
                }
            }
        });
    }

    /**
     * The number of side-by-side checkbox columns the show/hide dialog uses
     * for `checkboxCount` resolved columns, capped at
     * {@link COLUMN_DIALOG_MAX_PER_COLUMN} rows per column.
     *
     * @param checkboxCount - Total resolved columns to lay out.
     * @returns The column count, at least `1`.
     */
    private dialogColumnCount(checkboxCount: number): number {
        return Math.max(1, Math.ceil(checkboxCount / COLUMN_DIALOG_MAX_PER_COLUMN));
    }

    /**
     * Splits `columns` into {@link dialogColumnCount} slices, in display
     * order, as evenly sized as possible — e.g. 22 columns over 2 dialog
     * columns is `[11, 11]`, not `[15, 7]`.
     *
     * @param columns - Resolved columns in display order, from {@link columnsInMenuOrder}.
     * @returns One slice of `columns` per dialog column.
     */
    private splitIntoDialogColumns(columns: Column[]): Column[][] {
        const numColumns = this.dialogColumnCount(columns.length);
        const base       = Math.floor(columns.length / numColumns);
        const remainder  = columns.length % numColumns;

        const slices: Column[][] = [];
        let cursor = 0;

        for (let i = 0; i < numColumns; i++) {
            const size = base + (i < remainder ? 1 : 0);

            slices.push(columns.slice(cursor, cursor + size));
            cursor += size;
        }

        return slices;
    }

    /**
     * Builds the show/hide-columns dialog body: {@link splitIntoDialogColumns}'
     * slices laid out side by side, each built by {@link buildColumnDialogColumn}.
     *
     * @param columns - Resolved columns in display order, from {@link columnsInMenuOrder}.
     * @param staged  - The dialog's local copy of `_hiddenColumns`, mutated as the user toggles checkboxes.
     * @returns The dialog's `contentComponent`.
     */
    private buildColumnDialogBody(columns: Column[], staged: Set<string>): Component {
        const columnComponents = this.splitIntoDialogColumns(columns)
            .map(slice => this.buildColumnDialogColumn(slice, staged));

        return new Component({
            // The dialog is sized to this body's own preferred width (see
            // showColumnDialog), so `justify: "center"` is normally a no-op — it
            // only centers the columns when Dialog's own MIN_DIALOG_WIDTH floor
            // (320px) leaves leftover space, e.g. a couple of short-named columns.
            layoutManager: new HBox({ itemAlign: "start", justify: "center", spacing: COLUMN_DIALOG_COLUMN_GAP_PX }),
            insets:        new Insets(COLUMN_DIALOG_INSET_PX, COLUMN_DIALOG_INSET_PX, COLUMN_DIALOG_INSET_PX, COLUMN_DIALOG_INSET_PX),
            components:    columnComponents,
        });
    }

    /**
     * Builds one column of the show/hide-columns dialog: one `Checkbox` per
     * `columns` entry, indented and grouped under a bold `Text` header for
     * each grouped run — a group split across dialog columns repeats its
     * header at the top of the next one. Every checkbox's `change` listener
     * mutates `staged` only — nothing here writes to the table.
     *
     * @param columns - The slice of resolved columns this dialog column lists.
     * @param staged  - The dialog's local copy of `_hiddenColumns`, mutated as the user toggles checkboxes.
     * @returns A single dialog column, ready to sit beside its siblings.
     */
    private buildColumnDialogColumn(columns: Column[], staged: Set<string>): Component {
        const rows: Component[] = [];
        let lastGroup: string | null | undefined = undefined;

        for (const col of columns) {
            const fieldName = col.getField().getName();
            const group     = col.getGroup();

            if (group !== lastGroup && group !== null) {
                const groupHeader = new Text(group, { fontWeight: "bold" });

                rows.push(groupHeader);
            }

            rows.push(new Checkbox({
                label:     fieldName,
                selected:  !staged.has(fieldName),
                enabled:   !col.isUnhideable(),
                insets:    group !== null
                    ? new Insets(0, 0, 0, COLUMN_DIALOG_GROUP_INDENT_PX)
                    : undefined,
                listeners: {
                    change: (on: boolean) => {
                        if (on) {
                            staged.delete(fieldName);
                        } else {
                            staged.add(fieldName);
                        }
                    },
                },
            }));

            lastGroup = group;
        }

        return new Component({
            layoutManager: new VBox({ itemAlign: "stretch" }),
            components:    rows,
        });
    }

    /**
     * Enables or disables the "Export as CSV" / "Export as JSON" / "Export
     * as TSV" entries in the column context menu.
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

        TableExporter.exportCSV(columns, records, this._columnConfigs, this._cellText, options);
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

        TableExporter.exportJSON(columns, records, this._columnConfigs, this._cellText, options);
    }

    /**
     * Triggers a TSV download of the current store view. Mode-independent:
     * always exports the source table's records and columns, never the
     * rotated field/value projection.
     *
     * @param options - Optional export options (e.g. include hidden columns, custom filename).
     */
    exportTSV(options?: ExportOptions): void {
        const columns = this.getExportColumns(options?.includeHidden ?? false);
        const records = this._store.getRecords();

        TableExporter.exportTSV(columns, records, this._columnConfigs, this._cellText, options);
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
     * Returns the exact text a cell shows for `field` on `record` — the same
     * string CSV/JSON export and the column filter row resolve a combo label
     * or a formatted date/time/datetime through. Resolved against every
     * resolved column, including a hidden one, so a quick search built on
     * this method still matches a column the user has toggled off.
     *
     * @param field - The model field name to read and format.
     * @param record - The record to read the field from.
     * @returns The cell's display text, or `''` when `field` names no
     *   resolved column or the record's value is `null`/`undefined`.
     */
    getCellText(field: string, record: ModelRecord): string {
        const col = this._resolvedColumns.find(c => c.getField().getName() === field);

        if (!col) {
            return '';
        }

        return String(TableExporter.formatValue(col, record.get(field), this._columnConfigs, this._cellText) ?? '');
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

        // A column the drag actually moved is now user-set: the data-driven
        // re-sample must not overwrite it. `out` starts as a copy of `widths`, so
        // an untouched entry is bit-identical and needs no epsilon.
        if (this._displayMode !== "rotated") {
            out.forEach((w, i) => {
                if (w !== widths[i]) {
                    this._pinnedColumnWidths.set(columns[i].getField().getName(), w);
                }
            });
        }

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
        this._pinnedColumnWidths = new Map();
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
     * A column the user drag-resized returns its dragged width verbatim,
     * ahead of a declared `width` or the sampled policy width.
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
            const pinned = this.pinnedWidth(col);

            if (pinned !== null) {
                return pinned;   // the drag already clamped it; re-clamping would
                                 // snap a >AUTO_WIDTH_CAP_PX drag back to the cap
            }

            const policy = this.columnWidthPolicy(col, headerPx[i], contentPx[i]);
            const raw    = col.getWidth() ?? policy.preferred;

            if (raw === null) {
                return null;
            }

            return this.clampColumnWidth(raw, col, policy);
        });
    }

    /**
     * Returns the width the user drag-resized this column to, or `null` when
     * the column has never been dragged. Always `null` in rotated mode: the
     * projection's field names live in their own namespace and must never
     * match a pin recorded against a source column of the same name.
     */
    private pinnedWidth(col: Column): number | null {
        if (this._displayMode === "rotated") {
            return null;
        }

        return this._pinnedColumnWidths.get(col.getField().getName()) ?? null;
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
        return String(TableExporter.formatValue(sourceColumn, record.get('value'), new Map(), this._cellText) ?? '');
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
                const text = String(TableExporter.formatValue(col, raw, this._columnConfigs, this._cellText) ?? "");
                const list = best.get(name) ?? [];

                this.keepLongest(list, text);
                best.set(name, list);
            });
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

                // A rotated group member's `field`-name cell renders
                // indented by DEFAULT_INDENT_PX (see `Row.setFieldIndent`);
                // reserve that space here too, or an indented row's text
                // would overflow a column sized purely from raw text width.
                // Reserved whenever ANY row is currently indented, not
                // per-candidate — `_rotatedIndentedRecords` is empty
                // whenever the projection is sorted or has no groups, so
                // this adds nothing then.
                const indent = this._displayMode === "rotated"
                    && col.getField().getName() === "field"
                    && this._rotatedIndentedRecords.size > 0
                    ? DEFAULT_INDENT_PX
                    : 0;

                return { min, preferred: Math.max(min, contentPx + CELL_CHROME_PX + indent, headerPx) };
            }
        }
    }

    /**
     * Returns the cached width-reference bundle, measuring it once (in one
     * batched call) the first time anything asks. `dateReferenceKeys` scans
     * only the currently visible columns, so this is cleared everywhere
     * that set can change: `setStore`, `bindView` (a display-mode switch),
     * `setColumnVisible`, and `resetColumns`.
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
                const base = String(TableExporter.formatValue(col, REFERENCE_DATE, this._columnConfigs, this._cellText) ?? "");

                seen.set(key, [base, ...digitChars.map(d => base.replace(/\d/g, d))]);
            }
        }

        return Array.from(seen, ([key, texts]) => ({ key, texts }));
    }

    /**
     * Re-derives column widths whenever the source store's `'load'` / `'add'` /
     * `'remove'` / `'datachange'` events report data (an in-cell edit arrives as
     * the `'datachange'` that `AbstractStore.notifyRecordChanged` fires right
     * after its `'update'`). Clearing `_columnWidths` is what makes the layout
     * manager re-run `initializeWidths`; columns the user drag-resized keep
     * their width through `_pinnedColumnWidths`.
     *
     * A no-op when auto-size is off (rotated mode included) or the store is
     * empty. The pass is queued onto the animation-frame layout queue rather
     * than run synchronously, so a burst of adds, removes or edits collapses
     * into one layout — mirroring `onColumnResize`.
     */
    private maybeResampleColumnWidths(): void {
        if (!this.isAutoSizeColumns() || this._store.getCount() === 0) {
            return;
        }

        this._columnWidths      = [];
        this._savedColumnWidths = new Map();

        this.scheduleLayout();
    }
}

const TableCallable = callable(Table);
type TableCallable = Table;
export {
    Table         as _Table,
    TableCallable as Table
};
