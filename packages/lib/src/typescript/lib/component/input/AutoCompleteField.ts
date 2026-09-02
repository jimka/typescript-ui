// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { TextField, TextFieldOptions } from "~/component/input/TextField.js";
import { AutoCompleteDropdown } from "~/component/input/AutoCompleteDropdown.js";
import { registerFocusWithinRing } from "~/component/input/focusRing.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { saturate } from "~/primitive/Size.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { callable } from "~/core/Callable.js";

// Focus ring highlighting the composite root whenever the inner TextField is
// focused (the helper appends the focus pseudo-element).
registerFocusWithinRing(".AutoCompleteField");

// Chrome deviation shared by every AutoCompleteField's inner field: the
// composite root (below) owns the visible border, so the inner field is
// borderless and square-cornered, with no browser-default focus ring (the
// composite's own `:focus-within` ring, wired by `registerFocusWithinRing`
// above, shows instead). `Partial<TextFieldOptions>`-typed (not `StyleBag`)
// so it can double as the constructor's `subclassDefaults` forward, per
// ARCHITECTURE.md's "Class-level defaults must survive the getter" — without
// that forward, `_options` never sees these values and a pre-render
// `getBorder()`/`getOutline()` would answer the inherited `TextInput`
// default instead.
const AUTOCOMPLETE_FIELD_CHROME: Partial<TextFieldOptions> = {
    border:       "none",
    borderRadius: "0",
    outline:      "none",
};

/**
 * The inner text field of an {@link AutoCompleteField} — borderless and
 * chromeless by convention, so the composite root's own border reads as the
 * control's only edge.
 */
class AutoCompleteTextField extends TextField {
    protected static readonly ownClassStyleDefaults: StyleBag = AUTOCOMPLETE_FIELD_CHROME;

    constructor() {
        super(undefined, AUTOCOMPLETE_FIELD_CHROME);
    }
}

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
 * String-literal event emitted by {@link AutoCompleteField} on top of the
 * inherited `change` / `binding`: `"select"` fires when the user picks a
 * suggestion from the dropdown.
 *
 * @category Components
 */
