import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IconText } from '~/component/display/IconText';
import { HBox } from '~/layout/HBox';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Diagnostics } from '~/core/Diagnostics';
import { _ruleCacheKeys } from '~/core/StyleTarget';

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

describe('IconText setGlyph rename', () => {
    it('renames the glyph in place', () => {
        const it = new IconText('unicode-arrow-up', 'X');
        const glyph = it.getGlyphComponent();

        it.setGlyph('unicode-arrow-down');

        expect(it.getGlyphComponent()).toBe(glyph);
        expect(it.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-down');
    });
    it('keeps the renamed glyph at index 0', () => {
        const it = new IconText('unicode-arrow-up', 'X');

        it.setGlyph('unicode-arrow-down');

        const kids = (it as unknown as { getComponents(): unknown[] }).getComponents();

        expect(kids[0]).toBe(it.getGlyphComponent());
    });

    // Mirrors TreeCellRenderer.test.ts's C10 round-trip measure — the same two
    // exact, deterministic quantities, run twice so the first pass absorbs the
    // shared class-tier rules no instance's dispose() is meant to reclaim.
    it('strands neither a component nor a stylesheet rule across a glyph round trip', () => {
        const liveComponents = (): number => {
            const counters = Diagnostics.counters();

            return counters.componentsConstructed - counters.componentsDestroyed;
        };

        const driveGlyphs = (): void => {
            const it = new IconText('unicode-arrow-up', 'X');

            it.getElement(true);
            it.setGlyph('unicode-arrow-down');
            it.setGlyph('unicode-arrow-left');
            it.setGlyph('unicode-arrow-right');
            it.dispose();
        };

        driveGlyphs();

        const components = liveComponents();
        const rules      = _ruleCacheKeys().length;

        driveGlyphs();

        expect(liveComponents()).toBe(components);
        expect(_ruleCacheKeys().length).toBe(rules);
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

    it('builds the bag glyph once rather than constructing and discarding a positional one', () => {
        const before = Diagnostics.counters().componentsConstructed;

        const it = new IconText('unicode-arrow-up', 'pos', {
            glyph: 'unicode-arrow-down',
            text:  'bag',
        });

        // The IconText, its Glyph and its Text — not a fourth, discarded Glyph.
        expect(Diagnostics.counters().componentsConstructed - before).toBe(3);
        expect(it.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-down');
        expect(it.getTextComponent().getText()).toBe('bag');
    });
});
