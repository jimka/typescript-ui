// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "../Component.js";
import { Option } from "./Option.js";
import { Event } from "../Event.js";
import { Type } from "../Type.js";
import { Util } from "../Util.js";
import { AbstractStore } from "../data/AbstractStore.js";
import { ModelRecord } from "../data/ModelRecord.js";
import { Bindable } from "../Bindable.js";
import { ThemeManager } from "../Theme.js";

/**
 * Construction-time options for {@link ComboBox}.
 *
 * @category Components
 */
export interface ComboBoxOptions extends ComponentOptions {
    items?:         String | Array<String>;
    store?:         AbstractStore;
    displayField?:  string;
    valueField?:    string;
    selectedIndex?: number;
    value?:         string;
    selectedItem?:  string;
}

/**
 * A drop-down combo box component backed by a `<select>` element.
 *
 * Manages an internal list of {@link Option} items and keeps the DOM element in
 * sync when items are added or replaced. Also accepts an {@link AbstractStore} via
 * {@link setStore} to populate options from the data layer.
 *
 * @example
 * ```typescript
 * import { ComboBox, Option } from '@jimka/typescript-ui';
 *
 * const combo = new ComboBox();
 * combo.addItem(new Option('admin', 'Admin'));
 * combo.addItem(new Option('user',  'User'));
 * panel.addComponent(combo);
 * ```
 *
 * @category Components
 */
export class ComboBox extends Component implements Bindable<string> {

    private items: Array<Option> = [];
    private store: AbstractStore | null = null;
    private storeRefresh: (() => void) | null = null;
    private displayField: string | null = null;
    private valueField: string | null = null;

    constructor(options?: ComboBoxOptions) {
        super({ tag: "select" });

        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");
        this.getAria().setRole("combobox");

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        if (this.constructor === ComboBox && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link ComboBoxOptions} bag, dispatching item / store /
     * selection options after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ComboBoxOptions): this {
        super.applyOptions(options);

        if (options.store !== undefined && options.displayField !== undefined) {
            this.setStore(options.store, options.displayField, options.valueField);
        }

        if (options.items !== undefined) {
            this.setItems(options.items);
        }

        if (options.selectedIndex !== undefined) {
            this.setSelectedIndex(options.selectedIndex, false);
        }

        if (options.value !== undefined) {
            this.setValue(options.value);
        }

        if (options.selectedItem !== undefined) {
            this.setValue(options.selectedItem);
        }

        return this;
    }

    /**
     * Applies base styles and binds font-family/font-size to the active theme.
     *
     * @param element - The `<select>` element to apply styles to.
     *
     * @remarks Native `<select>` elements do not inherit `font-family` or `font-size`
     * from ancestors in Chromium/WebKit — they use the UA stylesheet defaults. We
     * therefore write the theme variables onto the per-component CSS rule explicitly,
     * the same way `Input` does for `<input>` / `<textarea>`.
     */
    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);

        const rule = this.getCSSRule();
        rule.style.fontFamily = "var(--ts-ui-font-family, sans-serif)";
        rule.style.fontSize   = "var(--ts-ui-font-size, 14px)";

        return this;
    }

    /**
     * Returns the offset from the top of the combo box to the inner-text baseline.
     *
     * @returns The baseline offset in pixels.
     *
     * @remarks Native `<select>` elements have a slightly different baseline
     * from `<input>` elements at the same font size. The 1-pixel offset on top
     * of the cached input baseline approximates the empirical placement of the
     * select's first-row text so a `Text` label next to a `ComboBox` lines up
     * visually.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(Util.measureInputBaseline() + 1);
    }

    /**
     * Recalculates preferred and maximum height from a native `<select>` element's measured size.
     *
     * Uses an off-screen probe so the result tracks the theme font size automatically.
     * Called at construction time and after each theme change.
     */
    protected updateHeight(): void {
        const probe = document.createElement("select");

        probe.style.position   = "fixed";
        probe.style.visibility = "hidden";
        probe.style.fontFamily = "var(--ts-ui-font-family, sans-serif)";
        probe.style.fontSize   = "var(--ts-ui-font-size, 14px)";

        document.body.appendChild(probe);

        const h = Math.ceil(probe.getBoundingClientRect().height) || 20;

        document.body.removeChild(probe);

        this.setPreferredSize(200, h);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, h);
    }

    /**
     * Registers a listener for the select element's 'change' event.
     *
     * @param listener - The callback to invoke when the selection changes.
     */
    addActionListener(listener: Function) : this {
        Event.addListener(this, "change", listener);

        return this;
    }

    setValue(value: string): this {
        const element = this.getElement();
        if (!element) return this;
        element.value = value;

        return this;
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
    setItems(items: String | Array<String>) : this {
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
            return this;
        }

        element.innerHTML = "";

        for (let idx in this.items) {
            let value = this.items[idx];

            element.appendChild(value.getElement());
        }

        return this;
    }

    /**
     * Appends a new option to the end of the list and to the select element.
     *
     * @param item - The string label for the new option.
     */
    addItem(item: String) : this {
        let listItem = new Option((this.items.length + 1).toString(), item as string);
        this.items.push(listItem);

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.appendChild(listItem.getElement(true));

        return this;
    }

    /**
     * Binds this component to a store, populating options from the given display field.
     *
     * @param store - The store to bind to.
     * @param displayField - The record field whose value is shown as the option label.
     * @param valueField - Optional. The record field used as the option value; defaults to the record's primary key.
     */
    setStore(store: AbstractStore, displayField: string, valueField?: string): this {
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

        return this;
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

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < this.items.length; i++) {
            fragment.appendChild(this.items[i].getElement(true));
        }
        element.appendChild(fragment);
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