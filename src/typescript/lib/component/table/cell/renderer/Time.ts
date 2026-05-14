// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only renderer for time cell values.
 *
 * Displays the time portion of a `Date` via a {@link Text} formatted with
 * `Date.toLocaleTimeString`.
 */
class TimeRenderer extends CellRenderer<Date | null> {

    private text: Text = new Text();
    private value: Date | null = null;
    private showSeconds: boolean;

    constructor(showSeconds: boolean = false) {
        super();
        this.showSeconds = showSeconds;

        this.text.setText("");
        this.text.setPointerEvents("none");
        this.text.setAutoMeasure(false);
        this.addComponent(this.text);
    }

    getValue(): Date | null {
        return this.value;
    }

    setValue(value: Date | null): this {
        this.value = value ?? null;
        const opts: Intl.DateTimeFormatOptions = this.showSeconds
            ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
            : { hour: '2-digit', minute: '2-digit' };
        this.text.setText(value ? value.toLocaleTimeString(undefined, opts) : "");

        return this;
    }
}

const TimeRendererCallable = callable(TimeRenderer);
type TimeRendererCallable = TimeRenderer;
export {
    TimeRenderer         as _TimeRenderer,
    TimeRendererCallable as TimeRenderer
};
