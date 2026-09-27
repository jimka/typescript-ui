// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Offline coverage for plans/in-progress/split-drag-unclamped-geometry.md's
 * `## Expected Behaviour` cases U1-U7, C1-C5 and S1: one frame of a `Split`
 * gutter drag places the gutter and the trailing pane from the extent the
 * leading pane *committed*, and divides the pair's *live* combined extent, so a
 * drag held past a pane's own limit keeps the gutter on the pane edge and a
 * container resized mid-drag never leaves the trailing pane wider than its host.
 * Case 6 of that plan's `## Verification` needs a real pointer, so it stays
 * manual.
 *
 * The harness — the `installTestDOM` config, the `requestAnimationFrame`
 * capture, the teardown, the scenes and the drives — is
 * Split.dragFrameGate.test.ts's, with two additions: every scene here passes
 * `spacing: 4` so the reserve between panes is non-zero (at the `spacing: 0`
 * default `gutterOffset` and `dividerGap` would both collapse into a vacuous
 * `0 === 0`), and `scene()` takes a trailing `resizeMode` the way
 * Split.resizeMode.test.ts's own `scene` does. The drag runs through the
 * gutter's own handlers, the path `scheduleDrag` actually sits on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { Tooltip } from '~/overlay/Tooltip';
import { setAppResizeMode } from '~/core/ResizeDrag';
import type { ResizeMode } from '~/core/ResizeDrag';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Split } from '~/layout/Split';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A cross-axis ceiling large enough never to bind, for the panes that carry a max. */
const UNBOUND_HEIGHT = 10000;

/**
 * The reserve between panes every scene in this file sets. `Split` defaults it
 * to `0`, where a pane's trailing edge, the gutter's visual centre and the
 * trailing pane's leading edge all coincide and this file's two invariants read
 * `0 === 0` whatever `onDrag` writes. `4` is the smallest even reserve that
 * separates all three, and it is the reserve every figure below is stated for.
 */
const SPACING = 4;

/** The scene's host box. */
const HOST_WIDTH  = 400;
const HOST_HEIGHT = 300;

/** The pair's combined main-axis room: the host less the one reserved gap. */
const PANE_ROOM = HOST_WIDTH - SPACING;

/**
 * The host width C1-C5 resize to under a live drag, which leaves the drag's
 * press-time total 100 px larger than the two panes then hold.
 */
const SHRUNK_HOST_WIDTH = 300;

/**
 * The vertical scene's cross-axis width. Its main-axis extent is `HOST_WIDTH`,
 * so every main-axis figure matches the horizontal scene's.
 */
const VERTICAL_HOST_WIDTH = 300;

/** Both panes' preferred main-axis extent, which the leading pane holds at rest. */
const PANE_PREFERRED = 100;

/** The leading pane's own maximum: a drive past it parks the drag against this clamp. */
const LHS_MAX = 250;

/** The leading pane's floor, and the trailing pane's. */
const LHS_MIN = 60;
const RHS_MIN = 80;

/**
 * The trailing pane's maximum, dropped mid-drag by U1, U2 and S1. It inverts
 * `resolveLhsSize`'s clamp bracket — `loLhs` passes `hiLhs` as soon as the live
 * total exceeds `maxLhs + maxRhs` — so the low bound wins and the leading pane
 * is handed a size *above* its own maximum, which its `setWidth` refuses.
 */
const RHS_MAX_DROPPED = 100;

/** The pointer coordinate the gutter is pressed at, and so the drag's origin. */
const PRESS_X = 100;

/**
 * The gutter's visual centre minus the leading pane's committed trailing edge,
 * on every frame of every drag: half the reserved gap, which is where
 * `Split.doLayout` centres the gutter element.
 */
const REST_GUTTER_OFFSET = SPACING / 2;

/**
 * The trailing pane's committed leading edge minus the leading pane's committed
 * trailing edge, on every frame of every drag: the whole reserved gap.
 */
const REST_DIVIDER_GAP = SPACING;

/** The three components one gutter drag moves. */
interface Pair {
    lhs:    Component;
    gutter: Component;
    rhs:    Component;
}

/** A pressable, draggable gutter, as `Split` builds them. */
type DragGutter = { onDragStart(e: MouseEvent): unknown; onDrag(e: MouseEvent): unknown; onDragStop(): unknown } & Component;

