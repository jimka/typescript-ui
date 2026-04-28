// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "./CellEditor.js";
import { Checkbox } from "../../../../component/Checkbox.js";

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

    setOnChange(fn: (value: Boolean) => void): void {
        this.onChange = fn;
    }

    getValue() {
        return this.checkBox.isSelected();
    }

    setValue(value: boolean) {
        this.checkBox.setSelected(value);
    }
}