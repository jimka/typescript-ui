// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Component } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { ComboBox } from "~/component/input/ComboBox.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { Grid } from "~/layout/Grid.js";
import { callable } from "~/core/Callable.js";

/** Pixel width of the combined date+time picker panel. */
const PANEL_WIDTH:          number = 240;

/** Pixel width of the combined date+time picker panel when seconds are shown. */
const PANEL_WIDTH_SECONDS:  number = 280;

/** Pixel height of the month-name + year row at the top. */
const MONTH_HEIGHT:         number = 24;
/** Pixel height of the weekday-name row. */
const HEADER_HEIGHT:        number = 20;
/** Pixel height of each day cell. */
const CELL_HEIGHT:          number = 24;
/** Pixel height of the time row at the bottom. */
const TIME_ROW_HEIGHT:      number = 28;
/** Pixel width of each ComboBox in the time row. */
const SELECT_WIDTH:         number = 56;
/** Pixel width of the ":" separator between selects. */
const SEPARATOR_WIDTH:      number = 8;
/** Pixel width of the "Time" label. */
const TIME_LABEL_WIDTH:     number = 36;

// Static hover styling only. All layout (grid, row stacking, time row) is
// driven by the framework Grid / VBox / HBox managers.
(() => {
    const day = new StyleRule({ scope: "class", name: "DateTimePickerDay" });
    day.setMany({
        cursor:       "pointer",
        borderRadius: "3px",
    });
    day.ensure();

    const dayHover = new StyleRule({ scope: "selector", name: ".DateTimePickerDay:hover" });
    dayHover.set("backgroundColor",
        "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))");
    dayHover.ensure();
})();

/** Month-name + year row label. */
class DateTimePickerMonthLabel extends Text {
    constructor(text: string) {
        super(text, {
            textAlign:     "center",
            fontWeight:    "bold",
            preferredSize: { width: 0, height: MONTH_HEIGHT },
        });
        this.setLineHeight(MONTH_HEIGHT);
    }
}

/** Single weekday-name header. */
class DateTimePickerDayHeader extends Text {
    constructor(text: string) {
        super(text, {
            textAlign:     "center",
            fontSize:      12,
            preferredSize: { width: 0, height: HEADER_HEIGHT },
        });
        this.setLineHeight(HEADER_HEIGHT);
    }
}

/** Empty cell shown before the first day of the month (or trailing the last). */
class DateTimePickerBlankCell extends Component {
    constructor() {
        super({ preferredSize: { width: 0, height: CELL_HEIGHT } });
    }
}

/**
 * A single day cell. Carries selection state through Component setters
 * (`setBackgroundColor` / `setFontWeight`).
 */
class DateTimePickerDay extends Text {
    private _date:     Date;
    private _selected: boolean = false;
    private readonly _onClick: (date: Date) => void;

    constructor(date: Date, onClick: (date: Date) => void) {
        super(String(date.getDate()), {
            textAlign:     "center",
            preferredSize: { width: 0, height: CELL_HEIGHT },
        });
        this._date    = date;
        this._onClick = onClick;
        this.setLineHeight(CELL_HEIGHT);

        Event.addListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
        Event.addListener(this, "click",       ()                => this.onClick());
    }

    /**
     * Suppresses focus loss when the day is pointed at so the host input's
     * blur-to-commit path doesn't fire mid-click.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Forwards the cell's date to the owner-supplied click callback.
     */
    private onClick(): void {
        this._onClick(this._date);
    }

    /**
     * Toggles the selected state.
     *
     * @param selected - True to mark this day as the currently-selected one.
     */
    setSelected(selected: boolean): this {
        if (this._selected === selected) {
            return this;
        }

        this._selected = selected;

        if (selected) {
            this.setBackgroundColor("var(--ts-ui-autocomplete-item-highlight-bg, rgba(30, 100, 200, 0.18))");
            this.setFontWeight("bold");
        } else {
            this.clearBackgroundColor();
            this.setFontWeight("normal");
        }

        return this;
    }
}

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

/** The ":" separator between the hour and minute selects. */
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

        this.addActionListener(() => this.onChange());
    }

    /**
     * Pins the picker-row size on theme change. The base `updateHeight` would
     * otherwise reset the width to 200 px and break the time-row layout.
     */
    protected updateHeight(): void {
        this.setPreferredSize(SELECT_WIDTH, TIME_ROW_HEIGHT);
        this.setMinSize(SELECT_WIDTH, TIME_ROW_HEIGHT);
        this.setMaxSize(SELECT_WIDTH, TIME_ROW_HEIGHT);
    }

    /**
     * Forwards the selected numeric value to the owner-supplied change callback.
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
export interface DateTimePickerDropdownOptions extends AnimatedDropdownOptions {
    /** When true, the time row exposes a Seconds select. Default: false. */
    showSeconds?: boolean;
}

