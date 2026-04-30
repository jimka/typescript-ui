// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Event } from "../Event.js";
import { ComboBox } from "./ComboBox.js";

/**
 * A scrollable list box component backed by a `<select>` element.
 *
 * Extends ComboBox to display all options simultaneously by sizing the select element
 * to fit its item count.
 */
export class List extends ComboBox {

    constructor() {
        super();

        this.setPreferredSize(200, 200);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this.setOverflow("auto");
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
     * Replaces all items and updates the select element's size to show all options.
     *
     * @param items - A single string or an array of strings to use as option labels.
     *
     * @remarks Sets the select's size attribute to items.length + 1 so all options are visible.
     */
    setItems(items: String | Array<String>) {
        super.setItems(items);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.size = this.getItems().length + 1;
    }

    /**
     * Appends an item and updates the select element's size.
     *
     * @param item - The string label for the new option.
     */
    addItem(item: String) {
        super.addItem(item);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.size = this.getItems().length + 1;
    }

    /**
     * Updates the select element's size after rebuilding options from the bound store.
     */
    protected refreshFromStore(): void {
        super.refreshFromStore();

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.size = this.getItems().length + 1;
    }

    /**
     * Renders the select element and sets its initial size to accommodate all items.
     *
     * @returns The created HTMLSelectElement with its size attribute initialised.
     */
    render() {
        let element = <HTMLSelectElement>super.render();

        element.size = this.getItems().length + 1;

        return element;
    }
}
