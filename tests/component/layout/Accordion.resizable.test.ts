// Resizable-mode tests for Accordion (draggable gutters between open
// sections). Reuses the harness shape from Accordion.manager.test.ts —
// hostAccordion / content / constraints, fixed HEADER. Drag reactivity is
// exercised at the logic level (calling the private drag handlers directly,
// mirroring Split.test.ts's `(split as any).onDragStart(...)` pattern) since
// real pointer/touch events are outside the offline DOM harness — see the
// manual-verify note at the bottom of this file.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Accordion } from '~/layout/Accordion';
import { Fit } from '~/layout/Fit';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
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

// Fixed header height so every sizing number below is derived from the
// documented formula, not sampled from whatever the layout currently emits.
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

describe('Accordion resizable — default off', () => {
    it('doLayout is unchanged from the fillWeight split, and no gutters are created', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        const host = hostAccordion(400, 200, acc);
        const a = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true, 1));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        const leftover = 200 - (2 * HEADER + 100);
        expect(a.getHeight()).toBe(50 + leftover);
        expect(b.getHeight()).toBe(50);
        expect((acc as unknown as { _resizeGutters: unknown[] })._resizeGutters.length).toBe(0);
        expect(acc.isResizable()).toBe(false);
    });
});

describe('Accordion resizable — seed parity with fillWeight', () => {
    it('first resizable doLayout yields the same heights the fillWeight split would', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 200, acc);
        const a = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true, 1));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        const leftover = 200 - (2 * HEADER + 100);
        expect(a.getHeight()).toBeCloseTo(50 + leftover, 5);
        expect(b.getHeight()).toBeCloseTo(50, 5);
    });
});

describe('Accordion resizable — fill invariant', () => {
    function openSections(count: number, hostHeight: number): { acc: Accordion; sections: Component[] } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, hostHeight, acc);
        const sections: Component[] = [];
        for (let i = 0; i < count; i++) {
            const c = content({ width: 100, height: 60 }, { width: 40, height: 10 });
            host.addComponent(c, constraints(`S${i}`, true));
            sections.push(c);
        }
        host.doLayout();
        return { acc, sections };
    }

    for (const count of [1, 2, 3]) {
        it(`open sections' heights sum to the open budget (${count} open)`, () => {
            const hostHeight = 400;
            const { sections } = openSections(count, hostHeight);
            const budget = hostHeight - count * HEADER;
            const sum = sections.reduce((total, c) => total + c.getHeight(), 0);
            expect(sum).toBeCloseTo(budget, 5);
        });
    }
});

describe('Accordion resizable — rescale on container resize', () => {
    it('open heights rescale proportionally, preserving the seeded ratio', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 200, acc);
        const a = content({ width: 100, height: 30 }, { width: 40, height: 5 });
        const b = content({ width: 100, height: 70 }, { width: 40, height: 5 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        const ratioBefore = a.getHeight() / b.getHeight();

        host.setHeight(400);
        host.doLayout();

        const budget = 400 - 2 * HEADER;
        expect(a.getHeight() + b.getHeight()).toBeCloseTo(budget, 5);
        expect(a.getHeight() / b.getHeight()).toBeCloseTo(ratioBefore, 5);
    });
});

describe('Accordion resizable — min floor', () => {
    it('an open section never renders below its minHeight even when the stored ratio would push it lower', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 200, acc);
        const a = content({ width: 100, height: 20 }, { width: 40, height: 80 }); // min > seeded share
        const b = content({ width: 100, height: 130 }, { width: 40, height: 5 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        expect(a.getHeight()).toBeGreaterThanOrEqual(80);
    });
});

describe('Accordion resizable — collapse frees space', () => {
    it('closing a section rescales the others and retains its stored size for reopen', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 300, acc);
        const a = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        const c = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const bHeightBeforeClose = b.getHeight();

        acc.closeSection(1);
        host.doLayout();

        const budgetTwoOpen = 300 - 3 * HEADER; // headers stay fixed; B's header remains visible
        expect(a.getHeight() + c.getHeight()).toBeCloseTo(budgetTwoOpen, 5);

        acc.openSection(1);
        host.doLayout();

        expect(b.getHeight()).toBeCloseTo(bHeightBeforeClose, 0);
    });
});

