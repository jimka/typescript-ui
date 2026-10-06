// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A scrolling `Panel` answers "what is my scroll viewport" in one place
// (`getScrollViewportRect`) and reveals through one method (`revealSpan`, which
// `revealDescendant` calls once per axis). Cases V1–V8, S1–S9 and D1–D11 of
// plans/implemented/scroll-reveal-geometry-fixes.md.
//
// The scroll viewport is the visible window onto the scrolled content: the
// panel's box inside its border, less the band each visible scrollbar
// occupies. A panel remembers its scroll offsets (`getScrollTop()` returns the
// value last written through `setScrollTop()`), and a scroll the browser makes
// on its own — a key press, `Tab` moving focus, a touch pan — leaves that
// remembered offset stale. A reveal has to re-read it.
//
// The modelled DOM gives the cases their scroll geometry as follows.
//
//   - An element's rectangle is composed from the sizes and positions the
//     library wrote, less each ancestor's recorded scroll offset. The D1–D10
//     cases stage rectangles by hand instead, as the `Panel.revealDescendant`
//     cases of `tests/unit/core/FocusReveal.test.ts` do.
//   - The recording sink stores each `scrollTop` / `scrollLeft` write and
//     `DOM.source.getScrollTop` reads it back. It does NOT clamp, unlike a
//     browser, so a wrong target shows as a wrong number — negative ones
//     included.
//   - A scroll the browser made on its own is a write straight on the
//     scrolling element, which goes around `Panel.setScrollTop`.
//   - A visible scrollbar's band needs `setScrollExtent` on the scrolling
//     element BEFORE the first sized layout: the panel's layout pass then
//     reserves the band, 12 px under `"overlay"` and 15 px under `"native"`
//     (`CONFIG.scrollBarWidth`).
//   - A connected element's border reads as 0 px in the model, so V5 stubs
//     `getBorderWidths`. An element that is not connected needs no stub: the
//     panel estimates the width from the spec string (`'2px solid red'` → 2).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Panel } from '~/core/Panel';
import type { PanelOptions } from '~/core/Panel';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle, Rect } from '~/core/DOM';
import { Absolute } from '~/layout/Absolute';
import { installTestDOM, setConnected, setScrollExtent, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,           // the native scrollbar's band under `"native"`
    fontMetrics,
    themeVars:       {},
};

// The mounted panel's box.
const PANEL_WIDTH  = 300;
const PANEL_HEIGHT = 200;

// Content past the panel's box on both axes, so both scrollbars show.
const OVERFLOWING = { width: 900, height: 800 };

// Where S7 lands. A visible scrollbar takes a band out of the viewport: the
// overlay scrollbar's 12 px track under `"overlay"`, `CONFIG.scrollBarWidth`
// (15) under `"native"`. Revealing the span 500–540 puts its end on the
// viewport's end edge, so the offset is 540 less the box less the band:
// 540 − (200 − 12) and 540 − (300 − 12); 540 − (200 − 15) and 540 − (300 − 15).
const BANDED_REVEAL = {
    overlay: { top: 352, left: 252 },
    native:  { top: 355, left: 255 },
} as const;

/** The two styles a scrolling `Panel` draws its scrollbar in. */
type ScrollbarStyle = 'overlay' | 'native';

const STYLES: readonly ScrollbarStyle[] = ['overlay', 'native'];

let frames: FrameRequestCallback[];
let built: Component[];

/** Runs every captured animation frame, including those a frame schedules. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard++) {
        const pending = frames;

        frames = [];

        for (const callback of pending) {
            callback(0);
        }
    }
}

/** The element of the panel that really scrolls. */
function scroller(panel: Panel): Handle {
    return (panel as any).getScrollElement();
}

/** How many writes the sink has recorded so far: the mark `scrollWrites` counts from. */
function writeMark(): number {
    return (DOM.sink as RecordingDOMSink).writes.length;
}

/**
 * How many scroll-offset writes the sink recorded after `from`.
 *
 * @param from - A mark taken with {@link writeMark}.
 * @returns The number of `apply` writes carrying `scrollTop` or `scrollLeft`.
 */
