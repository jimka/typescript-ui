import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Insets } from '~/primitive/Insets';
import { HFlow } from '~/layout/HFlow';
import type { FlowItemAlign } from '~/layout/FlowLayout';
import { VBox } from '~/layout/VBox';
import { FillType } from '~/layout/FillType';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { UNBOUNDED } from '~/primitive/Size';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import { expectNoSelfReschedule } from '../../helpers/layoutStability';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function hostHFlow(width: number, height: number, flow: HFlow): Container {
    const host = new Container({ layoutManager: flow });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('HFlow wrapping geometry', () => {
    afterEach(() => DOM.reset());

    it('flows left-to-right and wraps to a new row when the inner width is exceeded', () => {
        installTestDOM(CONFIG);

        // Inner width 100; three 60-wide children cannot fit on one row.
        const flow = new HFlow({ spacing: 5, lineSpacing: 8 });
        const host = hostHFlow(100, 300, flow);
        const a = new Component({ preferredSize: { width: 60, height: 20 } });
        const b = new Component({ preferredSize: { width: 60, height: 20 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Row 1 child starts at the left inset (0); row 2 child wraps below it.
        expect(a.getX()).toBe(0);
        expect(a.getY()).toBe(0);
        // b did not fit on row 1, so it wraps: its y is below a, its x resets to the left inset.
        expect(b.getY()).toBeGreaterThan(a.getY());
        expect(b.getX()).toBe(0);
    });

    it('keeps items on the same row when they fit, advancing x by width + spacing', () => {
        installTestDOM(CONFIG);

        const flow = new HFlow({ spacing: 5 });
        const host = hostHFlow(300, 200, flow);
        const a = new Component({ preferredSize: { width: 40, height: 20 } });
        const b = new Component({ preferredSize: { width: 30, height: 20 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Both fit on row 1: same y, b after a + spacing.
        expect(a.getY()).toBe(b.getY());
        expect(a.getX()).toBe(0);
        expect(b.getX()).toBe(40 + 5);
    });

    it('uniform "width" gives differently-sized children equal placed widths', () => {
        installTestDOM(CONFIG);

        const flow = new HFlow({ uniform: 'width' });
        const host = hostHFlow(300, 200, flow);
        const a = new Component({ preferredSize: { width: 30, height: 20 } });
        const b = new Component({ preferredSize: { width: 50, height: 20 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Both cells take the widest child's width (50). Flow never resizes the
        // child itself, but the cell partition advances by the uniform width, so
        // b sits at the uniform cell stride from a.
        expect(b.getX()).toBe(50 + flow.getComponentSpacing());
    });
});

describe('FlowLayout.clampedPreferredSize clamp ordering', () => {
    afterEach(() => DOM.reset());

    it('honours the minimum over a smaller maximum, so a later sibling does not overlap (degenerate min > max)', () => {
        installTestDOM(CONFIG);

        const flow = new HFlow();
        const host = hostHFlow(400, 300, flow);
        const stage = new Component({ preferredSize: { width: 50, height: 50 } });
        stage.setMinSize({ width: 120, height: 120 });
        stage.setMaxSize({ width: 47, height: 47 });
        const toggle = new Component({ preferredSize: { width: 30, height: 20 } });

        host.addComponent(stage);
        host.addComponent(toggle);
        host.doLayout();

        // The stage's own committed size always lands on its min (120x120)
        // once Component.setWidth/setHeight's own clamp reasserts it — that
        // step alone doesn't distinguish the bug from the fix.
        expect(stage.getWidth()).toBe(120);
        expect(stage.getHeight()).toBe(120);

        // What DOES distinguish them: the row must reserve the stage's full
        // min width (the cell FlowLayout.clampedPreferredSize computes) before
        // advancing to the next child, not the smaller (wrong) max. Before the
        // fix, the toggle lands at 47 + spacing, overlapping the stage.
        expect(toggle.getX()).toBe(120 + flow.getComponentSpacing());
    });
});

describe('HFlow preferred size', () => {
    afterEach(() => DOM.reset());

    /** Three 60x20 boxes — they wrap to three rows at inner width 100, one row at 300. */
    function threeBoxes(host: Container): Component[] {
        const boxes = [0, 1, 2].map(() => new Component({ preferredSize: { width: 60, height: 20 } }));

        for (const box of boxes) {
            host.addComponent(box);
        }

        return boxes;
    }

    it('reports the wrapped height once a layout has run, and never changes the width', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(100, 300, new HFlow({ spacing: 5, lineSpacing: 8 }));
        threeBoxes(host);

        // Single-line estimate before any layout: 3*60 + 2*5 wide, one 20-high row.
        expect(host.getPreferredSize()).toEqual({ width: 190, height: 20 });

        host.doLayout();

        // Three rows of 20 with two 8px line gaps.
        expect(host.getPreferredSize()).toEqual({ width: 190, height: 3 * 20 + 2 * 8 });
    });

    it('reports a height that matches where the children actually end', () => {
        installTestDOM(CONFIG);

        const host  = hostHFlow(100, 300, new HFlow({ spacing: 5, lineSpacing: 8 }));
        const boxes = threeBoxes(host);

        host.doLayout();

        const contentBottom = Math.max(...boxes.map(b => b.getY() + b.getHeight()));

        expect(host.getPreferredSize()!.height).toBe(contentBottom);
    });

    // The regression guard: a flow that fits on one line must not move.
    it('leaves a single-line flow reporting exactly what it reported before', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(300, 200, new HFlow({ spacing: 5 }));
        host.addComponent(new Component({ preferredSize: { width: 40, height: 20 } }));
        host.addComponent(new Component({ preferredSize: { width: 30, height: 20 } }));

        expect(host.getPreferredSize()).toEqual({ width: 75, height: 20 });

        host.doLayout();

        expect(host.getPreferredSize()).toEqual({ width: 75, height: 20 });
    });

    it('measures uniform-height rows', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(60, 300, new HFlow({ uniform: "height", spacing: 5, lineSpacing: 8 }));
        host.addComponent(new Component({ preferredSize: { width: 30, height: 20 } }));
        host.addComponent(new Component({ preferredSize: { width: 50, height: 40 } }));

        expect(host.getPreferredSize()).toEqual({ width: 85, height: 40 });

        host.doLayout();

        // Two uniform 40-high rows plus one 8px gap.
        expect(host.getPreferredSize()).toEqual({ width: 85, height: 2 * 40 + 8 });
    });

    it('measures uniform-width rows', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(100, 300, new HFlow({ uniform: "width", spacing: 5, lineSpacing: 8 }));
        host.addComponent(new Component({ preferredSize: { width: 30, height: 20 } }));
        host.addComponent(new Component({ preferredSize: { width: 50, height: 20 } }));
        host.addComponent(new Component({ preferredSize: { width: 20, height: 20 } }));

        expect(host.getPreferredSize()).toEqual({ width: 160, height: 20 });

        host.doLayout();

        expect(host.getPreferredSize()).toEqual({ width: 160, height: 3 * 20 + 2 * 8 });
    });

    it('falls back to the single-line estimate before any layout has run', () => {
        installTestDOM(CONFIG);

        const host = new Container({ layoutManager: new HFlow({ spacing: 5, lineSpacing: 8 }) });
        host.getElement(true);
        host.clearInsets();
        threeBoxes(host);

        expect(host.getPreferredSize()).toEqual({ width: 190, height: 20 });
    });

    it('publishes no measurement from a layout at a non-finite width', () => {
        installTestDOM(CONFIG);

        const host = new Container({ layoutManager: new HFlow({ spacing: 5, lineSpacing: 8 }) });
        host.getElement(true);
        host.clearInsets();
        threeBoxes(host);

        // The host was never sized, so getInnerSize() is NaN-wide and every wrap
        // comparison is false. A measurement taken there would be meaningless.
        host.doLayout();

        expect(host.getPreferredSize()).toEqual({ width: 190, height: 20 });

        // The assertion above cannot see the guard on its own: a NaN-width wrap
        // collapses to one bogus row whose height (20) is the same number the
        // single-line fallback returns. What publishing would really cost is the
        // fallback itself — a latched measurement replaces it for good. Adding a
        // taller child moves the estimate, so a stale 20 shows up here.
        host.addComponent(new Component({ preferredSize: { width: 60, height: 40 } }));

        expect(host.getPreferredSize()!.height).toBe(40);
    });

    it('tracks the width: a wider host re-measures to fewer rows', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(100, 300, new HFlow({ spacing: 5, lineSpacing: 8 }));
        threeBoxes(host);

        host.doLayout();
        expect(host.getPreferredSize()).toEqual({ width: 190, height: 76 });

        host.setWidth(300);
        host.doLayout();

        // All three now fit on one row.
        expect(host.getPreferredSize()).toEqual({ width: 190, height: 20 });
    });

    it('leaves getMinSize unchanged by the measurement', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(100, 300, new HFlow({ spacing: 5, lineSpacing: 8 }));
        threeBoxes(host);

        const before = host.getMinSize();

        host.doLayout();

        expect(host.getMinSize()).toEqual(before);
    });

    it('measures an empty flow as nothing, not a negative extent', () => {
        installTestDOM(CONFIG);

        // No rows means no gaps. Counting one gap per row boundary regardless
        // would measure an empty flow at minus one lineSpacing.
        const flow = new HFlow({ spacing: 5, lineSpacing: 8 });
        const host = hostHFlow(100, 300, flow);

        host.doLayout();

        // Asked through the manager, not the host: Container floors a negative
        // preferred size at zero, so the host reports 0 either way and cannot
        // tell a measured nothing from a measured -8.
        expect(flow.getPreferredSize()).toEqual({ width: 0, height: 0 });
        expect(host.getPreferredSize()).toEqual({ width: 0, height: 0 });
    });

    it('adds the container perimeter back to the measured height', () => {
        installTestDOM(CONFIG);

        // 7px of horizontal padding each side leaves the inner width at the 100
        // that wraps the boxes onto three rows; the vertical padding is
        // deliberately asymmetric so a fix that adds one side twice shows up.
        const host = hostHFlow(114, 300, new HFlow({ spacing: 5, lineSpacing: 8 }));
        host.setPadding(new Insets(10, 7, 12, 7));
        threeBoxes(host);

        host.doLayout();

        expect(host.getPreferredSize()!.height).toBe(3 * 20 + 2 * 8 + 10 + 12);
    });
});

describe('HFlow item alignment within the row', () => {
    afterEach(() => DOM.reset());

    /**
     * A 20-tall and a 60-tall child sharing one row, so the row height is 60 and
     * the short child has 40px of slack to be positioned in.
     */
    function mixedRow(itemAlign: FlowItemAlign): { short: Component; tall: Component } {
        const host  = hostHFlow(300, 200, new HFlow({ spacing: 5, itemAlign: itemAlign }));
        const short = new Component({ preferredSize: { width: 40, height: 20 } });
        const tall  = new Component({ preferredSize: { width: 40, height: 60 } });

        host.addComponent(short);
        host.addComponent(tall);
        host.doLayout();

        return { short: short, tall: tall };
    }

    it('tops the short child in the row by default', () => {
        installTestDOM(CONFIG);

        const { short, tall } = mixedRow("start");

        expect(short.getY()).toBe(0);
        expect(tall.getY()).toBe(0);
    });

    it('centres the short child in the row height', () => {
        installTestDOM(CONFIG);

        const { short, tall } = mixedRow("center");

        // Row height 60 less the 20-tall cell, halved.
        expect(short.getY()).toBe(20);
        // The cell that sets the row height has no slack and cannot move.
        expect(tall.getY()).toBe(0);
    });

    it('bottoms the short child in the row height', () => {
        installTestDOM(CONFIG);

        const { short, tall } = mixedRow("end");

        // Row height 60 less the 20-tall cell.
        expect(short.getY()).toBe(40);
        expect(tall.getY()).toBe(0);
    });
});

describe('HFlow per-child cross-axis fill (align-self: stretch)', () => {
    afterEach(() => DOM.reset());

    /**
     * A vertical rule: 1px wide, no intrinsic height, and a cross-axis (VERTICAL)
     * fill constraint — the divider shape `## Expected Behaviour` models.
     */
    function rule(maxHeight: number = UNBOUNDED): { component: Component; constraints: LayoutConstraints } {
        const component = new Component({
            preferredSize: { width: 1, height: 0 },
            minSize:       { width: 1, height: 0 },
            maxSize:       { width: 1, height: maxHeight },
        });
        const constraints = Object.assign(new LayoutConstraints(), { fill: FillType.VERTICAL });

        return { component: component, constraints: constraints };
    }

    it('H1 — a rule child spans its row', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(300, 200, new HFlow({ spacing: 5 }));
        const a = new Component({ preferredSize: { width: 40, height: 20 } });
        const { component: r, constraints } = rule();
        const c = new Component({ preferredSize: { width: 60, height: 30 } });

        host.addComponent(a);
        host.addComponent(r, constraints);
        host.addComponent(c);
        host.doLayout();

        expect(r.getHeight()).toBe(30);
        expect(r.getY()).toBe(0);
        expect(r.getWidth()).toBe(1);
        expect(r.getX()).toBe(45);
        expect(a.getHeight()).toBe(20);
        expect(c.getHeight()).toBe(30);
    });

    it('H2 — fill overrides itemAlign for that child only', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(300, 200, new HFlow({ spacing: 5, itemAlign: 'center' }));
        const a = new Component({ preferredSize: { width: 40, height: 20 } });
        const { component: r, constraints } = rule();
        const c = new Component({ preferredSize: { width: 60, height: 30 } });

        host.addComponent(a);
        host.addComponent(r, constraints);
        host.addComponent(c);
        host.doLayout();

        // A centres in the 30-tall row (30 - 20) / 2.
        expect(a.getY()).toBe(5);
        expect(r.getY()).toBe(0);
        expect(r.getHeight()).toBe(30);
    });

    it("H3 — the child's maximum caps the stretch", () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(300, 200, new HFlow({ spacing: 5 }));
        const a = new Component({ preferredSize: { width: 40, height: 20 } });
        const { component: r, constraints } = rule(12);
        const c = new Component({ preferredSize: { width: 60, height: 30 } });

        host.addComponent(a);
        host.addComponent(r, constraints);
        host.addComponent(c);
        host.doLayout();

        // The flow offers the 30-tall row; the child's own max refuses it.
        expect(r.getHeight()).toBe(12);
        expect(r.getY()).toBe(0);
    });

    it('H4 — a rule alone on a wrapped row stays zero-tall', () => {
        installTestDOM(CONFIG);

        // 95 + 5 + 1 = 101 > 100: the rule does not fit beside A and wraps alone.
        const host = hostHFlow(100, 300, new HFlow({ spacing: 5, lineSpacing: 8 }));
        const a = new Component({ preferredSize: { width: 95, height: 20 } });
        const { component: r, constraints } = rule();

        host.addComponent(a);
        host.addComponent(r, constraints);
        host.doLayout();

        // A line's cross extent comes from its members, and r is its only member.
        expect(r.getHeight()).toBe(0);
    });

    it('H5 — an unconstrained child is untouched', () => {
        installTestDOM(CONFIG);

        const host = hostHFlow(300, 200, new HFlow({ spacing: 5 }));
        const a = new Component({ preferredSize: { width: 40, height: 20 } });
        const { component: r } = rule();
        const c = new Component({ preferredSize: { width: 60, height: 30 } });

        host.addComponent(a);
        host.addComponent(r);
        host.addComponent(c);
        host.doLayout();

        expect(r.getHeight()).toBe(0);
    });
});

describe('HFlow measurement relay', () => {
    afterEach(() => DOM.reset());

    /**
     * An outer stretching VBox host wrapping a flow container. The relay only
     * fires through a real parent — notifyIntrinsicSizeChanged is a no-op on an
     * unparented component.
     */
    function nestedFlow(outerWidth: number): { outer: Container; flow: Container } {
        const outer = new Container({ layoutManager: new VBox({ stretching: true }) });
        const flow  = new Container({ layoutManager: new HFlow({ spacing: 5, lineSpacing: 8 }) });

        outer.getElement(true);
        outer.clearInsets();
        flow.clearInsets();

        for (let i = 0; i < 3; i++) {
            flow.addComponent(new Component({ preferredSize: { width: 60, height: 20 } }));
        }

        outer.addComponent(flow);
        outer.setWidth(outerWidth);
        outer.setHeight(400);

        return { outer, flow };
    }

    it('relays a changed measurement up to the parent', () => {
        installTestDOM(CONFIG);

        const { outer } = nestedFlow(100);
        outer.flushLayout();

        const spy = vi.spyOn(outer, 'scheduleLayout');

        // Widen so the three boxes collapse from three rows onto one.
        outer.setWidth(300);
        outer.doLayout();

        expect(spy).toHaveBeenCalled();

        spy.mockRestore();
    });

    // The loop guard: a second identical pass publishes the same extent and so
    // notifies nothing.
    it('does not re-dirty itself once settled', () => {
        installTestDOM(CONFIG);

        const { outer } = nestedFlow(100);

        expectNoSelfReschedule(outer);
    });

    it('does not re-dirty itself when a child makes the measurement non-finite', () => {
        installTestDOM(CONFIG);

        const { outer, flow } = nestedFlow(100);

        flow.addComponent(new Component({ preferredSize: { width: 60, height: NaN } }));

        // The loop guard compares the new extent against the stored one, and
        // `NaN !== NaN`. Storing a NaN would therefore make every pass look like
        // a change: each layout relays a size change that schedules the next.
        expectNoSelfReschedule(outer);
    });
});
