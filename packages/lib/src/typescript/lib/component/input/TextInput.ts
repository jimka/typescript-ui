// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { ComponentOptions } from "~/core/Component.js";
import type { StyleBag, StyleTrait, TextStyleBag } from "~/core/ClassStyleRules.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";
import { INPUT_CHROME_TRAIT } from "~/core/StyleTraits.js";

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
    type?:         string;
    text?:         string;
    textAlign?:    string | null;
    placeholder?:  string;
    maxLength?:    number;
    inputMode?:    string;
    autoComplete?: string;
    /**
     * Construction-time listener bag — the declarative form of `on()`. Adds the
     * text input's `action` shorthand to the inherited `change` / `binding`.
     */
    listeners?: {
        action?:  () => void;
        change?:  (value: string) => void;
        binding?: () => void;
    };
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultTextInputOptions: Partial<TextInputOptions> = {
    tag:             "input",
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
};

// The font baseline every text control shares. `line-height` renders the
// input's single line at the same px line box every text control measures
// against (`Util.lineHeightPx`), so the input doesn't inherit the UA
// `line-height: normal` and its baseline coincides with a `Text`/`Label` in
// the same row.
const TEXT_INPUT_FONT: TextStyleBag = {
    fontFamily: "var(--ts-ui-font-family, sans-serif)",
    fontSize:   "var(--ts-ui-font-size, 14px)",
    lineHeight: "calc(1em + var(--ts-ui-line-padding, 2px))",
};

