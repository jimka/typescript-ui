// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only renderer for string cell values.
 *
 * Displays the value via a {@link Text}. Caches the last value passed
 * to {@link setValue} so {@link getValue} returns `null` for an empty
 * cell, distinct from the empty-string render the user sees.
 *
 * @category Components
 */
class StringRenderer extends CellRenderer<String | null> {

    private _text:  Text          = new Text();
    private _value: String | null = null;

    constructor() {
        super();

        this._text.setText("");
        this._text.setPointerEvents("none");
        this._text.setAutoMeasure(false);
        this.addComponent(this._text);
    }

    /**
     * Returns the text component used to display text.
     *
     * @returns The underlying {@link Text}.
     */
    getText(): Text {
        return this._text;
    }

    /**
     * Returns the cached string value, or `null` when the cell is empty.
     *
     * @returns The displayed string value, or `null`.
     */
    getValue(): String | null {
        return this._value;
    }

    /**
     * Caches the value and renders it as text. `null` and `undefined`
     * are both normalised to `null` and render as the empty string.
     *
     * @param value - The string value to display, or `null`/`undefined`
     *   to clear the cell.
     */
    setValue(value: String | null): this {
        this._value = value ?? null;
        this._text.setText(this._value === null ? "" : String(this._value));

        return this;
    }
}

const StringRendererCallable = callable(StringRenderer);
type StringRendererCallable = StringRenderer;
export {
    StringRenderer         as _StringRenderer,
    StringRendererCallable as StringRenderer
};
