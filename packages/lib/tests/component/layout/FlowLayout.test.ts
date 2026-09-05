// FlowLayout is abstract; its setter/getter surface is tested through the
// concrete HFlow / VFlow subclasses. The setter/getter blocks are pure node
// with no geometry; the measurement-lifecycle blocks below install the DOM
// harness because they need a realised, sized host.
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { HFlow } from '~/layout/HFlow';
import { VFlow } from '~/layout/VFlow';
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

describe('FlowLayout setters/getters (via HFlow)', () => {
    it('defaults componentSpacing and lineSpacing to 5', () => {
        const flow = new HFlow();

        expect(flow.getComponentSpacing()).toBe(5);
        expect(flow.getLineSpacing()).toBe(5);
    });

    it('defaults uniform to "none", align/justify to "start", itemAlign to "start"', () => {
        const flow = new HFlow();

        expect(flow.getUniform()).toBe('none');
        expect(flow.getAlign()).toBe('start');
        expect(flow.getJustify()).toBe('start');
        expect(flow.getItemAlign()).toBe('start');
    });

    it('round-trips each setter', () => {
        const flow = new HFlow();

        flow.setComponentSpacing(12);
        flow.setLineSpacing(8);
        flow.setUniform('both');
        flow.setAlign('center');
        flow.setItemAlign('end');
        flow.setJustify('between');

        expect(flow.getComponentSpacing()).toBe(12);
        expect(flow.getLineSpacing()).toBe(8);
        expect(flow.getUniform()).toBe('both');
        expect(flow.getAlign()).toBe('center');
        expect(flow.getItemAlign()).toBe('end');
        expect(flow.getJustify()).toBe('between');
    });

    it('applies options through the construction bag', () => {
        const flow = new VFlow({ spacing: 3, lineSpacing: 4, uniform: 'width' });

        expect(flow.getComponentSpacing()).toBe(3);
        expect(flow.getLineSpacing()).toBe(4);
        expect(flow.getUniform()).toBe('width');
    });

    it('doLayout() does not throw without a container (HFlow and VFlow)', () => {
        expect(() => new HFlow().doLayout()).not.toThrow();
        expect(() => new VFlow().doLayout()).not.toThrow();
    });
});

describe('FlowLayout drops its measurement when the container changes', () => {
    afterEach(() => DOM.reset());

    /** A realised, sized host holding three 60x20 boxes under `flow`. */
    function host(flow: HFlow, width: number): Container {
        const container = new Container({ layoutManager: flow });

        container.getElement(true);
        container.setWidth(width);
        container.setHeight(300);
        container.clearInsets();

        for (let i = 0; i < 3; i++) {
            container.addComponent(new Component({ preferredSize: { width: 60, height: 20 } }));
        }

        return container;
    }

    it('does not carry a measurement onto a new container', () => {
        installTestDOM(CONFIG);

        const flow = new HFlow({ spacing: 5, lineSpacing: 8 });
        const first = host(flow, 100);

        first.doLayout();
        expect(first.getPreferredSize()!.height).toBe(76);

        // `Component.setLayoutManager` detaches the *container's* outgoing
        // manager, never the *manager's* previous container — so without the
        // clear in attach(), this empty host reports the old three-row 76.
        const second = new Container({ layoutManager: flow });
        second.getElement(true);
        second.setWidth(400);
        second.setHeight(300);
        second.clearInsets();

        expect(second.getPreferredSize()!.height).toBe(0);
    });

    it('restores the single-line fallback when re-attached', () => {
        installTestDOM(CONFIG);

        const flow = new HFlow({ spacing: 5, lineSpacing: 8 });
        const container = host(flow, 100);

        container.doLayout();
        expect(container.getPreferredSize()!.height).toBe(76);

        flow.attach(container);

        // Re-attached with no layout since: the single-line fallback is live
        // again, so the three boxes report one 20-high row rather than 76.
        expect(container.getPreferredSize()!.height).toBe(20);
    });
});

/**
 * A fixed-size box reporting an explicit text baseline. `Component.getBaseline`
 * is derived, not settable, and a plain `Component` reports null — so a
 * baseline-alignment case needs a child that claims one.
 */
class BaselineBox extends Component {

