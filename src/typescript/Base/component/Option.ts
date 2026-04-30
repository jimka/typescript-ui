// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";

/**
 * An option component backed by an `<option>` element for use inside a ComboBox or List.
 *
 * Suppresses framework positioning styles so the browser renders the option natively.
 */
export class Option extends Component {

    private key: string;
    private value: string;

    constructor(key: string, value: string) {
        super("option");

        this.key = key;
        this.value = value;
    }

    /**
     * Overrides applyStyle as a no-op; framework positioning styles break native option rendering inside `<select>`.
     */
    applyStyle() {
        // Framework styles (absolute positioning etc.) break native option rendering inside <select>.
    }

    /**
     * Renders the option element and sets its value attribute and text content.
     *
     * @returns The created HTMLOptionElement with value and textContent set.
     */
    render() {
        let element = super.render() as HTMLOptionElement;

        element.value = this.key;
        element.textContent = this.value;

        return element;
    }
}
