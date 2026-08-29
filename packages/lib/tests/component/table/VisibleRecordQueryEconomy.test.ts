// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Phase 1 of plans/implemented/table-subsystem-consolidation-round-2.md.
// `Body.updateCellRangeVisualState` and `Body.updateRowVisualState` used to
// call `getVisibleRecords()` — a full store array copy, plus a full
// `.filter()` when quick search or a row-visibility predicate is active —
// once per pooled row per render tick, even though `bindAndPositionRows`
// already holds the array and passes it down to every other per-row helper.
// This file pins that the query now happens once per tick regardless of pool
// size or how many rows rebind, plus the matching economy for a cell-range
// drag, which used to re-derive its bounds (and re-query) once per mousemove
// per pooled row via the old `updateCellRangeVisualState`-internal call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { Body } from '~/component/table/Body';
import { Cell } from '~/component/table/cell/Cell';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The coalesced layout queue runs on an animation frame, and the offline sink
// drops its callback — capture the frames so a scroll tick can be driven to
// completion, queue included. Mirrors ScrollRebindLayoutEconomy.test.ts.
let frames: FrameRequestCallback[] = [];
let tables: Table[] = [];

beforeEach(() => {
    installTestDOM(CONFIG);
    frames = [];
    tables = [];
    (DOM.sink as any).requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(cb);
    (DOM.sink as any).cancelAnimationFrame  = () => {};
});
afterEach(() => {
    for (const table of tables) {
        table.dispose();
    }
    DOM.reset();
});

/** Drains the captured animation frames, including any they queue in turn. */
function runFrames(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard++) {
        const pending = frames;
        frames = [];

        for (const callback of pending) {
            callback(0);
        }
    }
}

const MODEL = new Model([
    { name: 'reference', type: 'string', order: 0 },
    { name: 'amount',    type: 'number', order: 1 },
    { name: 'posted_at', type: 'date',   order: 2 },
], 'reference');

/** A realized, laid-out table over 400 records, tall enough to grow the pool when asked. */
async function makeScrollableTable(height = 320): Promise<Table> {
    const store = new MemoryStore(MODEL, Array.from({ length: 400 }, (_, r) => ({
        reference: `reference value ${r + 1}`,
        amount:    (r + 1) * 7,
        posted_at: new Date(2024, r % 12, (r % 27) + 1),
    })));
    await store.load();

    const table = new Table(store);
    tables.push(table);

    table.getElement(true);
    table.setWidth(600);
    table.setHeight(height);
    table.doLayout();
    runFrames();

    return table;
}

/** Spies on `getVisibleRecords()`, runs `action`, drains frames, and returns the call count. */
function countVisibleRecordsCalls(body: any, action: () => void): number {
    const spy = vi.spyOn(body, 'getVisibleRecords');
    action();
    runFrames();
    const count = spy.mock.calls.length;
    spy.mockRestore();
    return count;
}

describe('Table — visible-records query economy (scroll)', () => {
    it('a one-row scroll tick makes at most 2 getVisibleRecords() calls', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const rowHeight = body.getRowHeight();

        // Settle first: scroll once so nothing measured below is first-time work.
        body.setScrollY(rowHeight * 20);
        runFrames();

        const count = countVisibleRecordsCalls(body, () => body.setScrollY(rowHeight * 21));

        expect(count).toBeLessThanOrEqual(2);
    });

    it('a full-page jump (every pool slot rebinds) makes the same call count as a one-row tick — the query left the per-row loop', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const rowHeight = body.getRowHeight();

        body.setScrollY(rowHeight * 20);
        runFrames();
        const oneRowCount = countVisibleRecordsCalls(body, () => body.setScrollY(rowHeight * 21));

        // Jump far enough past the pool's own size that every slot rebinds
        // to a brand-new record, well clear of the store's 400-row end.
        const pageJumpCount = countVisibleRecordsCalls(body, () => body.setScrollY(rowHeight * 150));

        expect(pageJumpCount).toBe(oneRowCount);
    });

    it('an active quick search does not change either call count', async () => {
        const table = await makeScrollableTable();

        table.setQuickSearch('value');

        const body = table.getBody() as any;
        const rowHeight = body.getRowHeight();

        body.setScrollY(rowHeight * 20);
        runFrames();
        const oneRowCount = countVisibleRecordsCalls(body, () => body.setScrollY(rowHeight * 21));

        const pageJumpCount = countVisibleRecordsCalls(body, () => body.setScrollY(rowHeight * 150));

        expect(oneRowCount).toBeLessThanOrEqual(2);
        expect(pageJumpCount).toBe(oneRowCount);
    });

    it('growing the pool (a taller table) does not change either call count', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const rowHeight = body.getRowHeight();

        body.setScrollY(rowHeight * 20);
        runFrames();
        const beforeGrowth = countVisibleRecordsCalls(body, () => body.setScrollY(rowHeight * 21));

        // Grow the visible area (and so the pool) well past the original.
        table.setHeight(900);
        table.doLayout();
        runFrames();

        const afterGrowthOneRow  = countVisibleRecordsCalls(body, () => body.setScrollY(rowHeight * 22));
        const afterGrowthPageJump = countVisibleRecordsCalls(body, () => body.setScrollY(rowHeight * 150));

        expect(afterGrowthOneRow).toBe(beforeGrowth);
        expect(afterGrowthPageJump).toBe(beforeGrowth);
    });
});

describe('Body — visible-records query economy (cell-range drag)', () => {
    const RANGE_MODEL = new Model([
        { name: 'a', type: 'string', order: 0 },
        { name: 'b', type: 'string', order: 1 },
        { name: 'c', type: 'string', order: 2 },
    ], 'a');

    async function rangeBody(): Promise<Body> {
        const store = new MemoryStore(RANGE_MODEL, [
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

    it('a mousedown on a data cell makes exactly one getVisibleRecords() call', async () => {
        const b = await rangeBody();
        const spy = vi.spyOn(b as any, 'getVisibleRecords');

        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));

        expect(spy.mock.calls.length).toBe(1);
    });

    it('a mousemove resolving to a different cell makes exactly one call', async () => {
        const b = await rangeBody();
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));

        const spy = vi.spyOn(b as any, 'getVisibleRecords');
        (b as any).onCellDragMove(makeEvent(cellAt(b, 1, 0).getElement()!, 'mousemove'));

        expect(spy.mock.calls.length).toBe(1);
    });

    it('a mousemove resolving to the same cell as the current focus makes zero calls', async () => {
        const b = await rangeBody();
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));

        const spy = vi.spyOn(b as any, 'getVisibleRecords');
        (b as any).onCellDragMove(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousemove'));

        expect(spy.mock.calls.length).toBe(0);
    });

    it('a mousemove resolving to no cell at all makes zero calls', async () => {
        const b = await rangeBody();
        (b as any).onCellMouseDown(makeEvent(cellAt(b, 0, 0).getElement()!, 'mousedown'));

        const row = (b as any).getRowPool()[0];
        const spy = vi.spyOn(b as any, 'getVisibleRecords');
        (b as any).onCellDragMove(makeEvent(row.getElement(), 'mousemove'));

        expect(spy.mock.calls.length).toBe(0);
    });
});
