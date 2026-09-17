// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Record binding of an open cell editor across a row rebind. A table body keeps
// a small pool of `Row` components and rebinds them to new records as the user
// scrolls; an editor left open over one of those slots used to survive the
// rebind, so the next commit wrote the user's text onto whichever record the
// slot had moved on to and left the record actually edited untouched.
// `Body.commitEditsBeforeRebind` closes that door — the row axis' copy of the
// column-axis sweep `Body.commitEditsOutsideWindow` already performs, keyed on
// record identity rather than on the bind loop's `wasRebound` flag, which any
// store event sets for the whole pool.
//
// Offline-faithful: `Cell.startEdit` is pure control flow (its `focus` lands on
// the recording sink), `StringEditor` caches the typed value itself, and a
// scroll tick renders synchronously once its animation frames are drained. The
// harness shape is `ScrollRebindLayoutEconomy.test.ts`'s.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { TreeTable } from '~/component/table/TreeTable';
import { Row } from '~/component/table/Row';
import { Cell } from '~/component/table/cell/Cell';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { FieldOptions } from '~/data/Field';
import type { ModelRecord } from '~/data/ModelRecord';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The coalesced layout queue runs on an animation frame, and the offline sink
// drops its callback — capture the frames so a scroll tick can be driven to
// completion, queue included.
let frames: FrameRequestCallback[] = [];
let tables: Table[] = [];

beforeEach(() => {
    installTestDOM(CONFIG);
    frames = [];
    tables = [];
    (DOM.sink as any).requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(cb);
    (DOM.sink as any).cancelAnimationFrame  = () => {};
});
afterEach(() => {
    for (const table of tables) {
        table.dispose();
    }

    DOM.reset();
});

/** Drains the captured animation frames, including any they queue in turn. */
function runFrames(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard++) {
        const pending = frames;
        frames = [];

        for (const callback of pending) {
            callback(0);
        }
    }
}

// Body geometry: the same 600x320 box `ScrollRebindLayoutEconomy` uses, which
// leaves the flat fixture's three columns comfortably inside the body width so
// the column window never moves under a purely vertical scroll.
const TABLE_WIDTH  = 600;
const TABLE_HEIGHT = 320;

// Enough records that a scroll lands far outside the starting window, and far
// enough that the last record is nowhere near it — case 3 mutates that record
// to prove an unrelated store event leaves an open editor alone.
const RECORD_COUNT = 4000;

// Rows scrolled past in one tick. The pool is the visible window plus a small
// buffer (~20 rows at this height), so 40 rows moves every slot onto a record
// it was not bound to — which is exactly the rebind the sweep must catch.
const SCROLL_ROWS = 40;

/** The text "typed" into the open editor, never committed by the user. */
const TYPED = 'TYPED';

const MODEL = new Model([
    { name: 'reference', type: 'string', order: 0 },
    { name: 'amount',    type: 'number', order: 1 },
    { name: 'posted_at', type: 'date',   order: 2 },
], 'reference');

/** The `reference` value record `index` is seeded with. */
function seededReference(index: number): string {
    return `reference value ${index + 1}`;
}

/** Mounts, sizes and lays `table` out, then drains its startup frames. */
function realize<T extends Table>(table: T): T {
    tables.push(table);

    table.getElement(true);
    table.setWidth(TABLE_WIDTH);
    table.setHeight(TABLE_HEIGHT);
    table.doLayout();
    runFrames();

    return table;
}

/** A realized, laid-out table over enough rows to scroll well past its pool. */
async function makeScrollableTable(): Promise<Table> {
    const store = new MemoryStore(MODEL, Array.from({ length: RECORD_COUNT }, (_, r) => ({
        reference: seededReference(r),
        amount:    (r + 1) * 7,
        posted_at: new Date(2024, r % 12, (r % 27) + 1),
    })));

    await store.load();

    return realize(new Table(store));
}

function pooledRows(table: Table): Row[] {
    return (table.getBody() as any).getRowPool() as Row[];
}

/** An edit opened by {@link openEdit}: the editing cell and the record it was opened against. */
interface OpenEdit {
    cell:   Cell<any>;
    record: ModelRecord;
}

/**
 * Opens an editor on the first rendered cell of pool slot 0 and types `text`
 * into it, leaving the edit uncommitted.
 *
 * @param table - The realized table to edit in.
 * @param text - The text to type into the editor.
 *
 * @returns The editing cell and the record the edit was opened against.
 */
function openEdit(table: Table, text: string): OpenEdit {
    const row    = pooledRows(table)[0];
    const record = row.getData()!;
    const cell   = row.getComponents()[0] as Cell<any>;

    cell.startEdit();

    expect(cell.isEditing()).toBe(true);

    (cell as any)._activeEditor.setValue(text);

    return { cell, record };
}

/** Every record whose `reference` no longer matches the value it was seeded with. */
function changedRecords(table: Table): ModelRecord[] {
    return table.getStore().getRecords()
        .filter((record, index) => record.get('reference') !== seededReference(index));
}

