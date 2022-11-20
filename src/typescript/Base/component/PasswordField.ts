import { Text } from "./Text.js";
import { Insets } from "../Insets.js";

export class PasswordField extends Text { // TODO: Don't inherit from Text!

    constructor() {
        super("input");

        this.setPreferredSize(200, 20);
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);
        this.setCursor("text");
        this.setBackgroundColor("rgb(255, 255, 255");
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