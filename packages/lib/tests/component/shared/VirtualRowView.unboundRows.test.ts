// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A pool row that shows no data is hidden. `growRowPool` used to create each
// spare row displayed, so a long Tree, Table or TreeTable held three empty
// `treeitem` / `row` elements that a screen reader could reach. Cases follow
// the Part A table of plans/in-progress/collection-widget-keyboard-gaps.md.
//
// "Unbound" means `_boundIndices[i] === -1`. The modelled DOM has no layout
// engine: the pool target comes from the committed height and the row height
// of the widget.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { setConnected, installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import { TreeBody } from '~/component/table/TreeBody';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The pool size of the 200 x 120 tree: 5 rows fit, plus the pool's slack. */
const TREE_POOL_SIZE   = 11;
/** Rows bound in that tree once its first render has run. */
const TREE_BOUND_ROWS  = 8;
/** Tree width in px; wide enough that no short label raises a scrollbar. */
const TREE_WIDTH       = 200;
/** Tree height in px: five 24 px rows fit, so a long tree needs a pool. */
const TREE_HEIGHT      = 120;
/** Tree-table body width in px: three columns of 100 px. */
const BODY_WIDTH       = 300;
/** Body height in px: a few 20 px rows fit, so sixty records need a pool. */
const BODY_HEIGHT      = 100;
/** The column widths in px, matching {@link BODY_WIDTH}. */
const COLUMN_WIDTHS    = [100, 100, 100];
/** Pool size of that body, read from a run: the same slack as the tree's. */
const BODY_POOL_SIZE   = 11;
/** Rows bound in that body once its first render has run. */
const BODY_BOUND_ROWS  = 8;
/** A scroll position, in px, that moves the window past the first rows. */
const SCROLLED_Y       = 240;

let built: Array<{ dispose(): void }>;

beforeEach(() => {
    installTestDOM(CONFIG);

    built = [];
});

afterEach(() => {
    for (const component of built) {
        component.dispose();
    }

    DOM.reset();
});

/** The pooled rows of a view and which of them are bound. */
interface PoolView {
    rows:  Array<{ isDisplayed(): boolean }>;
    bound: number[];
}

/**
 * Builds a rendered tree of `count` leaf roots.
 *
 * @param count - How many root nodes.
 * @returns The tree.
 */
function mountTree(count: number): _Tree {
    const nodes: TreeNode[] = Array.from({ length: count }, (_, i) => ({ label: 'Node ' + i }));
    const tree = new _Tree();

    built.push(tree);

    setConnected(tree.getElement(true)!, true);
    tree.setWidth(TREE_WIDTH);
    tree.setHeight(TREE_HEIGHT);
    tree.setNodes(nodes);
    (tree as any).renderWindow();

    return tree;
}

/**
 * Builds a rendered tree-table body of sixty root records.
 *
 * @returns The body.
 */
function mountBody(): TreeBody {
    const model = new Model([
        { name: 'id',     type: 'number', order: 0 },
        { name: 'parent', type: 'number', order: 1 },
        { name: 'name',   type: 'string', order: 2 },
    ], 'id');
    const store = new MemoryStore(model, []);

    store.loadData(Array.from({ length: 60 }, (_, i) => ({ id: i + 1, parent: null, name: 'r' + i })));

    const body = new TreeBody(store, { idField: 'id', parentField: 'parent', treeColumn: 'name', indentPx: 16 });

    built.push(body);

    setConnected(body.getElement(true)!, true);
    body.setWidth(BODY_WIDTH);
    body.setHeight(BODY_HEIGHT);
    (body as any).renderWindow(BODY_WIDTH, COLUMN_WIDTHS);

    return body;
}

/**
 * Reads the pool of a view.
 *
 * @param view - A Tree or TreeBody.
 * @returns Its rows and the indices of the bound ones.
 */
function poolOf(view: object): PoolView {
    const rows  = (view as any)._rowPool as PoolView['rows'];
    const bound = ((view as any)._boundIndices as number[]);

    return { rows, bound };
}

/**
 * Whether every bound row is displayed and no unbound row is.
 *
 * @param pool - The pool to check.
 * @returns `true` when the display state follows the binding.
 */
function displayFollowsBinding(pool: PoolView): boolean {
    return pool.rows.every((row, i) => row.isDisplayed() === (pool.bound[i] !== -1));
}

describe('Unbound pool rows are hidden', () => {
    it('U1: a fresh long tree shows only its bound rows', () => {
        const pool = poolOf(mountTree(60));

        expect(pool.rows.length).toBe(TREE_POOL_SIZE);
        expect(pool.bound.filter(i => i !== -1).length).toBe(TREE_BOUND_ROWS);
        expect(displayFollowsBinding(pool)).toBe(true);
    });

    it('U2: after a scroll every bound row is displayed and every unbound one is not', () => {
        const tree = mountTree(60);

        (tree as any).setScrollY(SCROLLED_Y);
        (tree as any).renderWindow();

        expect(displayFollowsBinding(poolOf(tree))).toBe(true);
    });

    it('U3: a fresh tree-table body shows only its bound rows', () => {
        const pool = poolOf(mountBody());

        expect(pool.rows.length).toBe(BODY_POOL_SIZE);
        expect(pool.bound.filter(i => i !== -1).length).toBe(BODY_BOUND_ROWS);
        expect(displayFollowsBinding(pool)).toBe(true);
    });

    it('U4: a three-root tree has three bound, displayed rows', () => {
        const pool = poolOf(mountTree(3));

        expect(pool.rows.length).toBe(3);
        expect(pool.bound.every(i => i !== -1)).toBe(true);
        expect(pool.rows.every(row => row.isDisplayed())).toBe(true);
    });
});
