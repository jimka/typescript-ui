// Offline coverage for plans/implemented/table-generated-column-widths.md's
// `## Expected Behaviour` — the per-type width policy, the batched text
// measurement seam, and the sampled auto-size path for `string`/`auto`
// columns. Cases are numbered to match the plan.
//
// This suite uses its own font-metrics table (rather than the shared
// dom/font-metrics.test-font.json) because that shared table has no digit
// advances — every unlisted character falls back to the space advance, which
// would put the number-column floor (MIN_NUMBER_DIGITS * digitPx +
// CELL_CHROME_PX) below MIN_COLUMN_WIDTH_PX and make case 8 unreproducible.
// Digits get a distinct advance (8px) here; every other character falls back
// to the space advance (10px). `ModelledDOMSource.font()` ignores the
// requested font family/size/weight/style and returns this table's sole
// entry unconditionally, so header (bold) and body (normal) measurements are
// interchangeable under this harness — matching the offline-harness caveat
// in the plan's `## Expected Behaviour` preamble.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import { Util } from '~/core/Util';
import { Table } from '~/component/table/Table';
import { TablePanel } from '~/component/table/TablePanel';
import { LinkCellRenderer } from '~/component/table/cell/renderer/Link';
import { TableExporter } from '~/component/table/TableExporter';
import { CellTextResolver } from '~/component/table/cell/CellText';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';
import { expectNoSelfReschedule } from '../../helpers/layoutStability';

const fontMetrics = {
    fonts: {
        'ColumnWidthsTestFont': {
            ascent:  13,
            descent: 3,
            capTop:  10,
            advance: {
                ' ': 10,
                '0': 8, '1': 8, '2': 8, '3': 8, '4': 8,
                '5': 8, '6': 8, '7': 8, '8': 8, '9': 8,
            },
        },
    },
};

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// Fixed design constants from the plan's `## Internal Structure` constants
// table — stable regardless of theme/font, so tests may embed them literally.
const MIN_COLUMN_WIDTH_PX = 30;
const CHECKBOX_WIDTH_PX   = 16;
const CELL_CHROME_PX      = 6;
const MIN_NUMBER_DIGITS   = 4;
const MIN_STRING_CHARS    = 8;
const AUTO_WIDTH_CAP_PX   = 400;

async function makeStore(model: Model, records: Record<string, unknown>[] = []): Promise<MemoryStore> {
    const store = new MemoryStore(model, records);
    await store.load();

    return store;
}

function makeTable(store: MemoryStore, spec?: ColumnSpec): Table {
    const table = new Table(store, spec);
    table.getElement(true);

    return table;
}

describe('Batched text measurement', () => {
    it('1. batch matches singles', () => {
        const texts = ['a', 'bbb', ''];

        expect(Util.measureTextWidths(texts)).toEqual(texts.map(t => Util.measureTextWidth(t)));
    });

    it('2. empty input returns an empty array', () => {
        expect(Util.measureTextWidths([])).toEqual([]);
    });
});

