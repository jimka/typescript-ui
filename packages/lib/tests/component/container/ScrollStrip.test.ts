import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { Panel } from '~/core/Panel';
import { Button } from '~/component/button/Button';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { DOM } from '~/core/DOM';
import type { Rect } from '~/core/DOM';
import { FocusReveal } from '~/core/FocusReveal';
import { installTestDOM, setConnected } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Mirrored ONLY to derive expected relations: SCROLL_ARROW_SIZE is the per-end
// gutter ScrollStrip reserves on overflow. The slop-boundary tests assert the
// reserve equals this value (or 0), not the literal as an opaque golden.
const SCROLL_ARROW_SIZE = 24;

let frames: FrameRequestCallback[];

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

beforeEach(() => {
    installTestDOM(CONFIG);

    // A strip queues a layout pass when it is built, and a reveal through the
    // broker waits for it. Capture the frame, so a case can run it and the
    // teardown can drain it: a pass left queued stays in `Component`'s
    // module-level queue for the tests that follow, and its frame handle
    // swallows their own registration.
    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return frames.length;
    });
});

afterEach(() => {
    drainFrames();
    vi.restoreAllMocks();
    DOM.reset();
});

describe('ScrollStrip construction', () => {
    it('is a Panel', () => {
        expect(new ScrollStrip()).toBeInstanceOf(Panel);
    });

    it('defaults to horizontal orientation (HBox)', () => {
        const strip = new ScrollStrip();

        expect(strip.getOrientation()).toBe('horizontal');
        expect(strip.getContentBox()).toBeInstanceOf(HBox);
    });

    it('builds a VBox for { orientation: "vertical" }', () => {
        const strip = new ScrollStrip({ orientation: 'vertical' });

        expect(strip.getOrientation()).toBe('vertical');
        expect(strip.getContentBox()).toBeInstanceOf(VBox);
    });

    it('defaults to scrollable', () => {
        expect(new ScrollStrip().isScrollable()).toBe(true);
    });

    it('round-trips an explicit scrollable option', () => {
        expect(new ScrollStrip({ scrollable: false }).isScrollable()).toBe(false);
        expect(new ScrollStrip({ scrollable: true }).isScrollable()).toBe(true);
    });
});

describe('ScrollStrip.setOrientation box swap', () => {
    it('swaps the box to VBox on "vertical" and HBox on "horizontal"', () => {
        const strip = new ScrollStrip();

        strip.setOrientation('vertical');
        expect(strip.getContentBox()).toBeInstanceOf(VBox);

        strip.setOrientation('horizontal');
        expect(strip.getContentBox()).toBeInstanceOf(HBox);
    });

    it('is a no-op when the orientation is unchanged (keeps the box instance)', () => {
        const strip = new ScrollStrip();
        const box = strip.getContentBox();

        strip.setOrientation('horizontal');

        expect(strip.getContentBox()).toBe(box);
    });
});

describe('ScrollStrip.arrowReserve slop boundary', () => {
    it('reserves a gutter when content overflows the region by more than the slop', () => {
        const strip = new ScrollStrip();

        // content == region + 2 -> reserve (overflowing past the +1 slop).
        expect(strip.arrowReserve(102, 100)).toBe(SCROLL_ARROW_SIZE);
    });

    it('reserves nothing exactly at the +1 slop boundary', () => {
        const strip = new ScrollStrip();

        // content == region + 1 -> 0 (the slop absorbs a flush fit).
        expect(strip.arrowReserve(101, 100)).toBe(0);
    });

    it('reserves nothing when content fits the region', () => {
        const strip = new ScrollStrip();

        expect(strip.arrowReserve(80, 100)).toBe(0);
    });

    it('reserves nothing when not scrollable, however far it overflows', () => {
        const strip = new ScrollStrip({ scrollable: false });

        expect(strip.arrowReserve(500, 100)).toBe(0);
    });

    it('reserves a gutter again once scrollable is re-enabled', () => {
        const strip = new ScrollStrip({ scrollable: false });

        strip.setScrollable(true);
        expect(strip.arrowReserve(200, 100)).toBe(SCROLL_ARROW_SIZE);
    });
});

