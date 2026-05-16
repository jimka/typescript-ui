// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Bindable } from "~/core/Bindable.js";
import { ThemeManager } from "~/core/Theme.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { TextField } from "~/component/input/TextField.js";
import { AutoCompleteDropdown } from "~/component/input/AutoCompleteDropdown.js";
import { callable } from "~/core/Callable.js";

/**
 * Controls how typed input is matched against suggestion strings.
 *
 * - `'contains'` — matches anywhere in the string (default).
 * - `'startsWith'` — matches only from the beginning of the string.
 *
 * @category Components
 */
export type AutoCompleteMatchMode = 'contains' | 'startsWith';

/**
 * Construction-time options for {@link AutoCompleteField}.
 *
 * @category Components
 */
export interface AutoCompleteFieldOptions extends ComponentOptions {
    /** Static list of suggestion strings. */
    suggestions?    : string[];
    /** Data store used when suggestions come from a remote/in-memory store. */
    store?          : AbstractStore;
    /** The store field name whose value is shown as the suggestion text. Required when `store` is set. */
    displayField?   : string;
    /** Minimum number of characters typed before suggestions are queried. Default: 1. */
    minChars?       : number;
    /** Debounce delay in milliseconds before querying on each keystroke. Default: 200. */
    debounceMs?     : number;
    /** Maximum number of suggestions to show at once. Default: 10. */
    maxSuggestions? : number;
    /** Placeholder text shown in the input when empty. */
    placeholder?    : string;
    /** How the typed query is matched against suggestions. Default: `'contains'`. */
    matchMode?      : AutoCompleteMatchMode;
}

/**
 * @deprecated Use {@link AutoCompleteFieldOptions}.
 */
export type AutoCompleteFieldConfig = AutoCompleteFieldOptions;

/**
 * A typeahead/autocomplete text field.
 *
 * Wraps a [`TextField`](/api/component/input/classes/TextField) and an `AutoCompleteDropdown`. Suggestions may come
 * from a static string array or from an [`AbstractStore`](/api/data/classes/AbstractStore). Implements `Bindable<string>`
 * for use with the [`Binding`](/api/core/classes/Binding) system.
 *
 * @example
 * ```typescript
 * const field = new AutoCompleteField({
 *     suggestions: ['Apple', 'Banana', 'Cherry'],
 *     placeholder: 'Type a fruit…',
 * });
 * panel.addComponent(field);
 * field.addSelectListener(value => console.log('Selected:', value));
 * ```
 *
 * @category Components
 */
class AutoCompleteField extends Component<AutoCompleteFieldOptions> implements Bindable<string> {

    private textField         : TextField;
    private dropdown          : AutoCompleteDropdown;
    private debounceTimer     : ReturnType<typeof setTimeout> | null = null;
    private currentValue      : string                               = "";
    private bindingListeners  : Array<() => void>                    = [];
    private selectListeners   : Array<(value: string) => void>       = [];

