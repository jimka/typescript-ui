import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { UNBOUNDED } from '~/primitive/Size';
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

// Fixed header height so every sizing/shrink/fill number below is derived from
// the documented formula (header × displayed + spacing between + open content),
// not sampled from whatever the layout currently emits.
const HEADER = 30;

/** Host Container (clampsToContentSize()===false) with a materialised, sized, inset-cleared element. */
function hostAccordion(width: number, height: number, acc: Accordion): Container {
    const host = new Container({ layoutManager: acc });
    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();
    return host;
}

/** A content component materialised for createSection's element reparent. */
function content(pref: { width: number; height: number }, min?: { width: number; height: number }): Component {
    const c = new Component({ preferredSize: pref });
    if (min) c.setMinSize(min.width, min.height); // setter takes (width, height), not a Size
    c.getElement(true);
    return c;
}

function constraints(label: string, open: boolean, fillWeight?: number): AccordionConstraints {
    const cons = new AccordionConstraints(label, open);
    if (fillWeight !== undefined) cons.fillWeight = fillWeight;
    return cons;
}

afterEach(() => DOM.reset());

describe('Accordion manager — sizing reports', () => {
    it('getPreferredSize sums displayed headers + spacing + open preferred heights (pre-doLayout, via initiallyOpen)', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setSpacing(10);
        const host = hostAccordion(400, 600, acc);

        const a = content({ width: 120, height: 100 });
        const b = content({ width: 200, height: 50 });
        host.addComponent(a, constraints('A', true));  // open
        host.addComponent(b, constraints('B', false)); // closed

        // height = 2 headers + one inter-section gap + A's open content
        const pref = acc.getPreferredSize()!;
        expect(pref.height).toBe(HEADER + 100 + 10 + HEADER); // 170
        // width = widest OPEN section only (B is closed, excluded)
        expect(pref.width).toBe(120);
    });

    it('getPreferredSize reads live open state after doLayout', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setSpacing(10);
        const host = hostAccordion(400, 600, acc);
        host.addComponent(content({ width: 120, height: 100 }), constraints('A', true));
        host.addComponent(content({ width: 80, height: 40 }), constraints('B', false));
        host.doLayout();

        acc.closeSection(0); // now nothing open
        const pref = acc.getPreferredSize()!;
        expect(pref.height).toBe(HEADER + 10 + HEADER); // headers + gap only
        expect(pref.width).toBe(0);                     // no open section contributes width
    });

    it('a non-displayed section contributes neither header nor content nor gap', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setSpacing(10);
        const host = hostAccordion(400, 600, acc);
        const a = content({ width: 100, height: 80 });
        const b = content({ width: 100, height: 60 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        b.setDisplayed(false);

        const pref = acc.getPreferredSize()!;
        // Only A: one header + its content, no gap (single displayed section).
        expect(pref.height).toBe(HEADER + 80);
    });

    it('getMinSize mirrors preferred but floors open content at its own min', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        const host = hostAccordion(400, 600, acc);
        host.addComponent(content({ width: 100, height: 100 }, { width: 40, height: 40 }), constraints('A', true));

        expect(acc.getMinSize()!.height).toBe(HEADER + 40); // header + open min
    });

    it('a closed section contributes only its header height to both reports', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        const host = hostAccordion(400, 600, acc);
        host.addComponent(content({ width: 100, height: 100 }, { width: 40, height: 40 }), constraints('A', false));

        expect(acc.getPreferredSize()!.height).toBe(HEADER);
        expect(acc.getMinSize()!.height).toBe(HEADER);
    });
});

