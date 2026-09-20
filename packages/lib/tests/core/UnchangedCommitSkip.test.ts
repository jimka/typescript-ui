// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for the unchanged-commit layout skip on `LayoutManager.commitBounds`:
 * a commit that moves nothing withholds the child's layout pass when the child
 * opted in through the protected `canSkipUnchangedLayout` gate, no pass is owed,
 * and it has an element. Case numbers 1 to 9 refer to
 * `plans/unchanged-commit-skip-staged.md`'s `## Expected Behaviour` list; the
 * lettered cases and 10 and 11 pin the owed passes that plan's
 * `## Implementation Notes` add, and 12 and 13 are its `## Verification` gates
 * run in-process.
 *
 * The suite is not the acceptance gate for a change in this area on its own —
 * a skip that is wrong keeps most of it green. Cases 12 and 13 are: every
 * component's rectangle on every frame of a sweep, digested and compared with
 * what the same scenes produced before the skip existed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Border } from '~/layout/Border';
import { Fit } from '~/layout/Fit';
import { Split } from '~/layout/Split';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { LayoutManager } from '~/layout/LayoutManager';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { MenuBar } from '~/component/menubar/MenuBar';
import { ToolBar } from '~/component/menubar/ToolBar';
import { Button } from '~/component/button/Button';
import { Spacer } from '~/component/container/Spacer';
import { Insets } from '~/primitive/Insets';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The probe child's committed box — a size no clamp in these scenes touches. */
const CHILD_WIDTH  = 100;
const CHILD_HEIGHT = 50;

/**
 * Case 3's out-of-band height and case 3b's minimum height: each larger than
 * {@link CHILD_HEIGHT}, so a subtree left at either is visibly not at the
 * committed box.
 */
const OUT_OF_BAND_HEIGHT = 120;
const CLAMP_MIN_HEIGHT   = 80;

/** Case 4's move: far enough that the child visibly changes position. */
const MOVE_OFFSET = 40;

/** Case 7's inset on each edge. Any non-zero value works; four is a real toolbar value. */
const INSET = 4;

/** Case 11's two leaves, and the width the first grows to so the second is displaced. */
const LEAF_A_WIDTH       = 50;
const LEAF_A_GROWN_WIDTH = 80;
const LEAF_B_WIDTH       = 100;
const LEAF_HEIGHT        = 16;

/** Case 11's host row: wide enough for both leaves at the grown width, so nothing compresses. */
const HOST_ROW_WIDTH = 400;

/** The case-2 shell's box: large enough that neither bar is clamped. */
const SHELL_WIDTH  = 800;
const SHELL_HEIGHT = 600;

/** Case 8's bar box: tall enough for a vertical bar of three buttons. */
const BAR_BOX_WIDTH  = 300;
const BAR_BOX_HEIGHT = 200;

/** Frames of triangle wave each sweep drives, matching `Component.sizeHintMemo.test.ts`. */
const SWEEP_FRAMES = 20;

/**
 * Each sweep's starting box and the distance each frame moves the driven
 * axis. The width sweep's base is `Component.sizeHintMemo.test.ts`'s; the
 * height sweep is wider so the shell's CENTER dock is not squeezed, and
 * steps half as far because a 2x2 grid of editor panes has less height to
 * give than width. `BASELINE` was captured with exactly these values.
 */
const SWEEP_BASE = {
    width:  { width: 700, height: 600 },
    height: { width: 900, height: 500 },
} as const;
const SWEEP_STEP = { width: 20, height: 10 } as const;

/**
 * Baselines captured from this same file's scenes against the branch's start
 * point — `feature/size-hint-per-pass-memo` at `9320c19b`, where
 * `commitBounds` recursed unconditionally. Every one is a pre-change number,
 * which is what makes an equality against it an assertion that the skip
 * changed nothing rather than a restatement of its own output.
 *
 * The two shell digests were re-captured once, when `MenuBar` started
 * reserving its bottom rule as a real border and the bar grew from 28px to
 * 29px, taking a pixel of height out of everything the shell's `Border` puts
 * below and beside it. They were re-captured under the same condition the
 * originals were — the skip forced *off*, so `commitBounds` recurses
 * unconditionally — and that same harness reproduces the superseded digests
 * exactly on pre-change `MenuBar` code, so the equality still compares the
 * skip against an unskipped scene rather than against itself.
 *
 * Forcing it off means stubbing `canSkipUnchangedLayout` false on
 * `MenuBar.prototype` and `ToolBar.prototype` as well as on
 * `Component.prototype`: those two override it, so the mirror image of
 * `forceSkipEverywhere` below — which spies the base alone — leaves the
 * shell's own two bars skipping. Both routes produce these digests, which is
 * the property cases 12 and 13 exist to assert, but only the three-stub one
 * is a scene that skipped nothing.
 */
