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
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Body, resolveClickedColumn } from '~/component/table/Body';
import type { CellClickEvent } from '~/component/table/Body';
import { Body as CoreBody } from '~/core/Body';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { Row, _Row } from '~/component/table/Row';
import { Column } from '~/component/table/Column';
import { Cell } from '~/component/table/cell/Cell';
import { BooleanCell } from '~/component/table/cell/Boolean';
import { DynamicCell } from '~/component/table/cell/Dynamic';
import { ComboCell } from '~/component/table/cell/Combo';
import { NumberCell } from '~/component/table/cell/Number';
import { StringCell } from '~/component/table/cell/String';
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

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: Body): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/** Recorded `ensureStyleRule` ops for the given selector, in call order — mirrors `ClassHierarchyCascade.test.ts`'s own helper. */
function ensureStyleRuleOpsFor(sink: RecordingDOMSink, selector: string): Array<{ op: string; args: unknown[] }> {
    return sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector);
}

// Regression coverage for the table Body / core Body class-name collision fix
// — see plans/implemented/table-body-class-collision-fix.md. Importing
// `~/core/Body` above claims the "Body" name in ClassStyleRules.ts's `_owners`
// registry the instant this file loads (the singleton constructs and calls
// `init()` unconditionally at module evaluation — see core/Body.ts), which
// reproduces the collision precondition before any test body below runs.
//
// `_owners`/`_bags` are module state that survives `DOM.reset()` and persists
// for this whole file (Vitest isolates modules per file, not per test — see
// ClassHierarchyCascade.test.ts's header comment), so the shared
// `.TableBody` class-tier rule is created exactly once, by whichever test
// constructs and renders the first table `Body`. This block is declared
// before every other describe in this file — all of which construct table
// `Body` instances via the `body()` / `bodyWith()` helpers below — so its own
// construction is that first one; moving it later would make the
// `ensureStyleRuleOpsFor(sink, '.TableBody')` counts below observe a cache
// hit instead of the rule's actual creation.
describe('Body — class-name collision fix', () => {
    it('gets its own .TableBody class rule (backgroundColor hoisted), shared by a second table', () => {
        // Sanity-checks the collision precondition this block's ordering
        // comment depends on: the core Body singleton already exists.
        expect(CoreBody.getInstance()).toBeInstanceOf(CoreBody);

        const sink = DOM.sink as RecordingDOMSink;

        const b1 = new Body(new MemoryStore(MODEL, []));
        const declarations = declarationsDuring(sink, '.TableBody', () => b1.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.TableBody').length).toBe(1);
        expect(declarations.backgroundColor).toBe('var(--ts-ui-input-bg, rgb(255, 255, 255))');

        // A second table's Body shares the same rule — no duplicate created.
        const b2 = new Body(new MemoryStore(MODEL, []));
        b2.getElement(true);
        expect(ensureStyleRuleOpsFor(sink, '.TableBody').length).toBe(1);
    });

    it("no longer writes the framework baseline or backgroundColor to its own #id rule", () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b    = new Body(new MemoryStore(MODEL, []));

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        for (const key of [
            'position', 'visibility', 'display', 'boxSizing', 'whiteSpace',
            'userSelect', 'cursor', 'border', 'margin', 'minWidth', 'minHeight',
            'maxWidth', 'maxHeight', 'overflowX', 'overflowY',
        ]) {
            expect(declarations[key]).toBeUndefined();
        }
        expect(declarations.backgroundColor).toBeUndefined();
    });

    // Pins the rendered class list itself — see
    // ClassHierarchyCascade.test.ts's case 2 for the precedent this mirrors.
    // The collision fix makes TableBody a participating hierarchy member, so
    // its rendered element now carries its own ancestor's name (VirtualRowView)
    // and the class actually declared (TableBody), instead of the old bare
    // `Body` name — a breaking change for a consumer selector targeting
    // `.Body`, documented in the changelog's Breaking changes section.
    it("carries VirtualRowView and TableBody in its rendered class list, not the old Body name", () => {
        const sink  = DOM.sink as RecordingDOMSink;
        const b     = new Body(new MemoryStore(MODEL, []));
        const start = sink.writes.length;

        // Scope to the body's own element only — rendering also mounts row/
        // scrollbar children, each with their own 'ts-ui-component' addClass.
        const handle = b.getElement(true);

        const addClassOps = sink.writes.slice(start).filter((w) => {
            if (w.op !== 'apply' || w.args[0] !== handle) {
                return false;
            }
            const patch = w.args[1] as { addClass?: string[] };
            return Array.isArray(patch.addClass) && patch.addClass.includes('ts-ui-component');
        });

        expect(addClassOps.length).toBe(1);
        expect((addClassOps[0].args[1] as { addClass: string[] }).addClass).toEqual([
            'ts-ui-component', 'VirtualRowView', 'TableBody',
        ]);
    });
});

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

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran —
 * local copy of `InstanceStyleLayer.test.ts`'s own helper; that file's
 * header explains why it isn't shared across files (module isolation makes
 * sharing pointless).
 */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of sink.writes.slice(start)) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
            continue;
        }

        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[key] = styles[key];
        }
    }

    return out;
}

