// @vitest-environment jsdom
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
