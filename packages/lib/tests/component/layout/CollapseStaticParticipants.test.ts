// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for split-collapse-static-participants.md: `runCollapse` hands only
 * the participants whose box actually changes to the animation's frame loop, so
 * a pane, region or gutter that ends where it started is laid out once — by the
 * end layout — instead of once per frame. Case numbers below refer to that
 * plan's `## Expected Behaviour` list (E1-E9), and every expected count and box
 * is the one that list records.
 *
 * Settling works as in `Split.collapseUndisplay.test.ts`: `transitionend` never
 * fires offline and the modelled DOM swallows `requestAnimationFrame`, so frame
 * callbacks are captured through a `DOM.sink.requestAnimationFrame` spy and run
 * with a timestamp past the collapse duration, and the fake clock is advanced
 * past the primed transitions' fallback timers. A mid-animation case uses
 * {@link runFrame} rather than {@link flushFrames}: a frame short of the
 * duration reschedules itself, so flushing would run it up to
 * {@link MAX_FLUSH_ROUNDS} times.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
import { Border } from '~/layout/Border';
import { Fit } from '~/layout/Fit';
import { VBox } from '~/layout/VBox';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { LayoutManager } from '~/layout/LayoutManager';
import { Placement } from '~/primitive/Placement';
import { Animation } from '~/core/Animation';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Comfortably past the 200 ms collapse duration plus its 40 ms fallback buffer,
 * so one flush lands every geometry frame on its end state and every primed
 * transition's fallback timer fires.
 */
const PAST_FALLBACK_MS = 1000;

/**
 * Mid-animation offset for the "still animating" moments: well inside the
 * 200 ms collapse duration, so a frame run this far in commits an interpolated
 * rect and reschedules rather than settling.
 */
const MID_ANIMATION_MS = 50;

/**
 * Upper bound on flush rounds. At a past-duration timestamp the geometry loop
 * settles in one frame, and an effective-visibility reconcile schedules at most
 * one more, so a run that needs more than a handful is a loop, not progress.
 */
const MAX_FLUSH_ROUNDS = 8;

/** The host every scene is built in, matching the plan's scenes. */
const HOST_WIDTH  = 400;
const HOST_HEIGHT = 300;

let frames: FrameRequestCallback[] = [];

/** Installs the modelled DOM, fake timers, and the frame-capturing rAF spy. */
function install(): void {
    installTestDOM(CONFIG);

    frames = [];
    vi.useFakeTimers();
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    DOM.reset();
});

/**
 * Runs every captured frame at `offsetMs` past the current clock, then any
 * frames those callbacks scheduled in turn.
 *
 * @param offsetMs - How far past the current clock each frame reports itself.
 */
function flushFrames(offsetMs: number): void {
    for (let round = 0; round < MAX_FLUSH_ROUNDS && frames.length > 0; round += 1) {
        const pending = frames;

        frames = [];

        for (const cb of pending) {
            cb(performance.now() + offsetMs);
        }
    }
}

/**
 * Runs exactly one round of the frames captured so far, leaving whatever they
 * reschedule for the next call. This is what a mid-animation moment needs: the
 * frame it runs is short of the duration and puts itself straight back on the
 * queue.
 *
 * @param offsetMs - How far past the current clock each frame reports itself.
 */
function runFrame(offsetMs: number): void {
    const pending = frames;

    frames = [];

    for (const cb of pending) {
        cb(performance.now() + offsetMs);
    }
}

/**
 * Settles an in-flight collapse/expand: the geometry loop reaches its last
 * frame (firing `onIdle`), then the transition fallbacks fire.
 */
function settle(): void {
    flushFrames(PAST_FALLBACK_MS);
    vi.advanceTimersByTime(PAST_FALLBACK_MS);
    flushFrames(PAST_FALLBACK_MS);
}

/** An axis-aligned box, as the plan's tables write one. */
interface Box {
    x:      number;
    y:      number;
    width:  number;
    height: number;
}

/**
 * A component's visual box: its committed position with any translate folded
 * in, which is what a participant placed by `commitBounds`' size-stable fast
 * path actually occupies.
 *
 * @param component - The component to read.
 * @returns Its visual box.
 */
function visualBox(component: Component): Box {
    return {
        x:      component.getX() + component.getTranslateX(),
        y:      component.getY() + component.getTranslateY(),
        width:  component.getWidth(),
        height: component.getHeight(),
    };
}

