// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Text } from "~/component/input/Text.js";
import { normalizeComboOptions } from "~/component/table/ColumnConfig.js";
import type { ComboOption } from "~/component/table/ColumnConfig.js";
import { callable } from "~/core/Callable.js";

/**
 * A read-only renderer for constrained-choice (combo-box) cell values.
 *
 * Stores the option *value* (the code round-tripped to the record) but
 * displays the option *label*: a value of `"AU"` with an option set of
 * `[{ value: "AU", label: "Australia" }]` renders `"Australia"`. A value
 * not present in the option set falls back to rendering the raw value, so a
 * record holding an out-of-set code is still visible rather than blanked.
 * Caches the last value passed to {@link setValue} so {@link getValue}
 * returns `null` for an empty cell, distinct from the empty-string render.
 *
 * @category Components
 */
class ComboRenderer extends CellRenderer<String | null> {

    private _text:    Text                = new Text();
    private _map:     Map<string, string> = new Map();
    private _value:   String | null       = null;
    private _display: string              = "";

    /**
     * @param optionList - The column's option set; each entry is a plain
     *   string (value === label) or a `{ value, label }` pair. Used to
     *   build the value-to-label lookup the renderer displays.
     */
    constructor(optionList: Array<ComboOption | string>) {
        super();

        for (const option of normalizeComboOptions(optionList)) {
            this._map.set(option.value, option.label);
        }

        this._text.setText("");
        this._text.setPointerEvents("none");
        this._text.setAutoMeasure(false);
        this.addComponent(this._text);
    }

    /**
     * Returns the text component used to display the option label.
     *
     * @returns The underlying {@link Text}.
     */
    getText(): Text {
        return this._text;
    }

    /**
     * Returns the cached option value (the code stored on the record), or
     * `null` when the cell is empty. Returns the value, never the label, so
     * the round-trip back to the record stays honest.
     *
     * @returns The displayed option value, or `null`.
     */
    getValue(): String | null {
        return this._value;
    }

    /**
     * Caches the value and renders its label. `null` and `undefined` both
     * normalise to `null` and render the empty string; a value outside the
     * option set renders the raw value rather than blanking.
     *
     * @param value - The option value to display, or `null`/`undefined` to
     *   clear the cell.
     */
    setValue(value: String | null): this {
        this._value = value ?? null;

        if (this._value === null) {
            this._display = "";
        } else {
            const key = String(this._value);

            this._display = this._map.get(key) ?? key;
        }

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

    /**
     * Rebuilds the value-to-label map from a new option set and re-renders
     * the cached value against it, so a shared renderer can be reused
     * across rows whose combo options differ.
     *
     * @param optionList - The new option set; same shape as the constructor
     *   argument.
     * @returns This renderer, for method chaining.
     */
    setOptions(optionList: Array<ComboOption | string>): this {
        this._map.clear();

        for (const option of normalizeComboOptions(optionList)) {
            this._map.set(option.value, option.label);
        }

        this.setValue(this._value);

        return this;
    }
}

const ComboRendererCallable = callable(ComboRenderer);
type ComboRendererCallable = ComboRenderer;
export {
    ComboRenderer         as _ComboRenderer,
    ComboRendererCallable as ComboRenderer
};