/**
 * Floating combined date + time picker. The date grid (month view) sits above
 * a minimal hour/minute selector. Single-month, no navigation — per the
 * `dropdown-fade-animation` plan's non-goals.
 *
 * Inherits the fade lifecycle from
 * [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown).
 *
 * @category Components
 */
class DateTimePickerDropdown extends AnimatedDropdown<DateTimePickerDropdownOptions> {

    private readonly _onSelect:    (value: Date) => void;
    private readonly _showSeconds: boolean;
    /** Null until the user picks a day or a time. */
    private _value: Date | null = null;

    /** Outer VBox container holding (label, header row, day grid, time row). */
    private _root:       Component;
    private _monthLabel: DateTimePickerMonthLabel;
    private _headerRow:  Component;
    private _dayGrid:    Component;
    private _timeRow:    Component;

    /**
     * @param onSelect - Called with the chosen `Date` when the user updates any field.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: Date) => void, options?: DateTimePickerDropdownOptions) {
        super(options, {
            zIndex:          10050,
            layoutManager:   new Fit(),
            backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
            border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
            insets:          new Insets(6, 6, 6, 6),
        });

        this._onSelect    = onSelect;
        this._showSeconds = options?.showSeconds ?? false;

        this.getAria().setRole("group");
        this.setContain("layout");

        this._root = new Component();
        this._root.setLayoutManager(new VBox({ spacing: 4, stretching: true }));

        this._monthLabel = new DateTimePickerMonthLabel("");
        this._root.addComponent(this._monthLabel);

        this._headerRow = new Component({ preferredSize: { width: 0, height: HEADER_HEIGHT } });
        this._headerRow.setLayoutManager(new Grid({ columns: 7, spacing: 2, stretching: true }));
        for (const dh of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
            this._headerRow.addComponent(new DateTimePickerDayHeader(dh));
        }
        this._root.addComponent(this._headerRow);

        this._dayGrid = new Component({ preferredSize: { width: 0, height: 6 * CELL_HEIGHT + 5 * 2 } });
        this._dayGrid.setLayoutManager(new Grid({ columns: 7, spacing: 2, stretching: true }));
        this._root.addComponent(this._dayGrid);

        this._timeRow = new Component({ preferredSize: { width: 0, height: TIME_ROW_HEIGHT } });
        this._timeRow.setLayoutManager(new HBox({ spacing: 4 }));
        this._root.addComponent(this._timeRow);

        this.addComponent(this._root);

        // Subtree listener so the preventDefault also fires when the click
        // lands on a descendant (e.g. the time-row ComboBox surface). With
        // plain `addListener` it would match only the dropdown's own element,
        // letting clicks on child ComboBoxes blur the host cell editor.
        Event.addSubtreeListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
    }

    /**
     * Suppresses focus loss anywhere inside the panel so the host input
     * doesn't blur before a day or time click is delivered.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Anchors the picker below `anchorEl`, initialises the active value from
     * `selected` (or leaves it null when null), and plays the entrance fade.
     *
     * @param anchorEl - The input the picker anchors to.
     * @param selected - The currently-selected Date, or null.
     */
    showAt(anchorEl: HTMLElement, selected: Date | null): this {
        this._value = selected ? new Date(selected.getTime()) : null;

        this.pauseLayout();
        this.rebuild();
        this.resumeLayout();

        const panelHeight = this.computePanelHeight();
        this.setWidth(this._showSeconds ? PANEL_WIDTH_SECONDS : PANEL_WIDTH);
        this.setHeight(panelHeight);

        this.doLayout();

        this.placeAnchored(anchorEl.getBoundingClientRect());

        this.showAnimated();

        return this;
    }

    /**
     * Sums the fixed-height rows + the time row's actual baseline-aligned
     * height + the dropdown's chrome (insets + border) to produce the panel's
     * outer height.
     *
     * Two non-obvious adjustments over the naïve sum:
     *  - `getPerimiterSize` rather than `getInsets` so the 1-px border counts;
     *  - the time row's true height comes from `getMinSize` (HBox computes its
     *    minimum by baseline-aligning text-bearing children, which can exceed
     *    the explicit `TIME_ROW_HEIGHT` when label and ComboBox text baselines
     *    disagree — VBox then enforces that min). Hard-coding
     *    `TIME_ROW_HEIGHT` here under-sizes the panel by 2 px and clips the
     *    time selector ComboBoxes via the dropdown's `overflow: hidden`.
     */
    private computePanelHeight(): number {
        const perim     = this.getPerimiterSize();
        const rootGap   = 4;
        const dayGridH  = 6 * CELL_HEIGHT + 5 * 2;
        const timeRowH  = this._timeRow.getMinSize()?.height ?? TIME_ROW_HEIGHT;
        const innerH    = MONTH_HEIGHT + rootGap + HEADER_HEIGHT + rootGap + dayGridH + rootGap + timeRowH;

        return perim.top + perim.bottom + innerH;
    }