describe('Type policy without data', () => {
    it('3. boolean floor', async () => {
        const model = new Model([{ name: 'flag', type: 'boolean', order: 0 }]);
        const store = await makeStore(model);
        const table = makeTable(store);
        const col   = table.getColumns()[0];

        expect(table.getColumnMinWidth(col)).toBe(CHECKBOX_WIDTH_PX + CELL_CHROME_PX);

        // Holds with autoSizeColumns unset too (an explicit spec with the flag absent).
        const table2 = makeTable(await makeStore(model), { columns: [] });
        const col2   = table2.getColumns()[0];

        expect(table2.getColumnMinWidth(col2)).toBe(CHECKBOX_WIDTH_PX + CELL_CHROME_PX);
    });

    it('4. boolean width is header-driven', async () => {
        const model = new Model([
            { name: 'a',                          type: 'boolean', order: 0 },
            { name: 'reallylongheadertextfield',  type: 'boolean', order: 1 },
        ]);
        const store  = await makeStore(model);
        const table  = makeTable(store);
        const widths = table.getIntrinsicColumnWidths();

        expect(widths[1]).toBeGreaterThan(widths[0]!);
    });

    it('5. boolean ignores its data', async () => {
        const model = new Model([{ name: 'flag', type: 'boolean', order: 0 }]);

        const emptyStore = await makeStore(model, []);
        const emptyWidth = makeTable(emptyStore).getIntrinsicColumnWidths()[0];

        const fullStore = await makeStore(model, [{ flag: true }, { flag: false }, { flag: true }]);
        const fullWidth = makeTable(fullStore).getIntrinsicColumnWidths()[0];

        expect(fullWidth).toBe(emptyWidth);
    });

    it('6. date width needs no data', async () => {
        const model = new Model([{ name: 'd', type: 'date', order: 0 }]);
        const store = await makeStore(model, []);
        const table = makeTable(store);
        const width = table.getIntrinsicColumnWidths()[0];

        expect(width).toBeGreaterThan(MIN_COLUMN_WIDTH_PX);
    });

    it('7. seconds widen a time column', async () => {
        const model = new Model([
            { name: 'a', type: 'time', order: 0 },
            { name: 'b', type: 'time', order: 1 },
        ]);
        const spec: ColumnSpec = { columns: [{ field: 'b', showSeconds: true }] };
        const store  = await makeStore(model, []);
        const table  = makeTable(store, spec);
        const widths = table.getIntrinsicColumnWidths();

        expect(widths[1]).toBeGreaterThan(widths[0]!);
    });

    it('8. number floor', async () => {
        const model = new Model([{ name: 'n', type: 'number', order: 0 }]);
        const store = await makeStore(model, []);
        const table = makeTable(store);
        const col   = table.getColumns()[0];
        const min   = table.getColumnMinWidth(col);

        expect(min).toBeGreaterThan(MIN_COLUMN_WIDTH_PX);

        const digitPx = Util.measureTextWidths(['0'])[0];

        expect(min).toBeGreaterThanOrEqual(digitPx * MIN_NUMBER_DIGITS);
    });

    it('9. number width follows digit count', async () => {
        const model = new Model([
            { name: 'na', type: 'number', order: 0 },
            { name: 'nb', type: 'number', order: 1 },
        ]);
        const records = Array.from({ length: 5 }, (_, i) => ({ na: 100 + i, nb: 100000000 + i }));
        const store   = await makeStore(model, records);
        const table   = makeTable(store);
        const widths  = table.getIntrinsicColumnWidths();

        expect(widths[1]).toBeGreaterThan(widths[0]!);
    });

    it('10. maxContentLength outranks the sample for numbers', async () => {
        const model   = new Model([{ name: 'n', type: 'number', order: 0 }]);
        const records = [{ n: 1 }, { n: 2 }, { n: 3 }];

        const hintedStore = await makeStore(model, records);
        const hintedTable = makeTable(hintedStore, { columns: [{ field: 'n', maxContentLength: 12 }] });
        const hintedWidth = hintedTable.getIntrinsicColumnWidths()[0]!;

        const plainStore = await makeStore(model, records);
        const plainTable = makeTable(plainStore);
        const plainWidth = plainTable.getIntrinsicColumnWidths()[0]!;

        expect(hintedWidth).toBeGreaterThan(plainWidth);
    });

    it('11. string floor', async () => {
        const model = new Model([{ name: 's', type: 'string', order: 0 }]);
        const store = await makeStore(model, []);
        const table = makeTable(store);
        const col   = table.getColumns()[0];
        const min   = table.getColumnMinWidth(col);

        const digitPx = Util.measureTextWidths(['0'])[0];

        expect(min).toBeGreaterThanOrEqual(digitPx * MIN_STRING_CHARS);
    });

    it('12. declared minWidth replaces the policy floor', async () => {
        const model = new Model([{ name: 'flag', type: 'boolean', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'flag', minWidth: 5 }] };
        const store = await makeStore(model, []);
        const table = makeTable(store, spec);
        const col   = table.getColumns()[0];

        expect(table.getColumnMinWidth(col)).toBe(5);
    });
});

