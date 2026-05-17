// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { TextField } from "~/component/input/TextField.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for string cell values.
 *
 * Wraps a {@link TextField} and proxies blur and keydown events up to the parent
 * cell so the standard commit/cancel lifecycle works.
 *
 * @category Components
 */
class StringEditor extends CellEditor<String> {

    private _textField: TextField = new TextField();

    constructor() {
        super();

        Event.addListener(this._textField, "blur", (evnt: UIEvent) => {
            Event.fireEvent(this, "blur", evnt);
        });
        Event.addListener(this._textField, "keydown", (evnt: KeyboardEvent) => {
            Event.fireEvent(this, new KeyboardEvent('keydown', {
                key     : evnt.key     , code      : evnt.code   , keyCode: evnt.keyCode,
                shiftKey: evnt.shiftKey, ctrlKey   : evnt.ctrlKey,
                altKey  : evnt.altKey  , metaKey   : evnt.metaKey,
                bubbles : true         , cancelable: true
            }));
        });

        this._textField.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this._textField.clearPadding();
        this._textField.setBorderRadius('0');
        this._textField.setBorder({ style: BorderStyle.SOLID, width: 0, color: 'transparent' });
        this._textField.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this._textField.setOutline('none');
        this._textField.setText("");
        this.addComponent(this._textField);
    }

    /**
     * Returns the current text field value.
     *
     * @returns The current string from the text field.
     */
    getValue() {
        return this._textField.getText();
    }

    /**
     * Populates the text field with the given value.
     *
     * @param value - The string value to set in the text field.
     */
    setValue(value: string) : this {
        this._textField.setText(value || "");

        return this;
    }

    /**
     * Focuses the text field and selects all its content.
     *
     * @returns This component, for method chaining.
     */
    focus(): this {
        this._textField.focus();
        this._textField.select();

        return this;
    }
}

const StringEditorCallable = callable(StringEditor);
type StringEditorCallable = StringEditor;
export {
    StringEditor         as _StringEditor,
    StringEditorCallable as StringEditor
};
