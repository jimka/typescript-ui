// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { AnimatedDropdown } from "~/core/AnimatedDropdown.js";
import type { StyleBag, StyleTrait } from "~/core/ClassStyleRules.js";
import type { Handle } from "~/core/DOM.js";
import { PickerInput } from "~/component/input/PickerInput.js";
import { PickerButton } from "~/component/input/PickerButton.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
import { registerFocusWithinRing } from "~/component/input/focusRing.js";
import { Util } from "~/core/Util.js";
import { INPUT_CHROME_TRAIT } from "~/core/StyleTraits.js";

// Focus ring highlighting the picker root whenever the inner PickerInput is
// focused. The three concrete selectors share the one helper-registered overlay
// rule (the helper appends the focus pseudo-element to each).
registerFocusWithinRing(".DateField, .TimeField, .DateTimeField");

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
 * User-overridable visual defaults shared by every concrete picker field
 * (DateField / TimeField / DateTimeField); merged in the base constructor. The
 * three fields' defaults were byte-identical, so they live here once.
 */
const _defaultPickerFieldOptions: Partial<AbstractPickerFieldOptions> = {
    cursor:          "text",
    padding:         new Insets(3, 3, 3, 3),
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
};

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
    TDropdown extends AnimatedDropdown & { showAt(anchorEl: Handle, value: TValue | null): unknown },
    TOptions extends AbstractPickerFieldOptions = AbstractPickerFieldOptions
