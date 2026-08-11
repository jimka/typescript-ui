// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only renderer for date-time cell values.
 *
 * Displays a `Date` via a {@link Text} formatted with `Date.toLocaleString`.
 */
class DateTimeRenderer extends CellRenderer<Date | null> {

    private _text: Text = new Text();
    private _value: Date | null = null;
    private _showSeconds: boolean;
    private _display: string = "";

    constructor(showSeconds: boolean = false) {
        super();
        this._showSeconds = showSeconds;

        this._text.setText("");
        this._text.setPointerEvents("none");
        this._text.setAutoMeasure(false);
        this.addComponent(this._text);
    }

    getValue(): Date | null {
        return this._value;
    }

    setValue(value: Date | null): this {
        this._value = value ?? null;
        const opts: Intl.DateTimeFormatOptions = this._showSeconds
            ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
            : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
        this._display = value ? value.toLocaleString(undefined, opts) : "";
        this._text.setText(this._display);

        return this;
    }

    /**
     * Returns the exact text last rendered — the same string {@link setValue}
     * pushed into the child {@link Text}. Computed from cached state, never
     * the DOM.
     *
     * @returns The cell's current display text.
     */
    getDisplayText(): string {
        return this._display;
    }
}

const DateTimeRendererCallable = callable(DateTimeRenderer);
type DateTimeRendererCallable = DateTimeRenderer;
export {
    DateTimeRenderer         as _DateTimeRenderer,
    DateTimeRendererCallable as DateTimeRenderer
};
