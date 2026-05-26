// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Event } from "~/core/Event.js";
import { VBox } from "~/layout/VBox.js";
import { AutoCompleteItem } from "~/component/input/AutoCompleteItem.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link AutoCompleteDropdown}.
 *
 * @category Components
 */
export interface AutoCompleteDropdownOptions extends AnimatedDropdownOptions {
    maxItems?: number;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultAutoCompleteDropdownOptions: Partial<AutoCompleteDropdownOptions> = {
    zIndex:          10050,
    durationMs:      100,
    backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
    border:          "var(--ts-ui-input-border)",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
};

/**
 * Floating dropdown panel for [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField).
 *
 * Maintains a reusable pool of `AutoCompleteItem` rows — items are updated
 * in place rather than destroyed and recreated on each keystroke. Inherits the
 * fade-in / fade-out lifecycle from [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown).
 */
class AutoCompleteDropdown extends AnimatedDropdown<AutoCompleteDropdownOptions> {

    private _pool: AutoCompleteItem[] = [];
    private _highlightedIndex: number = -1;
    private readonly _onSelect: (value: string) => void;
    private readonly _onHide: () => void;
    private readonly _onViewportMouseDown: (e: MouseEvent) => void;

    /**
     * @param onSelect - Called with the selected suggestion string when the user picks an item.
     * @param onHide - Called whenever the dropdown hides, including via viewport click-outside.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: string) => void, onHide: () => void, options?: AutoCompleteDropdownOptions) {
        super(options, _defaultAutoCompleteDropdownOptions);

        this._onSelect = onSelect;
        this._onHide   = onHide;

        this.getAria().setRole("listbox");
        // Dynamic dimensions from anchor + suggestion count — layout containment is safe.
        this.setContain("layout");

        const vbox = new VBox();

        vbox.setComponentSpacing(0);
        vbox.setStretching(true);
        this.setLayoutManager(vbox);

        this._onViewportMouseDown = (e: MouseEvent) => {
            if (!this.getElement()?.contains(e.target as Node)) {
                this.hide();
            }
        };
    }

    /**
     * Applies an {@link AutoCompleteDropdownOptions} bag, dispatching `maxItems`
     * after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AutoCompleteDropdownOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as AutoCompleteDropdownOptions;

        if (opts.maxItems !== undefined) {
            this.setMaxItems(opts.maxItems);
        }

        return this;
    }

    /**
     * Sets the maximum number of items to display in the dropdown.
     *
     * @param maxItems - The cap on visible suggestions.
     *
     * @returns This component, for method chaining.
     */
    setMaxItems(maxItems: number): this {
        this._options.maxItems = maxItems;

        return this;
    }

    /**
     * Returns the maximum number of items to display, or null if unlimited.
     *
     * @returns The configured maxItems cap, or null.
     */
    getMaxItems(): number | null {
        return this._options.maxItems ?? null;
    }

    /**
     * Shows the dropdown anchored below `anchorEl`, rendering the given suggestions.
     *
     * Reuses existing item rows where possible; adds or removes rows only as needed.
     *
     * @param anchorEl - The input element to anchor the dropdown to.
     * @param suggestions - The list of suggestion strings to display.
     */
    show(anchorEl: HTMLElement, suggestions: string[]): this {
        // Force the floating element into existence before any layout pass.
        // showAnimated() below mounts it, but that runs after doLayout() —
        // on first show getInnerSize() would otherwise return null and VBox
        // would lay out nothing, leaving items at width 0 in the panel.
        this.getElement(true);

        this.pauseLayout();
        this.updatePool(suggestions);
        this.resumeLayout();

        this._highlightedIndex = -1;

        const HEIGHT = AutoCompleteItem.HEIGHT;
        const insets = 8;
        const itemCount = suggestions.length;
        const rect = anchorEl.getBoundingClientRect();

        this.setWidth(rect.width);
        this.setHeight(itemCount * HEIGHT + insets);

        this.doLayout();

        const panelHeight = itemCount * HEIGHT + insets;
        const vpHeight = window.innerHeight;
        let y = rect.bottom;

        if (y + panelHeight > vpHeight && rect.top - panelHeight > 0) {
            y = rect.top - panelHeight;
        }

        this.setX(rect.left);
        this.setY(y);

        this.showAnimated();

        Event.addViewportListener(this, "mousedown", this._onViewportMouseDown);

        return this;
    }

