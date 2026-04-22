// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";

export class ListItem extends Component {

    private key: string;
    private value: string;

    constructor(key: string, value: string) {
        super("li");

        this.key = key;
        this.value = value;
    }

    applyStyle() {
        // Framework styles (absolute positioning etc.) break native list rendering.
    }

    getKey() {
        return this.key;
    }

    render() {
        let element = super.render();

        element.dataset.key = this.key;
        element.textContent = this.value;

        return element;
    }
}