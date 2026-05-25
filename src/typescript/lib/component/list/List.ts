// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractCustomList, AbstractCustomListOptions } from "~/component/list/AbstractCustomList.js";
import { Bindable } from "~/core/Bindable.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link List}.
 *
 * @category Components
 */
export interface ListOptions extends AbstractCustomListOptions {
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
class List extends AbstractCustomList<string, ListOptions> implements Bindable<string> {

    /**
     * @param options - Optional. Construction-time options applied to
     *   the list.
     */
    constructor(options?: ListOptions) {
        super(options);

        // Late-built state: `selectedIndex` / `value` / `selectedItem`
        // were written pure to `_options` by the super-time cascade.
        // Dispatch them now that the row pool and selection set exist
        // (`super()` already populated `_items` from `items` / `store`).
        if (this._options.selectedIndex !== undefined) {
            this.setSelectedIndex(this._options.selectedIndex, false);
        }

        if (this._options.value !== undefined) {
            this.setValue(this._options.value);
        }

        if (this._options.selectedItem !== undefined) {
            this.setValue(this._options.selectedItem);
        }

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
        }
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

        const opts = { ...this._defaultOptions, ...options } as ListOptions;

        if (opts.selectedIndex !== undefined) this._options.selectedIndex = opts.selectedIndex;
        if (opts.value         !== undefined) this._options.value         = opts.value;
        if (opts.selectedItem  !== undefined) this._options.selectedItem  = opts.selectedItem;

        return this;
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
     * Returns the display label of the currently selected row.
     *
     * @returns The selected row's label, or `null` when nothing is selected.
     */
    getSelectedItem(): string | null {
        const idx = this.getSelectedIndex();

        if (idx < 0 || idx >= this._items.length) {
            return null;
        }

        return this._items[idx].label;
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

    /**
     * Reflects the enabled flag on the ARIA tree, the tabindex, and the
     * inner panel. Disabling the list parks the focus index at -1 so a
     * subsequent enable starts fresh, mirroring the native `<select>` it
     * replaces.
     *
     * @param value - The new enabled state.
     */
    protected applyEnabled(value: boolean): void {
        this.getAria().setDisabled(!value);
        this.getAria().setTabIndex(value ? 0 : -1);
        this.setCursor(value ? "default" : "not-allowed");

        if (!value) {
            this._focusedIndex = -1;
            this.refreshRowVisualState();
            this.updateActiveDescendant();
        }
    }

    /**
     * Reflects the read-only flag on the ARIA tree. Read-only lists stay
     * focusable and announce their state; the click / keyboard reducers
     * are gated separately in {@link AbstractCustomList.handleRowClick} /
     * `handleKeyDown` so an interaction can't mutate state.
     *
     * @param value - The new read-only state.
     */
    protected applyReadOnly(value: boolean): void {
        this.getAria().setReadOnly(value);
    }
}

const ListCallable = callable(List);
type ListCallable = List;
export {
    List         as _List,
    ListCallable as List,
};
