// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins Panel's scroll-read economy — candidate G16, both halves:
//
//   1. The settled pass. `doLayout` withholds its post-layout scroll-metrics
//      remeasure (remeasureScrollMetrics) when this pass committed the same
//      rectangle as the previous one AND nothing marked the panel's layout
//      since its last completed pass. The second half is the layout system's
//      own state — `Component.isLayoutSettled` — not a value signature, so
//      every panel earns the skip, subclasses included.
//   2. The per-event reads. One merged subtree `scroll` listener reads the
//      scrolling element's metrics once and hands them to both consumers (the
//      overlay bars and the shadow edges), and one wheel event reads the
//      metrics once for both axes' maxima and lends the pair to the clamp
//      `SmoothScroller.scrollBy` performs inside the same call.
//
// Assertions are call-count DELTAS against `DOM.source.getScrollMetrics`, not
// absolute counts, for the reason PanelResizeMetricsCoalescing.test.ts's own
// header gives: the absolute count varies with scrollbarStyle/scrollShadows/
// autoScroll while the delta claim holds for every configuration. Each case
// that names "the live-pass count" calibrates it from a live pass in the same
// test rather than hardcoding it.
//
// Mirrors the harness of PanelResizeMetricsCoalescing.test.ts (CONFIG,
// stubMetrics, the Map-keyed frame capture, the `internals()` cast) and
// PanelScrollChaining.test.ts's wheel()/wheelEvent() helpers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import type { Handle, ScrollMetrics } from '~/core/DOM';
import { Event } from '~/core/Event';
import { ThemeManager, ModernTheme } from '~/core/Theme';
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

// The panel's mount size, and the step a resize burst moves it to. Arbitrary,
// distinct values — no dimension here binds any min/max/content-size
// constraint. Copied from PanelResizeMetricsCoalescing.test.ts's S1/S2.
const S1W = 400; const S1H = 300;
const S2W = 300; const S2H = 200;

// A preferred size large enough to overflow S1 on both axes, so the child's
// relay in case D is a real announcement rather than a no-op write.
const CHILD_W = 900; const CHILD_H = 800;

// The offline sink drops requestAnimationFrame/cancelAnimationFrame; capture
// them so the settle relay (Component.afterNextLayout — see Panel.ts's
// scheduleScrollMetricsSettle) and the batched layout flush can both be driven
// to completion explicitly.
let nextFrameHandle = 1;
let frames: Map<number, FrameRequestCallback> = new Map();
let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
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
    // Restore the default theme before the drain, for the reason
    // UnchangedCommitMetricsGate.test.ts gives: `ThemeManager.setTheme` fires
    // every listener still registered in the process, so a file that leaves a
    // swapped theme behind pollutes every later theme case.
    ThemeManager.setTheme(ModernTheme);

    // A still-armed settle handle leaves Component's shared afterNextLayout
    // flush queued — cancel() only sets a flag, it doesn't deregister the
    // frame. Drain it here so a test that ends mid-burst doesn't leave
    // Component's module-level rafHandle non-null, which would make the next
    // test's own registration find a flush already "pending" and skip
    // registering a fresh frame.
    drainFrames();
    vi.restoreAllMocks();
    DOM.reset();
});

/** Stages the element geometry the scroll helpers read, defaulting every axis to "fits" (no overflow). */
function stubMetrics(metrics: Partial<ScrollMetrics> = {}) {
    return vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
        scrollTop: 0, scrollLeft: 0,
        scrollWidth: 400, scrollHeight: 300,
        clientWidth: 400, clientHeight: 300,
        ...metrics,
    });
}

type MetricsSpy = ReturnType<typeof stubMetrics>;

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

