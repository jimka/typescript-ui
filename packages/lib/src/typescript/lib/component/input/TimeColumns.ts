// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { HBox } from "~/layout/HBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { PickerCell, PickerColumn } from "~/component/input/PickerColumn.js";

/**
 * Pixel height of the Hour/Min/Sec column block. Sized to show roughly seven
 * scrollable cells beneath the column headers. The `TimePickerDropdown` panel
 * has a fixed height and stretches this to fill via its `Fit` layout, so the
 * value only governs the embedded `DateTimePickerDropdown` case.
 */
const TIME_COLUMNS_HEIGHT: number = 176;

/**
 * Construction-time options for {@link TimeColumns}.
 */
interface TimeColumnsOptions {
    /** When true, a third "Sec" column is built alongside Hour and Min. Default: false. */
    showSeconds?: boolean;
}

/**
 * The scrollable Hour/Min(/Sec) selection grid shared by `TimePickerDropdown`
 * and `DateTimePickerDropdown`. The columns are built once in the constructor;
 * selection changes (clicks and {@link setTime}) re-highlight the existing
 * cells in place via {@link PickerColumn.setSelectedValue} rather than tearing
 * the grid down, so a pick never resets a scrolled column's position.
 *
 * Internal — not exported from the input barrel.
 */
class TimeColumns extends Component {

    private readonly _onChange:    (hours: number, minutes: number, seconds: number) => void;
    private readonly _showSeconds: boolean;
    /** -1 means the user has not yet picked an hour. */
    private _hours:   number = -1;
    /** -1 means the user has not yet picked a minute. */
    private _minutes: number = -1;
    /** -1 means the user has not yet picked a second. Always 0 when `_showSeconds` is false. */
    private _seconds: number = -1;
    private readonly _hourColumn:   PickerColumn;
    private readonly _minuteColumn: PickerColumn;
    /** The Sec column, or null when `_showSeconds` is false. */
    private readonly _secondColumn: PickerColumn | null;

    /**
     * @param onChange - Called with `(hours, minutes, seconds)` whenever the user picks a value.
     * The `seconds` argument is always `0` when `showSeconds` is not set.
     * @param options - Optional construction-time options.
     */
    constructor(
        onChange: (hours: number, minutes: number, seconds: number) => void,
        options?: TimeColumnsOptions,
    ) {
        super({ preferredSize: { width: 0, height: TIME_COLUMNS_HEIGHT } });

        this._onChange    = onChange;
        this._showSeconds = options?.showSeconds ?? false;

        this.setLayoutManager(new HBox({ spacing: 4, stretching: true }));

        const weight = new LayoutConstraints();
        weight.weight = 1;

        this._hourColumn   = this.buildColumn("Hour", 24, 1, value => this.onUnitSelected("hours", value));
        this._minuteColumn = this.buildColumn("Min",  60, 5, value => this.onUnitSelected("minutes", value));

        this.addComponent(this._hourColumn,   weight);
        this.addComponent(this._minuteColumn, weight);

        if (this._showSeconds) {
            this._secondColumn = this.buildColumn("Sec", 60, 5, value => this.onUnitSelected("seconds", value));
            this.addComponent(this._secondColumn, weight);
        } else {
            this._secondColumn = null;
        }
    }

    /**
     * Seeds or refreshes the highlighted cells from `value`'s time portion (or
     * clears every column when null). In place — no rebuild, no scroll change.
     *
     * @param value - The time to highlight, or null to clear the selection.
     * @returns This component, for method chaining.
     */
    setTime(value: Date | null): this {
        if (value) {
            this._hours   = value.getHours();
            this._minutes = value.getMinutes();
            this._seconds = this._showSeconds ? value.getSeconds() : 0;
        } else {
            this._hours   = -1;
            this._minutes = -1;
            this._seconds = -1;
        }

        this.refreshColumns();

        return this;
    }

    /**
     * Builds a single scrollable column, populating it with `count / step`
     * cells whose labels are zero-padded values.
     *
     * @param label - Column header text ("Hour" / "Min" / "Sec").
     * @param count - Exclusive upper bound of the value range (24 for hours, 60 for minutes/seconds).
     * @param step - Step between cells (1 for hours, 5 for minutes/seconds).
     * @param onSelect - Callback fired with the clicked value.
     * @returns The constructed column.
     */
    private buildColumn(
        label:    string,
        count:    number,
        step:     number,
        onSelect: (value: number) => void,
    ): PickerColumn {
        const column = new PickerColumn(label);

        for (let v = 0; v < count; v += step) {
            const value = v;
            const cell  = new PickerCell(String(value).padStart(2, "0"), () => onSelect(value));

            column.addCell(cell);
        }

        return column;
    }

    /**
     * Records a clicked value for one unit, defaults the other units to `0` on
     * the first interaction so the consumer always receives a complete time,
     * re-highlights the columns in place, and fires `onChange`.
     *
     * @param unit - Which unit was picked.
     * @param value - The chosen value.
     */
    private onUnitSelected(unit: "hours" | "minutes" | "seconds", value: number): void {
        if (unit === "hours") {
            this._hours = value;
        } else if (unit === "minutes") {
            this._minutes = value;
        } else {
            this._seconds = value;
        }

        if (this._hours < 0) {
            this._hours = 0;
        }

        if (this._minutes < 0) {
            this._minutes = 0;
        }

        if (this._seconds < 0) {
            this._seconds = 0;
        }

        this.refreshColumns();

        this._onChange(this._hours, this._minutes, this._showSeconds ? this._seconds : 0);
    }

    /**
     * Re-applies each backing field's value as the active cell highlight. A
     * value with no matching cell (e.g. a non-multiple-of-5 minute seeded from
     * an external Date) leaves that column unhighlighted, matching the exact
     * cell-label match the picker has always used.
     */
    private refreshColumns(): void {
        this._hourColumn.setSelectedValue(this.cellLabel(this._hours));
        this._minuteColumn.setSelectedValue(this.cellLabel(this._minutes));
        this._secondColumn?.setSelectedValue(this.cellLabel(this._seconds));
    }

    /**
     * Formats a unit value as its zero-padded cell label, or null when unset
     * (so the column clears).
     *
     * @param value - The unit value, or -1 when unset.
     * @returns The two-digit label, or null.
     */
    private cellLabel(value: number): string | null {
        return value < 0 ? null : String(value).padStart(2, "0");
    }
}

export { TimeColumns };
