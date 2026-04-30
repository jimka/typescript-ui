// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { StringRenderer } from "./renderer/String.js";
import { Cell } from "./Cell.js";

/**
 * A plain string-rendering cell with no editor.
 *
 * Used as the fallback cell type for fields whose type is not explicitly mapped,
 * and as the base for {@link HeaderCell}.
 */
export class DefaultCell extends Cell<String> {

    constructor(tag?: string) {
        let renderer = new StringRenderer();

        super(tag || "td", renderer);
    }

    /**
     * Returns the renderer cast to StringRenderer.
     *
     * @returns The {@link StringRenderer} for this cell.
     */
    getRenderer() {
        return <StringRenderer>super.getRenderer();
    }

    /**
     * Sets the displayed text value on the string renderer.
     *
     * @param value - The string value to display.
     */
    setValue(value: String) {
        this.getRenderer().setValue(value);
    }
}