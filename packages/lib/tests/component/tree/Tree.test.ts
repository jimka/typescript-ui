import { describe, it, expect, afterEach, beforeEach, beforeAll, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import type { TreeNodeRenderContext } from '~/component/tree/TreeNodeRenderContext';
import { TreeNodeRenderer } from '~/component/tree/TreeNodeRenderer';
import { LabelTreeNodeRenderer } from '~/component/tree/renderer/Label';
import { IconLabelTreeNodeRenderer } from '~/component/tree/renderer/IconLabel';
import { Glyph } from '~/component/display/Glyph';
import { Scrollbar } from '~/component/container/Scrollbar';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The glyph registry starts empty; register the names the IconLabel renderer
// resolves so its Glyph construction does not throw. `char` glyphs need no SVG
// sprite, keeping the registration minimal.
beforeAll(() => {
    Glyph.register(
        { name: 'file',   kind: 'char', char: 'F' },
        { name: 'folder', kind: 'char', char: 'D' },
    );
});

// White-box seam: widen the protected `emit` so the listener bag can be fired
// without a real selection gesture (emit is protected; the public on/off pair
// registers/removes listeners).
class TestTree extends _Tree {
    public fire(nodes: TreeNode[]): void {
        this.emit('selection', nodes);
    }

    public fireContextMenu(node: TreeNode, event: MouseEvent): void {
        this.emit('contextmenu', node, event);
    }
}

// Labels drawn from the baked font's char set (H e l o W r d x X + space) so
// the renderer width tests measure real advances.
function fruitTree(): TreeNode[] {
    return [
        { label: 'Hello', children: [
            { label: 'Word' },
            { label: 'rod' },
        ] },
        { label: 'World' },
    ];
}

describe('Tree — construction contract', () => {
    it('wires ARIA role tree, tabIndex 0, and multiselectable', () => {
        const tree = new _Tree();

        expect(tree.getAria().getRole()).toBe('tree');
        expect(tree.getAria().getTabIndex()).toBe(0);
        expect(tree.getAria().getMultiselectable()).toBe(true);
    });

    it('defaults its preferred width to 200 and height to 0 when empty', () => {
        const tree = new _Tree();
        const pref = tree.getPreferredSize();

        expect(pref?.width).toBe(200);
        expect(pref?.height).toBe(0);
    });

    it('derives its preferred height from the current flattened row count', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);

        // 2 roots, both collapsed.
        expect(tree.getPreferredSize()?.height).toBe(2 * ROW_HEIGHT);

        // Expanding 'Hello' (2 children) flattens 2 more rows into view.
        tree.expandNode(nodes[0]);
        expect(tree.getPreferredSize()?.height).toBe(4 * ROW_HEIGHT);
    });

    it('an explicit preferredSize constraint wins over the content-derived height', () => {
        const tree = new _Tree({ preferredSize: { width: 500, height: 500 } });
        tree.setNodes(fruitTree());

        expect(tree.getPreferredSize()).toEqual({ width: 500, height: 500 });
    });
});

describe('Tree — setNodes / getNodes', () => {
    it('stores the node array by reference', () => {
        const tree = new _Tree();
        const nodes = fruitTree();

        tree.setNodes(nodes);
        // getNodes returns the same array identity (Tree.ts:159).
        expect(tree.getNodes()).toBe(nodes);
    });

    it('clears the selection so the getters report empty', () => {
        const tree = new _Tree();

        tree.setNodes(fruitTree());
        expect(tree.getSelectedNode()).toBeNull();
        expect(tree.getSelectedNodes()).toEqual([]);
    });

    it('resets a prior selection on a fresh setNodes', () => {
        const tree = new _Tree();

        // Seed a selection through the private surface (white-box), then swap.
        tree.setNodes(fruitTree());

        const poke = tree as unknown as {
            _selectedNodes: Set<TreeNode>;
            _anchorNode: TreeNode | null;
            _nodes: TreeNode[];
        };
        const first = poke._nodes[0];

        poke._selectedNodes.add(first);
        poke._anchorNode = first;
        expect(tree.getSelectedNodes()).toHaveLength(1);

        tree.setNodes(fruitTree());
        expect(tree.getSelectedNode()).toBeNull();
        expect(tree.getSelectedNodes()).toEqual([]);
    });
});

describe('Tree — renderer factory', () => {
    it('defaults to producing a LabelTreeNodeRenderer', () => {
        const tree = new _Tree();
        const renderer = tree.getRendererFactory()();

        expect(renderer).toBeInstanceOf(LabelTreeNodeRenderer);
    });

    it('setRendererFactory swaps the factory and is observable before any render', () => {
        const tree = new _Tree();
        const factory = (): TreeNodeRenderer => new IconLabelTreeNodeRenderer();

        tree.setRendererFactory(factory);
        expect(tree.getRendererFactory()).toBe(factory);
        expect(tree.getRendererFactory()()).toBeInstanceOf(IconLabelTreeNodeRenderer);
    });
});

