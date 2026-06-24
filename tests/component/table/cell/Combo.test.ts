//
// Offline coverage for the constrained-choice (combo) table cell: option
// normalisation, the renderer's value->label mapping + key round-trip, the
// editor's value round-trip, the cell's per-column editor key + renderer
// delegation, and the Body-level pool registration that wires `combo:<field>`
// to a per-column ComboEditor. All three classes build real input components
// through DOM.sink, so the offline harness is installed.
//
// Non-Goal (matches CellEditorPool.test): the focus / dropdown-overlay /
// commit lifecycle needs a live, connected, focusable surface the offline
// harness lacks; those behaviours are documented manual-verify steps in the
// plan, not asserted here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { normalizeComboOptions } from '~/component/table/ColumnConfig';
import { ComboRenderer } from '~/component/table/cell/renderer/Combo';
import { ComboEditor } from '~/component/table/cell/editor/Combo';
import { ComboCell } from '~/component/table/cell/Combo';
import { Body } from '~/component/table/Body';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnConfig } from '~/component/table/ColumnConfig';
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

const COUNTRIES = [{ value: 'AU', label: 'Australia' }, { value: 'SE', label: 'Sweden' }];

/** Reads the rendered label off a renderer's `_text` child. */
function renderedText(renderer: unknown): string {
    return (renderer as any)._text.getText();
}

describe('normalizeComboOptions', () => {
    it('expands a plain string to value === label', () => {
        expect(normalizeComboOptions(['Low', 'High'])).toEqual([
            { value: 'Low',  label: 'Low'  },
            { value: 'High', label: 'High' },
        ]);
    });

    it('keeps an explicit label and defaults a missing one to the value', () => {
        expect(normalizeComboOptions([{ value: 'AU', label: 'Australia' }, { value: 'SE' }])).toEqual([
            { value: 'AU', label: 'Australia' },
            { value: 'SE', label: 'SE'        },
        ]);
    });
});

describe('ComboRenderer value->label mapping', () => {
    it('a fresh renderer caches null and renders empty', () => {
        const r = new ComboRenderer(COUNTRIES);

        expect(r.getValue()).toBe(null);
        expect(renderedText(r)).toBe('');
    });

    it('setValue(key) renders the matching label but getValue returns the key', () => {
        const r = new ComboRenderer(COUNTRIES);

        r.setValue('AU');
        expect(renderedText(r)).toBe('Australia');
        expect(r.getValue()).toBe('AU');
    });

    it('setValue(null/undefined) normalises to null and renders empty', () => {
        const r = new ComboRenderer(COUNTRIES);

        r.setValue('AU');
        r.setValue(null);
        expect(r.getValue()).toBe(null);
        expect(renderedText(r)).toBe('');

        r.setValue('SE');
        r.setValue(undefined as any);
        expect(r.getValue()).toBe(null);
        expect(renderedText(r)).toBe('');
    });

    it('a value outside the option set renders the raw value (never blanks a present value)', () => {
        const r = new ComboRenderer(COUNTRIES);

        r.setValue('ZZ');
        expect(r.getValue()).toBe('ZZ');
        expect(renderedText(r)).toBe('ZZ');
    });

    it('plain-string option shorthand renders the value as its own label', () => {
        const r = new ComboRenderer(['Low', 'High']);

        r.setValue('Low');
        expect(renderedText(r)).toBe('Low');
        expect(r.getValue()).toBe('Low');
    });

    it('exposes the underlying Text via getText()', () => {
        const r = new ComboRenderer(COUNTRIES);

        expect(r.getText()).toBe((r as any)._text);
    });
});

describe('ComboEditor value round-trip', () => {
    it('a fresh editor caches null', () => {
        expect(new ComboEditor(COUNTRIES).getValue()).toBe(null);
    });

    it('setValue(key) round-trips the key through getValue', () => {
        const e = new ComboEditor(COUNTRIES);

        e.setValue('AU');
        expect(e.getValue()).toBe('AU');
    });

    it('setValue(null) clears the cached value', () => {
        const e = new ComboEditor(COUNTRIES);

        e.setValue('SE');
        e.setValue(null);
        expect(e.getValue()).toBe(null);
    });
});

describe('ComboCell', () => {
    it('getEditorKey namespaces the pool key by field', () => {
        expect(new ComboCell('country', COUNTRIES).getEditorKey()).toBe('combo:country');
    });

    it('two cells on different fields return different editor keys', () => {
        const a = new ComboCell('country', COUNTRIES);
        const b = new ComboCell('role', COUNTRIES);

        expect(a.getEditorKey()).not.toBe(b.getEditorKey());
    });

    it('uses a ComboRenderer and setValue delegates to it (label shown, key cached)', () => {
        const cell = new ComboCell('country', COUNTRIES);

        cell.setValue('SE');
        expect(cell.getRenderer()).toBeInstanceOf(ComboRenderer);
        expect(cell.getRenderer().getValue()).toBe('SE');
        expect(renderedText(cell.getRenderer())).toBe('Sweden');
    });
});

describe('Body registers per-column ComboEditor factories', () => {
    const MODEL = new Model([
        { name: 'id',   type: 'number', order: 0 },
        { name: 'role', type: 'string', order: 1 },
    ], 'id');

    // A stand-in cell — acquire only records it as the active-cell pointer.
    const CELL = {} as Cell<any>;

    function bodyWithComboColumn(): Body {
        const store   = new MemoryStore(MODEL, []);
        const body    = new Body(store);
        const configs = new Map<string, ColumnConfig>([
            ['role', { field: 'role', values: [{ value: 'dev', label: 'Developer' }, { value: 'qa', label: 'QA' }] }],
        ]);

        body.setColumnConfigs(configs);

        return body;
    }

    it('acquire(`combo:<field>`) returns a ComboEditor after setColumnConfigs', () => {
        const body = bodyWithComboColumn();

        expect(body.getEditorPool().acquire('combo:role', CELL)).toBeInstanceOf(ComboEditor);
    });

    it('re-acquiring the same key returns the same pooled instance', () => {
        const body = bodyWithComboColumn();
        const pool = body.getEditorPool();

        expect(pool.acquire('combo:role', CELL)).toBe(pool.acquire('combo:role', CELL));
    });

    it('does not register a combo editor for a column without values', () => {
        const store = new MemoryStore(MODEL, []);
        const body  = new Body(store);

        body.setColumnConfigs(new Map([['role', { field: 'role' }]]));

        expect(body.getEditorPool().acquire('combo:role', CELL)).toBe(null);
    });
});
