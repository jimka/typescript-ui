// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/layered-style-bag.md, Stage 5 — Expected
// Behaviour rows 16-19: Row's per-record new/dirty/stripe tint and Cell's
// per-cell readOnly tint now route through declared `ownStyleStates` (see
// Row.ts / Cell.ts), sharing one class-tier rule per concrete class per
// active state instead of each pooled instance writing its own inline
// style or `#id` declaration.
//
// Conventions mirrored from InstanceStyleLayer.test.ts / StyleStates.test.ts:
// a local declarationsDuring/idSelector pair rather than an import (module
// state — the `.ClassName` rule cache — survives DOM.reset() within one
// test file, not across files, so sharing helpers buys nothing).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Row } from '~/component/table/Row';
import { Cell } from '~/component/table/cell/Cell';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { TreeRow } from '~/component/tree/TreeRow';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';
import { _ruleCacheHas } from '~/core/StyleTarget';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(DOM_CONFIG); });
afterEach(() => DOM.reset());

const MODEL = new Model([
    { name: 'name', type: 'string', order: 0 },
]);

// Two columns, so a narrow-then-widen cycle has both a cell to retire into
// `Row`'s per-instance `_cellCache` and a same-key slot to restore it into.
const TWO_COL_MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
]);

/** A standalone `ModelRecord`, not backed by any store — enough for `Row.setData`. */
function recordWith(name: string): ModelRecord {
    return new ModelRecord(MODEL, { name });
}

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map.
 */
function declarationsDuring(
    recorder: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = recorder.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of recorder.writes.slice(start)) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
            continue;
        }

        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[key] = styles[key];
        }
    }

    return out;
}

/** `apply` writes carrying an `addClass`/`removeClass` patch, targeting `element`. */
function classToggleWritesFor(
    writes: RecordingDOMSink['writes'],
    element: unknown,
): Array<{ addClass?: string[]; removeClass?: string[] }> {
    return writes
        .filter((w) => w.op === 'apply' && w.args[0] === element)
        .map((w) => w.args[1] as { addClass?: string[]; removeClass?: string[] })
        .filter((patch) => patch.addClass !== undefined || patch.removeClass !== undefined);
}

/** Any `apply` write carrying an inline `style` patch, targeting `element`. */
function inlineStyleWritesFor(
    writes: RecordingDOMSink['writes'],
    element: unknown,
): Array<Record<string, string | null>> {
    return writes
        .filter((w) => w.op === 'apply' && w.args[0] === element)
        .map((w) => (w.args[1] as { style?: Record<string, string | null> }).style)
        .filter((style): style is Record<string, string | null> => !!style);
}