describe('Accordion resizable — gutter count', () => {
    function visibleGutterCount(acc: Accordion): number {
        const gutters = (acc as unknown as { _resizeGutters: Array<{ isVisible(): boolean }> })._resizeGutters;
        return gutters.filter(g => g.isVisible()).length;
    }

    it('resizable with 3 open sections shows 2 visible gutters', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 400, acc);
        for (let i = 0; i < 3; i++) {
            host.addComponent(content({ width: 100, height: 60 }, { width: 40, height: 10 }), constraints(`S${i}`, true));
        }
        host.doLayout();

        expect(visibleGutterCount(acc)).toBe(2);
    });

    it('non-resizable shows no gutters', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        const host = hostAccordion(400, 400, acc);
        for (let i = 0; i < 3; i++) {
            host.addComponent(content({ width: 100, height: 60 }, { width: 40, height: 10 }), constraints(`S${i}`, true));
        }
        host.doLayout();

        expect(visibleGutterCount(acc)).toBe(0);
    });

    it('singleOpen shows no gutters even when resizable', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        acc.setSingleOpen(true);
        const host = hostAccordion(400, 400, acc);
        for (let i = 0; i < 3; i++) {
            host.addComponent(content({ width: 100, height: 60 }, { width: 40, height: 10 }), constraints(`S${i}`, i === 0));
        }
        host.doLayout();

        expect(visibleGutterCount(acc)).toBe(0);
    });
});

describe('Accordion resizable — prune', () => {
    it('removing a section component drops its stored size on the next layout', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 300, acc);
        const a = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        const sizes = (acc as unknown as { _resizeSizes: Map<Component, number> })._resizeSizes;
        expect(sizes.has(a)).toBe(true);

        host.removeComponent(a);
        host.doLayout();

        expect(sizes.has(a)).toBe(false);
    });
});

describe('Accordion resizable — drag apportionment', () => {
    it('drag trades height between the two adjacent sections, conserving their sum and clamping to [min, max]', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 300, acc);
        const a = content({ width: 100, height: 60 }, { width: 40, height: 20 });
        const b = content({ width: 100, height: 60 }, { width: 40, height: 20 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        const total = a.getHeight() + b.getHeight();
        const aBefore = a.getHeight();
        const bBefore = b.getHeight();

        const accAny = acc as unknown as {
            onGutterDragStart(index: number, position: number): void;
            onGutterDrag(index: number, position: number): void;
        };

        accAny.onGutterDragStart(0, 0);
        accAny.onGutterDrag(0, 30); // drag the boundary 30px down: A grows, B shrinks
        host.doLayout();

        expect(a.getHeight() + b.getHeight()).toBeCloseTo(total, 5);
        expect(a.getHeight()).toBeGreaterThan(aBefore);
        expect(b.getHeight()).toBeLessThan(bBefore);

        // Drag far past B's floor: B clamps at its min, A absorbs the rest.
        accAny.onGutterDragStart(0, 0);
        accAny.onGutterDrag(0, 10000);
        host.doLayout();

        expect(b.getHeight()).toBeCloseTo(20, 5);
        expect(a.getHeight()).toBeCloseTo(total - 20, 5);
    });

    it('with 3+ open sections and no fillWeight (rendered scale != stored scale), a drag conserves the dragged pair\'s sum and leaves the untouched section alone', () => {
        // No fillWeight/fillHeight means the seeded _resizeSizes do not sum to
        // the open budget on their own — computeResizableHeights rescales them
        // by a factor != 1 at render time. onGutterDrag must convert its
        // rendered-pixel drag math back to that stored scale before writing,
        // or the untouched third section drifts too (see the fix commit for
        // "resizable gutter transition lagging" — this pins the companion
        // rendered/stored scale bug found in the same audit pass).
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 300, acc); // budget = 300 - 3*30 = 210
        const a = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        const c = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const cBefore = c.getHeight();
        const pairTotalBefore = a.getHeight() + b.getHeight();

        const accAny = acc as unknown as {
            onGutterDragStart(index: number, position: number): void;
            onGutterDrag(index: number, position: number): void;
            onGutterDragEnd(): void;
        };

        accAny.onGutterDragStart(0, 0); // gutter 0 sits between A and B
        accAny.onGutterDrag(0, 20);
        accAny.onGutterDragEnd();
        host.doLayout();

        expect(a.getHeight() + b.getHeight()).toBeCloseTo(pairTotalBefore, 5);
        expect(c.getHeight()).toBeCloseTo(cBefore, 5);
    });
});

