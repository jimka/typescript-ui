// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { List } from "./List.js";
import { ModelRecord } from "../data/ModelRecord.js";

/**
 * A multi-selection list box backed by a `<select multiple>` element.
 *
 * Extends `List` with `getValues()` / `setValues()` for reading and writing
 * multi-selection state. Use explicit `BindingAccessors` when wiring to a
 * `Binding` instance (see `BindingPanel` for the pattern).
 */
export class MultiSelectList extends List {

    /**
     * Returns the currently selected option values.
     *
     * @returns An array of selected option value strings, in DOM order.
     */
    getValues(): string[] {
        const element = this.getElement();
        if (!element) {
            return [];
        }

        const result: string[] = [];

        for (const option of Array.from(element.selectedOptions)) {
            result.push(option.value);
        }

        return result;
    }

    /**
     * Selects the options whose values appear in the given array, deselecting all others.
     *
     * @param values - The option values to select.
     */
    setValues(values: string[]): void {
        const element = this.getElement();
        if (!element) {
            return;
        }

        const valueSet = new Set(values);

        for (const option of Array.from(element.options)) {
            option.selected = valueSet.has(option.value);
        }
    }

    /**
     * Returns the store records that correspond to the currently selected options.
     *
     * Relies on `getItems()` and `store.getRecords()` being in the same order,
     * which is guaranteed by `ComboBox.refreshFromStore()`.
     *
     * @returns An array of selected `ModelRecord` instances, or an empty array if no store is bound.
     */
    getSelectedRecords(): ModelRecord[] {
        const store = this.getStore();
        if (!store) {
            return [];
        }

        const selected = new Set(this.getValues());
        const records  = store.getRecords();
        const items    = this.getItems();
        const result: ModelRecord[] = [];

        for (let i = 0; i < items.length && i < records.length; i++) {
            const optionEl = items[i].getElement() as HTMLOptionElement | undefined;

            if (optionEl && selected.has(optionEl.value)) {
                result.push(records[i]);
            }
        }

        return result;
    }

    /**
     * Selects the options that correspond to the given store records, deselecting all others.
     *
     * Relies on `getItems()` and `store.getRecords()` being in the same order,
     * which is guaranteed by `ComboBox.refreshFromStore()`.
     *
     * @param records - The store records to select.
     */
    setSelectedRecords(records: ModelRecord[]): void {
        const store = this.getStore();
        if (!store) {
            return;
        }

        const recordSet    = new Set(records);
        const storeRecords = store.getRecords();
        const items        = this.getItems();
        const values: string[] = [];

        for (let i = 0; i < items.length && i < storeRecords.length; i++) {
            if (recordSet.has(storeRecords[i])) {
                const optionEl = items[i].getElement() as HTMLOptionElement | undefined;

                if (optionEl) {
                    values.push(optionEl.value);
                }
            }
        }

        this.setValues(values);
    }

    /**
     * Renders the underlying `<select>` element with the `multiple` attribute set.
     *
     * @returns The created HTMLSelectElement configured for multi-selection.
     */
    render(): HTMLSelectElement {
        const element = super.render() as HTMLSelectElement;
        element.multiple = true;

        return element;
    }
}
