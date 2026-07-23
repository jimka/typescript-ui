//
// Offline coverage for DynamicCell — the per-cell (per-record) renderer/editor
// resolver. One DynamicCell instance lives for the life of its pool slot;
// only its active cached renderer and editor pool key vary per bound record.
// Focus / dblclick-driven edit opening needs a live, connected, focusable DOM
// the offline harness lacks (mirrors the gaps noted in CellEditorPool.test.ts
// and Combo.test.ts); those are documented manual-verify steps in the plan.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { DynamicCell } from '~/component/table/cell/Dynamic';
import { BooleanEditor } from '~/component/table/cell/editor/Boolean';
import { NumberRenderer } from '~/component/table/cell/renderer/Number';
import { ComboRenderer } from '~/component/table/cell/renderer/Combo';
import { ComboEditor } from '~/component/table/cell/editor/Combo';
import { Row } from '~/component/table/Row';
import { StringCell } from '~/component/table/cell/String';
import { ComboCell } from '~/component/table/cell/Combo';
import { Body } from '~/component/table/Body';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { CellType, ColumnConfig } from '~/component/table/ColumnConfig';
import type { Cell } from '~/component/table/cell/Cell';
import type { ModelRecord } from '~/data/ModelRecord';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// A stand-in cell — CellEditorPool.acquire only records it as the active-cell pointer.
const POOL_CELL = {} as Cell<any>;

/** Maps a row's cells to their backing field name via layout constraints. */
function cellsByField(row: Row): Map<string, Cell<any>> {
    const map = new Map<string, Cell<any>>();

    for (const cell of row.getComponents() as Cell<any>[]) {
        const field = (row as any).getLayoutConstraints(cell)?.data;

        map.set(field.getName(), cell);
    }

    return map;
}

describe('DynamicCell variant selection + editor keys', () => {
    // `value` is `auto` so a boolean/number/combo mix round-trips unchanged
    // (see the "Heterogeneous columns must use field type auto" plan note).
    const MODEL = new Model([
        { name: 'kind',  type: 'string', order: 0 },
        { name: 'value', type: 'auto',   order: 1 },
    ]);

    function recordFor(kind: string, value: any): ModelRecord {
        const store = new MemoryStore(MODEL, [{ kind, value }]);
        store.loadData([{ kind, value }]);

        return store.getRecords()[0];
    }

    const config: ColumnConfig = {
        field:    'value',
        cellType: (r) => r.get('kind') as CellType,
    };

    it('resolves a boolean row to a BooleanEditor renderer with a null editor key', () => {
        const cell = new DynamicCell('value', 'auto', config);

        cell.bindRecord(recordFor('boolean', true));

        expect(cell.getRenderer()).toBeInstanceOf(BooleanEditor);
        expect(cell.getEditorKey()).toBe(null);
    });

    it('resolves a number row to a NumberRenderer with the "number" editor key', () => {
        const cell = new DynamicCell('value', 'auto', config);

        cell.bindRecord(recordFor('number', 42));

        expect(cell.getRenderer()).toBeInstanceOf(NumberRenderer);
        expect(cell.getRenderer().getValue()).toBe(42);
        expect(cell.getEditorKey()).toBe('number');
    });

    it('resolves a combo row to a ComboRenderer with a field-namespaced combo editor key', () => {
        const cell = new DynamicCell('value', 'auto', config);

        cell.bindRecord(recordFor('combo', 'dev'));

        expect(cell.getRenderer()).toBeInstanceOf(ComboRenderer);
        expect(cell.getEditorKey()).toBe('combo:value');
    });

    it('cellType returning null falls back to the column field type', () => {
        const fallbackConfig: ColumnConfig = { field: 'value', cellType: () => null };
        const cell = new DynamicCell('value', 'number', fallbackConfig);

        cell.bindRecord(recordFor('anything', 7));

        expect(cell.getRenderer()).toBeInstanceOf(NumberRenderer);
        expect(cell.getEditorKey()).toBe('number');
    });
});

