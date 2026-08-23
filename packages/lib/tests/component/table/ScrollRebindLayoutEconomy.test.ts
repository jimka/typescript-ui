// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The surface half of the `Text.setText` auto-measure schedule fix
// (tests/component/input/TextAutoMeasureLayoutSchedule.test.ts holds the
// mechanism half). `CellRenderer.setValue` documents the contract this pins:
// "an implementation that only writes text needs no layout — the text does not
// auto-measure". A vertical scroll tick rebinds a pooled row at unchanged
// geometry, so `Body.bindAndPositionRows`'s `applyBounds` correctly withholds
// each cell's `doLayout` — but every renderer's `Text.setText` used to queue a
// next-frame layout for that renderer anyway, so the withheld pass came back
// through the coalesced queue and recomputed the same rectangle, once per
// rebound cell per tick.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { Row } from '~/component/table/Row';
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
// completion, queue included.
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

/** A realized, laid-out table over enough rows to scroll well past its pool. */
async function makeScrollableTable(): Promise<Table> {
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
    table.setHeight(320);
    table.doLayout();
    runFrames();

    return table;
}

function pooledRows(table: Table): Row[] {
    return (table.getBody() as any)._rowPool as Row[];
}

describe('Table — vertical scroll rebind economy', () => {
    it('lays out no pooled cell or renderer for a vertical scroll that moves no column', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const rowHeight = body.getRowHeight();

        // Settle first: scroll once so nothing measured below is first-time
        // work (a freshly grown pool slot legitimately lays out).
        body.setScrollY(rowHeight * 20);
        runFrames();

        const spies = pooledRows(table).flatMap(row => (row.getComponents() as Cell<any>[]).flatMap(cell => [
            vi.spyOn(cell, 'doLayout'),
            vi.spyOn(cell.getRenderer(), 'doLayout'),
        ]));

        // One row scrolls in. Its cells keep their column geometry exactly —
        // only the bound record changes — so nothing owes a layout pass.
        body.setScrollY(rowHeight * 21);
        runFrames();

        const called = spies.filter(spy => spy.mock.calls.length > 0);

        expect(called).toHaveLength(0);
    });

    it('still shows the rebound record', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const rowHeight = body.getRowHeight();

        body.setScrollY(rowHeight * 40);
        runFrames();

        const rendered = pooledRows(table)
            .map(row => (row.getComponents()[0] as Cell<any>).getRenderer().getDisplayText());

        expect(rendered).toContain('reference value 41');
    });
});
