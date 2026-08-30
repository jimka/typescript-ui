// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import type { Field } from "~/data/Field.js";
import { Row } from "~/component/table/Row.js";
import type { ColumnWindowSlidePlan, RetargetedCell } from "~/component/table/Row.js";
import { Cell } from "~/component/table/cell/Cell.js";
import type { CellNavigateDirection } from "~/component/table/cell/Cell.js";
import { CellEditorPool } from "~/component/table/cell/editor/CellEditorPool.js";
import { ComboEditor } from "~/component/table/cell/editor/Combo.js";
import { Event } from "~/core/Event.js";
import { VirtualRowView } from "~/component/shared/VirtualRowView.js";
import { reduceModifierSelection } from "~/component/shared/reduceModifierSelection.js";
import { selectionsEqual } from "~/component/shared/selectionsEqual.js";
import { Util } from "~/core/Util.js";
import type { ColumnConfig } from "~/component/table/ColumnConfig.js";
import { Column } from "~/component/table/Column.js";
import type { TableHeader } from "~/component/table/Header.js";
import { callable } from "~/core/Callable.js";
import { TableExporter } from "~/component/table/TableExporter.js";
import { CellTextResolver } from "~/component/table/cell/CellText.js";
import { tableRowHeight } from "~/component/table/RowMetrics.js";

/**
 * String-literal union of the events emitted by the table {@link Body}.
 * `"verticalscroll"` / `"horizontalscroll"` fire after the body's virtual
 * scroll position changes, carrying the new pixel offset. `"selection"`
 * fires when the selected-record set changes; `"cellclick"` fires when a data
 * cell is clicked; `"cellcontextmenu"` fires when a data cell is right-clicked.
 */
export type BodyEvent = "verticalscroll" | "horizontalscroll" | "selection" | "cellclick" | "cellcontextmenu";

/**
 * Payload delivered to a `"cellclick"` listener when a data cell is clicked.
 *
 * `field` (the model field name) is the stable column identity; `columnIndex`
 * matches the visible-column order the body exposes via a row's cells and the
 * keyboard-focused column. `rowIndex` is the record's position in the filtered +
 * sorted view (`getVisibleRecords()`), the same basis selection uses — never a
 * pool-slot index. `value` is read live from the record at click time.
 */
export interface CellClickEvent {
    /** The clicked row's bound record. */
    record: ModelRecord;
    /** The clicked column's model field name. */
    field: string;
    /** The clicked column's index in visible-column order. */
    columnIndex: number;
    /** `record.get(field)` at click time. */
    value: unknown;
    /** The record's index into the body's visible-records list. */
    rowIndex: number;
    /** The raw DOM mouse event that triggered the click. */
    event: MouseEvent;
}

/**
 * The complete view state a `Table` re-binds its body to in one step, via
 * {@link Body.bindViewState}.
 *
 * @category Components
 */
export interface BodyViewState {
    store:         AbstractStore;
    columns:       Column[];
    columnConfigs: Map<string, ColumnConfig>;
    hiddenColumns: Set<string>;
    rowReadOnly:   ((record: ModelRecord) => boolean) | null;
    rowVisible:    ((record: ModelRecord) => boolean) | null;
    rowSeparator:  ((record: ModelRecord) => { label: string, color: string | null } | null) | null;
    rowIndented:   ((record: ModelRecord) => boolean) | null;
}

/**
 * Returns the index of the cell in `cells` whose element is, or contains, the
 * clicked `target` handle; `-1` when the target lies outside every cell (or is
 * null). Pure with respect to the interned handles — no component state.
 *
 * @param cells - The clicked row's cells, in visible-column order.
 * @param target - The interned click-target handle, or null.
 *
 * @returns The matching cell index, or `-1`.
 *
 * @internal
 */
export function resolveClickedColumn(cells: Component[], target: Handle | null): number {
    for (let ci = 0; ci < cells.length; ci++) {
        const cellEl = cells[ci].getElement();

        if (cellEl && (cellEl === target || DOM.source.contains(cellEl, target))) {
            return ci;
        }
    }

    return -1;
}

/** Number of off-screen columns to render to the left and right of the viewport. */
const COLUMN_BUFFER = 2;

/**
 * The horizontally-visible column range plus the geometry every rendered
 * cell is placed from. `firstCol` / `lastCol` are inclusive visible-column
 * indices; `lastCol` is `-1` when there are no columns.
 *
 * @internal
 */
export interface ColumnWindow {
    firstCol: number;
    lastCol : number;
    /** Effective width per visible column, index-aligned with visible-column order. */
    widths  : number[];
    /** Left offset per visible column — the running sum of `widths`. */
    lefts   : number[];
}

/**
 * Computes the fixed rendered-column-window width for a viewport: the
 * number of slots that fits the largest raw-visible run any scroll offset
 * can produce, plus {@link COLUMN_BUFFER} on each side, capped at the
 * column count. Sizing the window from this fixed count rather than from
 * the current scroll offset is the column-axis counterpart of row
 * virtualization's pool-target sizing, which likewise sizes the row pool
 * from the viewport alone so edge clamping cannot shrink it.
 *
 * @param lefts - Left offset per visible column, in display order.
 * @param viewportWidth - The body's visible width in pixels.
 *
 * @returns The fixed slot count `computeColumnWindow` places its window with.
 *
 * @internal
 */
export function computeColumnWindowSize(lefts: number[], viewportWidth: number): number {
    const n = lefts.length;

    if (n === 0) {
        return 0;
    }

    // Widest run of columns whose left edges all fall within one viewport
    // width of each other. The raw-visible run at any scroll offset is one
    // such run plus at most one extra column on its left, so `widest + 1`
    // bounds every offset's raw-visible count.
    let widest = 1;
    let start  = 0;

    for (let end = 0; end < n; end++) {
        while (start < end && lefts[end] - lefts[start] > viewportWidth) {
            start++;
        }

        if (end - start + 1 > widest) {
            widest = end - start + 1;
        }
    }

    return Math.min(n, widest + 1 + 2 * COLUMN_BUFFER);
}

/**
 * Computes the column window for a horizontal scroll offset and viewport width.
 *
 * Walks `widths` left to right, accumulating each column's left offset. A
 * column is raw-visible when its right edge is at or after `scrollX` AND its
 * left edge is at or before `scrollX + viewportWidth` — an inclusive
 * comparison, so a table with no known widths yet (`widths` full of zeros,
 * e.g. before the layout manager has run) degrades to "every column
 * renders" rather than "no column renders". The window has a fixed width —
 * see {@link computeColumnWindowSize} — and slides against the ends of the
 * column list rather than being clamped at both ends, so it never narrows
 * near an edge.
 *
 * @param widths - Effective width per visible column, in display order.
 * @param scrollX - The current horizontal scroll offset in pixels.
 * @param viewportWidth - The body's visible width in pixels.
 *
 * @returns The column window: the rendered range plus the widths/lefts it was derived from.
 *
 * @internal
 */
export function computeColumnWindow(
    widths       : number[],
    scrollX      : number,
    viewportWidth: number,
): ColumnWindow {
    const n     = widths.length;
    const lefts = new Array<number>(n);
    let x = 0;

    for (let i = 0; i < n; i++) {
        lefts[i] = x;
        x += widths[i];
    }

    if (n === 0) {
        return { firstCol: 0, lastCol: -1, widths, lefts };
    }

    const viewportRight = scrollX + viewportWidth;

    let firstRawVisible = -1;

    for (let i = 0; i < n; i++) {
        if (lefts[i] + widths[i] >= scrollX && lefts[i] <= viewportRight) {
            firstRawVisible = i;
            break;
        }
    }

    if (firstRawVisible === -1) {
        // No column's span touches the viewport at all (e.g. scrolled past
        // the content); anchor the window at the left edge so a window is
        // still returned.
        firstRawVisible = 0;
    }

    const slotCount = computeColumnWindowSize(lefts, viewportWidth);
    const firstCol  = Math.min(Math.max(firstRawVisible - COLUMN_BUFFER, 0), n - slotCount);
    const lastCol   = firstCol + slotCount - 1;

    return { firstCol, lastCol, widths, lefts };
}

