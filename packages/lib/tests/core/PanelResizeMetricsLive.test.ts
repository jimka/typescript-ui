// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins that a scrolling Panel's post-layout scroll-metrics remeasure
// (remeasureScrollMetrics) runs on EVERY layout pass whose committed box moved,
// a live external resize included — a Split gutter drag or a window resize
// remeasures each frame rather than once the burst settles.
//
// This file replaces PanelResizeMetricsCoalescing.test.ts and its
// ...Realtime.test.ts sibling, which pinned the opposite: those two existed to
// hold a two-hop settle relay that withheld the remeasure on every frame of a
// resize burst past the first. That relay is gone — withholding the remeasure
// also withheld the scrollbar-gutter commit, both overlay bars' geometry and
// both halves of the scroll-shadow overlay, which is the visible defect
// PanelResizeGeometryStaleness.test.ts now covers frame by frame. The cases
// here are the ones from those two files that outlived the mechanism: the
// per-pass read count (which is the cost this change accepts, stated as a
// number rather than left implicit), the write-before-read ordering inside the
// native branch, the "none" and pre-render no-ops, and the burst cases with
// their assertions inverted.
//
// Assertions use a call-count DELTA against DOM.source.getScrollMetrics rather
// than an absolute count wherever the claim is "this pass measured", since the
// absolute count varies with scrollbarStyle/scrollShadows/autoScroll while the
// delta claim does not. Each of those deltas is compared either against a live
// pass's own delta from the same spy, itself asserted non-zero first, or against
// READS_PER_LIVE_PASS below, so none of them can pass by matching zero against
// zero. The cases whose whole claim is that a
// pass measured NOTHING are necessarily absolute zeros with no such anchor
// available; each says what would make it non-zero.
//
// Mirrors PanelOverlayScrollbar.test.ts's stubMetrics()/internals() idiom.
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

// Sizes driving the resize bursts below: S1 is the mount size, S2 a first burst
// step, S3 a second step extending the same burst. Arbitrary, distinct values —
// no dimension here binds any min/max/content-size constraint.
const S1W = 400; const S1H = 300;
const S2W = 300; const S2H = 200;
const S3W = 250; const S3H = 150;

// The reads one live pass takes in every configuration this file covers. Two is
// what the read-economy restructuring brought the pass down to (see
// PanelScrollReadEconomy.test.ts): the panel's own box, plus one read of
// whichever element actually scrolls. Pinned as an absolute here, and only
// here, because it is the per-frame cost a live resize now pays on every frame,
// where the withdrawn coalescing had a burst pay it twice in total — on the
// burst's first frame and again at its catch-up. A regression that quietly
// doubled the per-pass figure would otherwise only show up as a frame-time
// report nobody is running.
const READS_PER_LIVE_PASS = 2;

// The frame count the long-drag case drives past the burst's first frame. Well
// past the two frames the removed settle relay needed to arm, so a regression
// that reintroduced any kind of burst coalescing — however many frames it took
// to engage — fails here rather than passing a short burst by luck.
const LONG_DRAG_FRAMES = 33;

// The offline sink drops requestAnimationFrame/cancelAnimationFrame; capture
// them so the batched layout flush can be driven to completion explicitly.
let nextFrameHandle = 1;
let frames: Map<number, FrameRequestCallback> = new Map();

beforeEach(() => {
    installTestDOM(CONFIG);
    nextFrameHandle = 1;
    frames = new Map();
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
        const handle = nextFrameHandle++;

        frames.set(handle, callback);

        return handle;
    });
    vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((handle: number): void => {
        frames.delete(handle);
    });
});

afterEach(() => {
    // Drain to quiescence while the captured requestAnimationFrame is still
    // installed. Component.afterNextLayout's cancel() only sets a flag — it does
    // not deregister the frame — so a case ending with frames still queued
    // leaves Component's module-level flush handle non-null, and the next case's
    // own layout scheduling then finds a flush already pending and registers no
    // fresh frame.
    drainFrames();
    vi.restoreAllMocks();
    DOM.reset();
});

/** Stages the element geometry the three helpers read, defaulting every axis to "fits" (no overflow). */
function stubMetrics(metrics: Partial<{
    scrollTop: number; scrollLeft: number;
    scrollWidth: number; scrollHeight: number;
    clientWidth: number; clientHeight: number;
}> = {}) {
    return vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
        scrollTop: 0, scrollLeft: 0,
        scrollWidth: 400, scrollHeight: 300,
        clientWidth: 400, clientHeight: 300,
        ...metrics,
    });
}

