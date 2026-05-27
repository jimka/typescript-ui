// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only renderer for numeric cell values.
 *
 * Displays the value right-aligned via a {@link Text}.
 *
 * @category Components
 */
class NumberRenderer extends CellRenderer<Number> {

    private _text: Text = new Text();

    constructor() {
        super();

        this._text.setPointerEvents("none");
        this._text.setTextAlign("right");
        this._text.setText("");
        this._text.setAutoMeasure(false);

        this.addComponent(this._text);
    }

    /**
     * Returns the label text parsed as a number.
     *
     * @returns The current numeric value.
     */
    getValue() {
        return Number(this._text.getText());
    }

    /**
     * Sets the label text from the number value. `null` and `undefined`
     * render as the empty string; every other value (including `0`,
     * `-1`, `NaN`, `Infinity`) goes through `String(value)` so the
     * cell shows the actual literal — never the words `"undefined"` or
     * `"null"`.
     *
     * @param value - The numeric value to display, or `null`/`undefined`
     *   to clear the cell.
     */
    setValue(value: Number) : this {
        this._text.setText(value == null ? "" : String(value));

        return this;
    }
}

const NumberRendererCallable = callable(NumberRenderer);
type NumberRendererCallable = NumberRenderer;
export {
    NumberRenderer         as _NumberRenderer,
    NumberRendererCallable as NumberRenderer
};