describe('Accordion fill — respects maxSize (non-resizable)', () => {
    it('weighted fill never over-fills a capped section and redistributes the surplus to the other weighted section', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER); // NOT resizable
        const host = hostAccordion(400, 400, acc); // budget = 400 - 2*30 = 340
        const a = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        a.setMaxSize(10000, 100); // cap A's height at 100
        const b = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true, 1)); // fillWeight 1
        host.addComponent(b, constraints('B', true, 1)); // fillWeight 1
        host.doLayout();

        const budget = 400 - 2 * HEADER;
        const wrappers = (acc as unknown as { _panelWrappers: Component[] })._panelWrappers;

        // A's section (wrapper) must not be padded past A's own max.
        expect(wrappers[0].getHeight()).toBeLessThanOrEqual(100 + 1e-6);
        expect(a.getHeight()).toBeCloseTo(100, 5);
        expect(b.getHeight()).toBeCloseTo(240, 5);                    // absorbs A's surplus fill
        expect(a.getHeight() + b.getHeight()).toBeCloseTo(budget, 5); // fill invariant holds
    });

    it('setFillHeight spreads the slack equally across all open sections (unweighted → equal slices)', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setFillHeight(true);
        const host = hostAccordion(400, 400, acc); // budget = 400 - 3*30 = 310
        const a = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        const c = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const budget = 400 - 3 * HEADER; // 310
        // Every open section (all unweighted → equal weight) takes an equal slice
        // of the 160px slack: each ends at 50 + 160/3.
        expect(a.getHeight()).toBeCloseTo(50 + 160 / 3, 4);
        expect(b.getHeight()).toBeCloseTo(50 + 160 / 3, 4);
        expect(c.getHeight()).toBeCloseTo(50 + 160 / 3, 4);
        expect(a.getHeight() + b.getHeight() + c.getHeight()).toBeCloseTo(budget, 4);
    });

    it('setFillHeight caps a section at its max and re-shares the surplus among the other sections', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setFillHeight(true);
        const host = hostAccordion(400, 400, acc); // budget = 400 - 2*30 = 340
        const a = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        b.setMaxSize(10000, 90); // one section capped at 90
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        const budget = 400 - 2 * HEADER; // 340
        const wrappers = (acc as unknown as { _panelWrappers: Component[] })._panelWrappers;

        // B is capped at its max; the surplus it cannot take is re-shared to A
        // (the fill invariant holds), not left as slack.
        expect(wrappers[1].getHeight()).toBeLessThanOrEqual(90 + 1e-6);
        expect(b.getHeight()).toBeCloseTo(90, 5);
        expect(a.getHeight()).toBeCloseTo(budget - 90, 5); // absorbs B's surplus
        expect(a.getHeight() + b.getHeight()).toBeCloseTo(budget, 5);
    });
});

describe('Accordion — resizable/non-resizable size parity', () => {
    /** A Fit container whose own preferred is `pref` but whose *merged* min/max
     *  come from a child — mirroring the demo sections where getPreferredSize
     *  (own-constraint only) disagrees with the merged getMinSize/getMaxSize. */
    function childBoundedSection(pref: number, childMin: number, childMax: number): Container {
        const section = new Container({ preferredSize: { width: 100, height: pref }, layoutManager: new Fit() });
        const child = content({ width: 100, height: pref }, { width: 40, height: childMin });
        child.setMaxSize(10000, childMax);
        section.addComponent(child);
        section.getElement(true);
        return section;
    }

    it('toggling resizable leaves every open section height unchanged, even when a section preferred sits outside its merged [min,max]', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setFillHeight(true); // bottommost (D) absorbs the leftover, like the demo
        const host = hostAccordion(400, 800, acc); // budget = 800 - 5*30 = 650 (underflow: D fills)
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        // C mirrors Recent Items: preferred 150 but merged max 142 (capped child).
        const c = childBoundedSection(150, 10, 142);
        // E mirrors Personal Info: preferred 100 but merged min 130 (child floor).
        const e = childBoundedSection(100, 130, 10000);
        const b = content({ width: 100, height: 110 }, { width: 40, height: 10 });
        const d = content({ width: 100, height: 86 }, { width: 40, height: 10 });
        expect(c.getPreferredSize()?.height).toBe(150); // own preferred, unclamped by child
        expect(c.getMaxSize()?.height).toBe(142);       // merged max from the capped child
        expect(e.getPreferredSize()?.height).toBe(100); // own preferred, unclamped by child
        expect(e.getMinSize()?.height).toBe(130);       // merged min from the child floor
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.addComponent(e, constraints('E', true));
        host.addComponent(d, constraints('D', true));

        // Measure the wrappers (the visible section regions), not the content
        // components: a content component self-clamps its own height via setHeight,
        // so it reads the same in both modes, but the wrapper renders whatever
        // height the layout asked for — the mismatch is the on-screen toggle glitch.
        const wrappers = (acc as unknown as { _panelWrappers: Component[] })._panelWrappers;

        host.doLayout(); // non-resizable
        const off = wrappers.map(w => w.getHeight());

        acc.setResizable(true);
        host.doLayout(); // resizable
        const on = wrappers.map(w => w.getHeight());

        acc.setResizable(false);
        host.doLayout(); // back to non-resizable
        const offAgain = wrappers.map(w => w.getHeight());

        // Both modes respect the merged bounds: C never renders past its max (142;
        // its max headroom is 0 so fill can't grow it), E never below its min (130,
        // though setFillHeight's spread-all lets it grow above that) ...
        expect(off[2]).toBeCloseTo(142, 5);
        expect(off[3]).toBeGreaterThanOrEqual(130 - 1e-6);
        // ... and toggling resizable is a no-op for every section.
        for (let i = 0; i < off.length; i++) {
            expect(on[i]).toBeCloseTo(off[i], 5);
            expect(offAgain[i]).toBeCloseTo(off[i], 5);
        }
        // Sanity: the open heights fill the budget in both modes.
        expect(off.reduce((s, h) => s + h, 0)).toBeCloseTo(650, 4);
        expect(on.reduce((s, h) => s + h, 0)).toBeCloseTo(650, 4);
    });
});

