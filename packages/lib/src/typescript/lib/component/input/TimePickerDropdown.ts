// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Insets } from "~/primitive/Insets.js";
import { Fit } from "~/layout/Fit.js";
import { TimeColumns } from "~/component/input/TimeColumns.js";
import { isScrollbarTarget } from "~/component/container/Scrollbar.js";
import { callable } from "~/core/Callable.js";

/** Pixel width of the time picker panel (Hour + Minute). */
const PANEL_WIDTH:          number = 140;

/** Pixel width of the time picker panel when the Seconds column is shown. */
const PANEL_WIDTH_SECONDS:  number = 200;

/** Pixel height of the time picker panel. */
const PANEL_HEIGHT:         number = 220;

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
 * The scrollable column grid is the shared `TimeColumns` unit, built
 * once and re-highlighted in place on every pick, so selecting a value never
 * resets a scrolled column.
 *
 * Inherits the fade lifecycle from
 * [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown).
 *
 * @category Components
 */
class TimePickerDropdown extends AnimatedDropdown<TimePickerDropdownOptions> {

    private readonly _showSeconds: boolean;
    /** The shared Hour/Min(/Sec) selection grid. Built once; re-highlighted in place. */
    private readonly _timeColumns: TimeColumns;

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
            border:          "var(--ts-ui-input-border)",
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
            insets:          new Insets(4, 4, 4, 4),
        });

        this._showSeconds = options?.showSeconds ?? false;

        this.getAria().setRole("group");
        this.setContain("layout");

        this._timeColumns = new TimeColumns(onSelect, { showSeconds: this._showSeconds });
        this.addComponent(this._timeColumns);

        // Subtree listener so the preventDefault also fires for descendant
        // targets. With plain `addListener` only events whose exact target is
        // this dropdown's element would match, which would silently bypass
        // the focus-loss guard for the cell descendants.
        Event.addSubtreeListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
    }

    /**
     * Suppresses focus loss anywhere inside the panel so the host input
     * doesn't blur before a cell click is delivered — but lets a pointerdown
     * on a {@link TimeColumns} scrollbar through, since preventing it there
     * would suppress the compatibility `mousedown` the thumb/track drag
     * relies on (see {@link isScrollbarTarget}) and a scrollbar never holds
     * focus, so there's nothing to guard.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): Event.ListenerResult {
        if (isScrollbarTarget(e)) {
            return;
        }

        return { prevent: true };
    }

    /**
     * Anchors the picker below `anchorEl`, highlights the active hour/minute
     * from `selected` (or clears the highlight when null), and plays the
     * entrance fade. The columns already exist, so the selection is updated in
     * place rather than rebuilt.
     *
     * @param anchorEl - The input the picker anchors to.
     * @param selected - The currently-selected time (Date), or null.
     */
    showAt(anchorEl: Handle, selected: Date | null): this {
        this._timeColumns.setTime(selected);

        this.setWidth(this._showSeconds ? PANEL_WIDTH_SECONDS : PANEL_WIDTH);
        this.setHeight(PANEL_HEIGHT);

        this.placeAnchored(DOM.source.getElementRect(anchorEl));

        // Mount before laying out: the columns are built once in the
        // constructor, so — unlike the calendar dropdown, whose show-time
        // `buildDayGrid` forces element creation — nothing here realises the
        // panel's DOM element before layout. `Fit` reads `getInnerSize`, which
        // is null until the element exists, and would size the columns to 0.
        this.showAnimated();

        this.doLayout();

        return this;
    }
}

const TimePickerDropdownCallable = callable(TimePickerDropdown);
type TimePickerDropdownCallable = TimePickerDropdown;
export {
    TimePickerDropdown         as _TimePickerDropdown,
    TimePickerDropdownCallable as TimePickerDropdown
};
