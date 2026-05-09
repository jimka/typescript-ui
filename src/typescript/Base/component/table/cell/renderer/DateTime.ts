// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "./CellRenderer.js";
import { Text } from "../../../../component/Text.js";

/**
 * A read-only renderer for date-time cell values.
 *
 * Displays a `Date` via a {@link Text} formatted with `Date.toLocaleString`.
 */
export class DateTimeRenderer extends CellRenderer<Date | null> {

    private text: Text = new Text();
    private value: Date | null = null;
    private showSeconds: boolean;

    constructor(showSeconds: boolean = false) {
        super();
        this.showSeconds = showSeconds;

        this.text.setText("");
        this.text.setPointerEvents("none");
        this.addComponent(this.text);
    }

    getValue(): Date | null {
        return this.value;
    }

    setValue(value: Date | null): void {
        this.value = value ?? null;
        const opts: Intl.DateTimeFormatOptions = this.showSeconds
            ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
            : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
        this.text.setText(value ? value.toLocaleString(undefined, opts) : "");
    }
}
