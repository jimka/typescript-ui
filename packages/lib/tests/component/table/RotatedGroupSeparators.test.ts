// Rotated mode drops every trace of Header's parent-header grouping today —
// this pins the group-separator row plans/in-progress/rotated-view-column-groups.md
// adds to the rotated projection: a separator record immediately before each
// contiguous run of a group's field/value rows, labeled with the group name
// and tinted with `groupColor` (first non-null wins). Mirrors
// RotatedView.test.ts's `makeStore` / `makeTable` helper style.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { GroupSeparatorCell } from '~/component/table/cell/GroupSeparator';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ModelRecord } from '~/data/ModelRecord';
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

const GROUP_COLOR = 'rgba(30, 100, 200, 0.06)';

const MODEL = new Model([
    { name: 'street', type: 'string', order: 0 },
    { name: 'city',   type: 'string', order: 1 },
    { name: 'zip',    type: 'string', order: 2 },
    { name: 'cost',   type: 'number', order: 3 },
]);

// street/city/zip share "Address" (color declared on city only — first
// non-null wins, matching Header's rule); cost is ungrouped.
const SPEC: ColumnSpec = {
    columns: [
        { field: 'street', group: 'Address' },
        { field: 'city',   group: 'Address', groupColor: GROUP_COLOR },
        { field: 'zip',    group: 'Address' },
        { field: 'cost' },
    ],
};

async function makeStore(): Promise<{ store: MemoryStore; records: ModelRecord[] }> {
    const store = new MemoryStore(MODEL, [
        { street: '1 Main St', city: 'Springfield', zip: '00001', cost: 100 },
        { street: '2 Main St', city: 'Shelbyville', zip: '00002', cost: 200 },
    ]);
    await store.load();

    return { store, records: store.getRecords() };
}

function makeTable(store: MemoryStore, spec: ColumnSpec = SPEC): Table {
    const table = new Table(store, spec);
    table.getElement(true);

    return table;
}

/** Reads the projection rows currently bound to the body, in display order. */
function rotatedRows(table: Table): ModelRecord[] {
    return (table as any)._body.getVisibleRecords();
}

/** The Table-owned identity map from separator record to its label/color. */
function separatorMap(table: Table): Map<ModelRecord, { label: string, color: string | null }> {
    return (table as any)._rotatedSeparatorRecords;
}

/** Renders `rows` as a compact label list: `sep:<label>` for a separator, the field name otherwise. */
function describeRows(table: Table, rows: ModelRecord[]): string[] {
    const seps = separatorMap(table);

    return rows.map(r => seps.has(r) ? `sep:${r.get('field')}` : String(r.get('field')));
}

