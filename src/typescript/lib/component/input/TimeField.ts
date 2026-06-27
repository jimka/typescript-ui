// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractPickerField, AbstractPickerFieldOptions } from "~/component/input/AbstractPickerField.js";
import { Insets } from "~/primitive/Insets.js";
import { Event } from "~/core/Event.js";
import { Glyph } from "~/component/display/Glyph.js";
import { clock } from "~/glyphs/solid/clock.js";
import { TimePickerDropdown } from "~/component/input/TimePickerDropdown.js";
import type { Handle } from "~/core/DOM.js";
import { callable } from "~/core/Callable.js";

Glyph.register(clock);

/**
 * Construction-time options for {@link TimeField}.
 *
 * @category Components
 */
export interface TimeFieldOptions extends AbstractPickerFieldOptions {
    value?:       Date | null;
    /** When true, the field formats and the picker exposes seconds. Default: false. */
    showSeconds?: boolean;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 */
const _defaultTimeFieldOptions: Partial<TimeFieldOptions> = {
    cursor:          "text",
    padding:         new Insets(3, 3, 3, 3),
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
    border:          "var(--ts-ui-input-border)",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
};

/**
 * A time-picker input component.
 *
 * Renders a text input with a clock-glyph button on the right; clicking
 * either opens a
 * [`TimePickerDropdown`](/api/component/input/classes/TimePickerDropdown)
 * panel that fades in via the shared
 * [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown) lifecycle. The
 * native browser time-picker is no longer used.
 *
 * Inherits the [`Bindable`](/api/core/interfaces/Bindable) value contract,
 * change/binding listeners, and enabled/read-only surface from
 * [`AbstractPickerField`](/api/component/input/classes/AbstractPickerField).
 * The Date value uses today's date for its date portion; only hours,
 * minutes (and optionally seconds) are meaningful.
 *
 * @category Components
 */
class TimeField extends AbstractPickerField<Date, TimePickerDropdown, TimeFieldOptions> {

    private _showSeconds: boolean = false;

    constructor(options?: TimeFieldOptions) {
        super(options, _defaultTimeFieldOptions);

        // Button.setGlyph adds the glyph as the leading child of the
        // content row (with pointer-events: none) so the outer Fit centres
        // it within the button's inner rect.
        this._button.setGlyph("clock");

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
     * Applies a {@link TimeFieldOptions} bag. Late-built fields (value,
     * showSeconds) are cached pure on `_options` here and dispatched from
     * the constructor body once `_input` exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TimeFieldOptions): this {
        super.applyOptions(options);

        if (options.showSeconds !== undefined) {
            this._options.showSeconds = options.showSeconds;
        }

        if (options.value !== undefined) {
            this._options.value = options.value;
        }

        return this;
    }

    /**
     * Formats a Date as an "HH:MM" (or "HH:MM:SS" when `showSeconds` is
     * true) string for display in the text input.
     *
     * @param date - The Date to format.
     * @returns The formatted time string.
     */
    protected formatValue(date: Date): string {
        const h = String(date.getHours()).padStart(2, "0");
        const m = String(date.getMinutes()).padStart(2, "0");

        if (this._showSeconds) {
            const s = String(date.getSeconds()).padStart(2, "0");

            return `${h}:${m}:${s}`;
        }

        return `${h}:${m}`;
    }

    /**
     * Parses an "HH:MM" or "HH:MM:SS" string into a Date with today's date
     * portion. Returns null on parse failure.
     *
     * @param raw - The raw text typed into the input.
     * @returns The parsed Date, or null.
     */
    protected parseRaw(raw: string): Date | null {
        const [hStr, mStr, sStr] = raw.split(":");
        const h = Number(hStr);
        const m = Number(mStr);
        const s = sStr === undefined ? 0 : Number(sStr);

        const hasMinutes = mStr !== undefined && mStr !== "";
        const validHour  = !isNaN(h) && h >= 0 && h < 24;
        const validMin   = !isNaN(m) && m >= 0 && m < 60;
        const validSec   = !isNaN(s) && s >= 0 && s < 60;

        if (!hasMinutes || !validHour || !validMin || !validSec) {
            return null;
        }

        const d = new Date();
        d.setHours(h, m, s, 0);

        return d;
    }

    /**
     * Builds the time dropdown with the field's selection callback and the
     * cached `showSeconds` flag.
     */
    protected createDropdown(): TimePickerDropdown {
        return new TimePickerDropdown(
            (h: number, m: number, s: number) => this.onTimeSelected(h, m, s),
            { showSeconds: this._showSeconds },
        );
    }

    /**
     * Anchors the time dropdown to the inner input element.
     *
     * @param dropdown - The dropdown instance to show.
     * @param anchorEl - The element to anchor the panel to.
     * @param value - The current field value (or null when empty).
     */
    protected showDropdown(dropdown: TimePickerDropdown, anchorEl: Handle, value: Date | null): void {
        dropdown.showAt(anchorEl, value);
    }

    /**
     * Adapter from the inner dropdown's `(h, m, s)` selection callback to
     * the abstract base's `(value)` shape. Builds a Date with today's date
     * portion and the selected H:M:S.
     */
    private onTimeSelected(hours: number, minutes: number, seconds: number): void {
        const d = new Date();
        d.setHours(hours, minutes, seconds, 0);
        this.onDropdownSelected(d);
    }

    /**
     * Called when the user picks a time from the dropdown. Commits the
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
     * The TimeField's preferred width — chosen to fit a "HH:MM[:SS]" string
     * plus the 24-px glyph button without overflow at the default font size.
     */
    protected getPreferredWidth(): number {
        return 140;
    }

    /**
     * The default border restored when the invalid-border state clears.
     */
    protected getDefaultBorder(): string {
        return _defaultTimeFieldOptions.border as string;
    }
}

const TimeFieldCallable = callable(TimeField);
type TimeFieldCallable = TimeField;
export {
    TimeField         as _TimeField,
    TimeFieldCallable as TimeField
};
