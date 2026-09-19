// The frame loop, the pass loop and the timing summary. Ported from Loom's
// `measureRaf` and `summarize`; nothing here runs at import time.

import { sampleGeometry } from './probes.js';
import type { FrameSummary } from './types.js';

/**
 * One 60 Hz frame, in milliseconds: a sample above it missed a frame, which
 * is what `summarize`'s `over16` counts.
 */
const FRAME_BUDGET_MS = 16.7;

/** The quantiles `summarize` reports as `p50Ms` and `p90Ms`, Loom's pair. */
const MEDIAN = 0.5;
const P90 = 0.9;

/**
 * Decimal places kept in a summary. Loom's rounding: hundredths of a
 * millisecond are below the engine's timer resolution, and keeping them the
 * same keeps the app's figures comparable with the campaign's.
 */
const SUMMARY_DECIMALS = 2;

/** Driven units so far; per-pass memo ablations key on it. */
let frameCounter = 0;

/**
 * The current driven-unit index. It increments once per unit of every phase,
 * so a memo keyed on it lives exactly one frame or pass.
 *
 * @returns The number of units driven so far.
 */
export function currentFrame(): number {
    return frameCounter;
}

/**
 * Runs `units` animation frames. Per frame, in order: records the gap since
 * the previous frame, advances the frame counter, runs `step(index)` and
 * samples geometry.
 *
 * A throw in that work rejects the promise and requests no further frame, so
 * the run reports the error instead of hanging.
 *
 * @param units - How many frames to run.
 * @param step - The per-frame work, given the frame's index.
 * @returns The gaps between frames, in ms, without the first (from the call to the first frame).
 */
export function runFrames(units: number, step: (index: number) => void): Promise<number[]> {
    return new Promise<number[]>((resolve, reject) => {
        const gaps: number[] = [];
        let last = performance.now();
        let index = 0;

        /**
         * One frame's work; schedules the next frame or settles the promise.
         *
         * @param now - The frame's timestamp.
         */
        function frame(now: number): void {
            try {
                gaps.push(now - last);
                last = now;
                frameCounter++;
                step(index);
                sampleGeometry();
            } catch (error) {
                // No further frame is requested.
                reject(error);

                return;
            }

            index++;

            if (index < units) {
                requestAnimationFrame(frame);
            } else {
                resolve(gaps.slice(1));
            }
        }

        requestAnimationFrame(frame);
    });
}

/**
 * Runs `units` passes synchronously, with `runFrames`' per-unit order:
 * advances the frame counter, runs `step(index)` and samples geometry.
 *
 * @param units - How many passes to run.
 * @param step - The per-pass work, given the pass's index.
 * @returns Each pass's `step` duration, in ms; rejects with whatever `step` throws.
 */
export async function runPasses(units: number, step: (index: number) => void): Promise<number[]> {
    const samples: number[] = [];

    for (let index = 0; index < units; index++) {
        frameCounter++;

        const start = performance.now();

        step(index);
        samples.push(performance.now() - start);
        sampleGeometry();
    }

    return samples;
}

/**
 * Runs `units` frames that do nothing, to measure the idle frame rate.
 *
 * @param units - How many frames to run.
 * @returns The gaps between frames, in ms.
 */
export function measureIdle(units: number): Promise<number[]> {
    return runFrames(units, () => {});
}

/**
 * Waits `frames` animation frames, so a change a driver made in its setup or
 * teardown can restyle and lay out. Unlike `runFrames` it advances no frame
 * counter and samples no geometry.
 *
 * @param frames - How many frames to wait.
 */
export async function waitFrames(frames: number): Promise<void> {
    for (let i = 0; i < frames; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
}

/**
 * Summarises timing samples: count, mean, median, 90th percentile, maximum,
 * and how many exceed one 60 Hz frame. An empty list summarises as zeros.
 *
 * @param samples - Timing samples, in ms.
 * @returns The summary, rounded to hundredths.
 */
export function summarize(samples: number[]): FrameSummary {
    const sorted = [...samples].sort((a, b) => a - b);
    const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    const total = samples.reduce((a, b) => a + b, 0);

    // `Math.max(1, …)` makes an empty list's mean 0 instead of NaN.
    return {
        n: samples.length,
        avgMs: +(total / Math.max(1, samples.length)).toFixed(SUMMARY_DECIMALS),
        p50Ms: +pick(MEDIAN).toFixed(SUMMARY_DECIMALS),
        p90Ms: +pick(P90).toFixed(SUMMARY_DECIMALS),
        maxMs: +(sorted[sorted.length - 1] ?? 0).toFixed(SUMMARY_DECIMALS),
        over16: samples.filter((g) => g > FRAME_BUDGET_MS).length,
    };
}
