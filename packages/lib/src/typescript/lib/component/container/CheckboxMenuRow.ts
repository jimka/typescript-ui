// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Checkbox } from "~/component/input/Checkbox.js";
import { MenuItem } from "~/component/container/MenuItem.js";
import { MenuRow } from "~/component/container/MenuRow.js";
import { callable } from "~/core/Callable.js";

/** Events exposed by {@link CheckboxMenuRow}. */
export type CheckboxMenuRowEvent = "action";

/**
 * Construction-time options for {@link CheckboxMenuRow}.
 *
 * @category Components
 */
export interface CheckboxMenuRowOptions extends ComponentOptions {
    /** Row label, rendered beside the checkbox graphic. */
    text?: string;
    /** Initial checked state. Defaults to `false`. */
    checked?: boolean;
    /**
     * Construction-time listener bag; `action` fires after each toggle.
     */
    listeners?: { action?: () => void };
}

/**
 * A [`Menu`](/api/overlay/classes/Menu) row hosting a real
 * [`Checkbox`](/api/component/input/classes/Checkbox), for a multi-select menu.
 *
 * Built via `{ row: () => new CheckboxMenuRow({ text, checked }) }` on a
 * `MenuItemConfig`. Toggles on a click anywhere in the row or on Enter (via
 * {@link activate}) and leaves the menu open — unlike a plain `MenuItem`,
 * activating it never closes the panel. `isNavigable()` reports `true`, so
 * the menu's roving arrow-key highlight lands on it like any other row.
 *
 * @category Components
 */
class CheckboxMenuRow extends MenuRow<CheckboxMenuRowOptions> {

    private _checkbox: Checkbox;
    // The title offset the owning Menu pushed in, or null when this row is
    // standalone — in which case doLayout falls back to MenuItem.TEXT_INSET.
    private _iconStart: number | null = null;

    private readonly _onMouseOver: () => void;
    private readonly _onMouseOut: () => void;
    private readonly _onClick: () => void;

    /**
     * Constructs a CheckboxMenuRow.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: CheckboxMenuRowOptions, subclassDefaults?: Partial<CheckboxMenuRowOptions>) {
        super(options, subclassDefaults);

        // `text` / `checked` are read from the raw constructor argument, not
        // `this._options`: neither field has a matching setter for
        // `applyOptions` to dispatch through (there is no live `setText`, and
        // `setChecked` below writes straight to `_checkbox`, which cannot
        // exist yet during the `super()` cascade), so `this._options` is
        // never populated for them — `_checkbox` itself is the state cache
        // for `checked` from this point on.
        this._checkbox = new Checkbox({
            label:    options?.text ?? "",
            selected: options?.checked ?? false,
        });
        // Pointer-inert child so a click anywhere in the row hits the row
        // element and toggles — the same arrangement MenuItem uses for its
        // five labels and SelectableListRow uses for its renderer. The row's
        // own `click` listener is exact-target, so the Checkbox's internal
        // synthetic click (fired from setSelected on its own element) cannot
        // re-enter it.
        this._checkbox.setPointerEvents("none");
        this.addComponent(this._checkbox);

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
     * @returns Whether the checkbox is currently checked.
     */
    isChecked(): boolean {
        return this._checkbox.isSelected();
    }

    /**
     * Sets the checked state.
     *
     * @param value - `true` to check, `false` to uncheck.
     * @returns This row, for method chaining.
     */
    setChecked(value: boolean): this {
        this._checkbox.setSelected(value);

        return this;
    }

    /**
     * Returns `true` — a `CheckboxMenuRow` behaves like a menu item, so the
     * menu's roving highlight lands on it and Enter activates it.
     *
     * @returns `true`.
     */
    isNavigable(): boolean {
        return true;
    }

    /**
     * Flips the checkbox. Called by a click on the row or by
     * `Menu.activateFocused()` on Enter.
     */
    activate(): void {
        this.setChecked(!this.isChecked());
    }

    /**
     * Returns the row's own content width — the checkbox's natural width
     * plus right padding, excluding any left inset of its own (`Menu` adds
     * the shared `iconStart` uniformly; see {@link MenuRow.getContentWidth}).
     * Read by `Menu.layOutColumns` **before** {@link setColumns} runs, so
     * this must never depend on the injected `iconStart` value itself.
     *
     * @returns The row's preferred content width in pixels.
     */
    getContentWidth(): number {
        const width = Math.ceil(this._checkbox.getPreferredSize()?.width ?? 0);

        return width + MenuItem.RIGHT_PAD;
    }

    /**
     * Stores the menu-computed left offset so the checkbox lines up with the
     * `MenuItem`s around it. `checkZone` and `titleColumn` are unused — this
     * row has no check column and no shared title column of its own.
     *
     * @param _checkZone - Unused.
     * @param iconStart - The left offset (in pixels) to align the checkbox to.
     * @param _titleColumn - Unused.
     */
    setColumns(_checkZone: number, iconStart: number, _titleColumn: number): void {
        this._iconStart = iconStart;
        this.scheduleLayout();
    }

    /**
     * Positions the checkbox within the row's content box, vertically
     * centred, at the injected `iconStart` (or `MenuItem.TEXT_INSET` when
     * this row was never given one).
     *
     * @returns This row, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        const size = this._checkbox.getPreferredSize() ?? { width: 0, height: 0 };
        const left = this._iconStart ?? MenuItem.TEXT_INSET;
        const top  = Math.max(0, Math.floor((box.height - size.height) / 2));

        this._checkbox.setX(box.x + left);
        this._checkbox.setY(box.y + top);
        this._checkbox.setWidth(Math.max(0, box.width - left - MenuItem.RIGHT_PAD));
        this._checkbox.setHeight(size.height);

        return this;
    }

    /**
     * Registers a listener for this row's `"action"` event — fired after
     * each toggle (click or {@link activate}). A typed semantic shorthand
     * over {@link Event.addListener} (the underlying DOM event is `"click"`).
     *
     * @param event - The event name. Only `"action"` is accepted.
     * @param listener - The callback to invoke after each toggle.
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

const CheckboxMenuRowCallable = callable(CheckboxMenuRow);
type CheckboxMenuRowCallable = CheckboxMenuRow;
export {
    CheckboxMenuRow         as _CheckboxMenuRow,
    CheckboxMenuRowCallable as CheckboxMenuRow
};
