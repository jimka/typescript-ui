// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Pins that a scrolling `Panel` keeps its scroll geometry current on *every*
 * frame of a live external resize — here a real `Split` gutter drag, driven one
 * captured animation frame per pointer move.
 *
 * Three things used to freeze for the whole drag and only catch up two or three
 * frames after the pointer stopped, because `doLayout` withheld the entire
 * post-layout scroll-metrics remeasure on every frame of a resize burst after
 * the first: the panel's content did not re-flow (the scrollbar gutter
 * reservation was stale, so children were laid out against the wrong content
 * box), an overlay scrollbar froze at a position and track length that no longer
 * matched the pane, and the scroll-shadow edge kept a strength that no longer
 * matched either. Each froze at the value the burst's *first* frame committed —
 * that frame finds no burst in progress and so measures live — not at the
 * pre-drag value, so the error grew with however far the pane travelled
 * afterwards. The remeasure is the sole caller of all three write groups, so
 * withholding it froze them together: within a layout pass nothing else writes
 * any of them. (The overlay install path and the scroll handler write the same
 * state outside a layout pass, which is why scrolling a panel mid-burst still
 * moved its thumb — so no case here scrolls during a drag.)
 *
 * Both directions of the overflow threshold are covered, and each scene crosses
 * it *during* the burst rather than before or after it:
 *
 * - The **disappearing** direction (scenes V, H, N) grows the pane past its
 *   content, so a reserved gutter must be released, a shown bar hidden and a lit
 *   shadow edge ramped down mid-drag.
 * - The **appearing** direction (scenes AV, AH, AN) shrinks the pane until its
 *   content overflows, so a gutter must be reserved, a hidden bar shown and a
 *   dark shadow edge lit mid-drag. This direction is the one a user reported by
 *   hand — shrinking a viewport over a list that had no scrollbar showed none
 *   until the drag settled — and it is the reason the withholding was removed
 *   outright rather than merely gated.
 *
 * Every case pins a geometry consequence — a committed component box, a recorded
 * style write, the cached gutter — rather than a remeasure call count, and every
 * assertion about a transition is anchored on the same observable against its
 * value on an earlier frame of the same burst, so an implementation that stopped
 * measuring altogether fails the anchor rather than passing the transition.
 *
 * Scenes H and AH are not symmetry arguments about V and AV. They drive the
 * horizontal arm of every expression the vertical arm uses, which is the only
 * thing that catches a change narrowed to one axis — the same reason
 * Split.dragFrameGate.test.ts carries its own `verticalScene`.
 *
 * The harness is Split.dragFrameGate.test.ts's: the same `installTestDOM`
 * config, `requestAnimationFrame` capture, `_gutters[0]` reach,
 * `onDragStart`/`onDrag` drive and host-disposing teardown, plus
 * `setScrollExtent` from tests/dom/TestDOM to inject the overflow there is no
 * real layout offline to produce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { _Panel } from '~/core/Panel';