describe('Body virtual-scroll — row re-display after pool recycle', () => {
    // Reproduces the live "rows vanish while scrolling" report: a pooled row
    // hidden by `hideExcessPoolRows` and later brought back into the window
    // by `bindAndPositionRows` -> `positionRow` must actually become visible
    // again. `_rowDisplayed` bookkeeping alone isn't proof — the original bug
    // left it correctly `true` while the DOM stayed hidden forever.
    //
    // Originally written against `setDisplayed`'s old `writeStyle`-based
    // implementation, where hiding wrote a real per-instance `display: none`
    // onto the row's own `#id` rule and showing again had to explicitly clear
    // it with a matching `null` removal — the case this test pinned.
    // component-setdisplayed-state-tier-dedup.md routes the hide leg through
    // the shared `.ts-ui-component.undisplayed` class-tier rule instead, so
    // there is no longer any per-instance `display` declaration to leave
    // stale: showing the row again only removes the `undisplayed` token, and
    // `setDisplayed(true)`'s own `writeStyle({ displayed: true })` call
    // queues nothing but a `null` onto a rule that was never materialised in
    // the first place, so no `display` CSS write happens for this row at
    // all — the token removal below is what now carries the whole fix.
    it('removes the undisplayed token when a hidden pool row re-enters the window', async () => {
        const { b } = await bodyWith(200, 240);
        const p    = b as any;
        const sink = DOM.sink as RecordingDOMSink;
        const row  = p._rowPool[0];
        const element = row.getElement();

        // Simulate the row having scrolled out of the pool's window on a
        // previous tick.
        p.hideExcessPoolRows(0);
        expect(p._rowDisplayed[0]).toBe(false);

        // Re-render at the same scroll position — the row re-enters the
        // window at the same slot.
        const start = sink.writes.length;
        b.renderWindow(300, [100, 100, 100]);
        const writesAfter = sink.writes.slice(start);

        const removedUndisplayed = writesAfter.some(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { removeClass?: readonly string[] }).removeClass?.includes('undisplayed')
        );
        expect(removedUndisplayed).toBe(true);
        expect(row.isDisplayed()).toBe(true);
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

describe('Body range selection — mouse gestures', () => {
    async function rangeBody(): Promise<Body> {
        const store = new MemoryStore(MODEL, [
            { a: 'a0', b: 'b0', c: 'c0' },
            { a: 'a1', b: 'b1', c: 'c1' },
            { a: 'a2', b: 'b2', c: 'c2' },
            { a: 'a3', b: 'b3', c: 'c3' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(1000);   // tall enough that all 4 rows are in the pool
        (b as any).renderWindow(300, [100, 100, 100]);

        return b;
    }

    function cellAt(b: Body, row: number, col: number): Cell<any> {
        return (b as any).getRowPool()[row].getComponents()[col];
    }

    function recordAt(b: Body, row: number) {
        return (b as any).getRowPool()[row].getData();
    }

    it('walks the drag / plain-click / shift-click gesture sequence from the plan contract', async () => {
        const b = await rangeBody();

        // mousedown (R1, colB) -> anchor = focus = (R1, colB); rect = just that cell.
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 1, 1).getElement()!, 'mousedown'));

        expect((b as any)._rangeAnchor).toEqual({ record: recordAt(b, 1), col: 1 });
        expect((b as any)._rangeFocus).toEqual({ record: recordAt(b, 1), col: 1 });
        expect((b as any).getCellRangeBounds((b as any)._rangeAnchor, (b as any)._rangeFocus))
            .toEqual({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

        // ...then mousemove to (R3, colA), mouseup -> anchor unchanged; focus = (R3, colA); rect = rows 1-3 x cols A-B.
        (b as any).onCellDragMove(makeEvent(cellAt(b, 3, 0).getElement()!, 'mousemove'));
        (b as any).onCellDragEnd();

        expect((b as any)._rangeAnchor).toEqual({ record: recordAt(b, 1), col: 1 });
        expect((b as any)._rangeFocus).toEqual({ record: recordAt(b, 3), col: 0 });
        expect((b as any).getCellRangeBounds((b as any)._rangeAnchor, (b as any)._rangeFocus))
            .toEqual({ minRow: 1, maxRow: 3, minCol: 0, maxCol: 1 });

        // ...then a plain mousedown at (R0, colC) -> anchor = focus = (R0, colC); old range discarded.
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 2).getElement()!, 'mousedown'));

        expect((b as any)._rangeAnchor).toEqual({ record: recordAt(b, 0), col: 2 });
        expect((b as any)._rangeFocus).toEqual({ record: recordAt(b, 0), col: 2 });

        // ...then a shift-mousedown at (R2, colA) -> anchor unchanged; focus = (R2, colA); rect = rows 0-2 x cols A-C.
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 2, 0).getElement()!, 'mousedown', { shiftKey: true }));

        expect((b as any)._rangeAnchor).toEqual({ record: recordAt(b, 0), col: 2 });
        expect((b as any)._rangeFocus).toEqual({ record: recordAt(b, 2), col: 0 });
        expect((b as any).getCellRangeBounds((b as any)._rangeAnchor, (b as any)._rangeFocus))
            .toEqual({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });
    });

    it('a mousedown on a separator row is a no-op: no anchor/focus change, no drag armed', async () => {
        const b = await rangeBody();
        b.setRowSeparator(record => record.get('a') === 'a2' ? { label: 'SEP', color: null } : null);
        (b as any).renderWindow();

        const sepRow = (b as any).getRowPool().find((r: any) => r.isSeparator());
        expect(sepRow).toBeDefined();

        (b as any).onCellMouseDown(makeEvent(sepRow.getElement(), 'mousedown'));

        expect((b as any)._rangeAnchor).toBeNull();
        expect((b as any)._rangeFocus).toBeNull();
    });

    it('a mousedown on an actively-editing cell is a no-op', async () => {
        const b    = await rangeBody();
        const cell = cellAt(b, 0, 0) as any;

        cell._activeEditor = {}; // fakes Cell.isEditing() === true without full editor wiring

        (b as any).onCellMouseDown(makeEvent(cell.getElement(), 'mousedown'));

        expect((b as any)._rangeAnchor).toBeNull();
    });

    it('a mousedown outside every cell is a no-op', async () => {
        const b   = await rangeBody();
        const row = (b as any).getRowPool()[0];

        // The row's own element is not one of its cells.
        (b as any).onCellMouseDown(makeEvent(row.getElement(), 'mousedown'));

        expect((b as any)._rangeAnchor).toBeNull();
    });

    it('a mousemove resolving to the cell the focus already names is a no-op (no repaint)', async () => {
        const b = await rangeBody();
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));

        const spy = vi.spyOn(b as any, 'refreshCellRangeHighlight');
        (b as any).onCellDragMove(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousemove'));

        expect(spy).not.toHaveBeenCalled();
    });

    it('a mousemove that resolves to no cell leaves the focus unchanged', async () => {
        const b = await rangeBody();
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));

        const row = (b as any).getRowPool()[0];
        (b as any).onCellDragMove(makeEvent(row.getElement(), 'mousemove'));

        expect((b as any)._rangeFocus).toEqual({ record: recordAt(b, 0), col: 0 });
    });

    it('refreshCellRangeHighlight marks cells inside the rectangle selected and cells outside it not', async () => {
        const b = await rangeBody();

        (b as any)._rangeAnchor = { record: recordAt(b, 0), col: 0 };
        (b as any)._rangeFocus  = { record: recordAt(b, 0), col: 1 };
        (b as any).refreshCellRangeHighlight((b as any).getVisibleRecords());

        expect((cellAt(b, 0, 0) as any)._rangeSelected).toBe(true);
        expect((cellAt(b, 0, 1) as any)._rangeSelected).toBe(true);
        expect((cellAt(b, 0, 2) as any)._rangeSelected).toBe(false);
        expect((cellAt(b, 1, 0) as any)._rangeSelected).toBe(false);
    });

    function selectstartRegistrations(spy: ReturnType<typeof vi.spyOn>): unknown[] {
        return spy.mock.calls.filter((call: unknown[]) => call[1] === 'selectstart');
    }

    function clearSelectionWrites(): unknown[] {
        return (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'clearDocumentSelection');
    }

    // `Event` is a shared namespace object: `vi.spyOn` called again on an
    // already-spied method returns the SAME mock rather than a fresh one, so
    // its call history persists across `it` blocks unless cleared explicitly.
    function spyOnAddViewportListener(): ReturnType<typeof vi.spyOn> {
        const spy = vi.spyOn(Event, 'addViewportListener');
        spy.mockClear();

        return spy;
    }

    it('a drag that never leaves its origin cell does not touch native selection', async () => {
        const b = await rangeBody();
        const addSpy = spyOnAddViewportListener();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));
        (b as any).onCellDragMove(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousemove'));

        expect(clearSelectionWrites()).toHaveLength(0);
        expect(selectstartRegistrations(addSpy)).toHaveLength(0);
    });

    it('a cross-cell drag clears the selection and installs the suppressor', async () => {
        const b = await rangeBody();
        const addSpy = spyOnAddViewportListener();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));
        (b as any).onCellDragMove(makeEvent(cellAt(b, 1, 0).getElement()!, 'mousemove'));

        expect(clearSelectionWrites()).toHaveLength(1);
        expect(selectstartRegistrations(addSpy)).toHaveLength(1);
        expect((b as any)._rangeDragWidened).toBe(true);
    });

    it('a shift-click that already spans cells widens immediately', async () => {
        const b = await rangeBody();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));
        (b as any).onCellDragEnd();

        const addSpy = spyOnAddViewportListener();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 2, 2).getElement()!, 'mousedown', { shiftKey: true }));

        expect(clearSelectionWrites()).toHaveLength(1);
        expect(selectstartRegistrations(addSpy)).toHaveLength(1);
    });

    it('the suppressor is never registered twice in one gesture, but clearing keeps running every widened tick', async () => {
        const b = await rangeBody();
        const addSpy = spyOnAddViewportListener();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));
        (b as any).onCellDragMove(makeEvent(cellAt(b, 1, 0).getElement()!, 'mousemove'));
        (b as any).onCellDragMove(makeEvent(cellAt(b, 2, 0).getElement()!, 'mousemove'));
        (b as any).onCellDragMove(makeEvent(cellAt(b, 3, 0).getElement()!, 'mousemove'));

        expect(selectstartRegistrations(addSpy)).toHaveLength(1);
        expect(clearSelectionWrites()).toHaveLength(3);
    });

    it('mouseup re-arms text mode', async () => {
        const b = await rangeBody();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));
        (b as any).onCellDragMove(makeEvent(cellAt(b, 1, 0).getElement()!, 'mousemove'));

        const removeSpy = vi.spyOn(Event, 'removeViewportListener');
        removeSpy.mockClear();
        (b as any).onCellDragEnd();

        expect((b as any)._rangeDragWidened).toBe(false);
        expect(removeSpy.mock.calls.some(call => call[1] === 'selectstart')).toBe(true);

        const addSpy = spyOnAddViewportListener();
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));

        expect(selectstartRegistrations(addSpy)).toHaveLength(0);
    });

    it('a shift-click landing on the anchor\'s own cell stays in text mode', async () => {
        const b = await rangeBody();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 1, 1).getElement()!, 'mousedown'));
        (b as any).onCellDragEnd();

        const addSpy = spyOnAddViewportListener();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 1, 1).getElement()!, 'mousedown', { shiftKey: true }));

        expect(clearSelectionWrites()).toHaveLength(0);
        expect(selectstartRegistrations(addSpy)).toHaveLength(0);
    });

    it('a drag from (1,1) to (3,0) marks exactly that rectangle .rangeSelected and leaves cells outside it unmarked', async () => {
        const b = await rangeBody();

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 1, 1).getElement()!, 'mousedown'));
        (b as any).onCellDragMove(makeEvent(cellAt(b, 3, 0).getElement()!, 'mousemove'));

        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 3; c++) {
                const inRect = r >= 1 && r <= 3 && c >= 0 && c <= 1;
                expect((cellAt(b, r, c) as any)._rangeSelected).toBe(inRect);
            }
        }
    });
});

