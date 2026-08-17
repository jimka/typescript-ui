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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Body, resolveClickedColumn, buildTsv, locateCellInGrid } from '~/component/table/Body';
import type { CellClickEvent } from '~/component/table/Body';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { Cell } from '~/component/table/cell/Cell';
import { ComboCell } from '~/component/table/cell/Combo';
import { NumberCell } from '~/component/table/cell/Number';
import type { ColumnConfig } from '~/component/table/ColumnConfig';

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

        for (let i = before; i < before + 5; i++) {
            expect(p._boundIndices[i]).toBe(-1);
            expect(p._rowGeom[i]).toBeNull();
            expect(p._rowDisplayed[i]).toBe(false);
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

describe('Body virtual-scroll — single-row scroll pool rebind', () => {
    // Chrome's paint-flashing overlay lit up rows OUTSIDE the visible
    // viewport on every scroll tick. Root cause: the pool slot a row occupies
    // was mapped to its window-relative position (`firstRow + i`), not
    // recycled by data identity — so a one-row scroll shifted every slot's
    // bound data index by one, forcing every pooled row (including the
    // off-screen SCROLL_BUFFER rows) through a full rebind + reposition each
    // tick. A single row of scroll should touch exactly the one row entering
    // the window; every other pooled row already shows the right data at the
    // right position and must be left untouched.
    it('rebinds and repositions only the row entering the window, not the whole pool', async () => {
        const { b } = await bodyWith(100, 200);
        const p = b as any;
        const rh = p._rowHeight;

        // Scroll to mid-dataset first so the next one-row step isn't absorbed
        // by the top-of-data clamp (`Math.max(0, firstRow - SCROLL_BUFFER)`).
        p._scroller.setScrollY(20 * rh);
        b.renderWindow(300, [100, 100, 100]);

        const pool = p.getRowPool() as Array<{ setData(...args: unknown[]): unknown, setTranslate(...args: unknown[]): unknown }>;
        const setDataSpies      = pool.map((row) => vi.spyOn(row, 'setData'));
        const setTranslateSpies = pool.map((row) => vi.spyOn(row, 'setTranslate'));

        // Exactly one row's worth of scroll: one data index leaves the
        // window and one enters, so exactly one pool slot should rebind.
        p._scroller.setScrollY(21 * rh);
        b.renderWindow(300, [100, 100, 100]);

        const totalRebinds     = setDataSpies.reduce((n, s) => n + s.mock.calls.length, 0);
        const totalRepositions = setTranslateSpies.reduce((n, s) => n + s.mock.calls.length, 0);

        expect(totalRebinds).toBe(1);
        expect(totalRepositions).toBe(1);
    });
});

describe('Body virtual-scroll — invalidateGeom', () => {
    it('clears the row geometry; cell geometry no longer rides along', async () => {
        const { b } = await bodyWith(50, 240);
        const p = b as any;

        // The row half keeps its direct assertion: `invalidateGeom` must clear
        // the row records outright, checked before anything can repopulate them.
        p._rowGeom[0] = { ty: 5, w: 5, h: 5 };

        p.invalidateGeom();

        expect(p._rowGeom.every((g: unknown) => g === null)).toBe(true);

        // The cell half is gone: `Body` no longer overrides `invalidateGeom` to
        // clear a per-cell cache alongside the row one (see
        // `Cell.canSkipUnchangedLayout`). A cell re-placed at unchanged
        // geometry stays skipped even right after `invalidateGeom` — the diff
        // now lives on the cell's own committed rectangle, which
        // `invalidateGeom` has no reach into.
        let layouts = 0;

        b.renderWindow(300, [100, 100, 100]);

        for (const row of p._rowPool as Array<{ getComponents(): Array<{ doLayout(): unknown }> }>) {
            for (const cell of row.getComponents()) {
                cell.doLayout = () => { layouts++; return cell; };
            }
        }

        b.renderWindow(300, [100, 100, 100]);
        expect(layouts).toBe(0);

        p.invalidateGeom();
        b.renderWindow(300, [100, 100, 100]);

        expect(layouts).toBe(0);
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

describe('Body selection event — fires only when the set changes', () => {
    it('selectRecord called twice in a row for the same record fires "selection" once', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }, { a: '2' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const recs = store.getAll();
        let emitted = 0;
        b.on('selection', () => { emitted += 1; });

        b.selectRecord(recs[0]);
        b.selectRecord(recs[0]);

        expect(emitted).toBe(1);
    });

    it('selectRecord(null) on an already-empty selection does not fire', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        let emitted = 0;
        b.on('selection', () => { emitted += 1; });

        b.selectRecord(null);

        expect(emitted).toBe(0);
    });

    it('setSelectedRecords with the same two records reversed does not fire — membership, not order', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }, { a: '2' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const recs = store.getAll();
        b.setSelectedRecords([recs[0], recs[1]]);

        let emitted = 0;
        b.on('selection', () => { emitted += 1; });

        b.setSelectedRecords([recs[1], recs[0]]);

        expect(emitted).toBe(0);
    });

    it('two plain clicks on the same row fire "selection" once, not twice', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row = (b as any).getRowPool()[0];
        let emitted = 0;
        b.on('selection', () => { emitted += 1; });

        (b as any).onRowClick(row, makeEvent(row.getElement(), 'click'));
        (b as any).onRowClick(row, makeEvent(row.getElement(), 'click'));

        expect(emitted).toBe(1);
    });

    it('a ctrl/cmd-click on an unselected row, then a plain click on a different row, fires on both', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }, { a: '2' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const rows = (b as any).getRowPool();
        let emitted = 0;
        b.on('selection', () => { emitted += 1; });

        (b as any).onRowClick(rows[0], makeEvent(rows[0].getElement(), 'click', { ctrlKey: true }));
        (b as any).onRowClick(rows[1], makeEvent(rows[1].getElement(), 'click'));

        expect(emitted).toBe(2);
    });

    it('keyboard row navigation at a boundary does not emit; moving to a different row does', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }, { a: '2' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.selectRecord(store.getAll()[0]);

        let emitted = 0;
        b.on('selection', () => { emitted += 1; });

        (b as any).onKeyDown({ key: 'ArrowUp', preventDefault: () => {} });
        expect(emitted).toBe(0); // already the first row — clamps in place

        (b as any).onKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
        expect(emitted).toBe(1); // moved to a different row — a real change
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

describe('buildTsv', () => {
    const rows = [['Alice', '25', 'NYC'], ['Bob', '30', 'LA']];

    it('formats a whole row with no offsets as tab-separated', () => {
        expect(buildTsv(rows, 0, 0, null, 0, 2, null)).toBe('Alice\t25\tNYC');
    });

    it('formats a cross-row span as row-major, not rectangular', () => {
        expect(buildTsv(rows, 0, 1, null, 1, 1, null)).toBe('25\tNYC\nBob\t30');
    });

    it('trims both boundary cells to the selected characters', () => {
        expect(buildTsv(rows, 0, 0, 2, 0, 1, 1)).toBe('ice\t2');
    });

    it('trims a single-cell selection to the selected characters', () => {
        expect(buildTsv(rows, 0, 0, 2, 0, 0, 4)).toBe('ic');
    });

    it('keeps a boundary cell whole when only its own offset is null', () => {
        expect(buildTsv(rows, 0, 0, null, 0, 1, 1)).toBe('Alice\t2');
    });

    it('quote-wraps a field containing a tab, keeping the tab intact', () => {
        expect(buildTsv([['a\tb', 'c']], 0, 0, null, 0, 1, null)).toBe('"a\tb"\tc');
    });

    it('quote-wraps a field containing a quote, doubling interior quotes', () => {
        expect(buildTsv([['He said "hi"']], 0, 0, null, 0, 0, null)).toBe('"He said ""hi"""');
    });

    it('quote-wraps a field containing a newline, keeping the newline intact', () => {
        expect(buildTsv([['a\nb']], 0, 0, null, 0, 0, null)).toBe('"a\nb"');
    });
});

describe('locateCellInGrid', () => {
    it("returns the grid position of a cell's own element", async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();
        const grid  = [cells.map((c: any) => ({ element: c.getElement()! }))];

        expect(locateCellInGrid(grid, cells[1].getElement()!)).toEqual({ row: 0, col: 1 });
    });

    it('returns the grid position when the target is a descendant of the cell', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();
        const grid  = [cells.map((c: any) => ({ element: c.getElement()! }))];
        const inner = cells[2].getComponents()[0].getElement();

        expect(locateCellInGrid(grid, inner)).toEqual({ row: 0, col: 2 });
    });

    it('returns null when the target is outside every cell in the grid', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row   = (b as any).getRowPool()[0];
        const cells = row.getComponents();
        const grid  = [cells.map((c: any) => ({ element: c.getElement()! }))];

        // The row element itself is not one of its cells.
        expect(locateCellInGrid(grid, row.getElement()!)).toBe(null);
    });
});

