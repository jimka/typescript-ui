import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TabCloseButton } from '~/component/button/TabCloseButton';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('TabCloseButton seeded glyph', () => {
    it('is seeded with the xmark glyph', () => {
        const btn = new TabCloseButton();

        expect(btn.getGlyph()).not.toBe(null);
        expect(btn.getGlyph()!.getGlyphName()).toBe('xmark');
    });
});

describe('TabCloseButton sizing defaults', () => {
    it('defaults the preferred size to 16x16', () => {
        const pref = new TabCloseButton().getPreferredSize()!;

        expect(pref.width).toBe(16);
        expect(pref.height).toBe(16);
    });
    it('defaults insets to zero on every edge', () => {
        const insets = new TabCloseButton().getInsets();

        expect(insets.getTop()).toBe(0);
        expect(insets.getRight()).toBe(0);
        expect(insets.getBottom()).toBe(0);
        expect(insets.getLeft()).toBe(0);
    });
});

describe('TabCloseButton caller glyph precedence', () => {
    it('lets a caller-supplied { glyph } win over the xmark seed', () => {
        // The seed glyph lives in the defaults bag, and Component merges
        // {...defaults, ...options} at dispatch, so a caller glyph overrides it.
        const btn = new TabCloseButton({ glyph: 'unicode-arrow-up' });

        expect(btn.getGlyph()!.getGlyphName()).toBe('unicode-arrow-up');
    });
});
