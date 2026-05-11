// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "./CellRenderer.js";
import { Text } from "../../../Text.js";

/**
 * A read-only renderer for numeric cell values.
 *
 * Displays the value right-aligned via a {@link Text}.
 *
 * @category Components
 */
export class NumberRenderer extends CellRenderer<Number> {

    private text: Text = new Text();

    constructor() {
        super();

        this.text.setPointerEvents("none");
        this.text.setTextAlign("right");
        this.text.setText("");
        this.text.setAutoMeasure(false);

        this.addComponent(this.text);
    }

    /**
     * Returns the label text parsed as a number.
     *
     * @returns The current numeric value.
     */
    getValue() {
        return Number(this.text.getText());
    }

    /**
     * Sets the label text from the number value, defaulting to empty string for falsy values.
     *
     * @param value - The numeric value to display.
     */
    setValue(value: Number) {
        this.text.setText(String(value) || "");
    }
}
