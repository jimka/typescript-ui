// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal counters read by the diagnostics overlay
// (`diagnostics/DiagnosticsOverlay.ts`). This module imports nothing: `Event.ts`
// already imports `Component.ts`, and `Component.ts` imports this module, so an
// import back into either would create a load-bearing module-init cycle. Keeping
// this file importless makes that cycle structurally impossible — see
// `plans/implemented/debug-diagnostics-overlay.md`, footnote `leaf-module`.

/**
 * A snapshot of every pushed diagnostics counter.
 *
 * @category Core
 */
export interface DiagnosticsCounters {
    componentsConstructed: number;
    componentsDestroyed:   number;
    bagListenersAdded:     number;
    bagListenersRemoved:   number;
    layoutPasses:          number;
    layoutFlushes:         number;
    layoutFlushTotalMs:    number;
    layoutFlushMaxMs:      number;
}

/**
 * Module-level counters pushed by the framework's own lifecycle and layout
 * seams (`Component` construction/destruction/layout, `ListenerBag` add/remove).
 * Unconditional integer increments at seams the framework already runs — see
 * `plans/implemented/debug-diagnostics-overlay.md`'s *Architecture Decisions*
 * for why these are pushed rather than derived from a live registry.
 *
 * @category Core
 */
export namespace Diagnostics {
    let componentsConstructed: number = 0;
    let componentsDestroyed:   number = 0;
    let bagListenersAdded:     number = 0;
    let bagListenersRemoved:   number = 0;
    let layoutPasses:          number = 0;
    let layoutFlushes:         number = 0;
    let layoutFlushTotalMs:    number = 0;
    let layoutFlushMaxMs:      number = 0;

    let timingEnabled: boolean = false;

    /** Increments the live `Component` construction count. */
    export function noteComponentConstructed(): void {
        componentsConstructed++;
    }

    /** Increments the live `Component` destruction count. */
    export function noteComponentDestroyed(): void {
        componentsDestroyed++;
    }

    /** Increments the count of listeners registered through a `ListenerBag`. */
    export function noteBagListenerAdded(): void {
        bagListenersAdded++;
    }

    /** Increments the count of listeners removed from a `ListenerBag`. */
    export function noteBagListenerRemoved(): void {
        bagListenersRemoved++;
    }

    /** Increments the count of `Component.doLayout()` passes that actually ran. */
    export function noteLayoutPass(): void {
        layoutPasses++;
    }

    /**
     * Records one `flushPendingLayouts` timing sample: increments the flush
     * count, accumulates its duration, and raises the running maximum.
     *
     * @param durationMs - The measured duration of the flush, in milliseconds.
     */
    export function noteLayoutFlush(durationMs: number): void {
        layoutFlushes++;
        layoutFlushTotalMs += durationMs;

        if (durationMs > layoutFlushMaxMs) {
            layoutFlushMaxMs = durationMs;
        }
    }

    /**
     * Whether `flushPendingLayouts` should time itself. Gates the two
     * `performance.now()` calls so the cost of layout timing is paid only while
     * a consumer is actually watching it (the diagnostics overlay is open).
     *
     * @returns `true` while timing is enabled.
     */
    export function isTimingEnabled(): boolean {
        return timingEnabled;
    }

    /**
     * Enables or disables layout-flush timing.
     *
     * @param enabled - `true` to start timing flushes.
     *
     * @remarks Enabling zeroes `layoutFlushes` / `layoutFlushTotalMs` /
     * `layoutFlushMaxMs` so a freshly opened overlay reads a fresh average
     * rather than one diluted by time the overlay was closed. Disabling leaves
     * the aggregates as they stood, so a closed overlay's last reading is still
     * inspectable.
     */
    export function setTimingEnabled(enabled: boolean): void {
        timingEnabled = enabled;

        if (enabled) {
            layoutFlushes       = 0;
            layoutFlushTotalMs  = 0;
            layoutFlushMaxMs    = 0;
        }
    }

    /**
     * Returns a fresh snapshot of every counter.
     *
     * @returns The current {@link DiagnosticsCounters}.
     */
    export function counters(): DiagnosticsCounters {
        return {
            componentsConstructed,
            componentsDestroyed,
            bagListenersAdded,
            bagListenersRemoved,
            layoutPasses,
            layoutFlushes,
            layoutFlushTotalMs,
            layoutFlushMaxMs,
        };
    }

    /**
     * Zeroes every counter and clears the timing flag.
     *
     * @internal Test-only.
     */
    export function _reset(): void {
        componentsConstructed = 0;
        componentsDestroyed   = 0;
        bagListenersAdded     = 0;
        bagListenersRemoved   = 0;
        layoutPasses          = 0;
        layoutFlushes         = 0;
        layoutFlushTotalMs    = 0;
        layoutFlushMaxMs      = 0;
        timingEnabled         = false;
    }
}
