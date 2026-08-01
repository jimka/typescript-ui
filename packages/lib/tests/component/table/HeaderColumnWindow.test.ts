// Offline coverage for plans/table-header-column-virtualization.md's
// `## Expected Behaviour` — the header renders only its column window (the
// same range the body renders, per Body's `computeColumnWindow`), a header
// cell is recycled (never rebuilt) across a slide, and every per-column
// property (label, tooltip, glyph, group tint, required marker, ARIA column
// index) is re-applied on every reconcile so a recycled cell never shows a
// trace of its previous column. Cases are numbered to match the plan's
// `## Expected Behaviour` list.
//
// Most cases drive `TableHeader.renderColumnWindow` / `setScrollX` directly
// against a real `Table`'s header, bypassing `layout/Table.doLayout`'s own
// width derivation — mirroring how `Body.test.ts`'s `wideBody` helper calls
// `Body.renderWindow` directly with explicit widths rather than deriving them
// through a full layout pass. A few cases (1, 2, 17-20, 25) exercise the full
// `Table` → `layout/Table.doLayout` → header pipeline instead, because the
// contract under test is that integration itself.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import type { TableHeader } from '~/component/table/Header';
import type { HeaderCell } from '~/component/table/cell/Header';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnConfig, ColumnSpec } from '~/component/table/ColumnConfig';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Builds a Model with `n` string columns `c0`..`c{n-1}`, each described `desc-i` so a recycled cell's tooltip is distinguishable. */
function wideModel(n: number): Model {
    const fields = Array.from({ length: n }, (_, i) => ({
        name: `c${i}`, type: 'string' as const, order: i, description: `desc-${i}`,
    }));

    return new Model(fields, 'c0');
}

/**
 * Builds a Model with `n` string columns that declare **no** `order`, so every
 * `Field.getOrder()` returns the -1 sentinel and all order comparisons tie —
 * the common consumer case, and the one that catches a reconciler which
 * re-derives slot order from `getOrder()` instead of from its own assignment.
 */
function tiedOrderModel(n: number): Model {
    const fields = Array.from({ length: n }, (_, i) => ({
        name: `c${i}`, type: 'string' as const, description: `desc-${i}`,
    }));

    return new Model(fields, 'c0');
}

/** Builds a Table over `n` string columns, with its header realized but not laid out. */
async function wideTable(n: number, spec?: ColumnSpec, model: Model = wideModel(n)): Promise<Table> {
    const store = new MemoryStore(model, []);
    await store.load();

    const table = new Table(store, spec);
    table.getElement(true);

    return table;
}

function header(table: Table): TableHeader {
    return table.getHeader();
}

function cells(table: Table): HeaderCell[] {
    return header(table).getColumns() as HeaderCell[];
}

/** Establishes the header's cached geometry: 20 columns, 100px each, 250px viewport. */
function render20At100(table: Table, scrollX: number = 0): void {
    header(table).renderColumnWindow({
        columnWidths:    Array(20).fill(100),
        viewportWidth:   250,
        columnHeight:    20,
        parentRowHeight: 0,
    });

    if (scrollX !== 0) {
        header(table).setScrollX(scrollX);
    }
}

type PrivHeader = {
    handleSortClick(fieldName: string, shiftKey: boolean): void;
};

type PrivCell = {
    emit(event: string, ...args: unknown[]): void;
};

describe('Header column window — window coverage', () => {
    it('1. never-laid-out header renders zero cells; after sizing + doLayout it renders all four, windowStart 0', async () => {
        const table = await wideTable(4);

        expect(cells(table).length).toBe(0);

        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        expect(cells(table).length).toBe(4);
        expect(header(table).getColumnWindowStart()).toBe(0);
    });

    it('2. columns that all fit the viewport render one header cell per visible column', async () => {
        const table = await wideTable(3);

        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        expect(cells(table).length).toBe(3);
    });

    it('3. a 20-column table at 250px viewport scrolled to 550 renders 8 cells starting at column 3', async () => {
        const table = await wideTable(20);

        render20At100(table, 550);

        expect(cells(table).length).toBe(8);
        expect(header(table).getColumnWindowStart()).toBe(3);
    });

    it('4. the rendered cell count never exceeds the visible-column count at any scroll offset', async () => {
        const table = await wideTable(20);

        for (const scrollX of [0, 550, 1_000_000]) {
            render20At100(table, scrollX);

            expect(cells(table).length).toBeLessThanOrEqual(20);
        }
    });
});

