import { Component } from "../../Component.js";
import { Model } from "./model/Model.js";
import { Row } from "./Row.js";
import { LayoutConstraints } from "../../layout/LayoutConstraints.js";
import { Field } from "./model/Field.js";

export class Body extends Component {

    private model: Model;

    constructor(model: Model) {
        super("tbody");

        this.setOverflow("auto");
        this.setBackgroundColor("rgb(255, 255, 255)");

        this.model = model;
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

    sortRows() {
        throw Error("Not implemented yet.");
    }

    addRow(data: Map<String, any>) {
        let rowComponent = new Row(this.model, data);

        this.addComponent(rowComponent, {
            data: data
        });
    }

    addComponent(row: Row, constraints?: LayoutConstraints) {
        super.addComponent(row, constraints);
    }
}