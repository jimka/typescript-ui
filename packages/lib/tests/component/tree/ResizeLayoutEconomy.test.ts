// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins `VirtualRowView.deferRowLayoutWhileResizing` / `scheduleResizeSettle` /
// `flushResizeSettle`, at the `Tree` surface (the only current consumer). A
// live pane resize (dragging a `Split` gutter) changes the row width on every
// animation frame; withholding the width-driven child relayout while the
// width keeps moving, then catching every visible row up once it settles, is
// what removes the O(visible rows) `TreeRow.layoutChildren` cost from every
// frame of a drag. See plans/implemented/virtual-row-view-resize-relayout.md
// for the full design.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _Tree } from '~/component/tree/Tree';
import { _TreeRow } from '~/component/tree/TreeRow';
import { LabelTreeNodeRenderer } from '~/component/tree/renderer/Label';
import type { TreeNode } from '~/component/tree/TreeNode';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The settle mechanism runs on an animation frame, and the offline sink drops
// `requestAnimationFrame` outright — capture frames so a burst can be driven
// to completion. Unlike the read-only fake other suites use (see
// `ScrollRebindLayoutEconomy.test.ts`), the teardown case here (case 8) needs
// a cancelled frame to actually stop running, so callbacks are held in a Map
// keyed by an incrementing handle that `cancelAnimationFrame` can delete from.
let frames: Map<number, FrameRequestCallback> = new Map();
let nextHandle = 0;
let trees: _Tree[] = [];

