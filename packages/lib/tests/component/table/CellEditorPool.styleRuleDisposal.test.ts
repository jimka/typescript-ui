// Regression: `Body._editorPool` (a `CellEditorPool`) lazily builds one shared
// editor per variant the first time any cell of that type is edited, and
// holds it in a private `Map` for the table's entire lifetime. `Body`
// inherits `VirtualRowView.destructor()`, which disposes the row pool and the
// scroller — but never touched `_editorPool`. `Cell.detachEditor()` only
// `removeComponent`s a borrowed editor when an edit ends (so the pool can
// lend it to the next cell) — it never disposes it, because the editor must
// survive to be reused. Nothing else ever reached it once it was no longer
// any cell's registered child.
//
// `DateEditor`, `TimeEditor`, and `DateTimeEditor` each lazily build their
// own picker overlay (a `LayerManager`-mounted `AnimatedDropdown` subclass)
// the first time the editor receives focus, and hold it in a private
// `_dropdown` field. None of the three declared a `destructor()` override, so
// the dropdown was never disposed even when the editor itself was.
//
// This is the same defect class `plans/implemented/table-tab-close-residual-leak.md`
// fixed for `Menu`'s six owners and
// `plans/implemented/table-toolbar-button-residual-leak.md` fixed for
// `TabButton`'s close affordance — one layer deeper, inside the cell-editor
// subsystem. See plans/implemented/table-cell-rerender-leak-investigation.md.
//
// Mirrors tests/overlay/Menu.styleRuleDisposal.test.ts's shape.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { DateEditor } from '~/component/table/cell/editor/Date';
import { TimeEditor } from '~/component/table/cell/editor/Time';
import { DateTimeEditor } from '~/component/table/cell/editor/DateTime';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

type PoolCell = { startEdit(): void; cancelEdit(): void };
type PoolRow  = { getComponents(): PoolCell[] };
type PoolBody = { getRowPool(): PoolRow[] };

/** Builds a one-row, one-column `string` table, rendered and ready to edit. */
async function stringTable(): Promise<Table> {
    const model = new Model([{ name: 'a', type: 'string', order: 0 }], 'a');
    const store = new MemoryStore(model, [{ a: 'x' }]);

    await store.load();

    const table = new Table(store);

    table.getElement(true);
    table.setWidth(400);
    table.setHeight(200);
    table.doLayout();

    return table;
}

/** Builds a one-row, one-column `date` table, rendered and ready to edit. */
async function dateTable(): Promise<Table> {
    const model = new Model([{ name: 'a', type: 'date', order: 0 }], 'a');
    const store = new MemoryStore(model, [{ a: new Date('2024-01-01') }]);

    await store.load();

    const table = new Table(store);

    table.getElement(true);
    table.setWidth(400);
    table.setHeight(200);
    table.doLayout();

    return table;
}

/** The first body-pool row's first cell of `table`. */
function firstCell(table: Table): PoolCell {
    const body = (table as unknown as { _body: PoolBody })._body;
    const pool = body.getRowPool();

    expect(pool.length).toBeGreaterThan(0);

    return pool[0].getComponents()[0];
}

describe('CellEditorPool — style-rule disposal', () => {
    it('a Body whose pool acquired an editor leaves no trace after the Table disposes', async () => {
        installTestDOM(CONFIG);

        // Warm-up pass, mirroring the registry harness: keeps any
        // process-global rule these classes materialise on first use out of
        // the diff below.
        {
            const table = await stringTable();
            const cell = firstCell(table);

            cell.startEdit();
            cell.cancelEdit();

            table.dispose();
        }

        const before = new Set(_ruleCacheKeys());

        const table = await stringTable();
        const cell = firstCell(table);

        cell.startEdit();
        cell.cancelEdit();

        table.dispose();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('DateEditor whose dropdown was opened leaves no trace after destructor() runs', () => {
        installTestDOM(CONFIG);

        {
            const editor = new DateEditor();

            editor.getElement(true);
            (editor as unknown as { openDropdown(): void }).openDropdown();
            (editor as unknown as { destructor(): void }).destructor();
        }

        const before = new Set(_ruleCacheKeys());

        const editor = new DateEditor();

        editor.getElement(true);
        (editor as unknown as { openDropdown(): void }).openDropdown();

        (editor as unknown as { destructor(): void }).destructor();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('TimeEditor whose dropdown was opened leaves no trace after destructor() runs', () => {
        installTestDOM(CONFIG);

        {
            const editor = new TimeEditor();

            editor.getElement(true);
            (editor as unknown as { openDropdown(): void }).openDropdown();
            (editor as unknown as { destructor(): void }).destructor();
        }

        const before = new Set(_ruleCacheKeys());

        const editor = new TimeEditor();

        editor.getElement(true);
        (editor as unknown as { openDropdown(): void }).openDropdown();

        (editor as unknown as { destructor(): void }).destructor();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('DateTimeEditor whose dropdown was opened leaves no trace after destructor() runs', () => {
        installTestDOM(CONFIG);

        {
            const editor = new DateTimeEditor();

            editor.getElement(true);
            (editor as unknown as { openDropdown(): void }).openDropdown();
            (editor as unknown as { destructor(): void }).destructor();
        }

        const before = new Set(_ruleCacheKeys());

        const editor = new DateTimeEditor();

        editor.getElement(true);
        (editor as unknown as { openDropdown(): void }).openDropdown();

        (editor as unknown as { destructor(): void }).destructor();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('end-to-end: a real Table with a date column, edited once and cancelled, disposes leak-free', async () => {
        installTestDOM(CONFIG);

        {
            const table = await dateTable();
            const cell = firstCell(table);

            cell.startEdit();
            cell.cancelEdit();

            table.dispose();
        }

        const before = new Set(_ruleCacheKeys());

        const table = await dateTable();
        const cell = firstCell(table);

        cell.startEdit();
        cell.cancelEdit();

        table.dispose();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('a pool that never acquired any editor disposes as a no-op', async () => {
        installTestDOM(CONFIG);

        {
            const table = await stringTable();

            table.dispose();
        }

        const before = new Set(_ruleCacheKeys());

        const table = await stringTable();

        table.dispose();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('a cell mid-edit when the whole table disposes leaves nothing behind and does not throw', async () => {
        installTestDOM(CONFIG);

        {
            const table = await stringTable();
            const cell = firstCell(table);

            cell.startEdit();

            table.dispose();
        }

        const before = new Set(_ruleCacheKeys());

        const table = await stringTable();
        const cell = firstCell(table);

        cell.startEdit();

        expect(() => table.dispose()).not.toThrow();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });
});