import { Fit } from '~/layout/Fit';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Split } from '~/layout/Split';
import { setAppResizeMode } from '~/core/ResizeDrag';
import { Tooltip } from '~/overlay/Tooltip';
import { Scrollbar } from '~/component/container/Scrollbar';
import { installTestDOM, setScrollExtent } from '../dom/TestDOM';
import type { RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Every host's extent across its split axis, and so the scrolling pane's fixed cross extent. */
const CROSS_AXIS_HOST = 300;

/**
 * The gap the `Split` reserves between its two panes. `Split`'s own default is
 * `0`; a non-zero gap is what makes each pane half the host *less half the gap*,
 * which is what lands the overflow threshold strictly inside the drive below
 * rather than on its first frame. 4 px is the narrowest gap that separates the
 * two panes' boxes at all.
 */
const GUTTER_GAP = 4;

/** Every `Panel`'s own default inset per side, from `Panel`'s class defaults. */
const PANEL_INSET = 4;

/** The overlay `Scrollbar`'s track width, which is the gutter an overlay-mode panel reserves. */
const OVERLAY_TRACK = 12;

/** `CONFIG.scrollBarWidth`, which is the gutter a native-mode panel reserves. */
const NATIVE_TRACK = 15;

/** The content's extent along the pane's scroll axis, fixed for every drag below. */
const CONTENT_MAIN = 400;

/** The content's extent across the scroll axis: always inside the pane, so it never reserves a gutter. */
const CONTENT_CROSS = 200;

/** A child's cross-axis extent with no gutter reserved: the pane's cross extent less its insets. */
const CHILD_CROSS = CROSS_AXIS_HOST - 2 * PANEL_INSET;

/**
 * The host extent along the split axis for a drag that **grows** the scrolling
 * pane, and the pointer coordinate its resting gap midline sits at. Sized so the
 * pane starts at 298 — below `CONTENT_MAIN`, hence already overflowing.
 */
const GROW_SPLIT_HOST = 600;
const GROW_PRESS      = 300;

/** The four pointer coordinates the growing drag is driven through, one captured frame each. */
const GROW_DRIVE = [350, 400, 450, 500];

/**
 * The host extent along the split axis for a drag that **shrinks** the pane, and
 * its resting gap midline. Sized so the pane starts at 498 — above
 * `CONTENT_MAIN`, hence fitting, with no gutter and no lit edge.
 */
const SHRINK_SPLIT_HOST = 1000;
const SHRINK_PRESS      = 500;

/** The four pointer coordinates the shrinking drag is driven through. */
const SHRINK_DRIVE = [480, 440, 400, 360];

/**
 * A drag's pane extents along the split axis: its resting extent and one per
 * drive step. `Split` shares `host - GUTTER_GAP` between two equally weighted
 * panes, so the resting extent is half of that; a drive that puts the gap's
 * midline at `pos` leaves the leading pane half the gap short of the pointer.
 *
 * @param splitHost - The host's extent along the split axis.
 * @param drive - The pointer coordinates the drag is driven through.
 * @returns The resting extent and the extent after each drive step.
 */
function paneExtents(splitHost: number, drive: readonly number[]): { rest: number; frames: number[] } {
    return {
        rest:   (splitHost - GUTTER_GAP) / 2,
        frames: drive.map((position) => position - GUTTER_GAP / 2),
    };
}

/** Growing: 298 at rest, then 348, 398, 448, 498 — crossing 400 between frames 1 and 2. */
const GROW = paneExtents(GROW_SPLIT_HOST, GROW_DRIVE);

/** Shrinking: 498 at rest, then 478, 438, 398, 358 — crossing 400 between frames 1 and 2. */
const SHRINK = paneExtents(SHRINK_SPLIT_HOST, SHRINK_DRIVE);

/** The burst's first frame: the one frame that measured live even before this change. */
const FIRST = 0;

/** The last frame on the threshold's starting side, and the anchor every transition is read against. */
const BEFORE_CROSSING = 1;

/** The frame the content crosses the overflow threshold on. */
const CROSSING = 2;

/** One frame past the crossing, where the gutter change's own follow-up re-layout lands. */
const AFTER_CROSSING = 3;

/** The `Split` gutter's drag surface, reached the way Split.dragFrameGate.test.ts reaches it. */
type Gutter = Component & {
    onDragStart(event: MouseEvent): unknown;
    onDrag(event: MouseEvent): unknown;
    onDragStop(): unknown;
};

/** Narrow shape reaching the scroll-geometry private state without `any`. */
type PanelInternals = {
    _scrollbarGutter: { right: number; bottom: number };
    _shadowEdges:     { top: number; bottom: number; left: number; right: number };
    _scrollbarV:      Scrollbar | null;
    _scrollbarH:      Scrollbar | null;
    _shadowOverlay:   Handle | null;
    _overlayScrollElement: Handle | null;
};

/** What a case needs to drive one gutter drag and read the pane's geometry back. */
interface Scene {
    pane:  _Panel;
    child: Component;
    /** The pane's extent along the split axis after each drive step. */
    extents: number[];
    /** The pane's resting extent along the split axis, before the press. */
    rest: number;
    gutter: Gutter;
    /** The `MouseEvent` coordinate the split's own axis reads. */
    axis: 'clientX' | 'clientY';
    /** The pointer coordinates this drag is driven through. */
    drive: readonly number[];
    press: number;
}

/** How one scene differs from the others. */
interface SceneOptions {
    /** The split's axis. A vertical split scrolls its pane on `y`, a horizontal one on `x`. */
    orientation: 'vertical' | 'horizontal';
    /**
     * Which way the drag moves the scrolling pane. `"grows"` starts it
     * overflowing and takes it past its content, so the affordance must
     * disappear mid-drag; `"shrinks"` starts it fitting and takes it below its
     * content, so the affordance must appear mid-drag.
     */
    direction: 'grows' | 'shrinks';
    /** Native mode installs no overlay bars, which is what makes scenes N and AN their own. */
    scrollbarStyle?: 'native';
}

let frames:      Map<number, FrameRequestCallback>;
let nextFrameId: number;
let hosts:       Container[];
let sink:        RecordingDOMSink;

beforeEach(() => {
    sink        = installTestDOM(CONFIG);
    frames      = new Map();
    nextFrameId = 1;
    hosts       = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        const id = nextFrameId++;

        frames.set(id, callback);

        return id;
    });
    vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
        frames.delete(id);
    });
});

