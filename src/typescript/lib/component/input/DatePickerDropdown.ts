// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Component } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { Fit } from "~/layout/Fit.js";
import { VBox } from "~/layout/VBox.js";
import { Grid } from "~/layout/Grid.js";
import { callable } from "~/core/Callable.js";

/** Pixel width of the calendar grid. */
const PANEL_WIDTH:    number = 240;
/** Pixel height of the month-name + year row at the top. */
const MONTH_HEIGHT:   number = 24;
/** Pixel height of the weekday-name row. */
const HEADER_HEIGHT:  number = 20;
/** Pixel height of each day cell (and each empty leading cell). */
const CELL_HEIGHT:    number = 24;

// Static hover styling only. All layout (grid, row stacking) is driven by
// the framework Grid / VBox managers — no display:flex/grid here.
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
})();

/** Month name + year label. Spans the full panel width above the grid. */
class DatePickerMonthLabel extends Text {
    constructor(text: string) {
        super(text, {
            textAlign:     "center",
            fontWeight:    "bold",
            preferredSize: { width: 0, height: MONTH_HEIGHT },
        });
        this.setLineHeight(MONTH_HEIGHT);
    }
}

/** Weekday name header cell ("Sun", "Mon", …). */
class DatePickerDayHeader extends Text {
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
 * Empty cell shown before the first day of the month (and trailing the last)
 * so the day grid always renders as a full 6-row block.
 */
class DatePickerBlankCell extends Component {
    constructor() {
        super({ preferredSize: { width: 0, height: CELL_HEIGHT } });
    }
}

/**
 * A single day cell. Carries selection state through Component setters
 * (`setBackgroundColor` / `setFontWeight`), and click + pointerdown
 * suppression through `Event.addListener`. Static styling and the hover
 * effect live on the `.DatePickerDay` / `.DatePickerDay:hover` class rules.
 */
class DatePickerDay extends Text {
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

    /**
     * Returns whether this cell is currently marked as selected.
     */
    isSelected(): boolean {
        return this._selected;
    }
}

/**
 * Construction-time options for {@link DatePickerDropdown}.
 *
 * @category Components
 */
export interface DatePickerDropdownOptions extends AnimatedDropdownOptions {
}

/**
 * Floating month-grid date picker. Renders the calendar for the currently
 * focused month (initialised from the value passed to `showAt`, or today when
 * the value is null). Selecting a day fires the `onSelect` callback supplied
 * to the constructor.
 *
 * The grid is intentionally minimal — single month, no navigation — per the
 * `dropdown-fade-animation` plan's non-goals. Composers extend this class to
 * add navigation, week numbers, or locale-aware behaviour.
 *
 * Inherits the fade lifecycle from
 * [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown).
 *
 * @category Components
 */
class DatePickerDropdown extends AnimatedDropdown<DatePickerDropdownOptions> {

    private readonly _onSelect: (value: Date) => void;
    private _monthAnchor: Date = new Date();
    /** Outer VBox container holding month-label, header row, and day grid. */
    private _root:        Component;
    /** Inner Grid container holding the weekday header cells. */
    private _headerRow:   Component;
    /** Inner Grid container holding the day / blank cells. */
    private _dayGrid:     Component;
    /** The month label child of `_root`. Recycled across rebuilds. */
    private _monthLabel:  DatePickerMonthLabel;

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

        this._monthLabel = new DatePickerMonthLabel("");
        this._root.addComponent(this._monthLabel);

        this._headerRow = new Component({ preferredSize: { width: 0, height: HEADER_HEIGHT } });
        this._headerRow.setLayoutManager(new Grid({ columns: 7, spacing: 2, stretching: true }));
        for (const dh of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
            this._headerRow.addComponent(new DatePickerDayHeader(dh));
        }
        this._root.addComponent(this._headerRow);

        this._dayGrid = new Component({ preferredSize: { width: 0, height: 6 * CELL_HEIGHT + 5 * 2 } });
        this._dayGrid.setLayoutManager(new Grid({ columns: 7, spacing: 2, stretching: true }));
        this._root.addComponent(this._dayGrid);

        this.addComponent(this._root);

        // Suppress focus loss anywhere inside the panel — protects pooled
        // cell editors whose blur listener would otherwise commit before
        // the day-click fires.
        Event.addListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
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
        this._monthAnchor = selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date();

        this.pauseLayout();
        this.buildGrid(selected);
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
     * Sums the fixed-height rows + the panel's insets to produce the panel's
     * outer height. Avoids forcing a DOM measurement.
     */
    private computePanelHeight(): number {
        const insets    = this.getInsets();
        const rootGap   = 4;
        const dayGridH  = 6 * CELL_HEIGHT + 5 * 2;
        const innerH    = MONTH_HEIGHT + rootGap + HEADER_HEIGHT + rootGap + dayGridH;

        return insets.getTop() + insets.getBottom() + innerH;
    }

    /**
     * Rebuilds the day-grid children for `_monthAnchor`. The header row and
     * outer scaffolding are constructed once in the constructor and reused.
     *
     * @param selected - Currently-selected date, or null.
     */
    private buildGrid(selected: Date | null): void {
        this._dayGrid.removeAllComponents();

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
            const cell = new DatePickerDay(date, d => this._onSelect(d));

            const isSelected = selected != null
                && selected.getFullYear() === year
                && selected.getMonth()    === month
                && selected.getDate()     === day;

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
}

const DatePickerDropdownCallable = callable(DatePickerDropdown);
type DatePickerDropdownCallable = DatePickerDropdown;
export {
    DatePickerDropdown         as _DatePickerDropdown,
    DatePickerDropdownCallable as DatePickerDropdown
};
