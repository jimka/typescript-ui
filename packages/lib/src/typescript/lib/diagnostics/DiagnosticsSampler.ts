// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Diagnostics } from "~/core/Diagnostics.js";
import { Event } from "~/core/Event.js";
import { styleRuleCounts, type StyleRuleCounts } from "~/core/StyleTarget.js";
import { DOM } from "~/core/DOM.js";

/** Default sample-window length, matching the overlay's twice-a-second readout. */
const SAMPLE_INTERVAL_MS_DEFAULT = 500;

/** Bytes per megabyte, for converting `performance.memory`'s byte counts. */
const BYTES_PER_MB = 1024 * 1024;

/**
 * Every framework-internal diagnostics reading, assembled from the pushed
 * `Diagnostics` counters and the derived `Event` / `StyleTarget` registries.
 * Pure and offline-safe: no timing, no DOM reads.
 *
 * @category Core
 */
export interface FrameworkCounts {
    /** Live component count — `componentsConstructed - componentsDestroyed`. */
    components:            number;
    componentsConstructed: number;
    componentsDestroyed:   number;
    layoutPasses:          number;
    layoutFlushes:         number;
    layoutFlushTotalMs:    number;
    layoutFlushMaxMs:      number;
    domListeners:          Event.ListenerCounts;
    /** Live semantic listener count — `bagListenersAdded - bagListenersRemoved`. */
    semanticListeners:     number;
    styleRules:            StyleRuleCounts;
}

/**
 * Reads every framework counter once. No timing, no DOM reads — offline-safe.
 *
 * @returns The current {@link FrameworkCounts}.
 */
export function readFrameworkCounts(): FrameworkCounts {
    const counters = Diagnostics.counters();

    return {
        components:            counters.componentsConstructed - counters.componentsDestroyed,
        componentsConstructed: counters.componentsConstructed,
        componentsDestroyed:   counters.componentsDestroyed,
        layoutPasses:          counters.layoutPasses,
        layoutFlushes:         counters.layoutFlushes,
        layoutFlushTotalMs:    counters.layoutFlushTotalMs,
        layoutFlushMaxMs:      counters.layoutFlushMaxMs,
        domListeners:          Event.listenerCounts(),
        semanticListeners:     counters.bagListenersAdded - counters.bagListenersRemoved,
        styleRules:            styleRuleCounts(),
    };
}

/**
 * One window's worth of browser-level and framework-level diagnostics
 * readings, handed to {@link DiagnosticsSamplerOptions.onSample}.
 *
 * @category Core
 */
export interface DiagnosticsSample {
    fps:                    number;
    frameTimeMs:            number;
    frameTimeMaxMs:         number;
    heapUsedMB:             number | null;
    heapLimitMB:            number | null;
    domNodes:               number;
    /** Cumulative long-task count since {@link DiagnosticsSampler.start}. */
    longTasks:              number;
    /** Long-task count observed within this sample window only. */
    longTasksRecent:        number;
    components:             number;
    componentsConstructed:  number;
    componentsDestroyed:    number;
    layoutPassesPerSec:     number;
    /** Running average flush cost since timing was last enabled. */
    layoutFlushAvgMs:       number;
    layoutFlushMaxMs:       number;
    /** The `total` of {@link Event.ListenerCounts}, flattened. */
    domListeners:           number;
    semanticListeners:      number;
    styleRules:             StyleRuleCounts;
}

/**
 * Construction options for {@link DiagnosticsSampler}.
 *
 * @category Core
 */
export interface DiagnosticsSamplerOptions {
    /** Sample window length in ms. Default `500`. */
    intervalMs?: number;
    /** Invoked once per sample window while the sampler is running. */
    onSample:    (sample: DiagnosticsSample) => void;
}

/**
 * Drives the diagnostics overlay's live readout: one `requestAnimationFrame`
 * chain measures FPS and per-frame time, aggregates long tasks via a
 * `PerformanceObserver` when supported, and every {@link DiagnosticsSamplerOptions.intervalMs}
 * assembles a {@link DiagnosticsSample} from the framework counters, the DOM
 * node count, and `performance.memory` (when available).
 *
 * Not a `Component`, so it is not `callable()`-wrapped.
 *
 * @category Core
 */
export class DiagnosticsSampler {

    private readonly _onSample:   (sample: DiagnosticsSample) => void;
    private readonly _intervalMs: number;

    private _running:  boolean          = false;
    private _rafHandle: number | null   = null;
    private _observer: PerformanceObserver | null = null;

    // Sample-window accumulators, reset at the top of every window.
    private _windowStart:         number | null = null;
    private _lastFrameTs:         number | null = null;
    private _frameCount:          number         = 0;
    private _frameTimeMaxMs:      number         = 0;
    private _longTasksThisWindow: number         = 0;

    // Session accumulators, reset only by start().
    private _longTasksTotal:   number = 0;
    private _prevLayoutPasses: number = 0;

    private readonly _boundOnFrame:     FrameRequestCallback       = (ts) => this.onFrame(ts);
    private readonly _boundOnLongTasks: PerformanceObserverCallback = (list) => this.onLongTasks(list);

    /**
     * @param options - Sample interval and the per-window callback.
     */
    constructor(options: DiagnosticsSamplerOptions) {
        this._onSample   = options.onSample;
        this._intervalMs = options.intervalMs ?? SAMPLE_INTERVAL_MS_DEFAULT;
    }

