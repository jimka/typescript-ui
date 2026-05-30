// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    AbstractCalendarDropdown,
    AbstractCalendarDropdownOptions,
    ROOT_GAP,
} from "~/component/input/AbstractCalendarDropdown.js";
import { Component } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
import { ComboBox } from "~/component/input/ComboBox.js";
import { HBox } from "~/layout/HBox.js";
import { callable } from "~/core/Callable.js";

/** Pixel width of the combined date+time picker panel (no seconds). */
const PANEL_WIDTH:          number = 240;

/** Pixel width of the combined date+time picker panel when seconds are shown. */
const PANEL_WIDTH_SECONDS:  number = 280;

/**
 * Pixel height of the time row at the bottom of the panel. Mirrors the
 * picker-row sizing used by the time-only field so the row reads as the
 * same control across both pickers.
 */
const TIME_ROW_HEIGHT:      number = 28;

/** Pixel width of each ComboBox in the time row. */
const SELECT_WIDTH:         number = 56;

/** Pixel width of the ":" separator between time selects. */
const SEPARATOR_WIDTH:      number = 8;

/** Pixel width of the "Time" label that precedes the selects. */
const TIME_LABEL_WIDTH:     number = 36;

/** The "Time" label sitting before the hour/minute selects. */
class DateTimePickerTimeLabel extends Text {
    constructor() {
        super("Time", {
            fontSize:      12,
            preferredSize: { width: TIME_LABEL_WIDTH, height: TIME_ROW_HEIGHT },
        });
        this.setLineHeight(TIME_ROW_HEIGHT);
    }
}

/** The ":" separator between the hour, minute, and (optional) second selects. */
class DateTimePickerTimeSeparator extends Text {
    constructor() {
        super(":", {
            textAlign:     "center",
            preferredSize: { width: SEPARATOR_WIDTH, height: TIME_ROW_HEIGHT },
        });
        this.setLineHeight(TIME_ROW_HEIGHT);
    }
}

/**
 * Framework ComboBox used for the hour / minute / second pickers in the
 * time row. Sized to the fixed `SELECT_WIDTH × TIME_ROW_HEIGHT` so the row
 * lays out predictably regardless of the input-height theme token.
 *
 * The ComboBox's spawned dropdown panel is layered on top of the picker
 * via the shared {@link AnimatedDropdown} open-stack, so the picker's
 * outside-click dismiss handler (`DateTimeField.onViewportPointerDown`)
 * recognises clicks inside this ComboBox dropdown as in-panel and keeps
 * the picker open.
 */
class DateTimePickerSelect extends ComboBox {

    private readonly _onChange: (value: number) => void;
    private readonly _step:     number;

    /**
     * @param count - Number of options (24 for hours, 60 for minutes/seconds).
     * @param active - Currently-selected value, or -1 for no selection.
     * @param onChange - Callback fired when the user picks a new value.
     * @param step - Step between options (1 for hours, 5 for minutes/seconds).
     */
    constructor(count: number, active: number, onChange: (value: number) => void, step: number = 1) {
        super();

        this._onChange = onChange;
        this._step     = step;

        // ComboBox's base `updateHeight` (called from its constructor and on
        // theme change) writes a 200 px-wide preferred size that would push
        // the time row past the picker panel; lock the picker-specific size
        // here after super has finished so the override survives subsequent
        // updateHeight calls.
        this.setPreferredSize(SELECT_WIDTH, TIME_ROW_HEIGHT);
        this.setMinSize(SELECT_WIDTH, TIME_ROW_HEIGHT);
        this.setMaxSize(SELECT_WIDTH, TIME_ROW_HEIGHT);

        const labels: string[] = [];

        for (let v = 0; v < count; v += step) {
            labels.push(String(v).padStart(2, "0"));
        }

        this.setItems(labels);

        const snappedActive = active < 0 ? -1 : Math.round(active / step) * step;

        if (snappedActive >= 0) {
            this.setSelectedIndex(snappedActive / step, false);
        } else {
            this.setSelectedIndex(-1, false);
        }

        this.on("change", () => this.onChange());
    }

    /**
     * Pins the picker-row size on theme change. The base `updateHeight`
     * would otherwise reset the width to 200 px and break the time-row
     * layout.
     */
    protected updateHeight(): void {
        this.setPreferredSize(SELECT_WIDTH, TIME_ROW_HEIGHT);
        this.setMinSize(SELECT_WIDTH, TIME_ROW_HEIGHT);
        this.setMaxSize(SELECT_WIDTH, TIME_ROW_HEIGHT);
    }

    /**
     * Forwards the selected numeric value to the owner-supplied change
     * callback.
     */
    private onChange(): void {
        const idx = this.getSelectedIndex();

        if (idx >= 0) {
            this._onChange(idx * this._step);
        }
    }
}

/**
 * Construction-time options for {@link DateTimePickerDropdown}.
 *
 * @category Components
 */
