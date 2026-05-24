// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Type } from "~/core/Type.js";
import { Option } from "~/component/input/Option.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { Bindable } from "~/core/Bindable.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link List}.
 *
 * @category Components
 */
export interface ListOptions extends ComponentOptions {
    items?:         String | Array<String>;
    store?:         AbstractStore;
    displayField?:  string;
    valueField?:    string;
    selectedIndex?: number;
    value?:         string;
    selectedItem?:  string;
}

/**
 * User-overridable defaults forwarded to `super` via the options bag.
 */
const _defaultListOptions: Partial<ListOptions> = {
    tag:             "select",
    overflow:        "auto",
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
};

/**
 * A scrollable list box backed by a `<select size=N>` element.
 *
 * Displays all options simultaneously by sizing the underlying `<select>` to
 * fit its item count. Implements {@link Bindable} so it can be plugged into
 * a [`Binding`](/api/core/classes/Binding) directly.
 *
 * @category Components
 */
class List<TOptions extends ListOptions = ListOptions> extends Component<TOptions> implements Bindable<string> {

    protected _items: Array<Option> = [];
    private _storeRefresh: (() => void) | null = null;

    constructor(options?: TOptions) {
        super(options, _defaultListOptions as Partial<TOptions>);

        this.getAria().setRole("listbox");
        this.updateHeight();

        if (this._options.store !== undefined && this._options.displayField !== undefined) {
            this.setStore(this._options.store, this._options.displayField, this._options.valueField);
        }

        if (this._options.items !== undefined) {
            this.setItems(this._options.items);
        }

        if (this._options.selectedIndex !== undefined) {
            this.setSelectedIndex(this._options.selectedIndex, false);
        }

        if (this._options.value !== undefined) {
            this.setValue(this._options.value);
        }

        if (this._options.selectedItem !== undefined) {
            this.setValue(this._options.selectedItem);
        }
    }

    /**
     * Applies a {@link ListOptions} bag. Item / store / selection fields are
     * written pure into `_options` here and dispatched from the constructor body.
     *
     * @param options - The options bag.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.items         !== undefined) this._options.items         = opts.items;
        if (opts.store         !== undefined) this._options.store         = opts.store;
        if (opts.displayField  !== undefined) this._options.displayField  = opts.displayField;
        if (opts.valueField    !== undefined) this._options.valueField    = opts.valueField;
        if (opts.selectedIndex !== undefined) this._options.selectedIndex = opts.selectedIndex;
        if (opts.value         !== undefined) this._options.value         = opts.value;
        if (opts.selectedItem  !== undefined) this._options.selectedItem  = opts.selectedItem;

        return this;
    }

    /**
     * Default preferred size for an inline list. Overrideable by subclasses.
     */
    protected updateHeight(): void {
        this.setPreferredSize(200, 200);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    }

    /**
     * Returns `null` so a multi-line list is treated as a graphical / replaced
     * element by horizontal layouts.
     *
     * @returns Always `null`.
     */
    getBaseline(): number | null {
        return null;
    }

    /**
     * Returns the DOM element cast to HTMLSelectElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     * @returns The component's HTMLSelectElement.
     */
    getElement(createIfMissing: boolean = false): HTMLSelectElement {
        return <HTMLSelectElement>super.getElement(createIfMissing);
    }

    /**
     * Registers a listener for the list's 'change' event.
     *
     * @param listener - The callback to invoke when the selection changes.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this, "change", listener);

        return this;
    }

    /**
     * Registers a listener that fires on each user-driven change.
     *
     * @param fn - The callback to invoke on change.
     */
    addBindingListener(fn: () => void): void {
        this.addActionListener(fn);
    }

    /**
     * Sets the value to the option whose key matches.
     *
     * @param value - The option key to select.
     */
    setValue(value: string): this {
        const element = this.getElement();
        if (!element) {
            return this;
        }

        element.value = value;

        return this;
    }

    /**
     * Returns the value of the currently selected option.
     *
     * @returns The selected option's value, or an empty string when nothing is selected.
     */
    getValue(): string {
        const element = this.getElement();
        return element ? element.value : '';
    }

    /**
     * Returns the text content of the currently selected option.
     *
     * @returns The text content of the selected option element, or null.
     */
    getSelectedItem(): string | null {
        const element = this.getElement();
        if (!element || element.selectedIndex < 0) {
            return null;
        }

        return element.options[element.selectedIndex].textContent;
    }

    /**
     * Returns the zero-based index of the currently selected option.
     *
     * @returns The selected index.
     */
    getSelectedIndex(): number {
        const element = this.getElement();
        return element ? element.selectedIndex : -1;
    }

