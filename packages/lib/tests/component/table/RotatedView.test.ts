// Table's rotated ("\x"-style) display mode re-points the existing header
// and body at a two-field field/value projection built from the selected
// record. These tests pin the contract from
// plans/implemented/table-rotated-record-view.md's `## Expected Behaviour`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

const MODEL = new Model([
    { name: 'id',      type: 'number',  order: 0 },
    { name: 'name',    type: 'string',  order: 1 },
    { name: 'active',  type: 'boolean', order: 2 },
    { name: 'created', type: 'date',    order: 3 },
]);

async function makeStore(): Promise<{ store: MemoryStore; records: ModelRecord[] }> {
    // `active` is kept `false` on every record: a `true` value would flip
    // the row pool's checkbox editor away from its constructed-indeterminate
    // default, and `Checkbox.setSelected` dispatches a synthetic DOM `click`
    // on every real transition — routing into `Body.onSubtreeClick`'s
    // `instanceof MouseEvent` check, which throws under this suite's `node`
    // vitest environment (no global `MouseEvent`, unlike a `jsdom` one). That
    // gap is pre-existing and orthogonal to rotated mode (it reproduces for
    // any boolean column bound in "normal" mode too); staying on the
    // checkbox's default value sidesteps it without weakening any assertion
    // below, none of which depend on `active` actually differing per record.
    const store = new MemoryStore(MODEL, [
        { id: 1, name: 'Alice', active: false, created: new Date(2024, 0, 1) },
        { id: 2, name: 'Bob',   active: false, created: new Date(2024, 0, 2) },
        { id: 3, name: 'Carol', active: false, created: new Date(2024, 0, 3) },
    ]);
    await store.load();

    return { store, records: store.getRecords() };
}

function makeTable(store: MemoryStore): Table {
    const table = new Table(store);
    table.getElement(true);

    return table;
}

/** Reads the projection rows currently bound to the body, in display order. */
function rotatedRows(table: Table): ModelRecord[] {
    return (table as any)._body.getVisibleRecords();
}