const BASELINE = {
    /** Case 2: components in the shell, and commits a repeat pass makes. */
    shellSize:        32,
    shellRepeatCommits: 31,
    /** Cases 12 and 13: every component's visual rectangle, per frame, hashed. */
    geometry: {
        deepWidth:     '31d51d08:107980',
        deepHeight:    '3593254e:112303',
        shallowWidth:  '5dd52043:25040',
        shallowHeight: '613bf4ee:25040',
        shellWidth:    'd616d000:114540',
        shellHeight:   '88754fc4:123515',
    },
    /** Cases 12 and 13: `doLayout` plus size-hint calls over each whole sweep. */
    work: {
        deep:    83517,
        shallow: 17644,
        shell:   93933,
    },
} as const;

/**
 * Case 13's skips per shell sweep. The bar whose rectangle the sweep's axis
 * does not reach — the menu bar under a height sweep, the vertical tool bar
 * under a width sweep — is skipped on every one of the twenty frames, and the
 * other bar only on frame 0, whose triangle-wave offset repeats the initial
 * layout exactly.
 */
const SHELL_SWEEP_SKIPS = SWEEP_FRAMES + 1;

/** A container that opts into the skip, the way `MenuBar` and `ToolBar` do. */
class SkippableContainer extends Container {
    /**
     * Opts in.
     *
     * @returns `true`.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

/** An opted-in container that may also release its element, for case 6b. */
class ReleasableSkippableContainer extends SkippableContainer {
    /**
     * Allows `release`.
     *
     * @returns `true`.
     */
    protected canRelease(): boolean {
        return true;
    }
}

/**
 * A manager that commits its container's first child at a rectangle the case
 * chooses, through `commitBounds`, the way every shipped manager commits.
 */
class FixedPlacement extends LayoutManager {
    private rect: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: CHILD_WIDTH, height: CHILD_HEIGHT };

    /**
     * Sets the rectangle the next pass commits.
     *
     * @param x - The child's left edge.
     * @param y - The child's top edge.
     * @param width - The child's width.
     * @param height - The child's height.
     */
    place(x: number, y: number, width: number, height: number): void {
        this.rect = { x, y, width, height };
    }

    /** Commits the first child at the chosen rectangle. */
    doLayout(): void {
        const child = this.getContainer()?.getComponents()[0];

        if (child) {
            this.commitBounds(child, this.rect.x, this.rect.y, this.rect.width, this.rect.height);
        }
    }
}

/**
 * A rendered, inset-free container laid out by the given manager.
 *
 * @param manager - The container's layout manager.
 * @returns The container.
 */
function makeHost(manager: LayoutManager): Container {
    const host = new Container({ layoutManager: manager });

    host.getElement(true);
    host.clearInsets();

    return host;
}

/**
 * A rendered, inset-free container that opts into the skip.
 *
 * @param manager - The container's layout manager.
 * @returns The container.
 */
function makeSkippable(manager: LayoutManager): SkippableContainer {
    const host = new SkippableContainer({ layoutManager: manager });

    host.getElement(true);
    host.clearInsets();

    return host;
}

/**
 * A rendered leaf with an explicit preferred size.
 *
 * @param width - The leaf's preferred width.
 * @param height - The leaf's preferred height.
 * @returns The leaf.
 */
function makeLeaf(width: number, height: number): Component {
    const leaf = new Component({ preferredSize: { width, height } });

    leaf.getElement(true);

    return leaf;
}

/**
 * A root whose `FixedPlacement` commits `child` at the probe box.
 *
 * @param child - The root's only child.
 * @returns The root and its manager.
 */
function makeFixedScene(child: Component): { root: Container; placement: FixedPlacement } {
    const placement = new FixedPlacement();
    const root      = makeHost(placement);

    root.addComponent(child);
    root.setWidth(CHILD_WIDTH * 4);
    root.setHeight(CHILD_HEIGHT * 4);

    return { root, placement };
}

/**
 * An opted-in `Fit` container around one leaf, so the leaf's box is exactly
 * the box the container was last laid out at.
 *
 * @returns The container and its leaf.
 */
function makeFittedChild(): { child: SkippableContainer; leaf: Component } {
    const child = makeSkippable(new Fit());
    const leaf  = makeLeaf(CHILD_WIDTH, CHILD_HEIGHT);

    child.addComponent(leaf);

    return { child, leaf };
}

/**
 * A `placement` constraint for a `Border` region.
 *
 * @param value - The region slot.
 * @param collapsible - Whether the region carries a collapse gutter.
 * @returns The constraint.
 */
function placement(value: Placement, collapsible = false): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { placement: value, collapsible });
}

