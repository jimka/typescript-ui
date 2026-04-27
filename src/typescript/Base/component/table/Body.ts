// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { Model } from "../../data/Model.js";
import { ModelRecord } from "../../data/ModelRecord.js";
import { Row } from "./Row.js";
import { Event } from "../../Event.js";

const ROW_HEIGHT = 16;
const SCROLL_BUFFER = 2;

/**
 * Virtual-scrolling body for the Table component.
 *
 * Only the rows visible in the viewport plus SCROLL_BUFFER rows above and below
 * are ever in the DOM. The full dataset is stored in `allData`; a phantom <div>
 * gives the <tbody> the correct total scroll height so the scrollbar behaves as
 * if all rows were rendered.
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

    private model: Model;
    private allData: ModelRecord[] = [];
    private rowPool: Row[] = [];
    private boundIndices: number[] = [];
    private phantom: HTMLElement | null = null;
    private lastBodyWidth: number = 0;
    private lastColumnWidth: number = 0;
    private layoutInProgress = false;

    constructor(model: Model) {
        super("tbody");

        this.setOverflow("auto");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");

        this.model = model;
    }

    protected init(element?: HTMLElement) {
        super.init(element);

        const el = element || this.getElement();
        if (!el) return;

        this.phantom = document.createElement("div");
        this.phantom.style.position = "absolute";
        this.phantom.style.top = "0";
        this.phantom.style.width = "1px";
        this.phantom.style.height = this.allData.length * ROW_HEIGHT + "px";
        el.appendChild(this.phantom);

        Event.addListener(this, "scroll", () => {
            if (this.layoutInProgress) return;
            this.renderWindow();
        });

        this.renderWindow();
    }

    addRow(record: ModelRecord) {
        this.allData.push(record);

        if (this.phantom) {
            this.phantom.style.height = this.allData.length * ROW_HEIGHT + "px";
        }

        if (this.getElement()) {
            this.renderWindow();
        }
    }

    renderWindow(bodyWidth?: number, columnWidth?: number) {
        const element = this.getElement();
        if (!element) return;

        const scrollTop = element.scrollTop;
        const visibleHeight = this.getHeight() || 0;
        const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - SCROLL_BUFFER);
        const lastRow = Math.min(
            this.allData.length - 1,
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
            const row = new Row(this.model);
            const rowEl = row.getElement(true);
            element.appendChild(rowEl);
            this.rowPool.push(row);
            this.boundIndices.push(-1);
        }

        const rowWidth = this.lastBodyWidth;
        const colWidth = this.lastColumnWidth || (rowWidth / this.model.getFields().length);

        // Bind and position visible rows
        for (let i = 0; i < windowSize; i++) {
            const row = this.rowPool[i];
            const dataIndex = firstRow + i;

            if (this.boundIndices[i] !== dataIndex) {
                row.setData(this.allData[dataIndex]);
                this.boundIndices[i] = dataIndex;
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
            this.phantom.style.height = this.allData.length * ROW_HEIGHT + "px";
        }

        this.layoutInProgress = false;
    }

    sortColumns() {
        // No longer applicable — column order is fixed by field order in renderWindow
    }

    sortRows() {
        throw Error("Not implemented yet.");
    }
}
