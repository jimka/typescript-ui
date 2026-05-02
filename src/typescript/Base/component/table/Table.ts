// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { LayoutConstraints } from "../../layout/LayoutConstraints.js";
import { Table as TableLayout } from "../../layout/Table.js";
import { Header } from "./Header.js";
import { Body } from "./Body.js";
import { FooterRow } from "./Footer.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { ModelRecord } from "../../data/ModelRecord.js";
import { BorderStyle } from "../../BorderStyle.js";
import { Insets } from "../../Insets.js";

/**
 * A data-bound table component rendered as an HTML `<table>` element.
 *
 * Composes a {@link Header}, a virtual-scrolling {@link Body}, and an optional
 * {@link FooterRow}. Exposes CRUD and sync operations that delegate to the underlying
 * {@link AbstractStore}.
 */
export class Table extends Component {

    private store: AbstractStore;
    private headerVisible: boolean;
    private header: Header;
    private body: Body;
    private bodyVisible: boolean;
    private footer: FooterRow;
    private footerVisible: boolean;
    private columnWidths: number[] = [];

    constructor(store: AbstractStore) {
        super("table");

        this.setLayoutManager(new TableLayout());
        this.setBorder({ style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-border-color, black)" });
        this.setInsets(new Insets(0, 0, 0, 0));

        this.store = store;
        this.headerVisible = true;
        this.bodyVisible = true;
        this.footerVisible = false;

        this.header = new Header(store.model, store);
        this.header.setOnColumnResize((i, d) => this.onColumnResize(i, d));
        this.addComponent(this.header);

        this.body = new Body(store);
        this.addComponent(this.body);

        this.footer = new FooterRow();
        this.addComponent(this.footer);
    }

    /**
     * Returns the data store this table is bound to.
     *
     * @returns The current {@link AbstractStore}.
     */
    getStore(): AbstractStore {
        return this.store;
    }

    /**
     * Returns the model associated with this table's store.
     *
     * @returns The {@link AbstractModel} from the store.
     */
    getModel() {
        return this.store.model;
    }

    /**
     * Replaces the data store, updates the body and header to reflect the new model.
     *
     * @param store - The new store to bind to the table.
     */
    setStore(store: AbstractStore): void {
        this.store = store;
        this.columnWidths = [];
        this.body.setStore(store);
        this.header.setModel(store.model);
    }

    /**
     * Returns the per-column width array maintained by the layout manager.
     *
     * @returns The current column widths in pixels.
     */
    getColumnWidths(): number[] {
        return this.columnWidths;
    }

    /**
     * Stores the per-column width array (called by the layout manager on each layout pass).
     *
     * @param widths - The new column widths in pixels.
     */
    setColumnWidths(widths: number[]): void {
        this.columnWidths = widths;
    }

    private onColumnResize(colIndex: number, delta: number): void {
        const n = this.columnWidths.length;

        if (n === 0 || colIndex >= n - 1) {
            return; // last column: no-op
        }

        const MIN = 30;

        let w0 = this.columnWidths[colIndex] + delta;
        let w1 = this.columnWidths[colIndex + 1] - delta;

        if (w0 < MIN) {
            w1 += w0 - MIN;
            w0 = MIN;
        }

        if (w1 < MIN) {
            w0 += w1 - MIN;
            w1 = MIN;
        }

        if (w0 < MIN) {
            return;
        }

        this.columnWidths[colIndex]     = w0;
        this.columnWidths[colIndex + 1] = w1;

        this.doLayout();
    }

    /**
     * Returns the table header component.
     *
     * @returns The {@link Header} section of this table.
     */
    getHeader() {
        return this.header;
    }

    /**
     * Returns whether the header section is visible.
     *
     * @returns True if the header is visible.
     */
    isHeaderVisible() {
        return this.headerVisible;
    }

    /**
     * Returns the table body component.
     *
     * @returns The virtual-scrolling {@link Body} section of this table.
     */
    getBody() {
        return this.body;
    }

    /**
     * Returns whether the body section is visible.
     *
     * @returns True if the body is visible.
     */
    isBodyVisible() {
        return this.bodyVisible;
    }

    /**
     * Returns the table footer component.
     *
     * @returns The {@link FooterRow} section of this table.
     */
    getFooter() {
        return this.footer;
    }

    /**
     * Returns whether the footer section is visible.
     *
     * @returns True if the footer is visible.
     */
    isFooterVisible() {
        return this.footerVisible;
    }

    /**
     * Adds a new record to the store, scrolls to it, and selects it.
     *
     * @param defaults - Optional. Initial field values for the new record.
     *
     * @returns The newly created {@link ModelRecord}.
     */
    addRow(defaults: Record<string, any> = {}): ModelRecord {
        const [record] = this.store.add(defaults);
        this.body.scrollToRecord(record);
        this.body.selectRecord(record);
        return record;
    }

    /**
     * Removes the currently selected record from the store.
     */
    removeSelectedRow(): void {
        const record = this.body.getSelectedRecord();

        if (!record) {
            return;
        }

        this.body.selectRecord(null);
        this.store.remove(record);
    }

    /**
     * Persists all pending store changes to the server via the configured proxy.
     *
     * @returns A Promise that resolves when the sync operation completes.
     */
    async sync(): Promise<void> {
        return this.store.sync();
    }

    /**
     * Returns the currently selected record, or null if none is selected.
     *
     * @returns The selected {@link ModelRecord}, or null.
     */
    getSelectedRecord(): ModelRecord | null {
        return this.body.getSelectedRecord();
    }

    /**
     * Returns all currently selected records.
     *
     * @returns An array of selected {@link ModelRecord} instances.
     */
    getSelectedRecords(): ModelRecord[] {
        return this.body.getSelectedRecords();
    }

    /**
     * Adds a header, body, or footer section component, updating the stored reference.
     *
     * @param row - The section component to add.
     * @param constraints - Optional. Layout constraints for the section.
     */
    addComponent(row: Header | Body | FooterRow, constraints?: LayoutConstraints) {
        if (row instanceof Header) {
            this.header = row;
        } else if (row instanceof Body) {
            this.body = row;
        } else if (row instanceof FooterRow) {
            this.footer = row;
        }

        super.addComponent(row, constraints);
    }
}
