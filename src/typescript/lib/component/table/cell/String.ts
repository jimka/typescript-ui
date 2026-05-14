// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { StringRenderer } from "~/component/table/cell/renderer/String.js";
import { StringEditor } from "~/component/table/cell/editor/String.js";
import { callable } from "~/Callable.js";

/**
 * A table cell for string values.
 *
 * Uses a {@link StringRenderer} for display and a {@link StringEditor} for in-place editing.
 *
 * @category Components
 */
class StringCell extends Cell<String> {

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
    setValue(value: String) : this {
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
