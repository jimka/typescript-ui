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
import { Event } from '~/core/Event';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { TreeTable } from '~/component/table/TreeTable';
import { TableHeader } from '~/component/table/Header';
import { FilterCell } from '~/component/table/cell/Filter';
import { FilterCellRenderer } from '~/component/table/cell/renderer/Filter';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';
import type { ModelRecord } from '~/data/ModelRecord';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import { Util } from '~/core/Util';
import { Insets } from '~/primitive/Insets';
import { TimeRenderer } from '~/component/table/cell/renderer/Time';

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

/**
 * Simulates pressing `key` (optionally with modifiers) in a filter cell's
 * input, returning the disposition `onInputKeyDown` reports. `extra` carries
 * `ctrlKey` / `metaKey` / `altKey` for a modified keystroke.
 */
function pressKey(cell: FilterCell, key: string, extra: Partial<KeyboardEvent> = {}): unknown {
    return (cell as any).onInputKeyDown({ key, ...extra });
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

// --- table-column-filter-multi-condition helpers ---
//
// Popover row interactions are driven through the same private-method /
// bracket-access idiom this file already uses for keydown (`pressKey`) and
// the operator dropdown's provider (`pickOperator`), rather than a real
// `.click()` dispatch: the offline harness's window-level "click" base
// listener has the same first-registration-only reliability limit as
// "keydown" (see this file's header comment), so a popover row's own
// TabCloseButton / "Add condition" Button is never clicked directly — the
// private `FilterCell` method its action wraps is invoked instead.

/** Invokes the operator dropdown's trailing "Add condition…" entry. */
function addCondition(cell: FilterCell): void {
    const provider = renderer(cell).getOperatorButton().getMenuItems() as () => MenuItemConfig[];
    const items    = provider();
    const item     = items.find(i => i.text === 'Add condition…');

    item!.action!();
}

/** Returns the cell's lazily-created clauses popover (created by the first `addCondition`). */
function clausesPopover(cell: FilterCell): { isOpen(): boolean; getBody(): { getComponents(): any[] } } {
    return (cell as any)._clausesPopover;
}

/** Returns the popover's clause rows, in clause order — the trailing "Add condition" button excluded. */
function popoverRows(cell: FilterCell): any[] {
    return clausesPopover(cell).getBody().getComponents().slice(0, -1);
}

/** Simulates typing `text` into a popover row's text field (the row's second child), firing "change". */
function typeIntoRow(row: any, text: string): void {
    const field = row.getComponents()[1];

    field.setText(text);
    field.onInput();
}

/** Picks an operator on a popover row (the row's first child) by its menu label. */
function pickRowOperator(row: any, label: string): void {
    const provider = row.getComponents()[0].getMenuItems() as () => MenuItemConfig[];
    const items    = provider();
    const item     = items.find((i: MenuItemConfig) => i.text?.trim().endsWith(label));

    item!.action!();
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

    it('hiding the row with several active column filters clears them in one batch, not one store call per column', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }, { field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const nameFilterCell = filterCells(table).find(c => c.getFieldName() === 'name')!;
        const ageFilterCell  = filterCells(table).find(c => c.getFieldName() === 'age')!;

        typeInto(nameFilterCell, 'ali');
        vi.advanceTimersByTime(200);
        typeInto(ageFilterCell, '30');
        vi.advanceTimersByTime(200);

        expect(store.getFilter('name')).not.toBeNull();
        expect(store.getFilter('age')).not.toBeNull();

        const setFilters = vi.spyOn(store, 'setFilters');
        const setFilter  = vi.spyOn(store, 'setFilter');

        table.setFilterRowVisible(false);

        expect(store.getFilter('name')).toBeNull();
        expect(store.getFilter('age')).toBeNull();
        // One batched call for both columns, not one `setFilter` call per column.
        expect(setFilters).toHaveBeenCalledOnce();
        expect(setFilter).not.toHaveBeenCalled();

        setFilters.mockRestore();
        setFilter.mockRestore();
        vi.useRealTimers();
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
    // HeaderCell.setHeaderGlyph: applyBounds skips a cell's doLayout when its
    // x/width/height are unchanged — which is exactly the case for a cell
    // recycled onto a different column that happens to land at the same
    // geometry. An operator change moves this cell's own layout (the input's
    // enabled/disabled state) without moving that geometry, so
    // FilterCell.setFilterState must lay itself out rather than relying on
    // the header's geometry pass to do it — see
    // Cell.canSkipUnchangedLayout's writer list. Pins the fix directly
    // (asserts doLayout was invoked) rather
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

        cell.setFilterState({ clauses: [{ operator: 'startsWith', text: 'a' }] });

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
        expect(store.getFilter('age')).toEqual({ type: 'contains', field: 'age', value: '25' });
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
        // A disabled input with no explanation just looks broken — the
        // placeholder states why it won't take text.
        expect(renderer(cell).getInput().getPlaceholder()).toBe('No value needed');
        expect(store.getFilter('name')).toEqual({ type: 'in', field: 'name', values: [null, undefined, ''] });

        pickOperator(cell, 'Contains');

        expect(renderer(cell).getInput().isEnabled()).toBe(true);
        expect(renderer(cell).getInput().getPlaceholder()).toBeNull();
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

        expect(recycled.getFilterState()).toEqual({ clauses: [{ operator: 'contains', text: 'x' }] });
    });

    it('17. a filter cell recycled off-window and back restores its full clause list, not just clause 0', async () => {
        vi.useFakeTimers();

        const table = await wideTable(20);
        render20At100(table, 0); // window 0..2

        const c0 = filterCells(table).find(c => c.getFieldName() === 'c0')!;
        typeInto(c0, 'x');
        vi.advanceTimersByTime(200);
        addCondition(c0);
        typeIntoRow(popoverRows(c0)[1], 'y');
        vi.advanceTimersByTime(200);

        expect(c0.getFilterState().clauses).toEqual([
            { operator: 'contains', text: 'x' },
            { operator: 'contains', text: 'y' },
        ]);

        render20At100(table, 1000); // scroll far enough that c0 leaves the window
        expect(filterCells(table).some(c => c.getFieldName() === 'c0')).toBe(false);

        render20At100(table, 0); // scroll back — c0 re-enters
        const recycled = filterCells(table).find(c => c.getFieldName() === 'c0')!;

        expect(recycled.getFilterState().clauses).toEqual([
            { operator: 'contains', text: 'x' },
            { operator: 'contains', text: 'y' },
        ]);
    });

    // Regression for a live-testing report that a still-blank clause was
    // being "disposed of" somewhere along a header horizontal-scroll
    // recycle. `setFilterState`/`getFilterState` clone verbatim with no
    // pruning, so this pins that a blank clause (never typed into) survives
    // the exact recycle path test 17 above exercises with a filled one.
    it('a blank clause (never typed into) survives a scroll-out recycle and reopen — nothing prunes it', async () => {
        const table = await wideTable(20);
        render20At100(table, 0); // window 0..2

        const c0 = filterCells(table).find(c => c.getFieldName() === 'c0')!;
        addCondition(c0); // clause 1: blank, left untouched

        expect(c0.getFilterState().clauses).toEqual([
            { operator: 'contains', text: '' },
            { operator: 'contains', text: '' },
        ]);

        render20At100(table, 1000); // scroll far enough that c0 leaves the window
        expect(filterCells(table).some(c => c.getFieldName() === 'c0')).toBe(false);

        render20At100(table, 0); // scroll back — c0 re-enters
        const recycled = filterCells(table).find(c => c.getFieldName() === 'c0')!;

        // Still 2 clauses, the second one still blank — nothing disposed of
        // it or collapsed the cell back to a single clause on recycle.
        expect(recycled.getFilterState().clauses).toEqual([
            { operator: 'contains', text: '' },
            { operator: 'contains', text: '' },
        ]);
    });

    it('21. a recycle onto a different field closes an open popover; a same-field resync leaves it open', async () => {
        const table = await wideTable(20);
        render20At100(table, 0); // window 0..2

        const c0 = filterCells(table).find(c => c.getFieldName() === 'c0')!;
        addCondition(c0);
        expect(clausesPopover(c0).isOpen()).toBe(true);

        // Force a resync pass without moving the column window (mirrors an
        // `onStoreFilterChange`-triggered resync elsewhere) — c0 keeps its
        // field, so the popover must stay open.
        (header(table) as any)._filterCellsDirty = true;
        header(table).renderColumnWindow();

        expect(filterCells(table).some(c => c.getFieldName() === 'c0')).toBe(true);
        expect(clausesPopover(c0).isOpen()).toBe(true);

        render20At100(table, 1000); // scroll far enough that c0's slot recycles onto another field
        expect(clausesPopover(c0).isOpen()).toBe(false);
    });

    it('30. a cell recycled onto a different field type is re-offered that type\'s operators, falling back to operators[0]', async () => {
        const table = await wideTable(20);
        render20At100(table, 0); // window 0..2: c0 string, c1 number, c2 string

        const stringCell = filterCells(table).find(c => c.getFieldName() === 'c0')!;
        pickOperator(stringCell, 'Starts with');
        expect(stringCell.getFilterState().clauses[0].operator).toBe('startsWith');

        // Slide far enough that the small cell pool must recycle onto number
        // columns too (only a handful of cells exist for 20 columns). Whichever
        // cell now renders a number column must be re-offered that column's
        // operators — "startsWith" is string-only and must be gone.
        render20At100(table, 700); // window 7..9: c7 number, c8 string, c9 number

        const numberCell = filterCells(table).find(c => c.getFieldName() === 'c7')!;

        expect(numberCell.getFilterState().clauses[0].operator).not.toBe('startsWith');
        expect(['contains', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte']).toContain(numberCell.getFilterState().clauses[0].operator);
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

    // Offline coverage for plans/implemented/table-subsystem-consolidation-round-2.md's
    // `## Expected Behaviour` §Phase 2 — `reconcileFilterCells` now shares
    // `reconcileWindowedRow` / `reconcileWindowedRowSlide` with the column
    // row, but a tick whose window and `_filterCellsDirty` are both
    // unchanged still takes the early return before either shared method
    // runs, exactly as the hand-written reconciler did before the extraction.
    it('a scroll that leaves the filter window unchanged calls neither shared reconciler', async () => {
        const table = await wideTable(20);
        render20At100(table, 0); // window 0..2

        const rowSpy   = vi.spyOn(TableHeader.prototype as any, 'reconcileWindowedRow');
        const slideSpy = vi.spyOn(TableHeader.prototype as any, 'reconcileWindowedRowSlide');

        // Re-rendering at the exact same geometry and scroll position leaves
        // the filter window unchanged, so `reconcileFilterCells` must take
        // its early return before either shared reconciler runs.
        render20At100(table, 0);

        expect(rowSpy).not.toHaveBeenCalled();
        expect(slideSpy).not.toHaveBeenCalled();

        rowSpy.mockRestore();
        slideSpy.mockRestore();
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

        expect(cell.getFilterState().clauses[0].text).toBe('');
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
        expect(after.getFilterState()).toEqual({ clauses: [{ operator: 'contains', text: 'ali' }] });
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
    // Local to this describe block: the Filter row built via `buildRow`
    // below also wires its own "click" listener and must be disposed before
    // the module-level table disposal / DOM.reset() (see the file-level
    // `builtTables` comment above for the underlying gotcha). Nested
    // `afterEach` hooks run before the ones registered at module scope.
    let builtRows: Array<InstanceType<typeof CheckboxMenuRow>> = [];

    afterEach(() => {
        for (const row of builtRows) {
            row.dispose();
        }
        builtRows = [];
    });

    function capturedMenuItems(table: Table): MenuItemConfig[] {
        const captured: { items?: MenuItemConfig[] } = {};

        (table as any)._columnContextMenu.show = (_x: number, _y: number, items: MenuItemConfig[]) => {
            captured.items = items;
        };

        (table as any).showColumnMenu(0, 0);

        return captured.items!;
    }

    /** Calls a `row:` factory, recording the built row for teardown above. */
    function buildRow(config: MenuItemConfig): InstanceType<typeof CheckboxMenuRow> {
        const row = config.row!() as InstanceType<typeof CheckboxMenuRow>;

        builtRows.push(row);

        return row;
    }

    // The Filter entry is the menu's only `row:` config (see Table.ts's
    // showColumnMenu): every other top-level entry is a plain MenuItemConfig.
    const isFilterEntry = (i: MenuItemConfig) => i.row !== undefined;

    it('35. a Filter entry (a row config) appears after Reset columns when a column is filterable', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });

        const items       = capturedMenuItems(table);
        const resetIndex  = items.findIndex(i => i.text === 'Reset columns');
        const filterIndex = items.findIndex(isFilterEntry);

        expect(filterIndex).toBeGreaterThan(resetIndex);
        expect(items[filterIndex].text).toBeUndefined();
    });

    it('36. no Filter entry appears when no column is filterable', async () => {
        const { table } = await makeTable({ columns: [], filterable: false });

        const items = capturedMenuItems(table);

        expect(items.some(isFilterEntry)).toBe(false);
    });

    it('37. the built Filter row\'s checked state tracks table.isFilterRowVisible() across menu rebuilds', async () => {
        // The click-driven round trip (a real click flips the row, and its
        // "action" handler applies the new state via setFilterRowVisible) is
        // covered in ColumnVisibilityMenu.test.ts against this same Table.ts
        // factory; this case instead pins the build-time binding — that a
        // freshly rebuilt menu's Filter row always reflects live table state,
        // per `## Non-Goals`' "menu rebuilds its rows on every open".
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });

        expect(buildRow(capturedMenuItems(table).find(isFilterEntry)!).isChecked()).toBe(false);

        table.setFilterRowVisible(true);
        expect(buildRow(capturedMenuItems(table).find(isFilterEntry)!).isChecked()).toBe(true);

        table.setFilterRowVisible(false);
        expect(buildRow(capturedMenuItems(table).find(isFilterEntry)!).isChecked()).toBe(false);
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

// cell-display-text plan: combo and temporal columns filter on displayed
// text. A second model/spec fixture carries a `string` field with `values`
// (combo) and a `time` field with `showSeconds: true`, since MODEL above has
// neither. Cases numbered per that plan's own `## Expected Behaviour` list
// (27-34), independent of this file's pre-existing 20-40 sequence above.
// The fixture and its two cell finders are module-scoped (rather than local
// to this describe block) so the date-column-filter-string-operators block
// below can reuse the same `meet` column instead of duplicating it.
const COMBO_TEMPORAL_MODEL = new Model([
    { name: 'id',   type: 'string', order: 0 },
    { name: 'role', type: 'string', order: 1 },
    { name: 'meet', type: 'time',   order: 2 },
], 'id');

const ROLE_VALUES = [
    { value: 'dev', label: 'Developer' },
    { value: 'qa',  label: 'QA Engineer' },
    { value: 'pm',  label: 'Project Manager' },
];

const COMBO_TEMPORAL_RECORDS = [
    { id: '1', role: 'dev', meet: new Date(1970, 0, 1, 9, 30, 0) },
    { id: '2', role: 'qa',  meet: new Date(1970, 0, 1, 14, 0, 0) },
    { id: '3', role: 'pm',  meet: new Date(1970, 0, 1, 16, 45, 0) },
    { id: '4', role: '',    meet: null },
];

async function comboTemporalTable(): Promise<{ table: Table; store: MemoryStore }> {
    const store = new MemoryStore(COMBO_TEMPORAL_MODEL, COMBO_TEMPORAL_RECORDS);
    await store.load();

    const table = new Table(store, {
        columns: [
            { field: 'role', values: ROLE_VALUES },
            { field: 'meet', showSeconds: true },
        ],
    });
    table.getElement(true);
    table.setWidth(600);
    table.setHeight(400);
    table.doLayout();
    table.setFilterRowVisible(true);

    return { table, store };
}

function roleCell(table: Table): FilterCell {
    return filterCells(table).find(c => c.getFieldName() === 'role')!;
}

function meetCell(table: Table): FilterCell {
    return filterCells(table).find(c => c.getFieldName() === 'meet')!;
}

describe('Column filter row — combo and temporal filtering (cell-display-text)', () => {
    afterEach(() => vi.useRealTimers());

    it('27. typing "Developer" (Equals) leaves only the record whose stored value is "dev" visible', async () => {
        vi.useFakeTimers();
        const { table, store } = await comboTemporalTable();

        pickOperator(roleCell(table), 'Equals');
        typeInto(roleCell(table), 'Developer');
        vi.advanceTimersByTime(200);

        expect(store.getFilter('role')).toEqual({ type: 'in', field: 'role', values: ['dev'] });
        expect(visibleRecords(table).map(r => r.get('id'))).toEqual(['1']);
    });

    it('28. typing "eng" with the default Contains operator leaves only the "qa" record', async () => {
        vi.useFakeTimers();
        const { table } = await comboTemporalTable();

        typeInto(roleCell(table), 'eng');
        vi.advanceTimersByTime(200);

        expect(visibleRecords(table).map(r => r.get('id'))).toEqual(['2']);
    });

    it('29. typing "Zzz" into the combo column leaves no rows visible', async () => {
        vi.useFakeTimers();
        const { table } = await comboTemporalTable();

        typeInto(roleCell(table), 'Zzz');
        vi.advanceTimersByTime(200);

        expect(visibleRecords(table)).toEqual([]);
    });

    it('30. clearing the combo column\'s input restores every row', async () => {
        vi.useFakeTimers();
        const { table } = await comboTemporalTable();

        typeInto(roleCell(table), 'Zzz');
        vi.advanceTimersByTime(200);
        expect(visibleRecords(table)).toEqual([]);

        typeInto(roleCell(table), '');
        vi.advanceTimersByTime(200);

        expect(visibleRecords(table).length).toBe(4);
    });

    it('31. typing the exact displayed time (default Equals) leaves only that record visible', async () => {
        vi.useFakeTimers();
        const { table } = await comboTemporalTable();

        // Built relationally from TimeRenderer's own output for record 2's
        // value, never a locale literal — "type the time as displayed".
        const displayed = new TimeRenderer(true);
        displayed.setValue(new Date(1970, 0, 1, 14, 0, 0));

        typeInto(meetCell(table), displayed.getDisplayText());
        vi.advanceTimersByTime(200);

        expect(visibleRecords(table).map(r => r.get('id'))).toEqual(['2']);
    });

    it('32. typing a time with Greater than leaves only the later records', async () => {
        vi.useFakeTimers();
        const { table } = await comboTemporalTable();

        pickOperator(meetCell(table), 'Greater than');
        typeInto(meetCell(table), '10:00');
        vi.advanceTimersByTime(200);

        expect(visibleRecords(table).map(r => r.get('id')).sort()).toEqual(['2', '3']);
    });

    it('33. the isEmpty operator on the combo column still selects records whose stored value is empty', async () => {
        const { table } = await comboTemporalTable();

        pickOperator(roleCell(table), 'Is empty');

        expect(visibleRecords(table).map(r => r.get('id'))).toEqual(['4']);
    });

    it('34. a combo column with no filterable:false is offered the string operator set', async () => {
        const { table } = await comboTemporalTable();

        const cell     = roleCell(table);
        const provider = renderer(cell).getOperatorButton().getMenuItems() as () => MenuItemConfig[];
        const labels   = provider().map(i => i.text?.trim());

        expect(labels).toEqual(
            expect.arrayContaining(['Contains', 'Starts with', 'Ends with', 'Equals', 'Not equals', 'Is empty', 'Is not empty']));
        expect(renderer(cell).getInput().isDisplayed()).toBe(true);
    });
});

// date-column-filter-string-operators: a temporal column's filter row now
// also offers Contains/Starts with/Ends with, matching the displayed text
// rather than the raw Date. Case numbered per that plan's own
// `## Expected Behaviour` list (31 — originally a manual-only case; the
// offline harness above (cell-display-text's `comboTemporalTable`) can
// exercise it directly, so it is covered here instead of only by hand).
// Reuses the `meet` column fixture (a `time` field with `showSeconds: true`)
// from the describe block above.
describe('Column filter row — temporal substring operators (date-column-filter-string-operators)', () => {
    afterEach(() => vi.useRealTimers());

    it('31a. the meet column\'s operator menu leads with Contains and offers Starts with/Ends with directly after At most and before Is empty', async () => {
        const { table } = await comboTemporalTable();

        const provider = renderer(meetCell(table)).getOperatorButton().getMenuItems() as () => MenuItemConfig[];
        const labels   = provider().map(i => i.text?.trim()).filter((t): t is string => t !== undefined);

        expect(labels).toEqual(
            expect.arrayContaining(['Contains', 'Equals', 'Not equals', 'Greater than', 'At least', 'Less than', 'At most',
                'Starts with', 'Ends with', 'Is empty', 'Is not empty']));

        const atMostIndex     = labels.indexOf('At most');
        const startsWithIndex = labels.indexOf('Starts with');
        const endsWithIndex   = labels.indexOf('Ends with');
        const isEmptyIndex    = labels.indexOf('Is empty');

        expect(labels[0]).toBe('Contains');
        expect(startsWithIndex).toBe(atMostIndex + 1);
        expect(endsWithIndex).toBe(startsWithIndex + 1);
        expect(isEmptyIndex).toBe(endsWithIndex + 1);
    });

    it('31b. picking Contains and typing a fragment of the displayed time narrows to the matching record', async () => {
        vi.useFakeTimers();
        const { table } = await comboTemporalTable();

        // Built relationally from TimeRenderer's own output, never a locale
        // literal — "type a fragment of what the cell shows".
        const displayed = new TimeRenderer(true);
        displayed.setValue(new Date(1970, 0, 1, 14, 0, 0));

        pickOperator(meetCell(table), 'Contains');
        typeInto(meetCell(table), displayed.getDisplayText().slice(0, 5));
        vi.advanceTimersByTime(200);

        expect(visibleRecords(table).map(r => r.get('id'))).toEqual(['2']);
    });

    it('31c. Contains "GMT" matches nothing — the native Date.toString() form is never matched', async () => {
        vi.useFakeTimers();
        const { table } = await comboTemporalTable();

        pickOperator(meetCell(table), 'Contains');
        typeInto(meetCell(table), 'GMT');
        vi.advanceTimersByTime(200);

        expect(visibleRecords(table)).toEqual([]);
    });
});

// table-column-filter-multi-condition: multiple AND-combined conditions per
// column. Cases numbered per that plan's own `## Expected Behaviour` list
// (9-21), independent of this file's pre-existing 20-40 sequence and of the
// cell-display-text plan's own 27-34 sequence above. Case 10 (typing +
// flushing the debounce still calls store.setFilter with a bare leaf
// descriptor) has no dedicated test here — it is exactly what the
// pre-existing single-clause debounce tests above (24-28, 31) already prove,
// now against the clause-list shape. Case 17 (recycling restores the full
// clause list) and case 21 (a field recycle closes an open popover) live in
// the "recycling and external sync" describe block above, where
// `wideTable` / `render20At100` are already in scope.
describe('Column filter row — multiple conditions (table-column-filter-multi-condition)', () => {
    afterEach(() => vi.useRealTimers());

    function nameCell(table: Table): FilterCell {
        return filterCells(table).find(c => c.getFieldName() === 'name')!;
    }

    it('9. a freshly built FilterCell has one clause and renders identically to today, with no visible badge', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);

        expect(cell.getFilterState().clauses.length).toBe(1);
        expect(renderer(cell).getInput().isDisplayed()).toBe(true);
        expect(renderer(cell).getOperatorButton().isDisplayed()).toBe(true);
        expect((cell as any)._badge.isVisible()).toBe(false);
    });

    it('11. the operator dropdown lists every operator plus a trailing separator and "Add condition…"', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const provider = renderer(nameCell(table)).getOperatorButton().getMenuItems() as () => MenuItemConfig[];
        const items    = provider();

        const operatorLabels = ['Contains', 'Starts with', 'Ends with', 'Equals', 'Not equals', 'Is empty', 'Is not empty'];
        for (const label of operatorLabels) {
            expect(items.some(i => i.text?.trim().endsWith(label))).toBe(true);
        }

        expect(items[items.length - 2].separator).toBe(true);
        expect(items[items.length - 1].text).toBe('Add condition…');
        expect(items[items.length - 1].glyph).toBe('plus');
    });

    it('12. invoking "Add condition…" once adds a second blank clause and opens a two-row popover', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);

        addCondition(cell);

        expect(cell.getFilterState().clauses.length).toBe(2);
        expect(cell.getFilterState().clauses[1]).toEqual({ operator: 'contains', text: '' });
        // Neither clause has text yet, so nothing is actually applied to the
        // store — the badge stays hidden rather than showing a misleading
        // "2" for a column with zero active conditions (see the dedicated
        // effective-count badge tests below).
        expect((cell as any)._badge.getCount()).toBeNull();
        expect(clausesPopover(cell).isOpen()).toBe(true);

        const rows = popoverRows(cell);
        expect(rows.length).toBe(2);
        expect(rows[0].getComponents().length).toBe(2); // operator button + text field, no remove control
        expect(rows[1].getComponents().length).toBe(3); // operator button + text field + remove control
    });

    // Round 3 live-testing fix: a popover row's operator button was built
    // `setFlat(true)`, which strips its border/background/shadow — next to
    // the popover's own non-flat "Add condition" Button it read as
    // unclickable chrome. Not flat now (Button's own default), while staying
    // compact and glyph-only — compact wins over flat for the inset/sizing
    // calculation, so the button's size is unaffected. The always-visible
    // inline operator button (a different control, FilterOperatorButton) is
    // untouched and stays flat, per its own dedicated test above.
    it('a popover row\'s operator button is compact and glyph-only, but not flat — it must read as clickable', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        addCondition(cell);

        const rowOpButton = popoverRows(cell)[0].getComponents()[0];

        expect(rowOpButton.isFlat()).toBe(false);
        expect(rowOpButton.isCompact()).toBe(true);
        expect(rowOpButton.isShowText()).toBe(false);
    });

    it('clicking the operator button opens the default menu for 0/1 clauses, and vetoes it once the column has 2+', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell   = nameCell(table);
        const opBtn  = renderer(cell).getOperatorButton() as any;

        // The single-clause default: MenuButton's own internal toggle is let through.
        expect(cell.getFilterState().clauses.length).toBe(1);
        expect(opBtn.shouldToggleMenu()).toBe(true);

        addCondition(cell); // now 2 clauses

        expect(opBtn.shouldToggleMenu()).toBe(false);
    });

    it('clicking the operator button with 2+ clauses opens the clauses popover directly instead of the menu', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);

        // With one clause, the click handler is a no-op — MenuButton's own
        // (unvetoed) toggle is what opens the operator menu for that case,
        // and no popover has been created yet.
        (cell as any).onOperatorButtonClick();
        expect((cell as any)._clausesPopover).toBeNull();

        addCondition(cell); // 2 clauses; addCondition's own call already opened the popover
        // Give clause 1 real text — otherwise closing the popover below
        // would prune it back down to 1 clause (round 3's blank-clause
        // pruning fix), defeating the "2+ clauses" premise this test needs.
        typeIntoRow(popoverRows(cell)[1], 'Bob');

        const popover = clausesPopover(cell);
        (popover as any).hide();
        expect(popover.isOpen()).toBe(false);

        // Simulates the button's own click with 2+ clauses now in effect:
        // MenuButton's internal toggle is vetoed (proven by the previous
        // test), so this handler is the only thing that runs for the click,
        // and it must reopen the popover.
        (cell as any).onOperatorButtonClick();
        expect(popover.isOpen()).toBe(true);
    });

    it('a 2+ clause column states the actual conditions on the badge and the operator button, not just a count', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = filterCells(table).find(c => c.getFieldName() === 'age')!;

        addCondition(cell);
        pickRowOperator(popoverRows(cell)[0], 'At least');
        typeIntoRow(popoverRows(cell)[0], '18');
        pickRowOperator(popoverRows(cell)[1], 'At most');
        typeIntoRow(popoverRows(cell)[1], '65');

        const expected = 'age At least "18" AND age At most "65"';

        expect((cell as any)._badge.getAccessibleDescription()).toBe(expected);
        expect(renderer(cell).getOperatorButton().getDescription()?.getText().valueOf()).toBe(expected);

        // The description never renders on the glyph-only face — only the tooltip.
        expect(renderer(cell).getOperatorButton().isShowDescription()).toBe(false);

        // Round 3: with 2+ effective conditions the tooltip's title line (the
        // button's own text, off-face per showText: false) must name "how
        // many", not clause 0's operator alone — a bare "At least" would
        // misrepresent the AND-combined set as just its first clause.
        expect(renderer(cell).getOperatorButton().getText()).toBe('2 conditions');

        // Dropping back to one clause clears both...
        (cell as any).removeClause(1);
        expect((cell as any)._badge.getAccessibleDescription()).toBeNull();
        expect(renderer(cell).getOperatorButton().getDescription()).toBeNull();
        // ...and restores the single-operator title (clause 0's own operator,
        // "At least" — changed away from the field's default "Equals" above
        // via the popover row's own operator pick) — `removeClause` never
        // goes through `applyOperatorFace`, so `syncBadge` is what must
        // restore it.
        expect(renderer(cell).getOperatorButton().getText()).toBe('At least');
    });

    // Regression for a live-testing bug report: the badge counted every
    // clause in `_clauses`, including a row added via "Add condition…" but
    // not yet typed into, so a column with one real condition plus one
    // still-blank row showed "2" when only 1 condition was actually applied
    // to the store. The fix routes the badge's count through
    // `effectiveClauseCount` — the same would-this-clause-contribute-a-filter
    // rule `buildClauseFilter` already used to exclude a blank clause from
    // what's actually sent to the store — so the two can't drift apart again.
    describe('the badge counts only effective clauses (buildClauseFilter\'s own null-exclusion rule)', () => {
        it('a real condition plus one still-blank added row does not show "2" — the badge stays hidden below 2 effective clauses', async () => {
            const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
            table.setFilterRowVisible(true);

            const cell = nameCell(table);
            typeInto(cell, 'ali');  // clause 0: one real, effective condition
            addCondition(cell);     // clause 1: blank, not yet typed into

            expect(cell.getFilterState().clauses.length).toBe(2);
            expect((cell as any)._badge.getCount()).toBeNull();
            expect((cell as any)._badge.isVisible()).toBe(false);

            // Typing into the blank row makes it effective too — now both
            // conditions are actually applied, and the badge reports it.
            typeIntoRow(popoverRows(cell)[1], 'ce');

            expect((cell as any)._badge.getCount()).toBe(2);
            expect((cell as any)._badge.isVisible()).toBe(true);
        });

        it('isEmpty / isNotEmpty clauses count as effective with no typed text, same as buildClauseFilter', async () => {
            const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
            table.setFilterRowVisible(true);

            const cell = filterCells(table).find(c => c.getFieldName() === 'age')!;

            addCondition(cell);
            pickRowOperator(popoverRows(cell)[0], 'At least');
            typeIntoRow(popoverRows(cell)[0], '18');
            pickRowOperator(popoverRows(cell)[1], 'Is empty'); // no text needed

            expect((cell as any)._badge.getCount()).toBe(2);
        });

        it('a third, still-blank added clause does not inflate the badge past the number of effective clauses', async () => {
            const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
            table.setFilterRowVisible(true);

            const cell = nameCell(table);
            typeInto(cell, 'ali');
            addCondition(cell);
            typeIntoRow(popoverRows(cell)[1], 'Bob');
            (cell as any).onAddConditionButtonClick(); // clause 2: blank

            expect(cell.getFilterState().clauses.length).toBe(3);
            expect((cell as any)._badge.getCount()).toBe(2);
        });
    });

    // A blank clause (added but never typed into) is a popover-only
    // artifact while the popover stays open — editing a wholly different
    // clause must not disturb it.
    it('editing clause 0 does not disturb a still-open, still-blank clause 1', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        typeInto(cell, 'ali');
        addCondition(cell); // clause 1: blank

        pickOperator(cell, 'Starts with');

        expect(cell.getFilterState().clauses[1]).toEqual({ operator: 'contains', text: '' });
    });

    // Round 3 live-testing fix: a still-blank clause used to survive forever,
    // including a close/reopen of the popover (see the prior round's now-
    // superseded test this one replaces) — reopening kept showing the same
    // stale blank rows. `pruneBlankClauses`, wired into `Popover`'s new
    // `onClose`, now drops every non-effective clause at index ≥ 1 exactly
    // once per close, whether the close came from "Done" or an outside-click
    // dismissal. Clause 0 (the always-visible, never-removable inline
    // clause) is always kept regardless of its own effectiveness.
    it('closing the popover (Done) prunes blank clauses added but never typed into; reopening shows only the effective ones', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        typeInto(cell, 'ali');                     // clause 0: effective
        addCondition(cell);                        // clause 1: blank ("Add condition…")
        (cell as any).onAddConditionButtonClick();  // clause 2: blank (popover's own "Add condition")

        expect(cell.getFilterState().clauses.length).toBe(3);

        // "Done" -> Popover.hide() -> onClose -> pruneBlankClauses().
        (cell as any)._clausesPopover.hide();
        (cell as any).openClausesPopover();

        expect(cell.getFilterState().clauses).toEqual([{ operator: 'contains', text: 'ali' }]);
        expect(popoverRows(cell).length).toBe(1);
    });

    // A disabled popover-row text field is easy to miss the reason for —
    // same fix as the inline input's own isEmpty/isNotEmpty case (test 28
    // above), applied to `buildClauseRow`'s own field.
    it('a popover row\'s text field explains itself with a placeholder when its operator takes no operand', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = filterCells(table).find(c => c.getFieldName() === 'age')!;

        addCondition(cell);
        const row1Field = () => popoverRows(cell)[1].getComponents()[1];

        expect(row1Field().isEnabled()).toBe(true);
        expect(row1Field().getPlaceholder()).toBeNull();

        pickRowOperator(popoverRows(cell)[1], 'Is empty');

        expect(row1Field().isEnabled()).toBe(false);
        expect(row1Field().getPlaceholder()).toBe('No value needed');

        pickRowOperator(popoverRows(cell)[1], 'Equals');

        expect(row1Field().isEnabled()).toBe(true);
        expect(row1Field().getPlaceholder()).toBeNull();
    });

    it('13. typing into a popover row updates the store on the same shared per-field debounce timer', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        typeInto(cell, 'ali');
        vi.advanceTimersByTime(200);

        addCondition(cell);
        typeIntoRow(popoverRows(cell)[1], 'ce');

        // Not yet applied — the row's keystroke only (re)started the debounce.
        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'ali' });

        vi.advanceTimersByTime(200);

        expect(store.getFilter('name')).toEqual({
            type:    'and',
            filters: [
                { type: 'contains', field: 'name', value: 'ali' },
                { type: 'contains', field: 'name', value: 'ce' },
            ],
        });
    });

    it('14. picking a different operator on a popover row applies immediately, without a debounce wait', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        typeInto(cell, 'ali');
        vi.advanceTimersByTime(200);

        addCondition(cell);
        typeIntoRow(popoverRows(cell)[1], 'Bob');
        vi.advanceTimersByTime(200);

        pickRowOperator(popoverRows(cell)[1], 'Equals');

        expect(store.getFilter('name')).toEqual({
            type:    'and',
            filters: [
                { type: 'contains', field: 'name', value: 'ali' },
                { type: 'eq',       field: 'name', value: 'Bob' },
            ],
        });
    });

    it('15. removing a popover row drops back to one clause, hides the badge, and applies immediately', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        typeInto(cell, 'ali');
        vi.advanceTimersByTime(200);
        addCondition(cell);
        typeIntoRow(popoverRows(cell)[1], 'Bob');
        vi.advanceTimersByTime(200);

        expect(store.getFilter('name')).toEqual({
            type:    'and',
            filters: [
                { type: 'contains', field: 'name', value: 'ali' },
                { type: 'contains', field: 'name', value: 'Bob' },
            ],
        });

        // Row 1's own remove control — invoked directly per this file's
        // established idiom for a control whose action is a private method
        // (see the helpers above), rather than a real `.click()` dispatch.
        (cell as any).removeClause(1);

        expect(cell.getFilterState().clauses.length).toBe(1);
        expect((cell as any)._badge.getCount()).toBeNull();
        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'ali' });
        expect(popoverRows(cell).length).toBe(1);
    });

    it('16. the popover\'s own "Add condition" button appends further rows; row 0 is never removable', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        addCondition(cell); // outer menu entry -> 2 clauses, popover open

        // The popover's own internal button, not the outer menu entry.
        (cell as any).onAddConditionButtonClick();

        expect(cell.getFilterState().clauses.length).toBe(3);

        let rows = popoverRows(cell);
        expect(rows.length).toBe(3);
        expect(rows[0].getComponents().length).toBe(2); // row 0: still no remove control
        expect(rows[1].getComponents().length).toBe(3);
        expect(rows[2].getComponents().length).toBe(3);

        // Removing rows 2 then 1, in that order, always leaves row 0 un-removable.
        (cell as any).removeClause(2);
        expect(cell.getFilterState().clauses.length).toBe(2);

        (cell as any).removeClause(1);
        expect(cell.getFilterState().clauses.length).toBe(1);

        rows = popoverRows(cell);
        expect(rows.length).toBe(1);
        expect(rows[0].getComponents().length).toBe(2);
    });

    // Regression for an audit finding on this plan: a cell recycled from a
    // multi-condition column onto a `filterable: false` one (`setOperators`
    // called with an empty array) must drop its stale clause list and hide
    // the badge along with the input/operator button, not just the latter
    // two — otherwise a badge showing a leftover count of 2+ lingers with no
    // controls left to explain it.
    it('setOperators([]) drops a stale multi-clause list and hides the badge on a cell going non-filterable', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        typeInto(cell, 'ali');
        addCondition(cell);
        typeIntoRow(popoverRows(cell)[1], 'Bob');
        expect((cell as any)._badge.getCount()).toBe(2);

        cell.setOperators([]);

        expect(cell.getFilterState().clauses.length).toBe(1);
        expect((cell as any)._badge.isVisible()).toBe(false);
        expect((cell as any)._badge.getCount()).toBeNull();
    });

    it('18. store.clearFilter() resets a multi-clause column back to one blank clause with the badge hidden', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        typeInto(cell, 'ali');
        vi.advanceTimersByTime(200);
        addCondition(cell);
        typeIntoRow(popoverRows(cell)[1], 'Bob');
        vi.advanceTimersByTime(200);
        expect(cell.getFilterState().clauses.length).toBe(2);

        await store.clearFilter();

        const after = nameCell(table);
        expect(after.getFilterState()).toEqual({ clauses: [{ operator: 'contains', text: '' }] });
        expect((after as any)._badge.getCount()).toBeNull();
    });

    it('19. hiding the filter row with a multi-clause column clears its store entry; showing it again returns to one blank clause', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);
        typeInto(cell, 'ali');
        vi.advanceTimersByTime(200);
        addCondition(cell);
        typeIntoRow(popoverRows(cell)[1], 'Bob');
        vi.advanceTimersByTime(200);
        expect(store.getFilter('name')).not.toBeNull();

        table.setFilterRowVisible(false);
        expect(store.getFilter('name')).toBeNull();

        table.setFilterRowVisible(true);

        expect(nameCell(table).getFilterState()).toEqual({ clauses: [{ operator: 'contains', text: '' }] });
    });

    it('20. disposing a table after a popover was opened does not throw and closes the popover', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell    = nameCell(table);
        addCondition(cell);

        const popover = clausesPopover(cell);
        expect(popover.isOpen()).toBe(true);

        // `addCondition`'s immediate `fireFilterChange(true)` kicks off an
        // async `store.setFilter` write (`AbstractStore.applyFilterChange`
        // chains through `applyView().then(...)`); let it settle before
        // disposing so its later 'filterchange'/'datachange' emission does
        // not land against already-torn-down components — a pre-existing
        // `Body` gap (it never unbinds its own store listeners on
        // disposal; see this file's test 34 comment) unrelated to this
        // plan's popover code, which this test does not intend to exercise.
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(() => table.dispose()).not.toThrow();
        expect((popover as any).isOpen()).toBe(false);
    });
});