export interface DateTimePickerDropdownOptions extends AbstractCalendarDropdownOptions {
    /** When true, the time row exposes a Seconds select. Default: false. */
    showSeconds?: boolean;
}

/**
 * Floating combined date + time picker. The date grid (month view) sits
 * above a minimal hour/minute selector.
 *
 * Inherits the shared calendar structure, keyboard contract, and year
 * scroller from [`AbstractCalendarDropdown`](/api/component/input/classes/AbstractCalendarDropdown).
 * This subclass adds the time row beneath the day grid and preserves the
 * picked time when the user changes the calendar day or year.
 *
 * @category Components
 */
class DateTimePickerDropdown extends AbstractCalendarDropdown<DateTimePickerDropdownOptions> {

    /**
     * The hour/minute (and optional second) row. Assigned by
     * {@link buildExtraRootChildren}, which runs during the base
     * constructor — declared with `declare` so the field initialiser
     * doesn't clobber the super-time assignment.
     */
    declare protected _timeRow: Component;

    /**
     * @param onSelect - Called with the chosen `Date` whenever the user updates any field.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: Date) => void, options?: DateTimePickerDropdownOptions) {
        super(onSelect, options);
    }

    /**
     * Applies the {@link DateTimePickerDropdownOptions} bag. `showSeconds`
     * is a pure cache write — it's read at panel-sizing time and at
     * time-row build time.
     *
     * @param options - The options bag to apply.
     */
    protected applyOptions(options: DateTimePickerDropdownOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as DateTimePickerDropdownOptions;

        if (opts.showSeconds !== undefined) {
            this._options.showSeconds = opts.showSeconds;
        }

        return this;
    }

    /**
     * Appends an empty time row to `_root`. The selects are populated
     * lazily by {@link rebuildExtraRowsAfterValueChange} so they always
     * reflect the current `_value`.
     */
    protected buildExtraRootChildren(): void {
        this._timeRow = new Component({ preferredSize: { width: 0, height: TIME_ROW_HEIGHT } });
        this._timeRow.setLayoutManager(new HBox({ spacing: 4 }));
        this._root.addComponent(this._timeRow);
    }

    /**
     * Rebuilds the time row's children against the current `_value`.
     * Called from `showAt` and after every day / year / time-row commit
     * so the hour/minute selects always reflect the stored value.
     */
    protected rebuildExtraRowsAfterValueChange(): void {
        this._timeRow.removeAllComponents();
        this.buildTimeRow();
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
     * Returns the panel width — wider when seconds are shown so the third
     * select column doesn't crowd the calendar above.
     */
    protected getPanelWidth(): number {
        return this.isShowingSeconds() ? PANEL_WIDTH_SECONDS : PANEL_WIDTH;
    }

    /**
     * Extra inner height contributed by the time row. The row's true
     * height comes from `getMinSize` (HBox computes its minimum by
     * baseline-aligning text-bearing children, which can exceed the
     * explicit `TIME_ROW_HEIGHT` when label and ComboBox text baselines
     * disagree — VBox then enforces that min). Hard-coding
     * `TIME_ROW_HEIGHT` here under-sizes the panel by 2 px and clips the
     * time selector ComboBoxes via the dropdown's `overflow: hidden`.
     */
    protected getExtraInnerHeight(): number {
        const timeRowH = this._timeRow.getMinSize()?.height ?? TIME_ROW_HEIGHT;

        return ROOT_GAP + timeRowH;
    }

    /**
     * Builds the hour/minute (and optional second) selector row using the
     * current `_value`'s time portion as the active selection.
     */
    private buildTimeRow(): void {
        this._timeRow.addComponent(new DateTimePickerTimeLabel());

        const hourSelect = new DateTimePickerSelect(24, this._value?.getHours() ?? -1, value => {
            const v = this._value ?? this.todayMidnight();
            v.setHours(value, v.getMinutes(), 0, 0);
            this._value = v;
            this.notifyValueChanged();
        });
        this._timeRow.addComponent(hourSelect);
        this._timeRow.addComponent(new DateTimePickerTimeSeparator());

        const minuteSelect = new DateTimePickerSelect(60, this._value?.getMinutes() ?? -1, value => {
            const v = this._value ?? this.todayMidnight();
            v.setHours(v.getHours(), value, v.getSeconds(), 0);
            this._value = v;
            this.notifyValueChanged();
        }, 5);
        this._timeRow.addComponent(minuteSelect);

        if (this.isShowingSeconds()) {
            this._timeRow.addComponent(new DateTimePickerTimeSeparator());

            const secondSelect = new DateTimePickerSelect(60, this._value?.getSeconds() ?? -1, value => {
                const v = this._value ?? this.todayMidnight();
                v.setHours(v.getHours(), v.getMinutes(), value, 0);
                this._value = v;
                this.notifyValueChanged();
            }, 5);
            this._timeRow.addComponent(secondSelect);
        }
    }

    /**
     * Reads the cached `showSeconds` flag.
     *
     * @returns True when the time row exposes a Seconds select.
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
