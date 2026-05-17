// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { TextField } from "~/component/input/TextField.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for numeric cell values.
 *
 * Wraps a right-aligned {@link TextField} and proxies blur and keydown events
 * up to the parent cell so the standard commit/cancel lifecycle works.
 *
 * @category Components
 */
class NumberEditor extends CellEditor<Number> {

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

        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this._textField.clearPadding();
        this.setBorderRadius("0");
        this._textField.setBorder({ style: BorderStyle.SOLID, width: 0, color: 'transparent' });
        this._textField.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this._textField.setOutline('none');
        this._textField.setTextAlign("right");
        this._textField.setText("");

        this.addComponent(this._textField, {
            anchor: AnchorType.NORTHEAST
        });
    }

    /**
     * Returns the text field value parsed as a number.
     *
     * @returns The current numeric value from the text field.
     */
    getValue() {
        return Number(this._textField.getText());
    }

    /**
     * Populates the text field with the number as a string.
     *
     * @param value - The numeric value to set in the text field.
     */
    setValue(value: Number) : this {
        this._textField.setText(String(value) || "");

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

const NumberEditorCallable = callable(NumberEditor);
type NumberEditorCallable = NumberEditor;
export {
    NumberEditor         as _NumberEditor,
    NumberEditorCallable as NumberEditor
};
