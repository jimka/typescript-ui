// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input } from "./Input.js";

export class TextInput extends Input {

    private text: String = "";

    constructor(tag: string = "input") {
        super(tag);
    }

    getText(): String {
        return this.text;
    }

    setText(text: String) {
        this.text = text || "";

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.value = this.text.valueOf();
    }

    select(start?: number, end?: number) {
        let element = this.getElement();
        if (!element) {
            return;
        }

        if (!start || start < 0) {
            start = 0;
        }

        if (!end || end > this.text.length) {
            end = this.text.length + 1;
        }

        element.setSelectionRange(start, end);
    }

    protected render() {
        let element = super.render();

        element.value = this.text.valueOf();

        return element;
    }
}
