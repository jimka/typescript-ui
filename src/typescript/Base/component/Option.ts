import { Text } from "./Text.js";

export class Option extends Text {

    private key: String;
    private value: String;

    constructor(key: String, value: String) {
        super("option", value);

        this.key = key;
        this.value = value;
    }

    applyStyle() {
        // The component styles messes with the browser rendering too much here, so we skip them.
        // TODO: Fix!
    }

    render() {
        let element = <HTMLOptionElement>super.render();

        element.value = this.key.valueOf();
        element.textContent = this.value.valueOf();

        return element;
    }
}