// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "./CellRenderer.js";
import { Label } from "../../../Label.js";
import { AnchorType } from "../../../../layout/AnchorType.js";

/**
 * A read-only renderer for numeric cell values.
 *
 * Displays the value right-aligned via a {@link Label}.
 */
export class NumberRenderer extends CellRenderer<Number> {

    private label: Label = new Label();

    constructor() {
        super();

        this.label.setPointerEvents("none");
        this.label.setTextAlign("right");
        this.label.setText("");

        this.addComponent(this.label, {
            anchor: AnchorType.NORTHEAST
        });
    }

    /**
     * Returns the label text parsed as a number.
     *
     * @returns The current numeric value.
     */
    getValue() {
        return Number(this.label.getText());
    }

    /**
     * Sets the label text from the number value, defaulting to empty string for falsy values.
     *
     * @param value - The numeric value to display.
     */
    setValue(value: Number) {
        this.label.setText(String(value) || "");
    }
}