describe('Pooled per-record tint meta-classes (Stage 5)', () => {
    // Runs first, deliberately: the `.Row.dirty…` rule is process-module
    // state (fresh per test *file*, not per test — see this file's own
    // header), materialising the first time any dirty Row in this file
    // renders. Every later test below warms it further, so this is the one
    // test that gets to observe the FIRST ensureStyleRule call for it.
    it('row 18: two Row instances showing the same tint share one class rule — exactly one ensureStyleRule call for .Row.dirty… across the pair', () => {
        const start = sink.writes.length;

        // `resolveStyleStates(Row)` (and the class-tier rule it builds for
        // every declared state, `.dirty` included) resolves — and
        // materialises — on the FIRST Row render, not the first setData
        // call, so the `start` marker above must precede it: a marker
        // placed after both renders would already find `.Row.dirty…`
        // cached, making this assertion pass vacuously.
        const a = new Row(MODEL, undefined, new Set(), new Map());
        a.getElement(true);
        const b = new Row(MODEL, undefined, new Set(), new Map());
        b.getElement(true);

        const dirtyA = recordWith('a1');
        dirtyA.set('name', 'a2');
        a.setData(dirtyA);

        const dirtyB = recordWith('b1');
        dirtyB.set('name', 'b2');
        b.setData(dirtyB);

        const ensureCalls = sink.writes
            .slice(start)
            .filter((w) => w.op === 'ensureStyleRule' && typeof w.args[0] === 'string' && (w.args[0] as string).startsWith('.Row.dirty'));

        expect(ensureCalls).toHaveLength(1);
    });

    it('row 16: Row.updateVisualState() on a dirty row adds the dirty class token, writes no inline style, and the tint lives only on the shared .Row.dirty:not(.selected):not(.new) class rule', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());
        row.getElement(true);

        const dirty = recordWith('x');
        dirty.set('name', 'y'); // diverges from the original 'x' -> _dirty becomes true

        const start = sink.writes.length;
        row.setData(dirty);
        const writes = sink.writes.slice(start);

        expect(classToggleWritesFor(writes, row.getElement())).toContainEqual(
            expect.objectContaining({ addClass: ['dirty'] }),
        );
        expect(inlineStyleWritesFor(writes, row.getElement())).toEqual([]);

        expect(_ruleCacheHas('.Row.dirty:not(.selected):not(.new)')).toBe(true);

        const declarations = declarationsDuring(sink, idSelector(row), () => {});
        expect(declarations.backgroundColor).toBeUndefined();
    });

    it('row 17: rebinding a pooled Row from a dirty record to a clean one removes the dirty token, with no residue on #id or as an inline style', () => {
        const row = new Row(MODEL, undefined, new Set(), new Map());
        row.getElement(true);

        const dirty = recordWith('x');
        dirty.set('name', 'y');
        row.setData(dirty);

        const clean = recordWith('z'); // fresh, unmodified record: not new, not dirty

        const start = sink.writes.length;
        row.setData(clean);
        const writes = sink.writes.slice(start);

        expect(classToggleWritesFor(writes, row.getElement())).toContainEqual(
            expect.objectContaining({ removeClass: ['dirty'] }),
        );
        expect(inlineStyleWritesFor(writes, row.getElement())).toEqual([]);

        const idRuleWrites = writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === idSelector(row));
        expect(idRuleWrites).toEqual([]);
    });

    it('row 19: a readOnly Cell reports getBackgroundColor() as the readOnly token, resolved through the declared .readOnly state rather than any code writing _options.backgroundColor', () => {
        const cell = new Cell<String | null>('td', new StringRenderer());
        cell.getElement(true);

        cell.setReadOnly(true);

        expect(cell.getBackgroundColor()).toBe('var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))');
        expect(_ruleCacheHas('.Cell.readOnly:not(.rangeSelected)')).toBe(true);
    });

    // Regression: `.focused` shares no property with `.rangeSelected` /
    // `.readOnly` / `.requiredEmpty` (outline vs background/cursor/shadow),
    // so it is deliberately excluded from `Cell.ownStyleStates`'s guarded
    // list — a state chain's `:not(...)` guard applies to a whole rule
    // regardless of which properties overlap, so keeping `.focused` in that
    // same list would suppress a read-only cell's entire background/cursor
    // tint the moment it also gained keyboard focus. `.focused` carries its
    // own unguarded rule (`focusedStyleRule`) instead, so it always layers
    // on top rather than competing.
    it('a focused, read-only Cell keeps both its read-only background and its focus ring — .focused does not suppress an unrelated state', () => {
        const cell = new Cell<String | null>('td', new StringRenderer());
        cell.getElement(true);

        cell.setReadOnly(true);
        cell.setStyleState('.focused', true);

        expect(cell.getBackgroundColor()).toBe('var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))');
        expect(_ruleCacheHas('.Cell.focused')).toBe(true);
    });

    // Same regression, on TreeRow: `.selected` (backgroundColor) and
    // `.focused` (outline) share no property either, so `.focused` is kept
    // out of `TreeRow.ownStyleStates` for the same reason. Uses the real
    // `TreeRow` class directly (rather than a local subclass) — a subclass
    // declaring no `ownStyleStates` of its own inherits `TreeRow`'s, so its
    // generated rule is named after `TreeRow` (the declaring ancestor), not
    // the subclass — see `resolveStyleStates`'s own "nearest declaring
    // ancestor owns the list" contract.
    it('a selected, focused TreeRow keeps both its selection wash and its focus ring', () => {
        const row = new TreeRow();
        row.getElement(true);

        row.setStyleState('.selected', true);
        row.setStyleState('.focused', true);

        expect(_ruleCacheHas('.TreeRow.selected')).toBe(true);
        expect(_ruleCacheHas('.TreeRow.focused')).toBe(true);
    });

    // Regression: a cell `Row.setColumnWindow` retires into `_cellCache`
    // (a routine horizontal narrow, not an edge case) leaves
    // `getComponents()` entirely — reachable through neither
    // `_updateFocusStyle`'s own-cell fast path (its `getParentComponent()`
    // is already null) nor its full-sweep fallback (which only walks the
    // *current* pool's `getComponents()`, never `_cellCache`). Without
    // clearing `.focused` at retirement time, the token — and the stale
    // `_activeStates` entry behind it — would survive into whichever column
    // later restores the same cell instance from the cache.
    it('a cell retired into the column-window cache while focused does not carry the stale .focused token when later restored', () => {
        const row = new Row(TWO_COL_MODEL, undefined, new Set(), new Map());
        row.getElement(true);
        row.setColumnWindow(0, 1);

        const [cellA] = row.getComponents() as Cell<any>[];
        cellA.setStyleState('.focused', true);
        expect(cellA.isStyleState('.focused')).toBe(true);

        row.setColumnWindow(1, 1); // narrows away column 'a', retiring cellA into _cellCache
        row.setColumnWindow(0, 1); // widens back — restores the same cellA instance for 'a'

        const [restoredA] = row.getComponents() as Cell<any>[];
        expect(restoredA).toBe(cellA); // positive control: the cache really did hand back the same instance
        expect(restoredA.isStyleState('.focused')).toBe(false);
    });
});
