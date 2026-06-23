// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Absolute } from '~/layout/Absolute';
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

function hostAbsolute(width: number, height: number): Container {
    const host = new Container({ layoutManager: new Absolute() });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('Absolute', () => {
    afterEach(() => DOM.reset());

    it('doLayout() does not throw without a container', () => {
        expect(() => new Absolute().doLayout()).not.toThrow();
    });

    it('passes each child through at its own position and preferred size', () => {
        installTestDOM(CONFIG);

        const host = hostAbsolute(300, 200);
        const child = new Component({ preferredSize: { width: 40, height: 25 } });

        host.addComponent(child);
        child.setX(17);
        child.setY(33);

        host.doLayout();

        // Contract: Absolute copies inputs through, bypassing the cell clamp.
        expect(child.getX()).toBe(17);
        expect(child.getY()).toBe(33);
        expect(child.getWidth()).toBe(40);
        expect(child.getHeight()).toBe(25);
    });

    it('commits a child larger than the container at its full preferred size', () => {
        installTestDOM(CONFIG);

        const host = hostAbsolute(100, 100);
        const child = new Component({ preferredSize: { width: 500, height: 400 } });

        host.addComponent(child);
        child.setX(0);
        child.setY(0);

        host.doLayout();

        // No clamp: oversized children keep their full size so a scroll host can scroll them.
        expect(child.getWidth()).toBe(500);
        expect(child.getHeight()).toBe(400);
    });
});
