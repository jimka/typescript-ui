// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "./Cell.js";
import { StringRenderer } from "./renderer/String.js";
import { StringEditor } from "./editor/String.js";

/**
 * A table cell for string values.
 *
 * Uses a {@link StringRenderer} for display and a {@link StringEditor} for in-place editing.
 */
export class StringCell extends Cell<String> {

    constructor() {
        let renderer = new StringRenderer();
        let editor = new StringEditor();

        super("td", renderer, editor);
    }

    /**
     * Sets the displayed text value on the renderer.
     *
     * @param value - The string value to display.
     */
    setValue(value: String) {
        this.getRenderer().setValue(value);
    }
}