describe('ScrollStrip item management', () => {
    it('adds items as box children', () => {
        const strip = new ScrollStrip();
        const a = new Button({ text: 'A' });
        const b = new Button({ text: 'B' });

        strip.addItem(a).addItem(b);

        expect(strip.getItems()).toEqual([a, b]);
    });

    it('removes an item from the box', () => {
        const strip = new ScrollStrip();
        const a = new Button({ text: 'A' });
        const b = new Button({ text: 'B' });

        strip.addItem(a).addItem(b).removeItem(a);

        expect(strip.getItems()).toEqual([b]);
    });

    it('moves an item to a new index', () => {
        const strip = new ScrollStrip();
        const a = new Button({ text: 'A' });
        const b = new Button({ text: 'B' });
        const c = new Button({ text: 'C' });

        strip.addItem(a).addItem(b).addItem(c).moveItem(c, 0);

        expect(strip.getItems()).toEqual([c, a, b]);
    });
});

describe('ScrollStrip per-click step resolution', () => {
    it('uses the configured arrow step when no provider is set', () => {
        const strip = new ScrollStrip({ arrowStep: 50 });

        expect(strip.resolveStep()).toBe(50);
    });

    it('lets setArrowStep override the per-click step', () => {
        const strip = new ScrollStrip();

        strip.setArrowStep(70);
        expect(strip.resolveStep()).toBe(70);
    });

    it('prefers the step provider over the configured arrow step', () => {
        const strip = new ScrollStrip({ arrowStep: 50 });

        strip.setStepProvider(() => 123);
        expect(strip.resolveStep()).toBe(123);
    });
});

describe('ScrollStrip.revealItem arrow refresh (regression)', () => {
    // Arrow-paging (scrollBy) refreshes the arrows after it moves the native
    // scroll; revealItem must do the same. Reveal-on-select can jump the scroll
    // from the far start to the far end (e.g. selecting the last tab via the
    // context menu while scrolled fully left), and if the arrows aren't
    // re-evaluated the lead arrow stays wrongly disabled and the trail wrongly
    // enabled. The live overflow metrics (scrollWidth) are flattened offline, so
    // drive revealItem's rect inputs directly: the contract under test is "a
    // reveal that scrolls also refreshes the arrows", independent of the metrics.
    it('refreshes the arrows after a reveal that moves the scroll', () => {
        const strip = new ScrollStrip();

        strip.getClipElement(true); // realise the clip so revealItem passes its guard
        const item = new Button({ text: 'Z' });
        strip.addItem(item);
        const itemEl = item.getElement(true)!;

        const rect = (left: number, right: number) =>
            ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0 } as any);

        // revealItem reads the clip rect first, then the item rect. Put the item
        // fully to the right of the clip viewport so it must scroll right.
        vi.spyOn(DOM.source, 'getElementRect')
            .mockReturnValueOnce(rect(0, 100))
            .mockReturnValueOnce(rect(150, 200));

        const refreshSpy = vi.spyOn(strip, 'refreshArrows');
        const before = strip.mainScroll();

        strip.revealItem(itemEl);

        expect(strip.mainScroll()).toBeGreaterThan(before); // the reveal actually scrolled
        expect(refreshSpy).toHaveBeenCalled();              // and re-evaluated the arrows
    });
});

