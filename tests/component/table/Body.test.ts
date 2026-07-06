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
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Body, resolveClickedColumn } from '~/component/table/Body';
import type { CellClickEvent } from '~/component/table/Body';
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

// ---------------------------------------------------------------------------
// Virtual-scroll reconciliation characterization (Phase A of the data-view
// virtualization consolidation). These pin the current behaviour of the shared
// window/pool/geometry machinery so the extraction of `VirtualRowView` is a
// proven no-op. They poke privates (`_rowPool`, `_rowGeom`, `computeVisibleWindow`,
// …) via a cast, mirroring the established white-box pattern in this file.
// ---------------------------------------------------------------------------
async function bodyWith(rowCount: number, height: number): Promise<{ b: Body; recs: ReturnType<MemoryStore['getAll']> }> {
    const store = new MemoryStore(MODEL, Array.from({ length: rowCount }, (_, i) => ({ a: String(i) })));
    await store.load();

    const b = new Body(store);
    b.getElement(true);          // materialise → init() builds the scroller + first render
    b.setWidth(300);
    b.setHeight(height);
    (b as any).renderWindow(300, [100, 100, 100]);

    return { b, recs: store.getAll() };
}

describe('Body virtual-scroll — computeVisibleWindow', () => {
    it('starts at row 0 and pads the visible span by SCROLL_BUFFER at the top', async () => {
        const { b } = await bodyWith(100, 240);
        const p = b as any;
        const rh = p._rowHeight;

        const win = p.computeVisibleWindow(0, 240, 100);

        expect(win.firstRow).toBe(0);
        expect(win.lastRow).toBe(Math.min(99, Math.ceil(240 / rh) + 2));
        expect(win.windowSize).toBe(win.lastRow - win.firstRow + 1);
    });

    it('pads both edges by SCROLL_BUFFER mid-scroll', async () => {
        const { b } = await bodyWith(100, 240);
        const p = b as any;
        const rh = p._rowHeight;
        const scrollY = 20 * rh;

        const win = p.computeVisibleWindow(scrollY, 240, 100);

        expect(win.firstRow).toBe(Math.max(0, Math.floor(scrollY / rh) - 2));
        expect(win.lastRow).toBe(Math.min(99, Math.ceil((scrollY + 240) / rh) + 2));
    });

    it('clamps lastRow to the final data index near the bottom', async () => {
        const { b } = await bodyWith(30, 240);
        const p = b as any;
        const rh = p._rowHeight;

        const win = p.computeVisibleWindow(1000 * rh, 240, 30);

        expect(win.lastRow).toBe(29);
    });

    it('reports an empty window for an empty store', async () => {
        const { b } = await bodyWith(0, 240);
        const p = b as any;

        const win = p.computeVisibleWindow(0, 240, 0);

        expect(win.windowSize).toBe(0);
    });
});

describe('Body virtual-scroll — computePoolTarget', () => {
    it('grows to the max possible window capped at totalRows and never below windowSize', async () => {
        const { b } = await bodyWith(100, 240);
        const p = b as any;
        const rh = p._rowHeight;

        const target = p.computePoolTarget(5, 240, 100);

        expect(target).toBe(Math.min(100, Math.max(5, Math.ceil(240 / rh) + 2 * 2 + 2)));

        // Small dataset: cap at totalRows, still ≥ windowSize.
        expect(p.computePoolTarget(4, 240, 4)).toBe(4);
    });
});

describe('Body virtual-scroll — growRowPool', () => {
    it('extends every parallel array in lockstep and is monotonic', async () => {
        const { b } = await bodyWith(200, 240);
        const p = b as any;
        const before = p._rowPool.length;

        p.growRowPool(before + 5);

        expect(p._rowPool.length).toBe(before + 5);
        expect(p._boundIndices.length).toBe(before + 5);
        expect(p._rowGeom.length).toBe(before + 5);
        expect(p._rowDisplayed.length).toBe(before + 5);
        expect(p._cellGeom.length).toBe(before + 5);

        for (let i = before; i < before + 5; i++) {
            expect(p._boundIndices[i]).toBe(-1);
            expect(p._rowGeom[i]).toBeNull();
            expect(p._rowDisplayed[i]).toBe(false);
            expect(p._cellGeom[i]).toEqual([]);
            // Body's freshly-pooled rows carry cells wired for the visible fields.
            expect(p._rowPool[i].getComponents().length).toBe(3);
        }

        // Monotonic: a smaller target never shrinks the pool.
        p.growRowPool(before);
        expect(p._rowPool.length).toBe(before + 5);
    });
});

describe('Body virtual-scroll — hideExcessPoolRows', () => {
    it('hides and unbinds every slot at or beyond the window size', async () => {
        const { b } = await bodyWith(200, 240);
        const p = b as any;
        const poolLen = p._rowPool.length;

        p.hideExcessPoolRows(2);

        for (let i = 2; i < poolLen; i++) {
            expect(p._rowDisplayed[i]).toBe(false);
            expect(p._boundIndices[i]).toBe(-1);
            expect(p._rowGeom[i]).toBeNull();
        }
    });
});

