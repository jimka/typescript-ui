// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { Position } from "~/primitive/Position.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { VBox } from "~/layout/VBox.js";
import { AutoCompleteItem } from "~/component/input/AutoCompleteItem.js";
import { callable } from "~/core/Callable.js";

const AUTOCOMPLETE_ANIM_DURATION_MS: number = 100;

/**
 * Construction-time options for {@link AutoCompleteDropdown}.
 *
 * @category Components
 */
export interface AutoCompleteDropdownOptions extends ComponentOptions {
    maxItems?: number;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultAutoCompleteDropdownOptions: Partial<AutoCompleteDropdownOptions> = {
    zIndex:          10050,
    position:        Position.FIXED,
    backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
    border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
};

/**
 * Floating dropdown panel for [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField).
 *
 * Maintains a reusable pool of `AutoCompleteItem` rows — items are updated
 * in place rather than destroyed and recreated on each keystroke.
 */
class AutoCompleteDropdown extends Component<AutoCompleteDropdownOptions> {

    private pool: AutoCompleteItem[] = [];
    private highlightedIndex: number = -1;
    private readonly onSelect: (value: string) => void;
    private readonly onHide: () => void;
    private readonly onViewportMouseDown: (e: MouseEvent) => void;
    private open: boolean = false;
    // Set true while a fade-out is in flight; reset to false either when the
    // fade completes (so the deferred detach runs) or when a fresh `show()`
    // re-displays the dropdown mid-fade (the deferred detach skips because
    // the dropdown is back on screen).
    private dismissing: boolean = false;

    /**
     * @param onSelect - Called with the selected suggestion string when the user picks an item.
     * @param onHide - Called whenever the dropdown hides, including via viewport click-outside.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: string) => void, onHide: () => void, options?: AutoCompleteDropdownOptions) {
        super({ ..._defaultAutoCompleteDropdownOptions, ...(options ?? {}) });

        this.onSelect = onSelect;
        this.onHide   = onHide;

        this.setVisible(false);
        this.getAria().setRole("listbox");
        // Dynamic dimensions from anchor + suggestion count — layout containment is safe.
        this.setContain("layout");

        const vbox = new VBox();

        vbox.setComponentSpacing(0);
        vbox.setStretching(true);
        this.setLayoutManager(vbox);

        this.onViewportMouseDown = (e: MouseEvent) => {
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

        if (options.maxItems !== undefined) {
            this.setMaxItems(options.maxItems);
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
        this.pauseLayout();
        this.updatePool(suggestions);
        this.resumeLayout();

        this.highlightedIndex = -1;

        const HEIGHT = AutoCompleteItem.HEIGHT;
        const insets = 8;
        const itemCount = suggestions.length;
        const rect = anchorEl.getBoundingClientRect();

        this.setWidth(rect.width);
        this.setHeight(itemCount * HEIGHT + insets);

        const el = this.getElement(true);

        this.doLayout();

        const panelHeight = itemCount * HEIGHT + insets;
        const vpHeight = window.innerHeight;
        let y = rect.bottom;

        if (y + panelHeight > vpHeight && rect.top - panelHeight > 0) {
            y = rect.top - panelHeight;
        }

        this.setX(rect.left);
        this.setY(y);

        if (!document.documentElement.contains(el)) {
            document.documentElement.appendChild(el);
        }

        this.setVisible(true);
        this.open = true;

        // Cancel a pending fade-out's deferred detach so a fresh show during
        // the outgoing transition keeps the element in the DOM.
        this.dismissing = false;

        Animation.play(el, {
            from:       { opacity: "0" },
            to:         { opacity: "1" },
            durationMs: AUTOCOMPLETE_ANIM_DURATION_MS,
            properties: ["opacity"],
        });

        Event.addViewportListener(this, "mousedown", this.onViewportMouseDown);

        return this;
    }

    /**
     * Hides the dropdown, detaches it from the DOM, and fires the `onHide` callback.
     */
    hide(): this {
        this.open = false;
        Event.removeViewportListener(this, "mousedown", this.onViewportMouseDown);

        const el = this.getElement();
        const finalize = (): void => {
            this.setVisible(false);
            this.removeElement();
            this.onHide();
        };

        if (!el) {
            finalize();
            return this;
        }

        this.dismissing = true;

        Animation.play(el, {
            to:         { opacity: "0" },
            durationMs: AUTOCOMPLETE_ANIM_DURATION_MS,
            properties: ["opacity"],
            onComplete: () => {
                if (!this.dismissing) {
                    return;
                }
                this.dismissing = false;
                finalize();
            },
        });

        return this;
    }

