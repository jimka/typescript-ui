// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { ComponentOptions } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
import { SelectableText } from "~/component/input/SelectableText.js";
import { callable } from "~/core/Callable.js";

const _defaultStringRendererOptions: Partial<ComponentOptions> = { cursor: "text", userSelect: "text" };

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

    private _text:    Text          = this.createText();
    private _value:   String | null = null;
    private _display: string        = "";

    constructor(subclassDefaults?: Partial<ComponentOptions>) {
        super({ ..._defaultStringRendererOptions, ...(subclassDefaults ?? {}) });

        this._text.setText("");
        this._text.setPointerEvents("none");
        this._text.setAutoMeasure(false);
        this.addComponent(this._text);

        // The renderer is the element the pointer hits (the Text stays
        // pointer-events: none), so its own user-select/cursor come from
        // _defaultStringRendererOptions class defaults. The Text needs its own
        // opt-in too — its element carries the framework's user-select: none
        // in its own right, and a descendant's declaration is not inherited
        // from an ancestor's. Being a SelectableText, it now gets those values
        // from its own class defaults rather than imperative calls.
    }

    /**
     * Constructs this renderer's text child. A subclass overrides this to
     * swap in a differently-styled `Text` subclass — e.g. `HeaderCellRenderer`
     * (component/table/cell/Header.ts), which needs header-specific
     * font-weight/font-size/user-select defaults — without duplicating the
     * rest of this constructor's setup.
     */
    protected createText(): Text {
        return new SelectableText();
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

const StringRendererCallable = callable(StringRenderer);
type StringRendererCallable = StringRenderer;
export {
    StringRenderer         as _StringRenderer,
    StringRendererCallable as StringRenderer
};
