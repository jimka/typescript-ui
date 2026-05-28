// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { NumberRenderer } from "~/component/table/cell/renderer/Number.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for numeric values.
 *
 * Uses a [`NumberRenderer`](/api/component/table/classes/NumberRenderer) for display and borrows
 * a shared [`NumberEditor`](/api/component/table/classes/NumberEditor) from the body's
 * {@link CellEditorPool} on edit.
 *
 * @category Components
 */
class NumberCell extends Cell<Number | null> {

    constructor() {
        let renderer = new NumberRenderer();

        super("td", renderer);
    }

    /**
     * Returns the pool key for the shared {@link NumberEditor}.
     *
     * @returns The string `"number"`.
     */
    getEditorKey(): string {
        return "number";
    }

    /**
     * Sets the displayed numeric value on the renderer. `null` and
     * `undefined` render the cell as blank.
     *
     * @param value - The numeric value to display, or `null`/`undefined`
     *   to clear the cell.
     */
    setValue(value: Number | null): this {
        this.getRenderer().setValue(value);

        return this;
    }
}

const NumberCellCallable = callable(NumberCell);
type NumberCellCallable = NumberCell;
export {
    NumberCell         as _NumberCell,
    NumberCellCallable as NumberCell
};
