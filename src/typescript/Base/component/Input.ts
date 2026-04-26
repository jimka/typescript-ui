// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";

export class Input extends Component {

    constructor(tag: string = "input") {
        super(tag);

        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
    }

    getElement(createIfMissing: boolean = false) {
        return super.getElement(createIfMissing) as HTMLInputElement & HTMLTextAreaElement;
    }

    applyStyle(element: HTMLElement) {
        super.applyStyle(element);

        let rule = this.getCSSRule();
        rule.style.fontFamily = "sans-serif";
        rule.style.fontSize = "12px";
    }

    protected render() {
        return super.render() as HTMLInputElement & HTMLTextAreaElement;
    }
}
