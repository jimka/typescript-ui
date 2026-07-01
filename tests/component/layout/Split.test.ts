// Split is heavily DOM-coupled; this file scopes to the ratio / collapse STATE
// surface that LayoutSerialization depends on (orientation, pane ratios with
// normalisation, per-pane collapse). Deeper gutter geometry is a Non-Goal here.
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
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

function hostSplit(split: Split, paneCount: number): { host: Container; split: Split } {
    const host = new Container({ layoutManager: split });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);

    for (let i = 0; i < paneCount; i += 1) {
        host.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));
    }

    return { host, split };
}

describe('Split orientation', () => {
    it('defaults orientation and round-trips the constructor option', () => {
        expect(new Split({ orientation: 'horizontal' }).getOrientation()).toBe('horizontal');
        expect(new Split({ orientation: 'vertical' }).getOrientation()).toBe('vertical');
    });
});

describe('Split pane ratios', () => {
    afterEach(() => DOM.reset());

    it('getPaneRatios returns an equal split before any sizes are stored', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);

        const ratios = split.getPaneRatios();

        expect(ratios.length).toBe(2);
        expect(ratios[0]).toBeCloseTo(0.5, 5);
        expect(ratios[1]).toBeCloseTo(0.5, 5);
    });

    it('applyPaneRatios normalises un-normalised input to sum ~1.0', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);

        // Feed weights 1:3 (sum 4) — must normalise to 0.25 / 0.75.
        split.applyPaneRatios([1, 3]);

        const ratios = split.getPaneRatios();
        const sum = ratios.reduce((t, r) => t + r, 0);

        expect(sum).toBeCloseTo(1.0, 5);
        expect(ratios[0]).toBeCloseTo(0.25, 5);
        expect(ratios[1]).toBeCloseTo(0.75, 5);
    });
});