/**
 * The plan's case-2 shell: a `Border` holding a four-menu `MenuBar` NORTH, a
 * vertical `ToolBar` of three buttons WEST and `centre` CENTER.
 *
 * @param centre - The CENTER region.
 * @returns The shell and its two bars.
 */
function makeShell(centre: Component): { shell: Container; menuBar: MenuBar; toolBar: ToolBar } {
    const shell   = makeHost(new Border({ spacing: 0 }));
    const menuBar = new MenuBar({ menus: ['File', 'Edit', 'View', 'Help'].map(label => ({ label, items: [{ text: 'Item' }] })) });
    const toolBar = new ToolBar({ orientation: 'vertical' });

    for (const text of ['Files', 'Find', 'Gear']) {
        toolBar.addComponent(new Button({ text }));
    }

    shell.addComponent(menuBar, placement(Placement.NORTH));
    shell.addComponent(toolBar, placement(Placement.WEST));
    shell.addComponent(centre,  placement(Placement.CENTER));

    return { shell, menuBar, toolBar };
}

/**
 * A horizontal strip of `count` leaves — the breadcrumb, gutter, status and
 * content rows the sweep scenes' editor panes are built from.
 *
 * @param count - How many leaves the strip holds.
 * @param height - Each leaf's preferred height.
 * @returns The strip.
 */
function makeStrip(count: number, height: number): Container {
    const strip = makeHost(new HBox({ spacing: 0 }));

    for (let index = 0; index < count; index += 1) {
        strip.addComponent(makeLeaf(30 + index, height));
    }

    return strip;
}

/**
 * One Loom-shaped file-editor pane, built exactly as
 * `Component.sizeHintMemo.test.ts` builds it: a `Border` whose centre is a
 * scrolling `Panel` over a `VBox` of content rows, with a breadcrumb bar north,
 * a collapsible gutter west and a status bar south.
 *
 * @returns The pane.
 */
function makeEditorPane(): Container {
    const pane = makeHost(new Border());
    const rows = makeHost(new VBox({ spacing: 0 }));

    for (let index = 0; index < 8; index += 1) {
        rows.addComponent(makeStrip(3, 16));
    }

    const scroller = new Panel({ layoutManager: new Fit(), autoScroll: 'auto' });

    scroller.getElement(true);
    scroller.clearInsets();
    scroller.addComponent(rows);

    const centre = makeHost(new Fit());

    centre.addComponent(scroller);

    pane.addComponent(makeStrip(4, 18), placement(Placement.NORTH));
    pane.addComponent(makeStrip(3, 14), placement(Placement.SOUTH));
    pane.addComponent(makeStrip(1, 40), placement(Placement.WEST, true));
    pane.addComponent(centre,           placement(Placement.CENTER));

    return pane;
}

/**
 * The deep sweep scene: a `Split` of a 30-row tree pane and a 2x2 grid of
 * editor panes, 223 components — the Loom dock shape.
 *
 * @returns The root.
 */
function makeDeepScene(): Container {
    const root = makeHost(new Split({ orientation: 'horizontal' }));
    const tree = makeHost(new VBox({ spacing: 0 }));

    for (let index = 0; index < 30; index += 1) {
        tree.addComponent(makeLeaf(120, 18));
    }

    root.addComponent(tree);

    const grid = makeHost(new VBox({ spacing: 0 }));

    for (let row = 0; row < 2; row += 1) {
        const pair = makeHost(new HBox({ spacing: 0 }));

        pair.addComponent(makeEditorPane());
        pair.addComponent(makeEditorPane());
        grid.addComponent(pair);
    }

    root.addComponent(grid);

    return root;
}

/**
 * The shallow sweep scene: a single editor pane, 48 components.
 *
 * @returns The root.
 */
function makeShallowScene(): Container {
    const root = makeHost(new HBox({ spacing: 0 }));

    root.addComponent(makeEditorPane());

    return root;
}

/**
 * The shell sweep scene: the case-2 shell with the deep scene as its CENTER,
 * so a sweep drives both bars and the whole dock beside them.
 *
 * @returns The root.
 */
function makeShellScene(): Container {
    return makeShell(makeDeepScene()).shell;
}

/**
 * Every component in a subtree, the root included, in pre-order.
 *
 * @param component - The subtree root.
 * @returns The components.
 */
function flatten(component: Component): Component[] {
    return [component, ...component.getComponents().flatMap(flatten)];
}

/**
 * Every component's *visual* rectangle in a subtree, as one string: position
 * with any leftover translate folded in, so a fast-path move and a slow-path
 * move to the same place read the same.
 *
 * @param component - The subtree root.
 * @returns The joined `x,y,width,height` of every component.
 */
function geometryOf(component: Component): string {
    return flatten(component)
        .map(c => `${c.getX() + c.getTranslateX()},${c.getY() + c.getTranslateY()},${c.getWidth()},${c.getHeight()}`)
        .join('|');
}

