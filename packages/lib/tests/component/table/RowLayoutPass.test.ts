// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for the layout pass a table `Row` now records. Case numbers R1 to R4
 * refer to `## Expected Behaviour` in
 * `plans/implemented/table-row-layout-pass-contract.md`; A1 to A6, the manager
 * half, live in `tests/component/layout/Absolute.test.ts` and
 * `tests/core/UnchangedCommitOptIns.test.ts`.
 *
 * `Row.doLayout` used to be a bare `return this;`, so a row reported
 * `isLayoutDirty()` `true` for life, never drained an `onFirstLayout` callback,
 * and broke the batched flush's promise that a queued ancestor's pass recurses
 * into a queued descendant — a cell pruned under a queued row was left owing
 * its pass. Deleting the override alone moves the cells, because the default
 * `Absolute` manager commits each child at its *preferred* size: a
 * `BooleanCell` reports 20×16 against the 48×20 the render window gave it, and
 * a narrow `FilterCell` reports 236×22 against 25×22. So a row runs
 * `Absolute({ sizing: "committed" })`, and every case below compares the whole
 * `{ x, y, width, height }` before and after — a call count would not tell the
 * two apart.
 *
 * A walk from the table reaches neither a pooled row nor its cells, because
 * `growRowPool` raw-appends them; the fixture reaches through `_rowPool` on
 * purpose and R1 asserts it found the right class before asserting anything
 * else. The suite's own record is that a version of this test that walked from
 * the table passed vacuously.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { Row } from '~/component/table/Row';
import { Cell } from '~/component/table/cell/Cell';
import { Component } from '~/core/Component';
import { Insets } from '~/primitive/Insets';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { Glyph } from '~/component/display/Glyph';
import { caret_down } from '~/glyphs/solid/caret_down';

// `Tree`/`TreeTable` no longer register `caret-down` at module load (they use
// the shared `angle-right` toggle now); this file's own `icon: 'caret-down'`
// fixture value needs it registered directly.
Glyph.register(caret_down);

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A rectangle compared whole, so a case cannot pass on one axis alone. */
interface Rect {
    x      : number;
    y      : number;
    width  : number;
    height : number;
}

// The coalesced layout queue runs on an animation frame and the offline sink
// drops its callback, so the frames are captured and drained by hand.
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

    vi.restoreAllMocks();
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

/** Tracks `table` for disposal in `afterEach`, and returns it unchanged. */
function track(table: Table): Table {
    tables.push(table);

    return table;
}

function rectOf(component: Component): Rect {
    return {
        x:      component.getX(),
        y:      component.getY(),
        width:  component.getWidth(),
        height: component.getHeight(),
    };
}

/** The pooled body rows, which `growRowPool` raw-appends out of the child tree. */
function pooledRows(table: Table): Row[] {
    return (table.getBody() as any)._rowPool as Row[];
}

/** The first cell on `row` whose concrete class is named `className`, or `null`. */
function cellOfClass(row: Row, className: string): Cell<any> | null {
    for (const cell of row.getComponents() as Cell<any>[]) {
        if (cell.constructor.name === className) {
            return cell;
        }
    }

    return null;
}

// One column per cell class R1 sweeps. `kind` resolves every cell to a boolean
// through `cellType`, which is what makes a `DynamicCell` report a preferred
// size — a `DynamicCell` over a string would report `null` like a `StringCell`
// and lose the sized arm.
const BODY_MODEL = new Model([
    { name: 'name',   type: 'string',  order: 0 },
    { name: 'active', type: 'boolean', order: 1 },
    { name: 'icon',   type: 'glyph',   order: 2 },
    { name: 'kind',   type: 'string',  order: 3 },
], 'name');

/** Enough records to fill the row pool and leave the body scrollable. */
const BODY_RECORDS = 40;

// An arbitrary non-zero left inset for R4 — any value the cell's own `Card`
// pass would shift its renderer by works; 7 matches no padding or border width
// in the theme, so a shift from some other cause cannot coincide with it.
const CELL_LEFT_INSET = 7;

/** A realized, laid-out table holding one cell of each class R1 sweeps. */
async function makeBodyTable(): Promise<{ table: Table; row: Row }> {
    const store = new MemoryStore(BODY_MODEL, Array.from({ length: BODY_RECORDS }, (_, i) => ({
        name: `n${i}`, active: i % 2 === 0, icon: 'caret-down', kind: 'boolean',
    })));
    await store.load();

    const table = track(new Table(store, { columns: [
        { field: 'name' },
        { field: 'active' },
        { field: 'icon' },
        { field: 'kind', cellType: () => 'boolean' },
    ] }));

    table.getElement(true);
    table.setWidth(600);
    table.setHeight(300);
    table.doLayout();
    runFrames();

    return { table, row: pooledRows(table)[0] };
}

// A narrow fixed-width `number` column beside a wide flexible `string` one, so
// the filter row holds one cell narrower than a `FilterCell`'s preferred width
// and one wider — the two directions the default manager would move.
const FILTER_MODEL = new Model([
    { name: 'a', type: 'number', order: 0 },
    { name: 'b', type: 'string', order: 1 },
], 'a');

