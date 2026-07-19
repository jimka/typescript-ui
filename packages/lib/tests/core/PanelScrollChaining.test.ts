//
// Offline coverage for the two halves of "an affordance only for an axis that
// can actually move":
//
//   1. Component.onWheelScroll claims a wheel only for an axis with scrollable
//      extent, so a scroll-styled-but-fitting panel lets the wheel chain out to
//      an ancestor scroller that can move (the regression that stranded the
//      wheel in a Dialog: the app's autoScroll content panel is laid out at its
//      full content height inside the dialog's capped content area, so the inner
//      panel has nothing to scroll while the outer one holds the whole extent).
//   2. Panel.updateScrollShadows lights an edge only on a scrollable axis, so a
//      clipped axis reporting overflow through scrollWidth/scrollHeight cannot
//      paint a fade promising content no gesture can reveal.
//
// The offline DOM models no overflow (getScrollMetrics reports scrollWidth ===
// clientWidth and scrollHeight === clientHeight), so each test stubs the metrics
// to stage the geometry it needs. Real wheel delivery and native scroll are not
// exercisable offline; both fixes were additionally verified live in-browser
// against the Keyboard Shortcuts dialog.
//
// Every panel here is pinned to `scrollbarStyle: 'native'`: these tests
// document native-scroll semantics (wheel-chaining + shadow-edge lighting)
// specifically, so they keep exercising the exact native environment they
// were written for rather than picking up the overlay default.
//
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** Stages the element geometry both fixes read, defaulting every axis to "fits". */
function stubMetrics(metrics: Partial<{
    scrollTop: number; scrollLeft: number;
    scrollWidth: number; scrollHeight: number;
    clientWidth: number; clientHeight: number;
}>) {
    return vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
        scrollTop: 0, scrollLeft: 0,
        scrollWidth: 400, scrollHeight: 300,
        clientWidth: 400, clientHeight: 300,
        ...metrics,
    });
}

/** Invokes the private wheel handler as the Event subtree dispatch would. */
function wheel(panel: _Panel, e: WheelEvent): void {
    (panel as unknown as { onWheelScroll(e: WheelEvent): void }).onWheelScroll(e);
}

/** Invokes the private shadow recompute that `doLayout` and `scroll` drive. */
function updateShadows(panel: _Panel): void {
    (panel as unknown as { updateScrollShadows(): void }).updateScrollShadows();
}

/** Reads a shadow edge's cached strength (0–100), as `setShadowEdge` caches it. */
function shadowEdge(panel: _Panel, edge: 'top' | 'bottom' | 'left' | 'right'): number {
    return (panel as unknown as { _shadowEdges: Record<string, number> })._shadowEdges[edge];
}

/** A cancellable wheel event carrying the framework's once-marker surface. */
function wheelEvent(deltaY: number): WheelEvent & { defaultPrevented: boolean } {
    let prevented = false;

    return {
        deltaX: 0,
        deltaY,
        shiftKey: false,
        preventDefault() { prevented = true; },
        get defaultPrevented() { return prevented; },
    } as unknown as WheelEvent & { defaultPrevented: boolean };
}

describe('wheel claiming requires scrollable extent', () => {
    it('leaves the wheel unclaimed when a scroll-styled axis has nothing to scroll', () => {
        // The stranded-wheel regression: overflow-y is `auto`, but the content
        // fits, so this panel must not consume the event.
        stubMetrics({ scrollHeight: 300, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        const e     = wheelEvent(120);

        panel.getElement(true);
        wheel(panel, e);

        expect(e.defaultPrevented).toBe(false);
        expect((e as { _tsScrollConsumed?: boolean })._tsScrollConsumed).toBeUndefined();
    });

    it('claims the wheel when the axis has extent to move through', () => {
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        const e     = wheelEvent(120);

        panel.getElement(true);
        wheel(panel, e);

        expect(e.defaultPrevented).toBe(true);
        expect((e as { _tsScrollConsumed?: boolean })._tsScrollConsumed).toBe(true);
    });

    it('chains an unclaimed wheel to the ancestor scroller that does have extent', () => {
        // The Dialog shape: an inner content panel laid out at its full height
        // (nothing to scroll) inside an outer panel holding the whole extent.
        // Both are dispatched, innermost first; only the outer may claim.
        const inner = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        const outer = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        const e     = wheelEvent(120);

        inner.getElement(true);
        outer.getElement(true);

        stubMetrics({ scrollHeight: 300, clientHeight: 300 });
        wheel(inner, e);

        expect(e.defaultPrevented).toBe(false);

        stubMetrics({ scrollHeight: 900, clientHeight: 300 });
        wheel(outer, e);

        expect(e.defaultPrevented).toBe(true);
        expect((e as { _tsScrollConsumed?: boolean })._tsScrollConsumed).toBe(true);
    });
});

describe('scroll shadows light only on a scrollable axis', () => {
    it('paints no right-edge fade on a y-only panel whose content overflows the clipped x axis', () => {
        // The phantom-shadow regression: an `autoScroll: "y"` panel whose
        // content is wider than its post-gutter width still reports the overflow
        // through scrollWidth, but overflow-x is `hidden` — nothing can reveal it.
        stubMetrics({ scrollWidth: 420, clientWidth: 405, scrollHeight: 300, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });

        panel.getElement(true);
        updateShadows(panel);

        expect(shadowEdge(panel, 'right')).toBe(0);
        expect(shadowEdge(panel, 'left')).toBe(0);
    });

    it('still paints the bottom fade for the scrollable y axis', () => {
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });

        panel.getElement(true);
        updateShadows(panel);

        expect(shadowEdge(panel, 'bottom')).toBeGreaterThan(0);
    });

    it('paints the right fade once the x axis is scrollable too', () => {
        stubMetrics({ scrollWidth: 420, clientWidth: 405, scrollHeight: 300, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });

        panel.getElement(true);
        updateShadows(panel);

        expect(shadowEdge(panel, 'right')).toBeGreaterThan(0);
    });
});
