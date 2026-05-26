// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { Row } from "~/component/table/Row.js";
import { Cell } from "~/component/table/cell/Cell.js";
import { CellEditorPool } from "~/component/table/cell/editor/CellEditorPool.js";
import { Event } from "~/core/Event.js";
import { VirtualScroller } from "~/component/container/VirtualScroller.js";
import { ThemeManager } from "~/core/Theme.js";
import type { ColumnConfig } from "~/component/table/ColumnConfig.js";
import type { Header } from "~/component/table/Header.js";
import type { HeaderCell } from "~/component/table/cell/Header.js";
import { callable } from "~/core/Callable.js";

const SCROLL_BUFFER = 2;

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
    private _columnConfigs   : Map<string, ColumnConfig> = new Map();
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
     * Derives the row height from the active theme's body font: one line-box
     * (font-size × line-height) plus top+bottom cell padding.
     *
     * @remarks `theme.table.cell.height` is intentionally ignored: a fixed pixel
     * height ignores the active font size and clips text when the theme bumps
     * `font.size`. Deriving here keeps row height in sync with whatever font
     * the cells are actually rendered at.
     */
    private computeRowHeight(): number {
        const theme      = ThemeManager.getTheme();
        const fontSize   = parseFloat(theme.font.size) || 14;
        const lineHeight = theme.font.lineHeight       || 1.2;
        const padding    = theme.table.cell.padding    ?? 2;

        return Math.ceil(fontSize * lineHeight) + 2 * padding;
    }

    /**
     * Subscribes to all relevant store events to trigger a renderWindow refresh.
     *
     * @param store - The store whose events to subscribe to.
     */
    private bindStore(store: AbstractStore): void {
        const refresh = () => { this._boundIndices.fill(-1); this.renderWindow(); };

        this._storeRefresh = refresh;

        store.on('load', refresh);
        store.on('add', refresh);
        store.on('remove', refresh);
        store.on('datachanged', refresh);
        store.on('beforesync', refresh);
        store.on('sync', refresh);
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
     * Updates the set of hidden column field names, clears the row pool, and re-renders.
     *
     * @param hidden - The new set of field names to hide.
     */
    setHiddenColumns(hidden: Set<string>): this {
        this._hiddenColumns = new Set(hidden);
        this.clearRowPool();
        this.renderWindow();

        return this;
    }

    setColumnConfigs(configs: Map<string, ColumnConfig>): this {
        this._columnConfigs = configs;
        this.clearRowPool();
        this.renderWindow();

        return this;
    }

    /**
     * Removes all pooled row elements from the DOM and resets the pool arrays.
     */
    private clearRowPool(): void {
        const container = this._scroller ? this._scroller.getRowsContainer() : null;

        for (const row of this._rowPool) {
            // Release the compositor layer hint while the element is still attached
            // so the DOM write commits — once detached, the queued style flush is
            // moot because the row is about to be discarded.
            row.setWillChange(null);

            const rowEl = row.getElement();

            if (container && rowEl?.parentNode === container) {
                container.removeChild(rowEl);
            }
        }

        this._rowPool = [];
        this._boundIndices = [];
        this._rowGeom = [];
        this._cellGeom = [];
        this._rowDisplayed = [];
        this._lastAriaRowCount = -1;
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
        this._boundIndices.fill(-1);
        this.invalidateGeom();

        if (this.getElement()) {
            this.renderWindow();
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

        this._scroller = new VirtualScroller(this, el, () => this.renderWindow());

        Event.addListener(this, "focus", () => {
            this._updateActiveDescendant();
            this._updateFocusStyle();
        });

        Event.addListener(this, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));

        // One subtree click listener replaces the per-row listener that
        // growRowPool used to install. Walk up from the event target to find
        // the matching pool row; identical complexity per click, one window
        // registration regardless of pool size.
        Event.addSubtreeListener(this, "click", (e: MouseEvent) => {
            let node: HTMLElement | null = e.target as HTMLElement | null;

            while (node) {
                const row = this._rowPool.find(r => r.getElement() === node);

                if (row) {
                    this.onRowClick(row, e);
                    return;
                }

                node = node.parentElement;
            }
        });

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
        const records   = this._store.getRecords();
        const totalRows = records.length;

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
            const row = new Row(
                this._store.model,
                undefined,
                this._hiddenColumns,
                this._columnConfigs,
                (record) => this._store.notifyRecordChanged(record),
            );

            for (const cell of row.getComponents() as Cell<any>[]) {
                cell.setEditorPool(this._editorPool);
            }

            const rowEl = row.getElement(true);

            growFragment.appendChild(rowEl);

            // Click handler is a single subtree listener on Body.init(); see
            // there for the row-lookup walk.

            // Pin row's static top to 0 once. Per-frame Y offset comes from translateY,
            // which is composite-only (avoids layout/paint per scroll tick).
            row.setY(0);

            // Pre-promote pooled rows to their own compositor layer so the first
            // scroll-driven translate doesn't pay a layer-creation cost. Cleared
            // in clearRowPool when the row leaves the pool.
            row.setWillChange("transform");

            this._rowPool.push(row);
            this._boundIndices.push(-1);
            this._rowGeom.push(null);
            this._cellGeom.push([]);
            this._rowDisplayed.push(false);
        }

        rowsContainer.appendChild(growFragment);
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
     */
    private bindAndPositionRows(firstRow: number, windowSize: number, rowWidth: number, fallback: number, records: ModelRecord[]): void {
        const rowHeight = this._rowHeight;

        for (let i = 0; i < windowSize; i++) {
            const row = this._rowPool[i];
            const dataIndex = firstRow + i;
            const wasRebound = this._boundIndices[i] !== dataIndex;

            if (wasRebound) {
                row.setData(records[dataIndex]);

                this._boundIndices[i] = dataIndex;
                this.updateRowVisualState(i);
                row.getAria().setRowIndex(dataIndex + 2);
            }

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
     * Handles a row click, updating selection with support for ctrl/cmd and shift modifiers.
     *
     * @param row - The pool row that was clicked.
     * @param e - The mouse event.
     */
    private onRowClick(row: Row, e: MouseEvent): void {
        const record = row.getData() ?? null;
        if (!record) return;

        const records = this._store.getRecords();

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

            if (cellEl && (cellEl === e.target || cellEl.contains(e.target as Node))) {
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
     * Scrolls the body so the given record is visible at the top.
     *
     * @param record - The record to scroll into view.
     */
    scrollToRecord(record: ModelRecord): void {
        const idx = this._store.getRecords().indexOf(record);
        if (idx === -1) {
            return;
        }

        this.setScrollY(idx * this._rowHeight);
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

        const record = this._store.getRecords()[dataIdx];
        if (!record) {
            return;
        }

        const row = this._rowPool[i];
        const rowEl = row.getElement() as HTMLElement;
        const isSelected = this._selectedRecords.has(record);

        if (isSelected) {
            rowEl.style.setProperty('background-color', 'var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15))');
            rowEl.style.setProperty('box-shadow', 'var(--ts-ui-table-row-selected-border, none)');
        } else {
            rowEl.style.removeProperty('box-shadow');
            row.updateVisualState();
        }

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
     * column indicator.
     */
    private _updateFocusStyle(): void {
        for (const row of this._rowPool) {
            for (const cell of row.getComponents()) {
                const el = cell.getElement() as HTMLElement | null;

                if (el) {
                    el.style.removeProperty("outline");
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

        const anchorIdx = this._store.getRecords().indexOf(this._anchorRecord);
        const poolSlotIdx = this._boundIndices.indexOf(anchorIdx);

        if (poolSlotIdx < 0) {
            return;
        }

        const cells = this._rowPool[poolSlotIdx].getComponents();
        const cell = cells[this._focusedColIndex];

        if (cell) {
            const el = cell.getElement() as HTMLElement | null;

            if (el) {
                el.style.setProperty("outline", "var(--ts-ui-indicator-selection, 1px dashed rgb(120, 170, 240))");
                el.style.setProperty("outline-offset", "-1px");
            }
        }
    }

    /**
     * Sets `aria-activedescendant` on the body container to point at the focused cell (or row).
     *
     * @remarks Must be called after `renderWindow()` so the pool slot for the anchor record is guaranteed in the DOM.
     */
    private _updateActiveDescendant(): void {
        if (!this._anchorRecord) {
            this.getAria().setActiveDescendant("");

            return;
        }

        const anchorIdx = this._store.getRecords().indexOf(this._anchorRecord);
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
     */
    private onKeyDown(e: KeyboardEvent): void {
        const records = this._store.getRecords();

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

                typedCell.setOnEditEnd(() => {
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
     */
    private scrollRecordIntoView(record: ModelRecord): void {
        const idx = this._store.getRecords().indexOf(record);

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
