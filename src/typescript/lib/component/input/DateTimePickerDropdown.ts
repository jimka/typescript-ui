// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Component } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { ComboBox } from "~/component/input/ComboBox.js";
import { Glyph } from "~/component/display/Glyph.js";
import { chevron_left } from "~/glyphs/solid/chevron_left.js";
import { chevron_right } from "~/glyphs/solid/chevron_right.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { Grid } from "~/layout/Grid.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { PickerCell, PickerColumn } from "~/component/input/PickerColumn.js";
import { callable } from "~/core/Callable.js";

Glyph.register(chevron_left);
Glyph.register(chevron_right);

/** Pixel width of the combined date+time picker panel. */
const PANEL_WIDTH:          number = 240;

/** Pixel width of the combined date+time picker panel when seconds are shown. */
const PANEL_WIDTH_SECONDS:  number = 280;

/** Pixel height of the month-name + year row at the top. */
const MONTH_HEIGHT:         number = 24;
/** Pixel width of each chevron navigation cell on the header row. */
const NAV_BTN_WIDTH:        number = 24;
/** Pixel height of the weekday-name row. */
const HEADER_HEIGHT:        number = 20;
/** Pixel height of each day cell. */
const CELL_HEIGHT:          number = 24;
/** Pixel height of the day grid (6 rows × CELL_HEIGHT + 5 inter-row gaps of 2 px). */
const DAY_GRID_HEIGHT:      number = 6 * CELL_HEIGHT + 5 * 2;
/** Pixel height of the time row at the bottom. */
const TIME_ROW_HEIGHT:      number = 28;
/** Pixel width of each ComboBox in the time row. */
const SELECT_WIDTH:         number = 56;
/** Pixel width of the ":" separator between selects. */
const SEPARATOR_WIDTH:      number = 8;
/** Pixel width of the "Time" label. */
const TIME_LABEL_WIDTH:     number = 36;
/**
 * Default lower bound for the year scroller when no `minDate` is supplied.
 * 120 years back keeps the scroller bounded for "date of birth" style fields.
 */
const DEFAULT_YEAR_SPAN_BACK:    number = 120;
/**
 * Default upper bound for the year scroller when no `maxDate` is supplied.
 * 50 years ahead covers "due date" style use without flooding the scroll
 * region.
 */
const DEFAULT_YEAR_SPAN_FORWARD: number = 50;
/**
 * Idle-timeout for the year-scroller's 4-digit type-ahead buffer. 800 ms is
 * the macOS Finder type-ahead threshold; matches `DatePickerDropdown` so the
 * user experience is identical across the two dropdowns.
 */
const YEAR_TYPE_IDLE_MS:    number = 800;

// Static hover styling. Layout (grid, row stacking, time row) is driven by the
// framework Grid / VBox / HBox managers.
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

    const dayDisabled = new StyleRule({ scope: "selector", name: ".DateTimePickerDay.disabled" });
    dayDisabled.setMany({
        cursor:          "default",
        pointerEvents:   "none",
        color:           "var(--ts-ui-autocomplete-item-disabled-color, rgb(170, 170, 170))",
        backgroundColor: "var(--ts-ui-picker-cell-disabled-bg, transparent)",
    });
    dayDisabled.ensure();

    const navBtn = new StyleRule({ scope: "class", name: "DateTimePickerNavButton" });
    navBtn.setMany({
        cursor:       "pointer",
        borderRadius: "3px",
        color:        "var(--ts-ui-picker-nav-fg, var(--ts-ui-text-color))",
    });
    navBtn.ensure();

    const navBtnHover = new StyleRule({ scope: "selector", name: ".DateTimePickerNavButton:hover" });
    navBtnHover.set("backgroundColor",
        "var(--ts-ui-picker-nav-hover-bg, rgba(30, 100, 200, 0.08))");
    navBtnHover.ensure();
})();

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
 * Header chevron button (←/→). Carries the shared `.DateTimePickerNavButton`
 * class so a single rule controls the hover background + foreground colour.
 * Owns a single child Glyph; click + pointerdown listeners are wired internally.
 */
