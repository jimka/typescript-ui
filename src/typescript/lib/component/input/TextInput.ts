// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input, InputOptions } from "~/component/input/Input.js";
import { Util } from "~/core/Util.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link TextInput}.
 *
 * @category Components
 */
export interface TextInputOptions extends InputOptions {
    text?:         string;
    textAlign?:    string | null;
    placeholder?:  string;
    readOnly?:     boolean;
    maxLength?:    number;
    inputMode?:    string;
    autoComplete?: string;
}

/**
 * Base class for single-line and multi-line text input components.
 *
 * Tracks the current text value and text-align internally and exposes text selection support.
 */
class TextInput<TOptions extends TextInputOptions = TextInputOptions> extends Input<TOptions> {

    private _inputMode:    string | null = null;
    private _autoComplete: string | null = null;
    declare private _textAlign: string | null;

    constructor(options?: TOptions) {
        super({ ...(options ?? {}), tag: options?.tag ?? "input" } as TOptions);
    }

    /**
     * Applies a {@link TextInputOptions} bag, dispatching text, alignment, and
     * native HTML attributes (placeholder, readOnly, maxLength) after
     * inherited Input/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.setText(options.text);
        }

        if (options.textAlign !== undefined) {
            this.setTextAlign(options.textAlign);
        }

        if (options.placeholder !== undefined) {
            this.setPlaceholder(options.placeholder);
        }

        if (options.readOnly !== undefined) {
            this.setReadOnly(options.readOnly);
        }

        if (options.maxLength !== undefined) {
            this.setMaxLength(options.maxLength);
        }

        if (options.inputMode !== undefined) {
            this.setInputMode(options.inputMode);
        }

        if (options.autoComplete !== undefined) {
            this.setAutoComplete(options.autoComplete);
        }

        return this;
    }

    /**
     * Returns the cached HTML `inputmode` attribute value, or null when unset.
     *
     * @returns The inputmode string, or null.
     */
    getInputMode(): string | null {
        return this._inputMode;
    }

    /**
     * Sets the HTML `inputmode` attribute on the underlying input. Typical
     * values are `"none"` (suppress on-screen keyboards), `"text"`,
     * `"numeric"`, `"decimal"`, `"tel"`, `"email"`, `"url"`, `"search"`.
     *
     * @param value - A valid `inputmode` value.
     *
     * @returns This component, for method chaining.
     */
    setInputMode(value: string): this {
        if (this._inputMode === value) {
            return this;
        }

        this._inputMode = value;
        this._options.inputMode = value;

        // `setAttribute` (vs. `setElementAttribute`) caches into the
        // `_attributes` map so the write survives detached construction and
        // gets replayed at render time.
        this.setAttribute("inputmode", value);

        return this;
    }

    /**
     * Removes the HTML `inputmode` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearInputMode(): this {
        if (this._inputMode === null) {
            return this;
        }

        this._inputMode = null;
        this._options.inputMode = undefined;

        this.delAttribute("inputmode");

        return this;
    }

    /**
     * Returns the cached HTML `autocomplete` attribute value, or null when unset.
     *
     * @returns The autocomplete string, or null.
     */
    getAutoComplete(): string | null {
        return this._autoComplete;
    }

    /**
     * Sets the HTML `autocomplete` attribute on the underlying input. Common
     * values are `"on"`, `"off"`, `"email"`, `"current-password"`, etc.
     *
     * @param value - A valid `autocomplete` token.
     *
     * @returns This component, for method chaining.
     */
    setAutoComplete(value: string): this {
        if (this._autoComplete === value) {
            return this;
        }

        this._autoComplete = value;
        this._options.autoComplete = value;

        this.setAttribute("autocomplete", value);

        return this;
    }

    /**
     * Removes the HTML `autocomplete` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearAutoComplete(): this {
        if (this._autoComplete === null) {
            return this;
        }

        this._autoComplete = null;
        this._options.autoComplete = undefined;

        this.delAttribute("autocomplete");

        return this;
    }

    /**
     * Returns the offset from the top of the text input to its inner-text baseline.
     *
     * @returns The baseline offset in pixels.
     *
     * @remarks Adds the component's top border and CSS padding-top to the native
     * input's intrinsic baseline. `insets` is layout-side metadata used only
     * when sizing children; for a leaf input it does not visually push the
     * rendered element down, so it is excluded from the baseline. `padding` is
     * applied as real CSS padding (with `box-sizing: border-box`) and shifts
     * the inner text down. Bare [`Input`](/api/component/input/classes/Input) subclasses without inner text (e.g.
     * [`Checkbox`](/api/component/input/classes/Checkbox), the inner radio of [`RadioButton`](/api/component/input/classes/RadioButton)) inherit the default `null`
     * baseline from [`Component`](/api/core/classes/Component) and are treated as graphical elements by
     * horizontal layouts.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(Util.measureInputBaseline());
    }

    /**
     * Returns the current CSS text-align value.
     *
     * @returns The CSS text-align string, or null if not set.
     */
    getTextAlign(): string | null {
        return this._textAlign ?? null;
    }

