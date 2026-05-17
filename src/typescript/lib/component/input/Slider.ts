// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input, InputOptions } from "~/component/input/Input.js";
import { Event } from "~/core/Event.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";

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
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins. `colorScheme` is
 * *not* listed here because it must be read from the live `ThemeManager` at
 * each construction (the const would freeze the value at module-load time);
 * the in-body guard below keeps that lookup dynamic.
 */
const _defaultSliderOptions: Partial<SliderOptions> = {
    preferredSize:   { width: 200, height: 20 } as SliderOptions["preferredSize"],
    maxSize:         { width: Number.MAX_SAFE_INTEGER, height: 20 } as SliderOptions["maxSize"],
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
};

/**
 * A range slider input component backed by an `<input type="range">` element.
 *
 * Tracks min, max, step, and current value internally and keeps the DOM element
 * synchronised on every input event.
 *
 * @category Components
 */
class Slider<TOptions extends SliderOptions = SliderOptions> extends Input<TOptions> {

    constructor(options?: TOptions) {
        super({ ..._defaultSliderOptions, ...(options ?? {}) } as TOptions);

        let me = this;

        if (this._options.colorScheme === undefined) {
            this.setColorScheme(ThemeManager.getTheme().colorScheme);
        }

        ThemeManager.onThemeChange(() => this.setColorScheme(ThemeManager.getTheme().colorScheme));

        this.addActionListener(function (evnt: UIEvent) {
            let target = <HTMLInputElement>evnt.target;
            if (!target) {
                return;
            }

            me.setValue(Number(target.value));
        });
    }

    /**
     * Applies a {@link SliderOptions} bag, dispatching range bounds, step, and
     * current value after inherited Input/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
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
    getMinValue(): number {
        return this._options.minValue ?? 0;
    }

    /**
     * Sets the minimum value and updates the DOM element's min attribute.
     *
     * @param value - The new minimum value.
     *
     * @returns This component, for method chaining.
     */
    setMinValue(value: number): this {
        this._options.minValue = value;

        this.setAttribute("min", String(value));

        return this;
    }

    /**
     * Returns the maximum value of the slider range.
     *
     * @returns The maximum value.
     */
    getMaxValue(): number {
        return this._options.maxValue ?? 100;
    }

    /**
     * Sets the maximum value and updates the DOM element's max attribute.
     *
     * @param value - The new maximum value.
     *
     * @returns This component, for method chaining.
     */
    setMaxValue(value: number): this {
        this._options.maxValue = value;

        this.setAttribute("max", String(value));

        return this;
    }

    /**
     * Returns the slider step increment.
     *
     * @returns The step value.
     */
    getStep(): number {
        return this._options.step ?? 1;
    }

    /**
     * Sets the slider step increment and updates the DOM element's step attribute.
     *
     * @param value - The new step increment.
     *
     * @returns This component, for method chaining.
     */
    setStep(value: number): this {
        this._options.step = value;

        this.setAttribute("step", String(value));

        return this;
    }

    /**
     * Returns the current slider value.
     *
     * @returns The current value.
     */
    getValue(): number {
        return this._options.value ?? 50;
    }

    /**
     * Sets the current slider value and updates the DOM element's value attribute.
     *
     * @param value - The new value, which should be within the min/max range.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: number): this {
        this._options.value = value;

        this.setAttribute("value", String(value));

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
        element.setAttribute("min", String(this.getMinValue()));
        element.setAttribute("max", String(this.getMaxValue()));
        element.setAttribute("step", String(this.getStep()));
        element.setAttribute("value", String(this.getValue()));

        return element;
    }
}

const SliderCallable = callable(Slider);
type SliderCallable<TOptions extends SliderOptions = SliderOptions> = Slider<TOptions>;
export {
    Slider         as _Slider,
    SliderCallable as Slider
};