// Behaviour-preserved coverage for Phase 1 of
// plans/implemented/table-subsystem-consolidation-round-2.md: the visible-
// records array driving `updateRowVisualState` / `updateCellRangeVisualState`
// is now threaded in from the caller instead of re-queried per pool row —
// these pin that the rendered result is unchanged.
describe('Body range selection — behaviour preserved through the query-economy refactor', () => {
    async function rangeBody(): Promise<Body> {
        const store = new MemoryStore(MODEL, [
            { a: 'a0', b: 'b0', c: 'c0' },
            { a: 'a1', b: 'b1', c: 'c1' },
            { a: 'a2', b: 'b2', c: 'c2' },
            { a: 'a3', b: 'b3', c: 'c3' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(1000);   // tall enough that all 4 rows are in the pool
        (b as any).renderWindow(300, [100, 100, 100]);

        return b;
    }

    function cellAt(b: Body, row: number, col: number): Cell<any> {
        return (b as any).getRowPool()[row].getComponents()[col];
    }

    function recordAt(b: Body, row: number) {
        return (b as any).getRowPool()[row].getData();
    }

    it('selecting a row tints exactly that row; selecting another moves the tint', async () => {
        const b    = await rangeBody();
        const rows = (b as any).getRowPool();
        const recs = [recordAt(b, 0), recordAt(b, 1), recordAt(b, 2), recordAt(b, 3)];

        b.selectRecord(recs[0]);
        expect(rows.map((r: any) => r.isStyleState('.selected'))).toEqual([true, false, false, false]);

        b.selectRecord(recs[1]);
        expect(rows.map((r: any) => r.isStyleState('.selected'))).toEqual([false, true, false, false]);
    });

    it('scrolling a range-selected block out of view and back restores the highlight on the rebound rows', async () => {
        const store = new MemoryStore(MODEL, Array.from({ length: 40 }, (_, r) => ({
            a: `a${r}`, b: `b${r}`, c: `c${r}`,
        })));
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(120);   // a pool much smaller than the 40-row store
        (b as any).renderWindow(300, [100, 100, 100]);

        const target = store.getAll()[2];
        (b as any)._rangeAnchor = { record: target, col: 0 };
        (b as any)._rangeFocus  = { record: target, col: 1 };
        (b as any).refreshCellRangeHighlight((b as any).getVisibleRecords());

        const rowHeight = (b as any).getRowHeight();
        b.setScrollY(rowHeight * 30);   // scrolls the target row's pool slot out of view
        b.setScrollY(0);                // ...and back

        const restored = (b as any).getRowPool().find((r: any) => r.getData() === target);
        expect(restored).toBeDefined();

        const cells = restored.getComponents();
        expect((cells[0] as any)._rangeSelected).toBe(true);
        expect((cells[1] as any)._rangeSelected).toBe(true);
        expect((cells[2] as any)._rangeSelected).toBe(false);
    });

    it('a pool slot whose bound index is past the end of the visible records paints nothing and does not throw', async () => {
        const b = await rangeBody();
        const shortRecords = [recordAt(b, 0)];   // pool slot 3 is bound to dataIdx 3, out of range here

        expect(() => (b as any).updateRowVisualState(3, shortRecords)).not.toThrow();
        expect(() => (b as any).updateCellRangeVisualState(3, shortRecords, null)).not.toThrow();
    });

    it('a separator row is still skipped by the range highlight', async () => {
        const b = await rangeBody();
        b.setRowSeparator(record => record.get('a') === 'a1' ? { label: 'SEP', color: null } : null);
        (b as any).renderWindow();

        const sepRow = (b as any).getRowPool().find((r: any) => r.isSeparator());
        expect(sepRow).toBeDefined();

        (b as any)._rangeAnchor = { record: recordAt(b, 0), col: 0 };
        (b as any)._rangeFocus  = { record: recordAt(b, 3), col: 2 };

        expect(() => (b as any).refreshCellRangeHighlight((b as any).getVisibleRecords())).not.toThrow();

        expect((cellAt(b, 0, 0) as any)._rangeSelected).toBe(true);
        expect((cellAt(b, 3, 2) as any)._rangeSelected).toBe(true);
    });
});

describe('Body range selection — copy', () => {
    it('copySelectionToClipboard writes nothing when no range is selected', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        b.copySelectionToClipboard();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes).toHaveLength(0);
    });

    it('copies a range whose rows have scrolled out of the row pool (bug 2 regression)', async () => {
        const store = new MemoryStore(
            MODEL,
            Array.from({ length: 50 }, (_, i) => ({ a: `a${i}`, b: `b${i}`, c: `c${i}` })),
        );
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(100);   // small viewport -> a small pool
        (b as any).renderWindow(300, [100, 100, 100]);

        const records = store.getAll();
        (b as any)._rangeAnchor = { record: records[0], col: 0 };
        (b as any)._rangeFocus  = { record: records[2], col: 2 };

        (b as any)._scroller.setScrollY(100000);   // clamped to content max
        (b as any).renderWindow();

        // Sanity: rows 0-2 genuinely left the pool, so this is really
        // exercising the off-screen path and not a false negative.
        expect((b as any)._boundIndices).not.toContain(0);

        b.copySelectionToClipboard();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes).toHaveLength(1);
        expect(writes[0].args[0]).toBe('a0\tb0\tc0\na1\tb1\tc1\na2\tb2\tc2');
    });

    it('omits a separator row spanned by the copy range', async () => {
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

        const records = store.getAll();
        (b as any)._rangeAnchor = { record: records[0], col: 0 };
        (b as any)._rangeFocus  = { record: records[2], col: 2 };

        b.copySelectionToClipboard();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes[0].args[0]).toBe('1\t2\t3\n4\t5\t6');
    });

    it("formats a date column's copied text via TableExporter.formatValue, not the raw record value", async () => {
        const model  = new Model([{ name: 'd', type: 'date', order: 0 }], 'd');
        const sample = new Date(2021, 4, 17);
        const store  = new MemoryStore(model, [{ d: sample }]);
        await store.load();

        const b = new Body(store);
        b.setColumns(Column.resolve(model.getFields()));
        b.getElement(true);

        const record = store.getAll()[0];
        (b as any)._rangeAnchor = { record, col: 0 };
        (b as any)._rangeFocus  = { record, col: 0 };

        b.copySelectionToClipboard();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        // Relational assert (locale-agnostic): matches what the date renderer
        // itself would display, not the raw Date.
        expect(writes[0].args[0]).toBe(sample.toLocaleDateString());
    });

    it('Ctrl+C and Cmd+C both call copySelectionToClipboard; a bare "c" keypress does not', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const record = store.getAll()[0];
        (b as any)._rangeAnchor = { record, col: 0 };
        (b as any)._rangeFocus  = { record, col: 0 };

        const spy = vi.spyOn(b, 'copySelectionToClipboard');

        expect((b as any).onKeyDown(makeEvent(b.getElement()!, 'keydown', { key: 'c', ctrlKey: true })))
            .toEqual({ prevent: true });
        expect(spy).toHaveBeenCalledTimes(1);

        (b as any).onKeyDown(makeEvent(b.getElement()!, 'keydown', { key: 'c', metaKey: true }));
        expect(spy).toHaveBeenCalledTimes(2);

        (b as any).onKeyDown(makeEvent(b.getElement()!, 'keydown', { key: 'c' }));
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('Ctrl/Cmd+C defers to a live text selection', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const record = store.getAll()[0];
        (b as any)._rangeAnchor = { record, col: 0 };
        (b as any)._rangeFocus  = { record, col: 0 };

        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: b.getElement()!,
            startOffset:    0,
            endContainer:   b.getElement()!,
            endOffset:      2,
        });

        expect((b as any).onKeyDown(makeEvent(b.getElement()!, 'keydown', { key: 'c', ctrlKey: true })))
            .toBeUndefined();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes).toHaveLength(0);
    });
});

