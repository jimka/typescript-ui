// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";

/**
 * A single list item component backed by a `<li>` element.
 *
 * Stores a key/value pair and suppresses framework positioning styles so
 * the browser can render the item natively inside a list.
 */
export class ListItem extends Component {

    private key: string;
    private value: string;

    constructor(key: string, value: string) {
        super("li");

        this.key = key;
        this.value = value;
    }

    /**
     * Overrides applyStyle as a no-op; framework positioning styles break native list rendering.
     */
    applyStyle() {
        // Framework styles (absolute positioning etc.) break native list rendering.
    }

    /**
     * Returns the data-key identifier for this list item.
     *
     * @returns The key string.
     */
    getKey() {
        return this.key;
    }

    /**
     * Renders the li element, sets its data-key attribute, and populates its text content.
     *
     * @returns The created HTMLElement (`<li>`) with data-key and textContent set.
     */
    render() {
        let element = super.render();

        element.dataset.key = this.key;
        element.textContent = this.value;

        return element;
    }
}