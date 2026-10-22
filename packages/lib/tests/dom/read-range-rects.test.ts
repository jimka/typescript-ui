// @vitest-environment jsdom
//
// Coverage for `DOMSource.readRangeRects()` — the read-side named escape that
// measures a text range a foreign live widget builds — against the REAL
// production source (the `jsdom` pragma keeps `tests/setup/node-setup.ts` from
// installing the modelled DOM, mirroring `read-document-selection.test.ts`),
// and against the modelled source via `installTestDOM`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM, ProductionDOMSource } from '~/core/DOM';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

afterEach(() => {
    DOM.reset();
    document.body.replaceChildren();
});

describe('ProductionDOMSource.readRangeRects', () => {
    const source = new ProductionDOMSource();

    it('gives back the range\'s client rectangles as plain rectangles with every edge copied', () => {
        const rects = source.readRangeRects(() => ({
            getClientRects: () => [
                { x: 10, y: 20, left: 10, top: 20, right: 60, bottom: 40, width: 50, height: 20 },
                { x: 10, y: 44, left: 10, top: 44, right: 30, bottom: 64, width: 20, height: 20 },
            ],
        }) as unknown as Range);

        expect(rects).toEqual([
            { x: 10, y: 20, left: 10, top: 20, right: 60, bottom: 40, width: 50, height: 20 },
            { x: 10, y: 44, left: 10, top: 44, right: 30, bottom: 64, width: 20, height: 20 },
        ]);
    });

    it('returns no rectangles when build returns no range', () => {
        expect(source.readRangeRects(() => null)).toEqual([]);
    });

    it('returns no rectangles, without throwing, for a range with no geometry (jsdom)', () => {
        expect(source.readRangeRects(() => document.createRange())).toEqual([]);
    });
});

describe('ModelledDOMSource.readRangeRects', () => {
    it('returns no rectangles without calling build: the modelled document has no ranges', () => {
        installTestDOM({
            rootMountOffset: { x: 0, y: 0 }, viewport: { width: 1280, height: 800 }, scrollBarWidth: 15, fontMetrics, themeVars: {},
        });

        const build = vi.fn(() => null);

        expect(DOM.source.readRangeRects(build)).toEqual([]);
        expect(build).not.toHaveBeenCalled();
    });
});
