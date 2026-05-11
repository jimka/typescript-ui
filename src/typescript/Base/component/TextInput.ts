// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input, InputOptions } from "./Input.js";
import { Util } from "../Util.js";

/**
 * Construction-time options for {@link TextInput}.
 *
 * @category Components
 */
export interface TextInputOptions extends InputOptions {
    text?:        string;
    textAlign?:   string;
    placeholder?: string;
    readOnly?:    boolean;
    maxLength?:   number;
}

/**
 * Base class for single-line and multi-line text input components.
 *
 * Tracks the current text value and text-align internally and exposes text selection support.
 */
export class TextInput extends Input {

    private text: String = "";
    private textAlign: string | null = null;

    constructor(options?: TextInputOptions) {
        super({ tag: options?.tag ?? "input" });

        if (this.constructor === TextInput && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link TextInputOptions} bag, dispatching text, alignment, and
     * native HTML attributes (placeholder, readOnly, maxLength) after
     * inherited Input/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TextInputOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.setText(options.text);
        }

        if (options.textAlign !== undefined) {
            this.setTextAlign(options.textAlign);
        }

        if (options.placeholder !== undefined) {
            this.setElementAttribute("placeholder", options.placeholder);
        }

        if (options.readOnly !== undefined) {
            this.setElementAttribute("readonly", options.readOnly ? "" : null);
        }

        if (options.maxLength !== undefined) {
            this.setElementAttribute("maxlength", String(options.maxLength));
        }

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
     * the inner text down. Bare `Input` subclasses without inner text (e.g.
     * `Checkbox`, the inner radio of `RadioButton`) inherit the default `null`
     * baseline from `Component` and are treated as graphical elements by
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
    getTextAlign() {
        return this.textAlign;
    }

    /**
     * Sets the CSS text-align and updates the component's CSS rule.
     *
     * @param align - A CSS text-align value (e.g. "left", "center", "right").
     *
     * @returns This component, for method chaining.
     */
    setTextAlign(align: string): this {
        this.textAlign = align;

        this.setElementCSSRule("textAlign", align);

        return this;
    }

    /**
     * Returns the current text value.
     *
     * @returns The current text string.
     */
    getText(): String {
        return this.text;
    }

    /**
     * Sets the text value and updates the DOM element's value property.
     *
     * @param text - The new text value.
     *
     * @returns This component, for method chaining.
     */
    setText(text: String): this {
        this.text = text || "";

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.value = this.text.valueOf();

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

        if (!end || end > this.text.length) {
            end = this.text.length + 1;
        }

        element.setSelectionRange(start, end);

        return this;
    }

    /**
     * Applies base input styles and writes text-align to the CSS rule.
     *
     * @param element - The HTMLElement to apply styles to.
     */
    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);

        let rule = this.getCSSRule();
        rule.style.textAlign = this.textAlign ? this.textAlign : "";

        return this;
    }

    /**
     * Renders the input element and sets its initial value.
     *
     * @returns The created input element with its value initialised.
     */
    protected render() {
        let element = super.render();

        element.value = this.text.valueOf();

        return element;
    }
}
