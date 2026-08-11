// Offline coverage for plans/in-progress/table-column-filters.md's
// `## Expected Behaviour` — the header's optional filter row: its opt-in
// visibility, its per-column virtualized `FilterCell`s, keystroke debounce,
// operator picking, recycling, rotated-mode collapse, and the header
// context-menu toggle. Cases are numbered to match the plan's
// `## Expected Behaviour` list. Mirrors HeaderColumnWindow.test.ts's harness
// and helper style.
//
// Keydown (Enter/Escape) is exercised by invoking the cell's own private
// handler directly, `(cell as any).onInputKeyDown(...)`, rather than through
// a simulated DOM dispatch: the offline harness's window-level "keydown"
// base listener is installed once per process and is not reinstalled by a
// later `installTestDOM()` against a fresh sink, so a real dispatch is only
// reliable for the first test in the process to register that event type
// (see HeaderColumnWindow.test.ts's `PrivHeader`/`PrivCell` pattern for the
// same private-method-invocation idiom).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { TreeTable } from '~/component/table/TreeTable';
import type { TableHeader } from '~/component/table/Header';
import { FilterCell } from '~/component/table/cell/Filter';
import { FilterCellRenderer } from '~/component/table/cell/renderer/Filter';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';
import type { ModelRecord } from '~/data/ModelRecord';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import { Util } from '~/core/Util';
import { Insets } from '~/primitive/Insets';

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
    { name: 'id',   type: 'string', order: 0 },
    { name: 'name', type: 'string', order: 1 },
    { name: 'age',  type: 'number', order: 2 },
], 'id');

const RECORDS = [
    { id: '1', name: 'Alice', age: 30 },
    { id: '2', name: 'Bob',   age: 25 },
];

/** Builds a small (fits-in-viewport), fully laid-out Table over `MODEL`. */
async function makeTable(spec?: ColumnSpec, records: any[] = RECORDS): Promise<{ table: Table; store: MemoryStore }> {
    const store = new MemoryStore(MODEL, records);
    await store.load();

    const table = new Table(store, spec);
    table.getElement(true);
    table.setWidth(600);
    table.setHeight(400);
    table.doLayout();

    return { table, store };
}

function header(table: Table): TableHeader {
    return table.getHeader();
}

function filterCells(table: Table): FilterCell[] {
    return header(table).getFilterRow().getComponents() as FilterCell[];
}

function renderer(cell: FilterCell): FilterCellRenderer {
    return cell.getRenderer() as FilterCellRenderer;
}

/** Simulates typing `text` into a filter cell's input, firing "change". */
function typeInto(cell: FilterCell, text: string): void {
    const input = renderer(cell).getInput();

    (input as any).setText(text);
    (input as any).onInput();
}

/** Simulates pressing `key` (Enter/Escape) in a filter cell's input. */
function pressKey(cell: FilterCell, key: string): void {
    (cell as any).onInputKeyDown({ key });
}

/** Picks an operator on a filter cell by its menu label (e.g. "Contains"). */
function pickOperator(cell: FilterCell, label: string): void {
    const provider = renderer(cell).getOperatorButton().getMenuItems() as () => MenuItemConfig[];
    const items    = provider();
    const item     = items.find(i => i.text?.trim().endsWith(label));

    item!.action!();
}

function visibleRecords(table: Table): ModelRecord[] {
    return (table as any)._body.getVisibleRecords();
}