/**
 * An FNV-1a digest of a geometry string, with its length.
 *
 * @param value - The geometry string to digest.
 * @returns `"<hash>:<length>"`.
 */
function digest(value: string): string {
    let hash = 0x811c9dc5;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return `${hash.toString(16)}:${value.length}`;
}

/** Live counters over a sweep: the work it did and the commits it skipped. */
interface SweepCounters {
    readonly work: number;
    readonly skips: number;
}

/**
 * Counts, from now on, every `doLayout` and size-hint call anywhere, and every
 * commit that did not lay its child out.
 *
 * @returns A live view of the counts.
 */
function countSweepWork(): SweepCounters {
    const layouts = vi.spyOn(Component.prototype, 'doLayout');
    const hints   = [
        vi.spyOn(Component.prototype, 'getPreferredSize'),
        vi.spyOn(Component.prototype, 'getMinSize'),
        vi.spyOn(Component.prototype, 'getMaxSize'),
    ];
    const commit  = (LayoutManager.prototype as any).commitBounds as (this: LayoutManager, child: Component, ...rect: number[]) => void;

    let skips = 0;

    vi.spyOn(LayoutManager.prototype as any, 'commitBounds').mockImplementation(function (this: LayoutManager, child: unknown, ...rect: unknown[]) {
        const before = layouts.mock.contexts.length;

        commit.call(this, child as Component, ...(rect as number[]));

        // Only the calls this commit made are searched, so a sweep costs the
        // size of each committed subtree rather than the whole call history.
        if (layouts.mock.contexts.indexOf(child, before) === -1) {
            skips += 1;
        }
    });

    return {
        get work(): number {
            return layouts.mock.calls.length + hints.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
        },
        get skips(): number {
            return skips;
        },
    };
}

/**
 * Drives a triangle wave along one axis, laying the scene out once per frame
 * and digesting every component's visual rectangle on every frame.
 *
 * @param root - The scene root.
 * @param axis - The axis the wave drives.
 * @returns The digest of the whole sweep.
 */
function sweep(root: Container, axis: 'width' | 'height'): string {
    const base = SWEEP_BASE[axis];
    const step = SWEEP_STEP[axis];

    root.setWidth(base.width);
    root.setHeight(base.height);
    root.doLayout();

    let geometry = '';

    for (let frame = 0; frame < SWEEP_FRAMES; frame += 1) {
        const offset = frame < SWEEP_FRAMES / 2 ? frame : SWEEP_FRAMES - frame;

        if (axis === 'width') {
            root.setWidth(base.width + offset * step);
        } else {
            root.setHeight(base.height + offset * step);
        }

        root.doLayout();

        geometry += `${geometryOf(root)}#`;
    }

    return digest(geometry);
}

let frames: FrameRequestCallback[] = [];

/**
 * Installs the modelled DOM with a frame-capturing `requestAnimationFrame`.
 * Every case captures, not only the flush case: the flush clears the module's
 * pending-frame handle only when it runs, and the offline sink's recorder
 * never runs it, so one uncaptured `scheduleLayout` anywhere in this file
 * would leave every later case's flush unscheduled.
 */
function install(): void {
    installTestDOM(CONFIG);

    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
}

/** Runs every captured frame callback — the batched layout flush. */
function flushFrame(): void {
    const pending = frames;

    frames = [];

    for (const cb of pending) {
        cb(0);
    }
}

/** Lets every component skip, as the plan's Arm A does — the comparison with no opt-in list. */
function forceSkipEverywhere(): void {
    vi.spyOn(Component.prototype as any, 'canSkipUnchangedLayout').mockReturnValue(true);
}

afterEach(() => {
    flushFrame();
    vi.restoreAllMocks();
    DOM.reset();
});

describe('A component that has not opted in is never skipped (case 1)', () => {
    it('lays out every descendant on both of two unchanged passes, at the same rectangles', () => {
        install();

        const root = makeHost(new VBox({ spacing: 0 }));

        for (let index = 0; index < 2; index += 1) {
            const box = makeHost(new VBox({ spacing: 0 }));

            box.addComponent(makeLeaf(CHILD_WIDTH, CHILD_HEIGHT));
            box.addComponent(makeLeaf(CHILD_WIDTH, CHILD_HEIGHT));
            root.addComponent(box);
        }

        root.setWidth(CHILD_WIDTH * 4);
        root.setHeight(CHILD_HEIGHT * 8);
        root.doLayout();

        const first  = geometryOf(root);
        const layout = vi.spyOn(Component.prototype, 'doLayout');

        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(flatten(root).length);
        expect(geometryOf(root)).toBe(first);
    });
});

