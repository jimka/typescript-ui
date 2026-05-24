// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { AnimatedDropdown } from "~/core/AnimatedDropdown.js";
import { PickerInput } from "~/component/input/PickerInput.js";
import { PickerButton } from "~/component/input/PickerButton.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { BorderOptions } from "~/primitive/Border.js";
import { ThemeManager } from "~/core/Theme.js";
import { Util } from "~/core/Util.js";

// Width of the picker glyph button in pixels. Matches the prior `display: flex`
// + 24px caret column the framework used before the per-field doLayout
// override; sized to the calendar/clock glyph's intrinsic 16px box plus 4px
// padding on each side so the icon centres without crowding the input edge.
const PICKER_BUTTON_WIDTH_PX = 24;

/**
 * Construction-time options for {@link AbstractPickerField}. The `value`
 * field is supplied by each concrete subclass's options interface
 * (DateFieldOptions / TimeFieldOptions / DateTimeFieldOptions) so its type
 * matches the subclass's `TValue`.
 *
 * @category Components
 */
export interface AbstractPickerFieldOptions extends AbstractInputOptions {
    /** When false, the dropdown opens/closes instantly. Default: true. */
    dropdownAnimated?: boolean;
}

/**
 * Abstract base for the three picker fields ({@link DateField},
 * {@link TimeField}, {@link DateTimeField}). Owns the shared chrome — a
 * [`PickerInput`](/api/component/input/classes/PickerInput) on the left, a
 * [`PickerButton`](/api/component/input/classes/PickerButton) on the right,
 * the 24-px layout, the dropdown lifecycle (open/close/animated), the
 * invalid-border swap, the viewport-pointerdown dismissal, and the
 * ArrowDown/Escape keyboard contract. Subclasses provide only
 * format/parse, dropdown construction + anchoring, the dropdown's
 * selection callback, the preferred width (160 / 140 / 200), and the
 * default border.
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated;
 * concrete subclasses do the callable wrapping themselves.
 *
 * @category Components
 */
abstract class AbstractPickerField<
    TValue,
    TDropdown extends AnimatedDropdown,
    TOptions extends AbstractPickerFieldOptions = AbstractPickerFieldOptions