describe('Header column window — slot-to-column mapping', () => {
    it('5. every rendered slot\'s cell reports the field of windowStart + slot', async () => {
        const table = await wideTable(20);

        render20At100(table, 550);

        const start = header(table).getColumnWindowStart();

        cells(table).forEach((cell, slot) => {
            expect(cell.getFieldName()).toBe(`c${start + slot}`);
        });
    });

    it('6. every rendered slot\'s ARIA column index equals windowStart + slot + 1', async () => {
        const table = await wideTable(20);

        render20At100(table, 550);

        const start = header(table).getColumnWindowStart();

        cells(table).forEach((cell, slot) => {
            expect(cell.getAria().getColIndex()).toBe(start + slot + 1);
        });
    });

    it('7. columnresize from the cell at slot 2 of a window starting at 3 carries column index 5', async () => {
        const table = await wideTable(20);

        render20At100(table, 550);
        expect(header(table).getColumnWindowStart()).toBe(3);

        const seen: number[] = [];
        header(table).on('columnresize', (colIndex) => seen.push(colIndex));

        const cell = cells(table)[2] as unknown as PrivCell;
        cell.emit('resizedrag', 999);

        expect(seen).toEqual([5]);
    });
});

describe('Header column window — recycling', () => {
    it('8. scrolling one column right keeps the rendered count and advances windowStart by one', async () => {
        const table = await wideTable(20);

        render20At100(table, 550);
        expect(header(table).getColumnWindowStart()).toBe(3);
        const countBefore = cells(table).length;

        header(table).setScrollX(650);

        expect(header(table).getColumnWindowStart()).toBe(4);
        expect(cells(table).length).toBe(countBefore);
    });

    it('9. the cell instance rendering the departing column renders the entering column after the slide', async () => {
        const table = await wideTable(20);

        render20At100(table, 550);
        const departingCell = cells(table)[0]; // column 3

        header(table).setScrollX(650); // window 4..11

        const enteringSlot = 11 - header(table).getColumnWindowStart();
        expect(cells(table)[enteringSlot]).toBe(departingCell);
    });

    it('10. the recycled cell\'s label and tooltip are the entering column\'s, not the departing column\'s', async () => {
        const table = await wideTable(20);

        render20At100(table, 550);
        const recycled = cells(table)[0]; // column 3

        header(table).setScrollX(650); // column 3 leaves, column 11 enters

        expect(recycled.getFieldName()).toBe('c11');
        expect(recycled.getTooltip()).toBe('desc-11');
    });

    it('11. a cell recycled into a column with no groupColor loses the tint; into one with, gains it', async () => {
        const spec: ColumnSpec = {
            columns: [{ field: 'c3', groupColor: '#abc123' }],
        };
        const table = await wideTable(20, spec);

        render20At100(table, 550);
        const cell = cells(table)[0]; // column 3, tinted

        expect(cell.getBackgroundColor()).toBe('#abc123');

        header(table).setScrollX(650); // recycled into column 11, untinted

        expect(cell.getBackgroundColor()).toBe('var(--ts-ui-table-cell-bg, transparent)');

        // The other direction: an untinted cell recycled into a tinted column.
        const gaining = await wideTable(20, { columns: [{ field: 'c11', groupColor: '#abc123' }] });

        render20At100(gaining, 550);
        const gainCell = cells(gaining)[0]; // column 3, untinted

        expect(gainCell.getBackgroundColor()).toBe('var(--ts-ui-table-cell-bg, transparent)');

        header(gaining).setScrollX(650);

        expect(gainCell.getBackgroundColor()).toBe('#abc123');
    });

    it('12. a cell recycled into a column with no headerGlyph reports null; into one with, that glyph', async () => {
        const spec: ColumnSpec = {
            columns: [{ field: 'c11', headerGlyph: 'unicode-arrow-up' }],
        };
        const table = await wideTable(20, spec);

        render20At100(table, 550);
        const cell = cells(table)[0]; // column 3, no glyph

        expect(cell.getHeaderGlyph()).toBeNull();

        header(table).setScrollX(650); // recycled into column 11, glyph

        expect(cell.getHeaderGlyph()).toBe('unicode-arrow-up');

        // The other direction — the one with teardown behind it, since
        // `setHeaderGlyph(null)` disposes the mounted Glyph and restores the
        // renderer's left inset.
        const losing = await wideTable(20, { columns: [{ field: 'c3', headerGlyph: 'unicode-arrow-up' }] });

        render20At100(losing, 550);
        const loseCell = cells(losing)[0]; // column 3, glyph

        expect(loseCell.getHeaderGlyph()).toBe('unicode-arrow-up');

        header(losing).setScrollX(650); // recycled into column 11, no glyph

        expect(loseCell.getHeaderGlyph()).toBeNull();
    });

    it('13. a cell recycled into a required column shows the asterisk; into a non-required one, it does not', async () => {
        const spec: ColumnSpec = {
            columns: [{ field: 'c11', required: true }],
        };
        const table = await wideTable(20, spec);

        render20At100(table, 550);
        const cell = cells(table)[0]; // column 3, not required

        expect(cell.getRenderer().getText().getText().toString()).not.toContain('*');

        header(table).setScrollX(650); // recycled into column 11, required

        expect(cell.getRenderer().getText().getText().toString()).toContain('*');

        // The other direction: the marker must be stripped from a cell that
        // carries it when the entering column is not required.
        const losing = await wideTable(20, { columns: [{ field: 'c3', required: true }] });

        render20At100(losing, 550);
        const loseCell = cells(losing)[0]; // column 3, required

        expect(loseCell.getRenderer().getText().getText().toString()).toContain('*');

        header(losing).setScrollX(650); // recycled into column 11, not required

        expect(loseCell.getRenderer().getText().getText().toString()).not.toContain('*');
    });
});