describe('An opted-in component handed its own rectangle is skipped (case 2)', () => {
    it('makes three commits on a repeat pass over the shell, skipping both bars, at the same rectangles', () => {
        install();

        const { shell, menuBar, toolBar } = makeShell(new Container());

        shell.setWidth(SHELL_WIDTH);
        shell.setHeight(SHELL_HEIGHT);
        shell.doLayout();

        const first      = geometryOf(shell);
        const commits    = vi.spyOn(LayoutManager.prototype as any, 'commitBounds');
        const menuLayout = vi.spyOn(menuBar, 'doLayout');
        const toolLayout = vi.spyOn(toolBar, 'doLayout');

        shell.doLayout();

        expect(flatten(shell)).toHaveLength(BASELINE.shellSize);
        expect(commits).toHaveBeenCalledTimes(3);
        expect(commits.mock.calls.length).toBeLessThan(BASELINE.shellRepeatCommits);
        expect(menuLayout).not.toHaveBeenCalled();
        expect(toolLayout).not.toHaveBeenCalled();
        expect(geometryOf(shell)).toBe(first);
    });
});

describe('A box that moved since its last pass is laid out (case 3)', () => {
    it('re-lays a child resized out of band when handed its original rectangle', () => {
        install();

        const { child, leaf } = makeFittedChild();
        const { root }        = makeFixedScene(child);

        root.doLayout();

        child.setHeight(OUT_OF_BAND_HEIGHT);
        child.doLayout();

        expect(leaf.getHeight()).toBe(OUT_OF_BAND_HEIGHT);

        root.doLayout();

        expect(child.getHeight()).toBe(CHILD_HEIGHT);
        expect(leaf.getHeight()).toBe(CHILD_HEIGHT);
    });

    it('3b. re-lays a child whose clamp moves it at an unchanged request', () => {
        install();

        const { child, leaf } = makeFittedChild();
        const { root }        = makeFixedScene(child);

        root.doLayout();

        // A minimum announces itself to the parent, not to the child, so the
        // child is still clean when the unchanged request reaches it.
        child.setMinSize({ width: 0, height: CLAMP_MIN_HEIGHT });

        expect(child.isLayoutDirty()).toBe(false);

        root.doLayout();

        expect(child.getHeight()).toBe(CLAMP_MIN_HEIGHT);
        expect(leaf.getHeight()).toBe(CLAMP_MIN_HEIGHT);
    });
});

describe('A pure move is laid out (case 4)', () => {
    it('lays out a same-size move through the transform fast path, and the fold back after it', () => {
        install();

        const { child }           = makeFittedChild();
        const { root, placement } = makeFixedScene(child);

        root.doLayout();

        const layout = vi.spyOn(child, 'doLayout');

        placement.place(MOVE_OFFSET, 0, CHILD_WIDTH, CHILD_HEIGHT);
        root.doLayout();

        expect(child.getTranslateX()).toBe(MOVE_OFFSET);
        expect(layout).toHaveBeenCalledTimes(1);

        // The same visual position again: the slow path folds the translate
        // back into `left`, which is a box change even though nothing moves.
        root.doLayout();

        expect(child.getTranslateX()).toBe(0);
        expect(child.getX()).toBe(MOVE_OFFSET);
        expect(layout).toHaveBeenCalledTimes(2);

        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(2);
    });
});

describe('invalidateLayout forces the pass (case 5)', () => {
    it('lays out on both of two unchanged commits with an invalidation between them', () => {
        install();

        const { child } = makeFittedChild();
        const { root }  = makeFixedScene(child);

        root.doLayout();

        const layout = vi.spyOn(child, 'doLayout');

        child.invalidateLayout();
        root.doLayout();
        child.invalidateLayout();
        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(2);
    });
});

describe('A component with no element is never skipped (case 6)', () => {
    it('lays out on both of two unchanged commits', () => {
        install();

        // Neither is rendered: adding to a rendered parent would build the
        // child's element.
        const child     = new SkippableContainer({ layoutManager: new Fit() });
        const placement = new FixedPlacement();
        const root      = new Container({ layoutManager: placement });

        root.addComponent(child);

        const layout = vi.spyOn(child, 'doLayout');

        root.doLayout();
        root.doLayout();

        expect(child.getElement()).toBeFalsy();
        expect(layout).toHaveBeenCalledTimes(2);
    });

    it('6b. lays out a clean child whose element was released', () => {
        install();

        const child = new ReleasableSkippableContainer({ layoutManager: new Fit() });

        child.getElement(true);

        const { root } = makeFixedScene(child);

        root.doLayout();

        // Released after a pass that cleared the flag: only the element check
        // stands between this commit and a pass recorded as done on no element.
        expect(child.release()).toBe(true);
        expect(child.isLayoutDirty()).toBe(false);

        // The offline `getElementById` model does not evict a released node
        // (see `element-release.test.ts`), so model the real document's miss
        // for this one id.
        const lookup = DOM.source.getElementById.bind(DOM.source);

        vi.spyOn(DOM.source, 'getElementById').mockImplementation(id => (id === child.getId() ? null : lookup(id)));

        expect(child.getElement()).toBeFalsy();

        const layout = vi.spyOn(child, 'doLayout');

        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(1);
    });
});