// `_defaultTextInputOptions` is a `Partial<TextInputOptions>` and cannot carry
// a `font` key; the class tier's own bag adds it here, so the CSS rule and the
// getters read one source.
const _textInputClassStyleDefaults: StyleBag = {
    ..._defaultTextInputOptions,
    font: TEXT_INPUT_FONT,
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

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md.
    protected static readonly ownClassStyleDefaults: StyleBag = _textInputClassStyleDefaults;
    // Shares the border/borderRadius pair with AbstractPickerField, ComboBox,
    // and FieldSet via one generated CSS rule — see
    // plans/cross-class-style-groups.md.
    protected static readonly ownStyleTraits: readonly StyleTrait[] = [INPUT_CHROME_TRAIT];

    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            options,
            { ..._defaultTextInputOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        // Single native `input` listener for every text-derived control: it
        // syncs the cached text from the live DOM, then fans the fresh value
        // out through AbstractInput's change / binding listeners. Folding the
        // sync and the notify into one base listener (rather than a per-subclass
        // second `input` hook wired after this one) guarantees the cache is
        // current before `on("change")` reads it — the fix for the
        // one-keystroke-behind value bug.
        Event.addListener(this, "input", this.onInput);

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
    }

    /**
     * Supplies the class-level font defaults `ClassStyleRules.ts` cannot see in
     * `_defaultOptions` — `TextInputOptions` has no `font` field. Prefers
     * `ownClassStyleDefaults` off `this.constructor` (virtual dispatch) so a
     * subclass whose own bag is a complete font bag is reflected here, and falls
     * back to this class's own bag otherwise. Mirrors `Text.getClassStyleDefaults`.
     */
    protected getClassStyleDefaults(): StyleBag {
        return {
            ...super.getClassStyleDefaults(),
            font: (this.constructor as typeof TextInput).ownClassStyleDefaults.font ?? TEXT_INPUT_FONT,
        };
    }

    /**
     * Native `input` handler: syncs the cached text from the live DOM element,
     * then notifies the change / binding listeners with the fresh value.
     *
     * @remarks Registered once by the base constructor for every subclass, so
     * `getText()` and the `on("change")` fan-out always observe the just-typed
     * value on the same event. Subclasses must not wire a second `input`
     * listener.
     */
    protected onInput(): void {
        const element = this.getElement();

        this.setText(element ? DOM.source.getValue(element) : "");
        this.notifyChange(this.getValue());
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

        if (options.text !== undefined) {
            this.setText(options.text);
        }

        if (options.textAlign !== undefined) {
            this.setTextAlign(options.textAlign);
        }

        if (options.placeholder !== undefined) {
            this.setPlaceholder(options.placeholder);
        }

        if (options.readOnly !== undefined) {
            this.setReadOnly(options.readOnly);
        }

        if (options.enabled !== undefined) {
            this.setEnabled(options.enabled);
        }

        if (options.maxLength !== undefined) {
            this.setMaxLength(options.maxLength);
        }

        if (options.inputMode !== undefined) {
            this.setInputMode(options.inputMode);
        }

        if (options.autoComplete !== undefined) {
            this.setAutoComplete(options.autoComplete);
        }

        return this;
    }

    /**
     * Registers a listener for one of this text input's events. `"action"`
     * is a typed semantic shorthand over {@link Event.addListener} for the
     * native `input` DOM event (fired on every keystroke); `"keydown"` is the
     * same shorthand for the native `keydown` DOM event (so a consumer can wire
     * keyboard shortcuts without reaching for the raw {@link Event} API);
     * `"change"` and `"binding"` are the inherited {@link AbstractInput}
     * value-change events dispatched through the listener bag.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "action",  listener: Event.Listener): this;
    on(event: "keydown", listener: (e: KeyboardEvent) => Event.ListenerResult): this;
    on(event: "change",  listener: (value: string) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "action" | "keydown" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "input", listener as Event.Listener);

            return this;
        }

        if (event === "keydown") {
            Event.addListener(this, "keydown", listener as Event.Listener);

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
    off(event: "action" | "keydown" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.removeListener(this, "input", listener as Event.Listener);

            return this;
        }

        if (event === "keydown") {
            Event.removeListener(this, "keydown", listener as Event.Listener);

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
     * Sets the component's name — see
     * [`Component.setName`](/api/core/classes/Component#setname) for the shared
     * intrinsic-name semantics — and, because this is a form control, mirrors it
     * to the underlying element's HTML `name` attribute (used for form
     * submission and radio grouping). Passing `null` clears both the stored name
     * and the attribute. The intrinsic name is inherited (no separate `name`
     * state); this override only adds the DOM reflection.
     *
     * @param name - The name, or `null` to clear it.
     *
     * @returns This component, for method chaining.
     */
    setName(name: string | null): this {
        super.setName(name);

        if (name == null) {
            this.removeElementAttribute("name");
        } else {
            this.setElementAttribute("name", name);
        }

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
     * @remarks Adds the component's top border and CSS padding-top to the
     * unified content-relative baseline ([`Util.measureTextBaseline`](/api/core/namespaces/Util/functions/measureTextBaseline)).
     * `insets` is layout-side metadata used only
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
        return this.wrapInnerBaseline(Util.measureTextBaseline());
    }

    /**
     * Returns the current CSS text-align value.
     *
     * @returns The CSS text-align string, or `null` when neither this instance
     *   nor its class declares one.
     */
    getTextAlign(): string | null {
        return this.resolveFontValue("textAlign");
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
        this.writeStyle({ font: { textAlign: align } });

        return this;
    }

    /**
     * Clears the CSS text-align value, reverting to the class-tier default
     * when this class declares one.
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

        DOM.sink.setValue(element, this._options.text);

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

        DOM.sink.setSelectionRange(element, start, end);

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
     * Returns the DOM element handle.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's element handle.
     */
    getElement(createIfMissing: boolean = false): Handle | undefined {
        return super.getElement(createIfMissing);
    }

    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement()!;

        if (this._options.type !== undefined) {
            DOM.sink.apply(el, { setAttr: { type: this._options.type } });
        }

        if (this._options.name != null) {
            DOM.sink.apply(el, { setAttr: { name: this._options.name } });
        }

        if (this._options.placeholder !== undefined) {
            DOM.sink.apply(el, { setAttr: { placeholder: this._options.placeholder } });
        }

        if (this._options.readOnly) {
            DOM.sink.apply(el, { setAttr: { readonly: "" } });
        }

        if (this._options.maxLength !== undefined) {
            DOM.sink.apply(el, { setAttr: { maxlength: String(this._options.maxLength) } });
        }

        if (this._options.inputMode !== undefined) {
            DOM.sink.apply(el, { setAttr: { inputmode: this._options.inputMode } });
        }

        if (this._options.autoComplete !== undefined) {
            DOM.sink.apply(el, { setAttr: { autocomplete: this._options.autoComplete } });
        }

        return this;
    }

    /**
     * Renders the input element and sets its initial value.
     *
     * @returns The created input element handle.
     */
    protected render(): Handle {
        let element = super.render();

        DOM.sink.setValue(element, this._options.text ?? "");

        return element;
    }
}

const TextInputCallable = callable(TextInput);
type TextInputCallable<TOptions extends TextInputOptions = TextInputOptions> = TextInput<TOptions>;
export {
    TextInput         as _TextInput,
    TextInputCallable as TextInput
};
