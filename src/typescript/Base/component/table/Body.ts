// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { ModelRecord } from "../../data/ModelRecord.js";
import { Row } from "./Row.js";
import { Event } from "../../Event.js";

const ROW_HEIGHT = 16;
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
    private lastColumnWidth: number = 0;
    private layoutInProgress = false;
    private storeRefresh: (() => void) | null = null;
    private selectedRecord: ModelRecord | null = null;

    constructor(store: AbstractStore) {
        super("tbody");

        this.setOverflow("auto");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");

        this.store = store;
        this.bindStore(store);
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
        this.phantom.style.height = records.length * ROW_HEIGHT + "px";

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
    renderWindow(bodyWidth?: number, columnWidth?: number) {
        const element = this.getElement();
        if (!element) return;

        const records = this.store.getRecords();
        const totalRows = records.length;

        const scrollTop = element.scrollTop;
        const visibleHeight = this.getHeight() || 0;
        const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - SCROLL_BUFFER);
        const lastRow = Math.min(
            totalRows - 1,
            Math.ceil((scrollTop + visibleHeight) / ROW_HEIGHT) + SCROLL_BUFFER
        );
        const windowSize = lastRow - firstRow + 1 > 0 ? lastRow - firstRow + 1 : 0;

        if (bodyWidth !== undefined) {
            this.lastBodyWidth = bodyWidth;
            this.lastColumnWidth = columnWidth!;
            this.layoutInProgress = true;
        }

        // Grow pool if needed
        while (this.rowPool.length < windowSize) {
            const row = new Row(this.store.model);
            const rowEl = row.getElement(true);

            element.appendChild(rowEl);

            rowEl.addEventListener('click', () => this.selectRecord(row.getData() ?? null));

            this.rowPool.push(row);
            this.boundIndices.push(-1);
        }

        const rowWidth = this.lastBodyWidth;
        const colWidth = this.lastColumnWidth || (rowWidth / this.store.model.getFields().length);

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
            row.setY(dataIndex * ROW_HEIGHT);
            row.setWidth(rowWidth);
            row.setHeight(ROW_HEIGHT);
            row.setAutoCommitStyle(true);
            row.setDisplayed(true);

            const cells = row.getComponents();
            let x = 0;

            for (const cell of cells) {
                cell.setAutoCommitStyle(false);
                cell.setX(x);
                cell.setY(0);
                cell.setWidth(colWidth);
                cell.setHeight(ROW_HEIGHT);
                cell.setAutoCommitStyle(true);
                cell.doLayout();

                x += colWidth;
            }
        }

        // Hide excess pool rows
        for (let i = windowSize; i < this.rowPool.length; i++) {
            this.rowPool[i].setDisplayed(false);
            this.boundIndices[i] = -1;
        }

        // Keep phantom height in sync
        if (this.phantom) {
            this.phantom.style.height = totalRows * ROW_HEIGHT + "px";
        }

        this.layoutInProgress = false;
    }

    /**
     * Sets the selected record and updates the visual state of affected pool rows.
     *
     * @param record - The record to select, or null to clear the selection.
     */
    selectRecord(record: ModelRecord | null): void {
        const prev = this.selectedRecord;
        const records = this.store.getRecords();

        this.selectedRecord = record;

        this.boundIndices.forEach((dataIdx, i) => {
            if (dataIdx === -1) {
                return;
            }

            const r = records[dataIdx];

            if (r === prev || r === record) {
                this.updateRowVisualState(i);
            }
        });
    }

    /**
     * Returns the currently selected record, or null if none is selected.
     *
     * @returns The selected {@link ModelRecord}, or null.
     */
    getSelectedRecord(): ModelRecord | null {
        return this.selectedRecord;
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

        el.scrollTop = idx * ROW_HEIGHT;
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

        if (record === this.selectedRecord) {
            (this.rowPool[i].getElement() as HTMLElement).style.backgroundColor = 'rgba(30, 100, 200, 0.15)';
        } else {
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
