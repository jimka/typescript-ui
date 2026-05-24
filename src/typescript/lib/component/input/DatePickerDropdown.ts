// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Component } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
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

/** Pixel width of the calendar grid. */
const PANEL_WIDTH:    number = 240;
/** Pixel height of the month-name + year row at the top. */
const MONTH_HEIGHT:   number = 24;
/** Pixel width of each chevron navigation cell on the header row. */
const NAV_BTN_WIDTH:  number = 24;
/** Pixel height of the weekday-name row. */
const HEADER_HEIGHT:  number = 20;
/** Pixel height of each day cell (and each empty leading cell). */
const CELL_HEIGHT:    number = 24;
/** Pixel height of the day grid (6 rows × CELL_HEIGHT + 5 inter-row gaps of 2 px). */
const DAY_GRID_HEIGHT: number = 6 * CELL_HEIGHT + 5 * 2;
/**
 * Default lower bound for the year scroller when no `minDate` is supplied.
 * 120 years back keeps the scroller bounded for "date of birth" style fields.
 */
const DEFAULT_YEAR_SPAN_BACK:    number = 120;
/**
 * Default upper bound for the year scroller when no `maxDate` is supplied.
 * 50 years ahead covers "due date" / "subscription expiry" use without flooding
 * the scrollable region.
 */
const DEFAULT_YEAR_SPAN_FORWARD: number = 50;
/**
 * Idle-timeout for the year-scroller's 4-digit type-ahead buffer. 800 ms is the
 * macOS Finder type-ahead threshold (ComboBox uses the same value), so users
 * who pause briefly mid-typing pick up where they left off rather than the
 * buffer resetting underneath them.
 */
const YEAR_TYPE_IDLE_MS: number = 800;

// Static hover / cursor styling only. All layout (grid, row stacking) is driven
// by the framework Grid / VBox managers — no display:flex/grid here.
(() => {
    const day = new StyleRule({ scope: "class", name: "DatePickerDay" });
    day.setMany({
        cursor:       "pointer",
        borderRadius: "3px",
    });
    day.ensure();

    const dayHover = new StyleRule({ scope: "selector", name: ".DatePickerDay:hover" });
    dayHover.set("backgroundColor",
        "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))");
    dayHover.ensure();

    // Out-of-range day cells dim and ignore pointer events. Mirrors
    // `.PickerCell.disabled` so the year-scroller and day-grid look identical
    // when the user is at the bound's edge.
    const dayDisabled = new StyleRule({ scope: "selector", name: ".DatePickerDay.disabled" });
    dayDisabled.setMany({
        cursor:          "default",
        pointerEvents:   "none",
        color:           "var(--ts-ui-autocomplete-item-disabled-color, rgb(170, 170, 170))",
        backgroundColor: "var(--ts-ui-picker-cell-disabled-bg, transparent)",
    });
    dayDisabled.ensure();

    // Header chevron + month-label-as-button styling — single hover background,
    // shared by the chevrons and the label. The cursor is set per-cell (label
    // gets pointer; chevrons get pointer) so that screen readers see a button
    // affordance.
    const navBtn = new StyleRule({ scope: "class", name: "DatePickerNavButton" });
    navBtn.setMany({
        cursor:       "pointer",
        borderRadius: "3px",
        color:        "var(--ts-ui-picker-nav-fg, var(--ts-ui-text-color))",
    });
    navBtn.ensure();

    const navBtnHover = new StyleRule({ scope: "selector", name: ".DatePickerNavButton:hover" });
    navBtnHover.set("backgroundColor",
        "var(--ts-ui-picker-nav-hover-bg, rgba(30, 100, 200, 0.08))");
    navBtnHover.ensure();
})();

/** Weekday name header cell ("Sun", "Mon", …). */
class DatePickerDayHeader extends Text {
    /**
     * @param text - Header label (`"Sun"`, `"Mon"`, …).
     */
    constructor(text: string) {
        super(text, {
            textAlign:     "center",
            fontSize:      12,
            preferredSize: { width: 0, height: HEADER_HEIGHT },
        });
        this.setLineHeight(HEADER_HEIGHT);
    }
}

