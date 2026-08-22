//
// Offline coverage for plans/row-cell-cache.md's `## Expected Behaviour` —
// `Row` keeps a displaced cell that has no entering column to move to in a
// private, per-instance cache instead of disposing it, and consults that
// cache before building a fresh cell. Cases are numbered to match the
// plan's list.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Row } from '~/component/table/Row';
import { Table } from '~/component/table/Table';
import { Cell } from '~/component/table/cell/Cell';
import { NumberCell } from '~/component/table/cell/Number';
import { CellEditorPool } from '~/component/table/cell/editor/CellEditorPool';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// Six columns, declared order 0-5: c0-c2 `string` (one shared key), c3-c5
// `number` (another shared key) — so a narrow that keeps only the strings
// (or only the numbers) has a same-key group to file in the cache and a
// different-key group that must not be handed back to it.
const MODEL = new Model([
    { name: 'c0', type: 'string', order: 0 },
    { name: 'c1', type: 'string', order: 1 },
    { name: 'c2', type: 'string', order: 2 },
    { name: 'c3', type: 'number', order: 3 },
    { name: 'c4', type: 'number', order: 4 },
    { name: 'c5', type: 'number', order: 5 },
]);

/** A one-row store, bound to a `Row` so a mid-edit commit lands somewhere real. */
function recordFor() {
    const data = { c0: 'a', c1: 'b', c2: 'c', c3: 1, c4: 2, c5: 3 };
    const store = new MemoryStore(MODEL, [data]);

    store.loadData([data]);

    return store.getRecords()[0];
}

/** Sums the cache's per-key arrays — the count of cells the cache holds. */
function cacheSize(row: Row): number {
    const cache = (row as any)._cellCache as Map<string, unknown[]>;

    return [...cache.values()].reduce((sum, pool) => sum + pool.length, 0);
}

