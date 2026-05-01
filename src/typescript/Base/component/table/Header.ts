// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { Row } from "./Row.js";
import { AbstractModel } from "../../data/AbstractModel.js";
import { Field } from "../../data/Field.js";
import { HeaderCell } from "./cell/Header.js";
import { BorderStyle } from "../../BorderStyle.js";

/**
 * The header section of a table, rendered as a `<thead>` element.
 *
 * Builds one {@link HeaderCell} per field from the supplied model and delegates
 * width/height changes to the inner row.
 */
export class Header extends Component {

    private model: AbstractModel;

    constructor(model: AbstractModel) {
        super("thead");

        this.setBorder({ bottom: { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-table-header-border, black)" } });
        this.setBackgroundImage("var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))");

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

    /**
     * Returns the model driving this header's columns.
     *
     * @returns The {@link AbstractModel} currently bound to this header.
     */
    getModel() {
        return this.model;
    }

    /**
     * Replaces the model, rebuilding header cells only when the field list changes.
     *
     * @param model - The new model to bind to the header.
     *
     * @remarks If the new model has the same fields in the same order as the current model,
     * the existing cells are left in place and no DOM work is performed.
     */
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

    /**
     * Returns the header cell components in column order.
     *
     * @returns An array of cell components from the header's inner row.
     */
    getColumns() {
        return this.getComponents()[0].getComponents();
    }

    /**
     * Reorders header cells by field order using their layout constraints.
     */
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

    /**
     * Appends a row to the header.
     *
     * @param row - The row to append.
     */
    addRow(row: Row) {
        this.addComponent(row);
    }

    /**
     * Adds a row as a child component of the header.
     *
     * @param row - The row component to add.
     */
    addComponent(row: Row) {
        super.addComponent(row);
    }

    /**
     * Sets the header width and propagates it to the inner row.
     *
     * @param width - The width in pixels.
     */
    setWidth(width: number) {
        super.setWidth(width);

        this.getComponents()[0].setWidth(width);
    }

    /**
     * Sets the header height and propagates it to the inner row.
     *
     * @param height - The height in pixels.
     */
    setHeight(height: number) {
        super.setHeight(height);

        this.getComponents()[0].setHeight(height);
    }
}
