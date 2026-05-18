// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Component } from "~/core/Component.js";
import { CSS } from "~/core/CSS.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { Position } from "~/primitive/Position.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/** Pixel width of the calendar grid. */
const PANEL_WIDTH:  number = 240;

// Static layout and typography defined once via class rules. Each cell
// Component below auto-tags its element with its `this.constructor.name`,
// so the rules apply by class name without inline style writes.
(() => {
    const grid = CSS.createClassRule("DatePickerGrid");
    if (grid) {
        grid.style.setProperty("display", "grid");
        grid.style.setProperty("grid-template-columns", "repeat(7, 1fr)");
        grid.style.setProperty("gap", "2px");
        grid.style.setProperty("width", "100%");
    }

    const monthLabel = CSS.createClassRule("DatePickerMonthLabel");
    if (monthLabel) {
        monthLabel.style.setProperty("grid-column", "1 / -1");
        monthLabel.style.setProperty("text-align", "center");
        monthLabel.style.setProperty("font-weight", "bold");
        monthLabel.style.setProperty("padding", "4px 0");
    }

    const dayHeader = CSS.createClassRule("DatePickerDayHeader");
    if (dayHeader) {
        dayHeader.style.setProperty("text-align", "center");
        dayHeader.style.setProperty("font-size", "0.85em");
        dayHeader.style.setProperty("opacity", "0.7");
        dayHeader.style.setProperty("padding", "2px 0");
    }

    const day = CSS.createClassRule("DatePickerDay");
    if (day) {
        day.style.setProperty("text-align", "center");
        day.style.setProperty("padding", "4px 0");
        day.style.setProperty("cursor", "pointer");
        day.style.setProperty("border-radius", "3px");
    }

    const dayHover = CSS.createRule(".DatePickerDay:hover");
    if (dayHover) {
        dayHover.style.setProperty(
            "background-color",
            "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))"
        );
    }
})();

/**
 * Outer grid container. Sets `position:static` so its children participate
 * in the CSS-grid flow instead of getting the framework's default absolute
 * positioning. Layout properties live on the `.DatePickerGrid` class rule.
 */
class DatePickerGrid extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC, display: "grid" });
    }
}

/**
 * Month name + year header. Spans all seven columns via the
 * `.DatePickerMonthLabel` class rule.
 */
class DatePickerMonthLabel extends Text {
    constructor(text: string) {
        super(text, { position: Position.STATIC, textAlign: "center", fontWeight: "bold" });
    }
}

/**
 * Weekday name header cell ("Sun", "Mon", …). Static row above the day grid.
 */
class DatePickerDayHeader extends Text {
    constructor(text: string) {
        super(text, { position: Position.STATIC, textAlign: "center", fontSize: 12, opacity: 0.7 });
    }
}

/**
 * Empty cell shown before the first day of the month so the first day
 * aligns under the correct weekday.
 */
class DatePickerBlankCell extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC });
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
        super(String(date.getDate()), { position: Position.STATIC, textAlign: "center" });
        this._date    = date;
        this._onClick = onClick;

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

    /**
     * @param onSelect - Called with the chosen `Date` when the user picks a day.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: Date) => void, options?: DatePickerDropdownOptions) {
        super({
            zIndex:          10050,
            position:        Position.FIXED,
            backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
            border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
            padding:         new Insets(6, 6, 6, 6),
            ...(options ?? {}),
        });

        this._onSelect = onSelect;

        this.getAria().setRole("group");
        this.setContain("layout");

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

        this.setWidth(PANEL_WIDTH);

        const measuredHeight = this.measureNaturalHeight();
        this.setHeight(measuredHeight);

        this.doLayout();

        const rect      = anchorEl.getBoundingClientRect();
        const vpHeight  = window.innerHeight;
        let y           = rect.bottom;

        if (y + measuredHeight > vpHeight && rect.top - measuredHeight > 0) {
            y = rect.top - measuredHeight;
        }

        this.setX(rect.left);
        this.setY(y);

        this.showAnimated();

        return this;
    }

    /**
     * Measures the panel's natural rendered height for the freshly-built grid
     * so {@link showAt} can size the panel to its content. The grid container
     * uses static positioning, so the panel's `offsetHeight` already includes
     * the grid plus the panel's own padding and border — no separate chrome
     * accounting is needed.
     *
     * @returns The natural panel height in pixels.
     */
    private measureNaturalHeight(): number {
        const el = this.getElement(true);
        const wasMounted = document.documentElement.contains(el);

        if (!wasMounted) {
            this.setVisible(false);
            document.documentElement.appendChild(el);
        }

        const measured = el.offsetHeight;

        if (!wasMounted) {
            document.documentElement.removeChild(el);
            this.setVisible(true);
        }

        return measured;
    }

    /**
     * Rebuilds the month-grid children for `_monthAnchor`.
     *
     * @param selected - Currently-selected date, or null.
     */
    private buildGrid(selected: Date | null): void {
        this.removeAllComponents();

        const grid  = new DatePickerGrid();
        const year  = this._monthAnchor.getFullYear();
        const month = this._monthAnchor.getMonth();

        grid.addComponent(new DatePickerMonthLabel(
            this._monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        ));

        for (const dh of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
            grid.addComponent(new DatePickerDayHeader(dh));
        }

        const firstOfMonth = new Date(year, month, 1);
        const startWeekday = firstOfMonth.getDay();
        const daysInMonth  = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < startWeekday; i++) {
            grid.addComponent(new DatePickerBlankCell());
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

            grid.addComponent(cell);
        }

        this.addComponent(grid);
    }
}

const DatePickerDropdownCallable = callable(DatePickerDropdown);
type DatePickerDropdownCallable = DatePickerDropdown;
export {
    DatePickerDropdown         as _DatePickerDropdown,
    DatePickerDropdownCallable as DatePickerDropdown
};