describe('Split resize weights', () => {
    afterEach(() => DOM.reset());

    // Container gutters/insets are constant across a resize, so a change in host
    // width equals the change in the net-of-gutters `available` extent the panes
    // divide. Every case below asserts against that delta, never an absolute px
    // that would depend on the (untested) inset value.

    it('getPaneResizeWeight is undefined when unset and round-trips a set value', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        expect(split.getPaneResizeWeight(panes[0])).toBeUndefined();
        expect(split.setPaneResizeWeight(panes[0], 3)).toBe(split);
        expect(split.getPaneResizeWeight(panes[0])).toBe(3);
    });

    it('weight 0 pins a pane on grow; a positive-weight sibling absorbs the delta', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        split.setPaneResizeWeight(panes[0], 0);
        split.setPaneResizeWeight(panes[1], 1);
        host.doLayout();

        const a0 = split.getPaneSize(panes[0])!;
        const b0 = split.getPaneSize(panes[1])!;

        host.setWidth(490); // +90
        host.doLayout();

        expect(split.getPaneSize(panes[0])!).toBeCloseTo(a0, 4);        // pinned
        expect(split.getPaneSize(panes[1])!).toBeCloseTo(b0 + 90, 4);   // absorbed all
    });

    it('weight 0 pins a pane on shrink', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        split.setPaneResizeWeight(panes[0], 0);
        split.setPaneResizeWeight(panes[1], 1);
        host.doLayout();

        const a0 = split.getPaneSize(panes[0])!;
        const b0 = split.getPaneSize(panes[1])!;

        host.setWidth(340); // -60
        host.doLayout();

        expect(split.getPaneSize(panes[0])!).toBeCloseTo(a0, 4);        // pinned
        expect(split.getPaneSize(panes[1])!).toBeCloseTo(b0 - 60, 4);   // absorbed all
    });

    it('equal weights split the delta evenly', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        split.setPaneResizeWeight(panes[0], 1);
        split.setPaneResizeWeight(panes[1], 1);
        host.doLayout();

        const a0 = split.getPaneSize(panes[0])!;
        const b0 = split.getPaneSize(panes[1])!;

        host.setWidth(480); // +80
        host.doLayout();

        expect(split.getPaneSize(panes[0])!).toBeCloseTo(a0 + 40, 4);
        expect(split.getPaneSize(panes[1])!).toBeCloseTo(b0 + 40, 4);
    });

    it('weights 1:3 split the delta a quarter / three-quarters', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        split.setPaneResizeWeight(panes[0], 1);
        split.setPaneResizeWeight(panes[1], 3);
        host.doLayout();

        const a0 = split.getPaneSize(panes[0])!;
        const b0 = split.getPaneSize(panes[1])!;

        host.setWidth(480); // +80
        host.doLayout();

        expect(split.getPaneSize(panes[0])!).toBeCloseTo(a0 + 20, 4);
        expect(split.getPaneSize(panes[1])!).toBeCloseTo(b0 + 60, 4);
    });

    it('an unset pane defaults to its size and absorbs the delta beside an explicit weight-0 pane', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        split.setPaneResizeWeight(panes[0], 0); // explicit pin
        // panes[1] left unset — defaults to its current size
        host.doLayout();

        const a0 = split.getPaneSize(panes[0])!;
        const b0 = split.getPaneSize(panes[1])!;

        host.setWidth(490); // +90
        host.doLayout();

        expect(split.getPaneSize(panes[0])!).toBeCloseTo(a0, 4);        // pinned
        expect(split.getPaneSize(panes[1])!).toBeCloseTo(b0 + 90, 4);   // absorbed all
    });

    it('no weights set preserves the proportional rescale (ratio invariant across resize)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);

        split.applyPaneRatios([1, 2]); // seed 1:2

        host.setWidth(490); // +90
        host.doLayout();

        const ratios = split.getPaneRatios();

        expect(ratios[0]).toBeCloseTo(1 / 3, 5);
        expect(ratios[1]).toBeCloseTo(2 / 3, 5);
    });

    it('all weights 0 degrades to proportional rescale (delta has nowhere to go)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        split.applyPaneRatios([1, 2]); // seed 1:2
        split.setPaneResizeWeight(panes[0], 0);
        split.setPaneResizeWeight(panes[1], 0);

        host.setWidth(490); // +90
        host.doLayout();

        const ratios = split.getPaneRatios();

        expect(ratios[0]).toBeCloseTo(1 / 3, 5);
        expect(ratios[1]).toBeCloseTo(2 / 3, 5);
    });

    it('shrinking past a pinned pane clamps to >= 0 and refills to the exact extent', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        // Pin a large pane (weight 0) beside an absorbing one, seeded 3:1 so the
        // baseline `_lastAvailableMain` is set and the pinned pane starts large.
        split.applyPaneRatios([3, 1]);
        split.setPaneResizeWeight(panes[0], 0);
        split.setPaneResizeWeight(panes[1], 1);

        const sum0 = split.getPaneSize(panes[0])! + split.getPaneSize(panes[1])!;

        host.setWidth(100); // shrink by 300 — far below the pinned pane's room
        host.doLayout();

        const a1 = split.getPaneSize(panes[0])!;
        const b1 = split.getPaneSize(panes[1])!;

        // No negative size; the absorbing pane bottoms out; the pinned pane gives
        // up its px (geometry must fill the container) and the `Σ == available`
        // refill restores the invariant — sum tracks the net extent change exactly.
        expect(a1).toBeGreaterThanOrEqual(0);
        expect(b1).toBeGreaterThanOrEqual(0);
        expect(b1).toBeCloseTo(0, 4);
        expect(a1 + b1).toBeCloseTo(sum0 - 300, 4);
    });

    it('a resize preserves collapse state and the expanded panes still fill', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 3);

        split.applyPaneRatios([1, 1, 2]);   // panes 0:1:2 sized 1:1:2
        split.setPaneCollapsedImmediate(1, true);

        host.setWidth(490); // grow by 90
        host.doLayout();

        // Collapse survives the weighted redistribution untouched...
        expect(split.isPaneCollapsed(0)).toBe(false);
        expect(split.isPaneCollapsed(1)).toBe(true);
        expect(split.isPaneCollapsed(2)).toBe(false);

        // ...and the expanded panes keep their mutual proportion (2:1) filling
        // the extent — the collapsed pane's frozen size does not distort them.
        const ratios = split.getPaneRatios();
        expect(ratios[2] / ratios[0]).toBeCloseTo(2, 5);
    });

    it('transferPaneSize moves the resize weight to the new slot occupant', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        split.setPaneSize(panes[0], 100);
        split.setPaneResizeWeight(panes[0], 5);

        split.transferPaneSize(panes[0], panes[1]);

        expect(split.getPaneResizeWeight(panes[1])).toBe(5);
        expect(split.getPaneResizeWeight(panes[0])).toBeUndefined();
    });

    it('prunes the weight of a pane that leaves the container without a stored size', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split(), 2);
        const panes = host.getComponents();

        // Weight set but never laid out, so the pane has no `_sizes` entry — it is
        // invisible to the `_sizes`-keyed removal loop and must be pruned by the
        // dedicated `_weights` pass.
        split.setPaneResizeWeight(panes[0], 0);
        host.removeComponent(panes[0]);
        host.doLayout();

        expect(split.getPaneResizeWeight(panes[0])).toBeUndefined();
    });

    it('a weight-0 layout constraint pins a pane on resize (declarative surface)', () => {
        installTestDOM(CONFIG);

        const split = new Split();
        const host = new Container({ layoutManager: split });
        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);

        const pinned = new Component({ preferredSize: { width: 50, height: 50 } });
        const grower = new Component({ preferredSize: { width: 50, height: 50 } });
        host.addComponent(pinned, { weight: 0 }); // declarative pin via constraint
        host.addComponent(grower, { weight: 1 });

        host.doLayout();
        const a0 = split.getPaneSize(pinned)!;
        const b0 = split.getPaneSize(grower)!;

        host.setWidth(490); // +90
        host.doLayout();

        expect(split.getPaneSize(pinned)!).toBeCloseTo(a0, 4);        // pinned by constraint
        expect(split.getPaneSize(grower)!).toBeCloseTo(b0 + 90, 4);   // absorbed all
    });

    it('setPaneResizeWeight overrides a weight layout constraint', () => {
        installTestDOM(CONFIG);

        const split = new Split();
        const host = new Container({ layoutManager: split });
        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);

        const a = new Component({ preferredSize: { width: 50, height: 50 } });
        const b = new Component({ preferredSize: { width: 50, height: 50 } });
        host.addComponent(a, { weight: 0 }); // constraint says pin
        host.addComponent(b, { weight: 1 });

        // Runtime override: the imperative setter wins over the constraint, so
        // the delta splits evenly instead of pinning `a`.
        split.setPaneResizeWeight(a, 1);
        split.setPaneResizeWeight(b, 1);

        host.doLayout();
        const a0 = split.getPaneSize(a)!;
        const b0 = split.getPaneSize(b)!;

        host.setWidth(480); // +80
        host.doLayout();

        expect(split.getPaneSize(a)!).toBeCloseTo(a0 + 40, 4);
        expect(split.getPaneSize(b)!).toBeCloseTo(b0 + 40, 4);
    });
});

describe('Split collapse state', () => {
    afterEach(() => DOM.reset());

    it('round-trips per-pane collapse state', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);

        expect(split.isPaneCollapsed(0)).toBe(false);

        split.setPaneCollapsedImmediate(0, true);

        expect(split.isPaneCollapsed(0)).toBe(true);
        expect(split.isPaneCollapsed(1)).toBe(false);
    });

    it('isPaneCollapsed returns false for an out-of-range index', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);

        expect(split.isPaneCollapsed(5)).toBe(false);
    });
});
