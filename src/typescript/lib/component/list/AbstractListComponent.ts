// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { BulletedListItemStyle } from "~/component/list/BulletedListItemStyle.js";
import { NumberedListItemStyle } from "~/component/list/NumberedListItemStyle.js";
import { ListItem } from "~/component/list/ListItem.js";

/**
 * Construction-time options for {@link AbstractListComponent}.
 *
 * @category Components
 */
export interface AbstractListOptions<U extends BulletedListItemStyle | NumberedListItemStyle> extends ComponentOptions {
    itemStyle?:     U;
    selectedIndex?: number;
}

/**
 * Abstract base for bulleted and numbered list components.
 *
 * Manages the CSS list-style-type, selection state, and restricts child components to
 * ListItem instances. Concrete subclasses supply the HTML tag and default style.
 */
export abstract class AbstractListComponent<U extends BulletedListItemStyle | NumberedListItemStyle> extends Component<AbstractListOptions<U>> {

    // `declare` rather than initializer to dodge the class-field
    // super-cascade trap: the cascade-time setStyle write would otherwise
    // be clobbered by a `= undefined` initializer running after super().
    // The cascade always dispatches setStyle because the constructor seeds
    // `itemStyle: style` into the defaults bag below.
    declare private _style: U | undefined;

    constructor(
        tag:              string,
        style:            U,
        options?:         AbstractListOptions<U>,
        subclassDefaults?: Partial<AbstractListOptions<U>>,
    ) {
        super(options, {
            tag,
            preferredSize: { width: 200, height: 200 },
            padding:       new Insets(0, 0, 0, 25),
            itemStyle:     style,
            ...(subclassDefaults ?? {}),
        } as Partial<AbstractListOptions<U>>);
    }

    /**
     * Applies an {@link AbstractListOptions} bag, dispatching the list bullet
     * style and initial selection after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AbstractListOptions<U>): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as AbstractListOptions<U>;

        if (opts.itemStyle !== undefined) {
            this.setStyle(opts.itemStyle);
        }

        if (opts.selectedIndex !== undefined) {
            this.setSelectedIndex(opts.selectedIndex, false);
        }

        return this;
    }

    /**
     * Returns the current list-style-type value.
     *
     * @returns The current style enum value, or undefined if not yet set.
     */
    getStyle() {
        return this._style;
    }

    /**
     * Sets the list-style-type CSS property.
     *
     * @param style - The list item style enum value to apply.
     */
    setStyle(style: U) : this {
        this._style = style;
        this.setElementCSSRule("list-style-type", style);

        return this;
    }

    /**
     * Registers a listener for the list's `"action"` event — fired on a
     * selection change. A typed semantic shorthand over
     * {@link Event.addListener} (the underlying DOM event is `"change"`);
     * `"action"` is currently the only allowed event name.
     *
     * @param event - The event name. Only `"action"` is accepted.
     * @param listener - The callback to invoke when the selection changes.
     *
     * @returns This component, for method chaining.
     */
    on(event: "action", listener: Function): this;
    on(_event: "action", listener: Function): this {
        Event.addListener(this, "change", listener);

        return this;
    }

    /**
     * Removes a previously registered `"action"` listener. The exact callback
     * reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: "action", listener: Function): this;
    off(_event: "action", listener: Function): this {
        Event.removeListener(this, "change", listener);

        return this;
    }

    /**
     * Returns the data-key of the currently selected list item.
     *
     * @returns The data-key string of the selected option element.
     */
    getSelectedValue() {
        let element = this.getElement();
        return (<HTMLElement>element[element.selectedIndex]).dataset.key;
    }

    /**
     * Returns the zero-based index of the currently selected list item.
     *
     * @returns The selected index.
     */
    getSelectedIndex() {
        let element = this.getElement();
        return element.selectedIndex;
    }

    /**
     * Sets the selected item index and optionally fires a 'change' event.
     *
     * @param idx - The zero-based index to select.
     * @param fireEvent - Optional. When true (default), fires the 'change' event after updating.
     */
    setSelectedIndex(idx: number, fireEvent = true) : this {
        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.selectedIndex = idx;

        if (!!fireEvent) {
            Event.fireEvent(this, "change");
        }

        return this;
    }

    /**
     * Returns the DOM element cast to HTMLSelectElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's HTMLSelectElement.
     */
    getElement(createIfMissing: boolean = false) {
        return <HTMLSelectElement>super.getElement(createIfMissing);
    }

    /**
     * Adds a ListItem child; restricts the type accepted by this container to ListItem.
     *
     * @param component - The ListItem to add.
     * @param constraints - Optional. Layout constraints for the item.
     */
    addComponent(component: ListItem, constraints?: LayoutConstraints): this {
        super.addComponent(component, constraints);

        return this;
    }

    /**
     * Removes a ListItem child by instance or index.
     *
     * @param component - The ListItem instance or its numeric index to remove.
     *
     * @returns The layout constraints that were registered for the removed item, or undefined.
     */
    removeComponent(component: ListItem | Number) {
        return super.removeComponent(component);
    }
}