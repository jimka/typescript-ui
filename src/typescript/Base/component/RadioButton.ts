// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { HBox } from "../layout/HBox.js";
import { Input } from "./Input.js";
import { Label } from "./Label.js";

/**
 * A radio button component composed of an `<input type="radio">` and an associated Label.
 *
 * The label's `for` attribute is wired to the radio input's ID so clicking the label
 * toggles the radio. The selected state is kept in sync via a 'change' listener.
 */
export class RadioButton extends Component {

    private selected: boolean;
    private label: Label;
    private radio: Input;

    constructor(text? : string) {
        super();

        this.setLayoutManager(new HBox());

        this.radio = new Input();

        this.label = new Label(text);
        this.label.setForId(this.radio.getId());

        this.addComponent(this.radio);
        this.addComponent(this.label);

        this.selected = false;

        this.radio.setPreferredSize(20, 20);
        this.radio.setMaxSize(16, 16);
        this.radio.setCursor("pointer");

        this.addActionListener(() => {
            this.selected = this.radio.getElement().checked;
        });
    }

    /**
     * Returns the DOM element cast to HTMLInputElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's container element cast to HTMLInputElement.
     */
    getElement(createIfMissing: boolean = false) {
        return <HTMLInputElement>super.getElement(createIfMissing);
    }

    /**
     * Registers a listener for the radio input's 'change' event.
     *
     * @param listener - The callback to invoke when the radio selection changes.
     */
    addActionListener(listener: Function) {
        Event.addListener(this.radio, "change", listener);
    }

    /**
     * Sets the selected state and updates the radio input's checked property.
     *
     * @param value - True to select the radio button, false to deselect it.
     */
    setSelected(value: boolean) {
        this.selected = !!value;

        let element = this.radio.getElement();
        if (!element) {
            return;
        }

        element.checked = this.isSelected();
    }

    /**
     * Returns whether the radio button is currently selected.
     *
     * @returns True if the radio button is checked.
     */
    isSelected() {
        return this.selected;
    }

    /**
     * Renders the container element and sets the radio input type and checked state.
     *
     * @returns The created container HTMLInputElement with the internal radio input initialised.
     */
    render() {
        let element = <HTMLInputElement>super.render();
        let radioElement = this.radio.getElement();

        radioElement.setAttribute("type", "radio");
        radioElement.checked = this.isSelected();

        return element;
    }
}