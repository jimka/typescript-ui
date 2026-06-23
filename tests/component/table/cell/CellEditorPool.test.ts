// @vitest-environment jsdom
//
// Factory-key mapping coverage for CellEditorPool. `acquire` lazily constructs
// editors (which build input components through DOM.sink) and wires blur/keydown
// listeners, so the offline harness is installed. Only the construction-and-
// mapping surface is covered here; the focus/blur DOM lifecycle is a Non-Goal
// (needs a live, connected, focusable element the offline harness lacks). The
// `cell` arg to acquire is a structural stub — acquire only stores it as the
// active-cell pointer and does not touch it during construction.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

// A stand-in cell — acquire only records it as the active-cell pointer.
const CELL = {} as Cell<any>;

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
    class MarkerEditor extends CellEditor<string | null> {
        getValue(): string | null {
            return null;
        }

        setValue(_value: string | null): void {
            // no-op marker
        }
    }

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
});
