// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractPickerField, AbstractPickerFieldOptions } from "~/component/input/AbstractPickerField.js";
import { Event } from "~/core/Event.js";
import { Glyph } from "~/component/display/Glyph.js";
import { calendar } from "~/glyphs/solid/calendar.js";
import { DatePickerDropdown } from "~/component/input/DatePickerDropdown.js";
import { callable } from "~/core/Callable.js";
import { resolveDateMath, tokenizeDateMath, parseIsoDate, formatIsoDate, DateMathUnit } from "~/component/input/dateMath.js";

Glyph.register(calendar);

// Relative-shorthand units this field accepts. Time units (h/mi/s) are
// excluded because the field formats only "YYYY-MM-DD" — an hour/minute/
// second offset would move the stored Date without changing a character of
// the displayed text.
const DATE_FIELD_UNITS: readonly DateMathUnit[] = ["y", "mo", "w", "d"];

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
     * @returns A "YYYY-MM-DD" string, the year zero-padded to four digits.
     */
    protected formatValue(date: Date): string {
        return formatIsoDate(date);
    }

    /**
     * Parses a relative shorthand (e.g. "+9y", "-2w3d") resolved against
     * today's date, or an absolute date at local midnight. The absolute form
     * must be a complete, zero-padded "YYYY-MM-DD" naming a real calendar day:
     * a partial prefix typed on the way to one, or an impossible day the engine
     * would roll forward, is a parse failure rather than a different date.
     *
     * @param raw - The raw text typed into the input.
     * @returns The parsed Date, or null on parse failure.
     */
    protected parseRaw(raw: string): Date | null {
        const now      = new Date();
        const relative = resolveDateMath(
            raw,
            DATE_FIELD_UNITS,
            new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        );

        if (relative !== null) {
            return relative;
        }

        return parseIsoDate(raw);
    }

    /**
     * Whether `raw` is a relative shorthand expression this field accepts.
     *
     * @param raw - The raw text typed into the input.
     * @returns `true` when `raw` tokenizes over {@link DATE_FIELD_UNITS}.
     */
    protected isRawShorthand(raw: string): boolean {
        return tokenizeDateMath(raw, DATE_FIELD_UNITS) !== null;
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

    /**
     * Opts into the unchanged-geometry layout skip: a date field re-committed at
     * the rectangle it already holds, with no pass owed, is not re-laid-out.
     *
     * The inherited `doLayout` reads the content box alone — which a skip by
     * definition did not change — and places the inner input and the picker
     * button, calling the button's own `doLayout` directly so the button's gate
     * cannot withhold it. Every other input announces itself:
     *
     * - `setValue`, typing, and the dropdown's commit write the inner input's
     *   value, which is an element write and not a layout input.
     * - The unified single-line box height, re-pinned on every theme change,
     *   goes through `setPreferredSize`, which relays and marks every ancestor.
     * - `setInsets` / `clearInsets`, padding and border — each marks the layout
     *   owed here, like any `invalidateLayout`.
     * - A theme switch or web-font swap — re-measured through the text-metrics
     *   condition the skip's own gate applies.
     * - The calendar dropdown is an overlay with its own root, outside this
     *   field's layout entirely.
     *
     * The opt-in is this concrete field's, not `AbstractPickerField`'s, so
     * `DateTimeField` and `FileField` keep the default until each is audited on
     * its own.
     *
     * Not covered, and so not re-flowed until this component's rectangle next
     * moves or something schedules it: a consumer child that changes its own
     * intrinsic size without calling `setPreferredSize` or
     * `notifyIntrinsicSizeChanged`. It should follow its change with
     * `scheduleLayout()`.
     *
     * @returns `true`.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

const DateFieldCallable = callable(DateField);
type DateFieldCallable = DateField;
export {
    DateField         as _DateField,
    DateFieldCallable as DateField
};