describe('Auto-size and content', () => {
    it('13. auto-size off leaves strings flex', async () => {
        const model = new Model([
            { name: 'id',   type: 'number', order: 0 },
            { name: 'name', type: 'string', order: 1 },
        ]);
        const store  = await makeStore(model, []);
        const table  = makeTable(store);
        const widths = table.getIntrinsicColumnWidths();

        expect(typeof widths[0]).toBe('number');
        expect(widths[1]).toBeNull();
    });

    it('13b. auto-size off leaves strings flex even with a values/maxContentLength hint', async () => {
        // autoSizeColumns gates the whole string/auto fallback chain, not just
        // the store sample — a `values` or `maxContentLength` hint must not
        // pull a column out of flex when the flag is off (regression case:
        // resolveContentCandidates originally checked only the sample).
        const model = new Model([
            { name: 'status', type: 'string', order: 0 },
            { name: 'code',   type: 'string', order: 1 },
        ]);
        const spec: ColumnSpec = {
            columns: [
                { field: 'status', values: ['open', 'shipped', 'cancelled'] },
                { field: 'code',   maxContentLength: 10 },
            ],
        };
        const store  = await makeStore(model, []);
        const table  = makeTable(store, spec);
        const widths = table.getIntrinsicColumnWidths();

        expect(widths[0]).toBeNull();
        expect(widths[1]).toBeNull();
    });

    it('14. explicit width wins, and is clamped', async () => {
        const model = new Model([
            { name: 'region', type: 'string',  order: 0 },
            { name: 'flag',   type: 'boolean', order: 1 },
        ]);
        const spec: ColumnSpec = {
            columns: [
                { field: 'region', width: 300, maxWidth: 200 },
                { field: 'flag',   width: 20 },
            ],
        };
        const store  = await makeStore(model, []);
        const table  = makeTable(store, spec);
        const widths = table.getIntrinsicColumnWidths();

        expect(widths[0]).toBe(200);
        expect(widths[1]).toBe(CHECKBOX_WIDTH_PX + CELL_CHROME_PX);
    });

    it('15. content drives width', async () => {
        const model = new Model([
            { name: 'aa', type: 'string', order: 0 },
            { name: 'bb', type: 'string', order: 1 },
        ]);
        const records = [{ aa: 'shortval', bb: 'averyveryverylongvaluestringxx' }];
        const store   = await makeStore(model, records);
        const table   = makeTable(store, { columns: [], autoSizeColumns: true });
        const widths  = table.getIntrinsicColumnWidths();

        expect(widths[1]).toBeGreaterThan(widths[0]!);
    });

    it('15b. content-driven width includes CELL_CHROME_PX beyond the raw measured text', async () => {
        const model     = new Model([{ name: 'note', type: 'string', order: 0 }]);
        const candidate = 'a'.repeat(20);
        const records   = [{ note: candidate }];
        const store     = await makeStore(model, records);
        const table     = makeTable(store, { columns: [], autoSizeColumns: true });
        const width     = table.getIntrinsicColumnWidths()[0]!;
        const contentPx = Util.measureTextWidths([candidate])[0];

        expect(width).toBe(contentPx + CELL_CHROME_PX);
    });

    it('16. cap', async () => {
        const model   = new Model([{ name: 'notes', type: 'string', order: 0 }]);
        const records = [{ notes: 'x'.repeat(2000) }];
        const store   = await makeStore(model, records);
        const table   = makeTable(store, { columns: [], autoSizeColumns: true });
        const width   = table.getIntrinsicColumnWidths()[0];

        expect(width).toBe(AUTO_WIDTH_CAP_PX);
    });

    it('17. combo labels', async () => {
        const model   = new Model([{ name: 'status', type: 'string', order: 0 }]);
        const records = [{ status: 'open' }, { status: 'open' }, { status: 'open' }];

        const comboStore = await makeStore(model, records);
        const comboTable = makeTable(comboStore, {
            columns:         [{ field: 'status', values: ['open', 'shipped', 'cancelled'] }],
            autoSizeColumns: true,
        });
        const comboWidth = comboTable.getIntrinsicColumnWidths()[0]!;

        const plainStore = await makeStore(model, records);
        const plainTable = makeTable(plainStore, { columns: [{ field: 'status' }], autoSizeColumns: true });
        const plainWidth = plainTable.getIntrinsicColumnWidths()[0]!;

        // Sized from "cancelled" (the widest label), not "open" (the only stored value).
        expect(comboWidth).toBeGreaterThan(plainWidth);
    });

    it('18. a custom renderer is not sampled', async () => {
        const model = new Model([{ name: 'link', type: 'string', order: 0 }]);
        const spec: ColumnSpec = {
            columns:         [{ field: 'link', renderer: () => new LinkCellRenderer() }],
            autoSizeColumns: true,
        };

        const shortStore = await makeStore(model, [{ link: 'short' }]);
        const shortWidth = makeTable(shortStore, spec).getIntrinsicColumnWidths()[0];

        const longStore = await makeStore(model, [{ link: 'x'.repeat(500) }]);
        const longWidth = makeTable(longStore, spec).getIntrinsicColumnWidths()[0];

        expect(longWidth).toBe(shortWidth);
    });

    it('19. hint with no data', async () => {
        const model = new Model([{ name: 'code', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'code', maxContentLength: 10 }], autoSizeColumns: true };
        const store = await makeStore(model, []);
        const table = makeTable(store, spec);
        const width = table.getIntrinsicColumnWidths()[0]!;
        const floor = table.getColumnMinWidth(table.getColumns()[0]);

        expect(width).toBeGreaterThan(floor);
    });

    it('20. empty store, no hint, auto-size on', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, []);
        const table = makeTable(store, spec);

        expect(table.getIntrinsicColumnWidths()[0]).toBeNull();
    });

    it('21. re-derivation on first load', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, []);
        const table = makeTable(store, spec);

        expect(table.getIntrinsicColumnWidths()[0]).toBeNull();

        store.loadData([{ name: 'x'.repeat(30) }]);

        const after = table.getIntrinsicColumnWidths()[0];
        const floor = table.getColumnMinWidth(table.getColumns()[0]);

        expect(typeof after).toBe('number');
        expect(after).toBeGreaterThan(floor);
    });

    it('22. re-derivation happens on every load, not once', async () => {
        // The one-shot guard (`_autoWidthsSampled`) is gone: a second load
        // re-derives the widths instead of freezing them at the first
        // non-empty sample. The pass is now queued onto the animation-frame
        // layout queue (`scheduleLayout`), so each load needs its own
        // `flushLayout()` before the committed widths can be observed.
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, []);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        store.loadData([{ name: 'x'.repeat(30) }]);
        table.flushLayout();
        const afterFirstLoad = table.getColumnWidths().slice();

        store.loadData([{ name: 'y'.repeat(2000) }]);
        table.flushLayout();
        const afterSecondLoad = table.getColumnWidths().slice();

        expect(afterSecondLoad).not.toEqual(afterFirstLoad);
    });
});