describe('ScrollStrip.revealRect', () => {
    // Cases X1 and X2 of plans/implemented/nested-scroll-reveal.md, and X3–X11
    // the implementation added: a vertical strip, a hidden one, and the
    // strip as the only scroller around a component. The strip is a
    // scroller in the broker's scroll pass: it is handed a rectangle, scrolls
    // its clip along its main axis by the least distance that shows it, and
    // returns what the clip then shows of it.

    /**
     * A rectangle from its four edges.
     *
     * @param left - The left edge.
     * @param top - The top edge.
     * @param right - The right edge.
     * @param bottom - The bottom edge.
     * @returns The rectangle, with all eight fields.
     */
    function rect(left: number, top: number, right: number, bottom: number): Rect {
        return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
    }

    /**
     * A rectangle's four edges.
     *
     * @param r - The rectangle.
     * @returns `[left, top, right, bottom]`.
     */
    function edges(r: Rect): number[] {
        return [r.left, r.top, r.right, r.bottom];
    }

    /**
     * A strip with one item, whose clip measures as 100 px along the strip's
     * main axis and 20 px across it, from the window's origin.
     *
     * @param orientation - The strip's orientation.
     * @returns The strip.
     */
    function stripWithClip(orientation: 'horizontal' | 'vertical' = 'horizontal'): ScrollStrip {
        const strip = new ScrollStrip({ orientation });

        strip.getClipElement(true); // realise the clip so the reveal passes its guard
        strip.addItem(new Button({ text: 'Z' }));

        const clip     = strip.getClipElement()!;
        const clipRect = orientation === 'horizontal' ? rect(0, 0, 100, 20) : rect(0, 0, 20, 100);

        vi.spyOn(DOM.source, 'getElementRect')
            .mockImplementation(handle => handle === clip ? clipRect : rect(0, 0, 0, 0));

        return strip;
    }

    it('X1: scrolls its clip along the main axis and returns what the clip then shows', () => {
        const strip = stripWithClip();

        // The rectangle ends 100 px past the clip's end: the clip scrolls by
        // that, and the rectangle is then flush with the clip's end.
        expect(edges(strip.revealRect(rect(150, 0, 200, 20)))).toEqual([50, 0, 100, 20]);
        expect(strip.mainScroll()).toBe(100);

        // In view: handed back as it is, and nothing moves.
        expect(edges(strip.revealRect(rect(20, 0, 60, 20)))).toEqual([20, 0, 60, 20]);
        expect(strip.mainScroll()).toBe(100);
    });

    it('X2: a reveal along the other axis scrolls nothing and cuts the rectangle to the clip', () => {
        const strip = stripWithClip();

        expect(edges(strip.revealRect(rect(150, 0, 200, 20), 'y'))).toEqual([100, 0, 100, 20]);
        expect(strip.mainScroll()).toBe(0);

        expect(edges(strip.revealRect(rect(150, 0, 200, 20), 'x'))).toEqual([50, 0, 100, 20]);
        expect(strip.mainScroll()).toBe(100);
    });

    it('X3: a vertical strip scrolls its clip up and down, and moves the rectangle that way', () => {
        const strip = stripWithClip('vertical');

        // The rectangle ends 100 px below the clip's end.
        expect(edges(strip.revealRect(rect(0, 150, 20, 200)))).toEqual([0, 50, 20, 100]);
        expect(strip.mainScroll()).toBe(100);

        expect(edges(strip.revealRect(rect(0, 20, 20, 60)))).toEqual([0, 20, 20, 60]);
        expect(strip.mainScroll()).toBe(100);
    });

    it('X5: a hidden strip scrolls nothing and hands the rectangle on untouched', () => {
        const strip = stripWithClip();

        strip.setDisplayed(false);

        expect(edges(strip.revealRect(rect(150, 0, 200, 20)))).toEqual([150, 0, 200, 20]);
        expect(strip.mainScroll()).toBe(0);
    });

    it('X6: a strip says it has a scroll range along its main axis, and a row reveal inside it reaches the strip', () => {
        const across = new ScrollStrip();
        const down   = new ScrollStrip({ orientation: 'vertical' });
        const fixed  = new ScrollStrip({ scrollable: false });

        // `Panel`'s own answer is for the band, which never scrolls.
        expect([across.hasScrollRange('x'), across.hasScrollRange('y'), across.hasScrollRange()]).toEqual([true, false, true]);
        expect([down.hasScrollRange('x'), down.hasScrollRange('y'), down.hasScrollRange()]).toEqual([false, true, true]);
        expect([fixed.hasScrollRange('x'), fixed.hasScrollRange()]).toEqual([false, false]);

        const strip = stripWithClip();
        const item  = new Button({ text: 'Y' });

        strip.addItem(item);
        item.getElement(true);
        setConnected(strip.getElement(true)!, true);
        drainFrames();

        // What a component inside a strip item does after a keyboard move.
        // The clip is no child component of the strip, so the strip is found
        // from the element the clip is appended into.
        FocusReveal.revealRectAround(item, () => rect(150, 0, 200, 20), 'x');

        expect(strip.mainScroll()).toBe(100);
    });

    it('X7: a layout pass queued for the strip is run before a component inside it is revealed', () => {
        const strip = stripWithClip();
        const item  = new Button({ text: 'Y' });

        strip.addItem(item);
        item.getElement(true);
        setConnected(strip.getElement(true)!, true);
        drainFrames();

        // The clip is no child component of the strip, so a pass queued for
        // the strip is only found from the element the clip is appended into.
        strip.scheduleLayout();

        const laidOut  = vi.spyOn(strip, 'doLayout');
        const relaidOut: boolean[] = [];

        FocusReveal.revealRectAround(item, ran => {
            relaidOut.push(ran);

            return rect(150, 0, 200, 20);
        }, 'x');

        expect(laidOut).toHaveBeenCalledTimes(1);
        expect(relaidOut).toEqual([true]);
        expect(strip.mainScroll()).toBe(100);
    });

    it('X8: a scrolling panel inside a strip item scrolls before the strip does', () => {
        const strip = stripWithClip();
        const panel = new Panel({ autoScroll: 'x' });
        const inner = new Button({ text: 'Y' });
        const order: string[] = [];

        panel.addComponent(inner);
        strip.addItem(panel as never);
        panel.getElement(true);
        inner.getElement(true);
        setConnected(strip.getElement(true)!, true);
        drainFrames();

        vi.spyOn(panel, 'revealRect').mockImplementation(shown => {
            order.push('panel');

            return shown;
        });
        vi.spyOn(strip, 'revealRect').mockImplementation(shown => {
            order.push('strip');

            return shown;
        });

        // The panel is found through the component tree, the strip from the
        // element the clip is appended into. The strip is the outer one.
        FocusReveal.revealRectAround(inner, () => rect(150, 0, 200, 20), 'x');

        expect(order).toEqual(['panel', 'strip']);

        // A scrolling panel stays in the reveal registry until it is
        // disposed, and the next test's handle table reuses its number.
        panel.dispose();
    });

    it('X9: of two passes queued around the strip, the outer one runs first', () => {
        const strip = stripWithClip();
        const band  = new Panel({ layoutManager: new HBox() });
        const item  = new Button({ text: 'Y' });
        const order: string[] = [];

        band.addComponent(strip);
        strip.addItem(item);
        item.getElement(true);
        setConnected(band.getElement(true)!, true);
        setConnected(strip.getElement(true)!, true);
        drainFrames();

        const bandLayout  = band.doLayout.bind(band);
        const stripLayout = strip.doLayout.bind(strip);

        vi.spyOn(band, 'doLayout').mockImplementation(() => {
            order.push('band');

            return bandLayout();
        });
        vi.spyOn(strip, 'doLayout').mockImplementation(() => {
            order.push('strip');

            return stripLayout();
        });

        strip.scheduleLayout();
        band.scheduleLayout();
        FocusReveal.revealRectAround(item, () => rect(150, 0, 200, 20), 'x');

        expect(order[0]).toBe('band');
        expect(order.filter(name => name === 'strip')).toHaveLength(1);

        band.dispose();
    });

    it('X10: a pass queued for the strip runs before one queued for the component inside it', () => {
        const strip = stripWithClip();
        const item  = new Button({ text: 'Y' });
        const order: string[] = [];

        strip.addItem(item);
        item.getElement(true);
        setConnected(strip.getElement(true)!, true);
        drainFrames();

        const stripLayout = strip.doLayout.bind(strip);
        const itemLayout  = item.doLayout.bind(item);

        vi.spyOn(strip, 'doLayout').mockImplementation(() => {
            order.push('strip');

            return stripLayout();
        });
        vi.spyOn(item, 'doLayout').mockImplementation(() => {
            order.push('item');

            return itemLayout();
        });

        item.scheduleLayout();
        strip.scheduleLayout();
        FocusReveal.revealRectAround(item, () => rect(150, 0, 200, 20), 'x');

        // The strip is the outer one, found from the element its clip is
        // appended into; the item is found through the component tree.
        expect(order[0]).toBe('strip');
        expect(order).toContain('item');
    });

    it('X11: an opener around the strip that is animating, or hides the strip, holds the step back', () => {
        const strip = stripWithClip();
        const item  = new Button({ text: 'Y' });
        let settled = false;
        let hides   = false;

        strip.addItem(item);
        item.getElement(true);
        setConnected(strip.getElement(true)!, true);
        drainFrames();

        // An opener that is no ancestor of the item in the component tree:
        // it is found from the element the clip is appended into.
        const opener = {
            getRevealElement: () => strip.getElement()!,
            revealDescendant: () => {},
            isRevealSettled:  () => settled,
            hidesDescendant:  () => hides,
        };

        FocusReveal.register(opener);

        try {
            FocusReveal.revealRectAround(item, () => rect(150, 0, 200, 20), 'x');

            expect(strip.mainScroll()).toBe(0);

            settled = true;
            hides   = true;
            FocusReveal.revealRectAround(item, () => rect(150, 0, 200, 20), 'x');

            expect(strip.mainScroll()).toBe(0);

            hides = false;
            FocusReveal.revealRectAround(item, () => rect(150, 0, 200, 20), 'x');

            expect(strip.mainScroll()).toBe(100);
        } finally {
            FocusReveal.unregister(opener);
        }
    });

    it('X4: a vertical strip takes "y" as its own axis and leaves "x" alone', () => {
        const strip = stripWithClip('vertical');

        expect(edges(strip.revealRect(rect(0, 150, 20, 200), 'x'))).toEqual([0, 100, 20, 100]);
        expect(strip.mainScroll()).toBe(0);

        expect(edges(strip.revealRect(rect(0, 150, 20, 200), 'y'))).toEqual([0, 50, 20, 100]);
        expect(strip.mainScroll()).toBe(100);
    });
});

