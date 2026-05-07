// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "./Cell.js";
import { TimeRenderer } from "./renderer/Time.js";
import { TimeEditor } from "./editor/Time.js";

/**
 * A table cell for time values.
 *
 * Uses a {@link TimeRenderer} for display and a {@link TimeEditor} for in-place editing.
 * Committing an empty field writes null; committing an unparseable value reverts to the
 * previous value instead of writing null.
 */
export class TimeCell extends Cell<Date | null> {

    private timeEditor: TimeEditor;

    constructor(showSeconds: boolean = false) {
        let renderer = new TimeRenderer(showSeconds);
        let editor = new TimeEditor(showSeconds);

        super("td", renderer, editor);
        this.timeEditor = editor;
    }

    setValue(value: Date | null): void {
        this.getRenderer().setValue(value);
    }

    commitEdit(): void {
        if (!this.timeEditor.isEmpty() && this.timeEditor.getValue() === null) {
            this.cancelEdit();
            return;
        }
        super.commitEdit();
    }
}