describe('Column filter row — opt-in visibility', () => {
    it('20. hidden by default even when a column is filterable', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        const { table: baseline } = await makeTable({ columns: [] });

        expect(table.isFilterRowVisible()).toBe(false);
        expect(header(table).hasFilterRow()).toBe(false);
        expect(header(table).getFilterRow().getComponents()).toEqual([]);
        expect(header(table).getHeight()).toBe(header(baseline).getHeight());
    });

    it('21. toggling on renders one cell per visible column, including non-filterable ones; toggling off returns to hidden', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });

        table.setFilterRowVisible(true);

        expect(table.isFilterRowVisible()).toBe(true);
        expect(header(table).hasFilterRow()).toBe(true);
        expect(filterCells(table).length).toBe(3); // id, name, age

        table.setFilterRowVisible(false);

        expect(header(table).hasFilterRow()).toBe(false);
        expect(filterCells(table).length).toBe(0);
    });

    it('22. toggling on with no filterable column anywhere leaves the row empty', async () => {
        const { table } = await makeTable({ columns: [], filterable: false });

        table.setFilterRowVisible(true);

        expect(header(table).hasFilterRow()).toBe(false);
        expect(filterCells(table).length).toBe(0);
    });

    it('23. a column-level filterable: false overrides the spec-wide default', async () => {
        const { table } = await makeTable({ columns: [{ field: 'id', filterable: false }], filterable: true });

        table.setFilterRowVisible(true);

        expect(header(table).hasFilterRow()).toBe(true);

        const idCell = filterCells(table).find(c => c.getFieldName() === 'id')!;

        expect(renderer(idCell).getInput().isDisplayed()).toBe(false);
        expect(renderer(idCell).getOperatorButton().isDisplayed()).toBe(false);
    });

    it('columns are filterable by default, with no `filterable` set anywhere in the spec', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name' }] });

        table.setFilterRowVisible(true);

        const nameCell = filterCells(table).find(c => c.getFieldName() === 'name')!;

        expect(renderer(nameCell).getInput().isDisplayed()).toBe(true);
        expect(renderer(nameCell).getOperatorButton().isDisplayed()).toBe(true);
    });

    it('a column-level filterable: true is unnecessary now but still opts a column in under a false table-wide default', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }], filterable: false });

        table.setFilterRowVisible(true);

        const nameCell = filterCells(table).find(c => c.getFieldName() === 'name')!;

        expect(renderer(nameCell).getInput().isDisplayed()).toBe(true);
    });
});

describe('Column filter row — sizing and operator-button legibility', () => {
    it('the filter row is sized to the filter input\'s own single-line box, not offset from the column row', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        // TextField's own chrome (its default 3px top+bottom padding, zero
        // border — FilterCellRenderer zeroes the input's border) is what the
        // filter row must fit, independent of the table's own theme padding.
        const expectedHeight = Util.singleLineBoxHeight(
            new Insets(0, 0, 0, 0),
            new Insets(3, 3, 3, 3),
            { top: 0, bottom: 0 },
        );

        expect(header(table).getFilterRow().getHeight()).toBe(expectedHeight);
    });

    it('the operator button is a compact, flat, glyph-only control with the operator\'s icon', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell   = filterCells(table).find(c => c.getFieldName() === 'name')!;
        const opBtn  = renderer(cell).getOperatorButton();
        const glyph  = opBtn.getGlyph();

        expect(opBtn.isFlat()).toBe(true);
        expect(opBtn.isCompact()).toBe(true);
        expect(glyph).not.toBeNull();
        expect(glyph!.getGlyphName()).toBe('magnifying-glass'); // default operator: 'contains'
    });

    it('the operator button\'s title names the current mode for its hover tooltip, without showing on its face', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell  = filterCells(table).find(c => c.getFieldName() === 'name')!;
        const opBtn = renderer(cell).getOperatorButton();

        expect(opBtn.isShowText()).toBe(false);
        expect(opBtn.getText()).toBe('Contains'); // default operator

        pickOperator(cell, 'Starts with');

        expect(opBtn.getText()).toBe('Starts with');
    });

    it('the operator menu lists each operator\'s icon alongside its label', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell     = filterCells(table).find(c => c.getFieldName() === 'name')!;
        const provider = renderer(cell).getOperatorButton().getMenuItems() as () => MenuItemConfig[];
        const items    = provider();

        const containsItem = items.find(i => i.text?.trim().endsWith('Contains'))!;
        const startsItem   = items.find(i => i.text?.trim().endsWith('Starts with'))!;

        expect(containsItem.glyph).toBe('magnifying-glass');
        expect(startsItem.glyph).toBe('align-left');
        // `checked` (not a hand-rolled '✓ ' text prefix) marks the active operator,
        // so the menu's own check column — not FilterCell — owns the checkmark's position.
        expect(containsItem.checked).toBe(true); // default operator
        expect(startsItem.checked).toBe(false);
    });
});

