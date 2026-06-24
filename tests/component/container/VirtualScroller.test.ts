import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Scrollbar } from '~/component/container/Scrollbar';
import { VirtualScroller } from '~/component/container/VirtualScroller';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Builds a sized owner Container with a materialised element plus a
 * VirtualScroller wired to a spy onScroll callback. The owner's committed
 * width/height feed the scroller's effective-viewport math (the geometry oracle
 * answers getWidth/getHeight from this committed state).
 */
function makeScroller(ownerWidth: number, ownerHeight: number): { scroller: VirtualScroller; onScroll: ReturnType<typeof vi.fn> } {
    const owner = new Container();

    owner.getElement(true);
    owner.setWidth(ownerWidth);
    owner.setHeight(ownerHeight);

    const onScroll = vi.fn();
    const scroller = new VirtualScroller(owner, owner.getElement(true)!, onScroll);

    return { scroller, onScroll };
}

/** TRACK_WIDTH read off a real Scrollbar so the test never hard-codes 12. */
const TRACK_WIDTH = new Scrollbar('vertical').getTrackWidth();

describe('VirtualScroller scroll position', () => {
    afterEach(() => DOM.reset());

    it('starts at scroll (0, 0) on a fresh scroller', () => {
        installTestDOM(CONFIG);

        const { scroller } = makeScroller(200, 400);

        expect(scroller.getScrollX()).toBe(0);
        expect(scroller.getScrollY()).toBe(0);
    });

    it('clamps setScrollY to [0, contentHeight - viewportHeight]', () => {
        installTestDOM(CONFIG);

        const { scroller } = makeScroller(200, 400);

        // Content taller than the owner but narrow enough that the vertical
        // bar's track reservation never forces a horizontal bar (content width
        // 100 stays below ownerWidth - track = 188), so the effective vertical
        // viewport is the full owner height (400).
        scroller.layoutScrollbars(100, 1000);

        scroller.setScrollY(99999);

        // Contract: max = contentHeight - effectiveViewportH = 1000 - 400.
        expect(scroller.getScrollY()).toBe(1000 - 400);

        scroller.setScrollY(-50);

        expect(scroller.getScrollY()).toBe(0);
    });

    it('does not fire onScroll when the position is unchanged', () => {
        installTestDOM(CONFIG);

        const { scroller, onScroll } = makeScroller(200, 400);

        scroller.layoutScrollbars(200, 1000);
        onScroll.mockClear();

        scroller.setScrollY(0); // already 0

        expect(onScroll).not.toHaveBeenCalled();

        scroller.setScrollY(100);

        expect(onScroll).toHaveBeenCalledTimes(1);

        scroller.setScrollY(100); // no change

        expect(onScroll).toHaveBeenCalledTimes(1);
    });

    it('keeps max scroll at 0 when content fits the viewport', () => {
        installTestDOM(CONFIG);

        const { scroller, onScroll } = makeScroller(200, 400);

        scroller.layoutScrollbars(200, 300); // content shorter than owner
        onScroll.mockClear();

        scroller.setScrollY(100);

        expect(scroller.getScrollY()).toBe(0);
        expect(onScroll).not.toHaveBeenCalled();
    });

    it('subtracts the cross-axis track reservation from the effective viewport', () => {
        installTestDOM(CONFIG);

        const { scroller } = makeScroller(200, 400);

        // Content is taller than the owner (forces the vertical bar) and its
        // width (195) sits between the full owner width (200) and the
        // width-minus-track (200 - TRACK_WIDTH = 188). The two-pass visibility
        // resolution: the vertical bar appears (content height > 400), which
        // shrinks the effective width to 188; 195 > 188 forces the horizontal
        // bar too. So the effective horizontal viewport is ownerWidth - track.
        const contentWidth  = 200 - Math.floor(TRACK_WIDTH / 2); // 194, between 188 and 200
        const contentHeight = 1000;

        scroller.layoutScrollbars(contentWidth, contentHeight);

        scroller.setScrollX(99999);

        // Effective width = ownerWidth - TRACK_WIDTH because the vertical bar is
        // visible; max scroll = contentWidth - that.
        expect(scroller.getScrollX()).toBe(contentWidth - (200 - TRACK_WIDTH));
    });
});

describe('VirtualScroller clampToContent', () => {
    afterEach(() => DOM.reset());

    it('pulls an out-of-range position back to the new max without firing onScroll', () => {
        installTestDOM(CONFIG);

        const { scroller, onScroll } = makeScroller(200, 400);

        // Establish a tall, narrow content (no horizontal bar) and scroll near
        // the bottom. Content width 100 keeps the effective vertical viewport at
        // the full owner height (400).
        scroller.layoutScrollbars(100, 1000);
        scroller.setScrollY(600);

        expect(scroller.getScrollY()).toBe(600);

        onScroll.mockClear();

        // Content shrinks: new max = 500 - 400 = 100. The current 600 is pulled
        // back to 100, and clampToContent's contract is "Does not fire onScroll".
        scroller.clampToContent(100, 500);

        expect(scroller.getScrollY()).toBe(500 - 400);
        expect(onScroll).not.toHaveBeenCalled();
    });
});
