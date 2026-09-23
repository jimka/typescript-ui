import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IconLabel } from '~/component/display/IconLabel';
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

describe('IconLabel setGlyph rename', () => {
    it('renames the glyph in place, keeping it at index 0', () => {
        const il = new IconLabel('unicode-arrow-up', 'X', 'field-1');
        const glyph = il.getGlyphComponent();

        il.setGlyph('unicode-arrow-down');

        expect(il.getGlyphComponent()).toBe(glyph);
        expect(il.getGlyphComponent().getGlyphName()).toBe('unicode-arrow-down');

        const kids = (il as unknown as { getComponents(): unknown[] }).getComponents();

        expect(kids[0]).toBe(il.getGlyphComponent());
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
            const il = new IconLabel('unicode-arrow-up', 'X', 'field-1');

            il.getElement(true);
            il.setGlyph('unicode-arrow-down');
            il.setGlyph('unicode-arrow-left');
            il.setGlyph('unicode-arrow-right');
            il.dispose();
        };

        driveGlyphs();

        const components = liveComponents();
        const rules      = _ruleCacheKeys().length;

        driveGlyphs();

        expect(liveComponents()).toBe(components);
        expect(_ruleCacheKeys().length).toBe(rules);
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
