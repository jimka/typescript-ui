// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { Checkbox } from "~/component/input/Checkbox.js";
import { callable } from "~/core/Callable.js";

/**
 * An always-visible checkbox editor for boolean cell values.
 *
 * Used directly as the renderer in {@link BooleanCell}; changes fire the onChange
 * callback immediately without a separate commit step.
 *
 * @category Components
 */
class BooleanEditor extends CellEditor<Boolean> {

    private _checkBox: Checkbox = new Checkbox();
    private _onChange: ((value: Boolean) => void) | undefined;

    constructor() {
        super();

        this._checkBox.setSelected(false);
        this.addComponent(this._checkBox);

        this._checkBox.addActionListener(() => {
            this._onChange?.(this.getValue());
        });
    }

    /**
     * Registers a callback to fire when the checkbox value changes.
     *
     * @param fn - The callback to invoke with the new boolean value on each change.
     */
    setOnChange(fn: (value: Boolean) => void): void {
        this._onChange = fn;
    }

    /**
     * Returns the current checked state of the checkbox.
     *
     * @returns True if the checkbox is checked.
     */
    getValue() {
        return this._checkBox.isSelected();
    }

    /**
     * Sets the checkbox checked state.
     *
     * @param value - The boolean value to set on the checkbox.
     */
    setValue(value: boolean) : this {
        this._checkBox.setSelected(value);

        return this;
    }

    /**
     * Toggles the checkbox and fires the onChange callback.
     */
    toggle() : this {
        this._checkBox.setSelected(!this._checkBox.isSelected());
        this._onChange?.(this.getValue());

        return this;
    }
}

const BooleanEditorCallable = callable(BooleanEditor);
type BooleanEditorCallable = BooleanEditor;
export {
    BooleanEditor         as _BooleanEditor,
    BooleanEditorCallable as BooleanEditor
};
