//
// TreeBody flatten-relation coverage (tier 3). TreeBody subclasses the heavy
// Body, but its public constructor is harness-constructible: it takes a store +
// a TreeBodySpec, builds the parent/child index, and flattens — no live DOM
// reads in that path (verified offline). We assert the flat-record RELATION
// (order, depth, hasChildren, expanded, siblingCount, posInSet, orphan-as-root)
// through the public getFlatRecords / setExpanded / expandToDepth / collapseAll
// / isExpanded surface — never pixels.
//
// Non-Goal (scoped down per plan): the heavy virtual-scroll / row-pool /
// DnD render tier and the "expansion keyed by id survives a record-replacement
// store sync" bullet. The latter needs a store-sync seam whose re-render path
// (renderWindow) reaches live geometry the offline source zeroes out, so it is
// deferred rather than asserted here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { TreeBody } from '~/component/table/TreeBody';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
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

const MODEL = new Model([
    { name: 'id',     type: 'number', order: 0 },
    { name: 'parent', type: 'number', order: 1 },
    { name: 'name',   type: 'string', order: 2 },
], 'id');

const SPEC = { idField: 'id', parentField: 'parent', treeColumn: 'name', indentPx: 16 };

function tree(data: any[]): TreeBody {
    const store = new MemoryStore(MODEL, []);
    store.loadData(data);

    return new TreeBody(store, SPEC);
}

/** The id-field values of the current flat-record list, in order. */
function flatIds(tb: TreeBody): any[] {
    return tb.getFlatRecords().map(f => f.record.get('id'));
}

/** Looks up the store record by id via the body's index. */
function rec(tb: TreeBody, id: any): ModelRecord {
    return tb.getRecordById(id)!;
}

describe('TreeBody flatten — all-roots store', () => {
    const DATA = [
        { id: 1, parent: null, name: 'a' },
        { id: 2, parent: null, name: 'b' },
        { id: 3, parent: null, name: 'c' },
    ];

    it('flat list is every record at depth 0, all leaves, all collapsed', () => {
        const tb   = tree(DATA);
        const flat = tb.getFlatRecords();

        expect(flatIds(tb)).toEqual([1, 2, 3]);
        expect(flat.every(f => f.depth === 0)).toBe(true);
        expect(flat.every(f => f.hasChildren === false)).toBe(true);
        expect(flat.every(f => f.expanded === false)).toBe(true);
    });

    it('siblingCount is the root count; posInSet is the 1-based index', () => {
        const flat = tree(DATA).getFlatRecords();

        expect(flat.map(f => f.siblingCount)).toEqual([3, 3, 3]);
        expect(flat.map(f => f.posInSet)).toEqual([1, 2, 3]);
    });
});

describe('TreeBody flatten — parent with children', () => {
    const DATA = [
        { id: 1, parent: null, name: 'root' },
        { id: 2, parent: 1,    name: 'child-a' },
        { id: 3, parent: 1,    name: 'child-b' },
    ];

    it('collapsed by default: only the parent appears, marked hasChildren', () => {
        const tb   = tree(DATA);
        const flat = tb.getFlatRecords();

        expect(flatIds(tb)).toEqual([1]);
        expect(flat[0].hasChildren).toBe(true);
        expect(flat[0].expanded).toBe(false);
    });

    it('setExpanded(parent, true) reveals children under the parent at depth 1, in store order', () => {
        const tb = tree(DATA);

        tb.setExpanded(rec(tb, 1), true);

        expect(flatIds(tb)).toEqual([1, 2, 3]);

        const flat = tb.getFlatRecords();
        expect(flat[0].expanded).toBe(true);
        expect(flat[1].depth).toBe(1);
        expect(flat[2].depth).toBe(1);
        // Children carry their own sibling relation.
        expect(flat[1].siblingCount).toBe(2);
        expect(flat[1].posInSet).toBe(1);
        expect(flat[2].posInSet).toBe(2);
    });

    it('isExpanded reflects expansion state of a branch', () => {
        const tb = tree(DATA);

        expect(tb.isExpanded(rec(tb, 1))).toBe(false);
        tb.setExpanded(rec(tb, 1), true);
        expect(tb.isExpanded(rec(tb, 1))).toBe(true);
    });
});

describe('TreeBody leaf expansion is inert', () => {
    const DATA = [
        { id: 1, parent: null, name: 'root' },
        { id: 2, parent: 1,    name: 'leaf' },
    ];

    it('isExpanded(leaf) is always false', () => {
        const tb = tree(DATA);

        tb.setExpanded(rec(tb, 1), true);
        expect(tb.isExpanded(rec(tb, 2))).toBe(false);
    });

    it('setExpanded(leaf, true) is a no-op (returns this, flat list unchanged)', () => {
        const tb = tree(DATA);

        tb.setExpanded(rec(tb, 1), true);
        const before = flatIds(tb);

        const ret = tb.setExpanded(rec(tb, 2), true);
        expect(ret).toBe(tb);
        expect(flatIds(tb)).toEqual(before);
    });
});

describe('TreeBody expandToDepth / collapseAll', () => {
    // root(1) -> child(2) -> grandchild(3); plus sibling root(4).
    const DATA = [
        { id: 1, parent: null, name: 'root' },
        { id: 2, parent: 1,    name: 'child' },
        { id: 3, parent: 2,    name: 'grandchild' },
        { id: 4, parent: null, name: 'root2' },
    ];

    it('expandToDepth(0) expands only roots (children of roots appear, grandchildren do not)', () => {
        const tb = tree(DATA);

        tb.expandToDepth(0);
        // root1 expanded -> child appears; child stays collapsed -> no grandchild.
        expect(flatIds(tb)).toEqual([1, 2, 4]);
    });

    it('expandToDepth(1) expands roots and their children', () => {
        const tb = tree(DATA);

        tb.expandToDepth(1);
        expect(flatIds(tb)).toEqual([1, 2, 3, 4]);
    });

    it('collapseAll empties the expansion set so only roots remain', () => {
        const tb = tree(DATA);

        tb.expandToDepth(1);
        tb.collapseAll();
        expect(flatIds(tb)).toEqual([1, 4]);
    });
});

describe('TreeBody orphan-as-root', () => {
    it('a record whose parent id is absent renders as a root (depth 0), not dropped', () => {
        // CONTRACT (rebuildIndex): "orphans render as additional roots rather
        // than silently disappearing".
        const tb = tree([
            { id: 1, parent: null, name: 'root' },
            { id: 2, parent: 999,  name: 'orphan' },
        ]);

        const flat = tb.getFlatRecords();
        const orphan = flat.find(f => f.record.get('id') === 2)!;

        expect(orphan).toBeTruthy();
        expect(orphan.depth).toBe(0);
        expect(flatIds(tb).sort()).toEqual([1, 2]);
    });
});