function scrollWrites(from: number): number {
    return (DOM.sink as RecordingDOMSink).writes.slice(from).filter(write => {
        const patch = write.args[1] as { scrollTop?: number; scrollLeft?: number } | undefined;

        return write.op === 'apply' && (patch?.scrollTop !== undefined || patch?.scrollLeft !== undefined);
    }).length;
}

/**
 * Asserts the panel's vertical offset, on the scrolling element and in the
 * panel's remembered offset alike.
 *
 * @param panel - The panel under test.
 * @param offset - The expected `scrollTop`.
 */
function expectOffset(panel: Panel, offset: number): void {
    expect(DOM.source.getScrollTop(scroller(panel))).toBe(offset);
    expect(panel.getScrollTop()).toBe(offset);
}

/**
 * Asserts the panel's horizontal offset, on the scrolling element and in the
 * panel's remembered offset alike.
 *
 * @param panel - The panel under test.
 * @param offset - The expected `scrollLeft`.
 */
function expectLeft(panel: Panel, offset: number): void {
    expect(DOM.source.getScrollLeft(scroller(panel))).toBe(offset);
    expect(panel.getScrollLeft()).toBe(offset);
}

/**
 * Builds a panel, connects it and lays it out at 300 × 200.
 *
 * @param options - `Panel` options on top of an `Absolute` layout and no insets.
 * @param seed - A content extent to seed on the scrolling element before the
 *   first sized layout, for a case that needs a scrollbar's band.
 * @returns The mounted panel.
 */
function mountPanel(options: PanelOptions, seed?: { width: number; height: number }): Panel {
    const panel = new Panel({ layoutManager: new Absolute(), flush: true, ...options });

    built.push(panel);

    const element = panel.getElement(true)!;

    setConnected(element, true);

    if (seed) {
        setScrollExtent(scroller(panel), seed);
    }

    panel.setWidth(PANEL_WIDTH);
    panel.setHeight(PANEL_HEIGHT);
    panel.doLayout();

    drainFrames();

    return panel;
}

/**
 * The scroll viewport as `[left, top, width, height]`.
 *
 * @param panel - The panel to measure.
 * @returns The four numbers, or null when the panel has no scroll viewport.
 */
function viewportOf(panel: Panel): number[] | null {
    const view = panel.getScrollViewportRect();

    return view ? [view.left, view.top, view.width, view.height] : null;
}

beforeEach(() => {
    installTestDOM(CONFIG);

    frames = [];
    built  = [];

    // A scrolling panel schedules a follow-up layout frame. Capture it, so the
    // teardown can drain it: an undrained registration leaves `Component`'s
    // module-level frame handle set and swallows the next test's own.
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return frames.length;
    });
});

afterEach(() => {
    drainFrames();

    vi.restoreAllMocks();

    for (const component of built) {
        component.dispose();
    }

    DOM.reset();
});

describe('Panel.getScrollViewportRect', () => {
    it('V1: an overlay panel with no scrollbar showing has its whole box as viewport', () => {
        const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: 'overlay' });

        expect(viewportOf(panel)).toEqual([0, 0, 300, 200]);
    });

    it('V2: a native panel with no scrollbar showing has its whole box as viewport', () => {
        const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: 'native' });

        expect(viewportOf(panel)).toEqual([0, 0, 300, 200]);
    });

    it('V3: an overlay panel with both scrollbars showing loses a 12 px band on each axis', () => {
        const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: 'overlay' }, OVERFLOWING);

        expect(viewportOf(panel)).toEqual([0, 0, 288, 188]);
    });

    it('V4: a native panel with both scrollbars showing loses a 15 px band on each axis', () => {
        const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: 'native' }, OVERFLOWING);

        expect(viewportOf(panel)).toEqual([0, 0, 285, 185]);
    });

    it('V5: the viewport lies inside the border', () => {
        vi.spyOn(DOM.source, 'getBorderWidths').mockReturnValue({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: 'native', border: '2px solid red' });
        const view  = panel.getScrollViewportRect()!;

        expect([view.left, view.top, view.width, view.height]).toEqual([2, 2, 296, 196]);
        expect(view.right).toBe(298);
        expect(view.bottom).toBe(198);
        expect(view.x).toBe(2);
        expect(view.y).toBe(2);
    });

    it('V6: a panel that is not displayed has no scroll viewport', () => {
        const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: 'overlay' });

        panel.setDisplayed(false);

        expect(panel.getScrollViewportRect()).toBeNull();
    });

    it('V7: a panel that was never rendered has no scroll viewport', () => {
        const panel: Panel = new Panel({ autoScroll: 'y' });

        built.push(panel);

        expect(panel.getScrollViewportRect()).toBeNull();
    });

    it('V8: a panel that does not scroll has no scroll viewport', () => {
        const panel = mountPanel({ autoScroll: 'none' });

        expect(panel.getScrollViewportRect()).toBeNull();
    });
});

