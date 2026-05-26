// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractPickerField, AbstractPickerFieldOptions } from "~/component/input/AbstractPickerField.js";
import { Insets } from "~/primitive/Insets.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { BorderOptions } from "~/primitive/Border.js";
import { Event } from "~/core/Event.js";
import { Glyph } from "~/component/display/Glyph.js";
import { calendar } from "~/glyphs/solid/calendar.js";
import { DatePickerDropdown } from "~/component/input/DatePickerDropdown.js";
import { callable } from "~/core/Callable.js";

Glyph.register(calendar);

/**
 * Construction-time options for {@link DateField}.
 *
 * @category Components
 */
export interface DateFieldOptions extends AbstractPickerFieldOptions {
    value?:    Date | null;
    /** Earliest date the picker will allow selection of. Optional. */
    minDate?:  Date | null;
    /** Latest date the picker will allow selection of. Optional. */
    maxDate?:  Date | null;
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
 * Inherits the [`Bindable`](/api/core/interfaces/Bindable) value contract,
 * change/binding listeners, and enabled/read-only surface from
 * [`AbstractPickerField`](/api/component/input/classes/AbstractPickerField).
 * Returns `null` from `getValue` when the field is empty.
 *
 * @category Components
 */
class DateField extends AbstractPickerField<Date, DatePickerDropdown, DateFieldOptions> {

    constructor(options?: DateFieldOptions) {
        super(options, _defaultDateFieldOptions);

        // Button.setGlyph adds the glyph as the leading child of the
        // content row (with pointer-events: none) so the outer Fit centres
        // it within the button's inner rect.
        this._button.setGlyph("calendar");

        // Late-built state: `applyOptions` dispatched value/enabled/readOnly
        // through `_options` at super-time; re-apply them now that `_input`
        // exists so the inner text reflects the initial value and the inner
        // disabled / readonly attributes propagate.
        if (this._options.value !== undefined) {
            this.setValue(this._options.value);
        }

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
        }
    }

    /**
     * Applies a {@link DateFieldOptions} bag, caching the initial value pure
     * on `_options`. The constructor body dispatches the late-built fields
     * (value/enabled/readOnly) through their setters once `_input` exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DateFieldOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as DateFieldOptions;

        if (opts.value !== undefined) {
            this._options.value = opts.value;
        }

        if (opts.minDate !== undefined) {
            this._options.minDate = opts.minDate;
        }

        if (opts.maxDate !== undefined) {
            this._options.maxDate = opts.maxDate;
        }

        return this;
    }

    /**
     * Formats a Date as a YYYY-MM-DD string for display in the text input.
     *
     * @param date - The Date to format.
     * @returns A "YYYY-MM-DD" string.
     */
    protected formatValue(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");

        return `${y}-${m}-${d}`;
    }

    /**
     * Parses a "YYYY-MM-DD" string into a Date. Appends local midnight to
     * avoid UTC offset shifting the day.
     *
     * @param raw - The raw text typed into the input.
     * @returns The parsed Date, or null on parse failure.
     */
    protected parseRaw(raw: string): Date | null {
        const d = new Date(raw + "T00:00:00");

        return isNaN(d.getTime()) ? null : d;
    }

    /**
     * Builds the date dropdown with the field's selection callback and any
     * cached `minDate` / `maxDate` bounds forwarded into the dropdown's own
     * options bag.
     */
    protected createDropdown(): DatePickerDropdown {
        return new DatePickerDropdown(
            date => this.onDropdownSelected(date),
            {
                minDate: this._options.minDate ?? null,
                maxDate: this._options.maxDate ?? null,
            },
        );
    }

    /**
     * Anchors the date dropdown to the inner input element.
     *
     * @param dropdown - The dropdown instance to show.
     * @param anchorEl - The element to anchor the panel to.
     * @param value - The current field value (or null when empty).
     */
    protected showDropdown(dropdown: DatePickerDropdown, anchorEl: HTMLElement, value: Date | null): void {
        dropdown.showAt(anchorEl, value);
    }

    /**
     * Called when the user picks a day from the dropdown. Commits the value,
     * closes the panel, refocuses the input, and re-fires `input` so any
     * non-AbstractInput consumer reading from the inner DOM event still
     * sees the change.
     *
     * @param date - The chosen date.
     */
    protected onDropdownSelected(date: Date): void {
        this.setValue(date);
        this.closeDropdown();
        this._input.focus();
        Event.fireEvent(this._input, "input");
    }

    /**
     * The DateField's preferred width — chosen to fit a "YYYY-MM-DD" string
     * plus the 24-px glyph button without overflow at the default font size.
     */
    protected getPreferredWidth(): number {
        return 160;
    }

    /**
     * The default border restored when the invalid-border state clears.
     */
    protected getDefaultBorder(): BorderOptions {
        return _defaultDateFieldOptions.border as BorderOptions;
    }
}

const DateFieldCallable = callable(DateField);
type DateFieldCallable = DateField;
export {
    DateField         as _DateField,
    DateFieldCallable as DateField
};
