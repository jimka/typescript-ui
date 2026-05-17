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
     * Sets the label text from the number value, defaulting to empty string for falsy values.
     *
     * @param value - The numeric value to display.
     */
    setValue(value: Number) : this {
        this._text.setText(String(value) || "");

        return this;
    }
}

const NumberRendererCallable = callable(NumberRenderer);
type NumberRendererCallable = NumberRenderer;
export {
    NumberRenderer         as _NumberRenderer,
    NumberRendererCallable as NumberRenderer
};
