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

/** Pixel width of the combined date+time picker panel. */
const PANEL_WIDTH:          number = 240;

/** Pixel width of the combined date+time picker panel when seconds are shown. */
const PANEL_WIDTH_SECONDS:  number = 280;

// Static layout and typography defined once via class rules. Each cell
// Component below auto-tags its element with its `this.constructor.name`,
// so the rules apply by class name without inline style writes.
(() => {
    const root = CSS.createClassRule("DateTimePickerRoot");
    if (root) {
        root.style.setProperty("flex-direction", "column");
        root.style.setProperty("width", "100%");
        root.style.setProperty("gap", "6px");
    }

    const grid = CSS.createClassRule("DateTimePickerGrid");
    if (grid) {
        grid.style.setProperty("grid-template-columns", "repeat(7, 1fr)");
        grid.style.setProperty("gap", "2px");
    }

    const monthLabel = CSS.createClassRule("DateTimePickerMonthLabel");
    if (monthLabel) {
        monthLabel.style.setProperty("grid-column", "1 / -1");
        monthLabel.style.setProperty("text-align", "center");
        monthLabel.style.setProperty("font-weight", "bold");
        monthLabel.style.setProperty("padding", "4px 0");
    }

    const dayHeader = CSS.createClassRule("DateTimePickerDayHeader");
    if (dayHeader) {
        dayHeader.style.setProperty("text-align", "center");
        dayHeader.style.setProperty("font-size", "0.85em");
        dayHeader.style.setProperty("opacity", "0.7");
    }

    const day = CSS.createClassRule("DateTimePickerDay");
    if (day) {
        day.style.setProperty("text-align", "center");
        day.style.setProperty("padding", "3px 0");
        day.style.setProperty("cursor", "pointer");
        day.style.setProperty("border-radius", "3px");
    }

    const dayHover = CSS.createRule(".DateTimePickerDay:hover");
    if (dayHover) {
        dayHover.style.setProperty(
            "background-color",
            "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))"
        );
    }

    const timeRow = CSS.createClassRule("DateTimePickerTimeRow");
    if (timeRow) {
        timeRow.style.setProperty("align-items", "center");
        timeRow.style.setProperty("gap", "4px");
        timeRow.style.setProperty("padding", "4px 6px 2px 6px");
    }

    const timeLabel = CSS.createClassRule("DateTimePickerTimeLabel");
    if (timeLabel) {
        timeLabel.style.setProperty("font-size", "0.85em");
        timeLabel.style.setProperty("opacity", "0.7");
    }
})();

/**
 * Vertical container stacking the date grid above the time row. Layout
 * properties live on the `.DateTimePickerRoot` class rule.
 */
class DateTimePickerRoot extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC, display: "flex" });
    }
}

/** Calendar month grid. */
class DateTimePickerGrid extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC, display: "grid" });
    }
}

/** Month-name + year row spanning all seven columns of the grid. */
class DateTimePickerMonthLabel extends Text {
    constructor(text: string) {
        super(text, { position: Position.STATIC, textAlign: "center", fontWeight: "bold" });
    }
}

/** Single weekday-name header. */
class DateTimePickerDayHeader extends Text {
    constructor(text: string) {
        super(text, { position: Position.STATIC, textAlign: "center", fontSize: 12, opacity: 0.7 });
    }
}

/** Empty cell shown before the first day of the month. */
class DateTimePickerBlankCell extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC });
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
}

/** Horizontal "Time hh : mm" row. */
class DateTimePickerTimeRow extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC, display: "flex" });
    }
}

/** The "Time" label sitting before the hour/minute selects. */
class DateTimePickerTimeLabel extends Text {
    constructor() {
        super("Time", { position: Position.STATIC, fontSize: 12, opacity: 0.7 });
    }
}

/** The ":" separator between the hour and minute selects. */
class DateTimePickerTimeSeparator extends Text {
    constructor() {
        super(":", { position: Position.STATIC });
    }
}

/**
 * Native `<select>` Component used for the hour / minute / second pickers in
 * the time row. Owns its own listeners so they can be named methods rather
 * than inline closures over a `buildSelect` helper's locals.
 */
class DateTimePickerSelect extends Component {
    private readonly _onChange: (value: number) => void;

    /**
     * @param count - Number of options (24 hours, 60 minutes/seconds).
     * @param active - Currently-selected value, or -1 to leave nothing selected.
     * @param onChange - Callback fired when the user picks a new value.
     * @param step - Step between options (1 for hours, 5 for minutes/seconds).
     */
    constructor(count: number, active: number, onChange: (value: number) => void, step: number = 1) {
        super({ tag: "select", position: Position.STATIC });

        this._onChange = onChange;

        const el = this.getElement(true) as HTMLSelectElement;
        const snappedActive = active < 0 ? -1 : Math.round(active / step) * step;

        for (let v = 0; v < count; v += step) {
            const opt = document.createElement("option");
            opt.value       = String(v);
            opt.textContent = String(v).padStart(2, "0");

            if (v === snappedActive) {
                opt.selected = true;
            }

            el.appendChild(opt);
        }

        if (snappedActive < 0) {
            el.selectedIndex = -1;
        }

        Event.addListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
        Event.addListener(this, "change",      ()                => this.onChange());
    }