describe('An inset write marks a pass as owed (case 7)', () => {
    it('lays out after a real inset change, and skips again after a same-value one', () => {
        install();

        const { child } = makeFittedChild();
        const { root }  = makeFixedScene(child);

        root.doLayout();

        const layout = vi.spyOn(child, 'doLayout');

        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(0);

        child.setInsets(new Insets(INSET, INSET, INSET, INSET));
        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(1);

        child.setInsets(new Insets(INSET, INSET, INSET, INSET));
        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(1);

        child.clearInsets();
        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(2);

        child.clearInsets();
        root.doLayout();

        expect(layout).toHaveBeenCalledTimes(2);
    });
});

describe('The other unannounced placement inputs mark a pass as owed (case 7b)', () => {
    /**
     * An opted-in row of `[a, flex spacer, b]`, committed at a fixed box and
     * laid out, so `b` sits at the row's far edge.
     *
     * @returns The scene's root, the row and its three children.
     */
    function makeSpacedRow(): { root: Container; row: SkippableContainer; a: Component; spacer: Spacer; b: Component } {
        const row    = makeSkippable(new HBox({ spacing: 0 }));
        const a      = makeLeaf(LEAF_A_WIDTH, LEAF_HEIGHT);
        const spacer = Spacer.flex();
        const b      = makeLeaf(LEAF_B_WIDTH, LEAF_HEIGHT);

        row.addComponent(a);
        row.addComponent(spacer);
        row.addComponent(b);

        const { root, placement } = makeFixedScene(row);

        placement.place(0, 0, HOST_ROW_WIDTH, LEAF_HEIGHT);
        root.doLayout();

        return { root, row, a, spacer, b };
    }

    /**
     * Commits the row at its unchanged box and reports whether that left any
     * pass owed: the row's geometry after the commit, against the geometry a
     * direct pass of its own then produces.
     *
     * @param root - The scene's root.
     * @param row - The opted-in row.
     * @returns The row's geometry after the commit, and after its own pass.
     */
    function commitThenLayOut(root: Container, row: Container): { committed: string; laidOut: string } {
        root.doLayout();

        const committed = geometryOf(row);

        row.doLayout();

        return { committed, laidOut: geometryOf(row) };
    }

    it('re-places the row after a child\'s constraint changes through Spacer.setFlex', () => {
        install();

        const { root, row, spacer, b } = makeSpacedRow();

        expect(b.getX() + b.getTranslateX()).toBe(HOST_ROW_WIDTH - LEAF_B_WIDTH);

        spacer.setFlex(false);

        const { committed, laidOut } = commitThenLayOut(root, row);

        expect(committed).toBe(laidOut);
    });

    it('re-places the row after its children are re-sorted', () => {
        install();

        const { root, row, a } = makeSpacedRow();

        row.sortComponents((left, right) => (left === a ? 1 : right === a ? -1 : 0));

        const { committed, laidOut } = commitThenLayOut(root, row);

        expect(committed).toBe(laidOut);
    });

    it('re-places the row after its layout manager is swapped', () => {
        install();

        const { root, row } = makeSpacedRow();

        row.setLayoutManager(new VBox({ spacing: 0 }));

        const { committed, laidOut } = commitThenLayOut(root, row);

        expect(committed).toBe(laidOut);
    });
});

