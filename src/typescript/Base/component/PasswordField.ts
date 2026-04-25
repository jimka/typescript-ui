// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text } from "./Text.js";
import { Insets } from "../Insets.js";

export class PasswordField extends Text { // TODO: Don't inherit from Text!

    constructor() {
        super("input");

        this.setPreferredSize(200, 20);
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);
        this.setCursor("text");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");
    }

    getElement(createIfMissing: boolean = false): HTMLInputElement {
        return super.getElement(createIfMissing) as HTMLInputElement;
    }

    setText(text: String) {
        super.setText(text);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.textContent = null;
        element.value = text.valueOf();
    }

    render() {
        let element = <HTMLInputElement>super.render();

        element.setAttribute("type", "password");

        element.textContent = null;
        element.value = this.getText().valueOf();

        return element;
    }
}