describe('Body virtual-scroll — invalidateGeom', () => {
    it('clears both the row-geometry and the Body-only cell-geometry caches', async () => {
        const { b } = await bodyWith(50, 240);
        const p = b as any;

        p._rowGeom[0] = { ty: 5, w: 5, h: 5 };
        p._cellGeom[0] = [{ x: 1, w: 1, h: 1 }];

        p.invalidateGeom();

        expect(p._rowGeom.every((g: unknown) => g === null)).toBe(true);
        expect(p._cellGeom.every((c: unknown[]) => Array.isArray(c) && c.length === 0)).toBe(true);
    });
});

describe('Body virtual-scroll — scrollRecordIntoView', () => {
    it('reveals a record below the viewport by scrolling to its bottom edge', async () => {
        const { b, recs } = await bodyWith(100, 100);
        const p = b as any;
        const rh = p._rowHeight;

        (b as any).scrollRecordIntoView(recs[50]);

        expect(p._scroller.getScrollY()).toBe(51 * rh - 100);
    });

    it('leaves the scroll position unchanged when the record is already visible', async () => {
        const { b, recs } = await bodyWith(100, 100);
        const p = b as any;

        (b as any).scrollRecordIntoView(recs[0]);

        expect(p._scroller.getScrollY()).toBe(0);
    });
});

describe('Body selection event', () => {
    it('emits the current selection on select / set / clear', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }, { a: '2' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const recs = store.getAll();
        const seen: number[] = [];
        b.on('selection', (records) => seen.push(records.length));

        b.selectRecord(recs[0]);
        b.setSelectedRecords([recs[0], recs[1]]);
        b.selectRecord(null);

        expect(seen).toEqual([1, 2, 0]);
    });
});

describe('resolveClickedColumn', () => {
    it('returns the index of a cell whose element is the target', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();

        expect(resolveClickedColumn(cells, cells[1].getElement())).toBe(1);
    });

    it('returns the cell index when the target is a descendant of the cell', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();
        // The renderer element lives inside the cell — a click on it must
        // resolve to that cell's column via DOM.source.contains.
        const inner = cells[2].getComponents()[0].getElement();

        expect(resolveClickedColumn(cells, inner)).toBe(2);
    });

    it('returns -1 when the target is outside every cell', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();

        // The row element itself is not one of its cells.
        expect(resolveClickedColumn(cells, row.getElement())).toBe(-1);
    });

    it('returns -1 for a null target', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();

        expect(resolveClickedColumn(cells, null)).toBe(-1);
    });
});

describe('Body cellclick event', () => {
    it('emits a payload matching the clicked cell', async () => {
        const store = new MemoryStore(MODEL, [{ a: 'x', b: 'y', c: 'z' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();
        const rec   = row.getData();

        const seen: CellClickEvent[] = [];
        b.on('cellclick', (e) => seen.push(e));

        // Click column index 1 (field "b").
        (b as any).onRowClick(row, makeEvent(cells[1].getElement(), 'click'));

        expect(seen).toHaveLength(1);
        expect(seen[0].columnIndex).toBe(1);
        expect(seen[0].field).toBe('b');
        expect(seen[0].record).toBe(rec);
        expect(seen[0].value).toBe(rec.get('b'));
        expect(seen[0].rowIndex).toBe((b as any).getVisibleRecords().indexOf(rec));
    });

    it('fires alongside selection, with selection settled first', async () => {
        const store = new MemoryStore(MODEL, [{ a: 'x', b: 'y', c: 'z' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();
        const rec   = row.getData();

        const order: string[] = [];
        b.on('selection', () => order.push('selection'));
        b.on('cellclick',       () => order.push('cellclick'));

        (b as any).onRowClick(row, makeEvent(cells[0].getElement(), 'click'));

        expect(order).toEqual(['selection', 'cellclick']);
        expect(b.getSelectedRecords()).toContain(rec);
    });

    it('reports the live binding after a pool row is rebound to another record', async () => {
        const store = new MemoryStore(MODEL, [{ a: 'first' }, { a: 'second' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const recs  = store.getAll();
        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();

        // Rebind the pool slot to the second record, as a scroll recycle would.
        row.setData(recs[1]);

        const seen: CellClickEvent[] = [];
        b.on('cellclick', (e) => seen.push(e));

        (b as any).onRowClick(row, makeEvent(cells[0].getElement(), 'click'));

        expect(seen[0].record).toBe(recs[1]);
        expect(seen[0].rowIndex).toBe((b as any).getVisibleRecords().indexOf(recs[1]));
    });

    it('does not emit when the click lands outside every cell', async () => {
        const store = new MemoryStore(MODEL, [{ a: 'x' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row = (b as any).getRowPool()[0];

        const seen: CellClickEvent[] = [];
        b.on('cellclick', (e) => seen.push(e));

        // Target is the row element, not a cell.
        (b as any).onRowClick(row, makeEvent(row.getElement(), 'click'));

        expect(seen).toHaveLength(0);
    });
});