describe('Body range selection — right-click / context menu', () => {
    it('right-click with no prior selection sets _contextMenuCell and fires cellcontextmenu without touching the range', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const row    = (b as any).getRowPool()[0];
        const record = row.getData();
        const cells  = row.getComponents();

        const seen: Array<[number, number]> = [];
        b.on('cellcontextmenu', (x, y) => seen.push([x, y]));

        const result = (b as any).onCellContextMenu(
            makeEvent(cells[1].getElement(), 'contextmenu', { clientX: 42, clientY: 84 }),
        );

        expect(result).toEqual({ prevent: true });
        expect(seen).toEqual([[42, 84]]);
        expect((b as any)._contextMenuCell).toEqual({ record, col: 1 });
        expect((b as any)._rangeAnchor).toBeNull();
        expect((b as any)._rangeFocus).toBeNull();
    });

    it('right-clicking a cell inside the current range leaves the range untouched and copies the whole range', async () => {
        const store = new MemoryStore(MODEL, [
            { a: '1', b: '2', c: '3' },
            { a: '4', b: '5', c: '6' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const rows    = (b as any).getRowPool();
        const records = store.getAll();

        (b as any)._rangeAnchor = { record: records[0], col: 0 };
        (b as any)._rangeFocus  = { record: records[1], col: 1 };

        (b as any).onCellContextMenu(makeEvent(rows[0].getComponents()[0].getElement(), 'contextmenu', { clientX: 1, clientY: 1 }));

        expect((b as any)._rangeAnchor).toEqual({ record: records[0], col: 0 });
        expect((b as any)._rangeFocus).toEqual({ record: records[1], col: 1 });

        b.copyContextMenuSelection();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes[0].args[0]).toBe('1\t2\n4\t5');
    });

    it('right-clicking a cell outside the current range leaves the range untouched and copies just that cell', async () => {
        const store = new MemoryStore(MODEL, [
            { a: '1', b: '2', c: '3' },
            { a: '4', b: '5', c: '6' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const rows    = (b as any).getRowPool();
        const records = store.getAll();

        (b as any)._rangeAnchor = { record: records[0], col: 0 };
        (b as any)._rangeFocus  = { record: records[0], col: 0 };

        (b as any).onCellContextMenu(makeEvent(rows[1].getComponents()[2].getElement(), 'contextmenu', { clientX: 1, clientY: 1 }));

        expect((b as any)._rangeAnchor).toEqual({ record: records[0], col: 0 });
        expect((b as any)._rangeFocus).toEqual({ record: records[0], col: 0 });

        b.copyContextMenuSelection();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes[0].args[0]).toBe('6');
    });

    it('right-click on a separator row, an editing cell, or outside every cell is a no-op', async () => {
        const store = new MemoryStore(MODEL, [
            { a: '1', b: '2', c: '3' },
            { a: 'SEP', b: '', c: '' },
        ]);
        await store.load();

        const b = new Body(store);
        b.setRowSeparator(record => record.get('a') === 'SEP' ? { label: 'SEP', color: null } : null);
        b.getElement(true);
        b.renderWindow();

        const seen: unknown[] = [];
        b.on('cellcontextmenu', (...args: unknown[]) => seen.push(args));

        const sepRow = (b as any).getRowPool().find((r: any) => r.isSeparator());
        expect((b as any).onCellContextMenu(makeEvent(sepRow.getElement(), 'contextmenu'))).toBeUndefined();

        const dataRow = (b as any).getRowPool().find((r: any) => !r.isSeparator());
        const cell    = dataRow.getComponents()[0] as any;
        cell._activeEditor = {};
        expect((b as any).onCellContextMenu(makeEvent(cell.getElement(), 'contextmenu'))).toBeUndefined();

        expect((b as any).onCellContextMenu(makeEvent(dataRow.getElement(), 'contextmenu'))).toBeUndefined();

        expect(seen).toHaveLength(0);
        expect((b as any)._contextMenuCell).toBeNull();
    });

    it('copyContextMenuSelection is a no-op when no cell was right-clicked', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        b.copyContextMenuSelection();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes).toHaveLength(0);
    });

    it('copyContextMenuSelection is a no-op when the right-clicked record is no longer visible', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);
        await store.load();
        const otherStore = new MemoryStore(MODEL, [{ a: 'x', b: 'y', c: 'z' }]);
        await otherStore.load();

        const b = new Body(store);
        b.getElement(true);

        (b as any)._contextMenuCell = { record: otherStore.getAll()[0], col: 0 };

        expect(() => b.copyContextMenuSelection()).not.toThrow();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes).toHaveLength(0);
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
    it('renders a fixed-width window at the left edge — not every column', async () => {
        const b   = await wideBody(20, 300, 0);
        const row = (b as any).getRowPool()[0];

        expect(row.getComponents().length).toBe(9);
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

    // 7. The three tests above happen to cover group tint already — `wideBody(20,
    // 250, 300)` -> `setScrollX(400)` is window [0,7] -> [1,8], a genuine
    // same-width one-column slide (see `Column window — sliding`). The
    // readOnly/required tests above instead jump from window [0,4] to [3,10]
    // (different widths, scrollX 0 -> 550), which never takes the fast path —
    // so readOnly and required each need a dedicated same-width-slide version.

    it('7. a readOnly column entering via a same-width one-column slide is read-only immediately, without the row rebinding', async () => {
        const configs = new Map<string, ColumnConfig>([['c8', { field: 'c8', readOnly: true }]]);
        const b   = await wideBody(20, 250, 300, { configs }); // window [0,7] — c8 not yet visible
        const row = (b as any).getRowPool()[0];

        expect(row.getFieldNames()).not.toContain('c8');

        (b as any)._scroller.setScrollX(400); // one-column slide to window [1,8] — c8 enters

        const idx = row.getFieldNames().indexOf('c8');
        expect(idx).toBeGreaterThanOrEqual(0);
        expect((row.getComponents()[idx] as Cell<any>).isReadOnly()).toBe(true);
    });

    it('7. a required column with an empty value entering via a same-width one-column slide shows the outline immediately', async () => {
        const REQUIRED_OUTLINE = 'inset 0 0 0 1px var(--ts-ui-table-cell-required-outline, rgba(220, 60, 60, 0.6))';
        const configs = new Map<string, ColumnConfig>([['c8', { field: 'c8', required: true }]]);
        const b   = await wideBody(20, 250, 300, { configs, blankFields: [8] }); // window [0,7]
        const row = (b as any).getRowPool()[0];

        (b as any)._scroller.setScrollX(400); // one-column slide to window [1,8] — c8 enters

        const idx  = row.getFieldNames().indexOf('c8');
        const cell = row.getComponents()[idx] as Cell<any>;
        expect(cell.getShadow()).toBe(REQUIRED_OUTLINE);
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

    it('a readOnly config change applies immediately even to a column whose cell keeps its identity across the reconcile', async () => {
        // c1 is neither hidden nor type-changed, so `Row.setColumnWindow`'s
        // full path (forced by `_columnsDirty`, since a config change alone
        // still marks it dirty) matches c1's existing cell via pass 1 and
        // never adds it to `_lastRetargeted` — `Body.applyReadOnlyState`
        // must still reapply the read-only union to it, not just to cells
        // that were actually rebuilt or recycled.
        const b   = await wideBody(4, 400, 0); // 4x100 fits the 400px viewport — every column renders
        const row = (b as any).getRowPool()[0];
        const idx = row.getFieldNames().indexOf('c1');

        expect((row.getComponents()[idx] as Cell<any>).isReadOnly()).toBe(false);

        b.setColumnConfigs(new Map<string, ColumnConfig>([['c1', { field: 'c1', readOnly: true }]]));

        expect(row.getComponents()[idx]).toBeInstanceOf(StringCell); // same cell kind — pass 1 kept its identity
        expect((row.getComponents()[idx] as Cell<any>).isReadOnly()).toBe(true);
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

describe('Column window — keyboard cell-editor navigation', () => {
    // Two-row fixture for the Enter/Shift+Enter (row) cases, mirroring the
    // 'keyboard row navigation at a boundary' test's MemoryStore shape above,
    // but tall enough (and rendered) that both rows are pooled and their
    // cells are reachable via getRowPool()[i].getComponents().
    async function twoRowBody(): Promise<Body> {
        const store = new MemoryStore(MODEL, [
            { a: '1', b: '2', c: '3' },
            { a: '4', b: '5', c: '6' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(1000); // tall enough that both rows are in the pool
        (b as any).renderWindow(300, [100, 100, 100]);

        return b;
    }

    it('Tab commits, moves the focus to the next column, and re-opens editing there', async () => {
        const b       = await wideBody(20, 250, 0); // window [0,4]
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell = row.getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: false } } as any);

        expect(cell.isEditing()).toBe(false);
        expect((b as any)._focusedColIndex).toBe(1);
        expect((row.getComponents()[1] as Cell<any>).isEditing()).toBe(true);
    });

    it('Shift+Tab moves left and, at column 0, clamps: commits and re-opens editing on the same cell', async () => {
        const b       = await wideBody(20, 250, 0);
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell = row.getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: true } } as any);

        expect((b as any)._focusedColIndex).toBe(0);
        expect(cell.isEditing()).toBe(true);
    });

    it('Tab at the last column clamps the same way', async () => {
        const b       = await wideBody(4, 400, 0); // 4x100 fits 400px — every column renders
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);
        (b as any)._focusedColIndex = 3; // last column

        const cell = row.getComponents()[3] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: false } } as any);

        expect((b as any)._focusedColIndex).toBe(3);
        expect(cell.isEditing()).toBe(true);
    });

    it('Enter commits, moves down a row, and re-opens editing on the same column', async () => {
        const b       = await twoRowBody();
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell = (b as any).getRowPool()[0].getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 13, shiftKey: false } } as any);

        expect(cell.isEditing()).toBe(false);
        expect(b.getSelectedRecords()[0]).toBe(visible[1]);

        const nextCell = (b as any).getRowPool()[1].getComponents()[0] as Cell<any>;
        expect(nextCell.isEditing()).toBe(true);
    });

    it('Enter at the last row clamps: commits and re-opens editing on the same row/column', async () => {
        const b       = await twoRowBody();
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[1]); // last row

        const cell = (b as any).getRowPool()[1].getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 13, shiftKey: false } } as any);

        expect(b.getSelectedRecords()[0]).toBe(visible[1]);
        expect(cell.isEditing()).toBe(true);
    });

    it('Shift+Enter moves up a row and re-opens editing on the same column', async () => {
        const b       = await twoRowBody();
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[1]);

        const cell = (b as any).getRowPool()[1].getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 13, shiftKey: true } } as any);

        expect(b.getSelectedRecords()[0]).toBe(visible[0]);

        const prevCell = (b as any).getRowPool()[0].getComponents()[0] as Cell<any>;
        expect(prevCell.isEditing()).toBe(true);
    });

    it('Shift+Enter at row 0 clamps the same way', async () => {
        const b       = await twoRowBody();
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell = (b as any).getRowPool()[0].getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 13, shiftKey: true } } as any);

        expect(b.getSelectedRecords()[0]).toBe(visible[0]);
        expect(cell.isEditing()).toBe(true);
    });

    it('an arrow-keycode passed to Cell.onKeyDown is still a no-op — arrow keys are untouched', async () => {
        const b    = await wideBody(4, 400, 0);
        const row  = (b as any).getRowPool()[0];
        const cell = row.getComponents()[0] as Cell<any>;

        cell.startEdit();
        cell.onKeyDown({ detail: { keyCode: 37, shiftKey: false } } as any); // ArrowLeft

        expect(cell.isEditing()).toBe(true); // untouched — no commit, no navigation
    });

    it('Shift+Tab moves left across a real column boundary, not just the column-0 clamp', async () => {
        const b       = await wideBody(4, 400, 0); // 4x100 fits 400px — every column renders
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);
        (b as any)._focusedColIndex = 2;

        const cell = row.getComponents()[2] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: true } } as any);

        expect((b as any)._focusedColIndex).toBe(1);
        expect(cell.isEditing()).toBe(false);
        expect((row.getComponents()[1] as Cell<any>).isEditing()).toBe(true);
    });

    it('Tab into a boolean column does not toggle the checkbox, and returns focus to the body', async () => {
        // Regression: BooleanCell.startEdit() has no distinct edit session —
        // it toggles the checkbox immediately (see Boolean.ts) — so calling
        // it as a side effect of Tab navigating past it would silently flip
        // an unrelated checkbox. The navigate-handler path must skip it.
        const b       = await wideBody(4, 400, 0, { types: { 1: 'boolean' } });
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell     = row.getComponents()[0] as Cell<any>;
        const boolCell = row.getComponents()[1] as BooleanCell;
        const startEdit = vi.spyOn(boolCell, 'startEdit');
        const focus     = vi.spyOn(b, 'focus');

        cell.startEdit();
        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: false } } as any);

        expect((b as any)._focusedColIndex).toBe(1);
        expect(startEdit).not.toHaveBeenCalled();
        expect(focus).toHaveBeenCalled();
    });

    it('Tab into a DynamicCell bound to its boolean variant does not toggle the checkbox either', async () => {
        // Regression: DynamicCell.startEdit() mirrors BooleanCell.startEdit()
        // for its 'boolean' variant (toggles immediately, no edit session),
        // so it needs the same hasImmediateEditCommit() guard, not just a
        // BooleanCell-specific check.
        const configs = new Map<string, ColumnConfig>([['c1', { field: 'c1', cellType: () => 'boolean' }]]);
        const b       = await wideBody(4, 400, 0, { configs });
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell       = row.getComponents()[0] as Cell<any>;
        const dynamicCell = row.getComponents()[1] as DynamicCell;
        expect(dynamicCell).toBeInstanceOf(DynamicCell);
        expect(dynamicCell.hasImmediateEditCommit()).toBe(true);

        const startEdit = vi.spyOn(dynamicCell as any, 'startEdit');
        const focus     = vi.spyOn(b, 'focus');

        cell.startEdit();
        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: false } } as any);

        expect((b as any)._focusedColIndex).toBe(1);
        expect(startEdit).not.toHaveBeenCalled();
        expect(focus).toHaveBeenCalled();
    });

    it('Tab keeps working after landing on a boolean column — Body itself must still handle Tab once focus returns to it', async () => {
        // Regression: landing on an immediate-commit cell (BooleanCell) sends
        // focus back to the Body container instead of opening an editor (see
        // the tests above). From there, the *next* Tab keydown targets Body's
        // own element, not any cell's editor — so Body.onKeyDown must treat
        // Tab/Shift+Tab as navigable too, or navigation silently dead-ends the
        // moment it passes over any cell that doesn't open an editor.
        const b       = await wideBody(4, 400, 0, { types: { 1: 'boolean' } });
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();
        const priv    = b as any;

        b.selectRecord(visible[0]);

        const cell = row.getComponents()[0] as Cell<any>;
        cell.startEdit();
        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: false } } as any); // lands on column 1 (boolean)

        expect(priv._focusedColIndex).toBe(1);

        priv.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault: () => {} });

        expect(priv._focusedColIndex).toBe(2);
        expect((row.getComponents()[2] as Cell<any>).isEditing()).toBe(true);
    });

    it('Tab onto a read-only cell commits and moves the focus ring, but does not open an editor there, and returns focus to the body', async () => {
        const configs = new Map<string, ColumnConfig>([['c1', { field: 'c1', readOnly: true }]]);
        const b       = await wideBody(4, 400, 0, { configs });
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell   = row.getComponents()[0] as Cell<any>;
        const roCell = row.getComponents()[1] as Cell<any>;
        const focus  = vi.spyOn(b, 'focus');

        cell.startEdit();
        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: false } } as any);

        expect((b as any)._focusedColIndex).toBe(1);
        expect(roCell.isEditing()).toBe(false);
        expect(focus).toHaveBeenCalled();
    });

    it('a double-click-started edit is also refocused to the body on Escape (persistent setEditEndHandler, not the old transient per-keystroke wiring)', async () => {
        // Regression: the old code installed `on("editend", ...)` only
        // inside Body.onKeyDown's Enter/Space branch, so an edit started
        // by double-click (Cell's own dblclick wiring, never routed
        // through that branch) never got this listener at all — Escape
        // would cancel with no refocus. `wireRowCells` now installs
        // `setEditEndHandler` persistently, once per pooled cell,
        // regardless of how the edit was started.
        //
        // Drives the real double-click path — Cell's own internal
        // `dblclick` listener on the renderer, captured via a spy on
        // Event.addListener (matching editor.test.ts's "Tab suppresses
        // native focus-shift" precedent) and invoked directly, rather than
        // `cell.startEdit()` called by hand or a full DOM.sink.dispatchEvent
        // (whose window-level base listener is a process-wide singleton per
        // event type — see Event.ts's installBaseListener — so it only
        // reliably reaches a fresh test's own modelled sink for the FIRST
        // dispatch of a given event type in this file).
        const spy     = vi.spyOn(Event, 'addListener');
        const b       = await wideBody(4, 400, 0); // 4x100 fits 400px — every column renders
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell     = row.getComponents()[0] as Cell<any>;
        const renderer = cell.getRenderer();
        const focus    = vi.spyOn(b, 'focus');

        const registrations = spy.mock.calls.filter(c => c[0] === renderer && c[1] === 'dblclick');
        spy.mockRestore();

        expect(registrations.length).toBeGreaterThan(0);
        const dblclickListener = registrations[registrations.length - 1][2] as unknown as Event.Listener;

        dblclickListener({} as MouseEvent);
        expect(cell.isEditing()).toBe(true);

        cell.onKeyDown({ detail: { keyCode: 27, shiftKey: false } } as any);

        expect(cell.isEditing()).toBe(false);
        expect(focus).toHaveBeenCalled();
    });

    it('Enter skips a separator row via skipSeparators, matching ArrowDown', async () => {
        const store = new MemoryStore(MODEL, [
            { a: '1', b: '2', c: '3' },
            { a: 'SEP', b: '', c: '' },
            { a: '4', b: '5', c: '6' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(1000); // tall enough that all three rows are pooled
        b.setRowSeparator(record => record.get('a') === 'SEP' ? { label: 'SEP', color: null } : null);
        (b as any).renderWindow(300, [100, 100, 100]);

        const visible = (b as any).getVisibleRecords();
        b.selectRecord(visible[0]);

        const cell = (b as any).getRowPool()[0].getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 13, shiftKey: false } } as any);

        expect(b.getSelectedRecords()[0]).toBe(visible[2]);
    });

    // 50-row fixture for the PageUp/PageDown cases below — tall enough
    // (relative to the theme's row height) that `computePageSize()` moves
    // more than one row, so a page-jump is distinguishable from Enter's
    // single-row move.
    async function manyRowBody(): Promise<Body> {
        const rows = Array.from({ length: 50 }, (_, i) => ({ a: `${i}`, b: `${i}`, c: `${i}` }));
        const store = new MemoryStore(MODEL, rows);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(300);
        (b as any).renderWindow(300, [100, 100, 100]);

        return b;
    }

    function findEditingCell(b: Body): Cell<any> | undefined {
        return (b as any).getRowPool()
            .flatMap((row: any) => row.getComponents())
            .find((c: any) => c.isEditing());
    }

    it('PageDown commits, moves down a page of rows, and re-opens editing there', async () => {
        const b        = await manyRowBody();
        const visible  = (b as any).getVisibleRecords();
        const pageSize = (b as any).computePageSize();

        expect(pageSize).toBeGreaterThan(1); // sanity: fixture must exercise a real page jump

        b.selectRecord(visible[0]);

        const cell = (b as any).getRowPool()[0].getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 34, shiftKey: false } } as any); // PageDown

        expect(cell.isEditing()).toBe(false);
        expect(b.getSelectedRecords()[0]).toBe(visible[pageSize]);
        expect(findEditingCell(b)).toBeDefined();
    });

    it('PageDown at the last page clamps: commits and re-opens editing on the last row', async () => {
        const b       = await manyRowBody();
        const priv    = b as any;
        const visible = priv.getVisibleRecords();
        const lastRec = visible[visible.length - 1];

        // Scroll to the last row first — mirrors how a real session would
        // have gotten there — so it's actually pooled before resolving its
        // cell via the same private helper `navigateFromEditingCell` uses.
        b.selectRecord(lastRec);
        priv.scrollRecordIntoView(lastRec);
        priv.renderWindow();

        const cell = priv.resolveFocusedCell() as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 34, shiftKey: false } } as any); // PageDown

        expect(b.getSelectedRecords()[0]).toBe(lastRec);
        expect(findEditingCell(b)).toBeDefined();
    });

    it('PageUp commits, moves up a page of rows, and re-opens editing there', async () => {
        const b        = await manyRowBody();
        const priv     = b as any;
        const visible  = priv.getVisibleRecords();
        const pageSize = priv.computePageSize();
        const startRec = visible[visible.length - 1];
        const startIdx = visible.length - 1;

        expect(startIdx).toBeGreaterThan(pageSize); // sanity: room to move a full page up

        b.selectRecord(startRec);
        priv.scrollRecordIntoView(startRec);
        priv.renderWindow();

        const cell = priv.resolveFocusedCell() as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 33, shiftKey: false } } as any); // PageUp

        expect(cell.isEditing()).toBe(false);
        expect(b.getSelectedRecords()[0]).toBe(visible[startIdx - pageSize]);
        expect(findEditingCell(b)).toBeDefined();
    });

    it('PageUp at the first page clamps: commits and re-opens editing on the first row', async () => {
        const b       = await manyRowBody();
        const visible = (b as any).getVisibleRecords();

        b.selectRecord(visible[0]);

        const cell = (b as any).getRowPool()[0].getComponents()[0] as Cell<any>;
        cell.startEdit();

        cell.onKeyDown({ detail: { keyCode: 33, shiftKey: false } } as any); // PageUp

        expect(b.getSelectedRecords()[0]).toBe(visible[0]);
        expect(findEditingCell(b)).toBeDefined();
    });

    // Two-row, boolean-column fixture for the Enter-reserved-for-navigation
    // cases below — mirrors `twoRowBody` above, but built over `wideModel`
    // so a column can be typed 'boolean'.
    async function twoRowWideBody(colTypes: Record<number, string>): Promise<Body> {
        const model = wideModel(4, colTypes);
        const store = new MemoryStore(model, [
            { c0: 'r0c0', c1: 'v1', c2: 'r0c2', c3: 'r0c3' },
            { c0: 'r1c0', c1: 'v1', c2: 'r1c2', c3: 'r1c3' },
        ]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);
        b.setWidth(400);
        b.setHeight(1000); // tall enough that both rows are pooled
        (b as any).renderWindow(400, [100, 100, 100, 100]);

        return b;
    }

    it('Enter on a focused boolean cell navigates down a row instead of toggling it', async () => {
        // Regression: Body.onKeyDown's Enter/Space branch used to call
        // startEditAtFocusedCell() unconditionally, so Enter on a
        // BooleanCell toggled it the same as Space. Enter is reserved for
        // cell-to-cell navigation everywhere else in this feature; Space is
        // the deliberate toggle key.
        const b       = await twoRowWideBody({ 1: 'boolean' });
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();
        const priv    = b as any;

        b.selectRecord(visible[0]);
        priv._focusedColIndex = 1;

        const boolCell  = row.getComponents()[1] as BooleanCell;
        const startEdit = vi.spyOn(boolCell, 'startEdit');

        priv.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });

        expect(startEdit).not.toHaveBeenCalled();
        expect(b.getSelectedRecords()[0]).toBe(visible[1]);
        expect(priv._focusedColIndex).toBe(1);
    });

    it('Shift+Enter on a focused boolean cell navigates up a row instead of toggling it', async () => {
        const b       = await twoRowWideBody({ 1: 'boolean' });
        const row     = (b as any).getRowPool()[1];
        const visible = (b as any).getVisibleRecords();
        const priv    = b as any;

        b.selectRecord(visible[1]);
        priv._focusedColIndex = 1;

        const boolCell  = row.getComponents()[1] as BooleanCell;
        const startEdit = vi.spyOn(boolCell, 'startEdit');

        priv.onKeyDown({ key: 'Enter', shiftKey: true, preventDefault: () => {} });

        expect(startEdit).not.toHaveBeenCalled();
        expect(b.getSelectedRecords()[0]).toBe(visible[0]);
    });

    it('Space on a focused boolean cell still toggles it', async () => {
        const b       = await twoRowWideBody({ 1: 'boolean' });
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();
        const priv    = b as any;

        b.selectRecord(visible[0]);
        priv._focusedColIndex = 1;

        const boolCell  = row.getComponents()[1] as BooleanCell;
        const startEdit = vi.spyOn(boolCell, 'startEdit');

        priv.onKeyDown({ key: ' ', shiftKey: false, preventDefault: () => {} });

        expect(startEdit).toHaveBeenCalled();
        expect(b.getSelectedRecords()[0]).toBe(visible[0]); // unmoved — Space doesn't navigate
    });

    it('Enter on a focused non-boolean cell still starts editing it there', async () => {
        const b       = await twoRowWideBody({ 1: 'boolean' });
        const row     = (b as any).getRowPool()[0];
        const visible = (b as any).getVisibleRecords();
        const priv    = b as any;

        b.selectRecord(visible[0]);
        priv._focusedColIndex = 0;

        priv.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });

        expect((row.getComponents()[0] as Cell<any>).isEditing()).toBe(true);
        expect(b.getSelectedRecords()[0]).toBe(visible[0]); // unmoved — opened an editor instead
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

        // 400px is past the fixed-width window's pinned-at-0 zone by one
        // column, so the window slides by one and every surviving cell
        // moves slot while keeping its column.
        (b as any)._scroller.setScrollX(400);
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

