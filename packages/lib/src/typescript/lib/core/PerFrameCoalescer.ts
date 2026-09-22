// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal per-frame buffer for a high-frequency pointer stream,
// lifted out of `overlay/AbstractWindow.ts` so more than one module can share
// it: the window's own edge-resize and snap-move paths, and the drag session
// in `core/ResizeDrag.ts` that every resize drag runs through. Not exported
// from `core/index.ts` — it is framework plumbing, not consumer API, the same
// footing as `core/PendingPointerDrags.ts`.

import { DOM } from "~/core/DOM.js";

/**
 * Buffers the latest not-yet-applied value from a high-frequency event (e.g.
 * `mousemove`) and applies it at most once per animation frame, optionally
 * capped to a slower rate. Only the most recent value before a frame lands is
 * kept — an intermediate value between two events was never going to be
 * visible anyway. `T` must not itself use `null` as a meaningful value: `null`
 * is the buffer's own "nothing pending" sentinel.
 */
export class PerFrameCoalescer<T> {
    private _pending: T | null = null;
    private _rafHandle: number | null = null;
    private _lastFlushTime: number = 0;
    private readonly _apply: (value: T) => void;
    private readonly _fps?: () => number | undefined;

    /**
     * Constructs a coalescer around the given apply callback and optional fps cap.
     *
     * @param apply - Called with the most recent buffered value when a frame
     *   (or a {@link forceFlush}) applies it.
     * @param fps - Optional live frames-per-second cap, read fresh on every
     *   frame so a setter can change it mid-flight. Omit for no cap. A getter
     *   that returns `undefined` leaves that one frame uncapped, so a caller
     *   whose cap only applies to some frames can switch it off per frame
     *   rather than per session.
     */
    constructor(apply: (value: T) => void, fps?: () => number | undefined) {
        this._apply = apply;
        this._fps = fps;
    }

    /**
     * Buffers `value`, overwriting any not-yet-applied value, and arms a
     * `requestAnimationFrame` if one isn't already pending.
     */
    schedule(value: T): void {
        this._pending = value;

        if (this._rafHandle === null) {
            this._rafHandle = DOM.sink.requestAnimationFrame((ts) => this.onFrame(ts));
        }
    }

    /**
     * The `requestAnimationFrame` callback. Re-arms itself without draining
     * the buffer when the fps cap says it's too soon; otherwise applies the
     * buffered value.
     */
    private onFrame(timestamp: number): void {
        const fps = this._fps?.();
        if (fps !== undefined && timestamp - this._lastFlushTime < 1000 / fps) {
            this._rafHandle = DOM.sink.requestAnimationFrame((ts) => this.onFrame(ts));
            return;
        }

        this._lastFlushTime = timestamp;
        this._rafHandle = null;
        this.drain();
    }

    /**
     * Cancels any pending frame and applies the buffered value immediately,
     * bypassing the fps cap — for a caller that must commit the freshest
     * value synchronously (e.g. at `mousedown`). A no-op if nothing is
     * buffered.
     */
    forceFlush(): void {
        if (this._rafHandle !== null) {
            DOM.sink.cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }

        this.drain();
    }

    /**
     * Cancels any pending frame and discards the buffered value without
     * applying it — for teardown, where a buffered value must never commit.
     */
    cancel(): void {
        if (this._rafHandle !== null) {
            DOM.sink.cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }

        this._pending = null;
    }

    /**
     * Clears the buffered value and, if one was pending, applies it.
     */
    private drain(): void {
        const value = this._pending;

        this._pending = null;

        if (value !== null) {
            this._apply(value);
        }
    }
}