    /**
     * Sets the selected index and optionally fires a 'change' event.
     *
     * @param idx - The zero-based index to select.
     * @param fireEvent - Optional. When true (default), fires the 'change' event after updating.
     */
    setSelectedIndex(idx: number, fireEvent: boolean = true): this {
        const element = this.getElement();
        if (!element) {
            return this;
        }

        element.selectedIndex = idx;

        if (fireEvent) {
            Event.fireEvent(this, "change");
        }

        return this;
    }

    /**
     * Returns a copy of the current Option items array.
     *
     * @returns A shallow copy of the internal Option array.
     */
    getItems(): Array<Option> {
        return this._items.slice();
    }

    /**
     * Replaces all options with the given string values, sizing the select to
     * show all rows.
     *
     * @param items - A single string or an array of strings to use as option labels.
     */
    setItems(items: String | Array<String>): this {
        if (!Type.isArray(items)) {
            items = [items as String];
        }

        const list = items as Array<String>;
        for (let i = 0; i < list.length; i++) {
            this._items.push(new Option(String(i), list[i] as string));
        }

        const element = this.getElement();
        if (!element) {
            return this;
        }

        element.innerHTML = "";
        for (const item of this._items) {
            element.appendChild(item.getElement(true));
        }
        element.size = this._items.length + 1;

        return this;
    }

    /**
     * Appends a new option to the end of the list.
     *
     * @param item - The string label for the new option.
     */
    addItem(item: String): this {
        const opt = new Option(String(this._items.length + 1), item as string);
        this._items.push(opt);

        const element = this.getElement();
        if (!element) {
            return this;
        }

        element.appendChild(opt.getElement(true));
        element.size = this._items.length + 1;

        return this;
    }

    /**
     * Binds this list to a store, populating options from the given display field.
     *
     * @param store - The store to bind to.
     * @param displayField - The record field whose value is shown as the option label.
     * @param valueField - Optional. The record field used as the option value; defaults to the record's primary key.
     */
    setStore(store: AbstractStore, displayField: string, valueField?: string): this {
        const oldStore = this._options.store;

        if (this._storeRefresh && oldStore) {
            (['load', 'add', 'remove', 'datachanged', 'sync'] as const)
                .forEach(e => oldStore.off(e, this._storeRefresh!));
        }

        this._options.store        = store;
        this._options.displayField = displayField;
        this._options.valueField   = valueField;

        const refresh = (): void => this.refreshFromStore();
        this._storeRefresh = refresh;

        store.on('load',        refresh);
        store.on('add',         refresh);
        store.on('remove',      refresh);
        store.on('datachanged', refresh);
        store.on('sync',        refresh);

        this.refreshFromStore();

        return this;
    }

    /**
     * Returns the currently bound store, or null if none is set.
     *
     * @returns The bound store, or null.
     */
    getStore(): AbstractStore | null {
        return this._options.store ?? null;
    }

    /**
     * Returns the store record corresponding to the currently selected option.
     *
     * @returns The selected ModelRecord, or undefined if no store is bound or no item is selected.
     */
    getSelectedRecord(): ModelRecord | undefined {
        const store = this._options.store;

        if (!store) {
            return undefined;
        }

        return store.getRecords()[this.getSelectedIndex()];
    }

    /**
     * Rebuilds the option list from the bound store's current records and updates the select size.
     */
    protected refreshFromStore(): void {
        const store        = this._options.store;
        const displayField = this._options.displayField;
        const valueField   = this._options.valueField;

        if (!store || !displayField) {
            return;
        }

        this._items = [];
        const records = store.getRecords();

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const label  = String(record.get(displayField));
            const key    = valueField
                               ? String(record.get(valueField))
                               : String(record.getId());

            this._items.push(new Option(key, label));
        }

        const element = this.getElement();
        if (!element) {
            return;
        }

        element.innerHTML = "";

        const fragment = document.createDocumentFragment();
        for (const item of this._items) {
            fragment.appendChild(item.getElement(true));
        }
        element.appendChild(fragment);
        element.size = this._items.length + 1;
    }

    /**
     * Renders the underlying `<select>` element with its `size` attribute set
     * to fit all current items.
     *
     * @returns The created HTMLSelectElement.
     */
    render(): HTMLSelectElement {
        const element = super.render() as HTMLSelectElement;

        for (const item of this._items) {
            element.appendChild(item.getElement(true));
        }

        element.size = this._items.length + 1;

        return element;
    }
}

const ListCallable = callable(List);
type ListCallable = List;
export {
    List         as _List,
    ListCallable as List
};
