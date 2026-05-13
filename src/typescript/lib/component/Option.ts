// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "../Component.js";
import { callable } from "../Callable.js";

/**
 * Construction-time options for {@link Option}.
 *
 * @category Components
 */
export interface OptionOptions extends ComponentOptions {
    text?:     string;
    value?:    string;
    selected?: boolean;
    disabled?: boolean;
}

/**
 * An option component backed by an `<option>` element for use inside a ComboBox or List.
 *
 * Suppresses framework positioning styles so the browser renders the option natively.
 *
 * @category Components
 */
class Option extends Component {

    private key: string;
    private value: string;

    constructor(key: string, value: string, options?: OptionOptions) {
        super({ tag: "option" });

        this.key = key;
        this.value = value;

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link OptionOptions} bag, dispatching option label, value,
     * selected, and disabled attributes after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: OptionOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.value = options.text;
            const element = this.getElement() as HTMLOptionElement | undefined;
            if (element) {
                element.textContent = options.text;
            }
        }

        if (options.value !== undefined) {
            this.key = options.value;
            const element = this.getElement() as HTMLOptionElement | undefined;
            if (element) {
                element.value = options.value;
            }
        }

        if (options.selected !== undefined) {
            this.setElementAttribute("selected", options.selected ? "" : null);
        }

        if (options.disabled !== undefined) {
            this.setElementAttribute("disabled", options.disabled ? "" : null);
        }

        return this;
    }

    /**
     * Overrides applyStyle as a no-op; framework positioning styles break native option rendering inside `<select>`.
     *
     * @returns This component, for method chaining.
     */
    applyStyle(): this {
        // Framework styles (absolute positioning etc.) break native option rendering inside <select>.
        return this;
    }

    /**
     * Renders the option element and sets its value attribute and text content.
     *
     * @returns The created HTMLOptionElement with value and textContent set.
     */
    render() {
        let element = super.render() as HTMLOptionElement;

        element.value = this.key;
        element.textContent = this.value;

        return element;
    }
}

const OptionCallable = callable(Option);
type OptionCallable = Option;
export {
    Option         as _Option,
    OptionCallable as Option
};
