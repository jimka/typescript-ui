// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "./CellEditor.js";
import { TextField } from "../../../../component/TextField.js";
import { BorderStyle } from "../../../../BorderStyle.js";
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
        Event.addListener(this.textField, "keydown", (evnt: KeyboardEvent) => {
            Event.fireEvent(this, new KeyboardEvent('keydown', {
                key     : evnt.key     , code      : evnt.code   , keyCode: evnt.keyCode,
                shiftKey: evnt.shiftKey, ctrlKey   : evnt.ctrlKey,
                altKey  : evnt.altKey  , metaKey   : evnt.metaKey,
                bubbles : true         , cancelable: true
            }));
        });

        this.textField.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this.textField.setPadding(null);
        this.textField.setBorderRadius('0');
        this.textField.setBorder({ style: BorderStyle.SOLID, width: 0, color: 'transparent' });
        this.textField.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this.textField.setOutline('none');
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