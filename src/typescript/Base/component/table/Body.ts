// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { ModelRecord } from "../../data/ModelRecord.js";
import { Row } from "./Row.js";
import { Cell } from "./cell/Cell.js";
import { Event } from "../../Event.js";
import { VirtualScroller } from "../VirtualScroller.js";
import { ThemeManager } from "../../Theme.js";
import type { ColumnConfig } from "./ColumnConfig.js";
import { callable } from "../../Callable.js";

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

    private store           : AbstractStore;
    private hiddenColumns   : Set<string>               = new Set();
    private columnConfigs   : Map<string, ColumnConfig> = new Map();
    private rowPool         : Row[]                     = [];
    private boundIndices    : number[]                  = [];
    private rowGeom         : Array<{ ty: number, w: number, h: number } | null> = [];
    private cellGeom        : Array<Array<{ x: number, w: number, h: number } | null>> = [];
    private rowDisplayed    : boolean[]                 = [];
    private scroller        : VirtualScroller | null    = null;
    private lastBodyWidth   : number                    = 0;
    private lastColumnWidths: number[]                  = [];
    private lastAriaRowCount: number                    = -1;
    private rowHeight       : number;
    private storeRefresh    : (() => void) | null       = null;
    private selectedRecords : Set<ModelRecord>          = new Set();
    private anchorRecord    : ModelRecord | null        = null;
    private _focusedColIndex: number                    = 0;

    constructor(store: AbstractStore) {
        super({ tag: "tbody" });

        this.setOverflow("hidden");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.getAria().setTabIndex(0);
        this.getAria().setRole("rowgroup");

        this.store = store;
        this.bindStore(store);

        this.rowHeight = this.computeRowHeight();

        ThemeManager.onThemeChange(() => {
            this.rowHeight = this.computeRowHeight();
            this.boundIndices.fill(-1);
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
        const refresh = () => { this.boundIndices.fill(-1); this.renderWindow(); };

        this.storeRefresh = refresh;

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
        for (let i = 0; i < this.rowGeom.length; i++) {
            this.rowGeom[i] = null;
        }
        for (let i = 0; i < this.cellGeom.length; i++) {
            this.cellGeom[i] = [];
        }
    }

    /**
     * Updates the set of hidden column field names, clears the row pool, and re-renders.
     *
     * @param hidden - The new set of field names to hide.
     */
    setHiddenColumns(hidden: Set<string>): this {
        this.hiddenColumns = new Set(hidden);
        this.clearRowPool();
        this.renderWindow();

        return this;
    }

    setColumnConfigs(configs: Map<string, ColumnConfig>): this {
        this.columnConfigs = configs;
        this.clearRowPool();
        this.renderWindow();

        return this;
    }

    /**
     * Removes all pooled row elements from the DOM and resets the pool arrays.
     */
    private clearRowPool(): void {
        const container = this.scroller ? this.scroller.getRowsContainer() : null;

        if (container) {
            for (const row of this.rowPool) {
                const rowEl = row.getElement();

                if (rowEl?.parentNode === container) {
                    container.removeChild(rowEl);
                }
            }
        }

        this.rowPool = [];
        this.boundIndices = [];
        this.rowGeom = [];
        this.cellGeom = [];
        this.rowDisplayed = [];
        this.lastAriaRowCount = -1;
    }

    /**
     * Swaps the store, unsubscribing from the old one and rebinding to the new one.
     *
     * @param store - The new store to bind to the body.
     */
    setStore(store: AbstractStore): this {
        if (this.storeRefresh) {
            const old = this.store;

            (['load', 'add', 'remove', 'datachanged', 'beforesync', 'sync'] as const).forEach(e =>
                old.off(e, this.storeRefresh!)
            );
        }

        this.store = store;
        this.bindStore(store);
        this.boundIndices.fill(-1);
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

        this.scroller = new VirtualScroller(this, el, () => this.renderWindow());

        Event.addListener(this, "focus", () => {
            this._updateActiveDescendant();
            this._updateFocusStyle();
        });

        Event.addListener(this, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));

        this.renderWindow();

        return this;
    }

    /**
     * Sets the JS-controlled vertical scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param y - The new scroll position in pixels.
     */
    setScrollY(y: number): this {
        this.scroller?.setScrollY(y);

        return this;
    }

    /**
     * Sets the JS-controlled horizontal scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param x - The new scroll position in pixels.
     */
    setScrollX(x: number): this {
        this.scroller?.setScrollX(x);

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
        if (!element || !this.scroller) {
            return;
        }

        const scroller = this.scroller;
        const records   = this.store.getRecords();
        const totalRows = records.length;

        this.updateColumnWidthCache(bodyWidth, columnWidths);

        // Loose-clamp scroll positions against the new content sizes before
        // reading them for the window calc.
        const totalHeight       = totalRows * this.rowHeight;
        const totalColumnWidth  = this.lastColumnWidths.reduce((s, w) => s + w, 0);
        const totalContentWidth = Math.max(this.lastBodyWidth, totalColumnWidth);

        scroller.clampToContent(totalContentWidth, totalHeight);

        const visibleHeight = this.getHeight() || 0;
        const win = this.computeVisibleWindow(scroller.getScrollY(), visibleHeight, totalRows);

        const poolTarget = this.computePoolTarget(win.windowSize, visibleHeight, totalRows);
        this.growRowPool(poolTarget);

        const rowWidth   = Math.max(this.lastBodyWidth, totalColumnWidth);
        const fieldCount = this.store.model.getFields()
                               .filter(f => !this.hiddenColumns.has(f.getName()))
                               .length;
        const fallback   = fieldCount > 0 ? rowWidth / fieldCount : rowWidth;

        this.bindAndPositionRows(win.firstRow, win.windowSize, rowWidth, fallback, records);
        this.hideExcessPoolRows(win.windowSize);

        if (totalRows !== this.lastAriaRowCount) {
            this.getAria().setRowCount(totalRows);
            this.lastAriaRowCount = totalRows;
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

        const widthsChanged = this.lastBodyWidth !== bodyWidth
            || !columnWidthsEqual(this.lastColumnWidths, columnWidths);

        this.lastBodyWidth = bodyWidth;
        this.lastColumnWidths = columnWidths ?? [];

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
        const rowHeight = this.rowHeight;
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
                Math.ceil(visibleHeight / this.rowHeight) + 2 * SCROLL_BUFFER + 2
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
        if (!this.scroller || this.rowPool.length >= poolTarget) {
            return;
        }

        const rowsContainer = this.scroller.getRowsContainer();
        const growFragment  = document.createDocumentFragment();

        while (this.rowPool.length < poolTarget) {
            const row = new Row(
                this.store.model,
                undefined,
                this.hiddenColumns,
                this.columnConfigs,
                (record) => this.store.notifyRecordChanged(record),
            );
            const rowEl = row.getElement(true);

            growFragment.appendChild(rowEl);

            rowEl.addEventListener('click', (e: MouseEvent) => this.onRowClick(row, e));

            // Pin row's static top to 0 once. Per-frame Y offset comes from translateY,
            // which is composite-only (avoids layout/paint per scroll tick).
            row.setY(0);

            this.rowPool.push(row);
            this.boundIndices.push(-1);
            this.rowGeom.push(null);
            this.cellGeom.push([]);
            this.rowDisplayed.push(false);
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
        const rowHeight = this.rowHeight;

        for (let i = 0; i < windowSize; i++) {
            const row = this.rowPool[i];
            const dataIndex = firstRow + i;
            const wasRebound = this.boundIndices[i] !== dataIndex;

            if (wasRebound) {
                row.setData(records[dataIndex]);

                this.boundIndices[i] = dataIndex;
                this.updateRowVisualState(i);
                row.getAria().setRowIndex(dataIndex + 2);
            }

            const targetY = dataIndex * rowHeight;
            const prev = this.rowGeom[i];
            if (!prev || prev.ty !== targetY || prev.w !== rowWidth || prev.h !== rowHeight) {
                row.setAutoCommitStyle(false);
                row.setX(0);
                row.setTranslate(0, targetY);
                row.setWidth(rowWidth);
                row.setHeight(rowHeight);
                row.setAutoCommitStyle(true);
                this.rowGeom[i] = { ty: targetY, w: rowWidth, h: rowHeight };
            }
            if (!this.rowDisplayed[i]) {
                row.setDisplayed(true);
                this.rowDisplayed[i] = true;
            }

            const cells = row.getComponents();
            const cellRow = this.cellGeom[i];
            let x = 0;

            for (let ci = 0; ci < cells.length; ci++) {
                const cell = cells[ci];
                const colW = this.lastColumnWidths[ci] ?? fallback;
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
        for (let i = windowSize; i < this.rowPool.length; i++) {
            if (this.rowDisplayed[i]) {
                this.rowPool[i].setDisplayed(false);
                this.rowDisplayed[i] = false;
            }
            this.boundIndices[i] = -1;
            this.rowGeom[i] = null;
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

        const records = this.store.getRecords();

        if (e.shiftKey && this.anchorRecord) {
            // Range select from anchor to clicked record
            const anchorIdx = records.indexOf(this.anchorRecord);
            const clickIdx  = records.indexOf(record);
            const lo = Math.min(anchorIdx, clickIdx);
            const hi = Math.max(anchorIdx, clickIdx);

            if (!e.ctrlKey && !e.metaKey) {
                this.selectedRecords.clear();
            }

            for (let i = lo; i <= hi; i++) {
                this.selectedRecords.add(records[i]);
            }
        } else if (e.ctrlKey || e.metaKey) {
            // Toggle individual record
            if (this.selectedRecords.has(record)) {
                this.selectedRecords.delete(record);
            } else {
                this.selectedRecords.add(record);
            }
            this.anchorRecord = record;
        } else {
            // Plain click — replace selection
            this.selectedRecords.clear();
            this.selectedRecords.add(record);
            this.anchorRecord = record;
        }

        this.boundIndices.forEach((dataIdx, i) => {
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
        this.selectedRecords.clear();
        this.anchorRecord = record;

        if (record) {
            this.selectedRecords.add(record);
        }

        this.boundIndices.forEach((dataIdx, i) => {
            if (dataIdx !== -1) this.updateRowVisualState(i);
        });
    }

    /**
     * Returns the most recently anchored selected record, or null if the selection is empty.
     *
     * @returns The anchor {@link ModelRecord}, or null.
     */
    getSelectedRecord(): ModelRecord | null {
        return this.anchorRecord && this.selectedRecords.has(this.anchorRecord)
            ? this.anchorRecord
            : (this.selectedRecords.size > 0 ? [...this.selectedRecords][0] : null);
    }

    /**
     * Returns all currently selected records.
     *
     * @returns An array of selected {@link ModelRecord} instances.
     */
    getSelectedRecords(): ModelRecord[] {
        return [...this.selectedRecords];
    }

    /**
     * Scrolls the body so the given record is visible at the top.
     *
     * @param record - The record to scroll into view.
     */
    scrollToRecord(record: ModelRecord): void {
        const idx = this.store.getRecords().indexOf(record);
        if (idx === -1) {
            return;
        }

        this.setScrollY(idx * this.rowHeight);
    }

    /**
     * Applies selection highlight or normal visual state to the pool row at index i.
     *
     * @param i - The zero-based index into the row pool.
     */
    private updateRowVisualState(i: number): void {
        const dataIdx = this.boundIndices[i];
        if (dataIdx === -1) {
            return;
        }

        const record = this.store.getRecords()[dataIdx];
        if (!record) {
            return;
        }

        const row = this.rowPool[i];
        const rowEl = row.getElement() as HTMLElement;
        const isSelected = this.selectedRecords.has(record);

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
     * Applies a focus ring to the cell at `_focusedColIndex` in the anchor row, clearing it from all other cells.
     *
     * @remarks Called after every navigation and after `renderWindow` re-binds pool slots.
     */
    private _updateFocusStyle(): void {
        for (const row of this.rowPool) {
            for (const cell of row.getComponents()) {
                const el = cell.getElement() as HTMLElement | null;

                if (el) {
                    el.style.removeProperty("outline");
                    el.style.removeProperty("outline-offset");
                }
            }
        }

        if (!this.anchorRecord) {
            return;
        }

        const anchorIdx = this.store.getRecords().indexOf(this.anchorRecord);
        const poolSlotIdx = this.boundIndices.indexOf(anchorIdx);

        if (poolSlotIdx < 0) {
            return;
        }

        const cells = this.rowPool[poolSlotIdx].getComponents();
        const cell = cells[this._focusedColIndex];

        if (cell) {
            const el = cell.getElement() as HTMLElement | null;

            if (el) {
                el.style.setProperty("outline", "2px solid var(--ts-ui-focus-ring, rgba(30, 100, 200, 0.6))");
                el.style.setProperty("outline-offset", "-2px");
            }
        }
    }

    /**
     * Sets `aria-activedescendant` on the body container to point at the focused cell (or row).
     *
     * @remarks Must be called after `renderWindow()` so the pool slot for the anchor record is guaranteed in the DOM.
     */
    private _updateActiveDescendant(): void {
        if (!this.anchorRecord) {
            this.getAria().setActiveDescendant("");

            return;
        }

        const anchorIdx = this.store.getRecords().indexOf(this.anchorRecord);
        const poolSlotIdx = this.boundIndices.indexOf(anchorIdx);

        if (poolSlotIdx < 0) {
            this.getAria().setActiveDescendant("");

            return;
        }

        const cells = this.rowPool[poolSlotIdx].getComponents();
        const cell = cells[this._focusedColIndex];

        if (cell) {
            this.getAria().setActiveDescendant(cell.getId());
        } else {
            this.getAria().setActiveDescendant(this.rowPool[poolSlotIdx].getId());
        }
    }

    /**
     * Handles keyboard navigation: ArrowUp/Down/Home/End move row selection; ArrowLeft/Right
     * move column focus; PageUp/Down move by a viewport-height page; Enter starts cell edit.
     *
     * @param e - The keyboard event fired on the body element.
     */
    private onKeyDown(e: KeyboardEvent): void {
        const records = this.store.getRecords();

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
            const visibleColCount = this.store.model.getFields()
                .filter(f => !this.hiddenColumns.has(f.getName())).length;

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
            if (!this.anchorRecord) {
                return;
            }

            const anchorIdx = records.indexOf(this.anchorRecord);
            const poolSlotIdx = this.boundIndices.indexOf(anchorIdx);

            if (poolSlotIdx < 0) {
                return;
            }

            const cells = this.rowPool[poolSlotIdx].getComponents();
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
        const currentIdx = this.anchorRecord ? records.indexOf(this.anchorRecord) : -1;
        const pageSize = Math.max(1, Math.floor((this.getHeight() || this.rowHeight) / this.rowHeight));
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
        const idx = this.store.getRecords().indexOf(record);

        if (idx === -1 || !this.scroller) {
            return;
        }

        const top            = idx * this.rowHeight;
        const bottom         = top + this.rowHeight;
        const scrollTop      = this.scroller.getScrollY();
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
