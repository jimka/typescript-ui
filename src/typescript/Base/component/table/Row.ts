// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { AbstractModel } from "../../data/AbstractModel.js";
import { ModelRecord } from "../../data/ModelRecord.js";
import { Cell } from "./cell/Cell.js";
import { DefaultCell } from "./cell/Default.js";
import { StringCell } from "./cell/String.js";
import { BooleanCell } from "./cell/Boolean.js";
import { NumberCell } from "./cell/Number.js";
import { LayoutConstraints } from "../../layout/LayoutConstraints.js";

/**
 * A single data row in the table, rendered as a `<tr>` element.
 *
 * Creates one typed cell ({@link StringCell}, {@link NumberCell}, {@link BooleanCell},
 * or {@link DefaultCell}) per model field and binds each cell's commit callback to the
 * corresponding field on the bound {@link ModelRecord}.
 */
export class Row extends Component {

    private model?: AbstractModel;
    private data?: ModelRecord;

    constructor(model?: AbstractModel, data?: ModelRecord) {
        super("tr");

        this.model = model;
        this.data = data;

        if (this.model) {
            let fields = this.model.getFields();
            fields.sort((f1, f2) => f1.getOrder() - f2.getOrder());

            for (let idx in fields) {
                let field = fields[idx];
                let value = this.data ? this.data.get(field.getName()) : undefined;
                let cell;

                switch (field.getType()) {
                    case "string":
                        cell = new StringCell();
                        break;
                    case "number":
                        cell = new NumberCell();
                        break;
                    case "boolean":
                        cell = new BooleanCell();
                        break;
                    default:
                        cell = new DefaultCell();
                        break;
                }

                cell.setValue(value);
                cell.setOnCommit((newValue) => {
                    this.data?.set(field.getName(), newValue);
                    this.updateVisualState();
                });

                this.addComponent(cell, {
                    data: field
                });
            }
        }
    }

    /**
     * Returns the ModelRecord currently bound to this row.
     *
     * @returns The bound {@link ModelRecord}, or undefined if none has been set.
     */
    getData() {
        return this.data;
    }

    /**
     * Rebinds all cells to a new record, updating their displayed values.
     *
     * @param record - The new record to bind to this row.
     */
    setData(record: ModelRecord) {
        this.data = record;
        const fields = this.model!.getFields()
                                  .sort((f1, f2) => f1.getOrder() - f2.getOrder());

        const cells = this.getComponents() as Cell<any>[];

        fields.forEach((field, i) => {
            cells[i].setValue(record.get(field.getName()));
        });

        this.updateVisualState();
    }

    /**
     * Applies a background color based on the record's new/dirty/clean state.
     *
     * @remarks New records get a green tint, dirty records an orange tint, and clean records no tint.
     */
    updateVisualState(): void {
        const el = this.getElement() as HTMLElement;
        if (!el) {
            return;
        }

        if (this.data?.isNew()) {
             el.style.backgroundColor = 'rgba(70, 200, 70, 0.15)';
        } else if (this.data?.isDirty()) {
            el.style.backgroundColor = 'rgba(255, 165, 0, 0.15)';
        } else {
            el.style.backgroundColor = '';
        }
    }

    /**
     * Appends a cell component to this row.
     *
     * @param cell - The cell to append.
     * @param constraints - Optional. Layout constraints for the cell.
     */
    addColumn(cell: Cell<any>, constraints?: LayoutConstraints) {
        this.addComponent(cell, constraints);
    }

    /**
     * Adds a cell as a child component of this row.
     *
     * @param cell - The cell component to add.
     * @param constraints - Optional. Layout constraints for the cell.
     */
    addComponent(cell: Cell<any>, constraints?: LayoutConstraints) {
        super.addComponent(cell, constraints);
    }

    /**
     * No-op; cell layout is driven by the Body's renderWindow.
     */
    doLayout() { }
}
