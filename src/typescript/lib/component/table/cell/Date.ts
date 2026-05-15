// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { DateRenderer } from "~/component/table/cell/renderer/Date.js";
import { DateEditor } from "~/component/table/cell/editor/Date.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for date values.
 *
 * Uses a [`DateRenderer`](/api/component/table/classes/DateRenderer) for display and borrows a
 * shared [`DateEditor`](/api/component/table/classes/DateEditor) from the body's
 * {@link CellEditorPool} on edit. Committing an empty field writes null; committing an
 * unparseable value reverts to the previous value instead of writing null.
 */
class DateCell extends Cell<Date | null> {

    constructor() {
        let renderer = new DateRenderer();

        super("td", renderer);
    }

    /**
     * Returns the pool key for the shared {@link DateEditor}.
     *
     * @returns The string `"date"`.
     */
    getEditorKey(): string {
        return "date";
    }

    /**
     * Sets the displayed date value on the renderer.
     *
     * @param value - The date to display, or null to clear.
     */
    setValue(value: Date | null): this {
        this.getRenderer().setValue(value);

        return this;
    }

    /**
     * Commits the active edit, but reverts when the user typed something the editor could not
     * parse so the underlying record is not blanked.
     *
     * @returns This cell, for method chaining.
     */
    commitEdit(): this {
        const editor = this.activeEditor as DateEditor | null;

        if (editor && !editor.isEmpty() && editor.getValue() === null) {
            this.cancelEdit();

            return this;
        }

        super.commitEdit();

        return this;
    }
}

const DateCellCallable = callable(DateCell);
type DateCellCallable = DateCell;
export {
    DateCell         as _DateCell,
    DateCellCallable as DateCell
};