describe('Accordion resizable — [min,max] constraints in the distribution', () => {
    type Sizes = { _resizeSizes: Map<Component, number> };

    it('never allocates an open section more than its maxSize, redistributing the surplus', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 600, acc); // budget = 600 - 2*30 = 540
        const a = content({ width: 100, height: 80 }, { width: 40, height: 10 });
        a.setMaxSize(10000, 100); // cap A's height at 100 (width left unbounded)
        const b = content({ width: 100, height: 80 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        const budget = 600 - 2 * HEADER;
        expect(a.getHeight()).toBeLessThanOrEqual(100 + 1e-6); // never stretched past max
        expect(a.getHeight()).toBeCloseTo(100, 5);             // capped at max
        expect(b.getHeight()).toBeCloseTo(budget - 100, 5);    // B absorbs the surplus
        expect(a.getHeight() + b.getHeight()).toBeCloseTo(budget, 5); // fill invariant holds
    });

    it('redistributes a min floor so open heights still sum to the budget (no overflow past the box)', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 260, acc); // budget = 260 - 2*30 = 200
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 60 }, { width: 40, height: 60 }); // min height 60
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.doLayout();

        // Simulate A having absorbed most of the space into its stored size — as
        // fill does when the accordion underflowed before the container shrank.
        // B's rescaled share now falls below its own min, forcing a floor.
        const sizes = (acc as unknown as Sizes)._resizeSizes;
        sizes.set(a, 1000);
        sizes.set(b, 20);
        host.doLayout();

        const budget = 260 - 2 * HEADER; // 200
        expect(b.getHeight()).toBeCloseTo(60, 5);              // B floored to its min
        expect(a.getHeight()).toBeCloseTo(budget - 60, 5);     // A gives up the excess
        expect(a.getHeight() + b.getHeight()).toBeCloseTo(budget, 5); // sum stays == budget
    });
});

