// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { DateTimeRenderer } from "~/component/table/cell/renderer/DateTime.js";
import { DateTimeEditor } from "~/component/table/cell/editor/DateTime.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for date-time values.
 *
 * Uses a [`DateTimeRenderer`](/api/component/table/classes/DateTimeRenderer) for display and
 * borrows a shared [`DateTimeEditor`](/api/component/table/classes/DateTimeEditor) from the
 * body's {@link CellEditorPool} on edit. Committing an empty field writes null; committing an
 * unparseable value reverts to the previous value instead of writing null.
 */
class DateTimeCell extends Cell<Date | null> {

    private showSeconds: boolean;

    constructor(showSeconds: boolean = false) {
        let renderer = new DateTimeRenderer(showSeconds);

        super("td", renderer);

        this.showSeconds = showSeconds;
    }

    /**
     * Returns the pool key for the shared {@link DateTimeEditor}, differentiating the seconds variant.
     *
     * @returns `"datetime:seconds"` when the cell renders seconds, otherwise `"datetime"`.
     */
    getEditorKey(): string {
        return this.showSeconds ? "datetime:seconds" : "datetime";
    }

    /**
     * Sets the displayed date-time value on the renderer.
     *
     * @param value - The date-time to display, or null to clear.
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
        const editor = this.activeEditor as DateTimeEditor | null;

        if (editor && !editor.isEmpty() && editor.getValue() === null) {
            this.cancelEdit();

            return this;
        }

        super.commitEdit();

        return this;
    }
}

const DateTimeCellCallable = callable(DateTimeCell);
type DateTimeCellCallable = DateTimeCell;
export {
    DateTimeCell         as _DateTimeCell,
    DateTimeCellCallable as DateTimeCell
};