describe('Laid-out widths', () => {
    it('23. the re-derive reaches the layout', async () => {
        const model = new Model([
            { name: 'name',  type: 'string', order: 0 },
            { name: 'other', type: 'string', order: 1 },
            { name: 'third', type: 'string', order: 2 },
        ]);
        const spec: ColumnSpec = { columns: [], autoSizeColumns: true };
        const store = await makeStore(model, []);
        const table = makeTable(store, spec);

        table.setWidth(200);
        table.setHeight(300);
        table.doLayout();

        const before = table.getColumnWidths().slice();

        store.loadData([{ name: 'x'.repeat(40), other: 'y'.repeat(40), third: 'z'.repeat(40) }]);
        table.flushLayout();

        expect(table.getColumnWidths()).not.toEqual(before);
    });

    it('24. the floor survives the squeeze', async () => {
        const model = new Model([
            { name: 'flag', type: 'boolean', order: 0 },
            { name: 'a',    type: 'string',  order: 1 },
            { name: 'b',    type: 'string',  order: 2 },
        ]);
        const store = await makeStore(model, []);
        const table = makeTable(store);

        table.setWidth(80);
        table.setHeight(300);
        table.doLayout();

        const widths = table.getColumnWidths();
        const col    = table.getColumns()[0];

        expect(widths[0]).toBeGreaterThanOrEqual(table.getColumnMinWidth(col));
    });

    it('25. rotated mode ignores the flag', async () => {
        const model = new Model([
            { name: 'id',      type: 'number',  order: 0 },
            { name: 'name',    type: 'string',  order: 1 },
            { name: 'active',  type: 'boolean', order: 2 },
            { name: 'created', type: 'date',    order: 3 },
        ]);
        const records = [
            { id: 1, name: 'Alice', active: false, created: new Date(2024, 0, 1) },
            { id: 2, name: 'Bob',   active: false, created: new Date(2024, 0, 2) },
        ];
        const store = await makeStore(model, records);
        const table = makeTable(store, { columns: [], autoSizeColumns: true });

        table.setWidth(600);
        table.setHeight(400);
        table.setDisplayMode('rotated');
        table.doLayout();

        const widths = table.getColumnWidths();

        expect(widths.length).toBe(3);
        expect(widths[0]).toBeGreaterThanOrEqual(80);
        expect(widths[1]).toBeGreaterThanOrEqual(120);
        expect(widths[0]).toBeLessThanOrEqual(200);
        expect(widths[1]).toBeLessThanOrEqual(360);
    });

    it('25b. a rotated-first layout does not poison the date/time reference cache for normal mode', async () => {
        // `_widthRefs` is built by walking the CURRENT `getColumns()`, which
        // is the rotated field/value/filler projection while rotated (no
        // temporal columns). If the table's very first layout happens in
        // rotated mode and the cache survives the switch back, a later
        // `date`/`time`/`datetime` column's floor loses its reference-date
        // width entirely — reproducing the clipping bug this plan exists to
        // fix. Regression case: `_widthRefs` must be cleared on every
        // display-mode switch, not just `setStore`/resample.
        const model = new Model([
            { name: 'id',      type: 'number', order: 0 },
            { name: 'created', type: 'date',   order: 1 },
        ]);
        const store = await makeStore(model, [{ id: 1, created: new Date(2024, 0, 1) }]);
        const table = makeTable(store);

        table.setWidth(400);
        table.setHeight(300);
        table.setDisplayMode('rotated');
        table.doLayout();

        table.setDisplayMode('normal');
        table.doLayout();

        const dateCol = table.getColumns().find(c => c.getField().getName() === 'created')!;

        expect(table.getColumnMinWidth(dateCol)).toBeGreaterThan(MIN_COLUMN_WIDTH_PX);
    });

    it('26. reset re-derives', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const records = [{ name: 'a-fairly-long-value-string' }];
        const store   = await makeStore(model, records);
        const table   = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(300);
        table.doLayout();

        const measured = table.getColumnWidths()[0];

        // Overwrite the committed width and its saved-width mirror directly —
        // private state, driven the same way RotatedView.test.ts's suite does.
        (table as any)._columnWidths      = [9999];
        (table as any)._savedColumnWidths = new Map([['name', 9999]]);

        (table as any).resetColumns();

        expect(table.getColumnWidths()[0]).toBe(measured);
    });

    it('27. show/hide reuses saved widths', async () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
            { name: 'c', type: 'string', order: 2 },
        ]);
        const spec: ColumnSpec = {
            columns:         [{ field: 'b', hidden: true }],
            autoSizeColumns: true,
        };
        const records = [{ a: 'a'.repeat(10), b: 'b'.repeat(20), c: 'c'.repeat(2) }];
        const store   = await makeStore(model, records);
        const table   = makeTable(store, spec);

        table.setWidth(500);
        table.setHeight(300);
        table.doLayout();

        const aIndexBefore = table.getColumns().findIndex(c => c.getField().getName() === 'a');
        const aWidthBefore = table.getColumnWidths()[aIndexBefore];

        table.setColumnVisible('a', false);
        table.setColumnVisible('a', true);

        const aIndexAfter = table.getColumns().findIndex(c => c.getField().getName() === 'a');

        expect(table.getColumnWidths()[aIndexAfter]).toBe(aWidthBefore);

        table.setColumnVisible('b', true);

        const bIndex = table.getColumns().findIndex(c => c.getField().getName() === 'b');
        const bWidth = table.getColumnWidths()[bIndex];

        expect(typeof bWidth).toBe('number');
        expect(bWidth).toBeGreaterThan(0);
    });

    it('27b. showing a spec-hidden temporal column does not inherit a stale date-reference cache', async () => {
        // Same failure mode as 25b, reached through a different trigger:
        // `_widthRefs.datePx` is built from the columns visible at the time
        // it's first primed. A `date` column hidden at that moment must
        // still get a correct floor once revealed via setColumnVisible.
        const model = new Model([
            { name: 'id',      type: 'number', order: 0 },
            { name: 'created', type: 'date',   order: 1 },
        ]);
        const spec: ColumnSpec = { columns: [{ field: 'created', hidden: true }] };
        const store = await makeStore(model, [{ id: 1, created: new Date(2024, 0, 1) }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(300);
        table.doLayout();   // primes _widthRefs while `created` is hidden

        table.setColumnVisible('created', true);

        const dateCol = table.getColumns().find(c => c.getField().getName() === 'created')!;

        expect(table.getColumnMinWidth(dateCol)).toBeGreaterThan(MIN_COLUMN_WIDTH_PX);
    });

    it('27c. resetColumns does not inherit a stale date-reference cache either', async () => {
        // Isolates resetColumns' own `_widthRefs` clear: `created` starts
        // visible (no spec), is hidden at runtime (which also primes
        // `_widthRefs` without a date entry, since hiding clears the cache
        // too), then resetColumns — not a further setColumnVisible call —
        // is what reveals it again.
        const model = new Model([
            { name: 'id',      type: 'number', order: 0 },
            { name: 'created', type: 'date',   order: 1 },
        ]);
        const store = await makeStore(model, [{ id: 1, created: new Date(2024, 0, 1) }]);
        const table = makeTable(store);

        table.setWidth(300);
        table.setHeight(300);

        table.setColumnVisible('created', false);
        table.doLayout();   // `_widthRefs` is primed here with `created` hidden

        (table as any).resetColumns();   // restores default visibility: `created` reappears

        const dateCol = table.getColumns().find(c => c.getField().getName() === 'created')!;

        expect(table.getColumnMinWidth(dateCol)).toBeGreaterThan(MIN_COLUMN_WIDTH_PX);
    });
});

