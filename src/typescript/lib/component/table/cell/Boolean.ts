// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BooleanEditor } from "./editor/Boolean.js";
import { Cell } from "./Cell.js";
import { FillType } from "../../../layout/FillType.js";
import { AnchorType } from "../../../layout/AnchorType.js";
import { callable } from "../../../Callable.js";

/**
 * A table cell for boolean values, rendered as a checkbox.
 *
 * Unlike text-based cells, the {@link BooleanEditor} doubles as the renderer; there is
 * no separate renderer or edit-mode toggle — the checkbox is always interactive.
 *
 * @category Components
 */
class BooleanCell extends Cell<Boolean> {

    constructor() {
        let editor = new BooleanEditor();

        super("td",
            editor,
            undefined, {
                fill: FillType.NONE,
                anchor: AnchorType.CENTER
            },
            undefined
        );
    }

    /**
     * Wires the commit callback directly to the checkbox's onChange handler.
     *
     * @param fn - The callback to fire when the checkbox value changes.
     *
     * @remarks Overrides the base class implementation because BooleanCell has no separate
     * edit/commit cycle; changes are committed immediately on each checkbox interaction.
     */
    setOnCommit(fn: (value: Boolean) => void): void {
        (this.getRenderer() as BooleanEditor).setOnChange(fn);
    }

    /**
     * Toggles the checkbox value and fires the commit callback.
     */
    startEdit() {
        (this.getRenderer() as BooleanEditor).toggle();
    }

    /**
     * Sets the checkbox checked state.
     *
     * @param value - The boolean value to reflect on the checkbox.
     */
    setValue(value: Boolean) : this {
        this.getRenderer().setValue(value);

        return this;
    }
}

const BooleanCellCallable = callable(BooleanCell);
type BooleanCellCallable = BooleanCell;
export {
    BooleanCell         as _BooleanCell,
    BooleanCellCallable as BooleanCell
};
