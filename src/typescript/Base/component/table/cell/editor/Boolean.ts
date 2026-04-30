// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "./CellEditor.js";
import { Checkbox } from "../../../../component/Checkbox.js";

/**
 * An always-visible checkbox editor for boolean cell values.
 *
 * Used directly as the renderer in {@link BooleanCell}; changes fire the onChange
 * callback immediately without a separate commit step.
 */
export class BooleanEditor extends CellEditor<Boolean> {

    private checkBox: Checkbox = new Checkbox();
    private onChange: ((value: Boolean) => void) | undefined;

    constructor() {
        super();

        this.checkBox.setSelected(false);
        this.addComponent(this.checkBox);

        this.checkBox.addActionListener(() => {
            this.onChange?.(this.getValue());
        });
    }

    /**
     * Registers a callback to fire when the checkbox value changes.
     *
     * @param fn - The callback to invoke with the new boolean value on each change.
     */
    setOnChange(fn: (value: Boolean) => void): void {
        this.onChange = fn;
    }

    /**
     * Returns the current checked state of the checkbox.
     *
     * @returns True if the checkbox is checked.
     */
    getValue() {
        return this.checkBox.isSelected();
    }

    /**
     * Sets the checkbox checked state.
     *
     * @param value - The boolean value to set on the checkbox.
     */
    setValue(value: boolean) {
        this.checkBox.setSelected(value);
    }
}