/**
 * Header chevron button (←/→). Carries the shared `.DatePickerNavButton`
 * class so a single CSS rule covers the chevron and the month-label-as-button
 * hover state. Owns a single child Glyph; click + pointerdown listeners are
 * wired internally.
 */
class DatePickerNavButton extends Component {
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
        // Constrain the glyph so the chevron stays a visual icon — the surrounding
        // 24-px button cell holds the click target.
        glyph.setPreferredSize(12, 12);
        this.addComponent(glyph);

        Event.addListener(this, "pointerdown", (e: PointerEvent) => e.preventDefault());
        Event.addListener(this, "click",       ()                => onClick());
    }

    /**
     * Renders the root element and applies the shared nav-button class so a
     * single rule controls the hover background + foreground colour.
     *
     * @returns The rendered root element.
     */
    protected render(): HTMLElement {
        const element = super.render();

        element.classList.add("DatePickerNavButton");

        return element;
    }
}

/**
 * Month-label-as-button. Same hover/foreground treatment as the chevrons via
 * the shared `.DatePickerNavButton` class. Click + pointerdown listeners and
 * the button-affordance aria state are wired internally.
 */
class DatePickerMonthLabel extends Text {
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
     * Renders the root element and applies the shared nav-button class so a
     * single rule controls the hover background + foreground colour.
     *
     * @returns The rendered root element.
     */
    protected render(): HTMLElement {
        const element = super.render();

        element.classList.add("DatePickerNavButton");

        return element;
    }
}

/**
 * Empty cell shown before the first day of the month (and trailing the last)
 * so the day grid always renders as a full 6-row block.
 */
class DatePickerBlankCell extends Component {
    constructor() {
        super({ preferredSize: { width: 0, height: CELL_HEIGHT } });
    }
}

/**
 * A single day cell. Carries selection + disabled state through Component
 * setters, and click + pointerdown suppression through `Event.addListener`.
 * Static styling and the hover effect live on the `.DatePickerDay` /
 * `.DatePickerDay:hover` class rules; the dim out-of-range look comes from
 * `.DatePickerDay.disabled` (matching the shared `.PickerCell.disabled`).
 */
class DatePickerDay extends Text {

    private readonly _date:    Date;
    private _selected:         boolean = false;
    private _disabled:         boolean = false;
    private readonly _onClick: (date: Date) => void;

    /**
     * @param date - The day represented by this cell.
     * @param onClick - Called with `date` when the cell is clicked. Suppressed while disabled.
     */
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
     * while the cell is disabled (out of range).
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
     * @returns True when this cell is highlighted as the active selection.
     */
    isSelected(): boolean {
        return this._selected;
    }

    /**
     * Toggles the disabled state. Disabled days are dim, ignore pointer events,
     * and skip the constructor-supplied click callback.
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
     * Returns whether this cell is currently disabled (out of allowed range).
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

/**
 * Construction-time options for {@link DatePickerDropdown}.
 *
 * @category Components
 */
export interface DatePickerDropdownOptions extends AnimatedDropdownOptions {
    /** Earliest date the picker will allow selection of. Optional. */
    minDate?: Date | null;
    /** Latest date the picker will allow selection of. Optional. */
    maxDate?: Date | null;
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
 * Inherits the fade lifecycle from
 * [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown).
 *
 * @category Components
 */
class DatePickerDropdown extends AnimatedDropdown<DatePickerDropdownOptions> {

