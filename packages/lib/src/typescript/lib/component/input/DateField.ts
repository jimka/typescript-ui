// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractPickerField, AbstractPickerFieldOptions } from "~/component/input/AbstractPickerField.js";
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
        super(options);

        // Button.setGlyph adds the glyph as the leading child of the
        // content row (with pointer-events: none) so the outer Fit centres
        // it within the button's inner rect.
        this._button.setGlyph("calendar");

        // Late-built value: `applyOptions` cached it on `_options` at super-time;
        // re-apply now that `_input` exists so the inner text reflects it. The
        // enabled / readOnly re-dispatch is handled by the base constructor.
        if (this._options.value !== undefined) {
            this.setValue(this._options.value);
        }

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
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

        if (options.value !== undefined) {
            this._options.value = options.value;
        }

        if (options.minDate !== undefined) {
            this._options.minDate = options.minDate;
        }

        if (options.maxDate !== undefined) {
            this._options.maxDate = options.maxDate;
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
}

const DateFieldCallable = callable(DateField);
type DateFieldCallable = DateField;
export {
    DateField         as _DateField,
    DateFieldCallable as DateField
};
