//
// Factory-key mapping coverage for CellEditorPool. `acquire` lazily constructs
// editors (which build input components through DOM.sink) and wires blur/keydown
// listeners, so the offline harness is installed. Only the construction-and-
// mapping surface is covered here; the focus/blur DOM lifecycle is a Non-Goal
// (needs a live, connected, focusable element the offline harness lacks). The
// `cell` arg to acquire is a structural stub — the only thing the pool asks of
// a cell is a `commitEdit`, which it calls on whichever cell currently holds
// the shared editor before handing that editor to another cell or dropping it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { CellEditorPool } from '~/component/table/cell/editor/CellEditorPool';
import { CellEditor } from '~/component/table/cell/editor/CellEditor';
import { StringEditor } from '~/component/table/cell/editor/String';
import { NumberEditor } from '~/component/table/cell/editor/Number';
import { DateEditor } from '~/component/table/cell/editor/Date';
import { TimeEditor } from '~/component/table/cell/editor/Time';
import { DateTimeEditor } from '~/component/table/cell/editor/DateTime';
import { ComboEditor } from '~/component/table/cell/editor/Combo';
import type { Cell } from '~/component/table/cell/Cell';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// A stand-in cell. `acquire` and `register` commit whichever cell holds the
// editor, so the shared stub has to answer a `commitEdit`; the ownership tests
// below bring their own counting stubs.
const CELL = { commitEdit() { return this; } } as unknown as Cell<any>;

/** A stand-in cell whose `commitEdit` records every call. */
function countingCell(): Cell<any> {
    return { commitEdit: vi.fn() } as unknown as Cell<any>;
}

/** The cell the pool currently holds the shared editor for. */
function activeCell(pool: CellEditorPool): Cell<any> | null {
    return (pool as any)._activeCell as Cell<any> | null;
}

/** A distinguishable editor a test can register over a built-in key. */
class MarkerEditor extends CellEditor<string | null> {
    getValue(): string | null {
        return null;
    }

    setValue(_value: string | null): void {
        // no-op marker
    }
}

describe('CellEditorPool built-in factory keys', () => {
    it('maps each built-in key to the correct editor class', () => {
        const pool = new CellEditorPool();

        expect(pool.acquire('string', CELL)).toBeInstanceOf(StringEditor);
        expect(pool.acquire('number', CELL)).toBeInstanceOf(NumberEditor);
        expect(pool.acquire('date',   CELL)).toBeInstanceOf(DateEditor);
        expect(pool.acquire('time',            CELL)).toBeInstanceOf(TimeEditor);
        expect(pool.acquire('time:seconds',    CELL)).toBeInstanceOf(TimeEditor);
        expect(pool.acquire('datetime',         CELL)).toBeInstanceOf(DateTimeEditor);
        expect(pool.acquire('datetime:seconds', CELL)).toBeInstanceOf(DateTimeEditor);
    });

    it('returns null for an unknown key', () => {
        expect(new CellEditorPool().acquire('mystery', CELL)).toBe(null);
    });

    it('returns the SAME instance when a key is acquired twice (pool collapses to one)', () => {
        const pool = new CellEditorPool();

        const first  = pool.acquire('string', CELL);
        const second = pool.acquire('string', CELL);

        expect(first).toBe(second);
    });
});

describe('CellEditorPool.register override', () => {
    it('register overrides a key and drops any cached editor so the new factory runs', () => {
        const pool = new CellEditorPool();

        const original = pool.acquire('string', CELL);
        expect(original).toBeInstanceOf(StringEditor);

        pool.register('string', () => new MarkerEditor());

        const replaced = pool.acquire('string', CELL);
        expect(replaced).toBeInstanceOf(MarkerEditor);
        expect(replaced).not.toBe(original);
    });

    it('register adds a brand-new key', () => {
        const pool = new CellEditorPool();

        pool.register('custom', () => new MarkerEditor());

        expect(pool.acquire('custom', CELL)).toBeInstanceOf(MarkerEditor);
    });

    it('registers and acquires a namespaced `combo:<field>` key, as ComboCell/DynamicCell do', () => {
        const pool = new CellEditorPool();

        pool.register('combo:owner', () => new ComboEditor([{ value: 'a', label: 'A' }]));

        const first  = pool.acquire('combo:owner', CELL);
        const second = pool.acquire('combo:owner', CELL);

        expect(first).toBeInstanceOf(ComboEditor);
        expect(first).toBe(second);
    });
});

// One cell owns the shared editor at a time, and the pool commits that cell's
// open edit before anything takes the editor away from it — another cell
// acquiring it, or a factory re-registered over it. Both doors were unguarded:
// the editor moved on while the cell still believed it was editing, and
// `register` additionally dropped a cached editor without disposing it.
describe('CellEditorPool editor ownership', () => {
    it('ignores a release from a cell that no longer owns the editor', () => {
        const pool = new CellEditorPool();
        const a    = countingCell();
        const b    = countingCell();

        pool.acquire('string', a);
        pool.acquire('string', b);
        pool.release(a);

        expect(activeCell(pool)).toBe(b);
    });

    it('clears the pointer when the owning cell releases', () => {
        const pool = new CellEditorPool();
        const a    = countingCell();

        pool.acquire('string', a);
        pool.release(a);

        expect(activeCell(pool)).toBe(null);
    });

    it('commits the previous cell when a second cell acquires the editor', () => {
        const pool = new CellEditorPool();
        const a    = countingCell();
        const b    = countingCell();

        pool.acquire('string', a);
        pool.acquire('string', b);

        expect(a.commitEdit).toHaveBeenCalledTimes(1);
        expect(b.commitEdit).not.toHaveBeenCalled();
        expect(activeCell(pool)).toBe(b);
    });

    it('commits nothing when the same cell re-acquires the editor it holds', () => {
        const pool = new CellEditorPool();
        const a    = countingCell();

        pool.acquire('string', a);
        pool.acquire('string', a);

        expect(a.commitEdit).not.toHaveBeenCalled();
        expect(activeCell(pool)).toBe(a);
    });

    it('disposes the dropped editor exactly once and commits the active cell on re-register', () => {
        const pool = new CellEditorPool();
        const a    = countingCell();

        const dropped = pool.acquire('string', a)!;

        // Realise the element so disposal has the per-instance rules and DOM
        // node a live editor would leave behind.
        dropped.getElement(true);

        const disposed = vi.spyOn(dropped, 'dispose');

        pool.register('string', () => new MarkerEditor());

        expect(disposed).toHaveBeenCalledTimes(1);
        expect(a.commitEdit).toHaveBeenCalledTimes(1);
        expect(activeCell(pool)).toBe(null);
        expect(pool.acquire('string', a)).not.toBe(dropped);
    });

    it('commits and disposes nothing when registering a key with no cached editor', () => {
        const pool = new CellEditorPool();
        const a    = countingCell();

        const cached = pool.acquire('string', a)!;

        const disposed = vi.spyOn(cached, 'dispose');

        pool.register('combo:owner', () => new MarkerEditor());

        expect(disposed).not.toHaveBeenCalled();
        expect(a.commitEdit).not.toHaveBeenCalled();
        expect(activeCell(pool)).toBe(a);
    });
});