describe('A pass owed below an opted-in ancestor is not withheld by its skip (case 7c)', () => {
    /**
     * An opted-in host around a plain row of `[a, flex spacer, b]`: the
     * writers below mark the row, one level beneath the link that could skip.
     *
     * @returns The scene's root, the host, the row and its three children.
     */
    function makeNestedRow(): { root: Container; host: SkippableContainer; row: Container; a: Component; spacer: Spacer } {
        const host   = makeSkippable(new Fit());
        const row    = makeHost(new HBox({ spacing: 0 }));
        const a      = makeLeaf(LEAF_A_WIDTH, LEAF_HEIGHT);
        const spacer = Spacer.flex();

        row.addComponent(a);
        row.addComponent(spacer);
        row.addComponent(makeLeaf(LEAF_B_WIDTH, LEAF_HEIGHT));
        host.addComponent(row);

        const { root, placement } = makeFixedScene(host);

        placement.place(0, 0, HOST_ROW_WIDTH, LEAF_HEIGHT);
        root.doLayout();

        return { root, host, row, a, spacer };
    }

    it.each([
        ['setInsets',            (row: Container): void => { row.setInsets(new Insets(INSET, INSET, INSET, INSET)); }],
        ['sortComponents',       (row: Container, a: Component): void => { row.sortComponents((left, right) => (left === a ? 1 : right === a ? -1 : 0)); }],
        ['setLayoutManager',     (row: Container): void => { row.setLayoutManager(new VBox({ spacing: 0 })); }],
        ['Spacer.setFlex',       (_row: Container, _a: Component, spacer: Spacer): void => { spacer.setFlex(false); }],
    ] as const)('re-places the row after %s on it, on the host\'s next unchanged commit', (_writer, write) => {
        install();

        const { root, host, row, a, spacer } = makeNestedRow();

        write(row, a, spacer);
        root.doLayout();

        const committed = geometryOf(host);

        row.doLayout();

        expect(committed).toBe(geometryOf(host));
    });
});

describe('A ToolBar writer lays the bar out itself (case 8)', () => {
    /**
     * A horizontal bar of three buttons, committed at a fixed box and laid out.
     *
     * @returns The bar.
     */
    function makePlacedBar(): ToolBar {
        const bar = new ToolBar();

        for (const text of ['Cut', 'Copy', 'Paste']) {
            bar.addComponent(new Button({ text }));
        }

        const { root, placement } = makeFixedScene(bar);

        placement.place(0, 0, BAR_BOX_WIDTH, BAR_BOX_HEIGHT);
        root.doLayout();

        return bar;
    }

    it('leaves the children placed for the new orientation after setOrientation', () => {
        install();

        const bar = makePlacedBar();

        bar.setOrientation('vertical');

        const placed = geometryOf(bar);

        bar.doLayout();

        expect(placed).toBe(geometryOf(bar));
    });

    it('leaves the children placed for their new chrome after setFlat', () => {
        install();

        const bar = makePlacedBar();

        bar.setFlat(false);

        const placed = geometryOf(bar);

        bar.doLayout();

        expect(placed).toBe(geometryOf(bar));
    });
});

describe('The batched flush (case 9)', () => {
    it('keeps the own pass of a queued descendant behind an opted-in, clean link', () => {
        install();

        const root   = makeHost(new Fit());
        const middle = makeSkippable(new Fit());
        const inner  = makeHost(new VBox({ spacing: 0 }));

        inner.addComponent(makeLeaf(CHILD_WIDTH, CHILD_HEIGHT));
        middle.addComponent(inner);
        root.addComponent(middle);
        root.setWidth(CHILD_WIDTH * 2);
        root.setHeight(CHILD_HEIGHT * 2);
        root.doLayout();
        flushFrame();

        const layout = vi.spyOn(inner, 'doLayout');

        inner.scheduleLayout();
        root.scheduleLayout();
        flushFrame();

        expect(layout).toHaveBeenCalledTimes(1);
        expect(inner.isLayoutDirty()).toBe(false);
    });
});

describe('A pending first-layout drain is a pass owed (case 10)', () => {
    it('lays out a child whose first connected layout has not happened yet', () => {
        install();

        let connected = false;

        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);

        const { child } = makeFittedChild();
        const { root }  = makeFixedScene(child);
        const ran       = vi.fn();

        child.onFirstLayout(ran);
        root.doLayout();

        // Laid out while detached: the pass ran and cleared the flag, but the
        // drain waits for a connected one.
        expect(child.isLayoutDirty()).toBe(false);
        expect(ran).not.toHaveBeenCalled();

        connected = true;
        root.doLayout();

        expect(ran).toHaveBeenCalledTimes(1);

        const layout = vi.spyOn(child, 'doLayout');

        root.doLayout();

        expect(layout).not.toHaveBeenCalled();
    });
});

describe('A pending first-layout drain below an opted-in link is a pass owed (case 10b)', () => {
    it('lays out a descendant whose first connected layout has not happened yet', () => {
        install();

        let connected = false;

        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);

        const host  = makeSkippable(new Fit());
        const inner = makeHost(new Fit());
        const ran   = vi.fn();

        host.addComponent(inner);

        const { root } = makeFixedScene(host);

        inner.onFirstLayout(ran);
        root.doLayout();

        expect(inner.isLayoutDirty()).toBe(false);
        expect(ran).not.toHaveBeenCalled();

        connected = true;
        root.doLayout();

        expect(ran).toHaveBeenCalledTimes(1);

        const layout = vi.spyOn(host, 'doLayout');

        root.doLayout();

        expect(layout).not.toHaveBeenCalled();
    });
});

