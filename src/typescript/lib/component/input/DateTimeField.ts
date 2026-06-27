// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractPickerField, AbstractPickerFieldOptions } from "~/component/input/AbstractPickerField.js";
import { Insets } from "~/primitive/Insets.js";
import { Event } from "~/core/Event.js";
import { Glyph } from "~/component/display/Glyph.js";
import { calendar } from "~/glyphs/solid/calendar.js";
import { DateTimePickerDropdown } from "~/component/input/DateTimePickerDropdown.js";
import type { Handle } from "~/core/DOM.js";
import { callable } from "~/core/Callable.js";

Glyph.register(calendar);

/**
 * Construction-time options for {@link DateTimeField}.
 *
 * @category Components
 */
export interface DateTimeFieldOptions extends AbstractPickerFieldOptions {
    value?:       Date | null;
    /** When true, the field formats and the picker exposes seconds. Default: false. */
    showSeconds?: boolean;
    /** Earliest date the picker will allow selection of. Optional. */
    minDate?:     Date | null;
    /** Latest date the picker will allow selection of. Optional. */
    maxDate?:     Date | null;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 */
const _defaultDateTimeFieldOptions: Partial<DateTimeFieldOptions> = {
    cursor:          "text",
    padding:         new Insets(3, 3, 3, 3),
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
    border:          "var(--ts-ui-input-border)",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
};

/**
 * A date-time-picker input component.
 *
 * Renders a text input with a calendar-glyph button on the right; clicking
 * either opens a
 * [`DateTimePickerDropdown`](/api/component/input/classes/DateTimePickerDropdown)
 * panel that combines a month-view calendar grid with an hour/minute
 * selector. The dropdown fades in via the shared
 * [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown) lifecycle.
 *
 * Inherits the [`Bindable`](/api/core/interfaces/Bindable) value contract,
 * change/binding listeners, and enabled/read-only surface from
 * [`AbstractPickerField`](/api/component/input/classes/AbstractPickerField).
 *
 * @category Components
 */
class DateTimeField extends AbstractPickerField<Date, DateTimePickerDropdown, DateTimeFieldOptions> {

    private _showSeconds: boolean = false;

    constructor(options?: DateTimeFieldOptions) {
        super(options, _defaultDateTimeFieldOptions);

        // Button.setGlyph adds the glyph as the leading child of the
        // content row (with pointer-events: none) so the outer Fit centres
        // it within the button's inner rect.
        this._button.setGlyph("calendar");

        // Late-built state: `applyOptions` dispatched these through `_options`
        // at super-time. Re-apply now that `_input` exists. `showSeconds` is
        // read into the private field before `setValue` so the initial
        // formatting picks up the right precision.
        if (this._options.showSeconds !== undefined) {
            this._showSeconds = this._options.showSeconds;
        }

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
     * Applies a {@link DateTimeFieldOptions} bag. Late-built fields (value,
     * showSeconds) are cached pure on `_options` here and dispatched from
     * the constructor body once `_input` exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DateTimeFieldOptions): this {
        super.applyOptions(options);

        if (options.showSeconds !== undefined) {
            this._options.showSeconds = options.showSeconds;
        }

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
     * Formats a Date as a "YYYY-MM-DD HH:MM" (or "YYYY-MM-DD HH:MM:SS" when
     * `showSeconds` is true) string for display in the input.
     *
     * @param date - The Date to format.
     * @returns The formatted date-time string.
     */
    protected formatValue(date: Date): string {
        const y  = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, "0");
        const d  = String(date.getDate()).padStart(2, "0");
        const h  = String(date.getHours()).padStart(2, "0");
        const mi = String(date.getMinutes()).padStart(2, "0");

        if (this._showSeconds) {
            const s = String(date.getSeconds()).padStart(2, "0");

            return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
        }

        return `${y}-${mo}-${d} ${h}:${mi}`;
    }

    /**
     * Parses the typed text into a Date. Returns null on parse failure.
     *
     * @param raw - The raw text typed into the input.
     * @returns The parsed Date, or null.
     */
    protected parseRaw(raw: string): Date | null {
        // Require both a date and a time portion, ISO-anchored, so parsing is
        // the strict inverse of formatValue and not the locale-dependent,
        // time-optional `new Date(raw)`. Mirrors DateField/TimeField strictness.
        const [datePart, timePart] = raw.trim().split(/\s+/);
        if (!datePart || !timePart) {
            return null;
        }

        const d = new Date(`${datePart}T${timePart}`);

        return isNaN(d.getTime()) ? null : d;
    }

    /**
     * Builds the date-time dropdown with the field's selection callback, the
     * cached `showSeconds` flag, and any `minDate` / `maxDate` bounds forwarded
     * into the dropdown's own options bag.
     */
    protected createDropdown(): DateTimePickerDropdown {
        return new DateTimePickerDropdown(
            date => this.onDropdownSelected(date),
            {
                showSeconds: this._showSeconds,
                minDate:     this._options.minDate ?? null,
                maxDate:     this._options.maxDate ?? null,
            },
        );
    }

    /**
     * Anchors the date-time dropdown to the inner input element.
     *
     * @param dropdown - The dropdown instance to show.
     * @param anchorEl - The element to anchor the panel to.
     * @param value - The current field value (or null when empty).
     */
    protected showDropdown(dropdown: DateTimePickerDropdown, anchorEl: Handle, value: Date | null): void {
        dropdown.showAt(anchorEl, value);
    }

    /**
     * Called when the user picks a date-time from the dropdown. Commits the
     * value and re-fires `input` on the inner field so any DOM-event
     * consumer still sees the change.
     *
     * @param date - The chosen Date.
     */
    protected onDropdownSelected(date: Date): void {
        this.setValue(date);
        Event.fireEvent(this._input, "input");
    }

    /**
     * The DateTimeField's preferred width — chosen to fit a
     * "YYYY-MM-DD HH:MM[:SS]" string plus the 24-px glyph button without
     * overflow at the default font size.
     */
    protected getPreferredWidth(): number {
        return 200;
    }

    /**
     * The default border restored when the invalid-border state clears.
     */
    protected getDefaultBorder(): string {
        return _defaultDateTimeFieldOptions.border as string;
    }
}

const DateTimeFieldCallable = callable(DateTimeField);
type DateTimeFieldCallable = DateTimeField;
export {
    DateTimeField         as _DateTimeField,
    DateTimeFieldCallable as DateTimeField
};
