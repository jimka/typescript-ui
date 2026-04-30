// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "./CellEditor.js";
import { TextField } from "../../../../component/TextField.js";
import { AnchorType } from "../../../../layout/AnchorType.js";
import { Event } from "../../../../Event.js";

/**
 * An in-place editor for numeric cell values.
 *
 * Wraps a right-aligned {@link TextField} and proxies blur and keydown events
 * up to the parent cell so the standard commit/cancel lifecycle works.
 */
export class NumberEditor extends CellEditor<Number> {

    private textField: TextField = new TextField();

    constructor() {
        super();

        Event.addListener(this.textField, "blur", (evnt: UIEvent) => {
            Event.fireEvent(this, "blur", evnt);
        });
        Event.addListener(this.textField, "keydown", (evnt: UIEvent) => {
            Event.fireEvent(this, "keydown", evnt);
        });

        this.textField.setTextAlign("right");
        this.textField.setText("");

        this.addComponent(this.textField, {
            anchor: AnchorType.NORTHEAST
        });
    }

    /**
     * Returns the text field value parsed as a number.
     *
     * @returns The current numeric value from the text field.
     */
    getValue() {
        return Number(this.textField.getText());
    }

    /**
     * Populates the text field with the number as a string.
     *
     * @param value - The numeric value to set in the text field.
     */
    setValue(value: Number) {
        this.textField.setText(String(value) || "");
    }

    /**
     * Focuses the text field and selects all its content.
     */
    focus() {
        this.textField.focus();
        this.textField.select();
    }
}
