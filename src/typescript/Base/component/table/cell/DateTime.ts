// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "./Cell.js";
import { DateTimeRenderer } from "./renderer/DateTime.js";
import { DateTimeEditor } from "./editor/DateTime.js";

/**
 * A table cell for date-time values.
 *
 * Uses a {@link DateTimeRenderer} for display and a {@link DateTimeEditor} for in-place
 * editing. Committing an empty field writes null; committing an unparseable value reverts
 * to the previous value instead of writing null.
 */
export class DateTimeCell extends Cell<Date | null> {

    private dateTimeEditor: DateTimeEditor;

    constructor(showSeconds: boolean = false) {
        let renderer = new DateTimeRenderer(showSeconds);
        let editor = new DateTimeEditor(showSeconds);

        super("td", renderer, editor);
        this.dateTimeEditor = editor;
    }

    setValue(value: Date | null): void {
        this.getRenderer().setValue(value);
    }

    commitEdit(): void {
        if (!this.dateTimeEditor.isEmpty() && this.dateTimeEditor.getValue() === null) {
            this.cancelEdit();
            return;
        }
        super.commitEdit();
    }
}
