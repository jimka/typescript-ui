import { Component } from "../../Component.js";
import { Model } from "./model/Model.js";
import { Cell } from "./cell/Cell.js";
import { DefaultCell } from "./cell/Default.js";
import { StringCell } from "./cell/String.js";
import { BooleanCell } from "./cell/Boolean.js";
import { NumberCell } from "./cell/Number.js";
import { LayoutConstraints } from "../../layout/LayoutConstraints.js";

export class Row extends Component {

    private model?: Model;
    private data?: Map<String, any>;

    constructor(model?: Model, data?: Map<String, any>) {
        super("tr");

        this.model = model;
        this.data = data;

        if (this.model && this.data) {
            let fields = this.model.getFields();
            fields.sort((f1, f2) => f1.getOrder() - f2.getOrder());

            for (let idx in fields) {
                let field = fields[idx];
                let value = this.data.get(field.getId());

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
                this.addComponent(cell, {
                    data: field
                });
            }
        }
    }

    getData() {
        return this.data;
    }

    addColumn(cell: Cell<any>, constraints?: LayoutConstraints) {
        this.addComponent(cell, constraints);
    }

    addComponent(cell: Cell<any>, constraints?: LayoutConstraints) {
        super.addComponent(cell, constraints);
    }

    doLayout() { }
}