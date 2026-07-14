// Resizable-mode tests for Accordion (draggable gutters between open
// sections). Reuses the harness shape from Accordion.manager.test.ts —
// hostAccordion / content / constraints, fixed HEADER. Drag reactivity is
// exercised at the logic level (calling the private drag handlers directly,
// mirroring Split.test.ts's `(split as any).onDragStart(...)` pattern) since
// real pointer/touch events are outside the offline DOM harness — see the
// manual-verify note at the bottom of this file.
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Accordion } from '~/layout/Accordion';
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

// Manual verification (not exercisable by the DOM test harness — see
// plans/implemented/accordion-resizable-sections.md "Expected Behaviour"):
//   - Real pointer/touch drag on the boundary shows the ns-resize cursor,
//     resizes live without lag, and does not toggle the sections.
//   - On open/close the gutter slides with the boundary (its `top`
//     transition) rather than snapping.
//   - document.body pointer-events are restored after a drag (no stuck cursor).
//   - Ground truth in the app: sqladmin TreeExplorerView — out of scope for
//     this plan (see Non-Goals), left for a downstream adoption pass.