/**
 * A comparable snapshot of a component's resting state, for the cases that
 * assert a round trip lands back where it started.
 *
 * @param component - The component to read.
 * @returns Its visual box, clip path and displayed flag.
 */
function restState(component: Component): { box: Box; clip: string | null; displayed: boolean } {
    return {
        box:       visualBox(component),
        clip:      component.getClipPath(),
        displayed: component.isDisplayed(),
    };
}

/** A container that opts into the unchanged-commit skip, the way `MenuBar` and `ToolBar` do. */
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

/**
 * A rendered leaf of a fixed preferred size.
 *
 * @param width - Preferred width.
 * @param height - Preferred height.
 * @returns The leaf.
 */
function makeLeaf(width: number, height: number): Component {
    const leaf = new Component({ preferredSize: { width, height } });

    leaf.getElement(true);

    return leaf;
}

/**
 * The sized, inset-free host every scene is built in.
 *
 * @param manager - The host's layout manager.
 * @returns The rendered host.
 */
function makeHost(manager: LayoutManager): Container {
    const host = new Container({ layoutManager: manager });

    host.getElement(true);
    host.setWidth(HOST_WIDTH);
    host.setHeight(HOST_HEIGHT);
    host.clearInsets();

    return host;
}

/**
 * A rendered `Fit` pane or region holding one leaf.
 *
 * @param leafWidth - The leaf's preferred width.
 * @param leafHeight - The leaf's preferred height.
 * @param preferredSize - The pane's own pinned preferred size, when it has one.
 * @returns The pane and its leaf.
 */
function fitPane(leafWidth: number, leafHeight: number, preferredSize?: { width: number; height: number }): { pane: Container; leaf: Component } {
    const pane = new Container(preferredSize ? { layoutManager: new Fit(), preferredSize } : { layoutManager: new Fit() });
    const leaf = makeLeaf(leafWidth, leafHeight);

    pane.getElement(true);
    pane.addComponent(leaf);

    return { pane, leaf };
}

/** `_gutters` is non-public; every `Split` gutter probe goes through here. */
function splitGutters(split: Split): Component[] {
    return (split as unknown as { _gutters: Component[] })._gutters;
}

/** `_gutters` is non-public; every `Border` gutter probe goes through here. */
function borderGutters(border: Border): Map<Placement, Component> {
    return (border as unknown as { _gutters: Map<Placement, Component> })._gutters;
}

/** The two-pane scene's parts. */
interface TwoPaneScene {
    host:     Container;
    split:    Split;
    rest:     Container;
    restLeaf: Component;
    gutter:   Component;
}

/**
 * The plan's two-pane scene: a weight-0 `lead` pinned at 100x300 beside a
 * weight-1 `rest`, laid out and settled once so spies installed afterwards see
 * only the toggle's own passes.
 *
 * @param lead - The `lead` pane, already rendered and holding its content.
 * @returns The host, the manager, `rest` with its leaf, and the gutter.
 */
function twoPanes(lead: Container): TwoPaneScene {
    const split                = new Split({ orientation: 'horizontal' });
    const host                 = makeHost(split);
    const { pane, leaf } = fitPane(50, 50);

    host.addComponent(lead, { weight: 0 });
    host.addComponent(pane, { weight: 1 });
    host.doLayout();
    settle();

    return { host, split, rest: pane, restLeaf: leaf, gutter: splitGutters(split)[0] };
}

/**
 * The plan's default `lead`: a VBox pane pinned to 100x300 holding two 50x40
 * leaves.
 *
 * @returns The pane and its leaves.
 */
function plainLead(): { lead: Container; leaves: Component[] } {
    const lead   = new Container({ layoutManager: new VBox(), preferredSize: { width: 100, height: 300 } });
    const leaves = [makeLeaf(50, 40), makeLeaf(50, 40)];

    lead.getElement(true);

    for (const leaf of leaves) {
        lead.addComponent(leaf);
    }

    return { lead, leaves };
}

/**
 * E5's `lead`: the same pane on a class that opts into the unchanged-commit
 * skip, holding one 50x40 leaf.
 *
 * @returns The pane and its leaf.
 */
function skippableLead(): { lead: SkippableContainer; leaf: Component } {
    const lead = new SkippableContainer({ layoutManager: new VBox(), preferredSize: { width: 100, height: 300 } });
    const leaf = makeLeaf(50, 40);

    lead.getElement(true);
    lead.addComponent(leaf);

    return { lead, leaf };
}

