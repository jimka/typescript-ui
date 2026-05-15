// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { TimeRenderer } from "~/component/table/cell/renderer/Time.js";
import { TimeEditor } from "~/component/table/cell/editor/Time.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for time values.
 *
 * Uses a [`TimeRenderer`](/api/component/table/classes/TimeRenderer) for display and borrows a
 * shared [`TimeEditor`](/api/component/table/classes/TimeEditor) from the body's
 * {@link CellEditorPool} on edit. Committing an empty field writes null; committing an
 * unparseable value reverts to the previous value instead of writing null.
 */
class TimeCell extends Cell<Date | null> {

    private showSeconds: boolean;

    constructor(showSeconds: boolean = false) {
        let renderer = new TimeRenderer(showSeconds);

        super("td", renderer);

        this.showSeconds = showSeconds;
    }

    /**
     * Returns the pool key for the shared {@link TimeEditor}, differentiating the seconds variant.
     *
     * @returns `"time:seconds"` when the cell renders seconds, otherwise `"time"`.
     */
    getEditorKey(): string {
        return this.showSeconds ? "time:seconds" : "time";
    }

    /**
     * Sets the displayed time value on the renderer.
     *
     * @param value - The time to display, or null to clear.
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
        const editor = this.activeEditor as TimeEditor | null;

        if (editor && !editor.isEmpty() && editor.getValue() === null) {
            this.cancelEdit();

            return this;
        }

        super.commitEdit();

        return this;
    }
}

const TimeCellCallable = callable(TimeCell);
type TimeCellCallable = TimeCell;
export {
    TimeCell         as _TimeCell,
    TimeCellCallable as TimeCell
};
