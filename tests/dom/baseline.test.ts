// Runs in the default `node` environment: no jsdom, no browser. The modelled
// source answers every metric so the text-baseline maths is exercised offline.
import { describe, it, expect, afterEach } from 'vitest';
import { Util } from '~/core/Util';
import { DOM } from '~/core/DOM';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars: {
        '--ts-ui-font-family':  'TestSans',
        '--ts-ui-font-size':    '14px',
        '--ts-ui-line-padding': '2px',
    },
};

describe('Offline text metrics via ModelledDOMSource', () => {
    afterEach(() => {
        DOM.reset();
        Util.invalidateTextMetricsCache();
    });

    it('computes the text baseline from baked metrics without a browser', () => {
        installTestDOM(CONFIG);
        Util.invalidateTextMetricsCache();

        // ascent 13, descent 3 → font box 16; lineHeight = fontSize(14) + pad(2)
        // = 16; gap = 16 - 16 = 0; baseline = round(0 / 2 + 13) = 13.
        const baseline = Util.measureTextBaseline();

        expect(Math.abs(baseline - 13)).toBeLessThanOrEqual(1);
    });

    it('reports a modelled source and the injected environment', () => {
        installTestDOM(CONFIG);

        expect(DOM.source.isModelled()).toBe(true);
        expect(DOM.source.getViewportSize()).toEqual({ width: 1280, height: 800 });
        expect(DOM.source.getScrollBarWidth()).toBe(15);
        expect(DOM.source.getThemeVar('--ts-ui-font-size')).toBe('14px');
    });

    it('measures text width from baked per-character advances', () => {
        installTestDOM(CONFIG);

        // H(10) + e(7) + l(4) + l(4) + o(8) = 33
        const m = DOM.source.measureText('Hello');

        expect(m.width).toBe(33);
        expect(m.baseline).toBe(13);
    });

    it('restores the production source on reset', () => {
        installTestDOM(CONFIG);
        DOM.reset();

        expect(DOM.source.isModelled()).toBe(false);
    });
});