/** The three-pane scene's parts, in slot order. */
interface ThreePaneScene {
    host:  Container;
    split: Split;
    panes: Container[];
}

/**
 * The plan's three-pane scene: two weight-1 panes around a weight-0 `b` pinned
 * at 100x300, laid out and settled once.
 *
 * @returns The host, the manager and the three panes.
 */
function threePanes(): ThreePaneScene {
    const split = new Split({ orientation: 'horizontal' });
    const host  = makeHost(split);
    const panes = [
        fitPane(50, 50).pane,
        fitPane(50, 50, { width: 100, height: 300 }).pane,
        fitPane(50, 50).pane,
    ];

    host.addComponent(panes[0], { weight: 1 });
    host.addComponent(panes[1], { weight: 0 });
    host.addComponent(panes[2], { weight: 1 });
    host.doLayout();
    settle();

    return { host, split, panes };
}

/**
 * A `placement` constraint, collapsible for every edge (never the centre).
 *
 * @param placement - The region slot.
 * @returns The constraint.
 */
function collapsiblePlacement(placement: Placement): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { placement, collapsible: placement !== Placement.CENTER });
}

/**
 * The plan's `Border` regions, north first so that north's is the first gutter:
 * the slot, then the region's own pinned preferred width and height.
 */
const BORDER_REGIONS: Array<[Placement, number, number]> = [
    [Placement.NORTH,  400, 30],
    [Placement.SOUTH,  400, 20],
    [Placement.WEST,   100, 100],
    [Placement.EAST,    80, 100],
    [Placement.CENTER,  50, 50],
];

/** The `Border` scene's parts. */
interface BorderScene {
    host:    Container;
    border:  Border;
    regions: Map<Placement, Container>;
    leaves:  Map<Placement, Component>;
}

/**
 * The plan's `Border` scene: every edge collapsible and holding one 20x20 leaf,
 * laid out and settled once.
 *
 * @returns The host, the manager, and the regions and leaves by slot.
 */
function borderScene(): BorderScene {
    const border  = new Border({ spacing: 0 });
    const host    = makeHost(border);
    const regions = new Map<Placement, Container>();
    const leaves  = new Map<Placement, Component>();

    for (const [placement, width, height] of BORDER_REGIONS) {
        const { pane, leaf } = fitPane(20, 20, { width, height });

        regions.set(placement, pane);
        leaves.set(placement, leaf);
        host.addComponent(pane, collapsiblePlacement(placement));
    }

    host.doLayout();
    settle();

    return { host, border, regions, leaves };
}

describe('A collapse leaves the static toggled pane out of the frames (E1)', () => {
    it('lays the unmoved pane out once while its moving sibling is animated', () => {
        install();

        const { lead, leaves } = plainLead();
        const { host, split, rest, restLeaf, gutter } = twoPanes(lead);

        const leadLayout = vi.spyOn(lead, 'doLayout');
        const restLayout = vi.spyOn(rest, 'doLayout');

        split.setPaneCollapsed(0, true);

        expect(leadLayout).toHaveBeenCalledTimes(1);
        expect(restLayout).toHaveBeenCalledTimes(2);

        runFrame(MID_ANIMATION_MS);

        expect(leadLayout).toHaveBeenCalledTimes(1);
        expect(restLayout).toHaveBeenCalledTimes(3);

        settle();

        expect(leadLayout).toHaveBeenCalledTimes(1);
        expect(restLayout).toHaveBeenCalledTimes(4);

        expect(visualBox(lead)).toEqual({ x: 0, y: 0, width: 100, height: 300 });
        expect(lead.getClipPath()).toBe('inset(0 100% 0 0)');
        expect(leaves.map(leaf => leaf.isDisplayed())).toEqual([false, false]);
        expect(visualBox(gutter)).toEqual({ x: 0, y: 0, width: 18, height: 300 });
        expect(visualBox(rest)).toEqual({ x: 18, y: 0, width: 382, height: 300 });
        expect(visualBox(restLeaf)).toEqual({ x: 0, y: 0, width: 382, height: 300 });

        host.dispose();
    });
});