// Offline coverage for plans/implemented/table-auto-size-column-resample.md's
// `## Expected Behaviour` cases 1-8. `maybeResampleColumnWidths` now queues its
// pass via `scheduleLayout()` instead of running `doLayout()` synchronously, so
// every case that mutates the store and then reads `getColumnWidths()` needs a
// `table.flushLayout()` in between — the offline `requestAnimationFrame` only
// records its callback and never fires it.
describe('Auto-size re-sampling on data change', () => {
    it('RS1. a later load re-derives', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, [{ name: 'x'.repeat(30) }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        const before = table.getColumnWidths()[0];

        store.loadData([{ name: 'y'.repeat(200) }]);
        table.flushLayout();

        expect(table.getColumnWidths()[0]).toBeGreaterThan(before);
    });

    it('RS2. an add widens', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, [{ name: 'short' }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        const before = table.getColumnWidths()[0];

        store.add([{ name: 'z'.repeat(200) }]);
        table.flushLayout();

        expect(table.getColumnWidths()[0]).toBeGreaterThan(before);
    });

    it('RS3. a remove narrows', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, [
            { name: 'z'.repeat(200) },
            { name: 'short1' },
            { name: 'short2' },
        ]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        const before = table.getColumnWidths()[0];
        const long   = store.getRecords().find(r => String(r.get('name')).length > 100)!;

        store.remove(long);
        table.flushLayout();

        expect(table.getColumnWidths()[0]).toBeLessThan(before);
    });

    it('RS4. an edit re-derives, with no update wiring of its own', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, [{ name: 'short' }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        const before  = table.getColumnWidths()[0];
        const record  = store.getRecords()[0];

        record.set('name', 'z'.repeat(200));
        store.notifyRecordChanged(record);
        table.flushLayout();

        expect(table.getColumnWidths()[0]).toBeGreaterThan(before);
    });

    // RS5 ("a burst of mutations coalesces into one layout pass") lives in its
    // own file, ColumnAutoSizeCoalescing.test.ts — see that file's header
    // comment for why it cannot share this one.

    // Same four-column, [200, 150, 100, 50] fixture and drag as
    // ColumnResize.test.ts's case 1 ("the chain spills past the first
    // neighbour"): dragging A's right edge 80px right grows A and shrinks C,
    // B already sitting at its 100px floor.
    type PrivDrag = {
        onColumnResizeStart(colIndex: number, clientX: number): void;
        onColumnResize(colIndex: number, clientX: number): void;
    };

    function makeDragFixture(): { table: Table; store: MemoryStore } {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
            { name: 'c', type: 'string', order: 2 },
            { name: 'd', type: 'string', order: 3 },
        ]);
        const spec: ColumnSpec = {
            columns: [
                { field: 'a', minWidth: 60 },
                { field: 'b', minWidth: 100 },
                { field: 'c', minWidth: 40 },
                { field: 'd', minWidth: 30 },
            ],
            autoSizeColumns: true,
        };
        const store = new MemoryStore(model, [{ a: 'x', b: 'x', c: 'x', d: 'x' }]);
        const table = makeTable(store, spec);

        table.setWidth(514);
        table.setHeight(400);
        table.doLayout();
        table.setColumnWidths([200, 150, 100, 50]);

        return { table, store };
    }

    it('RS6. a dragged column survives the next re-sample', async () => {
        const { table, store } = makeDragFixture();
        const priv = table as unknown as PrivDrag;

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1080);

        expect(table.getColumnWidths()).toEqual([280, 100, 70, 50]);

        store.add([{
            a: 'z'.repeat(300), b: 'z'.repeat(300), c: 'z'.repeat(300), d: 'z'.repeat(300),
        }]);
        table.flushLayout();

        const after = table.getColumnWidths();

        expect(after[0]).toBe(280);   // dragged — pinned, not re-clamped
        expect(after[1]).toBe(100);   // dragged — pinned
        expect(after[2]).toBe(70);    // dragged — pinned
        expect(after[3]).toBeGreaterThan(50);   // never dragged — re-derived
    });

    it('RS7. resetColumns releases the pin', async () => {
        const { table } = makeDragFixture();
        const priv = table as unknown as PrivDrag;

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1080);

        expect(table.getColumnWidths()[0]).toBe(280);

        (table as any).resetColumns();

        // The pin is gone, so column A falls back to its freshly derived
        // width from the ('x'-only) sample, not the dragged 280.
        expect(table.getColumnWidths()[0]).not.toBe(280);
    });

    it('RS8a. autoSizeColumns unset leaves widths unchanged on a later load', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }] };
        const store = await makeStore(model, [{ name: 'short' }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        const before = table.getColumnWidths().slice();

        store.loadData([{ name: 'z'.repeat(200) }]);
        table.flushLayout();

        expect(table.getColumnWidths()).toEqual(before);
    });

    it('RS8b. a renderer column is never resampled on a later load', async () => {
        const model = new Model([{ name: 'link', type: 'string', order: 0 }]);
        const spec: ColumnSpec = {
            columns:         [{ field: 'link', renderer: () => new LinkCellRenderer() }],
            autoSizeColumns: true,
        };
        const store = await makeStore(model, [{ link: 'short' }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        const before = table.getColumnWidths().slice();

        store.loadData([{ link: 'x'.repeat(500) }]);
        table.flushLayout();

        expect(table.getColumnWidths()).toEqual(before);
    });

    it('RS8c. a values column is never resampled on a later load', async () => {
        const model = new Model([{ name: 'status', type: 'string', order: 0 }]);
        const spec: ColumnSpec = {
            columns:         [{ field: 'status', values: ['open', 'shipped', 'cancelled'] }],
            autoSizeColumns: true,
        };
        const store = await makeStore(model, [{ status: 'open' }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        const before = table.getColumnWidths().slice();

        store.loadData([{ status: 'x'.repeat(500) }]);
        table.flushLayout();

        expect(table.getColumnWidths()).toEqual(before);
    });

    it('RS8d. a declared width column still reports that width after a re-sample', async () => {
        // A second column keeps this table from being a single-column table,
        // where the sole column would stretch to fill the container and
        // confound "does the declared width survive" with unrelated flex
        // redistribution (see case 14, which sidesteps the same confound by
        // reading getIntrinsicColumnWidths() instead of the laid-out widths).
        const model = new Model([
            { name: 'name',  type: 'string', order: 0 },
            { name: 'other', type: 'string', order: 1 },
        ]);
        const spec: ColumnSpec = {
            columns:         [{ field: 'name', width: 120 }, { field: 'other' }],
            autoSizeColumns: true,
        };
        const store = await makeStore(model, [{ name: 'short', other: 'short' }]);
        const table = makeTable(store, spec);

        table.setWidth(400);
        table.setHeight(200);
        table.doLayout();

        store.loadData([{ name: 'z'.repeat(500), other: 'y'.repeat(500) }]);
        table.flushLayout();

        expect(table.getColumnWidths()[0]).toBe(120);
    });

    it('RS8e. a store change in rotated mode leaves the projection columns within bounds', async () => {
        const model = new Model([
            { name: 'id',      type: 'number',  order: 0 },
            { name: 'name',    type: 'string',  order: 1 },
            { name: 'active',  type: 'boolean', order: 2 },
            { name: 'created', type: 'date',    order: 3 },
        ]);
        const records = [
            { id: 1, name: 'Alice', active: false, created: new Date(2024, 0, 1) },
            { id: 2, name: 'Bob',   active: false, created: new Date(2024, 0, 2) },
        ];
        const store = await makeStore(model, records);
        const table = makeTable(store, { columns: [], autoSizeColumns: true });

        table.setWidth(600);
        table.setHeight(400);
        table.setDisplayMode('rotated');
        table.doLayout();

        store.add([{ id: 3, name: 'Carol'.repeat(50), active: true, created: new Date(2024, 0, 3) }]);
        table.flushLayout();

        const widths = table.getColumnWidths();

        expect(widths.length).toBe(3);
        expect(widths[0]).toBeGreaterThanOrEqual(80);
        expect(widths[1]).toBeGreaterThanOrEqual(120);
        expect(widths[0]).toBeLessThanOrEqual(200);
        expect(widths[1]).toBeLessThanOrEqual(360);
    });

    it('RS8f. removing every record leaves the widths unchanged', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, [{ name: 'a-fairly-long-value-string' }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        const before = table.getColumnWidths().slice();
        const record = store.getRecords()[0];

        store.remove(record);
        table.flushLayout();

        expect(table.getColumnWidths()).toEqual(before);
    });

    it('RS8g. a settled auto-size table does not re-arm itself from inside a layout pass', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = await makeStore(model, [{ name: 'a fairly long value' }]);
        const table = makeTable(store, spec);

        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        expectNoSelfReschedule(table);
    });
});

describe('TablePanel spec forwarding', () => {
    it('forwards an autoSizeColumns spec to the underlying Table', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const store = await makeStore(model, [{ name: 'x'.repeat(30) }]);
        const panel = new TablePanel(store, { columns: [], autoSizeColumns: true });

        expect(panel.getTable().isAutoSizeColumns()).toBe(true);
    });
});

