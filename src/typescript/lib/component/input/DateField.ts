// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Util } from "~/core/Util.js";
import { Event } from "~/core/Event.js";
import { CSS } from "~/core/CSS.js";
import { Insets } from "~/primitive/Insets.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Position } from "~/primitive/Position.js";
import { Bindable } from "~/core/Bindable.js";
import { ThemeManager } from "~/core/Theme.js";
import { Glyph } from "~/component/display/Glyph.js";
import { calendar } from "~/glyphs/solid/calendar.js";
import { DatePickerDropdown } from "~/component/input/DatePickerDropdown.js";
import { callable } from "~/core/Callable.js";

Glyph.register(calendar);

/**
 * Internal Input subclass that exposes typed setters for the input attributes
 * the picker fields need. Lives here (not in `Input.ts`) because these
 * setters are picker-specific and would otherwise pollute the public surface
 * of every `Input` consumer.
 */
class PickerInput extends TextInput<TextInputOptions> {

    constructor() {
        super();

        Event.addListener(this, "input", () => this.syncTextFromDom());
    }

    /**
     * Mirrors `TextField`'s sync hook: pulls the live DOM value into the
     * inherited cached text on every keystroke so callers can read it through
     * `getText()` instead of `element.value`.
     */
    private syncTextFromDom(): void {
        const el = this.getElement();
        this.setText(el?.value ?? "");
    }
}

// `align-items` has no typed setter on Component, so the picker buttons' inline
// flex-centering lives on a shared class rule. The IIFE registers once; later
// imports of files that define their own `PickerButton` class get null back
// from `createClassRule` and continue silently. All call sites use identical
// styling so this is safe.
(() => {
    const rule = CSS.createClassRule("PickerButton");
    if (rule) {
        rule.style.setProperty("align-items", "center");
    }
})();

/**
 * Internal `<button>` Component used by {@link DateField}, {@link TimeField},
 * and {@link DateTimeField} as the glyph-bearing trigger to the right of the
 * input. Defines the static styling via typed setters plus the
 * `.PickerButton` class rule for `align-items`.
 */
class PickerButton extends Component {
    constructor() {
        super({ tag: "button" });

        this.setBorder({ style: BorderStyle.NONE, width: 0, color: "transparent" });
        this.setBackgroundColor("transparent");
        this.setCursor("pointer");
        this.setPadding(new Insets(0, 4, 0, 4));
        this.setDisplay("flex");
    }
}

/**
 * Construction-time options for {@link DateField}.
 *
 * @category Components
 */
export interface DateFieldOptions extends ComponentOptions {
    value?:             Date | null;
    enabled?:           boolean;
    /** When false, the dropdown opens/closes instantly. Default: true. */
    dropdownAnimated?:  boolean;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 */
const _defaultDateFieldOptions: Partial<DateFieldOptions> = {
    cursor:          "text",
    padding:         new Insets(3, 3, 3, 3),
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
    border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
};

/**
 * A date-picker input component.
 *
 * Renders a text input with a calendar-glyph button on the right; clicking
 * either opens a [`DatePickerDropdown`](/api/component/input/classes/DatePickerDropdown)
 * panel that fades in via the shared
 * [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown) lifecycle. The
 * native browser date-picker is no longer used.
 *
 * Implements {@link Bindable} so it can participate in a
 * [`Binding`](/api/core/classes/Binding) directly. Returns `null` from
 * `getValue` when the field is empty.
 *
 * @category Components
 */
class DateField extends Component<DateFieldOptions> implements Bindable<Date | null> {

    private _input:    PickerInput;
    private _button:   PickerButton;
    private _dropdown: DatePickerDropdown | null = null;
    private _value:    Date | null = null;
    private _invalid:  boolean = false;
    // The viewport listener is added and removed dynamically (when the
    // dropdown opens / closes), so it needs a stable reference. The other
    // listeners are registered once in the constructor and never removed,
    // so they use inline `() => this.handler()` delegates to named methods.
    private readonly _onViewportPointerDown: (e: PointerEvent) => void;

    constructor(options?: DateFieldOptions) {
        super({ ..._defaultDateFieldOptions, ...(options ?? {}) });

        this._input = new PickerInput();
        this._input.setType("text");
        this._input.setInputMode("none");
        this._input.setAutoComplete("off");
        this._input.setPadding(new Insets(0, 3, 0, 3));

        this._button = new PickerButton();

        // Glyph runs in static position so the button's `display: flex;
        // align-items: center` actually centers it (flex skips abs-positioned
        // children). `setPointerEvents("none")` lets clicks pass through to
        // the button.
        const glyph = new Glyph("calendar", { position: Position.STATIC });
        glyph.setPointerEvents("none");
        this._button.addComponent(glyph);

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

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link DateFieldOptions} bag, dispatching the initial value and
     * enabled/disabled state after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DateFieldOptions): this {
        super.applyOptions(options);

        if (options.value !== undefined) {
            this.setValue(options.value);
        }

        if (options.enabled !== undefined) {
            this._input.setDisabledAttribute(!options.enabled);
        }

        if (options.dropdownAnimated !== undefined) {
            this.setDropdownAnimated(options.dropdownAnimated);
        }

        return this;
    }