describe('Column filter row — geometry-diff self-layout', () => {
    // Mirrors HeaderColumnWindow.test.ts's "geometry diffing" cases for
    // HeaderCell.setHeaderGlyph: the header's own geometry-diff cache
    // (CellGeometryCache) skips a cell's doLayout when its x/width/height
    // are unchanged — which is exactly the case for a cell recycled onto a
    // different column that happens to land at the same geometry. An
    // operator change moves this cell's own layout (the input's
    // enabled/disabled state) without moving that geometry, so
    // FilterCell.setFilterState must lay itself out rather than relying on
    // the header's geometry pass to do it — see CellGeometry.ts's writer
    // list. Pins the fix directly (asserts doLayout was invoked) rather
    // than an incidental geometric side effect, since none of
    // setFilterState's other writes (button text, enabled flag, value)
    // themselves depend on a layout pass having run.
    it('setFilterState lays the cell out itself, even when nothing else would', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = filterCells(table).find(c => c.getFieldName() === 'name')!;

        let calls = 0;
        const originalDoLayout = cell.doLayout.bind(cell);
        cell.doLayout = () => { calls++; return originalDoLayout(); };

        cell.setFilterState({ operator: 'startsWith', text: 'a' });

        expect(calls).toBeGreaterThan(0);
    });
});

describe('Column filter row — typing filters the store (debounced)', () => {
    afterEach(() => vi.useRealTimers());

    function nameCell(table: Table): FilterCell {
        return filterCells(table).find(c => c.getFieldName() === 'name')!;
    }

    function ageCell(table: Table): FilterCell {
        return filterCells(table).find(c => c.getFieldName() === 'age')!;
    }

    it('24. typing + flushing the debounce filters the store and the body', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        typeInto(nameCell(table), 'ali');
        vi.advanceTimersByTime(200);

        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'ali' });
        expect(visibleRecords(table).map(r => r.get('name'))).toEqual(['Alice']);
    });

    it('25. typing twice before the debounce fires produces exactly one active descriptor', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        typeInto(nameCell(table), 'ali');
        typeInto(nameCell(table), 'alic');
        vi.advanceTimersByTime(200);

        expect(store.getActiveFilters()).toEqual([{ type: 'contains', field: 'name', value: 'alic' }]);
    });

    it('26. clearing one column\'s input removes only its filter', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [], filterable: true });
        table.setFilterRowVisible(true);

        typeInto(nameCell(table), 'ali');
        vi.advanceTimersByTime(200);
        typeInto(ageCell(table), '25');
        vi.advanceTimersByTime(200);

        expect(store.getFilter('name')).not.toBeNull();
        expect(store.getFilter('age')).not.toBeNull();

        typeInto(nameCell(table), '');
        vi.advanceTimersByTime(200);

        expect(store.getFilter('name')).toBeNull();
        expect(store.getFilter('age')).toEqual({ type: 'eq', field: 'age', value: 25 });
    });

    it('27. picking an operator applies immediately, replacing the same key', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        typeInto(nameCell(table), 'Bob');
        vi.advanceTimersByTime(200);
        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'Bob' });

        pickOperator(nameCell(table), 'Equals');

        // No debounce wait needed — the operator pick applies immediately.
        expect(store.getFilter('name')).toEqual({ type: 'eq', field: 'name', value: 'Bob' });
        expect(store.getActiveFilters().length).toBe(1);
    });

    it('28. selecting isEmpty disables the text input and still applies; selecting contains re-enables it', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        pickOperator(cell, 'Is empty');

        expect(renderer(cell).getInput().isEnabled()).toBe(false);
        expect(store.getFilter('name')).toEqual({ type: 'in', field: 'name', values: [null, undefined, ''] });

        pickOperator(cell, 'Contains');

        expect(renderer(cell).getInput().isEnabled()).toBe(true);
        expect(store.getFilter('name')).toBeNull();
    });

    it('Enter applies immediately; Escape clears and applies immediately', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);

        typeInto(cell, 'ali');
        pressKey(cell, 'Enter');
        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'ali' });

        pressKey(cell, 'Escape');
        expect(store.getFilter('name')).toBeNull();
        expect(renderer(cell).getValue()).toBeNull();
    });
});

