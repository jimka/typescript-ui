// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/Component.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time options for {@link ListItem}.
 *
 * @category Components
 */
export interface ListItemOptions extends ComponentOptions {
    text?: string;
}

/**
 * A single list item component backed by a `<li>` element.
 *
 * Stores a key/value pair and suppresses framework positioning styles so
 * the browser can render the item natively inside a list.
 *
 * @category Components
 */
class ListItem extends Component {

    private key: string;
    private value: string;

    constructor(key: string, value: string, options?: ListItemOptions) {
        super({ tag: "li" });

        this.key = key;
        this.value = value;

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link ListItemOptions} bag, dispatching the item's display
     * text after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ListItemOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.value = options.text;
            const element = this.getElement();
            if (element) {
                element.textContent = options.text;
            }
        }

        return this;
    }

    /**
     * Overrides applyStyle as a no-op; framework positioning styles break native list rendering.
     *
     * @returns This component, for method chaining.
     */
    applyStyle(): this {
        // Framework styles (absolute positioning etc.) break native list rendering.
        return this;
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

const ListItemCallable = callable(ListItem);
type ListItemCallable = ListItem;
export {
    ListItem         as _ListItem,
    ListItemCallable as ListItem
};
