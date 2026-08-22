// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { ComponentOptions } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
import { SelectableText, SelectableTextOptions } from "~/component/input/SelectableText.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

const _defaultNumberRendererOptions: Partial<ComponentOptions> = { cursor: "text", userSelect: "text" };

// NumberRenderer's own right-aligned convention (see its constructor doc,
// below) — shared by the class default and the instance default bag so the
// two can never drift apart.
const NUMBER_RENDERER_TEXT_ALIGN = "right";

const _defaultNumberRendererTextOptions: Partial<SelectableTextOptions> = {
    textAlign: NUMBER_RENDERER_TEXT_ALIGN,
};

/**
 * The value text for a right-aligned {@link NumberRenderer} — every typed
 * `number` column renders with this alignment by default, so without a
 * shared class rule, every cell would carry an identical `text-align: right`
 * declaration on its own `#id` rule. Registers `textAlign` as a class
 * default, spread over `Text`'s own font declarations so every other font
 * property still resolves through the inherited `.Text` rule instead of
 * being duplicated too — see `## Architecture Decisions`. Mirrors
 * `SelectableText`'s own `cursor`/`userSelect` deviation from `Text`, one
 * class further down the same chain.
 *
 * {@link DynamicCell}'s left-aligned number row uses plain `SelectableText`
 * instead — `"left"` already matches `Text`'s own class default, so it needs
 * no dedicated class; see `NumberRenderer`'s constructor.
 */
class NumberRendererText extends SelectableText {

    protected static readonly ownClassStyleDefaults: StyleBag = {
        font: {
            ...Text.ownClassStyleDefaults.font,
            textAlign: NUMBER_RENDERER_TEXT_ALIGN,
        },
    };

    constructor() {
        super(undefined, undefined, _defaultNumberRendererTextOptions);
    }
}

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

    private _text:    Text;
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

        // "right" gets its own class default (NumberRendererText); "left"
        // already matches Text's own class default, so a plain
        // SelectableText needs no setTextAlign call either.
        this._text = align === "right" ? new NumberRendererText() : new SelectableText();
        this._text.setPointerEvents("none");
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
