// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Construction options for {@link AutoRepeat}.
 *
 * @category Core
 */
export interface AutoRepeatOptions {
    /** Delay before the first repeat tick, in ms. */
    initialDelay: number;
    /** Multiplier applied to the delay after each tick (`0 < decay <= 1`). */
    decay: number;
    /** Lower bound the decaying delay never drops below, in ms. */
    floor: number;
    /** Invoked once immediately on {@link AutoRepeat.start} and once per scheduled tick. */
    onTick: () => void;
}

/**
 * The press-and-hold *accelerating* auto-repeat state machine, extracted from the
 * spin button and scrollbar arrow so both drive one implementation.
 *
 * {@link start} fires `onTick` once immediately, then schedules repeats whose
 * interval starts at `initialDelay` and shrinks by `decay` after every tick,
 * never dropping below `floor`. {@link stop} cancels the schedule and resets the
 * interval, so a subsequent press begins again at `initialDelay`.
 *
 * It is a plain class (no DOM element, so not `callable()`-wrapped) and drives an
 * owner-supplied callback rather than emitting its own events — each host keeps
 * dispatching through its own event surface. `setTimeout` is a process timer, not
 * a DOM call, so it does not route through the DOM seam.
 *
 * @category Core
 */
export class AutoRepeat {

    private readonly _initialDelay: number;
    private readonly _decay: number;
    private readonly _floor: number;
    private readonly _onTick: () => void;
    private _handle: ReturnType<typeof setTimeout> | null = null;
    private _delay: number;

    /**
     * @param options - The repeat timing and the per-tick callback.
     */
    constructor(options: AutoRepeatOptions) {
        this._initialDelay = options.initialDelay;
        this._decay        = options.decay;
        this._floor        = options.floor;
        this._onTick       = options.onTick;
        this._delay        = options.initialDelay;
    }

    /**
     * Fires `onTick` immediately, then schedules accelerating repeats starting
     * at `initialDelay`.
     */
    start(): void {
        this._onTick();
        this._delay = this._initialDelay;
        this.scheduleNext();
    }

    /**
     * Cancels any pending schedule and resets the interval to `initialDelay`.
     */
    stop(): void {
        if (this._handle !== null) {
            clearTimeout(this._handle);
            this._handle = null;
        }

        this._delay = this._initialDelay;
    }

    /**
     * Returns whether a repeat schedule is currently armed.
     *
     * @returns `true` between {@link start} and {@link stop}.
     */
    isRunning(): boolean {
        return this._handle !== null;
    }

    /**
     * Schedules the next tick at the current interval, then decays the interval
     * (×`decay`, floored at `floor`) for the tick after it.
     */
    private scheduleNext(): void {
        this._handle = setTimeout(() => {
            this._onTick();
            this._delay = Math.max(this._floor, this._delay * this._decay);
            this.scheduleNext();
        }, this._delay);
    }
}
