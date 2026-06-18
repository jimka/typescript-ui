// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 1000, y: 2000 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('ModelledDOMSource geometry oracle', () => {
    afterEach(() => {
        DOM.reset();
    });

    it('reproduces nested viewport geometry from committed state', () => {
        installTestDOM(CONFIG);

        const root = new Component({});
        const mid  = new Component({});
        const leaf = new Component({});

        root.addComponent(mid);
        mid.addComponent(leaf);

        mid.setX(100);
        mid.setY(50);

        leaf.setX(10);
        leaf.setY(20);
        leaf.setWidth(40);
        leaf.setHeight(30);
        leaf.setTranslate(3, 7);

        const rect = DOM.source.getViewportRect(leaf);

        // x: rootMountOffset(1000) + mid.x(100) + leaf.x(10) + leaf.translateX(3)
        expect(rect.x).toBe(1113);
        // y: rootMountOffset(2000) + mid.y(50) + leaf.y(20) + leaf.translateY(7)
        expect(rect.y).toBe(2077);
        expect(rect.width).toBe(40);
        expect(rect.height).toBe(30);
        expect(rect.right).toBe(1153);
        expect(rect.bottom).toBe(2107);
    });

    it('places a direct child at the root mount offset plus its own position', () => {
        installTestDOM(CONFIG);

        const root  = new Component({});
        const child = new Component({});

        root.addComponent(child);

        child.setX(25);
        child.setY(60);
        child.setWidth(10);
        child.setHeight(10);

        const rect = DOM.source.getViewportRect(child);

        expect(rect.x).toBe(1025);
        expect(rect.y).toBe(2060);
    });
});
