//
// Offline coverage for plans/table-column-window-rotation.md's `## Expected
// Behaviour` — Row.setColumnWindow's fast path for an ordinary same-width
// horizontal slide: it retires the departing edge into the cell cache,
// resolves the entering edge, and leaves every surviving cell untouched.
// Cases are numbered to match the plan's list. Case 7 and the Body-level
// cases 11-16 live in Body.test.ts instead, since they exercise state
// (read-only/required tinting) that only `Body` applies.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Row } from '~/component/table/Row';
import type { ColumnWindowSlidePlan } from '~/component/table/Row';
import { Cell } from '~/component/table/cell/Cell';
import { NumberCell } from '~/component/table/cell/Number';
import { CellEditorPool } from '~/component/table/cell/editor/CellEditorPool';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/**
 * `n` columns `c0..c(n-1)`, string type by default with per-index overrides
 * — mirrors `Body.test.ts`'s `wideModel`. `withOrder: false` omits the
 * `order` field entirely, so every field ties on `Field.getOrder()`'s -1
 * sentinel (case 4).
 */
function wideModel(n: number, types: Record<number, string> = {}, withOrder: boolean = true): Model {
    const fields = [];

    for (let i = 0; i < n; i++) {
        const field: Record<string, unknown> = { name: `c${i}`, type: types[i] ?? 'string' };

        if (withOrder) {
            field.order = i;
        }

        fields.push(field);
    }

    return new Model(fields as any, 'c0');
}

