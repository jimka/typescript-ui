// Table.setDisplayMode re-binds the body through Table.bindView, which used
// to push the new store, columns, column configs, hidden-column set and four
// row predicates into Body one setter at a time — three of which each end in
// a pool-cell sync + a full render. These tests pin the render-economy
// contract from plans/implemented/table-bindview-redundant-rerender.md's
// `## Expected Behaviour` cases 1-4: one bulk `Body.bindViewState` call
// replaces that burst with one sync and at most two render passes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { TreeTable } from '~/component/table/TreeTable';
import { Body } from '~/component/table/Body';
import { Column } from '~/component/table/Column';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// Mirrors RotatedView.test.ts's four-field model — this suite exercises the
// same normal/rotated mode switch, just at the render-economy level rather
// than the projection-content level.
const MODEL = new Model([
    { name: 'id',      type: 'number',  order: 0 },
    { name: 'name',    type: 'string',  order: 1 },
    { name: 'active',  type: 'boolean', order: 2 },
    { name: 'created', type: 'date',    order: 3 },
]);

async function makeStore(): Promise<MemoryStore> {
    // `active` stays `false` on every record for the same reason
    // RotatedView.test.ts's makeStore keeps it `false` — see that file.
    const store = new MemoryStore(MODEL, [
        { id: 1, name: 'Alice', active: false, created: new Date(2024, 0, 1) },
        { id: 2, name: 'Bob',   active: false, created: new Date(2024, 0, 2) },
        { id: 3, name: 'Carol', active: false, created: new Date(2024, 0, 3) },
    ]);
    await store.load();

    return store;
}

/**
 * Builds a table sized to 600x400 and laid out while still in normal mode,
 * so the row pool holds bound rows before a `setDisplayMode` switch is
 * measured — a switch on an empty pool would trivially show no redundancy.
 */
async function makeSizedTable(): Promise<{ table: Table; body: any }> {
    const store = await makeStore();
    const table = new Table(store);

    table.getElement(true);
    table.setWidth(600);
    table.setHeight(400);
    table.doLayout();

    return { table, body: (table as any)._body };
}

describe('Table.setDisplayMode — bindView render economy', () => {
    it('case 1: invokes Body.syncPoolCells exactly once per switch into rotated mode', async () => {
        const { table, body } = await makeSizedTable();
        const spy = vi.spyOn(body, 'syncPoolCells');

        table.setDisplayMode('rotated');

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('case 2: invokes Body.syncPoolCells exactly once per switch back to normal mode', async () => {
        const { table, body } = await makeSizedTable();

        table.setDisplayMode('rotated');

        const spy = vi.spyOn(body, 'syncPoolCells');

        table.setDisplayMode('normal');

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('case 3: invokes Body.renderWindow at most twice per switch', async () => {
        const { table, body } = await makeSizedTable();
        const spy = vi.spyOn(body, 'renderWindow');

        table.setDisplayMode('rotated');

        expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('case 4: reconciles each pre-existing pooled row\'s column window at most twice per switch', async () => {
        const { table, body } = await makeSizedTable();

        const pool  = body.getRowPool() as Array<{ setColumnWindow(...args: unknown[]): boolean }>;
        const spies = pool.map((row) => vi.spyOn(row, 'setColumnWindow'));

        table.setDisplayMode('rotated');

        for (const spy of spies) {
            const reconciliations = spy.mock.results.filter((r) => r.value === true).length;

            expect(reconciliations).toBeLessThanOrEqual(2);
        }
    });

    it('case 7 (bindViewState): filters an unhideable column out of the hidden set it applies', async () => {
        // `bindViewState` itself is new post-fix code, so — unlike the
        // setHiddenColumns-based guard below, which runs against both
        // sources — this case has no pre-fix equivalent to run it against;
        // it exercises `bindViewState`'s own `filterUnhideable` pass
        // directly, the way cases 1-4 above exercise its render economy.
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
        ], 'a');
        const store = new MemoryStore(model, [{ a: '1', b: '2' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const columns = [
            new Column(model.getField('a')!, { field: 'a', unhideable: true }),
            new Column(model.getField('b')!),
        ];

        b.bindViewState({
            store,
            columns,
            columnConfigs: new Map(),
            hiddenColumns: new Set(['a', 'b']),
            rowReadOnly:   null,
            rowVisible:    null,
            rowSeparator:  null,
            rowIndented:   null,
        });

        const hidden = (b as any).getHiddenColumns() as Set<string>;

        expect(hidden.has('a')).toBe(false);
        expect(hidden.has('b')).toBe(true);
    });
});

// Behaviour-preservation guards (`## Expected Behaviour` cases 7-8): unlike
// cases 1-4 above, these pin behaviour that must hold both before and after
// the fix — run against the pre-fix source too, to confirm they guard the
// contract rather than merely agreeing with the new implementation.
describe('Body.bindViewState — behaviour-preservation guards', () => {
    it('case 7 (guard): the shared filterUnhideable pass survives the setHiddenColumns/bindViewState extraction', async () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
        ], 'a');
        const store = new MemoryStore(model, [{ a: '1', b: '2' }]);
        await store.load();

        const b = new Body(store);
        b.getElement(true);

        const columns = [
            new Column(model.getField('a')!, { field: 'a', unhideable: true }),
            new Column(model.getField('b')!),
        ];

        b.setColumns(columns);

        // Names both columns as hidden, even though `a` is unhideable. Goes
        // through `setColumns` + `setHiddenColumns` — not `bindViewState` —
        // so this guard runs against the pre-fix source too: `setHiddenColumns`
        // carried this same unhideable-filtering loop inline before it was
        // extracted into the private `filterUnhideable` that `bindViewState`
        // now also calls, so pinning `setHiddenColumns`'s result pins the
        // shared logic `bindViewState` depends on.
        b.setHiddenColumns(new Set(['a', 'b']));

        const hidden = (b as any).getHiddenColumns() as Set<string>;

        expect(hidden.has('a')).toBe(false);
        expect(hidden.has('b')).toBe(true);
    });

    it('case 8: a TreeTable mode switch keeps its flattened row list correct', async () => {
        const model = new Model([
            { name: 'id',     type: 'number', order: 0 },
            { name: 'parent', type: 'number', order: 1 },
            { name: 'name',   type: 'string', order: 2 },
        ], 'id');

        const store = new MemoryStore(model, [
            { id: 1, parent: null, name: 'root' },
            { id: 2, parent: 1,    name: 'child-a' },
            { id: 3, parent: 1,    name: 'child-b' },
        ]);
        await store.load();

        const tt = new TreeTable(store, { idField: 'id', parentField: 'parent', treeColumn: 'name', columns: [] });
        tt.getElement(true);

        const tb = tt.getBody();

        tb.setExpanded(tb.getRecordById(1)!, true);

        const before = (tb as any).getVisibleRecords().map((r: any) => r.get('id'));

        tt.setDisplayMode('rotated');
        tt.setDisplayMode('normal');

        const after = (tb as any).getVisibleRecords().map((r: any) => r.get('id'));

        expect(after).toEqual(before);
        expect(after).toEqual([1, 2, 3]);
    });
});
