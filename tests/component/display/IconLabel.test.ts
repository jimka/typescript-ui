// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IconLabel } from '~/component/display/IconLabel';
import { HBox } from '~/layout/HBox';
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

describe('IconLabel child wiring', () => {
    it('builds a leading Glyph for the constructor name', () => {
        const il = new IconLabel('unicode-arrow-up', 'Email', 'field-1');

        expect(il.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-up');
    });
    it('builds a trailing Label with the constructor text and for-id', () => {
        const il = new IconLabel('unicode-arrow-up', 'Email', 'field-1');

        expect(il.getLabelComponent().getText()).toBe('Email');
        expect(il.getLabelComponent().getForId()).toBe('field-1');
    });
});

describe('IconLabel setGlyph replace', () => {
    it('swaps in a fresh Glyph for the new name at index 0', () => {
        const il = new IconLabel('unicode-arrow-up', 'X', 'field-1');

        il.setGlyph('unicode-arrow-down');

        expect(il.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-down');

        const kids = (il as unknown as { getComponents(): unknown[] }).getComponents();

        expect(kids[0]).toBe(il.getGlyphComponent());
    });
});

describe('IconLabel setText / setForId', () => {
    it('updates the trailing label text', () => {
        const il = new IconLabel('unicode-arrow-up', 'Old', 'field-1');

        il.setText('New');

        expect(il.getLabelComponent().getText()).toBe('New');
    });
    it('updates the label for-id association', () => {
        const il = new IconLabel('unicode-arrow-up', 'X', 'field-1');

        il.setForId('field-2');

        expect(il.getLabelComponent().getForId()).toBe('field-2');
    });
});

describe('IconLabel gap', () => {
    it('defaults the HBox component spacing to 2', () => {
        const il = new IconLabel('unicode-arrow-up', 'X', 'field-1');

        expect((il.getLayoutManager() as HBox).getComponentSpacing()).toBe(2);
    });
    it('applies a { gap } option', () => {
        const il = new IconLabel('unicode-arrow-up', 'X', 'field-1', { gap: 6 });

        expect((il.getLayoutManager() as HBox).getComponentSpacing()).toBe(6);
    });
    it('updates spacing via setGap', () => {
        const il = new IconLabel('unicode-arrow-up', 'X', 'field-1');

        il.setGap(9);

        expect((il.getLayoutManager() as HBox).getComponentSpacing()).toBe(9);
    });
});

describe('IconLabel options precedence', () => {
    it('lets bag glyph/text/forId win over the positional arguments', () => {
        const il = new IconLabel('unicode-arrow-up', 'pos', 'pos-id', {
            glyph: 'unicode-arrow-down',
            text:  'bag',
            forId: 'bag-id',
        });

        expect(il.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-down');
        expect(il.getLabelComponent().getText()).toBe('bag');
        expect(il.getLabelComponent().getForId()).toBe('bag-id');
    });
});
