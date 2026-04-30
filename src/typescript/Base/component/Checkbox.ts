// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Event } from "../Event.js";
import { Input } from "./Input.js";
import { Bindable } from "../Bindable.js";

/**
 * A checkbox input component.
 *
 * Wraps an `<input type="checkbox">` element and tracks checked state internally,
 * keeping it synchronised with the DOM after each click.
 */
export class Checkbox extends Input implements Bindable<boolean> {

    private selected: boolean;

    constructor() {
        super();

        this.selected = false;

        this.setPreferredSize(16, 16);
        this.setMaxSize(16, 16);
        this.setCursor("pointer");

        this.addActionListener(this.onAction);
    }

    /**
     * Syncs the selected state from the DOM element's checked property after a click.
     */
    onAction() {
        let element = this.getElement();
        this.selected = element.checked;
    }

    /**
     * Registers a click event listener on this checkbox.
     *
     * @param listener - The callback to invoke on each click.
     */
    addActionListener(listener: Function) {
        Event.addListener(this, "click", listener);
    }

    setValue(value: boolean): void {
        this.setSelected(value);
    }

    getValue(): boolean {
        return this.isSelected();
    }

    addBindingListener(fn: () => void): void {
        this.addActionListener(fn);
    }

    /**
     * Sets the selected state and updates the checkbox element's checked property.
     *
     * @param value - True to check the box, false to uncheck it.
     */
    setSelected(value: boolean) {
        this.selected = !!value;

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.checked = this.isSelected();
    }

    /**
     * Returns whether the checkbox is currently checked.
     *
     * @returns True if the checkbox is checked.
     */
    isSelected() {
        return this.selected;
    }

    /**
     * Renders the input element with type="checkbox" and initial checked state.
     *
     * @returns The created HTMLInputElement with type and checked initialised.
     */
    render() {
        let element = super.render();

        element.setAttribute("type", "checkbox");
        element.checked = this.isSelected();

        return element;
    }
}