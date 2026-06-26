import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { Panel } from '~/core/Panel';
import { Button } from '~/component/button/Button';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
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

// Mirrored ONLY to derive expected relations: SCROLL_ARROW_SIZE is the per-end
// gutter ScrollStrip reserves on overflow. The slop-boundary tests assert the
// reserve equals this value (or 0), not the literal as an opaque golden.
const SCROLL_ARROW_SIZE = 24;

beforeEach(() => {
    installTestDOM(CONFIG);
});

afterEach(() => DOM.reset());

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
