// Table.setRowVisible / Body.setRowVisible add a live, consumer-settable
// predicate that hides rows without touching the store — the primitive a
// client-side quick search needs. These tests pin the contract from
// plans/in-progress/table-row-visibility.md's `## Expected Behaviour`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { TreeTable } from '~/component/table/TreeTable';
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
    // `active` stays `false` on every record — see RotatedView.test.ts's
    // makeStore for why a real transition on the checkbox editor is avoided
    // here; that gap is orthogonal to row visibility.
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

/** Reads the records currently bound to the body, in display order. */
function visibleRecords(table: Table): ModelRecord[] {
    return (table as any)._body.getVisibleRecords();
}

describe('Table row visibility — defaults and clearing', () => {
    it('every store record renders before any setRowVisible call', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        expect(visibleRecords(table)).toEqual(records);
    });

    it('setRowVisible(null) after a predicate was active clears filtering', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.setRowVisible(r => r.get('id') === 1);
        table.setRowVisible(null);

        expect(visibleRecords(table)).toEqual(records);
    });
});

describe('Table row visibility — filtering', () => {
    it('leaves only matching records, in store order', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.setRowVisible(r => (r.get('id') as number) !== 2);

        expect(visibleRecords(table)).toEqual([records[0], records[2]]);
    });

    it('a predicate matching zero records yields an empty list and a zero-size window', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        expect(() => table.setRowVisible(() => false)).not.toThrow();

        const records = visibleRecords(table);

        expect(records.length).toBe(0);

        const body = (table as any)._body;
        const win  = body.computeVisibleWindow(0, 240, records.length);

        expect(win.windowSize).toBe(0);
    });
});

describe('Table row visibility — automatic re-application on rebind triggers', () => {
    it('a newly added record is hidden or shown per the active predicate', async () => {
        const { store } = await makeStore();
        const table = makeTable(store);

        table.setRowVisible(r => (r.get('id') as number) % 2 === 0);

        const [failing] = store.add({ id: 5, name: 'Eve', active: false, created: new Date(2024, 0, 5) });
        expect(visibleRecords(table)).not.toContain(failing);

        const [passing] = store.add({ id: 6, name: 'Frank', active: false, created: new Date(2024, 0, 6) });
        expect(visibleRecords(table)).toContain(passing);
    });

    it('removing a currently-hidden record does not throw and leaves the visible set correct', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.setRowVisible(r => (r.get('id') as number) !== 2);
        expect(() => store.remove(records[1])).not.toThrow();

        expect(visibleRecords(table)).toEqual([records[0], records[2]]);
    });

    it('editing a bound record so it now fails the predicate hides it on the next render pass', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const bob = records[1];

        table.setRowVisible(r => r.get('name') !== 'Bob (edited)');
        expect(visibleRecords(table)).toContain(bob);

        // Mirrors what an in-grid edit fires: the field write plus the
        // explicit store notification (see RotatedView.test.ts's "picks up a
        // live edit to the displayed record").
        bob.set('name', 'Bob (edited)');
        store.notifyRecordChanged(bob);

        expect(visibleRecords(table)).not.toContain(bob);
    });

    it('toggling column visibility does not clear or bypass the active predicate', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.setRowVisible(r => (r.get('id') as number) !== 2);

        table.setColumnVisible('created', false);
        expect(visibleRecords(table)).toEqual([records[0], records[2]]);

        table.setColumnVisible('created', true);
        expect(visibleRecords(table)).toEqual([records[0], records[2]]);
    });
});

describe('Table row visibility — sort ordering', () => {
    it('applies the predicate after the store\'s own sort, never before', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        await store.sort('name', 'desc'); // Carol, Bob, Alice
        table.setRowVisible(r => (r.get('id') as number) !== 2); // drop Bob

        const [alice, bob, carol] = records;
        void bob;

        expect(visibleRecords(table)).toEqual([carol, alice]);
    });
});

describe('Table row visibility — display-only guarantee', () => {
    it('a hidden record stays selected', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const bob = records[1];

        table.selectRecord(bob);
        table.setRowVisible(r => (r.get('id') as number) !== 2);

        expect(table.getSelectedRecords()).toEqual([bob]);
        expect((table as any)._body.getSelectedRecords()).toEqual([bob]);
    });

    it('hiding and un-hiding a dirty record leaves the store\'s pending-change state and the dirty value untouched', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const bob = records[1];

        bob.set('name', 'Bobby');
        expect(store.hasPendingChanges()).toBe(true);

        table.setRowVisible(r => (r.get('id') as number) !== 2);
        expect(store.hasPendingChanges()).toBe(true);

        table.setRowVisible(null);
        expect(store.hasPendingChanges()).toBe(true);
        expect(bob.get('name')).toBe('Bobby');
    });

    it('selecting then hiding the anchor record does not throw when the focus/active-descendant paths run', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);
        const bob = records[1];

        table.selectRecord(bob);
        table.setRowVisible(r => (r.get('id') as number) !== 2);

        const body = (table as any)._body;

        expect(() => body._updateFocusStyle()).not.toThrow();
        expect(() => body._updateActiveDescendant()).not.toThrow();
    });
});

describe('Table row visibility — rotated mode', () => {
    it('neutralizes the predicate while rotated: every projection row renders', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setRowVisible(() => false);
        table.setDisplayMode('rotated');

        expect(visibleRecords(table).length).toBe(4); // one row per source field
    });

    it('restores the same predicate on return to normal, with no new setRowVisible call', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.setRowVisible(r => (r.get('id') as number) !== 2);
        table.setDisplayMode('rotated');
        table.setDisplayMode('normal');

        expect(visibleRecords(table)).toEqual([records[0], records[2]]);
    });

    it('a setRowVisible call while rotated has no immediate effect but is picked up on return to normal', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.setRowVisible(r => (r.get('id') as number) !== 2); // exclude Bob
        table.setDisplayMode('rotated');

        const rotatedCountBefore = visibleRecords(table).length;

        table.setRowVisible(r => (r.get('id') as number) !== 3); // exclude Carol instead, while rotated

        expect(visibleRecords(table).length).toBe(rotatedCountBefore); // rotated rows unaffected

        table.setDisplayMode('normal');

        expect(visibleRecords(table)).toEqual([records[0], records[1]]); // Carol dropped, not Bob
    });
});

describe('Table row visibility — TreeTable non-effect', () => {
    it('setRowVisible is inherited but has no effect on a TreeTable\'s flattened row list', async () => {
        const treeModel = new Model([
            { name: 'id',     type: 'number', order: 0 },
            { name: 'parent', type: 'number', order: 1 },
            { name: 'name',   type: 'string', order: 2 },
        ], 'id');
        const store = new MemoryStore(treeModel, [
            { id: 1, parent: null, name: 'first' },
            { id: 2, parent: null, name: 'second' },
        ]);
        await store.load();

        const treeTable = new TreeTable(store, { idField: 'id', parentField: 'parent', treeColumn: 'name', columns: [] });
        treeTable.getElement(true);

        const before = (treeTable.getBody() as any).getVisibleRecords();

        treeTable.setRowVisible(() => false);

        const after = (treeTable.getBody() as any).getVisibleRecords();

        expect(after).toEqual(before);
        expect(after.length).toBe(2);
    });
});
