import { Table } from '@jimka/typescript-ui/component/table';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import type { FieldType, ModelRecord } from '@jimka/typescript-ui/data';
import { DEPARTMENTS, ROW_FILTER_TITLES, tableRows } from '../builders/data.js';
import { elementFor, requireElement } from '../builders/dom.js';
import { choice } from '../builders/params.js';
import { admittedAt, awaitStoreView } from '../builders/store.js';
import type { CallTarget, HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'table-rows';

/** The model's fields, in column order: every cell type the table renders. */
const FIELDS: ReadonlyArray<{ name: string; type: FieldType }> = [
    { name: 'id', type: 'number' },
    { name: 'name', type: 'string' },
    { name: 'email', type: 'string' },
    { name: 'department', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'salary', type: 'number' },
    { name: 'hired', type: 'date' },
    { name: 'lastLogin', type: 'datetime' },
    { name: 'shiftStart', type: 'time' },
    { name: 'active', type: 'boolean' },
    { name: 'score', type: 'number' },
    { name: 'notes', type: 'string' },
];

/** What `update` changes: one record's score, or the department filter. */
const UPDATES = ['record', 'filter'] as const;

/** `rowfilter=`'s values: `off` sets no row filter, `title` admits `ROW_FILTER_TITLES`. */
const ROW_FILTERS = ['off', 'title'] as const;

/** Rows `update=record` cycles through: the ten that start visible. */
const UPDATE_ROW_SPAN = 10;

/** `update=record`'s score base: above the generator's 0–100 range, so every write changes the value. */
const SCORE_BASE = 1000;

/** The row selected before `key` runs: a few rows down, so both arrow keys move the selection. */
const KEY_START_ROW = 3;

/** The header cell `click` sorts by: `name`. The first columns are always inside the header's column window. */
const SORT_COLUMN_INDEX = 1;

export const description = 'Table of n rows (default 10,000) over a 12-field model with every cell type, the filter row shown. Reproduces slice 19 F19.2 (the focus style re-materialises the whole visible-record list at the tail of every render pass): 6 getVisibleRecords calls per ArrowDown. rowfilter=title sets a body row filter through Table.setRowVisible that admits two titles in five, so getVisibleRecords filters the whole store view on every call — the state G21\'s memo needs and no panel had.';

/** 10,000 rows: a store large enough that the view is built off the main thread and the body virtualises. */
export const defaultScale = 10_000;

/** Wheel-scrolling the body: the table's everyday hot path. */
export const defaultDrive = 'wheel';

/**
 * `rowfilter=title`'s predicate: admits a record whose `title` is one of `ROW_FILTER_TITLES`.
 *
 * @param record - The record to test.
 * @returns Whether the row filter admits it.
 */
function admitsFilteredTitle(record: ModelRecord): boolean {
    return ROW_FILTER_TITLES.has(record.get('title') as string);
}

/**
 * Whether the table's body ended up holding a row-visible predicate. `Table`
 * pushes the predicate to `Body` only in `"normal"` display mode and composes
 * it with any quick search first, so this reads what the body actually holds
 * rather than what `build` passed in.
 *
 * @param body - The table's body.
 * @returns Whether the body holds a row-visible predicate.
 */
function hasRowFilter(body: object): boolean {
    return typeof (body as unknown as { _rowVisible?: unknown })._rowVisible === 'function';
}

/**
 * The `update` target for the `update=` parameter.
 *
 * @param mode - What to change.
 * @param store - The table's store.
 * @param n - Rows in the store.
 * @param rowVisible - The row filter in effect, for `admittedAt`.
 * @returns The target.
 */
function updateTarget(mode: typeof UPDATES[number], store: MemoryStore, n: number, rowVisible: ((record: ModelRecord) => boolean) | null): CallTarget {
    if (mode === 'filter') {
        return function filterByDepartment(index: number): void {
            void store.setFilter('department', { type: 'eq', field: 'department', value: DEPARTMENTS[index % DEPARTMENTS.length] });
        };
    }

    return function rescoreRecord(index: number): void {
        admittedAt(store, rowVisible, index % Math.min(UPDATE_ROW_SPAN, n))!.set('score', SCORE_BASE + index);
    };
}

/**
 * Builds a `Table` of `n` generated rows with the filter row shown.
 *
 * @param n - Rows.
 * @param params - `update=` chooses what `update` changes; `rowfilter=` sets a body row filter.
 * @returns The table as root, target of `resize`, `passes` and `update`; `afterMount` waits for the store's view, selects a row and gives `wheel`, `key`, `drag` (a column edge) and `click` (a sort) their elements.
 * @throws Error - For an unknown `update=` or `rowfilter=` value.
 */
export function build(n: number, params: URLSearchParams): PanelBuild {
    const mode = choice(params, 'update', UPDATES, PANEL);
    const rowFilter = choice(params, 'rowfilter', ROW_FILTERS, PANEL);
    const rowVisible = rowFilter === 'title' ? admitsFilteredTitle : null;
    const store = new MemoryStore(new Model(FIELDS.map((f) => ({ name: f.name, type: f.type }))));

    store.loadData(tableRows(n));

    const columns = FIELDS.map((f) => {
        if (f.name === 'department') {
            return { field: f.name, values: [...DEPARTMENTS] };
        }

        return f.name === 'notes' ? { field: f.name, filterable: false } : { field: f.name };
    });

    const table = Table(store, { columns });

    table.setFilterRowVisible(true);

    if (rowVisible !== null) {
        table.setRowVisible(rowVisible);
    }

    return {
        root: table,
        targets: { resize: table, passes: table, update: updateTarget(mode, store, n, rowVisible) },
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            // At the default scale the store builds its view on a worker, so
            // the record to select and the body's rows both arrive after the
            // mount, not during `build`.
            await awaitStoreView(tools, store, PANEL);

            table.selectRecord(admittedAt(store, rowVisible, Math.min(KEY_START_ROW, n - 1))!);

            const body = elementFor(tools, table.getBody(), PANEL);
            const header = elementFor(tools, table.getHeader(), PANEL);
            const headerCell = header.querySelectorAll('.HeaderCell')[SORT_COLUMN_INDEX];

            if (!headerCell) {
                throw new Error(`${PANEL}: no element matches .HeaderCell at index ${SORT_COLUMN_INDEX}`);
            }

            return {
                wheel: body,
                key: { element: body, keys: ['ArrowDown', 'ArrowUp'] },
                drag: { element: requireElement(header, '.ResizeHandle', PANEL), axis: 'x' },
                click: { elements: [headerCell] },
            };
        },
        geometry: { table, header: table.getHeader(), body: table.getBody(), focused: '.Cell.focused', cell: '.TableBody .StringCell' },
        describe: () => ({
            rows: n,
            columns: FIELDS.length,
            rowFilter,
            storeRecords: store.getCount(),
            filteredRows: rowVisible === null ? store.getCount() : store.getRecords().filter(rowVisible).length,
            bodyRowFilter: hasRowFilter(table.getBody()),
        }),
        installWork: (tools: HarnessTools): string[] => [tools.countMethod(table.getBody(), 'getVisibleRecords'), tools.countMethod(store, 'getRecords')],
    };
}
