// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonEvent, ButtonOptions, ClickListener } from "~/component/button/Button.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Util } from "~/core/Util.js";
import { ThemeManager } from "~/core/Theme.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { Glyph } from "~/component/display/Glyph.js";
import { chevron_up } from "~/glyphs/solid/chevron_up.js";
import { chevron_down } from "~/glyphs/solid/chevron_down.js";

/**
 * String-literal union of the events emitted by {@link SpinButton}. Extends
 * the inherited `ButtonEvent` union with the spin-specific events.
 *
 * @category Components
 */
export type SpinButtonEvent = ButtonEvent | "tick";

Glyph.register(chevron_up, chevron_down);

/**
 * Construction-time options for {@link SpinButton}.
 *
 * @category Components
 */
export interface SpinButtonOptions extends ButtonOptions {
    /**
     * Multi-event listener bag dispatched to {@link SpinButton.on} at
     * construction time.
     */
    listeners?: {
        tick?: () => void;
    };
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * Strips [`Button`](/api/component/button/classes/Button)'s chrome (border /
 * radius / insets) so the spinner sits flush in its NumberSpinner cell. The
 * `shadow`/`pressedShadow` clears can't ride here — they're `clear*` calls
 * with no equivalent option value — so they stay in the constructor body
 * guarded on the consumer options bag.
 */
const _defaultSpinButtonOptions: Partial<SpinButtonOptions> = {
    border:       { style: BorderStyle.NONE },
    borderRadius: "0",
    insets:       new Insets(0, 0, 0, 0),
};

/**
 * A small up- or down-arrow button used inside a NumberSpinner.
 *
 * Extends Button to inherit the pressed-state appearance and click handling, then
 * adds a hold-repeat gesture: pressing and holding fires `tick` events at an
 * accelerating cadence (initial 400 ms, multiplied by 0.75 per tick, floored at 40 ms).
 *
 * @category Components
 */
class SpinButton extends Button<SpinButtonOptions> {

    private _listeners    : ListenerBag<SpinButtonEvent> = new ListenerBag<SpinButtonEvent>();
    private _repeatHandle : ReturnType<typeof setTimeout> | null = null;
    private _repeatDelay  : number = 400;

    /**
     * @param symbol - The arrow rendered inside the button (`"▲"` or `"▼"`).
     *                 Mapped internally to the matching SVG glyph in the
     *                 framework's glyph registry.
     */
    constructor(symbol: "▲" | "▼", options?: SpinButtonOptions) {
        // Hand defaults plus the symbol-derived glyph to Button via the
        // subclass-defaults arg so they land in `_defaultOptions`. User
        // options still win because Component merges `{...defaults, ...options}`
        // at dispatch time.
        super(undefined, options, {
            ..._defaultSpinButtonOptions,
            glyph: symbol === "▲" ? "chevron-up" : "chevron-down",
        });

        this.updateSize();
        ThemeManager.onThemeChange(() => this.updateSize());

        // `clearShadow` / `clearPressedShadow` have no representable option
        // value (they write `box-shadow: none` and `_options.shadow = undefined`
        // — distinct from `setShadow("none")` which stores the literal string),
        // so they stay in the body, guarded on the consumer bag.
        if (options?.shadow === undefined) {
            this.clearShadow();
        }
        if (options?.pressedShadow === undefined) {
            this.clearPressedShadow();
        }

        // Shrink the glyph so it fits the half-height (≈11 px) spin-button.
        // The 1 px upward translate compensates for sub-pixel rounding in the
        // Button's centring math: the measured input height is often odd,
        // making `(halfHeight - 8) / 2` a fractional value that the browser
        // resolves toward the bottom of the cell.
        const glyph = this.getGlyph();
        if (glyph) {
            glyph.setPreferredSize(8, 8);
            glyph.setTranslate(0, -1);
        }

        Event.addListener(this, "mousedown", () => this.onMouseDown());
        Event.addViewportListener(this, "mouseup", () => this.onMouseUp());
        Event.addViewportListener(this, "mouseleave", () => this.onMouseUp());

        if (options?.listeners?.tick !== undefined) {
            this.on("tick", options.listeners.tick);
        }
    }

    /**
     * Recalculates preferred and maximum size from the native input height divided in half.
     *
     * Called at construction time and after each theme change so font-size adjustments
     * propagate to the layout hint automatically.
     */
    private updateSize(): void {
        const fullHeight = Util.measureInputHeight();
        // Subtract the host NumberSpinner's 1 px top + bottom border so two
        // stacked buttons fit inside the spinner's inner rect — without this,
        // an odd `fullHeight` produces `2 * floor(h/2) = h - 1` which exceeds
        // the inner height `h - 2` and clips the bottom button.
        const halfHeight = Math.floor((fullHeight - 2) / 2);

        this.setPreferredSize(18, halfHeight);
        // Min = preferred = max so the parent's shrink-on-overallocation
        // doesn't collapse the chevron away when the spinner cell is
        // narrow.
        this.setMinSize(18, halfHeight);
        this.setMaxSize(18, halfHeight);
    }

    /**
     * Registers a listener for one of this spin button's events.
     *
     * @param event - `"action"` is the inherited DOM-routed click;
     *   `"tick"` fires on each logical tick (initial click plus every
     *   subsequent hold-repeat tick).
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This spin button, for method chaining.
     */
    on(event: "action",         listener: ClickListener): this;
    on(event: "tick",           listener: () => void): this;
    on(event: SpinButtonEvent,  listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "click", listener as ClickListener);
        } else {
            this._listeners.add(event, listener);
        }

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This spin button, for method chaining.
     */
    off(event: "action",        listener: ClickListener): this;
    off(event: "tick",          listener: () => void): this;
    off(event: SpinButtonEvent, listener: Function): this {
        if (event === "action") {
            Event.removeListener(this, "click", listener as ClickListener);
        } else {
            this._listeners.remove(event, listener);
        }

        return this;
    }

    /**
     * Fires every listener registered for `event` (excluding `"click"`, which
     * routes through the framework's DOM event surface) with no arguments.
     *
     * @param event - The event to emit. Only non-DOM events (currently
     *   `"tick"`) are dispatched through this method.
     */
    protected emit(event: "tick"): void;
    protected emit(event: "tick", ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Cancels any in-progress hold-repeat schedule and resets the tick delay to its initial value.
     */
    cancelRepeat(): void {
        if (this._repeatHandle !== null) {
            clearTimeout(this._repeatHandle);
            this._repeatHandle = null;
        }

        this._repeatDelay = 400;
    }

    /**
     * Fires the first tick immediately and schedules subsequent accelerating ticks.
     */
    private onMouseDown(): void {
        this.emit("tick");
        this.scheduleNext();
    }

    /**
     * Cancels the hold-repeat schedule when the pointer is released or leaves the viewport.
     */
    private onMouseUp(): void {
        if (this._repeatHandle === null) {
            return;
        }

        this.cancelRepeat();
    }

    /**
     * Schedules the next hold-repeat tick using the current `repeatDelay`, then accelerates
     * the delay (×0.75, floored at 40 ms) for the following tick.
     */
    private scheduleNext(): void {
        this._repeatHandle = setTimeout(() => {
            this.emit("tick");
            this._repeatDelay = Math.max(40, this._repeatDelay * 0.75);
            this.scheduleNext();
        }, this._repeatDelay);
    }
}

const SpinButtonCallable = callable(SpinButton);
type SpinButtonCallable = SpinButton;
export {
    SpinButton         as _SpinButton,
    SpinButtonCallable as SpinButton
};