class DateTimePickerNavButton extends Component {
    /**
     * @param glyphName - Registered glyph key (`"chevron-left"` / `"chevron-right"`).
     * @param onClick - Click handler.
     */
    constructor(glyphName: string, onClick: () => void) {
        super({ preferredSize: { width: NAV_BTN_WIDTH, height: MONTH_HEIGHT } });
        this.setLayoutManager(new Fit());
        this.getAria().setRole("button");

        const glyph = new Glyph(glyphName);
        glyph.setPointerEvents("none");
        glyph.setPreferredSize(12, 12);
        this.addComponent(glyph);

        Event.addListener(this, "pointerdown", (e: PointerEvent) => e.preventDefault());
        Event.addListener(this, "click",       ()                => onClick());
    }

    /**
     * Renders the root element and applies the shared nav-button class.
     *
     * @returns The rendered root element.
     */
    protected render(): HTMLElement {
        const element = super.render();

        element.classList.add("DateTimePickerNavButton");

        return element;
    }
}

/**
 * Month-label-as-button. Same hover/foreground treatment as the chevrons via
 * the shared `.DateTimePickerNavButton` class. Click + pointerdown listeners and
 * the button-affordance aria state are wired internally.
 */
class DateTimePickerMonthLabel extends Text {
    /**
     * @param onClick - Click handler invoked when the user activates the label.
     */
    constructor(onClick: () => void) {
        super("", {
            textAlign:  "center",
            fontWeight: "bold",
        });
        this.setLineHeight(MONTH_HEIGHT);
        this.setCursor("pointer");
        this.getAria().setRole("button");
        this.getAria().setExpanded(false);
        this.getAria().setTabIndex(0);

        Event.addListener(this, "pointerdown", (e: PointerEvent) => e.preventDefault());
        Event.addListener(this, "click",       ()                => onClick());
    }

    /**
     * Renders the root element and applies the shared nav-button class.
     *
     * @returns The rendered root element.
     */
    protected render(): HTMLElement {
        const element = super.render();

        element.classList.add("DateTimePickerNavButton");

        return element;
    }
}

/**
 * A single day cell. Carries selection + disabled state through Component
 * setters; click + pointerdown suppression through `Event.addListener`.
 */
class DateTimePickerDay extends Text {

