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

    private _text:  Text                = new Text();
    private _map:   Map<string, string> = new Map();
    private _value: String | null       = null;

    /**
     * @param options - The column's option set; each entry is a plain
     *   string (value === label) or a `{ value, label }` pair. Used to
     *   build the value-to-label lookup the renderer displays.
     */
    constructor(options: Array<ComboOption | string>) {
        super();

        for (const option of normalizeComboOptions(options)) {
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
            this._text.setText("");
        } else {
            const key = String(this._value);

            this._text.setText(this._map.get(key) ?? key);
        }

        return this;
    }
}

const ComboRendererCallable = callable(ComboRenderer);
type ComboRendererCallable = ComboRenderer;
export {
    ComboRenderer         as _ComboRenderer,
    ComboRendererCallable as ComboRenderer
};