    private readonly _onSelect: (value: Date) => void;
    /** Currently-displayed month (1st-of-month, time 00:00). Source of truth for the grid. */
    private _monthAnchor:  Date = new Date();
    /** Last value passed to `showAt`, retained so re-rendering the grid can re-apply the highlight. */
    private _selected:     Date | null = null;
    /** True while the year-scroller is replacing the day-grid in the panel. */
    private _yearScrollOpen: boolean = false;
    /** Outer VBox container holding header row, weekday row, and day-grid OR year-scroller. */
    private _root:         Component;
    /** Header row containing prev-chevron, month-label-as-button, next-chevron. */
    private _headerRow:    Component;
    private _prevButton:   DatePickerNavButton;
    private _nextButton:   DatePickerNavButton;
    private _monthLabel:   DatePickerMonthLabel;
    /** Inner Grid container holding the weekday header cells. */
    private _weekdayRow:   Component;
    /** Inner Grid container holding the day / blank cells. Swapped out while the year scroller is open. */
    private _dayGrid:      Component;
    /** Lazily-built year scroller; null until the user first opens it. */
    private _yearColumn:   PickerColumn | null = null;
    /** Index in `_dayGrid` children of the highlighted cell, for keyboard nav. -1 when no cell is highlighted. */
    private _highlightedDayIdx: number = -1;
    /** Highlighted year in the year scroller, -1 when none. */
    private _highlightedYear:   number = -1;
    /** Type-ahead buffer for the year scroller (digits only, max length 4). */
    private _yearTypeBuffer: string = "";
    /** Timer id for the type-ahead idle reset, or null. */
    private _yearTypeTimer:  number | null = null;

    /**
     * @param onSelect - Called with the chosen `Date` when the user picks a day.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: Date) => void, options?: DatePickerDropdownOptions) {
        super(options, {
            zIndex:          10050,
            layoutManager:   new Fit(),
            backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
            border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
            insets:          new Insets(6, 6, 6, 6),
        });

        this._onSelect = onSelect;

        this.getAria().setRole("group");
        this.setContain("layout");

        this._root = new Component();
        this._root.setLayoutManager(new VBox({ spacing: 4, stretching: true }));

        // Header row: [<] [Month YYYY (button)] [>]
        this._headerRow = new Component({ preferredSize: { width: 0, height: MONTH_HEIGHT } });
        this._headerRow.setLayoutManager(new HBox({ spacing: 2, stretching: true }));

        this._prevButton = new DatePickerNavButton("chevron-left",  () => this.prevMonth());
        this._nextButton = new DatePickerNavButton("chevron-right", () => this.nextMonth());
        this._monthLabel = new DatePickerMonthLabel(() => this.toggleYearScroller());

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
            this._weekdayRow.addComponent(new DatePickerDayHeader(dh));
        }
        this._root.addComponent(this._weekdayRow);

        this._dayGrid = new Component({ preferredSize: { width: 0, height: DAY_GRID_HEIGHT } });
        this._dayGrid.setLayoutManager(new Grid({ columns: 7, spacing: 2, stretching: true }));
        this._root.addComponent(this._dayGrid);

        this.addComponent(this._root);

        // Suppress focus loss anywhere inside the panel — protects pooled
        // cell editors whose blur listener would otherwise commit before
        // the day-click fires. Uses `addSubtreeListener` so the guard fires
        // for events landing on descendants too, not just the dropdown root.
        Event.addSubtreeListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
    }

    /**
     * Applies the {@link DatePickerDropdownOptions} bag. The min/max date
     * fields are pure cache writes here — they are read at year-scroller and
     * day-grid build time.
     *
     * @param options - The options bag to apply.
     */
    protected applyOptions(options: DatePickerDropdownOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as DatePickerDropdownOptions;

        if (opts.minDate !== undefined) {
            this._options.minDate = opts.minDate;
        }

        if (opts.maxDate !== undefined) {
            this._options.maxDate = opts.maxDate;
        }

        return this;
    }

    /**
     * Suppresses focus loss while the user is interacting with the panel.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Anchors the picker below `anchorEl`, builds the grid for the month
     * containing `selected` (or today when null), and plays the entrance fade.
     *
     * @param anchorEl - The input the picker anchors to.
     * @param selected - The currently-selected date, or null.
     */
    showAt(anchorEl: HTMLElement, selected: Date | null): this {
        this._selected    = selected;
        this._monthAnchor = selected
            ? new Date(selected.getFullYear(), selected.getMonth(), 1)
            : new Date();
        this._highlightedDayIdx = -1;
        this._highlightedYear   = -1;
        this.resetYearTypeBuffer();
        // Reset the swap so consecutive opens always start on the day grid.
        if (this._yearScrollOpen) {
            this.closeYearScroller();
        }

        this.pauseLayout();
        this.buildGrid();
        this.resumeLayout();

        const panelHeight = this.computePanelHeight();
        this.setWidth(PANEL_WIDTH);
        this.setHeight(panelHeight);

        this.doLayout();

        this.placeAnchored(anchorEl.getBoundingClientRect());

        this.showAnimated();

        return this;
    }

