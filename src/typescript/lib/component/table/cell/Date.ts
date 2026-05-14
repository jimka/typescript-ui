// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import { DateRenderer } from "~/component/table/cell/renderer/Date.js";
import { DateEditor } from "~/component/table/cell/editor/Date.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell for date values.
 *
 * Uses a {@link DateRenderer} for display and a {@link DateEditor} for in-place editing.
 * Committing an empty field writes null; committing an unparseable value reverts to the
 * previous value instead of writing null.
 */
class DateCell extends Cell<Date | null> {

    private dateEditor: DateEditor;

    constructor() {
        let renderer = new DateRenderer();
        let editor = new DateEditor();

        super("td", renderer, editor);
        this.dateEditor = editor;
    }

    setValue(value: Date | null): this {
        this.getRenderer().setValue(value);

        return this;
    }

    commitEdit(): this {
        // Non-empty input that failed to parse → revert rather than write null.
        if (!this.dateEditor.isEmpty() && this.dateEditor.getValue() === null) {
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
