// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Simulates an actual multi-frame `Split`-gutter drag against Panel's
// resize-metrics coalescing: exactly one real `doLayout()` pass per animation
// frame, interleaved with draining whatever settle-relay callback is
// currently queued *before* each pass — mirroring the real timing: the
// panel's own settle-relay callback for a given frame is registered
// synchronously during the *previous* frame's pass, so it always sorts
// earlier in that frame's `requestAnimationFrame` batch than the drag's own
// per-frame pass, which is registered later, by a `mousemove` task that runs
// only after the previous frame's batch has fully completed.
//
// PanelResizeMetricsCoalescing.test.ts's cases call `doLayout()` several
// times back-to-back with no intervening frame — a shape a real `Split`
// -driven drag never produces, and the exact shape that let an earlier,
// single-hop settle relay pass every one of that file's cases while never
// actually withholding anything during a real drag (see
// ScrollStrip.resizeResyncCoalescingRealtime.test.ts, whose header comment
// documents the same trap for the identical two-hop shape this plan mirrors).
// This file pins the realistic per-frame shape instead.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The drag's starting size; each frame below shrinks the width by 1px,
// height held constant.
const START_WIDTH  = 400;
const HEIGHT        = 300;

let nextFrameHandle = 1;
let frames: Map<number, FrameRequestCallback> = new Map();

beforeEach(() => {
    installTestDOM(CONFIG);
    nextFrameHandle = 1;
    frames = new Map();
    (DOM.sink as any).requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const handle = nextFrameHandle++;
        frames.set(handle, callback);

        return handle;
    };
    (DOM.sink as any).cancelAnimationFrame = (handle: number): void => {
        frames.delete(handle);
    };
});

afterEach(() => {
    // A still-armed settle handle leaves Component's shared afterNextLayout
    // flush queued — cancel() only sets a flag (Component.afterNextLayout's
    // contract), it doesn't deregister the frame. Drain it here so a test
    // that ends mid-drag doesn't leave Component's module-level rafHandle
    // non-null, which would make the next test's own
    // scheduleScrollMetricsSettle() find a flush already "pending" and skip
    // registering a fresh frame.
    drainFrames();
    vi.restoreAllMocks();
    DOM.reset();
});

/** Stages the element geometry the three helpers read, defaulting every axis to "fits" (no overflow). */
function stubMetrics() {
    return vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
        scrollTop: 0, scrollLeft: 0,
        scrollWidth: 400, scrollHeight: 300,
        clientWidth: 400, clientHeight: 300,
    });
}

/**
 * Fires exactly the frames currently queued, without draining any a callback
 * re-queues in turn — one real `requestAnimationFrame` batch.
 */
function runQueuedFramesOnce(): void {
    const pending = Array.from(frames.values());
    frames.clear();

    for (const callback of pending) {
        callback(0);
    }
}

/** Runs queued frames to quiescence, including any newly re-armed in turn. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.size > 0; guard++) {
        runQueuedFramesOnce();
    }
}

/** Narrow shape reaching the settle-relay handle without `any`. */
type ScrollMetricsInternals = { _scrollMetricsSettleHandle: { cancel(): void } | null };

function internals(panel: _Panel): ScrollMetricsInternals {
    return panel as unknown as ScrollMetricsInternals;
}

/** One real drag frame: the single `doLayout()` pass a live external resize would trigger this frame. */
function realDragFrame(panel: _Panel, width: number): void {
    panel.setWidth(width);
    panel.setHeight(HEIGHT);
    panel.doLayout();
}

/**
 * Advances one real animation frame of an ongoing drag: first fires whatever
 * settle-relay callback is currently queued — registered during the
 * *previous* frame, so it always sorts earlier in this frame's batch than the
 * drag's own pass (see this file's header comment) — then runs this frame's
 * real drag pass.
 */
function advanceDragFrame(panel: _Panel, width: number): void {
    runQueuedFramesOnce();
    realDragFrame(panel, width);
}

describe('Panel resize-metrics coalescing under a realistic one-pass-per-frame drag', () => {
    it('withholds the remeasure on every frame after the first while the drag continues', () => {
        const spy = stubMetrics();
        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);
        const afterMount = spy.mock.calls.length;

        realDragFrame(panel, START_WIDTH); // frame 1: drag start, always live

        const before = spy.mock.calls.length;

        // Pin that frame 1 actually measured something live — otherwise the
        // delta-to-`before` check below (`0 === 0`) would pass vacuously for
        // a mechanism that withholds everything, including the first pass.
        expect(before).toBeGreaterThan(afterMount);

        // Frames 2-20: a continuing drag, one real pass per frame, each a
        // genuinely different width — the scenario this plan exists to fix.
        // Under a settle mechanism that races the same-frame real pass (the
        // defect this file's header comment describes), every one of these
        // would remeasure live too, same as before the fix.
        for (let frame = 2; frame <= 20; frame++) {
            advanceDragFrame(panel, START_WIDTH - frame);
        }

        expect(spy.mock.calls.length).toBe(before);
    });

    it('catches up exactly once, reflecting the final size, once the drag stops', () => {
        const spy = stubMetrics();
        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);
        const afterMount = spy.mock.calls.length;
        const lastWidth = START_WIDTH - 9;

        realDragFrame(panel, START_WIDTH);
        const oneLivePass = spy.mock.calls.length - afterMount;

        // Pin that the first pass actually measured something live — without
        // this, a mechanism that withholds everything (including the first
        // pass, and the eventual catch-up) would still satisfy the delta
        // check below via `0 === 0`.
        expect(oneLivePass).toBeGreaterThan(0);

        for (let frame = 2; frame <= 9; frame++) {
            advanceDragFrame(panel, START_WIDTH - frame); // last iteration lands at lastWidth
        }

        // Drag stops here: no further frames arrive.
        const before = spy.mock.calls.length;

        drainFrames();

        expect(spy.mock.calls.length - before).toBe(oneLivePass);
        expect(panel.getWidth()).toBe(lastWidth);
        expect(internals(panel)._scrollMetricsSettleHandle).toBeNull();
    });

    it('stays withheld through a much longer drag (35 frames), not just the first few', () => {
        // The single-hop settle this file's header comment describes raced
        // and always lost to the drag's own per-frame pass, so it never
        // withheld anything — a defect a short burst wouldn't distinguish
        // from a correct two-hop relay that happened to catch up early. This
        // drives a burst well past the two frames the relay itself needs,
        // guarding against a regression to that single-hop shape specifically.
        const spy = stubMetrics();
        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);
        const lastWidth = START_WIDTH - 34;

        realDragFrame(panel, START_WIDTH);

        const before = spy.mock.calls.length;

        for (let frame = 2; frame <= 34; frame++) {
            advanceDragFrame(panel, START_WIDTH - frame); // last iteration lands at lastWidth
        }

        expect(spy.mock.calls.length).toBe(before);

        drainFrames();

        expect(spy.mock.calls.length).toBeGreaterThan(before);
        expect(panel.getWidth()).toBe(lastWidth);
        expect(internals(panel)._scrollMetricsSettleHandle).toBeNull();
    });
});