describe('ScrollStrip.resetScroll arrow refresh (regression)', () => {
    // resetScroll moves the native scroll back to the origin outside any
    // layout pass. The deferred-resync plan's layoutItems only re-derives the
    // arrows when the clamp signature (the clip's main-axis extent or the
    // laid-out items' far edge) moved, which a side switch that lands on an
    // identical box does not guarantee — so, like scrollBy and revealItem,
    // resetScroll must refresh the arrows itself rather than rely on the
    // next layout pass.
    it('refreshes the arrows after resetting the scroll', () => {
        const strip = new ScrollStrip();

        strip.getClipElement(true); // realise the clip

        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        strip.resetScroll();

        expect(refreshSpy).toHaveBeenCalled();
    });
});

describe('ScrollStrip as a FocusRevealer (regression)', () => {
    // A keyboard-driven focus move (e.g. SpatialNavigation's `.focus()` call)
    // never goes through `revealItem` on its own — it only calls
    // `FocusReveal.reveal(target)`. Before this fix, ScrollStrip never
    // registered with that broker, so a tab clipped out of the strip's own
    // overflow:hidden port stayed invisible after gaining keyboard focus.
    it('registers as a FocusRevealer, so FocusReveal.reveal scrolls a clipped-out item into view', () => {
        const strip = new ScrollStrip();
        strip.getClipElement(true);
        const item = new Button({ text: 'Z' });
        strip.addItem(item);
        const itemEl = item.getElement(true)!;

        setConnected(strip.getElement(true)!, true);
        setConnected(itemEl, true);

        const rect = (left: number, right: number) =>
            ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0 } as any);

        // Same fixture as the `revealItem` test above: the item sits fully to
        // the right of the clip's own viewport, so the strip must scroll
        // right. The rectangles are staged per element, not by call order:
        // the broker measures the item before the strip measures its clip.
        vi.spyOn(DOM.source, 'getElementRect')
            .mockImplementation(handle => handle === itemEl ? rect(150, 200) : rect(0, 100));

        const before = strip.mainScroll();

        // The strip's first layout pass is still queued, so the broker waits
        // for it and scrolls after it.
        expect(FocusReveal.reveal(itemEl)).toBe(true);
        expect(strip.mainScroll()).toBe(before);

        drainFrames();

        expect(strip.mainScroll()).toBeGreaterThan(before);
    });

    it('getRevealElement returns the strip\'s own element', () => {
        const strip = new ScrollStrip();
        const element = strip.getElement(true);

        expect(strip.getRevealElement()).toBe(element);
    });

    it('getScrollViewportElement returns the clip\'s element, not the strip\'s own', () => {
        // The band element never scrolls and also holds the two arrow
        // buttons; the visible window onto the scrolled items is the clip.
        const strip = new ScrollStrip();
        const element = strip.getElement(true);
        const clipElement = strip.getClipElement();

        expect(clipElement).not.toBeNull();
        expect(strip.getScrollViewportElement()).toBe(clipElement);
        expect(strip.getScrollViewportElement()).not.toBe(element);
    });
});
