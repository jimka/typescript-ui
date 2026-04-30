// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input } from "./Input.js";
import { Event } from "../Event.js";

/**
 * A range slider input component backed by an `<input type="range">` element.
 *
 * Tracks min, max, step, and current value internally and keeps the DOM element
 * synchronised on every input event.
 */
export class Slider extends Input {

    private minValue: number;
    private maxValue: number;
    private value: number;
    private step: number;

    constructor() {
        super();

        let me = this;

        this.minValue = 0;
        this.maxValue = 100;
        this.value = 50;
        this.step = 1;

        this.setPreferredSize(200, 20);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");

        this.addActionListener(function (evnt: UIEvent) {
            let target = <HTMLInputElement>evnt.target;
            if (!target) {
                return;
            }

            me.setValue(Number(target.value));
        });
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
     */
    setMinValue(value: number) {
        this.minValue = value;

        this.setElementAttribute("min", value);
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
     */
    setMaxValue(value: number) {
        this.maxValue = value;

        this.setElementAttribute("max", value);
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
     */
    setStep(value: number) {
        this.step = value;

        this.setElementAttribute("step", value);
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
     */
    setValue(value: number) {
        this.value = value;

        this.setElementAttribute("value", value);
    }

    /**
     * Registers a listener for the slider's 'input' event, fired on every value change.
     *
     * @param listener - The callback to invoke with each input event as the slider moves.
     */
    addActionListener(listener: Function) {
        Event.addListener(this, "input", listener);
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
