// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Event } from "../Event.js";
import { ComboBox, ComboBoxOptions } from "./ComboBox.js";
import { callable } from "../Callable.js";

/**
 * Construction-time options for {@link List}.
 *
 * @category Components
 */
export interface ListOptions extends ComboBoxOptions {
}

/**
 * A scrollable list box component backed by a `<select>` element.
 *
 * Extends ComboBox to display all options simultaneously by sizing the select element
 * to fit its item count.
 *
 * @category Components
 */
class List extends ComboBox {

    constructor(options?: ListOptions) {
        super();

        this.getAria().setRole("listbox");
        this.setOverflow("auto");
        this.updateHeight();

        if (this.constructor === List && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Overrides the ComboBox sizing to give the list a large default preferred size
     * and no maximum height constraint, so it can grow freely within its container.
     */
    protected updateHeight(): void {
        this.setPreferredSize(200, 200);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    }

    /**
     * Returns `null` so a multi-line `List` is treated as a graphical / replaced
     * element by horizontal layouts.
     *
     * @returns Always `null`.
     *
     * @remarks Overrides {@link ComboBox.getBaseline}: a list's box height is far
     * larger than its first visible row of text, so participating in baseline
     * alignment would drag every surrounding text label down by the list's
     * vertical extent.
     */
    getBaseline(): number | null {
        return null;
    }

    /**
     * Registers a listener for the list's 'change' event.
     *
     * @param listener - The callback to invoke when the selection changes.
     */
    addActionListener(listener: Function) : this {
        Event.addListener(this, "change", listener);

        return this;
    }

    /**
     * Replaces all items and updates the select element's size to show all options.
     *
     * @param items - A single string or an array of strings to use as option labels.
     *
     * @remarks Sets the select's size attribute to items.length + 1 so all options are visible.
     */
    setItems(items: String | Array<String>) : this {
        super.setItems(items);

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.size = this.getItems().length + 1;

        return this;
    }

    /**
     * Appends an item and updates the select element's size.
     *
     * @param item - The string label for the new option.
     */
    addItem(item: String) : this {
        super.addItem(item);

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.size = this.getItems().length + 1;

        return this;
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

const ListCallable = callable(List);
type ListCallable = List;
export {
    List         as _List,
    ListCallable as List
};
