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

/** Pixel width of the time picker panel (Hour + Minute). */
const PANEL_WIDTH:          number = 140;

/** Pixel width of the time picker panel when the Seconds column is shown. */
const PANEL_WIDTH_SECONDS:  number = 200;

/** Pixel height of the time picker panel. */
const PANEL_HEIGHT:         number = 220;

// Static layout and typography defined once via class rules. Each cell
// Component below auto-tags its element with its `this.constructor.name`,
// so the rules apply by class name without inline style writes.
(() => {
    const grid = CSS.createClassRule("TimePickerGrid");
    if (grid) {
        grid.style.setProperty("grid-template-columns", "1fr 1fr");
        grid.style.setProperty("gap", "4px");
        grid.style.setProperty("width", "100%");
        grid.style.setProperty("height", "100%");
    }

    const gridSeconds = CSS.createClassRule("TimePickerGridSeconds");
    if (gridSeconds) {
        gridSeconds.style.setProperty("grid-template-columns", "1fr 1fr 1fr");
        gridSeconds.style.setProperty("gap", "4px");
        gridSeconds.style.setProperty("width", "100%");
        gridSeconds.style.setProperty("height", "100%");
    }

    const column = CSS.createClassRule("TimePickerColumn");
    if (column) {
        column.style.setProperty("flex-direction", "column");
        column.style.setProperty("min-height", "0");
    }

    const header = CSS.createClassRule("TimePickerColumnHeader");
    if (header) {
        header.style.setProperty("opacity", "0.7");
        header.style.setProperty("padding", "2px 0");
        // `flex: 0 0 auto` prevents the list (flex: 1 1 auto) from squashing the
        // header to a sliver when their parent column is shorter than its content.
        header.style.setProperty("flex", "0 0 auto");
    }

    const list = CSS.createClassRule("TimePickerCellList");
    if (list) {
        list.style.setProperty("flex", "1 1 auto");
        list.style.setProperty("min-height", "0");
        // Hide the visual scrollbar so cells use the full column width and
        // align with the header above. Mouse-wheel scrolling still works.
        list.style.setProperty("scrollbar-width", "none");
    }

    const listScrollbar = CSS.createRule(".TimePickerCellList::-webkit-scrollbar");
    if (listScrollbar) {
        listScrollbar.style.setProperty("display", "none");
    }

    const cell = CSS.createClassRule("TimePickerCell");
    if (cell) {
        cell.style.setProperty("text-align", "center");
        cell.style.setProperty("padding", "3px 0");
        cell.style.setProperty("cursor", "pointer");
        cell.style.setProperty("border-radius", "3px");
    }

    const cellHover = CSS.createRule(".TimePickerCell:hover");
    if (cellHover) {
        cellHover.style.setProperty(
            "background-color",
            "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))"
        );
    }
})();

/**
 * Outer two-column grid container. Layout properties live on the
 * `.TimePickerGrid` class rule.
 */
class TimePickerGrid extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC, display: "grid" });
    }
}

/**
 * Outer three-column grid container used when the Seconds column is shown.
 * Layout properties live on the `.TimePickerGridSeconds` class rule.
 */
class TimePickerGridSeconds extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC, display: "grid" });
    }
}

/**
 * A single hour or minute column. Stacks a header above a scrollable cell
 * list via the `.TimePickerColumn` class rule.
 */
class TimePickerColumn extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC, display: "flex" });
    }
}

/** Column label ("Hour" / "Min"). */
class TimePickerColumnHeader extends Text {
    constructor(text: string) {
        super(text, { position: Position.STATIC, textAlign: "center", fontSize: 12 });
    }
}

/**
 * Scrollable list of time cells. The `overflow: "hidden auto"` shorthand
 * routes through the typed setter so it wins over the framework's default
 * per-component `overflow: hidden`; the class rule supplies `flex` and
 * `min-height`.
 */
