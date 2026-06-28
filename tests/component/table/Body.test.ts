//
// Horizontal scroll-into-view for the editing column. When a cell is edited
// the body must reveal its column through the shared VirtualScroller — not via
// the browser's native focus-scroll, which shifts only the clipped content
// layer and leaves the header translate + scrollbar thumb behind (the desync
// reported on double-clicking a right-edge cell).
//
// The geometry is offline-faithful: getWidth() answers from committed state via
// the geometry oracle, and the VirtualScroller's scrollX clamp is proven
// offline. The column-width cache (normally filled by the live-geometry render
// tier the offline source zeroes) is injected white-box, mirroring the
// editor.test pattern of poking a private to exercise a real contract.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Body } from '~/component/table/Body';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

const MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
    { name: 'c', type: 'string', order: 2 },
], 'a');

/**
 * Builds a materialised Body sized to `viewportWidth`, with a known per-column
 * width cache and the scroller's content extent pre-clamped, so
 * scrollColumnIntoView runs its geometry against committed state.
 */
function body(viewportWidth: number, colWidths: number[]): Body {
    const store = new MemoryStore(MODEL, []);
    const b     = new Body(store);

    b.getElement(true);          // materialise → init() builds the scroller
    b.setWidth(viewportWidth);   // committed viewport for getWidth()

    const total = colWidths.reduce((s, w) => s + w, 0);
    (b as any)._lastColumnWidths = colWidths;
    (b as any)._scroller.clampToContent(total, 0);

    return b;
}

/** Current horizontal scroll position read off the body's scroller. */
function scrollX(b: Body): number {
    return (b as any)._scroller.getScrollX();
}

describe('Body.scrollColumnIntoView', () => {
    it('scrolls a right-edge column fully into view through the scroll model', () => {
        // Viewport 300, five 100px columns: column 4 spans [400, 500], entirely
        // right of the viewport, so scrollX must advance to right - viewport.
        const b = body(300, [100, 100, 100, 100, 100]);

        (b as any).scrollColumnIntoView(4);

        expect(scrollX(b)).toBe(200);
    });

    it('leaves scrollX unchanged when the column is already fully visible', () => {
        // Column 1 spans [100, 200], inside the 300px viewport at scrollX 0.
        const b = body(300, [100, 100, 100]);

        (b as any).scrollColumnIntoView(1);

        expect(scrollX(b)).toBe(0);
    });

    it('scrolls left when the column sits off the left edge', () => {
        const b = body(300, [100, 100, 100, 100, 100]);
        (b as any)._scroller.setScrollX(200);

        // Column 0 spans [0, 100], now left of the viewport (scrollX 200).
        (b as any).scrollColumnIntoView(0);

        expect(scrollX(b)).toBe(0);
    });

    it('ignores an out-of-range column index', () => {
        const b = body(300, [100, 100, 100]);
        (b as any)._scroller.setScrollX(0);

        (b as any).scrollColumnIntoView(9);

        expect(scrollX(b)).toBe(0);
    });
});

describe('Body selectionchange event', () => {
    it('emits the current selection on select / set / clear', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }, { a: '2' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const recs = store.getAll();
        const seen: number[] = [];
        b.on('selectionchange', (records) => seen.push(records.length));

        b.selectRecord(recs[0]);
        b.setSelectedRecords([recs[0], recs[1]]);
        b.selectRecord(null);

        expect(seen).toEqual([1, 2, 0]);
    });
});