// Regression: a generated table's store usually loads after the table is
// built, so `maybeResampleColumnWidths` fires a layout pass from the store
// event — potentially before the table has ever been given a size. A
// never-sized component reports `getInnerSize()` as NaN x NaN (a non-null
// object, so the layout manager's `!containerSize` guard passes it through),
// which made `availableWidth` NaN. `absorbSlackIntoGreedy`'s
// `slack <= 0.5` early-return does not catch NaN, so the NaN was added to
// exactly the greedy (string/auto) columns and then stored — after which
// every later pass took the `rescaleWidths` branch and preserved it. The
// symptom in the app was the 45-column MiscPanel demo rendering as an
// unreadable smear: `x += columnWidths[i]` went NaN at the first string
// column, so every subsequent `setX` wrote "NaNpx" and Chrome dropped it,
// stacking all 45 header cells at x=0.
describe('Regression: layout before the table has a size', () => {
    it('R1. a layout pass with no resolved size leaves the widths untouched', async () => {
        const model = new Model([
            { name: 'name', type: 'string',  order: 0 },
            { name: 'qty',  type: 'number',  order: 1 },
        ]);
        const store = await makeStore(model);
        const table = makeTable(store, { columns: [], autoSizeColumns: true });

        // Never sized: no setWidth/setHeight, so getInnerSize() is NaN x NaN.
        table.doLayout();

        expect(table.getColumnWidths()).toEqual([]);
    });

    it('R2. data arriving before the first sizing still yields finite widths', async () => {
        const model = new Model([
            { name: 'name', type: 'string',  order: 0 },
            { name: 'qty',  type: 'number',  order: 1 },
            { name: 'when', type: 'date',    order: 2 },
            { name: 'ok',   type: 'boolean', order: 3 },
        ]);
        const store = await makeStore(model);
        const table = makeTable(store, { columns: [], autoSizeColumns: true });

        // The store loads while the table is still unsized — this is what
        // drives `maybeResampleColumnWidths` into a NaN-size layout pass.
        store.add([{ name: 'a very long product name', qty: 12345, when: new Date(2024, 0, 1), ok: true }]);

        table.setWidth(400);
        table.setHeight(300);
        table.doLayout();

        const widths = table.getColumnWidths();

        expect(widths).toHaveLength(4);
        expect(widths.every(w => Number.isFinite(w))).toBe(true);
    });

    it('R3. the string column is not left at NaN after an unsized layout pass', async () => {
        const model = new Model([
            { name: 'name', type: 'string', order: 0 },
            { name: 'qty',  type: 'number', order: 1 },
        ]);
        const store = await makeStore(model);
        const table = makeTable(store, { columns: [], autoSizeColumns: true });

        store.add([{ name: 'x'.repeat(40), qty: 1 }]);

        table.setWidth(600);
        table.setHeight(300);
        table.doLayout();

        expect(table.getColumnWidths()[0]).toBeGreaterThan(MIN_COLUMN_WIDTH_PX);
    });
});

