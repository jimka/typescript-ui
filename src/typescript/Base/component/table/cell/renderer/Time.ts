// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "./CellRenderer.js";
import { Label } from "../../../../component/Label.js";

/**
 * A read-only renderer for time cell values.
 *
 * Displays the time portion of a {@link Date} via a {@link Label} formatted with
 * {@link Date.toLocaleTimeString}.
 */
export class TimeRenderer extends CellRenderer<Date | null> {

    private label: Label = new Label();
    private value: Date | null = null;
    private showSeconds: boolean;

    constructor(showSeconds: boolean = false) {
        super();
        this.showSeconds = showSeconds;

        this.label.setText("");
        this.label.setPointerEvents("none");
        this.addComponent(this.label);
    }

    getValue(): Date | null {
        return this.value;
    }

    setValue(value: Date | null): void {
        this.value = value ?? null;
        const opts: Intl.DateTimeFormatOptions = this.showSeconds
            ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
            : { hour: '2-digit', minute: '2-digit' };
        this.label.setText(value ? value.toLocaleTimeString(undefined, opts) : "");
    }
}
