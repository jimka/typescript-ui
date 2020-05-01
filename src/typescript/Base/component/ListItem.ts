import { Component } from "../Component.js";

export class ListItem extends Component {

    private key: String;
    private value: String;

    constructor(key: string, value: string) {
        super("li");

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