    // Assigned in the body, not as an initializer: a field initializer runs
    // after super() and would clobber anything the construction cascade wrote.
    private _fixedBaseline!: number;

    constructor(width: number, height: number, baseline: number, pinMin = false) {
        super(pinMin
            ? { preferredSize: { width: width, height: height }, minSize: { width: width, height: height } }
            : { preferredSize: { width: width, height: height } });

        this._fixedBaseline = baseline;
    }

    getBaseline(): number | null {
        return this._fixedBaseline;
    }
}

describe('HFlow measures a baseline-aligned row by its real extent', () => {
    afterEach(() => DOM.reset());

    /**
     * A baseline row can be taller than its tallest child: aligning a
     * high-baseline child with a low-baseline one pushes the latter's descender
     * below the former's bottom. A plain max over the cell heights misses that,
     * and under-reporting re-clips exactly what the measurement exists to expose.
     */
    function baselineRow(): Container {
        const container = new Container({
            layoutManager: new HFlow({ spacing: 5, itemAlign: 'baseline' }),
        });

        container.getElement(true);
        container.setWidth(300);
        container.setHeight(200);
        container.clearInsets();

        // A 20-high child whose baseline sits at 15 and a 30-high child whose
        // baseline sits at 5: aligning them puts the second at y = 10, so the
        // row really ends at 40 while the tallest child is only 30.
        container.addComponent(new BaselineBox(40, 20, 15));
        container.addComponent(new BaselineBox(40, 30, 5));

        return container;
    }

    it('reports exactly where the children actually end', () => {
        installTestDOM(CONFIG);

        const container = baselineRow();
        container.doLayout();

        const kids = container.getComponents();
        const contentBottom = Math.max(...kids.map(k => k.getY() + k.getHeight()));

        // `toBe`, not `toBeGreaterThanOrEqual`: an over-report grows the host
        // past its content and would slip past an inequality.
        expect(container.getPreferredSize()!.height).toBe(contentBottom);
    });

    it('does not overlap wrapped baseline rows, and reports their real total', () => {
        installTestDOM(CONFIG);

        // Inner width 90 fits two 40-wide cells per row (40 + 5 + 40 = 85).
        const container = new Container({
            layoutManager: new HFlow({ spacing: 5, lineSpacing: 8, itemAlign: 'baseline' }),
        });

        container.getElement(true);
        container.setWidth(90);
        container.setHeight(400);
        container.clearInsets();

        for (let i = 0; i < 2; i++) {
            container.addComponent(new BaselineBox(40, 20, 18));
            container.addComponent(new BaselineBox(40, 40, 2));
        }

        container.doLayout();

        const kids = container.getComponents();
        const rowOneBottom = Math.max(kids[0].getY() + kids[0].getHeight(), kids[1].getY() + kids[1].getHeight());
        const rowTwoTop    = Math.min(kids[2].getY(), kids[3].getY());

        // The row advance must clear the descender the baseline offset pushed
        // below the tallest cell, or the second row lands on top of the first.
        expect(rowTwoTop).toBeGreaterThanOrEqual(rowOneBottom);

        const contentBottom = Math.max(...kids.map(k => k.getY() + k.getHeight()));

        expect(container.getPreferredSize()!.height).toBe(contentBottom);
    });

    // A uniform height sets every cell to the tallest item, but baseline
    // alignment still offsets each cell by its own baseline, so the row can end
    // below the uniform cell. The two features had no combined coverage.
    it('clears the descenders of a uniform-height baseline row', () => {
        installTestDOM(CONFIG);

        const container = new Container({
            layoutManager: new HFlow({ spacing: 5, lineSpacing: 8, uniform: 'height', itemAlign: 'baseline' }),
        });

        container.getElement(true);
        container.setWidth(90);
        container.setHeight(400);
        container.clearInsets();

        // Inner width 90 fits two 40-wide cells per row. Every cell is 40 high
        // (the uniform height), but the baselines differ, so the row runs past
        // 40 and the second row must start below that.
        for (let i = 0; i < 2; i++) {
            container.addComponent(new BaselineBox(40, 20, 18));
            container.addComponent(new BaselineBox(40, 40, 2));
        }

        container.doLayout();

        const kids = container.getComponents();
        const rowOneBottom = Math.max(kids[0].getY() + kids[0].getHeight(), kids[1].getY() + kids[1].getHeight());
        const rowTwoTop    = Math.min(kids[2].getY(), kids[3].getY());

        expect(rowTwoTop).toBeGreaterThanOrEqual(rowOneBottom);

        const contentBottom = Math.max(...kids.map(k => k.getY() + k.getHeight()));

        expect(container.getPreferredSize()!.height).toBe(contentBottom);
        // Pinned to the value, not just to the content: the baseline formula
        // runs over the UNIFORM cell height, not the item's own. Both cells are
        // 40 high, so rowAscent is 18 and rowDescent max(40-18, 40-2) = 38 —
        // a 56-high row, well past the 40 a uniform-only reading would give.
        expect(container.getPreferredSize()!.height).toBe(2 * 56 + 8);
    });

    it('reports the plain row max when alignment is not baseline', () => {
        installTestDOM(CONFIG);

        // Children carry baselines but itemAlign is the default "start", so each
        // cell sits inside the row and the row is exactly its tallest cell.
        const container = new Container({ layoutManager: new HFlow({ spacing: 5 }) });

        container.getElement(true);
        container.setWidth(300);
        container.setHeight(200);
        container.clearInsets();

        // The tallest child is deliberately NOT last: with it last, "tallest
        // cell" and "last cell" are the same number and a broken reduce would
        // still report 30.
        container.addComponent(new BaselineBox(40, 30, 10));
        container.addComponent(new BaselineBox(40, 20, 18));
        container.addComponent(new BaselineBox(40, 25, 12));

        container.doLayout();

        const kids = container.getComponents();
        const contentBottom = Math.max(...kids.map(k => k.getY() + k.getHeight()));

        expect(contentBottom).toBe(30);
        expect(container.getPreferredSize()!.height).toBe(30);
    });

    it('keeps a non-baseline minimum off the baseline formula', () => {
        installTestDOM(CONFIG);

        // Default itemAlign. Two 20-high children at baselines 15 and 0 give a
        // baseline-aware row height of 35, but under "start" each cell sits
        // inside the row, so the row minimum is the tallest min: 20. Reporting
        // 35 here would put the minimum above the preferred height.
        const container = new Container({ layoutManager: new HFlow({ spacing: 5 }) });

        container.getElement(true);
        container.setWidth(300);
        container.setHeight(200);
        container.clearInsets();

        container.addComponent(new BaselineBox(40, 20, 15, true));
        container.addComponent(new BaselineBox(40, 20, 0, true));

        container.doLayout();

        expect(container.getMinSize()!.height).toBe(20);
        expect(container.getMinSize()!.height)
            .toBeLessThanOrEqual(container.getPreferredSize()!.height);
    });

    it('keeps the minimum at or below the preferred size', () => {
        installTestDOM(CONFIG);

        const container = new Container({
            layoutManager: new HFlow({ spacing: 5, itemAlign: 'baseline' }),
        });

        container.getElement(true);
        container.setWidth(300);
        container.setHeight(200);
        container.clearInsets();

        // The minimums must be pinned for this to bite: getMinSize is itself
        // baseline-aware, so with two 20-high children at baselines 15 and 0 the
        // row minimum is 35 — above the 20 a plain max over the cell heights
        // would report as the preferred height.
        container.addComponent(new BaselineBox(40, 20, 15, true));
        container.addComponent(new BaselineBox(40, 20, 0, true));

        container.doLayout();

        // Pin the value, not just the ordering: two 20-high pinned minimums at
        // baselines 15 and 0 give rowAscent 15 + rowDescent 20 = 35. An
        // inequality alone passes for a minimum that wrongly drops to the plain
        // max of 20, which is the baseline arm this case exists to cover.
        expect(container.getMinSize()!.height).toBe(35);

        // ARCHITECTURE binds min <= preferred <= max. Component.getPreferredSize
        // does not clamp to a layout-derived minimum, so an inverted envelope
        // would be reported verbatim rather than silently corrected.
        expect(container.getMinSize()!.height)
            .toBeLessThanOrEqual(container.getPreferredSize()!.height);
    });
});