>
    extends AbstractInput<TValue | null, TOptions>
{
    protected _input:    PickerInput;
    protected _button:   PickerButton;
    protected _dropdown: TDropdown | null = null;
    protected _value:    TValue | null    = null;
    protected _invalid:  boolean          = false;

    // The viewport listener is added and removed dynamically (when the
    // dropdown opens / closes), so it needs a stable reference. The other
    // listeners are registered once in the constructor and never removed,
    // so they use inline `() => this.handler()` delegates to named methods.
    protected readonly _onViewportPointerDown: (e: PointerEvent) => void;

    /**
     * @param options - Caller-supplied options bag.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; concrete subclasses forward their
     *   `_defaultXxxFieldOptions` constant here.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, subclassDefaults);

        this._input = new PickerInput();
        this._input.setType("text");
        this._input.setInputMode("none");
        this._input.setAutoComplete("off");
        this._input.setPadding(new Insets(0, 3, 0, 3));

        // Subclasses add the per-field glyph (calendar / clock / calendar) to
        // `_button` after `super()` returns; `PickerButton.doLayout` then
        // centers it within the button's inner rect.
        this._button = new PickerButton();

        this.addComponent(this._input);
        this.addComponent(this._button);

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        Event.addListener(this._input,  "input",       ()                 => this.onInput());
        Event.addListener(this._input,  "blur",        ()                 => this.onBlur());
        Event.addListener(this._input,  "keydown",     (e: KeyboardEvent) => this.onKeyDown(e));
        Event.addListener(this._button, "click",       ()                 => this.onButtonClick());
        // Suppress focus loss when clicking the button (it would blur the input).
        Event.addListener(this._button, "pointerdown", (e: PointerEvent)  => this.onButtonPointerDown(e));

        this._onViewportPointerDown = (e: PointerEvent) => this.onViewportPointerDown(e);
    }

    /**
     * Subclass hook: format a non-null value for display in the text input.
     *
     * @param value - The value to format.
     * @returns The display string.
     */
    protected abstract formatValue(value: TValue): string;

    /**
     * Subclass hook: parse the typed text into a value. Return `null` on
     * parse failure to drive the invalid-border state.
     *
     * @param raw - The raw text typed into the input.
     * @returns The parsed value, or `null` on parse failure.
     */
    protected abstract parseRaw(raw: string): TValue | null;

    /**
     * Subclass hook: lazily construct the picker dropdown. Runs once per
     * field instance on first open.
     *
     * @returns The constructed dropdown.
     */
    protected abstract createDropdown(): TDropdown;

    /**
     * Subclass hook: anchor and show the dropdown with the field's current
     * value. Each concrete dropdown's `showAt(anchorEl, value)` accepts a
     * subclass-specific `value` type, so the dispatch lives here rather
     * than directly in `openDropdown`.
     *
     * @param dropdown - The dropdown instance to show.
     * @param anchorEl - The element to anchor the panel to.
     * @param value - The current field value (or null when empty).
     */
    protected abstract showDropdown(dropdown: TDropdown, anchorEl: HTMLElement, value: TValue | null): void;

    /**
     * Subclass hook: called when the user selects a value from the dropdown.
     * Implementations typically call `this.setValue(value)` and
     * `this.closeDropdown()`.
     *
     * @param value - The value chosen in the dropdown.
     */
    protected abstract onDropdownSelected(value: TValue): void;

    /**
     * Subclass hook: returns the field's preferred width in pixels
     * (DateField 160, TimeField 140, DateTimeField 200).
     *
     * @returns The preferred width in pixels.
     */
    protected abstract getPreferredWidth(): number;

    /**
     * Subclass hook: returns the default border restored when the
     * invalid-border state clears.
     *
     * @returns The default border options.
     */
    protected abstract getDefaultBorder(): BorderOptions;

    /**
     * Applies an {@link AbstractPickerFieldOptions} bag. The inherited
     * `enabled` / `readOnly` flags are cached on `_options` by
     * {@link AbstractInput} and dispatched from the concrete subclass's
     * constructor tail once `_input` exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.dropdownAnimated !== undefined) {
            this.setDropdownAnimated(opts.dropdownAnimated);
        }

        return this;
    }

    /**
     * Lays out the input flush left and the button flush right at the
     * fixed 24-px column width.
     */
    doLayout(): this {
        super.doLayout();

        const w = this.getWidth();
        const h = this.getHeight();

        this._input.setX(0);
        this._input.setY(0);
        this._input.setWidth(Math.max(0, w - PICKER_BUTTON_WIDTH_PX));
        this._input.setHeight(h);

        this._button.setX(w - PICKER_BUTTON_WIDTH_PX);
        this._button.setY(0);
        this._button.setWidth(PICKER_BUTTON_WIDTH_PX);
        this._button.setHeight(h);

        return this;
    }

    /**
     * Recalculates preferred and maximum height from the native input's
     * measured size; preferred width comes from the subclass-supplied
     * {@link getPreferredWidth}.
     */
    protected updateHeight(): void {
        const h = Util.measureInputHeight();

        this.setPreferredSize(this.getPreferredWidth(), h);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, h);
    }

    /**
     * Sets the field value from a parsed value and updates the DOM element.
     *
     * @param value - The value to display, or null to clear the field.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: TValue | null): this {
        this._value = value;
        // Optional chain because the cascade-time `applyOptions` may dispatch
        // this from inside `super()` before `_input` is constructed; the
        // concrete subclass's constructor tail re-runs the assignment once
        // `_input` exists.
        this._input?.setText(value ? this.formatValue(value) : "");

        return this;
    }

    /**
     * Returns the currently selected value, or null if the field is empty.
     *
     * @returns The selected value, or null.
     */
    getValue(): TValue | null {
        return this._value;
    }

    /**
     * Returns the offset from the top of the picker field to its inner-text
     * baseline.
     *
     * @returns The baseline offset in pixels.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this._input.getBaseline());
    }

    /**
     * Enables or disables the fade animation on the dropdown.
     *
     * @param value - true to fade, false for instant open/close.
     *
     * @returns This component, for method chaining.
     */
    setDropdownAnimated(value: boolean): this {
        this._options.dropdownAnimated = value;

        if (this._dropdown) {
            this._dropdown.setAnimated(value);
        }

        return this;
    }

    /**
     * Returns whether the dropdown fade is enabled.
     *
     * @returns true when the dropdown fades; false when it opens/closes instantly.
     */
    isDropdownAnimated(): boolean {
        return this._options.dropdownAnimated ?? true;
    }

    /**
     * Reflects the enabled flag by forwarding to the inner input's native
     * `disabled` attribute write — the same path the per-field
     * `applyOptions` blocks used before this base existed.
     */
    protected applyEnabled(value: boolean): void {
        this._input.setEnabled(value);
    }

    /**
     * Reflects the read-only flag by forwarding to the inner input's native
     * `readonly` attribute write.
     */
    protected applyReadOnly(value: boolean): void {
        this._input.setReadOnly(value);
    }

    /**
     * Toggles the dropdown when the glyph button is clicked. Re-focuses the
     * input first so the caret stays in the field while the picker is open.
     */
    protected onButtonClick(): void {
        if (this._dropdown?.isOpen()) {
            this.closeDropdown();
        } else {
            this._input.focus();
            this.openDropdown();
        }
    }

    /**
     * Suppresses focus loss on the input when the button is pointed at; the
     * subsequent `click` handler does the open/close work.
     *
     * @param e - The pointerdown event.
     */
    protected onButtonPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Viewport-level pointerdown handler: closes the dropdown when the click
     * lands outside both the field and the dropdown panel. Ignores clicks
     * landing inside any nested overlay spawned from within the dropdown
     * (e.g. the ComboBox dropdowns in the DateTimePicker's time row).
     *
     * @param e - The pointerdown event from the viewport.
     */
    protected onViewportPointerDown(e: PointerEvent): void {
        const target = e.target as Node;
        const dropEl = this._dropdown?.getElement();
        if (dropEl?.contains(target)) {
            return;
        }
        if (this._dropdown?.isClickOnTopmostOverlay(target)) {
            return;
        }
        if (this.getElement()?.contains(target)) {
            return;
        }
        this.closeDropdown();
    }

    /**
     * Syncs the internal value from the typed text on every input event and
     * toggles the invalid-border state based on whether the typed text
     * parses. Notifies change/binding listeners with the new value.
     */
    protected onInput(): void {
        const raw = this._input.getText();

        if (!raw) {
            this._value = null;
            this.setInvalid(false);
            this.notifyChange(null);

            return;
        }

        const parsed = this.parseRaw(raw);
        if (parsed !== null) {
            this._value = parsed;
            this.setInvalid(false);
            this.notifyChange(parsed);
        } else {
            this.setInvalid(true);
        }
    }

    /**
     * Clears non-empty unparseable text when the input loses focus, so the
     * field doesn't carry an invalid string across interactions.
     */
    protected onBlur(): void {
        if (!this._invalid) {
            return;
        }

        this._input.setText("");
        this._value = null;
        this.setInvalid(false);
    }

    /**
     * Toggles the red validation-error border on the field root.
     *
     * @param invalid - True to show the red border, false to restore the default.
     */
    protected setInvalid(invalid: boolean): void {
        if (this._invalid === invalid) {
            return;
        }
        this._invalid = invalid;

        if (invalid) {
            this.setBorder({
                style: BorderStyle.SOLID,
                width: 1,
                color: "var(--ts-ui-validation-error-border)",
            });
        } else {
            this.setBorder(this.getDefaultBorder());
        }
    }

    /**
     * Keyboard shortcuts: ArrowDown opens the dropdown; Escape closes it.
     *
     * @param e - The keyboard event.
     */
    protected onKeyDown(e: KeyboardEvent): void {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            this.openDropdown();
        } else if (e.key === "Escape") {
            this.closeDropdown();
        }
    }

    /**
     * Returns or lazily creates the picker dropdown instance.
     *
     * @returns The owned dropdown instance.
     */
    protected ensureDropdown(): TDropdown {
        if (!this._dropdown) {
            this._dropdown = this.createDropdown();
            const animated = this._options.dropdownAnimated;
            if (animated !== undefined) {
                this._dropdown.setAnimated(animated);
            }
        }

        return this._dropdown;
    }

    /**
     * Opens the dropdown anchored to the input. The concrete subclass's
     * {@link showDropdown} hook performs the actual `dropdown.showAt(...)`
     * call so the value type matches the dropdown's signature.
     */
    protected openDropdown(): void {
        const dropdown = this.ensureDropdown();
        if (dropdown.isOpen()) {
            return;
        }

        this.showDropdown(dropdown, this._input.getElement(true), this._value);
        Event.addViewportListener(this, "pointerdown", this._onViewportPointerDown);
    }

    /**
     * Closes the dropdown if open.
     */
    protected closeDropdown(): void {
        if (this._dropdown && this._dropdown.isOpen()) {
            Event.removeViewportListener(this, "pointerdown", this._onViewportPointerDown);
            this._dropdown.hideAnimated();
        }
    }
}

export { AbstractPickerField };
