// Offline coverage for plans/table-column-resize-exempt.md's
// `## Expected Behaviour` cases 3-7 — `ColumnConfig.preserveWidth` exempting
// a column from layout/Table.ts's resize-driven proportional rescaling.
// Cases are numbered to match the plan; cases 1-2 (the plain Column
// construction/getter round-trip) live in Column.test.ts instead.
//
// Fixture: the shared `installTestDOM` fixture from
// dom/font-metrics.test-font.json and the same `CONFIG` object
// ColumnResize.test.ts uses (`scrollBarWidth: 15`, viewport 1280x800) —
// `setWidth(w)` yields an available column width of `w - 14` (Scrollbar's
// TRACK_WIDTH plus Table's 1px-per-side border), per that file's own
// comment.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

async function makeStore(model: Model, records: Record<string, unknown>[] = []): Promise<MemoryStore> {
    const store = new MemoryStore(model, records);
    await store.load();

    return store;
}

describe('preserveWidth', () => {
    it('3. first render ignores preserveWidth', () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
        ]);
        const spec: ColumnSpec = {
            columns: [
                { field: 'a', preserveWidth: true },
                { field: 'b' },
            ],
        };
        const store = new MemoryStore(model, []);
        const table = new Table(store, spec);

        table.getElement(true);
        table.setWidth(514);
        table.setHeight(400);
        table.doLayout();

        const widths = table.getColumnWidths();

        expect(widths[0]).toBe(widths[1]);
    });

    it('4. a preserveWidth column keeps its exact width across a resize; a plain flex sibling rescales', () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
        ]);
        const spec: ColumnSpec = {
            columns: [
                { field: 'a', minWidth: 30, preserveWidth: true },
                { field: 'b', minWidth: 30 },
            ],
        };
        const store = new MemoryStore(model, []);
        const table = new Table(store, spec);

        table.getElement(true);
        table.setWidth(514); // available 500
        table.setHeight(400);
        table.doLayout();
        table.setColumnWidths([250, 250]);

        table.setWidth(314); // available 300
        table.doLayout();

        expect(table.getColumnWidths()).toEqual([250, 50]);
    });

    it('5. a preserveWidth column never receives absorbed slack, even with no maxWidth', () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
            { name: 'c', type: 'string', order: 2 },
        ]);
        const spec: ColumnSpec = {
            columns: [
                { field: 'a', minWidth: 30, preserveWidth: true },
                { field: 'b', minWidth: 30, maxWidth: 80 },
                { field: 'c', minWidth: 30 },
            ],
        };
        const store = new MemoryStore(model, []);
        const table = new Table(store, spec);

        table.getElement(true);
        table.setWidth(314); // available 300
        table.setHeight(400);
        table.doLayout();
        table.setColumnWidths([100, 80, 120]);

        table.setWidth(414); // available 400
        table.doLayout();

        expect(table.getColumnWidths()).toEqual([100, 80, 220]);
    });

    it('6. a preserveWidth column that no longer fits falls back to horizontal scroll, not a crash or a collapse', () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
        ]);
        const spec: ColumnSpec = {
            columns: [
                { field: 'a', minWidth: 30, preserveWidth: true },
                { field: 'b', minWidth: 30 },
            ],
        };
        const store = new MemoryStore(model, []);
        const table = new Table(store, spec);

        table.getElement(true);
        table.setWidth(514); // available 500
        table.setHeight(400);
        table.doLayout();
        table.setColumnWidths([250, 250]);

        table.setWidth(154); // available 140, less than `a` alone
        table.doLayout();

        const widths = table.getColumnWidths();

        expect(widths).toEqual([250, 250]);
        expect(widths.every(w => Number.isFinite(w))).toBe(true);
        expect(widths.reduce((s, w) => s + w, 0)).toBeGreaterThan(140);
    });

    it('7. preserveWidth composes end-to-end with autoSizeColumns (the motivating scenario)', async () => {
        const model = new Model([
            { name: 'short', type: 'string', order: 0 },
            { name: 'long',  type: 'string', order: 1 },
        ]);
        const spec: ColumnSpec = {
            columns:         [{ field: 'long', preserveWidth: true }],
            autoSizeColumns: true,
        };
        const records = [{ short: 'ab', long: 'a fairly long piece of sampled content' }];
        const store   = await makeStore(model, records);
        const table   = new Table(store, spec);

        table.getElement(true);
        table.setWidth(700); // available 686
        table.setHeight(400);
        table.doLayout();

        const [shortBefore, longBefore] = table.getColumnWidths();

        table.setWidth(500); // available 486 — 200px narrower, forces a real rescale
        table.doLayout();

        const [shortAfter, longAfter] = table.getColumnWidths();

        expect(longAfter).toBe(longBefore);
        expect(shortAfter).not.toBe(shortBefore);
    });
});
