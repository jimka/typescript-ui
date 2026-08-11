//
// Coverage for CellText.ts: buildCellRenderer (the variant-to-renderer
// factory promoted out of DynamicCell) and CellTextResolver (the owner-held
// pool of unmounted renderers non-cell call sites format values through).
// Renderers mint DOM.sink elements at construction, so the offline harness
// is installed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { buildCellRenderer, CellTextResolver } from '~/component/table/cell/CellText';
import { NumberRenderer } from '~/component/table/cell/renderer/Number';
import { DateRenderer } from '~/component/table/cell/renderer/Date';
import { TimeRenderer } from '~/component/table/cell/renderer/Time';
import { DateTimeRenderer } from '~/component/table/cell/renderer/DateTime';
import { ComboRenderer } from '~/component/table/cell/renderer/Combo';
import { GlyphRenderer } from '~/component/table/cell/renderer/Glyph';
import { StringRenderer } from '~/component/table/cell/renderer/String';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('buildCellRenderer', () => {
    it('defaults a number renderer to right-aligned; an explicit "left" wins', () => {
        const right = buildCellRenderer('number', false) as any;
        const left  = buildCellRenderer('number', false, 'left') as any;

        expect(right).toBeInstanceOf(NumberRenderer);
        expect(right._text.getTextAlign()).toBe('right');
        expect(left._text.getTextAlign()).toBe('left');
    });

    it('returns the matching class for date, time, datetime, combo, and glyph', () => {
        expect(buildCellRenderer('date',    false)).toBeInstanceOf(DateRenderer);
        expect(buildCellRenderer('time',    false)).toBeInstanceOf(TimeRenderer);
        expect(buildCellRenderer('datetime', false)).toBeInstanceOf(DateTimeRenderer);
        expect(buildCellRenderer('combo',   false)).toBeInstanceOf(ComboRenderer);
        expect(buildCellRenderer('glyph',   false)).toBeInstanceOf(GlyphRenderer);
    });

    it('falls back to StringRenderer for string, auto, and an unrecognised variant', () => {
        expect(buildCellRenderer('string', false)).toBeInstanceOf(StringRenderer);
        expect(buildCellRenderer('auto',   false)).toBeInstanceOf(StringRenderer);
        expect(buildCellRenderer('mystery' as any, false)).toBeInstanceOf(StringRenderer);
    });
});

describe('CellTextResolver', () => {
    it('resolves a combo value against the supplied option list', () => {
        const resolver = new CellTextResolver();

        expect(resolver.text('combo', false, [{ value: 'qa', label: 'QA Engineer' }], 'qa'))
            .toBe('QA Engineer');

        resolver.dispose();
    });

    it('reuses one renderer instance per variant — no per-value allocation', () => {
        const resolver = new CellTextResolver();

        resolver.text('string', false, undefined, 'a');
        const first  = (resolver as any)._renderers.get('string');
        resolver.text('string', false, undefined, 'b');
        const second = (resolver as any)._renderers.get('string');

        expect(first).toBe(second);
        expect((resolver as any)._renderers.size).toBe(1);

        resolver.dispose();
    });

    it('switching the combo option list between calls re-resolves against the new list', () => {
        const resolver = new CellTextResolver();

        expect(resolver.text('combo', false, [{ value: 'dev', label: 'Developer' }], 'dev'))
            .toBe('Developer');
        expect(resolver.text('combo', false, [{ value: 'dev', label: 'Software Engineer' }], 'dev'))
            .toBe('Software Engineer');

        resolver.dispose();
    });

    it('showSeconds true/false key different cached renderers, each matching its own TimeRenderer output', () => {
        const resolver = new CellTextResolver();
        const SAMPLE    = new Date(2021, 4, 17, 13, 45, 9);

        const withSeconds = resolver.text('time', true, undefined, SAMPLE);
        const noSeconds    = resolver.text('time', false, undefined, SAMPLE);

        expect(withSeconds).not.toBe(noSeconds);

        const refWith = new TimeRenderer(true);
        refWith.setValue(SAMPLE);
        const refWithout = new TimeRenderer(false);
        refWithout.setValue(SAMPLE);

        expect(withSeconds).toBe(refWith.getDisplayText());
        expect(noSeconds).toBe(refWithout.getDisplayText());

        resolver.dispose();
    });

    it('dispose() empties the cache; a later text() call rebuilds rather than throwing', () => {
        const resolver = new CellTextResolver();

        resolver.text('string', false, undefined, 'a');
        resolver.dispose();

        expect((resolver as any)._renderers.size).toBe(0);
        expect(() => resolver.text('string', false, undefined, 'b')).not.toThrow();
        expect(resolver.text('string', false, undefined, 'b')).toBe('b');

        resolver.dispose();
    });
});
