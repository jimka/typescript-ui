import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { DOM } from '~/core/DOM';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import type { TreeNodeRenderContext } from '~/component/tree/TreeNodeRenderContext';
import { TreeNodeRenderer } from '~/component/tree/TreeNodeRenderer';
import { LabelTreeNodeRenderer } from '~/component/tree/renderer/Label';
import { IconLabelTreeNodeRenderer } from '~/component/tree/renderer/IconLabel';
import { Glyph } from '~/component/display/Glyph';
import { installTestDOM } from '../../dom/TestDOM';
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
    _flatRows: FlatRow[];
    _expandedNodes: Set<TreeNode>;
}

function asPrivate(tree: _Tree): TreePrivate {
    return tree as unknown as TreePrivate;
}

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
