// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Anchor } from '~/layout/Anchor';
import { AnchorConstraints } from '~/layout/AnchorConstraints';
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

function anchorCons(fields: Partial<AnchorConstraints>): AnchorConstraints {
    return Object.assign(new AnchorConstraints(), fields);
}

function hostAnchor(width: number, height: number): Container {
    const host = new Container({ layoutManager: new Anchor() });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('Anchor', () => {
    afterEach(() => DOM.reset());

    it('doLayout() early-returns cleanly when there is no container', () => {
        expect(() => new Anchor().doLayout()).not.toThrow();
    });

    it('doLayout() early-returns cleanly when getInnerSize is null (no element)', () => {
        installTestDOM(CONFIG);

        const host = new Container({ layoutManager: new Anchor() });
        // No getElement(true) => getInnerSize() is null.
        host.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }));

        expect(() => host.doLayout()).not.toThrow();
    });

    it('pins a child a fixed distance from the left/top edge (origin 0)', () => {
        installTestDOM(CONFIG);

        const host = hostAnchor(300, 200);
        const child = new Component({ preferredSize: { width: 40, height: 25 } });

        host.addComponent(child, anchorCons({ left: 12, top: 8 }));

        host.doLayout();

        // start = origin(0) + near; extent = preferred (no opposing edge).
        expect(child.getX()).toBe(12);
        expect(child.getY()).toBe(8);
        expect(child.getWidth()).toBe(40);
        expect(child.getHeight()).toBe(25);
    });

    it('stretches a child between both horizontal edges', () => {
        installTestDOM(CONFIG);

        const host = hostAnchor(300, 200);
        const child = new Component({ preferredSize: { width: 40, height: 25 } });

        host.addComponent(child, anchorCons({ left: 10, right: 20 }));

        const inner = host.getInnerSize()!;

        host.doLayout();

        // extent = inner.width - left - right; start = left.
        expect(child.getX()).toBe(10);
        expect(child.getWidth()).toBe(inner.width - 10 - 20);
    });

    it('scales a proportional offset with the inner extent', () => {
        installTestDOM(CONFIG);

        const host = hostAnchor(400, 200);
        const child = new Component({ preferredSize: { width: 40, height: 25 } });

        host.addComponent(child, anchorCons({ left: { percent: 25 } }));

        const inner = host.getInnerSize()!;

        host.doLayout();

        // Proportional: 25% of inner width.
        expect(child.getX()).toBeCloseTo(inner.width * 0.25, 5);
    });
});
