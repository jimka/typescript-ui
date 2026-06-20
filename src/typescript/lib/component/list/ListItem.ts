// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";

/**
 * Construction-time options for {@link ListItem}.
 *
 * @category Components
 */
export interface ListItemOptions extends ComponentOptions {
    text?: string;
}

/**
 * Class-level defaults. The constructor merges the positional `value` in
 * as the bag's `text` default so the cascade-time `applyOptions` seeds
 * `_value` for both the positional and option paths (a caller-supplied
 * `text` overrides the positional via the standard options-over-defaults
 * merge).
 */
const _defaultListItemOptions: Partial<ListItemOptions> = {
    tag: "li",
};

/**
 * A single list item component backed by a `<li>` element.
 *
 * Stores a key/value pair and suppresses framework positioning styles so
 * the browser can render the item natively inside a list.
 *
 * @category Components
 */
class ListItem extends Component<ListItemOptions> {

    private _key: string;
    // `declare` rather than initializer-and-body-assign so the cascade-time
    // `applyOptions` write (sourced from the merged bag's `text`) survives.
    // The cascade always writes `_value` because the defaults bag carries
    // `text: value` (positional) — see the constructor's defaults merge.
    declare private _value: string;

    constructor(key: string, value: string, options?: ListItemOptions) {
        super(options, { ..._defaultListItemOptions, text: value });

        this._key = key;
    }

    /**
     * Applies a {@link ListItemOptions} bag, dispatching the item's display
     * text after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ListItemOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as ListItemOptions;

        if (opts.text !== undefined) {
            this._value = opts.text;
            const element = this.getElement();
            if (element) {
                DOM.sink.apply(element, { text: opts.text });
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
        return this._key;
    }

    /**
     * Renders the li element, sets its data-key attribute, and populates its text content.
     *
     * @returns The created HTMLElement (`<li>`) with data-key and textContent set.
     */
    render() {
        let element = super.render();

        DOM.sink.apply(element, { dataset: { key: this._key }, text: this._value });

        return element;
    }
}

const ListItemCallable = callable(ListItem);
type ListItemCallable = ListItem;
export {
    ListItem         as _ListItem,
    ListItemCallable as ListItem
};
