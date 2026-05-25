// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    AbstractCalendarDropdown,
    AbstractCalendarDropdownOptions,
} from "~/component/input/AbstractCalendarDropdown.js";
import { callable } from "~/core/Callable.js";

/** Pixel width of the calendar grid. */
const PANEL_WIDTH: number = 240;

/**
 * Construction-time options for {@link DatePickerDropdown}.
 *
 * @category Components
 */
export interface DatePickerDropdownOptions extends AbstractCalendarDropdownOptions {
}

/**
 * Floating month-grid date picker. Renders the calendar for the currently
 * displayed month (initialised from the value passed to `showAt`, or today
 * when the value is null). Selecting a day fires the `onSelect` callback
 * supplied to the constructor.
 *
 * Navigation:
 *  - Month-step `<` / `>` chevrons on the header row.
 *  - Clicking the "May 2026" header swaps the day grid for an in-place
 *    year-scroller; click a year to return to the day grid for that year.
 *  - 4-digit type-ahead inside the year scroller jumps to the typed year.
 *  - `minDate` / `maxDate` clamp both the year scroller range and which day
 *    cells are clickable.
 *
 * Inherits everything except the panel width — the shared calendar
 * structure, keyboard contract, year scroller, and bound-clamping all live
 * on [`AbstractCalendarDropdown`](/api/component/input/classes/AbstractCalendarDropdown).
 *
 * @category Components
 */
class DatePickerDropdown extends AbstractCalendarDropdown<DatePickerDropdownOptions> {

    /**
     * @param onSelect - Called with the chosen `Date` when the user picks a day.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: Date) => void, options?: DatePickerDropdownOptions) {
        super(onSelect, options);
    }

    /**
     * Returns the picker panel's outer width. Constant — the DateField
     * format ("YYYY-MM-DD") is narrower than DateTimeField, so the grid
     * doesn't need the seconds-variant extra width.
     */
    protected getPanelWidth(): number {
        return PANEL_WIDTH;
    }

    /**
     * Day-cell click handler. Folds the date into `_value`, notifies the
     * field, and stops — the field's selection callback closes the panel,
     * so refreshing the grid would be wasted work.
     *
     * @param date - The chosen day.
     */
    protected onDateSelected(date: Date): void {
        this.applyDateSelection(date);
        this._monthAnchor = new Date(date.getFullYear(), date.getMonth(), 1);
        this.notifyValueChanged();
    }
}

const DatePickerDropdownCallable = callable(DatePickerDropdown);
type DatePickerDropdownCallable = DatePickerDropdown;
export {
    DatePickerDropdown         as _DatePickerDropdown,
    DatePickerDropdownCallable as DatePickerDropdown
};
