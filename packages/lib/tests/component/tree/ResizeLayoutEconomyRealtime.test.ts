// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Simulates an actual multi-frame `Split`-gutter drag against
// `VirtualRowView`'s row-child relayout coalescing (exercised here at the
// `Tree` surface, its only current consumer): exactly one real `doLayout()`
// pass per animation frame (`Split.flushDrag`'s own per-frame coalescing —
// see `layout/Split.ts`'s `scheduleDrag`/`flushDrag` — cascades synchronously
// through to a resized `Tree`'s own `doLayout()` -> `renderWindow()`),
// interleaved with draining whatever settle-relay callback is currently
// queued *before* each pass — mirroring the real timing: the view's own
// settle-relay callback for a given frame is registered synchronously during
// the *previous* frame's pass, so it always sorts earlier in that frame's
// `requestAnimationFrame` batch than the drag's own per-frame pass, which is
// registered later, by a `mousemove` task that runs only after the previous
// frame's batch has fully completed.
//
// `ResizeLayoutEconomy.test.ts`'s cases call `doLayout()` several times
// back-to-back with no intervening frame — a shape a real `Split`-driven drag
// never produces, and the reason a since-fixed single-hop version of the
// settle relay (which raced and always lost to this exact per-frame timing,
// so it never withheld anything during a real drag) still passed every one
// of that file's cases. This file pins the shape that would have caught it —
// ported from the identical finding against `ScrollStrip`'s own resize-settle
// mechanism; see plans/implemented/virtual-row-view-resize-relayout.md's
// `## Implementation Notes` for the full trace.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
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

let nextFrameHandle = 1;
let frames: Map<number, FrameRequestCallback> = new Map();
let trees: _Tree[] = [];

beforeEach(() => {
    installTestDOM(CONFIG);
    nextFrameHandle = 1;
    frames = new Map();
    trees = [];
    (DOM.sink as any).requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const handle = nextFrameHandle++;
        frames.set(handle, callback);

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
    DOM.reset();
});

/**
 * Fires exactly the frames currently queued, without draining any a callback
 * re-queues in turn — one real `requestAnimationFrame` batch.
 */
function runQueuedFramesOnce(): void {
    const pending = Array.from(frames.values());
    frames.clear();

    for (const callback of pending) {
        callback(0);
    }
}

/** Runs queued frames to quiescence, including any newly re-armed in turn. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.size > 0; guard++) {
        runQueuedFramesOnce();
    }
}

/** Short, single-character labels so the renderer measures real advances without a wide alphabet. */
const CHARS = 'HeloWrdxXaBcDfGiJkLmNpQtUvYz';

function makeNodes(count: number): TreeNode[] {
    return Array.from({ length: count }, (_, i) => ({ label: CHARS[i % CHARS.length] }));
}

type TreePrivate = {
    _rowPool: _TreeRow[];
    _rowDisplayed: boolean[];
};

function displayedRows(tree: _Tree): _TreeRow[] {
    const priv = tree as unknown as TreePrivate;

    return priv._rowPool.filter((_, i) => priv._rowDisplayed[i]);
}

/** Spies on every currently pooled row's `layoutChildren`, returning the spies in pool order. */
function spyOnLayoutChildren(tree: _Tree): ReturnType<typeof vi.spyOn>[] {
    return (tree as unknown as TreePrivate)._rowPool.map(row => vi.spyOn(row, 'layoutChildren'));
}

function totalCalls(spies: ReturnType<typeof vi.spyOn>[]): number {
    return spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
}

/**
 * Mounts a tree over `nodeCount` short-labelled rows at `width` x `height`,
 * then drains the startup settle frame every fresh `VirtualRowView` arms (its
 * first render's width counts as a change from the initial 0) so a test
 * starts from a genuinely settled state instead of counting that harmless
 * startup frame as part of its own burst.
 */
function makeSettledTree(nodeCount: number, width: number, height: number): _Tree {
    const tree = new _Tree();
    trees.push(tree);

    tree.getElement(true);
    tree.setWidth(width);
    tree.setHeight(height);
    tree.setNodes(makeNodes(nodeCount));
    drainFrames();

    return tree;
}

/**
 * One real drag frame: the single `doLayout()` pass `Split.flushDrag`'s own
 * per-frame-coalesced drag callback would trigger this frame.
 */
function realDragFrame(tree: _Tree, width: number): void {
    tree.setWidth(width);
    tree.doLayout();
}

/**
 * Advances one real animation frame of an ongoing drag: first fires whatever
 * settle-relay callback is currently queued — registered during the
 * *previous* frame, so it always sorts earlier in this frame's batch than
 * the drag's own pass (see this file's header comment) — then runs this
 * frame's real drag pass.
 */
function advanceDragFrame(tree: _Tree, width: number): void {
    runQueuedFramesOnce();
    realDragFrame(tree, width);
}

describe('Tree resize-relayout coalescing under a realistic one-pass-per-frame drag', () => {
    it('withholds row-child relayout on every frame after the first while the drag continues', () => {
        const tree = makeSettledTree(20, 300, 120);

        realDragFrame(tree, 280); // frame 1: drag start, always live

        const spies = spyOnLayoutChildren(tree);

        // Frames 2-20: a continuing drag, one real pass per frame, each a
        // genuinely different width — the scenario this fix exists for.
        // Under a settle mechanism that races the same-frame real pass (the
        // defect this file's header comment describes), every one of these
        // would relayout live too, same as before the fix.
        for (let frame = 2; frame <= 20; frame++) {
            advanceDragFrame(tree, 280 - frame);
        }

        expect(totalCalls(spies)).toBe(0);
    });

    it('catches up exactly once, reflecting the final width, once the drag stops', () => {
        const tree = makeSettledTree(20, 300, 120);

        realDragFrame(tree, 280);

        for (let frame = 2; frame <= 10; frame++) {
            advanceDragFrame(tree, 280 - frame); // last iteration lands at width 270
        }

        // Drag stops here: no further frames arrive.
        const spies = spyOnLayoutChildren(tree);

        drainFrames();

        const windowSize = displayedRows(tree).length;
        expect(totalCalls(spies)).toBe(windowSize);
        expect((tree as unknown as { _resizeSettleHandle: number | null })._resizeSettleHandle).toBeNull();
    });
});
