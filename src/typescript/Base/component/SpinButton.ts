// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "./Button.js";
import { Event } from "../Event.js";
import { Util } from "../Util.js";
import { ThemeManager } from "../Theme.js";
import { BorderStyle } from "../BorderStyle.js";
import { Insets } from "../Insets.js";
import { callable } from "../Callable.js";

/**
 * Construction-time options for {@link SpinButton}.
 *
 * @category Components
 */
export interface SpinButtonOptions extends ButtonOptions {
}

/**
 * A small up- or down-arrow button used inside a NumberSpinner.
 *
 * Extends Button to inherit the pressed-state appearance and click handling, then
 * adds a hold-repeat gesture: pressing and holding fires `tick` events at an
 * accelerating cadence (initial 400 ms, multiplied by 0.75 per tick, floored at 40 ms).
 *
 * @category Components
 */
class SpinButton extends Button {

    private tickListeners: Array<() => void> = [];
    private repeatHandle : ReturnType<typeof setTimeout> | null = null;
    private repeatDelay  : number = 400;

    /**
     * @param symbol - The arrow glyph rendered inside the button (`"▲"` or `"▼"`).
     */
    constructor(symbol: "▲" | "▼", options?: SpinButtonOptions) {
        super(symbol);

        this.updateSize();
        ThemeManager.onThemeChange(() => this.updateSize());

        this.setShadow(null);
        this.setPressedShadow(null);
        this.setBorder({ style: BorderStyle.NONE });
        this.setBorderRadius("0");
        this.setInsets(new Insets(0, 0, 0, 0));
        this.getText().setFontSize(9);
        this.getText().setLineHeight(9);

        Event.addListener(this, "mousedown", () => this.onMouseDown());
        Event.addViewportListener(this, "mouseup", () => this.onMouseUp());
        Event.addViewportListener(this, "mouseleave", () => this.onMouseUp());

        if (options) {
            this.applyOptions(options);
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
        const halfHeight = Math.floor(fullHeight / 2);

        this.setPreferredSize(18, halfHeight);
        this.setMaxSize(18, halfHeight);
    }

    /**
     * Registers a callback that fires on each logical tick (initial click and each hold-repeat tick).
     *
     * @param listener - The callback invoked on every tick.
     */
    addTickListener(listener: () => void): void {
        this.tickListeners.push(listener);
    }

    /**
     * Cancels any in-progress hold-repeat schedule and resets the tick delay to its initial value.
     */
    cancelRepeat(): void {
        if (this.repeatHandle !== null) {
            clearTimeout(this.repeatHandle);
            this.repeatHandle = null;
        }

        this.repeatDelay = 400;
    }

    /**
     * Fires the first tick immediately and schedules subsequent accelerating ticks.
     */
    private onMouseDown(): void {
        this.fireTicks();
        this.scheduleNext();
    }

    /**
     * Cancels the hold-repeat schedule when the pointer is released or leaves the viewport.
     */
    private onMouseUp(): void {
        if (this.repeatHandle === null) {
            return;
        }

        this.cancelRepeat();
    }

    /**
     * Schedules the next hold-repeat tick using the current `repeatDelay`, then accelerates
     * the delay (×0.75, floored at 40 ms) for the following tick.
     */
    private scheduleNext(): void {
        this.repeatHandle = setTimeout(() => {
            this.fireTicks();
            this.repeatDelay = Math.max(40, this.repeatDelay * 0.75);
            this.scheduleNext();
        }, this.repeatDelay);
    }

    /**
     * Invokes all registered tick listeners in registration order.
     */
    private fireTicks(): void {
        for (const fn of this.tickListeners) {
            fn();
        }
    }
}

const SpinButtonCallable = callable(SpinButton);
type SpinButtonCallable = SpinButton;
export {
    SpinButton         as _SpinButton,
    SpinButtonCallable as SpinButton
};
