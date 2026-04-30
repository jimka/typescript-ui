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

    constructor(store: AbstractStore) {
        super("table");

        this.setLayoutManager(new TableLayout());
        this.setBorder({ style: BorderStyle.SOLID, width: 1, color: "rgb(0, 0, 0)" });
        this.setInsets(new Insets(0, 0, 0, 0));

        this.store = store;
        this.headerVisible = true;
        this.bodyVisible = true;
        this.footerVisible = false;

        this.header = new Header(store.model);
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
        this.body.setStore(store);
        this.header.setModel(store.model);
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
