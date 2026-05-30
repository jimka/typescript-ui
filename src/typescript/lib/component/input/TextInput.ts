// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";

/**
 * Unified focus mark for every standalone TextInput subclass — `TextField`,
 * `TextArea`, `PasswordField`. Uses `box-shadow: inset` rather than the
 * pseudo-element overlay the composite inputs (`AutoCompleteField`, the
 * picker fields, `NumberSpinner`) rely on, because `<input>` is a CSS
 * replaced element and doesn't render `::before` / `::after` reliably.
 * The inset 2-px shadow paints at the same visual position as those
 * pseudo borders — just inside the element's own border edge — so the
 * two recipes are interchangeable visually. `PickerInput` and any inner
 * input that opts out via `setOutline("none")` (AutoCompleteField,
 * NumberSpinner) keep the focus indicator on the outer composite
 * instead.
 */
(() => {
    new StyleRule({
        scope:  "selector",
        name:   ".TextField:focus, .TextArea:focus, .PasswordField:focus",
        styles: {
            outline:   "none",
            boxShadow: "inset 0 0 0 2px var(--ts-ui-indicator-focus, rgb(30, 100, 200))",
        },
    });
})();

/**
 * Construction-time options for {@link TextInput}.
 *
 * @remarks `tag` is inherited from {@link ComponentOptions} but defaults to
 * `"input"` for `TextInput` (subclasses such as {@link TextArea} pass
 * `"textarea"`).
 *
 * @category Components
 */