    /**
     * Cleans up dropdown state when the panel is dismissed (Escape, outside
     * click, or programmatic close). Resets the type-ahead buffer so a stale
     * `"19"` doesn't merge with the next opening's first digit.
     */
    hideAnimated(): this {
        super.hideAnimated();
        this.resetYearTypeBuffer();

        return this;
    }

    /**
     * Sums the fixed-height rows + the panel's insets to produce the panel's
     * outer height. Avoids forcing a DOM measurement.
     *
     * @returns Panel outer height in pixels.
     */
    private computePanelHeight(): number {
        const insets    = this.getInsets();
        const rootGap   = 4;
        const innerH    = MONTH_HEIGHT + rootGap + HEADER_HEIGHT + rootGap + DAY_GRID_HEIGHT;

        return insets.getTop() + insets.getBottom() + innerH;
    }

    /**
     * Rebuilds the day-grid children for `_monthAnchor`. The header row and
     * outer scaffolding are constructed once in the constructor and reused.
     */
    private buildGrid(): void {
        this._dayGrid.removeAllComponents();
        this._highlightedDayIdx = -1;

        const year  = this._monthAnchor.getFullYear();
        const month = this._monthAnchor.getMonth();

        this._monthLabel.setText(
            this._monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        );

        const firstOfMonth = new Date(year, month, 1);
        const startWeekday = firstOfMonth.getDay();
        const daysInMonth  = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < startWeekday; i++) {
            this._dayGrid.addComponent(new DatePickerBlankCell());
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const cell = new DatePickerDay(date, d => this.onDateSelected(d));

            if (!this.isDateInRange(date)) {
                cell.setDisabled(true);
            }

            const isSelected = this._selected != null
                && this._selected.getFullYear() === year
                && this._selected.getMonth()    === month
                && this._selected.getDate()     === day;

            if (isSelected) {
                cell.setSelected(true);
            }

            this._dayGrid.addComponent(cell);
        }

        // Pad to 42 cells (6 rows × 7) so the Grid renders a uniform block.
        const remaining = 42 - startWeekday - daysInMonth;
        for (let i = 0; i < remaining; i++) {
            this._dayGrid.addComponent(new DatePickerBlankCell());
        }
    }

    /**
     * Returns true when `date` falls within (or equal to) the configured
     * `minDate` and `maxDate` bounds. Both bounds are optional; an absent
     * bound is treated as ±∞.
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

        // Cheaper than scanning every day: a month is fully out-of-range only if
        // its last day is before `minDate` or its first day is after `maxDate`.
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
     * Day-cell click handler. Records selection, fires the constructor
     * callback, and refreshes the grid so the highlight follows.
     *
     * @param date - The chosen day.
     */
    private onDateSelected(date: Date): void {
        this._selected = date;
        this._onSelect(date);
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
            // Switching months while the scroller is open is allowed; just
            // re-render the header label and rebuild the scroller's selection.
            this.updateMonthLabel();
            this.refreshYearSelection();
        } else {
            this.buildGrid();
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
            this.buildGrid();
            this.doLayout();
        }
    }

    /**
     * Re-renders just the header label after `_monthAnchor` moves. Kept
     * separate from `buildGrid` so month-arrow clicks made while the year
     * scroller is open don't tear down the scroller.
     */
    private updateMonthLabel(): void {
        this._monthLabel.setText(
            this._monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        );
    }

    /**
     * Toggles the year scroller in place of the day grid. The header row
     * stays visible so the user can still see which month they're picking
     * a year for.
     */
    private toggleYearScroller(): void {
        if (this._yearScrollOpen) {
            this.closeYearScroller();
        } else {
            this.openYearScroller();
        }
    }