describe('Row column-window fast path — slide reconciliation', () => {
    it('1. a one-column right slide with a same-key entering column reuses the departing cell', () => {
        const model = wideModel(7); // c0..c6, all string
        const row = new Row(model, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        const departing = row.getComponents()[0];

        const plan: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 5, delta: 1,
            enteringKeys: new Map([[6, 'string']]),
        };
        row.setColumnWindow(1, 6, plan);

        expect(row.getComponents()[row.getComponents().length - 1]).toBe(departing);
    });

    it('2. a different-key entering column builds fresh and caches the departing one', () => {
        const model = wideModel(7, { 6: 'number' });
        const row = new Row(model, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        const departing = row.getComponents()[0];

        const plan: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 5, delta: 1,
            enteringKeys: new Map([[6, 'number']]),
        };
        row.setColumnWindow(1, 6, plan);

        const entering = row.getComponents()[row.getComponents().length - 1];
        expect(entering).toBeInstanceOf(NumberCell);
        expect(row.getComponents()).not.toContain(departing);
        expect((row as any)._cellCache.get('string')).toContain(departing);
    });

    it('3. a multi-column slide retires and resolves exactly |delta| cells, not width many', () => {
        const model = wideModel(13); // c0..c12, all string
        const row = new Row(model, undefined, new Set(), new Map());

        row.setColumnWindow(0, 9); // width 10, window [0,9]
        const before     = [...row.getComponents()] as Cell<any>[];
        const departing  = before.slice(0, 3);  // slots 0-2 -> columns 0-2
        const survivors  = before.slice(3);     // slots 3-9 -> columns 3-9 (7 cells)
        const colIndexSpies = survivors.map(cell => vi.spyOn(cell.getAria(), 'setColIndex'));

        const plan: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 9, delta: 3,
            enteringKeys: new Map([[10, 'string'], [11, 'string'], [12, 'string']]),
        };
        row.setColumnWindow(3, 12, plan);

        const after = row.getComponents() as Cell<any>[];

        for (let i = 0; i < survivors.length; i++) {
            expect(after[i]).toBe(survivors[i]);
        }

        for (const spy of colIndexSpies) {
            expect(spy).not.toHaveBeenCalled();
        }

        // The 3 trailing slots are exactly the 3 departing cells, reused —
        // not freshly constructed — since every column shares the 'string' key.
        expect(after.length).toBe(10);
        expect(after.slice(7)).toEqual(expect.arrayContaining(departing));
    });

    it('4. getFieldNames()/getComponents() stay index-aligned after a fast-path slide, including tied field order', () => {
        const model = wideModel(9, {}, false); // c0..c8, no `order` declared — every field ties
        const row = new Row(model, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);

        const plan: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 5, delta: 1,
            enteringKeys: new Map([[6, 'string']]),
        };
        row.setColumnWindow(1, 6, plan);

        expect(row.getFieldNames().length).toBe(row.getComponents().length);
        row.getFieldNames().forEach((name, s) => {
            const field = row.getLayoutConstraints(row.getComponents()[s])?.data as { getName(): string };

            expect(field.getName()).toBe(name);
        });
    });

    it('5. _treeCell becomes null when the tree column departs, and resolves when it enters, via the fast path', () => {
        const model = wideModel(7); // c0..c6, all string
        const plan: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 5, delta: 1,
            enteringKeys: new Map([[6, 'string']]),
        };

        // Departing edge: tree column c0 leaves the window.
        const rowA = new Row(model, undefined, new Set(), new Map(), undefined, 'c0');

        rowA.setColumnWindow(0, 5);
        expect(rowA.getTreeCell()).not.toBeNull();

        rowA.setColumnWindow(1, 6, plan);
        expect(rowA.getTreeCell()).toBeNull();

        // Entering edge: tree column c6 enters the window, freshly built
        // (never rendered before, so there is nothing to restore).
        const rowB = new Row(model, undefined, new Set(), new Map(), undefined, 'c6');

        rowB.setColumnWindow(0, 5);
        expect(rowB.getTreeCell()).toBeNull();

        const planB: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 5, delta: 1,
            enteringKeys: new Map([[6, 'tree:c6']]),
        };
        rowB.setColumnWindow(1, 6, planB);

        expect(rowB.getTreeCell()).not.toBeNull();
        expect(rowB.getTreeCell()).toBe(rowB.getComponents()[rowB.getComponents().length - 1]);
    });

    it('6. a cell restored during a fast-path slide is marked layout-dirty', () => {
        const model = wideModel(7);
        const row = new Row(model, undefined, new Set(), new Map());

        row.getElement(true);
        row.setColumnWindow(0, 5);

        for (const cell of row.getComponents() as Cell<any>[]) {
            cell.applyBounds(0, 0, 100, 20);
            expect(cell.isLayoutDirty()).toBe(false);
        }

        const plan: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 5, delta: 1,
            enteringKeys: new Map([[6, 'string']]),
        };
        row.setColumnWindow(1, 6, plan);

        const restored = row.getComponents()[row.getComponents().length - 1] as Cell<any>;

        expect(restored.isLayoutDirty()).toBe(true);
    });

    it('8. a cell mid-edit on the departing edge commits before being retired, via the fast path', () => {
        const model = wideModel(7);
        const data: Record<string, string> = {};

        for (let i = 0; i < 7; i++) {
            data[`c${i}`] = `v${i}`;
        }

        const store = new MemoryStore(model, [data]);

        store.loadData([data]);
        const record = store.getRecords()[0];

        const row = new Row(model, record, new Set(), new Map());

        row.setColumnWindow(0, 5);

        const cell = row.getComponents()[0] as Cell<any>; // c0, about to depart

        cell.setEditorPool(new CellEditorPool());
        cell.startEdit();
        (cell as any)._activeEditor.setValue('edited');

        const plan: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 5, delta: 1,
            enteringKeys: new Map([[6, 'string']]),
        };
        row.setColumnWindow(1, 6, plan);

        expect(record.get('c0')).toBe('edited');
        expect(cell.isEditing()).toBe(false);
    });

    it('9. eligibility rejects a plan whose previous window does not match the row\'s own, falling back to full reconciliation', () => {
        const model = wideModel(8); // c0..c7
        const row = new Row(model, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5); // row's own window is [0,5]

        const spy = vi.spyOn(Row.prototype as any, 'cellKeyFor');

        // Plan claims the previous window was [1,6] — does not match row's [0,5].
        const badPlan: ColumnWindowSlidePlan = {
            prevFirstCol: 1, prevLastCol: 6, delta: 1,
            enteringKeys: new Map([[7, 'string']]),
        };
        row.setColumnWindow(1, 6, badPlan);

        // The full path calls cellKeyFor at least once per rendered column (width 6).
        expect(spy.mock.calls.length).toBeGreaterThanOrEqual(6);
    });

    it('10. _columnsDirty disqualifies the fast path even when the window otherwise looks like a slide', () => {
        const model = wideModel(7);
        const row = new Row(model, undefined, new Set(), new Map());

        row.setColumnWindow(0, 5);
        row.setColumnFields(model, new Set(), new Map()); // sets _columnsDirty

        const spy = vi.spyOn(Row.prototype as any, 'cellKeyFor');

        const plan: ColumnWindowSlidePlan = {
            prevFirstCol: 0, prevLastCol: 5, delta: 1,
            enteringKeys: new Map([[6, 'string']]),
        };
        row.setColumnWindow(1, 6, plan);

        expect(spy.mock.calls.length).toBeGreaterThanOrEqual(6);
    });
});
