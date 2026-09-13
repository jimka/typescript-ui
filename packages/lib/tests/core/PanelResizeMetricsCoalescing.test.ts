// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins Panel's resize-metrics coalescing: while this panel's own committed
// width/height is changing every pass (a live external resize, e.g. a Split
// gutter drag resizing this panel), doLayout()'s post-layout scroll-metrics
// remeasure (resizeScrollShadowOverlay + measureScrollbarGutter +
// updateScrollShadows) is withheld together after the first size change of a
// burst and caught up in one pass once the burst goes quiet — the same
// two-hop settle-relay shape ScrollStrip and VirtualRowView already use for
// their own resize bursts (see the plan). Assertions use a call-count DELTA
// against `DOM.source.getScrollMetrics`, not an absolute count, since the
// absolute count varies with scrollbarStyle/scrollShadows/autoScroll (see the
// plan's Internal Structure table) while the delta claim — zero during a
// withheld pass, one live-pass-worth at catch-up — holds for every
// configuration.
//
// Mirrors PanelOverlayScrollbar.test.ts's stubMetrics()/internals() idiom and
// ScrollStrip.resizeResyncCoalescing.test.ts's Map-keyed frame-capture
// harness (needed, unlike an array, so cancelAnimationFrame genuinely drops a
// callback — required by the teardown case).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import type { RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Sizes driving the resize bursts below: S1 is the mount size, S2 a first
// burst step, S3 a second step extending the same burst. Arbitrary, distinct
// values — no dimension here binds any min/max/content-size constraint.
const S1W = 400; const S1H = 300;
const S2W = 300; const S2H = 200;
const S3W = 250; const S3H = 150;

// The offline sink drops requestAnimationFrame/cancelAnimationFrame; capture
// them so the settle relay can be driven and cancelled explicitly, keyed by
// handle so a cancelled frame is genuinely removed rather than merely
// ignored (needed for the teardown case). Wrapped in a spy so "never arms a
// settle frame" (the autoScroll: "none" case) can assert zero invocations.
let nextFrameHandle = 1;
let frames: Map<number, FrameRequestCallback> = new Map();
let rafSpy: ReturnType<typeof vi.fn>;
let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
    nextFrameHandle = 1;
    frames = new Map();
    rafSpy = vi.fn((callback: FrameRequestCallback): number => {
        const handle = nextFrameHandle++;
        frames.set(handle, callback);

        return handle;
    });
    (DOM.sink as any).requestAnimationFrame = rafSpy;
    (DOM.sink as any).cancelAnimationFrame = (handle: number): void => {
        frames.delete(handle);
    };
});

afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

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

/**
 * Runs exactly the currently-queued frames once, without draining any a
 * callback re-queues in turn — lets a test observe the settle relay's
 * intermediate state between two animation frames.
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

/** Last committed value of a camelCase style key applied to a raw handle — mirrors PanelOverlayScrollbar.test.ts's helper. */
function lastStyle(sink: RecordingDOMSink, handle: Handle, key: string): string | undefined {
    let value: string | undefined;

    for (const w of sink.writes) {
        if (w.op === 'apply' && w.args[0] === handle) {
            const patch = w.args[1] as { style?: Record<string, string | null> };

            if (patch.style && key in patch.style) {
                value = patch.style[key] ?? undefined;
            }
        }
    }

    return value;
}

/** Narrow shape reaching the settle-relay private state without `any`. */
type ScrollMetricsInternals = {
    _lastPanelWidth: number;
    _lastPanelHeight: number;
    _scrollMetricsOwed: boolean;
    _panelSizeMoved: boolean;
    _scrollMetricsSettleHandle: number | null;
    _overlayScrollElement: Handle | null;
};

function internals(panel: _Panel): ScrollMetricsInternals {
    return panel as unknown as ScrollMetricsInternals;
}

/** Builds and mounts a scrolling panel of the given mode, sized to S1. */
function mountPanel(autoScroll: 'auto' | 'both'): _Panel {
    const panel = new _Panel({ autoScroll });

    panel.setWidth(S1W);
    panel.setHeight(S1H);
    panel.getElement(true);

    return panel;
}