/** The scene each two-pane case drives. */
interface Scene extends Pair {
    host:   Container;
    split:  Split;
    gutter: DragGutter;
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

/** Builds one of a scene's two panes, carrying its preferred size but not yet its clamps. */
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

/** A pane added with a resize weight, as every scene's panes are. */
function weighted(weight: number): LayoutConstraints {
    const constraints = new LayoutConstraints();

    constraints.weight = weight;

    return constraints;
}

/**
 * The default pane: the plain `Component` Split.resizeMode.test.ts uses, whose
 * class leaves the protected opt-in gate at its `false` default.
 *
 * @returns The pane.
 */
function plainPane(): Component {
    return new Component({ preferredSize: { width: PANE_PREFERRED, height: HOST_HEIGHT } });
}

/**
 * A leaf pane whose class opted into the unchanged-commit skip, so a frame that
 * moves it nowhere lays it out not at all — which is what lets C1 read `[0, 0]`.
 *
 * @returns The pane.
 */
function skippablePane(): Component {
    return new SkippablePane({ preferredSize: { width: PANE_PREFERRED, height: HOST_HEIGHT } });
}

/**
 * A pane's committed trailing edge on the split's main axis, with any translate
 * folded in. `LayoutManager.commitBounds`' size-stable-move fast path reports a
 * moved pane's *pre-move* `getX()` and carries the move on a transform, and U7's
 * middle pane reaches its drag in exactly that state, so the raw `getX()` is not
 * where the pane's edge is. Split.resizeMode.test.ts's `visualBox` and
 * `CollapseSupport.captureRect` fold the translate in the same way.
 *
 * @param pair - The two panes and their gutter.
 * @param horizontal - Whether the split's main axis is the x axis.
 * @returns The leading pane's committed trailing edge.
 */
function leadingEdge(pair: Pair, horizontal: boolean): number {
    return horizontal
        ? pair.lhs.getX() + pair.lhs.getTranslateX() + pair.lhs.getWidth()
        : pair.lhs.getY() + pair.lhs.getTranslateY() + pair.lhs.getHeight();
}

/**
 * How far the gutter's visual centre sits past the leading pane's committed
 * trailing edge. Fixed at `REST_GUTTER_OFFSET` on every frame of every drag: the
 * gutter divides the pane boundary, so it cannot drift off it. The
 * centre-of-the-gap reading is Split.gutterHitBox.test.ts's.
 *
 * @param pair - The two panes and their gutter.
 * @param horizontal - Whether the split's main axis is the x axis.
 * @returns The signed offset, in pixels.
 */
function gutterOffset(pair: Pair, horizontal: boolean): number {
    const centre = horizontal
        ? pair.gutter.getX() + pair.gutter.getWidth() / 2
        : pair.gutter.getY() + pair.gutter.getHeight() / 2;

    return centre - leadingEdge(pair, horizontal);
}

/**
 * The gap between the two panes' committed facing edges. Fixed at
 * `REST_DIVIDER_GAP` on every frame of every drag: the reserve `doLayout` put
 * between them is not a drag's to change.
 *
 * @param pair - The two panes and their gutter.
 * @param horizontal - Whether the split's main axis is the x axis.
 * @returns The gap, in pixels.
 */
function dividerGap(pair: Pair, horizontal: boolean): number {
    const trailingStart = horizontal
        ? pair.rhs.getX() + pair.rhs.getTranslateX()
        : pair.rhs.getY() + pair.rhs.getTranslateY();

    return trailingStart - leadingEdge(pair, horizontal);
}

/**
 * The trailing pane's committed far edge, which is what a stale total pushes
 * past the host's inner edge.
 *
 * @param pair - The two panes and their gutter.
 * @param horizontal - Whether the split's main axis is the x axis.
 * @returns The far edge's coordinate.
 */
function trailingEnd(pair: Pair, horizontal: boolean): number {
    return horizontal
        ? pair.rhs.getX() + pair.rhs.getTranslateX() + pair.rhs.getWidth()
        : pair.rhs.getY() + pair.rhs.getTranslateY() + pair.rhs.getHeight();
}

describe('Split drag geometry', () => {
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
        // exactly as a real teardown does. Split.dragFrameGate.test.ts's
        // teardown, for the same reason.
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

    /** `_gutters` is non-public; every gutter probe in this file goes through here. */
    function gutters(split: Split): DragGutter[] {
        return (split as unknown as { _gutters: DragGutter[] })._gutters;
    }

    /**
     * The scene: a 400x300 host split horizontally, with a 4 px reserve, into a
     * 100 px pinned left pane (min 60, max 250) and a flexible right pane
     * (min 80). At rest the leading pane holds `{x 0, w 100}`, the gutter
     * `{x 97, w 10}` and the trailing pane `{x 104, w 296}`.
     *
     * @param makeLhs - Builds the leading pane. Defaults to a plain `Component`.
     * @param makeRhs - Builds the trailing pane. Defaults to a plain `Component`.
     * @param resizeMode - The split's own mode, or `undefined` to follow the
     *   app-wide default. Only C5 passes it.
     * @returns The host, the split, the two panes and the gutter between them.
     */
    function scene(makeLhs: MakePane = plainPane, makeRhs: MakePane = plainPane, resizeMode?: ResizeMode): Scene {
        const split = new Split({ orientation: 'horizontal', spacing: SPACING, resizeMode });
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

        return { host, split, lhs, rhs, gutter: gutters(split)[0] };
    }

    /**
     * The same scene rotated onto the y axis: a 300x400 host split vertically,
     * with the panes' main-axis numbers chosen so every main-axis figure matches
     * the horizontal scene's. `onDrag` writes its geometry through an
     * orientation `if`, so the vertical arm needs its own drives; without them a
     * fix applied to the horizontal branch alone would pass every other case
     * here.
     *
     * @param makeLhs - Builds the leading pane. Defaults to a plain `Component`.
     * @param makeRhs - Builds the trailing pane. Defaults to a plain `Component`.
     * @returns The host, the split, the two panes and the gutter between them.
     */
    function verticalScene(makeLhs: MakePane = plainPane, makeRhs: MakePane = plainPane): Scene {
        const split = new Split({ orientation: 'vertical', spacing: SPACING });
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.clearInsets();
        host.setWidth(VERTICAL_HOST_WIDTH);
        host.setHeight(HOST_WIDTH);

        const lhs = makeLhs();
        const rhs = makeRhs();

        // The pane builders seed a preferred size for the horizontal scene,
        // where the main axis is the width. Rotate it before the first pass
        // reads it, so the leading pane starts at `PANE_PREFERRED` on this axis
        // too rather than already pinned against its maximum.
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

        return { host, split, lhs, rhs, gutter: gutters(split)[0] };
    }

    /**
     * `scene()` with both clamps and both preferred sizes taken away: two bare
     * `Component` panes, which divide the pane room equally on the first pass.
     * Neither defect has a site here — nothing clamps, and the live total equals
     * the press total — so the cases on this fixture prove the rewrite leaves an
     * unconstrained drag exactly where it was.
     *
     * @returns The host, the split, the two panes and the gutter between them.
     */
    function unconstrainedScene(): Scene {
        const split = new Split({ orientation: 'horizontal', spacing: SPACING });
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.clearInsets();
        host.setWidth(HOST_WIDTH);
        host.setHeight(HOST_HEIGHT);

        const lhs = new Component();
        const rhs = new Component();

        lhs.getElement(true);
        rhs.getElement(true);

        host.addComponent(lhs, weighted(0));
        host.addComponent(rhs, weighted(1));
        host.doLayout();
        hosts.push(host);

        frames.clear();

        return { host, split, lhs, rhs, gutter: gutters(split)[0] };
    }

    /**
     * Watches both panes' layout passes from now on, so a scene's own
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

    /**
     * Shrinks the host under a live drag and lays it out, which re-divides the
     * two panes and leaves the drag's press-time total 100 px too large. C1-C5's
     * shared setup.
     *
     * @param scn - The scene being dragged.
     * @param horizontal - Whether the split's main axis is the x axis.
     */
    function shrinkHost(scn: Scene, horizontal: boolean): void {
        if (horizontal) {
            scn.host.setWidth(SHRUNK_HOST_WIDTH);
        } else {
            scn.host.setHeight(SHRUNK_HOST_WIDTH);
        }

        scn.host.doLayout();
    }

    describe('the gutter stays on the pane edge', () => {
        it('U1. keeps the gutter and the trailing pane on the leading pane\'s edge when its own maximum refuses the frame', () => {
            const scn = scene();

            drive(scn, [400]);

            // The leading pane is now pinned at its 250 px maximum. Dropping the
            // trailing pane's ceiling to 100 inverts `resolveLhsSize`'s bracket,
            // so the next frame hands the leading pane 296 — past its own
            // maximum, which its `setWidth` refuses. The requested travel reads
            // 46 for a pane that moved nowhere.
            scn.rhs.setMaxSize({ width: RHS_MAX_DROPPED, height: UNBOUND_HEIGHT });

            move(scn, 500);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: LHS_MAX, height: HOST_HEIGHT });
            expect(scn.gutter.getX()).toBe(247);
            expect(box(scn.rhs)).toEqual({ x: 254, y: 0, width: RHS_MAX_DROPPED, height: HOST_HEIGHT });
            expect(gutterOffset(scn, true)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(scn, true)).toBe(REST_DIVIDER_GAP);

            // 46 px of the pair's room is left bare, and must be: neither pane
            // will take it. The next full `doLayout` redistributes across every
            // pane; one drag frame cannot, and hiding it behind a floor would
            // move the gutter off the pane edge again.
            expect(trailingEnd(scn, true)).toBe(354);
        });

        it('U2. keeps the same frame\'s geometry on the y axis', () => {
            const scn = verticalScene();

            pressDown(scn);
            moveDown(scn, 400);

            scn.rhs.setMaxSize({ width: UNBOUND_HEIGHT, height: RHS_MAX_DROPPED });

            moveDown(scn, 500);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: VERTICAL_HOST_WIDTH, height: LHS_MAX });
            expect(scn.gutter.getY()).toBe(247);
            expect(box(scn.rhs)).toEqual({ x: 0, y: 254, width: VERTICAL_HOST_WIDTH, height: RHS_MAX_DROPPED });
            expect(gutterOffset(scn, false)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(scn, false)).toBe(REST_DIVIDER_GAP);
            expect(trailingEnd(scn, false)).toBe(354);
        });