// Regression: on a table wide enough that the fixed-shape columns alone
// exceed the viewport (the 45-column generated-table case), `rescaleWidths`
// computed `newFlexTotal = availableWidth - fixedTotal` as a negative number,
// so `ratio` went negative and every flex column clamped to its floor on the
// FIRST re-layout — no resize needed, the same availableWidth both passes.
// The table therefore rendered correctly for one pass and then collapsed its
// string columns. There is no space to share in that situation, so the flex
// columns keep their derived widths and the table scrolls horizontally.
describe('Regression: no room left for the flex columns', () => {
    function overflowingModel(): Model {
        return new Model([
            { name: 'description_field_one', type: 'string',  order: 0 },
            { name: 'quantity_number_col_a', type: 'number',  order: 1 },
            { name: 'quantity_number_col_b', type: 'number',  order: 2 },
            { name: 'posted_date_column_aa', type: 'date',    order: 3 },
            { name: 'posted_date_column_bb', type: 'date',    order: 4 },
            { name: 'settled_boolean_col_a', type: 'boolean', order: 5 },
        ]);
    }

    it('R4. a second layout pass does not collapse the flex columns', async () => {
        const store = await makeStore(overflowingModel(), [
            {
                description_field_one: 'a considerably longer description value',
                quantity_number_col_a: 1, quantity_number_col_b: 2,
                posted_date_column_aa: new Date(2024, 0, 1),
                posted_date_column_bb: new Date(2024, 0, 2),
                settled_boolean_col_a: true,
            },
        ]);
        const table = makeTable(store, { columns: [], autoSizeColumns: true });

        // Narrow enough that the fixed-shape columns alone overflow it.
        table.setWidth(200);
        table.setHeight(300);

        table.doLayout();
        const afterFirst = [...table.getColumnWidths()];

        table.doLayout();
        const afterSecond = [...table.getColumnWidths()];

        expect(afterSecond).toEqual(afterFirst);
    });

    it('R5. the flex column keeps its derived width rather than dropping to its floor', async () => {
        const store = await makeStore(overflowingModel(), [
            {
                description_field_one: 'a considerably longer description value',
                quantity_number_col_a: 1, quantity_number_col_b: 2,
                posted_date_column_aa: new Date(2024, 0, 1),
                posted_date_column_bb: new Date(2024, 0, 2),
                settled_boolean_col_a: true,
            },
        ]);
        const table = makeTable(store, { columns: [], autoSizeColumns: true });
        const col   = table.getColumns()[0];

        table.setWidth(200);
        table.setHeight(300);

        table.doLayout();
        table.doLayout();

        expect(table.getColumnWidths()[0]).toBeGreaterThan(table.getColumnMinWidth(col));
    });
});

