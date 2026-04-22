import { Component } from "../../Component.js";
import { Model } from "./model/Model.js";
import { Row } from "./Row.js";
import { Event } from "../../Event.js";

const ROW_HEIGHT = 16;
const SCROLL_BUFFER = 2;

export class Body extends Component {

    private model: Model;
    private allData: Map<String, any>[] = [];
    private rowPool: Row[] = [];
    private phantom: HTMLElement | null = null;
    private lastBodyWidth: number = 0;
    private lastColumnWidth: number = 0;

    constructor(model: Model) {
        super("tbody");

        this.setOverflow("auto");
        this.setBackgroundColor("rgb(255, 255, 255)");

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

        Event.addListener(this, "scroll", () => this.renderWindow());

        this.renderWindow();
    }

    addRow(data: Map<String, any>) {
        this.allData.push(data);

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

        // Grow pool if needed
        while (this.rowPool.length < windowSize) {
            const row = new Row(this.model);
            const rowEl = row.getElement(true);
            element.appendChild(rowEl);
            this.rowPool.push(row);
        }

        if (bodyWidth !== undefined) this.lastBodyWidth = bodyWidth;
        if (columnWidth !== undefined) this.lastColumnWidth = columnWidth;

        const rowWidth = this.lastBodyWidth;
        const colWidth = this.lastColumnWidth || (rowWidth / this.model.getFields().length);

        // Bind and position visible rows
        for (let i = 0; i < windowSize; i++) {
            const row = this.rowPool[i];
            const dataIndex = firstRow + i;

            row.setData(this.allData[dataIndex]);
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
        }

        // Keep phantom height in sync
        if (this.phantom) {
            this.phantom.style.height = this.allData.length * ROW_HEIGHT + "px";
        }
    }

    sortColumns() {
        // No longer applicable — column order is fixed by field order in renderWindow
    }

    sortRows() {
        throw Error("Not implemented yet.");
    }
}
