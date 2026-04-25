// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput } from "./TextInput.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";

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

    destructor() {
        //Util.removeListener("input", this.onInput);
    }

    onInput() {
        let element = this.getElement();
        this.setText(element.value);
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "input", listener);
    }

    render() {
        let element = super.render();

        element.setAttribute("type", "text");

        return element;
    }
}
