// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput } from "./TextInput.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";

/**
 * A multi-line text area component backed by a `<textarea>` element.
 *
 * Keeps internal text state in sync with the DOM on every input event.
 */
export class TextArea extends TextInput {

    constructor(text: string = "") {
        super("textarea");

        this.setCursor("text");
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setPreferredSize(200, 200);
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");
        if (text) {
            this.setText(text);
        }

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
     * Renders the textarea element with CSS resize disabled.
     *
     * @returns The created textarea element with resize set to "none".
     */
    render() {
        let element = super.render();

        element.style.resize = "none";

        return element;
    }
}
