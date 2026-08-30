// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { AbstractBooleanInput } from "~/component/input/AbstractBooleanInput.js";
import { MenuItem } from "~/component/container/MenuItem.js";
import { MenuRow } from "~/component/container/MenuRow.js";

/** Events exposed by an {@link AbstractBooleanMenuRow}. */
export type AbstractBooleanMenuRowEvent = "action";

// Dim applied to a disabled row, matching the framework's other composite
// disabled controls (Button.setEnabled, NumberSpinner.applyEnabled).
const DISABLED_OPACITY = 0.5;

/**
 * Construction-time options shared by the boolean-valued menu rows
 * ({@link CheckboxMenuRow}, {@link RadioMenuRow}).
 *
 * @category Components
 */
export interface AbstractBooleanMenuRowOptions extends ComponentOptions {
    /** Row label, rendered beside the control's graphic. */
    text?: string;
    /** Initial checked state. Defaults to `false`. */
    checked?: boolean;
    /** Defaults to `true`. Disabled rows are dimmed and non-interactive. */
    enabled?: boolean;
    /**
     * Construction-time listener bag; `action` fires after each activation.
     */
    listeners?: { action?: () => void };
}

/**
 * Abstract base for a [`Menu`](/api/overlay/classes/Menu) row hosting a real
 * boolean-valued control ({@link CheckboxMenuRow}'s `Checkbox`,
 * {@link RadioMenuRow}'s `RadioButton`). Owns the mechanics they share
 * verbatim: the control's disabled dimming, the hover-highlight and click
 * wiring, the shared-column geometry (`getContentWidth` / `setColumns` /
 * `doLayout`), and the `"action"` notification — fired after both a click on
 * the row and `Menu.activateFocused()` calling {@link activate} from a key
 * handler that belongs to a different component.
 *
 * Each subclass supplies only what differs: its inner control (returned from
 * `getControl()`) and the value mutation performed on activation
 * (`applyActivation()`).
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated.
 *
 * @category Components
 */
export abstract class AbstractBooleanMenuRow<
    TOptions extends AbstractBooleanMenuRowOptions = AbstractBooleanMenuRowOptions
