import { Component } from "../../Component.js";
import { Row } from "./Row.js";
import { BorderStyle } from "../../BorderStyle.js";

export class FooterRow extends Component {

    constructor() {
        super("tfoot");

        let row = new Row();
        row.setBorder(BorderStyle.SOLID, 1, "black");
        row.setBackgroundColor("#eee");
        this.addRow(row);
    }

    getColumns() {
        return this.getComponents()[0].getComponents();
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