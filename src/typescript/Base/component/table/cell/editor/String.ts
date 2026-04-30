// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "./CellEditor.js";
import { TextField } from "../../../../component/TextField.js";
import { Event } from "../../../../Event.js";

/**
 * An in-place editor for string cell values.
 *
 * Wraps a {@link TextField} and proxies blur and keydown events up to the parent
 * cell so the standard commit/cancel lifecycle works.
 */
export class StringEditor extends CellEditor<String> {

    private textField: TextField = new TextField();

    constructor() {
        super();

        Event.addListener(this.textField, "blur", (evnt: UIEvent) => {
            Event.fireEvent(this, "blur", evnt);
        });
        Event.addListener(this.textField, "keydown", (evnt: UIEvent) => {
            Event.fireEvent(this, "keydown", evnt);
        });

        this.textField.setText("");
        this.addComponent(this.textField);
    }

    /**
     * Returns the current text field value.
     *
     * @returns The current string from the text field.
     */
    getValue() {
        return this.textField.getText();
    }

    /**
     * Populates the text field with the given value.
     *
     * @param value - The string value to set in the text field.
     */
    setValue(value: String) {
        this.textField.setText(value || "");
    }

    /**
     * Focuses the text field and selects all its content.
     */
    focus() {
        this.textField.focus();
        this.textField.select();
    }
}