describe('FlowLayout keeps the maximum at or above the preferred size', () => {
    afterEach(() => DOM.reset());

    // A maximum below the reported preferred size violates ARCHITECTURE's
    // min <= preferred <= max, and clamps a content-clamping host back to one
    // line — re-clipping exactly what the measurement exists to expose.
    it('floors an HFlow maximum at the wrapped height', () => {
        installTestDOM(CONFIG);

        const container = new Container({ layoutManager: new HFlow({ spacing: 5, lineSpacing: 8 }) });
        container.getElement(true);
        container.setWidth(100);
        container.setHeight(300);
        container.clearInsets();

        for (let i = 0; i < 3; i++) {
            container.addComponent(new Component({
                preferredSize: { width: 60, height: 20 },
                maxSize:       { width: 60, height: 20 },
            }));
        }

        container.doLayout();

        expect(container.getPreferredSize()!.height).toBe(76);
        expect(container.getMaxSize()!.height).toBe(76);
    });

    // The floor raises a too-small maximum; it must not lower a larger one.
    // Only a single-row maximum ABOVE the measurement separates flooring from
    // overwriting — below it the two are the same number.
    it('leaves an HFlow maximum already above the wrapped height alone', () => {
        installTestDOM(CONFIG);

        const container = new Container({ layoutManager: new HFlow({ spacing: 5, lineSpacing: 8 }) });
        container.getElement(true);
        container.setWidth(100);
        container.setHeight(300);
        container.clearInsets();

        for (let i = 0; i < 3; i++) {
            container.addComponent(new Component({
                preferredSize: { width: 60, height: 20 },
                maxSize:       { width: 60, height: 500 },
            }));
        }

        container.doLayout();

        // Wrapped extent 76, single-row maximum 500. The larger wins.
        expect(container.getPreferredSize()!.height).toBe(76);
        expect(container.getMaxSize()!.height).toBe(500);
    });

    it('floors a VFlow maximum at the wrapped width', () => {
        installTestDOM(CONFIG);

        const container = new Container({ layoutManager: new VFlow({ spacing: 5, lineSpacing: 8 }) });
        container.getElement(true);
        container.setWidth(300);
        container.setHeight(100);
        container.clearInsets();

        for (let i = 0; i < 3; i++) {
            container.addComponent(new Component({
                preferredSize: { width: 20, height: 60 },
                maxSize:       { width: 20, height: 60 },
            }));
        }

        container.doLayout();

        expect(container.getPreferredSize()!.width).toBe(76);
        expect(container.getMaxSize()!.width).toBe(76);
    });

    it('leaves a VFlow maximum already above the wrapped width alone', () => {
        installTestDOM(CONFIG);

        const container = new Container({ layoutManager: new VFlow({ spacing: 5, lineSpacing: 8 }) });
        container.getElement(true);
        container.setWidth(300);
        container.setHeight(100);
        container.clearInsets();

        for (let i = 0; i < 3; i++) {
            container.addComponent(new Component({
                preferredSize: { width: 20, height: 60 },
                maxSize:       { width: 500, height: 60 },
            }));
        }

        container.doLayout();

        // Wrapped extent 76, single-column maximum 500. The larger wins.
        expect(container.getPreferredSize()!.width).toBe(76);
        expect(container.getMaxSize()!.width).toBe(500);
    });
});