describe('Column filter row — numeric input restriction (filter-numeric-input-restriction)', () => {
    afterEach(() => vi.useRealTimers());

    function ageCell(table: Table): FilterCell {
        return filterCells(table).find(c => c.getFieldName() === 'age')!;
    }

    function nameCell(table: Table): FilterCell {
        return filterCells(table).find(c => c.getFieldName() === 'name')!;
    }

    it('12. a non-numeric single character is refused on a number column', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        expect(pressKey(ageCell(table), 'a')).toEqual({ prevent: true });
    });

    it('13. digits, "-", and "." are allowed on a number column', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = ageCell(table);

        expect(pressKey(cell, '5')).toBe(false);
        expect(pressKey(cell, '-')).toBe(false);
        expect(pressKey(cell, '.')).toBe(false);
    });

    it('14. the gate is stateless — a second "-" is still allowed after text already holds one', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = ageCell(table);

        typeInto(cell, '-1');

        expect(pressKey(cell, '-')).toBe(false);
    });

    it('15. editing and navigation keys are allowed on a number column', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = ageCell(table);

        expect(pressKey(cell, 'Backspace')).toBe(false);
        expect(pressKey(cell, 'ArrowLeft')).toBe(false);
    });

    it('16. a modified keystroke is a shortcut, never refused', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = ageCell(table);

        expect(pressKey(cell, 'v', { ctrlKey: true } as Partial<KeyboardEvent>)).toBe(false);
        expect(pressKey(cell, 'a', { metaKey: true } as Partial<KeyboardEvent>)).toBe(false);
    });

    it('17. a refused keystroke changes nothing else — state unchanged, no "filterchange" fired', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell    = ageCell(table);
        const before  = cell.getFilterState();
        const onChange = vi.fn();

        cell.on('filterchange', onChange);
        pressKey(cell, 'a');

        expect(cell.getFilterState()).toEqual(before);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('18. Enter and Escape still work on a numeric column, unchanged', async () => {
        vi.useFakeTimers();

        const { table, store } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = ageCell(table);

        typeInto(cell, '30');
        pressKey(cell, 'Enter');

        expect(store.getFilter('age')).toEqual({ type: 'contains', field: 'age', value: '30' });

        pressKey(cell, 'Escape');

        expect(cell.getFilterState().clauses[0].text).toBe('');
        expect(store.getFilter('age')).toBeNull();
    });

    it('19. a string column\'s filter input still takes arbitrary text', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        expect(pressKey(nameCell(table), 'a')).toBe(false);
    });

    it('20. setNumericOnly is live — either order leaves the last call in effect', async () => {
        const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = nameCell(table);

        cell.setNumericOnly(true);
        cell.setNumericOnly(false);
        expect(pressKey(cell, 'a')).toBe(false);

        cell.setNumericOnly(false);
        cell.setNumericOnly(true);
        expect(pressKey(cell, 'a')).toEqual({ prevent: true });
    });

    it('21. a combo column over a numeric field is not restricted — a label can still be typed', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', values: ['30', '25'] }] });
        table.setFilterRowVisible(true);

        expect(pressKey(ageCell(table), 'a')).toBe(false);
    });

    it('22. a popover clause row carries the same gate', async () => {
        const { table } = await makeTable({ columns: [{ field: 'age', filterable: true }] });
        table.setFilterRowVisible(true);

        const cell = ageCell(table);
        const spy  = vi.spyOn(Event, 'addListener');

        addCondition(cell);

        const rowField = popoverRows(cell)[1].getComponents()[1];
        const registration = spy.mock.calls.find(c => c[0] === rowField && c[1] === 'keydown');

        spy.mockRestore();

        expect(registration).toBeDefined();

        const listener = registration![2] as unknown as Event.Listener;

        expect(listener({ key: 'a' } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ key: '5' } as KeyboardEvent)).toBe(false);

        // `addCondition`'s immediate `fireFilterChange(true)` kicks off an
        // async `store.setFilter` write (see this file's test 20 comment);
        // let it settle before the test ends so its later emission does not
        // land against a later test's freshly reset DOM.
        await new Promise(resolve => setTimeout(resolve, 0));
    });
});
