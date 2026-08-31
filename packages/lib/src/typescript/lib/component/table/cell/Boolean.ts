// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BooleanEditor } from "~/component/table/cell/editor/Boolean.js";
import { Cell, CellEvent } from "~/component/table/cell/Cell.js";
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
     * Registers a listener for one of this cell's events. The `"commit"`
     * listener is wired directly to the checkbox's `"change"` event rather
     * than the base {@link Cell} listener bag.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This cell, for method chaining.
     *
     * @remarks Overrides the base class because BooleanCell has no separate
     * edit/commit cycle; changes are committed immediately on each checkbox
     * interaction. Routed through the cached editor reference rather than
     * `getRenderer()` so the wiring survives a
     * [`TreeCellRenderer`](/api/component/table/classes/TreeCellRenderer)
     * wrap when the column is the tree column. The `"commit"` listener only
     * fires for user interaction, which always lands on a concrete
     * `true`/`false`; the `null` branch is included for consistency with the
     * editor's signature but is never emitted by the editor.
     */
    on(event: "commit",  listener: (value: Boolean | null) => void): this;
    on(event: "editend", listener: () => void): this;
    on(event: CellEvent, listener: Function): this {
        if (event === "commit") {
            this._checkbox.on("change", listener as (value: Boolean | null) => void);

            return this;
        }

        return super.on(event, listener as () => void);
    }

    /**
     * Removes a previously registered listener. The `"commit"` listener is
     * detached from the checkbox's `"change"` event; other events delegate
     * to the base {@link Cell}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This cell, for method chaining.
     */
    off(event: CellEvent, listener: Function): this {
        if (event === "commit") {
            this._checkbox.off("change", listener);

            return this;
        }

        return super.off(event, listener);
    }

    /**
     * Marks the cell read-only and propagates the flag to the checkbox so it
     * rejects user toggles. The base {@link Cell.setReadOnly} only handles the
     * cell chrome and the pooled-editor lifecycle; a BooleanCell's checkbox is
     * its always-on renderer, so it must be disabled explicitly or it would
     * stay interactive in a read-only column.
     *
     * @param value - `true` to lock the checkbox, `false` to restore it.
     *
     * @returns This cell, for method chaining.
     */
    setReadOnly(value: boolean): this {
        super.setReadOnly(value);
        this._checkbox.setReadOnly(value);

        return this;
    }

    /**
     * Toggles the checkbox value and fires the commit callback. A no-op when
     * the cell is read-only — the base {@link Cell.startEdit} self-guards on
     * `isReadOnly`, and this override (reached via the renderer's dblclick and
     * the body's keyboard activation) must do the same so a locked column never
     * toggles.
     */
    startEdit() {
        if (this.isReadOnly()) {
            return;
        }

        this._checkbox.toggle();
    }

    /**
     * @returns Always `true` — `startEdit()` toggles the checkbox
     *   immediately rather than opening a distinct edit session.
     */
    hasImmediateEditCommit(): boolean {
        return true;
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
