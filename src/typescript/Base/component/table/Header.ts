// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { Row } from "./Row.js";
import { AbstractModel } from "../../data/AbstractModel.js";
import { Field } from "../../data/Field.js";
import { HeaderCell } from "./cell/Header.js";
import { BorderStyle } from "../../BorderStyle.js";

export class Header extends Component {

    private model: AbstractModel;

    constructor(model: AbstractModel) {
        super("thead");

        this.setBorder({ bottom: { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-table-header-border, black)" } });
        this.setBackgroundImage("linear-gradient(var(--ts-ui-button-bg-top, rgb(241, 241, 241)), var(--ts-ui-button-bg-bottom, rgb(200, 200, 200)))");

        let row = new Row();
        this.addRow(row);

        if (model) {
            let fields = model.getFields();
            fields.sort((f1, f2) => f1.getOrder() - f2.getOrder());

            for (let idx in fields) {
                let field = fields[idx];

                let headerCell = new HeaderCell(field.getDescription());
                row.addComponent(headerCell, {
                    data: field
                });
            }
        }

        this.model = model;
    }

    getModel() {
        return this.model;
    }

    setModel(model: AbstractModel): void {
        const oldNames = this.model.getFields()
                                   .slice()
                                   .sort((a, b) => a.getOrder() - b.getOrder())
                                   .map(f => f.getName());

        const newNames = model.getFields()
                              .slice()
                              .sort((a, b) => a.getOrder() - b.getOrder())
                              .map(f => f.getName());

        const same = oldNames.length === newNames.length
                     && oldNames.every((n, i) => n === newNames[i]);

        if (same) {
            return;
        }

        this.model = model;

        const row = this.getComponents()[0] as Row;
        row.removeAllComponents();

        const fields = model.getFields()
                            .slice()
                            .sort((a, b) => a.getOrder() - b.getOrder());

        for (const field of fields) {
            row.addComponent(new HeaderCell(field.getDescription()), { data: field });
        }
    }

    getColumns() {
        return this.getComponents()[0].getComponents();
    }

    sortColumns() {
        let row = this.getComponents()[0];

        row.sortComponents((c1, c2) => {
            let lc1 = row.getLayoutConstraints(c1);
            let lc2 = row.getLayoutConstraints(c2);

            if (!lc1) {
                return -1;
            }

            if (!lc2) {
                return 1;
            }

            return (lc1.data as Field).getOrder() - (lc2.data as Field).getOrder();
        });
    }

    addRow(row: Row) {
        this.addComponent(row);
    }

    addComponent(row: Row) {
        super.addComponent(row);
    }

    setWidth(width: number) {
        super.setWidth(width);

        this.getComponents()[0].setWidth(width);
    }

    setHeight(height: number) {
        super.setHeight(height);

        this.getComponents()[0].setHeight(height);
    }
}
