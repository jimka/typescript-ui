//
// Offline coverage for the overlay-synced scrollbar default introduced on
// Panel: `scrollbarStyle` defaults to "overlay" (native scroll, native bar
// hidden, two synced Scrollbar widgets overlaid at the trailing edges) with
// "native" as the explicit opt-out (the pre-existing OS-bar + measured-gutter
// path, unchanged).
//
// Mirrors the harness of PanelScrollChaining.test.ts (installTestDOM +
// vi.spyOn(DOM.source, 'getScrollMetrics')) and the private-method access
// idiom of PanelGutterSettle.test.ts (cast to a narrow shape to reach a
// private field/method without an `any` escape hatch).
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,           // native OS probe width — only the "native" path reads this
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** Stages the element geometry the overlay/native gutter paths read, defaulting every axis to "fits". */
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

/** Narrow shape reaching the overlay-scrollbar private state without `any`. */
type OverlayInternals = {
    _scrollbarGutter:       { right: number; bottom: number };
    _overlayHost:           Handle | null;
    _scrollbarV:            { getX(): number; getY(): number; getWidth(): number; getHeight(): number; isDisplayed(): boolean } | null;
    _scrollbarH:            { getX(): number; getY(): number; getWidth(): number; getHeight(): number; isDisplayed(): boolean } | null;
    _overlayScrollHandler:  (() => void) | null;
    _onOverlayScrollV(position: number): void;
    _onOverlayScrollH(position: number): void;
    layoutOverlayScrollbars(element?: Handle): void;
    syncOverlayScrollbars(): void;
};

function internals(panel: _Panel): OverlayInternals {
    return panel as unknown as OverlayInternals;
}

