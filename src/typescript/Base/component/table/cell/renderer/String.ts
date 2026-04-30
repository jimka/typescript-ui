// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "./CellRenderer.js";
import { Label } from "../../../../component/Label.js";

/**
 * A read-only renderer for string cell values.
 *
 * Displays the value via a {@link Label}.
 */
export class StringRenderer extends CellRenderer<String> {

    private label: Label = new Label();

    constructor() {
        super();

        this.label.setText("");
        this.label.setPointerEvents("none");
        this.addComponent(this.label);
    }

    /**
     * Returns the label component used to display text.
     *
     * @returns The underlying {@link Label}.
     */
    getLabel() {
        return this.label;
    }

    /**
     * Returns the current label text.
     *
     * @returns The displayed string value.
     */
    getValue() {
        return this.label.getText();
    }

    /**
     * Sets the label text, defaulting to an empty string for falsy values.
     *
     * @param value - The string value to display.
     */
    setValue(value: String) {
        this.label.setText(value || "");
    }
}