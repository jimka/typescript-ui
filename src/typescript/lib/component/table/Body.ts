// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { Row } from "~/component/table/Row.js";
import { Cell } from "~/component/table/cell/Cell.js";
import { CellEditorPool } from "~/component/table/cell/editor/CellEditorPool.js";
import { Event } from "~/core/Event.js";
import { VirtualScroller } from "~/component/container/VirtualScroller.js";
import { ThemeManager } from "~/core/Theme.js";
import { Util } from "~/core/Util.js";
import type { ColumnConfig } from "~/component/table/ColumnConfig.js";
import { Column } from "~/component/table/Column.js";
import type { Header } from "~/component/table/Header.js";
import type { HeaderCell } from "~/component/table/cell/Header.js";
import { callable } from "~/core/Callable.js";

const SCROLL_BUFFER = 2;

/**
 * String-literal union of the events emitted by the table {@link Body}.
 * `"verticalscroll"` / `"horizontalscroll"` fire after the body's virtual
 * scroll position changes, carrying the new pixel offset.
 */
export type BodyEvent = "verticalscroll" | "horizontalscroll";

function columnWidthsEqual(a: number[], b: number[] | undefined): boolean {
    if (!b) return a.length === 0;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

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
 * Scrolling is delegated to a {@link VirtualScroller} that owns the
 * rows-container transform, two custom scrollbar overlays, and the wheel/touch
 * handlers with fling momentum.
 *
 * Re-exported as `TableBody` from the package barrel.
 *
 * @category Components
 */
class Body extends Component {

    private _store           : AbstractStore;
    private _hiddenColumns   : Set<string>               = new Set();
    private _columns         : Column[]                  = [];
    private _columnConfigs   : Map<string, ColumnConfig> = new Map();
    private _rowReadOnly     : ((record: ModelRecord) => boolean) | null = null;
    private _rowPool         : Row[]                     = [];
    private _boundIndices    : number[]                  = [];
    private _rowGeom         : Array<{ ty: number, w: number, h: number } | null> = [];
    private _cellGeom        : Array<Array<{ x: number, w: number, h: number } | null>> = [];
    private _rowDisplayed    : boolean[]                 = [];
    private _scroller        : VirtualScroller | null    = null;
    private _lastBodyWidth   : number                    = 0;
    private _lastColumnWidths: number[]                  = [];
    private _lastAriaRowCount: number                    = -1;
    private _rowHeight       : number;
    private _storeRefresh    : (() => void) | null       = null;
    private _selectedRecords : Set<ModelRecord>          = new Set();
    private _anchorRecord    : ModelRecord | null        = null;
    private _focusedColIndex: number                    = 0;
    private _editorPool      : CellEditorPool            = new CellEditorPool();
    private _header          : Header | null             = null;
    private _listeners       : ListenerBag<BodyEvent>    = new ListenerBag<BodyEvent>();

    constructor(store: AbstractStore) {
        super({ tag: "tbody" });

        this.setOverflow("hidden");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.getAria().setTabIndex(0);
        this.getAria().setRole("rowgroup");

        this._store = store;
        this.bindStore(store);

        this._rowHeight = this.computeRowHeight();

        ThemeManager.onThemeChange(() => {
            this._rowHeight = this.computeRowHeight();
            this._boundIndices.fill(-1);
            this.invalidateGeom();
            this.renderWindow();
        });
    }

    /**
     * Derives the row height from the shared px line box plus top+bottom cell
     * padding.
     *
     * @remarks `theme.table.cell.height` is intentionally ignored: a fixed pixel
     * height ignores the active line box and clips text when the theme changes
     * the leading. The line box is the additive `font-size + --ts-ui-line-padding`
     * value `Util.lineHeightPx` derives at the root font size, keeping row
     * height in sync with the line box the cells are actually rendered at.
     */
    private computeRowHeight(): number {
        const theme      = ThemeManager.getTheme();
        const lineHeight = Util.lineHeightPx();
        const padding    = theme.table.cell.padding          ?? 2;

        return lineHeight + 2 * padding;
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
        store.on('datachanged', refresh);
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
     * collection).
     *
     * @returns The records the row pool should bind to, in display order.
     *
     * @remarks Subclassing seam — `TreeBody` overrides this to return its
     * depth-flattened, expansion-aware visible subtree. Every internal
     * site that needs the visible records — virtual-window math, click
     * dispatch, focus + active-descendant tracking, keyboard nav,
     * scroll-into-view — goes through this method. Not for consumer use.
     */
    protected getVisibleRecords(): ModelRecord[] {
        return this._store.getRecords();
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
     * @remarks Subclassing seam — forwarded into {@link Row.syncCells}
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
     * Clears the cached row/cell geometry so the next renderWindow re-applies
     * positions and sizes for every visible row.
     */
    private invalidateGeom(): void {
        for (let i = 0; i < this._rowGeom.length; i++) {
            this._rowGeom[i] = null;
        }
        for (let i = 0; i < this._cellGeom.length; i++) {
            this._cellGeom[i] = [];
        }
    }

    /**
     * Updates the set of hidden column field names, syncs each pooled
     * row's cells in place to match the new visible-field list, and
     * re-renders.
     *
     * Field names belonging to {@link Column.isUnhideable} columns are stripped
     * from the set so a direct caller cannot bypass the unhideable contract.
     *
     * @param hidden - The new set of field names to hide.
     *
     * @remarks The previous implementation dropped the entire row pool
     * and rebuilt it via `growRowPool`. The in-place sync preserves
     * each row's existing cells (and their renderer / editor / theme
     * listener / sort state / group tint), constructing or removing
     * only the cells whose visibility actually changed.
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
        this.syncPoolCells();
        this.renderWindow();

        return this;
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
     * Updates the per-field column-config map and re-syncs each pooled
     * row's cells in place so any field-type-driven cell options
     * (e.g. `showSeconds`) and group tints take effect immediately.
     *
     * @param configs - The new column-config map keyed by field name.
     */
    setColumnConfigs(configs: Map<string, ColumnConfig>): this {
        this._columnConfigs = configs;
        this.syncPoolCells();
        this.renderWindow();

        return this;
    }

    /**
     * Walks every pool row and asks it to reconcile its cell set
     * against the current `_hiddenColumns` + `_columnConfigs`, then
     * invalidates the per-slot geometry caches so the next
     * `renderWindow` re-positions cells against the new column count.
     */
    private syncPoolCells(): void {
        const treeFieldName = this.getTreeFieldName();

        for (let i = 0; i < this._rowPool.length; i++) {
            const row = this._rowPool[i];

            row.syncCells(
                this._store.model,
                this._hiddenColumns,
                this._columnConfigs,
                treeFieldName,
            );

            // Newly-shown cells need the editor pool wired so in-place
            // editing keeps working. `setEditorPool` is idempotent for
            // surviving cells.
            for (const cell of row.getComponents() as Cell<any>[]) {
                cell.setEditorPool(this._editorPool);
            }

            // Per-slot geometry is keyed by cell position; both the
            // column count and per-cell (x, w, h) have changed.
            this._rowGeom[i]  = null;
            this._cellGeom[i] = [];
        }
    }

    /**
     * Swaps the store, unsubscribing from the old one and rebinding to the new one.
     *
     * @param store - The new store to bind to the body.
     */
    setStore(store: AbstractStore): this {
        if (this._storeRefresh) {
            const old = this._store;

            (['load', 'add', 'remove', 'datachanged', 'beforesync', 'sync'] as const).forEach(e =>
                old.off(e, this._storeRefresh!)
            );
        }

        this._store = store;
        this.bindStore(store);
        this.invalidateGeom();

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
     * Initializes the body element, constructs the {@link VirtualScroller}, and
     * wires keyboard and focus listeners.
     *
     * @param element - Optional. The HTMLElement to initialize with; falls back to `getElement()`.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        this._scroller = new VirtualScroller(this, el, () => {
            this.renderWindow();
            if (this._scroller) {
                this.emit("verticalscroll",   this._scroller.getScrollY());
                this.emit("horizontalscroll", this._scroller.getScrollX());
            }
        });

        Event.addListener(this, "focus", () => {
            this._updateActiveDescendant();
            this._updateFocusStyle();
        });

        Event.addListener(this, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));

        // One subtree click listener replaces the per-row listener that
        // growRowPool used to install. Walk up from the event target to find
        // the matching pool row; identical complexity per click, one window
        // registration regardless of pool size. Routed through
        // `onSubtreeClick` so subclasses (e.g. `TreeBody`) can intercept
        // clicks on subtree-owned widgets like the expand/collapse toggle.
        Event.addSubtreeListener(this, "click", (e: MouseEvent) => this.onSubtreeClick(e));

        this.renderWindow();

        return this;
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
     * Sets the JS-controlled vertical scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param y - The new scroll position in pixels.
     */
    setScrollY(y: number): this {
        this._scroller?.resetWheelEase();
        this._scroller?.setScrollY(y);

        return this;
    }

    /**
     * Sets the JS-controlled horizontal scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param x - The new scroll position in pixels.
     */
    setScrollX(x: number): this {
        this._scroller?.resetWheelEase();
        this._scroller?.setScrollX(x);

        return this;
    }

    /**
     * Recomputes the visible row window, rebinds changed rows from the pool, and hides excess rows.
     *
     * @param bodyWidth - Optional. The total body width in pixels; cached and reused on scroll updates.
     * @param columnWidths - Optional. The per-column widths in pixels; derived from bodyWidth when omitted.
     */
    renderWindow(bodyWidth?: number, columnWidths?: number[]) {
        const element = this.getElement();
        if (!element || !this._scroller) {
            return;
        }

        const scroller = this._scroller;
        const records   = this.getVisibleRecords();
        const totalRows = records.length;

        // Capture scroll positions before clampToContent / layoutScrollbars
        // (called below) potentially shrink them in place. Those calls don't
        // go through setScrollX/Y, so the VirtualScroller's onScroll hook
        // never fires — without an explicit notification here the header's
        // horizontal translate would stay stuck at the pre-clamp value when
        // a widen-to-fit layout drops scrollX back toward 0.
        const prevScrollX = scroller.getScrollX();
        const prevScrollY = scroller.getScrollY();

        this.updateColumnWidthCache(bodyWidth, columnWidths);

        // Loose-clamp scroll positions against the new content sizes before
        // reading them for the window calc.
        const totalHeight       = totalRows * this._rowHeight;
        const totalColumnWidth  = this._lastColumnWidths.reduce((s, w) => s + w, 0);
        const totalContentWidth = Math.max(this._lastBodyWidth, totalColumnWidth);

        scroller.clampToContent(totalContentWidth, totalHeight);

        const visibleHeight = this.getHeight() || 0;
        const win = this.computeVisibleWindow(scroller.getScrollY(), visibleHeight, totalRows);

        const poolTarget = this.computePoolTarget(win.windowSize, visibleHeight, totalRows);
        this.growRowPool(poolTarget);

        const rowWidth   = Math.max(this._lastBodyWidth, totalColumnWidth);
        const fieldCount = this._store.model.getFields()
                               .filter(f => !this._hiddenColumns.has(f.getName()))
                               .length;
        const fallback   = fieldCount > 0 ? rowWidth / fieldCount : rowWidth;

        this.bindAndPositionRows(win.firstRow, win.windowSize, rowWidth, fallback, records);
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
     * Computes the `[firstRow, lastRow]` data-index window visible in the
     * current viewport, padded by `SCROLL_BUFFER` on each side and clamped to
     * the dataset bounds.
     *
     * @param scrollY - The current scroll offset in pixels.
     * @param visibleHeight - The viewport height in pixels.
     * @param totalRows - The total number of records in the store.
     * @returns The `firstRow` / `lastRow` data indices and the number of rows in the window.
     */
    private computeVisibleWindow(scrollY: number, visibleHeight: number, totalRows: number): { firstRow: number, lastRow: number, windowSize: number } {
        const rowHeight = this._rowHeight;
        const firstRow  = Math.max(0, Math.floor(scrollY / rowHeight) - SCROLL_BUFFER);
        const lastRow   = Math.min(
            totalRows - 1,
            Math.ceil((scrollY + visibleHeight) / rowHeight) + SCROLL_BUFFER
        );
        const windowSize = lastRow - firstRow + 1 > 0 ? lastRow - firstRow + 1 : 0;

        return { firstRow, lastRow, windowSize };
    }

    /**
     * Computes the row-pool target size: the max possible window for the
     * current viewport, not just the current windowSize. windowSize shrinks
     * near the top/bottom edges of the dataset because firstRow clamps to 0
     * (and lastRow to totalRows-1); growing only to windowSize would force
     * regrowth mid-scroll once the user passes a viewport-edge boundary,
     * paying per-row first-time `cell.doLayout` cost then. Pre-growing pays
     * that cost once.
     *
     * @param windowSize - The current visible-window size.
     * @param visibleHeight - The viewport height in pixels.
     * @param totalRows - The total number of records in the store.
     * @returns The pool target size.
     */
    private computePoolTarget(windowSize: number, visibleHeight: number, totalRows: number): number {
        return Math.min(
            totalRows,
            Math.max(
                windowSize,
                Math.ceil(visibleHeight / this._rowHeight) + 2 * SCROLL_BUFFER + 2
            )
        );
    }

    /**
     * Grows the row pool up to `poolTarget`, batching new row elements through
     * a {@link DocumentFragment} so the live rows container sees a single
     * append instead of N.
     *
     * @param poolTarget - The target pool size.
     */
    private growRowPool(poolTarget: number): void {
        if (!this._scroller || this._rowPool.length >= poolTarget) {
            return;
        }

        const rowsContainer = this._scroller.getRowsContainer();
        const growFragment  = document.createDocumentFragment();

        while (this._rowPool.length < poolTarget) {
            const row = this.createRow();

            for (const cell of row.getComponents() as Cell<any>[]) {
                cell.setEditorPool(this._editorPool);
            }

            const rowEl = row.getElement(true);

            DOM.sink.appendChild(growFragment, rowEl);

            // Click handler is a single subtree listener on Body.init(); see
            // there for the row-lookup walk.

            // Pin row's static top to 0 once. Per-frame Y offset comes from translateY,
            // which is composite-only (avoids layout/paint per scroll tick).
            row.setY(0);

            // Pre-promote pooled rows to their own compositor layer so the first
            // scroll-driven translate doesn't pay a layer-creation cost. Pool
            // rows now survive column-toggle and config swaps via in-place
            // cell sync, so the hint stays live for the body's lifetime.
            row.setWillChange("transform");

            this._rowPool.push(row);
            this._boundIndices.push(-1);
            this._rowGeom.push(null);
            this._cellGeom.push([]);
            this._rowDisplayed.push(false);
        }

        DOM.sink.appendChild(rowsContainer, growFragment);
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
     * @param fallback - Fallback column width for fields without an explicit width.
     * @param records - The current store records (passed in so this helper doesn't re-query).
     *
     * @remarks `protected` so subclasses (e.g. `TreeBody`) can wrap the
     * standard bind + position pass with their own post-bind work
     * (depth / toggle updates). Not for consumer use.
     */
    protected bindAndPositionRows(firstRow: number, windowSize: number, rowWidth: number, fallback: number, records: ModelRecord[]): void {
        const rowHeight = this._rowHeight;

        for (let i = 0; i < windowSize; i++) {
            const row = this._rowPool[i];
            const dataIndex = firstRow + i;
            const wasRebound = this._boundIndices[i] !== dataIndex;

            if (wasRebound) {
                row.setData(records[dataIndex]);

                this._boundIndices[i] = dataIndex;
                row.setStripe(dataIndex % 2 === 1);   // odd logical rows carry the zebra stripe; set before the paint below
                this.updateRowVisualState(i);
                this.computeRowAria(row, dataIndex);
                this.applyReadOnlyState(row, records[dataIndex]);
            }

            this.afterRowBound(row, dataIndex, wasRebound);

            const targetY = dataIndex * rowHeight;
            const prev = this._rowGeom[i];
            if (!prev || prev.ty !== targetY || prev.w !== rowWidth || prev.h !== rowHeight) {
                row.setAutoCommitStyle(false);
                row.setX(0);
                row.setTranslate(0, targetY);
                row.setWidth(rowWidth);
                row.setHeight(rowHeight);
                row.setAutoCommitStyle(true);
                this._rowGeom[i] = { ty: targetY, w: rowWidth, h: rowHeight };
            }
            if (!this._rowDisplayed[i]) {
                row.setDisplayed(true);
                this._rowDisplayed[i] = true;
            }

            const cells = row.getComponents();
            const cellRow = this._cellGeom[i];
            let x = 0;

            for (let ci = 0; ci < cells.length; ci++) {
                const cell = cells[ci];
                const colW = this._lastColumnWidths[ci] ?? fallback;
                const prevCell = cellRow[ci];
                const cellChanged = !prevCell || prevCell.x !== x || prevCell.w !== colW || prevCell.h !== rowHeight;

                if (cellChanged) {
                    cell.setAutoCommitStyle(false);
                    cell.setX(x);
                    cell.setY(0);
                    cell.setWidth(colW);
                    cell.setHeight(rowHeight);
                    cell.setAutoCommitStyle(true);
                    cellRow[ci] = { x: x, w: colW, h: rowHeight };
                    if (!prevCell) {
                        cell.getAria().setColIndex(ci + 1);
                    }
                    // Geometry change requires a full layout pass so the
                    // renderer/editor (Card-layout siblings) re-fit. Pure data
                    // rebinds don't need this because renderers with
                    // setAutoMeasure(false) don't resize on text changes.
                    cell.doLayout();
                }

                x += colW;
            }
        }
    }

    /**
     * Hides pool slots whose index falls outside the visible window and
     * clears their cached binding so the next bind triggers a full rebuild.
     *
     * @param windowSize - The number of pool slots currently in use.
     */
    private hideExcessPoolRows(windowSize: number): void {
        for (let i = windowSize; i < this._rowPool.length; i++) {
            if (this._rowDisplayed[i]) {
                this._rowPool[i].setDisplayed(false);
                this._rowDisplayed[i] = false;
            }
            this._boundIndices[i] = -1;
            this._rowGeom[i] = null;
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

        let node: HTMLElement | null = e.target as HTMLElement | null;

        while (node) {
            const row = this._rowPool.find(r => r.getElement() === node);

            if (row) {
                this.onRowClick(row, e);
                return;
            }

            node = DOM.source.getParentElement(node) as HTMLElement | null;
        }
    }

    /**
     * Handles a row click, updating selection with support for ctrl/cmd and shift modifiers.
     *
     * @param row - The pool row that was clicked.
     * @param e - The mouse event.
     */
    private onRowClick(row: Row, e: MouseEvent): void {
        const record = row.getData() ?? null;
        if (!record) return;

        const records = this.getVisibleRecords();

        if (e.shiftKey && this._anchorRecord) {
            // Range select from anchor to clicked record
            const anchorIdx = records.indexOf(this._anchorRecord);
            const clickIdx  = records.indexOf(record);
            const lo = Math.min(anchorIdx, clickIdx);
            const hi = Math.max(anchorIdx, clickIdx);

            if (!e.ctrlKey && !e.metaKey) {
                this._selectedRecords.clear();
            }

            for (let i = lo; i <= hi; i++) {
                this._selectedRecords.add(records[i]);
            }
        } else if (e.ctrlKey || e.metaKey) {
            // Toggle individual record
            if (this._selectedRecords.has(record)) {
                this._selectedRecords.delete(record);
            } else {
                this._selectedRecords.add(record);
            }
            this._anchorRecord = record;
        } else {
            // Plain click — replace selection
            this._selectedRecords.clear();
            this._selectedRecords.add(record);
            this._anchorRecord = record;
        }

        this._boundIndices.forEach((dataIdx, i) => {
            if (dataIdx !== -1) this.updateRowVisualState(i);
        });

        // Determine which column was clicked and update focused cell
        const cells = row.getComponents();

        for (let ci = 0; ci < cells.length; ci++) {
            const cellEl = cells[ci].getElement();

            if (cellEl && (cellEl === e.target || DOM.source.contains(cellEl, e.target as Node))) {
                this._focusedColIndex = ci;
                break;
            }
        }

        // Don't steal focus from an active cell editor (e.g. <input type="date">).
        const targetTag = (e.target as HTMLElement).tagName;
        if (targetTag !== 'INPUT' && targetTag !== 'TEXTAREA' && targetTag !== 'SELECT') {
            this.focus();
        }

        this._updateFocusStyle();
        this._updateActiveDescendant();
    }

    /**
     * Sets the selected record set to contain exactly the given record (or clears selection).
     *
     * @param record - The record to select, or null to clear the selection.
     */
    selectRecord(record: ModelRecord | null): void {
        this._selectedRecords.clear();
        this._anchorRecord = record;

        if (record) {
            this._selectedRecords.add(record);
        }

        this._boundIndices.forEach((dataIdx, i) => {
            if (dataIdx !== -1) this.updateRowVisualState(i);
        });
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
        this._selectedRecords.clear();
        this._anchorRecord = records.length > 0 ? records[0] : null;

        for (const record of records) {
            this._selectedRecords.add(record);
        }

        this._boundIndices.forEach((dataIdx, i) => {
            if (dataIdx !== -1) this.updateRowVisualState(i);
        });
    }

    /**
     * Registers a listener for one of this body's virtual-scroll events.
     * `"verticalscroll"` fires after the body scrolls vertically with the
     * new `scrollY`; `"horizontalscroll"` fires after a horizontal scroll
     * with the new `scrollX`.
     *
     * @param event - The event name.
     * @param listener - Receives the new pixel offset along the scroll axis.
     *
     * @returns This body, for method chaining.
     *
     * @remarks `"verticalscroll"` is used by
     * [`PinnedTable`](/api/component/table/classes/PinnedTable) to mirror
     * `scrollY` from the scroll-side body into the pinned-side body;
     * `"horizontalscroll"` is used by `Table` to mirror `scrollX` into the
     * header's transform so column headers stay aligned with the body cells
     * they label. The listeners fire from the {@link VirtualScroller}'s
     * onScroll hook (see `init`) — the body uses transform-based virtual
     * scroll, so the native DOM `scroll` event never fires.
     */
    on(event: "verticalscroll",   listener: (scrollTop: number) => void): this;
    on(event: "horizontalscroll", listener: (scrollLeft: number) => void): this;
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
     * @param offset - The new pixel offset along the scroll axis.
     */
    protected emit(event: BodyEvent, offset: number): void {
        this._listeners.fire(event, offset);
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
     * {@link Cell.setReadOnly}. Runs inside the rebind block once per
     * row.
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
     */
    private applyReadOnlyState(row: Row, record: ModelRecord): void {
        const rowOverride = this._rowReadOnly?.(record) === true;
        const cells       = row.getComponents() as Cell<any>[];
        const fieldNames  = row.getFieldNames();

        for (let i = 0; i < cells.length; i++) {
            const cell       = cells[i];
            const fieldName  = fieldNames[i];
            const config     = this._columnConfigs.get(fieldName);
            const colStatic  = config?.readOnly === true;
            const cellPredOk = config?.cellReadOnly?.(record) === true;
            const union      = colStatic || rowOverride || cellPredOk;

            cell.setReadOnly(union);
        }
    }

    /**
     * Applies selection highlight or normal visual state to the pool row at index i.
     *
     * @param i - The zero-based index into the row pool.
     */
    private updateRowVisualState(i: number): void {
        const dataIdx = this._boundIndices[i];
        if (dataIdx === -1) {
            return;
        }

        const record = this.getVisibleRecords()[dataIdx];
        if (!record) {
            return;
        }

        const row = this._rowPool[i];
        const rowEl = row.getElement() as HTMLElement;
        const isSelected = this._selectedRecords.has(record);

        // Per-record ephemeral selection highlight on a pooled row re-bound to a
        // different record on every render. Routing this through cached Component
        // setters would persist it into _options and replay it onto the next record
        // bound to this reused row, so write/remove the inline styles directly.
        /* eslint-disable local/no-element-style */
        if (isSelected) {
            rowEl.style.setProperty('background-color', 'var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15))');
            rowEl.style.setProperty('box-shadow', 'var(--ts-ui-table-row-selected-border, none)');
        } else {
            rowEl.style.removeProperty('box-shadow');
            row.updateVisualState();
        }
        /* eslint-enable local/no-element-style */

        row.getAria().setSelected(isSelected);
    }

    /**
     * No-op; column order is fixed by field order in renderWindow.
     */
    sortColumns() {
        // No longer applicable — column order is fixed by field order in renderWindow
    }

    /**
     * Not yet implemented; throws an error if called.
     */
    sortRows() {
        throw Error("Not implemented yet.");
    }

    /**
     * Internal wiring called by [`Table`](/api/component/table/classes/Table) —
     * not for consumer use. Hands the Body a reference to its sibling Header so
     * `_updateFocusStyle` can mirror the focused column index onto the header
     * cells. Consumers instantiating `Body` standalone may leave this unset; the
     * header-side indicator is then simply skipped.
     *
     * @param header - The Header sibling owned by the same Table.
     *
     * @returns This component, for method chaining.
     */
    setHeader(header: Header): this {
        this._header = header;

        return this;
    }

    /**
     * Applies a focus ring to the cell at `_focusedColIndex` in the anchor row, clearing it from all other cells.
     *
     * @remarks Called after every navigation and after `renderWindow` re-binds pool slots.
     * Also mirrors the focused column index onto the linked Header cells (when
     * one has been wired in via `setHeader`) so the header shows the matching
     * column indicator. `protected` so subclasses (e.g. `TreeBody`) can
     * refresh the focus indicator after a programmatic navigation. Not
     * for consumer use.
     */
    protected _updateFocusStyle(): void {
        // Per-cell ephemeral focus outline on pooled cells re-bound to different
        // records on every render. Routing this through cached Component setters
        // would persist it into _options and replay it onto the next record bound
        // to the reused cell, so write/remove the inline styles directly.
        for (const row of this._rowPool) {
            for (const cell of row.getComponents()) {
                const el = cell.getElement() as HTMLElement | null;

                if (el) {
                    /* eslint-disable-next-line local/no-element-style -- pooled-cell ephemeral focus style; see note above */
                    el.style.removeProperty("outline");
                    /* eslint-disable-next-line local/no-element-style -- pooled-cell ephemeral focus style; see note above */
                    el.style.removeProperty("outline-offset");
                }
            }
        }

        const headerCells: HeaderCell[] | null = this._header !== null
            ? this._header.getColumns() as HeaderCell[]
            : null;

        if (headerCells !== null) {
            for (const cell of headerCells) {
                cell.setColumnFocused(false);
            }
        }

        if (!this._anchorRecord) {
            return;
        }

        if (headerCells !== null) {
            for (let i = 0; i < headerCells.length; i++) {
                headerCells[i].setColumnFocused(i === this._focusedColIndex);
            }
        }

        const anchorIdx = this.getVisibleRecords().indexOf(this._anchorRecord);
        const poolSlotIdx = this._boundIndices.indexOf(anchorIdx);

        if (poolSlotIdx < 0) {
            return;
        }

        const cells = this._rowPool[poolSlotIdx].getComponents();
        const cell = cells[this._focusedColIndex];

        if (cell) {
            const el = cell.getElement() as HTMLElement | null;

            if (el) {
                // Pooled-cell ephemeral focus style; see note at method top.
                /* eslint-disable local/no-element-style */
                el.style.setProperty("outline", "var(--ts-ui-indicator-selection, 1px dashed rgb(120, 170, 240))");
                el.style.setProperty("outline-offset", "-1px");
                /* eslint-enable local/no-element-style */
            }
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

        const cells = this._rowPool[poolSlotIdx].getComponents();
        const cell = cells[this._focusedColIndex];

        if (cell) {
            this.getAria().setActiveDescendant(cell.getId());
        } else {
            this.getAria().setActiveDescendant(this._rowPool[poolSlotIdx].getId());
        }
    }

    /**
     * Handles keyboard navigation: ArrowUp/Down/Home/End move row selection; ArrowLeft/Right
     * move column focus; PageUp/Down move by a viewport-height page; Enter starts cell edit.
     *
     * @param e - The keyboard event fired on the body element.
     *
     * @remarks `protected` so subclasses (e.g. `TreeBody`) can intercept
     * additional keys (ArrowRight/Left for expand/collapse) and delegate
     * the rest to `super.onKeyDown`. Not for consumer use.
     */
    protected onKeyDown(e: KeyboardEvent): void {
        const records = this.getVisibleRecords();

        if (records.length === 0) {
            return;
        }

        const navigable = new Set([
            'ArrowDown', 'ArrowUp', 'Home', 'End',
            'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Enter', ' '
        ]);

        if (!navigable.has(e.key)) {
            return;
        }

        e.preventDefault();

        // Column navigation — no row change needed
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const visibleColCount = this._store.model.getFields()
                .filter(f => !this._hiddenColumns.has(f.getName())).length;

            if (e.key === 'ArrowLeft') {
                this._focusedColIndex = Math.max(0, this._focusedColIndex - 1);
            } else {
                this._focusedColIndex = Math.min(visibleColCount - 1, this._focusedColIndex + 1);
            }

            this._updateActiveDescendant();
            this._updateFocusStyle();

            return;
        }

        // Enter/Space — start editing the focused cell
        if (e.key === 'Enter' || e.key === ' ') {
            if (!this._anchorRecord) {
                return;
            }

            const anchorIdx = records.indexOf(this._anchorRecord);
            const poolSlotIdx = this._boundIndices.indexOf(anchorIdx);

            if (poolSlotIdx < 0) {
                return;
            }

            const cells = this._rowPool[poolSlotIdx].getComponents();
            const cell = cells[this._focusedColIndex];

            if (cell instanceof Cell) {
                const typedCell = cell as Cell<unknown>;

                typedCell.on("editend", () => {
                    this.focus();
                    this._updateFocusStyle();
                    this._updateActiveDescendant();
                });
                typedCell.startEdit();
            }

            return;
        }

        // Row navigation
        const currentIdx = this._anchorRecord ? records.indexOf(this._anchorRecord) : -1;
        const pageSize = Math.max(1, Math.floor((this.getHeight() || this._rowHeight) / this._rowHeight));
        let newIdx: number;

        if (e.key === 'ArrowDown') {
            newIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, records.length - 1);
        } else if (e.key === 'ArrowUp') {
            newIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
        } else if (e.key === 'PageDown') {
            newIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + pageSize, records.length - 1);
        } else if (e.key === 'PageUp') {
            newIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - pageSize, 0);
        } else if (e.key === 'Home') {
            newIdx = 0;
        } else {
            newIdx = records.length - 1;
        }

        const newAnchor = records[newIdx];

        this.selectRecord(newAnchor);
        this.scrollRecordIntoView(newAnchor);
        this.renderWindow();
        this._updateActiveDescendant();
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
        const idx = this.getVisibleRecords().indexOf(record);

        if (idx === -1 || !this._scroller) {
            return;
        }

        const top            = idx * this._rowHeight;
        const bottom         = top + this._rowHeight;
        const scrollTop      = this._scroller.getScrollY();
        const viewportHeight = this.getHeight();
        const visibleBottom  = scrollTop + viewportHeight;

        let target = scrollTop;
        if (top < scrollTop) {
            target = top;
        } else if (bottom > visibleBottom) {
            target = bottom - viewportHeight;
        }
        if (target !== scrollTop) {
            this.setScrollY(target);
        }
    }
}

const BodyCallable = callable(Body);
type BodyCallable = Body;
export {
    Body         as _Body,
    BodyCallable as Body
};