describe('Row cell cache', () => {
    it('1. a narrow-then-widen cycle returns the same cell instances', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        const original = [...row.getComponents()];

        row.setColumnWindow(0, 1);
        row.setColumnWindow(0, 5);
        const restored = row.getComponents();

        expect(restored.length).toBe(6);
        for (const cell of original) {
            expect(restored).toContain(cell);
        }
        for (const cell of restored) {
            expect(original).toContain(cell);
        }
    });

    it('2. retired cells leave the rendered set', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        row.setColumnWindow(0, 1);

        expect(row.getComponents().length).toBe(2);
        expect(row.getFieldNames().length).toBe(2);
    });

    it('3. the cache respects keys — a widen onto number columns never receives cached string cells', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        const numberCells = row.getComponents().slice(3, 6);

        row.setColumnWindow(0, 2); // only the string columns render; the three number cells go to the cache
        row.setColumnWindow(3, 5);

        const rendered = row.getComponents();

        expect(rendered.length).toBe(3);
        for (const cell of rendered) {
            expect(numberCells).toContain(cell);
            expect(cell).toBeInstanceOf(NumberCell);
        }
    });

    it('4. total live cells (rendered + cached) never exceeds the field count', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());
        const totalLive = () => row.getComponents().length + cacheSize(row);

        row.setColumnWindow(0, 5);
        expect(totalLive()).toBe(6);

        row.setColumnWindow(0, 1);
        expect(totalLive()).toBe(6);

        row.setColumnWindow(0, 5);
        expect(totalLive()).toBe(6);

        row.setColumnWindow(0, 0);
        expect(totalLive()).toBe(6);

        row.setColumnWindow(0, 5);
        expect(totalLive()).toBe(6);
    });

    it('5. a cell restored from the cache is marked layout-dirty', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.getElement(true);
        row.setColumnWindow(0, 5);

        const cells = row.getComponents() as Cell<any>[];
        for (const cell of cells) {
            cell.applyBounds(0, 0, 100, 20);
            expect(cell.isLayoutDirty()).toBe(false);
        }

        // Columns 2-5 are the ones a narrow to [0,1] displaces into the cache;
        // these are the instances the subsequent widen must restore dirty.
        const displaced = cells.slice(2);

        row.setColumnWindow(0, 1);
        row.setColumnWindow(0, 5);

        for (const cell of displaced) {
            expect(cell.isLayoutDirty()).toBe(true);
        }
    });

    it('6. the unchanged-window early return still holds after a narrow/widen', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        row.setColumnWindow(0, 1);

        expect(row.setColumnWindow(0, 5)).toBe(true);
        expect(row.setColumnWindow(0, 5)).toBe(false);
    });

    it('7. a cell mid-edit is committed before it is retired into the cache', () => {
        const record = recordFor();
        const row = new Row(MODEL, record, new Set(), new Map());

        row.setColumnWindow(0, 5);

        const cell = row.getComponents()[5] as Cell<any>; // c5, a number column

        cell.setEditorPool(new CellEditorPool());
        cell.startEdit();
        (cell as any)._activeEditor.setValue(42);

        row.setColumnWindow(0, 1); // c5 leaves the window mid-edit

        expect(record.get('c5')).toBe(42);

        const cache = (row as any)._cellCache as Map<string, Cell<any>[]>;
        for (const pool of cache.values()) {
            for (const cached of pool) {
                expect(cached.isEditing()).toBe(false);
            }
        }
    });

    it('8. setColumnFields empties the cache and disposes what it held', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        row.setColumnWindow(0, 1);

        const cache = (row as any)._cellCache as Map<string, Cell<any>[]>;
        const cachedCells = [...cache.values()].flat();

        expect(cachedCells.length).toBeGreaterThan(0);

        row.setColumnFields(MODEL, new Set(), new Map());

        expect(cacheSize(row)).toBe(0);
        // Proves the cells were dispose()d, not just dropped from the map:
        // Component.destructor recursively empties a component's own
        // getComponents(), which a bare map.clear() would leave untouched.
        for (const cell of cachedCells) {
            expect(cell.getComponents().length).toBe(0);
        }
    });

    it('9. a separator flip round-trips the row\'s cells through the cache', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        const original = [...row.getComponents()];

        row.renderSeparator('g', null);

        expect(row.getComponents().length).toBe(1);
        expect(cacheSize(row)).toBe(6);

        row.setColumnWindow(0, 5);
        const restored = row.getComponents();

        expect(restored.length).toBe(6);
        for (const cell of original) {
            expect(restored).toContain(cell);
        }
    });

    it('10. renderSeparator disposes a slot with no key', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.renderSeparator('g', null); // never windowed — nothing to retire
        expect(cacheSize(row)).toBe(0);

        const firstSeparator = row.getComponents()[0];

        row.renderSeparator('g', null); // retires the previous GroupSeparatorCell — no key, disposed
        expect(cacheSize(row)).toBe(0);
        // Proves dispose(), not a bare removeComponent: Component.destructor
        // recursively empties the cell's own getComponents() (its renderer).
        expect(firstSeparator.getComponents().length).toBe(0);
    });

    it('11. a table torn down after narrowing leaves no stylesheet rules behind', async () => {
        // A 12-column model, not the file's shared 6-column MODEL: the fixed
        // column-window width floors at 2 + 2*COLUMN_BUFFER = 6 columns, so a
        // narrow of a 6-column table no longer displaces anything into the
        // cache — this case needs a column count past that floor for the
        // narrow below to still exercise cached-cell disposal.
        const WIDE_MODEL = new Model(
            Array.from({ length: 12 }, (_, i) => ({
                name: `c${i}`, type: (i % 2 === 0 ? 'string' : 'number') as 'string' | 'number', order: i,
            })),
        );

        async function narrowedTable(): Promise<Table> {
            const data: Record<string, string | number> = {};

            for (let i = 0; i < 12; i++) {
                data[`c${i}`] = i % 2 === 0 ? `v${i}` : i;
            }

            const store = new MemoryStore(WIDE_MODEL, [data]);

            await store.load();

            const table = new Table(store);

            table.getElement(true);
            table.setWidth(1200);
            table.setHeight(200);
            table.doLayout();

            // Drive the column window directly through Body.setWidth +
            // Body.renderWindow rather than Table.doLayout's own width
            // derivation, which doesn't shrink the rendered column count for
            // this fixture — mirrors Body.test.ts's `wideBody` helper and
            // HeaderColumnWindow.test.ts's direct `renderColumnWindow` calls.
            // computeColumnWindow (called from renderWindowPass) reads the
            // body's own committed width via `getWidth()`, not the
            // `bodyWidth` argument, so `setWidth` has to run first.
            // Render the full 12-column window, then narrow to a 10px
            // viewport so half the cells are displaced into the row's cache.
            const body = table.getBody();

            body.setWidth(1200);
            body.renderWindow(1200, Array(12).fill(100));

            body.setWidth(10);
            body.renderWindow(10, Array(12).fill(100));

            return table;
        }

        // Warm-up pass, keeping any process-global rule these classes
        // materialise on first use out of the diff below.
        {
            const table = await narrowedTable();

            table.dispose();
        }

        const before = new Set(_ruleCacheKeys());

        const table = await narrowedTable();

        table.dispose();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('12. a row disposed twice does not throw', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        row.setColumnWindow(0, 1); // cache non-empty

        expect(() => { row.dispose(); row.dispose(); }).not.toThrow();
    });

    // Not one of the plan's numbered cases — pins the bounded, documented
    // gap in the `^bound` invariant recorded in `## Implementation Notes`
    // ("The `^bound` invariant is looser than stated across a
    // `setColumnFields` call"). `Body.syncPoolCells` calls
    // `row.setColumnFields` (clearing the cache) immediately followed by
    // `row.setColumnWindow` against the *new* field list, so a column
    // hidden by that same call is retired into the cache by the ordinary
    // "this column left the window" path — indistinguishable, from
    // `setColumnWindow`'s side, from a narrow. The surplus is transient: a
    // *further* `setColumnFields` call clears it, per case 8.
    it('a column hidden by setColumnFields is cached, not dropped, until the next field-set change', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5); // 3 string + 3 number cells, all attached

        row.setColumnFields(MODEL, new Set(['c3', 'c4', 'c5']), new Map());
        row.setColumnWindow(0, 2); // only the 3 string fields are visible now

        // 3 attached (visible) + 3 cached (the hidden number cells) exceeds
        // the 3 currently-visible fields — the documented, bounded gap.
        expect(row.getComponents().length).toBe(3);
        expect(cacheSize(row)).toBe(3);

        // Bounded: the very next field-set change clears the surplus (case 8's
        // contract), so it never survives more than one setColumnFields call.
        row.setColumnFields(MODEL, new Set(), new Map());
        expect(cacheSize(row)).toBe(0);
    });
});
