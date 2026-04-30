// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "./Cell.js";
import { NumberRenderer } from "./renderer/Number.js";
import { NumberEditor } from "./editor/Number.js";

/**
 * A table cell for numeric values.
 *
 * Uses a {@link NumberRenderer} for display and a {@link NumberEditor} for in-place editing.
 */
export class NumberCell extends Cell<Number> {

    constructor() {
        let renderer = new NumberRenderer();
        let editor = new NumberEditor();

        super("td", renderer, editor);
    }

    /**
     * Sets the displayed numeric value on the renderer.
     *
     * @param value - The numeric value to display.
     */
    setValue(value: Number) {
        this.getRenderer().setValue(value);
    }
}