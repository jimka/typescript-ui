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
import type { ModelRecord } from '~/data/ModelRecord';

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

// ---------------------------------------------------------------------------
// Part one of plans/implemented/table-body-visible-records-memo.md.
// `Body.getVisibleRecords()` used to call `store.getRecords()` — which is
// `this._records.slice()`, a whole-view copy — on every single call, six times
// per keyboard-navigation unit and twice per update unit. It now keeps one copy
// beside the store's view generation and re-copies only when the store has
// rebuilt its view since. The row filter is deliberately NOT memoised: its
// answer depends on a record's contents, which an in-cell edit changes without
// the store rebuilding anything, so it re-runs on every call. The last cases
// here pin both halves of that split.
// ---------------------------------------------------------------------------
describe('Body — store-view copy memo', () => {
    const MEMO_MODEL = new Model([
        { name: 'id',     type: 'number', order: 0 },
        { name: 'title',  type: 'string', order: 1 },
        { name: 'amount', type: 'number', order: 2 },
    ], 'id');

    /** A loaded six-record store — well below the store's worker threshold. */
    async function memoStore(): Promise<MemoryStore> {
        const store = new MemoryStore(MEMO_MODEL, Array.from({ length: 6 }, (_, r) => ({
            id:     r + 1,
            title:  `title ${r + 1}`,
            amount: (r + 1) * 10,
        })));
        await store.load();

        return store;
    }

    /** A realized, rendered body over `store`, tall enough to pool every row. */
    async function memoBody(store: MemoryStore): Promise<Body> {
        const b = new Body(store);
        b.getElement(true);
        b.setWidth(300);
        b.setHeight(400);
        (b as any).renderWindow(300, [100, 100, 100]);

        return b;
    }

    /** The protected seam under test. */
    function visible(b: Body): ModelRecord[] {
        return (b as any).getVisibleRecords();
    }

    it('serves two consecutive unfiltered queries from one copy of the store view', async () => {
        const store = await memoStore();
        const b     = await memoBody(store);

        visible(b);                                     // prime the copy
        const spy = vi.spyOn(store, 'getRecords');

        const first  = visible(b);
        const second = visible(b);

        expect(first).toBe(second);
        expect(spy.mock.calls.length).toBe(0);
        spy.mockRestore();
    });

    it('re-copies the store view after a record is added', async () => {
        const store = await memoStore();
        const b     = await memoBody(store);

        const before = visible(b);
        store.add({ id: 99, title: 'added', amount: 990 });
        const after  = visible(b);

        expect(after).not.toBe(before);
        expect(after.length).toBe(before.length + 1);
        expect(after.some(r => r.get('id') === 99)).toBe(true);
    });

    it('re-copies the store view after a store-level filter resolves', async () => {
        const store = await memoStore();
        const b     = await memoBody(store);

        expect(visible(b).length).toBe(6);              // prime the copy

        await store.setFilter('amount', { type: 'gt', field: 'amount', value: 30 });

        const after = visible(b);

        expect(after.length).toBe(3);
        expect(after.every(r => (r.get('amount') as number) > 30)).toBe(true);
    });

    it('re-copies the store view after removeAll empties it', async () => {
        const store = await memoStore();
        const b     = await memoBody(store);

        expect(visible(b).length).toBe(6);              // prime the copy

        store.removeAll();

        expect(visible(b).length).toBe(0);
    });

    it('re-copies the store view after a sort reorders it', async () => {
        const store = await memoStore();
        const b     = await memoBody(store);

        expect(visible(b)[0].get('id')).toBe(1);        // prime the copy

        await store.sort('amount', 'desc');

        expect(visible(b)[0].get('id')).toBe(6);
    });

    it('re-runs a row filter on every call — a fresh array each time, and still no re-copy', async () => {
        const store = await memoStore();
        const b     = await memoBody(store);
        b.setRowVisible(r => (r.get('amount') as number) > 30);

        visible(b);                                     // prime the copy
        const spy = vi.spyOn(store, 'getRecords');

        const first  = visible(b);
        const second = visible(b);

        expect(first).not.toBe(second);
        expect(first).toEqual(second);
        expect(spy.mock.calls.length).toBe(0);
        spy.mockRestore();
    });

    it('re-evaluates a row filter against an in-place edit the store rebuilt no view for', async () => {
        const store = await memoStore();
        const b     = await memoBody(store);
        b.setRowVisible(r => (r.get('amount') as number) > 30);

        expect(visible(b).length).toBe(3);

        // The premise the whole design rests on: an in-cell edit reaches
        // `notifyRecordChanged`, which emits but never calls `applyView()`, so
        // the store's view — and its generation — are untouched.
        const generation = (store as any).getViewGeneration();
        store.getAt(0)!.set('amount', 1000);
        expect((store as any).getViewGeneration()).toBe(generation);

        expect(visible(b).length).toBe(4);
    });

    it('does not serve a swapped-in store from the outgoing store\'s copy, even at an equal generation', async () => {
        const outgoing = await memoStore();
        const incoming = new MemoryStore(MEMO_MODEL, [{ id: 500, title: 'other', amount: 1 }]);
        await incoming.load();

        const b = await memoBody(outgoing);
        expect(visible(b).length).toBe(6);               // prime against `outgoing`

        // Two stores loaded the same way agree on their counter, so the number
        // alone cannot tell the swap — the stash reset in `rebindStore` is what
        // does. Asserted rather than assumed, so this case cannot pass because
        // the generations happened to differ.
        expect((incoming as any).getViewGeneration()).toBe((outgoing as any).getViewGeneration());

        b.setStore(incoming);

        const records = visible(b);

        expect(records.length).toBe(1);
        expect(records[0].get('id')).toBe(500);
    });

    it('gives two bodies over one store their own copies', async () => {
        const store = await memoStore();
        const first  = await memoBody(store);
        const second = await memoBody(store);

        const firstView  = visible(first);
        const secondView = visible(second);

        expect(firstView).not.toBe(secondView);
        expect(firstView).toEqual(secondView);
        // The second body's read must not have taken the first body's copy away.
        expect(visible(first)).toBe(firstView);
    });

    it('a keyboard navigation tick re-copies nothing, however often it asks for the view', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const store = table.getStore();

        body.selectRecord(store.getAt(0)!);
        runFrames();

        // Settle first: one tick so nothing measured below is first-time work.
        body.onKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
        runFrames();

        const askSpy  = vi.spyOn(body, 'getVisibleRecords');
        const copySpy = vi.spyOn(store, 'getRecords');

        body.onKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
        runFrames();

        const asks   = askSpy.mock.calls.length;
        const copies = copySpy.mock.calls.length;

        askSpy.mockRestore();
        copySpy.mockRestore();

        // The keyboard phase is where the measurement found six queries a unit.
        // The tick still asks repeatedly — asserted, so this case cannot pass by
        // the body having stopped asking — but it no longer copies per ask.
        expect(asks).toBeGreaterThan(1);
        expect(copies).toBe(0);
    });

    it('a one-row scroll tick and a full-page jump each re-copy nothing', async () => {
        const table     = await makeScrollableTable();
        const body      = table.getBody() as any;
        const store     = table.getStore();
        const rowHeight = body.getRowHeight();

        // Settle first, so nothing below is first-time work.
        body.setScrollY(rowHeight * 20);
        runFrames();

        const spy = vi.spyOn(store, 'getRecords');

        body.setScrollY(rowHeight * 21);
        runFrames();
        const oneRow = spy.mock.calls.length;

        body.setScrollY(rowHeight * 150);
        runFrames();
        const pageJump = spy.mock.calls.length - oneRow;

        spy.mockRestore();

        expect(oneRow).toBe(0);
        expect(pageJump).toBe(0);
    });
});