    /**
     * Opens the year scroller: removes the day grid from the panel, builds /
     * rebuilds the year column, swaps it in, and centres the active year.
     */
    private openYearScroller(): void {
        if (!this._yearColumn) {
            this._yearColumn = new PickerColumn(null);
            // Match the day-grid's height slot so the panel doesn't resize on swap.
            this._yearColumn.setPreferredSize(0, DAY_GRID_HEIGHT);
            this._yearColumn.getAria().setRole("listbox");
        }

        this.buildYearScroller();

        this._root.removeComponent(this._dayGrid);
        this._root.addComponent(this._yearColumn);

        this._yearScrollOpen = true;
        this._monthLabel.getAria().setExpanded(true);

        this.doLayout();
        // After layout commits the cells acquire their offsetTop; only then can
        // we centre the active year mid-viewport.
        this._yearColumn.scrollSelectedIntoView();
    }

    /**
     * Closes the year scroller and restores the day grid. Re-applies the
     * selection so the highlight survives a year change that happened inside
     * the scroller.
     */
    private closeYearScroller(): void {
        if (this._yearColumn) {
            this._root.removeComponent(this._yearColumn);
        }

        this._root.addComponent(this._dayGrid);

        this._yearScrollOpen = false;
        this._monthLabel.getAria().setExpanded(false);
        this.resetYearTypeBuffer();

        this.buildGrid();
        this.doLayout();
    }

    /**
     * Populates `_yearColumn` with one cell per year in the legal range,
     * marking the active year as selected. Bound by `minDate` / `maxDate`
     * when set, otherwise the default ±span around today.
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
     * change moved `_monthAnchor` into a different year. Cheaper than a full
     * `buildYearScroller` because the cells themselves are unchanged.
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
     * Year-cell click handler. Sets `_monthAnchor` to the same month in the
     * new year, closes the scroller, and rebuilds the grid.
     *
     * @param year - The chosen year.
     */
    private onYearSelected(year: number): void {
        this._monthAnchor = new Date(year, this._monthAnchor.getMonth(), 1);
        this.closeYearScroller();
    }

    /**
     * Resets the year-scroller's 4-digit type-ahead buffer and clears any
     * pending idle timer. Called when the dropdown closes, the user presses
     * Escape, or the user commits a year.
     */
    private resetYearTypeBuffer(): void {
        this._yearTypeBuffer = "";

        if (this._yearTypeTimer !== null) {
            window.clearTimeout(this._yearTypeTimer);
            this._yearTypeTimer = null;
        }
    }

    /**
     * Keyboard router. Returns `true` when the event was handled (the caller
     * should `preventDefault`); `false` lets the host input's own handler run.
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
     * Returns the children of `_dayGrid` as a typed array. Tuple of (index,
     * cell) so callers can find the highlighted index without `instanceof`
     * filtering at the call site.
     *
     * @returns The grid's day cells in DOM order. Includes blank-cell entries.
     */
    private getDayGridChildren(): Component[] {
        return this._dayGrid.getComponents();
    }

