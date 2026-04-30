// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput } from "./TextInput.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";

/**
 * A single-line text field component backed by an `<input type="text">` element.
 *
 * Keeps internal text state in sync with the DOM on every input event.
 */
export class TextField extends TextInput {

    constructor() {
        super();

        this.setCursor("text");
        this.setPreferredSize(200, 20);
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");

        Event.addListener(this, "input", this.onInput);
    }

    /**
     * Cleanup hook; currently a no-op placeholder.
     */
    destructor() {
        //Util.removeListener("input", this.onInput);
    }

    /**
     * Syncs the text content from the DOM element's value on every input event.
     */
    onInput() {
        let element = this.getElement();
        this.setText(element.value);
    }

    /**
     * Registers a listener for the 'input' event, fired on every keystroke.
     *
     * @param listener - The callback to invoke on each input event.
     */
    addActionListener(listener: Function) {
        Event.addListener(this, "input", listener);
    }

    /**
     * Renders the input element with type="text".
     *
     * @returns The created input element with its type attribute set to "text".
     */
    render() {
        let element = super.render();

        element.setAttribute("type", "text");

        return element;
    }
}
