// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "./CellRenderer.js";
import { Text } from "../../../../component/Text.js";

/**
 * A read-only renderer for string cell values.
 *
 * Displays the value via a {@link Text}.
 *
 * @category Components
 */
export class StringRenderer extends CellRenderer<String> {

    private text: Text = new Text();

    constructor() {
        super();

        this.text.setText("");
        this.text.setPointerEvents("none");
        this.text.setAutoMeasure(false);
        this.addComponent(this.text);
    }

    /**
     * Returns the text component used to display text.
     *
     * @returns The underlying {@link Text}.
     */
    getText() {
        return this.text;
    }

    /**
     * Returns the current displayed text.
     *
     * @returns The displayed string value.
     */
    getValue() {
        return this.text.getText();
    }

    /**
     * Sets the displayed text, defaulting to an empty string for falsy values.
     *
     * @param value - The string value to display.
     */
    setValue(value: String) {
        this.text.setText(value || "");
    }
}