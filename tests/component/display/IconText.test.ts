import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IconText } from '~/component/display/IconText';
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

describe('IconText child wiring', () => {
    it('builds a leading Glyph for the constructor name', () => {
        const it = new IconText('unicode-arrow-up', 'Up');

        expect(it.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-up');
    });
    it('builds a trailing Text for the constructor label', () => {
        const it = new IconText('unicode-arrow-up', 'Up');

        expect(it.getTextComponent().getText()).toBe('Up');
    });
    it('places the glyph at index 0 and the text at index 1', () => {
        const it = new IconText('unicode-arrow-up', 'Up');
        const kids = (it as unknown as { getComponents(): unknown[] }).getComponents();

        expect(kids[0]).toBe(it.getGlyphComponent());
        expect(kids[1]).toBe(it.getTextComponent());
    });
});

describe('IconText setGlyph replace', () => {
    it('swaps in a fresh Glyph for the new name', () => {
        const it = new IconText('unicode-arrow-up', 'X');

        it.setGlyph('unicode-arrow-down');

        expect(it.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-down');
    });
    it('keeps the replacement glyph at index 0', () => {
        const it = new IconText('unicode-arrow-up', 'X');

        it.setGlyph('unicode-arrow-down');

        const kids = (it as unknown as { getComponents(): unknown[] }).getComponents();

        expect(kids[0]).toBe(it.getGlyphComponent());
    });
});

describe('IconText setText', () => {
    it('updates the trailing text component', () => {
        const it = new IconText('unicode-arrow-up', 'Old');

        it.setText('New');

        expect(it.getTextComponent().getText()).toBe('New');
    });
});

describe('IconText gap', () => {
    it('defaults the HBox component spacing to 2', () => {
        const it = new IconText('unicode-arrow-up', 'X');

        expect((it.getLayoutManager() as HBox).getComponentSpacing()).toBe(2);
    });
    it('applies a { gap } option', () => {
        const it = new IconText('unicode-arrow-up', 'X', { gap: 8 });

        expect((it.getLayoutManager() as HBox).getComponentSpacing()).toBe(8);
    });
    it('updates spacing via setGap', () => {
        const it = new IconText('unicode-arrow-up', 'X');

        it.setGap(10);

        expect((it.getLayoutManager() as HBox).getComponentSpacing()).toBe(10);
    });
});

describe('IconText options precedence', () => {
    it('lets bag glyph/text win over the positional arguments', () => {
        const it = new IconText('unicode-arrow-up', 'pos', {
            glyph: 'unicode-arrow-down',
            text:  'bag',
        });

        expect(it.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-down');
        expect(it.getTextComponent().getText()).toBe('bag');
    });
});