describe('Body onCopy / buildSelectionText', () => {
    it('returns undefined and writes nothing when there is no selection', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        // ModelledDOMSource.getDocumentSelection() defaults to null — no stubbing needed.
        const fakeEvent = { clipboardData: { setData: vi.fn() } } as unknown as ClipboardEvent;

        expect((b as any).onCopy(fakeEvent)).toBeUndefined();
        expect(fakeEvent.clipboardData!.setData).not.toHaveBeenCalled();
    });

    it('writes a tab-separated payload and prevents default for a resolved whole-row selection', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const cells = (b as any).getRowPool()[0].getComponents();

        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: cells[0].getElement()!,
            startOffset:    null,
            endContainer:   cells[2].getElement()!,
            endOffset:      null,
        });

        const fakeEvent = { clipboardData: { setData: vi.fn() } } as unknown as ClipboardEvent;

        expect((b as any).onCopy(fakeEvent)).toEqual({ prevent: true });
        expect(fakeEvent.clipboardData!.setData).toHaveBeenCalledOnce();
        expect(fakeEvent.clipboardData!.setData).toHaveBeenCalledWith('text/plain', '1\t2\t3');
    });

    it('returns undefined and writes nothing when the selection resolves outside every rendered cell', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row = (b as any).getRowPool()[0];

        // The row's own element is not one of its cells, so this selection
        // does not resolve to any grid position.
        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: row.getElement()!,
            startOffset:    null,
            endContainer:   row.getElement()!,
            endOffset:      null,
        });

        const fakeEvent = { clipboardData: { setData: vi.fn() } } as unknown as ClipboardEvent;

        expect((b as any).onCopy(fakeEvent)).toBeUndefined();
        expect(fakeEvent.clipboardData!.setData).not.toHaveBeenCalled();
    });

    it('skips a GroupSeparatorCell row spanned by the selection, in a rotated-mode body', async () => {
        const store = new MemoryStore(MODEL, [
            { a: '1', b: '2', c: '3' },
            { a: 'SEP', b: '', c: '' },
            { a: '4', b: '5', c: '6' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setRowSeparator(record => record.get('a') === 'SEP' ? { label: 'SEP', color: null } : null);
        b.renderWindow();

        const rowPool = (b as any).getRowPool();
        const sepRow  = rowPool.find((r: any) => r.isSeparator());
        expect(sepRow).toBeDefined();

        const firstDataRow = rowPool.find((r: any) => !r.isSeparator() && r.getData()?.get('a') === '1');
        const lastDataRow  = rowPool.find((r: any) => !r.isSeparator() && r.getData()?.get('a') === '4');

        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: firstDataRow.getComponents()[0].getElement()!,
            startOffset:    null,
            endContainer:   lastDataRow.getComponents()[2].getElement()!,
            endOffset:      null,
        });

        const fakeEvent = { clipboardData: { setData: vi.fn() } } as unknown as ClipboardEvent;

        (b as any).onCopy(fakeEvent);

        // The separator row is absent from the copy grid entirely — its
        // label never appears, and the two data rows land on adjacent lines.
        expect(fakeEvent.clipboardData!.setData).toHaveBeenCalledWith('text/plain', '1\t2\t3\n4\t5\t6');
    });

    it('recovers correct row-major order when the Range reports start/end reversed', async () => {
        const store = new MemoryStore(MODEL, [
            { a: '1', b: '2', c: '3' },
            { a: '4', b: '5', c: '6' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const pool     = (b as any).getRowPool();
        const row0Cells = pool[0].getComponents(); // data index 0: "1","2","3"
        const row1Cells = pool[1].getComponents(); // data index 1: "4","5","6"

        // A pool row's element is appended to the DOM once, in creation
        // order, and never physically moved as the pool recycles (see
        // renderedCellGrid's own remarks), so a real Range's start/end
        // containers — which the browser orders by DOM position, not data
        // index — can resolve to the LATER row first. Stand in for that
        // directly: "start" is a cell in the row with the larger data
        // index, "end" a cell in the row with the smaller one.
        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: row1Cells[1].getElement()!,
            startOffset:    null,
            endContainer:   row0Cells[1].getElement()!,
            endOffset:      null,
        });

        const fakeEvent = { clipboardData: { setData: vi.fn() } } as unknown as ClipboardEvent;
        (b as any).onCopy(fakeEvent);

        // Reading order follows the DATA index (row 0's b/c cells, then row
        // 1's a/b cells), not which container the Range happened to label
        // "start", and is never empty.
        expect(fakeEvent.clipboardData!.setData).toHaveBeenCalledWith('text/plain', '2\t3\n4\t5');
    });

    it('swaps the start/end character offsets along with the reversed positions', async () => {
        const store = new MemoryStore(MODEL, [
            { a: 'aaa', b: 'bbb', c: 'ccc' },
            { a: 'ddd', b: 'eee', c: 'fff' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const pool      = (b as any).getRowPool();
        const row0Cells = pool[0].getComponents(); // "aaa","bbb","ccc"
        const row1Cells = pool[1].getComponents(); // "ddd","eee","fff"

        // Same reversed-order setup as above, but this time both boundary
        // containers carry a real character offset — proving the offset
        // that trims each cell travels with its (now-swapped) position
        // rather than staying attached to whichever container the browser
        // originally labelled "start" / "end".
        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: row1Cells[1].getElement()!, // "eee"
            startOffset:    1,
            endContainer:   row0Cells[1].getElement()!, // "bbb"
            endOffset:      2,
        });

        const fakeEvent = { clipboardData: { setData: vi.fn() } } as unknown as ClipboardEvent;
        (b as any).onCopy(fakeEvent);

        // True start is ("bbb", offset 2) -> "b"; true end is ("eee", offset
        // 1) -> "e". A missing or inverted offset swap would instead trim
        // "bbb" with offset 1 ("bb") and "eee" with offset 2 ("ee").
        expect(fakeEvent.clipboardData!.setData).toHaveBeenCalledWith('text/plain', 'b\tccc\nddd\te');
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

describe('Body.isEmptyValue', () => {
    it('treats null, undefined, and the empty string as empty', () => {
        const isEmptyValue = (Body as any).isEmptyValue;

        expect(isEmptyValue(null)).toBe(true);
        expect(isEmptyValue(undefined)).toBe(true);
        expect(isEmptyValue('')).toBe(true);
    });

    it('does not treat 0, false, a non-empty string, or a single space as empty', () => {
        const isEmptyValue = (Body as any).isEmptyValue;

        expect(isEmptyValue(0)).toBe(false);
        expect(isEmptyValue(false)).toBe(false);
        expect(isEmptyValue('x')).toBe(false);
        expect(isEmptyValue(' ')).toBe(false);
    });
});

describe('Body required-empty cell outline resolution', () => {
    const REQUIRED_OUTLINE = 'inset 0 0 0 1px var(--ts-ui-table-cell-required-outline, rgba(220, 60, 60, 0.6))';

    const REQ_MODEL = new Model([
        { name: 'a',         type: 'string', order: 0 },
        { name: 'reqField',  type: 'string', order: 1 },
        { name: 'predField', type: 'string', order: 2 },
        { name: 'plainField', type: 'string', order: 3 },
    ], 'a');

    /**
     * Builds a materialised Body over `REQ_MODEL` with `reqField` marked
     * statically required and `predField` required only for the record
     * whose `a` is `'new'`, then renders one record with every field
     * empty and one record with `reqField` filled (`predField` stays
     * empty but its predicate doesn't match, so it must not tint).
     */
    async function bodyWithRequiredConfig(): Promise<{ b: Body; newRow: Cell<any>[]; newFields: string[]; filledRow: Cell<any>[]; filledFields: string[] }> {
        const store = new MemoryStore(REQ_MODEL, [
            { a: 'new',      reqField: '', predField: '', plainField: '' },
            { a: 'existing', reqField: 'filled', predField: '', plainField: '' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(400);
        b.setHeight(200);

        const configs = new Map<string, ColumnConfig>([
            ['reqField',  { field: 'reqField',  required: true }],
            ['predField', { field: 'predField', requiredPredicate: (record) => record.get('a') === 'new' }],
        ]);
        b.setColumnConfigs(configs);

        const rows = (b as any).getRowPool();
        const newRow    = rows.find((r: any) => r.getData()?.get('a') === 'new');
        const filledRow = rows.find((r: any) => r.getData()?.get('a') === 'existing');

        return {
            b,
            newRow:       newRow.getComponents() as Cell<any>[],
            newFields:    newRow.getFieldNames(),
            filledRow:    filledRow.getComponents() as Cell<any>[],
            filledFields: filledRow.getFieldNames(),
        };
    }

    it('outlines a statically required column\'s cell when its value is empty', async () => {
        const { newRow, newFields } = await bodyWithRequiredConfig();

        const cell = newRow[newFields.indexOf('reqField')];
        expect(cell.getShadow()).toBe(REQUIRED_OUTLINE);
    });

    it('does not outline a statically required column once its value is filled', async () => {
        const { filledRow, filledFields } = await bodyWithRequiredConfig();

        const cell = filledRow[filledFields.indexOf('reqField')];
        expect(cell.getShadow()).toBeNull();
    });

    it('outlines a predicate-required column\'s empty cell only for records the predicate matches', async () => {
        const { newRow, newFields, filledRow, filledFields } = await bodyWithRequiredConfig();

        const matched   = newRow[newFields.indexOf('predField')];
        const unmatched = filledRow[filledFields.indexOf('predField')];

        expect(matched.getShadow()).toBe(REQUIRED_OUTLINE);
        // Empty too, but the predicate doesn't match this record — no outline.
        expect(unmatched.getShadow()).toBeNull();
    });

    it('never outlines a plain (non-required) column even when its value is empty', async () => {
        const { newRow, newFields } = await bodyWithRequiredConfig();

        const cell = newRow[newFields.indexOf('plainField')];
        expect(cell.getShadow()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Column virtualization (table-column-virtualization plan). Rendered-set,
// sliding-window, per-cell-state-on-entry, column-set-change, editing, and
// keyboard coverage — see the plan's `## Expected Behaviour`.
// ---------------------------------------------------------------------------

/** Builds a Model with `n` 100px-friendly string columns `c0`..`c{n-1}`, with per-index type overrides. */
function wideModel(n: number, types: Record<number, string> = {}): Model {
    const fields = [];

    for (let i = 0; i < n; i++) {
        fields.push({ name: `c${i}`, type: (types[i] ?? 'string') as any, order: i });
    }

    return new Model(fields, 'c0');
}

/**
 * Builds a materialised Body over `columnCount` 100px-wide columns bound to
 * one record, rendered at `viewportWidth`. `scrollX`, when non-zero, is
 * applied through the real `VirtualScroller` after the initial render —
 * mirroring a real horizontal scroll, so it drives the same re-render path
 * a wheel gesture does.
 */
async function wideBody(
    columnCount: number,
    viewportWidth: number,
    scrollX: number = 0,
    opts?: { types?: Record<number, string>; configs?: Map<string, ColumnConfig>; blankFields?: number[] },
): Promise<Body> {
    const model = wideModel(columnCount, opts?.types ?? {});
    const blank = new Set(opts?.blankFields ?? []);
    const row: Record<string, any> = {};

    for (let i = 0; i < columnCount; i++) {
        row[`c${i}`] = blank.has(i) ? '' : `v${i}`;
    }

    const store = new MemoryStore(model, [row]);
    await store.load();

    const b = new Body(store);

    if (opts?.configs) {
        b.setColumnConfigs(opts.configs);
    }

    b.getElement(true);
    b.setWidth(viewportWidth);
    b.setHeight(100);
    b.renderWindow(viewportWidth, Array(columnCount).fill(100));

    if (scrollX !== 0) {
        (b as any)._scroller.setScrollX(scrollX);
    }

    return b;
}

describe('Column window — rendered cell set', () => {
    it('renders raw-visible columns plus COLUMN_BUFFER on each side, clamped at 0 — not every column', async () => {
        const b   = await wideBody(20, 300, 0);
        const row = (b as any).getRowPool()[0];

        expect(row.getComponents().length).toBe(6);
        expect(row.getColumnWindowStart()).toBe(0);
    });

    it('renders every column when the table fits the viewport; getColumnWindowStart is 0', async () => {
        const b   = await wideBody(3, 300, 0);
        const row = (b as any).getRowPool()[0];

        expect(row.getComponents().length).toBe(3);
        expect(row.getColumnWindowStart()).toBe(0);
    });

    it('getFieldNames() is index-aligned with getComponents(), naming column windowStart+s at slot s', async () => {
        const b     = await wideBody(20, 300, 0);
        const row   = (b as any).getRowPool()[0];
        const start = row.getColumnWindowStart();

        expect(row.getFieldNames().length).toBe(row.getComponents().length);
        row.getFieldNames().forEach((name: string, s: number) => {
            expect(name).toBe(`c${start + s}`);
        });
    });
});

describe('Column window — sliding', () => {
    it('crossing a column boundary advances getColumnWindowStart and leaves the rendered cell count unchanged', async () => {
        const b = await wideBody(20, 250, 300);
        const row = (b as any).getRowPool()[0];
        const beforeCount = row.getComponents().length;
        const beforeStart = row.getColumnWindowStart();

        (b as any)._scroller.setScrollX(400);

        expect(row.getColumnWindowStart()).toBe(beforeStart + 1);
        expect(row.getComponents().length).toBe(beforeCount);
    });

    it('a one-column slide over same-typed columns reuses the departing cell for the entering column', async () => {
        const b = await wideBody(20, 250, 300);
        const row = (b as any).getRowPool()[0];
        const departingCell = row.getComponents()[0]; // slot 0 -> column 0, about to leave

        (b as any)._scroller.setScrollX(400);

        const enteringCell = row.getComponents()[row.getComponents().length - 1]; // new last slot -> column 8
        expect(enteringCell).toBe(departingCell);
    });

    it('a one-column slide where the entering column is a different type builds a fresh cell and caches the departing one', async () => {
        const b = await wideBody(20, 250, 300, { types: { 8: 'number' } });
        const row = (b as any).getRowPool()[0];
        const departingCell = row.getComponents()[0]; // column 0 (string), about to leave

        (b as any)._scroller.setScrollX(400);

        const enteringCell = row.getComponents()[row.getComponents().length - 1]; // column 8 (number)
        expect(enteringCell).toBeInstanceOf(NumberCell);
        expect((enteringCell as NumberCell).getEditorKey()).toBe('number');
        expect(row.getComponents()).not.toContain(departingCell);
        // Retired into the row's cell cache, not disposed: `removeComponent`
        // alone leaves the cell's own children (its renderer) intact, unlike
        // `Component.destructor`, which would clear them.
        expect(departingCell.getComponents().length).toBeGreaterThan(0);
        expect((row as any)._cellCache.get('string')).toContain(departingCell);
    });

    it('after any slide, aria colIndex equals the column index + 1 for every rendered cell', async () => {
        const b = await wideBody(20, 250, 300);
        const row = (b as any).getRowPool()[0];

        (b as any)._scroller.setScrollX(400);

        const start = row.getColumnWindowStart();
        row.getComponents().forEach((cell: Cell<any>, s: number) => {
            expect(cell.getAria().getColIndex()).toBe(start + s + 1);
        });
    });
});

describe('Column window — per-cell state on entry', () => {
    it('a readOnly column scrolling into the window is read-only immediately, without the row rebinding', async () => {
        const configs = new Map<string, ColumnConfig>([['c10', { field: 'c10', readOnly: true }]]);
        const b   = await wideBody(20, 250, 0, { configs });
        const row = (b as any).getRowPool()[0];

        expect(row.getFieldNames()).not.toContain('c10');

        (b as any)._scroller.setScrollX(550); // window [3,10] — c10 scrolls in

        const idx = row.getFieldNames().indexOf('c10');
        expect(idx).toBeGreaterThanOrEqual(0);
        expect((row.getComponents()[idx] as Cell<any>).isReadOnly()).toBe(true);
    });

    it('a required column with an empty bound value shows the required outline as soon as it scrolls into the window', async () => {
        const REQUIRED_OUTLINE = 'inset 0 0 0 1px var(--ts-ui-table-cell-required-outline, rgba(220, 60, 60, 0.6))';
        const configs = new Map<string, ColumnConfig>([['c10', { field: 'c10', required: true }]]);
        const b   = await wideBody(20, 250, 0, { configs, blankFields: [10] });
        const row = (b as any).getRowPool()[0];

        (b as any)._scroller.setScrollX(550); // window [3,10] — c10 scrolls in

        const idx  = row.getFieldNames().indexOf('c10');
        const cell = row.getComponents()[idx] as Cell<any>;
        expect(cell.getShadow()).toBe(REQUIRED_OUTLINE);
    });

    it('a recycled cell entering a column with no groupColor loses the previous column\'s group tint', async () => {
        const configs = new Map<string, ColumnConfig>([['c0', { field: 'c0', groupColor: 'rgb(9,9,9)' }]]);
        const b   = await wideBody(20, 250, 300, { configs }); // window [0,7]
        const row = (b as any).getRowPool()[0];

        expect((row.getComponents()[0] as Cell<any>).getBackgroundColor()).toBe('rgb(9,9,9)');

        (b as any)._scroller.setScrollX(400); // c0 (groupColor) departs; c8 (no groupColor, same key) enters, recycled

        const recycled = row.getComponents()[row.getComponents().length - 1] as Cell<any>;
        expect(recycled.getBackgroundColor()).toBe('var(--ts-ui-table-cell-bg, transparent)');
    });
});

describe('Column window — column-set changes', () => {
    it('hiding a middle column leaves surviving cells\' instances unchanged and drops the hidden field from the rendered set', async () => {
        const b   = await wideBody(4, 400, 0); // 4x100 fits the 400px viewport — every column renders
        const row = (b as any).getRowPool()[0];
        const before = new Map(row.getFieldNames().map((n: string, i: number) => [n, row.getComponents()[i]]));

        b.setHiddenColumns(new Set(['c1']));

        expect(row.getFieldNames()).not.toContain('c1');
        for (const name of ['c0', 'c2', 'c3']) {
            const idx = row.getFieldNames().indexOf(name);
            expect(row.getComponents()[idx]).toBe(before.get(name));
        }
    });

    it('setColumnConfigs adding `values` to a column replaces that column\'s cell with a ComboCell', async () => {
        const b   = await wideBody(4, 400, 0);
        const row = (b as any).getRowPool()[0];

        b.setColumnConfigs(new Map<string, ColumnConfig>([['c1', { field: 'c1', values: ['a', 'b'] }]]));

        const idx = row.getFieldNames().indexOf('c1');
        expect(row.getComponents()[idx]).toBeInstanceOf(ComboCell);
    });
});

describe('Column window — editing', () => {
    it('a scroll that pushes an editing cell\'s column out of the window commits it and updates the record', async () => {
        const b    = await wideBody(20, 250, 0); // window [0,4]
        const row  = (b as any).getRowPool()[0];
        const cell = row.getComponents()[0] as Cell<any>;

        cell.startEdit();
        (cell as any)._activeEditor.setValue('edited');

        (b as any)._scroller.setScrollX(1750); // window [15,19] — c0 scrolls out

        expect(cell.isEditing()).toBe(false);
        expect(row.getData()?.get('c0')).toBe('edited');
    });

    it('the commit-on-scroll-out does not recurse — renderWindow completes and the pool stays intact', async () => {
        const b    = await wideBody(20, 250, 0);
        const row  = (b as any).getRowPool()[0];
        const cell = row.getComponents()[0] as Cell<any>;
        const poolSizeBefore = (b as any).getRowPool().length;

        cell.startEdit();
        (cell as any)._activeEditor.setValue('edited');

        expect(() => (b as any)._scroller.setScrollX(1750)).not.toThrow();

        expect((b as any).getRowPool().length).toBe(poolSizeBefore);
        expect((b as any)._reconciling).toBe(false);
    });
});

describe('Column window — keyboard column navigation', () => {
    it('ArrowRight past the right edge scrolls the body and keeps the focused column inside the rendered set', async () => {
        const b    = await wideBody(20, 250, 0);
        const priv = b as any;

        for (let i = 0; i < 6; i++) {
            priv.onKeyDown({ key: 'ArrowRight', preventDefault: () => {} });
        }

        expect(priv._scroller.getScrollX()).toBeGreaterThan(0);

        const row   = priv.getRowPool()[0];
        const start = row.getColumnWindowStart();
        expect(priv._focusedColIndex).toBeGreaterThanOrEqual(start);
        expect(priv._focusedColIndex).toBeLessThan(start + row.getComponents().length);
    });

    it('ArrowLeft at column 0 clamps and does not scroll', async () => {
        const b    = await wideBody(20, 250, 0);
        const priv = b as any;

        priv.onKeyDown({ key: 'ArrowLeft', preventDefault: () => {} });

        expect(priv._focusedColIndex).toBe(0);
        expect(priv._scroller.getScrollX()).toBe(0);
    });
});

describe('Column window — slot order with tied field order', () => {
    // `Row.setColumnWindow` assigns cells to slots itself; slot order must come
    // from that assignment, not from re-sorting the child array on
    // `Field.getOrder()`. A model declaring no `order` returns the -1 sentinel
    // for every field, so the comparison ties throughout, the sort is a stable
    // no-op, and a recycled cell keeps the index it already held — breaking the
    // documented alignment between getFieldNames() and getComponents().
    it('getFieldNames() stays index-aligned with getComponents() after a slide when no field declares an order', async () => {
        const fields = Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, type: 'string' as any }));
        const row: Record<string, any> = {};

        for (let i = 0; i < 20; i++) {
            row[`c${i}`] = `v${i}`;
        }

        const store = new MemoryStore(new Model(fields, 'c0'), [row]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(100);
        b.renderWindow(300, Array(20).fill(100));
        (b as any)._scroller.setScrollX(550);

        const poolRow = (b as any).getRowPool()[0];
        const start   = poolRow.getColumnWindowStart();

        expect(poolRow.getFieldNames()).toEqual(
            poolRow.getFieldNames().map((_: string, s: number) => `c${start + s}`));

        // The cell at slot s must be the one bound to getFieldNames()[s].
        poolRow.getComponents().forEach((cell: any, s: number) => {
            const field = poolRow.getLayoutConstraints(cell)?.data;

            expect(field.getName()).toBe(poolRow.getFieldNames()[s]);
        });
    });
});

describe('Column window — geometry diffing', () => {
    // Body cells are positioned at a content-absolute x, so a cell that keeps
    // its column keeps its geometry. The diff is keyed on the cell rather than
    // on its slot precisely so a window slide — which renumbers the slots while
    // the surviving cells stay on their own columns — does not re-lay-out the
    // whole pool. That is the expensive case: the pool holds one cell per
    // rendered column per pooled row, so re-laying-out all of them costs an
    // order of magnitude more than the header's single row.

    /**
     * A body over `columnCount` 100px columns and enough records to fill a
     * 400px viewport, so the row pool holds many rows rather than the single
     * row `wideBody` seeds. The multi-row pool is the whole point: it is what
     * makes re-laying-out the pool on every slide cost an order of magnitude
     * more than the header's one row.
     */
    async function tallWideBody(columnCount: number): Promise<Body> {
        const fields = Array.from({ length: columnCount }, (_, i) => ({
            name: `c${i}`, type: 'string' as const, order: i,
        }));
        const records = Array.from({ length: 200 }, (_, r) => {
            const record: Record<string, string> = {};

            for (let i = 0; i < columnCount; i++) {
                record[`c${i}`] = `v${r}-${i}`;
            }

            return record;
        });
        const store = new MemoryStore(new Model(fields, 'c0'), records);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(400);
        b.renderWindow(300, Array(columnCount).fill(100));

        return b;
    }

    /** Replaces `doLayout` on every rendered cell of every pooled row with a counter. */
    function countCellLayouts(b: Body): { calls: () => number, cells: number } {
        let calls = 0;
        let cells = 0;

        for (const row of (b as any).getRowPool() as Array<{ getComponents(): Array<{ doLayout(): unknown }> }>) {
            for (const cell of row.getComponents()) {
                cells++;
                cell.doLayout = () => { calls++; return cell; };
            }
        }

        return { calls: () => calls, cells };
    }

    it('lays out no cell when a scroll leaves the column window where it is', async () => {
        const b       = await tallWideBody(20);
        const counter = countCellLayouts(b);

        expect(counter.cells).toBeGreaterThan(50); // a real pool, not one row

        (b as any)._scroller.setScrollX(10);
        b.renderWindow(300, Array(20).fill(100));

        expect(counter.calls()).toBe(0);
    });

    it('lays out only the cells that changed column when the window slides', async () => {
        const b = await tallWideBody(20);

        type PoolRow = { getComponents(): Array<{ doLayout(): unknown }>, getFieldNames(): string[] };

        const pool    = (b as any).getRowPool() as PoolRow[];
        const laidOut = new Set<unknown>();
        // Which field each cell object held before the slide.
        const fieldBefore = new Map<unknown, string>();

        for (const row of pool) {
            const names = row.getFieldNames();

            row.getComponents().forEach((cell, slot) => {
                fieldBefore.set(cell, names[slot]);
                cell.doLayout = () => { laidOut.add(cell); return cell; };
            });
        }

        // 300px crosses three column boundaries, so the window slides and every
        // surviving cell moves slot while keeping its column.
        (b as any)._scroller.setScrollX(300);
        b.renderWindow(300, Array(20).fill(100));

        let survivors = 0;

        for (const row of pool) {
            const names = row.getFieldNames();

            row.getComponents().forEach((cell, slot) => {
                if (fieldBefore.get(cell) === names[slot]) {
                    survivors++;

                    // Kept its column, so it kept its geometry — the whole
                    // point of a committed rect living on the cell itself.
                    expect(laidOut.has(cell)).toBe(false);
                }
            });
        }

        // At pool scale, so the count reflects the case the diff exists for.
        expect(survivors).toBeGreaterThan(50);
    });

    it('leaves every cell at its own column\'s geometry after a slide', async () => {
        const b = await tallWideBody(20);

        // Far enough right that the window's first column is no longer 0,
        // asserted below so the case cannot silently stop being a slide.
        (b as any)._scroller.setScrollX(800);
        b.renderWindow(300, Array(20).fill(100));

        // Only the rows the window currently shows: the pool keeps hidden
        // excess rows that no pass has positioned.
        const priv = b as any;
        const pool = (priv.getRowPool() as Array<{ getComponents(): Array<any>, getFieldNames(): string[] }>)
            .filter((_, i) => priv._rowDisplayed[i]);
        const start = priv._colWindow.firstCol;

        expect(pool.length).toBeGreaterThan(1);

        // The positive half of the contract: skipping a cell is only correct
        // if the cell it skipped is already where its column says it should
        // be. Keyed on each cell's own field, so a cell parked at the wrong
        // slot cannot pass.
        for (const row of pool) {
            const names = row.getFieldNames();

            row.getComponents().forEach((cell, slot) => {
                const column = Number(names[slot].slice(1));

                expect(cell.getX()).toBe(column * 100);
                expect(cell.getWidth()).toBe(100);
            });
        }

        expect(start).toBeGreaterThan(0);
    });

    it('the per-column state a recycle re-applies needs no layout pass', async () => {
        const b   = await tallWideBody(20);
        const row = (b as any).getRowPool()[0] as { getComponents(): Array<any> };
        const cell = row.getComponents()[0];

        /** Every geometry the cell's subtree currently holds, as a comparable string. */
        function snapshot(): string {
            const parts: string[] = [];
            const walk = (c: any): void => {
                parts.push(`${c.getX()},${c.getY()},${c.getWidth()},${c.getHeight()}`);
                c.getComponents().forEach(walk);
            };

            walk(cell);

            return parts.join('|');
        }

        // The skip rests on these being layout-neutral. The writes that are not
        // — a renderer swap, a tree-state change, a glyph renderer replacing
        // its child — each lay the cell out themselves; everything the
        // reconciler re-applies on a recycle is a value, attribute or style
        // write. Asserted by forcing the
        // layout the skip withholds and checking nothing moves.
        cell.setValue('a considerably longer cell value than before');
        cell.setBaseBackground('#123456');
        cell.getAria().setColIndex(9);

        const before = snapshot();

        cell.doLayout();

        expect(snapshot()).toBe(before);

        // The snapshot has to be able to see a layout move at all, or the
        // assertion above would hold no matter what those setters did.
        cell.setWidth(cell.getWidth() + 120);
        cell.doLayout();

        expect(snapshot()).not.toBe(before);
    });

    it('a glyph cell rebound to a different glyph has its new glyph laid out', async () => {
        const fields = [
            { name: 'g', type: 'glyph' as const, order: 0 },
            { name: 'b', type: 'string' as const, order: 1 },
        ];
        const records = Array.from({ length: 100 }, (_, r) => ({
            g: r % 2 ? 'caret-down' : 'caret-right', b: `v${r}`,
        }));
        const store = new MemoryStore(new Model(fields, 'b'), records);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(400);
        b.setHeight(200);
        b.renderWindow(400, [100, 100]);

        // The pool now recycles rows by data identity rather than by window
        // slot (see VirtualRowView.alignPoolWindow), so slot 0's occupant can
        // be a different physical row object after a scroll — re-fetch it
        // rather than holding a reference across the render below.
        const cellAtSlot0 = () => ((b as any).getRowPool()[0] as { getComponents(): Array<any> }).getComponents()[0];
        const glyph = (cell: any) => cell.getRenderer().getComponents()[0];

        expect(glyph(cellAtSlot0()).getWidth()).toBeGreaterThan(0);

        // A vertical scroll rebinds this slot to a record whose glyph differs,
        // so the renderer discards its child and builds a new one. Rebuilding a
        // child is a layout input, and the cell's geometry has not moved — so
        // nothing else will lay it out, and the renderer must do it itself.
        (b as any)._scroller.setScrollY(24 * 23);
        b.renderWindow(400, [100, 100]);

        const cell = cellAtSlot0();
        expect(cell.getRenderer().getValue()).toBe('caret-down');
        expect(glyph(cell).getWidth()).toBeGreaterThan(0);
    });

    it('a cell re-pointed at a different column at identical geometry is not left stale', async () => {
        const fields = [
            { name: 'c0', type: 'glyph' as const, order: 0 },
            { name: 'c1', type: 'glyph' as const, order: 1 },
            { name: 'c2', type: 'string' as const, order: 2 },
        ];
        const store = new MemoryStore(new Model(fields, 'c2'),
                                      [{ c0: 'caret-right', c1: 'caret-down', c2: 'x' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(400);
        b.setHeight(200);
        b.setHiddenColumns(new Set(['c0']));
        b.renderWindow(400, [100, 100]);

        const row  = (b as any).getRowPool()[0] as { getComponents(): Array<any>, getFieldNames(): string[] };
        const cell = row.getComponents()[0];

        expect(row.getFieldNames()[0]).toBe('c1');

        // Swapping which column is hidden re-points this cell at c0, which
        // sits at the same x and width. A window slide can never produce that,
        // so it is the one route where a recycled cell keeps its record.
        b.setHiddenColumns(new Set(['c1']));
        b.renderWindow(400, [100, 100]);

        expect(row.getComponents()[0]).toBe(cell);
        expect(row.getFieldNames()[0]).toBe('c0');
        expect(cell.getRenderer().getValue()).toBe('caret-right');
        expect(cell.getRenderer().getComponents()[0].getWidth()).toBeGreaterThan(0);
    });
});
