// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";

export class Option extends Component {

    private key: string;
    private value: string;

    constructor(key: string, value: string) {
        super("option");

        this.key = key;
        this.value = value;
    }

    applyStyle() {
        // Framework styles (absolute positioning etc.) break native option rendering inside <select>.
    }

    render() {
        let element = super.render() as HTMLOptionElement;

        element.value = this.key;
        element.textContent = this.value;

        return element;
    }
}