describe('The expand does the same (E2)', () => {
    it('lays the unmoved pane out once and restores every pre-collapse box', () => {
        install();

        const { lead, leaves } = plainLead();
        const { host, split, rest, restLeaf, gutter } = twoPanes(lead);

        const before = [lead, ...leaves, rest, restLeaf, gutter].map(restState);

        const leadLayout = vi.spyOn(lead, 'doLayout');
        const restLayout = vi.spyOn(rest, 'doLayout');

        split.setPaneCollapsed(0, true);
        settle();
        leadLayout.mockClear();
        restLayout.mockClear();

        split.setPaneCollapsed(0, false);

        expect(leadLayout).toHaveBeenCalledTimes(1);
        expect(restLayout).toHaveBeenCalledTimes(2);

        runFrame(MID_ANIMATION_MS);

        expect(leadLayout).toHaveBeenCalledTimes(1);
        expect(restLayout).toHaveBeenCalledTimes(3);

        settle();

        expect(leadLayout).toHaveBeenCalledTimes(1);
        expect(restLayout).toHaveBeenCalledTimes(4);

        expect([lead, ...leaves, rest, restLeaf, gutter].map(restState)).toEqual(before);

        host.dispose();
    });
});

describe('A toggled pane that moves is still animated (E3)', () => {
    it('animates the toggled pane whose slot the growing neighbour pushes along', () => {
        install();

        const { host, split, panes } = threePanes();
        const layouts = panes.map(pane => vi.spyOn(pane, 'doLayout'));

        split.setPaneCollapsed(1, true);

        for (const layout of layouts) {
            expect(layout).toHaveBeenCalledTimes(2);
        }

        runFrame(MID_ANIMATION_MS);

        for (const layout of layouts) {
            expect(layout).toHaveBeenCalledTimes(3);
        }

        settle();

        expect(visualBox(panes[0])).toEqual({ x: 0, y: 0, width: 189, height: 300 });
        expect(visualBox(panes[1])).toEqual({ x: 193, y: 0, width: 100, height: 300 });
        expect(panes[1].getClipPath()).toBe('inset(0 100% 0 0)');
        expect(visualBox(panes[2])).toEqual({ x: 211, y: 0, width: 189, height: 300 });
        expect(visualBox(splitGutters(split)[1])).toEqual({ x: 193, y: 0, width: 18, height: 300 });

        host.dispose();
    });
});

describe('Border leaves every unmoved region out of the frames (E4)', () => {
    it('animates only the centre and restores every region on the expand', () => {
        install();

        const { host, border, regions, leaves } = borderScene();
        const edges   = [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST];
        const before  = new Map([...regions].map(([placement, region]) => [placement, restState(region)]));
        const layouts = new Map([...regions].map(([placement, region]) => [placement, vi.spyOn(region, 'doLayout')]));

        border.setRegionCollapsed(Placement.WEST, true);

        for (const edge of edges) {
            expect(layouts.get(edge)).toHaveBeenCalledTimes(2);
        }

        expect(layouts.get(Placement.CENTER)).toHaveBeenCalledTimes(3);

        runFrame(MID_ANIMATION_MS);

        for (const edge of edges) {
            expect(layouts.get(edge)).toHaveBeenCalledTimes(2);
        }

        expect(layouts.get(Placement.CENTER)).toHaveBeenCalledTimes(4);

        settle();

        for (const edge of edges) {
            expect(layouts.get(edge)).toHaveBeenCalledTimes(3);
        }

        expect(layouts.get(Placement.CENTER)).toHaveBeenCalledTimes(6);

        for (const edge of [Placement.NORTH, Placement.SOUTH, Placement.EAST]) {
            expect(visualBox(regions.get(edge)!)).toEqual(before.get(edge)!.box);
        }

        expect(visualBox(regions.get(Placement.WEST)!)).toEqual({ x: 0, y: 30, width: 100, height: 250 });
        expect(regions.get(Placement.WEST)!.getClipPath()).toBe('inset(0 100% 0 0)');
        expect(leaves.get(Placement.WEST)!.isDisplayed()).toBe(false);
        expect(regions.get(Placement.CENTER)!.getWidth()).toBe(302);

        border.setRegionCollapsed(Placement.WEST, false);
        settle();

        expect(new Map([...regions].map(([placement, region]) => [placement, restState(region)]))).toEqual(before);

        host.dispose();
    });
});

