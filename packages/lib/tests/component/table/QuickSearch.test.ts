// Table.setQuickSearch(text, fields?) hides every row whose displayed cell
// text does not contain `text`, matched case-insensitively — a single call
// replacing the hand-rolled setRowVisible + per-record cache pattern the
// demos used to build by hand. These tests pin the contract from
// plans/in-progress/table-quick-search.md's `## Expected Behaviour`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { TreeTable } from '~/component/table/TreeTable';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';
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
    { name: 'name',    type: 'string',   order: 0 },
    { name: 'role',    type: 'string',   order: 1 },
    { name: 'score',   type: 'number',   order: 2 },
    { name: 'active',  type: 'boolean',  order: 3 },
    { name: 'joined',  type: 'date',     order: 4 },
    { name: 'meeting', type: 'time',     order: 5 },
    { name: 'seen',    type: 'datetime', order: 6 },
    { name: 'notes',   type: 'string',   order: 7 },
    { name: 'secret',  type: 'string',   order: 8 },
]);

const SPEC: ColumnSpec = {
    columns: [
        { field: 'role',   values: [{ value: 'dev', label: 'Developer' }, { value: 'qa', label: 'QA Engineer' }] },
        { field: 'notes',  hidden: true },
        { field: 'secret', filterable: false },
    ],
};

async function makeStore(): Promise<{ store: MemoryStore; records: ModelRecord[] }> {
    // `active` stays `false` on every record — see RowVisibility.test.ts's
    // makeStore for why a real transition on the checkbox editor is avoided
    // here: a `true` value flips the row pool's checkbox editor away from
    // its constructed-indeterminate default, and `Checkbox.setSelected`
    // dispatches a synthetic DOM `click` that throws under this suite's
    // `node` vitest environment (no global `MouseEvent`). No case below
    // depends on which record holds which boolean value — only that the
    // `boolean` column as a whole is outside quick search's default scope.
    const store = new MemoryStore(MODEL, [
        {
            name: 'Alice', role: 'dev', score: 95, active: false,
            joined: new Date(2021, 2, 15), meeting: new Date(2021, 2, 15, 9, 30), seen: new Date(2021, 2, 15, 9, 45),
            notes: 'top performer', secret: 'zebra',
        },
        {
            name: 'Bob', role: 'qa', score: 72, active: false,
            joined: new Date(2022, 7, 3), meeting: new Date(2022, 7, 3, 14, 0), seen: new Date(2022, 7, 3, 14, 15),
            notes: 'follow up', secret: 'walrus',
        },
        {
            name: 'Carol', role: 'dev', score: 88, active: false,
            joined: new Date(2020, 11, 20), meeting: new Date(2020, 11, 20, 11, 0), seen: new Date(2020, 11, 20, 11, 10),
            notes: 'on track', secret: 'otter',
        },
    ]);
    await store.load();

    return { store, records: store.getRecords() };
}

function makeTable(store: MemoryStore, spec?: ColumnSpec): Table {
    const table = new Table(store, spec);
    table.getElement(true);

    return table;
}

/** Reads the records currently bound to the body, in display order. */
function visibleRecords(table: Table): ModelRecord[] {
    return (table as any)._body.getVisibleRecords();
}

describe('Table quick search — defaults and clearing', () => {
    it('every store record renders before any setQuickSearch call', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        expect(visibleRecords(table)).toEqual(records);
    });

    it('null, empty, and whitespace-only text each restore every record', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('ali');
        table.setQuickSearch(null);
        expect(visibleRecords(table)).toEqual(records);

        table.setQuickSearch('ali');
        table.setQuickSearch('');
        expect(visibleRecords(table)).toEqual(records);

        table.setQuickSearch('ali');
        table.setQuickSearch('   ');
        expect(visibleRecords(table)).toEqual(records);
    });
});

