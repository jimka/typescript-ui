// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Option } from "./Option.js";
import { Event } from "../Event.js";
import { Type } from "../Type.js";
import { AbstractStore } from "../data/AbstractStore.js";
import { ModelRecord } from "../data/ModelRecord.js";
import { Bindable } from "../Bindable.js";

/**
 * A drop-down combo box component backed by a `<select>` element.
 *
 * Manages an internal list of Option items and keeps the DOM element in sync
 * when items are added or replaced.
 */
export class ComboBox extends Component implements Bindable<string> {

    private items: Array<Option>;
    private store: AbstractStore | null = null;
    private storeRefresh: (() => void) | null = null;
    private displayField: string | null = null;
    private valueField: string | null = null;

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

    setValue(value: string): void {
        const element = this.getElement();
        if (!element) return;
        element.value = value;
    }

    getValue(): string {
        const element = this.getElement();
        return element ? element.value : '';
    }

    addBindingListener(fn: () => void): void {
        this.addActionListener(fn);
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
     * Binds this component to a store, populating options from the given display field.
     *
     * @param store - The store to bind to.
     * @param displayField - The record field whose value is shown as the option label.
     * @param valueField - Optional. The record field used as the option value; defaults to the record's primary key.
     */
    setStore(store: AbstractStore, displayField: string, valueField?: string): void {
        if (this.storeRefresh && this.store) {
            const old = this.store;

            (['load', 'add', 'remove', 'datachanged', 'sync'] as const)
                .forEach(e => old.off(e, this.storeRefresh!));
        }

        this.store = store;
        this.displayField = displayField;
        this.valueField = valueField ?? null;

        const refresh = () => this.refreshFromStore();
        this.storeRefresh = refresh;

        store.on('load',        refresh);
        store.on('add',         refresh);
        store.on('remove',      refresh);
        store.on('datachanged', refresh);
        store.on('sync',        refresh);

        this.refreshFromStore();
    }

    /**
     * Returns the currently bound store, or null if none is set.
     */
    getStore(): AbstractStore | null {
        return this.store;
    }

    /**
     * Returns the store record corresponding to the currently selected option.
     *
     * @returns The selected ModelRecord, or undefined if no store is bound or no item is selected.
     */
    getSelectedRecord(): ModelRecord | undefined {
        if (!this.store) {
            return undefined;
        }

        return this.store.getRecords()[this.getSelectedIndex()];
    }

    /**
     * Rebuilds the option list from the bound store's current records.
     *
     * Updates `this.items` unconditionally. Syncs the DOM only if the element already exists;
     * otherwise `render()` picks up the updated items when the element is created.
     */
    protected refreshFromStore(): void {
        if (!this.store || !this.displayField) {
            return;
        }

        this.items = [];
        const records = this.store.getRecords();

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const label  = String(record.get(this.displayField));
            const key    = this.valueField
                               ? String(record.get(this.valueField))
                               : String(record.getId());

            this.items.push(new Option(key, label));
        }

        const element = this.getElement();
        if (!element) {
            return;
        }

        element.innerHTML = "";

        for (let i = 0; i < this.items.length; i++) {
            element.appendChild(this.items[i].getElement(true));
        }
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