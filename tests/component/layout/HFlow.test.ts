// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { HFlow } from '~/layout/HFlow';
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