afterEach(() => {
    // Disposing the host runs `Split.detach`, which cancels a drag left
    // mid-flight; without it the session's viewport listeners survive in
    // `Event`'s module-level registration maps, which DOM.reset() does not
    // clear. Split.dragFrameGate.test.ts's teardown, for the same reason.
    for (const host of hosts) {
        host.dispose();
    }

    // Then drain to quiescence while the captured `requestAnimationFrame` is
    // still installed. `Component.afterNextLayout`'s `cancel()` only sets a
    // flag — it does not deregister the frame — so a case ending with frames
    // still queued otherwise leaves `Component`'s module-level flush handle
    // non-null, and the next case's own layout scheduling finds a flush already
    // pending and registers no fresh frame. Every case below then drives a drag
    // whose frames never run, and each fails on its very first assertion.
    drainFrames();

    vi.restoreAllMocks();
    setAppResizeMode('live');
    Tooltip._stopPointerWatch();
    DOM.reset();
});

/** Runs every frame callback pending since the last drain, without draining what they re-queue. */
function flushFrame(): void {
    const pending = [...frames.values()];

    frames.clear();

    for (const callback of pending) {
        callback(0);
    }
}

/** Runs queued frames to quiescence, including any re-armed in turn. */
function drainFrames(): void {
    for (let guard = 0; guard < 14 && frames.size > 0; guard++) {
        flushFrame();
    }
}

/**
 * A pane added with a resize weight, as both of a scene's panes are.
 *
 * @param weight - The pane's resize weight.
 * @returns The constraints carrying it.
 */
function weighted(weight: number): LayoutConstraints {
    const constraints = new LayoutConstraints();

    constraints.weight = weight;

    return constraints;
}

/**
 * Reaches a panel's scroll-geometry private state.
 *
 * @param panel - The panel to inspect.
 * @returns Its private scroll-geometry fields.
 */
function internals(panel: _Panel): PanelInternals {
    return panel as unknown as PanelInternals;
}

/**
 * Last committed value of a camelCase style key applied to a raw handle —
 * PanelOverlayScrollbar.test.ts's helper.
 *
 * @param handle - The element whose writes to scan.
 * @param key - The camelCase style property.
 * @returns The last value written, or `undefined` when the key was never written.
 */
function lastStyle(handle: Handle, key: string): string | undefined {
    let value: string | undefined;

    for (const write of sink.writes) {
        if (write.op === 'apply' && write.args[0] === handle) {
            const patch = write.args[1] as { style?: Record<string, string | null> };

            if (patch.style && key in patch.style) {
                value = patch.style[key] ?? undefined;
            }
        }
    }

    return value;
}

/**
 * Builds a two-pane `Split` whose leading pane scrolls along the split's own
 * axis, settles it, then seeds the content's scroll extent.
 *
 * @param options - Which axis, which direction, and which scrollbar style.
 * @returns The scene, ready to press.
 */