for (const style of STYLES) {
    describe('Panel.revealSpan — ' + style + ' scrollbars', () => {
        /**
         * S1–S4 are one sequence on one panel; each later case starts from the
         * state the one before it left.
         *
         * @param steps - How many of the four steps to run.
         * @returns The panel, and a write mark taken before the last step ran.
         */
        function runSequence(steps: 1 | 2 | 3 | 4): { panel: Panel; mark: number; rememberedBeforeS3: number } {
            const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: style });

            let mark               = writeMark();
            let rememberedBeforeS3 = Number.NaN;

            panel.revealSpan('y', 100, 140);

            if (steps >= 2) {
                mark = writeMark();
                panel.revealSpan('y', 500, 540);
            }

            if (steps >= 3) {
                // The browser scrolls the panel on its own, on both axes.
                DOM.sink.apply(scroller(panel), { scrollTop: 1000, scrollLeft: 70 });

                rememberedBeforeS3 = panel.getScrollTop();
                mark               = writeMark();

                panel.revealSpan('y', 900, 940);
            }

            if (steps >= 4) {
                mark = writeMark();
                panel.revealSpan('y', 950, 990);
            }

            return { panel, mark, rememberedBeforeS3 };
        }

        it('S1: a span already in view is not scrolled to', () => {
            const { panel, mark } = runSequence(1);

            expect(scrollWrites(mark)).toBe(0);
            expectOffset(panel, 0);
        });

        it('S2: a span below the view lands on the bottom edge', () => {
            const { panel } = runSequence(2);

            // 540 − 200.
            expectOffset(panel, 340);
        });

        it('S3: a reveal starts from where the browser scrolled the panel to, and leaves the other axis alone', () => {
            const { panel, rememberedBeforeS3 } = runSequence(3);

            // Stale until the reveal: the panel never heard of the scroll to 1000.
            expect(rememberedBeforeS3).toBe(340);

            // The span 900–940 is above the real view 1000–1200: top edge.
            expectOffset(panel, 900);
            expectLeft(panel, 70);
        });

        it('S4: a span inside the view the reveal left is not scrolled to again', () => {
            const { panel, mark } = runSequence(4);

            expect(scrollWrites(mark)).toBe(0);
            expectOffset(panel, 900);
        });

        it('S5: an axis the panel does not scroll is left alone', () => {
            const panel = mountPanel({ autoScroll: 'y', scrollbarStyle: style });
            const mark  = writeMark();

            panel.revealSpan('x', 500, 540);

            expect(scrollWrites(mark)).toBe(0);
            expect(panel.getScrollLeft()).toBe(0);
        });

        it('S6: a hidden panel is neither revealed nor re-read', () => {
            const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: style });

            panel.setScrollTop(300);
            panel.setDisplayed(false);

            // What an element under `display: none` reports: an offset of 0.
            DOM.sink.apply(scroller(panel), { scrollTop: 0 });

            const mark = writeMark();

            panel.revealSpan('y', 0, 10);
            panel.revealDescendant(scroller(panel));

            expect(scrollWrites(mark)).toBe(0);
            expect(panel.getScrollTop()).toBe(300);
        });

        it('S7: a visible scrollbar\'s band is not viewport, on either axis', () => {
            const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: style }, OVERFLOWING);

            panel.revealSpan('y', 500, 540);
            panel.revealSpan('x', 500, 540);

            expectOffset(panel, BANDED_REVEAL[style].top);
            expectLeft(panel, BANDED_REVEAL[style].left);
        });

        it('S8: a panel that does not scroll is not scrolled', () => {
            const panel = mountPanel({ autoScroll: 'none', scrollbarStyle: style });
            const mark  = writeMark();

            panel.revealSpan('y', 500, 540);

            expect(scrollWrites(mark)).toBe(0);
            expect(panel.getScrollTop()).toBe(0);
        });

        it('S9: a panel that was never rendered ignores the call', () => {
            const panel: Panel = new Panel({ autoScroll: 'y', scrollbarStyle: style });

            built.push(panel);

            expect(() => panel.revealSpan('y', 500, 540)).not.toThrow();
            expect(panel.getScrollTop()).toBe(0);
        });
    });
}

