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
import type { RecordingDOMSink } from '../dom/TestDOM';
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
    _overlayScrollElement:  Handle | null;
    _scrollbarV:            { getX(): number; getY(): number; getWidth(): number; getHeight(): number; isDisplayed(): boolean } | null;
    _scrollbarH:            { getX(): number; getY(): number; getWidth(): number; getHeight(): number; isDisplayed(): boolean } | null;
    _overlayScrollHandler:  (() => void) | null;
    _shadowOverlay:         Handle | null;
    _onOverlayScrollV(position: number): void;
    _onOverlayScrollH(position: number): void;
    getScrollElement(): Handle | undefined;
    layoutOverlayScrollbars(element?: Handle): void;
    syncOverlayScrollbars(): void;
};

function internals(panel: _Panel): OverlayInternals {
    return panel as unknown as OverlayInternals;
}

/** Last committed value of a camelCase style key applied to a raw handle. */
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

describe('Panel — overlay scrollbar default', () => {
    it('defaults getScrollbarStyle() to "overlay"; "native" opts out', () => {
        expect(new _Panel().getScrollbarStyle()).toBe('overlay');
        expect(new _Panel({ scrollbarStyle: 'native' }).getScrollbarStyle()).toBe('native');
    });

    it('stays inert while autoScroll is "none" (overlay default, non-scrolling panel)', () => {
        const sink = installTestDOM(CONFIG);

        const panel = new _Panel();
        panel.getElement(true);

        const i = internals(panel);
        expect(i._overlayScrollElement).toBeNull();
        expect(i._scrollbarV).toBeNull();
        expect(i._scrollbarH).toBeNull();

        // Does not hide the native bar: the teardown guard's resting write
        // (scrollbarWidth -> null, a harmless no-op un-hide) is fine, but
        // "none" is never written for a panel that never installed.
        const hidesScrollbarWidth = sink.writes.some(
            (w) => w.op === 'setRuleStyle' && w.args[0] === 'scrollbarWidth' && w.args[1] === 'none'
        );
        expect(hidesScrollbarWidth).toBe(false);
    });

    it('installs both bars + inner scroller + handler once autoScroll and overlay style are both active', () => {
        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);

        const i = internals(panel);
        expect(i._overlayScrollElement).not.toBeNull();
        expect(i._scrollbarV).not.toBeNull();
        expect(i._scrollbarH).not.toBeNull();
        expect(i._overlayScrollHandler).not.toBeNull();
    });

    it('updates the inner scroller overflow axes on a runtime mode-to-mode change (no teardown)', () => {
        // The inner element persists across a scrolling→scrolling mode switch
        // (refreshOverlayScrollbars only tears down for "none"/native), so its
        // per-axis overflow must be re-written to the new mode or the newly
        // scrollable axis stays `hidden` and cannot scroll. Reachable at runtime
        // via List.setHorizontalScrolling (autoScroll "y"→"auto").
        const sink = installTestDOM(CONFIG);

        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);

        const inner = internals(panel)._overlayScrollElement!;
        expect(lastStyle(sink, inner, 'overflowX')).toBe('hidden');
        expect(lastStyle(sink, inner, 'overflowY')).toBe('auto');

        panel.setAutoScroll('both');
        expect(internals(panel)._overlayScrollElement).toBe(inner);   // same element, not re-created
        expect(lastStyle(sink, inner, 'overflowX')).toBe('auto');
        expect(lastStyle(sink, inner, 'overflowY')).toBe('auto');

        panel.setAutoScroll('x');
        expect(lastStyle(sink, inner, 'overflowX')).toBe('auto');
        expect(lastStyle(sink, inner, 'overflowY')).toBe('hidden');
    });

    it('routes getScrollElement() to the inner scroller in overlay mode, and to the panel element otherwise', () => {
        const overlay = new _Panel({ autoScroll: 'y' });
        overlay.getElement(true);
        const oi = internals(overlay);
        expect(oi.getScrollElement()).toBe(oi._overlayScrollElement);
        expect(oi.getScrollElement()).not.toBe(overlay.getElement());

        const nativeP = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        nativeP.getElement(true);
        expect(internals(nativeP).getScrollElement()).toBe(nativeP.getElement());

        const nonScroll = new _Panel();
        nonScroll.getElement(true);
        expect(internals(nonScroll).getScrollElement()).toBe(nonScroll.getElement());
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
        // Genuinely overflowing (not the {0,0} resting gutter) so the
        // teardown's gutter-clear write is exercised from a non-zero state,
        // not a no-op. Re-install to capture the sink, then stub metrics
        // against the freshly-installed DOM.source.
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);
        expect(internals(panel)._overlayScrollElement).not.toBeNull();
        expect(internals(panel)._scrollbarGutter.right).toBe(12);

        panel.setAutoScroll('none');
        let i = internals(panel);
        expect(i._overlayScrollElement).toBeNull();
        expect(i._scrollbarV).toBeNull();
        expect(i._scrollbarH).toBeNull();
        expect(i._scrollbarGutter.right).toBe(0);
        expect(i._scrollbarGutter.bottom).toBe(0);

        // The native bar is un-hidden on teardown: the last scrollbarWidth
        // write for this instance is the un-hide (null), not "none".
        const scrollbarWidthWrites = sink.writes.filter(
            (w) => w.op === 'setRuleStyle' && w.args[0] === 'scrollbarWidth'
        );
        expect(scrollbarWidthWrites.length).toBeGreaterThan(0);
        expect(scrollbarWidthWrites[scrollbarWidthWrites.length - 1].args[1]).toBeNull();

        // Re-enter overlay mode, then tear down via the style switch instead.
        panel.setAutoScroll('y');
        expect(internals(panel)._overlayScrollElement).not.toBeNull();
        expect(internals(panel)._scrollbarGutter.right).toBe(12);

        panel.setScrollbarStyle('native');
        i = internals(panel);
        expect(i._overlayScrollElement).toBeNull();
        expect(i._scrollbarV).toBeNull();
        expect(i._scrollbarH).toBeNull();
        expect(i._scrollbarGutter.right).toBe(0);

        // Re-entering overlay while still scrollable re-installs.
        panel.setScrollbarStyle('overlay');
        expect(internals(panel)._overlayScrollElement).not.toBeNull();
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
        // Content exactly fills the viewport on both axes (scroll == client), so
        // neither axis overflows. Stub explicitly: visibility now reads the
        // panel element for the viewport and the inner element for content, so
        // an un-stubbed harness no longer self-cancels those two reads.
        stubMetrics({ scrollWidth: 400, clientWidth: 400, scrollHeight: 300, clientHeight: 300 });

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

    it('insets the inner scroll element by the track on both axes when both overflow — content clips before the bar band', () => {
        // The core fix: the native scroll viewport (the inner element) is
        // physically inset by the track on each axis whose perpendicular bar
        // shows, so overflowing content clips at the inner viewport edge and
        // can never scroll under a bar. availW/H = panel client box (400x300);
        // inner element sized to (400-12) x (300-12).
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollWidth: 900, clientWidth: 400, scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'both' });
        panel.getElement(true);
        panel.doLayout();

        const inner = internals(panel)._overlayScrollElement;
        expect(inner).not.toBeNull();
        expect(lastStyle(sink, inner!, 'width')).toBe('388px');
        expect(lastStyle(sink, inner!, 'height')).toBe('288px');

        // The inner viewport's trailing edges coincide with the bars' inner
        // edges — the bar band is reserved space the content cannot occupy.
        const i = internals(panel);
        expect(i._scrollbarV!.getX()).toBe(388);   // = inner width
        expect(i._scrollbarH!.getY()).toBe(288);   // = inner height
    });

    it('insets only the overflowing axis of the inner scroll element (vertical-only → width inset, full height)', () => {
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollHeight: 900, clientHeight: 300, scrollWidth: 400, clientWidth: 400 });

        const panel = new _Panel({ autoScroll: 'y' });
        panel.getElement(true);
        panel.doLayout();

        const inner = internals(panel)._overlayScrollElement;
        expect(lastStyle(sink, inner!, 'width')).toBe('388px');    // right gutter reserved
        expect(lastStyle(sink, inner!, 'height')).toBe('300px');   // no bottom bar → full height
    });

    it('re-sizes the inner scroller to the CURRENT panel viewport on every layout (never lags a resize)', () => {
        // The inner element's own client box is what the overflow test reads, so
        // it must track the current viewport rather than the previous pass's
        // size — otherwise a resize flickers a transient bar (expand: a stale-
        // small box keeps a bar the widened viewport dropped; shrink: a stale-
        // large box floors scrollWidth so content that now fits reads as
        // overflowing). This pins the mechanism that keeps it fresh: the inner
        // element is written to (viewport − gutter) on each layout. A vertical-
        // only overflow (content fits horizontally) reserves a 12px right gutter,
        // so the inner width tracks viewportW − 12 as the viewport grows/shrinks.
        // (The transient itself is a write-then-read the offline stub can't model
        // — it is verified live; this guards the sizing that prevents it.)
        const sink = installTestDOM(CONFIG);
        // Content fits horizontally (scrollWidth 100) but overflows vertically
        // (scrollHeight 900 > clientHeight 300) → a right gutter, never a bottom.
        const metrics = (viewportW: number) => ({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 100, scrollHeight: 900,
            clientWidth: viewportW, clientHeight: 300,
        });
        const spy = vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue(metrics(400));

        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);
        const inner = internals(panel)._overlayScrollElement!;
        panel.doLayout();
        expect(lastStyle(sink, inner, 'width')).toBe('388px');   // 400 − 12

        spy.mockReturnValue(metrics(600));
        panel.doLayout();
        expect(lastStyle(sink, inner, 'width')).toBe('588px');   // grow → tracks 600 − 12

        spy.mockReturnValue(metrics(200));
        panel.doLayout();
        expect(lastStyle(sink, inner, 'width')).toBe('188px');   // shrink → tracks 200 − 12, not stuck large

        expect(internals(panel)._scrollbarGutter.bottom).toBe(0); // no spurious H bar at any size
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
        expect(i._overlayScrollElement).toBeNull();
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
        expect(i._overlayScrollElement).not.toBeNull();
        expect(i._scrollbarV).not.toBeNull();
    });

    it('ScrollStrip is forced native even though its Panel base defaults to overlay', () => {
        expect(new ScrollStrip().getScrollbarStyle()).toBe('native');
    });
});

