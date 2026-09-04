import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Insets } from '~/primitive/Insets';
import { VFlow } from '~/layout/VFlow';
import type { FlowItemAlign } from '~/layout/FlowLayout';
import { FillType } from '~/layout/FillType';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
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

function hostVFlow(width: number, height: number, flow: VFlow): Container {
    const host = new Container({ layoutManager: flow });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('VFlow wrapping geometry (transposed HFlow)', () => {
    afterEach(() => DOM.reset());

    it('flows top-to-bottom and wraps into a new column when the inner height is exceeded', () => {
        installTestDOM(CONFIG);

        // Inner height 100; two 60-tall children cannot share one column.
        const flow = new VFlow({ spacing: 5, lineSpacing: 8 });
        const host = hostVFlow(300, 100, flow);
        const a = new Component({ preferredSize: { width: 20, height: 60 } });
        const b = new Component({ preferredSize: { width: 20, height: 60 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Column 1 child at the top inset; column 2 child wraps to the right.
        expect(a.getX()).toBe(0);
        expect(a.getY()).toBe(0);
        // b wraps into a new column: its x is to the right of a, its y resets to the top inset.
        expect(b.getX()).toBeGreaterThan(a.getX());
        expect(b.getY()).toBe(0);
    });

    it('stacks items in the same column when they fit, advancing y by height + spacing', () => {
        installTestDOM(CONFIG);

        const flow = new VFlow({ spacing: 5 });
        const host = hostVFlow(200, 300, flow);
        const a = new Component({ preferredSize: { width: 20, height: 40 } });
        const b = new Component({ preferredSize: { width: 20, height: 30 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Both fit in column 1: same x, b after a + spacing.
        expect(a.getX()).toBe(b.getX());
        expect(a.getY()).toBe(0);
        expect(b.getY()).toBe(40 + 5);
    });
});

describe('VFlow preferred size', () => {
    afterEach(() => DOM.reset());

    /** Three 20x60 boxes — they wrap to three columns at inner height 100. */
    function threeBoxes(host: Container): Component[] {
        const boxes = [0, 1, 2].map(() => new Component({ preferredSize: { width: 20, height: 60 } }));

        for (const box of boxes) {
            host.addComponent(box);
        }

        return boxes;
    }

    it('reports the wrapped width once a layout has run, and never changes the height', () => {
        installTestDOM(CONFIG);

        const host = hostVFlow(300, 100, new VFlow({ spacing: 5, lineSpacing: 8 }));
        threeBoxes(host);

        // Single-column estimate: widest child 20, 3*60 + 2*5 tall.
        expect(host.getPreferredSize()).toEqual({ width: 20, height: 190 });

        host.doLayout();

        // Three columns of 20 with two 8px line gaps.
        expect(host.getPreferredSize()).toEqual({ width: 3 * 20 + 2 * 8, height: 190 });
    });

    it('reports a width that matches where the children actually end', () => {
        installTestDOM(CONFIG);

        const host  = hostVFlow(300, 100, new VFlow({ spacing: 5, lineSpacing: 8 }));
        const boxes = threeBoxes(host);

        host.doLayout();

        const contentRight = Math.max(...boxes.map(b => b.getX() + b.getWidth()));

        expect(host.getPreferredSize()!.width).toBe(contentRight);
    });

    // The regression guard: a flow that fits in one column must not move.
    it('leaves a single-column flow reporting exactly what it reported before', () => {
        installTestDOM(CONFIG);

        const host = hostVFlow(200, 300, new VFlow({ spacing: 5 }));
        host.addComponent(new Component({ preferredSize: { width: 20, height: 40 } }));
        host.addComponent(new Component({ preferredSize: { width: 30, height: 30 } }));

        expect(host.getPreferredSize()).toEqual({ width: 30, height: 75 });

        host.doLayout();

        expect(host.getPreferredSize()).toEqual({ width: 30, height: 75 });
    });

    it('measures uniform-width columns', () => {
        installTestDOM(CONFIG);

        const host = hostVFlow(300, 60, new VFlow({ uniform: "width", spacing: 5, lineSpacing: 8 }));
        host.addComponent(new Component({ preferredSize: { width: 30, height: 20 } }));
        host.addComponent(new Component({ preferredSize: { width: 50, height: 40 } }));

        expect(host.getPreferredSize()).toEqual({ width: 50, height: 65 });

        host.doLayout();

        // Two uniform 50-wide columns plus one 8px gap.
        expect(host.getPreferredSize()).toEqual({ width: 2 * 50 + 8, height: 65 });
    });

    it('falls back to the single-column estimate before any layout has run', () => {
        installTestDOM(CONFIG);

        const host = new Container({ layoutManager: new VFlow({ spacing: 5, lineSpacing: 8 }) });
        host.getElement(true);
        host.clearInsets();
        threeBoxes(host);

        expect(host.getPreferredSize()).toEqual({ width: 20, height: 190 });
    });

    it('publishes no measurement from a layout at a non-finite height', () => {
        installTestDOM(CONFIG);

        const host = new Container({ layoutManager: new VFlow({ spacing: 5, lineSpacing: 8 }) });
        host.getElement(true);
        host.clearInsets();
        threeBoxes(host);

        // The host was never sized, so getInnerSize() is NaN-tall and every wrap
        // comparison is false. A measurement taken there would be meaningless.
        host.doLayout();

        expect(host.getPreferredSize()).toEqual({ width: 20, height: 190 });

        // The assertion above cannot see the guard on its own: a NaN-height wrap
        // collapses to one bogus column whose width (20) is the same number the
        // single-column fallback returns. What publishing would really cost is
        // the fallback itself — a latched measurement replaces it for good. A
        // wider child moves the estimate, so a stale 20 shows up here.
        host.addComponent(new Component({ preferredSize: { width: 50, height: 60 } }));

        expect(host.getPreferredSize()!.width).toBe(50);
    });

    it('tracks the height: a taller host re-measures to fewer columns', () => {
        installTestDOM(CONFIG);

        const host = hostVFlow(300, 100, new VFlow({ spacing: 5, lineSpacing: 8 }));
        threeBoxes(host);

        host.doLayout();
        expect(host.getPreferredSize()).toEqual({ width: 76, height: 190 });

        host.setHeight(300);
        host.doLayout();

        // All three now fit in one column.
        expect(host.getPreferredSize()).toEqual({ width: 20, height: 190 });
    });

    it('measures a mixed-width column by its widest cell', () => {
        installTestDOM(CONFIG);

        // Every other case here uses three identical 20-wide boxes, so a column
        // width of "widest", "first" or "last" would all read 20. Mixed widths
        // with the widest in the middle separate them.
        const host = hostVFlow(300, 100, new VFlow({ spacing: 5, lineSpacing: 8 }));

        // The widest cell is FIRST in its column, not last: with it last,
        // "widest" and "last" coincide and a broken max would still read 45.
        host.addComponent(new Component({ preferredSize: { width: 45, height: 40 } }));
        host.addComponent(new Component({ preferredSize: { width: 20, height: 40 } }));
        host.addComponent(new Component({ preferredSize: { width: 30, height: 40 } }));

        host.doLayout();

        const kids = host.getComponents();
        const contentRight = Math.max(...kids.map(k => k.getX() + k.getWidth()));

        // Two columns at inner height 100: [40, 40] then [40]. Widths 45 and 30.
        expect(host.getPreferredSize()!.width).toBe(contentRight);
        expect(host.getPreferredSize()!.width).toBe(45 + 8 + 30);
    });

    it('leaves getMinSize unchanged by the measurement', () => {
        installTestDOM(CONFIG);

        const host = hostVFlow(300, 100, new VFlow({ spacing: 5, lineSpacing: 8 }));
        threeBoxes(host);

        const before = host.getMinSize();

        host.doLayout();

        expect(host.getMinSize()).toEqual(before);
    });

    it('measures an empty flow as nothing, not a negative extent', () => {
        installTestDOM(CONFIG);

        // No columns means no gaps. Counting one gap per column boundary
        // regardless would measure an empty flow at minus one lineSpacing.
        const flow = new VFlow({ spacing: 5, lineSpacing: 8 });
        const host = hostVFlow(300, 100, flow);

        host.doLayout();

        // Asked through the manager, not the host: Container floors a negative
        // preferred size at zero, so the host reports 0 either way and cannot
        // tell a measured nothing from a measured -8.
        expect(flow.getPreferredSize()).toEqual({ width: 0, height: 0 });
        expect(host.getPreferredSize()).toEqual({ width: 0, height: 0 });
    });

    it('adds the container perimeter back to the measured width', () => {
        installTestDOM(CONFIG);

        // 7px of vertical padding each side leaves the inner height at the 100
        // that wraps the boxes into three columns; the horizontal padding is
        // deliberately asymmetric so a fix that adds one side twice shows up.
        const host = hostVFlow(300, 114, new VFlow({ spacing: 5, lineSpacing: 8 }));
        host.setPadding(new Insets(7, 12, 7, 10));
        threeBoxes(host);

        host.doLayout();

        expect(host.getPreferredSize()!.width).toBe(3 * 20 + 2 * 8 + 10 + 12);
    });
});

describe('VFlow item alignment within the column', () => {
    afterEach(() => DOM.reset());

    /**
     * A 20-wide and a 60-wide child sharing one column, so the column width is
     * 60 and the narrow child has 40px of slack to be positioned in.
     */
    function mixedColumn(itemAlign: FlowItemAlign): { narrow: Component; wide: Component } {
        const host   = hostVFlow(200, 300, new VFlow({ spacing: 5, itemAlign: itemAlign }));
        const narrow = new Component({ preferredSize: { width: 20, height: 40 } });
        const wide   = new Component({ preferredSize: { width: 60, height: 40 } });

        host.addComponent(narrow);
        host.addComponent(wide);
        host.doLayout();

        return { narrow: narrow, wide: wide };
    }

    it('aligns the narrow child to the leading column edge by default', () => {
        installTestDOM(CONFIG);

        const { narrow, wide } = mixedColumn("start");

        expect(narrow.getX()).toBe(0);
        expect(wide.getX()).toBe(0);
    });

    it('centres the narrow child in the column width', () => {
        installTestDOM(CONFIG);

        const { narrow, wide } = mixedColumn("center");

        // Column width 60 less the 20-wide cell, halved.
        expect(narrow.getX()).toBe(20);
        // The cell that sets the column width has no slack and cannot move.
        expect(wide.getX()).toBe(0);
    });

    it('aligns the narrow child to the trailing column edge', () => {
        installTestDOM(CONFIG);

        const { narrow, wide } = mixedColumn("end");

        // Column width 60 less the 20-wide cell.
        expect(narrow.getX()).toBe(40);
        expect(wide.getX()).toBe(0);
    });

    // VFlow has no shared text baseline, so its baseline arm degrades to "start".
    it('degrades baseline alignment to the leading edge', () => {
        installTestDOM(CONFIG);

        const { narrow, wide } = mixedColumn("baseline");

        expect(narrow.getX()).toBe(0);
        expect(wide.getX()).toBe(0);
    });
});

describe('VFlow per-child cross-axis fill (align-self: stretch)', () => {
    afterEach(() => DOM.reset());

    /**
     * A horizontal rule: 1px tall, no intrinsic width, and a cross-axis
     * (HORIZONTAL) fill constraint — the transpose of HFlow's rule.
     */
    function rule(): { component: Component; constraints: LayoutConstraints } {
        const component = new Component({
            preferredSize: { width: 0, height: 1 },
            minSize:       { width: 0, height: 1 },
            maxSize:       { width: UNBOUNDED, height: 1 },
        });
        const constraints = Object.assign(new LayoutConstraints(), { fill: FillType.HORIZONTAL });

        return { component: component, constraints: constraints };
    }

    it('V1 — a rule child spans its column', () => {
        installTestDOM(CONFIG);

        const host = hostVFlow(300, 200, new VFlow({ spacing: 5 }));
        const a = new Component({ preferredSize: { width: 20, height: 40 } });
        const { component: r, constraints } = rule();
        const c = new Component({ preferredSize: { width: 30, height: 60 } });

        host.addComponent(a);
        host.addComponent(r, constraints);
        host.addComponent(c);
        host.doLayout();

        expect(r.getWidth()).toBe(30);
        expect(r.getX()).toBe(0);
        expect(r.getHeight()).toBe(1);
        expect(r.getY()).toBe(45);
    });

    it('V2 — fill overrides itemAlign for that child only', () => {
        installTestDOM(CONFIG);

        const host = hostVFlow(300, 200, new VFlow({ spacing: 5, itemAlign: 'center' }));
        const a = new Component({ preferredSize: { width: 20, height: 40 } });
        const { component: r, constraints } = rule();
        const c = new Component({ preferredSize: { width: 30, height: 60 } });

        host.addComponent(a);
        host.addComponent(r, constraints);
        host.addComponent(c);
        host.doLayout();

        // A centres in the 30-wide column: (30 - 20) / 2.
        expect(a.getX()).toBe(5);
        expect(r.getX()).toBe(0);
        expect(r.getWidth()).toBe(30);
    });

    it('V3 — an unconstrained child is untouched', () => {
        installTestDOM(CONFIG);

        const host = hostVFlow(300, 200, new VFlow({ spacing: 5 }));
        const a = new Component({ preferredSize: { width: 20, height: 40 } });
        const { component: r } = rule();
        const c = new Component({ preferredSize: { width: 30, height: 60 } });

        host.addComponent(a);
        host.addComponent(r);
        host.addComponent(c);
        host.doLayout();

        expect(r.getWidth()).toBe(0);
    });
});