class TimePickerCellList extends Component {
    constructor() {
        super({ tag: "div", position: Position.STATIC, overflow: "hidden auto" });
    }
}

/**
 * A single hour or minute cell. Carries selection state through Component
 * setters; static styling and the hover effect live on the
 * `.TimePickerCell` / `.TimePickerCell:hover` class rules.
 */
class TimePickerCell extends Text {
    private _value:    number;
    private _selected: boolean = false;
    private readonly _onClick: (value: number) => void;

    constructor(value: number, onClick: (value: number) => void) {
        super(String(value).padStart(2, "0"), { position: Position.STATIC, textAlign: "center" });
        this._value   = value;
        this._onClick = onClick;

        Event.addListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
        Event.addListener(this, "click",       ()                => this.onClick());
    }

    /**
     * Suppresses focus loss when the cell is pointed at so the host input's
     * blur-to-commit path doesn't fire mid-click.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Forwards the cell's numeric value to the owner-supplied click callback.
     */
    private onClick(): void {
        this._onClick(this._value);
    }

    /**
     * Toggles the selected (highlighted) state.
     *
     * @param selected - True to highlight this cell as the active value.
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

/**
 * Construction-time options for {@link TimePickerDropdown}.
 *
 * @category Components
 */
export interface TimePickerDropdownOptions extends AnimatedDropdownOptions {
    /** When true, the picker renders a third "Sec" column alongside Hour and Min. Default: false. */
    showSeconds?: boolean;
}

/**
 * Floating hour/minute selector with an optional seconds column. The grid is
 * intentionally minimal (24-hour list of hours, `:00`/`:05`/`:10`/… minute
 * snaps, and matching second snaps when `showSeconds` is on); 12-hour
 * formatting and locale-aware grouping are out of scope.
 *
 * Inherits the fade lifecycle from
 * [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown).
 *
 * @category Components
 */
class TimePickerDropdown extends AnimatedDropdown<TimePickerDropdownOptions> {

    private readonly _onSelect:    (hours: number, minutes: number, seconds: number) => void;
    private readonly _showSeconds: boolean;
    /** -1 means the user has not yet picked an hour. */
    private _hours:   number = -1;
    /** -1 means the user has not yet picked a minute. */
    private _minutes: number = -1;
    /** -1 means the user has not yet picked a second. Always 0 when `_showSeconds` is false. */
    private _seconds: number = -1;

    /**
     * @param onSelect - Called with `(hours, minutes, seconds)` whenever the user picks a value.
     * The `seconds` argument is always `0` when the picker is not configured with `showSeconds`.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (hours: number, minutes: number, seconds: number) => void, options?: TimePickerDropdownOptions) {
        super({
            zIndex:          10050,
            position:        Position.FIXED,
            backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
            border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
            padding:         new Insets(4, 4, 4, 4),
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
     * doesn't blur before a cell click is delivered.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Anchors the picker below `anchorEl`, initialises the active hour/minute
     * from `selected` (or leaves both unset when null), and plays the entrance fade.
     *
     * @param anchorEl - The input the picker anchors to.
     * @param selected - The currently-selected time (Date), or null.
     */
    showAt(anchorEl: HTMLElement, selected: Date | null): this {
        if (selected) {
            this._hours   = selected.getHours();
            this._minutes = selected.getMinutes();
            this._seconds = this._showSeconds ? selected.getSeconds() : 0;
        } else {
            this._hours   = -1;
            this._minutes = -1;
            this._seconds = -1;
        }

        this.pauseLayout();
        this.buildGrid();
        this.resumeLayout();

        this.setWidth(this._showSeconds ? PANEL_WIDTH_SECONDS : PANEL_WIDTH);
        this.setHeight(PANEL_HEIGHT);

        this.doLayout();

        const rect      = anchorEl.getBoundingClientRect();
        const vpHeight  = window.innerHeight;
        let y           = rect.bottom;

        if (y + PANEL_HEIGHT > vpHeight && rect.top - PANEL_HEIGHT > 0) {
            y = rect.top - PANEL_HEIGHT;
        }

        this.setX(rect.left);
        this.setY(y);

        this.showAnimated();

        return this;
    }

