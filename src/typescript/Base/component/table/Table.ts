// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { LayoutConstraints } from "../../layout/LayoutConstraints.js";
import { Table as TableLayout } from "../../layout/Table.js";
import { Header } from "./Header.js";
import { Body } from "./Body.js";
import { FooterRow } from "./Footer.js";
import { Model } from "../../data/Model.js";
import { BorderStyle } from "../../BorderStyle.js";
import { Insets } from "../../Insets.js";

export class Table extends Component {

    private model: Model;
    private headerVisible: boolean;
    private header: Header;
    private body: Body;
    private bodyVisible: boolean;
    private footer: FooterRow;
    private footerVisible: boolean;

    constructor(model: Model, rows?: Record<string, any> | Array<Record<string, any>>) {
        super("table");

        this.setLayoutManager(new TableLayout());
        this.setBorder({ style: BorderStyle.SOLID, width: 1, color: "rgb(0, 0, 0)" });
        this.setInsets(new Insets(0, 0, 0, 0));

        this.model = model;
        this.headerVisible = true;
        this.bodyVisible = true;
        this.footerVisible = false;

        this.header = new Header(model);
        this.addComponent(this.header);

        this.body = new Body(model);
        this.addComponent(this.body);

        this.footer = new FooterRow();
        this.addComponent(this.footer);

        if (rows) {
            this.addRows(rows);
        }
    }

    getModel() {
        return this.model;
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

    addRow(data: Record<string, any> | any[]) {
        this.body.addRow(this.model.createRecord(this.normalizeRow(data)));
    }

    addRows(rows: Record<string, any> | Array<Record<string, any> | any[]>) {
        const rowArray = Array.isArray(rows) ? rows : [rows];
        for (const row of rowArray) {
            this.addRow(row);
        }
    }

    private normalizeRow(data: Record<string, any> | any[]): Record<string, any> {
        if (!Array.isArray(data)) {
            return data;
        }
        const fields = this.model.getFields().slice().sort((a, b) => a.getOrder() - b.getOrder());
        const record: Record<string, any> = {};
        fields.forEach((field, i) => {
            record[field.getName()] = data[i];
        });
        return record;
    }

    addComponent(row: Header | Body | FooterRow, constraints?: LayoutConstraints) {
        if (row instanceof Header) {
            this.header = row;
        } else if (row instanceof Body) {
            this.body = row;
        } else if (row instanceof FooterRow) {
            this.footer = row;
        } else {
            // The constraints is the model.
            this.addRow(row);

            return;
        }

        super.addComponent(row, constraints);
    }
}
