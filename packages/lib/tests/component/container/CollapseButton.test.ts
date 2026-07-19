import { describe, it, expect, afterEach } from 'vitest';
import { CollapseButton } from '~/component/container/CollapseButton';
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

describe('CollapseButton direction', () => {
    afterEach(() => DOM.reset());

    it('defaults the direction to east', () => {
        installTestDOM(CONFIG);

        expect(new CollapseButton().getDirection()).toBe('east');
    });

    it('round-trips the direction option', () => {
        installTestDOM(CONFIG);

        expect(new CollapseButton({ direction: 'north' }).getDirection()).toBe('north');
    });

    it('round-trips setDirection and stays chainable', () => {
        installTestDOM(CONFIG);

        const button = new CollapseButton();

        expect(button.setDirection('south')).toBe(button);
        expect(button.getDirection()).toBe('south');
    });
});

describe('CollapseButton stripMode', () => {
    afterEach(() => DOM.reset());

    it('toggles stripMode without throwing and stays chainable', () => {
        installTestDOM(CONFIG);

        const button = new CollapseButton();

        // The width write is a CSS-rule side effect; the contract worth
        // asserting offline is no-throw + chainable `this` return.
        expect(button.setStripMode(true)).toBe(button);
        expect(button.setStripMode(false)).toBe(button);
    });
});

describe('CollapseButton collapse listener', () => {
    afterEach(() => DOM.reset());

    it('registers a collapse listener chainably', () => {
        installTestDOM(CONFIG);

        const button = new CollapseButton();

        // The collapse event fires on a real `dblclick` DOM event, which the
        // recording sink records rather than dispatching to the window-level
        // handler — so the firing path needs a real browser (Tier 3). Offline we
        // assert the listener API is chainable and accepts both the `on`
        // registration and the constructor `listeners` bag without throwing.
        expect(button.on('collapse', () => {})).toBe(button);

        expect(() => new CollapseButton({ listeners: { collapse: () => {} } })).not.toThrow();
    });
});