> extends MenuRow<TOptions> {

    private _listeners: ListenerBag<AbstractBooleanMenuRowEvent> =
        this.registerListenerBag(new ListenerBag<AbstractBooleanMenuRowEvent>());

    // The title offset the owning Menu pushed in, or null when this row is
    // standalone — in which case doLayout falls back to MenuItem.TEXT_INSET.
    private _iconStart: number | null = null;
    // The check-column width the owning Menu pushed in, alongside _iconStart —
    // needed to tell whether _iconStart was widened for a sibling's icon (see
    // doLayout's `iconColumnReserved`).
    private _checkZone: number | null = null;

    /**
     * Constructs an AbstractBooleanMenuRow.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, subclassDefaults);

        this.applyListeners(options?.listeners);
    }

    /**
     * Returns the row's current checked state.
     *
     * @returns Whether the control is currently checked.
     */
    isChecked(): boolean {
        return this.getControl().getValue();
    }

    /**
     * Sets the checked state.
     *
     * @param value - `true` to check, `false` to uncheck.
     * @returns This row, for method chaining.
     */
    setChecked(value: boolean): this {
        this.getControl().setValue(value);

        return this;
    }

    /**
     * Returns `true` — a boolean menu row behaves like a menu item, so the
     * menu's roving highlight lands on it and Enter activates it.
     *
     * @returns `true`.
     */
    isNavigable(): boolean {
        return true;
    }

    /**
     * Overrides {@link MenuRow.isEnabled}, reading the inner control's own
     * enabled state — the cache for this row's `enabled` option, just as it
     * already is for `checked`.
     *
     * @returns Whether this row is interactive.
     */
    isEnabled(): boolean {
        return this.getControl().isEnabled();
    }

    /**
     * Activates this row as if the user clicked or pressed Enter on it.
     * Called by a click on the row or by `Menu.activateFocused()` on Enter.
     * A no-op when the row is disabled; otherwise applies the subclass's
     * value mutation and notifies every registered `"action"` listener,
     * after the mutation so the listener reads the new state.
     */
    activate(): void {
        if (!this.isEnabled()) {
            return;
        }

        this.applyActivation();
        this.emit("action");
    }

    /**
     * Returns the row's own content width — the control's natural width plus
     * right padding, excluding any left inset of its own (`Menu` adds the
     * shared `iconStart` uniformly; see {@link MenuRow.getContentWidth}).
     * Read by `Menu.layOutColumns` **before** {@link setColumns} runs, so
     * this must never depend on the injected `iconStart` value itself.
     *
     * @returns The row's preferred content width in pixels.
     */
    getContentWidth(): number {
        const width = Math.ceil(this.getControl().getPreferredSize()?.width ?? 0);

        return width + MenuItem.RIGHT_PAD;
    }

    /**
     * Stores the menu-computed left offset so the control lines up with the
     * `MenuItem`s around it. `titleColumn` is unused — this row has no shared
     * title column of its own.
     *
     * @param checkZone - Width reserved for the menu's leading checkmark column.
     * @param iconStart - The left offset (in pixels) to align the control to.
     * @param _titleColumn - Unused.
     */
    setColumns(checkZone: number, iconStart: number, _titleColumn: number): void {
        this._checkZone = checkZone;
        this._iconStart = iconStart;
        this.scheduleLayout();
    }

    /**
     * Positions the control within the row's content box, vertically
     * centred, at the injected `iconStart` (or `MenuItem.TEXT_INSET` when
     * this row was never given one).
     *
     * When a sibling row reserves an icon column, `iconStart` is pushed out
     * to align with icon rows' *title text* — past their icon — which would
     * otherwise indent this row's control behind an icon-sized gap of empty
     * space. Aligning with the icon's own position instead (`checkZone + 4`,
     * matching {@link MenuItem}'s icon inset) keeps the control flush with
     * where a sibling's icon renders, since the control plays the same
     * visual role. With no icon column, `iconStart` already collapses to
     * `checkZone + MenuItem.TEXT_INSET`, so this leaves a plain
     * control-only menu's layout unchanged.
     *
     * @returns This row, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        const control = this.getControl();
        const size = control.getPreferredSize() ?? { width: 0, height: 0 };
        const checkZone           = this._checkZone ?? 0;
        const iconColumnReserved  = this._iconStart !== null && this._iconStart - checkZone === MenuItem.ICON_ZONE;
        const left = iconColumnReserved ? checkZone + 4 : (this._iconStart ?? MenuItem.TEXT_INSET);
        const top  = Math.max(0, Math.floor((box.height - size.height) / 2));

        control.setX(box.x + left);
        control.setY(box.y + top);
        control.setWidth(Math.max(0, box.width - left - MenuItem.RIGHT_PAD));
        control.setHeight(size.height);

        return this;
    }

    /**
     * Registers a listener for this row's `"action"` event — fired after
     * each activation (click or {@link activate}).
     *
     * @param event - The event name. Only `"action"` is accepted.
     * @param listener - The callback to invoke after each activation.
     * @returns This row, for method chaining.
     */
    on(event: AbstractBooleanMenuRowEvent, listener: () => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered `"action"` listener.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     * @returns This row, for method chaining.
     */
    off(event: AbstractBooleanMenuRowEvent, listener: () => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every registered `"action"` listener, in registration order.
     *
     * @param event - The event to emit. Only `"action"` is accepted.
     */
    protected emit(event: AbstractBooleanMenuRowEvent): void {
        this._listeners.fire(event);
    }

    /**
     * Mounts the subclass's control as a pointer-inert child, wires the
     * hover-highlight and click listeners, and applies the disabled dimming.
     * Called by each subclass at the end of its own constructor, once its
     * control field is assigned — nothing in this base's own constructor may
     * call `getControl()`, since the subclass field cannot exist until
     * the subclass constructor body runs.
     */
    protected installControl(): void {
        const control = this.getControl();

        control.setPointerEvents("none");
        this.addComponent(control);

        if (!control.isEnabled()) {
            this.setPointerEvents("none");
            this.setOpacity(DISABLED_OPACITY);
        }

        Event.addListener(this, "mouseover", this.handleMouseOver);
        Event.addListener(this, "mouseout",  this.handleMouseOut);
        Event.addListener(this, "click",     this.handleClick);
    }

    /**
     * Subclass hook: the inner control this row hosts ({@link CheckboxMenuRow}'s
     * `Checkbox`, {@link RadioMenuRow}'s `RadioButton`).
     *
     * @returns The inner control.
     */
    protected abstract getControl(): AbstractBooleanInput;

    /**
     * Subclass hook: perform the value mutation for an activation. Called
     * only after {@link activate}'s enabled guard has passed.
     */
    protected abstract applyActivation(): void;

    private handleMouseOver(): void {
        this.setFocused(true);
    }

    private handleMouseOut(): void {
        this.setFocused(false);
    }

    private handleClick(): void {
        this.activate();
    }
}
