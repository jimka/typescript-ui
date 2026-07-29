// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
import { HBox } from "~/layout/HBox.js";
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
 * Pixels between the marker slot and the label — roughly one space at the
 * framework's default font size, which is what makes the two read as separate
 * runs rather than one word. Structural separation between two content slots,
 * the same role `IconText`'s `gap` plays.
 */
const MARKER_GAP_PX = 4;

/**
 * Class-level defaults. Only `tag` is a genuine class default; the
 * positional `value` is a per-instance value resolved in the constructor
 * body, not smuggled through this bag.
 */
const _defaultListItemOptions: Partial<ListItemOptions> = {
    tag: "li",
};

/**
 * A single list item component backed by a `<li>` element.
 *
 * Pairs a marker slot with a label, laid out horizontally. The marker is a real
 * child component rather than the browser's own `::marker`, so the framework
 * measures and positions it like any other content. Its owning list writes the
 * marker string and rewrites every item's whenever the children change; an item
 * never markers itself.
 *
 * @category Components
 */
class ListItem extends Component<ListItemOptions> {

    private _key: string;
    private _marker!: Text;
    private _text!:   Text;

    constructor(key: string, value: string, options?: ListItemOptions) {
        // The HBox sits in the defaults bag (under user options) so a caller
        // that wants a different layoutManager can still override it, and is
        // built per instance because a layout manager holds container state.
        super(options, {
            ..._defaultListItemOptions,
            layoutManager: new HBox({ spacing: MARKER_GAP_PX }),
        });

        this._key = key;

        this._marker = new Text();
        this._text   = new Text();

        this.addComponent(this._marker);
        // The label absorbs whatever width the marker leaves.
        this.addComponent(this._text, { weight: 1 });

        // The marker duplicates what a screen reader already announces from the
        // item's position in the list, so it is hidden from the accessibility
        // tree while the list and item carry explicit list semantics.
        this._marker.getAria().setHidden(true);
        this.getAria().setRole("listitem");

        // Late-built state: the text setter reaches into a child that did not
        // exist during super's cascade, so dispatch from `_options` now. An
        // explicit `text` option wins over the positional value.
        this.setText(this._options.text ?? value);
        this.setMarker("");
    }

    /**
     * Applies a {@link ListItemOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; `text` is written pure to `_options` here
     * and dispatched from the constructor body once the label exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ListItemOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) this._options.text = options.text;

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
     * Returns the item's label text.
     *
     * @returns The label string.
     */
    getText(): string {
        return this._text.getText().valueOf();
    }

    /**
     * Updates the item's label text.
     *
     * @param text - The new label string.
     *
     * @returns This component, for method chaining.
     */
    setText(text: string): this {
        this._text.setText(text);

        return this;
    }

    /**
     * Returns the marker string the owning list wrote.
     *
     * @returns The marker string, or `""` when this item has no marker.
     */
    getMarker(): string {
        return this._marker.getText().valueOf();
    }

    /**
     * Sets the marker string. Called by the owning list, which owns numbering
     * and bullet selection; an empty string hides the marker slot entirely.
     *
     * @param text - The marker string, or `""` for no marker.
     *
     * @returns This component, for method chaining.
     */
    setMarker(text: string): this {
        this._marker.setText(text);
        // Box layouts iterate the displayed children, so hiding the slot drops
        // both its width and the gap that would follow it.
        this._marker.setDisplayed(text.length > 0);

        return this;
    }

    /**
     * Renders the li element and sets its data-key attribute.
     *
     * @returns The created HTMLElement (`<li>`) with data-key set. The label
     * text is written by the child `Text`, not here.
     */
    protected render() {
        let element = super.render();

        DOM.sink.apply(element, { dataset: { key: this._key } });

        return element;
    }
}

const ListItemCallable = callable(ListItem);
type ListItemCallable = ListItem;
export {
    ListItem         as _ListItem,
    ListItemCallable as ListItem
};