    /**
     * Stops propagation so the surrounding panel's `pointerdown` (which
     * `preventDefault`s to keep focus on the host input) doesn't suppress
     * the native `<select>` popup from opening.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): void {
        e.stopPropagation();
    }

    /**
     * Forwards the selected numeric value to the owner-supplied change callback.
     */
    private onChange(): void {
        const el = this.getElement() as HTMLSelectElement | null;
        if (el) {
            this._onChange(Number(el.value));
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

    /**
     * @param onSelect - Called with the chosen `Date` when the user updates any field.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: Date) => void, options?: DateTimePickerDropdownOptions) {
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

        this._onSelect    = onSelect;
        this._showSeconds = options?.showSeconds ?? false;

        this.getAria().setRole("group");
        this.setContain("layout");

        Event.addListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
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
        this.buildGrid();
        this.resumeLayout();

        this.setWidth(this._showSeconds ? PANEL_WIDTH_SECONDS : PANEL_WIDTH);

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
     * so {@link showAt} can size the panel to its content. The root container
     * uses static positioning, so the panel's `offsetHeight` already includes
     * everything inside.
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
     * Rebuilds the combined month-grid + hour/minute selector for `_value`.
     */
    private buildGrid(): void {
        this.removeAllComponents();

        const root = new DateTimePickerRoot();
        root.addComponent(this.buildDateGrid());
        root.addComponent(this.buildTimeRow());

        this.addComponent(root);
    }

    /**
     * Builds the month-view date grid.
     *
     * @returns The grid component.
     */
    private buildDateGrid(): DateTimePickerGrid {
        const grid = new DateTimePickerGrid();

        // When no value is set, anchor the month view on today so the user
        // can navigate; nothing in this anchor is highlighted.
        const anchor = this._value ?? new Date();
        const year   = anchor.getFullYear();
        const month  = anchor.getMonth();

        grid.addComponent(new DateTimePickerMonthLabel(
            anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        ));

        for (const dh of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
            grid.addComponent(new DateTimePickerDayHeader(dh));
        }

        const firstOfMonth = new Date(year, month, 1);
        const startWeekday = firstOfMonth.getDay();
        const daysInMonth  = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < startWeekday; i++) {
            grid.addComponent(new DateTimePickerBlankCell());
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

            grid.addComponent(cell);
        }

        return grid;
    }

    /**
     * Builds the hour/minute selector row.
     *
     * @returns The row component.
     */
    private buildTimeRow(): DateTimePickerTimeRow {
        const row = new DateTimePickerTimeRow();
        row.addComponent(new DateTimePickerTimeLabel());

        const hourSelect = this.buildSelect(24, this._value?.getHours() ?? -1, value => {
            const v = this._value ?? this.todayMidnight();
            v.setHours(value, v.getMinutes(), 0, 0);
            this._value = v;
            this.emit();
        });

        row.addComponent(hourSelect);
        row.addComponent(new DateTimePickerTimeSeparator());

        const minuteSelect = this.buildSelect(60, this._value?.getMinutes() ?? -1, value => {
            const v = this._value ?? this.todayMidnight();
            v.setHours(v.getHours(), value, v.getSeconds(), 0);
            this._value = v;
            this.emit();
        }, 5);

        row.addComponent(minuteSelect);

        if (this._showSeconds) {
            row.addComponent(new DateTimePickerTimeSeparator());

            const secondSelect = this.buildSelect(60, this._value?.getSeconds() ?? -1, value => {
                const v = this._value ?? this.todayMidnight();
                v.setHours(v.getHours(), v.getMinutes(), value, 0);
                this._value = v;
                this.emit();
            }, 5);

            row.addComponent(secondSelect);
        }

        return row;
    }

    /**
     * Thin wrapper kept so the call sites in {@link buildTimeRow} stay
     * concise. The actual `<select>` Component is {@link DateTimePickerSelect},
     * which owns its own listeners.
     *
     * @param count - Number of options (24 hours, 60 minutes/seconds).
     * @param active - Currently-selected value, or -1 to leave nothing selected.
     * @param onChange - Callback when the user picks a new value.
     * @param step - Step between options (1 for hours, 5 for minutes/seconds).
     */
    private buildSelect(count: number, active: number, onChange: (value: number) => void, step: number = 1): DateTimePickerSelect {
        return new DateTimePickerSelect(count, active, onChange, step);
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
     * Handles a day-cell click. Updates `_value`, emits, and rebuilds the
     * grid so the highlight follows.
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
        this.buildGrid();
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