describe('Panel resize-metrics coalescing', () => {
    it('remeasures live on a one-off size change', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');
        const before = spy.mock.calls.length;

        panel.doLayout();

        const oneLivePass = spy.mock.calls.length - before;
        expect(oneLivePass).toBeGreaterThan(0);
    });

    it('withholds the remeasure for a second size change in the same burst', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');

        panel.doLayout(); // live; arms the relay

        const before = spy.mock.calls.length;

        panel.setWidth(S2W);
        panel.setHeight(S2H);
        panel.doLayout();

        expect(spy.mock.calls.length).toBe(before);
        expect(panel.getWidth()).toBe(S2W);
        expect(panel.getHeight()).toBe(S2H);
    });

    it('still withholds a same-size pass inside a burst', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');

        panel.doLayout();
        panel.setWidth(S2W);
        panel.setHeight(S2H);
        panel.doLayout();

        const before = spy.mock.calls.length;

        panel.doLayout(); // same size again, still mid-burst

        expect(spy.mock.calls.length).toBe(before);
    });

    it('performs exactly one catch-up when the settle relay drains to quiescence', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');
        const afterMount = spy.mock.calls.length;

        panel.doLayout();
        const oneLivePass = spy.mock.calls.length - afterMount;

        panel.setWidth(S2W);
        panel.setHeight(S2H);
        panel.doLayout();

        const before = spy.mock.calls.length;

        drainFrames();

        expect(spy.mock.calls.length - before).toBe(oneLivePass);
        expect(panel.getWidth()).toBe(S2W);
        expect(internals(panel)._scrollMetricsSettleHandle).toBeNull();
    });

    // Deviates from the plan's own "drain frames one queued batch at a time:
    // the first batch re-arms, the second catches up" framing — tracing the
    // literal deferScrollMetricsWhileResizing/flushScrollMetricsSettle code
    // shows the withheld S2 pass above already leaves _panelSizeMoved true,
    // so draining exactly two raw hops from that state only reaches the same
    // "extended, not settled" waypoint this test asserts after its own two
    // hops; a genuine catch-up needs a further two-hop cycle once no further
    // size change lands. This test instead mirrors
    // ScrollStrip.resizeResyncCoalescing.test.ts's own "extends the burst"
    // case: drain exactly the two hops that consume S2's contribution, land
    // S3 in the window right after the second hop's re-arm (this pass's own
    // contribution, not a leftover from S2), then drain to quiescence and
    // check the final state — see the plan's Implementation Notes.
    it('extends the burst when a change lands between the settle relay\'s two hops', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');
        const afterMount = spy.mock.calls.length;

        panel.doLayout(); // live; arms the relay
        const oneLivePass = spy.mock.calls.length - afterMount;
        const afterFirstPass = spy.mock.calls.length;

        panel.setWidth(S2W);
        panel.setHeight(S2H);
        panel.doLayout(); // withheld: _panelSizeMoved set for the relay's second hop to see

        runQueuedFramesOnce(); // relay's first hop: only re-arms, doesn't touch _panelSizeMoved
        runQueuedFramesOnce(); // relay's second hop: sees S2's change, re-arms instead of catching up

        const internal = internals(panel);

        expect(internal._panelSizeMoved).toBe(false); // S2's contribution consumed
        expect(internal._scrollMetricsSettleHandle).not.toBeNull(); // extended, not settled
        expect(spy.mock.calls.length).toBe(afterFirstPass); // no catch-up performed yet

        panel.setWidth(S3W);
        panel.setHeight(S3H);
        panel.doLayout(); // lands in the window right after the second hop's re-arm
        expect(internal._panelSizeMoved).toBe(true); // this pass's own contribution, not a leftover from S2

        drainFrames(); // let the newly-extended relay run to completion

        expect(spy.mock.calls.length - afterFirstPass).toBe(oneLivePass);
        expect(panel.getWidth()).toBe(S3W);
        expect(panel.getHeight()).toBe(S3H);
        expect(internal._scrollMetricsSettleHandle).toBeNull();
    });

    it('keeps the overlay inner scroller tracking this panel\'s live size even while withheld', () => {
        // The withheld remeasure freezes the reserved gutter and shadow
        // strength for a whole burst (an accepted, documented staleness — see
        // the plan's Potential Challenges) — but the inner scroller's own
        // size is a plain write against already-cached data (this panel's
        // width/height and the last-known gutter), not a fresh
        // `getScrollMetrics` read, so it must still track every pass. Without
        // this, a widening burst would visibly reveal a gap between the
        // frozen inner viewport and the live-resizing outer border for the
        // whole burst, not just one frame.
        stubMetrics();
        const panel = mountPanel('auto');

        panel.doLayout(); // live; arms the relay

        const inner = internals(panel)._overlayScrollElement!;
        const widthAfterLivePass = lastStyle(sink, inner, 'width');

        panel.setWidth(S2W);
        panel.setHeight(S2H);
        panel.doLayout(); // withheld

        // stubMetrics()'s default (no overflow on either axis) keeps the
        // reserved gutter at 0 for the whole test, so the inner scroller's
        // width is simply this panel's own live width.
        expect(lastStyle(sink, inner, 'width')).not.toBe(widthAfterLivePass);
        expect(lastStyle(sink, inner, 'width')).toBe(S2W + 'px');
    });

    it('accounts for this panel\'s own border when tracking the live size while withheld', () => {
        // `layoutOverlayScrollbars`'s own pre-read sizing write sizes the
        // inner scroller from `getScrollMetrics(panelEl).clientWidth` — the
        // border-box size minus this panel's border — not from the raw
        // border-box `getWidth()`/`getHeight()` the withheld-pass write above
        // uses as its starting point. Subtracting `getBorderSize()` (cached,
        // no DOM read) keeps the two paths agreeing on a bordered panel;
        // without it, a bordered panel would jump by its border widths on
        // every withheld frame and back at settle.
        const panel = new _Panel({ autoScroll: 'auto', border: '1px solid black' });
        const border = panel.getBorderSize();

        // Stub the live path's `clientWidth`/`clientHeight` to what a real
        // browser would report for this exact border-box size and border —
        // border-box minus border, no scrollbar (overlay mode hides the
        // native one) — so the live pass's own inner-scroller write is
        // directly comparable to the withheld-pass write's cached-geometry
        // computation, rather than to an unrelated hardcoded stub value.
        // `scrollWidth`/`scrollHeight` are pinned equal (no overflow, no
        // reserved gutter) so the comparison isolates the border, not a
        // gutter reservation on top of it.
        const clientWidth  = S1W - border.left - border.right;
        const clientHeight = S1H - border.top  - border.bottom;
        const spy = stubMetrics({ clientWidth, clientHeight, scrollWidth: clientWidth, scrollHeight: clientHeight });

        panel.setWidth(S1W);
        panel.setHeight(S1H);
        panel.getElement(true);
        panel.doLayout(); // live; arms the relay

        const inner = internals(panel)._overlayScrollElement!;
        const widthAfterLivePass = lastStyle(sink, inner, 'width');

        panel.setWidth(S2W);
        panel.doLayout(); // withheld

        expect(widthAfterLivePass).toBe((S1W - border.left - border.right) + 'px');
        expect(lastStyle(sink, inner, 'width')).toBe((S2W - border.left - border.right) + 'px');
        expect(spy).toHaveBeenCalled(); // sanity: the live pass really measured
    });

    it('never arms a settle frame for a class-default ("none") panel', () => {
        stubMetrics();

        const panel = new _Panel();

        panel.setWidth(S1W);
        panel.setHeight(S1H);
        panel.getElement(true);

        panel.doLayout(); // S1

        panel.setWidth(S2W);
        panel.setHeight(S2H);
        panel.doLayout(); // S2

        panel.setWidth(S3W);
        panel.setHeight(S3H);
        panel.doLayout(); // S3

        expect(rafSpy).not.toHaveBeenCalled();
        expect(internals(panel)._scrollMetricsSettleHandle).toBeNull();
    });

    it('constructing with a non-"none" autoScroll option arms no settle frame, and the first post-render pass still remeasures live', () => {
        // `Panel.applyOptions` dispatches `setAutoScroll` from inside the
        // `super()` cascade; for a non-"none" mode this can itself trigger a
        // `doLayout()` call (via `LayoutManager.setOverflowing`) before this
        // panel has ever rendered. `deferScrollMetricsWhileResizing`'s
        // `!this.getElement()` guard must keep that phantom pass from arming
        // a settle frame that would otherwise outlive construction and wrongly
        // withhold the panel's genuine first post-render pass below.
        const spy = stubMetrics();
        const panel = new _Panel({ autoScroll: 'auto' });

        expect(rafSpy).not.toHaveBeenCalled();
        expect(internals(panel)._scrollMetricsSettleHandle).toBeNull();

        panel.setWidth(S1W);
        panel.setHeight(S1H);
        panel.getElement(true);
        const afterMount = spy.mock.calls.length;

        panel.doLayout();

        expect(spy.mock.calls.length).toBeGreaterThan(afterMount);
    });

    it('withholds on a width-only change (autoScroll: "both")', () => {
        const spy = stubMetrics();
        const panel = mountPanel('both');

        panel.doLayout(); // live; arms the relay

        const before = spy.mock.calls.length;

        panel.setWidth(S2W); // height unchanged
        panel.doLayout();

        expect(spy.mock.calls.length).toBe(before);
    });

    it('withholds on a height-only change (autoScroll: "both")', () => {
        const spy = stubMetrics();
        const panel = mountPanel('both');

        panel.doLayout(); // live; arms the relay

        const before = spy.mock.calls.length;

        panel.setHeight(S2H); // width unchanged
        panel.doLayout();

        expect(spy.mock.calls.length).toBe(before);
    });

    it('cancels an armed settle frame on teardown, running no callback', () => {
        stubMetrics();
        const panel = mountPanel('auto');

        panel.doLayout();
        panel.setWidth(S2W);
        panel.setHeight(S2H);
        panel.doLayout(); // settle armed, withheld state

        const handle = internals(panel)._scrollMetricsSettleHandle;

        expect(handle).not.toBeNull();
        expect(frames.has(handle as number)).toBe(true);

        panel.dispose();

        expect(frames.has(handle as number)).toBe(false); // cancelled, not merely left to no-op
        expect(() => drainFrames()).not.toThrow();
    });
});
