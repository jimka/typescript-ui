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

    getStore(): AbstractStore {
        return this.store;
    }

    getModel() {
        return this.store.model;
    }

    setStore(store: AbstractStore): void {
        this.store = store;
        this.body.setStore(store);
        this.header.setModel(store.model);
    }

    getHeader() {
        return this.header;
    }

    isHeaderVisible() {
        return this.headerVisible;
    }

    getBody() {
        return this.body;
    }

    isBodyVisible() {
        return this.bodyVisible;
    }

    getFooter() {
        return this.footer;
    }

    isFooterVisible() {
        return this.footerVisible;
    }

    addRow(defaults: Record<string, any> = {}): ModelRecord {
        const [record] = this.store.add(defaults);
        this.body.scrollToRecord(record);
        this.body.selectRecord(record);
        return record;
    }

    removeSelectedRow(): void {
        const record = this.body.getSelectedRecord();

        if (!record) {
            return;
        }

        this.body.selectRecord(null);
        this.store.remove(record);
    }

    async sync(): Promise<void> {
        return this.store.sync();
    }

    getSelectedRecord(): ModelRecord | null {
        return this.body.getSelectedRecord();
    }

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
