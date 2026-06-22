// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { VFlow } from '~/layout/VFlow';
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