    /**
     * Returns whether the dropdown is currently visible.
     *
     * @returns True if the dropdown is open.
     */
    isOpen(): boolean {
        return this.open;
    }

    /**
     * Moves keyboard highlight to the next item, wrapping to the first if at the end.
     */
    highlightNext(): void {
        const next = this.highlightedIndex + 1;

        this.moveTo(next < this.pool.length ? next : 0);
    }

    /**
     * Moves keyboard highlight to the previous item, wrapping to the last if at the start.
     */
    highlightPrev(): void {
        const prev = this.highlightedIndex - 1;

        this.moveTo(prev >= 0 ? prev : this.pool.length - 1);
    }

    /**
     * Returns the text of the currently highlighted item, or null if nothing is highlighted.
     *
     * @returns The highlighted suggestion string, or null.
     */
    getHighlightedValue(): string | null {
        if (this.highlightedIndex < 0 || this.highlightedIndex >= this.pool.length) {
            return null;
        }

        return this.pool[this.highlightedIndex].getText();
    }

    /**
     * Returns the element ID of the currently highlighted item, or null if none is highlighted.
     *
     * Used to populate `aria-activedescendant` on the combobox input.
     *
     * @returns The highlighted item's HTML element ID, or null.
     */
    getHighlightedId(): string | null {
        if (this.highlightedIndex < 0 || this.highlightedIndex >= this.pool.length) {
            return null;
        }

        return this.pool[this.highlightedIndex].getId();
    }

    /**
     * Fires the select callback for the currently highlighted item, if any.
     */
    selectHighlighted(): void {
        const value = this.getHighlightedValue();

        if (value !== null) {
            this.onSelect(value);
        }
    }

    /**
     * Moves highlight to a specific pool index, clearing the previous highlight.
     *
     * @param index - The pool index to highlight.
     */
    private moveTo(index: number): void {
        if (this.highlightedIndex >= 0 && this.highlightedIndex < this.pool.length) {
            this.pool[this.highlightedIndex].setHighlighted(false);
        }

        this.highlightedIndex = index;

        if (index >= 0 && index < this.pool.length) {
            this.pool[index].setHighlighted(true);
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
        const oldLen = this.pool.length;
        const overlap = Math.min(newLen, oldLen);

        for (let i = 0; i < overlap; i++) {
            this.pool[i].update(suggestions[i]);
            this.pool[i].setHighlighted(false);
        }

        if (newLen > oldLen) {
            for (let i = oldLen; i < newLen; i++) {
                const item = new AutoCompleteItem(suggestions[i], this.onSelect);

                this.addComponent(item);
                this.pool.push(item);
            }
        } else if (newLen < oldLen) {
            for (let i = newLen; i < oldLen; i++) {
                this.removeComponent(this.pool[i]);
            }

            this.pool.splice(newLen);
        }
    }
}

const AutoCompleteDropdownCallable = callable(AutoCompleteDropdown);
type AutoCompleteDropdownCallable = AutoCompleteDropdown;
export {
    AutoCompleteDropdown         as _AutoCompleteDropdown,
    AutoCompleteDropdownCallable as AutoCompleteDropdown
};
