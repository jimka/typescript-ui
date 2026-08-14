// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { RadioButton } from "~/component/input/RadioButton.js";
import { MenuItem } from "~/component/container/MenuItem.js";
import { MenuRow } from "~/component/container/MenuRow.js";
import { callable } from "~/core/Callable.js";

/** Events exposed by {@link RadioMenuRow}. */
export type RadioMenuRowEvent = "action";

// Dim applied to a disabled row, matching the framework's other composite
// disabled controls (Button.setEnabled, NumberSpinner.applyEnabled).
const DISABLED_OPACITY = 0.5;

/**
 * Construction-time options for {@link RadioMenuRow}.
 *
 * @category Components
 */
export interface RadioMenuRowOptions extends ComponentOptions {
    /** Row label, rendered beside the radio graphic. */
    text?: string;
    /** Initial selected state. Defaults to `false`. */
    checked?: boolean;
    /** Defaults to `true`. Disabled rows are dimmed and non-interactive. */
    enabled?: boolean;
    /**
     * Construction-time listener bag; `action` fires after each click.
     */
    listeners?: { action?: () => void };
}

/**
 * A [`Menu`](/api/overlay/classes/Menu) row hosting a real
 * [`RadioButton`](/api/component/input/classes/RadioButton), for a single-choice menu.
 *
 * Built via `{ row: () => new RadioMenuRow({ text, checked }) }` on a
 * `MenuItemConfig`. Selects on a click anywhere in the row or on Enter (via
 * {@link activate}) and leaves the menu open — unlike a plain `MenuItem`,
 * activating it never closes the panel. `isNavigable()` reports `true`, so
 * the menu's roving arrow-key highlight lands on it like any other row.
 *
 * @category Components
 */
class RadioMenuRow extends MenuRow<RadioMenuRowOptions> {

    private _radio: RadioButton;
    // The title offset the owning Menu pushed in, or null when this row is
    // standalone — in which case doLayout falls back to MenuItem.TEXT_INSET.
    private _iconStart: number | null = null;
    // The check-column width the owning Menu pushed in, alongside _iconStart —
    // needed to tell whether _iconStart was widened for a sibling's icon (see
    // doLayout's `iconColumnReserved`).
    private _checkZone: number | null = null;

    private readonly _onMouseOver: () => void;
    private readonly _onMouseOut: () => void;
    private readonly _onClick: () => void;

    /**
     * Constructs a RadioMenuRow.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: RadioMenuRowOptions, subclassDefaults?: Partial<RadioMenuRowOptions>) {
        super(options, subclassDefaults);

        // `text` / `checked` are read from the raw constructor argument, not
        // `this._options`: neither field has a matching setter for
        // `applyOptions` to dispatch through (there is no live `setText`, and
        // `setChecked` below writes straight to `_radio`, which cannot exist
        // yet during the `super()` cascade), so `this._options` is never
        // populated for them — `_radio` itself is the state cache for
        // `checked` from this point on.
        this._radio = new RadioButton(options?.text ?? "", {
            selected: options?.checked ?? false,
            enabled:  options?.enabled ?? true,
        });
        // Pointer-inert child so a click anywhere in the row hits the row
        // element and selects — the same arrangement MenuItem uses for its
        // five labels and SelectableListRow uses for its renderer. Unlike
        // Checkbox.setSelected, RadioButton.setSelected fires no synthetic
        // click of its own, so there is no internal click to re-enter; this
        // pointer-inert wiring exists purely to route every click on the
        // radio graphic to the row's own exact-target `click` listener.
        this._radio.setPointerEvents("none");
        this.addComponent(this._radio);

        if (options?.enabled === false) {
            // Pointer-inert, not merely guarded: a consumer's `on("action", …)`
            // handler is a second click listener on this row, which no guard
            // inside `activate()` can suppress. Keeping the click off the row
            // is what makes a disabled row truly non-interactive.
            this.setPointerEvents("none");
            this.setOpacity(DISABLED_OPACITY);
        }

        this._onMouseOver = () => {
            this.setFocused(true);
        };

        this._onMouseOut = () => {
            this.setFocused(false);
        };

        this._onClick = () => {
            this.activate();
        };

        Event.addListener(this, "mouseover", this._onMouseOver);
        Event.addListener(this, "mouseout", this._onMouseOut);
        Event.addListener(this, "click", this._onClick);

        this.applyListeners(options?.listeners);
    }

    /**
     * Returns the row's current checked state.
     *
     * @returns Whether the radio button is currently selected.
     */
    isChecked(): boolean {
        return this._radio.isSelected();
    }

    /**
     * Sets the checked state.
     *
     * @param value - `true` to select, `false` to deselect.
     * @returns This row, for method chaining.
     */
    setChecked(value: boolean): this {
        this._radio.setSelected(value);

        return this;
    }

