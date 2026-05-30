// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
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
    resize?: string;
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
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
    resize:          "none",
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
        // Positional `text` lands as a subclass default — user-supplied
        // `options.text` still wins because applyOptions merges
        // `{...defaults, ...options}` at dispatch time.
        super(
            options,
            text ? { ..._defaultTextAreaOptions, text } : _defaultTextAreaOptions,
        );

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

        const opts = { ...this._defaultOptions, ...options } as TextAreaOptions;

        if (opts.rows !== undefined) {
            this.setRows(opts.rows);
        }

        if (opts.cols !== undefined) {
            this.setCols(opts.cols);
        }

        if (opts.wrap !== undefined) {
            this.setWrap(opts.wrap);
        }

        if (opts.resize !== undefined) {
            this.setResize(opts.resize);
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
     * Returns the configured CSS `resize` value, or null if not set.
     *
     * @returns The CSS `resize` string, or null.
     */
    getResize(): string | null {
        return this._options.resize ?? null;
    }

    /**
     * Sets the CSS `resize` style on the underlying textarea. Use
     * {@link clearResize} to remove the inline declaration and fall back to
     * the user-agent default.
     *
     * @param value - A CSS `resize` value (e.g. "none", "both", "vertical", "horizontal").
     *
     * @returns This component, for method chaining.
     */
    setResize(value: string): this {
        if (this._options.resize === value) {
            return this;
        }

        this._options.resize = value;
        this.setElementStyle("resize", value);

        return this;
    }

    /**
     * Removes the inline CSS `resize` declaration from the underlying textarea.
     *
     * @returns This component, for method chaining.
     */
    clearResize(): this {
        if (this._options.resize === undefined) {
            return this;
        }

        this._options.resize = undefined;
        this.setElementStyle("resize", null);

        return this;
    }

    /**
     * Returns `null` so a `TextArea` is treated as a graphical / replaced element
     * by horizontal layouts.
     *
     * @returns Always `null`.
     *
     * @remarks A multi-line text area's box height is far larger than its first
     * line of text, so participating in baseline alignment would drag every
     * surrounding text label down by the area's vertical extent. Treating it as
     * a baseline-less block lets the row keep its text labels in place.
     */
    getBaseline(): number | null {
        return null;
    }

    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement()!;

        if (this._options.rows !== undefined) {
            el.setAttribute("rows", String(this._options.rows));
        }

        if (this._options.cols !== undefined) {
            el.setAttribute("cols", String(this._options.cols));
        }

        if (this._options.wrap !== undefined) {
            el.setAttribute("wrap", this._options.wrap);
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
        this.setText(element.value);
    }

}

const TextAreaCallable = callable(TextArea);
type TextAreaCallable = TextArea;
export {
    TextArea         as _TextArea,
    TextAreaCallable as TextArea
};
