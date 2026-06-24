// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { ComboRenderer } from "~/component/table/cell/renderer/Combo.js";
import type { ComboOption } from "~/component/table/ColumnConfig.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for constrained-choice (combo-box) columns.
 *
 * Activated when a column declares `ColumnConfig.values`, regardless of the
 * field's declared type. Displays the chosen option's label via a
 * [`ComboRenderer`](/api/component/table/classes/ComboRenderer) and borrows a
 * per-column [`ComboEditor`](/api/component/table/classes/ComboEditor) from the
 * body's {@link CellEditorPool} on edit. The editor key is namespaced by field
 * (`combo:<field>`) so each combo column keeps its own option set rather than
 * sharing one pooled editor.
 *
 * @category Components
 */
class ComboCell extends Cell<String | null> {

    private _field: string;

    /**
     * @param field - The model field name this column presents; used to
     *   namespace the pooled editor key.
     * @param options - The column's option set, forwarded to the renderer
     *   so it can map stored values to display labels.
     */
    constructor(field: string, options: Array<ComboOption | string>) {
        super("td", new ComboRenderer(options));

        this._field = field;
    }

    /**
     * Returns the per-column pool key for this cell's shared
     * [`ComboEditor`](/api/component/table/classes/ComboEditor).
     *
     * @returns The string `` `combo:${field}` ``.
     */
    getEditorKey(): string {
        return `combo:${this._field}`;
    }

    /**
     * Sets the displayed value on the renderer, which maps it to the
     * matching option label. `null` and `undefined` render the cell blank.
     *
     * @param value - The option value to display, or `null`/`undefined` to
     *   clear the cell.
     */
    setValue(value: String | null): this {
        this.getRenderer().setValue(value);

        return this;
    }
}

const ComboCellCallable = callable(ComboCell);
type ComboCellCallable = ComboCell;
export {
    ComboCell         as _ComboCell,
    ComboCellCallable as ComboCell
};