    /**
     * Returns `true` — a `RadioMenuRow` behaves like a menu item, so the
     * menu's roving highlight lands on it and Enter activates it.
     *
     * @returns `true`.
     */
    isNavigable(): boolean {
        return true;
    }

    /**
     * Overrides {@link MenuRow.isEnabled}, reading the inner `RadioButton`'s
     * own enabled state — the cache for this row's `enabled` option, just as
     * it already is for `checked`.
     *
     * @returns Whether this row is interactive.
     */
    isEnabled(): boolean {
        return this._radio.isEnabled();
    }

    /**
     * Selects this row. Called by a click on the row or by
     * `Menu.activateFocused()` on Enter. Selecting is one-way — a click on an
     * already-selected row leaves it selected, matching `RadioButton`'s own
     * activation rule — so a group of rows is deselected by whoever owns the
     * group, not by the row itself. A no-op when the row is disabled.
     */
    activate(): void {
        if (!this.isEnabled()) {
            return;
        }

        this.setChecked(true);
    }

    /**
     * Returns the row's own content width — the radio button's natural width
     * plus right padding, excluding any left inset of its own (`Menu` adds
     * the shared `iconStart` uniformly; see {@link MenuRow.getContentWidth}).
     * Read by `Menu.layOutColumns` **before** {@link setColumns} runs, so
     * this must never depend on the injected `iconStart` value itself.
     *
     * @returns The row's preferred content width in pixels.
     */
    getContentWidth(): number {
        const width = Math.ceil(this._radio.getPreferredSize()?.width ?? 0);

        return width + MenuItem.RIGHT_PAD;
    }

    /**
     * Stores the menu-computed left offset so the radio button lines up with
     * the `MenuItem`s around it. `titleColumn` is unused — this row has no
     * shared title column of its own.
     *
     * @param checkZone - Width reserved for the menu's leading checkmark column.
     * @param iconStart - The left offset (in pixels) to align the radio button to.
     * @param _titleColumn - Unused.
     */
    setColumns(checkZone: number, iconStart: number, _titleColumn: number): void {
        this._checkZone = checkZone;
        this._iconStart = iconStart;
        this.scheduleLayout();
    }

    /**
     * Positions the radio button within the row's content box, vertically
     * centred, at the injected `iconStart` (or `MenuItem.TEXT_INSET` when
     * this row was never given one).
     *
     * When a sibling row reserves an icon column, `iconStart` is pushed out
     * to align with icon rows' *title text* — past their icon — which would
     * otherwise indent this row's radio button behind an icon-sized gap of
     * empty space. Aligning with the icon's own position instead
     * (`checkZone + 4`, matching {@link MenuItem}'s icon inset) keeps the
     * radio button flush with where a sibling's icon renders, since the
     * radio button plays the same visual role. With no icon column,
     * `iconStart` already collapses to `checkZone + MenuItem.TEXT_INSET`, so
     * this leaves a plain radio-only menu's layout unchanged.
     *
     * @returns This row, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        const size = this._radio.getPreferredSize() ?? { width: 0, height: 0 };
        const checkZone           = this._checkZone ?? 0;
        const iconColumnReserved  = this._iconStart !== null && this._iconStart - checkZone === MenuItem.ICON_ZONE;
        const left = iconColumnReserved ? checkZone + 4 : (this._iconStart ?? MenuItem.TEXT_INSET);
        const top  = Math.max(0, Math.floor((box.height - size.height) / 2));

        this._radio.setX(box.x + left);
        this._radio.setY(box.y + top);
        this._radio.setWidth(Math.max(0, box.width - left - MenuItem.RIGHT_PAD));
        this._radio.setHeight(size.height);

        return this;
    }

    /**
     * Registers a listener for this row's `"action"` event — fired after
     * each click (a direct click or {@link activate}). A typed semantic
     * shorthand over {@link Event.addListener} (the underlying DOM event is
     * `"click"`).
     *
     * @param event - The event name. Only `"action"` is accepted.
     * @param listener - The callback to invoke after each click.
     * @returns This row, for method chaining.
     */
    on(event: "action", listener: () => void): this;
    on(_event: "action", listener: () => void): this {
        Event.addListener(this, "click", listener);

        return this;
    }

    /**
     * Removes a previously registered `"action"` listener.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     * @returns This row, for method chaining.
     */
    off(event: "action", listener: () => void): this;
    off(_event: "action", listener: () => void): this {
        Event.removeListener(this, "click", listener);

        return this;
    }
}

const RadioMenuRowCallable = callable(RadioMenuRow);
type RadioMenuRowCallable = RadioMenuRow;
export {
    RadioMenuRow         as _RadioMenuRow,
    RadioMenuRowCallable as RadioMenuRow
};