        it('U3. holds the invariants at the leading pane\'s own minimum', () => {
            const scn = scene();

            drive(scn, [-500]);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: LHS_MIN, height: HOST_HEIGHT });
            expect(scn.gutter.getX()).toBe(57);
            expect(box(scn.rhs)).toEqual({ x: 64, y: 0, width: PANE_ROOM - LHS_MIN, height: HOST_HEIGHT });
            expect(gutterOffset(scn, true)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(scn, true)).toBe(REST_DIVIDER_GAP);
            expect(trailingEnd(scn, true)).toBe(HOST_WIDTH);
        });

        it('U4. holds them at the leading pane\'s own minimum on the y axis', () => {
            const scn = verticalScene();

            pressDown(scn);
            moveDown(scn, -500);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: VERTICAL_HOST_WIDTH, height: LHS_MIN });
            expect(scn.gutter.getY()).toBe(57);
            expect(box(scn.rhs)).toEqual({ x: 0, y: 64, width: VERTICAL_HOST_WIDTH, height: PANE_ROOM - LHS_MIN });
            expect(gutterOffset(scn, false)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(scn, false)).toBe(REST_DIVIDER_GAP);
            expect(trailingEnd(scn, false)).toBe(HOST_WIDTH);
        });

        it('U5. leaves an unconstrained pair alone when driven past the far end', () => {
            const scn = unconstrainedScene();

            drive(scn, [900]);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: PANE_ROOM, height: HOST_HEIGHT });
            expect(scn.gutter.getX()).toBe(393);
            expect(box(scn.rhs)).toEqual({ x: HOST_WIDTH, y: 0, width: 0, height: HOST_HEIGHT });
            expect(gutterOffset(scn, true)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(scn, true)).toBe(REST_DIVIDER_GAP);
            expect(trailingEnd(scn, true)).toBe(HOST_WIDTH);
        });

        it('U6. leaves it alone when driven past the near end', () => {
            const scn = unconstrainedScene();

            drive(scn, [-800]);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: 0, height: HOST_HEIGHT });

            // Negative, and correct: the gutter element is pure overhang, so at a
            // zero-width leading pane it hangs past the container's own edge.
            expect(scn.gutter.getX()).toBe(-3);

            expect(box(scn.rhs)).toEqual({ x: SPACING, y: 0, width: PANE_ROOM, height: HOST_HEIGHT });
            expect(gutterOffset(scn, true)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(scn, true)).toBe(REST_DIVIDER_GAP);
        });

        it('U7. holds the invariants over a pane that entered the drag carrying a translate', () => {
            const { panes, pairGutters } = translateScene();

            // The middle pane keeps its width while its slot moves, so
            // `commitBounds` took its size-stable-move fast path: the pane
            // reports its pre-move `getX()` and carries the move on a transform.
            expect(panes[1].getX()).toBe(104);
            expect(panes[1].getTranslateX()).toBe(TRANSLATE);
            expect(panes[1].getWidth()).toBe(TRANSLATE_PANE_MAIN);
            expect(pairGutters[1].getX()).toBe(241);

            const pair: Pair = { lhs: panes[1], gutter: pairGutters[1], rhs: panes[2] };

            // The same inverted bracket U1 drives, now over a translated pane:
            // the middle pane is handed 140 and its own 100 px maximum refuses
            // it, so the frame must move neither the gutter nor the last pane.
            panes[1].setMaxSize({ width: TRANSLATE_PANE_MAIN, height: UNBOUND_HEIGHT });
            panes[2].setMaxSize({ width: TRANSLATE_LAST_MAX, height: UNBOUND_HEIGHT });

            pairGutters[1].onDragStart({ clientX: TRANSLATE_PRESS_X } as MouseEvent);
            pairGutters[1].onDrag({ clientX: 300 } as MouseEvent);
            flushFrame();

            expect(panes[1].getX()).toBe(104);
            expect(panes[1].getTranslateX()).toBe(TRANSLATE);
            expect(panes[1].getWidth()).toBe(TRANSLATE_PANE_MAIN);
            expect(pairGutters[1].getX()).toBe(241);
            expect(box(panes[2])).toEqual({ x: 248, y: 0, width: TRANSLATE_LAST_MAX, height: TRANSLATE_HOST_HEIGHT });
            expect(gutterOffset(pair, true)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(pair, true)).toBe(REST_DIVIDER_GAP);
        });
    });

    describe('the trailing pane stays inside its host', () => {
        it('C1. moves nothing on a frame a mid-drag shrink left with nothing to move', () => {
            const scn = scene(skippablePane, skippablePane);

            press(scn);
            shrinkHost(scn, true);

            const count = passes(scn.lhs, scn.rhs);

            // Back at the press coordinate after the shrink: the leading pane is
            // asked for the width it holds, and the trailing pane for the width
            // it holds, so the frame moves neither. Against the press-time total
            // the trailing pane is asked for 296 instead, which ends at 400 —
            // 100 px past the shrunken host's own inner edge.
            move(scn, PRESS_X);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: PANE_PREFERRED, height: HOST_HEIGHT });
            expect(box(scn.rhs)).toEqual({ x: 104, y: 0, width: 196, height: HOST_HEIGHT });
            expect(trailingEnd(scn, true)).toBe(SHRUNK_HOST_WIDTH);
            expect(count()).toEqual([0, 0]);
        });

        it('C2. divides the live total on a moving frame after a mid-drag shrink', () => {
            const scn = scene(skippablePane, skippablePane);

            press(scn);
            shrinkHost(scn, true);
            move(scn, 200);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: 200, height: HOST_HEIGHT });
            expect(scn.gutter.getX()).toBe(197);
            expect(box(scn.rhs)).toEqual({ x: 204, y: 0, width: 96, height: HOST_HEIGHT });
            expect(gutterOffset(scn, true)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(scn, true)).toBe(REST_DIVIDER_GAP);
            expect(trailingEnd(scn, true)).toBe(SHRUNK_HOST_WIDTH);
        });

        it('C3. divides it on the y axis too', () => {
            const scn = verticalScene(skippablePane, skippablePane);

            pressDown(scn);
            shrinkHost(scn, false);
            moveDown(scn, 200);

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: VERTICAL_HOST_WIDTH, height: 200 });
            expect(scn.gutter.getY()).toBe(197);
            expect(box(scn.rhs)).toEqual({ x: 0, y: 204, width: VERTICAL_HOST_WIDTH, height: 96 });
            expect(gutterOffset(scn, false)).toBe(REST_GUTTER_OFFSET);
            expect(dividerGap(scn, false)).toBe(REST_DIVIDER_GAP);
            expect(trailingEnd(scn, false)).toBe(SHRUNK_HOST_WIDTH);
        });

        it('C4. divides it on the release frame, which is the one the user is left looking at', () => {
            const scn = scene(skippablePane, skippablePane);

            press(scn);
            shrinkHost(scn, true);

            // No frame drained: the release force-flushes the buffered move, so
            // this last `onDrag` runs out of `ResizeDrag.end()`. A total read
            // anywhere but inside `onDrag` would leave exactly this frame stale.
            scn.gutter.onDrag({ clientX: 200 } as MouseEvent);
            scn.gutter.onDragStop();

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: 200, height: HOST_HEIGHT });
            expect(box(scn.rhs)).toEqual({ x: 204, y: 0, width: 96, height: HOST_HEIGHT });
            expect(trailingEnd(scn, true)).toBe(SHRUNK_HOST_WIDTH);
        });

        it('C5. divides it on an outline release after a mid-drag shrink', () => {
            const scn = scene(skippablePane, skippablePane, 'outline');

            press(scn);
            shrinkHost(scn, true);

            // With the frame drained the outline has moved and the panes have
            // not, so `end()` has nothing buffered to flush and commits the
            // previewed move once. The committed frame must divide the *live*
            // total, not the press-time one the outline's own preview replays.
            scn.gutter.onDrag({ clientX: 200 } as MouseEvent);
            flushFrame();

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: PANE_PREFERRED, height: HOST_HEIGHT });

            scn.gutter.onDragStop();

            expect(box(scn.lhs)).toEqual({ x: 0, y: 0, width: 200, height: HOST_HEIGHT });
            expect(box(scn.rhs)).toEqual({ x: 204, y: 0, width: 96, height: HOST_HEIGHT });
            expect(trailingEnd(scn, true)).toBe(SHRUNK_HOST_WIDTH);
        });
    });

    describe('the stored sizes', () => {
        it('S1. never stores a size a pane refused', () => {
            const scn = scene();

            drive(scn, [400]);
            scn.rhs.setMaxSize({ width: RHS_MAX_DROPPED, height: UNBOUND_HEIGHT });
            move(scn, 500);

            // `_sizes` is the ratio the next `doLayout` reproduces and the array
            // `getPaneSizes()` hands a consumer to persist through `paneresize`,
            // so the 296 this frame requested and the leading pane refused must
            // not reach it.
            expect(scn.split.getPaneSize(scn.lhs)).toBe(LHS_MAX);
            expect(scn.split.getPaneSize(scn.rhs)).toBe(RHS_MAX_DROPPED);
        });
    });

    /** U7's host box: three 100 px panes plus the two reserved gaps. */
    const TRANSLATE_HOST_WIDTH  = 308;
    const TRANSLATE_HOST_HEIGHT = 200;

    /** Each of U7's three panes at rest, and the middle pane's width throughout. */
    const TRANSLATE_PANE_MAIN = 100;

    /** What U7's first and last panes are resized to, which moves the middle pane's slot. */
    const TRANSLATE_FIRST_MAIN = 140;
    const TRANSLATE_LAST_MAIN  = 60;

    /** The translate the middle pane ends up carrying: how far its slot moved. */
    const TRANSLATE = TRANSLATE_FIRST_MAIN - TRANSLATE_PANE_MAIN;

    /** U7's last pane's maximum, which its frame's inverted bracket runs into. */
    const TRANSLATE_LAST_MAX = 20;

    /** Where U7 presses its gutter: inside the second gutter's own hit box. */
    const TRANSLATE_PRESS_X = 245;

    /**
     * U7's fixture: a three-pane split whose middle pane carries a translate. One
     * `setPaneSize` on each outer pane plus one `doLayout` moves the middle
     * pane's slot without changing its width, which is the one shape
     * `LayoutManager.commitBounds`' size-stable-move fast path takes — it writes
     * the move as a `transform` and leaves `getX()` reporting the pre-move
     * coordinate.
     *
     * @returns The three panes and the two gutters between them.
     */
    function translateScene(): { panes: Component[]; pairGutters: DragGutter[] } {
        const split = new Split({ orientation: 'horizontal', spacing: SPACING });
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.clearInsets();
        host.setWidth(TRANSLATE_HOST_WIDTH);
        host.setHeight(TRANSLATE_HOST_HEIGHT);

        const panes = [new Component(), new Component(), new Component()];

        for (const pane of panes) {
            pane.getElement(true);
            host.addComponent(pane, weighted(0));
        }

        host.doLayout();
        hosts.push(host);

        split.setPaneSize(panes[0], TRANSLATE_FIRST_MAIN);
        split.setPaneSize(panes[2], TRANSLATE_LAST_MAIN);
        host.doLayout();

        frames.clear();

        return { panes, pairGutters: gutters(split) };
    }
});
