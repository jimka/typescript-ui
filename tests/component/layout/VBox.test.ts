import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { VBox } from '~/layout/VBox';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
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

/**
 * Builds a Container hosting a VBox, sized and inset-cleared so cell origins
 * start at (0,0). The host MUST be a Container (clampsToContentSize() === false)
 * and have a materialised element, or doLayout() early-returns / collapses.
 */
function hostVBox(width: number, height: number, vbox: VBox): Container {
    const host = new Container({ layoutManager: vbox });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('VBox setters/getters', () => {
    it('defaults component spacing to 5', () => {
        expect(new VBox().getComponentSpacing()).toBe(5);
    });

    it('updates component spacing', () => {
        const vbox = new VBox();

        vbox.setComponentSpacing(10);

        expect(vbox.getComponentSpacing()).toBe(10);
    });

    it('defaults stretching to false', () => {
        expect(new VBox().isStretching()).toBe(false);
    });

    it('toggles stretching', () => {
        const vbox = new VBox();

        vbox.setStretching(true);

        expect(vbox.isStretching()).toBe(true);
    });

    it('doLayout() does not throw without a container', () => {
        expect(() => new VBox().doLayout()).not.toThrow();
    });
});

describe('VBox doLayout geometry', () => {
    afterEach(() => DOM.reset());

    it('stacks children top-to-bottom separated by componentSpacing', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox()); // default spacing 5
        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 60, height: 40 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Contract: stack at insets.top (0); child i's y = sum(prev heights) + i*spacing.
        expect(a.getY()).toBe(0);
        expect(a.getHeight()).toBe(30);
        expect(b.getY()).toBe(35); // 30 + spacing(5)
        expect(b.getHeight()).toBe(40);
    });

    it('stacks three children with the cumulative-offset relation', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 600, new VBox({ spacing: 10 }));
        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 50, height: 40 } });
        const c = new Component({ preferredSize: { width: 50, height: 20 } });

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);

        host.doLayout();

        expect(a.getY()).toBe(0);
        expect(b.getY()).toBe(40);  // 30 + 10
        expect(c.getY()).toBe(90);  // 30 + 40 + 2*10
    });

    it('keeps each child at its preferred width when not stretching', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox());
        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 60, height: 40 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        expect(a.getWidth()).toBe(50);
        expect(b.getWidth()).toBe(60);
    });

    it('fills every child to the inner width when stretching', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox({ stretching: true }));
        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 60, height: 40 } });

        host.addComponent(a);
        host.addComponent(b);

        const innerWidth = host.getInnerSize()!.width;

        host.doLayout();

        expect(a.getWidth()).toBe(innerWidth);
        expect(b.getWidth()).toBe(innerWidth);
    });

    it('splits leftover vertical slack roughly in proportion to weight', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox());
        const a = new Component({ preferredSize: { width: 50, height: 0 } });
        const b = new Component({ preferredSize: { width: 50, height: 0 } });

        const w1 = Object.assign(new LayoutConstraints(), { weight: 1 });
        const w2 = Object.assign(new LayoutConstraints(), { weight: 2 });

        host.addComponent(a, w1);
        host.addComponent(b, w2);

        host.doLayout();

        // Relational: a weight-2 cell gets ~2x the height of a weight-1 cell.
        expect(b.getHeight()).toBeCloseTo(a.getHeight() * 2, 5);
    });
});