describe('DynamicCell slot reuse across rebinds', () => {
    const MODEL = new Model([
        { name: 'kind',  type: 'string', order: 0 },
        { name: 'value', type: 'auto',   order: 1 },
    ]);

    function recordFor(kind: string, value: any): ModelRecord {
        const store = new MemoryStore(MODEL, [{ kind, value }]);
        store.loadData([{ kind, value }]);

        return store.getRecords()[0];
    }

    const config: ColumnConfig = {
        field:    'value',
        cellType: (r) => r.get('kind') as CellType,
    };

    it('swaps the active renderer between records, showing the new value, and keeps the prior renderer cached', () => {
        const cell = new DynamicCell('value', 'auto', config);

        cell.bindRecord(recordFor('boolean', true));
        const booleanRenderer = cell.getRenderer();
        expect(booleanRenderer).toBeInstanceOf(BooleanEditor);

        cell.bindRecord(recordFor('number', 99));
        const numberRenderer = cell.getRenderer();

        expect(numberRenderer).toBeInstanceOf(NumberRenderer);
        expect(numberRenderer.getValue()).toBe(99);
        expect(numberRenderer).not.toBe(booleanRenderer);
        // The boolean renderer is retained as a hidden Card child, not removed.
        expect(cell.getComponents()).toContain(booleanRenderer);

        cell.bindRecord(recordFor('boolean', false));
        // Cached renderer reused, not rebuilt.
        expect(cell.getRenderer()).toBe(booleanRenderer);
    });

    it('re-fits the swapped-in renderer to the cell on a variant change without an external relayout', () => {
        const cell = new DynamicCell('value', 'auto', config);
        cell.getElement(true);
        cell.setWidth(120);
        cell.setHeight(20);

        // Initial bind + layout sizes the first variant, as Body's first
        // geometry pass does for a freshly bound pool slot.
        cell.bindRecord(recordFor('string', 'hello'));
        cell.doLayout();
        expect(cell.getRenderer().getHeight()).toBeGreaterThan(0);

        // Rebind to a different variant WITHOUT calling doLayout again — this
        // is the pure-scroll rebind Body performs, where it skips the cell's
        // own layout because the column geometry is unchanged. The swapped-in
        // renderer must still be sized (it vanished at zero height before).
        cell.bindRecord(recordFor('number', 42));

        const swapped = cell.getRenderer();

        expect(swapped).toBeInstanceOf(NumberRenderer);
        expect(swapped.getHeight()).toBeGreaterThan(0);
    });
});

describe('DynamicCell per-row combo options', () => {
    const MODEL = new Model([
        { name: 'kind',     type: 'string', order: 0 },
        { name: 'category', type: 'string', order: 1 },
        { name: 'value',    type: 'auto',   order: 2 },
    ]);

    function recordFor(category: string, value: any): ModelRecord {
        const data = { kind: 'combo', category, value };
        const store = new MemoryStore(MODEL, [data]);
        store.loadData([data]);

        return store.getRecords()[0];
    }

    const OWNER_OPTIONS = [{ value: 'alice', label: 'Alice' }, { value: 'bob', label: 'Bob' }];
    const TYPE_OPTIONS  = [{ value: 'str', label: 'String' }, { value: 'num', label: 'Number' }];

    const config: ColumnConfig = {
        field:      'value',
        cellType:   (r) => r.get('kind') as CellType,
        cellValues: (r) => r.get('category') === 'owner' ? OWNER_OPTIONS : TYPE_OPTIONS,
    };

    it('two combo rows in the same column render each row\'s own option labels', () => {
        const ownerCell = new DynamicCell('value', 'auto', config);
        ownerCell.bindRecord(recordFor('owner', 'alice'));

        const typeCell = new DynamicCell('value', 'auto', config);
        typeCell.bindRecord(recordFor('datatype', 'num'));

        expect((ownerCell.getRenderer() as any)._text.getText()).toBe('Alice');
        expect((typeCell.getRenderer() as any)._text.getText()).toBe('Number');
    });

    it('Body registers a single combo:<field> editor for a cellValues column, seeded empty', () => {
        const store = new MemoryStore(MODEL, []);
        const body  = new Body(store);

        body.setColumnConfigs(new Map<string, ColumnConfig>([['value', config]]));

        const pool = body.getEditorPool();
        const first  = pool.acquire('combo:value', POOL_CELL);
        const second = pool.acquire('combo:value', POOL_CELL);

        expect(first).toBeInstanceOf(ComboEditor);
        expect(first).toBe(second); // one shared editor, regardless of how many combo rows exist
    });
});

