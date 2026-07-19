// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { DOM } from "~/core/DOM.js";

/**
 * The axis a {@link SmoothScroller} position applies to.
 *
 * @category Core
 */
export type ScrollAxis = "x" | "y";

/**
 * Claims a wheel event for the calling scroll container, returning whether the
 * claim succeeded (the event was not already claimed).
 *
 * @param e - The wheel event to claim.
 *
 * @returns `true` if this caller claimed the event; `false` if an inner
 * container already did.
 *
 * @remarks The framework dispatches subtree events descendant-first, so the
 * innermost scroll container under the pointer sees the wheel first. Claiming
 * it here lets ancestor containers — reached later in the same dispatch — skip a
 * wheel an inner container already handled, restoring the native "inner element
 * traps the wheel" behaviour that a single `preventDefault` used to provide
 * before more than one container processed wheel in JS.
 *
 * @category Core
 */
export function consumeWheel(e: WheelEvent): boolean {
    const marked = e as WheelEvent & { _tsScrollConsumed?: boolean };

    if (marked._tsScrollConsumed) {
        return false;
    }

    marked._tsScrollConsumed = true;

    return true;
}

/**
 * Per-axis read/write/clamp seam that a {@link SmoothScroller} drives. One
 * implementation writes a `translate3d` transform (the virtual-list scroller);
 * another writes `element.scrollLeft` / `element.scrollTop` (native overflow).
 *
 * @category Core
 */
export interface SmoothScrollTarget {

    /**
     * Reads the current live position for `axis`, in pixels.
     *
     * @param axis - The axis to read.
     *
     * @returns The current position in pixels.
     */
    read(axis: ScrollAxis): number;

    /**
     * Writes `value` px to `axis` immediately, without easing.
     *
     * @param axis - The axis to write.
     * @param value - The new position in pixels.
     */
    write(axis: ScrollAxis, value: number): void;

    /**
     * Clamps a requested position for `axis` to its valid `[0, max]` range.
     *
     * @param axis - The axis to clamp.
     * @param value - The requested position in pixels.
     *
     * @returns The clamped position in pixels.
     */
    clamp(axis: ScrollAxis, value: number): number;
}

// One 60 fps frame in milliseconds — the normaliser that makes the exponential
// approach frame-rate independent. Matches the touch-fling loop in
// VirtualScroller so both share one decay-constant family.
const FRAME_MS = 16.667;

// Fraction of the remaining distance left UN-covered after one 60 fps frame.
// 0.75 ⇒ each frame closes ~25% of the gap, settling a typical wheel notch in
// a few frames — empirically tuned against the touch loop's feel; higher feels
// laggy, lower feels like an instant jump.
const SMOOTH_FACTOR = 0.75;

// Sub-pixel distance at which the loop snaps to the target and stops. Below one
// half-pixel there is no visible difference, so continuing to animate only
// wastes frames.
const STOP_PX = 0.5;

/**
 * Re-targetable RAF easing loop that glides a current position toward an
 * accumulated target via frame-rate-independent exponential decay. Built for
 * smooth mouse-wheel scrolling: each wheel tick extends a moving target while
 * the loop is mid-flight, and the loop converges on wherever the target
 * currently is — no tween restart, no easing discontinuity across rapid ticks.
 *
 * Drives any {@link SmoothScrollTarget}, so the same loop serves both the
 * transform-based virtual scroller and native-overflow elements. Programmatic
 * jumps must call {@link reset} so a lingering ease can't snap the user back.
 *
 * @remarks Distinct from the velocity-fling momentum loop in the virtual
 * scroller's touch handler: this one chases a target position; that one decays
 * a release velocity. They intentionally stay separate models.
 *
 * @category Core
 */
export class SmoothScroller {

    private _target  : SmoothScrollTarget;
    private _curX    : number       = 0;
    private _curY    : number       = 0;
    private _tgtX    : number       = 0;
    private _tgtY    : number       = 0;
    private _lastT   : number       = 0;
    private _raf     : number | null = null;

    /**
     * Constructs a SmoothScroller bound to a target seam.
     *
     * @param target - The read/write/clamp seam this scroller drives.
     */
    constructor(target: SmoothScrollTarget) {
        this._target = target;
    }

    /**
     * Accumulates a wheel delta into the target and eases toward it. Under
     * `prefers-reduced-motion: reduce` the clamped target is written
     * immediately and no loop starts.
     *
     * @param deltaX - Horizontal delta in pixels to add to the target.
     * @param deltaY - Vertical delta in pixels to add to the target.
     *
     * @remarks On the first tick of a fresh gesture (loop idle) the current and
     * target seeds are re-read from the live position, so an ease started after
     * the position moved out-of-band (scrollbar drag, keyboard, a programmatic
     * jump, a layout clamp) begins from where the content actually is rather
     * than from stale internal state.
     */
    scrollBy(deltaX: number, deltaY: number): void {
        if (this._raf === null) {
            this._curX = this._tgtX = this._target.read("x");
            this._curY = this._tgtY = this._target.read("y");
        }

        this._tgtX = this._target.clamp("x", this._tgtX + deltaX);
        this._tgtY = this._target.clamp("y", this._tgtY + deltaY);

        if (Animation.isReducedMotion()) {
            this._target.write("x", this._tgtX);
            this._target.write("y", this._tgtY);

            return;
        }

        if (this._raf === null) {
            this._lastT = performance.now();
            this._raf   = DOM.sink.requestAnimationFrame(now => this.step(now));
        }
    }

    /**
     * Aborts the in-flight loop and re-seeds the internal current/target from a
     * fresh read of the live position. Call from every programmatic jump so the
     * jump sticks and a lingering ease can't pull the position back.
     */
    reset(): void {
        if (this._raf !== null) {
            DOM.sink.cancelAnimationFrame(this._raf);
            this._raf = null;
        }

        this._curX = this._tgtX = this._target.read("x");
        this._curY = this._tgtY = this._target.read("y");
    }

    /**
     * Reports whether the easing loop is currently running.
     *
     * @returns `true` while the RAF loop is active.
     */
    isAnimating(): boolean {
        return this._raf !== null;
    }

    /**
     * One easing frame: advances each axis a frame-normalised fraction toward
     * its target, snaps and ends when both are within {@link STOP_PX}.
     *
     * @param now - The `requestAnimationFrame` timestamp in milliseconds.
     */
    private step(now: number): void {
        const frame = now - this._lastT;
        this._lastT = now;

        // Fraction of the remaining gap to close this frame. Normalising the
        // exponent by FRAME_MS makes the glide cover the same proportion of
        // distance per unit time regardless of the actual frame interval.
        const k = 1 - Math.pow(SMOOTH_FACTOR, frame / FRAME_MS);

        this._curX += (this._tgtX - this._curX) * k;
        this._curY += (this._tgtY - this._curY) * k;

        const settledX = Math.abs(this._tgtX - this._curX) < STOP_PX;
        const settledY = Math.abs(this._tgtY - this._curY) < STOP_PX;

        if (settledX) {
            this._curX = this._tgtX;
        }
        if (settledY) {
            this._curY = this._tgtY;
        }

        this._target.write("x", this._curX);
        this._target.write("y", this._curY);

        if (settledX && settledY) {
            this._raf = null;

            return;
        }

        this._raf = DOM.sink.requestAnimationFrame(next => this.step(next));
    }
}