describe('Header column window — sort state', () => {
    it('14. sorting a column outside the window, then scrolling it in, shows the arrow on its cell', async () => {
        const table = await wideTable(20);
        const priv  = header(table) as unknown as PrivHeader;

        render20At100(table, 0); // window 0..4
        priv.handleSortClick('c10', false); // c10 is not rendered — no visible effect yet

        header(table).setScrollX(550); // window 3..10 — c10 slides in at the last slot

        const last = cells(table)[cells(table).length - 1];
        expect(last.getFieldName()).toBe('c10');
        expect(last.getSortState()?.state).toBe('asc');
    });

    it('15. a two-column multi-sort shows the priority badge on whichever column is in the window', async () => {
        const table = await wideTable(20);
        const priv  = header(table) as unknown as PrivHeader;

        render20At100(table, 550); // window 3..10
        priv.handleSortClick('c3', false);
        priv.handleSortClick('c5', true); // shift-append — multi-sort

        const c3 = cells(table).find(c => c.getFieldName() === 'c3')!;
        const c5 = cells(table).find(c => c.getFieldName() === 'c5')!;

        expect(c3.getSortState()).toEqual({ state: 'asc', priority: 1 });
        expect(c5.getSortState()).toEqual({ state: 'asc', priority: 2 });
    });

    it('16. clicking a rendered cell after a slide sorts the column that cell renders, not the column at its slot', async () => {
        const table = await wideTable(20);

        render20At100(table, 550); // window 3..10
        header(table).setScrollX(650); // window 4..11 — slot 0 now renders column 4

        const slot0 = cells(table)[0] as unknown as PrivCell;
        slot0.emit('sortclick', 'c4', false);

        const store = (table as unknown as { _store: MemoryStore })._store;
        expect(store.getActiveSorters()).toEqual([{ field: 'c4', dir: 'asc' }]);
    });
});

describe('Header column window — column-set changes', () => {
    async function smallTable(): Promise<Table> {
        const table = await wideTable(5);
        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        return table;
    }

    it('17. hiding a middle column leaves surviving cells\' instances unchanged and drops the hidden field', async () => {
        const table = await smallTable();
        const before = new Map(cells(table).map(c => [c.getFieldName(), c]));

        table.setColumnVisible('c2', false);

        const fieldNames = cells(table).map(c => c.getFieldName());
        expect(fieldNames).not.toContain('c2');

        for (const name of ['c0', 'c1', 'c3', 'c4']) {
            expect(cells(table).find(c => c.getFieldName() === name)).toBe(before.get(name));
        }
    });

    it('18. showing a hidden column restores it', async () => {
        const table = await smallTable();

        table.setColumnVisible('c2', false);
        table.setColumnVisible('c2', true);

        expect(cells(table).map(c => c.getFieldName())).toContain('c2');
    });

    it('19. the width array length still equals table.getColumns().length after a hide or show', async () => {
        const table = await smallTable();

        table.setColumnVisible('c2', false);
        expect(table.getColumnWidths().length).toBe(table.getColumns().length);

        table.setColumnVisible('c2', true);
        expect(table.getColumnWidths().length).toBe(table.getColumns().length);
    });

    it('20. setStore on an already-sized table renders the new columns without the caller calling doLayout', async () => {
        const table = await smallTable();

        const newModel = wideModel(3);
        const newStore = new MemoryStore(newModel, []);
        await newStore.load();

        table.setStore(newStore);

        expect(cells(table).map(c => c.getFieldName()).sort()).toEqual(['c0', 'c1', 'c2']);
    });
});

