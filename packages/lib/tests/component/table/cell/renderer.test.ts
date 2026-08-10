//
// Cached-value seam coverage for the six cell renderers. Each renderer builds a
// Text (or Glyph) child in its constructor that mints a DOM.sink element, so
// the offline harness is installed. We assert the cache contract
// (getValue round-trips, null-vs-zero) and the display string RELATIONALLY for
// temporal renderers — compared against the same toLocale* call, never a
// hard-coded locale literal. Rendered text is read off the private `_text`
// child via getText() (StringRenderer exposes a public getText()).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { NumberRenderer } from '~/component/table/cell/renderer/Number';
import { DateRenderer } from '~/component/table/cell/renderer/Date';
import { TimeRenderer } from '~/component/table/cell/renderer/Time';
import { DateTimeRenderer } from '~/component/table/cell/renderer/DateTime';
import { GlyphRenderer } from '~/component/table/cell/renderer/Glyph';
import { expectNoSelfReschedule } from '../../../helpers/layoutStability';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Reads the rendered text off a renderer's `_text` child. */
function renderedText(renderer: unknown): string {
    return (renderer as any)._text.getText();
}

/** Reads the text alignment off a renderer's `_text` child. */
function renderedAlign(renderer: unknown): string | null {
    return (renderer as any)._text.getTextAlign();
}

describe('StringRenderer', () => {
    it('a fresh renderer caches null', () => {
        expect(new StringRenderer().getValue()).toBe(null);
    });

    it('setValue(null) and setValue(undefined) both normalise to null and render empty', () => {
        const r = new StringRenderer();

        r.setValue('seed');
        r.setValue(null);
        expect(r.getValue()).toBe(null);
        expect(renderedText(r)).toBe('');

        r.setValue('seed');
        r.setValue(undefined as any);
        expect(r.getValue()).toBe(null);
        expect(renderedText(r)).toBe('');
    });

    it('setValue round-trips the exact string', () => {
        const r = new StringRenderer();

        r.setValue('hello');
        expect(r.getValue()).toBe('hello');
        expect(renderedText(r)).toBe('hello');
    });

    it('distinguishes an empty cell (cache null) from a rendered empty string', () => {
        const r = new StringRenderer();

        // Rendered "" with cache still null is the empty-cell state.
        expect(r.getValue()).toBe(null);
        expect(renderedText(r)).toBe('');
    });

    it('exposes the underlying Text via getText()', () => {
        const r = new StringRenderer();

        expect(r.getText()).toBe((r as any)._text);
    });

    it('a settled renderer does not re-schedule its own layout (relayout-loop guard)', () => {
        // CellRenderer.doLayout syncs the Text child's line-height to the cell
        // height every pass; before the setLineHeight idempotency guard that
        // re-armed the layout flush forever (a silent CPU-pinning relayout loop
        // on every table/StringRenderer-bearing panel). A settled renderer laid
        // out once more with no state change must dirty nothing.
        const r = new StringRenderer();
        r.setValue('hello');
        r.getElement(true);
        r.setWidth(120);
        r.setHeight(24);

        expectNoSelfReschedule(r as unknown as {
            flushLayout(): unknown; doLayout(): unknown; scheduleLayout(): unknown;
        });
    });
});

describe('NumberRenderer null-vs-zero contract', () => {
    it('a fresh renderer caches null', () => {
        expect(new NumberRenderer().getValue()).toBe(null);
    });

    it('defaults to right-aligned; DynamicCell requests "left" explicitly', () => {
        expect(renderedAlign(new NumberRenderer())).toBe('right');
        expect(renderedAlign(new NumberRenderer('left'))).toBe('left');
    });

    it('setValue(0) caches 0, NOT null, and renders the literal "0"', () => {
        // CONTRACT (JSDoc): the cache must distinguish empty (null) from zero.
        const r = new NumberRenderer();

        r.setValue(0);
        expect(r.getValue()).toBe(0);
        expect(renderedText(r)).toBe('0');
    });

    it('setValue(null/undefined) normalises to null and renders empty', () => {
        const r = new NumberRenderer();

        r.setValue(5);
        r.setValue(null);
        expect(r.getValue()).toBe(null);
        expect(renderedText(r)).toBe('');
    });

    it('renders -1, NaN, and Infinity via String(value) — never "null"/"undefined"', () => {
        // CONTRACT (JSDoc): "every other value (including 0, -1, NaN, Infinity)
        // goes through String(value)".
        const r = new NumberRenderer();

        r.setValue(-1);
        expect(r.getValue()).toBe(-1);
        expect(renderedText(r)).toBe('-1');

        r.setValue(NaN);
        expect(Object.is(r.getValue(), NaN)).toBe(true);
        expect(renderedText(r)).toBe('NaN');

        r.setValue(Infinity);
        expect(r.getValue()).toBe(Infinity);
        expect(renderedText(r)).toBe('Infinity');
    });
});