describe('Accordion resizable — drag growth chains past maxed sections', () => {
    type Drag = {
        onGutterDragStart(index: number, position: number): void;
        onGutterDrag(index: number, position: number): void;
    };

    /** Three open sections A/B/C at 100px each (budget 300), with B pinned at its max. */
    function threeWithMaxedMiddle(): { acc: Accordion; a: Component; b: Component; c: Component } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 390, acc); // budget = 390 - 3*30 = 300
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        b.setMaxSize(10000, 100); // B cannot grow past 100 (its current height)
        const c = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();
        return { acc, a, b, c };
    }

    it('shrinking the bottom section grows the section above the maxed middle one', () => {
        const { acc, a, b, c } = threeWithMaxedMiddle();
        const drag = acc as unknown as Drag;

        drag.onGutterDragStart(1, 0); // gutter between B and C
        drag.onGutterDrag(1, 30);     // pull down 30: C shrinks, B is maxed → A grows

        expect(c.getHeight()).toBeCloseTo(70, 5);
        expect(b.getHeight()).toBeCloseTo(100, 5);   // maxed middle unchanged
        expect(a.getHeight()).toBeCloseTo(130, 5);   // grows past the maxed B
        expect(a.getHeight() + b.getHeight() + c.getHeight()).toBeCloseTo(300, 5);
    });

    it('shrinking the top section grows the section below the maxed middle one', () => {
        const { acc, a, b, c } = threeWithMaxedMiddle();
        const drag = acc as unknown as Drag;

        drag.onGutterDragStart(0, 0); // gutter between A and B
        drag.onGutterDrag(0, -30);    // pull up 30: A shrinks, B is maxed → C grows

        expect(a.getHeight()).toBeCloseTo(70, 5);
        expect(b.getHeight()).toBeCloseTo(100, 5);   // maxed middle unchanged
        expect(c.getHeight()).toBeCloseTo(130, 5);   // grows past the maxed B
        expect(a.getHeight() + b.getHeight() + c.getHeight()).toBeCloseTo(300, 5);
    });

    /** Three open sections A/B/C at 100px each (budget 300), with B pinned at its min. */
    function threeWithMinnedMiddle(): { acc: Accordion; a: Component; b: Component; c: Component } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 390, acc); // budget = 300
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 100 }, { width: 40, height: 100 }); // min == current: cannot shrink
        const c = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();
        return { acc, a, b, c };
    }

    it('expanding the bottom section shrinks the section above the minned middle one', () => {
        const { acc, a, b, c } = threeWithMinnedMiddle();
        const drag = acc as unknown as Drag;

        drag.onGutterDragStart(1, 0); // gutter between B and C
        drag.onGutterDrag(1, -30);    // pull up 30: C grows, B is minned → A shrinks

        expect(c.getHeight()).toBeCloseTo(130, 5);
        expect(b.getHeight()).toBeCloseTo(100, 5);   // minned middle unchanged
        expect(a.getHeight()).toBeCloseTo(70, 5);    // shrinks past the minned B
        expect(a.getHeight() + b.getHeight() + c.getHeight()).toBeCloseTo(300, 5);
    });

    it('expanding the top section shrinks the section below the minned middle one', () => {
        const { acc, a, b, c } = threeWithMinnedMiddle();
        const drag = acc as unknown as Drag;

        drag.onGutterDragStart(0, 0); // gutter between A and B
        drag.onGutterDrag(0, 30);     // pull down 30: A grows, B is minned → C shrinks

        expect(a.getHeight()).toBeCloseTo(130, 5);
        expect(b.getHeight()).toBeCloseTo(100, 5);   // minned middle unchanged
        expect(c.getHeight()).toBeCloseTo(70, 5);    // shrinks past the minned B
        expect(a.getHeight() + b.getHeight() + c.getHeight()).toBeCloseTo(300, 5);
    });

    it('reversing a drag restores the closest section first, not the furthest', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 390, acc); // budget = 300
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 100 }, { width: 40, height: 50 }); // min 50
        const c = content({ width: 100, height: 100 }, { width: 40, height: 10 }); // min 10
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const drag = acc as unknown as Drag;
        drag.onGutterDragStart(0, 0); // gutter between A and B
        drag.onGutterDrag(0, 80);     // expand A down 80: B shrinks to its min, then C shrinks

        expect(b.getHeight()).toBeCloseTo(50, 5); // B at its min
        expect(c.getHeight()).toBeCloseTo(70, 5); // C took the overflow

        // Reverse toward the start: the closest section (B) must grow back first,
        // leaving the furthest (C) untouched until B is restored.
        drag.onGutterDrag(0, 50); // frameDelta -30

        expect(b.getHeight()).toBeCloseTo(80, 5);  // closest grows first
        expect(c.getHeight()).toBeCloseTo(70, 5);  // furthest untouched
        expect(a.getHeight()).toBeCloseTo(150, 5);
    });

    it('reversing a drag lets the closest section absorb the travel (no rewind to origin)', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 390, acc); // budget = 300
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 100 }, { width: 40, height: 50 });
        const c = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const drag = acc as unknown as Drag;
        drag.onGutterDragStart(0, 0);
        drag.onGutterDrag(0, 80); // expand A: B -> min 50, C -> 70
        drag.onGutterDrag(0, 0);  // reverse the pointer all the way back to the start

        // The drag keeps no memory of the start heights, so reversing simply moves
        // the boundary the other way: the section nearest the gutter (B) absorbs all
        // the returning travel, growing past its start height, while C stays where the
        // forward drag left it. A "rewind to origin" (A=B=C=100) is explicitly wrong.
        expect(a.getHeight()).toBeCloseTo(100, 5); // A back to its start (the gutter returned)
        expect(b.getHeight()).toBeCloseTo(130, 5); // closest section absorbs the reversal
        expect(c.getHeight()).toBeCloseTo(70, 5);  // furthest section untouched on the way back
    });

    it('reversing an upper-group drag grows the closest section, not the furthest (no rewind)', () => {
        // Mirror of the closest-first case on the UPPER chain: expand the bottom
        // section upward so the sections ABOVE it shrink, then reverse mid-motion.
        // Reproduces the AccordionDemoPanel report (expand About up -> Recent to min,
        // Preferences shrinks; reversing must grow Recent first, not Preferences).
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 390, acc); // budget = 300
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 }); // Preferences (top)
        const b = content({ width: 100, height: 100 }, { width: 40, height: 50 }); // Recent (min 50)
        const c = content({ width: 100, height: 100 }, { width: 40, height: 10 }); // About (bottom)
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const drag = acc as unknown as Drag;
        drag.onGutterDragStart(1, 0); // gutter between B (Recent) and C (About)
        drag.onGutterDrag(1, -80);    // expand About up 80: Recent -> min 50, then Preferences shrinks

        expect(b.getHeight()).toBeCloseTo(50, 5);  // Recent at its min
        expect(a.getHeight()).toBeCloseTo(70, 5);  // Preferences took the overflow
        expect(c.getHeight()).toBeCloseTo(180, 5);

        drag.onGutterDrag(1, -20); // reverse by 60 in the same motion

        expect(b.getHeight()).toBeCloseTo(110, 5); // Recent (closest) absorbs the reversal
        expect(a.getHeight()).toBeCloseTo(70, 5);  // Preferences (furthest) untouched — no rewind
        expect(c.getHeight()).toBeCloseTo(120, 5);
    });

    it('overshooting a fully-exhausted chain leaves a dead zone the pointer must retrace before the gutter moves', () => {
        // Split/Border keep the handle glued to the cursor by clamping an absolute
        // origin+offset; the incremental chain reproduces that by advancing its
        // tracked pointer only by the travel actually applied. Overshoot past a
        // maxed/minned chain is retained, so reversing does nothing until the
        // pointer retraces the overshoot back to where the chain hit its limit.
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 390, acc); // budget = 300
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const c = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const drag = acc as unknown as Drag;
        drag.onGutterDragStart(0, 0);
        drag.onGutterDrag(0, 180); // expand A fully: B and C both bottom out at min 10
        expect(a.getHeight()).toBeCloseTo(280, 5);
        expect(b.getHeight()).toBeCloseTo(10, 5);
        expect(c.getHeight()).toBeCloseTo(10, 5);

        drag.onGutterDrag(0, 250); // overshoot far past the limit — nothing left to give
        expect(a.getHeight()).toBeCloseTo(280, 5);

        drag.onGutterDrag(0, 240); // reverse, but still inside the dead zone → no movement
        expect(a.getHeight()).toBeCloseTo(280, 5);

        drag.onGutterDrag(0, 150); // pointer retraces past the limit point (180) → gutter moves 30
        expect(a.getHeight()).toBeCloseTo(250, 5);
        expect(b.getHeight()).toBeCloseTo(40, 5);
        expect(c.getHeight()).toBeCloseTo(10, 5);
    });

    it('a drag with no maxed neighbour still trades only with the immediate section', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 390, acc);
        const a = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        const c = content({ width: 100, height: 100 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const drag = acc as unknown as Drag;
        drag.onGutterDragStart(1, 0); // gutter between B and C
        drag.onGutterDrag(1, 30);     // B not maxed → B grows, C shrinks, A untouched

        expect(a.getHeight()).toBeCloseTo(100, 5); // outside the pair, untouched
        expect(b.getHeight()).toBeCloseTo(130, 5);
        expect(c.getHeight()).toBeCloseTo(70, 5);
    });
});

