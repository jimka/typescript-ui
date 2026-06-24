import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Card } from '~/layout/Card';
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

function hostCard(width: number, height: number, card: Card): Container {
    const host = new Container({ layoutManager: card });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('Card setters/getters', () => {
    it('defaults visibleComponentId to null', () => {
        expect(new Card().getVisibleComponentId()).toBe(null);
    });

    it('round-trips setVisibleComponentId', () => {
        const card = new Card();

        card.setVisibleComponentId('abc');

        expect(card.getVisibleComponentId()).toBe('abc');
    });

    it('doLayout() does not throw without a container', () => {
        expect(() => new Card().doLayout()).not.toThrow();
    });
});

describe('Card visibility switching', () => {
    afterEach(() => DOM.reset());

    it('shows exactly the chosen child and hides the rest', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const host = hostCard(200, 150, card);
        const a = new Component({ preferredSize: { width: 10, height: 10 } });
        const b = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(a);
        host.addComponent(b);

        card.setVisibleComponentId(b.getId());

        expect(b.isVisible()).toBe(true);
        expect(a.isVisible()).toBe(false);
    });

    it('flips visibility cleanly when switching to a different id', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const host = hostCard(200, 150, card);
        const a = new Component({ preferredSize: { width: 10, height: 10 } });
        const b = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(a);
        host.addComponent(b);

        card.setVisibleComponentId(b.getId());
        card.setVisibleComponentId(a.getId());

        expect(a.isVisible()).toBe(true);
        expect(b.isVisible()).toBe(false);
    });

    it('sizes the visible child to fill the host inner bounds', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const host = hostCard(200, 150, card);
        const a = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(a);

        card.setVisibleComponentId(a.getId());

        const inner = host.getInnerSize()!;

        host.doLayout();

        expect(a.getWidth()).toBe(inner.width);
        expect(a.getHeight()).toBe(inner.height);
        expect(a.getX()).toBe(0);
        expect(a.getY()).toBe(0);
    });
});
