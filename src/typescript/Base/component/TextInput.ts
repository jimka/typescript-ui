// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input } from "./Input.js";

export class TextInput extends Input {

    private text: String = "";
    private textAlign: string | null = null;

    constructor(tag: string = "input") {
        super(tag);
    }

    getTextAlign() {
        return this.textAlign;
    }

    setTextAlign(align: string) {
        this.textAlign = align;

        this.setElementCSSRule("textAlign", align);
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

    applyStyle(element: HTMLElement) {
        super.applyStyle(element);

        let rule = this.getCSSRule();
        rule.style.textAlign = this.textAlign ? this.textAlign : "";
    }

    protected render() {
        let element = super.render();

        element.value = this.text.valueOf();

        return element;
    }
}