    /**
     * Sets the CSS text-align and updates the component's CSS rule.
     *
     * @param align - A CSS text-align value (e.g. "left", "center", "right"),
     *   or null to clear the rule.
     *
     * @returns This component, for method chaining.
     */
    setTextAlign(align: string | null): this {
        this._textAlign         = align;
        this._options.textAlign = align;

        this.setElementCSSRule("textAlign", align);

        return this;
    }

    /**
     * Clears the CSS text-align value, removing the rule.
     *
     * @returns This component, for method chaining.
     */
    clearTextAlign(): this {
        return this.setTextAlign(null);
    }

    /**
     * Returns the current text value.
     *
     * @returns The current text string.
     */
    getText(): string {
        return this._options.text ?? "";
    }

    /**
     * Sets the text value and updates the DOM element's value property.
     *
     * @param text - The new text value.
     *
     * @returns This component, for method chaining.
     */
    setText(text: string): this {
        this._options.text = text || "";

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.value = this._options.text;

        return this;
    }

    /**
     * Returns the placeholder text shown when the input is empty, or null if none is set.
     *
     * @returns The placeholder string, or null.
     */
    getPlaceholder(): string | null {
        return this._options.placeholder ?? null;
    }

    /**
     * Sets the HTML `placeholder` attribute on the underlying input.
     *
     * @param value - The placeholder text.
     *
     * @returns This component, for method chaining.
     */
    setPlaceholder(value: string): this {
        this._options.placeholder = value;
        this.setAttribute("placeholder", value);

        return this;
    }

    /**
     * Removes the HTML `placeholder` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearPlaceholder(): this {
        if (this._options.placeholder === undefined) {
            return this;
        }

        this._options.placeholder = undefined;
        this.delAttribute("placeholder");

        return this;
    }

    /**
     * Returns whether the input is in read-only mode.
     *
     * @returns True if the `readonly` attribute is set.
     */
    isReadOnly(): boolean {
        return this._options.readOnly ?? false;
    }

    /**
     * Sets the HTML `readonly` attribute on the underlying input.
     *
     * @param value - True to mark the input as read-only, false to remove the attribute.
     *
     * @returns This component, for method chaining.
     */
    setReadOnly(value: boolean): this {
        this._options.readOnly = value;

        if (value) {
            this.setAttribute("readonly", "");
        } else {
            this.delAttribute("readonly");
        }

        return this;
    }

    /**
     * Returns the configured maximum text length, or null if unset.
     *
     * @returns The maxlength value, or null.
     */
    getMaxLength(): number | null {
        return this._options.maxLength ?? null;
    }

    /**
     * Sets the HTML `maxlength` attribute on the underlying input.
     *
     * @param value - The maximum number of characters allowed.
     *
     * @returns This component, for method chaining.
     */
    setMaxLength(value: number): this {
        this._options.maxLength = value;
        this.setAttribute("maxlength", String(value));

        return this;
    }

    /**
     * Removes the HTML `maxlength` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearMaxLength(): this {
        if (this._options.maxLength === undefined) {
            return this;
        }

        this._options.maxLength = undefined;
        this.delAttribute("maxlength");

        return this;
    }

    /**
     * Selects a range of text in the input; defaults to selecting all if start/end are omitted.
     *
     * @param start - Optional. The start index of the selection. Defaults to 0.
     * @param end - Optional. The end index of the selection. Defaults to the text length + 1.
     *
     * @returns This component, for method chaining.
     */
    select(start?: number, end?: number): this {
        let element = this.getElement();
        if (!element) {
            return this;
        }

        if (!start || start < 0) {
            start = 0;
        }

        const text = this._options.text ?? "";
        if (!end || end > text.length) {
            end = text.length + 1;
        }

        element.setSelectionRange(start, end);

        return this;
    }

    /**
     * Renders the input element and sets its initial value.
     *
     * @returns The created input element with its value initialised.
     */
    protected render() {
        let element = super.render();

        element.value = this._options.text ?? "";

        return element;
    }
}

const TextInputCallable = callable(TextInput);
type TextInputCallable<TOptions extends TextInputOptions = TextInputOptions> = TextInput<TOptions>;
export {
    TextInput         as _TextInput,
    TextInputCallable as TextInput
};
