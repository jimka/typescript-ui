// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Offline coverage for plans/in-progress/split-noop-drag-frame-gate.md's
 * `## Expected Behaviour` cases D1-D8: a `Split` gutter-drag frame whose clamp
 * leaves a pane at the box it already holds lays that pane out only when the
 * pane's own unchanged-commit gate refuses to withhold the pass. Cases D9 and
 * D10 need a real pointer and an engine recording respectively, so they stay
 * manual.
 *
 * The harness — the `installTestDOM` config, the `requestAnimationFrame`
 * capture, the teardown, the scene and the drive — is Split.resizeMode.test.ts's,
 * with `scene()` taking the pane builders as parameters so the same drag can be
 * driven over a pane whose class opted into the skip and one whose class did
 * not. The drag runs through the gutter's own handlers, the path `scheduleDrag`
 * actually sits on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { Tooltip } from '~/overlay/Tooltip';
import { setAppResizeMode } from '~/core/ResizeDrag';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { LayoutManager } from '~/layout/LayoutManager';
import { Split } from '~/layout/Split';
import { ThemeManager } from '~/core/Theme';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A cross-axis ceiling large enough never to bind, for the one pane that carries a max. */
const UNBOUND_HEIGHT = 10000;

/** The scene's host box, and so the pair's combined main-axis room less the gutter. */
const HOST_WIDTH  = 400;
const HOST_HEIGHT = 300;

/**
 * The host width D2b and D2c resize to under a live drag, which leaves the
 * drag's captured total 100 px larger than the two panes now hold.
 */
const SHRUNK_HOST_WIDTH = 300;

/**
 * The vertical scene's cross-axis width. Its main-axis extent is `HOST_WIDTH`,
 * so every main-axis figure matches the horizontal scene's.
 */
const VERTICAL_HOST_WIDTH = 300;

/** Both panes' preferred main-axis extent, which the leading pane holds at rest. */
const PANE_PREFERRED = 100;

/** The leading pane's own maximum width: a drive past it parks the drag against this clamp. */
const LHS_MAX = 250;

/** The leading pane's floor, and the trailing pane's, neither of which these cases reach. */
const LHS_MIN = 60;
const RHS_MIN = 80;

/** The pointer coordinate the gutter is pressed at, and so the drag's origin. */
const PRESS_X = 100;

/**
 * A drive whose first move pins the leading pane at its maximum and whose next
 * two ask for more room it cannot take: one moving frame, then two parked ones.
 */
const PARKED_DRIVE = [400, 500, 600];

/** A content child small enough to sit anywhere inside its pane at any drag position. */
const CONTENT_SIZE = 20;

/** The scene each drag case drives. */
interface Scene {
    host:   Container;
    split:  Split;
    lhs:    Component;
    rhs:    Component;
    gutter: { onDragStart(e: MouseEvent): unknown; onDrag(e: MouseEvent): unknown; onDragStop(): unknown } & Component;
}