describe('Table — an editor open across a row rebind', () => {
    it('commits the typed text onto the record the edit was opened against', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const edit  = openEdit(table, TYPED);

        body.setScrollY(body.getRowHeight() * SCROLL_ROWS);
        runFrames();

        expect(edit.cell.isEditing()).toBe(false);
        expect(edit.record.get('reference')).toBe(TYPED);
    });

    it('leaves the record the rebound slot now shows untouched', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const edit  = openEdit(table, TYPED);

        body.setScrollY(body.getRowHeight() * SCROLL_ROWS);
        runFrames();

        expect(pooledRows(table)[0].getData()).not.toBe(edit.record);
        expect(changedRecords(table)).toEqual([edit.record]);
    });

    it('leaves an open editor alone on a settled re-render', async () => {
        const table = await makeScrollableTable();
        const body  = table.getBody() as any;
        const edit  = openEdit(table, TYPED);

        body.renderWindow();
        runFrames();

        expect(edit.cell.isEditing()).toBe(true);
        expect((edit.cell as any)._activeEditor.getValue()).toBe(TYPED);
        expect(changedRecords(table)).toEqual([]);
    });

    it('leaves an open editor alone on an unrelated store event', async () => {
        const table   = await makeScrollableTable();
        const records = table.getStore().getRecords();
        const edit    = openEdit(table, TYPED);

        records[RECORD_COUNT - 1].set('amount', 12345);
        runFrames();

        expect(edit.cell.isEditing()).toBe(true);
        expect(changedRecords(table)).toEqual([]);

        // The interrupted edit is still the user's to finish, and it still
        // lands on the record it was opened against.
        edit.cell.commitEdit();

        expect(edit.record.get('reference')).toBe(TYPED);
    });
});

// Column-axis columns: twelve columns at a pinned 150px each total 1800px
// against a 600px body. The width is pinned because a 'string' column otherwise
// flexes to share the body width however many columns there are, leaving no
// horizontal overflow — and without overflow the column window never moves and
// the column-axis case asserts nothing.
const WIDE_COLUMN_COUNT = 12;
const WIDE_COLUMN_WIDTH = 150;

// Only as many records as the pool can show — the column-axis case scrolls
// sideways, never down, so a deep store would only slow the fixture.
const WIDE_RECORD_COUNT = 50;

// Far past the widest this fixture can be; `clampToContent` pins it to the real
// maximum, which is all the case needs to push column 0 out of the window.
const SCROLL_PAST_LAST_COLUMN = 100_000;

const WIDE_FIELDS: FieldOptions[] = Array.from({ length: WIDE_COLUMN_COUNT }, (_, c) => ({
    name:  `col${c}`,
    type:  'string',
    order: c,
}));

const WIDE_MODEL = new Model(WIDE_FIELDS, 'col0');

/** A realized table whose columns overflow its body width. */
async function makeWideTable(): Promise<Table> {
    const store = new MemoryStore(WIDE_MODEL, Array.from({ length: WIDE_RECORD_COUNT }, (_, r) => (
        Object.fromEntries(WIDE_FIELDS.map((field, c) => [field.name, `r${r} c${c}`]))
    )));

    await store.load();

    return realize(new Table(store, {
        appendUnlisted: false,
        columns:        WIDE_FIELDS.map(field => ({ field: field.name!, width: WIDE_COLUMN_WIDTH })),
    }));
}

describe('Table — an editor open across a column-window change', () => {
    it('commits onto the record its row is bound to', async () => {
        const table  = await makeWideTable();
        const body   = table.getBody() as any;
        const row    = pooledRows(table)[0];
        const record = row.getData()!;
        const cell   = row.getComponents()[0] as Cell<any>;

        cell.startEdit();

        expect(cell.isEditing()).toBe(true);

        (cell as any)._activeEditor.setValue(TYPED);

        body.setScrollX(SCROLL_PAST_LAST_COLUMN);
        runFrames();

        // Without a moved column window the case would be vacuous.
        expect(body._colWindow.firstCol).toBeGreaterThan(0);

        expect(cell.isEditing()).toBe(false);
        expect(record.get('col0')).toBe(TYPED);
        expect(pooledRows(table)[0].getData()).toBe(record);
    });
});

// The tree fixture renders exactly two columns — the tree column and one plain
// editable column — so both stay inside the body width and the edited cell is
// always slot 1, whatever the measured column widths come out at.
const TREE_MODEL = new Model([
    { name: 'id',     type: 'number', order: 0 },
    { name: 'parent', type: 'number', order: 1 },
    { name: 'name',   type: 'string', order: 2 },
    { name: 'note',   type: 'string', order: 3 },
], 'id');

/** The `note` value tree record `index` is seeded with. */
function seededNote(index: number): string {
    return `note ${index + 1}`;
}

/** A realized tree table over one expanded root holding every other record. */
async function makeScrollableTreeTable(): Promise<TreeTable> {
    const store = new MemoryStore(TREE_MODEL, Array.from({ length: RECORD_COUNT }, (_, r) => ({
        id:     r + 1,
        parent: r === 0 ? null : 1,
        name:   `name ${r + 1}`,
        note:   seededNote(r),
    })));

    await store.load();

    const table = realize(new TreeTable(store, {
        idField:        'id',
        parentField:    'parent',
        treeColumn:     'name',
        appendUnlisted: false,
        columns:        [{ field: 'name' }, { field: 'note' }],
    }));

    table.setExpanded(table.getRecordById(1)!, true);
    runFrames();

    return table;
}

describe('TreeTable — an editor open across a row rebind', () => {
    it('commits the typed text onto the record the edit was opened against', async () => {
        const table  = await makeScrollableTreeTable();
        const body   = table.getBody() as any;
        const row    = pooledRows(table)[0];
        const record = row.getData()!;
        const cell   = row.getComponents()[1] as Cell<any>;

        cell.startEdit();

        expect(cell.isEditing()).toBe(true);

        (cell as any)._activeEditor.setValue(TYPED);

        body.setScrollY(body.getRowHeight() * SCROLL_ROWS);
        runFrames();

        const untouched = table.getStore().getRecords()
            .filter((other, index) => other !== record && other.get('note') !== seededNote(index));

        expect(cell.isEditing()).toBe(false);
        expect(record.get('note')).toBe(TYPED);
        expect(pooledRows(table)[0].getData()).not.toBe(record);
        expect(untouched).toEqual([]);
    });
});