describe('Panel — overlay scrollbar default', () => {
    it('defaults getScrollbarStyle() to "overlay"; "native" opts out', () => {
        expect(new _Panel().getScrollbarStyle()).toBe('overlay');
        expect(new _Panel({ scrollbarStyle: 'native' }).getScrollbarStyle()).toBe('native');
    });

    it('stays inert while autoScroll is "none" (overlay default, non-scrolling panel)', () => {
        const panel = new _Panel();
        panel.getElement(true);

        const i = internals(panel);
        expect(i._overlayHost).toBeNull();
        expect(i._scrollbarV).toBeNull();
        expect(i._scrollbarH).toBeNull();
    });

    it('installs both bars + host + handler once autoScroll and overlay style are both active', () => {
        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);

        const i = internals(panel);
        expect(i._overlayHost).not.toBeNull();
        expect(i._scrollbarV).not.toBeNull();
        expect(i._scrollbarH).not.toBeNull();
        expect(i._overlayScrollHandler).not.toBeNull();
    });

    it('hides the native scrollbar via the deferred CSS seam on install', () => {
        const sink = installTestDOM(CONFIG);

        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);

        const hidesScrollbarWidth = sink.writes.some(
            (w) => w.op === 'setRuleStyle' && w.args[0] === 'scrollbarWidth' && w.args[1] === 'none'
        );
        expect(hidesScrollbarWidth).toBe(true);
    });

    it('tears down on transition to autoScroll("none") and on transition to scrollbarStyle("native")', () => {
        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);
        expect(internals(panel)._overlayHost).not.toBeNull();

        panel.setAutoScroll('none');
        let i = internals(panel);
        expect(i._overlayHost).toBeNull();
        expect(i._scrollbarV).toBeNull();
        expect(i._scrollbarH).toBeNull();

        // Re-enter overlay mode, then tear down via the style switch instead.
        panel.setAutoScroll('y');
        expect(internals(panel)._overlayHost).not.toBeNull();

        panel.setScrollbarStyle('native');
        i = internals(panel);
        expect(i._overlayHost).toBeNull();
        expect(i._scrollbarV).toBeNull();
        expect(i._scrollbarH).toBeNull();

        // Re-entering overlay while still scrollable re-installs.
        panel.setScrollbarStyle('overlay');
        expect(internals(panel)._overlayHost).not.toBeNull();
    });

    it('reserves a 12px right gutter when the y axis overflows', () => {
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);

        expect(internals(panel)._scrollbarGutter.right).toBe(12);
        expect(internals(panel)._scrollbarGutter.bottom).toBe(0);
    });

    it('reserves a 12px bottom gutter when the x axis overflows', () => {
        stubMetrics({ scrollWidth: 900, clientWidth: 300 });

        const panel = new _Panel({ autoScroll: 'x' });
        panel.getElement(true);

        expect(internals(panel)._scrollbarGutter.bottom).toBe(12);
        expect(internals(panel)._scrollbarGutter.right).toBe(0);
    });

    it('reserves no gutter when nothing overflows', () => {
        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);

        expect(internals(panel)._scrollbarGutter.right).toBe(0);
        expect(internals(panel)._scrollbarGutter.bottom).toBe(0);
    });

    it('positions both bars against the effective (post-gutter) viewport when both axes overflow', () => {
        stubMetrics({ scrollWidth: 900, clientWidth: 400, scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'both' });
        panel.getElement(true);

        const i = internals(panel);
        expect(i._scrollbarV!.getX()).toBe(400 - 12);
        expect(i._scrollbarV!.getHeight()).toBe(300 - 12);
        expect(i._scrollbarH!.getY()).toBe(300 - 12);
        expect(i._scrollbarH!.getWidth()).toBe(400 - 12);
    });

    it('auto-hides the bar for an axis whose content fits', () => {
        // scrollWidth (380) fits comfortably inside the *effective* width
        // (400 - 12 = 388) reserved by the overflowing y axis's gutter, so
        // the horizontal bar reports no overflow even after the vertical
        // gutter is reserved — avoids the single-pass V<->H settle transient
        // documented in the plan's Potential Challenges (a content extent
        // that merely equals the raw, pre-gutter clientWidth would need a
        // second settle pass to resolve, which this test does not drive).
        stubMetrics({ scrollWidth: 380, clientWidth: 400, scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);

        expect(internals(panel)._scrollbarH!.isDisplayed()).toBe(false);
    });

    it('forwards a vertical bar scroll to setScrollTop, and a horizontal bar scroll to setScrollLeft', () => {
        const panel = new _Panel({ autoScroll: 'both' });
        panel.getElement(true);

        const setScrollTop  = vi.spyOn(panel, 'setScrollTop');
        const setScrollLeft = vi.spyOn(panel, 'setScrollLeft');

        internals(panel)._onOverlayScrollV(120);
        expect(setScrollTop).toHaveBeenCalledWith(120);

        internals(panel)._onOverlayScrollH(80);
        expect(setScrollLeft).toHaveBeenCalledWith(80);
    });

    it('syncOverlayScrollbars is a metrics-only push — never re-triggers a native scroll write', () => {
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);

        const setScrollTop  = vi.spyOn(panel, 'setScrollTop');
        const setScrollLeft = vi.spyOn(panel, 'setScrollLeft');

        internals(panel).syncOverlayScrollbars();
        internals(panel).syncOverlayScrollbars();

        expect(setScrollTop).not.toHaveBeenCalled();
        expect(setScrollLeft).not.toHaveBeenCalled();
    });

    it('scrollbarStyle: "native" keeps the measured-gutter path and installs no overlay', () => {
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });   // getScrollBarWidth() === 15 via CONFIG

        const panel = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        panel.getElement(true);
        panel.doLayout();   // native gutter measurement runs from doLayout, not init

        const i = internals(panel);
        expect(i._scrollbarGutter.right).toBe(15);
        expect(i._overlayHost).toBeNull();
        expect(i._scrollbarV).toBeNull();
        expect(i._scrollbarH).toBeNull();
    });

    it('is the default with no scrollbarStyle option set — takes the overlay branch, not the native 15px one', () => {
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'auto' });
        expect(panel.getScrollbarStyle()).toBe('overlay');

        panel.getElement(true);
        panel.doLayout();

        const i = internals(panel);
        expect(i._scrollbarGutter.right).toBe(12);
        expect(i._overlayHost).not.toBeNull();
        expect(i._scrollbarV).not.toBeNull();
    });

    it('ScrollStrip is forced native even though its Panel base defaults to overlay', () => {
        expect(new ScrollStrip().getScrollbarStyle()).toBe('native');
    });
});