export interface TextInputOptions extends AbstractInputOptions {
    name?:         string;
    type?:         string;
    text?:         string;
    textAlign?:    string | null;
    placeholder?:  string;
    maxLength?:    number;
    inputMode?:    string;
    autoComplete?: string;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultTextInputOptions: Partial<TextInputOptions> = {
    tag:             "input",
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    border:          "var(--ts-ui-input-border)",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
};

/**
 * Base class for `<input>`- and `<textarea>`-backed text controls. Owns
 * the `<input>`-by-default `render()`, the type/name HTML attributes, the
 * text value cache, placeholder / maxLength / inputMode / autoComplete /
 * textAlign setters, the native `disabled` and `readonly` writes, and the
 * `getValue` / `setValue` aliases that satisfy the {@link AbstractInput}
 * value contract. Subclasses ({@link TextField}, {@link TextArea},
 * {@link PasswordField}, [`PickerInput`](/api/component/input/classes/PickerInput))
 * inherit the full surface.
 *
 * @category Components
 */
class TextInput<TOptions extends TextInputOptions = TextInputOptions>
    extends AbstractInput<string, TOptions>
{

    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            options,
            { ..._defaultTextInputOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        // Default sans-serif 12px font lives on the per-component CSS rule.
        // Queueing through `setElementCSSRules` at construction defers the
        // write until `applyStyle` flushes the buffer at render time, so we
        // no longer need a class-level `applyStyle` override.
        this.setElementCSSRules({
            fontFamily: "var(--ts-ui-font-family, sans-serif)",
            fontSize:   "var(--ts-ui-font-size, 12px)",
        });

        // Bridge the native `input` DOM event into AbstractInput's change /
        // binding listener fan-out so `addChangeListener` fires on every
        // keystroke for every text-derived control. Bindings already fire on
        // the same DOM event in subclass-specific `onInput` hooks; this opens
        // the second dispatch path for the unified listener API.
        Event.addListener(this, "input", () => this.notifyChange(this.getValue()));
    }

    /**
     * Applies a {@link TextInputOptions} bag, dispatching name, text,
     * alignment, and native HTML attributes (placeholder, maxLength,
     * inputMode, autoComplete) after inherited Component fields. The
     * `enabled` / `readOnly` flags are routed through the typed setters
     * because TextInput's `applyEnabled` / `applyReadOnly` are
     * cascade-safe (the cache-then-write pattern survives the element not
     * yet existing).
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.name !== undefined) {
            this.setName(opts.name);
        }

        if (opts.text !== undefined) {
            this.setText(opts.text);
        }

        if (opts.textAlign !== undefined) {
            this.setTextAlign(opts.textAlign);
        }

        if (opts.placeholder !== undefined) {
            this.setPlaceholder(opts.placeholder);
        }

        if (opts.readOnly !== undefined) {
            this.setReadOnly(opts.readOnly);
        }

        if (opts.enabled !== undefined) {
            this.setEnabled(opts.enabled);
        }

        if (opts.maxLength !== undefined) {
            this.setMaxLength(opts.maxLength);
        }

        if (opts.inputMode !== undefined) {
            this.setInputMode(opts.inputMode);
        }

        if (opts.autoComplete !== undefined) {
            this.setAutoComplete(opts.autoComplete);
        }

        return this;
    }

    /**
     * Registers a listener for one of this text input's events. `"input"`
     * is a typed shorthand over {@link Event.addListener} for the native
     * `input` DOM event (fired on every keystroke); `"change"` and
     * `"binding"` are the inherited {@link AbstractInput} value-change
     * events dispatched through the listener bag.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "input",   listener: Function): this;
    on(event: "change",  listener: (value: string) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "input" | "change" | "binding", listener: Function): this {
        if (event === "input") {
            Event.addListener(this, "input", listener);

            return this;
        }

        return super.on(event as "change", listener as (value: string) => void);
    }

    /**
     * Removes a previously registered listener. The exact callback
     * reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: "input" | "change" | "binding", listener: Function): this {
        if (event === "input") {
            Event.removeListener(this, "input", listener);

            return this;
        }

        return super.off(event, listener);
    }

    /**
     * Sets the HTML `type` attribute on the underlying input element.
     *
     * Typically called once at construction time by subclasses (e.g.
     * `PasswordField` sets `"password"`, `PickerInput` sets `"text"`). Most
     * consumers should not need this directly.
     *
     * @param value - The input type (e.g. "text", "password").
     *
     * @returns This component, for method chaining.
     */
    setType(value: string): this {
        this._options.type = value;
        this.setElementAttribute("type", value);

        return this;
    }

    /**
     * Returns the HTML `name` attribute value, or null if unset.
     *
     * @returns The name string, or null.
     */
    getName(): string | null {
        return this._options.name ?? null;
    }

    /**
     * Sets the HTML `name` attribute on the underlying input.
     *
     * @param value - The name used for form submission and radio grouping.
     *
     * @returns This component, for method chaining.
     */
    setName(value: string): this {
        this._options.name = value;
        this.setElementAttribute("name", value);

        return this;
    }

    /**
     * Removes the HTML `name` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearName(): this {
        if (this._options.name === undefined) {
            return this;
        }

        this._options.name = undefined;
        this.removeElementAttribute("name");

        return this;
    }

    /**
     * Returns the cached HTML `inputmode` attribute value, or null when unset.
     *
     * @returns The inputmode string, or null.
     */
    getInputMode(): string | null {
        return this._options.inputMode ?? null;
    }

    /**
     * Sets the HTML `inputmode` attribute on the underlying input. Typical
     * values are `"none"` (suppress on-screen keyboards), `"text"`,
     * `"numeric"`, `"decimal"`, `"tel"`, `"email"`, `"url"`, `"search"`.
     *
     * @param value - A valid `inputmode` value.
     *
     * @returns This component, for method chaining.
     */
    setInputMode(value: string): this {
        if (this._options.inputMode === value) {
            return this;
        }

        this._options.inputMode = value;

        // Behavioral HTML attribute the browser interprets natively. Routed
        // via `setElementAttribute` rather than `setDataAttribute` so the
        // attribute renders as `inputmode="..."` (not `data-inputmode="..."`).
        // The value lives on `_options.inputMode`; `init()` replays it from
        // there once the element exists.
        this.setElementAttribute("inputmode", value);

        return this;
    }

    /**
     * Removes the HTML `inputmode` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearInputMode(): this {
        if (this._options.inputMode === undefined) {
            return this;
        }

        this._options.inputMode = undefined;

        this.removeElementAttribute("inputmode");

        return this;
    }

    /**
     * Returns the cached HTML `autocomplete` attribute value, or null when unset.
     *
     * @returns The autocomplete string, or null.
     */
    getAutoComplete(): string | null {
        return this._options.autoComplete ?? null;
    }

    /**
     * Sets the HTML `autocomplete` attribute on the underlying input. Common
     * values are `"on"`, `"off"`, `"email"`, `"current-password"`, etc.
     *
     * @param value - A valid `autocomplete` token.
     *
     * @returns This component, for method chaining.
     */
    setAutoComplete(value: string): this {
        if (this._options.autoComplete === value) {
            return this;
        }

        this._options.autoComplete = value;

        this.setElementAttribute("autocomplete", value);

        return this;
    }

    /**
     * Removes the HTML `autocomplete` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearAutoComplete(): this {
        if (this._options.autoComplete === undefined) {
            return this;
        }

        this._options.autoComplete = undefined;

        this.removeElementAttribute("autocomplete");

        return this;
    }

    /**
     * Returns the offset from the top of the text input to its inner-text baseline.
     *
     * @returns The baseline offset in pixels.
     *
     * @remarks Adds the component's top border and CSS padding-top to the native
     * input's intrinsic baseline. `insets` is layout-side metadata used only
     * when sizing children; for a leaf input it does not visually push the
     * rendered element down, so it is excluded from the baseline. `padding` is
     * applied as real CSS padding (with `box-sizing: border-box`) and shifts
     * the inner text down. Bare text controls without inner text (e.g.
     * [`Checkbox`](/api/component/input/classes/Checkbox), the inner radio of
     * [`RadioButton`](/api/component/input/classes/RadioButton)) inherit the
     * default `null` baseline from [`Component`](/api/core/classes/Component)
     * and are treated as graphical elements by horizontal layouts.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(Util.measureInputBaseline());
    }

    /**
     * Returns the current CSS text-align value.
     *
     * @returns The CSS text-align string, or null if not set.
     */
    getTextAlign(): string | null {
        return this._options.textAlign ?? null;
    }

    /**
     * Sets the CSS text-align and updates the component's CSS rule.
     *
     * @param align - A CSS text-align value (e.g. "left", "center", "right"),
     *   or null to clear the rule.
     *
     * @returns This component, for method chaining.
     */
    setTextAlign(align: string | null): this {
        this._options.textAlign = align;

        this.setElementCSSRule("textAlign", align);

        return this;
    }

    /**
     * Clears the CSS text-align value, removing the rule.
     *
     * @returns This component, for method chaining.
     */
    clearTextAlign(): this {
        return this.setTextAlign(null);
    }

    /**
     * Returns the current text value.
     *
     * @returns The current text string.
     */
    getText(): string {
        return this._options.text ?? "";
    }

    /**
     * Sets the text value and updates the DOM element's value property.
     *
     * @param text - The new text value.
     *
     * @returns This component, for method chaining.
     */
    setText(text: string): this {
        this._options.text = text || "";

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.value = this._options.text;

        return this;
    }

    /**
     * Returns the current value (alias for {@link getText}, satisfies
     * {@link AbstractInput}'s [`Bindable`](/api/core/interfaces/Bindable) contract).
     *
     * @returns The current text string.
     */
    getValue(): string {
        return this.getText();
    }

    /**
     * Sets the current value (alias for {@link setText}, satisfies
     * {@link AbstractInput}'s [`Bindable`](/api/core/interfaces/Bindable) contract).
     *
     * @param value - The new text value.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: string): this {
        return this.setText(value);
    }

    /**
     * Returns the placeholder text shown when the input is empty, or null if none is set.
     *
     * @returns The placeholder string, or null.
     */
    getPlaceholder(): string | null {
        return this._options.placeholder ?? null;
    }

    /**
     * Sets the HTML `placeholder` attribute on the underlying input.
     *
     * @param value - The placeholder text.
     *
     * @returns This component, for method chaining.
     */
    setPlaceholder(value: string): this {
        this._options.placeholder = value;
        this.setElementAttribute("placeholder", value);

        return this;
    }

    /**
     * Removes the HTML `placeholder` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearPlaceholder(): this {
        if (this._options.placeholder === undefined) {
            return this;
        }

        this._options.placeholder = undefined;
        this.removeElementAttribute("placeholder");

        return this;
    }

    /**
     * Returns the configured maximum text length, or null if unset.
     *
     * @returns The maxlength value, or null.
     */
    getMaxLength(): number | null {
        return this._options.maxLength ?? null;
    }

    /**
     * Sets the HTML `maxlength` attribute on the underlying input.
     *
     * @param value - The maximum number of characters allowed.
     *
     * @returns This component, for method chaining.
     */
    setMaxLength(value: number): this {
        this._options.maxLength = value;
        this.setElementAttribute("maxlength", String(value));

        return this;
    }

    /**
     * Removes the HTML `maxlength` attribute from the underlying input.
     *
     * @returns This component, for method chaining.
     */
    clearMaxLength(): this {
        if (this._options.maxLength === undefined) {
            return this;
        }

        this._options.maxLength = undefined;
        this.removeElementAttribute("maxlength");

        return this;
    }

    /**
     * Selects a range of text in the input; defaults to selecting all if start/end are omitted.
     *
     * @param start - Optional. The start index of the selection. Defaults to 0.
     * @param end - Optional. The end index of the selection. Defaults to the text length + 1.
     *
     * @returns This component, for method chaining.
     */
    select(start?: number, end?: number): this {
        let element = this.getElement();
        if (!element) {
            return this;
        }

        if (!start || start < 0) {
            start = 0;
        }

        const text = this._options.text ?? "";
        if (!end || end > text.length) {
            end = text.length + 1;
        }

        element.setSelectionRange(start, end);

        return this;
    }

    /**
     * Reflects the enabled flag by writing the native `disabled` attribute.
     * Routes through {@link setDisabledAttribute} so the existing
     * `_disabledAttribute` cache stays the single source of truth for the
     * native attribute; the cache replays at render time when the element
     * doesn't yet exist.
     */
    protected applyEnabled(value: boolean): void {
        this.setDisabledAttribute(!value);
    }

    /**
     * Reflects the read-only flag by writing the native `readonly`
     * attribute. The cached `_options.readOnly` set by
     * {@link AbstractInput.setReadOnly} drives `init()`'s replay path
     * when the element doesn't yet exist.
     */
    protected applyReadOnly(value: boolean): void {
        if (value) {
            this.setElementAttribute("readonly", "");
        } else {
            this.removeElementAttribute("readonly");
        }
    }

    /**
     * Returns the DOM element cast to HTMLInputElement & HTMLTextAreaElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's element typed as both HTMLInputElement and HTMLTextAreaElement.
     */
    getElement(createIfMissing: boolean = false) {
        return super.getElement(createIfMissing) as HTMLInputElement & HTMLTextAreaElement;
    }

    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = (element || this.getElement()!) as HTMLInputElement & HTMLTextAreaElement;

        if (this._options.type !== undefined) {
            el.setAttribute("type", this._options.type);
        }

        if (this._options.name !== undefined) {
            el.setAttribute("name", this._options.name);
        }

        if (this._options.placeholder !== undefined) {
            el.setAttribute("placeholder", this._options.placeholder);
        }

        if (this._options.readOnly) {
            el.setAttribute("readonly", "");
        }

        if (this._options.maxLength !== undefined) {
            el.setAttribute("maxlength", String(this._options.maxLength));
        }

        if (this._options.inputMode !== undefined) {
            el.setAttribute("inputmode", this._options.inputMode);
        }

        if (this._options.autoComplete !== undefined) {
            el.setAttribute("autocomplete", this._options.autoComplete);
        }

        return this;
    }

    /**
     * Renders the input element and sets its initial value.
     *
     * @returns The created input element cast to HTMLInputElement & HTMLTextAreaElement.
     */
    protected render() {
        let element = super.render() as HTMLInputElement & HTMLTextAreaElement;

        element.value = this._options.text ?? "";

        return element;
    }
}

const TextInputCallable = callable(TextInput);
type TextInputCallable<TOptions extends TextInputOptions = TextInputOptions> = TextInput<TOptions>;
export {
    TextInput         as _TextInput,
    TextInputCallable as TextInput
};
