// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { Checkbox } from "~/component/input/Checkbox.js";
import { callable } from "~/core/Callable.js";

/**
 * An always-visible checkbox editor for boolean cell values.
 *
 * Used directly as the renderer in {@link BooleanCell}; changes fire the onChange
 * callback immediately without a separate commit step. A record whose
 * boolean field is `null` or `undefined` renders as the checkbox's
 * indeterminate (mixed) state; the first user click follows the
 * Checkbox's WAI-ARIA mixed-state rule and lands at `true`, after
 * which the cell carries a concrete `true`/`false` value.
 *
 * @category Components
 */
class BooleanEditor extends CellEditor<Boolean | null> {

    private _checkBox: Checkbox                                       = new Checkbox();
    private _value:    Boolean | null                                 = null;
    private _onChange: ((value: Boolean | null) => void) | undefined;

    constructor() {
        super();

        this._checkBox.setIndeterminate(true);
        this.addComponent(this._checkBox);

        this._checkBox.addActionListener(() => {
            this._value = this._checkBox.isSelected();
            this._onChange?.(this._value);
        });
    }

    /**
     * Registers a callback to fire when the checkbox value changes.
     * The callback receives the concrete `true`/`false` produced by the
     * click; the editor never emits `null` from user interaction.
     *
     * @param fn - The callback to invoke with the new boolean value on each change.
     */
    setOnChange(fn: (value: Boolean | null) => void): void {
        this._onChange = fn;
    }

    /**
     * Returns the cached boolean value, or `null` when the checkbox is
     * still in its initial indeterminate state.
     *
     * @returns `true`/`false` once the user (or `setValue`) has set a
     *   concrete value, otherwise `null`.
     */
    getValue(): Boolean | null {
        return this._value;
    }

    /**
     * Sets the checkbox state. `null` and `undefined` put the checkbox
     * into the indeterminate state and cache the value as `null`;
     * `true`/`false` clear indeterminate and select accordingly.
     *
     * @param value - The boolean value to reflect on the checkbox, or
     *   `null`/`undefined` to render the indeterminate state.
     */
    setValue(value: Boolean | null): this {
        this._value = value ?? null;

        if (this._value === null) {
            this._checkBox.setIndeterminate(true);
        } else {
            this._checkBox.setIndeterminate(false);
            this._checkBox.setSelected(this._value as boolean);
        }

        return this;
    }

    /**
     * Toggles the checkbox and fires the onChange callback. Clears the
     * indeterminate state if it was set, so the toggled value is always
     * a concrete boolean.
     */
    toggle(): this {
        const next = !this._checkBox.isSelected();

        this._checkBox.setIndeterminate(false);
        this._checkBox.setSelected(next);
        this._value = next;
        this._onChange?.(this._value);

        return this;
    }
}

const BooleanEditorCallable = callable(BooleanEditor);
type BooleanEditorCallable = BooleanEditor;
export {
    BooleanEditor         as _BooleanEditor,
    BooleanEditorCallable as BooleanEditor
};