describe('DynamicCell commit write-back', () => {
    const MODEL = new Model([
        { name: 'kind',  type: 'string', order: 0 },
        { name: 'value', type: 'auto',   order: 1 },
    ]);

    function recordFor(kind: string, value: any): ModelRecord {
        const data = { kind, value };
        const store = new MemoryStore(MODEL, [data]);
        store.loadData([data]);

        return store.getRecords()[0];
    }

    const config: ColumnConfig = {
        field:    'value',
        cellType: (r) => r.get('kind') as CellType,
    };

    it('a boolean-active cell toggle commits the new boolean to the record', () => {
        const record = recordFor('boolean', false);
        const cell = new DynamicCell('value', 'auto', config);

        cell.bindRecord(record);
        cell.on('commit', (v) => record.set('value', v));

        cell.startEdit(); // toggles the checkbox, which fires change -> commit

        expect(record.get('value')).toBe(true);
        expect(typeof record.get('value')).toBe('boolean');
    });

    it('a number cell commit (via the commit emit) writes the number to the record', () => {
        // The actual editor-open/commit gesture needs a live, focusable DOM
        // (documented manual-verify step); this exercises the write path the
        // way `Cell.commitEdit` drives it: emit "commit" with the new value.
        const record = recordFor('number', 1);
        const cell = new DynamicCell('value', 'auto', config);

        cell.bindRecord(record);
        cell.on('commit', (v) => record.set('value', v));

        (cell as any).emit('commit', 42);

        expect(record.get('value')).toBe(42);
        expect(typeof record.get('value')).toBe('number');
    });
});

describe('DynamicCell read-only union', () => {
    const MODEL = new Model([
        { name: 'kind',  type: 'string', order: 0 },
        { name: 'value', type: 'auto',   order: 1 },
    ]);

    function recordFor(kind: string, value: any): ModelRecord {
        const data = { kind, value };
        const store = new MemoryStore(MODEL, [data]);
        store.loadData([data]);

        return store.getRecords()[0];
    }

    const config: ColumnConfig = {
        field:    'value',
        cellType: (r) => r.get('kind') as CellType,
    };

    it('marking a boolean-active cell read-only disables the checkbox and rejects toggles', () => {
        const record = recordFor('boolean', true);
        const cell = new DynamicCell('value', 'auto', config);

        cell.bindRecord(record);
        cell.setReadOnly(true);

        expect(cell.isReadOnly()).toBe(true);
        expect((cell as any)._checkbox.isReadOnly()).toBe(true);

        let commits = 0;
        cell.on('commit', () => commits++);
        cell.startEdit();

        expect(commits).toBe(0);
    });
});

describe('DynamicCell backward compatibility', () => {
    it('Row.createCellForField ignores cellType-less configs — existing routing is unchanged', () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
        ]);
        const configs = new Map<string, ColumnConfig>([
            ['b', { field: 'b', values: ['x', 'y'] }],
        ]);

        const cells = cellsByField(new Row(model, undefined, new Set(), configs));

        expect(cells.get('a')).toBeInstanceOf(StringCell);
        expect(cells.get('b')).toBeInstanceOf(ComboCell);
        expect(cells.get('a')).not.toBeInstanceOf(DynamicCell);
        expect(cells.get('b')).not.toBeInstanceOf(DynamicCell);
    });

    it('a `cellType` config routes the column to a DynamicCell', () => {
        const model = new Model([
            { name: 'kind',  type: 'string', order: 0 },
            { name: 'value', type: 'auto',   order: 1 },
        ]);
        const configs = new Map<string, ColumnConfig>([
            ['value', { field: 'value', cellType: (r) => r.get('kind') as CellType }],
        ]);

        const cells = cellsByField(new Row(model, undefined, new Set(), configs));

        expect(cells.get('value')).toBeInstanceOf(DynamicCell);
    });
});

describe('Row.syncCells rebuilds a cell when cellType is toggled on/off', () => {
    const model = new Model([
        { name: 'kind',  type: 'string', order: 0 },
        { name: 'value', type: 'auto',   order: 1 },
    ]);

    it('a surviving plain cell rebuilds into a DynamicCell once the config gains cellType, and back', () => {
        const plainConfigs = new Map<string, ColumnConfig>([['value', { field: 'value' }]]);
        const row = new Row(model, undefined, new Set(), plainConfigs);

        expect(cellsByField(row).get('value')).not.toBeInstanceOf(DynamicCell);

        const dynamicConfigs = new Map<string, ColumnConfig>([
            ['value', { field: 'value', cellType: (r) => r.get('kind') as CellType }],
        ]);
        row.syncCells(model, new Set(), dynamicConfigs);

        expect(cellsByField(row).get('value')).toBeInstanceOf(DynamicCell);

        row.syncCells(model, new Set(), plainConfigs);

        expect(cellsByField(row).get('value')).not.toBeInstanceOf(DynamicCell);
    });
});