    private readonly _date:    Date;
    private _selected:         boolean = false;
    private _disabled:         boolean = false;
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
     * Returns the date represented by this cell.
     *
     * @returns The cell's date.
     */
    getDate(): Date {
        return this._date;
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
     * Forwards the cell's date to the owner-supplied click callback. No-op
     * while the cell is disabled.
     */
    private onClick(): void {
        if (this._disabled) {
            return;
        }

        this._onClick(this._date);
    }

    /**
     * Toggles the selected state.
     *
     * @param selected - True to mark this day as the currently-selected one.
     * @returns This component, for method chaining.
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

    /**
     * Returns whether this cell is currently marked as selected.
     *
     * @returns True when this cell is highlighted.
     */
    isSelected(): boolean {
        return this._selected;
    }

    /**
     * Toggles the disabled state. Disabled days are dim, ignore pointer events,
     * and skip the click callback.
     *
     * @param disabled - True to disable the cell.
     * @returns This component, for method chaining.
     */
    setDisabled(disabled: boolean): this {
        if (this._disabled === disabled) {
            return this;
        }

        this._disabled = disabled;

        const element = this.getElement();

        if (element) {
            element.classList.toggle("disabled", disabled);
        }

        return this;
    }

    /**
     * Returns whether this cell is currently disabled.
     *
     * @returns True when this cell is disabled.
     */
    isDisabled(): boolean {
        return this._disabled;
    }

    /**
     * Renders the cell and applies the cached `.disabled` class so the first
     * paint reflects state set before the element was realised.
     *
     * @returns The rendered root element.
     */
    protected render(): HTMLElement {
        const element = super.render();

        if (this._disabled) {
            element.classList.add("disabled");
        }

        return element;
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
    /** Earliest date the picker will allow selection of. Optional. */
    minDate?:     Date | null;
    /** Latest date the picker will allow selection of. Optional. */
    maxDate?:     Date | null;
}

/**
 * Floating combined date + time picker. The date grid (month view) sits above
 * a minimal hour/minute selector.
 *
 * Navigation:
 *  - Month-step `<` / `>` chevrons on the header row.
 *  - Clicking the "May 2026" header swaps the day grid for an in-place year
 *    scroller (the time row stays visible).
 *  - 4-digit type-ahead inside the year scroller jumps to the typed year.
 *  - `minDate` / `maxDate` clamp both the year scroller range and which day
 *    cells are clickable.
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
    /** Currently-displayed month (1st-of-month, time 00:00). Source of truth for the grid. */
    private _monthAnchor: Date = new Date();
    /** True while the year-scroller is replacing the day-grid. */
    private _yearScrollOpen: boolean = false;

    /** Outer VBox container holding (header row, weekday row, day-grid OR year-scroller, time row). */
    private _root:        Component;
    /** Header row containing prev-chevron, month-label-as-button, next-chevron. */
    private _headerRow:   Component;
    private _prevButton:  DateTimePickerNavButton;
    private _nextButton:  DateTimePickerNavButton;
    private _monthLabel:  DateTimePickerMonthLabel;
    private _weekdayRow:  Component;
    private _dayGrid:     Component;
    private _timeRow:     Component;
    private _yearColumn:  PickerColumn | null = null;
    private _highlightedDayIdx: number = -1;
    private _highlightedYear:   number = -1;
    private _yearTypeBuffer: string = "";
    private _yearTypeTimer:  number | null = null;

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

        // Header row: [<] [Month YYYY (button)] [>]
        this._headerRow = new Component({ preferredSize: { width: 0, height: MONTH_HEIGHT } });
        this._headerRow.setLayoutManager(new HBox({ spacing: 2, stretching: true }));

        this._prevButton = new DateTimePickerNavButton("chevron-left",  () => this.prevMonth());
        this._nextButton = new DateTimePickerNavButton("chevron-right", () => this.nextMonth());
        this._monthLabel = new DateTimePickerMonthLabel(() => this.toggleYearScroller());

        // Chevrons take their fixed preferred width from the NavButton constructor;
        // the label takes the remaining width via weight.
        const labelWeight = new LayoutConstraints();
        labelWeight.weight = 1;

        this._headerRow.addComponent(this._prevButton);
        this._headerRow.addComponent(this._monthLabel, labelWeight);
        this._headerRow.addComponent(this._nextButton);

        this._root.addComponent(this._headerRow);

        this._weekdayRow = new Component({ preferredSize: { width: 0, height: HEADER_HEIGHT } });
        this._weekdayRow.setLayoutManager(new Grid({ columns: 7, spacing: 2, stretching: true }));
        for (const dh of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
            this._weekdayRow.addComponent(new DateTimePickerDayHeader(dh));
        }
        this._root.addComponent(this._weekdayRow);

        this._dayGrid = new Component({ preferredSize: { width: 0, height: DAY_GRID_HEIGHT } });
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
     * Applies the {@link DateTimePickerDropdownOptions} bag.
     *
     * @param options - The options bag to apply.
     */
    protected applyOptions(options: DateTimePickerDropdownOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as DateTimePickerDropdownOptions;

        if (opts.minDate !== undefined) {
            this._options.minDate = opts.minDate;
        }

        if (opts.maxDate !== undefined) {
            this._options.maxDate = opts.maxDate;
        }

        return this;
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
        this._value       = selected ? new Date(selected.getTime()) : null;
        const anchor      = this._value ?? new Date();
        this._monthAnchor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        this._highlightedDayIdx = -1;
        this._highlightedYear   = -1;
        this.resetYearTypeBuffer();

        if (this._yearScrollOpen) {
            this.closeYearScroller();
        }

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
     * Cleans up dropdown state when the panel is dismissed. Resets the
     * type-ahead buffer so a stale `"19"` doesn't merge with the next
     * opening's first digit.
     */
    hideAnimated(): this {
        super.hideAnimated();
        this.resetYearTypeBuffer();

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
        const timeRowH  = this._timeRow.getMinSize()?.height ?? TIME_ROW_HEIGHT;
        const innerH    = MONTH_HEIGHT + rootGap + HEADER_HEIGHT + rootGap + DAY_GRID_HEIGHT + rootGap + timeRowH;

        return perim.top + perim.bottom + innerH;
    }

    /**
     * Rebuilds the day-grid and time-row children. The header row, weekday
     * row, and outer scaffolding are constructed once in the constructor.
     */
    private rebuild(): void {
        this._dayGrid.removeAllComponents();
        this._timeRow.removeAllComponents();
        this.buildDateGrid();
        this.buildTimeRow();
    }

    /**
     * Fills the day grid for the month containing `_monthAnchor`. Updates the
     * month label and respects `minDate` / `maxDate` bounds.
     */
    private buildDateGrid(): void {
        this._dayGrid.removeAllComponents();
        this._highlightedDayIdx = -1;

        const year   = this._monthAnchor.getFullYear();
        const month  = this._monthAnchor.getMonth();

        this._monthLabel.setText(
            this._monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
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

            if (!this.isDateInRange(date)) {
                cell.setDisabled(true);
            }

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
     * Returns true when `date` falls within (or equal to) the configured
     * `minDate` and `maxDate` bounds.
     *
     * @param date - The date to test.
     * @returns True when `date` is allowed.
     */
    private isDateInRange(date: Date): boolean {
        const minDate = this._options.minDate ?? null;
        const maxDate = this._options.maxDate ?? null;

        if (minDate && date.getTime() < dayStart(minDate).getTime()) {
            return false;
        }

        if (maxDate && date.getTime() > dayEnd(maxDate).getTime()) {
            return false;
        }

        return true;
    }

    /**
     * Returns true when at least one day in `monthAnchor`'s month is within
     * range — used by the month chevrons to refuse advancing into a fully
     * out-of-bounds month.
     *
     * @param monthAnchor - 1st-of-month for the candidate month.
     * @returns True when at least one day in that month is in range.
     */
    private hasAnyInRange(monthAnchor: Date): boolean {
        const year  = monthAnchor.getFullYear();
        const month = monthAnchor.getMonth();
        const last  = new Date(year, month + 1, 0).getDate();
        const firstDay = new Date(year, month, 1);
        const lastDay  = new Date(year, month, last);
        const minDate  = this._options.minDate ?? null;
        const maxDate  = this._options.maxDate ?? null;

        if (minDate && dayEnd(lastDay).getTime() < dayStart(minDate).getTime()) {
            return false;
        }

        if (maxDate && dayStart(firstDay).getTime() > dayEnd(maxDate).getTime()) {
            return false;
        }

        return true;
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
     * Handles a day-cell click. Updates `_value`, advances `_monthAnchor` to
     * the new month, emits, and rebuilds so the highlight follows.
     *
     * @param date - The clicked day.
     */
    private onDateSelected(date: Date): void {
        if (!this._value) {
            this._value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        } else {
            this._value.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        }

        this._monthAnchor = new Date(date.getFullYear(), date.getMonth(), 1);
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

    /**
     * Advances `_monthAnchor` by `-1` month and rebuilds the grid. No-op when
     * the previous month is fully out of range.
     */
    private prevMonth(): void {
        const candidate = new Date(this._monthAnchor.getFullYear(), this._monthAnchor.getMonth() - 1, 1);

        if (!this.hasAnyInRange(candidate)) {
            return;
        }

        this._monthAnchor = candidate;

        if (this._yearScrollOpen) {
            this.updateMonthLabel();
            this.refreshYearSelection();
        } else {
            this.buildDateGrid();
            this.doLayout();
        }
    }

    /**
     * Advances `_monthAnchor` by `+1` month and rebuilds the grid. No-op when
     * the next month is fully out of range.
     */
    private nextMonth(): void {
        const candidate = new Date(this._monthAnchor.getFullYear(), this._monthAnchor.getMonth() + 1, 1);

        if (!this.hasAnyInRange(candidate)) {
            return;
        }

        this._monthAnchor = candidate;

        if (this._yearScrollOpen) {
            this.updateMonthLabel();
            this.refreshYearSelection();
        } else {
            this.buildDateGrid();
            this.doLayout();
        }
    }

    /**
     * Re-renders just the header label after `_monthAnchor` moves.
     */
    private updateMonthLabel(): void {
        this._monthLabel.setText(
            this._monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        );
    }

    /**
     * Toggles the year scroller in place of the day grid. The header row and
     * the time row stay visible.
     */
    private toggleYearScroller(): void {
        if (this._yearScrollOpen) {
            this.closeYearScroller();
        } else {
            this.openYearScroller();
        }
    }

    /**
     * Opens the year scroller: removes the day grid, builds/rebuilds the year
     * column, swaps it in, and centres the active year.
     */
    private openYearScroller(): void {
        if (!this._yearColumn) {
            this._yearColumn = new PickerColumn(null);
            this._yearColumn.setPreferredSize(0, DAY_GRID_HEIGHT);
            this._yearColumn.getAria().setRole("listbox");
        }

        this.buildYearScroller();

        // The day grid is sandwiched between the weekday row and the time row.
        // Swap in the year column at the same slot so the time row stays
        // anchored at the bottom of the panel.
        this._root.removeComponent(this._dayGrid);
        // Inserting after the weekday row keeps the time row in place because
        // `addComponent` appends to the end; we re-add the time row after the
        // year column to preserve order.
        this._root.removeComponent(this._timeRow);
        this._root.addComponent(this._yearColumn);
        this._root.addComponent(this._timeRow);

        this._yearScrollOpen = true;
        this._monthLabel.getAria().setExpanded(true);

        this.doLayout();
        this._yearColumn.scrollSelectedIntoView();
    }

    /**
     * Closes the year scroller and restores the day grid. Re-applies the
     * selection so the highlight survives a year change.
     */
    private closeYearScroller(): void {
        if (this._yearColumn) {
            this._root.removeComponent(this._yearColumn);
        }

        // Same dance as `openYearScroller` — re-insert the day grid before the
        // time row so the visual order is restored.
        this._root.removeComponent(this._timeRow);
        this._root.addComponent(this._dayGrid);
        this._root.addComponent(this._timeRow);

        this._yearScrollOpen = false;
        this._monthLabel.getAria().setExpanded(false);
        this.resetYearTypeBuffer();

        this.buildDateGrid();
        this.doLayout();
    }

    /**
     * Populates `_yearColumn` for the legal year range.
     */
    private buildYearScroller(): void {
        if (!this._yearColumn) {
            return;
        }

        this._yearColumn.clearCells();
        this._highlightedYear = -1;

        const today    = new Date();
        const minYear  = this._options.minDate?.getFullYear() ?? today.getFullYear() - DEFAULT_YEAR_SPAN_BACK;
        const maxYear  = this._options.maxDate?.getFullYear() ?? today.getFullYear() + DEFAULT_YEAR_SPAN_FORWARD;
        const activeY  = this._monthAnchor.getFullYear();

        for (let y = minYear; y <= maxYear; y++) {
            const year = y;
            const cell = new PickerCell(String(year), () => this.onYearSelected(year));

            if (year === activeY) {
                cell.setSelected(true);
            }

            this._yearColumn.addCell(cell);
        }
    }

    /**
     * Updates the year scroller's selection highlight after a month-arrow
     * change moved `_monthAnchor` into a different year.
     */
    private refreshYearSelection(): void {
        if (!this._yearColumn) {
            return;
        }

        const activeY = this._monthAnchor.getFullYear();

        for (const child of this._yearColumn.getCellList().getComponents()) {
            if (child instanceof PickerCell) {
                child.setSelected(child.getText().valueOf() === String(activeY));
            }
        }
    }

    /**
     * Year-cell click handler. Updates `_monthAnchor` (and `_value` so the
     * highlight follows when a date is already selected), closes the scroller
     * and rebuilds.
     *
     * @param year - The chosen year.
     */
    private onYearSelected(year: number): void {
        this._monthAnchor = new Date(year, this._monthAnchor.getMonth(), 1);

        if (this._value) {
            this._value.setFullYear(year);
            this.emit();
        }

        this.closeYearScroller();
    }

    /**
     * Resets the year-scroller's 4-digit type-ahead buffer and clears any
     * pending idle timer.
     */
    private resetYearTypeBuffer(): void {
        this._yearTypeBuffer = "";

        if (this._yearTypeTimer !== null) {
            window.clearTimeout(this._yearTypeTimer);
            this._yearTypeTimer = null;
        }
    }

    /**
     * Keyboard router. Returns `true` when the event was handled.
     *
     * @param e - The keyboard event.
     * @returns True when handled.
     */
    handleKey(e: KeyboardEvent): boolean {
        if (!this.isOpen()) {
            return false;
        }

        if (this._yearScrollOpen) {
            return this.handleKeyInYearScroller(e);
        }

        return this.handleKeyInDayGrid(e);
    }

    /**
     * Routes the keystroke when the day grid is visible.
     *
     * @param e - The keyboard event.
     * @returns True when handled.
     */
    private handleKeyInDayGrid(e: KeyboardEvent): boolean {
        switch (e.key) {
            case "ArrowLeft":
                return this.moveHighlightedDay(-1);
            case "ArrowRight":
                return this.moveHighlightedDay(1);
            case "ArrowUp":
                return this.moveHighlightedDay(-7);
            case "ArrowDown":
                return this.moveHighlightedDay(7);
            case "PageUp":
                this.prevMonth();
                return true;
            case "PageDown":
                this.nextMonth();
                return true;
            case "Home":
                return this.highlightFirstDayOfMonth();
            case "End":
                return this.highlightLastDayOfMonth();
            case "Enter":
            case " ":
                return this.commitHighlightedDay();
            default:
                return false;
        }
    }

    /**
     * Returns the children of `_dayGrid` as a typed array.
     *
     * @returns The grid's day cells in DOM order. Includes blank-cell entries.
     */
    private getDayGridChildren(): Component[] {
        return this._dayGrid.getComponents();
    }

    /**
     * Moves the keyboard-highlighted day cell by `delta` positions.
     *
     * @param delta - Positive or negative step.
     * @returns Always true.
     */
    private moveHighlightedDay(delta: number): boolean {
        const children = this.getDayGridChildren();
        const dayCells: { idx: number; cell: DateTimePickerDay }[] = [];

        for (let i = 0; i < children.length; i++) {
            const c = children[i];
            if (c instanceof DateTimePickerDay && !c.isDisabled()) {
                dayCells.push({ idx: i, cell: c });
            }
        }

        if (dayCells.length === 0) {
            return true;
        }

        let currentPos = -1;
        for (let i = 0; i < dayCells.length; i++) {
            if (dayCells[i].idx === this._highlightedDayIdx) {
                currentPos = i;
                break;
            }
        }

        if (currentPos < 0) {
            currentPos = 0;

            for (let i = 0; i < dayCells.length; i++) {
                if (dayCells[i].cell.isSelected()) {
                    currentPos = i;
                    break;
                }
            }
        }

        const newPos = Math.max(0, Math.min(dayCells.length - 1, currentPos + delta));
        this.setHighlightedDay(dayCells[newPos].idx);

        return true;
    }

    /**
     * Sets the keyboard highlight on the day cell at the given grid index.
     *
     * @param newIdx - Grid index of the cell to highlight.
     */
    private setHighlightedDay(newIdx: number): void {
        const children = this.getDayGridChildren();

        if (this._highlightedDayIdx >= 0 && this._highlightedDayIdx < children.length) {
            const prev = children[this._highlightedDayIdx];

            if (prev instanceof DateTimePickerDay && !this.matchesSelection(prev)) {
                prev.setSelected(false);
            }
        }

        if (newIdx < 0 || newIdx >= children.length) {
            this._highlightedDayIdx = -1;

            return;
        }

        const cell = children[newIdx];

        if (cell instanceof DateTimePickerDay) {
            cell.setSelected(true);
            this._highlightedDayIdx = newIdx;
        }
    }

    /**
     * True when `cell`'s date matches the currently-selected date.
     *
     * @param cell - The day cell to test.
     * @returns True when the cell represents the currently-selected date.
     */
    private matchesSelection(cell: DateTimePickerDay): boolean {
        if (!this._value) {
            return false;
        }

        const d = cell.getDate();

        return d.getFullYear() === this._value.getFullYear()
            && d.getMonth()    === this._value.getMonth()
            && d.getDate()     === this._value.getDate();
    }

    /**
     * Jumps the highlight to the first in-range day of the current month.
     *
     * @returns Always true.
     */
    private highlightFirstDayOfMonth(): boolean {
        const children = this.getDayGridChildren();

        for (let i = 0; i < children.length; i++) {
            const c = children[i];
            if (c instanceof DateTimePickerDay && !c.isDisabled()) {
                this.setHighlightedDay(i);

                return true;
            }
        }

        return true;
    }

    /**
     * Jumps the highlight to the last in-range day of the current month.
     *
     * @returns Always true.
     */
    private highlightLastDayOfMonth(): boolean {
        const children = this.getDayGridChildren();

        for (let i = children.length - 1; i >= 0; i--) {
            const c = children[i];
            if (c instanceof DateTimePickerDay && !c.isDisabled()) {
                this.setHighlightedDay(i);

                return true;
            }
        }

        return true;
    }

    /**
     * Commits the highlighted day as if the user had clicked it.
     *
     * @returns True when a day was committed.
     */
    private commitHighlightedDay(): boolean {
        if (this._highlightedDayIdx < 0) {
            return false;
        }

        const children = this.getDayGridChildren();
        const cell     = children[this._highlightedDayIdx];

        if (cell instanceof DateTimePickerDay && !cell.isDisabled()) {
            this.onDateSelected(cell.getDate());

            return true;
        }

        return false;
    }

    /**
     * Routes the keystroke when the year scroller is visible.
     *
     * @param e - The keyboard event.
     * @returns True when handled.
     */
    private handleKeyInYearScroller(e: KeyboardEvent): boolean {
        if (/^[0-9]$/.test(e.key)) {
            return this.appendYearDigit(e.key);
        }

        switch (e.key) {
            case "ArrowLeft":
            case "ArrowUp":
                return this.moveHighlightedYear(-1);
            case "ArrowRight":
            case "ArrowDown":
                return this.moveHighlightedYear(1);
            case "PageUp":
                return this.moveHighlightedYear(-10);
            case "PageDown":
                return this.moveHighlightedYear(10);
            case "Home":
                return this.highlightFirstYear();
            case "End":
                return this.highlightLastYear();
            case "Enter":
            case " ":
                return this.commitHighlightedYear();
            case "Escape":
                this.closeYearScroller();
                return true;
            default:
                return false;
        }
    }

    /**
     * Returns the year cells in the scroller.
     *
     * @returns PickerCell entries from the scroller's cell list.
     */
    private getYearCells(): PickerCell[] {
        if (!this._yearColumn) {
            return [];
        }

        const cells: PickerCell[] = [];

        for (const c of this._yearColumn.getCellList().getComponents()) {
            if (c instanceof PickerCell) {
                cells.push(c);
            }
        }

        return cells;
    }

    /**
     * Moves the year-scroller highlight by `delta` cells.
     *
     * @param delta - Step size (positive = down/later years, negative = up/earlier).
     * @returns Always true.
     */
    private moveHighlightedYear(delta: number): boolean {
        const cells = this.getYearCells();

        if (cells.length === 0) {
            return true;
        }

        const currentPos = this.findHighlightedYearPos(cells);
        const newPos     = Math.max(0, Math.min(cells.length - 1, currentPos + delta));

        this.applyYearHighlight(cells, newPos);

        return true;
    }

    /**
     * Returns the cell position of the highlighted year.
     *
     * @param cells - Snapshot of the scroller's cell list.
     * @returns Position in the cells array; 0 when nothing matches.
     */
    private findHighlightedYearPos(cells: PickerCell[]): number {
        if (this._highlightedYear < 0) {
            for (let i = 0; i < cells.length; i++) {
                if (cells[i].isSelected()) {
                    return i;
                }
            }

            return 0;
        }

        for (let i = 0; i < cells.length; i++) {
            if (cells[i].getText().valueOf() === String(this._highlightedYear)) {
                return i;
            }
        }

        return 0;
    }

    /**
     * Sets the visual highlight on cell `pos` and remembers the year.
     *
     * @param cells - Snapshot of the scroller's cell list.
     * @param pos - Index of the cell to highlight.
     */
    private applyYearHighlight(cells: PickerCell[], pos: number): void {
        const activeY = this._monthAnchor.getFullYear();

        for (const c of cells) {
            c.setSelected(c.getText().valueOf() === String(activeY));
        }

        cells[pos].setSelected(true);
        this._highlightedYear = parseInt(cells[pos].getText().valueOf(), 10);

        if (this._yearColumn) {
            this._yearColumn.scrollSelectedIntoView();
        }
    }

    /**
     * Jumps the highlight to the first year cell.
     *
     * @returns Always true.
     */
    private highlightFirstYear(): boolean {
        const cells = this.getYearCells();

        if (cells.length === 0) {
            return true;
        }

        this.applyYearHighlight(cells, 0);

        return true;
    }

    /**
     * Jumps the highlight to the last year cell.
     *
     * @returns Always true.
     */
    private highlightLastYear(): boolean {
        const cells = this.getYearCells();

        if (cells.length === 0) {
            return true;
        }

        this.applyYearHighlight(cells, cells.length - 1);

        return true;
    }

    /**
     * Commits the highlighted year as if the user had clicked it.
     *
     * @returns Always true.
     */
    private commitHighlightedYear(): boolean {
        const year = this._highlightedYear >= 0
            ? this._highlightedYear
            : this._monthAnchor.getFullYear();

        this.onYearSelected(year);

        return true;
    }

    /**
     * Appends a digit to the type-ahead buffer; resets after `YEAR_TYPE_IDLE_MS`
     * ms idle or 4 digits. Jumps to the prefix-matched year as soon as one
     * exists.
     *
     * @param digit - The single decimal digit pressed.
     * @returns Always true.
     */
    private appendYearDigit(digit: string): boolean {
        if (this._yearTypeBuffer.length >= 4) {
            this._yearTypeBuffer = "";
        }

        this._yearTypeBuffer += digit;

        if (this._yearTypeTimer !== null) {
            window.clearTimeout(this._yearTypeTimer);
        }

        this._yearTypeTimer = window.setTimeout(() => this.resetYearTypeBuffer(), YEAR_TYPE_IDLE_MS);

        const cells = this.getYearCells();
        const buf   = this._yearTypeBuffer;
        let target  = -1;

        for (let i = 0; i < cells.length; i++) {
            if (cells[i].getText().valueOf().startsWith(buf)) {
                target = i;
                break;
            }
        }

        if (target >= 0) {
            this.applyYearHighlight(cells, target);
        }

        if (buf.length === 4) {
            this.resetYearTypeBuffer();
        }

        return true;
    }
}

/**
 * Returns midnight at the start of `date`'s local day.
 *
 * @param date - The date whose day-start is wanted.
 * @returns A new `Date` at 00:00:00 local time on the same day.
 */
function dayStart(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/**
 * Returns the last instant of `date`'s local day (23:59:59.999).
 *
 * @param date - The date whose day-end is wanted.
 * @returns A new `Date` at 23:59:59.999 local time on the same day.
 */
function dayEnd(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

const DateTimePickerDropdownCallable = callable(DateTimePickerDropdown);
type DateTimePickerDropdownCallable = DateTimePickerDropdown;
export {
    DateTimePickerDropdown         as _DateTimePickerDropdown,
    DateTimePickerDropdownCallable as DateTimePickerDropdown
};