describe('Panel.revealSpan — return value', () => {
    it('returns the panel, for chaining', () => {
        const panel = mountPanel({ autoScroll: 'auto' });

        expect(panel.revealSpan('y', 500, 540)).toBe(panel);
    });
});

describe('Panel.revealDescendant — staged rectangles', () => {
    /**
     * Stages the panel's own rectangle as left 0, top 100, 300 × 300, and a
     * movable one for the target, given as its edges where it is drawn now.
     *
     * @param panel - The panel whose element is staged.
     * @param target - The target element.
     * @param targetRect - The target's edges; unstated ones default to a 40 × 40 box at the origin.
     */
    function stageRects(panel: Panel, target: Handle, targetRect: Partial<Rect>): void {
        const view: Rect = { x: 0, y: 100, width: 300, height: 300, top: 100, left: 0, right: 300, bottom: 400 };
        const rect: Rect = { x: 0, y: 0, width: 40, height: 40, top: 0, left: 0, right: 40, bottom: 40, ...targetRect };
        const rects = new Map<Handle, Rect>([[panel.getElement()!, view], [target, rect]]);

        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((handle: Handle) => rects.get(handle)!);
    }

    /**
     * A rendered panel — neither sized nor connected — and a loose target
     * element. Scrolls both axes under `"native"` unless `options` says otherwise.
     *
     * @param options - `Panel` options on top of the defaults.
     * @returns The panel and the target.
     */
    function panelWithTarget(options: PanelOptions = {}): { panel: Panel; target: Handle } {
        const panel = new Panel({ autoScroll: 'both', scrollbarStyle: 'native', ...options });

        built.push(panel);

        panel.getElement(true);

        const target = DOM.sink.createElement('div');

        return { panel, target };
    }

    it('D1: the distance is added to where the browser scrolled the panel to', () => {
        const { panel, target } = panelWithTarget();

        // The browser scrolled the panel by 200; the panel still remembers 0.
        DOM.sink.apply(panel.getElement()!, { scrollTop: 200 });

        stageRects(panel, target, { top: 420, bottom: 460, left: 50, right: 90 });

        panel.revealDescendant(target);

        // 60 px below the view's bottom edge (400), from a real offset of 200.
        expect(panel.getScrollTop()).toBe(260);
        expect(DOM.source.getScrollTop(panel.getElement()!)).toBe(260);
        expect(panel.getScrollLeft()).toBe(0);
    });

    it('D2: a target past the bottom and right edges lands inside the border', () => {
        const { panel, target } = panelWithTarget({ border: '2px solid red' });

        expect(panel.getBorderSize().top).toBe(2);

        stageRects(panel, target, { top: 420, bottom: 460, left: 320, right: 360 });

        panel.revealDescendant(target);

        // The viewport ends 2 px inside the box: at 398 and at 298.
        expect(panel.getScrollTop()).toBe(62);
        expect(panel.getScrollLeft()).toBe(62);
    });

    it('D3: a target past the top and left edges lands inside the border', () => {
        const { panel, target } = panelWithTarget({ border: '2px solid red' });

        stageRects(panel, target, { top: 20, bottom: 60, left: -30, right: 10 });

        panel.revealDescendant(target);

        // The viewport starts 2 px inside the box: at 102 and at 2.
        expect(panel.getScrollTop()).toBe(-82);
        expect(panel.getScrollLeft()).toBe(-32);
    });

    it('D4: a panel that scrolls vertically only is not scrolled sideways', () => {
        const { panel, target } = panelWithTarget({ autoScroll: 'y' });

        stageRects(panel, target, { top: 420, bottom: 460, left: 320, right: 360 });

        panel.revealDescendant(target);

        expect(panel.getScrollTop()).toBe(60);
        expect(panel.getScrollLeft()).toBe(0);
    });

    it('D5: a panel that scrolls horizontally only is not scrolled up or down', () => {
        const { panel, target } = panelWithTarget({ autoScroll: 'x' });

        stageRects(panel, target, { top: 420, bottom: 460, left: 320, right: 360 });

        panel.revealDescendant(target);

        expect(panel.getScrollTop()).toBe(0);
        expect(panel.getScrollLeft()).toBe(60);
    });

    it('D6: a target wider than the viewport and cut at the end keeps its start', () => {
        const { panel, target } = panelWithTarget();

        stageRects(panel, target, { top: 150, bottom: 190, left: 50, right: 650, width: 600 });

        panel.revealDescendant(target);

        expect(panel.getScrollLeft()).toBe(50);
        expect(panel.getScrollTop()).toBe(0);
    });

    it('D7: a target wider than the viewport that already starts on its edge is left alone', () => {
        const { panel, target } = panelWithTarget();

        stageRects(panel, target, { top: 150, bottom: 190, left: 0, right: 600, width: 600 });

        const mark = writeMark();

        panel.revealDescendant(target);

        expect(scrollWrites(mark)).toBe(0);
    });

    it('D8: a target that covers the viewport is left alone', () => {
        const { panel, target } = panelWithTarget();

        // The browser scrolled the panel 100 px sideways; the target now
        // starts 100 px left of the view and ends 200 px right of it.
        DOM.sink.apply(panel.getElement()!, { scrollLeft: 100 });

        stageRects(panel, target, { top: 150, bottom: 190, left: -100, right: 500, width: 600 });

        const mark = writeMark();

        panel.revealDescendant(target);

        expect(scrollWrites(mark)).toBe(0);
        expect(panel.getScrollLeft()).toBe(100);
    });

    it('D9: a target wider than the viewport and wholly past its end lands on its start', () => {
        const { panel, target } = panelWithTarget();

        stageRects(panel, target, { top: 150, bottom: 190, left: 400, right: 1000, width: 600 });

        panel.revealDescendant(target);

        expect(panel.getScrollLeft()).toBe(400);
    });

    it('D10: a hidden panel keeps its remembered offset', () => {
        const { panel, target } = panelWithTarget();

        panel.setScrollTop(120);
        panel.setDisplayed(false);

        stageRects(panel, target, { top: 420, bottom: 460 });

        const mark = writeMark();

        panel.revealDescendant(target);

        expect(scrollWrites(mark)).toBe(0);
        expect(panel.getScrollTop()).toBe(120);
    });
});

