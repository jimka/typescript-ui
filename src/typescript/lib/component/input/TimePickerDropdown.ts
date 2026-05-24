// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Component } from "~/core/Component.js";
import { Panel } from "~/core/Panel.js";
import { CSS } from "~/core/CSS.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { callable } from "~/core/Callable.js";

/** Pixel width of the time picker panel (Hour + Minute). */
const PANEL_WIDTH:          number = 140;

/** Pixel width of the time picker panel when the Seconds column is shown. */
const PANEL_WIDTH_SECONDS:  number = 200;

/** Pixel height of the time picker panel. */
const PANEL_HEIGHT:         number = 220;

/** Pixel height of each clickable cell row. */
const CELL_HEIGHT:          number = 22;

/** Pixel height of the column header row. */
const HEADER_HEIGHT:        number = 18;

// Static typography and hover effect defined once via class rules. Layout
// (column widths, cell stacking, scrolling) is driven by the framework
// HBox / VBox managers and Panel.autoScroll — no display:flex/grid here.
(() => {
    const header = CSS.createClassRule("TimePickerColumnHeader");
    if (header) {
        header.style.setProperty("opacity", "0.7");
    }

    const cell = CSS.createClassRule("TimePickerCell");
    if (cell) {
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

/** Column header label ("Hour" / "Min" / "Sec"). Centred within its row. */
class TimePickerColumnHeader extends Text {
    constructor(text: string) {
        super(text, { textAlign: "center", fontSize: 12 });
    }
}

/**
 * Scrollable list of time cells. A Panel with `autoScroll: 'y'` and a
 * stretching VBox so cells render at the full column width — giving the
 * mouse-hover region the full row, not just the digits' bounding box.
 */
class TimePickerCellList extends Panel {
    constructor() {
        super({
            layoutManager: new VBox({ spacing: 0, stretching: true }),
            autoScroll:    "y",
            insets:        new Insets(0, 0, 0, 0),
        });
    }
}

/**
 * A single hour/minute/second cell. Text-only leaf; the row width is set by
 * the parent's stretching VBox so `text-align: center` actually centres
 * across the column.
 */
class TimePickerCell extends Text {
    private _value:    number;
    private _selected: boolean = false;
    private readonly _onClick: (value: number) => void;

    constructor(value: number, onClick: (value: number) => void) {
        super(String(value).padStart(2, "0"), {
            textAlign:     "center",
            preferredSize: { width: 0, height: CELL_HEIGHT },
        });
        this._value   = value;
        this._onClick = onClick;

        // `lineHeight = CELL_HEIGHT` centres the single line of digits vertically
        // within the row so the hover area looks consistent.
        this.setLineHeight(CELL_HEIGHT);

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
 * A single hour or minute column. Stacks its header above the scrollable cell
 * list via a stretching VBox — no `display: flex` on the column element.
 */
class TimePickerColumn extends Component {
    private _cellList: TimePickerCellList;

    constructor(headerText: string) {
        super();
        this.setLayoutManager(new VBox({ spacing: 2, stretching: true }));

        const header = new TimePickerColumnHeader(headerText);
        header.setPreferredSize(0, HEADER_HEIGHT);
        this.addComponent(header);

        this._cellList = new TimePickerCellList();
        // Weight=1 so the list takes all remaining vertical space after the
        // fixed-height header.
        const listConstraints = new LayoutConstraints();
        listConstraints.weight = 1;
        this.addComponent(this._cellList, listConstraints);
    }

    /**
     * Adds a cell to this column's scrollable list.
     */
    addCell(cell: TimePickerCell): this {
        this._cellList.addComponent(cell);

        return this;
    }

    /**
     * Clears all cells from this column's scrollable list.
     */
    clearCells(): this {
        this._cellList.removeAllComponents();

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
    /** Outer HBox container holding the per-unit columns. */
    private _grid:    Component;

    /**
     * @param onSelect - Called with `(hours, minutes, seconds)` whenever the user picks a value.
     * The `seconds` argument is always `0` when the picker is not configured with `showSeconds`.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (hours: number, minutes: number, seconds: number) => void, options?: TimePickerDropdownOptions) {
        super(options, {
            zIndex:          10050,
            layoutManager:   new Fit(),
            backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
            border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
            insets:          new Insets(4, 4, 4, 4),
        });

        this._onSelect    = onSelect;
        this._showSeconds = options?.showSeconds ?? false;

        this.getAria().setRole("group");
        this.setContain("layout");

        this._grid = new Component();
        this._grid.setLayoutManager(new HBox({ spacing: 4, stretching: true }));
        this.addComponent(this._grid);

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

        this.placeAnchored(anchorEl.getBoundingClientRect());

        this.showAnimated();

        return this;
    }

    /**
     * Builds the hour/minute columns (plus optional seconds). The active
     * selection is highlighted; clicking a cell updates the active value and
     * fires `onSelect`.
     */
    private buildGrid(): void {
        this._grid.removeAllComponents();

        const weight = new LayoutConstraints();
        weight.weight = 1;

        this._grid.addComponent(this.buildColumn("Hour", 24, this._hours,   value => this.onHourSelected(value)),                  weight);
        this._grid.addComponent(this.buildColumn("Min",  60, this._minutes, value => this.onMinuteSelected(value), 5),             weight);

        if (this._showSeconds) {
            this._grid.addComponent(this.buildColumn("Sec", 60, this._seconds, value => this.onSecondSelected(value), 5), weight);
        }
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
        const column = new TimePickerColumn(label);

        for (let v = 0; v < count; v += step) {
            const cell = new TimePickerCell(v, onSelect);
            if (v === activeValue) {
                cell.setSelected(true);
            }
            column.addCell(cell);
        }

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
