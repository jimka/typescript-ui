import { Component } from "../../Component.js";
import { Row } from "./Row.js";
import { Model } from "./model/Model.js";
import { HeaderCell } from "./cell/Header.js";
import { Field } from "./model/Field.js";
import { BorderStyle } from "../../BorderStyle.js";

export class Header extends Component {

    private model: Model;

    constructor(model: Model) {
        super("thead");

        let row = new Row();
        row.setBorder(BorderStyle.SOLID, 1, "#e1e1e8");
        row.setBackgroundColor("#eee");
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