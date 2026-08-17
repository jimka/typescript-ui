// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { ComponentOptions } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
import { SelectableText } from "~/component/input/SelectableText.js";
import { callable } from "~/core/Callable.js";

const _defaultNumberRendererOptions: Partial<ComponentOptions> = { cursor: "text", userSelect: "text" };

/**
 * A read-only renderer for numeric cell values.
 *
 * Displays the value via a {@link Text}, right-aligned by default. Caches
 * the last value passed to {@link setValue} so {@link getValue} returns the
 * exact `Number | null` that was rendered — never the result of re-parsing
 * the DOM text, which silently coerces an empty cell back to `0`.
 *
 * @category Components
 */
class NumberRenderer extends CellRenderer<Number | null> {

    private _text:    Text          = new SelectableText();
    private _value:   Number | null = null;
    private _display: string        = "";

    /**
     * @param align - The text alignment to render with. Defaults to
     *   `"right"`, the convention for a homogeneous numeric column;
     *   {@link DynamicCell} passes `"left"` instead, since it renders a
     *   number row alongside left-aligned rows of other types in the same
     *   column.
     */
    constructor(align: "left" | "right" = "right") {
        super(_defaultNumberRendererOptions);

        this._text.setPointerEvents("none");
        this._text.setTextAlign(align);
        this._text.setText("");
        this._text.setAutoMeasure(false);

        this.addComponent(this._text);
    }

    /**
     * Returns the cached numeric value, or `null` when the cell is
     * empty. Reads the private cache rather than re-parsing the DOM
     * text so an empty cell round-trips as `null` instead of `0`.
     *
     * @returns The current numeric value, or `null`.
     */
    getValue(): Number | null {
        return this._value;
    }

    /**
     * Caches the value and renders it as text. `null` and `undefined`
     * are both normalised to `null` and render as the empty string;
     * every other value (including `0`, `-1`, `NaN`, `Infinity`) goes
     * through `String(value)` so the cell shows the actual literal —
     * never the words `"undefined"` or `"null"`.
     *
     * @param value - The numeric value to display, or `null`/`undefined`
     *   to clear the cell.
     */
    setValue(value: Number | null): this {
        this._value   = value ?? null;
        this._display = this._value === null ? "" : String(this._value);
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

const NumberRendererCallable = callable(NumberRenderer);
type NumberRendererCallable = NumberRenderer;
export {
    NumberRenderer         as _NumberRenderer,
    NumberRendererCallable as NumberRenderer
};
