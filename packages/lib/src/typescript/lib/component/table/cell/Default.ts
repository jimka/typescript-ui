// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { StringRenderer } from "~/component/table/cell/renderer/String.js";
import { Cell } from "~/component/table/cell/Cell.js";
import { callable } from "~/core/Callable.js";

/**
 * A plain string-rendering cell with no editor.
 *
 * Used as the fallback cell type for fields whose type is not explicitly mapped,
 * and as the base for {@link HeaderCell}.
 *
 * @category Components
 */
class DefaultCell extends Cell<String | null> {

    constructor(tag?: string, renderer?: StringRenderer) {
        super(tag || "td", renderer ?? new StringRenderer());
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
     * Sets the displayed text value on the string renderer. `null` and
     * `undefined` render the cell as blank.
     *
     * @param value - The string value to display, or `null`/`undefined`
     *   to clear the cell.
     */
    setValue(value: String | null): this {
        this.getRenderer().setValue(value);

        return this;
    }
}

const DefaultCellCallable = callable(DefaultCell);
type DefaultCellCallable = DefaultCell;
export {
    DefaultCell         as _DefaultCell,
    DefaultCellCallable as DefaultCell
};