describe('Column filter row — recycling and external sync', () => {
    afterEach(() => vi.useRealTimers());

    function wideFilterModel(n: number): Model {
        const fields = Array.from({ length: n }, (_, i) => ({
            name: `c${i}`, type: (i % 2 === 0 ? 'string' as const : 'number' as const), order: i,
        }));

        return new Model(fields, 'c0');
    }

    async function wideTable(n: number): Promise<Table> {
        const store = new MemoryStore(wideFilterModel(n), []);
        await store.load();

        const table = new Table(store, { columns: [], filterable: true });
        table.getElement(true);
        table.setFilterRowVisible(true);

        return table;
    }

    // Always drives `setScrollX` (even for `0`), unlike HeaderColumnWindow.test.ts's
    // same-named helper — these tests scroll back to `0` after a nonzero
    // offset, and `setScrollX` no-ops when the requested offset already
    // matches `_scrollX`, so the explicit-geometry call above it is what
    // actually re-renders in that case.
    function render20At100(table: Table, scrollX: number = 0): void {
        header(table).renderColumnWindow({
            columnWidths:    Array(20).fill(100),
            viewportWidth:   250,
            columnHeight:    20,
            parentRowHeight: 0,
            filterRowHeight: 28,
        });

        header(table).setScrollX(scrollX);
    }

    it('29. a filtered column that scrolls out and back in shows the same operator and text', async () => {
        vi.useFakeTimers();

        const table = await wideTable(20);
        render20At100(table, 0); // window 0..2

        const c0 = filterCells(table).find(c => c.getFieldName() === 'c0')!;
        typeInto(c0, 'x');
        vi.advanceTimersByTime(200);

        render20At100(table, 1000); // scroll far enough that c0 leaves the window
        expect(filterCells(table).some(c => c.getFieldName() === 'c0')).toBe(false);

        render20At100(table, 0); // scroll back — c0 re-enters
        const recycled = filterCells(table).find(c => c.getFieldName() === 'c0')!;

        expect(recycled.getFilterState()).toEqual({ operator: 'contains', text: 'x' });
    });

    it('30. a cell recycled onto a different field type is re-offered that type\'s operators, falling back to operators[0]', async () => {
        const table = await wideTable(20);
        render20At100(table, 0); // window 0..2: c0 string, c1 number, c2 string

        const stringCell = filterCells(table).find(c => c.getFieldName() === 'c0')!;
        pickOperator(stringCell, 'Starts with');
        expect(stringCell.getFilterState().operator).toBe('startsWith');

        // Slide far enough that the small cell pool must recycle onto number
        // columns too (only a handful of cells exist for 20 columns). Whichever
        // cell now renders a number column must be re-offered that column's
        // operators — "startsWith" is string-only and must be gone.
        render20At100(table, 700); // window 7..9: c7 number, c8 string, c9 number

        const numberCell = filterCells(table).find(c => c.getFieldName() === 'c7')!;

        expect(numberCell.getFilterState().operator).not.toBe('startsWith');
        expect(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']).toContain(numberCell.getFilterState().operator);
    });

    it('31. store.clearFilter() called programmatically blanks the rendered inputs on the next render pass', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = filterCells(table).find(c => c.getFieldName() === 'name')!;
        typeInto(cell, 'ali');
        vi.advanceTimersByTime(200);
        expect(store.getFilter('name')).not.toBeNull();

        await store.clearFilter();

        expect(renderer(filterCells(table).find(c => c.getFieldName() === 'name')!).getValue()).toBeNull();
    });
});