describe('Table quick search — matching', () => {
    it('matches a case-insensitive substring of a string column', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('ali');

        expect(visibleRecords(table)).toEqual([records[0]]);
    });

    it('matches case-insensitively in both directions', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('ALI');
        expect(visibleRecords(table)).toEqual([records[0]]);

        table.setQuickSearch('alice');
        expect(visibleRecords(table)).toEqual([records[0]]);
    });

    it('matches a combo column by its option label, not its stored code', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('developer');
        expect(visibleRecords(table)).toEqual([records[0], records[2]]);

        table.setQuickSearch('qa engineer');
        expect(visibleRecords(table)).toEqual([records[1]]);
    });

    it('matches a date/time/datetime column by its formatted display text', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);
        const alice = records[0];

        table.setQuickSearch(table.getCellText('joined', alice));
        expect(visibleRecords(table)).toEqual([alice]);

        table.setQuickSearch(table.getCellText('meeting', alice));
        expect(visibleRecords(table)).toEqual([alice]);

        table.setQuickSearch(table.getCellText('seen', alice));
        expect(visibleRecords(table)).toEqual([alice]);
    });

    it('matches a number column', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);
        const alice = records[0];

        table.setQuickSearch(String(alice.get('score')));

        expect(visibleRecords(table)).toEqual([alice]);
    });

    it('matches a hidden column', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('top performer');

        expect(visibleRecords(table)).toEqual([records[0]]);
    });

    it('does not search a column with filterable: false', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('zebra');

        expect(visibleRecords(table)).toEqual([]);
    });

    it('does not search a boolean column', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('true');
        expect(visibleRecords(table)).toEqual([]);

        table.setQuickSearch('false');
        expect(visibleRecords(table)).toEqual([]);
    });

    it('does not match a needle spanning two fields, since cached text is newline-joined', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('alice developer');

        expect(visibleRecords(table)).toEqual([]);
    });
});

describe('Table quick search — explicit fields', () => {
    it('searches an explicitly named field even when its column is filterable: false', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('zebra', ['secret']);

        expect(visibleRecords(table)).toEqual([records[0]]);
    });

    it('does not search a field outside the given list, even one in the default scope', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('ali', ['role']);

        expect(visibleRecords(table)).toEqual([]);
    });

    it('an unknown field name contributes empty text and throws nothing', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        expect(() => table.setQuickSearch('ali', ['nosuchfield'])).not.toThrow();
        expect(visibleRecords(table)).toEqual([]);
    });

    it('an empty fields array searches no columns and matches nothing', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('ali', []);

        expect(visibleRecords(table)).toEqual([]);
    });
});

describe('Table quick search — composition with setRowVisible', () => {
    it('composes with setRowVisible via AND, in either call order', async () => {
        const { store, records } = await makeStore();
        const table1 = makeTable(store, SPEC);

        table1.setQuickSearch('developer');
        table1.setRowVisible(r => r.get('name') !== 'Carol');
        expect(visibleRecords(table1)).toEqual([records[0]]);

        const { store: store2, records: records2 } = await makeStore();
        const table2 = makeTable(store2, SPEC);

        table2.setRowVisible(r => r.get('name') !== 'Carol');
        table2.setQuickSearch('developer');
        expect(visibleRecords(table2)).toEqual([records2[0]]);
    });

    it('clearing quickSearch leaves the setRowVisible predicate active', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('developer');
        table.setRowVisible(r => r.get('name') !== 'Carol');

        table.setQuickSearch(null);

        expect(visibleRecords(table)).toEqual([records[0], records[1]]);
    });

    it('clearing setRowVisible leaves the quick search active', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('developer');
        table.setRowVisible(r => r.get('name') !== 'Carol');

        table.setRowVisible(null);

        expect(visibleRecords(table)).toEqual([records[0], records[2]]);
    });
});