for (const style of STYLES) {
    describe('Panel.revealDescendant — real children, ' + style + ' scrollbars', () => {
        it('D11: reveals a child below the view, again after the browser scrolled away, and a child wider than the view', () => {
            const panel = mountPanel({ autoScroll: 'auto', scrollbarStyle: style });
            const child = new Component({ preferredSize: { width: 40,  height: 40 } });
            const wide  = new Component({ preferredSize: { width: 700, height: 40 } });

            child.setX(50);
            child.setY(500);
            wide.setX(0);
            wide.setY(100);

            panel.addComponent(child);
            panel.addComponent(wide);
            panel.doLayout();

            drainFrames();

            // The child spans 500–540: its bottom lands on the bottom edge, 540 − 200.
            panel.revealDescendant(child.getElement()!);

            expectOffset(panel, 340);
            expectLeft(panel, 0);

            // The browser scrolls the panel back to the top on its own.
            DOM.sink.apply(scroller(panel), { scrollTop: 0 });

            panel.revealDescendant(child.getElement()!);

            expectOffset(panel, 340);

            // The 700 px child starts at the view's left edge already: no
            // sideways move. It spans 100–140, above the view: top edge.
            panel.revealDescendant(wide.getElement()!);

            expectOffset(panel, 100);
            expectLeft(panel, 0);
        });
    });
}
