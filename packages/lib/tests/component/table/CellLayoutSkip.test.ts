// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for `Cell.canSkipUnchangedLayout`'s opt-in, threaded through a real
// `Table` — the parity check for the deleted `CellGeometryCache`, plus the
// negative half the earlier attempt at this skip was missing (see the plan's
// `[^negative-half]` note). Cases are numbered to match
// `layout-calc-commit-split.md`'s `## Expected Behaviour` list (11-15); 1-10
// live in `tests/core/ComponentBounds.test.ts`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { Row } from '~/component/table/Row';
import { Cell } from '~/component/table/cell/Cell';
import { DynamicCell } from '~/component/table/cell/Dynamic';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ModelRecord } from '~/data/ModelRecord';
import type { CellType, ColumnSpec } from '~/component/table/ColumnConfig';
import { ThemeManager, ModernTheme } from '~/core/Theme';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Every table this file constructs, disposed in `afterEach` before the DOM
// resets. An undisposed table keeps its Header/Body theme subscriptions
// alive — `ThemeManager.setTheme` fires every listener still registered in
// the process — so a later test's theme change would otherwise reach a
// previous test's table and write through its now-stale handles.
let tables: Table[] = [];

/** Tracks `table` for disposal in `afterEach`, and returns it unchanged. */
function track(table: Table): Table {
    tables.push(table);

    return table;
}

beforeEach(() => {
    installTestDOM(CONFIG);
    tables = [];
});
afterEach(() => {
    for (const table of tables) {
        table.dispose();
    }

    // Theme state is module-level; restore it even if an assertion above
    // fails, so a non-default theme never leaks into another test file.
    ThemeManager.setTheme(ModernTheme);
    DOM.reset();
});

/** ModernTheme with a different table-cell padding — drives every cell's renderer insets. */
function paddedTheme(padding: number) {
    return {
        ...ModernTheme,
        table: {
            ...ModernTheme.table,
            cell: { ...ModernTheme.table.cell, padding },
        },
    };
}

// Column 'a' is a fixed-shape type (kept at its width by `rescaleWidths` on a
// resize); 'b' and 'c' are flexible strings that absorb the change — the
// fixture behaviour 12 needs.
const MODEL = new Model([
    { name: 'a', type: 'number', order: 0 },
    { name: 'b', type: 'string', order: 1 },
    { name: 'c', type: 'string', order: 2 },
], 'a');

/** Builds a realized, laid-out Table over `MODEL` with `rowCount` records. */
async function makeTable(rowCount: number = 5): Promise<Table> {
    const store = new MemoryStore(MODEL, Array.from({ length: rowCount }, (_, i) => ({ a: i, b: `b${i}`, c: `c${i}` })));
    await store.load();

    const table = track(new Table(store));
    table.getElement(true);
    table.setWidth(300);
    table.setHeight(200);
    table.doLayout();

    return table;
}

function headerCells(table: Table): Cell<any>[] {
    return table.getHeader().getColumns() as Cell<any>[];
}

function pooledBodyCells(table: Table): Cell<any>[] {
    return ((table.getBody() as any)._rowPool as Row[]).flatMap(row => row.getComponents() as Cell<any>[]);
}

function allCells(table: Table): Cell<any>[] {
    return [...headerCells(table), ...pooledBodyCells(table)];
}

// Mirrors PropertyGridPanel's demo: a `value` column whose cell variant is
// resolved per record from `kind`, giving a real `DynamicCell` to swap.
const DYNAMIC_MODEL = new Model([
    { name: 'property', type: 'string', order: 0 },
    { name: 'value',    type: 'auto',   order: 1 },
    { name: 'kind',     type: 'string', order: 2 },
], 'property');

const DYNAMIC_SPEC: ColumnSpec = {
    columns: [
        { field: 'property' },
        { field: 'value', cellType: (r) => r.get('kind') as CellType },
        { field: 'kind', hidden: true },
    ],
};

/**
 * Builds a realized, laid-out Table with one DynamicCell ('value') per row.
 * The two records swap between 'number' and 'string' — not 'boolean', whose
 * checkbox editor dispatches a synthetic click this Node-based harness has no
 * `MouseEvent` global for; that gap is pre-existing and orthogonal to the
 * renderer-swap behaviour under test here.
 */
async function makeDynamicTable(): Promise<{ table: Table, recs: ModelRecord[] }> {
    const store = new MemoryStore(DYNAMIC_MODEL, [
        { property: 'Count', value: 5,     kind: 'number' },
        { property: 'Name',  value: 'Bob', kind: 'string' },
    ]);
    await store.load();

    const table = track(new Table(store, DYNAMIC_SPEC));
    table.getElement(true);
    table.setWidth(400);
    table.setHeight(200);
    table.doLayout();

    return { table, recs: store.getAll() };
}

