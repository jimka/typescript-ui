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

/** Last committed value of a camelCase style key applied to a raw handle — mirrors PanelOverlayScrollbar.test.ts's helper. */
function lastStyle(recording: RecordingDOMSink, handle: Handle, key: string): string | undefined {
    let value: string | undefined;

    for (const w of recording.writes) {
        if (w.op === 'apply' && w.args[0] === handle) {
            const patch = w.args[1] as { style?: Record<string, string | null> };

            if (patch.style && key in patch.style) {
                value = patch.style[key] ?? undefined;
            }
        }
    }

    return value;
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
    removeScrollShadows(): void;
    removeOverlayScrollbars(): void;
    getScrollElement?(): Handle | undefined;
    _wheelScroller: { scrollBy(dx: number, dy: number): void } | null;
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

describe('Panel — one scroll listener reads the metrics once for both consumers', () => {
    it('H: wires exactly one merged scroll handler, replacing the two it supersedes', () => {
        const panel = mountPanel('y');
        const i = internals(panel);

        // `typeof`, not `not.toBeNull()`: an absent field reads `undefined`,
        // which is not null, so a null check alone would pass before the merged
        // handler existed at all.
        expect(typeof i._scrollHandler).toBe('function');
        expect(i._shadowScrollHandler).toBeUndefined();
        expect(i._overlayScrollHandler).toBeUndefined();
    });

    it('wires the subtree scroll listener exactly once, however many times either consumer installs', () => {
        // A registration count, mirroring WindowHeader.test.ts:122's "does not
        // stack a duplicate subtree listener" convention. It has to be the count
        // rather than an observable effect: `ensureScrollListener` builds a FRESH
        // arrow per call, so a missing guard registers a second, distinct
        // listener that `Event`'s own identity dedupe cannot collapse — every
        // scroll would then read the metrics twice again, and the first handler
        // would leak, since `_scrollHandler` only ever holds the last one for
        // `releaseScrollListener` to remove.
        const add = vi.spyOn(Event, 'addSubtreeListener');
        const panel = mountPanel('y');

        const registrations = (): number =>
            add.mock.calls.filter((c) => c[0] === panel && c[1] === 'scroll').length;

        // Both consumers install during `init`.
        expect(registrations()).toBe(1);

        // And both installers are re-entered by a same-value refresh.
        panel.setScrollbarStyle('overlay');
        panel.setScrollShadows(true);

        expect(registrations()).toBe(1);
    });

    it('I2: wires the merged handler from the bars alone, with the shadows never installed', () => {
        // Case I turns the shadows off *after* mount, by when the shadow install
        // has already wired the listener — so it cannot tell whether the bars
        // wire one of their own. A panel built with `scrollShadows: false` can.
        const panel = new _Panel({ autoScroll: 'y', scrollShadows: false });

        panel.setWidth(S1W);
        panel.setHeight(S1H);
        panel.getElement(true);

        expect(internals(panel)._shadowOverlay).toBeNull();
        expect(internals(panel)._overlayScrollElement).not.toBeNull();
        expect(typeof internals(panel)._scrollHandler).toBe('function');
    });

    it('I: keeps the merged handler when the shadows go away and the bars still need it', () => {
        const panel = mountPanel('y');

        panel.setScrollShadows(false);

        expect(internals(panel)._shadowOverlay).toBeNull();
        expect(internals(panel)._overlayScrollElement).not.toBeNull();
        expect(typeof internals(panel)._scrollHandler).toBe('function');
    });

    it('J: releases the merged handler once neither consumer is left', () => {
        const panel = mountPanel('y');
        const handler = internals(panel)._scrollHandler;
        const remove = vi.spyOn(Event, 'removeSubtreeListener');

        panel.setScrollShadows(false);
        panel.setAutoScroll('none');

        expect(internals(panel)._shadowOverlay).toBeNull();
        expect(internals(panel)._overlayScrollElement).toBeNull();
        expect(internals(panel)._scrollHandler).toBeNull();
        expect(remove).toHaveBeenCalledWith(panel, 'scroll', handler);
    });

    // The three cases below drive one teardown at a time through the internals
    // cast, because no public setter isolates one. `setAutoScroll("none")` runs
    // removeOverlayScrollbars and then removeScrollShadows back to back, so a
    // release placed *before* either one nulled its own field is silently
    // rescued by the other's release — case J stays green for both mistakes, and
    // for a release guard that has lost one of its two terms. Each teardown's
    // own ordering and the guard's own two terms need their own case.

    it("J2: keeps the merged handler when only the bars go and the shadows still need it", () => {
        const panel = mountPanel('y');

        expect(internals(panel)._shadowOverlay).not.toBeNull();

        internals(panel).removeOverlayScrollbars();

        expect(internals(panel)._overlayScrollElement).toBeNull();
        expect(typeof internals(panel)._scrollHandler).toBe('function');
    });

    it("J3: releases the merged handler when the bars go and nothing else needs it", () => {
        const panel = mountPanel('y');

        panel.setScrollShadows(false);
        internals(panel).removeOverlayScrollbars();

        expect(internals(panel)._scrollHandler).toBeNull();
    });

    it("J4: releases the merged handler when the shadows go and no bars were ever installed", () => {
        const panel = mountPanel('y', 'native');

        expect(internals(panel)._shadowOverlay).not.toBeNull();
        expect(internals(panel)._overlayScrollElement).toBeNull();
        expect(typeof internals(panel)._scrollHandler).toBe('function');

        internals(panel).removeScrollShadows();

        expect(internals(panel)._scrollHandler).toBeNull();
    });
});

// One scroll position with four DISTINCT, non-saturated edge strengths, so a
// transposed axis or a read of the wrong element cannot coincide with the right
// answer. `scrollShadowRamp` saturates at 41px of distance (see ScrollShadow.ts),
// so every distance below stays inside the ramp:
//   top    distance  9 -> ( 9 - 1) / 40 = 0.20 -> 20
//   bottom distance 29 -> (29 - 1) / 40 = 0.70 -> 70
//   left   distance 21 -> (21 - 1) / 40 = 0.50 -> 50
//   right  distance 13 -> (13 - 1) / 40 = 0.30 -> 30
const SCROLLED: ScrollMetrics = {
    scrollTop: 9, scrollLeft: 21,
    scrollHeight: 338, clientHeight: 300,   // maxTop  = 38, so bottom distance = 29
    scrollWidth:  434, clientWidth:  400,   // maxLeft = 34, so right  distance = 13
};

const SCROLLED_EDGES = { top: 20, bottom: 70, left: 50, right: 30 };

// The same box at rest. Every one of the four edges differs from SCROLLED_EDGES,
// so the mount's own updateScrollShadows cannot pre-satisfy the assertion.
const AT_REST: ScrollMetrics = { ...SCROLLED, scrollTop: 0, scrollLeft: 0 };

/**
 * Case K for one scrollbar style: one scroll event reads the scrolling element's
 * metrics exactly once, and both consumers get values derived from that read.
 *
 * @param scrollbarStyle - The style to run the case against.
 */
function runOneScrollReadsOnce(scrollbarStyle: 'overlay' | 'native'): void {
    const spy = stubMetrics(AT_REST);
    const panel = mountPanel('both', scrollbarStyle);
    const i = internals(panel);
    const scroller = i.getScrollElement!();

    const barV = i._scrollbarV ? vi.spyOn(i._scrollbarV, 'setMetrics') : null;
    const barH = i._scrollbarH ? vi.spyOn(i._scrollbarH, 'setMetrics') : null;

    expect(i._shadowEdges).not.toEqual(SCROLLED_EDGES);

    spy.mockReturnValue(SCROLLED);

    const reads = readsDuring(spy, () => i.handleScroll());

    expect(reads).toBe(1);
    expect(spy.mock.calls[spy.mock.calls.length - 1]![0]).toBe(scroller);
    expect(i._shadowEdges).toEqual(SCROLLED_EDGES);

    if (scrollbarStyle === 'overlay') {
        expect(barV).toHaveBeenCalledWith(SCROLLED.clientHeight, SCROLLED.scrollHeight, SCROLLED.scrollTop);
        expect(barH).toHaveBeenCalledWith(SCROLLED.clientWidth,  SCROLLED.scrollWidth,  SCROLLED.scrollLeft);
    } else {
        expect(barV).toBeNull();
        expect(barH).toBeNull();
    }
}

describe('Panel — the scroll path reads once and the overlay is sized at install', () => {
    it('K: one scroll reads the metrics once and feeds both consumers (overlay)', () => {
        runOneScrollReadsOnce('overlay');
    });

    it('K: one scroll reads the metrics once and feeds both consumers (native)', () => {
        runOneScrollReadsOnce('native');
    });

    it("L: sizes the shadow overlay during init, before any layout pass has run", () => {
        // Native style so the overlay's size is the panel's client box with no
        // gutter inset subtracted, and the expected pixels are exact.
        const spy = stubMetrics(AT_REST);
        const panel = mountPanel('both', 'native');
        const overlay = internals(panel)._shadowOverlay;

        expect(overlay).not.toBeNull();
        expect(lastStyle(sink, overlay!, 'width')).toBe(AT_REST.clientWidth + 'px');
        expect(lastStyle(sink, overlay!, 'height')).toBe(AT_REST.clientHeight + 'px');

        // The premise, asserted rather than left to a comment. `Component.doLayout`
        // clears the dirty flag only for a component that HAS an element, so a
        // still-dirty panel has never completed a pass with one — which is the
        // precondition `remeasureScrollMetrics` needs before it measures anything
        // and writes the same size through resolveShadowOverlaySize /
        // applyShadowOverlaySize. Without this, a future `mountPanel` that drove a
        // pass would let the case keep passing on that write instead of the
        // install's. (The panel's own `_lastPanelWidth` is NOT the premise to
        // assert: `setAutoScroll` drives one element-less pass from inside the
        // `super()` cascade, which leaves the field written and the flag alone.)
        expect(panel.isLayoutDirty()).toBe(true);
    });
});

/**
 * Invokes the private wheel handler as the `Event` subtree dispatch would, and
 * returns its disposition — `onWheelScroll` claims a wheel by RETURNING
 * `{ prevent: true }` rather than calling `preventDefault` itself. Copied from
 * PanelScrollChaining.test.ts.
 *
 * @param panel - The panel whose handler to invoke.
 * @param e - The wheel event to hand it.
 *
 * @returns The handler's disposition.
 */
function wheel(panel: _Panel, e: WheelEvent): Event.ListenerResult {
    return internals(panel).onWheelScroll(e);
}

/** True when the handler's returned disposition asks the dispatcher to preventDefault. */
function prevented(result: Event.ListenerResult): boolean {
    return typeof result === 'object' && !!result?.prevent;
}

/** A wheel event carrying the framework's once-marker surface. Copied from PanelScrollChaining.test.ts. */
function wheelEvent(deltaY: number): WheelEvent {
    return {
        deltaX: 0,
        deltaY,
        shiftKey: false,
    } as unknown as WheelEvent;
}

// The maxima SCROLLED implies, and so the pair one wheel event must derive from
// its single read and lend to the clamp.
const MAX_SCROLL = {
    x: SCROLLED.scrollWidth  - SCROLLED.clientWidth,
    y: SCROLLED.scrollHeight - SCROLLED.clientHeight,
};

// A box with no overflow on either axis, for the unclaimed case.
const FITS: ScrollMetrics = {
    scrollTop: 0, scrollLeft: 0,
    scrollHeight: 300, clientHeight: 300,
    scrollWidth:  400, clientWidth:  400,
};

describe('Panel — one wheel event reads the scroll metrics once for both axes', () => {
    it('M: reads the metrics once for a claimed wheel over both scrollable axes', () => {
        const spy = stubMetrics(SCROLLED);
        const panel = mountPanel('auto');
        const e = wheelEvent(120);

        const reads = readsDuring(spy, () => {
            expect(prevented(wheel(panel, e))).toBe(true);
        });

        expect(reads).toBe(1);
    });

    it('M2: lends that read\'s pair to the clamp for the duration of the call', () => {
        stubMetrics(SCROLLED);

        const panel = mountPanel('auto');
        const scroller = internals(panel)._wheelScroller;

        expect(scroller).not.toBeNull();

        let lentDuringCall: { x: number; y: number } | null | undefined;

        vi.spyOn(scroller!, 'scrollBy').mockImplementation((): void => {
            lentDuringCall = internals(panel)._wheelMaxScroll;
        });

        wheel(panel, wheelEvent(120));

        expect(lentDuringCall).toEqual(MAX_SCROLL);
    });

    it('N: leaves the wheel unclaimed when neither axis has anything to scroll', () => {
        const spy = stubMetrics(FITS);
        const panel = mountPanel('auto');
        const e = wheelEvent(120);

        const reads = readsDuring(spy, () => {
            expect(prevented(wheel(panel, e))).toBe(false);
        });

        expect(reads).toBe(1);
        expect((e as { _tsScrollConsumed?: boolean })._tsScrollConsumed).toBeUndefined();
    });

    it('O: leaves no lent pair behind, whether the wheel was claimed, unclaimed, or threw', () => {
        const spy = stubMetrics(SCROLLED);
        const panel = mountPanel('auto');

        wheel(panel, wheelEvent(120));
        expect(internals(panel)._wheelMaxScroll).toBeNull();

        spy.mockReturnValue(FITS);
        wheel(panel, wheelEvent(120));
        expect(internals(panel)._wheelMaxScroll).toBeNull();

        // The throwing case is what the `finally` is for, and the only one a
        // plain post-call assignment would fail: SmoothScroller.scrollBy runs
        // consumer-reachable code (the clamp and write callbacks) inside this
        // handler's own call.
        spy.mockReturnValue(SCROLLED);

        const scroller = internals(panel)._wheelScroller;

        vi.spyOn(scroller!, 'scrollBy').mockImplementation((): void => {
            throw new Error('clamp blew up');
        });

        expect(() => wheel(panel, wheelEvent(120))).toThrow('clamp blew up');
        expect(internals(panel)._wheelMaxScroll).toBeNull();
    });

    it('P: keeps getMaxScrollLeft / getMaxScrollTop at one read each, with the same answers', () => {
        const spy = stubMetrics(SCROLLED);
        const panel = mountPanel('auto');

        expect(readsDuring(spy, () => {
            expect(panel.getMaxScrollLeft()).toBe(MAX_SCROLL.x);
        })).toBe(1);

        expect(readsDuring(spy, () => {
            expect(panel.getMaxScrollTop()).toBe(MAX_SCROLL.y);
        })).toBe(1);
    });
});