describe('Header column window — parent row', () => {
    it('21. a table with no grouped columns has zero parent cells', async () => {
        const table = await wideTable(4);

        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        expect(header(table).getParentRow().getComponents().length).toBe(0);
    });

    it('22. groups A A A B B produce two parent cells spanning 0-2 and 3-4', async () => {
        const spec: ColumnSpec = {
            columns: [
                { field: 'c0', group: 'A' },
                { field: 'c1', group: 'A' },
                { field: 'c2', group: 'A' },
                { field: 'c3', group: 'B' },
                { field: 'c4', group: 'B' },
            ],
        };
        const table = await wideTable(5, spec);

        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        expect(header(table).getParentRow().getComponents().length).toBe(2);
    });

    it('23. a parent cell\'s x/width sum the widths left of / across its span', async () => {
        const columns: ColumnConfig[] = [
            { field: 'c0' },
            { field: 'c1' },
            { field: 'c2', group: 'G' },
            { field: 'c3', group: 'G' },
            { field: 'c4' },
        ];
        const table = await wideTable(5, { columns });

        header(table).renderColumnWindow({
            columnWidths:    [100, 60, 60, 200, 90],
            viewportWidth:   1000,
            columnHeight:    20,
            parentRowHeight: 20,
        });

        const spanned = header(table).getParentRow().getComponents()
            .find((_, i) => i === 2)!; // spanFrom 2, spanTo 3 — the third built cell

        expect(spanned.getX()).toBe(160);
        expect(spanned.getWidth()).toBe(260);
    });

    it('24. a parent cell whose span starts left of the window still reports its full-span geometry', async () => {
        const columns: ColumnConfig[] = [{ field: 'c0', group: 'ALL' }];
        for (let i = 1; i < 20; i++) {
            columns.push({ field: `c${i}`, group: 'ALL' });
        }
        const table = await wideTable(20, { columns });

        render20At100(table, 550); // window starts at column 3

        const parentCells = header(table).getParentRow().getComponents();
        expect(parentCells.length).toBe(1);
        expect(parentCells[0].getX()).toBe(0);
        expect(parentCells[0].getWidth()).toBe(2000);
    });
});

describe('Header column window — rotated mode', () => {
    it('25. a rotated table renders a header cell for every projected column, windowStart 0', async () => {
        const table = await wideTable(4);

        table.setWidth(600);
        table.setHeight(400);
        table.setDisplayMode('rotated');
        table.doLayout();

        expect(cells(table).length).toBe(3); // field / value / filler
        expect(header(table).getColumnWindowStart()).toBe(0);
    });
});

describe('Header column window — slot order with tied field order', () => {
    // The reconciler assigns cells to slots itself; slot order must come from
    // that assignment, not from re-sorting the child array on `Field.getOrder()`.
    // A model that declares no `order` ties every comparison at the -1 sentinel,
    // so a sort-based reordering is a stable no-op and a recycled cell keeps the
    // array index it happened to hold — desynchronising slot from column.
    it('27. slot s renders column windowStart + s after a slide, even when no field declares an order', async () => {
        const table = await wideTable(20, undefined, tiedOrderModel(20));
        render20At100(table);
        render20At100(table, 550);

        const start = header(table).getColumnWindowStart();
        const names = cells(table).map(c => c.getFieldName());

        expect(names).toEqual(names.map((_, s) => `c${start + s}`));
    });

    it('27b. after a slide each cell sits at the x of the column it actually renders', async () => {
        const table = await wideTable(20, undefined, tiedOrderModel(20));
        render20At100(table);
        render20At100(table, 550);

        // Keyed on the cell's own field, not its slot — asserting per slot
        // would pass even when the wrong cell occupies the slot, since
        // `positionColumnCells` writes geometry by slot position.
        cells(table).forEach(cell => {
            const col = Number(cell.getFieldName().slice(1));

            expect(cell.getX()).toBe(col * 100);
        });
    });
});

describe('Header column window — teardown', () => {
    it('26. a cell the reconciler drops is disposed — no stylesheet rule keyed on its id survives', async () => {
        const table = await wideTable(5);
        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        const dropped = cells(table).find(c => c.getFieldName() === 'c2')!;
        const survivingBefore = _ruleCacheKeys().filter(key => key.includes(dropped.getId()));
        expect(survivingBefore.length).toBeGreaterThan(0);

        table.setColumnVisible('c2', false);

        const survivingAfter = _ruleCacheKeys().filter(key => key.includes(dropped.getId()));
        expect(survivingAfter).toEqual([]);
    });
});
