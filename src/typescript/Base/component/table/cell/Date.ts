// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "./Cell.js";
import { DateRenderer } from "./renderer/Date.js";
import { DateEditor } from "./editor/Date.js";

/**
 * A table cell for date values.
 *
 * Uses a {@link DateRenderer} for display and a {@link DateEditor} for in-place editing.
 * Committing an empty field writes null; committing an unparseable value reverts to the
 * previous value instead of writing null.
 */
export class DateCell extends Cell<Date | null> {

    private dateEditor: DateEditor;

    constructor() {
        let renderer = new DateRenderer();
        let editor = new DateEditor();

        super("td", renderer, editor);
        this.dateEditor = editor;
    }

    setValue(value: Date | null): void {
        this.getRenderer().setValue(value);
    }

    commitEdit(): void {
        // Non-empty input that failed to parse → revert rather than write null.
        if (!this.dateEditor.isEmpty() && this.dateEditor.getValue() === null) {
            this.cancelEdit();
            return;
        }
        super.commitEdit();
    }
}