describe('Table rotated mode', () => {
    it('defaults to normal mode with one column per field', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        expect(table.getDisplayMode()).toBe('normal');
        expect(table.getColumns().length).toBe(4);
    });

    it('rotation swaps the column set to field/value', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        table.setDisplayMode('rotated');

        const cols = table.getColumns();

        expect(cols.length).toBe(2);
        expect(cols.map(c => c.getField().getName())).toEqual(['field', 'value']);
    });

    it('produces one projection row per visible source column, in source order', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        table.setDisplayMode('rotated');

        const rows = rotatedRows(table);

        expect(rows.length).toBe(4);
        expect(rows.map(r => r.get('field'))).toEqual(['id', 'name', 'active', 'created']);
    });

    it('populates values from the displayed record', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const record2 = records[1];

        table.selectRecord(record2);
        table.setDisplayMode('rotated');

        for (const row of rotatedRows(table)) {
            expect(row.get('value')).toEqual(record2.get(row.get('field')));
        }
    });

    it('omits a hidden source column from the field list', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        table.setColumnVisible('created', false);
        table.setDisplayMode('rotated');

        const rows = rotatedRows(table);

        expect(rows.length).toBe(3);
        expect(rows.some(r => r.get('field') === 'created')).toBe(false);
    });

    it('returns the source record as the selection while rotated', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const record2 = records[1];

        table.selectRecord(record2);
        table.setDisplayMode('rotated');

        expect(table.getSelectedRecord()).toBe(record2);
        expect(table.getSelectedRecords()).toEqual([record2]);
    });

    it('selectRecord re-targets the rotated view', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const record2 = records[1];
        const record3 = records[2];

        table.selectRecord(record2);
        table.setDisplayMode('rotated');

        const seen: ModelRecord[][] = [];
        table.on('selection', recs => seen.push(recs));

        table.selectRecord(record3);

        const rows = rotatedRows(table);

        expect(rows.length).toBe(4);

        for (const row of rows) {
            expect(row.get('value')).toEqual(record3.get(row.get('field')));
        }

        expect(seen).toEqual([[record3]]);
    });

    it('rotating an empty store yields no rows and no selection', async () => {
        const store = new MemoryStore(MODEL, []);
        await store.load();
        const table = makeTable(store);

        expect(() => table.setDisplayMode('rotated')).not.toThrow();
        expect(rotatedRows(table).length).toBe(0);
        expect(table.getSelectedRecord()).toBeNull();
    });

    it('picks up a live edit to the displayed record', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const record2 = records[1];

        table.selectRecord(record2);
        table.setDisplayMode('rotated');

        record2.set('name', 'changed');
        store.notifyRecordChanged(record2);

        const rows = rotatedRows(table);
        const nameRow = rows.find(r => r.get('field') === 'name');

        expect(rows.length).toBe(4);
        expect(nameRow?.get('value')).toBe('changed');
    });

    it('re-targets to the first remaining record when the displayed record is removed', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const record2 = records[1];

        table.selectRecord(record2);
        table.setDisplayMode('rotated');

        const seen: ModelRecord[][] = [];
        table.on('selection', recs => seen.push(recs));

        store.remove(record2);

        const remaining = store.getRecords()[0];

        expect(table.getSelectedRecord()).toBe(remaining);
        expect(seen[seen.length - 1]).toEqual([remaining]);
    });

    it('re-targets to the new first record on a store reload', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const record2 = records[1];

        table.selectRecord(record2);
        table.setDisplayMode('rotated');

        store.loadData([
            { id: 9, name: 'New', active: false, created: new Date(2024, 5, 1) },
        ]);

        const newRecord = store.getRecords()[0];
        const rows = rotatedRows(table);

        expect(table.getSelectedRecord()).toBe(newRecord);
        expect(rows.length).toBe(4);

        for (const row of rows) {
            expect(row.get('value')).toEqual(newRecord.get(row.get('field')));
        }
    });

    it('restores the normal view on a round trip, keeping the displayed record selected', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const record2 = records[1];

        table.selectRecord(record2);
        table.setDisplayMode('rotated');
        table.setDisplayMode('normal');

        expect(table.getColumns().length).toBe(4);
        expect(table.getSelectedRecord()).toBe(record2);
    });

    it('is idempotent: calling setDisplayMode("rotated") twice fires "selection" once', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        const seen: ModelRecord[][] = [];
        table.on('selection', recs => seen.push(recs));

        table.setDisplayMode('rotated');
        table.setDisplayMode('rotated');

        expect(seen.length).toBe(1);
    });

    it('re-initializes column widths for the two-column layout after doLayout', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        table.setWidth(600);
        table.setHeight(400);
        table.setDisplayMode('rotated');
        table.doLayout();

        const widths = table.getColumnWidths();

        expect(widths.length).toBe(2);
        expect(widths[0]).toBeGreaterThanOrEqual(80);
        expect(widths[1]).toBeGreaterThanOrEqual(120);
    });

    it('makes setColumnVisible inert while rotated', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        table.setDisplayMode('rotated');
        table.setColumnVisible('id', false);

        expect(table.getColumns().length).toBe(2);
    });

    it('leaves rotated mode when setStore is called', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        table.setDisplayMode('rotated');

        const otherStore = new MemoryStore(MODEL, [
            { id: 5, name: 'Dana', active: true, created: new Date(2024, 6, 1) },
        ]);
        await otherStore.load();

        table.setStore(otherStore);

        expect(table.getDisplayMode()).toBe('normal');
        expect(table.getColumns().map(c => c.getField().getName())).toEqual(['id', 'name', 'active', 'created']);
    });

    it('renders every projection cell read-only', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');
        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        const pool = (table as any)._body.getRowPool();
        const boundRows = pool.filter((r: any) => r.getData());

        expect(boundRows.length).toBeGreaterThan(0);

        for (const row of boundRows) {
            for (const cell of row.getComponents()) {
                expect(cell.isReadOnly()).toBe(true);
            }
        }
    });

    it('leaves the source store untouched by a rotate/un-rotate round trip', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        const recordCountBefore = store.getRecords().length;
        const sortersBefore = store.getActiveSorters();

        table.setDisplayMode('rotated');
        table.setDisplayMode('normal');

        expect(store.getRecords().length).toBe(recordCountBefore);
        expect(store.getActiveSorters()).toEqual(sortersBefore);
    });
});
