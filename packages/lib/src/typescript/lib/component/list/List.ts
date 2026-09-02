// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractSelectableList, AbstractSelectableListOptions, SelectableListItem } from "~/component/list/AbstractSelectableList.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link List}.
 *
 * @category Components
 */
export interface ListOptions extends AbstractSelectableListOptions {
    selectedIndex?: number;
    value?:         string;
    selectedItem?:  string;
}

/**
 * A scrollable single-selection list box.
 *
 * Rendered as a `<div role="listbox">` populated with `<div role="option">`
 * rows. Implements [`Bindable<string>`](/api/core/interfaces/Bindable) so it can be plugged into a
 * [`Binding`](/api/core/classes/Binding) directly. Keyboard model mirrors the WAI-ARIA listbox
 * pattern: ArrowUp/Down moves and selects, Home/End jump to the
 * extremes, PageUp/Down jump by viewport-row count, Enter / Space
 * commits the focused row, and printable characters drive a 700ms
 * type-ahead search.
 *
 * @category Components
 */
class List extends AbstractSelectableList<string, ListOptions> {

    /**
     * @param options - Optional. Construction-time options applied to
     *   the list.
     */
    constructor(options?: ListOptions) {
        super(options);

        // Late-built state: `selectedIndex` / `value` / `selectedItem`
        // were written pure to `_options` by the super-time cascade.
        // Dispatch them now that the row pool and selection set exist
        // (`super()` already populated `_items` from `items` / `store`,
        // and applied `enabled` / `readOnly`).
        if (this._options.selectedIndex !== undefined) {
            this.setSelectedIndex(this._options.selectedIndex, false);
        }

        if (this._options.value !== undefined) {
            this.setValue(this._options.value);
        }

        if (this._options.selectedItem !== undefined) {
            this.setValue(this._options.selectedItem);
        }

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
    }

    /**
     * Applies a {@link ListOptions} bag. Single-select state fields are
     * written pure into `_options` here and dispatched from the constructor
     * body after the row pool is built.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: ListOptions): this {
        super.applyOptions(options);

        if (options.selectedIndex !== undefined) this._options.selectedIndex = options.selectedIndex;
        if (options.value         !== undefined) this._options.value         = options.value;
        if (options.selectedItem  !== undefined) this._options.selectedItem  = options.selectedItem;

        return this;
    }

    /**
     * Pushes pre-formed {@link SelectableListItem} pairs into the list,
     * bypassing the auto-keying that {@link setItems} applies to a
     * label-only array. Intended for hosts that already own typed
     * `{key, label}` data (e.g. the [`ComboBox`](/api/component/input/classes/ComboBox)
     * dropdown forwarding its item array). Selection and focus are
     * reset; the row pool is reconciled against the new length.
     *
     * @param items - The pre-formed item pairs, in display order.
     *
     * @returns This component, for method chaining.
     */
    setItemsArray(items: Array<SelectableListItem>): this {
        return super.setItemsArray(items);
    }

    /**
     * Selects the row whose `key` matches `value`. No-op when the value
     * doesn't appear in the current item set — same behaviour the prior
     * native `<select>` had when assigned an unknown `value`.
     *
     * @param value - The row key to select.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: string): this {
        const idx = this._items.findIndex(item => item.key === value);

        this.setSelectedIndex(idx, false);

        return this;
    }

    /**
     * Returns the key of the currently selected row.
     *
     * @returns The selected row's key, or an empty string when nothing
     *   is selected.
     */
    getValue(): string {
        const idx = this.getSelectedIndex();

        if (idx < 0 || idx >= this._items.length) {
            return "";
        }

        return this._items[idx].key;
    }

    /**
     * Reduces a click / keyboard gesture into the single-select shape:
     * the modifier keys are ignored, the selection becomes exactly
     * `{idx}`, and the anchor / focus collapse to the clicked row.
     *
     * @param idx - The row index the gesture targeted.
     * @param _ev - Ignored; single-select doesn't branch on modifier keys.
     */
    protected reduceSelection(idx: number, _ev: { ctrl: boolean, shift: boolean }): void {
        this._selectedSet.clear();
        this._selectedSet.add(idx);
        this._anchorIndex  = idx;
        this._focusedIndex = idx;
    }

    /**
     * User-driven selection commit. Mirrors the prior native `<select>`
     * `change` event semantics — fired from the click / keyboard
     * reducers, not from programmatic `setValue` / `setSelectedIndex(idx,
     * false)`.
     */
    protected notifyUserChange(): void {
        this.fireChange();
    }

}

const ListCallable = callable(List);
type ListCallable = List;
export {
    List         as _List,
    ListCallable as List,
};