describe("An opted-in pane's returning content is laid out once (E5)", () => {
    it('lays the expanding pane out exactly once and puts its leaf back', () => {
        install();

        const { lead, leaf } = skippableLead();
        const { host, split } = twoPanes(lead);

        const leadLayout = vi.spyOn(lead, 'doLayout');

        split.setPaneCollapsed(0, true);
        settle();
        leadLayout.mockClear();

        split.setPaneCollapsed(0, false);

        expect(leadLayout).toHaveBeenCalledTimes(1);

        settle();

        expect(leadLayout).toHaveBeenCalledTimes(1);
        expect(leaf.isDisplayed()).toBe(true);
        expect(visualBox(leaf)).toEqual({ x: 0, y: 0, width: 50, height: 40 });

        host.dispose();
    });
});

describe('Reduced motion (E6)', () => {
    it('writes the end state without animating the static pane, both ways', () => {
        install();
        vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true);

        const { lead, leaves } = plainLead();
        const { host, split, rest, restLeaf, gutter } = twoPanes(lead);

        const before     = [lead, ...leaves, rest, restLeaf, gutter].map(restState);
        const leadLayout = vi.spyOn(lead, 'doLayout');
        const restLayout = vi.spyOn(rest, 'doLayout');

        split.setPaneCollapsed(0, true);

        expect(leadLayout).toHaveBeenCalledTimes(1);
        expect(restLayout).toHaveBeenCalledTimes(2);
        expect(leaves.map(leaf => leaf.isDisplayed())).toEqual([false, false]);
        expect(visualBox(lead)).toEqual({ x: 0, y: 0, width: 100, height: 300 });
        expect(visualBox(gutter)).toEqual({ x: 0, y: 0, width: 18, height: 300 });
        expect(visualBox(rest)).toEqual({ x: 18, y: 0, width: 382, height: 300 });

        split.setPaneCollapsed(0, false);

        expect(leadLayout).toHaveBeenCalledTimes(2);
        expect(restLayout).toHaveBeenCalledTimes(4);
        expect([lead, ...leaves, rest, restLeaf, gutter].map(restState)).toEqual(before);

        host.dispose();
    });
});

describe('A re-toggle mid-animation (E7)', () => {
    it('gives the static pane one end layout per toggle and lands back where it started', () => {
        install();

        const { lead, leaves } = plainLead();
        const { host, split, rest, restLeaf, gutter } = twoPanes(lead);

        const before     = [lead, ...leaves, rest, restLeaf, gutter].map(restState);
        const leadLayout = vi.spyOn(lead, 'doLayout');
        const restLayout = vi.spyOn(rest, 'doLayout');

        split.setPaneCollapsed(0, true);
        runFrame(MID_ANIMATION_MS);
        split.setPaneCollapsed(0, false);

        expect(leadLayout).toHaveBeenCalledTimes(2);
        expect(restLayout).toHaveBeenCalledTimes(5);

        settle();

        expect(leadLayout).toHaveBeenCalledTimes(2);
        expect(restLayout).toHaveBeenCalledTimes(6);
        expect([lead, ...leaves, rest, restLeaf, gutter].map(restState)).toEqual(before);

        host.dispose();
    });
});

describe('A static pane carrying a translate is left normalised (E8)', () => {
    it('folds the translate back into the position and still skips the frames', () => {
        install();

        const { lead } = plainLead();
        const { host, split } = twoPanes(lead);

        // Same visual box, expressed as a position 7 px short plus a translate
        // that makes it up — the state a size-stable fast-path commit leaves.
        lead.setX(lead.getX() - 7);
        lead.setTranslate(7, 0);

        const leadLayout = vi.spyOn(lead, 'doLayout');

        split.setPaneCollapsed(0, true);

        expect(lead.getX()).toBe(0);
        expect(lead.getTranslateX()).toBe(0);
        expect(leadLayout).toHaveBeenCalledTimes(1);

        host.dispose();
    });
});

describe("A static first gutter's promotion is released (E9)", () => {
    it('keeps the colour hint through the animation and clears it on cleanup', () => {
        install();

        const { host, border } = borderScene();

        border.setRegionCollapsed(Placement.WEST, true);

        expect(borderGutters(border).get(Placement.NORTH)!.getWillChange()).toBe('background-color');

        settle();

        for (const gutter of borderGutters(border).values()) {
            expect(gutter.getWillChange()).toBeNull();
            expect(gutter.getTransition()).toBeNull();
        }

        host.dispose();
    });
});
