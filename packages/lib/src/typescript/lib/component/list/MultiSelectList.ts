// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractSelectableList, AbstractSelectableListOptions } from "~/component/list/AbstractSelectableList.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { reduceModifierSelection } from "~/component/shared/reduceModifierSelection.js";
import { callable } from "~/core/Callable.js";
import { Event } from "~/core/Event.js";

/**
 * Construction-time options for {@link MultiSelectList}.
 *
 * @category Components
 */
export interface MultiSelectListOptions extends AbstractSelectableListOptions {
    selectedIndices?: number[];
}

/**
 * A scrollable multi-selection list box.
 *
 * Rendered as a `<div role="listbox" aria-multiselectable="true">`
 * populated with `<div role="option">` rows. Implements
 * [`Bindable<string[]>`](/api/core/interfaces/Bindable) so it can be
 * plugged into a [`Binding`](/api/core/classes/Binding) directly — earlier
 * versions required explicit `BindingAccessors` because the single-value
 * `Bindable<string>` contract didn't fit. Selection follows the
 * standard modifier-key model:
 *
 * - Plain click / Enter / Space replaces the selection with the
 *   clicked row.
 * - Ctrl-click (Cmd on macOS) / Ctrl+Space toggles the clicked row's
 *   selection.
 * - Shift-click / Shift+Arrow extends the selection from the anchor
 *   row to the targeted row.
 *
 * @category Components
 */
class MultiSelectList extends AbstractSelectableList<string[], MultiSelectListOptions> {

    /**
     * @param options - Optional. Construction-time options applied to
     *   the list.
     */
    constructor(options?: MultiSelectListOptions) {
        super(options);

        this.getAria().setMultiselectable(true);

        // Late-built state: `selectedIndices` was written pure to
        // `_options` by the super-time cascade. Dispatch it now that the
        // row pool exists (`super()` already populated `_items` from
        // `items` / `store`, and applied `enabled` / `readOnly`).
        if (this._options.selectedIndices !== undefined) {
            this.applyInitialSelection(this._options.selectedIndices);
        }

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
    }

    /**
     * Applies a {@link MultiSelectListOptions} bag. Multi-select state
     * fields are written pure into `_options` here and dispatched from the
     * constructor body after the row pool is built.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: MultiSelectListOptions): this {
        super.applyOptions(options);

        if (options.selectedIndices !== undefined) this._options.selectedIndices = options.selectedIndices;

        return this;
    }

    /**
     * Replaces the selection with the rows whose keys appear in
     * `values`. Programmatic — does not fire the `change` event; user-
     * driven gestures route through the click / keyboard reducer
     * instead.
     *
     * @param values - The row keys to select.
     *
     * @returns This component, for method chaining.
     */
    setValues(values: string[]): this {
        const valueSet = new Set(values);

        this._selectedSet.clear();

        for (let i = 0; i < this._items.length; i++) {
            if (valueSet.has(this._items[i].key)) {
                this._selectedSet.add(i);
            }
        }

        // Park the anchor at the last selected index when there is one,
        // so a follow-up Shift-arrow extends from a sensible position.
        if (this._selectedSet.size > 0) {
            this._anchorIndex = Math.max(...this._selectedSet);
        } else {
            this._anchorIndex = null;
        }

        this.refreshRowVisualState();
        this.updateActiveDescendant();

        return this;
    }

    /**
     * `Bindable<string[]>` write-side — alias of {@link setValues}.
     *
     * @param value - The row keys to select.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: string[]): this {
        return this.setValues(value);
    }

    /**
     * Returns the keys of every currently selected row, sorted by row
     * order. Satisfies the `Bindable<string[]>` read-side.
     *
     * @returns The selected row keys.
     */
    getValue(): string[] {
        const indices = [...this._selectedSet].sort((a, b) => a - b);

        return indices.map(i => this._items[i].key);
    }

    /**
     * Compares two selection sets for dirty-tracking purposes. `getValue()`
     * builds a fresh array on every call, so this overrides the inherited
     * `Object.is` default with a length-and-per-index comparison — sound
     * because `getValue()` always returns keys sorted by row order.
     *
     * @param a - The candidate value.
     * @param b - The clean baseline, or `undefined` if none has been set.
     *
     * @returns `true` when the two are equal for dirty-tracking purposes.
     */
    protected valuesEqual(a: string[], b: string[] | undefined): boolean {
        if (b === undefined || a.length !== b.length) {
            return false;
        }

        return a.every((v, i) => v === b[i]);
    }