describe('Accordion resizable — lightweight drag path', () => {
    type DragInternals = {
        onGutterDragStart(index: number, position: number): void;
        onGutterDrag(index: number, position: number): void;
        _resizeGutters: Array<{ getY(): number; isVisible(): boolean }>;
        _headers: Component[];
        _panelWrappers: Component[];
    };

    /** Build a resizable accordion with `count` open sections and lay it out once. */
    function openLayout(count: number, hostHeight: number, min = 10): { acc: Accordion; host: Container; sections: Component[] } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, hostHeight, acc);
        const sections: Component[] = [];
        for (let i = 0; i < count; i++) {
            const c = content({ width: 100, height: 60 }, { width: 40, height: min });
            host.addComponent(c, constraints(`S${i}`, true));
            sections.push(c);
        }
        host.doLayout();
        return { acc, host, sections };
    }

    it('a drag updates the pair directly, without running a full container relayout', () => {
        const { acc, host, sections: [a, b] } = openLayout(2, 300, 20);
        const drag = acc as unknown as DragInternals;

        const aBefore = a.getHeight();
        const bBefore = b.getHeight();
        const total = aBefore + bBefore;

        const doLayoutSpy = vi.spyOn(host, 'doLayout');

        drag.onGutterDragStart(0, 0);
        drag.onGutterDrag(0, 30); // boundary 30px down: A grows, B shrinks

        // The lightweight path writes only the dragged band — no full relayout.
        expect(doLayoutSpy).not.toHaveBeenCalled();
        expect(a.getHeight()).toBeGreaterThan(aBefore);
        expect(b.getHeight()).toBeLessThan(bBefore);
        expect(a.getHeight() + b.getHeight()).toBeCloseTo(total, 5);
    });

    it('conserves the pair sum across a range of deltas', () => {
        const { acc, sections: [a, b] } = openLayout(2, 300, 20);
        const drag = acc as unknown as DragInternals;
        const total = a.getHeight() + b.getHeight();

        for (const delta of [-40, 15, 30, 8]) {
            drag.onGutterDragStart(0, 0);
            drag.onGutterDrag(0, delta);
            expect(a.getHeight() + b.getHeight()).toBeCloseTo(total, 5);
        }
    });

    it('clamps the lower section at its min on the direct-write path', () => {
        const { acc, sections: [a, b] } = openLayout(2, 300, 20);
        const drag = acc as unknown as DragInternals;
        const total = a.getHeight() + b.getHeight();

        drag.onGutterDragStart(0, 0);
        drag.onGutterDrag(0, 10000); // far past B's floor

        expect(b.getHeight()).toBeCloseTo(20, 5);
        expect(a.getHeight()).toBeCloseTo(total - 20, 5);
    });

    it('keeps the boundary gutter glued to the new content bottom', () => {
        const { acc, sections: [a] } = openLayout(2, 300, 20);
        const drag = acc as unknown as DragInternals;

        drag.onGutterDragStart(0, 0);
        drag.onGutterDrag(0, 25);

        const gutter = drag._resizeGutters[0];
        const upperWrapper = drag._panelWrappers[0];
        expect(gutter.getY()).toBeCloseTo(upperWrapper.getY() + a.getHeight() - 6, 5); // RESIZE_GUTTER_SIZE = 6
    });

    it('leaves sections outside the dragged pair untouched', () => {
        const { acc, sections: [, , c] } = openLayout(3, 300);
        const drag = acc as unknown as DragInternals;

        const cHeightBefore = c.getHeight();
        const cHeaderYBefore = drag._headers[2].getY();

        drag.onGutterDragStart(0, 0); // gutter 0 = A/B boundary
        drag.onGutterDrag(0, 20);

        expect(c.getHeight()).toBeCloseTo(cHeightBefore, 5);
        expect(drag._headers[2].getY()).toBeCloseTo(cHeaderYBefore, 5);
    });

    it('slides a displayed closed section that sits between the dragged pair', () => {
        // A open, B closed, C open → gutter 0's pair is {upper: A, lower: C},
        // spanning the closed B. Growing A must push B's header (and C) down.
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 300, acc);
        const a = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        const c = content({ width: 100, height: 60 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', false)); // closed, but displayed
        host.addComponent(c, constraints('C', true));
        host.doLayout();

        const drag = acc as unknown as DragInternals;
        const bHeaderYBefore = drag._headers[1].getY();
        const aBefore = a.getHeight();
        const pairTotal = a.getHeight() + c.getHeight();

        drag.onGutterDragStart(0, 0);
        drag.onGutterDrag(0, 20);

        const delta = a.getHeight() - aBefore;
        expect(drag._headers[1].getY()).toBeCloseTo(bHeaderYBefore + delta, 5);
        expect(a.getHeight() + c.getHeight()).toBeCloseTo(pairTotal, 5);
    });

    it('a full doLayout after a drag preserves the dragged ratio', () => {
        const { acc, host, sections: [a, b] } = openLayout(2, 300, 20);
        const drag = acc as unknown as DragInternals;

        drag.onGutterDragStart(0, 0);
        drag.onGutterDrag(0, 40);

        const ratio = a.getHeight() / b.getHeight();

        host.doLayout();

        expect(a.getHeight() / b.getHeight()).toBeCloseTo(ratio, 5);
        expect(a.getHeight() + b.getHeight()).toBeCloseTo(300 - 2 * HEADER, 5);
    });
});