describe('Table quick search — caching and freshness', () => {
    it('a batch edit (beginEdit/commitEdit) leaves cached search text stale', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);
        const bob = records[1];

        table.setQuickSearch('qa engineer');
        expect(visibleRecords(table)).toEqual([bob]);

        // commitEdit() emits only 'datachange', no per-record 'update' — the
        // cache is never told this record changed.
        store.beginEdit();
        bob.set('role', 'dev');
        store.commitEdit();

        expect(visibleRecords(table)).toEqual([bob]);
    });

    it('record.set + notifyRecordChanged re-tests that record against fresh text', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);
        const [, bob, carol] = records;

        table.setQuickSearch('qa engineer');
        expect(visibleRecords(table)).toEqual([bob]);

        // Mirrors what an in-grid edit fires (see RowVisibility.test.ts).
        bob.set('role', 'dev');
        store.notifyRecordChanged(bob);
        expect(visibleRecords(table)).not.toContain(bob);

        carol.set('role', 'qa');
        store.notifyRecordChanged(carol);
        expect(visibleRecords(table)).toContain(carol);
    });

    it('a record added to the store is tested against the active search on its own text', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('developer');

        const [dave] = store.add({
            name: 'Dave', role: 'dev', score: 50, active: false,
            joined: new Date(2023, 5, 1), meeting: new Date(2023, 5, 1, 10, 0), seen: new Date(2023, 5, 1, 10, 5),
            notes: '', secret: '',
        });
        expect(visibleRecords(table)).toContain(dave);

        const [erin] = store.add({
            name: 'Erin', role: 'qa', score: 60, active: false,
            joined: new Date(2023, 5, 2), meeting: new Date(2023, 5, 2, 11, 0), seen: new Date(2023, 5, 2, 11, 5),
            notes: '', secret: '',
        });
        expect(visibleRecords(table)).not.toContain(erin);
    });
});

describe('Table quick search — store replacement', () => {
    it('re-applies the same search against a new store on the same model', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('ali');

        const otherStore = new MemoryStore(MODEL, [
            {
                name: 'Alina', role: 'dev', score: 10, active: false,
                joined: new Date(2023, 0, 1), meeting: new Date(2023, 0, 1, 8, 0), seen: new Date(2023, 0, 1, 8, 5),
                notes: '', secret: '',
            },
            {
                name: 'Zara', role: 'qa', score: 20, active: false,
                joined: new Date(2023, 0, 2), meeting: new Date(2023, 0, 2, 9, 0), seen: new Date(2023, 0, 2, 9, 5),
                notes: '', secret: '',
            },
        ]);
        await otherStore.load();

        table.setStore(otherStore);

        expect(visibleRecords(table)).toEqual([otherStore.getRecords()[0]]);
    });

    it('re-derives the searched field list against a store on a different model', async () => {
        const { store } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('ali');

        const otherModel = new Model([
            { name: 'fullName', type: 'string', order: 0 },
            { name: 'title',    type: 'string', order: 1 },
        ]);
        const otherStore = new MemoryStore(otherModel, [
            { fullName: 'Alina', title: 'dev' },
            { fullName: 'Zara',  title: 'qa' },
        ]);
        await otherStore.load();

        table.setStore(otherStore);

        expect(visibleRecords(table)).toEqual([otherStore.getRecords()[0]]);
    });
});

describe('Table quick search — rotated mode', () => {
    it('renders every projection row regardless of an active search', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');
        const baseline = visibleRecords(table).length;
        table.setDisplayMode('normal');

        table.setQuickSearch('nonexistentneedlexyz');
        table.setDisplayMode('rotated');

        expect(visibleRecords(table).length).toBe(baseline);
    });

    it('restores the active search on return to normal, with no new setQuickSearch call', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('developer');
        table.setDisplayMode('rotated');
        table.setDisplayMode('normal');

        expect(visibleRecords(table)).toEqual([records[0], records[2]]);
    });

    it('a setQuickSearch call while rotated has no immediate effect but is picked up on return to normal', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store, SPEC);

        table.setQuickSearch('developer'); // Alice, Carol
        table.setDisplayMode('rotated');

        const rotatedCountBefore = visibleRecords(table).length;

        table.setQuickSearch('qa engineer'); // switch to Bob only, while rotated

        expect(visibleRecords(table).length).toBe(rotatedCountBefore);

        table.setDisplayMode('normal');

        expect(visibleRecords(table)).toEqual([records[1]]);
    });
});

describe('Table quick search — TreeTable non-effect', () => {
    it('setQuickSearch is inherited but has no effect on a TreeTable\'s flattened row list', async () => {
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

        treeTable.setQuickSearch('x');

        const after = (treeTable.getBody() as any).getVisibleRecords();

        expect(after).toEqual(before);
        expect(after.length).toBe(2);
    });
});
