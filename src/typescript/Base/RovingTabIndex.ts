// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";

/**
 * Manages the roving tabindex pattern for a group of sibling {@link Component} items.
 *
 * Exactly one item in the group has `tabindex=0` at any time; all others have `tabindex=-1`.
 * Calling {@link moveTo} updates the tabindices and transfers DOM focus to the new active item.
 *
 * @example
 * ```typescript
 * const group = new RovingTabIndex();
 * group.add(buttonA);
 * group.add(buttonB);
 * group.moveTo(1); // focus buttonB
 * ```
 *
 * @category Core
 */
export class RovingTabIndex {

    private _items: Component[] = [];
    private _activeIndex: number = 0;

    /**
     * Returns all items currently managed by this roving group.
     *
     * @returns The array of managed {@link Component} instances.
     */
    getItems(): Component[] {
        return this._items;
    }

    /**
     * Returns the zero-based index of the currently active item.
     *
     * @returns The active index.
     */
    getActiveIndex(): number {
        return this._activeIndex;
    }

    /**
     * Appends a component to the group.
     *
     * @remarks The first item added receives `tabindex=0`; all subsequent items receive `tabindex=-1`.
     * @param component - The component to add.
     */
    add(component: Component): this {
        const isFirst = this._items.length === 0;

        this._items.push(component);
        component.getAria().setTabIndex(isFirst ? 0 : -1);

        return this;
    }

    /**
     * Removes a component from the group.
     *
     * @remarks If the removed item was active, focus moves to the previous item (or index 0).
     * @param component - The component to remove.
     */
    remove(component: Component): this {
        const idx = this._items.indexOf(component);

        if (idx < 0) {
            return this;
        }

        this._items.splice(idx, 1);

        if (this._items.length === 0) {
            this._activeIndex = 0;

            return this;
        }

        if (idx === this._activeIndex) {
            this.moveTo(Math.max(0, idx - 1));
        } else if (idx < this._activeIndex) {
            this._activeIndex -= 1;
        }

        return this;
    }

    /**
     * Activates the item at the given index, updating `tabindex` on both the old and new items and transferring DOM focus.
     *
     * @param index - Zero-based index of the item to activate. Clamped to valid range.
     */
    moveTo(index: number): void {
        if (this._items.length === 0) {
            return;
        }

        const clampedIndex = Math.max(0, Math.min(index, this._items.length - 1));

        const prev = this._items[this._activeIndex];

        if (prev && clampedIndex !== this._activeIndex) {
            prev.getAria().setTabIndex(-1);
        }

        this._activeIndex = clampedIndex;

        const next = this._items[this._activeIndex];

        if (next) {
            next.getAria().setTabIndex(0);
            next.focus();
        }
    }

    /**
     * Moves focus to the next item, wrapping from the last item back to the first.
     */
    moveNext(): void {
        const count = this._items.length;

        if (count === 0) {
            return;
        }

        this.moveTo((this._activeIndex + 1) % count);
    }

    /**
     * Moves focus to the previous item, wrapping from the first item back to the last.
     */
    movePrev(): void {
        const count = this._items.length;

        if (count === 0) {
            return;
        }

        this.moveTo((this._activeIndex - 1 + count) % count);
    }
}