    /**
     * Rebuilds the day-grid and time-row children for `_value`. The header
     * row and outer scaffolding are constructed once in the constructor and
     * reused.
     */
    private rebuild(): void {
        this._dayGrid.removeAllComponents();
        this._timeRow.removeAllComponents();
        this.buildDateGrid();
        this.buildTimeRow();
    }

    /**
     * Fills the day grid for the month containing `_value` (or today when
     * `_value` is null). Updates the month label.
     */
    private buildDateGrid(): void {
        // When no value is set, anchor the month view on today so the user
        // can navigate; nothing in this anchor is highlighted.
        const anchor = this._value ?? new Date();
        const year   = anchor.getFullYear();
        const month  = anchor.getMonth();

        this._monthLabel.setText(
            anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        );

        const firstOfMonth = new Date(year, month, 1);
        const startWeekday = firstOfMonth.getDay();
        const daysInMonth  = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < startWeekday; i++) {
            this._dayGrid.addComponent(new DateTimePickerBlankCell());
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const cell = new DateTimePickerDay(date, d => this.onDateSelected(d));

            const isSelected = this._value != null
                && this._value.getFullYear() === year
                && this._value.getMonth()    === month
                && this._value.getDate()     === day;

            if (isSelected) {
                cell.setSelected(true);
            }

            this._dayGrid.addComponent(cell);
        }

        const remaining = 42 - startWeekday - daysInMonth;
        for (let i = 0; i < remaining; i++) {
            this._dayGrid.addComponent(new DateTimePickerBlankCell());
        }
    }

    /**
     * Builds the hour/minute (and optional second) selector row.
     */
    private buildTimeRow(): void {
        this._timeRow.addComponent(new DateTimePickerTimeLabel());

        const hourSelect = new DateTimePickerSelect(24, this._value?.getHours() ?? -1, value => {
            const v = this._value ?? this.todayMidnight();
            v.setHours(value, v.getMinutes(), 0, 0);
            this._value = v;
            this.emit();
        });
        this._timeRow.addComponent(hourSelect);
        this._timeRow.addComponent(new DateTimePickerTimeSeparator());

        const minuteSelect = new DateTimePickerSelect(60, this._value?.getMinutes() ?? -1, value => {
            const v = this._value ?? this.todayMidnight();
            v.setHours(v.getHours(), value, v.getSeconds(), 0);
            this._value = v;
            this.emit();
        }, 5);
        this._timeRow.addComponent(minuteSelect);

        if (this._showSeconds) {
            this._timeRow.addComponent(new DateTimePickerTimeSeparator());

            const secondSelect = new DateTimePickerSelect(60, this._value?.getSeconds() ?? -1, value => {
                const v = this._value ?? this.todayMidnight();
                v.setHours(v.getHours(), v.getMinutes(), value, 0);
                this._value = v;
                this.emit();
            }, 5);
            this._timeRow.addComponent(secondSelect);
        }
    }

    /**
     * Returns today's date at 00:00:00.000, used as the seed when the user
     * picks a time before picking a day.
     *
     * @returns A new `Date` for today at midnight.
     */
    private todayMidnight(): Date {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }

    /**
     * Handles a day-cell click. Updates `_value`, emits, and rebuilds so the
     * highlight follows.
     *
     * @param date - The clicked day.
     */
    private onDateSelected(date: Date): void {
        if (!this._value) {
            this._value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        } else {
            this._value.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        }
        this.emit();
        this.rebuild();
        this.doLayout();
    }

    /**
     * Fires the `onSelect` callback with the current value, if any.
     */
    private emit(): void {
        if (this._value) {
            this._onSelect(new Date(this._value.getTime()));
        }
    }
}

const DateTimePickerDropdownCallable = callable(DateTimePickerDropdown);
type DateTimePickerDropdownCallable = DateTimePickerDropdown;
export {
    DateTimePickerDropdown         as _DateTimePickerDropdown,
    DateTimePickerDropdownCallable as DateTimePickerDropdown
};
