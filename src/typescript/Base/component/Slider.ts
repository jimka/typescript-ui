import { Component } from "../Component.js";
import { Event } from "../Event.js";

export class Slider extends Component {

    private minValue: number;
    private maxValue: number;
    private value: number;
    private step: number;

    constructor() {
        super("input");

        let me = this;

        this.minValue = 0;
        this.maxValue = 100;
        this.value = 50;
        this.step = 1;

        this.setPreferredSize(200, 20);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);

        this.addActionListener(function (evnt: UIEvent) {
            let target = <HTMLInputElement>evnt.target;
            if (!target) {
                return;
            }

            me.setValue(Number(target.value));
        });
    }

    getMinValue() {
        return this.minValue;
    }

    setMinValue(value: number) {
        this.minValue = value;

        this.setElementAttribute("min", value);
    }

    getMaxValue() {
        return this.maxValue;
    }

    setMaxValue(value: number) {
        this.maxValue = value;

        this.setElementAttribute("max", value);
    }

    getStep() {
        return this.step;
    }

    setStep(value: number) {
        this.step = value;

        this.setElementAttribute("step", value);
    }

    getValue() {
        return this.value;
    }

    setValue(value: number) {
        this.value = value;

        this.setElementAttribute("value", value);
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "input", listener);
    }

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