/** A pane that opts into the unchanged-commit skip, the way `Panel`, `MenuBar` and `ToolBar` do. */
class SkippablePane extends Component {
    /**
     * Opts in.
     *
     * @returns `true`.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

/** An opted-in pane that holds content, for the cases about a pass owed beneath it. */
class SkippableContentPane extends Container {
    /**
     * Opts in.
     *
     * @returns `true`.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

/**
 * Commits the container's first child flush against its trailing edge, so a
 * change in the container's width moves that child without resizing it. That is
 * the one shape `LayoutManager.commitBounds`' size-stable-move fast path takes:
 * it writes the move as a `transform`, promotes the child with
 * `will-change: transform` and marks the pass that folds both back as owed on
 * every skipping ancestor — which is what leaves the pane owing a pass after a
 * drag frame that moved the gutter.
 */
class TrailingEdge extends LayoutManager {
    /** Commits the first child against the container's trailing edge. */
    doLayout(): void {
        const container = this.getContainer();
        const child     = container?.getComponents()[0];

        if (container && child) {
            this.commitBounds(child, container.getWidth() - CONTENT_SIZE, 0, CONTENT_SIZE, CONTENT_SIZE);
        }
    }
}

/**
 * Commits the container's first child at the container's own origin, so no
 * width change ever moves it. That keeps the pane settled across a moving drag
 * frame — the fold-back {@link TrailingEdge} provokes is a second mechanism, and
 * the case about a descendant's own mark has to be free of it.
 */
class PinnedChild extends LayoutManager {
    /** Commits the first child at the container's origin. */
    doLayout(): void {
        const child = this.getContainer()?.getComponents()[0];

        if (child) {
            this.commitBounds(child, 0, 0, CONTENT_SIZE, CONTENT_SIZE);
        }
    }
}

/** Builds one of the scene's two panes, carrying its preferred size but not yet its clamps. */
type MakePane = () => Component;

/** A component's committed box. */
function box(component: Component): { x: number; y: number; width: number; height: number } {
    return {
        x:      component.getX(),
        y:      component.getY(),
        width:  component.getWidth(),
        height: component.getHeight(),
    };
}

/** A pane added with a resize weight, as the scene's two panes are. */
function weighted(weight: number): LayoutConstraints {
    const constraints = new LayoutConstraints();

    constraints.weight = weight;

    return constraints;
}

/**
 * The scene's default pane: the plain `Component` Split.resizeMode.test.ts
 * uses, whose class leaves the protected opt-in gate at its `false` default and
 * so is never allowed to withhold a pass.
 *
 * @returns The pane.
 */
function plainPane(): Component {
    return new Component({ preferredSize: { width: PANE_PREFERRED, height: HOST_HEIGHT } });
}

/**
 * A leaf pane whose class opted into the unchanged-commit skip.
 *
 * @returns The pane.
 */
function skippablePane(): Component {
    return new SkippablePane({ preferredSize: { width: PANE_PREFERRED, height: HOST_HEIGHT } });
}

/**
 * An opted-in pane holding one child, for the cases about a pass owed beneath
 * the pane rather than on it.
 *
 * @param manager - How the pane places that child.
 * @returns The pane and its child.
 */
function contentPane(manager: LayoutManager): { pane: Container; child: Component } {
    const child = new Component({ preferredSize: { width: CONTENT_SIZE, height: CONTENT_SIZE } });
    const pane  = new SkippableContentPane({
        layoutManager: manager,
        preferredSize: { width: PANE_PREFERRED, height: HOST_HEIGHT },
    });

    pane.getElement(true);
    pane.clearInsets();
    child.getElement(true);
    pane.addComponent(child);

    return { pane, child };
}

describe('Split drag-frame gate', () => {
    let frames:      Map<number, FrameRequestCallback>;
    let nextFrameId: number;
    let hosts:       Container[];

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames      = new Map();
        nextFrameId = 1;
        hosts       = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const id = nextFrameId++;

            frames.set(id, cb);

            return id;
        });
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
            frames.delete(id);
        });
    });

    afterEach(() => {
        // A drag left mid-flight keeps its session's viewport listeners
        // registered, and `Event`'s registration maps are module state
        // DOM.reset() does not clear — a surviving type map stops the next
        // `addViewportListener` re-registering against the fresh sink.
        // Disposing the host runs `Split.detach`, which cancels the session
        // exactly as a real teardown does. Split.resizeMode.test.ts's teardown,
        // for the same reason.
        for (const host of hosts) {
            host.dispose();
        }

        vi.restoreAllMocks();
        setAppResizeMode('live');
        Tooltip._stopPointerWatch();
        DOM.reset();
    });

    /** Runs every frame callback still pending since the last drain. */
    function flushFrame(): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(performance.now());
        }
    }

    /**
     * The scene: a 400x300 host split horizontally into a 100 px pinned left
     * pane (min 60, max 250) and a flexible right pane (min 80).
     *
     * @param makeLhs - Builds the leading pane. Defaults to a plain `Component`.
     * @param makeRhs - Builds the trailing pane. Defaults to a plain `Component`.
     * @returns The host, the split, the two panes and the gutter between them.
     */
    function scene(makeLhs: MakePane = plainPane, makeRhs: MakePane = plainPane): Scene {
        const split = new Split({ orientation: 'horizontal' });
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.clearInsets();
        host.setWidth(HOST_WIDTH);
        host.setHeight(HOST_HEIGHT);

        const lhs = makeLhs();
        const rhs = makeRhs();

        lhs.setMinSize({ width: LHS_MIN, height: 0 });
        lhs.setMaxSize({ width: LHS_MAX, height: UNBOUND_HEIGHT });
        rhs.setMinSize({ width: RHS_MIN, height: 0 });
        lhs.getElement(true);
        rhs.getElement(true);

        host.addComponent(lhs, weighted(0));
        host.addComponent(rhs, weighted(1));
        host.doLayout();
        hosts.push(host);

        // Drop the layout-flush frames the scene's own construction queued, so
        // a drained frame below runs the drag's work and nothing else.
        frames.clear();

        const gutter = (split as unknown as { _gutters: Scene['gutter'][] })._gutters[0];

        return { host, split, lhs, rhs, gutter };
    }

    /**
     * The same scene rotated onto the y axis: a 300x400 host split vertically,
     * with the panes' main-axis numbers chosen so every figure matches the
     * horizontal scene's — the leading pane pins at the same `LHS_MAX` and the
     * trailing one lands at the same offset and extent. `onDrag` reads its three
     * samples through an orientation ternary, so the vertical arm of that
     * ternary needs its own drive; without one, a gate that read `getWidth()` /
     * `getX()` unconditionally would pass every other case in this file.
     *
     * @param makeLhs - Builds the leading pane. Defaults to a plain `Component`.
     * @param makeRhs - Builds the trailing pane. Defaults to a plain `Component`.
     * @returns The host, the split, the two panes and the gutter between them.
     */
    function verticalScene(makeLhs: MakePane = plainPane, makeRhs: MakePane = plainPane): Scene {
        const split = new Split({ orientation: 'vertical' });
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.clearInsets();
        host.setWidth(VERTICAL_HOST_WIDTH);
        host.setHeight(HOST_WIDTH);

        const lhs = makeLhs();
        const rhs = makeRhs();

        // The pane builders seed a preferred size for the horizontal scene, where
        // the main axis is the width. Rotate it before the first pass reads it,
        // so the leading pane starts at `PANE_PREFERRED` on this axis too rather
        // than already pinned against its maximum.
        lhs.setPreferredSize({ width: VERTICAL_HOST_WIDTH, height: PANE_PREFERRED });
        rhs.setPreferredSize({ width: VERTICAL_HOST_WIDTH, height: PANE_PREFERRED });

        lhs.setMinSize({ width: 0, height: LHS_MIN });
        lhs.setMaxSize({ width: UNBOUND_HEIGHT, height: LHS_MAX });
        rhs.setMinSize({ width: 0, height: RHS_MIN });
        lhs.getElement(true);
        rhs.getElement(true);

        host.addComponent(lhs, weighted(0));
        host.addComponent(rhs, weighted(1));
        host.doLayout();
        hosts.push(host);

        frames.clear();

        const gutter = (split as unknown as { _gutters: Scene['gutter'][] })._gutters[0];

        return { host, split, lhs, rhs, gutter };
    }

    /**
     * Watches both panes' layout passes from now on, so the scene's own
     * construction pass is not counted.
     *
     * @param panes - The panes to watch, in the order the counts are reported.
     * @returns A reader for each pane's pass count, in the same order.
     */
    function passes(...panes: Component[]): () => number[] {
        const spies = panes.map(pane => vi.spyOn(pane, 'doLayout'));

        return () => spies.map(spy => spy.mock.calls.length);
    }

    /**
     * Presses the gutter at `PRESS_X`, starting a drag session.
     *
     * @param scn - The scene to press.
     */
    function press(scn: Scene): void {
        scn.gutter.onDragStart({ clientX: PRESS_X } as MouseEvent);
    }

    /**
     * Presses the gutter of a vertical split, which reads `clientY`.
     *
     * @param scn - The scene to press.
     */
    function pressDown(scn: Scene): void {
        scn.gutter.onDragStart({ clientY: PRESS_X } as MouseEvent);
    }

    /**
     * Moves a vertical split's pressed gutter and drains the frame applying it.
     *
     * @param scn - The scene being dragged.
     * @param position - The pointer position to move to.
     */
    function moveDown(scn: Scene, position: number): void {
        scn.gutter.onDrag({ clientY: position } as MouseEvent);
        flushFrame();
    }

    /**
     * Moves the pressed gutter to `position` and drains the frame that applies it.
     *
     * @param scn - The scene being dragged.
     * @param position - The pointer position to move to.
     */
    function move(scn: Scene, position: number): void {
        scn.gutter.onDrag({ clientX: position } as MouseEvent);
        flushFrame();
    }

    /**
     * Presses the gutter and drags it through `positions`, draining one frame
     * after each move.
     *
     * @param scn - The scene to drive.
     * @param positions - The pointer positions to move through.
     */
    function drive(scn: Scene, positions: number[]): void {
        press(scn);

        for (const position of positions) {
            move(scn, position);
        }
    }

    /** The boxes the scene's panes hold once the leading one is pinned at its maximum. */
    const PINNED_LHS = { x: 0, y: 0, width: LHS_MAX, height: HOST_HEIGHT };
    const PINNED_RHS = { x: 250, y: 0, width: 150, height: HOST_HEIGHT };

    it('D1. lays both panes out on a frame that moves them, whatever the pane class', () => {
        for (const makePane of [plainPane, skippablePane]) {
            const scn   = scene(makePane, makePane);
            const count = passes(scn.lhs, scn.rhs);

            drive(scn, [400]);

            expect(count()).toEqual([1, 1]);
            expect(box(scn.lhs)).toEqual(PINNED_LHS);
            expect(box(scn.rhs)).toEqual(PINNED_RHS);
        }
    });

    it('D2. lays out neither opted-in pane on a parked frame', () => {
        const scn   = scene(skippablePane, skippablePane);
        const count = passes(scn.lhs, scn.rhs);

        drive(scn, PARKED_DRIVE);

        expect(count()).toEqual([1, 1]);
        expect(box(scn.lhs)).toEqual(PINNED_LHS);
        expect(box(scn.rhs)).toEqual(PINNED_RHS);
        expect(scn.split.getPaneSize(scn.lhs)).toBe(LHS_MAX);
    });

    // D2b and D2c resize the container under a live drag; the geometry those
    // frames produce is pinned by Split.dragGeometry.test.ts, and these cases
    // keep asserting the pass counts, which are this gate's own contract.
    //
    // Since `onDrag` divides the pair's *live* combined extent, the trailing
    // pane's requested size follows the leading pane's travel on every reachable
    // frame, so its position and extent move together and no case here isolates
    // `rhsMoved`'s position term on its own. D2d remains the extent-only
    // witness: its position is unchanged and its own clamp cuts its extent.

    it('D2b. lays out neither pane on a frame that a mid-drag resize left with nothing to move', () => {
        const scn = scene(skippablePane, skippablePane);

        press(scn);
        scn.host.setWidth(SHRUNK_HOST_WIDTH);
        scn.host.doLayout();

        const count = passes(scn.lhs, scn.rhs);

        // Back at the press coordinate after the host shrank: the leading pane is
        // asked for the width it holds and the trailing pane for the width it
        // holds, so neither moves.
        move(scn, PRESS_X);

        expect(count()).toEqual([0, 0]);
        expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: PANE_PREFERRED, height: HOST_HEIGHT });
    });

    it('D2c. lays out the trailing pane when only its position moves', () => {
        const scn = scene(skippablePane, skippablePane);

        press(scn);
        scn.host.setWidth(SHRUNK_HOST_WIDTH);
        scn.host.doLayout();

        const count = passes(scn.lhs, scn.rhs);

        // The frame moves the leading pane by 100, and the trailing pane's
        // position and extent both follow.
        move(scn, 200);

        expect(count()).toEqual([1, 1]);
        expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: 200, height: HOST_HEIGHT });
    });

    it('D2d. skips the leading pane when its own clamp rejects the size it was handed', () => {
        const scn = scene(skippablePane, skippablePane);

        drive(scn, [400]);

        // `resolveLhsSize` clamps the leading size into `[loLhs, hiLhs]` as
        // `max(loLhs, min(hiLhs, …))`, so once the trailing pane's ceiling drops
        // far enough that `loLhs` passes `hiLhs`, the low bound wins and the
        // leading pane is handed 300 — past its own 250 px maximum. Its
        // `setWidth` clamps that straight back, so the frame moves it nowhere
        // even though the requested delta is 50: the case that separates the
        // committed-box read-back from a `dragAmount !== 0` test, and the one
        // `Component.writeBounds` and `commitBounds` both warn about.
        scn.rhs.setMaxSize({ width: 100, height: UNBOUND_HEIGHT });

        const count = passes(scn.lhs, scn.rhs);

        move(scn, 500);

        expect(count()).toEqual([0, 1]);
        expect(box(scn.lhs)).toEqual(PINNED_LHS);

        // Only the leading pane's box is asserted here; the geometry this frame
        // produces is pinned by Split.dragGeometry.test.ts, and this case keeps
        // asserting the pass counts, which are this gate's own contract.
    });

    it('D3. still lays out a pane that did not opt in on a parked frame', () => {
        const scn   = scene();
        const count = passes(scn.lhs, scn.rhs);

        drive(scn, PARKED_DRIVE);

        expect(count()).toEqual([PARKED_DRIVE.length, PARKED_DRIVE.length]);
        expect(box(scn.lhs)).toEqual(PINNED_LHS);
        expect(box(scn.rhs)).toEqual(PINNED_RHS);
    });

    it('D4. writes the stored pane sizes on a parked frame, and reports them on release', () => {
        const scn    = scene(skippablePane, skippablePane);
        const resize = vi.fn();

        scn.split.on('paneresize', resize);

        drive(scn, PARKED_DRIVE);

        expect(scn.split.getPaneSizes()[0]).toEqual({ unit: 'px', value: LHS_MAX });

        scn.gutter.onDragStop();

        expect(resize).toHaveBeenCalledTimes(1);
        expect(resize.mock.calls[0][0][0]).toEqual({ unit: 'px', value: LHS_MAX });
    });

    it('D5. lays out a pane owed a pass on the next parked frame, then stops', () => {
        const scn   = scene(skippablePane, skippablePane);
        const count = passes(scn.lhs, scn.rhs);

        drive(scn, [400, 500]);

        expect(count()).toEqual([1, 1]);

        scn.lhs.invalidateLayout();
        move(scn, 500);

        expect(count()).toEqual([2, 1]);

        move(scn, 500);

        expect(count()).toEqual([2, 1]);
    });

    it('D6. lets a descendant\'s markPassOwedAbove reach the pane the same way', () => {
        const { pane, child } = contentPane(new PinnedChild());
        const scn             = scene(() => pane, skippablePane);
        const count           = passes(scn.lhs, scn.rhs);

        drive(scn, [400, 500]);

        expect(count()).toEqual([1, 1]);

        child.markPassOwedAbove();
        move(scn, 500);

        expect(count()).toEqual([2, 1]);

        move(scn, 500);

        expect(count()).toEqual([2, 1]);
    });

    it('D6b. runs the fold-back a moving frame owed, releasing the promotion it took', () => {
        const { pane, child } = contentPane(new TrailingEdge());
        const scn             = scene(() => pane, skippablePane);
        const count           = passes(scn.lhs, scn.rhs);

        // The moving frame widens the pane, so its trailing-edge child moves
        // without resizing: `commitBounds` takes the fast path, leaving the
        // child's real position in a translate behind a `will-change` promotion
        // and the fold-back owed on the pane.
        press(scn);
        move(scn, 400);

        expect(count()).toEqual([1, 1]);
        expect(child.getTranslateX()).toBe(LHS_MAX - PANE_PREFERRED);
        expect(child.getWillChange()).toBe('transform');
        expect(scn.lhs.isLayoutDirty()).toBe(true);

        // The next frame is parked and moves no pane, but the owed pass is what
        // folds the translate back and releases the promotion — the state an
        // unconditional skip would strand for the whole park.
        move(scn, 500);

        expect(count()).toEqual([2, 1]);
        expect(child.getTranslateX()).toBe(0);
        expect(child.getWillChange()).toBeNull();
        expect(box(child)).toEqual({ x: LHS_MAX - CONTENT_SIZE, y: 0, width: CONTENT_SIZE, height: CONTENT_SIZE });

        // Nothing is owed any more, so every later parked frame skips.
        move(scn, 600);

        expect(count()).toEqual([2, 1]);
    });

    it('D7. lays both panes out once the text metrics move under them', () => {
        const scn   = scene(skippablePane, skippablePane);
        const count = passes(scn.lhs, scn.rhs);

        drive(scn, [400, 500]);

        expect(count()).toEqual([1, 1]);

        // A theme switch bumps the text-metrics generation without moving any
        // rectangle, the bump UnchangedCommitMetricsGate.test.ts uses for the
        // same gate. Re-setting the live theme keeps the scene's own metrics.
        ThemeManager.setTheme(ThemeManager.getTheme());
        move(scn, 500);

        expect(count()).toEqual([2, 2]);

        move(scn, 500);

        expect(count()).toEqual([2, 2]);
    });

    it('D8. never lays out a collapsed neighbour whose content is undisplayed', () => {
        const scn   = scene(() => contentPane(new TrailingEdge()).pane, plainPane);
        const count = passes(scn.lhs, scn.rhs);

        scn.split.setPaneCollapsedImmediate(0, true);
        scn.host.doLayout();

        // The collapse's own pass, which the drag's counts are read against.
        const [beforeLhs, beforeRhs] = count();

        drive(scn, PARKED_DRIVE);

        // The leading pane's own layout stays withheld on every frame, moving or
        // parked, while the trailing pane keeps the class behaviour D3 pins.
        expect(count()).toEqual([beforeLhs, beforeRhs + PARKED_DRIVE.length]);
    });

    // Dv1 and Dv2 repeat D1 and D2 on a vertical split, which is the only thing
    // that exercises the `getHeight()` / `getY()` arm of `onDrag`'s three
    // orientation ternaries. Every other case here is horizontal, so a gate that
    // sampled the x axis unconditionally would leave all of them green while a
    // vertical drag stopped laying its panes out at all.

    it('Dv1. lays both panes out on a vertical frame that moves them', () => {
        const scn   = verticalScene(skippablePane, skippablePane);
        const count = passes(scn.lhs, scn.rhs);

        pressDown(scn);
        moveDown(scn, 400);

        expect(count()).toEqual([1, 1]);
        expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: VERTICAL_HOST_WIDTH, height: LHS_MAX });
        expect(box(scn.rhs)).toEqual({ x: 0, y: 250, width: VERTICAL_HOST_WIDTH, height: 150 });
    });

    it('Dv2. lays out neither opted-in pane on a parked vertical frame', () => {
        const scn   = verticalScene(skippablePane, skippablePane);
        const count = passes(scn.lhs, scn.rhs);

        pressDown(scn);

        for (const position of PARKED_DRIVE) {
            moveDown(scn, position);
        }

        expect(count()).toEqual([1, 1]);
        expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: VERTICAL_HOST_WIDTH, height: LHS_MAX });
        expect(box(scn.rhs)).toEqual({ x: 0, y: 250, width: VERTICAL_HOST_WIDTH, height: 150 });
        expect(scn.split.getPaneSize(scn.lhs)).toBe(LHS_MAX);
    });
});