function columnWidthsEqual(a: number[], b: number[] | undefined): boolean {
    if (!b) return a.length === 0;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Inclusive row/column bounds of a rectangular cell-range selection, in
 * visible-row / visible-column index space.
 *
 * @internal
 */
interface CellRangeBounds {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
}

// Named so the class default below and the constructor's explicit seed share
// one literal instead of two — mirrors Footer.ts's FOOTER_BG.
const TABLE_BODY_BG = "var(--ts-ui-input-bg, rgb(255, 255, 255))";

// Own contribution to the hierarchy-aware class tier — see
// plans/implemented/class-hierarchy-cascade.md. Every Table's body resolves
// the same resting background from theme tokens, so it is a class default
// rather than a per-instance write.
const _defaultTableBodyOptions: Partial<ComponentOptions> = {
    backgroundColor: TABLE_BODY_BG,
};

/**
 * Virtual-scrolling body for the Table component.
 *
 * Only the rows visible in the viewport plus SCROLL_BUFFER rows above and below
 * are ever in the DOM. The store is queried on every render so the body always
 * reflects current store state without maintaining a duplicate data array.
 *
 * A fixed pool of Row components (`rowPool`) is reused as the user scrolls.
 * Each pool slot is tracked in `boundIndices`: when a slot is mapped to a new
 * data index, `row.setData()` is called to rebind cell values; if the index
 * hasn't changed (e.g. during a pure resize) the call is skipped, avoiding the
 * text-measurement reflow inside `setText()`.
 *
 * Scrolling is delegated to a `VirtualScroller` that owns the
 * rows-container transform, two custom scrollbar overlays, and the wheel/touch
 * handlers with fling momentum.
 *
 * Exported as `Body`; commonly imported as `TableBody` to avoid colliding
 * with other same-named exports — see docs/components/TableInternals.md.
 *
 * @category Components
 */
class TableBody extends VirtualRowView<Row> {

    protected static readonly ownClassStyleDefaults: StyleBag = _defaultTableBodyOptions;

    private _store           : AbstractStore;
    private _hiddenColumns   : Set<string>               = new Set();
    private _columns         : Column[]                  = [];
    private _columnConfigs   : Map<string, ColumnConfig> = new Map();
    private _rowReadOnly     : ((record: ModelRecord) => boolean) | null = null;
    private _rowVisible      : ((record: ModelRecord) => boolean) | null = null;
    private _rowSeparator    : ((record: ModelRecord) => { label: string, color: string | null } | null) | null = null;
    private _rowIndented     : ((record: ModelRecord) => boolean) | null = null;
    private _lastBodyWidth   : number                    = 0;
    private _lastColumnWidths: number[]                  = [];
    private _lastAriaRowCount: number                    = -1;
    private _rowHeight       : number;
    // Last column window `bindAndPositionRows` applied. Framework-managed
    // bookkeeping (recomputed from `renderWindow` on every pass), so per
    // ARCHITECTURE.md's DOM-write rule this gets no `BodyOptions` field or
    // public setter.
    private _colWindow       : ColumnWindow               = { firstCol: 0, lastCol: -1, widths: [], lefts: [] };
    // Re-entrancy guard: a commit fired mid-render cascades back into
    // `renderWindow` / `syncPoolCells` through `store.notifyRecordChanged`;
    // this makes the nested call a no-op. See `commitEditsOutsideWindow`.
    private _reconciling     : boolean                    = false;
    private _storeRefresh    : (() => void) | null       = null;
    private _selectedRecords : Set<ModelRecord>          = new Set();
    private _anchorRecord    : ModelRecord | null        = null;
    private _focusedColIndex: number                    = 0;
    // The pool cell `_updateFocusStyle` last set `.focused` on, so the next
    // call can clear just that one cell instead of sweeping the whole pool
    // — see that method's own comment. `null` when nothing is focused, or
    // once the tracked cell falls out of the pool (a resize / field-set
    // change / window jump), which forces the full-sweep fallback.
    private _previousFocusedCell: Cell<any> | null       = null;
    // Rectangular cell-range selection, keyed by record identity + visible-
    // column index — mirrors `_selectedRecords`/`_anchorRecord`'s tolerance
    // for a since-removed/filtered record (see `getCellRangeBounds`).
    private _rangeAnchor     : { record: ModelRecord, col: number } | null = null;
    private _rangeFocus      : { record: ModelRecord, col: number } | null = null;
    // True once the live drag has widened from native text selection into
    // rectangular cell-range selection — the one-way switch that installs the
    // `selectstart` suppressor. Framework-managed bookkeeping (reset on every
    // mousedown and mouseup), so per ARCHITECTURE.md's DOM-write rule this gets
    // no `BodyOptions` field and no public setter.
    private _rangeDragWidened: boolean                    = false;
    // The right-clicked cell, resolved fresh on every `"contextmenu"` and
    // left untouched by anything else — right-click never mutates the
    // persistent range (see the plan's right-click Architecture Decision).
    private _contextMenuCell : { record: ModelRecord, col: number } | null = null;
    // Formats off-screen values the way their cell renderer would, for a
    // copy range that spans outside the rendered pool. Owner-held, mirroring
    // `_editorPool` — disposed in `destructor()`.
    private _cellText        : CellTextResolver          = new CellTextResolver();
    private _editorPool      : CellEditorPool            = new CellEditorPool();
    private _header          : TableHeader | null             = null;
    private _listeners       : ListenerBag<BodyEvent>    = this.registerListenerBag(new ListenerBag<BodyEvent>());

    constructor(store: AbstractStore, subclassDefaults?: Partial<ComponentOptions>) {
        super({ tag: "tbody" }, { ..._defaultTableBodyOptions, ...(subclassDefaults ?? {}) });

        this.setOverflow("hidden");
        this.setBackgroundColor(TABLE_BODY_BG);
        this.getAria().setTabIndex(0);
        this.getAria().setRole("rowgroup");

        this._store = store;
        this.bindStore(store);

        this._rowHeight = tableRowHeight();

        this.subscribeTheme(() => this.onThemeReflow());
    }

    /**
     * Refreshes the derived row height, marks every pooled row's cells dirty,
     * then chains to the shared re-bind pass.
     *
     * @remarks Order matters: {@link VirtualRowView.onThemeReflow} ends by
     * calling `renderWindow()`, so the cells must already be dirty (see
     * {@link Cell.canSkipUnchangedLayout}'s enumeration) when it does, or a
     * cell re-placed at unchanged geometry would keep its `doLayout()`
     * withheld altogether — parity with the deleted per-cell geometry cache,
     * whose own clear-on-theme-change was reached from this same call chain.
     * Whether a cell's *renderer* reflects the new theme's insets by the end
     * of this one pass is a separate question this marking does not answer: the
     * renderer's own theme subscription registers after this component's
     * (built when the cell is pooled, not in `Body`'s constructor), so it
     * can still be pending when this inline `renderWindow()` runs — the same
     * ordering risk `TableHeader`'s theme subscription comment documents and
     * avoids by not re-rendering inline. `Body` re-renders inline here
     * unchanged from before this class opted its cells into the skip.
     */
    protected onThemeReflow(): void {
        this._rowHeight = tableRowHeight();

        for (const row of this._rowPool) {
            for (const cell of row.getComponents()) {
                cell.invalidateLayout();
            }
        }

        super.onThemeReflow();
    }

    /**
     * Returns the live row height. The base's window / geometry math reads it
     * on every call so a theme-driven `_rowHeight` recompute takes effect
     * immediately.
     */
    protected getRowHeight(): number {
        return this._rowHeight;
    }

    /**
     * Constructs one pool row, windows it to the current column window, and
     * wires each of its cells to the shared editor pool + horizontal
     * scroll-into-view handler. The base's `growRowPool` owns the append +
     * parallel-array bookkeeping.
     *
     * @returns The wired, un-appended pool row.
     */
    protected createPoolRow(): Row {
        const row = this.createRow();

        row.setColumnWindow(this._colWindow.firstCol, this._colWindow.lastCol);
        this.wireRowCells(row);

        return row;
    }

    /**
     * Wires `cells` (default: every one of `row`'s cells) to four
     * callbacks: the shared editor pool (`setEditorPool`), the horizontal
     * scroll-into-view handler (`setScrollIntoViewHandler`), the edit-end
     * handler that returns focus to the body on Escape
     * (`setEditEndHandler`), and the navigate handler that moves editing to
     * a neighboring cell on Tab/Shift+Tab/Enter/Shift+Enter
     * (`setNavigateHandler`). Called from {@link createPoolRow} for a
     * freshly-pooled row (no scope — the whole row is new) and from
     * {@link bindAndPositionRows} whenever a reconcile changes the rendered
     * cell set, scoped to just the retargeted cells — all four setters
     * simply replace the cell's single stored callback rather than
     * accumulating state (unlike `.on()`), so re-running any of them on a
     * surviving cell is idempotent and scoping down changes nothing but
     * the cost.
     *
     * @param row - The pool row whose cells to wire.
     * @param cells - Optional. The cells to wire; defaults to every cell in `row`.
     */
    private wireRowCells(row: Row, cells?: Cell<any>[]): void {
        for (const cell of cells ?? (row.getComponents() as Cell<any>[])) {
            cell.setEditorPool(this._editorPool);
            cell.setScrollIntoViewHandler(() => this.scrollColumnIntoView(this._focusedColIndex));
            cell.setEditEndHandler(() => {
                this.focus();
                this._updateFocusStyle();
                this._updateActiveDescendant();
            });
            cell.setNavigateHandler((direction) => this.navigateFromEditingCell(direction));
        }
    }

    /**
     * Subscribes to all relevant store events to trigger a renderWindow refresh.
     *
     * @param store - The store whose events to subscribe to.
     *
     * @remarks The single store-event refresh callback is routed through
     * {@link onStoreChange}, a protected hook that subclasses (e.g.
     * `TreeBody`) override to rebuild per-row indexes before the
     * inherited rebind + render runs.
     */
    private bindStore(store: AbstractStore): void {
        const refresh = () => this.onStoreChange();

        this._storeRefresh = refresh;

        store.on('load', refresh);
        store.on('add', refresh);
        store.on('remove', refresh);
        store.on('datachange', refresh);
        store.on('beforesync', refresh);
        store.on('sync', refresh);
    }

    /**
     * Hook invoked from {@link bindStore}'s store-event callbacks before
     * the row pool is rebound and rendered. Default behaviour clears the
     * bound-index cache and re-renders.
     *
     * @remarks Subclassing seam — `TreeBody` overrides this to rebuild
     * its parent/child index and flatten the visible subtree before
     * delegating to `super.onStoreChange()`. Not for consumer use.
     */
    protected onStoreChange(): void {
        this._boundIndices.fill(-1);
        this.renderWindow();
    }

    /**
     * Returns the records visible in the current scroll window. Default
     * behaviour delegates to the store's view (filtered + sorted master
     * collection), further filtered through {@link setRowVisible}'s
     * predicate when one is active.
     *
     * @returns The records the row pool should bind to, in display order.
     *
     * @remarks Subclassing seam — `TreeBody` overrides this to return its
     * depth-flattened, expansion-aware visible subtree, and does not
     * consult `_rowVisible` — see {@link setRowVisible}. Every internal
     * site that needs the visible records — virtual-window math, click
     * dispatch, focus + active-descendant tracking, keyboard nav,
     * scroll-into-view — goes through this method. Not for consumer use.
     */
    protected getVisibleRecords(): ModelRecord[] {
        const records = this._store.getRecords();

        return this._rowVisible ? records.filter(this._rowVisible) : records;
    }

    /**
     * Returns the model's non-hidden fields, in display order — the same
     * list every pooled `Row.setColumnFields` derives independently.
     *
     * @returns The visible fields, in display order.
     *
     * @remarks Mirrors `Row.setColumnFields`' own filter+sort, and
     * `Header.computeVisibleFields`'s identical one — not extracted to a
     * shared helper, since it is two lines needed here only once per tick
     * (not once per row) and the codebase already tolerates this exact
     * duplication between `Row` and `Header`. Read by
     * {@link computeColumnWindowSlidePlan} to resolve each entering
     * column's reuse key once per tick. Not for consumer use.
     */
    private computeVisibleFields(): Field[] {
        return this._store.model.getFields()
                   .filter(f => !this._hiddenColumns.has(f.getName()))
                   .sort((f1, f2) => f1.getOrder() - f2.getOrder());
    }

    /**
     * Constructs one pool row. Default behaviour returns a plain `Row`
     * bound to the store's model with the current hidden-column and
     * column-config maps.
     *
     * @returns A new `Row` instance.
     *
     * @remarks Subclassing seam — `TreeBody` overrides this to pass the
     * `treeFieldName` so the tree column's cell gets a
     * `TreeCellRenderer`. Not for consumer use.
     */
    protected createRow(): Row {
        return new Row(
            this._store.model,
            undefined,
            this._hiddenColumns,
            this._columnConfigs,
            (record) => this._store.notifyRecordChanged(record),
        );
    }

    /**
     * Returns the field name of the column carrying a
     * {@link TreeCellRenderer}, or `undefined` when no column is the
     * tree column. The base returns `undefined`; `TreeBody` overrides
     * to return its `_treeColumn`.
     *
     * @returns The tree column's field name, or `undefined`.
     *
     * @remarks Subclassing seam — forwarded into {@link Row.setColumnFields}
     * from {@link setHiddenColumns} / {@link setColumnConfigs} so an
     * incremental column-toggle preserves the tree renderer on the
     * surviving cell. Not for consumer use.
     */
    protected getTreeFieldName(): string | undefined {
        return undefined;
    }

    /**
     * Updates the ARIA attributes that depend on a row's current data
     * index. Default behaviour writes only `aria-rowindex` (the +2
     * accounts for the 1-based ARIA spec plus the header band).
     *
     * @param row - The pool row whose ARIA attributes to update.
     * @param dataIndex - The row's index into the visible-records list.
     *
     * @remarks Subclassing seam — `TreeBody` overrides this to additionally
     * set `aria-level`, `aria-expanded`, `aria-setsize`, and
     * `aria-posinset` from the flat record entry. Not for consumer use.
     */
    protected computeRowAria(row: Row, dataIndex: number): void {
        row.getAria().setRowIndex(dataIndex + 2);
    }

    /**
     * Hook invoked once per pool slot inside the bind loop, after the
     * row has been rebound (when needed) but before the geometry-driven
     * cell layout runs. Default behaviour is a no-op.
     *
     * @param row - The pool row being processed.
     * @param dataIndex - The row's index into the visible-records list.
     * @param wasRebound - `true` when the row was just rebound to a new
     *   record on this pass; `false` for a pure scroll where the slot's
     *   data index is unchanged.
     *
     * @remarks Subclassing seam — `TreeBody` overrides this to push
     * depth + expansion state through {@link TreeCellRenderer.setTreeState}
     * on the row's tree cell. Not for consumer use.
     */
    protected afterRowBound(_row: Row, _dataIndex: number, _wasRebound: boolean): void {
        // Default implementation is a no-op; subclasses provide behaviour.
    }

    /**
     * Resets every pool slot's data-index cache so the next render pass
     * forces a full rebind. Use after the visible-records list has
     * changed shape (sort, expand/collapse, etc.) but the store itself
     * hasn't fired one of the events {@link bindStore} subscribes to.
     *
     * @remarks Subclassing seam — `TreeBody` calls this from
     * {@link TreeBody.setExpanded} before triggering a re-render.
     * Not for consumer use.
     */
    protected invalidateRowBindings(): void {
        this._boundIndices.fill(-1);
    }

    /**
     * Returns the data store this body is bound to.
     *
     * @returns The current {@link AbstractStore}.
     *
     * @remarks Exposed at protected scope for subclasses (e.g. `TreeBody`)
     * that need to read model fields when reconstructing pool rows or
     * walking records to rebuild a depth index.
     */
    protected getStore(): AbstractStore {
        return this._store;
    }

    /**
     * Returns the set of column field names currently hidden from
     * render.
     *
     * @returns The hidden-column set (do not mutate).
     *
     * @remarks Exposed at protected scope so subclasses can pass the
     * same set into custom pool-row construction.
     */
    protected getHiddenColumns(): Set<string> {
        return this._hiddenColumns;
    }

    /**
     * Returns the column-config map keyed by field name.
     *
     * @returns The column-config map (do not mutate).
     *
     * @remarks Exposed at protected scope so subclasses can pass the
     * same map into custom pool-row construction.
     */
    protected getColumnConfigs(): Map<string, ColumnConfig> {
        return this._columnConfigs;
    }

    /**
     * Returns the row pool used by the virtual scroll. Each entry is a
     * `Row` whose `data` may be bound to a record or `undefined` when
     * the slot is hidden.
     *
     * @returns The row-pool array (do not mutate the array; mutating
     *   individual rows is the caller's responsibility).
     *
     * @remarks Exposed at protected scope so subclasses can walk the
     * pool — e.g. `TreeBody` does this from its `onSubtreeClick`
     * override to find the row whose tree-cell toggle was clicked.
     */
    protected getRowPool(): Row[] {
        return this._rowPool;
    }

    /**
     * Updates the set of hidden column field names, records the new
     * visible-field list on every pooled row, and re-renders.
     *
     * Field names belonging to {@link Column.isUnhideable} columns are stripped
     * from the set so a direct caller cannot bypass the unhideable contract.
     *
     * @param hidden - The new set of field names to hide.
     *
     * @remarks The previous implementation dropped the entire row pool
     * and rebuilt it via `growRowPool`. Recording the fields instead
     * builds and removes nothing here: each row reconciles its own cell
     * set on the following render, matching every column that survives
     * by field name so its renderer, editor, theme listener, sort state
     * and group tint are preserved.
     */
    setHiddenColumns(hidden: Set<string>): this {
        this._hiddenColumns = this.filterUnhideable(hidden);
        this.syncPoolCells();
        this.renderWindow();

        return this;
    }

    /**
     * Strips field names belonging to {@link Column.isUnhideable} columns
     * from `hidden`, returned as a new `Set`. Extracted from
     * {@link setHiddenColumns} so {@link bindViewState} can apply the same
     * unhideable-column guard.
     *
     * @param hidden - The candidate set of field names to hide.
     * @returns A new set with unhideable columns' field names removed.
     */
    private filterUnhideable(hidden: Set<string>): Set<string> {
        const filtered = new Set<string>();

        for (const name of hidden) {
            const col = this._columns.find(c => c.getField().getName() === name);

            if (!col || !col.isUnhideable()) {
                filtered.add(name);
            }
        }

        return filtered;
    }

    /**
     * Supplies the resolved {@link Column} list so the body can read per-column
     * metadata (e.g. `isUnhideable()`) when filtering hidden-column sets.
     *
     * @param columns - The resolved columns in display order.
     *
     * @returns This body, for method chaining.
     */
    setColumns(columns: Column[]): this {
        this._columns = columns;
        this.syncPoolCells();
        this.renderWindow();

        return this;
    }

    /**
     * Sets the table-wide row-level read-only predicate forwarded from
     * {@link ColumnSpec.rowReadOnly}. Cleared by passing `null`.
     *
     * @param predicate - Returns `true` to mark every cell in the
     *   record's row read-only. Called on every rebind; must be O(1)
     *   and pure.
     * @returns This body, for method chaining.
     *
     * @remarks Internal wiring called by {@link Table} — not for
     * consumer use. Consumers declare the predicate in the spec.
     */
    setRowReadOnly(predicate: ((record: ModelRecord) => boolean) | null): this {
        this._rowReadOnly = predicate;

        return this;
    }

    /**
     * Sets the predicate that marks a record as a group-separator row for
     * rotated mode. Cleared by passing `null`. Unlike {@link setRowVisible},
     * this setter forces no render of its own.
     *
     * @param predicate - Returns the separator's label/color for a
     *   separator record, or `null` for an ordinary field/value record.
     *   Called on every rebind; must be O(1) and pure.
     * @returns This body, for method chaining.
     *
     * @remarks Not for consumer use. `Table`'s internal view-binding step
     * writes this predicate directly via {@link bindViewState} rather than
     * calling this setter, so it currently has no production caller; kept
     * as a standalone setter for symmetry with {@link setRowReadOnly} /
     * {@link setRowVisible} / {@link setRowIndented}.
     */
    setRowSeparator(predicate: ((record: ModelRecord) => { label: string, color: string | null } | null) | null): this {
        this._rowSeparator = predicate;

        return this;
    }

    /**
     * Sets the predicate that marks a record as a rotated-mode group
     * member. Cleared by passing `null`. Mirrors {@link setRowSeparator}'s
     * shape and, like it, forces no render of its own.
     *
     * @param predicate - Returns `true` when the record's `field`-name cell
     *   should render indented (see {@link Row.setFieldIndent}). Called on
     *   every rebind; must be O(1) and pure.
     * @returns This body, for method chaining.
     *
     * @remarks Not for consumer use. `Table`'s internal view-binding step
     * writes this predicate directly via {@link bindViewState} rather than
     * calling this setter, so it currently has no production caller; kept
     * as a standalone setter for symmetry with {@link setRowReadOnly} /
     * {@link setRowVisible} / {@link setRowSeparator}.
     */
    setRowIndented(predicate: ((record: ModelRecord) => boolean) | null): this {
        this._rowIndented = predicate;

        return this;
    }

    /**
     * Sets a live predicate that hides non-matching rows without touching
     * the store — the display-only filter behind {@link Table.setRowVisible}.
     * Cleared by passing `null`.
     *
     * @param predicate - Returns `true` to keep the record's row rendered.
     *   Called for every loaded record on every render pass; must be O(1)
     *   and pure, the same contract {@link ColumnSpec.rowReadOnly} follows.
     * @returns This body, for method chaining.
     *
     * @remarks Internal wiring called by {@link Table} — not for consumer
     * use; consumers call {@link Table.setRowVisible}. Unlike
     * {@link setRowReadOnly}, changing the predicate can shrink or grow the
     * visible-records list itself, so a pool slot's cached data index can no
     * longer be trusted to still name the same record — invalidating the
     * bindings and forcing a render is required, not optional. Has no
     * effect on `TreeBody`, whose depth-flattened visible-records override
     * never consults `_rowVisible` — see the `TreeTable` docs non-goal.
     */
    setRowVisible(predicate: ((record: ModelRecord) => boolean) | null): this {
        this._rowVisible = predicate;
        this.invalidateRowBindings();
        this.renderWindow();

        return this;
    }

    /**
     * Updates the per-field column-config map and re-syncs each pooled
     * row's cells in place so any field-type-driven cell options
     * (e.g. `showSeconds`) and group tints take effect immediately.
     *
     * @param configs - The new column-config map keyed by field name.
     */
    setColumnConfigs(configs: Map<string, ColumnConfig>): this {
        this._columnConfigs = configs;
        this.registerComboEditors(configs);
        this.syncPoolCells();
        this.renderWindow();

        return this;
    }

    /**
     * Registers a per-column [`ComboEditor`](/api/component/table/classes/ComboEditor)
     * factory on the editor pool for every column declaring `values`, plus
     * every column declaring `cellValues` (a per-record `DynamicCell` combo
     * column). The factory closes over that column's resolved option set —
     * an empty seed for `cellValues` columns, since the real per-row options
     * are injected at edit time by `DynamicCell.prepareEditor` — so each
     * combo column borrows an editor wired to its own choices under the
     * `combo:<field>` key returned by
     * [`ComboCell.getEditorKey`](/api/component/table/classes/ComboCell#geteditorkey)
     * or `DynamicCell.getEditorKey`.
     *
     * `register` overwrites and drops any cached editor, so re-applying
     * configs with new options rebuilds the editor on the next edit.
     *
     * @param configs - The column-config map keyed by field name.
     */
    private registerComboEditors(configs: Map<string, ColumnConfig>): void {
        for (const [field, config] of configs) {
            const values = config.values;

            if (values && values.length > 0) {
                this._editorPool.register(`combo:${field}`, () => new ComboEditor(values));
            } else if (config.cellValues) {
                this._editorPool.register(`combo:${field}`, () => new ComboEditor([]));
            }
        }
    }

    /**
     * Commits every open edit (the whole rendered cell set is about to be
     * discarded, so `keep` is `null`), then walks every pool row and records
     * the new `_hiddenColumns` + `_columnConfigs` it should render from.
     * Builds no cells itself — marking a row's column fields dirty makes its
     * next {@link Row.setColumnWindow} (from {@link bindAndPositionRows}, on
     * the next `renderWindow`) reconcile the cell set against the new column
     * list, exactly as it does for a scroll-driven window slide. Also clears
     * the row-geometry cache so render re-positions each row against the new
     * column count.
     *
     * Guarded by `_reconciling`, mirroring `renderWindow`: the commit pass
     * can cascade back into this method through `store.notifyRecordChanged`.
     */
    private syncPoolCells(): void {
        if (this._reconciling) {
            return;
        }

        this._reconciling = true;

        try {
            this.commitEditsOutsideWindow(null);

            const treeFieldName = this.getTreeFieldName();

            for (let i = 0; i < this._rowPool.length; i++) {
                const row = this._rowPool[i];

                row.setColumnFields(
                    this._store.model,
                    this._hiddenColumns,
                    this._columnConfigs,
                    treeFieldName,
                );

                this.wireRowCells(row);

                // The row's column count changed, so its own width may have.
                // A cell's committed rect lives on the cell itself, so it
                // stays valid across the re-point `setColumnWindow` performs
                // next — a cell moved onto a column at the same x and width
                // genuinely needs no reposition. What it may need is a
                // layout, when the new column changes something the layout
                // fits around; the writes that do that lay the cell out
                // themselves.
                this._rowGeom[i] = null;
            }
        } finally {
            this._reconciling = false;
        }
    }

    /**
     * Swaps the store, unsubscribing from the old one and rebinding to the new one.
     *
     * @param store - The new store to bind to the body.
     */
    setStore(store: AbstractStore): this {
        this.rebindStore(store);

        if (this.getElement()) {
            // Route through `onStoreChange` so subclasses (e.g. `TreeBody`)
            // can rebuild their per-row index against the new store before
            // the inherited rebind + render runs. The base implementation
            // is equivalent to the previous `_boundIndices.fill(-1) +
            // renderWindow()` inline pair.
            this.onStoreChange();
        }

        return this;
    }

    /**
     * Unsubscribes from the outgoing store's refresh listeners, assigns and
     * subscribes to the new store, and invalidates the geometry caches.
     * Extracted from {@link setStore} so {@link bindViewState} can rebind the
     * store without triggering the render `setStore` triggers on its own —
     * `bindViewState` runs its own render once, after every field is written.
     *
     * @param store - The new store to bind to the body.
     */
    private rebindStore(store: AbstractStore): void {
        this.unbindStore(this._store);

        this._store = store;
        this.bindStore(store);
        this.invalidateGeom();
    }

    /**
     * Unsubscribes the callbacks installed by {@link bindStore} from `store`.
     * Extracted from {@link rebindStore} so {@link destructor} can call the
     * same unbind on teardown — `store` is owned by the caller, not this
     * body, and can outlive it, so an un-unsubscribed listener would pin
     * this body in the store's own `ListenerBag` for as long as the store
     * itself lives.
     *
     * @param store - The store to unsubscribe from.
     */
    private unbindStore(store: AbstractStore): void {
        if (!this._storeRefresh) {
            return;
        }

        (['load', 'add', 'remove', 'datachange', 'beforesync', 'sync'] as const).forEach(e =>
            store.off(e, this._storeRefresh!)
        );
    }

    /**
     * Re-binds every field a `Table` display-mode switch pushes into the
     * body — store, columns, column configs, hidden-column set and the four
     * row predicates — writing them all before reconciling the pool and
     * rendering once, instead of the eight separate setter calls that would
     * otherwise each sync and render on their own.
     *
     * @param state - The complete view state to bind.
     * @returns This body, for method chaining.
     *
     * @remarks Internal wiring called by {@link Table} — not for consumer
     * use. `state.columns` is assigned before the hidden-column set is
     * filtered, matching the order the individual setters run in today.
     */
    bindViewState(state: BodyViewState): this {
        this.rebindStore(state.store);

        this._columns       = state.columns;
        this._columnConfigs = state.columnConfigs;
        this._hiddenColumns = this.filterUnhideable(state.hiddenColumns);
        this._rowReadOnly   = state.rowReadOnly;
        this._rowVisible    = state.rowVisible;
        this._rowSeparator  = state.rowSeparator;
        this._rowIndented   = state.rowIndented;

        this.registerComboEditors(state.columnConfigs);
        this.syncPoolCells();
        this.invalidateRowBindings();

        if (this.getElement()) {
            this.onStoreChange();
        }

        return this;
    }

    /**
     * Initializes the body element, constructs the `VirtualScroller`, and
     * wires keyboard and focus listeners.
     *
     * @param element - Optional. The element handle to initialize with; falls back to `getElement()`.
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        this.initScroller(el);

        Event.addListener(this, "focus", this.onFocus);
        Event.addListener(this, "keydown", this.onKeyDown);

        // One subtree click listener replaces the per-row listener that
        // growRowPool used to install. Walk up from the event target to find
        // the matching pool row; identical complexity per click, one window
        // registration regardless of pool size. Routed through
        // `onSubtreeClick` so subclasses (e.g. `TreeBody`) can intercept
        // clicks on subtree-owned widgets like the expand/collapse toggle.
        Event.addSubtreeListener(this, "click", this.onSubtreeClick);

        // Drives the cell-range-selection drag gesture (mousedown arms the
        // move/up viewport listeners — see `onCellMouseDown`; the selectstart
        // suppressor arms only once the drag widens past its origin cell) and
        // the right-click "Copy" menu target resolution.
        Event.addSubtreeListener(this, "mousedown",   this.onCellMouseDown);
        Event.addSubtreeListener(this, "contextmenu", this.onCellContextMenu);

        this.renderWindow();

        return this;
    }

    /**
     * On every scroller tick, re-renders the window and then emits the
     * unconditional scroll events consumers mirror (the header translate and
     * the pinned-side body). Overrides the base default, which only re-renders.
     */
    protected onScrollerTick(): void {
        this.renderWindow();

        // A pass the startup font gate deferred rendered no rows, so the
        // mirrors these events drive — the header translate and the pinned-side
        // body — would be moved to an offset nothing was laid out at.
        if (this.wasRenderDeferred()) {
            return;
        }

        if (this._scroller) {
            this.emit("verticalscroll",   this._scroller.getScrollY());
            this.emit("horizontalscroll", this._scroller.getScrollX());
        }
    }

    /** Refreshes the active-descendant pointer and focus ring when the body gains focus. */
    private onFocus(): void {
        this._updateActiveDescendant();
        this._updateFocusStyle();
    }

    /**
     * Returns the shared editor pool that backs in-place editing for every cell in this body.
     *
     * @returns The {@link CellEditorPool} owned by this body.
     *
     * @remarks Use this to register a custom editor factory for a cell-specific key. Built-in
     * factories for the seven standard typed cells are seeded automatically.
     */
    getEditorPool(): CellEditorPool {
        return this._editorPool;
    }

    /**
     * Unsubscribes from the store (see {@link bindStore}), disposes the
     * shared cell-editor pool, then runs the inherited teardown (which
     * disposes the row pool and the scroller — see
     * VirtualRowView.destructor()). `_editorPool`'s cached editors are held in
     * a private Map, never a registered child of this body, so the base
     * destructor's recursion cannot reach them.
     */
    protected destructor(): void {
        this.unbindStore(this._store);
        this._editorPool.dispose();
        this._cellText.dispose();

        super.destructor();
    }

    /**
     * Runs a render pass the startup font gate deferred, once a layout reaches
     * this body again.
     *
     * @returns This body, for method chaining.
     *
     * @remarks Unlike `Tree`, this body does not render its window on every
     * layout — its passes come from the parent table layout and from store
     * events. The parent layout usually gets there first, calling
     * `renderWindow` directly with the column widths, which resumes the pass on
     * its own; this override covers the case where it does not, so a body whose
     * table is already clean still picks its deferred pass back up.
     */
    doLayout(): this {
        super.doLayout();
        this.renderWindowIfDeferred();

        return this;
    }

    /**
     * Recomputes the visible row window, rebinds changed rows from the pool, and hides excess rows.
     *
     * @param bodyWidth - Optional. The total body width in pixels; cached and reused on scroll updates.
     * @param columnWidths - Optional. The per-column widths in pixels; derived from bodyWidth when omitted.
     */
    renderWindow(bodyWidth?: number, columnWidths?: number[]) {
        // Cache the caller's widths before anything can return early. They come
        // from the parent layout and from nowhere else, so a pass the startup
        // font gate defers below would otherwise replay against the zero-width
        // cache this view starts with. This also means an unmounted body now
        // records widths (and may invalidate its row geometry) where it used to
        // return untouched — harmless, since its pool is empty.
        this.updateColumnWidthCache(bodyWidth, columnWidths);

        // A commit fired mid-render (see `commitEditsOutsideWindow`) cascades
        // back into this method through `store.notifyRecordChanged`; the
        // nested call is dropped rather than queued, both guarded methods
        // commit before they read the state they render from, so the next
        // (outer) pass sees the up-to-date result. Above the two early
        // returns below so a nested call still caches any widths it carries
        // (`updateColumnWidthCache` already ran) — only the render itself is
        // dropped.
        if (this._reconciling) {
            return;
        }

        const element = this.getElement();
        if (!element || !this._scroller) {
            return;
        }

        if (this.deferRenderWhileFirstLayoutHeld()) {
            return;
        }

        this._reconciling = true;

        try {
            this.renderWindowPass();
        } finally {
            this._reconciling = false;
        }

        // Applies any scroll offset the startup font gate held back. Unlike
        // `Tree` there is no post-render work to redo alongside it: every caller
        // that refreshes this body's active descendant is a user gesture —
        // focus, click, key — and none of those can land inside the startup
        // hold, before a single row exists. Outside the guard above: applying a
        // held offset re-enters `renderWindow` through the scroller's onScroll
        // hook, and that nested pass has to run.
        this.finishResumedRender();
    }

    /**
     * Derives this tick's slide plan from the previous and new column
     * windows, or undefined when this tick isn't an ordinary same-width
     * overlapping slide (see the eligibility table in the plan's
     * Architecture Decisions).
     *
     * @param prev - The column window from the previous render tick.
     * @param next - The column window this tick just computed.
     *
     * @returns The slide plan, or undefined when this tick takes the full path.
     */
    private computeColumnWindowSlidePlan(prev: ColumnWindow, next: ColumnWindow): ColumnWindowSlidePlan | undefined {
        if (prev.lastCol === -1 || next.lastCol === -1) {
            return undefined;
        }

        const prevWidth = prev.lastCol - prev.firstCol + 1;
        const nextWidth = next.lastCol - next.firstCol + 1;

        if (prevWidth !== nextWidth) {
            return undefined;
        }

        const delta = next.firstCol - prev.firstCol;

        if (delta === 0 || Math.abs(delta) >= nextWidth) {
            return undefined;
        }

        const visibleFields = this.computeVisibleFields();
        const treeFieldName = this.getTreeFieldName();
        const enteringKeys  = new Map<number, string>();
        const enteringRange = delta > 0
            ? Util.range(next.lastCol - delta + 1, next.lastCol)
            : Util.range(next.firstCol, next.firstCol - delta - 1);

        for (const col of enteringRange) {
            const field = visibleFields[col];

            if (!field) {
                return undefined;   // defensive; should not happen given effectiveWidths sizing
            }

            const config = this._columnConfigs.get(field.getName());

            enteringKeys.set(col, Row.cellKey(field, config, field.getName() === treeFieldName));
        }

        return { prevFirstCol: prev.firstCol, prevLastCol: prev.lastCol, delta, enteringKeys };
    }

    /**
     * The body of `renderWindow`, below its early returns — recomputes the
     * row AND column windows, rebinds changed rows from the pool, and hides
     * excess rows. Split out so the public `renderWindow` can wrap it in the
     * `_reconciling` re-entrancy guard.
     */
    private renderWindowPass(): void {
        const scroller = this._scroller!;
        let records   = this.getVisibleRecords();
        let totalRows = records.length;

        // Capture scroll positions before clampToContent / layoutScrollbars
        // (called below) potentially shrink them in place. Those calls don't
        // go through setScrollX/Y, so the VirtualScroller's onScroll hook
        // never fires — without an explicit notification here the header's
        // horizontal translate would stay stuck at the pre-clamp value when
        // a widen-to-fit layout drops scrollX back toward 0.
        const prevScrollX = scroller.getScrollX();
        const prevScrollY = scroller.getScrollY();

        // Loose-clamp scroll positions against the new content sizes before
        // reading them for the window calc.
        let totalHeight         = totalRows * this._rowHeight;
        const totalColumnWidth  = this._lastColumnWidths.reduce((s, w) => s + w, 0);
        const totalContentWidth = Math.max(this._lastBodyWidth, totalColumnWidth);

        scroller.clampToContent(totalContentWidth, totalHeight);

        const rowWidth   = Math.max(this._lastBodyWidth, totalColumnWidth);
        const fieldCount = this.computeVisibleFields().length;
        const fallback   = fieldCount > 0 ? rowWidth / fieldCount : rowWidth;
        const effectiveWidths = Array.from({ length: fieldCount }, (_, i) => this._lastColumnWidths[i] ?? fallback);

        const prevColWindow = this._colWindow;

        this._colWindow = computeColumnWindow(effectiveWidths, scroller.getScrollX(), this.getWidth() || 0);

        const slidePlan = this.computeColumnWindowSlidePlan(prevColWindow, this._colWindow);

        // An edit whose column is about to leave the window is committed
        // before any pool row is rebound — mirrors the precedent
        // `Row.setColumnWindow` sets for a column-set change: commit before
        // discarding the cell that holds it. A commit can change what a
        // filtered/sorted store returns, so the row count is re-read.
        if (this.commitEditsOutsideWindow(this._colWindow)) {
            records   = this.getVisibleRecords();
            totalRows = records.length;
            totalHeight = totalRows * this._rowHeight;
        }

        const visibleHeight = this.getHeight() || 0;
        const win = this.computeVisibleWindow(scroller.getScrollY(), visibleHeight, totalRows);

        const poolTarget = this.computePoolTarget(win.windowSize, visibleHeight, totalRows);
        this.growRowPool(poolTarget);

        this.bindAndPositionRows(win.firstRow, win.windowSize, rowWidth, records, this._colWindow, slidePlan);
        this.hideExcessPoolRows(win.windowSize);

        if (totalRows !== this._lastAriaRowCount) {
            this.getAria().setRowCount(totalRows);
            this._lastAriaRowCount = totalRows;
        }

        scroller.layoutScrollbars(totalContentWidth, totalHeight);

        const newScrollX = scroller.getScrollX();
        const newScrollY = scroller.getScrollY();
        if (newScrollX !== prevScrollX) {
            this.emit("horizontalscroll", newScrollX);
        }
        if (newScrollY !== prevScrollY) {
            this.emit("verticalscroll", newScrollY);
        }

        this._updateFocusStyle();
    }

    /**
     * Caches incoming bodyWidth / columnWidths from a layout-driven call and
     * invalidates the per-row geometry cache when either changes.
     *
     * @param bodyWidth - The new body width in pixels, or undefined to leave the cache untouched.
     * @param columnWidths - The new per-column widths in pixels.
     */
    private updateColumnWidthCache(bodyWidth?: number, columnWidths?: number[]): void {
        if (bodyWidth === undefined) {
            return;
        }

        const widthsChanged = this._lastBodyWidth !== bodyWidth
            || !columnWidthsEqual(this._lastColumnWidths, columnWidths);

        this._lastBodyWidth = bodyWidth;
        this._lastColumnWidths = columnWidths ?? [];

        if (widthsChanged) {
            this.invalidateGeom();
        }
    }

    /**
     * Commits every open edit whose rendered column falls outside `keep`,
     * ahead of a column-window change that is about to discard the cell
     * holding it — mirrors the precedent {@link Row.setColumnWindow} sets on
     * a column-set change: commit before discarding. Guarded by the same
     * `_reconciling` flag `renderWindow` sets: `Cell.commitEdit` emits
     * `"commit"` while the cell still reports `isEditing()`, and that emit
     * cascades through `store.notifyRecordChanged` back into `renderWindow`.
     *
     * @param keep - The column window to preserve; every rendered slot
     *   outside it is a candidate. `null` treats every rendered slot as
     *   outside — used by {@link syncPoolCells}, which is about to discard
     *   the whole cell set for a hide/show or config swap.
     *
     * @returns `true` when at least one open edit was committed.
     */
    private commitEditsOutsideWindow(keep: ColumnWindow | null): boolean {
        let committed = false;

        for (const row of this._rowPool) {
            const cells = row.getComponents() as Cell<any>[];
            const start = row.getColumnWindowStart();

            for (let slot = 0; slot < cells.length; slot++) {
                const colIndex = start + slot;
                const outside  = keep === null || colIndex < keep.firstCol || colIndex > keep.lastCol;

                if (outside && cells[slot].isEditing()) {
                    cells[slot].commitEdit();
                    committed = true;
                }
            }
        }

        return committed;
    }

    /**
     * Binds visible pool slots to their data records and positions each row +
     * its cells. Skips data rebind when the slot's bound index hasn't changed;
     * skips geometry writes when the row geometry hasn't changed; skips cell
     * layout when the cell geometry hasn't changed.
     *
     * @param firstRow - The first data index covered by the visible window.
     * @param windowSize - The number of rows in the window.
     * @param rowWidth - The horizontal extent of each row in pixels.
     * @param records - The current store records (passed in so this helper doesn't re-query).
     * @param columns - The column window: the rendered `[firstCol, lastCol]`
     *   range plus the widths/lefts every rendered cell is placed from.
     * @param slidePlan - Optional. This tick's slide plan from
     *   {@link computeColumnWindowSlidePlan}, present only for an ordinary
     *   same-width horizontal slide; forwarded to each row's
     *   `setColumnWindow` so it can opt into the fast path.
     *
     * @remarks `protected` so subclasses (e.g. `TreeBody`) can wrap the
     * standard bind + position pass with their own post-bind work
     * (depth / toggle updates). Not for consumer use.
     */
    protected bindAndPositionRows(
        firstRow: number, windowSize: number, rowWidth: number, records: ModelRecord[],
        columns: ColumnWindow, slidePlan?: ColumnWindowSlidePlan,
    ): void {
        const rowHeight = this._rowHeight;

        this.alignPoolWindow(firstRow);

        const rangeBounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus, records);

        for (let i = 0; i < windowSize; i++) {
            const row       = this._rowPool[i];
            const dataIndex = firstRow + i;
            const separator = this._rowSeparator?.(records[dataIndex]) ?? null;

            if (separator) {
                const wasRebound = this._boundIndices[i] !== dataIndex;

                if (wasRebound || !row.isSeparator()) {
                    row.renderSeparator(separator.label, separator.color);
                    this._boundIndices[i] = dataIndex;
                    this.computeRowAria(row, dataIndex);
                }

                this.positionRow(i, dataIndex * rowHeight, rowWidth);
                row.getComponents()[0].applyBounds(0, 0, rowWidth, rowHeight);

                continue;
            }

            const windowChanged = row.setColumnWindow(columns.firstCol, columns.lastCol, slidePlan);
            const retargeted    = windowChanged ? row.getRetargetedCells() : undefined;

            if (windowChanged) {
                // Slot → column mapping changed, so newly-entered cells need
                // the editor pool + scroll-into-view handler wired. A cell's
                // committed rect lives on the cell itself, so a cell that
                // kept its column stays correctly positioned even though its
                // slot moved. Scoped to just the retargeted cells — correct
                // under either reconciliation path, since "retargeted" means
                // the same thing regardless of which one produced it.
                this.wireRowCells(row, retargeted!.map(r => r.cell));
            }

            const wasRebound = this._boundIndices[i] !== dataIndex;

            if (wasRebound) {
                row.setData(records[dataIndex]);

                this._boundIndices[i] = dataIndex;
                row.setStripe(dataIndex % 2 === 1);   // odd logical rows carry the zebra stripe; set before the paint below
                this.updateRowVisualState(i, records);
                this.computeRowAria(row, dataIndex);
            }

            if (wasRebound) {
                this.applyReadOnlyState(row, records[dataIndex]);          // full row — the record changed
                row.setFieldIndent(this._rowIndented?.(records[dataIndex]) ?? false);
            } else if (windowChanged) {
                this.applyReadOnlyState(row, records[dataIndex], retargeted);   // scoped
                row.setFieldIndent(this._rowIndented?.(records[dataIndex]) ?? false);
            }

            if (wasRebound || windowChanged) {
                this.updateCellRangeVisualState(i, records, rangeBounds);
            }

            this.afterRowBound(row, dataIndex, wasRebound);

            this.applyRequiredEmptyState(row, records[dataIndex]);

            this.positionRow(i, dataIndex * rowHeight, rowWidth);

            const cells = row.getComponents();
            let   x     = columns.lefts[columns.firstCol] ?? 0;

            for (let slot = 0; slot < cells.length; slot++) {
                const colW = columns.widths[columns.firstCol + slot] ?? 0;

                cells[slot].applyBounds(x, 0, colW, rowHeight);

                x += colW;
            }
        }
    }

    /**
     * Default subtree-click handler — walks up from the event target to
     * find the pool row that owns the click, then dispatches to
     * {@link onRowClick}. Subclasses (e.g. `TreeBody`) override this to
     * intercept clicks on subtree-owned widgets such as the
     * expand/collapse toggle.
     *
     * @param e - The bubbled click event.
     *
     * @remarks Subclassing seam — not for consumer use.
     */
    protected onSubtreeClick(e: MouseEvent): void {
        // Filter synthetic "click" events. `Checkbox.setSelected` dispatches
        // a `CustomEvent("click")` on its root for backward-compat with
        // `on("action", fn)` consumers; during a scroll rebind, the Active
        // column's cell receives a programmatic `setValue` for every pool
        // slot, so a flurry of synthetic clicks bubbles up here and would
        // each fire `onRowClick` — selecting whichever record happens to be
        // bound to that slot at the moment, effectively dragging the
        // selection downward with the scroll.
        if (!(e instanceof MouseEvent)) {
            return;
        }

        let node: Handle | null = e.target === null ? null : DOM.source.intern(e.target);

        while (node) {
            const row = this._rowPool.find(r => r.getElement() === node);

            if (row) {
                this.onRowClick(row, e);
                return;
            }

            node = DOM.source.getParentElement(node);
        }
    }

    /**
     * Handles a row click, updating selection with support for ctrl/cmd and shift modifiers.
     *
     * @param row - The pool row that was clicked.
     * @param e - The mouse event.
     */
    private onRowClick(row: Row, e: MouseEvent): void {
        if (row.isSeparator()) {
            return;
        }

        const record = row.getData() ?? null;
        if (!record) return;

        const records = this.getVisibleRecords();
        const before  = new Set(this._selectedRecords);

        this._anchorRecord = reduceModifierSelection(
            this._selectedRecords,
            this._anchorRecord,
            record,
            r => records.indexOf(r),
            i => records[i],
            { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey },
        );

        this._boundIndices.forEach((dataIdx, i) => {
            if (dataIdx !== -1) this.updateRowVisualState(i, records);
        });

        this.notifySelectionChange(before);

        // Determine which column was clicked and update focused cell.
        // `resolveClickedColumn` scans the rendered cells and so returns a
        // slot, not a column index — convert by adding the window start so
        // `_focusedColIndex` and the "cellclick" payload stay in
        // visible-column order regardless of what the row currently renders.
        const targetHandle = e.target === null ? null : DOM.source.intern(e.target);
        const cells        = row.getComponents();
        const slot         = resolveClickedColumn(cells, targetHandle);
        const columnIndex  = slot >= 0 ? slot + row.getColumnWindowStart() : -1;

        if (columnIndex >= 0) {
            this._focusedColIndex = columnIndex;
        }

        // Don't steal focus from an active cell editor (e.g. <input type="date">).
        const targetTag = targetHandle === null ? "" : DOM.source.getTagName(targetHandle);
        if (targetTag !== 'INPUT' && targetTag !== 'TEXTAREA' && targetTag !== 'SELECT') {
            this.focus();
        }

        this._updateFocusStyle();
        this._updateActiveDescendant();

        // Fire the column-aware cell-click event last, after selection and
        // focus have settled, so it is purely additive. Skip clicks that land
        // inside the row but outside any cell (should not happen for a <td>
        // grid, but keeps the emit total).
        if (columnIndex >= 0) {
            const field = row.getFieldNames()[slot];

            this.emit("cellclick", {
                record,
                field,
                columnIndex,
                value:    record.get(field),
                rowIndex: records.indexOf(record),
                event:    e,
            });
        }
    }

    /**
     * Walks up from `target` to the pool row that owns it, mirroring
     * {@link onSubtreeClick}'s own walk, then resolves the column.
     *
     * @param target - The interned event-target handle, or null.
     *
     * @returns The located row/cell/record/column, or `null` off a
     *   separator row, a hidden row, or a target outside every cell.
     */
    private locateCellFromTarget(target: Handle | null): { row: Row, cell: Cell<any>, record: ModelRecord, col: number } | null {
        let node = target;

        while (node) {
            const row = this._rowPool.find(r => r.getElement() === node);

            if (row) {
                if (row.isSeparator()) {
                    return null;
                }

                const record = row.getData();
                if (!record) {
                    return null;
                }

                const cells = row.getComponents() as Cell<any>[];
                const slot  = resolveClickedColumn(cells, target);
                if (slot < 0) {
                    return null;
                }

                return { row, cell: cells[slot], record, col: slot + row.getColumnWindowStart() };
            }

            node = DOM.source.getParentElement(node);
        }

        return null;
    }

    /**
     * Resolves `anchor`/`focus` into inclusive row/column bounds,
     * re-deriving each endpoint's row position live from
     * {@link getVisibleRecords} — the same identity-vs-DOM-position
     * tolerance `_anchorRecord` already relies on for row selection.
     *
     * @param anchor - The range's fixed corner, or `null` when no range is active.
     * @param focus - The range's moving corner, or `null` when no range is active.
     * @param records - The visible records to resolve each endpoint's row
     *   position against. Defaults to a live query for the cold callers
     *   (clipboard copy, context-menu copy) that don't already hold one.
     *
     * @returns The inclusive row/column bounds, or `null` when either
     *   endpoint is missing or its record is no longer visible.
     */
    private getCellRangeBounds(
        anchor: { record: ModelRecord, col: number } | null,
        focus:  { record: ModelRecord, col: number } | null,
        records: ModelRecord[] = this.getVisibleRecords(),
    ): CellRangeBounds | null {
        if (!anchor || !focus) {
            return null;
        }

        const anchorRow = records.indexOf(anchor.record);
        const focusRow  = records.indexOf(focus.record);

        if (anchorRow === -1 || focusRow === -1) {   // record removed/filtered since selection
            return null;
        }

        return {
            minRow: Math.min(anchorRow, focusRow), maxRow: Math.max(anchorRow, focusRow),
            minCol: Math.min(anchor.col, focus.col), maxCol: Math.max(anchor.col, focus.col),
        };
    }

    /**
     * Reports whether `cell` falls inside `bounds`, re-deriving its row
     * position live from {@link getVisibleRecords}.
     *
     * @param cell - The candidate record/column pair.
     * @param bounds - The bounds to test against, or `null`.
     *
     * @returns `true` when `cell` is inside `bounds`.
     */
    private isCellWithinBounds(cell: { record: ModelRecord, col: number }, bounds: CellRangeBounds | null): boolean {
        if (!bounds) {
            return false;
        }

        const row = this.getVisibleRecords().indexOf(cell.record);

        return row >= bounds.minRow && row <= bounds.maxRow && cell.col >= bounds.minCol && cell.col <= bounds.maxCol;
    }

    /**
     * Repaints every currently-bound pool row's cell-range highlight against
     * the current `_rangeAnchor`/`_rangeFocus`. Called after every gesture
     * that can change the range — a mousedown, and a mousemove whose
     * resolved cell actually changed — and nowhere else; a right-click never
     * calls this, since it does not mutate the persistent range.
     *
     * @param records - The current visible records, passed in so this
     *   helper doesn't re-query.
     */
    private refreshCellRangeHighlight(records: ModelRecord[]): void {
        const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus, records);

        this._boundIndices.forEach((dataIdx, i) => {
            if (dataIdx !== -1) { this.updateCellRangeVisualState(i, records, bounds); }
        });
    }

    /**
     * Applies the cell-range-selection highlight to every cell in the pool
     * row at index `i`, per the current `_rangeAnchor`/`_rangeFocus`. Mirrors
     * {@link updateRowVisualState}'s two call sites exactly: a full sweep
     * from {@link refreshCellRangeHighlight} after a range-changing gesture,
     * and a per-row call from {@link bindAndPositionRows} gated on
     * `wasRebound || windowChanged`, so a cell scrolled into view picks up
     * correct highlight state without a full sweep on every scroll tick.
     *
     * @param i - The zero-based index into the row pool.
     * @param records - The current visible records, passed in so this
     *   helper doesn't re-query.
     * @param bounds - The current cell-range bounds, or `null` when no
     *   range is active.
     */
    private updateCellRangeVisualState(i: number, records: ModelRecord[], bounds: CellRangeBounds | null): void {
        const row = this._rowPool[i];
        if (row.isSeparator()) {
            return;
        }

        const dataIdx = this._boundIndices[i];
        if (!records[dataIdx]) {
            return;
        }

        const cells  = row.getComponents() as Cell<any>[];
        const start  = row.getColumnWindowStart();

        for (let slot = 0; slot < cells.length; slot++) {
            const col     = start + slot;
            const inRange = !!bounds
                && dataIdx >= bounds.minRow && dataIdx <= bounds.maxRow
                && col >= bounds.minCol && col <= bounds.maxCol;

            cells[slot].setRangeSelected(inRange);
        }
    }

    /**
     * Formats the rectangular cell range described by `bounds` into a
     * row-major grid of display text, via {@link TableExporter.formatValue}
     * so a range that spans outside the rendered pool still formats
     * combo/date/time/datetime values correctly — a live `CellRenderer` may
     * not exist for an off-screen cell at all. Rows matching the active
     * {@link setRowSeparator} predicate are skipped entirely, matching the
     * deleted `renderedCellGrid`'s behaviour.
     *
     * @param bounds - The rectangular range to format.
     *
     * @returns The tab/newline-formatted clipboard text.
     */
    private buildCopyText(bounds: CellRangeBounds): string {
        const records = this.getVisibleRecords();
        const fields  = this.computeVisibleFields();
        const rows: string[][] = [];

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            const record = records[r];
            if (this._rowSeparator?.(record)) {   // matches the old renderedCellGrid's separator skip
                continue;
            }

            const line: string[] = [];
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const field  = fields[c];
                const column = this._columns.find(col => col.getField().getName() === field.getName());
                const value  = column
                    ? TableExporter.formatValue(column, record.get(field.getName()), this._columnConfigs, this._cellText)
                    : record.get(field.getName());

                line.push(String(value ?? ''));
            }
            rows.push(line);
        }

        return TableExporter.buildRectangularTSV(rows);
    }

    /**
     * Copies the current cell-range selection to the clipboard — the
     * Ctrl/Cmd+C path. No-op when nothing is selected.
     */
    copySelectionToClipboard(): void {
        const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);
        if (!bounds) {
            return;
        }

        DOM.sink.writeClipboardText(this.buildCopyText(bounds));
    }

    /**
     * Copies the effective right-click copy target — the current range when
     * the right-clicked cell falls inside it, otherwise just that one cell.
     * The menu "Copy" path. No-op when no cell was right-clicked.
     */
    copyContextMenuSelection(): void {
        if (!this._contextMenuCell) {
            return;
        }

        const currentRange = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);
        const bounds        = this.isCellWithinBounds(this._contextMenuCell, currentRange)
            ? currentRange
            : this.getCellRangeBounds(this._contextMenuCell, this._contextMenuCell);

        // Falls through here (rather than a non-null assertion above) so a
        // `_contextMenuCell` whose record was removed from the store between
        // the right-click and the menu click — `getCellRangeBounds` returns
        // null for both branches in that case — copies nothing instead of
        // throwing.
        if (!bounds) {
            return;
        }

        DOM.sink.writeClipboardText(this.buildCopyText(bounds));
    }

    /**
     * Mousedown-driven start of a cell-range-selection drag: resolves the
     * clicked cell and sets it as the new anchor+focus — or, with Shift held
     * and an existing anchor, extends the focus while keeping the anchor
     * fixed, mirroring {@link reduceModifierSelection}'s shift-range shape.
     * Repaints the highlight, focuses the body (a genuine multi-cell drag
     * never fires a `click` event at all, so {@link onRowClick}'s own
     * focus() call cannot be relied on to run after one), and arms the
     * mousemove/mouseup viewport listeners that drive the rest of the
     * gesture. The `selectstart` suppressor arms only once the drag widens
     * past its origin cell.
     *
     * A no-op — no anchor/focus change, no drag armed — when the mousedown
     * resolves to a separator row, an actively-editing cell, or no cell at all.
     *
     * @param e - The mousedown event.
     */
    protected onCellMouseDown(e: MouseEvent): void {
        const target  = e.target === null ? null : DOM.source.intern(e.target);
        const located = this.locateCellFromTarget(target);

        if (!located || located.cell.isEditing()) {
            return;
        }

        const cell = { record: located.record, col: located.col };

        if (e.shiftKey && this._rangeAnchor) {
            this._rangeFocus = cell;
        } else {
            this._rangeAnchor = cell;
            this._rangeFocus  = cell;
        }

        const records = this.getVisibleRecords();

        this.refreshCellRangeHighlight(records);
        this.focus();

        this.resetRangeDragWidening();

        Event.addViewportListener(this, "mousemove", this.onCellDragMove);
        Event.addViewportListener(this, "mouseup",   this.onCellDragEnd);

        this.widenRangeDragIfMultiCell(records);
    }

    /**
     * Extends the live drag's focus corner to whatever cell the pointer now
     * resolves to. A no-op when the pointer resolves to no cell (left every
     * pool row, or landed on a separator row — no auto-scroll, no clamping)
     * or already names the cell the focus currently holds, which skips the
     * repaint entirely.
     *
     * @param e - The mousemove event.
     */
    protected onCellDragMove(e: MouseEvent): Event.ListenerResult {
        if (this._rangeDragWidened) {
            DOM.sink.clearDocumentSelection();
        }

        const target  = e.target === null ? null : DOM.source.intern(e.target);
        const located = this.locateCellFromTarget(target);

        if (!located) {
            return;
        }

        const focus = this._rangeFocus;
        if (focus && focus.record === located.record && focus.col === located.col) {
            return;
        }

        this._rangeFocus = { record: located.record, col: located.col };

        const records = this.getVisibleRecords();

        this.refreshCellRangeHighlight(records);
        this.widenRangeDragIfMultiCell(records);
    }

    /**
     * Tears down the drag's viewport listeners on mouseup. The range itself
     * is already committed live by every {@link onCellDragMove} call, so
     * nothing else happens here — including for a plain click, which is a
     * zero-distance drag ({@link onCellMouseDown} alone already set
     * anchor === focus).
     */
    protected onCellDragEnd(): Event.ListenerResult {
        Event.removeViewportListener(this, "mousemove", this.onCellDragMove);
        Event.removeViewportListener(this, "mouseup",   this.onCellDragEnd);

        this.resetRangeDragWidening();
    }

    /**
     * Suppresses native text selection from the moment a drag widens past
     * its origin cell until mouseup — the same technique `DragManager`'s
     * `onSelectStart` uses to stop a mouse-driven drag from painting a
     * native selection alongside it, since `preventDefault()` on `mousemove`
     * does not by itself stop the browser from extending one.
     *
     * @returns Always suppresses the event while installed.
     */
    private onCellDragSelectStart(): Event.ListenerResult {
        return { stop: true, prevent: true };
    }

    /**
     * Widens the live gesture from native text selection into rectangular
     * cell-range selection, once the range spans more than the one cell it
     * started in. A no-op while the range is still one cell, so an ordinary
     * click-drag inside a cell keeps the browser's own text selection; once
     * widened it clears that selection and stays widened until mouseup.
     *
     * @param records - The current visible records, passed in so this
     *   helper doesn't re-query.
     */
    private widenRangeDragIfMultiCell(records: ModelRecord[]): void {
        if (this._rangeDragWidened) {
            return;
        }

        const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus, records);

        if (!bounds || (bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol)) {
            return;
        }

        this._rangeDragWidened = true;

        DOM.sink.clearDocumentSelection();
        Event.addViewportListener(this, "selectstart", this.onCellDragSelectStart);
    }

    /**
     * Tears down the `selectstart` suppressor and re-arms native text
     * selection for the next gesture. `Event.removeViewportListener`
     * no-ops for a listener that was never installed, so it is safe to call
     * for a gesture that never widened.
     */
    private resetRangeDragWidening(): void {
        Event.removeViewportListener(this, "selectstart", this.onCellDragSelectStart);

        this._rangeDragWidened = false;
    }

    /**
     * Resolves the right-clicked cell into the short-lived `_contextMenuCell`
     * field and emits `"cellcontextmenu"` with the event's viewport
     * coordinates — deliberately never touching `_rangeAnchor`/`_rangeFocus`
     * or repainting the highlight, since a right-click does not change the
     * selection (mirrors `Tree._handleContextMenu`'s same rule).
     *
     * A no-op — leaving the browser's native menu intact — when the
     * right-click resolves to a separator row, an actively-editing cell, or
     * no cell at all.
     *
     * @param e - The contextmenu event.
     *
     * @returns `{ prevent: true }` when a menu target was resolved, so the
     *   dispatcher suppresses the browser's native context menu; `undefined`
     *   otherwise.
     */
    protected onCellContextMenu(e: MouseEvent): Event.ListenerResult {
        const target  = e.target === null ? null : DOM.source.intern(e.target);
        const located = this.locateCellFromTarget(target);

        if (!located || located.cell.isEditing()) {
            return;
        }

        this._contextMenuCell = { record: located.record, col: located.col };

        this.emit("cellcontextmenu", e.clientX, e.clientY);

        return { prevent: true };
    }

    /**
     * Sets the selected record set to contain exactly the given record (or clears selection).
     *
     * @param record - The record to select, or null to clear the selection.
     */
    selectRecord(record: ModelRecord | null): void {
        const before = new Set(this._selectedRecords);

        this._selectedRecords.clear();
        this._anchorRecord = record;

        if (record) {
            this._selectedRecords.add(record);
        }

        const records = this.getVisibleRecords();

        this._boundIndices.forEach((dataIdx, i) => {
            if (dataIdx !== -1) this.updateRowVisualState(i, records);
        });

        this.notifySelectionChange(before);
    }

    /**
     * Returns the most recently anchored selected record, or null if the selection is empty.
     *
     * @returns The anchor {@link ModelRecord}, or null.
     */
    getSelectedRecord(): ModelRecord | null {
        return this._anchorRecord && this._selectedRecords.has(this._anchorRecord)
            ? this._anchorRecord
            : (this._selectedRecords.size > 0 ? [...this._selectedRecords][0] : null);
    }

    /**
     * Returns all currently selected records.
     *
     * @returns An array of selected {@link ModelRecord} instances.
     */
    getSelectedRecords(): ModelRecord[] {
        return [...this._selectedRecords];
    }

    /**
     * Replaces the selected-record set with exactly the given records.
     * Mirrors {@link selectRecord} but accepts a multi-record list.
     *
     * @param records - The records that should appear selected. The
     *   first record (if any) becomes the new anchor.
     */
    setSelectedRecords(records: ModelRecord[]): void {
        const before = new Set(this._selectedRecords);

        this._selectedRecords.clear();
        this._anchorRecord = records.length > 0 ? records[0] : null;

        for (const record of records) {
            this._selectedRecords.add(record);
        }

        const visibleRecords = this.getVisibleRecords();

        this._boundIndices.forEach((dataIdx, i) => {
            if (dataIdx !== -1) this.updateRowVisualState(i, visibleRecords);
        });

        this.notifySelectionChange(before);
    }

    /**
     * Registers a listener for one of this body's events.
     * `"verticalscroll"` fires after the body scrolls vertically with the
     * new `scrollY`; `"horizontalscroll"` fires after a horizontal scroll
     * with the new `scrollX`; `"selection"` fires with the current
     * selected-record array when the selected set changes; `"cellclick"`
     * fires when a data cell is clicked, carrying the clicked record, the
     * column's field name and visible index, the cell value, the record's
     * row index in the visible-records view, and the raw mouse event;
     * `"cellcontextmenu"` fires when a data cell is right-clicked, carrying
     * the event's viewport coordinates.
     *
     * @param event - The event name.
     * @param listener - Receives the new pixel offset along the scroll axis
     *   (scroll events), the selected records (`"selection"`), the
     *   cell-click payload (`"cellclick"`), or the right-click viewport
     *   coordinates (`"cellcontextmenu"`).
     *
     * @returns This body, for method chaining.
     *
     * @remarks `"verticalscroll"` has no consumer inside the library today
     * and exists so a host rendering two bodies side by side can mirror one
     * body's `scrollY` into the other;
     * `"horizontalscroll"` is used by `Table` to mirror `scrollX` into the
     * header's transform so column headers stay aligned with the body cells
     * they label. The listeners fire from the `VirtualScroller`'s
     * onScroll hook (see `init`) — the body uses transform-based virtual
     * scroll, so the native DOM `scroll` event never fires. `"cellcontextmenu"`
     * is used by `Table` to open the shared column-menu instance over the
     * right-clicked cell.
     */
    on(event: "verticalscroll",   listener: (scrollTop: number) => void): this;
    on(event: "horizontalscroll", listener: (scrollLeft: number) => void): this;
    on(event: "selection",  listener: (records: ModelRecord[]) => void): this;
    on(event: "cellclick",        listener: (e: CellClickEvent) => void): this;
    on(event: "cellcontextmenu",  listener: (x: number, y: number) => void): this;
    on(event: BodyEvent,          listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered scroll listener. The exact callback
     * reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This body, for method chaining.
     */
    off(event: BodyEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with the new scroll
     * offset, in registration order.
     *
     * @param event - The event to emit.
     * @param payload - The scroll offset (scroll events), the selected
     *   records (`"selection"`), the cell-click detail (`"cellclick"`), or
     *   the right-click viewport coordinates (`"cellcontextmenu"`).
     */
    protected emit(event: "verticalscroll" | "horizontalscroll", offset: number): void;
    protected emit(event: "selection", records: ModelRecord[]): void;
    protected emit(event: "cellclick", detail: CellClickEvent): void;
    protected emit(event: "cellcontextmenu", x: number, y: number): void;
    protected emit(event: BodyEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Fires `"selection"` with the current selection, unless it has the same
     * membership as `before` — in which case the gesture that ran did not
     * actually change what was selected, and the event is skipped.
     *
     * @param before - The selection as it stood immediately before the
     *   mutating gesture ran.
     */
    private notifySelectionChange(before: ReadonlySet<ModelRecord>): void {
        if (selectionsEqual(before, this._selectedRecords)) {
            return;
        }

        this.emit("selection", this.getSelectedRecords());
    }

    /**
     * Scrolls the body so the given record is visible at the top.
     *
     * @param record - The record to scroll into view.
     */
    scrollToRecord(record: ModelRecord): void {
        const idx = this.getVisibleRecords().indexOf(record);
        if (idx === -1) {
            return;
        }

        this.setScrollY(idx * this._rowHeight);
    }

    /**
     * Computes the read-only union per cell and forwards it to
     * {@link Cell.setReadOnly}. Runs once per row whenever that row
     * rebinds *or* its column window changes — the latter so a
     * `readOnly` column scrolling into view arrives read-only without
     * waiting for a rebind.
     *
     * The union is OR-composed from three sources:
     *
     * 1. Column-level static flag from {@link ColumnConfig.readOnly}.
     * 2. Spec-level row predicate from {@link ColumnSpec.rowReadOnly}
     *    (cached in `_rowReadOnly`).
     * 3. Per-column per-record predicate from
     *    {@link ColumnConfig.cellReadOnly}.
     *
     * Source 1 is read from the column config rather than the cell's
     * current `_readOnly` flag — a previous bind may have marked the
     * cell read-only via a dynamic predicate, and re-reading the cell
     * state would make a positive predicate result sticky once a row
     * went read-only.
     *
     * @param row - The pool row being rebound.
     * @param record - The record now bound to that row.
     * @param retargeted - Optional. When given, scopes the sweep to just
     *   these cells (a window change that didn't rebind the row) instead of
     *   every cell in `row` — a survivor's read-only status cannot have
     *   changed when its own record and column are both unchanged.
     */
    private applyReadOnlyState(row: Row, record: ModelRecord, retargeted?: RetargetedCell[]): void {
        const rowOverride = this._rowReadOnly?.(record) === true;
        const entries     = retargeted
            ?? row.getComponents().map((cell, i) => ({ cell: cell as Cell<any>, fieldName: row.getFieldNames()[i] }));

        for (const { cell, fieldName } of entries) {
            const config     = this._columnConfigs.get(fieldName);
            const colStatic  = config?.readOnly === true;
            const cellPredOk = config?.cellReadOnly?.(record) === true;
            const union      = colStatic || rowOverride || cellPredOk;

            cell.setReadOnly(union);
        }
    }

    /**
     * Returns whether `value` counts as "empty" for the required-cell
     * tint: `null`, `undefined`, or `''`. `0` and `false` are legit
     * values and are NOT empty; an unset boolean (`null`/`undefined`,
     * rendered indeterminate) IS empty.
     *
     * @param value - The raw record value to test.
     * @returns `true` when the value is empty.
     */
    private static isEmptyValue(value: unknown): boolean {
        return value === null || value === undefined || value === '';
    }

    /**
     * Computes the required union per cell and forwards it, AND-ed with
     * emptiness, to {@link Cell.setRequiredEmpty}. Unlike
     * {@link applyReadOnlyState}, this runs on every render (not gated
     * on a rebind or a window change) because the tint depends on the cell's current
     * value, which changes on in-place edits — a commit cascades
     * through `store.notifyRecordChanged` back into a `renderWindow`
     * pass, and this must re-run then to clear a filled cell's tint.
     * `setRequiredEmpty` is idempotent, so an unchanged cell costs one
     * comparison.
     *
     * The union is OR-composed from two sources:
     *
     * 1. Column-level static flag from {@link ColumnConfig.required}.
     * 2. Per-column per-record predicate from
     *    {@link ColumnConfig.requiredPredicate}.
     *
     * @param row - The pool row being rendered.
     * @param record - The record currently bound to that row.
     */
    private applyRequiredEmptyState(row: Row, record: ModelRecord): void {
        const cells      = row.getComponents() as Cell<any>[];
        const fieldNames = row.getFieldNames();

        for (let i = 0; i < cells.length; i++) {
            const fieldName = fieldNames[i];
            const config    = this._columnConfigs.get(fieldName);
            const required  = config?.required === true
                           || config?.requiredPredicate?.(record) === true;
            const empty     = TableBody.isEmptyValue(record.get(fieldName));

            cells[i].setRequiredEmpty(required && empty);
        }
    }

    /**
     * Applies selection highlight or normal visual state to the pool row at index i.
     *
     * @param i - The zero-based index into the row pool.
     * @param records - The current visible records, passed in so this
     *   helper doesn't re-query.
     */
    private updateRowVisualState(i: number, records: ModelRecord[]): void {
        const dataIdx = this._boundIndices[i];
        if (dataIdx === -1) {
            return;
        }

        const record = records[dataIdx];
        if (!record) {
            return;
        }

        const row = this._rowPool[i];
        const isSelected = this._selectedRecords.has(record);

        // `.selected` (declared on `Row.ownStyleStates`) always outranks
        // new/dirty/stripe via its own higher-priority guard, so the
        // new/dirty/stripe sweep below can run unconditionally rather than
        // only in the not-selected branch — the CSS cascade, not this call
        // site, now decides which one actually paints.
        row.setStyleState(".selected", isSelected);
        row.updateVisualState();

        row.getAria().setSelected(isSelected);
    }

    /**
     * Internal wiring called by [`Table`](/api/component/table/classes/Table) —
     * not for consumer use. Hands the Body a reference to its sibling TableHeader so
     * `_updateFocusStyle` can mirror the focused column index onto the header
     * cells. Consumers instantiating `Body` standalone may leave this unset; the
     * header-side indicator is then simply skipped.
     *
     * @param header - The TableHeader sibling owned by the same Table.
     *
     * @returns This component, for method chaining.
     */
    setHeader(header: TableHeader): this {
        this._header = header;

        return this;
    }

    /**
     * Applies a focus ring to the cell at `_focusedColIndex` in the anchor row, clearing it from all other cells.
     *
     * @remarks Called after every navigation and after `renderWindow` re-binds pool slots.
     * Also mirrors the focused column index onto the linked header cells (when
     * one has been wired in via `setHeader`) so the header shows the matching
     * column indicator. `protected` so subclasses (e.g. `TreeBody`) can
     * refresh the focus indicator after a programmatic navigation. Not
     * for consumer use.
     */
    protected _updateFocusStyle(): void {
        // Per-cell ephemeral focus outline on pooled cells re-bound to
        // different records on every render: `setStyleState` toggles the
        // shared `.Cell.focused` class-tier rule (see `Cell.ownStyleStates`,
        // which also carries the `outline-offset` sibling — see its own
        // comment) via a DOM class token, so clearing just the
        // previously-focused cell is enough, rather than sweeping the whole
        // pool every tick. Falls back to the full sweep when that cell is no
        // longer attached to a row — a field-set rebuild can detach/dispose
        // a cell entirely; a plain column-window recycle never does, it only
        // repositions/rebinds — so no stale `.focused` token survives on a
        // cell this pass never visits.
        if (this._previousFocusedCell?.getParentComponent()) {
            this._previousFocusedCell.setStyleState(".focused", false);
        } else {
            for (const row of this._rowPool) {
                for (const cell of row.getComponents() as Cell<any>[]) {
                    cell.setStyleState(".focused", false);
                }
            }
        }

        this._previousFocusedCell = null;

        this._header?.setFocusedColumn(this._anchorRecord ? this._focusedColIndex : null);

        if (!this._anchorRecord) {
            return;
        }

        const anchorIdx = this.getVisibleRecords().indexOf(this._anchorRecord);
        const poolSlotIdx = this._boundIndices.indexOf(anchorIdx);

        if (poolSlotIdx < 0) {
            return;
        }

        const row   = this._rowPool[poolSlotIdx];
        const cells = row.getComponents() as Cell<any>[];
        const slot  = this._focusedColIndex - row.getColumnWindowStart();
        const cell  = (slot >= 0 && slot < cells.length) ? cells[slot] : undefined;

        if (cell) {
            cell.setStyleState(".focused", true);
            this._previousFocusedCell = cell;
        }
    }

    /**
     * Sets `aria-activedescendant` on the body container to point at the focused cell (or row).
     *
     * @remarks Must be called after `renderWindow()` so the pool slot
     * for the anchor record is guaranteed in the DOM. `protected` so
     * subclasses (e.g. `TreeBody`) can refresh the active-descendant
     * pointer after a programmatic navigation. Not for consumer use.
     */
    protected _updateActiveDescendant(): void {
        if (!this._anchorRecord) {
            this.getAria().setActiveDescendant("");

            return;
        }

        const anchorIdx = this.getVisibleRecords().indexOf(this._anchorRecord);
        const poolSlotIdx = this._boundIndices.indexOf(anchorIdx);

        if (poolSlotIdx < 0) {
            this.getAria().setActiveDescendant("");

            return;
        }

        const row   = this._rowPool[poolSlotIdx];
        const cells = row.getComponents();
        const slot  = this._focusedColIndex - row.getColumnWindowStart();
        const cell  = (slot >= 0 && slot < cells.length) ? cells[slot] : undefined;

        if (cell) {
            this.getAria().setActiveDescendant(cell.getId());
        } else {
            this.getAria().setActiveDescendant(this._rowPool[poolSlotIdx].getId());
        }
    }

    /**
     * Steps `index` in `direction` past every separator record (per
     * {@link setRowSeparator}'s predicate), returning the nearest real-row
     * index. Only reachable when a separator predicate is active.
     *
     * A separator is always immediately followed by at least one real row
     * (a group run is never empty) and the projection's last row can never
     * be a separator, so a forward (`+1`) search always terminates without
     * needing the fallback below. Only a backward (`-1`) search can run off
     * the array — when a group sits at the very first row — in which case
     * the fallback retries forward from the original index so the anchor
     * still lands on a real row instead of the clamp re-selecting the
     * separator it just walked off.
     *
     * @param records - The current visible-records list.
     * @param index - The candidate index to start from.
     * @param direction - The direction the caller's key already moves:
     *   `1` for ArrowDown/PageDown/Home, `-1` for ArrowUp/PageUp/End.
     *
     * @returns The nearest index in `records` that is not a separator.
     */
    private skipSeparators(records: ModelRecord[], index: number, direction: 1 | -1): number {
        let i = index;

        while (i >= 0 && i < records.length && this._rowSeparator?.(records[i])) {
            i += direction;
        }

        if (i < 0 || i >= records.length) {
            i = index;

            while (i < records.length && this._rowSeparator?.(records[i])) {
                i++;
            }
        }

        return Math.max(0, Math.min(i, records.length - 1));
    }

    /**
     * Handles keyboard navigation: ArrowUp/Down/Home/End move row selection; ArrowLeft/Right
     * move column focus; PageUp/Down move by a viewport-height page; Enter starts cell edit,
     * or, on a cell with no distinct edit session (see {@link Cell.hasImmediateEditCommit}),
     * navigates to the next/previous row instead; Space always starts the edit (or toggle).
     * Ctrl/Cmd+C copies the cell range, unless a live sub-cell text selection
     * exists, in which case the browser's own copy runs instead.
     *
     * @param e - The keyboard event fired on the body element.
     *
     * @remarks `protected` so subclasses (e.g. `TreeBody`) can intercept
     * additional keys (ArrowRight/Left for expand/collapse) and delegate
     * the rest to `super.onKeyDown`. Not for consumer use.
     */
    protected onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        const records = this.getVisibleRecords();

        if (records.length === 0) {
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            // A live sub-cell text selection wins: let the browser copy the
            // substring instead of overwriting the clipboard with whole cells.
            // Returns null for a collapsed caret too, so a plain click still
            // copies the range.
            if (DOM.source.getDocumentSelection()) {
                return;
            }

            this.copySelectionToClipboard();

            return { prevent: true };
        }

        const navigable = new Set([
            'ArrowDown', 'ArrowUp', 'Home', 'End',
            'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Enter', ' ', 'Tab'
        ]);

        if (!navigable.has(e.key)) {
            return;
        }

        // Column navigation — no row change needed
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const visibleColCount = this._store.model.getFields()
                .filter(f => !this._hiddenColumns.has(f.getName())).length;

            if (e.key === 'ArrowLeft') {
                this._focusedColIndex = Math.max(0, this._focusedColIndex - 1);
            } else {
                this._focusedColIndex = Math.min(visibleColCount - 1, this._focusedColIndex + 1);
            }

            // Bring the newly-focused column into the rendered window before
            // refreshing the focus ring / active descendant against it.
            this.scrollColumnIntoView(this._focusedColIndex);
            this.renderWindow();

            this._updateActiveDescendant();
            this._updateFocusStyle();

            return { prevent: true };
        }

        // Enter/Space — start editing the focused cell. Space always does,
        // including toggling an immediate-commit cell's checkbox (see
        // hasImmediateEditCommit). Enter does too, EXCEPT on such a cell:
        // toggling it isn't "starting an edit" the way opening a text editor
        // is, and Enter is reserved for cell-to-cell navigation everywhere
        // else in this feature (see Cell.onKeyDown), so it navigates like it
        // does there instead — Space remains the deliberate toggle key.
        if (e.key === 'Enter' || e.key === ' ') {
            if (!this._anchorRecord) {
                return { prevent: true };
            }

            // Same as the ArrowLeft/ArrowRight branch: make sure the focused
            // column is in the rendered window before resolving its slot.
            this.scrollColumnIntoView(this._focusedColIndex);
            this.renderWindow();

            if (e.key === 'Enter' && this.resolveFocusedCell()?.hasImmediateEditCommit()) {
                this.navigateFromEditingCell(e.shiftKey ? "up" : "down");
            } else {
                this.startEditAtFocusedCell();
            }

            return { prevent: true };
        }

        // Tab/Shift+Tab — reached when Body itself holds keyboard focus
        // rather than a cell's editor, which happens whenever
        // `openEditingAfterNavigate` lands on a cell it doesn't open an
        // editor for (an immediate-commit cell, a read-only cell, …) and
        // calls `this.focus()`. Without this branch, navigation would
        // silently dead-end there: the next Tab keydown targets Body's own
        // element, and `Cell.onKeyDown`'s Tab handling only ever fires while
        // an editor is actually focused. Reuses the same
        // `navigateFromEditingCell` the editing cell's own Tab handling
        // calls, so the clamp and re-open-editor behaviour match exactly.
        if (e.key === 'Tab') {
            this.navigateFromEditingCell(e.shiftKey ? "left" : "right");

            return { prevent: true };
        }

        // Row navigation
        const currentIdx = this._anchorRecord ? records.indexOf(this._anchorRecord) : -1;
        const pageSize = this.computePageSize();
        let newIdx: number;
        let direction: 1 | -1;

        if (e.key === 'ArrowDown') {
            newIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, records.length - 1);
            direction = 1;
        } else if (e.key === 'ArrowUp') {
            newIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
            direction = -1;
        } else if (e.key === 'PageDown') {
            newIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + pageSize, records.length - 1);
            direction = 1;
        } else if (e.key === 'PageUp') {
            newIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - pageSize, 0);
            direction = -1;
        } else if (e.key === 'Home') {
            newIdx = 0;
            direction = 1;
        } else {
            newIdx = records.length - 1;
            direction = -1;
        }

        if (this._rowSeparator) {
            newIdx = this.skipSeparators(records, newIdx, direction);
        }

        const newAnchor = records[newIdx];

        this.selectRecord(newAnchor);
        this.scrollRecordIntoView(newAnchor);
        this.renderWindow();
        this._updateActiveDescendant();

        return { prevent: true };
    }

    /**
     * Resolves the cell at the current anchor row + `_focusedColIndex`, or
     * `undefined` if no record is anchored, the anchor's pool row can't be
     * found, or no cell is bound at that slot. Shared by
     * `startEditAtFocusedCell` and `openEditingAfterNavigate`.
     */
    private resolveFocusedCell(): Cell<any> | undefined {
        if (!this._anchorRecord) {
            return undefined;
        }

        const anchorIdx = this.getVisibleRecords().indexOf(this._anchorRecord);
        const poolSlotIdx = this._boundIndices.indexOf(anchorIdx);

        if (poolSlotIdx < 0) {
            return undefined;
        }

        const row   = this._rowPool[poolSlotIdx];
        const cells = row.getComponents();
        const slot  = this._focusedColIndex - row.getColumnWindowStart();
        const cell  = (slot >= 0 && slot < cells.length) ? cells[slot] : undefined;

        return cell instanceof Cell ? cell : undefined;
    }

    /**
     * Starts editing the cell at the current anchor row + `_focusedColIndex`,
     * if one is bound. Used by the Enter/Space keyboard-start-edit path for
     * Space (always) and for Enter on a cell that opens a distinct edit
     * session. Enter on a {@link BooleanCell} — whose "edit" is an immediate
     * checkbox toggle with no distinct session (see
     * {@link BooleanCell.startEdit}) — navigates instead of calling this; see
     * the caller.
     */
    private startEditAtFocusedCell(): void {
        this.resolveFocusedCell()?.startEdit();
    }

    /**
     * Opens editing on the cell at the current anchor row +
     * `_focusedColIndex` after Tab/Shift+Tab/Enter/Shift+Enter navigation
     * lands there. Unlike `startEditAtFocusedCell`, this never calls
     * `startEdit()` on a cell whose {@link Cell.hasImmediateEditCommit}
     * returns `true` (e.g. a `BooleanCell`, or a `DynamicCell` currently
     * showing its `boolean` variant): arriving here by navigation, unlike a
     * deliberate keypress on an already-focused cell, must not mutate it as
     * a side effect of merely passing over it. Whether or not an editor
     * actually opens — a read-only or editor-pool-less destination's own
     * `startEdit()` already no-ops, and an immediate-commit cell is skipped
     * here — keyboard focus returns to this body's own container so
     * `Body.onKeyDown` (which fires only while its own element holds focus)
     * keeps receiving subsequent keys instead of the browser silently
     * dropping focus once the previous cell's editor closed.
     */
    private openEditingAfterNavigate(): void {
        const cell = this.resolveFocusedCell();

        if (cell && !cell.hasImmediateEditCommit()) {
            cell.startEdit();
        }

        if (!cell?.isEditing()) {
            this.focus();
        }
    }

    /**
     * Moves editing to the neighboring cell after `Cell.onKeyDown` commits an
     * edit via Tab / Shift+Tab / Enter / Shift+Enter. Installed on every cell
     * as its navigate handler by `wireRowCells`.
     *
     * Tab/Shift+Tab move within the row, mirroring the ArrowLeft/Right clamp.
     * Enter/Shift+Enter move to the next/previous row in the same column,
     * mirroring the ArrowDown/Up clamp (including `skipSeparators`). Both
     * clamp at the grid edge rather than wrapping — see Architecture Decisions.
     *
     * @param direction - Which neighboring cell to move editing to.
     */
    private navigateFromEditingCell(direction: CellNavigateDirection): void {
        const records = this.getVisibleRecords();

        if (records.length === 0 || !this._anchorRecord) {
            return;
        }

        if (direction === "left" || direction === "right") {
            const visibleColCount = this._store.model.getFields()
                .filter(f => !this._hiddenColumns.has(f.getName())).length;

            this._focusedColIndex = direction === "left"
                ? Math.max(0, this._focusedColIndex - 1)
                : Math.min(visibleColCount - 1, this._focusedColIndex + 1);

            this.scrollColumnIntoView(this._focusedColIndex);
            this.renderWindow();
        } else {
            const currentIdx = records.indexOf(this._anchorRecord);
            let newIdx = direction === "down"
                ? Math.min(currentIdx + 1, records.length - 1)
                : Math.max(currentIdx - 1, 0);

            if (this._rowSeparator) {
                newIdx = this.skipSeparators(records, newIdx, direction === "down" ? 1 : -1);
            }

            const newAnchor = records[newIdx];

            this.selectRecord(newAnchor);
            this.scrollRecordIntoView(newAnchor);
            this.renderWindow();
        }

        this._updateActiveDescendant();
        this._updateFocusStyle();

        this.openEditingAfterNavigate();
    }

    /**
     * Scrolls the body so the given record is visible, without moving the viewport unless necessary.
     *
     * @param record - The record to scroll into view.
     *
     * @remarks `protected` so subclasses (e.g. `TreeBody`) can keep
     * keyboard-driven navigation inside the scroll viewport. Not for
     * consumer use.
     */
    protected scrollRecordIntoView(record: ModelRecord): void {
        this.scrollRowIntoView(this.getVisibleRecords().indexOf(record));
    }

    /**
     * Scrolls the body horizontally so the column at `colIndex` is fully
     * visible, without moving the viewport unless necessary. The horizontal
     * mirror of {@link scrollRecordIntoView}.
     *
     * @param colIndex - The visible-column index to reveal.
     *
     * @remarks Driving the shared `VirtualScroller` keeps the header
     * translate and the scrollbar thumb in sync with the move. This is why an
     * inline edit routes through here rather than relying on the browser's
     * native focus-scroll: that scroll shifts only the clipped content layer
     * and leaves the header + scrollbar behind. `protected` so subclasses can
     * reuse it. Not for consumer use.
     */
    protected scrollColumnIntoView(colIndex: number): void {
        const widths = this._lastColumnWidths;

        if (!this._scroller || colIndex < 0 || colIndex >= widths.length) {
            return;
        }

        let left = 0;
        for (let i = 0; i < colIndex; i++) {
            left += widths[i];
        }
        const right         = left + widths[colIndex];
        const scrollLeft    = this._scroller.getScrollX();
        const viewportWidth = this.getWidth() || 0;
        const visibleRight  = scrollLeft + viewportWidth;

        let target = scrollLeft;
        if (left < scrollLeft) {
            target = left;
        } else if (right > visibleRight) {
            target = right - viewportWidth;
        }
        if (target !== scrollLeft) {
            this.setScrollX(target);
        }
    }
}

const BodyCallable = callable(TableBody);
type BodyCallable = TableBody;
export {
    TableBody    as _Body,
    BodyCallable as Body
};
