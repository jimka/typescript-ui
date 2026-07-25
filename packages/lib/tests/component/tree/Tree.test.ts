import { describe, it, expect, afterEach, beforeEach, beforeAll } from 'vitest';
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

    it('defaults its preferred size to 200×300', () => {
        const tree = new _Tree();
        const pref = tree.getPreferredSize();

        expect(pref?.width).toBe(200);
        expect(pref?.height).toBe(300);
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
        const priv = tree as unknown as { _loadAndExpand(node: TreeNode): Promise<void> };
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
