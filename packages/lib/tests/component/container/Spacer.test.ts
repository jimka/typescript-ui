import { describe, it, expect, afterEach } from 'vitest';
import { Spacer } from '~/component/container/Spacer';
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

describe('Spacer flex flags', () => {
    afterEach(() => DOM.reset());

    it('defaults to non-flex with weight 1', () => {
        installTestDOM(CONFIG);

        const spacer = new Spacer({});

        // SpacerOptions documents flex defaulting to false and flexWeight to 1.
        expect(spacer.isFlex()).toBe(false);
        expect(spacer.getFlexWeight()).toBe(1);
    });

    it('round-trips setFlex', () => {
        installTestDOM(CONFIG);

        const spacer = new Spacer({});

        spacer.setFlex(true);

        expect(spacer.isFlex()).toBe(true);

        spacer.setFlex(false);

        expect(spacer.isFlex()).toBe(false);
    });

    it('round-trips setFlexWeight', () => {
        installTestDOM(CONFIG);

        const spacer = new Spacer({});

        spacer.setFlexWeight(3);

        expect(spacer.getFlexWeight()).toBe(3);
    });

    it('honours the flex and flexWeight options', () => {
        installTestDOM(CONFIG);

        const spacer = new Spacer({ flex: true, flexWeight: 2 });

        expect(spacer.isFlex()).toBe(true);
        expect(spacer.getFlexWeight()).toBe(2);
    });

    it('Spacer.flex() builds a flex spacer with the given weight', () => {
        installTestDOM(CONFIG);

        const spacer = Spacer.flex(5);

        expect(spacer.isFlex()).toBe(true);
        expect(spacer.getFlexWeight()).toBe(5);
    });
});