/** The `value` column's DynamicCell in the dynamic table's first pooled row. */
function dynamicValueCell(table: Table): DynamicCell {
    return ((table.getBody() as any)._rowPool[0] as Row).getComponents()[1] as unknown as DynamicCell;
}

/**
 * Every cell's own committed rect plus its renderer's, for the negative-half
 * comparison. Scoped to these two levels — not the renderer's own
 * descendants (e.g. an inner `Text`) — because that is what the geometry
 * skip under test operates on; a renderer's deeper content position is
 * governed by its own theme subscription, a separate, pre-existing timing
 * concern the "after a theme reflow" case below documents rather than pins.
 */
function snapshot(cells: Cell<any>[]): unknown[] {
    return cells.map(cell => {
        const renderer = cell.getRenderer();

        return [cell.getX(), cell.getY(), cell.getWidth(), cell.getHeight(),
                renderer.getX(), renderer.getY(), renderer.getWidth(), renderer.getHeight()];
    });
}

/** Forces every cell's doLayout and asserts nothing in `snapshot`'s shape moved. */
function assertForcedRelayoutMovesNothing(cells: Cell<any>[]): void {
    const before = snapshot(cells);

    for (const cell of cells) {
        cell.doLayout();
    }

    expect(snapshot(cells)).toEqual(before);
}

describe('Table — geometry-diff skip', () => {
    it('11. a second doLayout at unchanged container size lays out no header or body cell', async () => {
        const table = await makeTable();

        const spies = allCells(table).map(cell => vi.spyOn(cell, 'doLayout'));

        table.doLayout();

        for (const spy of spies) {
            expect(spy).not.toHaveBeenCalled();
        }
    });

    it('12. a body-width change re-lays-out only the columns whose width changed', async () => {
        const table = await makeTable();

        const [headerA, headerB] = headerCells(table);
        const [bodyA, bodyB]     = pooledBodyCells(table);

        const spyHeaderA = vi.spyOn(headerA, 'doLayout');
        const spyBodyA   = vi.spyOn(bodyA,   'doLayout');
        const spyHeaderB = vi.spyOn(headerB, 'doLayout');
        const spyBodyB   = vi.spyOn(bodyB,   'doLayout');

        // 'a' is fixed-shape (number) and keeps its width; 'b'/'c' are the
        // flexible columns that absorb the widened table.
        table.setWidth(500);
        table.doLayout();

        expect(spyHeaderA).not.toHaveBeenCalled();
        expect(spyBodyA).not.toHaveBeenCalled();
        expect(spyHeaderB).toHaveBeenCalled();
        expect(spyBodyB).toHaveBeenCalled();
    });

    describe('13. forcing doLayout on every settled cell moves nothing', () => {
        it('baseline, freshly settled', async () => {
            const table = await makeTable();

            assertForcedRelayoutMovesNothing(allCells(table));
        });

        it('after a theme reflow, settled by a driven pass', async () => {
            const table = await makeTable();

            ThemeManager.setTheme(paddedTheme(ModernTheme.table.cell.padding + 8));
            // The header only marks its cells dirty from its theme
            // subscription (see `TableHeader`'s constructor comment); a
            // driven pass is what actually re-fits them. This pins that no
            // *cell* is left stale at the (cell, renderer) level `snapshot`
            // covers — it does not pin a body renderer's own inner content
            // (e.g. its `Text`'s insets), which can lag by one pass; see
            // `snapshot`'s doc comment and `Body.onThemeReflow`'s remarks.
            table.doLayout();

            assertForcedRelayoutMovesNothing(allCells(table));
        });

        it('after a DynamicCell renderer swap', async () => {
            const { table, recs } = await makeDynamicTable();

            dynamicValueCell(table).bindRecord(recs[1]);

            assertForcedRelayoutMovesNothing(allCells(table));
        });
    });

    it('14. a theme reflow re-lays-out every rendered header cell and every pooled body cell', async () => {
        const table = await makeTable();

        const spies = allCells(table).map(cell => vi.spyOn(cell, 'doLayout'));

        ThemeManager.setTheme(paddedTheme(ModernTheme.table.cell.padding + 8));
        table.doLayout();

        for (const spy of spies) {
            expect(spy).toHaveBeenCalled();
        }
    });

    it('15. a DynamicCell swapping renderer between two passes at identical geometry is re-laid-out', async () => {
        const { table, recs } = await makeDynamicTable();
        const cell = dynamicValueCell(table);

        const doLayout = vi.spyOn(cell, 'doLayout');

        // Same pool slot, same geometry (no scroll, no resize) — only the
        // bound record's kind changes, from 'number' to 'string'.
        cell.bindRecord(recs[1]);

        expect(doLayout).toHaveBeenCalled();
    });
});
