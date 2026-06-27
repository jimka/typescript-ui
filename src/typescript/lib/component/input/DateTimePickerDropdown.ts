// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    AbstractCalendarDropdown,
    AbstractCalendarDropdownOptions,
    ROOT_GAP,
} from "~/component/input/AbstractCalendarDropdown.js";
import { TimeField } from "~/component/input/TimeField.js";
import { callable } from "~/core/Callable.js";

/** Pixel width of the combined date+time picker panel. */
const PANEL_WIDTH:          number = 240;

/**
 * Construction-time options for {@link DateTimePickerDropdown}.
 *
 * @category Components
 */
export interface DateTimePickerDropdownOptions extends AbstractCalendarDropdownOptions {
    /** When true, the embedded time field and its picker expose seconds. Default: false. */
    showSeconds?: boolean;
}

/**
 * Floating combined date + time picker. The date grid (month view) sits
 * above a minimal hour/minute selector.
 *
 * Inherits the shared calendar structure, keyboard contract, and year
 * scroller from [`AbstractCalendarDropdown`](/api/component/input/classes/AbstractCalendarDropdown).
 * This subclass adds an embedded
 * [`TimeField`](/api/component/input/classes/TimeField) beneath the day grid —
 * clicking it opens the floating
 * [`TimePickerDropdown`](/api/component/input/classes/TimePickerDropdown) — and
 * preserves the picked time when the user changes the calendar day or year.
 *
 * @category Components
 */
class DateTimePickerDropdown extends AbstractCalendarDropdown<DateTimePickerDropdownOptions> {

    /**
     * The embedded time field beneath the day grid. Clicking it opens a
     * floating time-picker dropdown that layers above this panel. Assigned by
     * {@link buildExtraRootChildren}, which runs during the base
     * constructor — declared with `declare` so the field initialiser
     * doesn't clobber the super-time assignment.
     */
    declare protected _timeField: TimeField;

    /**
     * @param onSelect - Called with the chosen `Date` whenever the user updates any field.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: Date) => void, options?: DateTimePickerDropdownOptions) {
        super(onSelect, options);
    }

    /**
     * Applies the {@link DateTimePickerDropdownOptions} bag. `showSeconds`
     * is a pure cache write — it's read at time-field build time.
     *
     * @param options - The options bag to apply.
     */
    protected applyOptions(options: DateTimePickerDropdownOptions): this {
        super.applyOptions(options);

        if (options.showSeconds !== undefined) {
            this._options.showSeconds = options.showSeconds;
        }

        return this;
    }

    /**
     * Builds the embedded {@link TimeField} once and appends it to `_root`.
     * Its `change` event folds the picked time into `_value`; the field's
     * displayed value is refreshed by {@link rebuildExtraRowsAfterValueChange}.
     */
    protected buildExtraRootChildren(): void {
        this._timeField = new TimeField({ showSeconds: this.isShowingSeconds() });
        this._timeField.on("change", value => this.onTimeFieldChange(value));
        this._root.addComponent(this._timeField);
    }

    /**
     * Re-seeds the embedded time field from the current `_value`'s time
     * portion. Called from `showAt` and after every day commit so the field
     * always reflects the stored value. `setValue` is silent (it fires no
     * `change`), so this seeding can't feed back into {@link onTimeFieldChange}.
     */
    protected rebuildExtraRowsAfterValueChange(): void {
        this._timeField.setValue(this._value);
    }

    /**
     * Folds a time picked in the embedded field into `_value`'s time portion,
     * seeding from today at midnight when `_value` is null, and notifies. The
     * field's value carries today's date, so only its H/M/S is read. A null
     * value (cleared field) leaves the stored time untouched.
     *
     * @param value - The time field's new value, or null when cleared.
     */
    private onTimeFieldChange(value: Date | null): void {
        if (!value) {
            return;
        }

        const v = this._value ?? this.todayMidnight();
        v.setHours(value.getHours(), value.getMinutes(), this.isShowingSeconds() ? value.getSeconds() : 0, 0);
        this._value = v;
        this.notifyValueChanged();
    }

    /**
     * Folds a clicked day into `_value` while preserving the existing
     * time portion. When `_value` is null, seeds it with the clicked
     * day at 00:00.
     *
     * @param date - The clicked day.
     */
    protected applyDateSelection(date: Date): void {
        if (!this._value) {
            this._value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        } else {
            this._value.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        }
    }

    /**
     * Updates `_value`'s year when the year-scroller commits, and fires
     * the change callback. Unlike DateField, picking a year *is* a
     * meaningful edit here — the calendar year is part of the value the
     * user is constructing.
     *
     * @param year - The chosen year.
     */
    protected applyYearSelection(year: number): void {
        if (this._value) {
            this._value.setFullYear(year);
            this.notifyValueChanged();
        }
    }

    /**
     * Returns the panel width. The embedded time field stretches to fit, so
     * the seconds option doesn't widen the panel — the day grid sets the width.
     */
    protected getPanelWidth(): number {
        return PANEL_WIDTH;
    }

    /**
     * Extra inner height contributed by the embedded time field: the gap above
     * it plus the field's own preferred height.
     */
    protected getExtraInnerHeight(): number {
        const fieldH = this._timeField.getPreferredSize()?.height ?? 0;

        return ROOT_GAP + fieldH;
    }

    /**
     * Reads the cached `showSeconds` flag.
     *
     * @returns True when the embedded time field and its picker expose seconds.
     */
    private isShowingSeconds(): boolean {
        return this._options.showSeconds ?? false;
    }

    /**
     * Returns today's date at 00:00:00.000, used as the seed when the
     * user picks a time before picking a day.
     *
     * @returns A new `Date` for today at midnight.
     */
    private todayMidnight(): Date {
        const now = new Date();

        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }
}

const DateTimePickerDropdownCallable = callable(DateTimePickerDropdown);
type DateTimePickerDropdownCallable = DateTimePickerDropdown;
export {
    DateTimePickerDropdown         as _DateTimePickerDropdown,
    DateTimePickerDropdownCallable as DateTimePickerDropdown
};