    /**
     * Lays out the input flush left and the button flush right.
     */
    doLayout(): this {
        super.doLayout();

        const w  = this.getWidth();
        const h  = this.getHeight();
        const bw = 24;

        this._input.setX(0);
        this._input.setY(0);
        this._input.setWidth(Math.max(0, w - bw));
        this._input.setHeight(h);

        this._button.setX(w - bw);
        this._button.setY(0);
        this._button.setWidth(bw);
        this._button.setHeight(h);

        return this;
    }

    /**
     * Recalculates preferred and maximum height from the native input's measured size.
     */
    private updateHeight(): void {
        const h = Util.measureInputHeight();

        this.setPreferredSize(160, h);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, h);
    }

    /**
     * Toggles the dropdown when the calendar button is clicked. Re-focuses the
     * input first so the caret stays in the field while the picker is open.
     */
    private onButtonClick(): void {
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
    private onButtonPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Viewport-level pointerdown handler: closes the dropdown when the click
     * lands outside both the field and the dropdown panel.
     *
     * @param e - The pointerdown event from the viewport.
     */
    private onViewportPointerDown(e: PointerEvent): void {
        const target = e.target as Node;
        const dropEl = this._dropdown?.getElement();
        if (dropEl?.contains(target)) {
            return;
        }
        if (this.getElement()?.contains(target)) {
            return;
        }
        this.closeDropdown();
    }

    /**
     * Syncs the internal Date value from the DOM element on every input event
     * and toggles the invalid-border state based on whether the typed text
     * parses as a date.
     */
    private onInput(): void {
        const raw = this._input.getText();

        if (!raw) {
            this._value = null;
            this.setInvalid(false);
            return;
        }

        // Accept "YYYY-MM-DD" — append local midnight to avoid UTC offset shifting the day.
        const d = new Date(raw + "T00:00:00");
        if (!isNaN(d.getTime())) {
            this._value = d;
            this.setInvalid(false);
        } else {
            this.setInvalid(true);
        }
    }

    /**
     * Clears non-empty unparseable text when the input loses focus, so the
     * field doesn't carry an invalid string across interactions.
     */
    private onBlur(): void {
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
    private setInvalid(invalid: boolean): void {
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
            this.setBorder(_defaultDateFieldOptions.border!);
        }
    }

    /**
     * Keyboard shortcuts: ArrowDown opens the dropdown; Escape closes it.
     *
     * @param e - The keyboard event.
     */
    private onKeyDown(e: KeyboardEvent): void {
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
    private ensureDropdown(): DatePickerDropdown {
        if (!this._dropdown) {
            this._dropdown = new DatePickerDropdown(date => this.onDateSelected(date));
            const animated = this._options.dropdownAnimated;
            if (animated !== undefined) {
                this._dropdown.setAnimated(animated);
            }
        }

        return this._dropdown;
    }

    /**
     * Opens the dropdown anchored to the input.
     */
    private openDropdown(): void {
        const dropdown = this.ensureDropdown();
        if (dropdown.isOpen()) {
            return;
        }

        dropdown.showAt(this._input.getElement(true), this._value);
        Event.addViewportListener(this, "pointerdown", this._onViewportPointerDown);
    }

    /**
     * Closes the dropdown if open.
     */
    private closeDropdown(): void {
        if (this._dropdown && this._dropdown.isOpen()) {
            Event.removeViewportListener(this, "pointerdown", this._onViewportPointerDown);
            this._dropdown.hideAnimated();
        }
    }

    /**
     * Called when the user selects a day in the dropdown.
     *
     * @param date - The chosen date.
     */
    private onDateSelected(date: Date): void {
        this.setValue(date);
        this.closeDropdown();
        this._input.focus();
        Event.fireEvent(this._input, "input");
    }

    /**
     * Registers a listener for the 'input' event, fired whenever the date changes.
     *
     * @param listener - The callback to invoke on each input event.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this._input, "input", listener);

        return this;
    }

    /**
     * Sets the field value from a Date and updates the DOM element.
     *
     * @param value - The Date to display, or null to clear the field.
     */
    setValue(value: Date | null): this {
        this._value = value;
        // Optional chain because `applyOptions` may dispatch this from inside
        // `super()` before `_input` is constructed; the explicit
        // `applyOptions(options)` call at the end of the constructor re-runs
        // the assignment once `_input` exists.
        this._input?.setText(value ? this.formatDate(value) : "");

        return this;
    }

    /**
     * Returns the currently selected Date, or null if the field is empty.
     *
     * @returns The selected Date, or null.
     */
    getValue(): Date | null {
        return this._value;
    }

    /**
     * Registers a listener that fires on each user-driven date change.
     *
     * @param fn - The callback to invoke on change.
     */
    addBindingListener(fn: () => void): void {
        this.addActionListener(fn);
    }

    /**
     * Formats a Date as a YYYY-MM-DD string for display in the text input.
     *
     * @param date - The Date to format.
     * @returns A "YYYY-MM-DD" string.
     */
    private formatDate(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");

        return `${y}-${m}-${d}`;
    }

    /**
     * Returns the offset from the top of the date field to its inner-text baseline.
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
}

const DateFieldCallable = callable(DateField);
type DateFieldCallable = DateField;
export {
    DateField         as _DateField,
    DateFieldCallable as DateField
};
