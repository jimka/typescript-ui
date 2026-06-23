// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Fit } from '~/layout/Fit';
import { FillType } from '~/layout/FillType';
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

function hostFit(width: number, height: number, fit: Fit): Container {
    const host = new Container({ layoutManager: fit });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('Fit setters/getters', () => {
    it('defaults fill to BOTH', () => {
        expect(new Fit().getFill()).toBe(FillType.BOTH);
    });

    it('round-trips setFill', () => {
        const fit = new Fit();

        fit.setFill(FillType.NONE);

        expect(fit.getFill()).toBe(FillType.NONE);
    });

    it('doLayout() does not throw without a container', () => {
        expect(() => new Fit().doLayout()).not.toThrow();
    });
});

describe('Fit doLayout geometry', () => {
    afterEach(() => DOM.reset());

    it('fills the single child to the host inner size exactly (BOTH)', () => {
        installTestDOM(CONFIG);

        const host = hostFit(200, 150, new Fit());
        const child = new Component({ preferredSize: { width: 50, height: 30 } });

        host.addComponent(child);

        const inner = host.getInnerSize()!;

        host.doLayout();

        expect(child.getX()).toBe(0);
        expect(child.getY()).toBe(0);
        expect(child.getWidth()).toBe(inner.width);
        expect(child.getHeight()).toBe(inner.height);
    });

    it('centres the child at its preferred size with FillType.NONE', () => {
        installTestDOM(CONFIG);

        const host = hostFit(200, 150, new Fit({ fill: FillType.NONE }));
        const child = new Component({ preferredSize: { width: 50, height: 30 } });

        host.addComponent(child);

        const inner = host.getInnerSize()!;

        host.doLayout();

        // Contract: child keeps its preferred size and is centred.
        expect(child.getWidth()).toBe(50);
        expect(child.getHeight()).toBe(30);
        expect(child.getX()).toBe((inner.width - 50) / 2);
        expect(child.getY()).toBe((inner.height - 30) / 2);
    });

    it('throws when the container holds more than one component', () => {
        installTestDOM(CONFIG);

        const host = hostFit(200, 150, new Fit());

        host.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }));
        host.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }));

        // Contract: Fit expects exactly one child; doLayout throws on two.
        expect(() => host.doLayout()).toThrow(/more then one component/);
    });
});
