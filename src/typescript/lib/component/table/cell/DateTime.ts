// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { DateTimeRenderer } from "~/component/table/cell/renderer/DateTime.js";
import { DateTimeEditor } from "~/component/table/cell/editor/DateTime.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for date-time values.
 *
 * Uses a {@link DateTimeRenderer} for display and a {@link DateTimeEditor} for in-place
 * editing. Committing an empty field writes null; committing an unparseable value reverts
 * to the previous value instead of writing null.
 */
class DateTimeCell extends Cell<Date | null> {

    private dateTimeEditor: DateTimeEditor;

    constructor(showSeconds: boolean = false) {
        let renderer = new DateTimeRenderer(showSeconds);
        let editor = new DateTimeEditor(showSeconds);

        super("td", renderer, editor);
        this.dateTimeEditor = editor;
    }

    setValue(value: Date | null): this {
        this.getRenderer().setValue(value);

        return this;
    }

    commitEdit(): this {
        if (!this.dateTimeEditor.isEmpty() && this.dateTimeEditor.getValue() === null) {
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
