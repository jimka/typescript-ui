// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { ModelRecord } from "../../data/ModelRecord.js";
import { Row } from "./Row.js";
import { Event } from "../../Event.js";
import { ThemeManager } from "../../Theme.js";

const SCROLL_BUFFER = 2;

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
 * `renderWindow()` is the single entry point for both layout-manager-driven
 * updates (resize) and scroll-event-driven updates. The `layoutInProgress` flag
 * suppresses the spurious scroll event that the browser fires when the body
 * height changes during layout.
 *
 * Known limitation: the browser's GPU compositor scrolls content visually
 * before the JS scroll event reaches the main thread, causing a one-frame
 * flicker during fast scrolling. Eliminating it would require a transform-based
 * positioning strategy rather than `position: absolute; top: dataIndex * ROW_HEIGHT`.
 */
export class Body extends Component {

    private store: AbstractStore;
    private rowPool: Row[] = [];
    private boundIndices: number[] = [];
    private phantom: HTMLElement | null = null;
    private lastBodyWidth: number = 0;
    private lastColumnWidths: number[] = [];
    private rowHeight: number;
    private layoutInProgress = false;
    private storeRefresh: (() => void) | null = null;
    private selectedRecords: Set<ModelRecord> = new Set();
    private anchorRecord: ModelRecord | null = null;

    constructor(store: AbstractStore) {
        super("tbody");

        this.setOverflow("auto");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");

        this.store = store;
        this.bindStore(store);

        this.rowHeight = parseFloat(ThemeManager.getTheme().table.cell.height) || 22;

        ThemeManager.onThemeChange(() => {
            this.rowHeight = parseFloat(ThemeManager.getTheme().table.cell.height) || 22;
            this.boundIndices.fill(-1);
            this.renderWindow();
        });
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
     * Swaps the store, unsubscribing from the old one and rebinding to the new one.
     *
     * @param store - The new store to bind to the body.
     */
    setStore(store: AbstractStore): void {
        if (this.storeRefresh) {
            const old = this.store;

            (['load', 'add', 'remove', 'datachanged', 'beforesync', 'sync'] as const).forEach(e =>
                old.off(e, this.storeRefresh!)
            );
        }

        this.store = store;
        this.bindStore(store);
        this.boundIndices.fill(-1);

        if (this.getElement()) {
            this.renderWindow();
        }
    }

    /**
     * Initializes the body element, creates the phantom height div, and attaches the scroll listener.
     *
     * @param element - Optional. The HTMLElement to initialize with; falls back to `getElement()`.
     */
    protected init(element?: HTMLElement) {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return;
        }

        const records = this.store.getRecords();

        this.phantom = document.createElement("div");
        this.phantom.style.position = "absolute";
        this.phantom.style.top = "0";
        this.phantom.style.width = "1px";
        this.phantom.style.height = records.length * this.rowHeight + "px";

        el.appendChild(this.phantom);

        Event.addListener(this, "scroll", () => {
            if (this.layoutInProgress) return;
            this.renderWindow();
        });

        this.renderWindow();
    }

    /**
     * Recomputes the visible row window, rebinds changed rows from the pool, and hides excess rows.
     *
     * @param bodyWidth - Optional. The total body width in pixels; cached and reused on scroll updates.
     * @param columnWidth - Optional. The per-column width in pixels; derived from bodyWidth when omitted.
     *
     * @remarks When called with width arguments (layout pass) the `layoutInProgress` flag is set to
     * suppress the spurious scroll event the browser fires when the phantom element's height changes.
     */
    renderWindow(bodyWidth?: number, columnWidths?: number[]) {
        const element = this.getElement();
        if (!element) {
            return;
        }

        const rowHeight = this.rowHeight;
        const records = this.store.getRecords();
        const totalRows = records.length;

        const scrollTop = element.scrollTop;
        const visibleHeight = this.getHeight() || 0;
        const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - SCROLL_BUFFER);
        const lastRow = Math.min(
            totalRows - 1,
            Math.ceil((scrollTop + visibleHeight) / rowHeight) + SCROLL_BUFFER
        );
        const windowSize = lastRow - firstRow + 1 > 0 ? lastRow - firstRow + 1 : 0;

        if (bodyWidth !== undefined) {
            this.lastBodyWidth = bodyWidth;
            this.lastColumnWidths = columnWidths ?? [];
            this.layoutInProgress = true;
        }

        // Grow pool if needed
        while (this.rowPool.length < windowSize) {
            const row = new Row(this.store.model);
            const rowEl = row.getElement(true);

            element.appendChild(rowEl);

            rowEl.addEventListener('click', (e: MouseEvent) => this.onRowClick(row, e));

            this.rowPool.push(row);
            this.boundIndices.push(-1);
        }

        const rowWidth = this.lastBodyWidth;
        const fieldCount = this.store.model.getFields().length;
        const fallback = fieldCount > 0 ? rowWidth / fieldCount : rowWidth;

        // Bind and position visible rows
        for (let i = 0; i < windowSize; i++) {
            const row = this.rowPool[i];
            const dataIndex = firstRow + i;

            if (this.boundIndices[i] !== dataIndex) {
                row.setData(records[dataIndex]);

                this.boundIndices[i] = dataIndex;
                this.updateRowVisualState(i);
            }

            row.setAutoCommitStyle(false);
            row.setX(0);
            row.setY(dataIndex * rowHeight);
            row.setWidth(rowWidth);
            row.setHeight(rowHeight);
            row.setAutoCommitStyle(true);
            row.setDisplayed(true);

            const cells = row.getComponents();
            let x = 0;

            for (let ci = 0; ci < cells.length; ci++) {
                const cell = cells[ci];
                const colW = this.lastColumnWidths[ci] ?? fallback;

                cell.setAutoCommitStyle(false);
                cell.setX(x);
                cell.setY(0);
                cell.setWidth(colW);
                cell.setHeight(rowHeight);
                cell.setAutoCommitStyle(true);
                cell.doLayout();

                x += colW;
            }
        }

        // Hide excess pool rows
        for (let i = windowSize; i < this.rowPool.length; i++) {
            this.rowPool[i].setDisplayed(false);
            this.boundIndices[i] = -1;
        }

        // Keep phantom height in sync
        if (this.phantom) {
            this.phantom.style.height = totalRows * rowHeight + "px";
        }

        this.layoutInProgress = false;
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

        const el = this.getElement() as HTMLElement;

        if (!el) {
            return;
        }

        el.scrollTop = idx * this.rowHeight;
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

        const rowEl = this.rowPool[i].getElement() as HTMLElement;

        if (this.selectedRecords.has(record)) {
            rowEl.style.setProperty('background-color', 'var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15))');
            rowEl.style.setProperty('box-shadow', 'var(--ts-ui-table-row-selected-border, none)');
        } else {
            rowEl.style.removeProperty('box-shadow');
            this.rowPool[i].updateVisualState();
        }
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
}
