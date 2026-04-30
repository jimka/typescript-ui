// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";
import { LayoutConstraints } from "../layout/LayoutConstraints.js";
import { BulletedListItemStyle } from "./BulletedListItemStyle.js";
import { NumberedListItemStyle } from "./NumberedListItemStyle.js";
import { ListItem } from "./ListItem.js";

/**
 * Abstract base for bulleted and numbered list components.
 *
 * Manages the CSS list-style-type, selection state, and restricts child components to
 * ListItem instances. Concrete subclasses supply the HTML tag and default style.
 */
export abstract class AbstractListComponent<U extends BulletedListItemStyle | NumberedListItemStyle> extends Component {

    private style: U | undefined;

    constructor(tag: string, style: U) {
        super(tag);

        this.setStyle(style);
        this.setPreferredSize(200, 200);
        this.setPadding(new Insets(0, 0, 0, 25));
    }

    /**
     * Returns the current list-style-type value.
     *
     * @returns The current style enum value, or undefined if not yet set.
     */
    getStyle() {
        return this.style;
    }

    /**
     * Sets the list-style-type CSS property.
     *
     * @param style - The list item style enum value to apply.
     */
    setStyle(style: U) {
        this.style = style;
        this.setElementCSSRule("list-style-type", style);
    }

    /**
     * Registers a listener for the list's 'change' event.
     *
     * @param listener - The callback to invoke when the selection changes.
     */
    addActionListener(listener: Function) {
        Event.addListener(this, "change", listener);
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
    setSelectedIndex(idx: number, fireEvent = true) {
        let element = this.getElement();
        if (!element) {
            return;
        }

        element.selectedIndex = idx;

        if (!!fireEvent) {
            Event.fireEvent(this, "change");
        }
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
    addComponent(component: ListItem, constraints?: LayoutConstraints) {
        super.addComponent(component, constraints);
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