describe('Table rotated mode — group separators', () => {
    it('inserts one separator before a contiguous grouped run, none around an ungrouped column', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');

        expect(describeRows(table, rotatedRows(table))).toEqual([
            'sep:Address', 'street', 'city', 'zip', 'cost',
        ]);
    });

    it("the separator's color is the first non-null groupColor in the run", async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');

        const rows = rotatedRows(table);
        const seps = separatorMap(table);
        const sep  = rows.find(r => seps.has(r))!;

        expect(seps.get(sep)?.color).toBe(GROUP_COLOR);
    });

    it('non-adjacent columns sharing a group name produce two separate separators', async () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
            { name: 'c', type: 'string', order: 2 },
        ]);
        const spec: ColumnSpec = {
            columns: [
                { field: 'a', group: 'X' },
                { field: 'b' },
                { field: 'c', group: 'X' },
            ],
        };
        const store = new MemoryStore(model, [{ a: '1', b: '2', c: '3' }]);
        await store.load();
        const table = makeTable(store, spec);

        table.setDisplayMode('rotated');

        expect(describeRows(table, rotatedRows(table))).toEqual([
            'sep:X', 'a', 'b', 'sep:X', 'c',
        ]);
    });

    it('hiding the middle column of a group merges the remaining ones into one run, mirroring the header parent cell', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.setColumnVisible('city', false);
        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');

        const rows = rotatedRows(table);

        expect(describeRows(table, rows)).toEqual(['sep:Address', 'street', 'zip', 'cost']);

        // Only `city` (now excluded from getSourceColumns()) carried a
        // groupColor, so the merged run's color falls back to null.
        expect(separatorMap(table).get(rows[0])?.color).toBeNull();
    });

    it('suppresses every separator while the rotated projection is sorted', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');

        await (table as any)._rotatedStore.sort([{ field: 'value', dir: 'asc' }]);

        const rows = rotatedRows(table);

        expect(rows.length).toBe(4);
        expect(rows.some(r => separatorMap(table).has(r))).toBe(false);
    });

    it('restores separators, in their original positions, once the sort is cleared', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');

        await (table as any)._rotatedStore.sort([{ field: 'value', dir: 'asc' }]);
        await (table as any)._rotatedStore.clearSort();

        expect(describeRows(table, rotatedRows(table))).toEqual([
            'sep:Address', 'street', 'city', 'zip', 'cost',
        ]);
    });

    it('clicking a separator row does not add anything to the selection', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');
        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        const body   = (table as any)._body;
        const sepRow = body.getRowPool().find((r: any) => r.isSeparator());

        expect(sepRow).toBeDefined();

        const before = new Set(body._selectedRecords);

        body.onRowClick(sepRow, makeEvent(sepRow.getElement(), 'click'));

        expect(body._selectedRecords).toEqual(before);
        expect(body._anchorRecord).toBeNull();
    });

    it('keyboard row navigation never lands the anchor on a separator', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');
        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        const body = (table as any)._body;
        const seps = separatorMap(table);
        const press = (key: string) => body.onKeyDown({ key, preventDefault: () => {} });

        for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown']) {
            press(key);
            expect(seps.has(body._anchorRecord)).toBe(false);
        }
    });

    it("ArrowUp from a leading group's first field row lands back on that row (skipSeparators backward fallback)", async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');
        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        const body          = (table as any)._body;
        const streetRecord = rotatedRows(table).find(r => r.get('field') === 'street')!;

        body.selectRecord(streetRecord);
        body.onKeyDown({ key: 'ArrowUp', preventDefault: () => {} });

        expect(body._anchorRecord).toBe(streetRecord);
    });

    it('a separator row renders a single GroupSeparatorCell, never a value-column typed cell', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');
        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        const body   = (table as any)._body;
        const sepRow = body.getRowPool().find((r: any) => r.isSeparator());

        expect(sepRow).toBeDefined();
        expect(sepRow.getComponents().length).toBe(1);
        expect(sepRow.getComponents()[0]).toBeInstanceOf(GroupSeparatorCell);
        expect(sepRow.getFieldNames()).toEqual([]);
    });

    it('rebuilds separators fresh and correctly after switching the displayed record', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');

        table.selectRecord(records[1]);

        const rows = rotatedRows(table);

        expect(describeRows(table, rows)).toEqual(['sep:Address', 'street', 'city', 'zip', 'cost']);

        const cityRow = rows.find(r => r.get('field') === 'city')!;

        expect(cityRow.get('value')).toBe(records[1].get('city'));
    });

    it('leaves the source table completely unaffected on return to normal mode', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');
        table.setDisplayMode('normal');

        expect(table.getColumns().map(c => c.getField().getName())).toEqual(['street', 'city', 'zip', 'cost']);
        expect(store.getRecords().length).toBe(records.length);
    });

    it('leaves setColumnVisible / setRowVisible as no-ops while rotated', async () => {
        const { store, records } = await makeStore();
        const table = makeTable(store);

        table.selectRecord(records[0]);
        table.setDisplayMode('rotated');

        table.setColumnVisible('street', false);
        expect(table.getColumns().length).toBe(3);

        table.setRowVisible(() => false);
        expect(rotatedRows(table).length).toBe(5);
    });
});
