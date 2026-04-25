// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput } from "./TextInput.js";
import { Insets } from "../Insets.js";

export class PasswordField extends TextInput {

    constructor() {
        super();

        this.setPreferredSize(200, 20);
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);
        this.setCursor("text");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");
    }

    render() {
        let element = super.render();

        element.setAttribute("type", "password");

        return element;
    }
}