    /**
     * Starts the frame loop. Idempotent — a no-op while already running.
     *
     * @remarks Enables {@link Diagnostics.setTimingEnabled}, so a freshly
     * started sampler reads a fresh layout-flush average rather than one
     * diluted by time spent stopped. Installs the long-task observer when the
     * engine supports it.
     */
    start(): void {
        if (this._running) {
            return;
        }

        this._running = true;

        Diagnostics.setTimingEnabled(true);

        this._windowStart         = null;
        this._lastFrameTs         = null;
        this._frameCount          = 0;
        this._frameTimeMaxMs      = 0;
        this._longTasksThisWindow = 0;
        this._longTasksTotal      = 0;
        this._prevLayoutPasses    = Diagnostics.counters().layoutPasses;

        if (typeof PerformanceObserver !== "undefined"
            && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
            this._observer = new PerformanceObserver(this._boundOnLongTasks);
            this._observer.observe({ entryTypes: ["longtask"] });
        }

        this._rafHandle = DOM.sink.requestAnimationFrame(this._boundOnFrame);
    }

    /**
     * Stops the frame loop and disconnects the long-task observer, if one was
     * installed. Idempotent — a no-op while already stopped.
     */
    stop(): void {
        if (!this._running) {
            return;
        }

        this._running = false;

        if (this._rafHandle !== null) {
            DOM.sink.cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }

        this._observer?.disconnect();
        this._observer = null;

        Diagnostics.setTimingEnabled(false);
    }

    /**
     * Whether the frame loop is currently running.
     *
     * @returns `true` between a `start()` and its matching `stop()`.
     */
    isRunning(): boolean {
        return this._running;
    }

    /**
     * The `requestAnimationFrame` callback: accumulates this frame into the
     * current window's stats and, once the window has elapsed, assembles and
     * emits a sample before starting the next window.
     *
     * @param ts - The frame's own high-resolution timestamp, supplied by the
     *   browser. Reused as both the frame-delta clock and the window clock so
     *   no extra `performance.now()` read happens per frame.
     */
    private onFrame(ts: number): void {
        if (this._lastFrameTs !== null) {
            const delta = ts - this._lastFrameTs;

            this._frameCount++;

            if (delta > this._frameTimeMaxMs) {
                this._frameTimeMaxMs = delta;
            }
        }
        this._lastFrameTs = ts;

        if (this._windowStart === null) {
            this._windowStart = ts;
        }

        const elapsedMs = ts - this._windowStart;

        if (elapsedMs >= this._intervalMs) {
            this.emitSample(elapsedMs);

            this._windowStart         = ts;
            this._frameCount          = 0;
            this._frameTimeMaxMs      = 0;
            this._longTasksThisWindow = 0;
        }

        this._rafHandle = DOM.sink.requestAnimationFrame(this._boundOnFrame);
    }

    /**
     * The `PerformanceObserver` callback for `"longtask"` entries: folds the
     * batch into both the cumulative and current-window long-task counts.
     *
     * @param list - The observed batch of long-task entries.
     */
    private onLongTasks(list: PerformanceObserverEntryList): void {
        const n = list.getEntries().length;

        this._longTasksTotal      += n;
        this._longTasksThisWindow += n;
    }

    /**
     * Assembles one {@link DiagnosticsSample} from the current window's
     * accumulators plus the framework counters, the DOM node count, and
     * `performance.memory`, and hands it to the configured callback.
     *
     * @param elapsedMs - The elapsed time covered by this window, in ms.
     */
    private emitSample(elapsedMs: number): void {
        const framework    = readFrameworkCounts();
        const deltaPasses  = framework.layoutPasses - this._prevLayoutPasses;
        this._prevLayoutPasses = framework.layoutPasses;

        const memory = (performance as unknown as {
            memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        }).memory;

        const sample: DiagnosticsSample = {
            fps:                   this._frameCount > 0 && elapsedMs > 0 ? (this._frameCount / elapsedMs) * 1000 : 0,
            frameTimeMs:            this._frameCount > 0 ? elapsedMs / this._frameCount : 0,
            frameTimeMaxMs:         this._frameTimeMaxMs,
            heapUsedMB:             memory ? memory.usedJSHeapSize  / BYTES_PER_MB : null,
            heapLimitMB:            memory ? memory.jsHeapSizeLimit / BYTES_PER_MB : null,
            domNodes:               DOM.source.countElements(),
            longTasks:              this._longTasksTotal,
            longTasksRecent:        this._longTasksThisWindow,
            components:             framework.components,
            componentsConstructed:  framework.componentsConstructed,
            componentsDestroyed:    framework.componentsDestroyed,
            layoutPassesPerSec:     elapsedMs > 0 ? (deltaPasses / elapsedMs) * 1000 : 0,
            layoutFlushAvgMs:       framework.layoutFlushes > 0 ? framework.layoutFlushTotalMs / framework.layoutFlushes : 0,
            layoutFlushMaxMs:       framework.layoutFlushMaxMs,
            domListeners:           framework.domListeners.total,
            semanticListeners:      framework.semanticListeners,
            styleRules:             framework.styleRules,
        };

        this._onSample(sample);
    }
}