describe('FlowLayout cross-axis fill vs uniform cells and size reports', () => {
    afterEach(() => DOM.reset());

    /** A vertical rule matching HFlow.test.ts's H1 rule shape. */
    function hRule(): { component: Component; constraints: LayoutConstraints } {
        const component = new Component({
            preferredSize: { width: 1, height: 0 },
            minSize:       { width: 1, height: 0 },
            maxSize:       { width: 1, height: UNBOUNDED },
        });
        const constraints = Object.assign(new LayoutConstraints(), { fill: FillType.VERTICAL });

        return { component: component, constraints: constraints };
    }

    /** A horizontal rule matching VFlow.test.ts's V1 rule shape. */
    function vRule(): { component: Component; constraints: LayoutConstraints } {
        const component = new Component({
            preferredSize: { width: 0, height: 1 },
            minSize:       { width: 0, height: 1 },
            maxSize:       { width: UNBOUNDED, height: 1 },
        });
        const constraints = Object.assign(new LayoutConstraints(), { fill: FillType.HORIZONTAL });

        return { component: component, constraints: constraints };
    }

    it('U1 — fill is inert when uniform already fixes the cross axis (HFlow)', () => {
        installTestDOM(CONFIG);

        const container = new Container({ layoutManager: new HFlow({ uniform: 'height', spacing: 5 }) });
        container.getElement(true);
        container.setWidth(300);
        container.setHeight(200);
        container.clearInsets();

        const a = new Component({ preferredSize: { width: 40, height: 20 } });
        const { component: r, constraints } = hRule();
        const c = new Component({ preferredSize: { width: 60, height: 30 } });

        container.addComponent(a);
        container.addComponent(r, constraints);
        container.addComponent(c);
        container.doLayout();

        // Every cell is 30 tall (the uniform height): the same value with or
        // without the fill constraint.
        expect(r.getHeight()).toBe(30);
    });

    it('U2 — fill is inert when uniform already fixes the cross axis (VFlow)', () => {
        installTestDOM(CONFIG);

        const container = new Container({ layoutManager: new VFlow({ uniform: 'width', spacing: 5 }) });
        container.getElement(true);
        container.setWidth(300);
        container.setHeight(200);
        container.clearInsets();

        const a = new Component({ preferredSize: { width: 20, height: 40 } });
        const { component: r, constraints } = vRule();
        const c = new Component({ preferredSize: { width: 30, height: 60 } });

        container.addComponent(a);
        container.addComponent(r, constraints);
        container.addComponent(c);
        container.doLayout();

        expect(r.getWidth()).toBe(30);
    });

    it('U3 — fill on the main axis stays inert even when uniform widens its cell (HFlow)', () => {
        installTestDOM(CONFIG);

        const container = new Container({ layoutManager: new HFlow({ uniform: 'width', spacing: 5 }) });
        container.getElement(true);
        container.setWidth(300);
        container.setHeight(200);
        container.clearInsets();

        // A wide sibling forces the uniform width (100) well past the rule's own
        // 0 preferred width, so a naive "stretch to the cell" would move it.
        const a = new Component({ preferredSize: { width: 100, height: 20 } });
        const { component: r, constraints } = vRule();

        container.addComponent(a);
        container.addComponent(r, constraints);
        container.doLayout();

        // fill: HORIZONTAL names HFlow's main axis, which the flow owns — the
        // rule stays at its own preferred width regardless of the uniform cell.
        expect(r.getWidth()).toBe(0);
    });

    it('U4 — fill on the main axis stays inert even when uniform widens its cell (VFlow)', () => {
        installTestDOM(CONFIG);

        const container = new Container({ layoutManager: new VFlow({ uniform: 'height', spacing: 5 }) });
        container.getElement(true);
        container.setWidth(300);
        container.setHeight(200);
        container.clearInsets();

        // A tall sibling forces the uniform height (100) well past the rule's
        // own 0 preferred height, so a naive "stretch to the cell" would move it.
        const a = new Component({ preferredSize: { width: 20, height: 100 } });
        const { component: r, constraints } = hRule();

        container.addComponent(a);
        container.addComponent(r, constraints);
        container.doLayout();

        // fill: VERTICAL names VFlow's main axis, which the flow owns — the
        // rule stays at its own preferred height regardless of the uniform cell.
        expect(r.getHeight()).toBe(0);
    });

    it("S1 — the flow's reported sizes are unaffected", () => {
        installTestDOM(CONFIG);

        function buildHost(applyFill: boolean): Container {
            const container = new Container({ layoutManager: new HFlow({ spacing: 5 }) });
            container.getElement(true);
            container.setWidth(300);
            container.setHeight(200);
            container.clearInsets();

            const a = new Component({ preferredSize: { width: 40, height: 20 } });
            const { component: r, constraints } = hRule();
            const c = new Component({ preferredSize: { width: 60, height: 30 } });

            container.addComponent(a);
            container.addComponent(r, applyFill ? constraints : undefined);
            container.addComponent(c);
            container.doLayout();

            return container;
        }

        const filled = buildHost(true);
        const plain  = buildHost(false);

        expect(filled.getPreferredSize()).toEqual(plain.getPreferredSize());
        expect(filled.getMinSize()).toEqual(plain.getMinSize());
        expect(filled.getMaxSize()).toEqual(plain.getMaxSize());
    });
});
