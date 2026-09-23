// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins the tree half of plans/implemented/list-and-tree-row-economy.md
// (`## Expected Behaviour` cases 16-23): `Tree.doLayout` re-renders the row
// window only when the tree's own box — its outer height and its content box —
// differs from the one the last render read, and every other input reaches the
// rows through the call that changed it. The two paths that used to rely on an
// unrelated layout pass to finish their work, `setRowOverflow` and the
// Ctrl/Cmd-click selection toggle, now render themselves.
//
// Kept out of `Tree.test.ts` deliberately: the frame capture below is
// file-scoped state, and `Component.afterNextLayout`'s single module-level
// frame leaks between files that share one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _Tree } from '~/component/tree/Tree';
import { _TreeRow } from '~/component/tree/TreeRow';
import { LabelTreeNodeRenderer } from '~/component/tree/renderer/Label';
import type { TreeNode } from '~/component/tree/TreeNode';
import { Insets } from '~/primitive/Insets';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The settle mechanism runs on an animation frame (via Component.afterNextLayout
// — see VirtualRowView.ts's scheduleResizeSettle), and the offline sink drops
// `requestAnimationFrame` outright — capture frames so a burst can be driven
// to completion. Copied from `ResizeLayoutEconomy.test.ts`, whose file header
// explains the shape: a settle relay left armed leaks into the next test.
let frames: Map<number, FrameRequestCallback> = new Map();
let nextHandle = 0;
let trees: _Tree[] = [];
let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
    frames = new Map();
    nextHandle = 0;
    trees = [];
    (DOM.sink as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
        const handle = ++nextHandle;
        frames.set(handle, cb);
        return handle;
    };
    (DOM.sink as any).cancelAnimationFrame = (handle: number): void => {
        frames.delete(handle);
    };
});
afterEach(() => {
    vi.restoreAllMocks();
    for (const tree of trees) {
        tree.dispose();
    }

    // A still-armed settle handle leaves Component's shared afterNextLayout
    // flush queued — cancel() only sets a flag (Component.afterNextLayout's
    // contract), it doesn't deregister the frame. Drain it here so a test
    // that ends mid-burst doesn't leave Component's module-level rafHandle
    // non-null, which would make the next test's own scheduleResizeSettle()
    // find a flush already "pending" and skip registering a fresh frame.
    runFrames();
    DOM.reset();
});

/**
 * Drains every currently captured frame, including any a callback schedules
 * in turn (a settle frame that re-arms itself lands in a fresh generation and
 * this keeps draining until none remain). Use this to run a burst to its
 * final, settled state.
 */
function runFrames(): void {
    for (let guard = 0; guard < 10 && frames.size > 0; guard++) {
        const pending = frames;
        frames = new Map();
        for (const callback of pending.values()) {
            callback(0);
        }
    }
}

/** Short, single-character labels so the renderer measures real advances without a wide alphabet. */
const CHARS = 'HeloWrdxXaBcDfGiJkLmNpQtUvYz';

function makeNodes(count: number): TreeNode[] {
    return Array.from({ length: count }, (_, i) => ({ label: CHARS[i % CHARS.length] }));
}

/**
 * Long enough, in the baked test font, that its natural width exceeds the
 * 100px row box case 21 mounts — the same string `Tree.test.ts`'s own
 * `rowOverflow` cases use against the same font.
 */
const LONG_LABEL = 'Hello World '.repeat(12).trim();

type TreePrivate = {
    _rowPool: _TreeRow[];
    _rowDisplayed: boolean[];
    _flatRows: Array<{ node: TreeNode }>;
};

function pooledRows(tree: _Tree): _TreeRow[] {
    return (tree as unknown as TreePrivate)._rowPool;
}

function displayedRows(tree: _Tree): _TreeRow[] {
    const priv = tree as unknown as TreePrivate;
    return priv._rowPool.filter((_, i) => priv._rowDisplayed[i]);
}

function flatNode(tree: _Tree, index: number): TreeNode {
    return (tree as unknown as TreePrivate)._flatRows[index].node;
}

/**
 * Mounts a tree over `nodeCount` short-labelled rows at `width` x `height`,
 * then drains the startup settle frame every fresh `VirtualRowView` arms (its
 * first render's width counts as a change from the initial 0) so a test starts
 * from a genuinely settled state instead of counting that harmless startup
 * frame as part of its own burst.
 */
function makeSettledTree(nodeCount: number, width: number, height: number): _Tree {
    const tree = new _Tree();
    trees.push(tree);

    tree.getElement(true);
    tree.setWidth(width);
    tree.setHeight(height);
    tree.setNodes(makeNodes(nodeCount));
    runFrames();

    return tree;
}

/** The fixture every case below measures against: a settled tree plus a spy on its render pass. */
function settledTreeWithRenderSpy(): { tree: _Tree; renderWindow: ReturnType<typeof vi.spyOn> } {
    const tree = makeSettledTree(20, 300, 120);

    return { tree, renderWindow: vi.spyOn(tree as any, 'renderWindow') };
}

