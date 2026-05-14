// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input, InputOptions } from "~/component/Input.js";
import { Event } from "~/Event.js";
import { ThemeManager } from "~/Theme.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time options for {@link Slider}.
 *
 * @category Components
 */
export interface SliderOptions extends InputOptions {
    minValue?: number;
    maxValue?: number;
    value?:    number;
    step?:     number;
}

/**
 * A range slider input component backed by an `<input type="range">` element.
 *
 * Tracks min, max, step, and current value internally and keeps the DOM element
 * synchronised on every input event.
 *
 * @category Components
 */
class Slider extends Input {

    private minValue: number = 0;
    private maxValue: number = 100;
    private value: number = 50;
    private step: number = 1;

    constructor(options?: SliderOptions) {
        super();

        let me = this;

        this.setPreferredSize(200, 20);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setColorScheme(ThemeManager.getTheme().colorScheme);

        ThemeManager.onThemeChange(() => this.setColorScheme(ThemeManager.getTheme().colorScheme));

        this.addActionListener(function (evnt: UIEvent) {
            let target = <HTMLInputElement>evnt.target;
            if (!target) {
                return;
            }

            me.setValue(Number(target.value));
        });

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link SliderOptions} bag, dispatching range bounds, step, and
     * current value after inherited Input/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: SliderOptions): this {
        super.applyOptions(options);

        if (options.minValue !== undefined) {
            this.setMinValue(options.minValue);
        }

        if (options.maxValue !== undefined) {
            this.setMaxValue(options.maxValue);
        }

        if (options.step !== undefined) {
            this.setStep(options.step);
        }

        if (options.value !== undefined) {
            this.setValue(options.value);
        }

        return this;
    }

    /**
     * Returns the minimum value of the slider range.
     *
     * @returns The minimum value.
     */
    getMinValue() {
        return this.minValue;
    }

    /**
     * Sets the minimum value and updates the DOM element's min attribute.
     *
     * @param value - The new minimum value.
     *
     * @returns This component, for method chaining.
     */
    setMinValue(value: number): this {
        this.minValue = value;

        this.setElementAttribute("min", value);

        return this;
    }

    /**
     * Returns the maximum value of the slider range.
     *
     * @returns The maximum value.
     */
    getMaxValue() {
        return this.maxValue;
    }

    /**
     * Sets the maximum value and updates the DOM element's max attribute.
     *
     * @param value - The new maximum value.
     *
     * @returns This component, for method chaining.
     */
    setMaxValue(value: number): this {
        this.maxValue = value;

        this.setElementAttribute("max", value);

        return this;
    }

    /**
     * Returns the slider step increment.
     *
     * @returns The step value.
     */
    getStep() {
        return this.step;
    }

    /**
     * Sets the slider step increment and updates the DOM element's step attribute.
     *
     * @param value - The new step increment.
     *
     * @returns This component, for method chaining.
     */
    setStep(value: number): this {
        this.step = value;

        this.setElementAttribute("step", value);

        return this;
    }

    /**
     * Returns the current slider value.
     *
     * @returns The current value.
     */
    getValue() {
        return this.value;
    }

    /**
     * Sets the current slider value and updates the DOM element's value attribute.
     *
     * @param value - The new value, which should be within the min/max range.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: number): this {
        this.value = value;

        this.setElementAttribute("value", value);

        return this;
    }

    /**
     * Registers a listener for the slider's 'input' event, fired on every value change.
     *
     * @param listener - The callback to invoke with each input event as the slider moves.
     *
     * @returns This component, for method chaining.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this, "input", listener);

        return this;
    }

    /**
     * Renders the input element with type="range" and initial min/max/step/value attributes.
     *
     * @returns The created input element with all range attributes initialised.
     */
    render() {
        let element = super.render();

        element.setAttribute("type", "range");
        element.setAttribute("min", String(this.minValue));
        element.setAttribute("max", String(this.maxValue));
        element.setAttribute("step", String(this.step));
        element.setAttribute("value", String(this.value));

        return element;
    }
}

const SliderCallable = callable(Slider);
type SliderCallable = Slider;
export {
    Slider         as _Slider,
    SliderCallable as Slider
};