    /**
     * Builds the hour/minute grid (plus optional seconds). The active selection
     * is highlighted; clicking a cell updates the active value and fires
     * `onSelect`.
     */
    private buildGrid(): void {
        this.removeAllComponents();

        const grid = this._showSeconds ? new TimePickerGridSeconds() : new TimePickerGrid();
        grid.addComponent(this.buildColumn("Hour", 24, this._hours,   value => this.onHourSelected(value)));
        grid.addComponent(this.buildColumn("Min",  60, this._minutes, value => this.onMinuteSelected(value), 5));

        if (this._showSeconds) {
            grid.addComponent(this.buildColumn("Sec", 60, this._seconds, value => this.onSecondSelected(value), 5));
        }

        this.addComponent(grid);
    }

    /**
     * Builds a single scrollable column (hours or minutes).
     *
     * @param label - Column header text.
     * @param count - Number of cells (24 for hours, 60 for minutes).
     * @param activeValue - Currently-selected value (for highlight), or -1 for no selection.
     * @param onSelect - Callback fired with the clicked value.
     * @param step - Optional step (default 1). For minutes we use 5 to keep the grid manageable.
     */
    private buildColumn(
        label:       string,
        count:       number,
        activeValue: number,
        onSelect:    (value: number) => void,
        step:        number = 1,
    ): TimePickerColumn {
        const column = new TimePickerColumn();
        column.addComponent(new TimePickerColumnHeader(label));

        const list = new TimePickerCellList();

        for (let v = 0; v < count; v += step) {
            const cell = new TimePickerCell(v, onSelect);
            if (v === activeValue) {
                cell.setSelected(true);
            }
            list.addComponent(cell);
        }

        column.addComponent(list);

        return column;
    }

    /**
     * Records the new hour and re-renders the grid. Defaults the other fields
     * to `00` when this is the first interaction so the consumer always gets
     * a complete time.
     *
     * @param hours - The chosen hour (0-23).
     */
    private onHourSelected(hours: number): void {
        this._hours = hours;
        if (this._minutes < 0) {
            this._minutes = 0;
        }
        if (this._seconds < 0) {
            this._seconds = 0;
        }
        this._onSelect(this._hours, this._minutes, this._showSeconds ? this._seconds : 0);
        this.buildGrid();
    }

    /**
     * Records the new minute and re-renders the grid. Defaults the other
     * fields to `00` when this is the first interaction so the consumer
     * always gets a complete time.
     *
     * @param minutes - The chosen minute (0-59).
     */
    private onMinuteSelected(minutes: number): void {
        this._minutes = minutes;
        if (this._hours < 0) {
            this._hours = 0;
        }
        if (this._seconds < 0) {
            this._seconds = 0;
        }
        this._onSelect(this._hours, this._minutes, this._showSeconds ? this._seconds : 0);
        this.buildGrid();
    }

    /**
     * Records the new second and re-renders the grid. Defaults the other
     * fields to `00` when this is the first interaction so the consumer
     * always gets a complete time.
     *
     * @param seconds - The chosen second (0-59).
     */
    private onSecondSelected(seconds: number): void {
        this._seconds = seconds;
        if (this._hours < 0) {
            this._hours = 0;
        }
        if (this._minutes < 0) {
            this._minutes = 0;
        }
        this._onSelect(this._hours, this._minutes, this._seconds);
        this.buildGrid();
    }
}

const TimePickerDropdownCallable = callable(TimePickerDropdown);
type TimePickerDropdownCallable = TimePickerDropdown;
export {
    TimePickerDropdown         as _TimePickerDropdown,
    TimePickerDropdownCallable as TimePickerDropdown
};