    /**
     * @param options - Optional construction-time options for suggestions, store, behaviour, and base Component styling.
     */
    constructor(options?: AutoCompleteFieldOptions) {
        // Children are built below, so consumer options can't safely cascade
        // through super(). Apply them manually at the end of the constructor.
        super();

        this.textField = new TextField();

        this.addComponent(this.textField);

        this.syncSizeFromTextField();
        ThemeManager.onThemeChange(() => this.syncSizeFromTextField());

        this.dropdown = new AutoCompleteDropdown(
            value => this.onSuggestionSelected(value),
            ()    => this.onDropdownHidden(),
        );

        this.textField.getAria().setRole("combobox");
        this.textField.getAria().setAutoComplete("list");
        this.textField.getAria().setExpanded(false);
        this.textField.getAria().setControls(this.dropdown.getId());
        this.textField.getAria().setActiveDescendant("");

        Event.addListener(this.textField, "input",   () => this.onInput());
        Event.addListener(this.textField, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));
        Event.addListener(this.textField, "focus",   () => this.onFocus());
        Event.addListener(this.textField, "blur",    () => this.onBlur());

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link AutoCompleteFieldOptions} bag, dispatching each field
     * through its setter so side effects fire identically whether the value
     * came from the constructor or a later setter call.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AutoCompleteFieldOptions): this {
        super.applyOptions(options);

        if (options.suggestions    !== undefined) this.setSuggestions(options.suggestions);
        if (options.minChars       !== undefined) this.setMinChars(options.minChars);
        if (options.debounceMs     !== undefined) this.setDebounceMs(options.debounceMs);
        if (options.maxSuggestions !== undefined) this.setMaxSuggestions(options.maxSuggestions);
        if (options.matchMode      !== undefined) this.setMatchMode(options.matchMode);
        if (options.placeholder    !== undefined) this.setPlaceholder(options.placeholder);

        // store + displayField are paired; apply via setStore when both present,
        // otherwise route through the individual options bag fields so partial
        // configuration is preserved without firing a half-configured setStore.
        if (options.store !== undefined && options.displayField !== undefined) {
            this.setStore(options.store, options.displayField);
        } else {
            if (options.store        !== undefined) this._options.store        = options.store;
            if (options.displayField !== undefined) this._options.displayField = options.displayField;
        }

        return this;
    }

    /**
     * Mirrors the preferred and max size from the inner [`TextField`](/api/component/input/classes/TextField) onto this component
     * so that parent layout managers can calculate the correct row height.
     *
     * Called at construction time and after each theme change.
     */
    private syncSizeFromTextField(): void {
        const pref = this.textField.getPreferredSize();
        const max  = this.textField.getMaxSize();

        if (pref) {
            this.setPreferredSize(pref.width, pref.height);
        }

        if (max) {
            this.setMaxSize(max.width, max.height);
        }
    }

    /**
     * Returns the offset from the top of the autocomplete field to the inner text field's baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the text field has no baseline.
     *
     * @remarks `doLayout` places the inner [`TextField`](/api/component/input/classes/TextField) at `(0, 0)` to fill this
     * component, so this baseline excludes `insets` (which are not used to
     * position the child) and only adds the component's own border.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this.textField.getBaseline());
    }

    /**
     * Lays out the internal text field to fill the container exactly.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this.textField.setX(0);
        this.textField.setY(0);
        this.textField.setWidth(this.getWidth());
        this.textField.setHeight(this.getHeight());

        return this;
    }

    // ── Bindable<string> ────────────────────────────────────────────────────

    /**
     * Sets the field value programmatically without firing binding or select listeners.
     *
     * @param value - The string value to display.
     */
    setValue(value: string): this {
        this.currentValue = value;
        this.textField.setValue(value);

        return this;
    }

    /**
     * Returns the current text value of the field.
     *
     * @returns The current string value.
     */
    getValue(): string {
        return this.currentValue;
    }

    /**
     * Registers a listener that is called whenever the field value changes due to user input.
     *
     * @param fn - Callback invoked after each value change.
     */
    addBindingListener(fn: () => void): void {
        this.bindingListeners.push(fn);
    }

    // ── Configuration ────────────────────────────────────────────────────────

    /**
     * Replaces the static suggestion list.
     *
     * @param suggestions - The new list of suggestion strings.
     */
    setSuggestions(suggestions: string[]): this {
        this._options.suggestions = suggestions;

        return this;
    }

    /**
     * Configures the field to query suggestions from a store.
     *
     * @param store - The data store to filter.
     * @param displayField - The field name on each record to use as the suggestion text.
     */
    setStore(store: AbstractStore, displayField: string): this {
        this._options.store        = store;
        this._options.displayField = displayField;

        return this;
    }

    /**
     * Sets the minimum number of characters required before suggestions are shown.
     *
     * @param n - Minimum character count. Default is 1.
     */
    setMinChars(n: number): this {
        this._options.minChars = n;

        return this;
    }

    /**
     * Sets the debounce delay in milliseconds applied to each input event.
     *
     * @param ms - Delay in milliseconds. Default is 200.
     */
    setDebounceMs(ms: number): this {
        this._options.debounceMs = ms;

        return this;
    }

    /**
     * Sets the maximum number of suggestions to display at once.
     *
     * @param n - Maximum item count. Default is 10.
     */
    setMaxSuggestions(n: number): this {
        this._options.maxSuggestions = n;

        return this;
    }

    /**
     * Sets how typed input is matched against suggestion strings.
     *
     * @param mode - `'contains'` to match anywhere; `'startsWith'` to match from the beginning only.
     */
    setMatchMode(mode: AutoCompleteMatchMode): this {
        this._options.matchMode = mode;

        return this;
    }

    /**
     * Sets the placeholder text shown in the inner text field when empty.
     *
     * @param placeholder - The placeholder string.
     */
    setPlaceholder(placeholder: string): this {
        this._options.placeholder = placeholder;
        this.textField.setPlaceholder(placeholder);

        return this;
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * Registers a listener called when the user selects a suggestion.
     *
     * @param fn - Callback that receives the selected string value.
     */
    addSelectListener(fn: (value: string) => void): void {
        this.selectListeners.push(fn);
    }

    // ── Internal event handlers ──────────────────────────────────────────────

    /**
     * Handles the `input` event on the internal text field.
     *
     * Notifies binding listeners, then schedules a debounced query if the
     * typed value meets the `minChars` threshold.
     */
    private onInput(): void {
        this.currentValue = this.textField.getValue();

        for (const fn of this.bindingListeners) {
            fn();
        }

        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }

        const minChars = this._options.minChars ?? 1;

        if (this.currentValue.length < minChars) {
            this.dropdown.hide();

            return;
        }

        this.debounceTimer = setTimeout(
            () => this.querySuggestions(this.currentValue),
            this._options.debounceMs ?? 200
        );
    }

    /**
     * Handles `keydown` events on the internal text field for dropdown navigation.
     *
     * @param e - The keyboard event from the text field.
     */
    private onKeyDown(e: KeyboardEvent): void {
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();

                if (!this.dropdown.isOpen()) {
                    this.querySuggestions(this.currentValue);
                } else {
                    this.dropdown.highlightNext();
                    this.updateActiveDescendant();
                }

                break;

            case "ArrowUp":
                e.preventDefault();
                this.dropdown.highlightPrev();
                this.updateActiveDescendant();
                break;

            case "Enter":
                if (this.dropdown.isOpen() && this.dropdown.getHighlightedValue() !== null) {
                    e.preventDefault();
                    this.dropdown.selectHighlighted();
                }

                break;

            case "Escape":
                this.dropdown.hide();
                this.textField.focus();
                break;

            case "Tab":
                this.dropdown.hide();
                break;

            default:
                break;
        }
    }

    /**
     * Handles focus on the text field — no-op placeholder for future extension.
     */
    private onFocus(): void {
        // reserved for future use
    }

    /**
     * Hides the dropdown after a short delay when the field loses focus.
     *
     * The delay allows a click on a dropdown item to fire before the dropdown is hidden.
     */
    private onBlur(): void {
        setTimeout(() => {
            const active = document.activeElement;
            const dropEl = this.dropdown.getElement();

            if (dropEl && dropEl.contains(active)) {
                return;
            }

            this.dropdown.hide();
        }, 150);
    }

    /**
     * Returns true when `candidate` matches `lower` according to the current `matchMode`.
     *
     * Both strings must already be lowercased by the caller.
     *
     * @param candidate - The lowercased suggestion string to test.
     * @param lower - The lowercased query string.
     */
    private matches(candidate: string, lower: string): boolean {
        if ((this._options.matchMode ?? 'contains') === 'startsWith') {
            return candidate.startsWith(lower);
        }

        return candidate.includes(lower);
    }

    /**
     * Queries the suggestion source for the given input string and shows results.
     *
     * Stale results (where the query string no longer matches the current value)
     * are discarded.
     *
     * @param query - The string to filter suggestions by.
     */
    private querySuggestions(query: string): void {
        const maxSuggestions = this._options.maxSuggestions ?? 10;
        const matchMode      = this._options.matchMode ?? 'contains';
        const suggestions    = this._options.suggestions;
        const store          = this._options.store;
        const displayField   = this._options.displayField;

        if (suggestions !== undefined) {
            const lower    = query.toLowerCase();
            const filtered = suggestions
                .filter(s => this.matches(s.toLowerCase(), lower))
                .slice(0, maxSuggestions);

            if (query === this.currentValue) {
                this.showSuggestions(filtered);
            }

            return;
        }

        if (store !== undefined && displayField !== undefined) {
            store.clearFilter();
            store.filterBy({
                type: matchMode === 'startsWith' ? 'startsWith' : 'contains',
                field: displayField,
                value: query,
                caseSensitive: false,
            });

            const results = store.getRecords()
                .map(r => String(r.get(displayField)))
                .slice(0, maxSuggestions);

            if (query === this.currentValue) {
                this.showSuggestions(results);
            }
        }
    }

    /**
     * Shows the dropdown with the given list, or hides it if the list is empty.
     *
     * @param list - The suggestion strings to display.
     */
    private showSuggestions(list: string[]): void {
        if (list.length === 0) {
            this.dropdown.hide();

            return;
        }

        this.dropdown.show(this.textField.getElement(true), list);
        this.textField.getAria().setExpanded(true);
    }

    /**
     * Called by the dropdown's `onHide` callback whenever it closes, including
     * via the viewport click-outside handler.
     *
     * Resets the combobox ARIA state on the input.
     */
    private onDropdownHidden(): void {
        this.textField.getAria().setExpanded(false);
        this.textField.getAria().setActiveDescendant("");
    }

    /**
     * Syncs `aria-activedescendant` on the input with the currently highlighted item.
     */
    private updateActiveDescendant(): void {
        this.textField.getAria().setActiveDescendant(this.dropdown.getHighlightedId() ?? "");
    }

    /**
     * Called when the user selects a suggestion from the dropdown.
     *
     * Updates the field value, notifies listeners, hides the dropdown, and
     * returns focus to the text field.
     *
     * @param value - The selected suggestion string.
     */
    private onSuggestionSelected(value: string): void {
        this.textField.setValue(value);
        this.currentValue = value;

        for (const fn of this.selectListeners) {
            fn(value);
        }

        for (const fn of this.bindingListeners) {
            fn();
        }

        this.dropdown.hide();
        this.textField.focus();
    }
}

const AutoCompleteFieldCallable = callable(AutoCompleteField);
type AutoCompleteFieldCallable = AutoCompleteField;
export {
    AutoCompleteField         as _AutoCompleteField,
    AutoCompleteFieldCallable as AutoCompleteField
};
