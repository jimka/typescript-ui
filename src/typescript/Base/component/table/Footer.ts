// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { Row } from "./Row.js";
import { BorderStyle } from "../../BorderStyle.js";

/**
 * The footer section of a table, rendered as a `<tfoot>` element.
 *
 * Contains a single {@link Row} and delegates width/height changes to it.
 */
export class FooterRow extends Component {

    constructor() {
        super("tfoot");

        this.setBorder({ top: { style: BorderStyle.SOLID, width: 1, color: "black" } });
        this.setBackgroundImage("linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))");

        let row = new Row();
        this.addRow(row);
    }

    /**
     * Returns the footer cell components in column order.
     *
     * @returns An array of cell components from the footer's inner row.
     */
    getColumns() {
        return this.getComponents()[0].getComponents();
    }

    /**
     * Appends a row to the footer.
     *
     * @param row - The row to append.
     */
    addRow(row: Row) {
        this.addComponent(row);
    }

    /**
     * Adds a row as a child component of the footer.
     *
     * @param row - The row component to add.
     */
    addComponent(row: Row) {
        super.addComponent(row);
    }

    /**
     * Sets the footer width and propagates it to the inner row.
     *
     * @param width - The width in pixels.
     */
    setWidth(width: number) {
        super.setWidth(width);

        this.getComponents()[0].setWidth(width);
    }

    /**
     * Sets the footer height and propagates it to the inner row.
     *
     * @param height - The height in pixels.
     */
    setHeight(height: number) {
        super.setHeight(height);

        this.getComponents()[0].setHeight(height);
    }
}