describe('Accordion resizable — teardown', () => {
    type DragTeardown = {
        onGutterDragStart(index: number, position: number): void;
        detach(): void;
        _dragUpper: Component | null;
        _dragLower: Component | null;
    };

    it('detaching mid-drag ends the in-flight drag (clears the drag pair)', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 300, acc);
        host.addComponent(content({ width: 100, height: 60 }, { width: 40, height: 10 }), constraints('A', true));
        host.addComponent(content({ width: 100, height: 60 }, { width: 40, height: 10 }), constraints('B', true));
        host.doLayout();

        const drag = acc as unknown as DragTeardown;
        drag.onGutterDragStart(0, 0); // begins a drag: captures the pair + registers viewport listeners
        expect(drag._dragUpper).not.toBeNull();

        drag.detach(); // detaching mid-drag must end the drag, not strand it

        expect(drag._dragUpper).toBeNull();
        expect(drag._dragLower).toBeNull();
    });
});

describe('Accordion transitions — off by default (snap on relayout)', () => {
    type WithSections = { _headers: Component[]; _panelWrappers: Component[] };

    function build(): { acc: Accordion; host: Container; a: Component; b: Component } {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        const host = hostAccordion(400, 200, acc);
        const a = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        const b = content({ width: 100, height: 50 }, { width: 40, height: 10 });
        host.addComponent(a, constraints('A', true));
        host.addComponent(b, constraints('B', true));
        host.doLayout();
        return { acc, host, a, b };
    }

    it('sections carry no CSS transition after their first layout', () => {
        const { acc, a, b } = build();
        const internals = acc as unknown as WithSections;

        for (const header of internals._headers) {
            expect(header.getTransition()).toBe('none');
        }

        for (const wrapper of internals._panelWrappers) {
            expect(wrapper.getTransition()).toBe('none');
        }

        expect(a.getTransition()).toBe('none');
        expect(b.getTransition()).toBe('none');
    });

    it('a container resize relayout leaves transitions off (so it snaps, not animates)', () => {
        const { acc, host, a, b } = build();

        host.setHeight(400);
        host.doLayout();

        const internals = acc as unknown as WithSections;

        for (const header of internals._headers) {
            expect(header.getTransition()).toBe('none');
        }

        for (const wrapper of internals._panelWrappers) {
            expect(wrapper.getTransition()).toBe('none');
        }

        expect(a.getTransition()).toBe('none');
        expect(b.getTransition()).toBe('none');
    });

    it('a resizable gutter carries no CSS transition by default', () => {
        installTestDOM(CONFIG);
        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);
        const host = hostAccordion(400, 400, acc);
        for (let i = 0; i < 3; i++) {
            host.addComponent(content({ width: 100, height: 60 }, { width: 40, height: 10 }), constraints(`S${i}`, true));
        }
        host.doLayout();

        const gutters = (acc as unknown as { _resizeGutters: Component[] })._resizeGutters;
        for (const gutter of gutters.filter(g => (g as unknown as { isVisible(): boolean }).isVisible())) {
            expect(gutter.getTransition()).toBe('none');
        }
    });

    it('an open/close toggle enables the wrapper transition for the animation', () => {
        const { acc, a } = build();
        const internals = acc as unknown as WithSections & { onHeaderClicked(i: number): void };

        // Close section A: primeWrapper must turn its wrapper transition on so
        // the height animation runs (transitions are otherwise off).
        internals.onHeaderClicked(0);

        expect(internals._panelWrappers[0].getTransition()).not.toBe('none');
        expect(internals._panelWrappers[0].getTransition()).toContain('height');
        expect(a.getTransition()).toContain('height');
    });
});

// Manual verification (not exercisable by the DOM test harness — see
// plans/implemented/accordion-resizable-sections.md "Expected Behaviour"):
//   - Real pointer/touch drag on the boundary shows the ns-resize cursor,
//     resizes live without lag, and does not toggle the sections.
//   - On open/close the gutter slides with the boundary (its `top`
//     transition) rather than snapping.
//   - document.body pointer-events are restored after a drag (no stuck cursor).
//   - Ground truth in the app: sqladmin TreeExplorerView — out of scope for
//     this plan (see Non-Goals), left for a downstream adoption pass.
