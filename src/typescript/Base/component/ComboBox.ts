// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Option } from "./Option.js";
import { Event } from "../Event.js";
import { Type } from "../Type.js";

/**
 * A drop-down combo box component backed by a `<select>` element.
 *
 * Manages an internal list of Option items and keeps the DOM element in sync
 * when items are added or replaced.
 */
export class ComboBox extends Component {

    private items: Array<Option>;

    constructor() {
        super("select");

        this.setPreferredSize(200, 20);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");

        this.items = [];
    }

    /**
     * Registers a listener for the select element's 'change' event.
     *
     * @param listener - The callback to invoke when the selection changes.
     */
    addActionListener(listener: Function) {
        Event.addListener(this, "change", listener);
    }

    /**
     * Returns the text content of the currently selected option.
     *
     * @returns The text content of the selected option element.
     */
    getSelectedItem() {
        let element = this.getElement();
        return element[element.selectedIndex].textContent;
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
     * Returns the zero-based index of the currently selected option.
     *
     * @returns The selected index.
     */
    getSelectedIndex() {
        let element = this.getElement();
        return element.selectedIndex;
    }

    /**
     * Sets the selected index and optionally fires a 'change' event.
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
     * Returns a copy of the current Option items array.
     *
     * @returns A shallow copy of the internal Option array.
     */
    getItems() {
        return this.items.slice();
    }

    /**
     * Replaces all options with the given string values and re-renders the select element's content.
     *
     * @param items - A single string or an array of strings to use as option labels.
     *
     * @remarks Clears the existing DOM options before appending the new ones.
     */
    setItems(items: String | Array<String>) {
        if (!Type.isArray(items)) {
            items = [<String>items];
        }

        for (let idx in items) {
            let value = items[idx];

            let item = new Option(idx, value as string);
            this.items.push(item);
        }

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.innerHTML = "";

        for (let idx in this.items) {
            let value = this.items[idx];

            element.appendChild(value.getElement());
        }
    }

    /**
     * Appends a new option to the end of the list and to the select element.
     *
     * @param item - The string label for the new option.
     */
    addItem(item: String) {
        let listItem = new Option((this.items.length + 1).toString(), item as string);
        this.items.push(listItem);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.appendChild(listItem.getElement(true));
    }

    /**
     * Renders the select element and appends all option child elements.
     *
     * @returns The created HTMLSelectElement with all options appended.
     */
    render() {
        let element = super.render();

        for (let idx in this.items) {
            let item = this.items[idx];

            element.appendChild(item.getElement(true));
        }

        return element;
    }
}