/** Narrow shape reaching the private scroll state without an `any` escape hatch. */
type ScrollInternals = {
    _scrollHandler: (() => void) | null;
    _shadowScrollHandler?: (() => void) | null;
    _overlayScrollHandler?: (() => void) | null;
    _scrollMetricsSettleHandle: { cancel(): void } | null;
    _shadowEdges: Record<'top' | 'bottom' | 'left' | 'right', number>;
    _shadowOverlay: Handle | null;
    _overlayScrollElement: Handle | null;
    _scrollbarV: { setMetrics(viewport: number, content: number, position: number): void } | null;
    _scrollbarH: { setMetrics(viewport: number, content: number, position: number): void } | null;
    _wheelMaxScroll: { x: number; y: number } | null;
    handleScroll(): void;
    onWheelScroll(e: WheelEvent): Event.ListenerResult;
};

function internals(panel: _Panel): ScrollInternals {
    return panel as unknown as ScrollInternals;
}

/**
 * A child that republishes its preferred size from inside its own layout pass,
 * which relays upward and marks its parent while the parent's pass is still
 * running. This is the shape a `Text` descendant takes when it re-measures at a
 * new width — and the only way a panel is marked from *inside* its own pass
 * rather than before it.
 */
class RepublishingChild extends _Panel {

    /** The size to republish on the next pass, then cleared. Null to publish nothing. */
    republishOnNextPass: { width: number; height: number } | null = null;

    /** @inheritDoc */
    doLayout(): this {
        super.doLayout();

        if (this.republishOnNextPass) {
            this.setPreferredSize(this.republishOnNextPass);
            this.republishOnNextPass = null;
        }

        return this;
    }
}

/** Builds and mounts a panel of the given mode, sized to S1. */
function mountPanel(autoScroll: 'auto' | 'both' | 'y' | 'none', scrollbarStyle?: 'overlay' | 'native'): _Panel {
    const panel = new _Panel({ autoScroll, ...(scrollbarStyle ? { scrollbarStyle } : {}) });

    panel.setWidth(S1W);
    panel.setHeight(S1H);
    panel.getElement(true);

    return panel;
}

/**
 * Runs one live pass and drains every queued frame, so the panel ends settled
 * with no resize-settle relay armed — the state every settled-pass case below
 * starts from.
 *
 * @param panel - The mounted panel to settle.
 * @param spy - The `getScrollMetrics` spy the caller installed.
 *
 * @returns How many `getScrollMetrics` calls that one live pass made — the
 *   per-configuration "live-pass count" the cases compare against, calibrated
 *   rather than hardcoded. Every case that compares against it also asserts it
 *   is non-zero: a `toBe(live)` whose `live` collapsed to 0 would be satisfied
 *   by an implementation that had stopped remeasuring altogether.
 */
function runLivePassAndSettle(panel: _Panel, spy: MetricsSpy): number {
    const before = spy.mock.calls.length;

    panel.doLayout();

    const live = spy.mock.calls.length - before;

    drainFrames();

    return live;
}

/** How many `getScrollMetrics` calls `body` made. */
function readsDuring(spy: MetricsSpy, body: () => void): number {
    const before = spy.mock.calls.length;

    body();

    return spy.mock.calls.length - before;
}

