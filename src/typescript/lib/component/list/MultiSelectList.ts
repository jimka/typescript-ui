// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { List, ListOptions } from "~/component/list/List.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link MultiSelectList}.
 *
 * @category Components
 */
export interface MultiSelectListOptions extends ListOptions {
    selectedIndices?: number[];
}

/**
 * A multi-selection list box backed by a `<select multiple>` element.
 *
 * Extends [`List`](/api/component/list/classes/List) with `getValues()` / `setValues()` for reading and writing
 * multi-selection state. Use explicit [`BindingAccessors`](/api/core/interfaces/BindingAccessors) when wiring to a
 * [`Binding`](/api/core/classes/Binding) instance.
 *
 * @category Components
 */
class MultiSelectList extends List<MultiSelectListOptions> {

    constructor(options?: MultiSelectListOptions) {
        super(options);

        // Late-built state: `selectedIndices` was written pure to `_options` by
        // the super-time cascade. Dispatch it now that `ComboBox`'s constructor
        // body has populated `this.items` from `items` / `store`.
        if (this._options.selectedIndices !== undefined) {
            const element = this.getElement();
            if (element) {
                const indexSet = new Set(this._options.selectedIndices);

                for (let i = 0; i < element.options.length; i++) {
                    element.options[i].selected = indexSet.has(i);
                }
            }
        }
    }

    /**
     * Writes the multi-select `selectedIndices` field pure into `_options`; the
     * constructor body dispatches it after items are populated.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: MultiSelectListOptions): this {
        super.applyOptions(options);

        if (options.selectedIndices !== undefined) {
            this._options.selectedIndices = options.selectedIndices;
        }

        return this;
    }

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
    setValues(values: string[]): this {
        const element = this.getElement();
        if (!element) {
            return this;
        }

        const valueSet = new Set(values);

        for (const option of Array.from(element.options)) {
            option.selected = valueSet.has(option.value);
        }

        return this;
    }

    /**
     * Returns the store records that correspond to the currently selected options.
     *
     * Relies on `getItems()` and `store.getRecords()` being in the same order,
     * which is guaranteed by `ComboBox.refreshFromStore()`.
     *
     * @returns An array of selected [`ModelRecord`](/api/data/classes/ModelRecord) instances, or an empty array if no store is bound.
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
    setSelectedRecords(records: ModelRecord[]): this {
        const store = this.getStore();
        if (!store) {
            return this;
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

        return this;
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

const MultiSelectListCallable = callable(MultiSelectList);
type MultiSelectListCallable = MultiSelectList;
export {
    MultiSelectList         as _MultiSelectList,
    MultiSelectListCallable as MultiSelectList
};
