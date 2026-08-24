// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Text, TextOptions } from "~/component/input/Text.js";
import { HBox } from "~/layout/HBox.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

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

const LIST_ITEM_MARKER_TEXT_ALIGN = "right";

const _defaultListItemMarkerTextOptions: Partial<TextOptions> = {
    textAlign: LIST_ITEM_MARKER_TEXT_ALIGN,
};

/**
 * The marker text for a {@link ListItem} — every marker in a list renders
 * right-aligned by default, so without a shared class rule every item's
 * marker would carry an identical `text-align: right` declaration on its own
 * `#id` rule. Mirrors `NumberRendererText`
 * (component/table/cell/renderer/Number.ts).
 */
class ListItemMarkerText extends Text {
    protected static readonly ownClassStyleDefaults: StyleBag = {
        font: {
            ...Text.ownClassStyleDefaults.font,
            textAlign: LIST_ITEM_MARKER_TEXT_ALIGN,
        },
    };

    constructor() {
        super(undefined, undefined, _defaultListItemMarkerTextOptions);
    }
}

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

    /**
     * @param key - The item's stable key.
     * @param value - The item's label text.
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(
        key:               string,
        value:             string,
        options?:          ListItemOptions,
        subclassDefaults?: Partial<ListItemOptions>,
    ) {
        // The HBox sits in the defaults bag (under user options) so a caller
        // that wants a different layoutManager can still override it, and is
        // built per instance because a layout manager holds container state.
        super(options, {
            ..._defaultListItemOptions,
            layoutManager: new HBox({ spacing: MARKER_GAP_PX }),
            ...(subclassDefaults ?? {}),
        });

        this._key = key;

        // The marker sits in a slot shared with every other item in the list,
        // widened to the widest marker among them, so it hugs the slot's right
        // edge and the trailing full stops line up down the list.
        this._marker = new ListItemMarkerText();
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
     * Returns the marker's own measured width, before any shared column widens it.
     *
     * @returns The measured width in pixels, or 0 when nothing has been measured.
     *
     * @remarks Called by the owning list to size its shared marker column.
     */
    getMarkerWidth(): number {
        // Force the lazy measurement, then read the raw measured width back off
        // the preferred-size constraint. getPreferredSize() would floor the
        // width at the shared column this item already carries, which would
        // ratchet the column wider on every pass and never let it shrink.
        this._marker.getPreferredSize();

        return this._marker.getPreferredSizeConstraint()?.width ?? 0;
    }

    /**
     * Widens the marker slot to the owning list's shared column width.
     *
     * @param width - The shared column width in pixels.
     *
     * @returns This component, for method chaining.
     */
    setMarkerColumnWidth(width: number): this {
        // A minimum, not a preferred size: Text republishes its own measurement
        // through setPreferredSize, and pinning one would freeze the measurement
        // this list has to read back.
        this._marker.setMinSize({ width: width, height: 0 });

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