describe('Column window — fast-path slide (Body integration)', () => {
    // Pool-scale variant of `tallWideBody` (from `Column window — geometry
    // diffing` above, out of scope here) with an optional initial `scrollX`,
    // so a test can reach a base window away from the column-0 clamp before
    // triggering the one-column slide under test.
    async function tallWideBody(columnCount: number, scrollX: number = 0, types: Record<number, string> = {}): Promise<Body> {
        const fields = Array.from({ length: columnCount }, (_, i) => ({
            name: `c${i}`, type: (types[i] ?? 'string') as any, order: i,
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

        if (scrollX !== 0) {
            (b as any)._scroller.setScrollX(scrollX);
        }

        return b;
    }

    it('11. a one-column slide calls cellKeyFor zero times across the whole pool', async () => {
        const b = await tallWideBody(20, 300); // window [0,8]

        const spy = vi.spyOn(Row.prototype as any, 'cellKeyFor');

        (b as any)._scroller.setScrollX(400); // one-column slide to window [1,9]

        expect(spy.mock.calls.length).toBe(0);
    });

    it('12. a one-column slide constructs at most poolSize cells (not poolSize x width) and disposes none', async () => {
        // c9 is the sole entering column after the slide below; type-mismatched
        // against every departing (c0, string) cell so each displayed row must
        // build a fresh NumberCell rather than reusing its departing cell.
        const b = await tallWideBody(20, 300, { 9: 'number' }); // window [0,8]

        const priv     = b as any;
        const poolSize = (priv.getRowPool() as unknown[]).length;

        // Row.ts's own createCellForField call (Row.createCellForField(...) at
        // Row.ts:681) resolves the bare `Row` identifier in scope there — the
        // raw class, not the callable-wrapped export — so the spy must sit on
        // the raw class (_Row) to see those internal calls.
        const buildSpy   = vi.spyOn(_Row as any, 'createCellForField');
        const disposeSpy = vi.spyOn(Cell.prototype, 'dispose');

        (b as any)._scroller.setScrollX(400); // one-column slide to window [1,9] — c9 enters

        // Exactly one build per row that actually reconciled this tick (at
        // most the whole pool) — never `poolSize x width` (9), which is what
        // re-deriving every rendered column's cell assignment would cost.
        expect(buildSpy.mock.calls.length).toBeGreaterThan(0);
        expect(buildSpy.mock.calls.length).toBeLessThanOrEqual(poolSize);
        expect(buildSpy.mock.calls.length).toBeLessThan(poolSize * 9);
        expect(disposeSpy).not.toHaveBeenCalled();
    });

    it('13. computeColumnWindowSlidePlan returns undefined for each fallback case in the eligibility table', async () => {
        const b = await tallWideBody(4);
        const compute = (b as any).computeColumnWindowSlidePlan.bind(b) as
            (prev: unknown, next: unknown) => unknown;

        const empty = { widths: [], lefts: [] };
        const win = (firstCol: number, lastCol: number) => ({ firstCol, lastCol, widths: [], lefts: [] });

        // First render: no previous window to diff against.
        expect(compute({ firstCol: 0, lastCol: -1, ...empty }, win(0, 5))).toBeUndefined();

        // Resize: window width changed (6 -> 8).
        expect(compute(win(0, 5), win(0, 7))).toBeUndefined();

        // Jump: |delta| (10) >= width (6) — no overlap.
        expect(compute(win(0, 5), win(10, 15))).toBeUndefined();

        // No-op tick: delta === 0.
        expect(compute(win(0, 5), win(0, 5))).toBeUndefined();
    });

    it('14. a big horizontal jump (|delta| >= width) still reconciles correctly via the full path', async () => {
        const b = await tallWideBody(20, 0, { 15: 'number' }); // window [0,8], c15 type-mismatched
        const row = (b as any).getRowPool()[0];

        (b as any)._scroller.setScrollX(1500); // far jump — window lands at [11,19], no overlap with [0,8]

        expect(row.getColumnWindowStart()).toBe(11);
        expect(row.getFieldNames()).toContain('c15');

        // byName matching still works across the jump (a surviving string
        // column keeps a string cell), and the one genuinely type-mismatched
        // column (c15, number) builds fresh rather than being force-fit.
        const numberCellIdx = row.getFieldNames().indexOf('c15');
        expect(row.getComponents()[numberCellIdx]).toBeInstanceOf(NumberCell);
        row.getFieldNames().forEach((name: string, i: number) => {
            if (name !== 'c15') {
                expect(row.getComponents()[i]).not.toBeInstanceOf(NumberCell);
            }
        });
    });

    it('15. a same-tick resize alongside a scroll takes the full path, not the fast path', async () => {
        const b = await tallWideBody(20, 300); // window [0,8], 100px columns

        const spy = vi.spyOn(Row.prototype as any, 'cellKeyFor');

        // Writes the scroll position directly (bypassing the setScrollX ->
        // onScroll -> renderWindow trigger, per this file's own white-box
        // precedent) so the widened-column render below is the single tick
        // that sees both the scroll delta AND the width change together —
        // what a resize while mid-scroll produces in practice.
        (b as any)._scroller._scrollX = 400;
        b.renderWindow(300, Array(20).fill(150)); // columns widened 100px -> 150px

        expect(spy.mock.calls.length).toBeGreaterThan(0);
    });
});