describe('A fast-path move leaves its host a pass owed (case 11)', () => {
    it('folds a settled move back on the next unchanged commit, then skips', () => {
        install();

        const host = makeSkippable(new HBox({ spacing: 0 }));
        const a    = makeLeaf(LEAF_A_WIDTH, LEAF_HEIGHT);
        const b    = makeLeaf(LEAF_B_WIDTH, LEAF_HEIGHT);

        host.addComponent(a);
        host.addComponent(b);

        const { root, placement } = makeFixedScene(host);

        placement.place(0, 0, HOST_ROW_WIDTH, LEAF_HEIGHT);
        root.doLayout();

        // Displaces `b` without resizing it: the host is dirtied by the relay,
        // so this pass runs and moves `b` through the transform fast path.
        a.setPreferredSize({ width: LEAF_A_GROWN_WIDTH, height: LEAF_HEIGHT });
        root.doLayout();

        expect(b.getTranslateX()).toBe(LEAF_A_GROWN_WIDTH - LEAF_A_WIDTH);
        expect(b.getWillChange()).toBe('transform');

        // Nothing moves now, but the fold back — and the release of the
        // compositor promotion — is the pass that is owed.
        root.doLayout();

        expect(b.getTranslateX()).toBe(0);
        expect(b.getX()).toBe(LEAF_A_GROWN_WIDTH);
        expect(b.getWillChange()).toBeNull();

        const layout = vi.spyOn(host, 'doLayout');

        root.doLayout();

        expect(layout).not.toHaveBeenCalled();
    });
});

describe('A fast-path move below an opted-in link is folded back (case 11b)', () => {
    it('releases a grandchild\'s promotion on the next unchanged commit of the opted-in link, then skips', () => {
        install();

        const host = makeSkippable(new Fit());
        const row  = makeHost(new HBox({ spacing: 0 }));
        const a    = makeLeaf(LEAF_A_WIDTH, LEAF_HEIGHT);
        const b    = makeLeaf(LEAF_B_WIDTH, LEAF_HEIGHT);

        row.addComponent(a);
        row.addComponent(b);
        host.addComponent(row);

        const { root, placement } = makeFixedScene(host);

        placement.place(0, 0, HOST_ROW_WIDTH, LEAF_HEIGHT);
        root.doLayout();

        // The relay dirties the row and the host alike, so this pass runs
        // down to `b` and moves it through the transform fast path.
        a.setPreferredSize({ width: LEAF_A_GROWN_WIDTH, height: LEAF_HEIGHT });
        root.doLayout();

        expect(b.getTranslateX()).toBe(LEAF_A_GROWN_WIDTH - LEAF_A_WIDTH);
        expect(b.getWillChange()).toBe('transform');

        root.doLayout();

        expect(b.getTranslateX()).toBe(0);
        expect(b.getWillChange()).toBeNull();

        const layout = vi.spyOn(host, 'doLayout');

        root.doLayout();

        expect(layout).not.toHaveBeenCalled();
    });
});

describe('The comparison forced on for every component changes no geometry (case 12, Arm A)', () => {
    it.each([
        ['deep',    'width',  makeDeepScene,    BASELINE.geometry.deepWidth,     BASELINE.work.deep],
        ['deep',    'height', makeDeepScene,    BASELINE.geometry.deepHeight,    BASELINE.work.deep],
        ['shallow', 'width',  makeShallowScene, BASELINE.geometry.shallowWidth,  BASELINE.work.shallow],
        ['shallow', 'height', makeShallowScene, BASELINE.geometry.shallowHeight, BASELINE.work.shallow],
        ['shell',   'width',  makeShellScene,   BASELINE.geometry.shellWidth,    BASELINE.work.shell],
        ['shell',   'height', makeShellScene,   BASELINE.geometry.shellHeight,   BASELINE.work.shell],
    ] as const)('commits the %s scene under a %s sweep at the same rectangles, for less work', (_scene, axis, make, geometry, work) => {
        install();
        forceSkipEverywhere();

        const root     = make();
        const counters = countSweepWork();

        expect(sweep(root, axis)).toBe(geometry);
        expect(counters.skips).toBeGreaterThan(0);
        expect(counters.work).toBeLessThan(work);
    });
});

describe('The shipped opt-ins change no geometry (case 13, Arm B)', () => {
    it.each([
        ['width',  BASELINE.geometry.shellWidth],
        ['height', BASELINE.geometry.shellHeight],
    ] as const)('commits the shell scene under a %s sweep at the same rectangles, skipping only the bars', (axis, geometry) => {
        install();

        const root     = makeShellScene();
        const counters = countSweepWork();

        expect(sweep(root, axis)).toBe(geometry);
        expect(counters.skips).toBe(SHELL_SWEEP_SKIPS);
        expect(counters.work).toBeLessThan(BASELINE.work.shell);
    });
});