export type AutoCompleteFieldEvent = "select";

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
    private _selectBag     : ListenerBag<AutoCompleteFieldEvent> = this.registerListenerBag(new ListenerBag<AutoCompleteFieldEvent>());

    /**
     * @param options - Optional construction-time options for suggestions, store, behaviour, and base Component styling.
     */
    constructor(options?: AutoCompleteFieldOptions) {
        // Children are built below, so consumer options can't safely cascade
        // through super(). Apply them manually at the end of the constructor.
        // eslint-disable-next-line local/forward-super-options
        super();

        // The composite owns the visible chrome — gray edge from the shared
        // `--ts-ui-input-border` token, matching `:focus-within` outline
        // wired up at module top. The inner TextField then strips its own
        // border + browser focus outline so the two never paint over.
        this.setBorder("var(--ts-ui-input-border)");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");

        this._textField = new AutoCompleteTextField();

        this.addComponent(this._textField);

        this.syncSizeFromTextField();
        this.subscribeTheme(() => this.syncSizeFromTextField());

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
        Event.addListener(this._textField, "blur",    () => this.onBlur());
        // Bridge user-driven text changes from the inner TextField up into
        // AbstractInput's change / binding listener fan-out so consumers
        // attached via the inherited `on("change", fn)` see every keystroke
        // and every suggestion-pick (suggestions hit setValue, which writes
        // through the TextField and re-fires its own change listeners).
        this._textField.on("change", value => this.notifyChange(value));

        if (options) {
            this.applyOptions(options);
        }

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
        }

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
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
     * Mirrors the preferred, max, and min size from the inner [`TextField`](/api/component/input/classes/TextField) onto this component
     * so that parent layout managers can calculate the correct row height.
     *
     * The inner field is sized to this component's *content* box, so each
     * mirrored **height** gains this component's own perimeter; widths stay
     * mirrored (see below). Reporting the bare
     * inner size instead would let a parent squeeze the composite to it, and
     * the clamp would hand the inner field back a box its own minimum overflows
     * — re-creating through the size hints exactly the clipping `doLayout` now
     * avoids.
     *
     * Called at construction time and after each theme change.
     */
    private syncSizeFromTextField(): void {
        const perimeter  = this.getPerimeterSize();
        const horizontal = perimeter.left + perimeter.right;
        const vertical   = perimeter.top  + perimeter.bottom;

        const pref = this._textField.getPreferredSize();
        const max  = this._textField.getMaxSize();
        const min  = this._textField.getMinSize();

        if (pref) {
            // Height gains this component's perimeter, width does not. The
            // inner field's height is derived from its own border and drops by
            // it, so adding the perimeter back restores parity with a bare
            // TextField; its width is a flat constant that does not move, so
            // adding the perimeter there would make the composite 2px wider
            // than a sibling field and break preferred-width column alignment.
            this.setPreferredSize({ width: pref.width, height: pref.height + vertical });
        }

        if (max) {
            this.setMaxSize({ width: saturate(max.width + horizontal), height: saturate(max.height + vertical) });
        }

        // Mirrors the inner field's min so the composite is non-squishable
        // like a bare TextField, not just visually preferred at one line. Min
        // width stays mirrored: the inner field pins min-width 0 on purpose so
        // the composite stays horizontally flexible.
        if (min) {
            this.setMinSize({ width: min.width, height: min.height + vertical });
        }
    }

    /**
     * Returns the offset from the top of the autocomplete field to the inner text field's baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the text field has no baseline.
     *
     * @remarks `doLayout` places the inner [`TextField`](/api/component/input/classes/TextField) at the content-box
     * origin, so the child is already offset by this component's insets, border
     * and padding — exactly the sum `wrapInnerBaseline` re-adds to the inner
     * field's own baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this._textField.getBaseline());
    }

    /**
     * Lays out the internal text field to fill this component's content box —
     * the outer box less this component's own border — so the inner field does
     * not overhang the border and get clipped.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        this._textField.setX(box.x);
        this._textField.setY(box.y);
        this._textField.setWidth(box.width);
        this._textField.setHeight(box.height);

        return this;
    }

    // ── Bindable<string> ────────────────────────────────────────────────────

    /**
     * Sets the field value programmatically without firing binding or select
     * listeners. Forwards directly to the inner TextField so the inherited
     * `notifyChange` does not double-fire on this path; user-driven changes
     * fire through the constructor's `_textField.on("change", fn)` bridge.
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
     * Registers a listener for one of this field's events. `"select"` fires when
     * the user picks a suggestion from the dropdown (routed through this class's
     * own listener bag); `"change"` and `"binding"` are the inherited
     * {@link AbstractInput} value events.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "select",  listener: (value: string) => void): this;
    on(event: "change",  listener: (value: string) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "select" | "change" | "binding", listener: Function): this {
        if (event === "select") {
            this._selectBag.add("select", listener);

            return this;
        }

        return super.on(event as "change", listener as (value: string) => void);
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: "select" | "change" | "binding", listener: Function): this {
        if (event === "select") {
            this._selectBag.remove("select", listener);

            return this;
        }

        return super.off(event, listener);
    }

    /**
     * Registers a listener called when the user selects a suggestion. Retained
     * for back-compat; a thin forwarder onto `on("select", fn)`.
     *
     * @param fn - Callback that receives the selected string value.
     */
    addSelectListener(fn: (value: string) => void): void {
        this.on("select", fn);
    }

    // ── Internal event handlers ──────────────────────────────────────────────

    /**
     * Handles the `input` event on the internal text field.
     *
     * Schedules a debounced query when the typed value meets the `minChars`
     * threshold. AbstractInput's change / binding listeners fire through
     * the constructor's `_textField.on("change", fn)` bridge, so this
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
     * While the dropdown is open, navigation / commit keys are forwarded
     * into the inner list's keyboard reducer via `dropdown.handleKey`.
     * The forward is gated by an allow-list (ArrowDown / ArrowUp / Enter)
     * so printable characters fall through to the TextField's `input`
     * handler without entering the list's type-ahead buffer — otherwise
     * every keystroke would double-fire (type-ahead + `querySuggestions`).
     * Escape and Tab stay on this handler so the dropdown can close
     * without the list consuming them.
     *
     * @param e - The keyboard event from the text field.
     */
    private onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (this._dropdown.isOpen()) {
            const forward = e.key === "ArrowDown"
                         || e.key === "ArrowUp"
                         || e.key === "Enter";

            if (forward && this._dropdown.handleKey(e)) {
                this.updateActiveDescendant();

                return { prevent: true };
            }
        }

        switch (e.key) {
            case "ArrowDown":
                // Dropdown was closed — fire the query.
                this.querySuggestions(this.getValue());

                return { prevent: true };

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
     * Hides the dropdown after a short delay when the field loses focus.
     *
     * The delay allows a click on a dropdown item to fire before the dropdown is hidden.
     */
    private onBlur(): void {
        setTimeout(() => {
            const active = DOM.source.getActiveElement();
            const dropEl = this._dropdown.getElement();

            if (dropEl && DOM.source.contains(dropEl, active)) {
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

        this._dropdown.show(this._textField.getElement(true)!, list);
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
     * Syncs `aria-activedescendant` on the input with the currently focused
     * row in the dropdown's inner list.
     */
    private updateActiveDescendant(): void {
        this._textField.getAria().setActiveDescendant(this._dropdown.getFocusedRowId() ?? "");
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

        this._selectBag.fire("select", value);

        this._dropdown.hide();
        this._textField.focus();
    }

    /**
     * Disposes the dropdown, then runs the inherited teardown. `_dropdown`
     * is a `Position.FIXED` overlay (see ARCHITECTURE.md's carve-out for
     * `AnimatedDropdown`), never a registered child, so `super.destructor()`'s
     * recursion cannot reach it on its own.
     */
    protected destructor(): void {
        this._dropdown.dispose();

        super.destructor();
    }
}

const AutoCompleteFieldCallable = callable(AutoCompleteField);
type AutoCompleteFieldCallable = AutoCompleteField;
export {
    AutoCompleteField         as _AutoCompleteField,
    AutoCompleteFieldCallable as AutoCompleteField
};