describe('Accordion manager — open/close coordination + events', () => {
    function threeClosed(single: boolean): { acc: Accordion; host: Container } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setSingleOpen(single);
        const host = hostAccordion(400, 600, acc);
        host.addComponent(content({ width: 100, height: 50 }), constraints('A', false));
        host.addComponent(content({ width: 100, height: 50 }), constraints('B', false));
        host.addComponent(content({ width: 100, height: 50 }), constraints('C', false));
        host.doLayout(); // populate _openState
        return { acc, host };
    }

    it('openSection opens and emits sectiontoggle(i, true)', () => {
        const { acc } = threeClosed(false);
        const calls: [number, boolean][] = [];
        acc.on('sectiontoggle', (i, open) => calls.push([i, open]));

        acc.openSection(1);

        expect(acc.isSectionOpen(1)).toBe(true);
        expect(calls).toEqual([[1, true]]);
    });

    it('closeSection closes and emits sectiontoggle(i, false)', () => {
        const { acc } = threeClosed(false);
        acc.openSection(1);
        const calls: [number, boolean][] = [];
        acc.on('sectiontoggle', (i, open) => calls.push([i, open]));

        acc.closeSection(1);

        expect(acc.isSectionOpen(1)).toBe(false);
        expect(calls).toEqual([[1, false]]);
    });

    // A toggle changes the accordion's own preferred/min height, so it must relay
    // an intrinsic-size change up to the host — the hook a scrolling ancestor
    // listens on to refresh its scrollbar. Without it the host only re-lays-out
    // on a later resize, leaving overflowed content clipped (see
    // Component.notifyIntrinsicSizeChanged).
    it('openSection relays an intrinsic-size change to the host', () => {
        const { acc, host } = threeClosed(false);
        const notified = vi.fn();
        (host as unknown as { _onPreferredSizeChange: (() => void) | null })._onPreferredSizeChange = notified;

        acc.openSection(1);

        expect(notified).toHaveBeenCalled();
    });

    it('closeSection relays an intrinsic-size change to the host', () => {
        const { acc, host } = threeClosed(false);
        acc.openSection(1);
        const notified = vi.fn();
        (host as unknown as { _onPreferredSizeChange: (() => void) | null })._onPreferredSizeChange = notified;

        acc.closeSection(1);

        expect(notified).toHaveBeenCalled();
    });

    it('singleOpen: opening a section closes every other open one (others first, target last)', () => {
        const { acc } = threeClosed(true);
        acc.openSection(0);
        const calls: [number, boolean][] = [];
        acc.on('sectiontoggle', (i, open) => calls.push([i, open]));

        acc.openSection(2);

        expect(acc.isSectionOpen(0)).toBe(false);
        expect(acc.isSectionOpen(2)).toBe(true);
        expect(calls).toEqual([[0, false], [2, true]]); // close others, then open target
    });

    it('expandAll opens all in multi mode', () => {
        const { acc } = threeClosed(false);
        acc.expandAll();
        expect([0, 1, 2].map(i => acc.isSectionOpen(i))).toEqual([true, true, true]);
    });

    it('expandAll opens only section 0 in singleOpen mode', () => {
        const { acc } = threeClosed(true);
        acc.expandAll();
        expect([0, 1, 2].map(i => acc.isSectionOpen(i))).toEqual([true, false, false]);
    });

    it('collapseAll closes every section', () => {
        const { acc } = threeClosed(false);
        acc.expandAll();
        acc.collapseAll();
        expect([0, 1, 2].map(i => acc.isSectionOpen(i))).toEqual([false, false, false]);
    });

    it('openSection / closeSection with an out-of-range index is a no-op (no emit, no throw)', () => {
        const { acc } = threeClosed(false);
        const calls: unknown[] = [];
        acc.on('sectiontoggle', (...a) => calls.push(a));

        expect(() => { acc.openSection(99); acc.closeSection(-1); }).not.toThrow();
        expect(calls).toEqual([]);
    });

    it('isSectionOpen(outOfRange) returns false', () => {
        const { acc } = threeClosed(false);
        expect(acc.isSectionOpen(99)).toBe(false);
    });
});

describe('Accordion manager — shrink-ratio geometry', () => {
    // Single open section: header + content budget. pref 200, min 50.
    // totalPreferred = HEADER + 200, totalMin = HEADER + 50.
    function oneOpen(hostHeight: number, fillWeight?: number): { acc: Accordion; a: Component } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        const host = hostAccordion(400, hostHeight, acc);
        const a = content({ width: 100, height: 200 }, { width: 40, height: 50 });
        host.addComponent(a, constraints('A', true, fillWeight));
        host.doLayout();
        return { acc, a };
    }

    it('fits (preferred ≤ budget): ratio 0, section renders at preferred height', () => {
        const { a } = oneOpen(400); // 400 >= HEADER+200 = 230
        expect(a.getHeight()).toBe(200);
    });

    it('overflows within min: shrinks by (preferred − budget)/(preferred − min)', () => {
        // budget 128: totalPreferred 230, totalMin 80. ratio = (230-128)/(230-80)? No —
        // the ratio is over CONTENT: (totalPreferred - budget)/(totalPreferred - totalMin).
        // openContentHeight = pref - ratio*(pref-min).
        const { a } = oneOpen(128);
        const totalPreferred = HEADER + 200;
        const totalMin = HEADER + 50;
        const ratio = (totalPreferred - 128) / (totalPreferred - totalMin);
        expect(a.getHeight()).toBeCloseTo(200 - ratio * (200 - 50), 5);
    });

    it('overflows even at min (budget < min): ratio 0, falls back to preferred (host clips)', () => {
        const { a } = oneOpen(50); // 50 < HEADER+50 = 80
        expect(a.getHeight()).toBe(200);
    });
});

