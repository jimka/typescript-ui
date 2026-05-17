// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only renderer for date cell values.
 *
 * Displays the value via a {@link Text} formatted with `Date.toLocaleDateString`.
 */
class DateRenderer extends CellRenderer<Date | null> {

    private _text: Text = new Text();
    private _value: Date | null = null;

    constructor() {
        super();

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
        this._text.setText(value ? value.toLocaleDateString() : "");

        return this;
    }
}

const DateRendererCallable = callable(DateRenderer);
type DateRendererCallable = DateRenderer;
export {
    DateRenderer         as _DateRenderer,
    DateRendererCallable as DateRenderer
};