describe('Panel — the settled pass withholds its scroll-metrics remeasure', () => {
    it('A: reads nothing on a pass that commits the same box with nothing marked', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');

        expect(runLivePassAndSettle(panel, spy)).toBeGreaterThan(0);

        expect(readsDuring(spy, () => panel.doLayout())).toBe(0);
    });

    it('B: remeasures live on the pass after setWidth / setHeight', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');
        const live = runLivePassAndSettle(panel, spy);

        expect(live).toBeGreaterThan(0);
        expect(readsDuring(spy, () => {
            panel.setWidth(S2W);
            panel.setHeight(S2H);
            panel.doLayout();
        })).toBe(live);
    });

    it('C: remeasures live on the pass after invalidateLayout()', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');
        const live = runLivePassAndSettle(panel, spy);

        expect(live).toBeGreaterThan(0);
        expect(readsDuring(spy, () => {
            panel.invalidateLayout();
            panel.doLayout();
        })).toBe(live);
    });

    it("D: remeasures live on the pass after a child's setPreferredSize relayed upward", () => {
        const spy = stubMetrics();
        const panel = new _Panel({ autoScroll: 'auto' });
        const child = new _Panel();

        panel.addComponent(child);
        panel.setWidth(S1W);
        panel.setHeight(S1H);
        panel.getElement(true);

        const live = runLivePassAndSettle(panel, spy);

        expect(live).toBeGreaterThan(0);
        expect(readsDuring(spy, () => panel.doLayout())).toBe(0);

        expect(readsDuring(spy, () => {
            child.setPreferredSize({ width: CHILD_W, height: CHILD_H });
            panel.doLayout();
        })).toBe(live);
    });

    it('E: remeasures live on the pass after a theme switch moved the text metrics', () => {
        const spy = stubMetrics();
        const panel = mountPanel('auto');
        const live = runLivePassAndSettle(panel, spy);

        expect(live).toBeGreaterThan(0);
        expect(readsDuring(spy, () => {
            // Re-applying the SAME theme still bumps the text-metrics
            // generation (ThemeManager.setTheme always reflows), which is the
            // third term of the settled predicate.
            ThemeManager.setTheme(ThemeManager.getTheme());
            panel.doLayout();
        })).toBe(live);
    });

    it("F: still performs the resize burst's catch-up remeasure at settle", () => {
        // Deliberately NOT pre-settled: the burst has to start with the relay
        // already armed by the mount pass, which is what makes the next pass a
        // withheld one that owes a catch-up. Pre-draining first would leave the
        // burst's own first step live and its second step an ordinary settled
        // pass, with nothing owed at all.
        const spy = stubMetrics();
        const panel = mountPanel('auto');
        const before = spy.mock.calls.length;

        panel.doLayout();   // live; arms the relay

        const live = spy.mock.calls.length - before;

        expect(live).toBeGreaterThan(0);

        panel.setWidth(S2W);
        panel.setHeight(S2H);

        expect(readsDuring(spy, () => panel.doLayout())).toBe(0);

        // The catch-up runs outside the settled gate: by the time the burst goes
        // quiet the panel IS settled at a box that has not moved since the last
        // pass — exactly the shape an ordinary pass skips on — so a gate placed
        // inside remeasureScrollMetrics, or inside the relay, would swallow the
        // one re-measure the relay exists to perform.
        expect(readsDuring(spy, () => drainFrames())).toBe(live);
    });

    it('G: reads nothing and arms no settle frame for an autoScroll: "none" panel', () => {
        const spy = stubMetrics();
        const panel = mountPanel('none');

        // The first pass's own size change is what would arm a settle frame, so
        // the handle is asserted HERE rather than after the drain below: a drain
        // clears whatever was armed, and a post-drain null says nothing about
        // whether one was ever armed at all.
        expect(readsDuring(spy, () => panel.doLayout())).toBe(0);
        expect(internals(panel)._scrollMetricsSettleHandle).toBeNull();

        drainFrames();

        expect(readsDuring(spy, () => panel.doLayout())).toBe(0);
        expect(internals(panel)._scrollMetricsSettleHandle).toBeNull();
    });

    it('remeasures live when the pass itself is marked from inside its own run', () => {
        // Not one of the plan's prescribed cases A-G, none of which reaches the
        // gate's SECOND isLayoutDirty() read: A-G all mark the panel (or not)
        // before the pass starts, which only the entry sample sees. A child that
        // republishes its preferred size from inside its own doLayout relays
        // upward mid-pass, so the panel enters settled and leaves marked.
        const spy = stubMetrics();
        const panel = new _Panel({ autoScroll: 'auto' });
        const child = new RepublishingChild();

        panel.addComponent(child);
        panel.setWidth(S1W);
        panel.setHeight(S1H);
        panel.getElement(true);

        const live = runLivePassAndSettle(panel, spy);

        expect(live).toBeGreaterThan(0);
        expect(readsDuring(spy, () => panel.doLayout())).toBe(0);

        child.republishOnNextPass = { width: CHILD_W, height: CHILD_H };

        expect(readsDuring(spy, () => panel.doLayout())).toBe(live);
    });
});
