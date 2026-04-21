import { Text } from "./Text.js";

export class Option extends Text {

    private key: string;
    private value: string;

    constructor(key: string, value: string) {
        super("option", value);

        this.key = key;
        this.value = value;
    }

    applyStyle() {
        // Framework styles (absolute positioning etc.) break native option rendering inside <select>.
    }

    render() {
        let element = <HTMLOptionElement>super.render();

        element.value = this.key;
        element.textContent = this.value;

        return element;
    }
}