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

    it('honours an explicit lineHeight, splitting the surplus into the baseline', () => {
        installTestDOM(CONFIG);

        // ascent 13, descent 3 -> font box 16. A 21px line box has 5px of
        // surplus over the font box; production splits it evenly above and
        // below, so the baseline drops by half: round(5/2 + 13) = 16.
        const m = DOM.source.measureText('Hello', { lineHeight: '21px' });

        expect(m.height).toBe(21);
        expect(m.baseline).toBe(16);
    });

    it('falls back to the font box when lineHeight is absent or unparseable', () => {
        installTestDOM(CONFIG);

        const withoutOption = DOM.source.measureText('Hello');
        const unparseable   = DOM.source.measureText('Hello', { lineHeight: 'normal' });

        expect(withoutOption.height).toBe(16);
        expect(withoutOption.baseline).toBe(13);
        expect(unparseable.height).toBe(16);
        expect(unparseable.baseline).toBe(13);
    });
});