// `dateReferenceKeys` widens each date/time/datetime reference by
// substituting every digit position with each of 0-9 and keeping the widest
// variant — guards against a non-tabular font rendering some digit wider than
// REFERENCE_DATE's own digits. Exercising that needs a font whose digit
// advances genuinely differ, so this block overrides installTestDOM with its
// own beforeEach rather than reusing the shared uniform-digit CONFIG above
// (still a single-entry font table, per this file's own font() convention).
describe('Date/time reference width under non-uniform digit metrics', () => {
    const nonUniformFontMetrics = {
        fonts: {
            'NonUniformDigitTestFont': {
                ascent:  13,
                descent: 3,
                capTop:  10,
                advance: {
                    ' ': 10, '/': 4,
                    '0': 8, '1': 4, '2': 6, '3': 8, '4': 8,
                    '5': 8, '6': 8, '7': 8, '8': 14, '9': 8,
                },
            },
        },
    };

    beforeEach(() => installTestDOM({ ...CONFIG, fontMetrics: nonUniformFontMetrics }));
    afterEach(() => DOM.reset());

    it('D1. date column min width reflects the widest digit-substituted variant, not the raw reference text', async () => {
        const model = new Model([{ name: 'd', type: 'date', order: 0 }]);
        const store = await makeStore(model, []);
        const table = makeTable(store);
        const col   = table.getColumns()[0];

        const min = table.getColumnMinWidth(col);

        // Independently compute the expected floor via the same
        // digit-substitution `dateReferenceKeys` performs: format the same
        // reference instant Table.ts uses (REFERENCE_DATE), then re-measure
        // with every digit position replaced by each of 0-9 in turn, keeping
        // the widest variant.
        const referenceDate = new Date(2000, 11, 31, 23, 59, 59);
        const display       = new CellTextResolver();
        const base          = String(TableExporter.formatValue(col, referenceDate, new Map(), display));
        display.dispose();
        const digitChars    = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const variants       = [base, ...digitChars.map(d => base.replace(/\d/g, d))];
        const widest         = Math.max(...Util.measureTextWidths(variants));

        expect(min).toBe(widest + CELL_CHROME_PX);

        // '8' (advance 14) is wider than every digit REFERENCE_DATE's own
        // formatted text actually contains, so the widened floor must be
        // strictly greater than the pre-fix (base-text-only) measurement.
        const baseOnly = Util.measureTextWidths([base])[0];

        expect(widest).toBeGreaterThan(baseOnly);
    });
});
