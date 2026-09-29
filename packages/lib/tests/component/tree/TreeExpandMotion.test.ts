// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins plans/implemented/tree-expand-collapse-animation.md's Tree row-motion
// cases (`## Expected Behaviour`, M1-M15). A single expand/collapse commits
// its state and its final-state render synchronously in the same call, then
// VirtualRowView's Animation.tween-based row motion rewinds the affected
// rows on the next animation frame and plays them forward over 200ms.
//
// Frame-and-clock harness: the offline sink drops requestAnimationFrame
// outright, so it is captured (copied from RenderPassEconomy.test.ts) and
// driven by hand. Animation.tween reads its frame callback's `now` argument
// to compute progress, so performance.now() is mocked to a controllable
// `clock` variable that each driven frame's timestamp is set from.
//
// Kept out of Tree.test.ts deliberately, same reason RenderPassEconomy.test.ts
// is: the frame capture below is file-scoped state that would otherwise leak
// between files sharing the same module-level rAF plumbing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Animation } from '~/core/Animation';
import { COLLAPSE_EASE } from '~/layout/CollapseSupport';
import { _Tree } from '~/component/tree/Tree';
import { _TreeRow } from '~/component/tree/TreeRow';
import type { TreeNode } from '~/component/tree/TreeNode';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Mirrors Tree.ts's own fixed row height. */
const ROW_HEIGHT = 24;

let frames: Map<number, FrameRequestCallback> = new Map();
let nextHandle = 0;
let clock = 0;
let trees: _Tree[] = [];
let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
    frames = new Map();
    nextHandle = 0;
    clock = 0;
    trees = [];

    vi.spyOn(performance, 'now').mockImplementation(() => clock);

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
    for (const tree of trees) {
        tree.dispose();
    }

    // A motion left running would otherwise leak its captured frame into the
    // next test's `frames` map.
    runFrames();
    vi.restoreAllMocks();
    DOM.reset();
});

/** Sets the clock to `now` and runs every frame captured so far at that timestamp. */
function runFrame(now: number): void {
    clock = now;

    const pending = frames;
    frames = new Map();

    for (const callback of pending.values()) {
        callback(now);
    }
}

/** Drains every captured frame — including any a callback re-schedules — at the current clock. */
function runFrames(): void {
    for (let guard = 0; guard < 10 && frames.size > 0; guard++) {
        const pending = frames;
        frames = new Map();

        for (const callback of pending.values()) {
            callback(clock);
        }
    }
}

/**
 * Jumps the clock far past any running tween's duration and drives one frame,
 * so it completes regardless of exactly how much of it had already played.
 * Also settles the unrelated frame sources the offline harness schedules
 * alongside it (`Component.afterNextLayout`'s flush, a `Scrollbar`'s
 * visibility reconcile) — none of which read the clock, so jumping it has no
 * effect on them beyond draining whatever they left pending.
 */
function settle(): void {
    runFrame(clock + 100_000);
}

// ---------------------------------------------------------------------------
// White-box access, mirroring Tree.test.ts's own `asPrivate`/`asPool` casts:
// the render pool and the toggle/keyboard entry points used to drive and
// observe a motion are private.
// ---------------------------------------------------------------------------
interface TreePrivate {
    _onToggle(node: TreeNode): void;
    _onKeyDown(e: KeyboardEvent): void;
    _handleClick(e: MouseEvent): void;
    _selectAtIndex(index: number): void;
    isRowMotionRunning(): boolean;
    _flatRows: Array<{ node: TreeNode; depth: number }>;
    _rowPool: _TreeRow[];
    _boundIndices: number[];
    _scroller: { getScrollY(): number; layoutScrollbars(w: number, h: number): void } | null;
}

function asPrivate(tree: _Tree): TreePrivate {
    return tree as unknown as TreePrivate;
}

/** The pool slot bound to `node`, or `-1` when none is currently bound and displayed. */
function slotFor(tree: _Tree, node: TreeNode): number {
    const p = asPrivate(tree);

    return p._rowPool.findIndex((row, i) => p._boundIndices[i] >= 0 && row.getNode() === node);
}

function rowFor(tree: _Tree, node: TreeNode): _TreeRow {
    const slot = slotFor(tree, node);

    expect(slot).toBeGreaterThanOrEqual(0);

    return asPrivate(tree)._rowPool[slot];
}

/** True when some pool slot is currently bound and displayed for `node`. */
function isDisplayed(tree: _Tree, node: TreeNode): boolean {
    return slotFor(tree, node) >= 0;
}

interface Fixture {
    A: TreeNode;
    B: TreeNode;
    b1: TreeNode;
    b2: TreeNode;
    b3: TreeNode;
    C: TreeNode;
    D: TreeNode;
    nodes: TreeNode[];
}

function fixtureNodes(): Fixture {
    const b1: TreeNode = { label: 'b1' };
    const b2: TreeNode = { label: 'b2' };
    const b3: TreeNode = { label: 'b3' };
    const B:  TreeNode = { label: 'B', children: [b1, b2, b3] };
    const A:  TreeNode = { label: 'A' };
    const C:  TreeNode = { label: 'C' };
    const D:  TreeNode = { label: 'D' };

    return { A, B, b1, b2, b3, C, D, nodes: [A, B, C, D] };
}