describe('Column filter row — hiding the row stops its filters', () => {
    afterEach(() => vi.useRealTimers());

    it('hiding the filter row removes every filter it applied and restores the unfiltered view', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({
            columns: [{ field: 'name', filterable: true }, { field: 'age', filterable: true }],
        });
        table.setFilterRowVisible(true);

        typeInto(filterCells(table).find(c => c.getFieldName() === 'name')!, 'ali');
        vi.advanceTimersByTime(200);

        expect(store.getFilter('name')).not.toBeNull();
        expect(visibleRecords(table).map(r => r.get('name'))).toEqual(['Alice']);

        table.setFilterRowVisible(false);

        expect(store.getFilter('name')).toBeNull();
        expect(visibleRecords(table).map(r => r.get('name')).sort()).toEqual(['Alice', 'Bob']);
    });

    it('a pending debounced write is cancelled, not applied, when the row is hidden mid-keystroke', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        typeInto(filterCells(table).find(c => c.getFieldName() === 'name')!, 'ali');
        table.setFilterRowVisible(false);

        expect(() => vi.advanceTimersByTime(500)).not.toThrow();
        expect(store.getFilter('name')).toBeNull();
    });

    it('showing the row again after a hide starts with a blank, default-operator cell, not the previous criteria', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        typeInto(filterCells(table).find(c => c.getFieldName() === 'name')!, 'ali');
        vi.advanceTimersByTime(200);
        table.setFilterRowVisible(false);
        table.setFilterRowVisible(true);

        const cell = filterCells(table).find(c => c.getFieldName() === 'name')!;

        expect(cell.getFilterState().text).toBe('');
        expect(store.getFilter('name')).toBeNull();
    });
});

describe('Column filter row — rotated mode and column visibility', () => {
    afterEach(() => vi.useRealTimers());

    it('32. rotating collapses the filter row; un-rotating restores it with its previous state', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = filterCells(table).find(c => c.getFieldName() === 'name')!;
        typeInto(cell, 'ali');
        vi.advanceTimersByTime(200);
        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'ali' });

        table.setDisplayMode('rotated');
        table.doLayout();

        expect(header(table).hasFilterRow()).toBe(false);
        expect(filterCells(table).length).toBe(0);
        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'ali' });

        table.setDisplayMode('normal');
        table.doLayout();

        expect(table.isFilterRowVisible()).toBe(true);
        expect(header(table).hasFilterRow()).toBe(true);

        const after = filterCells(table).find(c => c.getFieldName() === 'name')!;
        expect(after.getFilterState()).toEqual({ operator: 'contains', text: 'ali' });
    });

    it('33. hiding a filtered column leaves its store filter active', async () => {
        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        await store.setFilter('name', { type: 'contains', field: 'name', value: 'ali' });

        table.setColumnVisible('name', false);

        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'ali' });
    });

    it('34. typing then disposing the table cancels the pending write; the disposed header no longer reacts to the store\'s filterchange', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = filterCells(table).find(c => c.getFieldName() === 'name')!;
        typeInto(cell, 'ali');

        table.dispose();

        expect(() => vi.advanceTimersByTime(500)).not.toThrow();
        expect(store.getFilter('name')).toBeNull();

        // The header's destructor detaches its store 'filterchange' listener,
        // so re-emitting it after disposal must not throw. Emitted directly
        // (bypassing `setFilter`, which also fires 'datachange') because
        // `Body` has a separate, pre-existing gap — it never unbinds its own
        // store listeners on disposal — and 'datachange' is one Body listens
        // to; that crash is unrelated to this plan's filter-row code. Body
        // does not listen to 'filterchange' at all, so this exercises the
        // header's own listener wiring without tripping Body's gap.
        expect(() => (store as any).emit('filterchange', { filters: [] })).not.toThrow();
    });
});

