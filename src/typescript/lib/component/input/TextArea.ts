// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
import { Util } from "~/core/Util.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link TextArea}.
 *
 * @category Components
 */
export interface TextAreaOptions extends TextInputOptions {
    rows?: number;
    cols?: number;
    wrap?: string;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultTextAreaOptions: Partial<TextAreaOptions> = {
    tag:             "textarea",
    cursor:          "text",
    padding:         new Insets(3, 3, 3, 3),
    preferredSize:   { width: 200, height: 200 },
    minSize:         { width: 100, height: 100 },
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
};

/**
 * A multi-line text area component backed by a `<textarea>` element.
 *
 * Keeps internal text state in sync with the DOM on every input event.
 *
 * @category Components
 */
class TextArea extends TextInput<TextAreaOptions> {

    constructor(text: string = "", options?: TextAreaOptions) {
        // Positional `text` is per-instance state, so it goes in the options bag
        // (dispatched through `setText` into `_options`), NOT `_defaultOptions`,
        // which holds class-level defaults the value getters never consult. An
        // explicit `options.text` still wins (spread last).
        super(
            text ? { text, ...options } : options,
            _defaultTextAreaOptions,
        );

        // The `<textarea>` corner grip is the only user-resize affordance on
        // any of these components. Pin `resize: none` as a persistent CSS rule
        // (not an inline style, which `applyStyle` would wipe on re-render) so
        // the area can never be drag-resized. There is no accompanying option
        // or setter — non-resizability is immutable by design.
        this.setElementCSSRules({ resize: "none" });

        Event.addListener(this, "input", this.onInput);
    }

    /**
     * Applies a {@link TextAreaOptions} bag, dispatching textarea-specific
     * `rows`, `cols`, and `wrap` attributes after inherited TextInput fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TextAreaOptions): this {
        super.applyOptions(options);

        if (options.rows !== undefined) {
            this.setRows(options.rows);
        }

        if (options.cols !== undefined) {
            this.setCols(options.cols);
        }

        if (options.wrap !== undefined) {
            this.setWrap(options.wrap);
        }

        return this;
    }

    /**
     * Returns the configured `rows` attribute value, or null if not set.
     *
     * @returns The row count, or null.
     */
    getRows(): number | null {
        return this._options.rows ?? null;
    }

    /**
     * Sets the HTML `rows` attribute on the underlying textarea.
     *
     * @param value - The number of visible text rows.
     *
     * @returns This component, for method chaining.
     */
    setRows(value: number): this {
        this._options.rows = value;
        this.setElementAttribute("rows", String(value));

        return this;
    }

    /**
     * Removes the HTML `rows` attribute from the underlying textarea.
     *
     * @returns This component, for method chaining.
     */
    clearRows(): this {
        if (this._options.rows === undefined) {
            return this;
        }

        this._options.rows = undefined;
        this.removeElementAttribute("rows");

        return this;
    }

    /**
     * Returns the configured `cols` attribute value, or null if not set.
     *
     * @returns The column count, or null.
     */
    getCols(): number | null {
        return this._options.cols ?? null;
    }

    /**
     * Sets the HTML `cols` attribute on the underlying textarea.
     *
     * @param value - The visible width in average character widths.
     *
     * @returns This component, for method chaining.
     */
    setCols(value: number): this {
        this._options.cols = value;
        this.setElementAttribute("cols", String(value));

        return this;
    }

    /**
     * Removes the HTML `cols` attribute from the underlying textarea.
     *
     * @returns This component, for method chaining.
     */
    clearCols(): this {
        if (this._options.cols === undefined) {
            return this;
        }

        this._options.cols = undefined;
        this.removeElementAttribute("cols");

        return this;
    }

    /**
     * Returns the configured `wrap` attribute value, or null if not set.
     *
     * @returns The wrap mode, or null.
     */
    getWrap(): string | null {
        return this._options.wrap ?? null;
    }

    /**
     * Sets the HTML `wrap` attribute on the underlying textarea.
     *
     * @param value - The wrap mode (e.g. "hard", "soft", "off").
     *
     * @returns This component, for method chaining.
     */
    setWrap(value: string): this {
        this._options.wrap = value;
        this.setElementAttribute("wrap", value);

        return this;
    }

    /**
     * Removes the HTML `wrap` attribute from the underlying textarea.
     *
     * @returns This component, for method chaining.
     */
    clearWrap(): this {
        if (this._options.wrap === undefined) {
            return this;
        }

        this._options.wrap = undefined;
        this.removeElementAttribute("wrap");

        return this;
    }

    /**
     * Returns the baseline of the text area's **first** line so it aligns its
     * top line with sibling controls in a horizontal row; the box then extends
     * downward below the baseline.
     *
     * @returns The first-line baseline offset in pixels.
     *
     * @remarks The first-line baseline (not the box bottom) is used so a tall
     * text area does not dominate the row's ascent and drag every sibling down
     * by its full height. This stays safe for surrounding graphics only because
     * they expose their own (bottom-edge) baselines — a `null`-baseline sibling
     * would be centred against this area's inflated descent and float to the
     * row's middle.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(Util.measureTextBaseline());
    }

    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement()!;

        if (this._options.rows !== undefined) {
            DOM.sink.apply(el, { setAttr: { rows: String(this._options.rows) } });
        }

        if (this._options.cols !== undefined) {
            DOM.sink.apply(el, { setAttr: { cols: String(this._options.cols) } });
        }

        if (this._options.wrap !== undefined) {
            DOM.sink.apply(el, { setAttr: { wrap: this._options.wrap } });
        }

        return this;
    }

    /**
     * Cleanup hook; currently a no-op placeholder.
     */
    destructor() {
        //Util.removeListener("input", this.onInput);
    }

    /**
     * Syncs the text content from the DOM element's value on every input event.
     */
    onInput() {
        let element = this.getElement();
        this.setText(DOM.source.getValue(element!));
    }

}

const TextAreaCallable = callable(TextArea);
type TextAreaCallable = TextArea;
export {
    TextArea         as _TextArea,
    TextAreaCallable as TextArea
};