describe('Tree.doLayout — re-renders only when the tree\'s box changed (render-pass-economy)', () => {
    it('case 16: an unchanged layout pass renders nothing and writes nothing', () => {
        const { tree, renderWindow } = settledTreeWithRenderSpy();

        renderWindow.mockClear();
        const start = sink.writes.length;

        tree.doLayout();

        expect(renderWindow).not.toHaveBeenCalled();
        expect(sink.writes.slice(start)).toEqual([]);
    });

    it('case 17: a width change renders once, and the pass after it renders no more', () => {
        const { tree, renderWindow } = settledTreeWithRenderSpy();

        tree.setWidth(340);
        renderWindow.mockClear();

        tree.doLayout();

        expect(renderWindow).toHaveBeenCalledTimes(1);

        renderWindow.mockClear();

        tree.doLayout();

        expect(renderWindow).not.toHaveBeenCalled();
    });

    it('case 18: a height change renders once and shows more rows', () => {
        const { tree, renderWindow } = settledTreeWithRenderSpy();
        const before = displayedRows(tree).length;

        tree.setHeight(168);
        renderWindow.mockClear();

        tree.doLayout();

        expect(renderWindow).toHaveBeenCalledTimes(1);
        expect(displayedRows(tree).length).toBeGreaterThan(before);
    });

    it('case 19: a padding change renders once although the outer size held still', () => {
        const { tree, renderWindow } = settledTreeWithRenderSpy();

        // Four equal sides, so the outer box is untouched and only the content
        // box moves — the half of the record the outer height alone would miss.
        tree.setPadding(new Insets(4, 4, 4, 4));
        renderWindow.mockClear();

        tree.doLayout();

        expect(renderWindow).toHaveBeenCalledTimes(1);
    });

    it('case 20: every other render input renders through the call that changed it, and owes the next pass nothing', () => {
        const { tree, renderWindow } = settledTreeWithRenderSpy();

        /**
         * Runs `change`, then asserts it rendered and that the layout pass
         * right after it does not render again.
         */
        const expectSelfRendering = (name: string, change: () => void): void => {
            renderWindow.mockClear();

            change();

            expect(renderWindow, name + ' did not render itself').toHaveBeenCalled();

            renderWindow.mockClear();

            tree.doLayout();

            expect(renderWindow, name + ' left a render owed to doLayout').not.toHaveBeenCalled();
        };

        expectSelfRendering('selectNode', () => tree.selectNode(flatNode(tree, 3)));
        expectSelfRendering('setScrollY', () => tree.setScrollY(48));
        expectSelfRendering('setNodes', () => tree.setNodes(makeNodes(20)));
        expectSelfRendering('notifyNodeChanged', () => tree.notifyNodeChanged(flatNode(tree, 1)));
        expectSelfRendering('setRendererFactory', () => tree.setRendererFactory(() => new LabelTreeNodeRenderer()));

        const branch = { label: 'branch', children: [{ label: 'x' }, { label: 'y' }] };
        const other  = new _Tree();
        trees.push(other);
        other.getElement(true);
        other.setWidth(300);
        other.setHeight(120);
        other.setNodes([branch]);
        runFrames();

        const otherRender = vi.spyOn(other as any, 'renderWindow');
        otherRender.mockClear();

        other.expandNode(branch);

        expect(otherRender, 'expandNode did not render itself').toHaveBeenCalled();

        otherRender.mockClear();

        other.doLayout();

        expect(otherRender, 'expandNode left a render owed to doLayout').not.toHaveBeenCalled();
    });

    it('case 21: setRowOverflow takes effect with no layout pass behind it', () => {
        const tree = new _Tree();
        trees.push(tree);

        tree.getElement(true);
        tree.setWidth(100);
        tree.setHeight(24);
        tree.setNodes([{ label: LONG_LABEL }]);
        runFrames();

        expect(pooledRows(tree)[0].getWidth()).toBeGreaterThan(100);

        tree.setRowOverflow('clip');

        expect(pooledRows(tree)[0].getWidth()).toBeLessThanOrEqual(100);

        tree.setRowOverflow('scroll');

        expect(pooledRows(tree)[0].getWidth()).toBeGreaterThan(100);
    });

    it('case 22: a Ctrl-click rebinds the row it toggles, so its renderer sees the new selected flag', () => {
        const tree = makeSettledTree(20, 300, 120);
        const rowB = pooledRows(tree)[1];
        const node = rowB.getNode()!;

        let selections = 0;
        tree.on('selection', () => { selections += 1; });

        const update = vi.spyOn(rowB.getRenderer(), 'update');
        const click  = (): void => {
            (tree as any)._handleClick(makeEvent(rowB.getElement()!, 'click', { ctrlKey: true }));
        };

        click();

        expect(update).toHaveBeenCalledWith(expect.objectContaining({ node, selected: true }));
        expect(selections).toBe(1);

        update.mockClear();

        click();

        expect(update).toHaveBeenCalledWith(expect.objectContaining({ node, selected: false }));
        expect(selections).toBe(2);
    });

    it('case 23: an unrendered tree lays out safely, and a settled one renders nothing on the next pass', () => {
        const tree = new _Tree();
        trees.push(tree);

        const start = sink.writes.length;

        expect(() => tree.doLayout()).not.toThrow();
        expect(sink.writes.slice(start)).toEqual([]);

        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);
        tree.setNodes(makeNodes(20));
        runFrames();

        const renderWindow = vi.spyOn(tree as any, 'renderWindow');

        tree.doLayout();

        expect(renderWindow).not.toHaveBeenCalled();
    });
});
