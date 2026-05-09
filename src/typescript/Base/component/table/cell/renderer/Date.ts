// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "./CellRenderer.js";
import { Label } from "../../../../component/Label.js";

/**
 * A read-only renderer for date cell values.
 *
 * Displays the value via a {@link Label} formatted with `Date.toLocaleDateString`.
 */
export class DateRenderer extends CellRenderer<Date | null> {

    private label: Label = new Label();
    private value: Date | null = null;

    constructor() {
        super();

        this.label.setText("");
        this.label.setPointerEvents("none");
        this.addComponent(this.label);
    }

    getValue(): Date | null {
        return this.value;
    }

    setValue(value: Date | null): void {
        this.value = value ?? null;
        this.label.setText(value ? value.toLocaleDateString() : "");
    }
}