describe('DateRenderer / TimeRenderer / DateTimeRenderer (relational format)', () => {
    const SAMPLE = new Date(2021, 4, 17, 13, 45, 9);

    it('DateRenderer returns the exact Date instance and renders toLocaleDateString', () => {
        const r = new DateRenderer();

        r.setValue(SAMPLE);
        expect(r.getValue()).toBe(SAMPLE);
        expect(renderedText(r)).toBe(SAMPLE.toLocaleDateString());
    });

    it('DateRenderer setValue(null) caches null and renders empty', () => {
        const r = new DateRenderer();

        r.setValue(SAMPLE);
        r.setValue(null);
        expect(r.getValue()).toBe(null);
        expect(renderedText(r)).toBe('');
    });

    it('TimeRenderer(false) renders hour:minute; TimeRenderer(true) is longer/different', () => {
        const noSecs   = new TimeRenderer(false);
        const withSecs = new TimeRenderer(true);

        noSecs.setValue(SAMPLE);
        withSecs.setValue(SAMPLE);

        expect(renderedText(noSecs))
            .toBe(SAMPLE.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
        expect(renderedText(withSecs))
            .toBe(SAMPLE.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        expect(renderedText(withSecs)).not.toBe(renderedText(noSecs));
    });

    it('DateTimeRenderer(false) vs (true): seconds toggle drives the longer form', () => {
        const noSecs   = new DateTimeRenderer(false);
        const withSecs = new DateTimeRenderer(true);

        noSecs.setValue(SAMPLE);
        withSecs.setValue(SAMPLE);

        expect(renderedText(noSecs))
            .toBe(SAMPLE.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
        expect(renderedText(withSecs))
            .toBe(SAMPLE.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        expect(renderedText(withSecs)).not.toBe(renderedText(noSecs));
    });

    it('DateTimeRenderer returns the exact Date instance set', () => {
        const r = new DateTimeRenderer();

        r.setValue(SAMPLE);
        expect(r.getValue()).toBe(SAMPLE);
    });
});

describe('GlyphRenderer add/remove/idempotent', () => {
    // "unicode-arrow-up" is a built-in char glyph registered eagerly by Glyphs,
    // so no test-side registration is needed and Glyph construction won't throw.
    const NAME  = 'unicode-arrow-up';
    const OTHER = 'unicode-arrow-down';

    function glyphChildCount(r: unknown): number {
        return (r as any).getComponents().length;
    }

    it('a fresh renderer caches null and has no glyph child', () => {
        const r = new GlyphRenderer();

        expect(r.getValue()).toBe(null);
        expect(glyphChildCount(r)).toBe(0);
    });

    it('falsy / null / undefined / empty-string leave no glyph and cache null', () => {
        const r = new GlyphRenderer();

        r.setValue(null);
        expect(r.getValue()).toBe(null);
        expect(glyphChildCount(r)).toBe(0);

        r.setValue('' as any);
        expect(r.getValue()).toBe(null);
        expect(glyphChildCount(r)).toBe(0);

        r.setValue(undefined as any);
        expect(r.getValue()).toBe(null);
        expect(glyphChildCount(r)).toBe(0);
    });

    it('a registry name caches that name and adds one glyph child', () => {
        const r = new GlyphRenderer();

        r.setValue(NAME);
        expect(r.getValue()).toBe(NAME);
        expect(glyphChildCount(r)).toBe(1);
    });

    it('setting the same name twice does not rebuild the glyph (idempotent)', () => {
        // CONTRACT: the `next === this._value && (...)` early return keeps the
        // existing Glyph instance.
        const r = new GlyphRenderer();

        r.setValue(NAME);
        const first = (r as any)._glyph;

        r.setValue(NAME);
        expect((r as any)._glyph).toBe(first);
        expect(glyphChildCount(r)).toBe(1);
    });

    it('switching name removes the old glyph and adds the new one', () => {
        const r = new GlyphRenderer();

        r.setValue(NAME);
        const first = (r as any)._glyph;

        r.setValue(OTHER);
        expect(r.getValue()).toBe(OTHER);
        expect((r as any)._glyph).not.toBe(first);
        expect(glyphChildCount(r)).toBe(1);
    });

    it('clearing a set glyph removes the child', () => {
        const r = new GlyphRenderer();

        r.setValue(NAME);
        r.setValue(null);
        expect(r.getValue()).toBe(null);
        expect(glyphChildCount(r)).toBe(0);
    });
});
