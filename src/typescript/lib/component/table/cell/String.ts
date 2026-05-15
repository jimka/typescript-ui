// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { StringRenderer } from "~/component/table/cell/renderer/String.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for string values.
 *
 * Uses a [`StringRenderer`](/api/component/table/classes/StringRenderer) for display and borrows
 * a shared [`StringEditor`](/api/component/table/classes/StringEditor) from the body's
 * {@link CellEditorPool} on edit.
 *
 * @category Components
 */
class StringCell extends Cell<String> {

    constructor() {
        let renderer = new StringRenderer();

        super("td", renderer);
    }

    /**
     * Returns the pool key for the shared {@link StringEditor}.
     *
     * @returns The string `"string"`.
     */
    getEditorKey(): string {
        return "string";
    }

    /**
     * Sets the displayed text value on the renderer.
     *
     * @param value - The string value to display.
     */
    setValue(value: String): this {
        this.getRenderer().setValue(value);

        return this;
    }
}

const StringCellCallable = callable(StringCell);
type StringCellCallable = StringCell;
export {
    StringCell         as _StringCell,
    StringCellCallable as StringCell
};