describe('Column filter row — header context-menu toggle', () => {
    function capturedMenuItems(table: Table): MenuItemConfig[] {
        const captured: { items?: MenuItemConfig[] } = {};

        (table as any)._columnContextMenu.show = (_x: number, _y: number, items: MenuItemConfig[]) => {
            captured.items = items;
        };

        (table as any).showColumnMenu(0, 0);

        return captured.items!;
    }

    // Matches on a trailing "Filter" (`.endsWith`), not an exact-equals after
    // `.trim()`: the checked face is `'✓ Filter'`, and `.trim()` only strips
    // whitespace, so the leading `'✓ '` survives and an exact-equals match
    // would silently stop finding the entry the moment it becomes checked.
    const isFilterEntry = (i: MenuItemConfig) => i.text?.trim().endsWith('Filter') ?? false;

    it('35. a Filter entry (unchecked) appears after Reset columns when a column is filterable', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });

        const items       = capturedMenuItems(table);
        const resetIndex  = items.findIndex(i => i.text === 'Reset columns');
        const filterIndex = items.findIndex(isFilterEntry);

        expect(filterIndex).toBeGreaterThan(resetIndex);
        expect(items[filterIndex].text).toBe('  Filter');
    });

    it('36. no Filter entry appears when no column is filterable', async () => {
        const { table } = await makeTable({ columns: [], filterable: false });

        const items = capturedMenuItems(table);

        expect(items.some(isFilterEntry)).toBe(false);
    });

    it('37. invoking the Filter action toggles the row and the entry\'s checkmark', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });

        let items = capturedMenuItems(table);
        items.find(isFilterEntry)!.action!();

        expect(table.isFilterRowVisible()).toBe(true);

        items = capturedMenuItems(table);
        expect(items.find(isFilterEntry)!.text).toBe('✓ Filter');

        items.find(isFilterEntry)!.action!();

        expect(table.isFilterRowVisible()).toBe(false);

        items = capturedMenuItems(table);
        expect(items.find(isFilterEntry)!.text).toBe('  Filter');
    });
});

describe('Column filter row — TreeTable', () => {
    // Plan case 40 ("On a TreeTable with a filterable column, after toggling
    // the filter row on, filtering a parent out removes its subtree and
    // re-roots its orphaned children") is listed as manual-only because a
    // live browser session couldn't get programmatic access to a running
    // demo's store to drive it (see the plan's Implementation Notes). This
    // pins the same contract offline instead, through the real component —
    // no TreeTable-specific code was added by this plan, so this also
    // stands as the regression guard for that non-goal staying true.
    it('40. store.setFilter on a filterable column drops a filtered parent\'s subtree and re-roots its children', async () => {
        const treeModel = new Model([
            { name: 'id',     type: 'number', order: 0 },
            { name: 'parent', type: 'number', order: 1 },
            { name: 'name',   type: 'string', order: 2 },
        ], 'id');
        const store = new MemoryStore(treeModel, [
            { id: 1, parent: null, name: 'src' },
            { id: 2, parent: 1,    name: 'main.ts' },
            { id: 3, parent: null, name: 'docs' },
        ]);
        await store.load();

        const treeTable = new TreeTable(store, {
            idField: 'id', parentField: 'parent', treeColumn: 'name',
            columns: [{ field: 'name', filterable: true }],
        });
        treeTable.getElement(true);
        treeTable.setFilterRowVisible(true);
        treeTable.expandAll();

        const before = (treeTable.getBody() as any).getVisibleRecords();
        expect(before.map((r: ModelRecord) => r.get('name'))).toEqual(['src', 'main.ts', 'docs']);

        // "main" matches only 'main.ts' — its parent 'src' does not match and
        // is dropped, so 'main.ts' must re-root as a visible root rather than
        // vanish along with its filtered-out parent's subtree, matching
        // TreeTable.md's Filtering section (and TreeBody.test.ts's existing
        // "orphan-as-root" contract, which this exercises through the new
        // setFilter path instead of filterBy).
        await store.setFilter('name', { type: 'contains', field: 'name', value: 'main' });

        const after = (treeTable.getBody() as any).getVisibleRecords();
        expect(after.map((r: ModelRecord) => r.get('name'))).toEqual(['main.ts']);

        await store.setFilter('name', null);

        const restored = (treeTable.getBody() as any).getVisibleRecords();
        expect(restored.map((r: ModelRecord) => r.get('name'))).toEqual(['src', 'main.ts', 'docs']);
    });
});
