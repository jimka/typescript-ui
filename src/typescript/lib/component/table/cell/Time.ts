// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { TimeRenderer } from "~/component/table/cell/renderer/Time.js";
import { TimeEditor } from "~/component/table/cell/editor/Time.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for time values.
 *
 * Uses a {@link TimeRenderer} for display and a {@link TimeEditor} for in-place editing.
 * Committing an empty field writes null; committing an unparseable value reverts to the
 * previous value instead of writing null.
 */
class TimeCell extends Cell<Date | null> {

    private timeEditor: TimeEditor;

    constructor(showSeconds: boolean = false) {
        let renderer = new TimeRenderer(showSeconds);
        let editor = new TimeEditor(showSeconds);

        super("td", renderer, editor);
        this.timeEditor = editor;
    }

    setValue(value: Date | null): this {
        this.getRenderer().setValue(value);

        return this;
    }

    commitEdit(): this {
        if (!this.timeEditor.isEmpty() && this.timeEditor.getValue() === null) {
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