>
    extends AbstractInput<TValue | null, TOptions>
{
    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultPickerFieldOptions;
    // Shares the border/borderRadius pair with TextInput, ComboBox, and
    // FieldSet via one generated CSS rule — see plans/cross-class-style-groups.md.
    protected static readonly ownStyleTraits: readonly StyleTrait[] = [INPUT_CHROME_TRAIT];

    protected _input:    PickerInput;
    protected _button:   PickerButton;
    protected _dropdown: TDropdown | null = null;
    protected _value:    TValue | null    = null;
    protected _invalid:  boolean          = false;
    // Hoisted here so it is declared once; only TimeField / DateTimeField
    // read it (from their constructor body). Harmless-and-unused on DateField.
    protected _showSeconds: boolean       = false;

    /**
     * @param options - Caller-supplied options bag.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: AbstractPickerFieldOptions, subclassDefaults?: Partial<AbstractPickerFieldOptions>);
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            options,
            { ..._defaultPickerFieldOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

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
        this.subscribeTheme(() => this.updateHeight());

        Event.addListener(this._input,  "input",       ()                 => this.onInput());
        Event.addListener(this._input,  "blur",        ()                 => this.onBlur());
        Event.addListener(this._input,  "keydown",     (e: KeyboardEvent) => this.onKeyDown(e));

        // Route button events through the named-method surface — never raw
        // `Event.addListener(button, …)` per ARCHITECTURE.md's "component
        // owns its event surface" rule.
        this._button.on("action", ()                => this.onButtonClick());
        // Suppress focus loss when clicking the button (it would blur the input).
        this._button.addPointerDownListener((e: PointerEvent) => this.onButtonPointerDown(e));

        // Late-built dispatch: `applyOptions` cached enabled / readOnly onto
        // `_options` during `super()` before `_input` existed. Dispatch them now
        // that `_input` is built. The per-subclass `value` re-dispatch stays in
        // each subclass because it reads the subclass-typed `_options.value`.
        if (this._options.enabled  !== undefined) this.applyEnabled(this._options.enabled);
        if (this._options.readOnly !== undefined) this.applyReadOnly(this._options.readOnly);
    }

    /**
     * Disposes the dropdown (if built), then runs the inherited teardown.
     * `_dropdown` is a `Position.FIXED` overlay (see ARCHITECTURE.md's
     * carve-out for `AnimatedDropdown`), built lazily by {@link createDropdown}
     * and never a registered child, so `super.destructor()`'s recursion
     * cannot reach it on its own.
     */
    protected destructor(): void {
        this._dropdown?.dispose();

        super.destructor();
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
     * Returns the default border restored when the invalid-border state clears
     * — the shared `--ts-ui-input-border` token, identical across all three
     * picker fields. The value is passed straight to {@link Component.setBorder}.
     *
     * @returns The default border shorthand string.
     *
     * @remarks Reads {@link INPUT_CHROME_TRAIT}'s declared border directly
     * rather than `_defaultPickerFieldOptions.border` — the border/borderRadius
     * pair moved onto the shared trait (see plans/cross-class-style-groups.md),
     * so `_defaultPickerFieldOptions` no longer carries it and this method
     * bypasses the options-merge pipeline entirely.
     */
    protected getDefaultBorder(): string {
        return INPUT_CHROME_TRAIT.declarations.border as string;
    }

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

        if (options.dropdownAnimated !== undefined) {
            this.setDropdownAnimated(options.dropdownAnimated);
        }

        return this;
    }

    /**
     * Lays out the input against the content box's left edge and the button
     * against its right edge at the fixed 24-px column width. Both edges are
     * the content box's, not the field's outer box, so the button does not
     * overhang the border.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        const inputWidth = Math.max(0, box.width - PICKER_BUTTON_WIDTH_PX);

        this._input.setX(box.x);
        this._input.setY(box.y);
        this._input.setWidth(inputWidth);
        this._input.setHeight(box.height);

        this._button.setX(box.x + inputWidth);
        this._button.setY(box.y);
        this._button.setWidth(PICKER_BUTTON_WIDTH_PX);
        this._button.setHeight(box.height);

        // The button was already laid out by `super.doLayout()` against its
        // construction-time preferred size; the manual setWidth/setHeight
        // calls above don't auto-relayout, so the inner glyph would stay
        // anchored to the smaller pre-resize inner rect. Re-fire the button's
        // own layout so the Fit-centred content row tracks the new height.
        this._button.doLayout();

        return this;
    }

    /**
     * Recalculates preferred and maximum height from the unified line box plus
     * this field's own chrome; preferred width comes from the already-resolved
     * constraint, falling back to the subclass-supplied {@link getPreferredWidth}
     * on the very first call.
     *
     * @remarks Box height is `Util.lineHeightPx()` plus the field root's own
     * vertical insets, padding, and border — the same sum `wrapInnerBaseline`
     * re-adds — so the picker shares its row height and baseline with a sibling
     * `TextField`. `doLayout` stretches the inner input to this full height, so
     * the root's chrome (not the inner input's) governs the box.
     */
    protected updateHeight(): void {
        this.applySingleLineBox(
            Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize()),
            this.getPreferredWidth(),
        );
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
     * Compares two picker values for dirty-tracking purposes. `Date` fails
     * reference equality (every commit path constructs a fresh `Date`), so
     * this overrides the inherited `Object.is` default with a `.getTime()`
     * comparison when both sides are `Date` instances, falling back to
     * `Object.is` for `null`/mismatched-type comparisons.
     *
     * @param a - The candidate value.
     * @param b - The clean baseline, or `undefined` if none has been set.
     *
     * @returns `true` when the two are equal for dirty-tracking purposes.
     */
    protected valuesEqual(a: TValue | null, b: (TValue | null) | undefined): boolean {
        if (a instanceof Date && b instanceof Date) {
            return a.getTime() === b.getTime();
        }

        return Object.is(a, b);
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
    protected onButtonPointerDown(_e: PointerEvent): Event.ListenerResult {
        return { prevent: true };
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
            this.setBorder({ border: "1px solid var(--ts-ui-validation-error-border)" });
        } else {
            this.setBorder(this.getDefaultBorder());
        }
    }

    /**
     * Keyboard shortcuts: ArrowDown opens the dropdown; Escape closes it.
     * While the dropdown is open the event is first offered to
     * {@link AnimatedDropdown.handleKey} so the dropdown can consume
     * navigation keys (arrows for day grid / year scroller, PageUp/Down,
     * Home/End, Enter / Space, and digit-keys for the year-scroller's
     * type-ahead). Keys the dropdown does not consume fall through to the
     * host input's own contract.
     *
     * @param e - The keyboard event.
     */
    protected onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (this._dropdown && this._dropdown.isOpen()) {
            if (this._dropdown.handleKey(e)) {
                return { prevent: true };
            }
        }

        if (e.key === "ArrowDown") {
            this.openDropdown();

            return { prevent: true };
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
     * Opens the dropdown anchored to the input. Every concrete dropdown
     * declares `showAt(anchorEl, value: TValue | null)` (enforced by the
     * `TDropdown` bound), so the value-typed call lives here directly.
     */
    protected openDropdown(): void {
        const dropdown = this.ensureDropdown();
        if (dropdown.isOpen()) {
            return;
        }

        // The manager closes the dropdown on an outside click via its
        // "click-outside" mode; route that through the field's own
        // closeDropdown and exclude the field root (the trigger) so the
        // toggle click doesn't immediately re-close it.
        dropdown.setCloseHandler(() => this.closeDropdown());
        dropdown.setAnchorElement(this.getElement(true) ?? null);

        dropdown.showAt(this._input.getElement(true)!, this._value);
    }

    /**
     * Closes the dropdown if open.
     */
    protected closeDropdown(): void {
        if (this._dropdown && this._dropdown.isOpen()) {
            this._dropdown.hideAnimated();
        }
    }
}

export { AbstractPickerField };