    /**
     * Hides the dropdown, detaches it from the DOM, and fires the `onHide` callback.
     */
    hide(): this {
        Event.removeViewportListener(this, "mousedown", this._onViewportMouseDown);

        this.hideAnimated();

        return this;
    }

    /**
     * Fires the `onHide` callback once the exit fade has completed and the
     * panel is detached from the DOM.
     */
    protected onHideComplete(): void {
        this._onHide();
    }

    /**
     * Moves keyboard highlight to the next item, wrapping to the first if at the end.
     */
    highlightNext(): void {
        const next = this._highlightedIndex + 1;

        this.moveTo(next < this._pool.length ? next : 0);
    }

    /**
     * Moves keyboard highlight to the previous item, wrapping to the last if at the start.
     */
    highlightPrev(): void {
        const prev = this._highlightedIndex - 1;

        this.moveTo(prev >= 0 ? prev : this._pool.length - 1);
    }

    /**
     * Returns the text of the currently highlighted item, or null if nothing is highlighted.
     *
     * @returns The highlighted suggestion string, or null.
     */
    getHighlightedValue(): string | null {
        if (this._highlightedIndex < 0 || this._highlightedIndex >= this._pool.length) {
            return null;
        }

        return this._pool[this._highlightedIndex].getText();
    }

    /**
     * Returns the element ID of the currently highlighted item, or null if none is highlighted.
     *
     * Used to populate `aria-activedescendant` on the combobox input.
     *
     * @returns The highlighted item's HTML element ID, or null.
     */
    getHighlightedId(): string | null {
        if (this._highlightedIndex < 0 || this._highlightedIndex >= this._pool.length) {
            return null;
        }

        return this._pool[this._highlightedIndex].getId();
    }

    /**
     * Fires the select callback for the currently highlighted item, if any.
     */
    selectHighlighted(): void {
        const value = this.getHighlightedValue();

        if (value !== null) {
            this._onSelect(value);
        }
    }

    /**
     * Moves highlight to a specific pool index, clearing the previous highlight.
     *
     * @param index - The pool index to highlight.
     */
    private moveTo(index: number): void {
        if (this._highlightedIndex >= 0 && this._highlightedIndex < this._pool.length) {
            this._pool[this._highlightedIndex].setHighlighted(false);
        }

        this._highlightedIndex = index;

        if (index >= 0 && index < this._pool.length) {
            this._pool[index].setHighlighted(true);
        }
    }

    /**
     * Reconciles the item pool with a new list of suggestions.
     *
     * Overlapping items are updated in place; excess items are removed;
     * new items are appended. This is O(n) in visible items.
     *
     * @param suggestions - The new suggestion strings.
     */
    private updatePool(suggestions: string[]): void {
        const newLen = suggestions.length;
        const oldLen = this._pool.length;
        const overlap = Math.min(newLen, oldLen);

        for (let i = 0; i < overlap; i++) {
            this._pool[i].update(suggestions[i]);
            this._pool[i].setHighlighted(false);
        }

        if (newLen > oldLen) {
            for (let i = oldLen; i < newLen; i++) {
                const item = new AutoCompleteItem(suggestions[i], this._onSelect);

                this.addComponent(item);
                this._pool.push(item);
            }
        } else if (newLen < oldLen) {
            for (let i = newLen; i < oldLen; i++) {
                this.removeComponent(this._pool[i]);
            }

            this._pool.splice(newLen);
        }
    }
}

const AutoCompleteDropdownCallable = callable(AutoCompleteDropdown);
type AutoCompleteDropdownCallable = AutoCompleteDropdown;
export {
    AutoCompleteDropdown         as _AutoCompleteDropdown,
    AutoCompleteDropdownCallable as AutoCompleteDropdown
};