describe('Accordion manager — fill-weight distribution', () => {
    // Two open sections, pref 50 each, HEADER each, spacing 0.
    // used at ratio 0 = 2*HEADER + 100. Host height 200 -> leftover = 200 - (2*30+100) = 40.
    function twoOpen(opts: { aWeight?: number; bWeight?: number; fillHeight?: boolean }): { a: Component; b: Component } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        if (opts.fillHeight) acc.setFillHeight(true);
        const host = hostAccordion(400, 200, acc);
        const a = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true, opts.aWeight));
        host.addComponent(b, constraints('B', true, opts.bWeight));
        host.doLayout();
        return { a, b };
    }

    const LEFTOVER = 200 - (2 * HEADER + 100); // 40

    it('a single weighted section absorbs the entire leftover, regardless of position', () => {
        const { a, b } = twoOpen({ aWeight: 1 }); // A is first, still gets all
        expect(a.getHeight()).toBe(50 + LEFTOVER);
        expect(b.getHeight()).toBe(50);
    });

    it('equal weights split the leftover in proportion (halves)', () => {
        const { a, b } = twoOpen({ aWeight: 1, bWeight: 1 });
        expect(a.getHeight()).toBe(50 + LEFTOVER / 2);
        expect(b.getHeight()).toBe(50 + LEFTOVER / 2);
    });

    it('with no weighted section, setFillHeight spreads the leftover equally across all open sections', () => {
        const { a, b } = twoOpen({ fillHeight: true });
        expect(a.getHeight()).toBe(50 + LEFTOVER / 2);
        expect(b.getHeight()).toBe(50 + LEFTOVER / 2);
    });

    it('on overflow the fill map is empty — shrink and fill never both apply', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        const host = hostAccordion(400, 128, acc); // overflow budget from the shrink suite
        const a = content({ width: 100, height: 200 }, { width: 40, height: 50 });
        host.addComponent(a, constraints('A', true, 1)); // fillWeight set but must be ignored
        host.doLayout();

        const totalPreferred = HEADER + 200;
        const totalMin = HEADER + 50;
        const ratio = (totalPreferred - 128) / (totalPreferred - totalMin);
        expect(a.getHeight()).toBeCloseTo(200 - ratio * (200 - 50), 5); // pure shrink, no fill added
    });
});

describe('Accordion manager — X-only overflow', () => {
    // A narrow observed section (own min 50, so its own min never floors it above
    // the container) plus a wide sibling (min 300) that drives computeTotalMinSize.
    // The observed section's width therefore isolates the manager's inflation from
    // the child's own min-clamp.
    function twoWide(): { acc: Accordion; observed: Component } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        const host = hostAccordion(100, 300, acc); // narrow host
        const observed = content({ width: 50, height: 50 }, { width: 50, height: 10 });
        const wide     = content({ width: 50, height: 50 }, { width: 300, height: 10 }); // drives totalMin width
        host.addComponent(observed, constraints('A', true));
        host.addComponent(wide, constraints('B', true));
        return { acc, observed };
    }

    it('inflates the working width to the total min width when the host marks X overflowing', () => {
        const { acc, observed } = twoWide();
        acc.setOverflowing(true, false);
        acc.getContainer()!.doLayout();
        expect(observed.getWidth()).toBe(300); // inflated to totalMin width (from the wide sibling)
    });

    it('does not inflate — child sits at the container width — when X overflow is off', () => {
        const { acc, observed } = twoWide();
        acc.setOverflowing(false, false);
        acc.getContainer()!.doLayout();
        expect(observed.getWidth()).toBe(100); // container width, not the 300 totalMin
    });
});

describe('Accordion getMaxSize', () => {
    it('reports unbounded on both axes', () => {
        // A height-animated vertical stack has no meaningful static ceiling; the
        // max is deliberately unbounded, keeping min ≤ preferred ≤ max trivially
        // satisfied against the finite min/preferred reports.
        installTestDOM(CONFIG);
        const acc = new Accordion();
        const host = hostAccordion(400, 600, acc);
        host.addComponent(content({ width: 120, height: 100 }), constraints('A', true));

        expect(acc.getMaxSize()).toEqual({ width: UNBOUNDED, height: UNBOUNDED });
    });
});