beforeEach(() => {
    installTestDOM(CONFIG);
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

/**
 * Drains exactly the frames pending right now, without following a callback's
 * own re-arm into a further generation — lets a test observe the settle
 * relay's intermediate state between individual animation frames (the relay
 * is two hops deep: see `VirtualRowView.ts`'s `scheduleResizeSettle`/
 * `armResizeSettleCheck` remarks), which {@link runFrames}'s look-until-empty
 * loop would otherwise collapse into one settled end state.
 */
function runOnePendingFrameBatch(): void {
    const pending = frames;
    frames = new Map();
    for (const callback of pending.values()) {
        callback(0);
    }
}

/** Short, single-character labels so the renderer measures real advances without a wide alphabet. */
const CHARS = 'HeloWrdxXaBcDfGiJkLmNpQtUvYz';

function makeNodes(count: number): TreeNode[] {
    return Array.from({ length: count }, (_, i) => ({ label: CHARS[i % CHARS.length] }));
}

// Long enough, in the baked test font, that its natural width exceeds every
// row width this file drives — `Tree.test.ts`'s own "clip" coverage uses the
// same string against the same font. Only under `rowOverflow: "clip"` does a
// label's *rendered* width track the row's box width the way the renderer's
// own width always does; in the default "scroll" mode a row grows to fit the
// label instead, so the label's rendered width never moves.
const LONG_LABEL = 'Hello World '.repeat(12).trim();

type TreePrivate = {
    _rowPool: _TreeRow[];
    _rowDisplayed: boolean[];
};

function pooledRows(tree: _Tree): _TreeRow[] {
    return (tree as unknown as TreePrivate)._rowPool;
}

function displayedRows(tree: _Tree): _TreeRow[] {
    const priv = tree as unknown as TreePrivate;
    return priv._rowPool.filter((_, i) => priv._rowDisplayed[i]);
}

/**
 * Mounts a tree over `nodeCount` short-labelled rows at `width` x `height`,
 * then drains the startup settle frame every fresh `VirtualRowView` arms (its
 * first render's width counts as a change from the initial 0 — see the
 * plan's Potential Challenges) so a test starts from a genuinely settled
 * state instead of counting that harmless startup frame as part of its own
 * burst.
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

/**
 * Same settling as {@link makeSettledTree}, but `rowOverflow: "clip"` and every
 * node labelled with {@link LONG_LABEL}, so both the renderer's own width and
 * its label's rendered width track the row's box width (see case 4).
 */
function makeSettledClipTree(nodeCount: number, width: number, height: number): _Tree {
    const tree = new _Tree({ rowOverflow: 'clip' });
    trees.push(tree);

    tree.getElement(true);
    tree.setWidth(width);
    tree.setHeight(height);
    tree.setNodes(Array.from({ length: nodeCount }, () => ({ label: LONG_LABEL })));
    runFrames();

    return tree;
}

function rendererWidths(rows: _TreeRow[]): number[] {
    return rows.map(row => row.getRenderer().getWidth());
}

function labelWidths(rows: _TreeRow[]): number[] {
    return rows.map(row => (row.getRenderer() as LabelTreeNodeRenderer).getLabel().getWidth());
}

/** Spies on every currently pooled row's `layoutChildren`, returning the spies in pool order. */
function spyOnLayoutChildren(tree: _Tree): ReturnType<typeof vi.spyOn>[] {
    return pooledRows(tree).map(row => vi.spyOn(row, 'layoutChildren'));
}

function totalCalls(spies: ReturnType<typeof vi.spyOn>[]): number {
    return spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
}

describe('Tree — resize-relayout economy', () => {
    it('a one-off width change lays out every visible row\'s children, and nothing further is owed', () => {
        const tree = makeSettledTree(20, 300, 120);
        const spies = spyOnLayoutChildren(tree);
        const windowSize = displayedRows(tree).length;

        tree.setWidth(340);
        tree.doLayout();

        expect(totalCalls(spies)).toBe(windowSize);

        for (const spy of spies) {
            spy.mockClear();
        }
        runFrames();

        expect(totalCalls(spies)).toBe(0);
    });

    it('a second width change in the same burst lays out no row\'s children, though each row\'s own width still updates', () => {
        const tree = makeSettledTree(20, 300, 120);

        tree.setWidth(340);
        tree.doLayout();

        const widthBefore = pooledRows(tree)[0].getWidth();
        const spies = spyOnLayoutChildren(tree);

        tree.setWidth(360);
        tree.doLayout();

        expect(totalCalls(spies)).toBe(0);

        // The effective row width (the viewport width, net of the vertical
        // scrollbar's track when visible — not the tree's own raw width) is
        // what `positionRow` writes to every row on every pass, burst or not.
        const widthAfter = (tree as unknown as { _lastRowWidth: number })._lastRowWidth;
        expect(widthAfter).not.toBe(widthBefore);

        // Only the currently displayed slots are positioned each pass — a
        // pre-grown but not-yet-visible pool slot is never given a width at
        // all, so it is not part of what this pass is expected to update.
        for (const row of displayedRows(tree)) {
            expect(row.getWidth()).toBe(widthAfter);
        }
    });

    it('a same-width pass inside a burst lays out no row\'s children', () => {
        const tree = makeSettledTree(20, 300, 120);

        tree.setWidth(340);
        tree.doLayout();
        tree.setWidth(360);
        tree.doLayout();

        const spies = spyOnLayoutChildren(tree);

        // No width change this time, so every slot's geometry is already
        // current — `_positionRows` skips `layoutChildren` on that basis
        // alone, with no help from the burst state. Pins that a quiet pass
        // mid-burst doesn't relayout, leaving the eventual settle frame as
        // the only place the withheld work is ever caught up.
        tree.doLayout();

        expect(totalCalls(spies)).toBe(0);
    });

    it('the settle frame catches every visible row up exactly once, matching a single-step control', () => {
        // `rowOverflow: "clip"` + a label wider than every row width driven
        // here: only then does a label's *rendered* width move with the row's
        // box width the way the plan's case 4 exercises — in the default
        // "scroll" mode a row grows to fit the label instead, so neither the
        // label's nor (indirectly) the renderer's width would distinguish a
        // withheld pass from a caught-up one.
        const tree = makeSettledClipTree(20, 300, 120);

        tree.setWidth(340);
        tree.doLayout();

        const spies = spyOnLayoutChildren(tree);

        tree.setWidth(360);
        tree.doLayout();

        runFrames();

        const windowSize = displayedRows(tree).length;
        expect(totalCalls(spies)).toBe(windowSize);

        const control = makeSettledClipTree(20, 300, 120);
        control.setWidth(360);
        control.doLayout();
        runFrames();

        const actual  = displayedRows(tree);
        const expected = displayedRows(control);
        expect(rendererWidths(actual)).toEqual(rendererWidths(expected));
        expect(labelWidths(actual)).toEqual(labelWidths(expected));

        // Guards the guard: if this fires, the fixture no longer clamps the
        // label to the row width, and the two `toEqual`s above would pass
        // vacuously (both sides always at the label's own full content width)
        // regardless of whether the settle pass actually ran.
        expect(labelWidths(expected)[0]).toBeLessThan((expected[0].getRenderer() as LabelTreeNodeRenderer).getContentWidth());
    });

    it('extends the burst when a width change lands between the settle relay\'s two hops', () => {
        // The settle relay is two requestAnimationFrame hops deep (see
        // VirtualRowView.ts's scheduleResizeSettle/armResizeSettleCheck
        // remarks): the first hop only re-arms for one more frame, the second
        // is where flushResizeSettle actually decides whether to catch up.
        // This pins the mechanism that makes that decision correctly extend
        // the burst — via the private _rowWidthMoved/_resizeSettleHandle
        // fields directly, rather than inferring it from call counts alone:
        // each row's own geometry already reflects the latest pass regardless
        // of whether its child relayout was withheld, so a black-box,
        // geometry-only assertion could not tell a correct extension apart
        // from one that ignored the interrupt and coincidentally caught up
        // on the same already-current geometry.
        const tree = makeSettledTree(20, 300, 120);

        tree.setWidth(340);
        tree.doLayout(); // live; arms the relay

        const spies = spyOnLayoutChildren(tree);

        tree.setWidth(360);
        tree.doLayout(); // withheld: _rowWidthMoved set for the relay's second hop to see

        runOnePendingFrameBatch(); // relay's first hop: only re-arms, doesn't touch _rowWidthMoved
        runOnePendingFrameBatch(); // relay's second hop: sees 360's change, re-arms instead of catching up

        expect((tree as unknown as { _rowWidthMoved: boolean })._rowWidthMoved).toBe(false); // 360's contribution consumed
        expect((tree as unknown as { _resizeSettleHandle: number | null })._resizeSettleHandle).not.toBeNull(); // extended, not settled
        expect(totalCalls(spies)).toBe(0);

        tree.setWidth(380);
        tree.doLayout(); // lands in the window right after the second hop's re-arm
        expect((tree as unknown as { _rowWidthMoved: boolean })._rowWidthMoved).toBe(true); // this pass's own contribution, not a leftover from 360

        runFrames(); // let the newly-extended relay run to completion

        const windowSize = displayedRows(tree).length;
        expect(totalCalls(spies)).toBe(windowSize);
        expect((tree as unknown as { _resizeSettleHandle: number | null })._resizeSettleHandle).toBeNull();
    });

    it('a slot rebound during a withheld pass still lays its children out, and no already-bound slot does', () => {
        const tree = makeSettledTree(20, 300, 120);

        // First change of a burst: arms the settle frame without withholding.
        tree.setWidth(320);
        tree.doLayout();

        const boundBefore = new Set(displayedRows(tree));
        const spy = vi.spyOn(_TreeRow.prototype, 'layoutChildren');

        // Second change of the burst, withheld — but a taller viewport also
        // pulls further rows into the window this same pass.
        tree.setWidth(340);
        tree.setHeight(240);
        tree.doLayout();

        const boundAfter   = displayedRows(tree);
        const newlyVisible = boundAfter.filter(row => !boundBefore.has(row));

        expect(newlyVisible.length).toBeGreaterThan(0);

        for (const row of newlyVisible) {
            const callsOnRow = spy.mock.instances.filter(instance => instance === row);
            expect(callsOnRow).toHaveLength(1);
        }

        for (const row of boundAfter) {
            if (boundBefore.has(row)) {
                expect(spy.mock.instances).not.toContain(row);
            }
        }
    });

    it('scroll economy is unchanged: a one-row scroll with no width change lays out only the rebound slot', () => {
        const tree = makeSettledTree(40, 300, 120);
        const priv = tree as unknown as { _scroller: { setScrollY(y: number): void } };
        const rowHeight = 24; // ROW_HEIGHT — see Tree.ts; fixed, not derived from the theme.

        priv._scroller.setScrollY(rowHeight * 5);
        tree.doLayout();
        runFrames();

        const spies = spyOnLayoutChildren(tree);

        priv._scroller.setScrollY(rowHeight * 6);
        tree.doLayout();

        expect(totalCalls(spies)).toBe(1);
    });

    it('disposing the tree mid-burst cancels the settle frame: draining afterwards runs nothing and throws nothing', () => {
        const tree = makeSettledTree(20, 300, 120);

        // Two changes, not one: the first only arms the settle frame (nothing
        // withheld yet, nothing owed); the second is what makes a catch-up
        // genuinely owed. Disposing after only the first would make this case
        // vacuous — the surviving frame would find nothing owed and return on
        // its own, passing whether or not the cancel below ever ran.
        tree.setWidth(340);
        tree.doLayout();
        tree.setWidth(360);
        tree.doLayout();

        expect(frames.size).toBeGreaterThan(0);

        const renderWindowSpy = vi.spyOn(tree as any, 'renderWindow');
        const layoutSpies     = spyOnLayoutChildren(tree);

        trees = trees.filter(t => t !== tree);
        tree.dispose();

        // The armed frame is actually gone from the fake sink's own bookkeeping
        // — not merely inert — confirming `destructor` reached `cancelAnimationFrame`.
        expect(frames.size).toBe(0);

        expect(() => runFrames()).not.toThrow();
        expect(renderWindowSpy).not.toHaveBeenCalled();
        expect(totalCalls(layoutSpies)).toBe(0);
    });
});
