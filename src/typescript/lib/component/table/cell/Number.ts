// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { NumberRenderer } from "~/component/table/cell/renderer/Number.js";
import { NumberEditor } from "~/component/table/cell/editor/Number.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for numeric values.
 *
 * Uses a {@link NumberRenderer} for display and a {@link NumberEditor} for in-place editing.
 *
 * @category Components
 */
class NumberCell extends Cell<Number> {

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
    setValue(value: Number) : this {
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
