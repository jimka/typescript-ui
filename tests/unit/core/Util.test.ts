// Util mixes pure string/UUID helpers with DOM-backed text measurement. The
// pure helpers need no harness; the measurement helpers delegate to DOM.source
// and become deterministic under installTestDOM with a baked font table.
import { describe, it, expect, afterEach } from 'vitest';
import { Util } from '~/core/Util';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

// Pin the theme vars the measurement helpers read so the fallbacks never apply:
// --ts-ui-font-size drives rootFontSizePx, --ts-ui-line-padding drives the
// leading. The single baked font (ascent 13, descent 3) backs measureText.
const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {
        '--ts-ui-font-size':    '14px',
        '--ts-ui-line-padding': '2px',
    },
};

describe('Util.kebabToCamel', () => {
    it('converts hyphenated identifiers to camelCase', () => {
        expect(Util.kebabToCamel('border-top-width')).toBe('borderTopWidth');
    });

    it('leaves a no-hyphen string unchanged', () => {
        expect(Util.kebabToCamel('width')).toBe('width');
    });

    it('leaves a trailing hyphen (no following letter) untouched', () => {
        expect(Util.kebabToCamel('foo-')).toBe('foo-');
    });

    it('leaves a leading hyphen (no preceding letter group) — uppercases the first letter', () => {
        // The regex matches "-b", replacing it with "B".
        expect(Util.kebabToCamel('-bar')).toBe('Bar');
    });
});

describe('Util.isInteger', () => {
    it('delegates to Number.isInteger', () => {
        expect(Util.isInteger(5)).toBe(true);
        expect(Util.isInteger(5.5)).toBe(false);
        expect(Util.isInteger('5' as unknown as Object)).toBe(false);
    });
});

describe('Util.generateUUID', () => {
    it('matches the UUID v4 shape', () => {
        const uuid = Util.generateUUID();

        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('never produces a leading digit (documented contract)', () => {
        for (let i = 0; i < 500; i += 1) {
            expect(Util.generateUUID()).toMatch(/^[^0-9]/);
        }
    });
});

describe('Util text measurement (jsdom + harness)', () => {
    afterEach(() => {
        Util.invalidateTextMetricsCache();
        DOM.reset();
    });

    it('lineHeightPx returns the bare font size when linePadding is false', () => {
        installTestDOM(CONFIG);

        expect(Util.lineHeightPx({ fontSizePx: 14, linePadding: false })).toBe(14);
    });

    it('lineHeightPx adds an explicit numeric padding (round(14 + 4))', () => {
        installTestDOM(CONFIG);

        expect(Util.lineHeightPx({ fontSizePx: 14, linePadding: 4 })).toBe(18);
    });

    it('lineHeightPx adds the theme line padding by default (14 + 2)', () => {
        installTestDOM(CONFIG);

        // Default linePadding === true adds --ts-ui-line-padding (2px here).
        expect(Util.lineHeightPx({ fontSizePx: 14 })).toBe(16);
    });

    it('measureTextBaseline equals round(gap/2 + ascent) derived from the line box', () => {
        installTestDOM(CONFIG);

        // lineHeightPx() (no args) = rootFontSize(14) + linePadding(2) = 16.
        // gap = 16 - (ascent 13 + descent 3) = 0 -> baseline = round(0/2 + 13) = 13.
        const lineBox = Util.lineHeightPx();
        const gap = lineBox - (13 + 3);
        const expected = Math.round(gap / 2 + 13);

        expect(Util.measureTextBaseline()).toBe(expected);
        expect(Util.measureTextBaseline()).toBe(13);
    });

    it('measureTextWidth sums per-character advances from the baked font', () => {
        installTestDOM(CONFIG);

        // Relational: two characters are wider than one (advances are positive).
        // 'x' is a baked glyph with a positive integer advance.
        const one = Util.measureTextWidth('x');
        const two = Util.measureTextWidth('xx');

        expect(two).toBeGreaterThan(one);
        expect(two).toBe(one * 2);
    });

    it('re-reads correctly after invalidateTextMetricsCache (-1 sentinel)', () => {
        installTestDOM(CONFIG);

        const before = Util.measureTextBaseline();

        Util.invalidateTextMetricsCache();

        const after = Util.measureTextBaseline();

        expect(after).toBe(before);
    });
});