function scrollingSplitScene(options: SceneOptions): Scene {
    const vertical  = options.orientation === 'vertical';
    const growing   = options.direction === 'grows';
    const splitHost = growing ? GROW_SPLIT_HOST : SHRINK_SPLIT_HOST;
    const geometry  = growing ? GROW : SHRINK;
    const split     = new Split({ orientation: options.orientation, spacing: GUTTER_GAP });
    const host      = new Container({ layoutManager: split });

    host.getElement(true);
    host.clearInsets();
    host.setWidth(vertical  ? CROSS_AXIS_HOST : splitHost);
    host.setHeight(vertical ? splitHost : CROSS_AXIS_HOST);

    const pane = new _Panel({
        layoutManager: new Fit(),
        autoScroll:    vertical ? 'y' : 'x',
        ...(options.scrollbarStyle ? { scrollbarStyle: options.scrollbarStyle } : {}),
    });

    const extent = vertical
        ? { width: CONTENT_CROSS, height: CONTENT_MAIN }
        : { width: CONTENT_MAIN,  height: CONTENT_CROSS };

    const child    = new Component({ preferredSize: extent });
    const trailing = new _Panel();

    pane.getElement(true);
    child.getElement(true);
    trailing.getElement(true);
    pane.addComponent(child);
    host.addComponent(pane,     weighted(1));
    host.addComponent(trailing, weighted(1));
    host.doLayout();
    hosts.push(host);

    // Settle the scene's own construction before the press, so the drag's own
    // frames are the only ones a case's `flushFrame` runs.
    drainFrames();

    // There is no real layout offline to measure overflowing content against, so
    // the scroll extent is an injected input. Overlay mode scrolls an inner
    // element the panel owns; native mode scrolls the panel element itself.
    setScrollExtent(internals(pane)._overlayScrollElement ?? pane.getElement()!, extent);

    host.doLayout();
    drainFrames();

    const gutter = (split as unknown as { _gutters: Gutter[] })._gutters[0];

    return {
        pane,
        child,
        extents: geometry.frames,
        rest:    geometry.rest,
        gutter,
        axis:    vertical ? 'clientY' : 'clientX',
        drive:   growing ? GROW_DRIVE : SHRINK_DRIVE,
        press:   growing ? GROW_PRESS : SHRINK_PRESS,
    };
}

/**
 * Presses the gutter at its resting midline, starting the drag session.
 *
 * @param scene - The scene to press.
 */
function press(scene: Scene): void {
    scene.gutter.onDragStart({ [scene.axis]: scene.press } as unknown as MouseEvent);
}

/**
 * Runs one drag frame: moves the gutter to the given drive step and runs the
 * frames that move queued — the one captured frame a real pointer move gets.
 *
 * @param scene - The scene to drive.
 * @param frame - The index into the scene's drive.
 */
function dragTo(scene: Scene, frame: number): void {
    scene.gutter.onDrag({ [scene.axis]: scene.drive[frame] } as unknown as MouseEvent);
    flushFrame();
}

