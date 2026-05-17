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

    private _textField         : TextField;
    private _dropdown          : AutoCompleteDropdown;
    private _debounceTimer     : ReturnType<typeof setTimeout> | null = null;
    private _currentValue      : string                               = "";
    private _bindingListeners  : Array<() => void>                    = [];
    private _selectListeners   : Array<(value: string) => void>       = [];

    /**
     * @param options - Optional construction-time options for suggestions, store, behaviour, and base Component styling.
     */
    constructor(options?: AutoCompleteFieldOptions) {
        // Children are built below, so consumer options can't safely cascade
        // through super(). Apply them manually at the end of the constructor.
        super();

        this._textField = new TextField();

        this.addComponent(this._textField);

        this.syncSizeFromTextField();
        ThemeManager.onThemeChange(() => this.syncSizeFromTextField());

        this._dropdown = new AutoCompleteDropdown(
            value => this.onSuggestionSelected(value),
            ()    => this.onDropdownHidden(),
        );

        this._textField.getAria().setRole("combobox");
        this._textField.getAria().setAutoComplete("list");
        this._textField.getAria().setExpanded(false);
        this._textField.getAria().setControls(this._dropdown.getId());
        this._textField.getAria().setActiveDescendant("");

        Event.addListener(this._textField, "input",   () => this.onInput());
        Event.addListener(this._textField, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));
        Event.addListener(this._textField, "focus",   () => this.onFocus());
        Event.addListener(this._textField, "blur",    () => this.onBlur());

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
        const pref = this._textField.getPreferredSize();
        const max  = this._textField.getMaxSize();

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
        return this.wrapInnerBaseline(this._textField.getBaseline());
    }

    /**
     * Lays out the internal text field to fill the container exactly.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this._textField.setX(0);
        this._textField.setY(0);
        this._textField.setWidth(this.getWidth());
        this._textField.setHeight(this.getHeight());

        return this;
    }

    // ── Bindable<string> ────────────────────────────────────────────────────

    /**
     * Sets the field value programmatically without firing binding or select listeners.
     *
     * @param value - The string value to display.
     */
    setValue(value: string): this {
        this._currentValue = value;
        this._textField.setValue(value);

        return this;
    }

    /**
     * Returns the current text value of the field.
     *
     * @returns The current string value.
     */
    getValue(): string {
        return this._currentValue;
    }

    /**
     * Registers a listener that is called whenever the field value changes due to user input.
     *
     * @param fn - Callback invoked after each value change.
     */
    addBindingListener(fn: () => void): void {
        this._bindingListeners.push(fn);
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
        this._textField.setPlaceholder(placeholder);

        return this;
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * Registers a listener called when the user selects a suggestion.
     *
     * @param fn - Callback that receives the selected string value.
     */
    addSelectListener(fn: (value: string) => void): void {
        this._selectListeners.push(fn);
    }

    // ── Internal event handlers ──────────────────────────────────────────────

    /**
     * Handles the `input` event on the internal text field.
     *
     * Notifies binding listeners, then schedules a debounced query if the
     * typed value meets the `minChars` threshold.
     */
    private onInput(): void {
        this._currentValue = this._textField.getValue();

        for (const fn of this._bindingListeners) {
            fn();
        }

        if (this._debounceTimer !== null) {
            clearTimeout(this._debounceTimer);
        }

        const minChars = this._options.minChars ?? 1;

        if (this._currentValue.length < minChars) {
            this._dropdown.hide();

            return;
        }

        this._debounceTimer = setTimeout(
            () => this.querySuggestions(this._currentValue),
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

                if (!this._dropdown.isOpen()) {
                    this.querySuggestions(this._currentValue);
                } else {
                    this._dropdown.highlightNext();
                    this.updateActiveDescendant();
                }

                break;

            case "ArrowUp":
                e.preventDefault();
                this._dropdown.highlightPrev();
                this.updateActiveDescendant();
                break;

            case "Enter":
                if (this._dropdown.isOpen() && this._dropdown.getHighlightedValue() !== null) {
                    e.preventDefault();
                    this._dropdown.selectHighlighted();
                }

                break;

            case "Escape":
                this._dropdown.hide();
                this._textField.focus();
                break;

            case "Tab":
                this._dropdown.hide();
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
            const dropEl = this._dropdown.getElement();

            if (dropEl && dropEl.contains(active)) {
                return;
            }

            this._dropdown.hide();
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

            if (query === this._currentValue) {
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

            if (query === this._currentValue) {
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
            this._dropdown.hide();

            return;
        }

        this._dropdown.show(this._textField.getElement(true), list);
        this._textField.getAria().setExpanded(true);
    }

    /**
     * Called by the dropdown's `onHide` callback whenever it closes, including
     * via the viewport click-outside handler.
     *
     * Resets the combobox ARIA state on the input.
     */
    private onDropdownHidden(): void {
        this._textField.getAria().setExpanded(false);
        this._textField.getAria().setActiveDescendant("");
    }

    /**
     * Syncs `aria-activedescendant` on the input with the currently highlighted item.
     */
    private updateActiveDescendant(): void {
        this._textField.getAria().setActiveDescendant(this._dropdown.getHighlightedId() ?? "");
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
        this._textField.setValue(value);
        this._currentValue = value;

        for (const fn of this._selectListeners) {
            fn(value);
        }

        for (const fn of this._bindingListeners) {
            fn();
        }

        this._dropdown.hide();
        this._textField.focus();
    }
}

const AutoCompleteFieldCallable = callable(AutoCompleteField);
type AutoCompleteFieldCallable = AutoCompleteField;
export {
    AutoCompleteField         as _AutoCompleteField,
    AutoCompleteFieldCallable as AutoCompleteField
};