/** Runs exactly the currently-queued frames once, without draining any a callback re-queues in turn. */
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

/** Narrow shape reaching the private scroll state without `any`. */
type ScrollMetricsInternals = {
    _scrollbarGutter: { right: number; bottom: number };
};

function internals(panel: _Panel): ScrollMetricsInternals {
    return panel as unknown as ScrollMetricsInternals;
}

/** Builds and mounts a scrolling panel of the given mode, sized to S1. */
function mountPanel(autoScroll: 'auto' | 'both', scrollbarStyle?: 'overlay' | 'native'): _Panel {
    const panel = new _Panel({ autoScroll, ...(scrollbarStyle ? { scrollbarStyle } : {}) });

    panel.setWidth(S1W);
    panel.setHeight(S1H);
    panel.getElement(true);

    return panel;
}

/**
 * Reads taken while `body` ran.
 *
 * @param spy - The getScrollMetrics spy.
 * @param body - The work to measure.
 * @returns The number of reads `body` took.
 */
function readsDuring(spy: ReturnType<typeof stubMetrics>, body: () => void): number {
    const before = spy.mock.calls.length;

    body();

    return spy.mock.calls.length - before;
}

/** One real drag frame: the single `doLayout()` pass a live external resize triggers this frame. */
function dragFrame(panel: _Panel, width: number, height: number): void {
    panel.setWidth(width);
    panel.setHeight(height);
    panel.doLayout();
}

