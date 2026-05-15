// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Input}.
 *
 * @remarks `tag` is inherited from {@link ComponentOptions} but defaults to
 * `"input"` for `Input` (subclasses such as {@link TextArea} pass `"textarea"`).
 *
 * @category Components
 */
export interface InputOptions extends ComponentOptions {
    name?: string;
}

/**
 * Base class for input elements (`<input>` and `<textarea>`).
 *
 * Sets a white background by default and applies a sans-serif 12px font via the CSS rule.
 */
class Input extends Component {

    private name: string | null = null;

    constructor(options?: InputOptions) {
        super({ tag: options?.tag ?? "input" });

        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");

        if (this.constructor === Input && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link InputOptions} bag, including the optional `name`
     * attribute used by HTML form submission and radio grouping.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: InputOptions): this {
        super.applyOptions(options);

        if (options.name !== undefined) {
            this.setName(options.name);
        }

        return this;
    }

    /**
     * Sets the HTML `type` attribute on the underlying input element.
     *
     * Typically called once at construction time by subclasses (e.g. `RadioButton`
     * sets `"radio"`). Most consumers should not need this directly.
     *
     * @param value - The input type (e.g. "text", "radio", "checkbox").
     *
     * @returns This component, for method chaining.
     */
    setType(value: string): this {
        this.setElementAttribute("type", value);

        return this;
    }

    /**
     * Returns the HTML `name` attribute value, or null if unset.
     *
     * @returns The name string, or null.
     */
    getName(): string | null {
        return this.name;
    }

    /**
     * Sets the HTML `name` attribute on the underlying input.
     *
     * @param value - The name used for form submission and radio grouping.
     *
     * @returns This component, for method chaining.
     */
    setName(value: string): this {
        this.name = value;
        this.setElementAttribute("name", value);

        return this;
    }

    /**
     * Returns the DOM element cast to HTMLInputElement & HTMLTextAreaElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's element typed as both HTMLInputElement and HTMLTextAreaElement.
     */
    getElement(createIfMissing: boolean = false) {
        return super.getElement(createIfMissing) as HTMLInputElement & HTMLTextAreaElement;
    }

    /**
     * Applies base styles and sets a default sans-serif 12px font on the CSS rule.
     *
     * @param element - The HTMLElement to apply styles to.
     */
    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);

        let rule = this.getCSSRule();
        rule.style.fontFamily = "var(--ts-ui-font-family, sans-serif)";
        rule.style.fontSize   = "var(--ts-ui-font-size, 12px)";

        return this;
    }

    /**
     * Renders the input element cast to HTMLInputElement & HTMLTextAreaElement.
     *
     * @returns The created element typed as both HTMLInputElement and HTMLTextAreaElement.
     */
    protected render() {
        return super.render() as HTMLInputElement & HTMLTextAreaElement;
    }
}

const InputCallable = callable(Input);
type InputCallable = Input;
export {
    Input         as _Input,
    InputCallable as Input
};