/**
 * Mounts a 300x120 tree (5 visible rows at `ROW_HEIGHT`) over `A B{b1 b2 b3} C D`,
 * every node collapsed — the fixture the plan's worked example and M1-M8 and
 * M11-M15 use.
 */
function mountFixture(): { tree: _Tree; fx: Fixture } {
    const fx   = fixtureNodes();
    const tree = new _Tree();

    trees.push(tree);
    tree.getElement(true);
    tree.setWidth(300);
    tree.setHeight(120);
    tree.setNodes(fx.nodes);

    return { tree, fx };
}

/** Mounts a 300x120 tree over one root branch `E` with `childCount` leaf children, collapsed. */
function mountSingleBranch(childCount: number): { tree: _Tree; E: TreeNode } {
    const E: TreeNode = { label: 'E', children: Array.from({ length: childCount }, (_, i) => ({ label: 'c' + i })) };
    const tree = new _Tree();

    trees.push(tree);
    tree.getElement(true);
    tree.setWidth(300);
    tree.setHeight(120);
    tree.setNodes([E]);

    return { tree, E };
}

describe('Tree — expand/collapse row motion', () => {

    it('M1: the commit is synchronous — state, event, and the final-position render all land before any frame runs', () => {
        const { tree, fx } = mountFixture();
        let expandCount = 0;
        tree.on('expand', () => { expandCount += 1; });

        tree.expandNode(fx.B);

        expect(tree.getExpandedNodes()).toEqual([fx.B]);
        expect(expandCount).toBe(1);
        expect(asPrivate(tree)._flatRows).toHaveLength(7);

        const p = asPrivate(tree);
        for (let i = 0; i < p._rowPool.length; i++) {
            if (p._boundIndices[i] < 0) { continue; }
            expect(p._rowPool[i].getTranslateY()).toBe(p._boundIndices[i] * ROW_HEIGHT);
            expect(p._rowPool[i].getOpacity()).toBeNull();
        }
    });

    it('M2: expand frames follow the slide-and-fade formula at r=0 and r=0.5, growing the content height', () => {
        const { tree, fx } = mountFixture();
        const scroller = asPrivate(tree)._scroller!;
        const layoutSpy = vi.spyOn(scroller, 'layoutScrollbars');

        clock = 1000;
        tree.expandNode(fx.B);

        runFrame(1000); // r = 0: children hidden under B, C/D at their pre-expand rows.
        expect(rowFor(tree, fx.b1).getTranslateY()).toBe(-24);
        expect(rowFor(tree, fx.b1).getOpacity()).toBe(0);
        expect(rowFor(tree, fx.b2).getTranslateY()).toBe(0);
        expect(rowFor(tree, fx.b2).getOpacity()).toBe(0);
        expect(rowFor(tree, fx.b3).getTranslateY()).toBe(24);
        expect(rowFor(tree, fx.b3).getOpacity()).toBe(0);
        expect(rowFor(tree, fx.C).getTranslateY()).toBe(48);
        expect(rowFor(tree, fx.D).getTranslateY()).toBe(72);
        expect(layoutSpy.mock.calls.at(-1)?.[1]).toBe(96);

        runFrame(1100); // r = 0.5.
        expect(rowFor(tree, fx.b1).getTranslateY()).toBeCloseTo(12);
        expect(rowFor(tree, fx.b1).getOpacity()).toBeCloseTo(0);
        expect(rowFor(tree, fx.b2).getTranslateY()).toBeCloseTo(36);
        expect(rowFor(tree, fx.b2).getOpacity()).toBeCloseTo(0.5);
        expect(rowFor(tree, fx.b3).getTranslateY()).toBeCloseTo(60);
        expect(rowFor(tree, fx.b3).getOpacity()).toBeCloseTo(1);
        expect(rowFor(tree, fx.C).getTranslateY()).toBeCloseTo(84);
        expect(rowFor(tree, fx.D).getTranslateY()).toBeCloseTo(108);
        expect(layoutSpy.mock.calls.at(-1)?.[1]).toBeCloseTo(132);
    });

    it('M3: the motion settles at the final positions and requests no further frame', () => {
        const { tree, fx } = mountFixture();
        const scroller  = asPrivate(tree)._scroller!;
        const layoutSpy = vi.spyOn(scroller, 'layoutScrollbars');
        const tweenSpy  = vi.spyOn(Animation, 'tween');

        clock = 1000;
        tree.expandNode(fx.B);
        runFrame(1000);
        runFrame(1100);
        runFrame(1200);

        const p = asPrivate(tree);
        for (let i = 0; i < p._rowPool.length; i++) {
            if (p._boundIndices[i] < 0) { continue; }
            expect(p._rowPool[i].getTranslateY()).toBe(p._boundIndices[i] * ROW_HEIGHT);
            expect(p._rowPool[i].getOpacity()).toBeNull();
            expect(p._rowPool[i].getPointerEvents()).not.toBe('none');
        }
        expect(layoutSpy.mock.calls.at(-1)?.[1]).toBe(168);
        // The one tween this motion ever drives; settling schedules no second one.
        expect(tweenSpy).toHaveBeenCalledTimes(1);
    });

    it('M4: a collapse plays the same motion in reverse, from the pre-collapse row list', () => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        settle(); // settle the expand first.

        let collapseCount = 0;
        tree.on('collapse', () => { collapseCount += 1; });

        clock = 1000;
        asPrivate(tree)._onToggle(fx.B);

        expect(asPrivate(tree)._flatRows).toHaveLength(4);
        expect(collapseCount).toBe(1);

        runFrame(1000); // r = 1: the pre-collapse positions, unchanged.
        expect(rowFor(tree, fx.b1).getTranslateY()).toBe(48);
        expect(rowFor(tree, fx.b2).getTranslateY()).toBe(72);
        expect(rowFor(tree, fx.b3).getTranslateY()).toBe(96);

        runFrame(1100); // r = 0.5.
        expect(rowFor(tree, fx.b1).getTranslateY()).toBeCloseTo(12);
        expect(rowFor(tree, fx.b2).getTranslateY()).toBeCloseTo(36);
        expect(rowFor(tree, fx.b3).getTranslateY()).toBeCloseTo(60);

        runFrame(1200); // settle.
        expect(isDisplayed(tree, fx.b1)).toBe(false);
        expect(isDisplayed(tree, fx.b2)).toBe(false);
        expect(isDisplayed(tree, fx.b3)).toBe(false);
        expect(rowFor(tree, fx.C).getTranslateY()).toBe(48);
        expect(rowFor(tree, fx.D).getTranslateY()).toBe(72);
    });

    it('M5: rows inside the toggled block ignore the pointer during an expand and a collapse motion; rows outside it do not', () => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        runFrame(0);
        runFrame(100);

        expect(rowFor(tree, fx.b1).getPointerEvents()).toBe('none');
        expect(rowFor(tree, fx.b2).getPointerEvents()).toBe('none');
        expect(rowFor(tree, fx.b3).getPointerEvents()).toBe('none');
        expect(rowFor(tree, fx.A).getPointerEvents()).not.toBe('none');
        expect(rowFor(tree, fx.B).getPointerEvents()).not.toBe('none');
        expect(rowFor(tree, fx.C).getPointerEvents()).not.toBe('none');
        expect(rowFor(tree, fx.D).getPointerEvents()).not.toBe('none');

        settle();

        clock = 1000;
        asPrivate(tree)._onToggle(fx.B); // the M4 collapse.

        for (const now of [1000, 1100]) {
            runFrame(now);

            expect(rowFor(tree, fx.b1).getPointerEvents()).toBe('none');
            expect(rowFor(tree, fx.b2).getPointerEvents()).toBe('none');
            expect(rowFor(tree, fx.b3).getPointerEvents()).toBe('none');
            expect(rowFor(tree, fx.A).getPointerEvents()).not.toBe('none');
            expect(rowFor(tree, fx.B).getPointerEvents()).not.toBe('none');
            expect(rowFor(tree, fx.C).getPointerEvents()).not.toBe('none');
            expect(rowFor(tree, fx.D).getPointerEvents()).not.toBe('none');
        }
    });

    it('M6: re-toggling the same node mid-motion retargets instead of restarting from the far end', () => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        runFrame(0);
        runFrame(80); // the expand is now at r = COLLAPSE_EASE(0.4).

        const snapshot = [fx.b1, fx.b2, fx.b3, fx.C, fx.D].map(node => rowFor(tree, node).getTranslateY());

        let collapseCount = 0;
        tree.on('collapse', () => { collapseCount += 1; });

        asPrivate(tree)._onToggle(fx.B); // collapse while the expand is still at r=0.4, clock unchanged (80).

        expect(collapseCount).toBe(1);

        runFrame(80); // the retargeted tween's own first frame (t=0) reads back the same reveal.
        const afterRetarget = [fx.b1, fx.b2, fx.b3, fx.C, fx.D].map(node => rowFor(tree, node).getTranslateY());
        expect(afterRetarget).toEqual(snapshot);

        // A retarget from r~0.34 finishes in ~68ms — well inside 150ms — whereas
        // a non-retargeted collapse (from=1) would still be running at this point.
        // (settle() itself would also prove this, just without pinning the timing.)
        runFrame(230);
        expect(isDisplayed(tree, fx.b1)).toBe(false);
        expect(isDisplayed(tree, fx.b2)).toBe(false);
        expect(isDisplayed(tree, fx.b3)).toBe(false);
    });

    /**
     * Asserts the pool renders `_flatRows` at its final state: every displayed
     * slot is bound to the node at its flat index and sits at `index * H`,
     * and no pool row carries an opacity or `pointer-events: none`.
     */
    function expectFinalRender(tree: _Tree): void {
        const p = asPrivate(tree);

        for (let i = 0; i < p._rowPool.length; i++) {
            const row = p._rowPool[i];

            expect(row.getOpacity()).toBeNull();
            expect(row.getPointerEvents()).toBeNull();

            if (p._boundIndices[i] < 0) { continue; }
            expect(row.getNode()).toBe(p._flatRows[p._boundIndices[i]].node);
            expect(row.getTranslateY()).toBe(p._boundIndices[i] * ROW_HEIGHT);
        }
    }

    /** Everything a frame could change on the pool: binding, position, opacity, pointer. */
    function poolSnapshot(tree: _Tree): unknown[] {
        const p = asPrivate(tree);

        return p._rowPool.map((row, i) => [
            p._boundIndices[i], row.getNode(), row.getTranslateY(), row.getOpacity(), row.getPointerEvents(),
        ]);
    }

    const STOPPERS: Array<[string, (tree: _Tree, fx: Fixture) => void, (tree: _Tree, fx: Fixture) => void]> = [
        ['setChildren(B, [...])',
            (tree, fx) => { tree.setChildren(fx.B, [{ label: 'z1' }]); },
            (tree, fx) => { expect(asPrivate(tree)._flatRows.map(r => r.node.label)).toEqual(['A', 'B', 'z1', 'C', 'D']); }],
        ['insertNode(null, 0, X)',
            (tree) => { tree.insertNode(null, 0, { label: 'X' }); },
            (tree) => { expect(asPrivate(tree)._flatRows.map(r => r.node.label)).toEqual(['X', 'A', 'B', 'b1', 'b2', 'b3', 'C', 'D']); }],
        ['removeNode(C)',
            (tree, fx) => { tree.removeNode(fx.C); },
            (tree, fx) => { expect(isDisplayed(tree, fx.C)).toBe(false); expect(asPrivate(tree)._flatRows).toHaveLength(6); }],
        ['setNodes(...)',
            (tree) => { tree.setNodes([{ label: 'P' }, { label: 'Q' }]); },
            (tree) => { expect(asPrivate(tree)._flatRows.map(r => r.node.label)).toEqual(['P', 'Q']); }],
        ['expandAll()',
            (tree) => { tree.expandAll(); },
            (tree) => { expect(asPrivate(tree)._flatRows).toHaveLength(7); }],
    ];

    it.each(STOPPERS)('M7: %s during a motion stops it and renders the new state at once', (_name, act, check) => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        runFrame(0);
        runFrame(80); // mid-motion: b1-b3 are faded and C/D displaced.

        act(tree, fx);

        check(tree, fx);
        expectFinalRender(tree);

        const before = poolSnapshot(tree);
        runFrame(100);
        runFrames();
        settle();
        expect(poolSnapshot(tree)).toEqual(before);
    });

    it('M8: expandAll, revealByPredicate and setNodes never animate', async () => {
        const { tree, fx } = mountFixture();
        const tweenSpy = vi.spyOn(Animation, 'tween');

        tree.expandAll();
        await tree.revealByPredicate(() => false);
        tree.setNodes(fx.nodes);

        expect(tweenSpy).not.toHaveBeenCalled();
    });

    it('M9: a block that exactly fills the viewport animates; one row taller snaps', () => {
        const tweenSpy = vi.spyOn(Animation, 'tween');

        const fits = mountSingleBranch(5);
        fits.tree.expandNode(fits.E);
        expect(tweenSpy).toHaveBeenCalledTimes(1);

        tweenSpy.mockClear();

        const overflows = mountSingleBranch(6);
        overflows.tree.expandNode(overflows.E);
        expect(tweenSpy).not.toHaveBeenCalled();
    });

    it('M10: a collapse whose commit clamps the scroll offset snaps instead of animating', () => {
        const tree = new _Tree();
        trees.push(tree);
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);

        const leaves = Array.from({ length: 20 }, (_, i) => ({ label: 'r' + i }));
        const z1: TreeNode = { label: 'z1' };
        const z2: TreeNode = { label: 'z2' };
        const z3: TreeNode = { label: 'z3' };
        const Z:  TreeNode = { label: 'Z', children: [z1, z2, z3] };

        tree.setNodes([...leaves, Z]);

        clock = 0;
        tree.expandNode(Z);
        settle(); // settle: 24 flat rows now.

        tree.setScrollY(24 * ROW_HEIGHT); // scrolled to (past) the end.
        const scrollBefore = asPrivate(tree)._scroller!.getScrollY();

        const tweenSpy = vi.spyOn(Animation, 'tween');
        asPrivate(tree)._onToggle(Z); // collapsing drops 3 rows, so the commit re-clamps the scroll offset.

        expect(tweenSpy).not.toHaveBeenCalled();
        expect(asPrivate(tree)._scroller!.getScrollY()).toBeLessThan(scrollBefore);
        expect(isDisplayed(tree, z1)).toBe(false);
    });

    it('M11: reduced motion commits the final state with no tween', () => {
        vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true);
        const { tree, fx } = mountFixture();
        const tweenSpy = vi.spyOn(Animation, 'tween');

        tree.expandNode(fx.B);

        expect(tweenSpy).not.toHaveBeenCalled();
        expect(rowFor(tree, fx.b1).getTranslateY()).toBe(48);
        expect(rowFor(tree, fx.b1).getOpacity()).toBeNull();
    });

    it('M12: a lazy expand animates only once the load commits its children', async () => {
        const load = vi.fn(() => new Promise<TreeNode[]>(resolve => {
            setTimeout(() => resolve([{ label: 'z1' }, { label: 'z2' }]), 0);
        }));
        const lazy: TreeNode = { label: 'lazy', hasChildren: true, loadChildren: load };
        const tree = new _Tree();
        trees.push(tree);
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);
        tree.setNodes([lazy, { label: 'sibling' }]);

        const tweenSpy = vi.spyOn(Animation, 'tween');
        let expandCount = 0;
        // What the "expand" listener observes when it runs: the committed row
        // list, the nodes bound into the pool, and how many tweens had been
        // scheduled (the commit's render schedules its one before "expand").
        const observed: Array<{ flatRows: string[]; displayed: string[]; tweened: number }> = [];

        tree.on('expand', () => {
            expandCount += 1;

            const p = asPrivate(tree);

            observed.push({
                flatRows:  p._flatRows.map(r => r.node.label!),
                displayed: p._rowPool.filter((_row, i) => p._boundIndices[i] >= 0).map(row => row.getNode()!.label!),
                tweened:   tweenSpy.mock.calls.length,
            });
        });

        const expanded = tree.expandNodeAsync(lazy);

        expect(tweenSpy).not.toHaveBeenCalled(); // the spinner render animates nothing.

        expect(await expanded).toBe(true);
        expect(expandCount).toBe(1);
        expect(tweenSpy).toHaveBeenCalledTimes(1);

        // "expand" fired after the render: its listener already saw the
        // loaded children committed and bound into the pool.
        expect(observed).toHaveLength(1);
        expect(observed[0].flatRows).toEqual(['lazy', 'z1', 'z2', 'sibling']);
        expect(observed[0].displayed).toEqual(expect.arrayContaining(['lazy', 'z1', 'z2', 'sibling']));
        expect(observed[0].tweened).toBe(1);
    });

    it('M13: disposing the tree mid-motion cancels the captured frame harmlessly', () => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        runFrame(0);

        const renderSpy = vi.spyOn(tree as any, 'renderWindow');

        expect(() => tree.dispose()).not.toThrow();
        expect(() => runFrames()).not.toThrow();
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('M14: scrolling mid-motion re-renders at the current reveal; the scroll moves the container, not the rows', () => {
        const { tree, fx } = mountFixture();
        const H = ROW_HEIGHT;

        /** The plan's slide formula for `A B b1 b2 b3 C D` (b = 2, k = 3) at reveal `r`. */
        const expectedY = (index: number, r: number): number => (index < 2 ? index * H : index * H - (1 - r) * 3 * H);
        const rows      = [fx.b1, fx.b2, fx.b3, fx.C, fx.D];
        const indices   = [2, 3, 4, 5, 6];

        clock = 0;
        tree.expandNode(fx.B);
        runFrame(0);
        runFrame(160); // r = COLLAPSE_EASE(0.8): content tall enough to scroll.

        const r1 = COLLAPSE_EASE(0.8);
        tree.setScrollY(H);

        expect(asPrivate(tree)._scroller!.getScrollY()).toBe(H);
        rows.forEach((node, i) => expect(rowFor(tree, node).getTranslateY()).toBeCloseTo(expectedY(indices[i], r1)));

        runFrame(180); // the next frame, still scrolled, renders its own reveal.
        const r2 = COLLAPSE_EASE(0.9);

        expect(asPrivate(tree)._scroller!.getScrollY()).toBe(H);
        rows.forEach((node, i) => expect(rowFor(tree, node).getTranslateY()).toBeCloseTo(expectedY(indices[i], r2)));
    });

    it('M15: ArrowDown during a collapse motion, with the leaving children still rendered, moves to C, never into them', () => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        settle();

        const p = asPrivate(tree);
        p._selectAtIndex(p._flatRows.findIndex(r => r.node === fx.B));

        clock = 1000;
        p._onKeyDown({ key: 'ArrowLeft', shiftKey: false, preventDefault: (): void => {} } as KeyboardEvent);

        runFrame(1000); // first collapse frame: the pool renders the motion row list again.
        runFrame(1100); // mid-collapse.

        expect(isDisplayed(tree, fx.b1)).toBe(true);
        expect(isDisplayed(tree, fx.b2)).toBe(true);
        expect(isDisplayed(tree, fx.b3)).toBe(true);

        p._onKeyDown({ key: 'ArrowDown', shiftKey: false, preventDefault: (): void => {} } as KeyboardEvent);

        expect(tree.getSelectedNodes()).toEqual([fx.C]);
    });

    // -----------------------------------------------------------------------
    // Scroll-into-view mid-motion. Every scroll-into-view path computes its
    // target from committed row positions, so it settles a running motion
    // first — but only when it will actually move the scroll offset. With the
    // target already in view the motion keeps playing.
    // -----------------------------------------------------------------------

    /**
     * Mounts a 300x120 tree (5 visible rows) over `A B{b1 b2 b3} C D L0..L19`,
     * every node collapsed — long enough that a committed row can sit outside
     * the viewport.
     */
    function mountLongFixture(): { tree: _Tree; fx: Fixture; leaves: TreeNode[] } {
        const fx     = fixtureNodes();
        const leaves = Array.from({ length: 20 }, (_, i): TreeNode => ({ label: 'L' + i }));
        const tree   = new _Tree();

        trees.push(tree);
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);
        tree.setNodes([...fx.nodes, ...leaves]);

        return { tree, fx, leaves };
    }

    /** Expands B and settles, scrolls to `scrollY`, then leaves a collapse of B mid-motion. */
    function startCollapse(tree: _Tree, fx: Fixture, scrollY: number): void {
        clock = 0;
        tree.expandNode(fx.B);
        settle();
        tree.setScrollY(scrollY);

        clock = 1000;
        asPrivate(tree)._onToggle(fx.B);
        runFrame(1000);
        runFrame(1050);

        expect(asPrivate(tree).isRowMotionRunning()).toBe(true);
    }

    /** Presses `key` through the tree's own keydown handler. */
    function press(tree: _Tree, key: string): void {
        asPrivate(tree)._onKeyDown({ key, shiftKey: false, preventDefault: (): void => {} } as KeyboardEvent);
    }

    /** Asserts the motion was settled: final render, leaving rows gone, and no later frame changes the pool. */
    function expectSettled(tree: _Tree, fx: Fixture): void {
        expect(asPrivate(tree).isRowMotionRunning()).toBe(false);
        [fx.b1, fx.b2, fx.b3].forEach(node => expect(isDisplayed(tree, node)).toBe(false));
        expectFinalRender(tree);

        const before = poolSnapshot(tree);

        runFrame(clock + 50);
        settle();
        expect(poolSnapshot(tree)).toEqual(before);
    }

    /** Asserts the collapse is still playing: running, with its leaving rows still rendered. */
    function expectStillAnimating(tree: _Tree, fx: Fixture): void {
        expect(asPrivate(tree).isRowMotionRunning()).toBe(true);
        [fx.b1, fx.b2, fx.b3].forEach(node => expect(isDisplayed(tree, node)).toBe(true));
    }

    /** Asserts `node`'s row renders fully inside the 120px viewport. */
    function expectRenderedInView(tree: _Tree, node: TreeNode): void {
        const top = rowFor(tree, node).getTranslateY()! - asPrivate(tree)._scroller!.getScrollY();

        expect(top).toBeGreaterThanOrEqual(0);
        expect(top + ROW_HEIGHT).toBeLessThanOrEqual(120);
    }

    it('selectNode mid-collapse settles the motion when it has to scroll, so the node renders in view', () => {
        const { tree, fx, leaves } = mountLongFixture();

        startCollapse(tree, fx, 0);
        tree.selectNode(leaves[3]); // committed row 7, below the 5-row viewport.

        expect(asPrivate(tree)._scroller!.getScrollY()).toBeGreaterThan(0);
        expectSettled(tree, fx);
        expectRenderedInView(tree, leaves[3]);
    });

    it('selectNode mid-collapse keeps the motion running when its node is already in view', () => {
        const { tree, fx } = mountLongFixture();

        startCollapse(tree, fx, 0);
        tree.selectNode(fx.C); // committed row 2: in view, no scroll.

        expect(asPrivate(tree)._scroller!.getScrollY()).toBe(0);
        expectStillAnimating(tree, fx);
    });

    it('a click-select mid-collapse settles the motion when it has to scroll', () => {
        const { tree, fx } = mountLongFixture();

        // Scrolled 3 rows down, C still renders at its pre-collapse row
        // inside the viewport, but its committed row (2) sits above it.
        startCollapse(tree, fx, 3 * ROW_HEIGHT);
        asPrivate(tree)._handleClick(makeEvent(rowFor(tree, fx.C).getElement()!, 'click') as MouseEvent);

        expect(tree.getSelectedNodes()).toEqual([fx.C]);
        expect(asPrivate(tree)._scroller!.getScrollY()).toBe(2 * ROW_HEIGHT);
        expectSettled(tree, fx);
        expectRenderedInView(tree, fx.C);
    });

    it('a click-select mid-collapse keeps the motion running when its row is already in view', () => {
        const { tree, fx, leaves } = mountLongFixture();

        startCollapse(tree, fx, 3 * ROW_HEIGHT);
        asPrivate(tree)._handleClick(makeEvent(rowFor(tree, leaves[0]).getElement()!, 'click') as MouseEvent); // committed row 4: in view.

        expect(tree.getSelectedNodes()).toEqual([leaves[0]]);
        expect(asPrivate(tree)._scroller!.getScrollY()).toBe(3 * ROW_HEIGHT);
        expectStillAnimating(tree, fx);
    });

    it('an ArrowLeft collapse whose row has to scroll into view settles its own motion', () => {
        const { tree, fx } = mountLongFixture();

        clock = 0;
        tree.expandNode(fx.B);
        settle();
        asPrivate(tree)._selectAtIndex(1);
        tree.setScrollY(3 * ROW_HEIGHT); // B (row 1) now sits above the viewport.

        clock = 1000;
        press(tree, 'ArrowLeft');

        expect(tree.getExpandedNodes()).toEqual([]);
        expect(asPrivate(tree)._scroller!.getScrollY()).toBe(ROW_HEIGHT);
        expectSettled(tree, fx);
        expectRenderedInView(tree, fx.B);
    });

    it('an ArrowLeft collapse whose row is in view keeps its motion', () => {
        const { tree, fx } = mountLongFixture();

        clock = 0;
        tree.expandNode(fx.B);
        settle();
        asPrivate(tree)._selectAtIndex(1);

        clock = 1000;
        press(tree, 'ArrowLeft');
        runFrame(1000);
        runFrame(1050);

        expect(asPrivate(tree)._scroller!.getScrollY()).toBe(0);
        expectStillAnimating(tree, fx);
    });

    it('keyboard navigation mid-collapse settles the motion when it has to scroll', () => {
        const { tree, fx, leaves } = mountLongFixture();

        startCollapse(tree, fx, 0);
        press(tree, 'End'); // the last leaf, committed row 23.

        expect(tree.getSelectedNodes()).toEqual([leaves[19]]);
        expectSettled(tree, fx);
        expectRenderedInView(tree, leaves[19]);
    });

    it('keyboard navigation mid-collapse keeps the motion running when the new row is already in view', () => {
        const { tree, fx } = mountLongFixture();

        startCollapse(tree, fx, 0);
        asPrivate(tree)._selectAtIndex(1); // B: committed row 1, in view.
        press(tree, 'ArrowDown'); // C: committed row 2, in view.

        expect(tree.getSelectedNodes()).toEqual([fx.C]);
        expect(asPrivate(tree)._scroller!.getScrollY()).toBe(0);
        expectStillAnimating(tree, fx);
    });

    it('keyboard navigation mid-expand near the list end scrolls to the committed offset, not the pre-expand maximum', () => {
        const { tree, fx, leaves } = mountLongFixture();
        const scroller = asPrivate(tree)._scroller!;

        // Scrolled to the bottom of the collapsed list, an expand's first
        // frame (r = 0) keeps the pre-expand content height on the scroller.
        tree.setScrollY(1_000_000);
        const maxScroll = scroller.getScrollY();
        expect(maxScroll).toBe(24 * ROW_HEIGHT - 120);

        clock = 1000;
        tree.expandNode(fx.B);
        runFrame(1000);
        expect(asPrivate(tree).isRowMotionRunning()).toBe(true);

        press(tree, 'End'); // the last leaf, committed row 26.

        expect(tree.getSelectedNodes()).toEqual([leaves[19]]);
        expect(scroller.getScrollY()).toBe(27 * ROW_HEIGHT - 120);
        expect(asPrivate(tree).isRowMotionRunning()).toBe(false);
        expectFinalRender(tree);
        expectRenderedInView(tree, leaves[19]);
    });

    // -----------------------------------------------------------------------
    // A keyboard move onto a row an expand is still fading in settles the
    // motion, so the selection lands on a row rendered final.
    // -----------------------------------------------------------------------

    /** Selects B, then expands it with ArrowRight and plays the motion to +60ms. */
    function startKeyboardExpand(tree: _Tree, fx: Fixture): void {
        asPrivate(tree)._selectAtIndex(1); // B

        clock = 1000;
        press(tree, 'ArrowRight');
        runFrame(1000);
        runFrame(1060);

        expect(asPrivate(tree).isRowMotionRunning()).toBe(true);
        expect(rowFor(tree, fx.b1).getOpacity()).toBeLessThan(1);
    }

    /** Asserts no motion is left and no later frame changes the pool. */
    function expectNoMotionLeft(tree: _Tree): void {
        expect(asPrivate(tree).isRowMotionRunning()).toBe(false);
        expectFinalRender(tree);

        const before = poolSnapshot(tree);

        runFrame(clock + 50);
        expect(poolSnapshot(tree)).toEqual(before);
        settle();
        expect(poolSnapshot(tree)).toEqual(before);
    }

    it('ArrowDown mid-expand onto an entering child settles the motion, so the child renders final', () => {
        const { tree, fx } = mountFixture();

        startKeyboardExpand(tree, fx);
        press(tree, 'ArrowDown');

        expect(tree.getSelectedNodes()).toEqual([fx.b1]);
        expect(rowFor(tree, fx.b1).getOpacity()).toBeNull();
        expect(tree.getAria().getActiveDescendant()).toBe(rowFor(tree, fx.b1).getId());
        expectNoMotionLeft(tree);
    });

    it('Shift+ArrowDown mid-expand onto an entering child settles the motion too', () => {
        const { tree, fx } = mountFixture();

        startKeyboardExpand(tree, fx);
        asPrivate(tree)._onKeyDown({ key: 'ArrowDown', shiftKey: true, preventDefault: (): void => {} } as KeyboardEvent);

        expect(tree.getSelectedNodes()).toEqual(expect.arrayContaining([fx.B, fx.b1]));
        expectNoMotionLeft(tree);
    });

    it('ArrowDown onto an entering child before the expand\'s first frame cancels the motion', () => {
        const { tree, fx } = mountFixture();

        asPrivate(tree)._selectAtIndex(1); // B

        clock = 1000;
        press(tree, 'ArrowRight');
        press(tree, 'ArrowDown');

        expect(tree.getSelectedNodes()).toEqual([fx.b1]);
        expectNoMotionLeft(tree);
    });

    it('a keyboard move to a row outside the expanding block keeps the motion playing', () => {
        const { tree, fx } = mountFixture();

        startKeyboardExpand(tree, fx);
        press(tree, 'ArrowUp'); // A: above the block, in view.

        expect(tree.getSelectedNodes()).toEqual([fx.A]);
        expect(asPrivate(tree).isRowMotionRunning()).toBe(true);
        expect(rowFor(tree, fx.b1).getOpacity()).toBeLessThan(1);
    });

    // -----------------------------------------------------------------------
    // Leaving rows are hidden from assistive technology while they play.
    // -----------------------------------------------------------------------

    /** The pool rows currently carrying `aria-hidden="true"`. */
    function hiddenRows(tree: _Tree): _TreeRow[] {
        return asPrivate(tree)._rowPool.filter(row => row.getAria().getHidden() === true);
    }

    /**
     * The pool rows carrying any `aria-hidden` at all. A revealed row has the
     * attribute removed, not set to `"false"`, so this is empty once no row
     * is hidden.
     */
    function rowsWithAriaHidden(tree: _Tree): _TreeRow[] {
        return asPrivate(tree)._rowPool.filter(row => row.getAria().getHidden() !== null);
    }

    it('leaving rows are aria-hidden on every frame of a collapse; no other row is', () => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        settle();

        clock = 1000;
        asPrivate(tree)._onToggle(fx.B);

        for (const now of [1000, 1050, 1100, 1150]) {
            runFrame(now);

            expect(hiddenRows(tree)).toEqual(expect.arrayContaining([fx.b1, fx.b2, fx.b3].map(node => rowFor(tree, node))));
            expect(hiddenRows(tree)).toHaveLength(3);
        }
    });

    it('an expand hides no row: its entering rows are committed', () => {
        const { tree, fx } = mountFixture();

        clock = 1000;
        tree.expandNode(fx.B);

        for (const now of [1000, 1100]) {
            runFrame(now);
            expect(rowsWithAriaHidden(tree)).toEqual([]);
        }
    });

    it('the leaving rows are revealed again when the collapse settles', () => {
        const { tree, fx } = mountFixture();

        startCollapse(tree, fx, 0);
        expect(hiddenRows(tree)).toHaveLength(3);

        settle();
        expect(rowsWithAriaHidden(tree)).toEqual([]);
    });

    it('the leaving rows are revealed again when a structural change stops the collapse', () => {
        const { tree, fx } = mountFixture();

        startCollapse(tree, fx, 0);
        expect(hiddenRows(tree)).toHaveLength(3);

        tree.expandAll(); // stops the motion; b1-b3 stay bound, now as committed rows.

        expect(isDisplayed(tree, fx.b1)).toBe(true);
        expect(rowsWithAriaHidden(tree)).toEqual([]);
    });

    it('a leaving row\'s slot rebound to another node mid-motion is revealed again', () => {
        const { tree, fx } = mountLongFixture();

        startCollapse(tree, fx, 0);

        const leavingRows = hiddenRows(tree);
        expect(leavingRows).toHaveLength(3);

        tree.setScrollY(10 * ROW_HEIGHT); // b1-b3 scroll out of the window; their slots rebind.

        const p         = asPrivate(tree);
        const reboundTo = leavingRows.filter(row => p._boundIndices[p._rowPool.indexOf(row)] >= 0);

        expect(p.isRowMotionRunning()).toBe(true);
        expect(reboundTo.length).toBeGreaterThan(0);
        reboundTo.forEach(row => expect([fx.b1, fx.b2, fx.b3]).not.toContain(row.getNode()));
        expect(rowsWithAriaHidden(tree)).toEqual([]);
    });

    it('aria-activedescendant never names a hidden leaving row, even when the focused node is inside the collapsing block', () => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        settle();
        asPrivate(tree)._selectAtIndex(3); // b2
        expect(tree.getAria().getActiveDescendant()).toBe(rowFor(tree, fx.b2).getId());

        clock = 1000;
        asPrivate(tree)._onToggle(fx.B); // a caret click: focus stays on b2.

        for (const now of [1000, 1050, 1100, 1150]) {
            runFrame(now);

            expect(hiddenRows(tree)).toHaveLength(3);
            expect(hiddenRows(tree).map(row => row.getId())).not.toContain(tree.getAria().getActiveDescendant());
        }
    });

    it('aria-activedescendant never names an undisplayed pool row once a collapse hides the focused node', () => {
        const { tree, fx } = mountFixture();

        clock = 0;
        tree.expandNode(fx.B);
        settle();
        asPrivate(tree)._selectAtIndex(3); // b2

        const b2Row = rowFor(tree, fx.b2);

        clock = 1000;
        asPrivate(tree)._onToggle(fx.B); // a caret click: focus stays on b2.
        runFrame(1000);
        settle();

        // Four committed rows leave the pool's excess slots undisplayed, the
        // one that showed b2 still holding b2's node.
        const p = asPrivate(tree);
        expect(p._boundIndices[p._rowPool.indexOf(b2Row)]).toBe(-1);
        expect(b2Row.getNode()).toBe(fx.b2);
        expect(tree.getAria().getActiveDescendant()).toBeNull();
    });
});
