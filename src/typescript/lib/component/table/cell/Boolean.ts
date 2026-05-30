// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BooleanEditor } from "~/component/table/cell/editor/Boolean.js";
import { Cell } from "~/component/table/cell/Cell.js";
import { FillType } from "~/layout/FillType.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for boolean values, rendered as a checkbox.
 *
 * Unlike text-based cells, the {@link BooleanEditor} doubles as the renderer; there is
 * no separate renderer or edit-mode toggle — the checkbox is always interactive.
 *
 * @category Components
 */
class BooleanCell extends Cell<Boolean | null> {

    private _checkbox: BooleanEditor;

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

        this._checkbox = editor;
    }

    /**
     * Wires the commit callback directly to the checkbox's onChange handler.
     *
     * @param fn - The callback to fire when the checkbox value changes.
     *
     * @remarks Overrides the base class implementation because BooleanCell has no separate
     * edit/commit cycle; changes are committed immediately on each checkbox interaction.
     * Routed through the cached editor reference rather than `getRenderer()` so the
     * wiring survives a [`TreeCellRenderer`](/api/component/table/classes/TreeCellRenderer)
     * wrap when the column is the tree column. The callback only fires
     * for user interaction, which always lands on a concrete `true`/`false`;
     * the `null` branch of the parameter type is included for consistency
     * with the editor's signature but is never emitted by the editor.
     */
    setOnCommit(fn: (value: Boolean | null) => void): void {
        this._checkbox.on("change", fn);
    }

    /**
     * Toggles the checkbox value and fires the commit callback.
     */
    startEdit() {
        this._checkbox.toggle();
    }

    /**
     * Sets the checkbox checked state. `null` and `undefined` put the
     * checkbox into the indeterminate (mixed) state.
     *
     * @param value - The boolean value to reflect on the checkbox, or
     *   `null`/`undefined` to render the indeterminate state.
     */
    setValue(value: Boolean | null): this {
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
