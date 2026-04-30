// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Legend } from "./Legend.js";
import { BorderStyle } from "../BorderStyle.js";
import { Insets } from "../Insets.js";

/**
 * A fieldset component with an embedded legend title.
 *
 * Renders a `<fieldset>` element and prepends a Legend child for the group title.
 */
export class FieldSet extends Component {

    private legend: Legend = new Legend();

    constructor(title: string = "") {
        super("fieldset");

        this.legend.setText(title);
        this.setBorder({ style: BorderStyle.GROOVE, width: 1, color: "var(--ts-ui-border-color, black)" });
        this.setPadding(new Insets(15, 3, 3, 3));
        this.setInsets(new Insets(5, 5, 15, 5));
    }

    /**
     * Returns the fieldset legend title text.
     *
     * @returns The current legend text string.
     */
    getTitle() {
        return this.legend.getText();
    }

    /**
     * Sets the fieldset legend title text.
     *
     * @param title - The text to display in the legend.
     */
    setTitle(title: string) {
        this.legend.setText(title);
    }

    /**
     * Renders the fieldset element and appends the legend as its first child.
     *
     * @returns The created HTMLFieldSetElement with the legend prepended.
     */
    render() {
        let element = super.render();

        element.appendChild(this.legend.getElement(true));

        return element;
    }
}