describe('Panel resize-metrics live remeasure', () => {
    describe('the per-pass cost', () => {
        it('reads the metrics exactly twice per live pass in the default configuration (overlay, shadows on)', () => {
            const spy = stubMetrics();
            const panel = mountPanel('auto');

            expect(readsDuring(spy, () => panel.doLayout())).toBe(READS_PER_LIVE_PASS);
        });

        it('reads the metrics exactly twice per live pass with native scrollbars and shadows on', () => {
            const spy = stubMetrics();
            const panel = mountPanel('auto', 'native');

            expect(readsDuring(spy, () => panel.doLayout())).toBe(READS_PER_LIVE_PASS);
        });
    });

    describe('every frame of a resize burst measures', () => {
        it('remeasures live on a second size change in the same burst', () => {
            // The direct inverse of the removed coalescing: this pass used to
            // take zero reads and defer everything it writes to a catch-up two
            // frames later.
            const spy = stubMetrics();
            const panel = mountPanel('auto');
            const live = readsDuring(spy, () => panel.doLayout());

            expect(live).toBeGreaterThan(0);
            expect(readsDuring(spy, () => dragFrame(panel, S2W, S2H))).toBe(live);
            expect(panel.getWidth()).toBe(S2W);
            expect(panel.getHeight()).toBe(S2H);
        });

        it('remeasures live on a third size change too, with no frame drained between them', () => {
            const spy = stubMetrics();
            const panel = mountPanel('auto');
            const live = readsDuring(spy, () => panel.doLayout());

            expect(live).toBeGreaterThan(0);

            dragFrame(panel, S2W, S2H);

            expect(readsDuring(spy, () => dragFrame(panel, S3W, S3H))).toBe(live);
            expect(panel.getWidth()).toBe(S3W);
        });

        it('remeasures live on a width-only change mid-burst (autoScroll: "both")', () => {
            const spy = stubMetrics();
            const panel = mountPanel('both');
            const live = readsDuring(spy, () => panel.doLayout());

            expect(live).toBeGreaterThan(0);
            expect(readsDuring(spy, () => {
                panel.setWidth(S2W); // height unchanged
                panel.doLayout();
            })).toBe(live);
        });

        it('remeasures live on a height-only change mid-burst (autoScroll: "both")', () => {
            const spy = stubMetrics();
            const panel = mountPanel('both');
            const live = readsDuring(spy, () => panel.doLayout());

            expect(live).toBeGreaterThan(0);
            expect(readsDuring(spy, () => {
                panel.setHeight(S2H); // width unchanged
                panel.doLayout();
            })).toBe(live);
        });

        it('remeasures live on every frame of a long realistic drag, one pass per animation frame', () => {
            // One real doLayout() per animation frame, with that frame's queued
            // callbacks drained first — the shape a Split-driven drag actually
            // produces, as opposed to several doLayout() calls back to back.
            // Driven well past the two frames the removed relay needed to arm,
            // so any reintroduced coalescing fails here however slowly it
            // engaged.
            const spy = stubMetrics();
            const panel = mountPanel('auto');
            const live = readsDuring(spy, () => panel.doLayout());

            expect(live).toBeGreaterThan(0);

            const duringDrag = readsDuring(spy, () => {
                for (let frame = 1; frame <= LONG_DRAG_FRAMES; frame++) {
                    runQueuedFramesOnce();
                    dragFrame(panel, S1W - frame, S1H);
                }
            });

            expect(duringDrag).toBe(LONG_DRAG_FRAMES * live);
            expect(panel.getWidth()).toBe(S1W - LONG_DRAG_FRAMES);
        });
    });

    describe('the read-then-write ordering inside one pass', () => {
        it('clears an over-reserved native gutter on the same pass a shrink brings content back within the viewport', () => {
            // The specific bug the write-before-read ordering in
            // remeasureScrollMetrics's native branch exists to avoid: the shadow
            // overlay is this panel's only in-flow child, so a stale overlay
            // height floors the panel's own scrollHeight. Sequencing two distinct
            // getScrollMetrics returns — an "avail" read that still looks
            // overflowing, then a post-overlay-resize read that fits — pins that
            // the gutter decision is based on the SECOND (fresh) read: a
            // regression that reused `avail`, or read before writing the
            // overlay's new size, would still see the stale overflow and leave
            // the gutter reserved.
            const panel = mountPanel('auto', 'native');

            // A prior, now-stale pass left a gutter reserved for overflow that no
            // longer exists once the content shrinks back within the viewport.
            // `right` is the vertical-scrollbar gutter (Y-axis overflow, via
            // scrollHeight — see resolveNativeGutter); `bottom` is the horizontal
            // one (X-axis, via scrollWidth), unused by this scenario.
            internals(panel)._scrollbarGutter = { right: 15, bottom: 0 };

            const spy = vi.spyOn(DOM.source, 'getScrollMetrics')
                .mockReturnValueOnce({ // avail: this panel's own client box
                    scrollTop: 0, scrollLeft: 0,
                    scrollWidth: S1W, scrollHeight: S1H + 200, // still looks overflowing
                    clientWidth: S1W, clientHeight: S1H,
                })
                .mockReturnValueOnce({ // shadowMetrics: fresh read, post-overlay-resize — content fits
                    scrollTop: 0, scrollLeft: 0,
                    scrollWidth: S1W, scrollHeight: S1H,
                    clientWidth: S1W, clientHeight: S1H,
                });

            panel.doLayout();

            expect(spy).toHaveBeenCalledTimes(READS_PER_LIVE_PASS);
            expect(internals(panel)._scrollbarGutter.right).toBe(0);
        });
    });

    describe('the passes that still read nothing', () => {
        it('reads nothing on a pass that commits the same box with nothing marked', () => {
            // The settled-pass skip, which is a separate mechanism from the
            // removed burst coalescing and is deliberately untouched: nothing the
            // remeasure reads can have moved, so the pass takes no read.
            const spy = stubMetrics();
            const panel = mountPanel('auto');
            const live = readsDuring(spy, () => panel.doLayout());

            expect(live).toBeGreaterThan(0);

            drainFrames();

            expect(readsDuring(spy, () => panel.doLayout())).toBe(0);
        });

        it('reads nothing at all for a class-default ("none") panel, however often it resizes', () => {
            // An absolute zero with no live-pass anchor available, because the
            // claim is that this configuration never measures at all: the same
            // three passes on an `autoScroll: 'auto'` panel take two reads each,
            // which is what the burst cases above assert.
            const spy = stubMetrics();
            const panel = new _Panel();

            panel.setWidth(S1W);
            panel.setHeight(S1H);
            panel.getElement(true);

            expect(readsDuring(spy, () => {
                panel.doLayout();
                dragFrame(panel, S2W, S2H);
                dragFrame(panel, S3W, S3H);
            })).toBe(0);
        });

        it('reads nothing before this panel has ever rendered, and remeasures live on its first post-render pass', () => {
            // `Panel.applyOptions` dispatches `setAutoScroll` from inside the
            // `super()` cascade; for a non-"none" mode that can itself trigger a
            // `doLayout()` call (via `LayoutManager.setOverflowing`) before this
            // panel has ever rendered. remeasureScrollMetrics' own getElement()
            // guard is what keeps that phantom pass from measuring, and it must
            // not leave anything behind that suppresses the genuine first pass.
            const spy = stubMetrics();
            const panel = new _Panel({ autoScroll: 'auto' });

            expect(spy).not.toHaveBeenCalled();

            panel.setWidth(S1W);
            panel.setHeight(S1H);
            panel.getElement(true);

            expect(readsDuring(spy, () => panel.doLayout())).toBe(READS_PER_LIVE_PASS);
        });
    });
});