describe('Tree — listener bag', () => {
    it('emit dispatches the selection payload to a registered listener', () => {
        const tree = new TestTree();
        const seen: TreeNode[][] = [];
        const listener = (nodes: TreeNode[]): void => {
            seen.push(nodes);
        };

        tree.on('selection', listener);
        const payload = [{ label: 'A' }];
        tree.fire(payload);
        expect(seen).toEqual([payload]);
    });

    it('emit dispatches the contextmenu payload (node + event) to a listener', () => {
        const tree = new TestTree();
        const seen: Array<[TreeNode, MouseEvent]> = [];

        tree.on('contextmenu', (node: TreeNode, event: MouseEvent) => {
            seen.push([node, event]);
        });

        const node = { label: 'A' };
        const event = { clientX: 10, clientY: 20 } as MouseEvent;
        tree.fireContextMenu(node, event);

        expect(seen).toEqual([[node, event]]);
    });

    it('selectNode selects a node and does not emit selection', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);

        let emitted = 0;
        tree.on('selection', () => { emitted += 1; });

        tree.selectNode(nodes[1]);

        expect(tree.getSelectedNodes()).toEqual([nodes[1]]);
        expect(tree.getSelectedNode()).toBe(nodes[1]);
        expect(emitted).toBe(0);
    });

    it('selectNode is a no-op for a node not in the visible set', () => {
        const tree = new _Tree();
        tree.setNodes(fruitTree());

        tree.selectNode({ label: 'ghost' });

        expect(tree.getSelectedNodes()).toEqual([]);
    });

    it('off removes a previously registered listener', () => {
        const tree = new TestTree();
        let count = 0;
        const listener = (): void => {
            count += 1;
        };

        tree.on('selection', listener);
        tree.fire([]);
        tree.off('selection', listener);
        tree.fire([]);
        expect(count).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// White-box block: the flatten / expand traversal lives in private handlers
// (`_flatten`, `_isExpandable`, `_onToggle`). They are reachable offline
// because setNodes()/_onToggle() gate their _renderWindow() call behind
// getElement(), which is undefined for an unrendered tree — so the flatten
// arithmetic runs without a wired VirtualScroller. Reached via a typed cast;
// clearly fenced as private-surface testing.
// ---------------------------------------------------------------------------
interface FlatRow {
    node: TreeNode;
    depth: number;
    siblingCount: number;
    posInSet: number;
}

interface TreePrivate {
    _flatten(): void;
    _onToggle(node: TreeNode): void;
    _isExpandable(node: TreeNode): boolean;
    _selectAtIndex(index: number): void;
    _extendSelectionTo(index: number): void;
    _onKeyDown(e: KeyboardEvent): void;
    _flatRows: FlatRow[];
    _expandedNodes: Set<TreeNode>;
    _loadedNodes: Set<TreeNode>;
    _selectedNodes: Set<TreeNode>;
    _anchorNode: TreeNode | null;
}

function asPrivate(tree: _Tree): TreePrivate {
    return tree as unknown as TreePrivate;
}

// ---------------------------------------------------------------------------
// Selection-event change guard: `"selection"` must fire only when the
// selected set actually changes membership, not on every mutating call.
// _selectAtIndex / _extendSelectionTo / _onKeyDown all gate their DOM-facing
// calls (renderWindow, scrollIntoView) behind getElement()/the scroller being
// present, so they run safely offline like the _onToggle block above.
// ---------------------------------------------------------------------------
describe('Tree (white-box) — selection event fires only on a real change', () => {
    it('_selectAtIndex called twice for the same row fires "selection" once', () => {
        const tree = new _Tree();
        tree.setNodes(fruitTree());
        const priv = asPrivate(tree);

        let emitted = 0;
        tree.on('selection', () => { emitted += 1; });

        priv._selectAtIndex(0);
        priv._selectAtIndex(0);

        expect(emitted).toBe(1);
    });

    it('_selectAtIndex for two different rows fires "selection" twice', () => {
        const tree = new _Tree();
        tree.setNodes(fruitTree());
        const priv = asPrivate(tree);

        let emitted = 0;
        tree.on('selection', () => { emitted += 1; });

        priv._selectAtIndex(0);
        priv._selectAtIndex(1);

        expect(emitted).toBe(2);
    });

    it('_extendSelectionTo producing the same range twice fires "selection" once', () => {
        const tree = new _Tree();
        tree.setNodes(fruitTree());
        const priv = asPrivate(tree);

        priv._selectAtIndex(0); // anchors the range at row 0

        let emitted = 0;
        tree.on('selection', () => { emitted += 1; });

        priv._extendSelectionTo(1);
        priv._extendSelectionTo(1);

        expect(emitted).toBe(1);
    });

    it('selectNode does not emit, and a click reproducing its selection does not emit either', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        const priv = asPrivate(tree);

        tree.selectNode(nodes[0]);

        let emitted = 0;
        tree.on('selection', () => { emitted += 1; });

        priv._selectAtIndex(0); // reproduces exactly what selectNode already set

        expect(emitted).toBe(0);
    });

    it('keyboard navigation at a boundary row does not emit; moving to a different row does', () => {
        const tree = new _Tree();
        tree.setNodes(fruitTree());
        const priv = asPrivate(tree);

        priv._selectAtIndex(0); // focus on the first (boundary) row

        let emitted = 0;
        tree.on('selection', () => { emitted += 1; });

        priv._onKeyDown({ key: 'ArrowUp', shiftKey: false, preventDefault: () => {} } as KeyboardEvent);
        expect(emitted).toBe(0); // already the first row — clamps in place

        priv._onKeyDown({ key: 'ArrowDown', shiftKey: false, preventDefault: () => {} } as KeyboardEvent);
        expect(emitted).toBe(1); // moved to a different row — a real change
    });
});

describe('Tree (white-box) — _flatten depth / posInSet', () => {
    it('a collapsed parent contributes only itself', () => {
        const tree = new _Tree();

        tree.setNodes(fruitTree());
        const rows = asPrivate(tree)._flatRows;

        // No node expanded yet → only the two roots are flattened.
        expect(rows.map(r => r.node.label)).toEqual(['Hello', 'World']);
        expect(rows.map(r => r.depth)).toEqual([0, 0]);
        expect(rows.map(r => r.posInSet)).toEqual([1, 2]);
        expect(rows.map(r => r.siblingCount)).toEqual([2, 2]);
    });

    it('an expanded parent inlines its children with depth+1 and 1-based posInSet', () => {
        const tree = new _Tree();
        const nodes = fruitTree();

        tree.setNodes(nodes);
        const priv = asPrivate(tree);

        priv._expandedNodes.add(nodes[0]);
        priv._flatten();

        const rows = priv._flatRows;
        expect(rows.map(r => r.node.label)).toEqual(['Hello', 'Word', 'rod', 'World']);
        expect(rows.map(r => r.depth)).toEqual([0, 1, 1, 0]);
        expect(rows.map(r => r.posInSet)).toEqual([1, 1, 2, 2]);
        // Children form a sibling group of 2; roots a group of 2.
        expect(rows.map(r => r.siblingCount)).toEqual([2, 2, 2, 2]);
    });
});

describe('Tree (white-box) — _isExpandable', () => {
    it('classifies eager, empty, and lazy nodes per the caret contract', () => {
        const tree = new _Tree();
        const priv = asPrivate(tree);

        const eager: TreeNode = { label: 'p', children: [{ label: 'c' }] };
        const emptyEager: TreeNode = { label: 'leaf', children: [] };
        const leaf: TreeNode = { label: 'leaf2' };
        const lazy: TreeNode = { label: 'lazy', hasChildren: true };

        expect(priv._isExpandable(eager)).toBe(true);
        // Empty children array → not expandable (Tree.ts:292).
        expect(priv._isExpandable(emptyEager)).toBe(false);
        expect(priv._isExpandable(leaf)).toBe(false);
        // Lazy node is expandable before its children exist.
        expect(priv._isExpandable(lazy)).toBe(true);
    });
});

describe('Tree (white-box) — _onToggle expand / collapse', () => {
    it('toggling an eager parent grows then shrinks the flat rows', () => {
        const tree = new _Tree();
        const nodes = fruitTree();

        tree.setNodes(nodes);
        const priv = asPrivate(tree);

        expect(priv._flatRows).toHaveLength(2);

        priv._onToggle(nodes[0]);
        expect(priv._expandedNodes.has(nodes[0])).toBe(true);
        expect(priv._flatRows.map(r => r.node.label)).toEqual(['Hello', 'Word', 'rod', 'World']);

        priv._onToggle(nodes[0]);
        expect(priv._expandedNodes.has(nodes[0])).toBe(false);
        expect(priv._flatRows).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Expand / collapse observability — getExpandedNodes(), the "expand"/"collapse"
// event pair, and expandNodeAsync(). Every row of the emission table in the
// plan's Architecture Decisions is one test here; offline throughout, since
// _reflattenAndRender is safe without a rendered element and lazy loads are
// driven by hand-written loadChildren functions.
// ---------------------------------------------------------------------------
describe('Tree — expand / collapse observability', () => {
    function lazyNode(loadChildren: () => Promise<TreeNode[]>): TreeNode {
        return { label: 'lazy', hasChildren: true, loadChildren };
    }

    it('_onToggle on a collapsed node adds it and emits "expand" (caret click / ArrowRight path)', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        const priv = asPrivate(tree);

        const seen: TreeNode[] = [];
        tree.on('expand', node => seen.push(node));

        priv._onToggle(nodes[0]);

        expect(priv._expandedNodes.has(nodes[0])).toBe(true);
        expect(seen).toEqual([nodes[0]]);
    });

    it('_onToggle on an expanded node removes it and emits "collapse" (caret click / ArrowLeft path)', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        const priv = asPrivate(tree);
        priv._onToggle(nodes[0]);

        const seen: TreeNode[] = [];
        tree.on('collapse', node => seen.push(node));

        priv._onToggle(nodes[0]);

        expect(priv._expandedNodes.has(nodes[0])).toBe(false);
        expect(seen).toEqual([nodes[0]]);
    });

    it('expandNode on a collapsed node adds it and emits "expand"', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);

        const seen: TreeNode[] = [];
        tree.on('expand', node => seen.push(node));

        tree.expandNode(nodes[0]);

        expect(asPrivate(tree)._expandedNodes.has(nodes[0])).toBe(true);
        expect(seen).toEqual([nodes[0]]);
    });

    it('expandNode on an already-expanded node is a no-op and emits nothing', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        tree.expandNode(nodes[0]);

        let emitted = 0;
        tree.on('expand', () => { emitted += 1; });

        tree.expandNode(nodes[0]);

        expect(emitted).toBe(0);
    });

    it('expandNodeAsync on a collapsed eager node commits synchronously and resolves true', async () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        const priv = asPrivate(tree);

        const seen: TreeNode[] = [];
        tree.on('expand', node => seen.push(node));

        const promise = tree.expandNodeAsync(nodes[0]);
        // Synchronous commit: the state is already updated before the caller awaits.
        expect(priv._expandedNodes.has(nodes[0])).toBe(true);

        const result = await promise;
        expect(result).toBe(true);
        expect(seen).toEqual([nodes[0]]);
    });

    it('expandNodeAsync on a lazy node whose loader resolves adds it after the load and emits "expand"', async () => {
        const tree = new _Tree();
        const target: TreeNode = { label: 'child' };
        const node = lazyNode(() => Promise.resolve([target]));
        tree.setNodes([node]);
        const priv = asPrivate(tree);

        const seen: TreeNode[] = [];
        tree.on('expand', n => seen.push(n));

        const promise = tree.expandNodeAsync(node);
        // Not committed yet — the load has not resolved.
        expect(priv._expandedNodes.has(node)).toBe(false);

        const result = await promise;

        expect(result).toBe(true);
        expect(priv._expandedNodes.has(node)).toBe(true);
        expect(node.children).toEqual([target]);
        expect(seen).toEqual([node]);
    });

    it('expandNodeAsync on a lazy node whose loader rejects resolves false and emits only "loaderror"', async () => {
        const tree = new _Tree();
        const node = lazyNode(() => Promise.reject(new Error('nope')));
        tree.setNodes([node]);
        const priv = asPrivate(tree);

        let expandCount = 0;
        let errorCount = 0;
        tree.on('expand', () => { expandCount += 1; });
        tree.on('loaderror', () => { errorCount += 1; });

        const result = await tree.expandNodeAsync(node);

        expect(result).toBe(false);
        expect(expandCount).toBe(0);
        expect(errorCount).toBe(1);
        expect(priv._expandedNodes.has(node)).toBe(false);
    });

    it('a rejected lazy load leaves the node retryable: absent from _expandedNodes / _loadedNodes, and a second call reloads', async () => {
        const tree = new _Tree();
        let loadCount = 0;
        const node = lazyNode(() => {
            loadCount += 1;
            return loadCount === 1 ? Promise.reject(new Error('nope')) : Promise.resolve([]);
        });
        tree.setNodes([node]);
        const priv = asPrivate(tree);

        const first = await tree.expandNodeAsync(node);
        expect(first).toBe(false);
        expect(priv._expandedNodes.has(node)).toBe(false);
        expect(priv._loadedNodes.has(node)).toBe(false);

        const second = await tree.expandNodeAsync(node);
        expect(loadCount).toBe(2);
        expect(second).toBe(true);
    });

    it('expandNodeAsync on an already-expanded node resolves true and emits nothing', async () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        tree.expandNode(nodes[0]);

        let emitted = 0;
        tree.on('expand', () => { emitted += 1; });

        const result = await tree.expandNodeAsync(nodes[0]);

        expect(result).toBe(true);
        expect(emitted).toBe(0);
    });

    it('a second expandNodeAsync while a load is in flight joins the first: one loadChildren call, one "expand"', async () => {
        const tree = new _Tree();
        let resolveLoad!: (children: TreeNode[]) => void;
        let loadCount = 0;
        const node = lazyNode(() => {
            loadCount += 1;
            return new Promise<TreeNode[]>(resolve => { resolveLoad = resolve; });
        });
        tree.setNodes([node]);

        let expandCount = 0;
        tree.on('expand', () => { expandCount += 1; });

        const first = tree.expandNodeAsync(node);
        const second = tree.expandNodeAsync(node);

        resolveLoad([]);

        const [r1, r2] = await Promise.all([first, second]);

        expect(loadCount).toBe(1);
        expect(r1).toBe(true);
        expect(r2).toBe(true);
        expect(expandCount).toBe(1);
    });

    it('expandNode then expandNodeAsync on the same lazy node also runs one load and one "expand"', async () => {
        const tree = new _Tree();
        let resolveLoad!: (children: TreeNode[]) => void;
        let loadCount = 0;
        const node = lazyNode(() => {
            loadCount += 1;
            return new Promise<TreeNode[]>(resolve => { resolveLoad = resolve; });
        });
        tree.setNodes([node]);

        let expandCount = 0;
        tree.on('expand', () => { expandCount += 1; });

        tree.expandNode(node);
        const asyncResult = tree.expandNodeAsync(node);

        resolveLoad([]);
        const result = await asyncResult;

        expect(loadCount).toBe(1);
        expect(result).toBe(true);
        expect(expandCount).toBe(1);
    });

    it('expandNodeAsync on a leaf adds it to the expanded set, emits "expand", and renders nothing new', async () => {
        const tree = new _Tree();
        const leaf: TreeNode = { label: 'leaf' };
        tree.setNodes([leaf]);
        const priv = asPrivate(tree);

        const seen: TreeNode[] = [];
        tree.on('expand', n => seen.push(n));

        const result = await tree.expandNodeAsync(leaf);

        expect(result).toBe(true);
        expect(priv._expandedNodes.has(leaf)).toBe(true);
        expect(seen).toEqual([leaf]);
        expect(priv._flatRows).toHaveLength(1);
    });

    it('setNodes during an in-flight load orphans it: resolves false, no "expand"/"loaderror", node stays uncommitted', async () => {
        const tree = new _Tree();
        let resolveLoad!: (children: TreeNode[]) => void;
        const node = lazyNode(() => new Promise<TreeNode[]>(resolve => { resolveLoad = resolve; }));
        tree.setNodes([node]);
        const priv = asPrivate(tree);

        let expandCount = 0;
        let errorCount = 0;
        tree.on('expand', () => { expandCount += 1; });
        tree.on('loaderror', () => { errorCount += 1; });

        const promise = tree.expandNodeAsync(node);

        tree.setNodes([{ label: 'other' }]);
        resolveLoad([]);

        const result = await promise;

        expect(result).toBe(false);
        expect(expandCount).toBe(0);
        expect(errorCount).toBe(0);
        expect(priv._expandedNodes.has(node)).toBe(false);
    });

    it('expandAll() emits nothing while getExpandedNodes() reflects what it expanded', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);

        let emitted = 0;
        tree.on('expand', () => { emitted += 1; });

        tree.expandAll();

        expect(emitted).toBe(0);
        expect(tree.getExpandedNodes()).toContain(nodes[0]);
    });

    it('revealByPredicate() emits nothing while getExpandedNodes() reflects the expanded ancestors', async () => {
        const tree = new _Tree();
        const target: TreeNode = { label: 'orders', data: { name: 'orders' } };
        const nodes: TreeNode[] = [{ label: 'public', children: [target] }];
        tree.setNodes(nodes);

        let emitted = 0;
        tree.on('expand', () => { emitted += 1; });

        await tree.revealByPredicate(d => typeof d === 'object' && d !== null && (d as { name?: string }).name === 'orders');

        expect(emitted).toBe(0);
        expect(tree.getExpandedNodes()).toContain(nodes[0]);
    });

    it('setNodes() clears the expanded set and emits zero "collapse"', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        tree.expandNode(nodes[0]);

        let emitted = 0;
        tree.on('collapse', () => { emitted += 1; });

        tree.setNodes(fruitTree());

        expect(emitted).toBe(0);
        expect(tree.getExpandedNodes()).toEqual([]);
    });

    it('getExpandedNodes() returns [] on a fresh tree and [node] after expandNode', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);

        expect(tree.getExpandedNodes()).toEqual([]);

        tree.expandNode(nodes[0]);
        expect(tree.getExpandedNodes()).toEqual([nodes[0]]);
    });

    it('getExpandedNodes() returns a snapshot copy that mutation does not affect', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        tree.expandNode(nodes[0]);

        const snapshot = tree.getExpandedNodes();
        snapshot.push({ label: 'ghost' });
        snapshot.pop();
        snapshot.pop();

        expect(tree.getExpandedNodes()).toEqual([nodes[0]]);
    });

    it('an "expand" listener for an eager parent sees the committed state and rebuilt rows', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        const priv = asPrivate(tree);

        let sawExpanded = false;
        let sawChildren = false;
        tree.on('expand', node => {
            sawExpanded = tree.getExpandedNodes().includes(node);
            sawChildren = priv._flatRows.some(r => r.node.label === 'Word');
        });

        tree.expandNode(nodes[0]);

        expect(sawExpanded).toBe(true);
        expect(sawChildren).toBe(true);
    });

    it('a "collapse" listener no longer sees the collapsed node\'s children in the flat rows', () => {
        const tree = new _Tree();
        const nodes = fruitTree();
        tree.setNodes(nodes);
        const priv = asPrivate(tree);
        tree.expandNode(nodes[0]);

        let sawChildren = true;
        tree.on('collapse', () => {
            sawChildren = priv._flatRows.some(r => r.node.label === 'Word');
        });

        priv._onToggle(nodes[0]);

        expect(sawChildren).toBe(false);
    });

    it('the construction-time listeners bag wires both "expand" and "collapse"', () => {
        let expandCount = 0;
        let collapseCount = 0;
        const tree = new _Tree({
            listeners: {
                expand:   () => { expandCount += 1; },
                collapse: () => { collapseCount += 1; },
            },
        });
        const nodes = fruitTree();
        tree.setNodes(nodes);
        const priv = asPrivate(tree);

        priv._onToggle(nodes[0]); // expand
        priv._onToggle(nodes[0]); // collapse

        expect(expandCount).toBe(1);
        expect(collapseCount).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Payload slot — the optional `data` field is an opaque caller-supplied carrier.
// The tree never reads it for identity/dedup; it only round-trips by reference
// through the node-flow API. All four behaviours are in-memory and offline.
// ---------------------------------------------------------------------------
describe('TreeNode — data payload slot', () => {
    it('round-trips through setNodes / getNodes by reference', () => {
        const tree = new _Tree();
        const payload = { kind: 'schema', name: 'public' };
        const nodes: TreeNode[] = [{ label: 'public', data: payload }];

        tree.setNodes(nodes);
        // getNodes returns the same array, so the same node reference carries data.
        expect(tree.getNodes()[0].data).toBe(payload);
    });

    it('is retrievable from a fired selection event', () => {
        const tree = new TestTree();
        const payload = { kind: 'table', name: 'users' };
        const node: TreeNode = { label: 'users', data: payload };
        let received: TreeNode[] = [];

        tree.on('selection', nodes => {
            received = nodes;
        });
        tree.fire([node]);
        expect(received[0].data).toBe(payload);
    });

    it('survives the lazy-load path and is reachable from the loaded child', async () => {
        const tree = new _Tree();
        const childPayload = { kind: 'table', name: 'orders' };
        const parent: TreeNode = {
            label:        'schema',
            hasChildren:  true,
            loadChildren: () => Promise.resolve([{ label: 'orders', data: childPayload }]),
        };

        tree.setNodes([parent]);
        // _loadAndExpand writes the resolved children onto the parent by
        // reference; awaiting it lets the child's payload settle in place.
        const priv = tree as unknown as { _loadAndExpand(node: TreeNode): Promise<boolean> };
        await priv._loadAndExpand(parent);

        expect(parent.children?.[0].data).toBe(childPayload);
    });

    it('does not affect expansion or selection identity', () => {
        const tree = new _Tree();
        const shared = { kind: 'schema' };
        const a: TreeNode = { label: 'dup', data: shared, children: [{ label: 'child' }] };
        const b: TreeNode = { label: 'dup', data: shared, children: [{ label: 'child' }] };

        tree.setNodes([a, b]);
        const priv = asPrivate(tree);

        // Expanding one node with shared data must not expand the other.
        priv._onToggle(a);
        expect(priv._expandedNodes.has(a)).toBe(true);
        expect(priv._expandedNodes.has(b)).toBe(false);

        // Selecting one (seeded white-box) must not select the other: the
        // selection set is keyed by object reference, never by `data`.
        (tree as unknown as { _selectedNodes: Set<TreeNode> })._selectedNodes.add(a);
        expect(tree.getSelectedNodes()).toContain(a);
        expect(tree.getSelectedNodes()).not.toContain(b);
    });
});

// ---------------------------------------------------------------------------
// revealByPredicate — expand-to-node search. Offline: the reveal path only
// touches the flatten / expand model (no DOM), like the _onToggle block above.
// ---------------------------------------------------------------------------
describe('Tree — revealByPredicate', () => {
    const named = (d: unknown, name: string): boolean =>
        typeof d === 'object' && d !== null && (d as { name?: string }).name === name;

    it('expands the ancestor path to reveal an eager node under a collapsed parent', async () => {
        const tree = new _Tree();
        const target: TreeNode = { label: 'orders', data: { name: 'orders' } };
        const nodes: TreeNode[] = [{ label: 'public', children: [target] }];
        tree.setNodes(nodes);
        const priv = asPrivate(tree);

        // Collapsed: only the root is flattened, so a plain selectNode would no-op.
        expect(priv._flatRows.map(r => r.node.label)).toEqual(['public']);

        const found = await tree.revealByPredicate(d => named(d, 'orders'));

        expect(found).toBe(target);
        expect(priv._expandedNodes.has(nodes[0])).toBe(true);
        expect(priv._flatRows.map(r => r.node.label)).toContain('orders');
    });

    it('loads a lazy branch to reveal a node the user never expanded to', async () => {
        const tree = new _Tree();
        const target: TreeNode = { label: 'orders', data: { name: 'orders' } };
        const schema: TreeNode = {
            label:        'public',
            hasChildren:  true,
            loadChildren: () => Promise.resolve([target]),
        };
        tree.setNodes([schema]);
        const priv = asPrivate(tree);

        const found = await tree.revealByPredicate(d => named(d, 'orders'));

        expect(found).toBe(target);
        // Children were loaded and cached, the branch expanded, the node visible.
        expect(schema.children).toEqual([target]);
        expect(priv._loadedNodes.has(schema)).toBe(true);
        expect(priv._expandedNodes.has(schema)).toBe(true);
        expect(priv._flatRows.map(r => r.node.label)).toContain('orders');
    });

    it('returns null and leaves the tree collapsed when nothing matches', async () => {
        const tree = new _Tree();
        tree.setNodes([{ label: 'public', children: [{ label: 'orders', data: { name: 'orders' } }] }]);
        const priv = asPrivate(tree);

        const found = await tree.revealByPredicate(() => false);

        expect(found).toBe(null);
        expect(priv._flatRows.map(r => r.node.label)).toEqual(['public']);
    });

    it('reveals without selecting or emitting selection', async () => {
        const tree = new _Tree();
        const target: TreeNode = { label: 'orders', data: { name: 'orders' } };
        tree.setNodes([{ label: 'public', children: [target] }]);
        let emitted = 0;
        tree.on('selection', () => { emitted += 1; });

        await tree.revealByPredicate(d => named(d, 'orders'));

        expect(emitted).toBe(0);
        expect(tree.getSelectedNodes()).toEqual([]);
    });

    it('skips a lazy branch whose load rejects and continues to a later match', async () => {
        const tree = new _Tree();
        const target: TreeNode = { label: 'orders', data: { name: 'orders' } };
        const broken: TreeNode = { label: 'broken', hasChildren: true, loadChildren: () => Promise.reject(new Error('nope')) };
        const good:   TreeNode = { label: 'good', children: [target] };
        tree.setNodes([broken, good]);
        const priv = asPrivate(tree);

        const found = await tree.revealByPredicate(d => named(d, 'orders'));

        expect(found).toBe(target);
        expect(priv._expandedNodes.has(good)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Renderer content-width tests — these route through DOM.source.measureText
// (offline-modelled), so the width is a real relational invariant: the sum of
// the baked advances for the label string.
// ---------------------------------------------------------------------------
describe('Tree renderers — content width', () => {
    afterEach(() => {
        DOM.reset();
    });

    function ctx(label: string): TreeNodeRenderContext {
        return {
            node:        { label },
            depth:       0,
            expanded:    false,
            selected:    false,
            hasChildren: false,
        };
    }

    it('LabelTreeNodeRenderer.getContentWidth equals the measured label width', () => {
        installTestDOM(CONFIG);

        const renderer = new LabelTreeNodeRenderer();
        renderer.update(ctx('Hello'));

        const expected = DOM.source.measureText('Hello').width;
        expect(renderer.getContentWidth()).toBe(expected);
    });

    it('LabelTreeNodeRenderer re-measures on the next update', () => {
        installTestDOM(CONFIG);

        const renderer = new LabelTreeNodeRenderer();
        renderer.update(ctx('Hello'));
        renderer.update(ctx('World'));

        const expected = DOM.source.measureText('World').width;
        expect(renderer.getContentWidth()).toBe(expected);
    });

    it('IconLabelTreeNodeRenderer width is ICON_WIDTH + label width', () => {
        installTestDOM(CONFIG);

        const renderer = new IconLabelTreeNodeRenderer();
        renderer.update(ctx('World'));

        const ICON_WIDTH = 20;
        const expected = ICON_WIDTH + DOM.source.measureText('World').width;
        expect(renderer.getContentWidth()).toBe(expected);
    });

    it('IconLabelTreeNodeRenderer reflects a glyph-resolver swap in its width', () => {
        installTestDOM(CONFIG);

        // The resolver returns a different glyph name on the second update; the
        // width still tracks ICON_WIDTH + the new label's measured width.
        let n = 0;
        const renderer = new IconLabelTreeNodeRenderer(() => (n++ === 0 ? 'file' : 'folder'));

        renderer.update(ctx('Hello'));
        renderer.update(ctx('World'));

        const ICON_WIDTH = 20;
        const expected = ICON_WIDTH + DOM.source.measureText('World').width;
        expect(renderer.getContentWidth()).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// Mounted block: wiring the VirtualScroller requires a real element, so these
// mount the tree (getElement(true)) and inspect the recycled pool rows.
// ---------------------------------------------------------------------------
describe('Tree — rows fill the effective viewport width', () => {
    afterEach(() => DOM.reset());

    it('sizes rows to owner width minus the vertical track and shows no horizontal bar', () => {
        installTestDOM(CONFIG);

        const TRACK_WIDTH = new Scrollbar('vertical').getTrackWidth();

        const tree = new _Tree();
        tree.getElement(true);   // wires the VirtualScroller
        tree.setWidth(200);
        tree.setHeight(120);     // 5 rows visible at ROW_HEIGHT 24

        // Ten short-label roots overflow vertically (10 × 24 = 240 > 120) but
        // not horizontally, so only the vertical bar should appear. Labels are
        // single chars from the baked font so the measured content width stays
        // well under the effective width.
        const labels = ['H', 'e', 'l', 'o', 'W', 'r', 'd', 'x', 'X', 'o'];
        tree.setNodes(labels.map(label => ({ label })));

        const priv = tree as unknown as {
            _rowPool:  Array<{ getWidth(): number }>;
            _scroller: { getScrollX(): number; setScrollX(x: number): void };
        };

        // The first visible pool row fills the effective width (owner − track),
        // not the full owner width — so content never runs under the vertical bar.
        expect(priv._rowPool[0].getWidth()).toBe(200 - TRACK_WIDTH);

        // No horizontal range: the horizontal bar stays hidden (scrollX pinned).
        priv._scroller.setScrollX(99999);
        expect(priv._scroller.getScrollX()).toBe(0);
    });
});

describe('Tree rowOverflow', () => {
    afterEach(() => DOM.reset());

    it('defaults to "scroll"', () => {
        const tree = new _Tree();

        expect(tree.getRowOverflow()).toBe('scroll');
    });

    it('"scroll" (the default) grows a row wider than the viewport to fit its label, rather than clipping it', () => {
        installTestDOM(CONFIG);

        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(100);
        tree.setHeight(24);
        tree.setNodes([{ label: 'Hello World Hello World Hello World Hello World' }]);

        const priv = tree as unknown as { _rowPool: Array<{ getWidth(): number }> };

        expect(priv._rowPool[0].getWidth()).toBeGreaterThan(100);
    });

    it('"clip" caps a row wider than the viewport at the effective viewport width instead of growing to fit it', () => {
        installTestDOM(CONFIG);

        const tree = new _Tree({ rowOverflow: 'clip' });
        tree.getElement(true);
        tree.setWidth(100);
        tree.setHeight(24);
        tree.setNodes([{ label: 'Hello World Hello World Hello World Hello World' }]);

        const priv = tree as unknown as { _rowPool: Array<{ getWidth(): number }> };

        expect(priv._rowPool[0].getWidth()).toBeLessThanOrEqual(100);
    });
});

describe('Tree expandTrigger', () => {
    it('defaults to "dblclick"', () => {
        const tree = new _Tree();

        expect(tree.getExpandTrigger()).toBe('dblclick');
    });

    it('can be set at construction time', () => {
        const tree = new _Tree({ expandTrigger: 'click' });

        expect(tree.getExpandTrigger()).toBe('click');
    });

    it('setExpandTrigger changes what getExpandTrigger reports', () => {
        const tree = new _Tree();

        tree.setExpandTrigger('click');

        expect(tree.getExpandTrigger()).toBe('click');
    });
});

// ---------------------------------------------------------------------------
// Virtual-scroll reconciliation characterization (Phase A of the data-view
// virtualization consolidation). These pin the current behaviour of the shared
// window/pool/geometry machinery so the extraction of `VirtualRowView` is a
// proven no-op. Tree's fixed ROW_HEIGHT is 24. The helpers poked here are the
// shared virtualization primitives; on the pre-extraction Tree they carry the
// `_`-prefixed names below (the extraction repoints these invocations to the
// hoisted base names — the assertions, which pin the behaviour, are unchanged).
// ---------------------------------------------------------------------------
const ROW_HEIGHT = 24;

describe('Tree virtual-scroll — characterization', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    function bigTree(n: number): TreeNode[] {
        return Array.from({ length: n }, (_, i) => ({ label: 'n' + i }));
    }

    function mount(n: number, height: number): _Tree {
        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(200);
        tree.setHeight(height);
        tree.setNodes(bigTree(n));
        (tree as any).renderWindow();
        return tree;
    }

    it('computeVisibleWindow starts at row 0 and pads by SCROLL_BUFFER at the top', () => {
        const p = mount(100, 120) as any;
        const win = p.computeVisibleWindow(0, 120, 100);

        expect(win.firstRow).toBe(0);
        expect(win.lastRow).toBe(Math.min(99, Math.ceil(120 / ROW_HEIGHT) + 2));
        expect(win.windowSize).toBe(win.lastRow - win.firstRow + 1);
    });

    it('computeVisibleWindow pads both edges mid-scroll', () => {
        const p = mount(100, 120) as any;
        const scrollY = 20 * ROW_HEIGHT;
        const win = p.computeVisibleWindow(scrollY, 120, 100);

        expect(win.firstRow).toBe(Math.max(0, Math.floor(scrollY / ROW_HEIGHT) - 2));
        expect(win.lastRow).toBe(Math.min(99, Math.ceil((scrollY + 120) / ROW_HEIGHT) + 2));
    });

    it('computeVisibleWindow clamps lastRow near the bottom and empties for no rows', () => {
        const p = mount(30, 120) as any;

        expect(p.computeVisibleWindow(100000, 120, 30).lastRow).toBe(29);
        expect(p.computeVisibleWindow(0, 120, 0).windowSize).toBe(0);
    });

    it('computePoolTarget grows to the max window capped at totalRows, never below windowSize', () => {
        const p = mount(100, 120) as any;

        expect(p.computePoolTarget(3, 120, 100)).toBe(
            Math.min(100, Math.max(3, Math.ceil(120 / ROW_HEIGHT) + 2 * 2 + 2)),
        );
        expect(p.computePoolTarget(4, 120, 4)).toBe(4);
    });

    it('growRowPool extends every parallel array in lockstep and is monotonic', () => {
        const p = mount(200, 120) as any;
        const before = p._rowPool.length;

        p.growRowPool(before + 5);

        expect(p._rowPool.length).toBe(before + 5);
        expect(p._boundIndices.length).toBe(before + 5);
        expect(p._rowGeom.length).toBe(before + 5);
        expect(p._rowDisplayed.length).toBe(before + 5);

        for (let i = before; i < before + 5; i++) {
            expect(p._boundIndices[i]).toBe(-1);
            expect(p._rowGeom[i]).toBeNull();
            expect(p._rowDisplayed[i]).toBe(false);
            expect(p._rowPool[i].getElement()).toBeTruthy();
        }

        p.growRowPool(before);
        expect(p._rowPool.length).toBe(before + 5);
    });

    it('hideExcessPoolRows hides and unbinds every slot beyond the window size', () => {
        const p = mount(200, 120) as any;
        const poolLen = p._rowPool.length;

        p.hideExcessPoolRows(2);

        for (let i = 2; i < poolLen; i++) {
            expect(p._rowDisplayed[i]).toBe(false);
            expect(p._boundIndices[i]).toBe(-1);
            expect(p._rowGeom[i]).toBeNull();
        }
    });

    it('invalidateGeom clears the row-geometry cache', () => {
        const p = mount(50, 120) as any;
        p._rowGeom[0] = { ty: 5, w: 5, h: 5 };

        p.invalidateGeom();

        expect(p._rowGeom.every((g: unknown) => g === null)).toBe(true);
    });

    it('scrollRowIntoView reveals a below-viewport row and no-ops when already visible', () => {
        const p = mount(100, 100) as any;

        p.scrollRowIntoView(50);
        expect(p._scroller.getScrollY()).toBe(51 * ROW_HEIGHT - 100);

        p.setScrollY(0);
        p.scrollRowIntoView(0);
        expect(p._scroller.getScrollY()).toBe(0);
    });

    // Same mechanism as Body (they share VirtualRowView), tested through the
    // sibling subclass so a refactor that relocates the fix can't leave Tree
    // in the pre-fix state. See Body.test.ts's "single-row scroll pool
    // rebind" test for the full rationale.
    it('a single-row scroll rebinds and repositions only the entering row', () => {
        const p = mount(100, 200) as any;

        p._scroller.setScrollY(20 * ROW_HEIGHT);
        p.renderWindow();

        const pool = p._rowPool as Array<{ setRowData(...args: unknown[]): unknown, setTranslate(...args: unknown[]): unknown }>;
        const setRowDataSpies   = pool.map((row) => vi.spyOn(row, 'setRowData'));
        const setTranslateSpies = pool.map((row) => vi.spyOn(row, 'setTranslate'));

        p._scroller.setScrollY(21 * ROW_HEIGHT);
        p.renderWindow();

        const totalRebinds     = setRowDataSpies.reduce((n, s) => n + s.mock.calls.length, 0);
        const totalRepositions = setTranslateSpies.reduce((n, s) => n + s.mock.calls.length, 0);

        expect(totalRebinds).toBe(1);
        expect(totalRepositions).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Horizontal content width must be stable while scrolling. The width is derived
// from only the *visible* rows, so without a monotonic max it grew and shrank as
// different-width rows scrolled through the window — jittering the horizontal
// scrollbar and snapping scrollX back. The widest row is discovered once and
// then held; a reflatten (setNodes / expand / collapse) re-derives it.
// ---------------------------------------------------------------------------
describe('Tree — horizontal content width is scroll-stable', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    // Rows are 'x' (narrow) except one wide row deep in the list, built from the
    // baked font's char set so its measured advance is genuinely wider.
    const WIDE_ROW  = 42;
    const WIDE_LABEL = 'WoWoWoWoWoWoWoWoWoWo';

    function mixedTree(): TreeNode[] {
        return Array.from({ length: 60 }, (_, i) => ({ label: i === WIDE_ROW ? WIDE_LABEL : 'x' }));
    }

    function mount(): _Tree {
        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(200);
        tree.setHeight(120); // 5 rows visible at ROW_HEIGHT 24
        tree.setNodes(mixedTree());
        (tree as any).renderWindow();
        return tree;
    }

    it('holds the widest discovered row width after that row scrolls out of view', () => {
        const tree = mount();
        const p = tree as any;

        // At the top only narrow 'x' rows are visible: content width is the
        // effective viewport (no horizontal overflow).
        const narrowWidth = p._lastRowWidth;

        // Scroll the wide row into the window; it is measured and widens content.
        p.setScrollY(WIDE_ROW * ROW_HEIGHT);
        const wideWidth = p._lastRowWidth;
        expect(wideWidth).toBeGreaterThan(narrowWidth);

        // Scroll back to the top. The wide row is gone from the window, but the
        // content width must not shrink back — otherwise the H scrollbar jitters.
        p.setScrollY(0);
        expect(p._lastRowWidth).toBe(wideWidth);
    });

    it('re-derives the width when the flattened row set is rebuilt', () => {
        const tree = mount();
        const p = tree as any;

        p.setScrollY(WIDE_ROW * ROW_HEIGHT);
        const wideWidth = p._lastRowWidth;

        // Replace the data with only narrow rows: the reflatten resets the
        // monotonic max, so the stale wide width is dropped.
        tree.setNodes(Array.from({ length: 60 }, () => ({ label: 'x' })));
        (tree as any).renderWindow();

        expect(p._lastRowWidth).toBeLessThan(wideWidth);
    });
});

// ---------------------------------------------------------------------------
// _handleClick's ctrl/cmd-click toggle branch resolves the clicked node from
// a real bound row element, so — unlike the offline block above — it needs a
// mounted tree with a rendered row pool.
// ---------------------------------------------------------------------------
describe('Tree — ctrl/cmd-click selection event fires only on a real change', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    function mount(): _Tree {
        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(200);
        tree.setHeight(200);
        tree.setNodes(fruitTree());
        (tree as any).renderWindow();
        return tree;
    }

    it('toggling the same node off then on with ctrl/cmd-click fires "selection" on both clicks', () => {
        const tree = mount();
        const p = tree as any;
        const nodeA = p._flatRows[0].node;
        const rowA = p._rowPool.find((r: any) => r.getNode() === nodeA);

        // Seed the selection so the first click is a removal.
        p._selectedNodes.add(nodeA);
        p._anchorNode = nodeA;

        const fired: TreeNode[][] = [];
        tree.on('selection', (nodes: TreeNode[]) => fired.push(nodes));

        p._handleClick(makeEvent(rowA.getElement(), 'click', { ctrlKey: true }));
        p._handleClick(makeEvent(rowA.getElement(), 'click', { ctrlKey: true }));

        expect(fired).toHaveLength(2);
        expect(fired[0]).toEqual([]);
        expect(fired[1]).toEqual([nodeA]);
    });
});

// ---------------------------------------------------------------------------
// expandTrigger's row-body toggle in _handleClick. Mounted for the same
// reason as the ctrl/cmd-click block above: the toggle branch resolves the
// clicked node from a real bound row element. `fruitTree()`'s 'Hello' is
// expandable, 'World' is a leaf.
// ---------------------------------------------------------------------------
describe('Tree — expandTrigger row-body toggle (_handleClick)', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    function mount(options?: { expandTrigger?: 'dblclick' | 'click' }): _Tree {
        const tree = new _Tree(options);
        tree.getElement(true);
        tree.setWidth(200);
        tree.setHeight(200);
        tree.setNodes(fruitTree());
        (tree as any).renderWindow();
        return tree;
    }

    it('default mode: a plain click on an expandable row\'s body selects it and leaves _expandedNodes untouched', () => {
        const tree = mount();
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        p._handleClick(makeEvent(rowHello.getElement(), 'click'));

        expect(p._selectedNodes.has(nodeHello)).toBe(true);
        expect(p._expandedNodes.has(nodeHello)).toBe(false);
    });

    it('"click" mode: a plain click on an expandable row\'s body selects it and adds it to _expandedNodes; the same click on an already-expanded row removes it', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        p._handleClick(makeEvent(rowHello.getElement(), 'click'));
        expect(p._selectedNodes.has(nodeHello)).toBe(true);
        expect(p._expandedNodes.has(nodeHello)).toBe(true);

        p._handleClick(makeEvent(rowHello.getElement(), 'click'));
        expect(p._expandedNodes.has(nodeHello)).toBe(false);
    });

    it('"click" mode: a plain click on a leaf row\'s body selects it; _expandedNodes stays empty', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeWorld = p._flatRows.find((r: any) => r.node.label === 'World').node;
        const rowWorld = p._rowPool.find((r: any) => r.getNode() === nodeWorld);

        p._handleClick(makeEvent(rowWorld.getElement(), 'click'));

        expect(p._selectedNodes.has(nodeWorld)).toBe(true);
        expect(p._expandedNodes.size).toBe(0);
    });

    it('"click" mode: a Ctrl/Cmd-click on an expandable row\'s body toggles selection membership only; _expandedNodes stays untouched', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        p._handleClick(makeEvent(rowHello.getElement(), 'click', { ctrlKey: true }));

        expect(p._selectedNodes.has(nodeHello)).toBe(true);
        expect(p._expandedNodes.has(nodeHello)).toBe(false);
    });

    it('"click" mode: a Shift-click on an expandable row\'s body with an anchor already set range-selects only; _expandedNodes stays untouched', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeWorld = p._flatRows.find((r: any) => r.node.label === 'World').node;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        p._anchorNode = nodeWorld;

        p._handleClick(makeEvent(rowHello.getElement(), 'click', { shiftKey: true }));

        expect(p._selectedNodes.has(nodeHello)).toBe(true);
        expect(p._expandedNodes.has(nodeHello)).toBe(false);
    });

    it('"click" mode: a Shift-click on an expandable row\'s body with no anchor set behaves like a plain click — selects and toggles', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        expect(p._anchorNode).toBeNull();

        p._handleClick(makeEvent(rowHello.getElement(), 'click', { shiftKey: true }));

        expect(p._selectedNodes.has(nodeHello)).toBe(true);
        expect(p._expandedNodes.has(nodeHello)).toBe(true);
    });

    it('default mode: a click on the caret still toggles unconditionally', () => {
        const tree = mount();
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        p._handleClick(makeEvent(rowHello.getToggle().getElement(), 'click'));

        expect(p._expandedNodes.has(nodeHello)).toBe(true);
    });

    it('"click" mode: a click on the caret still toggles unconditionally', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        p._handleClick(makeEvent(rowHello.getToggle().getElement(), 'click'));

        expect(p._expandedNodes.has(nodeHello)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// expandTrigger's effect on _handleDblClick's own row-body toggle skip.
// `_handleDblClick` had no prior test coverage at all, so the default-mode
// case here is this path's first-ever regression net, not just coverage for
// the new mode.
// ---------------------------------------------------------------------------
describe('Tree — expandTrigger and _handleDblClick', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    function mount(options?: { expandTrigger?: 'dblclick' | 'click' }): _Tree {
        const tree = new _Tree(options);
        tree.getElement(true);
        tree.setWidth(200);
        tree.setHeight(200);
        tree.setNodes(fruitTree());
        (tree as any).renderWindow();
        return tree;
    }

    it('default mode: a double-click on an expandable row\'s body emits "dblclick" with the node and toggles _expandedNodes once', () => {
        const tree = mount();
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        const fired: TreeNode[] = [];
        tree.on('dblclick', (node: TreeNode) => fired.push(node));

        p._handleDblClick(makeEvent(rowHello.getElement(), 'dblclick'));

        expect(fired).toEqual([nodeHello]);
        expect(p._expandedNodes.has(nodeHello)).toBe(true);
    });

    it('"click" mode: a full double-click (two _handleClick calls, then _handleDblClick) emits "dblclick" but leaves _expandedNodes in the same membership state it had before the gesture', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        expect(p._expandedNodes.has(nodeHello)).toBe(false);

        const fired: TreeNode[] = [];
        tree.on('dblclick', (node: TreeNode) => fired.push(node));

        p._handleClick(makeEvent(rowHello.getElement(), 'click'));
        p._handleClick(makeEvent(rowHello.getElement(), 'click'));
        p._handleDblClick(makeEvent(rowHello.getElement(), 'dblclick'));

        expect(fired).toEqual([nodeHello]);
        expect(p._expandedNodes.has(nodeHello)).toBe(false);
    });

    it('default mode: a double-click on a leaf row\'s body emits "dblclick" and never touches _expandedNodes', () => {
        const tree = mount();
        const p = tree as any;
        const nodeWorld = p._flatRows.find((r: any) => r.node.label === 'World').node;
        const rowWorld = p._rowPool.find((r: any) => r.getNode() === nodeWorld);

        const fired: TreeNode[] = [];
        tree.on('dblclick', (node: TreeNode) => fired.push(node));

        p._handleDblClick(makeEvent(rowWorld.getElement(), 'dblclick'));

        expect(fired).toEqual([nodeWorld]);
        expect(p._expandedNodes.size).toBe(0);
    });

    it('"click" mode: a double-click on a leaf row\'s body emits "dblclick" and never touches _expandedNodes', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeWorld = p._flatRows.find((r: any) => r.node.label === 'World').node;
        const rowWorld = p._rowPool.find((r: any) => r.getNode() === nodeWorld);

        const fired: TreeNode[] = [];
        tree.on('dblclick', (node: TreeNode) => fired.push(node));

        p._handleClick(makeEvent(rowWorld.getElement(), 'click'));
        p._handleDblClick(makeEvent(rowWorld.getElement(), 'dblclick'));

        expect(fired).toEqual([nodeWorld]);
        expect(p._expandedNodes.size).toBe(0);
    });

    it('default mode: a double-click on the caret emits "dblclick" and does not toggle a third time', () => {
        const tree = mount();
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        const fired: TreeNode[] = [];
        tree.on('dblclick', (node: TreeNode) => fired.push(node));

        // This is a white-box unit test of `_handleDblClick`'s skip-condition
        // logic, not a faithful reproduction of what a real caret double-click
        // delivers: `setRowData` (TreeRow.ts:144,167,171) tears down and
        // recreates `_toggle` on every expand/collapse rebind, and a browser
        // freezes a native "dblclick" event's target to whatever the second
        // click's own pre-handler hit-test resolved — which that same click's
        // handler then detaches by rebinding again. A detached target has no
        // ancestors to bubble through, so `Event.addSubtreeListener`'s
        // delegated dblclick listener likely never receives it in a real
        // browser, meaning `_handleDblClick` (Tree.ts:1225) may not even run
        // for a genuine caret double-click, in either `expandTrigger` mode.
        // This is a pre-existing gap in the caret's own dblclick delivery,
        // predating and unrelated to `expandTrigger` — see the plan's
        // Implementation Notes. Re-reading the toggle element fresh before
        // each dispatch (rather than caching it) exercises the skip condition
        // itself, which is what this test pins.
        p._handleClick(makeEvent(rowHello.getToggle().getElement(), 'click'));
        p._handleClick(makeEvent(rowHello.getToggle().getElement(), 'click'));
        p._handleDblClick(makeEvent(rowHello.getToggle().getElement(), 'dblclick'));

        expect(fired).toEqual([nodeHello]);
        expect(p._expandedNodes.has(nodeHello)).toBe(false);
    });

    it('"click" mode: a double-click on the caret emits "dblclick" and does not toggle a third time', () => {
        const tree = mount({ expandTrigger: 'click' });
        const p = tree as any;
        const nodeHello = p._flatRows[0].node;
        const rowHello = p._rowPool.find((r: any) => r.getNode() === nodeHello);

        const fired: TreeNode[] = [];
        tree.on('dblclick', (node: TreeNode) => fired.push(node));

        // See the default-mode test above for why this is a white-box unit
        // test of the skip condition rather than a faithful reproduction of
        // real caret dblclick delivery.
        p._handleClick(makeEvent(rowHello.getToggle().getElement(), 'click'));
        p._handleClick(makeEvent(rowHello.getToggle().getElement(), 'click'));
        p._handleDblClick(makeEvent(rowHello.getToggle().getElement(), 'dblclick'));

        expect(fired).toEqual([nodeHello]);
        expect(p._expandedNodes.has(nodeHello)).toBe(false);
    });
});