    /**
     * Moves the keyboard-highlighted day cell by `delta` positions in the grid.
     * Skips blank cells; wraps month boundaries by mutating `_monthAnchor`.
     *
     * @param delta - Positive or negative step (±1 for arrow, ±7 for row).
     * @returns Always true (the keystroke is consumed even when no movement happens).
     */
    private moveHighlightedDay(delta: number): boolean {
        const children = this.getDayGridChildren();
        const dayCells: { idx: number; cell: DatePickerDay }[] = [];

        for (let i = 0; i < children.length; i++) {
            const c = children[i];
            if (c instanceof DatePickerDay && !c.isDisabled()) {
                dayCells.push({ idx: i, cell: c });
            }
        }

        if (dayCells.length === 0) {
            return true;
        }

        // Map the current highlighted index → its position within dayCells.
        let currentPos = -1;
        for (let i = 0; i < dayCells.length; i++) {
            if (dayCells[i].idx === this._highlightedDayIdx) {
                currentPos = i;
                break;
            }
        }

        if (currentPos < 0) {
            // No highlight yet — start from the selected cell if present,
            // otherwise the first in-range cell.
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
     * Visual highlight is the same as the click-selection style (background +
     * bold) so the user sees the same indicator either way.
     *
     * @param newIdx - Grid index of the cell to highlight.
     */
    private setHighlightedDay(newIdx: number): void {
        const children = this.getDayGridChildren();

        if (this._highlightedDayIdx >= 0 && this._highlightedDayIdx < children.length) {
            const prev = children[this._highlightedDayIdx];

            if (prev instanceof DatePickerDay && !this.matchesSelection(prev)) {
                prev.setSelected(false);
            }
        }

        if (newIdx < 0 || newIdx >= children.length) {
            this._highlightedDayIdx = -1;

            return;
        }

        const cell = children[newIdx];

        if (cell instanceof DatePickerDay) {
            cell.setSelected(true);
            this._highlightedDayIdx = newIdx;
        }
    }

    /**
     * True when `cell`'s date matches the currently-selected date — used to
     * decide whether removing the keyboard highlight should also clear the
     * selection styling.
     *
     * @param cell - The day cell to test.
     * @returns True when the cell represents the currently-selected date.
     */
    private matchesSelection(cell: DatePickerDay): boolean {
        if (!this._selected) {
            return false;
        }

        const d = cell.getDate();

        return d.getFullYear() === this._selected.getFullYear()
            && d.getMonth()    === this._selected.getMonth()
            && d.getDate()     === this._selected.getDate();
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
            if (c instanceof DatePickerDay && !c.isDisabled()) {
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
            if (c instanceof DatePickerDay && !c.isDisabled()) {
                this.setHighlightedDay(i);

                return true;
            }
        }

        return true;
    }

    /**
     * Commits the highlighted day as if the user had clicked it.
     *
     * @returns True when a day was committed; false when no highlight exists.
     */
    private commitHighlightedDay(): boolean {
        if (this._highlightedDayIdx < 0) {
            return false;
        }

        const children = this.getDayGridChildren();
        const cell     = children[this._highlightedDayIdx];

        if (cell instanceof DatePickerDay && !cell.isDisabled()) {
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
     * Returns the cell position of the highlighted year (or the selected year
     * when none is keyboard-highlighted yet).
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
     * Sets the visual highlight on cell `pos` and remembers the year. Clears
     * the previous highlight where appropriate.
     *
     * @param cells - Snapshot of the scroller's cell list.
     * @param pos - Index of the cell to highlight.
     */
    private applyYearHighlight(cells: PickerCell[], pos: number): void {
        const activeY  = this._monthAnchor.getFullYear();

        for (const c of cells) {
            // Only the truly-selected year keeps its highlight; everything else
            // clears so the new keyboard-highlight stands alone.
            c.setSelected(c.getText().valueOf() === String(activeY));
        }

        cells[pos].setSelected(true);
        this._highlightedYear = parseInt(cells[pos].getText().valueOf(), 10);

        // Mirror in the scrollable region so the new highlight is visible.
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
     * Commits the highlighted year as if the user had clicked it. Falls back
     * to the currently-selected year when no keyboard highlight is active.
     *
     * @returns Always true (the keystroke is consumed).
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
     * ms idle or 4 digits. Commits the jump when the buffer reaches 4 digits.
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

        // Prefix-match jump: as soon as the buffer matches a legal year exactly
        // (length === 4) or prefix-matches a single year, jump.
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

        // After 4 digits the buffer is "complete" — clear it so the next digit
        // starts fresh rather than appearing as a 5th character.
        if (buf.length === 4) {
            this.resetYearTypeBuffer();
        }

        return true;
    }
}

/**
 * Returns midnight at the start of `date`'s local day. Bound comparisons use
 * `dayStart(minDate)` and `dayEnd(maxDate)` so a `new Date(year, m, d)` with
 * `00:00:00` semantics counts as "in range" even when the bound has a non-zero
 * time component.
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

const DatePickerDropdownCallable = callable(DatePickerDropdown);
type DatePickerDropdownCallable = DatePickerDropdown;
export {
    DatePickerDropdown         as _DatePickerDropdown,
    DatePickerDropdownCallable as DatePickerDropdown
};
