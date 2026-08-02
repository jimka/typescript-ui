// Table surfaces the body's selection changes on its own "selection"
// event so consumers (e.g. a delete action) can react without reaching into the
// private body.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import type { CellClickEvent } from '~/component/table/Body';
import { TableExporter } from '~/component/table/TableExporter';
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

const MODEL = new Model([{ name: 'a', type: 'string', order: 0 }], 'a');

describe('Table selection event', () => {
    it('forwards the body selection on its own event', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }]);
        await store.load();

        const table = new Table(store);
        table.getElement(true);

        const seen: number[] = [];
        table.on('selection', (records: ModelRecord[]) => seen.push(records.length));

        // selectRecord on the body is the canonical mutation; addRow / clicks all
        // route through it. Triggering it must surface on the Table's event.
        const priv = table as unknown as { _body: { selectRecord(r: ModelRecord | null): void } };
        priv._body.selectRecord(store.getAll()[0]);
        priv._body.selectRecord(null);

        expect(seen).toEqual([1, 0]);
    });
});

describe('Table cellclick event', () => {
    it('forwards the body cellclick on its own event', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }]);
        await store.load();

        const table = new Table(store);
        table.getElement(true);

        const seen: CellClickEvent[] = [];
        table.on('cellclick', (e) => seen.push(e));

        // Drive the body's cellclick through its white-box row-click path; the
        // Table constructor subscribes to it and must re-emit its own.
        const priv  = table as any;
        const row   = priv._body.getRowPool()[0];
        const cells = row.getComponents();
        priv._body.onRowClick(row, makeEvent(cells[0].getElement(), 'click'));

        expect(seen).toHaveLength(1);
        expect(seen[0].field).toBe('a');
        expect(seen[0].record).toBe(store.getAll()[0]);
    });
});

// Column virtualization (table-column-virtualization plan): export and
// aria-colcount read the full resolved column list, never the body's
// rendered column window — see the plan's `## Expected Behaviour`.
describe('Column window — export and ARIA column count are scroll-independent', () => {
    const WIDE_MODEL = new Model(
        Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, type: 'string', order: i })),
        'c0',
    );

    async function wideTable(): Promise<Table> {
        const row: Record<string, string> = {};
        for (let i = 0; i < 20; i++) {
            row[`c${i}`] = `v${i}`;
        }

        const store = new MemoryStore(WIDE_MODEL, [row]);
        await store.load();

        const table = new Table(store);
        table.getElement(true);
        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        return table;
    }

    it('exportCSV on a wide table scrolled to the far right still emits every column, not just the windowed ones', async () => {
        const table = await wideTable();
        const body  = table.getBody();

        (body as any)._scroller.setScrollX(100000); // clamps to the content's far right
        expect((body as any)._scroller.getScrollX()).toBeGreaterThan(0);

        const spy = vi.spyOn(TableExporter, 'exportCSV').mockImplementation(() => {});
        table.exportCSV();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toHaveLength(20);
    });

    it('aria-colcount equals the full column count regardless of scroll position', async () => {
        const table = await wideTable();
        const body  = table.getBody();

        expect(table.getAria().getColCount()).toBe(20);

        (body as any)._scroller.setScrollX(100000);
        expect((body as any)._scroller.getScrollX()).toBeGreaterThan(0);

        expect(table.getAria().getColCount()).toBe(20);
    });

    // table-header-column-virtualization plan: `layout/Table.doLayout` derives
    // `columnCount` from `container.getColumns().length`, never the header's
    // own rendered-cell count. Reading the latter is fatal on the very first
    // layout — the header has rendered no window yet, so `columnCount` would
    // read 0, match the also-empty stored width array, and permanently block
    // width derivation.
    it('the first layout derives real column widths even though the header has not rendered a window yet', async () => {
        const table = await wideTable();

        expect(table.getColumnWidths().length).toBe(20);
        expect(table.getColumnWidths().every(w => w > 0)).toBe(true);
    });

    it('setStore on an already-sized table repopulates the header without the caller calling doLayout', async () => {
        const table = await wideTable();

        const otherModel = new Model(
            Array.from({ length: 5 }, (_, i) => ({ name: `d${i}`, type: 'string', order: i })),
            'd0',
        );
        const otherStore = new MemoryStore(otherModel, []);
        await otherStore.load();

        table.setStore(otherStore);

        const header = table.getHeader();
        const cells  = header.getColumns();

        expect(cells.length).toBe(5);
        expect(cells.map((c: any) => c.getFieldName()).sort()).toEqual(['d0', 'd1', 'd2', 'd3', 'd4']);
    });
});