    /**
     * Returns the store records that correspond to the currently
     * selected rows.
     *
     * @returns The selected [`ModelRecord`](/api/data/classes/ModelRecord)
     *   instances in row order, or an empty array when no store is bound.
     */
    getSelectedRecords(): ModelRecord[] {
        const store = this.getStore();

        if (!store) {
            return [];
        }

        const records = store.getRecords();
        const indices = [...this._selectedSet].sort((a, b) => a - b);
        const result: ModelRecord[] = [];

        for (const i of indices) {
            if (i < records.length) {
                result.push(records[i]);
            }
        }

        return result;
    }

    /**
     * Replaces the selection with the rows whose backing records appear
     * in `records`. Relies on the parallel ordering of `_items` and
     * `store.getRecords()` that the store-bound refresh guarantees — see
     * [`setStore`](/api/component/list/classes/MultiSelectList#setstore).
     *
     * @param records - The store records to select.
     *
     * @returns This component, for method chaining.
     */
    setSelectedRecords(records: ModelRecord[]): this {
        const store = this.getStore();

        if (!store) {
            return this;
        }

        const recordSet    = new Set(records);
        const storeRecords = store.getRecords();
        const values: string[] = [];

        for (let i = 0; i < this._items.length && i < storeRecords.length; i++) {
            if (recordSet.has(storeRecords[i])) {
                values.push(this._items[i].key);
            }
        }

        return this.setValues(values);
    }

    /**
     * Reduces a click / keyboard gesture into the multi-select shape.
     * Ported verbatim from [`Body.onRowClick`](/api/component/table/classes/Body) — the same modifier
     * rules apply: plain replaces, `ctrl` toggles individual rows,
     * `shift` extends the selection from the anchor row to `idx`.
     *
     * @param idx - The row index the gesture targeted.
     * @param ev - The normalised modifier flags.
     */
    protected reduceSelection(idx: number, ev: { ctrl: boolean, shift: boolean }): void {
        this._anchorIndex = reduceModifierSelection(
            this._selectedSet,
            this._anchorIndex,
            idx,
            i => i,
            i => i,
            ev,
        );

        // The shared modifier reducer sweeps a contiguous index range, so a
        // Shift-extension can cross a disabled row. Drop those: a gesture must
        // never select a row the user could not have clicked.
        for (const i of [...this._selectedSet]) {
            if (!this.isItemEnabled(i)) {
                this._selectedSet.delete(i);
            }
        }

        this._focusedIndex = idx;
    }

    /**
     * User-driven selection commit. Fires the `change` event the same
     * way the prior native `<select multiple>` did — only user-driven
     * gestures (click / keyboard reducer) route through it.
     */
    protected notifyUserChange(): void {
        this.fireChange();
    }

    /**
     * Extends the base keyboard map with `Ctrl+A` (select-all) — every
     * other key delegates to {@link AbstractSelectableList.handleKeyDown}.
     *
     * @param e - The keyboard event.
     */
    protected handleKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (!this.isEnabled() || this.isReadOnly()) {
            return;
        }

        const ctrl = e.ctrlKey || e.metaKey;

        if (ctrl && (e.key === "a" || e.key === "A")) {
            this.selectAll();

            return { prevent: true };
        }

        return super.handleKeyDown(e);
    }

    /**
     * Selects every row in the list. Used by the Ctrl+A keyboard shortcut.
     */
    protected selectAll(): void {
        if (this._items.length === 0) {
            return;
        }

        this._selectedSet.clear();

        for (let i = 0; i < this._items.length; i++) {
            if (this.isItemEnabled(i)) {
                this._selectedSet.add(i);
            }
        }

        this._anchorIndex  = 0;
        this._focusedIndex = this._items.length - 1;

        this.refreshRowVisualState();
        this.updateActiveDescendant();
        this.notifyUserChange();
    }

    /**
     * Construction-tail dispatch of `selectedIndices`. Writes the
     * indices directly into the selection set without firing `change`,
     * matching the construct-time semantics of `setValues` (programmatic
     * writes are silent; user gestures emit `change`).
     *
     * @param indices - Initial selection indices from the options bag.
     */
    private applyInitialSelection(indices: number[]): void {
        this._selectedSet.clear();

        for (const i of indices) {
            if (i >= 0 && i < this._items.length) {
                this._selectedSet.add(i);
            }
        }

        if (this._selectedSet.size > 0) {
            this._anchorIndex = Math.max(...this._selectedSet);
        }

        this.refreshRowVisualState();
        this.updateActiveDescendant();
    }
}

const MultiSelectListCallable = callable(MultiSelectList);
type MultiSelectListCallable = MultiSelectList;
export {
    MultiSelectList         as _MultiSelectList,
    MultiSelectListCallable as MultiSelectList,
};
