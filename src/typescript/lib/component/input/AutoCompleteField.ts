// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Event } from "~/core/Event.js";
import { ThemeManager } from "~/core/Theme.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { TextField } from "~/component/input/TextField.js";
import { AutoCompleteDropdown } from "~/component/input/AutoCompleteDropdown.js";
import { callable } from "~/core/Callable.js";

/**
 * Controls how typed input is matched against suggestion strings.
 *
 * - `'contains'`                — substring match, case-insensitive (default).
 * - `'startsWith'`              — prefix match, case-insensitive.
 * - `'containsCaseSensitive'`   — substring match, case-sensitive.
 * - `'startsWithCaseSensitive'` — prefix match, case-sensitive.
 *
 * @category Components
 */
export type AutoCompleteMatchMode =
    | 'contains'
    | 'startsWith'
    | 'containsCaseSensitive'
    | 'startsWithCaseSensitive';

/**
 * Construction-time options for {@link AutoCompleteField}.
 *
 * @category Components
 */
export interface AutoCompleteFieldOptions extends AbstractInputOptions {
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
    /** How the typed query is matched against suggestions. Default: `'contains'` (case-insensitive). */
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
class AutoCompleteField extends AbstractInput<string, AutoCompleteFieldOptions> {

    private _textField     : TextField;
    private _dropdown      : AutoCompleteDropdown;
    private _debounceTimer : ReturnType<typeof setTimeout> | null = null;
    private _selectListeners: Array<(value: string) => void>      = [];

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
        // Bridge user-driven text changes from the inner TextField up into
        // AbstractInput's change / binding listener fan-out so consumers
        // attached via the inherited `addChangeListener` see every keystroke
        // and every suggestion-pick (suggestions hit setValue, which writes
        // through the TextField and re-fires its own change listeners).
        this._textField.addChangeListener(value => this.notifyChange(value));

        if (options) {
            this.applyOptions(options);
        }

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
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

        const opts = { ...this._defaultOptions, ...options } as AutoCompleteFieldOptions;

        if (opts.suggestions    !== undefined) this.setSuggestions(opts.suggestions);
        if (opts.minChars       !== undefined) this.setMinChars(opts.minChars);
        if (opts.debounceMs     !== undefined) this.setDebounceMs(opts.debounceMs);
        if (opts.maxSuggestions !== undefined) this.setMaxSuggestions(opts.maxSuggestions);
        if (opts.matchMode      !== undefined) this.setMatchMode(opts.matchMode);
        if (opts.placeholder    !== undefined) this.setPlaceholder(opts.placeholder);

        // store + displayField are paired; apply via setStore when both present,
        // otherwise route through the individual options bag fields so partial
        // configuration is preserved without firing a half-configured setStore.
        if (opts.store !== undefined && opts.displayField !== undefined) {
            this.setStore(opts.store, opts.displayField);
        } else {
            if (opts.store        !== undefined) this._options.store        = opts.store;
            if (opts.displayField !== undefined) this._options.displayField = opts.displayField;
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
     * Sets the field value programmatically without firing binding or select
     * listeners. Forwards directly to the inner TextField so the inherited
     * `notifyChange` does not double-fire on this path; user-driven changes
     * fire through the constructor's `_textField.addChangeListener` bridge.
     *
     * @param value - The string value to display.
     */
    setValue(value: string): this {
        this._textField.setValue(value);

        return this;
    }

    /**
     * Returns the current text value of the field, read directly from the
     * inner TextField.
     *
     * @returns The current string value.
     */
    getValue(): string {
        return this._textField.getValue();
    }

    /**
     * Reflects the enabled flag by forwarding to the inner TextField.
     */
    protected applyEnabled(value: boolean): void {
        this._textField.setEnabled(value);
    }

    /**
     * Reflects the read-only flag by forwarding to the inner TextField.
     */
    protected applyReadOnly(value: boolean): void {
        this._textField.setReadOnly(value);
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
     * Sets how typed input is matched against suggestion strings. The default
     * `'contains'` matches anywhere, case-insensitive. The `*CaseSensitive`
     * variants opt in to case-sensitive matching.
     *
     * @param mode - One of `'contains'`, `'startsWith'`, `'containsCaseSensitive'`, `'startsWithCaseSensitive'`.
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
     * Schedules a debounced query when the typed value meets the `minChars`
     * threshold. AbstractInput's change / binding listeners fire through
     * the constructor's `_textField.addChangeListener` bridge, so this
     * handler doesn't fan out to them itself.
     */
    private onInput(): void {
        if (this._debounceTimer !== null) {
            clearTimeout(this._debounceTimer);
        }

        const minChars = this._options.minChars ?? 1;
        const current  = this.getValue();

        if (current.length < minChars) {
            this._dropdown.hide();

            return;
        }

        this._debounceTimer = setTimeout(
            () => this.querySuggestions(current),
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
                    this.querySuggestions(this.getValue());
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
     * Returns true when `candidate` matches `query` according to the current
     * `matchMode`. Handles both axes: case-sensitivity via the `*CaseSensitive`
     * variants and position via the `startsWith*` variants.
     *
     * @param candidate - The raw suggestion string to test.
     * @param query - The raw query string.
     */
    private matches(candidate: string, query: string): boolean {
        const mode = this._options.matchMode ?? 'contains';

        const caseSensitive = mode === 'containsCaseSensitive'
                           || mode === 'startsWithCaseSensitive';
        const startsWith    = mode === 'startsWith'
                           || mode === 'startsWithCaseSensitive';

        const haystack = caseSensitive ? candidate : candidate.toLowerCase();
        const needle   = caseSensitive ? query     : query.toLowerCase();

        return startsWith ? haystack.startsWith(needle) : haystack.includes(needle);
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
            const filtered = suggestions
                .filter(s => this.matches(s, query))
                .slice(0, maxSuggestions);

            if (query === this.getValue()) {
                this.showSuggestions(filtered);
            }

            return;
        }

        if (store !== undefined && displayField !== undefined) {
            const caseSensitive = matchMode === 'containsCaseSensitive'
                               || matchMode === 'startsWithCaseSensitive';
            const filterType    = (matchMode === 'startsWith' || matchMode === 'startsWithCaseSensitive')
                                ? 'startsWith'
                                : 'contains';

            store.clearFilter();
            store.filterBy({
                type: filterType,
                field: displayField,
                value: query,
                caseSensitive,
            });

            const results = store.getRecords()
                .map(r => String(r.get(displayField)))
                .slice(0, maxSuggestions);

            if (query === this.getValue()) {
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
     * Updates the field value (which fires the inherited change listeners
     * through the constructor's TextField bridge), notifies the dedicated
     * select listeners, hides the dropdown, and returns focus to the text
     * field.
     *
     * @param value - The selected suggestion string.
     */
    private onSuggestionSelected(value: string): void {
        this.setValue(value);

        for (const fn of this._selectListeners) {
            fn(value);
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