// Regression: the scroll-shadow overlay marks the CONTENT-viewport edge. With a
// native bar, `clientWidth`/`clientHeight` already exclude the bar, so the
// full-client-box overlay sat correctly inside it. In overlay mode the native
// bar is hidden and the overlay Scrollbar is painted INSIDE `clientWidth` at the
// trailing gutter, so a full-client-box shadow overlay bleeds its bottom/right
// edge shadow under the translucent bar track (reads as "the shadow is on top of
// the scrollbar"). The overlay must be inset by the reserved overlay gutter so
// each edge shadow lands just inside its bar — and only in overlay mode, since
// native `clientWidth`/`clientHeight` already exclude the OS bar.
describe('Panel — scroll-shadow overlay is inset by the overlay-scrollbar gutter', () => {
    it('insets both edges by the 12px track when both axes overflow in overlay mode', () => {
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollWidth: 900, clientWidth: 400, scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'auto' });   // overlay by default
        panel.getElement(true);
        panel.doLayout();

        const overlay = internals(panel)._shadowOverlay;
        expect(overlay).not.toBeNull();

        // clientWidth 400 - 12 track, clientHeight 300 - 12 track.
        expect(lastStyle(sink, overlay!, 'width')).toBe('388px');
        expect(lastStyle(sink, overlay!, 'height')).toBe('288px');
    });

    it('insets only the overflowing axis (vertical bar only → right inset, full height)', () => {
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollHeight: 900, clientHeight: 300, scrollWidth: 400, clientWidth: 400 });

        const panel = new _Panel({ autoScroll: 'y' });   // overlay by default
        panel.getElement(true);
        panel.doLayout();

        const overlay = internals(panel)._shadowOverlay;

        expect(lastStyle(sink, overlay!, 'width')).toBe('388px');   // right gutter reserved
        expect(lastStyle(sink, overlay!, 'height')).toBe('300px');  // no bottom bar → no inset
    });

    it('shows no horizontal bar when content fits the vertical bar\'s reduced viewport (no spurious cross-bar)', () => {
        // Vertical-only overflow. Because the overlay bar now reserves REAL space
        // (the inner scroller is inset by the 12px track), "does content overflow
        // horizontally?" is judged against the reduced viewport (388), not the
        // full client box. Real stretched content is laid out to that reduced
        // width (getInnerSize already subtracts the gutter), so `scrollWidth`
        // 388 fits exactly and no stray horizontal bar paints over the bottom
        // shadow. (Content that instead filled the *full* 400 client box would
        // genuinely overflow the 388 viewport and correctly show a 12px bar.)
        installTestDOM(CONFIG);
        stubMetrics({ scrollHeight: 900, clientHeight: 300, scrollWidth: 388, clientWidth: 400 });

        const panel = new _Panel({ autoScroll: 'auto' });   // overlay by default
        panel.getElement(true);
        panel.doLayout();

        const i = internals(panel);
        expect(i._scrollbarV!.isDisplayed()).toBe(true);    // real vertical overflow
        expect(i._scrollbarH!.isDisplayed()).toBe(false);   // content fits the reduced viewport → hidden
        expect(i._scrollbarGutter.bottom).toBe(0);          // and no bottom gutter reserved
    });

    it('does NOT inset in native mode — clientWidth already excludes the OS bar', () => {
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollHeight: 900, clientHeight: 300, scrollWidth: 400, clientWidth: 400 });

        const panel = new _Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        panel.getElement(true);
        panel.doLayout();

        const overlay = internals(panel)._shadowOverlay;

        expect(lastStyle(sink, overlay!, 'width')).toBe('400px');   // full client box, no inset
        expect(lastStyle(sink, overlay!, 'height')).toBe('300px');
    });
});