/** A realized, laid-out table showing its header's filter row. */
async function makeFilterTable(): Promise<Table> {
    const store = new MemoryStore(FILTER_MODEL, [{ a: 1, b: 'b1' }]);
    await store.load();

    const table = track(new Table(store, { columns: [
        { field: 'a', filterable: true },
        { field: 'b', filterable: true },
    ] }));

    table.getElement(true);
    table.setWidth(600);
    table.setHeight(300);
    table.setFilterRowVisible(true);
    table.doLayout();
    runFrames();

    return table;
}

describe('Row — the layout pass a row records', () => {
    it.each([
        ['StringCell',  true],
        ['BooleanCell', false],
        ['GlyphCell',   false],
        ['DynamicCell', false],
    ] as const)('keeps its %s\'s rectangle across a row pass (R1)', async (className, nullPreferred) => {
        const { row } = await makeBodyTable();
        const cell    = cellOfClass(row, className);

        // The fixture reaches the pool by a private field, so prove it found
        // the cell this arm is about before asserting anything about it.
        expect(cell).not.toBeNull();
        expect(cell!.constructor.name).toBe(className);

        const before = rectOf(cell!);
        const pref   = cell!.getPreferredSize();

        expect(before.width).toBeGreaterThan(0);
        expect(before.height).toBeGreaterThan(0);
        // An axis swap in the committed arm is invisible on a square cell.
        expect(before.width).not.toBe(before.height);

        if (nullPreferred) {
            // The arm that hid the defect: both sizing modes agree here, so
            // this arm exists to catch a row that records no pass at all and a
            // committed arm that swaps the axes.
            expect(pref).toBeNull();
        } else {
            expect(pref).not.toBeNull();
            expect(pref!.width).not.toBe(before.width);
            expect(pref!.height).not.toBe(before.height);
        }

        row.invalidateLayout();

        expect(row.isLayoutDirty()).toBe(true);

        // A pooled row is parentless, so this is a top-level pass.
        row.scheduleLayout();
        runFrames();

        expect(row.isLayoutDirty()).toBe(false);
        expect(rectOf(cell!)).toEqual(before);
    });

    it('keeps both the grown and the shrunk arm of the filter row across a header pass (R2)', async () => {
        const table     = await makeFilterTable();
        const header     = table.getHeader();
        const filterRow  = header.getFilterRow();
        const [narrow, wide] = filterRow.getComponents() as Cell<any>[];

        expect(narrow).toBeTruthy();
        expect(wide).toBeTruthy();

        const beforeNarrow = rectOf(narrow);
        const beforeWide   = rectOf(wide);
        const pref         = narrow.getPreferredSize();

        expect(pref).not.toBeNull();
        // The two directions the default manager would move these cells. Height
        // does not discriminate — a filter cell's preferred height equals its
        // committed one — so the preconditions are on width only.
        expect(beforeNarrow.width).toBeLessThan(pref!.width);
        expect(beforeWide.width).toBeGreaterThan(pref!.width);

        filterRow.invalidateLayout();

        expect(filterRow.isLayoutDirty()).toBe(true);

        // The header runs the default `Absolute` over its three rows, so its
        // own pass is what reaches the filter row.
        header.scheduleLayout();
        runFrames();

        expect(filterRow.isLayoutDirty()).toBe(false);
        expect(rectOf(narrow)).toEqual(beforeNarrow);
        expect(rectOf(wide)).toEqual(beforeWide);
    });

    it('drains an onFirstLayout callback on a pooled row\'s first connected pass (R3)', async () => {
        const { row } = await makeBodyTable();

        let connected = false;
        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);

        let fired = 0;
        row.onFirstLayout(() => { fired++; });
        runFrames();

        // `onFirstLayout` schedules its own pass; while detached the drain
        // waits, so this pass must not run the callback.
        expect(fired).toBe(0);

        connected = true;
        row.scheduleLayout();
        runFrames();

        expect(fired).toBe(1);
    });

    it('runs a cell pass the flush folded into its row\'s pass (R4)', async () => {
        const { row } = await makeBodyTable();
        const cell    = cellOfClass(row, 'StringCell');

        expect(cell).not.toBeNull();

        const renderer = cell!.getComponents()[0];

        expect(renderer).toBeTruthy();

        const x0     = renderer.getX();
        const before = rectOf(cell!);

        // `Cell`'s constructor zeroes its insets — the padding lives on the
        // renderer — so the left inset written below is the whole shift the
        // cell's own `Card` pass must apply.
        expect(cell!.getInsets().getLeft()).toBe(0);

        // A left inset moves the renderer without moving the cell. Both are
        // queued in the same frame, so the flush drops the cell's pass and
        // relies on the row's pass to reach it.
        cell!.setInsets(new Insets(0, 0, 0, CELL_LEFT_INSET));
        cell!.scheduleLayout();
        row.scheduleLayout();

        expect(cell!.isLayoutDirty()).toBe(true);

        runFrames();

        expect(renderer.getX()).toBe(x0 + CELL_LEFT_INSET);
        expect(rectOf(cell!)).toEqual(before);
    });
});
