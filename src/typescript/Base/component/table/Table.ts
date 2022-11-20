import { Component } from "../../Component.js";
import { LayoutConstraints } from "../../layout/LayoutConstraints.js";
import { Table as TableLayout } from "../../layout/Table.js";
import { Header } from "./Header.js";
import { Body } from "./Body.js";
import { FooterRow } from "./Footer.js";
import { Model } from "./model/Model.js";
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

    constructor(model: Model, rows?: Map<String, any> | Array<Map<String, any>>) {
        super("table");

        this.setLayoutManager(new TableLayout());
        this.setBorder(BorderStyle.SOLID, 1, "rgb(0, 0, 0)");
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

    addRow(row: Map<String, any>) {
        this.body.addRow(row);
    }

    addRows(rows: Map<String, any> | Array<Map<String, any>>) {
        if (!(rows instanceof Array)) {
            rows = new Array<Map<String, any>>(rows);
        }

        for (let idx in rows) {
            let row = rows[idx];
            this.body.addRow(row);
        }
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