describe('Panel resize-geometry staleness', () => {
    describe('Scene V — growing a y-scrolling overlay pane past its content', () => {
        it('V1 — releases the reservation on the frame the content stops overflowing', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'grows' });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            // The non-zero anchor the release is read against: a run that
            // reserved nothing at all fails here instead of passing below.
            expect(internals(scene.pane)._scrollbarGutter.right).toBe(OVERLAY_TRACK);

            dragTo(scene, CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.right).toBe(0);
        });

        it('V2 — lets the child recover its width during the drag, one frame after the release', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'grows' });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(scene.child.getWidth()).toBe(CHILD_CROSS - OVERLAY_TRACK);

            dragTo(scene, CROSSING);

            // `commitScrollbarGutterIfChanged` schedules the pass that re-lays the
            // child out, so the recovery lands on the frame after the release.
            dragTo(scene, AFTER_CROSSING);

            expect(scene.child.getWidth()).toBe(CHILD_CROSS);
        });

        it('V3 — keeps the vertical bar\'s track length on the pane on every frame', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'grows' });
            const bar   = internals(scene.pane)._scrollbarV!;

            expect(bar.getHeight()).toBe(scene.rest);

            press(scene);

            for (const frame of [FIRST, BEFORE_CROSSING, CROSSING, AFTER_CROSSING]) {
                dragTo(scene, frame);

                expect(bar.getHeight()).toBe(scene.extents[frame]);
            }
        });

        it('V4 — returns the bar to the un-inset edge and hides it on the crossing frame', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'grows' });
            const bar   = internals(scene.pane)._scrollbarV!;

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(bar.getX()).toBe(CROSS_AXIS_HOST - OVERLAY_TRACK);
            expect(bar.isDisplayed()).toBe(true);

            dragTo(scene, CROSSING);

            expect(bar.getX()).toBe(CROSS_AXIS_HOST);
            expect(bar.isDisplayed()).toBe(false);
        });

        it('V5 — ramps the bottom shadow edge down during the drag', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'grows' });
            const edges = internals(scene.pane)._shadowEdges;

            press(scene);
            dragTo(scene, FIRST);

            // Fully lit: 400 px of content in a 348 px viewport leaves more than
            // the ramp's own span still to scroll.
            expect(edges.bottom).toBe(100);

            dragTo(scene, BEFORE_CROSSING);

            // Ramping, not switched off: 2 px left to scroll at a 398 px viewport.
            expect(edges.bottom).toBeGreaterThan(0);
            expect(edges.bottom).toBeLessThan(100);

            dragTo(scene, CROSSING);

            expect(edges.bottom).toBe(0);
        });

        it('V6 — keeps the inner overlay scroller on the pane\'s post-gutter box every frame', () => {
            // The inner scroller was the one write the withheld branch still made
            // from cached data, so it alone tracked the pane while the bar, the
            // gutter and the shadow froze. It must still track — now because the
            // whole remeasure runs, not because of a special case — and its width
            // must follow the gutter's release rather than staying inset.
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'grows' });
            const inner = internals(scene.pane)._overlayScrollElement!;

            press(scene);

            for (const frame of [FIRST, BEFORE_CROSSING, CROSSING, AFTER_CROSSING]) {
                dragTo(scene, frame);

                const reserved = frame <= BEFORE_CROSSING ? OVERLAY_TRACK : 0;

                expect(lastStyle(inner, 'height')).toBe(scene.extents[frame] + 'px');
                expect(lastStyle(inner, 'width')).toBe((CROSS_AXIS_HOST - reserved) + 'px');
            }
        });

    });

    describe('Scene H — growing an x-scrolling overlay pane past its content', () => {
        it('H1 — releases the bottom reservation on the crossing frame', () => {
            const scene = scrollingSplitScene({ orientation: 'horizontal', direction: 'grows' });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.bottom).toBe(OVERLAY_TRACK);

            dragTo(scene, CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.bottom).toBe(0);
        });

        it('H2 — lets the child recover its height during the drag', () => {
            const scene = scrollingSplitScene({ orientation: 'horizontal', direction: 'grows' });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(scene.child.getHeight()).toBe(CHILD_CROSS - OVERLAY_TRACK);

            dragTo(scene, CROSSING);
            dragTo(scene, AFTER_CROSSING);

            expect(scene.child.getHeight()).toBe(CHILD_CROSS);
        });

        it('H3 — keeps the horizontal bar on the pane and hides it on the crossing frame', () => {
            const scene = scrollingSplitScene({ orientation: 'horizontal', direction: 'grows' });
            const bar   = internals(scene.pane)._scrollbarH!;

            press(scene);
            dragTo(scene, FIRST);

            expect(bar.getWidth()).toBe(scene.extents[FIRST]);
            expect(bar.getY()).toBe(CROSS_AXIS_HOST - OVERLAY_TRACK);
            expect(bar.isDisplayed()).toBe(true);

            dragTo(scene, BEFORE_CROSSING);

            expect(bar.getWidth()).toBe(scene.extents[BEFORE_CROSSING]);

            dragTo(scene, CROSSING);

            expect(bar.getWidth()).toBe(scene.extents[CROSSING]);
            expect(bar.getY()).toBe(CROSS_AXIS_HOST);
            expect(bar.isDisplayed()).toBe(false);

            dragTo(scene, AFTER_CROSSING);

            expect(bar.getWidth()).toBe(scene.extents[AFTER_CROSSING]);
        });

        it('H4 — keeps the shadow overlay\'s committed box on the pane on every frame', () => {
            const scene  = scrollingSplitScene({ orientation: 'horizontal', direction: 'grows' });
            const shadow = internals(scene.pane)._shadowOverlay!;

            press(scene);
            dragTo(scene, FIRST);

            expect(lastStyle(shadow, 'width')).toBe(scene.extents[FIRST] + 'px');
            expect(lastStyle(shadow, 'height')).toBe((CROSS_AXIS_HOST - OVERLAY_TRACK) + 'px');

            dragTo(scene, BEFORE_CROSSING);

            expect(lastStyle(shadow, 'width')).toBe(scene.extents[BEFORE_CROSSING] + 'px');

            dragTo(scene, CROSSING);

            expect(lastStyle(shadow, 'width')).toBe(scene.extents[CROSSING] + 'px');
            expect(lastStyle(shadow, 'height')).toBe(CROSS_AXIS_HOST + 'px');

            dragTo(scene, AFTER_CROSSING);

            expect(lastStyle(shadow, 'width')).toBe(scene.extents[AFTER_CROSSING] + 'px');
        });

        it('H5 — ramps the right shadow edge down during the drag', () => {
            const scene = scrollingSplitScene({ orientation: 'horizontal', direction: 'grows' });
            const edges = internals(scene.pane)._shadowEdges;

            press(scene);
            dragTo(scene, FIRST);

            expect(edges.right).toBe(100);

            dragTo(scene, BEFORE_CROSSING);

            expect(edges.right).toBeGreaterThan(0);
            expect(edges.right).toBeLessThan(100);

            dragTo(scene, CROSSING);

            expect(edges.right).toBe(0);
        });
    });

    describe('Scene N — growing a native-scrollbar pane past its content', () => {
        it('N1 — releases the native reservation on the crossing frame, with no overlay bar in play', () => {
            const scene = scrollingSplitScene({
                orientation:    'vertical',
                direction:      'grows',
                scrollbarStyle: 'native',
            });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.right).toBe(NATIVE_TRACK);

            // Native mode installs no overlay bars, so the frozen-bar symptom
            // cannot arise here while the other two still do.
            expect(internals(scene.pane)._scrollbarV).toBeNull();

            dragTo(scene, CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.right).toBe(0);
            expect(internals(scene.pane)._scrollbarV).toBeNull();
        });

        it('N2 — lets the child recover its width during the drag', () => {
            const scene = scrollingSplitScene({
                orientation:    'vertical',
                direction:      'grows',
                scrollbarStyle: 'native',
            });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(scene.child.getWidth()).toBe(CHILD_CROSS - NATIVE_TRACK);

            dragTo(scene, CROSSING);
            dragTo(scene, AFTER_CROSSING);

            expect(scene.child.getWidth()).toBe(CHILD_CROSS);
        });

        it('N3 — keeps the shadow overlay\'s committed height on the pane on every frame', () => {
            // The height, not the width: offline `getScrollMetrics` reports
            // `clientWidth` as the recorded style width and does not subtract a
            // native scrollbar, so the width figure cannot distinguish a current
            // measurement from a stale one. The height can, because this scene
            // never reserves a bottom gutter.
            const scene = scrollingSplitScene({
                orientation:    'vertical',
                direction:      'grows',
                scrollbarStyle: 'native',
            });

            const shadow = internals(scene.pane)._shadowOverlay!;

            press(scene);

            for (const frame of [FIRST, BEFORE_CROSSING, CROSSING, AFTER_CROSSING]) {
                dragTo(scene, frame);

                expect(lastStyle(shadow, 'height')).toBe(scene.extents[frame] + 'px');
            }
        });
    });

    // The appearing direction. This is the reported defect: shrinking a viewport
    // over content that fitted showed no scrollbar and no shadow until the drag
    // settled, because every frame of the burst past the first was withheld and
    // nothing cached could predict an overflow that had not been measured yet.
    describe('Scene AV — shrinking a y-scrolling overlay pane until its content overflows', () => {
        it('AV1 — reserves the gutter on the frame the content starts overflowing', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'shrinks' });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            // The anchor: still fitting one frame earlier, so the reservation
            // below is a transition this burst made rather than a standing value.
            expect(internals(scene.pane)._scrollbarGutter.right).toBe(0);

            dragTo(scene, CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.right).toBe(OVERLAY_TRACK);
        });

        it('AV2 — shows the bar during the burst, inset and at the pane\'s own track length', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'shrinks' });
            const bar   = internals(scene.pane)._scrollbarV!;

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(bar.isDisplayed()).toBe(false);
            expect(bar.getX()).toBe(CROSS_AXIS_HOST);

            dragTo(scene, CROSSING);

            expect(bar.isDisplayed()).toBe(true);
            expect(bar.getX()).toBe(CROSS_AXIS_HOST - OVERLAY_TRACK);
            expect(bar.getHeight()).toBe(scene.extents[CROSSING]);

            dragTo(scene, AFTER_CROSSING);

            expect(bar.isDisplayed()).toBe(true);
            expect(bar.getHeight()).toBe(scene.extents[AFTER_CROSSING]);
        });

        it('AV3 — lights the bottom shadow edge during the burst', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'shrinks' });
            const edges = internals(scene.pane)._shadowEdges;

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(edges.bottom).toBe(0);

            dragTo(scene, CROSSING);

            // Lit but still ramping: 2 px to scroll at a 398 px viewport.
            expect(edges.bottom).toBeGreaterThan(0);
            expect(edges.bottom).toBeLessThan(100);

            dragTo(scene, AFTER_CROSSING);

            expect(edges.bottom).toBe(100);
        });

        it('AV4 — makes the child give up its width during the burst, one frame after the reservation', () => {
            const scene = scrollingSplitScene({ orientation: 'vertical', direction: 'shrinks' });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);
            dragTo(scene, CROSSING);

            expect(scene.child.getWidth()).toBe(CHILD_CROSS);

            dragTo(scene, AFTER_CROSSING);

            expect(scene.child.getWidth()).toBe(CHILD_CROSS - OVERLAY_TRACK);
        });
    });

    describe('Scene AH — shrinking an x-scrolling overlay pane until its content overflows', () => {
        it('AH1 — reserves the bottom gutter and shows the horizontal bar during the burst', () => {
            const scene = scrollingSplitScene({ orientation: 'horizontal', direction: 'shrinks' });
            const bar   = internals(scene.pane)._scrollbarH!;

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.bottom).toBe(0);
            expect(bar.isDisplayed()).toBe(false);
            expect(bar.getY()).toBe(CROSS_AXIS_HOST);

            dragTo(scene, CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.bottom).toBe(OVERLAY_TRACK);
            expect(bar.isDisplayed()).toBe(true);
            expect(bar.getY()).toBe(CROSS_AXIS_HOST - OVERLAY_TRACK);
            expect(bar.getWidth()).toBe(scene.extents[CROSSING]);
        });

        it('AH2 — makes the child give up its height during the burst', () => {
            const scene = scrollingSplitScene({ orientation: 'horizontal', direction: 'shrinks' });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);
            dragTo(scene, CROSSING);

            expect(scene.child.getHeight()).toBe(CHILD_CROSS);

            dragTo(scene, AFTER_CROSSING);

            expect(scene.child.getHeight()).toBe(CHILD_CROSS - OVERLAY_TRACK);
        });

        it('AH3 — lights the right shadow edge during the burst', () => {
            const scene = scrollingSplitScene({ orientation: 'horizontal', direction: 'shrinks' });
            const edges = internals(scene.pane)._shadowEdges;

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(edges.right).toBe(0);

            dragTo(scene, CROSSING);

            expect(edges.right).toBeGreaterThan(0);
            expect(edges.right).toBeLessThan(100);

            dragTo(scene, AFTER_CROSSING);

            expect(edges.right).toBe(100);
        });
    });

    describe('Scene AN — shrinking a native-scrollbar pane until its content overflows', () => {
        it('AN1 — reserves the native gutter during the burst, with no overlay bar in play', () => {
            const scene = scrollingSplitScene({
                orientation:    'vertical',
                direction:      'shrinks',
                scrollbarStyle: 'native',
            });

            press(scene);
            dragTo(scene, FIRST);
            dragTo(scene, BEFORE_CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.right).toBe(0);
            expect(internals(scene.pane)._scrollbarV).toBeNull();

            dragTo(scene, CROSSING);

            expect(internals(scene.pane)._scrollbarGutter.right).toBe(NATIVE_TRACK);
            expect(internals(scene.pane)._scrollbarV).toBeNull();

            dragTo(scene, AFTER_CROSSING);

            expect(scene.child.getWidth()).toBe(CHILD_CROSS - NATIVE_TRACK);
        });

        it('AN2 — keeps the shadow overlay\'s committed height on the pane on every frame', () => {
            const scene = scrollingSplitScene({
                orientation:    'vertical',
                direction:      'shrinks',
                scrollbarStyle: 'native',
            });

            const shadow = internals(scene.pane)._shadowOverlay!;

            press(scene);

            for (const frame of [FIRST, BEFORE_CROSSING, CROSSING, AFTER_CROSSING]) {
                dragTo(scene, frame);

                expect(lastStyle(shadow, 'height')).toBe(scene.extents[frame] + 'px');
            }
        });
    });
});
