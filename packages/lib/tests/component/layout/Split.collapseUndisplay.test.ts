// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for collapsed-panes-leave-render-tree.md: once a `Split` pane's
 * collapse animation settles, its direct children leave the render tree
 * (`display: none`) while the pane itself stays displayed, sized and clipped
 * exactly as before; an expand puts the children back synchronously before its
 * animation starts; and the split's own size reports and the content's native
 * scroll offsets survive the round trip. Case numbers below refer to the plan's
 * `## Expected Behaviour` list (1-3, 5-10, 18).
 *
 * `transitionend` never fires offline and the modelled DOM swallows
 * `requestAnimationFrame`, so an animated toggle is settled here the way
 * `tests/core/Animation.test.ts` settles a tween: frame callbacks are captured
 * through a `DOM.sink.requestAnimationFrame` spy and run with a timestamp past
 * the collapse duration — completing the geometry loop whose last frame is
 * where `runCollapse`'s `onIdle` fires — and the fake clock is advanced past
 * the primed CSS transitions' fallback timers.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Split, type SplitOptions } from '~/layout/Split';
import { Fit } from '~/layout/Fit';
import { VBox } from '~/layout/VBox';
import { Card } from '~/layout/Card';
import { Tab } from '~/layout/Tab';
import { serializeLayout, restoreLayout } from '~/layout/LayoutSerialization';
import { Animation } from '~/core/Animation';
import { COLLAPSE_STRIP_SIZE } from '~/layout/CollapseSupport';
import { Size } from '~/primitive/Size';
import { DOM } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
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
 * Mid-animation offset for the "still animating" case: well inside the 200 ms
 * collapse duration, so a frame run this far in commits an interpolated rect
 * and reschedules rather than settling.
 */
const MID_ANIMATION_MS = 50;

/**
 * Upper bound on flush rounds. At a past-duration timestamp the geometry loop
 * settles in one frame, and an effective-visibility reconcile schedules at most
 * one more, so a run that needs more than a handful is a loop, not progress.
 */
const MAX_FLUSH_ROUNDS = 8;

/** The private per-pane bookkeeping this suite peeks at — framework state, not public surface. */
interface SplitInternals {
    _undisplayedPaneContent: Map<Component, { preferred: Size | null; min: Size | null; max: Size | null; displayed: Component[] }>;
    _pendingScrollRestore:   Set<Component>;
    computeTotalMinSize(): Size;
}

let frames: FrameRequestCallback[] = [];

/** Installs the modelled DOM, fake timers, and the frame-capturing rAF spy. */
function install(): RecordingDOMSink {
    const sink = installTestDOM(CONFIG);

    frames = [];
    vi.useFakeTimers();
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });

    return sink;
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
 * Settles an in-flight collapse/expand: the geometry loop reaches its last
 * frame (firing `onIdle`), then the transition fallbacks fire.
 */
function settle(): void {
    flushFrames(PAST_FALLBACK_MS);
    vi.advanceTimersByTime(PAST_FALLBACK_MS);
    flushFrames(PAST_FALLBACK_MS);
}

/**
 * A pane that fills its slot and derives its own size from one child of a
 * known size — the common "content wrapped in a plain Container" shape.
 *
 * @param child - The pane's single content child.
 * @returns The rendered pane.
 */
function makePane(child: Component): Container {
    const pane = new Container({ layoutManager: new Fit() });

    pane.addComponent(child);
    pane.getElement(true);
    child.getElement(true);

    return pane;
}

/** A 50x50 content child. */
function makeChild(): Component {
    return new Component({ preferredSize: { width: 50, height: 50 } });
}

/**
 * A sized, inset-free horizontal Split host holding `panes`, laid out once.
 *
 * @param panes - The panes, in slot order.
 * @param options - Extra Split options merged over the horizontal orientation.
 * @returns The host and its manager.
 */
function hostPanes(panes: Container[], options: SplitOptions = {}): { container: Container; split: Split } {
    const split     = new Split({ orientation: 'horizontal', ...options });
    const container = new Container({ layoutManager: split });

    container.getElement(true);
    container.setWidth(400);
    container.setHeight(300);
    container.clearInsets();

    for (const pane of panes) {
        container.addComponent(pane);
    }

    container.doLayout();

    return { container, split };
}

/**
 * A host with `paneCount` panes, each holding one 50x50 child.
 *
 * @param paneCount - How many panes to build.
 * @param options - Extra Split options.
 * @returns The host, its manager, and the panes and children in slot order.
 */
function hostSplit(paneCount: number, options: SplitOptions = {}): { container: Container; split: Split; panes: Container[]; children: Component[] } {
    const children = Array.from({ length: paneCount }, () => makeChild());
    const panes    = children.map(child => makePane(child));

    return { ...hostPanes(panes, options), panes, children };
}

/** Narrow access to the manager's private bookkeeping. */
function internals(split: Split): SplitInternals {
    return split as unknown as SplitInternals;
}

describe("A settled collapse undisplays the pane's children, not the pane (case 1)", () => {
    it('leaves the pane displayed and laid out while its direct children report undisplayed', () => {
        install();

        const { container, split, panes, children } = hostSplit(2);

        split.setPaneCollapsed(0, true);
        settle();

        expect(children[0].isDisplayed()).toBe(false);
        expect(panes[0].isDisplayed()).toBe(true);
        expect(container.getLaidOutComponents()).toContain(panes[0]);

        // The expanded sibling is untouched.
        expect(children[1].isDisplayed()).toBe(true);

        container.dispose();
    });
});

describe('The undisplay lands only once the animation settles (case 2)', () => {
    it('keeps the children displayed through the collapse-start layout and every mid-animation frame', () => {
        install();

        const { container, split, children } = hostSplit(2);

        split.setPaneCollapsed(0, true);

        // `runCollapse` has already laid the end state out by the time the
        // call returns; the children must have survived that pass.
        expect(children[0].isDisplayed()).toBe(true);

        vi.advanceTimersByTime(MID_ANIMATION_MS);
        flushFrames(MID_ANIMATION_MS);

        expect(children[0].isDisplayed()).toBe(true);

        container.dispose();
    });
});

describe('An expand redisplays the children synchronously (case 3)', () => {
    it('reports the children displayed before any timer advances or frame runs', () => {
        install();

        const { container, split, children } = hostSplit(2);

        split.setPaneCollapsed(0, true);
        settle();

        expect(children[0].isDisplayed()).toBe(false);

        split.setPaneCollapsed(0, false);

        expect(children[0].isDisplayed()).toBe(true);

        container.dispose();
    });
});

describe('Native scroll offsets survive a collapse/expand round trip (case 5)', () => {
    it("captures a natively scrolled Panel's offset before the collapse hides it and restores it once the expand settles", () => {
        const sink = install();

        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const { container, split } = hostPanes([makePane(panel), makePane(makeChild())]);
        const panelEl = panel.getElement()!;

        // A wheel/keyboard scroll moves the native offset without going
        // through the component's setters, so its cache is stale until the
        // collapse captures the live value.
        DOM.sink.apply(panelEl, { scrollTop: 40 });
        expect(panel.getScrollTop()).toBe(0);

        split.setPaneCollapsed(0, true);
        settle();

        expect(panel.isDisplayed()).toBe(false);
        expect(panel.getScrollTop()).toBe(40);

        // Simulate the browser dropping the native offset once display: none
        // removed the subtree's boxes.
        DOM.sink.apply(panelEl, { scrollTop: 0 });

        const before = sink.writes.length;

        split.setPaneCollapsed(0, false);
        settle();

        const restoreWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && w.args[0] === panelEl
            && (w.args[1] as { scrollTop?: number }).scrollTop === 40
        );

        expect(restoreWrite).toBe(true);
        expect(DOM.source.getScrollTop(panelEl)).toBe(40);

        container.dispose();
    });

    it('keeps the cached offset when the pane is re-collapsed before its expand settles, and restores it on the next expand', () => {
        const sink = install();

        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const { container, split } = hostPanes([makePane(panel), makePane(makeChild())]);
        const panelEl = panel.getElement()!;

        DOM.sink.apply(panelEl, { scrollTop: 40 });
        split.setPaneCollapsed(0, true);
        settle();

        expect(panel.getScrollTop()).toBe(40);

        // The engine dropped the native offset while the subtree had no boxes.
        DOM.sink.apply(panelEl, { scrollTop: 0 });

        // Expand, let one frame run mid-animation so the restore is queued but
        // not yet written, then collapse again before it settles.
        split.setPaneCollapsed(0, false);
        flushFrames(MID_ANIMATION_MS);
        split.setPaneCollapsed(0, true);
        settle();

        expect(panel.isDisplayed()).toBe(false);
        // The re-collapse must not have captured the engine's reset zero over
        // the offset the pane was collapsed with.
        expect(panel.getScrollTop()).toBe(40);

        const before = sink.writes.length;

        split.setPaneCollapsed(0, false);
        settle();

        const restoreWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && w.args[0] === panelEl
            && (w.args[1] as { scrollTop?: number }).scrollTop === 40
        );

        expect(restoreWrite).toBe(true);
        expect(DOM.source.getScrollTop(panelEl)).toBe(40);

        container.dispose();
    });

    it('keeps the cached offset across an immediate expand and re-collapse with no layout between them', () => {
        install();

        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const { container, split } = hostPanes([makePane(panel), makePane(makeChild())]);
        const panelEl = panel.getElement()!;

        DOM.sink.apply(panelEl, { scrollTop: 40 });
        split.setPaneCollapsedImmediate(0, true);

        expect(panel.getScrollTop()).toBe(40);

        DOM.sink.apply(panelEl, { scrollTop: 0 });

        split.setPaneCollapsedImmediate(0, false);
        split.setPaneCollapsedImmediate(0, true);

        expect(panel.isDisplayed()).toBe(false);
        expect(panel.getScrollTop()).toBe(40);

        split.setPaneCollapsedImmediate(0, false);
        container.doLayout();

        expect(DOM.source.getScrollTop(panelEl)).toBe(40);

        container.dispose();
    });
});

describe("A general Component pane keeps its own box while its content is out", () => {
    it('is committed at its stored size across an idle layout while collapsed and expands from that box', () => {
        install();

        // A content-clamping component with a box manager — not a Container —
        // used directly as a pane: with its children undisplayed, its merged
        // max collapses to the bare perimeter, which its own setWidth/setHeight
        // clamp would otherwise honour.
        const pane  = new Component({ layoutManager: new VBox() });
        const child = makeChild();

        pane.getElement(true);
        pane.addComponent(child);
        child.getElement(true);

        const split     = new Split({ orientation: 'horizontal' });
        const container = new Container({ layoutManager: split });

        container.getElement(true);
        container.setWidth(400);
        container.setHeight(300);
        container.clearInsets();
        container.addComponent(pane);
        container.addComponent(makePane(makeChild()));
        container.doLayout();

        const width  = pane.getWidth();
        const height = pane.getHeight();

        expect(width).toBeGreaterThan(0);
        expect(height).toBe(300);

        split.setPaneCollapsed(0, true);
        settle();
        container.doLayout();

        expect(child.isDisplayed()).toBe(false);
        expect(pane.getWidth()).toBe(width);
        expect(pane.getHeight()).toBe(height);

        split.setPaneCollapsed(0, false);
        settle();

        expect(child.isDisplayed()).toBe(true);
        expect(pane.getWidth()).toBe(width);
        expect(pane.getHeight()).toBe(height);

        container.dispose();
    });
});

describe("A sibling's toggle does not prime the cross-fade on a collapsed-and-undisplayed pane", () => {
    it('leaves the collapsed pane without a background-color transition when another pane collapses', () => {
        install();

        const { container, split, panes, children } = hostSplit(3);

        split.setPaneCollapsedImmediate(0, true);
        container.doLayout();

        expect(children[0].isDisplayed()).toBe(false);
        expect(panes[0].getTransition()).toBeNull();

        // Pane 0 moves as a box only during pane 1's collapse; it must not be
        // mistaken for a gutter and carry the strip cross-fade.
        split.setPaneCollapsed(1, true);

        expect(panes[0].getTransition()).toBeNull();
        expect(panes[0].getWillChange()).toBeNull();

        settle();
        container.dispose();
    });
});

describe('A manager swap releases what the collapse took out', () => {
    it("puts a collapsed pane's content back and resumes its clamp when the Split is detached", () => {
        install();

        const pane  = new Component({ layoutManager: new VBox() });
        const child = makeChild();

        pane.getElement(true);
        pane.addComponent(child);
        child.getElement(true);

        const split     = new Split({ orientation: 'horizontal' });
        const container = new Container({ layoutManager: split });

        container.getElement(true);
        container.setWidth(400);
        container.setHeight(300);
        container.clearInsets();
        container.addComponent(pane);
        container.addComponent(makePane(makeChild()));
        container.doLayout();

        split.setPaneCollapsedImmediate(0, true);
        container.doLayout();

        expect(child.isDisplayed()).toBe(false);

        container.setLayoutManager(new VBox());
        container.doLayout();

        expect(child.isDisplayed()).toBe(true);

        // The clamp is the pane's own again: with its child displayed the
        // content-derived max is unbounded, so a box write goes through.
        pane.setWidth(198);
        expect(pane.getWidth()).toBe(198);

        container.dispose();
    });

    it('writes nothing to a collapsed pane\'s children when the container is disposed with them', () => {
        install();

        const { container, split, children } = hostSplit(2);

        split.setPaneCollapsedImmediate(0, true);
        container.doLayout();

        expect(children[0].isDisplayed()).toBe(false);

        // The destructor destroys the children before the manager detaches
        // and leaves their parent links in place, so the detach must not
        // mistake them for a parked pane's live children.
        const redisplay = vi.spyOn(children[0], 'setDisplayed');

        container.dispose();

        expect(redisplay).not.toHaveBeenCalled();
    });

    it('lets a collapsed Tab-stack pane survive a serializeLayout/restoreLayout round trip', () => {
        install();

        // The Dock's persisted-layout shape: a Split of Tab-managed stack
        // panes, each holding one leaf the restore factory knows by id.
        // `restoreLayout` parks the *leaf* out of its stack before tearing the
        // old tree down, so the old Split's detach must release it by
        // liveness, not by parent link, for the fresh Split's re-collapse to
        // find it displayed and take ownership of it.
        const leafA = makeChild();
        const leafB = makeChild();

        leafA.setId('a');
        leafB.setId('b');

        const stack = (leaf: Component): Container => {
            const tab   = new Tab();
            const pane  = new Container({ layoutManager: tab });

            pane.addComponent(leaf);
            tab.createTab(leaf);
            pane.getElement(true);
            leaf.getElement(true);

            return pane;
        };

        const stackA = stack(leafA);
        const stackB = stack(leafB);
        const { container, split } = hostPanes([stackA, stackB]);

        // Let the stacks lay out (each Tab selects its page).
        stackA.doLayout();
        stackB.doLayout();

        expect(leafA.isDisplayed()).toBe(true);

        split.setPaneCollapsedImmediate(0, true);
        container.doLayout();

        expect(leafA.isDisplayed()).toBe(false);

        const state = serializeLayout(container);

        restoreLayout(container, state, id => ({ a: leafA, b: leafB } as Record<string, Component>)[id] ?? null);

        const fresh   = container.getLayoutManager() as Split;
        const freshA  = container.getComponents()[0];

        expect(fresh).not.toBe(split);
        expect(fresh.isPaneCollapsed(0)).toBe(true);
        expect(freshA.getComponents()[0]).toBe(leafA);

        // The layouts a frame would run: the re-homed stack's own (its Tab
        // re-selects the page) and the root's idle sweeps, which must have the
        // leaf recorded to take it out again.
        freshA.doLayout();
        container.doLayout();
        container.doLayout();

        expect(leafA.isDisplayed()).toBe(false);
        expect(leafB.isDisplayed()).toBe(true);

        fresh.setPaneCollapsedImmediate(0, false);
        container.doLayout();

        expect(leafA.isDisplayed()).toBe(true);

        container.dispose();
    });

    it('lets a pane parked and re-homed under a fresh Split expand with its content', () => {
        install();

        const { container, split, panes, children } = hostSplit(2);

        split.setPaneCollapsedImmediate(0, true);
        container.doLayout();

        expect(children[0].isDisplayed()).toBe(false);

        // The LayoutSerialization restore shape: park the leaves, dispose the
        // old tree, rebuild under a fresh Split and re-apply the collapse.
        const fresh    = new Container();
        const newSplit = new Split({ orientation: 'horizontal' });

        fresh.setLayoutManager(newSplit);
        fresh.getElement(true);
        fresh.setWidth(400);
        fresh.setHeight(300);
        fresh.clearInsets();
        fresh.moveComponent(panes[0]);
        fresh.moveComponent(panes[1]);
        container.dispose();

        fresh.doLayout();
        newSplit.setPaneCollapsedImmediate(0, true);
        fresh.doLayout();

        expect(children[0].isDisplayed()).toBe(false);

        newSplit.setPaneCollapsedImmediate(0, false);
        fresh.doLayout();

        expect(children[0].isDisplayed()).toBe(true);

        fresh.dispose();
    });
});

describe('A queued scroll restore outlives a consumer-side undisplay of the pane', () => {
    it('restores once the pane is displayed again and laid out, instead of dropping the entry', () => {
        install();

        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const pane = makePane(panel);
        const { container, split } = hostPanes([pane, makePane(makeChild())]);
        const panelEl = panel.getElement()!;

        DOM.sink.apply(panelEl, { scrollTop: 40 });
        split.setPaneCollapsed(0, true);
        settle();
        DOM.sink.apply(panelEl, { scrollTop: 0 });

        // Expand, but hide the pane itself before the restore can land.
        split.setPaneCollapsed(0, false);
        pane.setDisplayed(false);
        settle();

        expect(internals(split)._pendingScrollRestore.has(pane)).toBe(true);
        expect(DOM.source.getScrollTop(panelEl)).toBe(0);

        pane.setDisplayed(true);
        container.doLayout();

        expect(internals(split)._pendingScrollRestore.has(pane)).toBe(false);
        expect(DOM.source.getScrollTop(panelEl)).toBe(40);

        container.dispose();
    });
});

describe('setPaneCollapsedImmediate toggles the content synchronously (case 6)', () => {
    it('undisplays on collapse and redisplays on expand with no animation, restoring scroll on the next layout', () => {
        install();

        const { container, split, panes, children } = hostSplit(2);

        split.setPaneCollapsedImmediate(0, true);

        expect(children[0].isDisplayed()).toBe(false);

        split.setPaneCollapsedImmediate(0, false);

        expect(children[0].isDisplayed()).toBe(true);

        // No animation settles an immediate expand, so the layout it
        // scheduled is what reapplies the captured scroll offsets.
        const restoreSpy = vi.spyOn(panes[0], 'restoreSubtreeScroll');

        container.doLayout();

        expect(restoreSpy).toHaveBeenCalledTimes(1);

        container.dispose();
    });
});

describe('A pane collapsed from construction is undisplayed on the first layout (case 7)', () => {
    it('undisplays the collapsedPanes entry with no setPaneCollapsed call', () => {
        install();

        const { container, split, children } = hostSplit(2, { collapsedPanes: [0] });

        expect(split.isPaneCollapsed(0)).toBe(true);
        expect(children[0].isDisplayed()).toBe(false);
        expect(children[1].isDisplayed()).toBe(true);

        container.dispose();
    });
});

describe('Size reports are frozen at their pre-collapse values while the content is undisplayed (case 8)', () => {
    it('reports the same preferred/min sizes after the collapse settles as the instant before it', () => {
        install();

        const big = new Component({ preferredSize: { width: 200, height: 120 }, minSize: { width: 60, height: 40 } });
        const { container, split } = hostPanes([makePane(big), makePane(makeChild())]);
        const pane = big.getParentComponent()!;

        const paneBefore      = pane.getPreferredSize();
        const preferredBefore = split.getPreferredSize();
        const minBefore       = split.getMinSize();

        expect(paneBefore).not.toBeNull();

        split.setPaneCollapsed(0, true);

        // The collapsed flag legitimately swaps the pane's main-axis
        // contribution for the strip; the cross axis must not move on top.
        const totalMinDuring = internals(split).computeTotalMinSize();

        settle();

        expect(big.isDisplayed()).toBe(false);

        // The pane's own live report has changed — the snapshot is what keeps
        // the split's report stable.
        expect(pane.getPreferredSize()).not.toEqual(paneBefore);

        expect(split.getPreferredSize()).toEqual(preferredBefore);
        expect(split.getMinSize()).toEqual(minBefore);
        expect(internals(split).computeTotalMinSize()).toEqual(totalMinDuring);

        container.dispose();
    });
});

describe("A collapsed pane's stored size and expanded geometry survive its childless reports", () => {
    it("keeps a box-managed pane's stored size through an idle layout while collapsed and its width after the expand", () => {
        install();

        // A box manager reports its bare perimeter as its max the moment it
        // has no laid-out children, and `recalculateSizes` re-clamps every
        // stored size against the pane's max on each layout.
        const boxed = new Container({ layoutManager: new VBox() });

        boxed.addComponent(makeChild());
        boxed.getElement(true);

        const { container, split } = hostPanes([boxed, makePane(makeChild())]);
        const widthBefore  = boxed.getWidth();
        const storedBefore = split.getPaneSize(boxed);

        expect(widthBefore).toBeGreaterThan(COLLAPSE_STRIP_SIZE);

        split.setPaneCollapsedImmediate(0, true);
        container.doLayout();

        expect(split.getPaneSize(boxed)).toBe(storedBefore);

        split.setPaneCollapsedImmediate(0, false);
        container.doLayout();

        expect(boxed.getWidth()).toBe(widthBefore);

        container.dispose();
    });
});

describe('An expand puts back only the children the collapse took out', () => {
    it("leaves a Card-managed pane's inactive page undisplayed across the round trip", () => {
        install();

        const card  = new Card();
        const paged = new Container({ layoutManager: card });
        const front = makeChild();
        const back  = makeChild();

        paged.addComponent(front);
        paged.addComponent(back);
        paged.getElement(true);
        card.setVisibleComponentId(front.getId());

        const { container, split } = hostPanes([paged, makePane(makeChild())]);

        expect(front.isDisplayed()).toBe(true);
        expect(back.isDisplayed()).toBe(false);

        split.setPaneCollapsedImmediate(0, true);

        expect(front.isDisplayed()).toBe(false);
        expect(back.isDisplayed()).toBe(false);

        split.setPaneCollapsedImmediate(0, false);
        container.doLayout();

        // `Card` only re-hides on a page switch, so a page this manager had
        // not taken out must not come back through it.
        expect(front.isDisplayed()).toBe(true);
        expect(back.isDisplayed()).toBe(false);

        container.dispose();
    });
});

describe("A pane's own layout manager cannot put its content back while it stays collapsed", () => {
    it("keeps a Tab-managed pane's selected page out across an idle resize and a sibling's animated toggle", () => {
        install();

        // The Dock's split-region shape: the pane is a Container driven by
        // Tab, which re-selects its page with setDisplayed(true) on every
        // layout of the pane.
        const tab   = new Tab();
        const paged = new Container({ layoutManager: tab });
        const front = makeChild();
        const back  = makeChild();

        paged.addComponent(front);
        paged.addComponent(back);
        tab.createTab(front);
        tab.createTab(back);
        paged.getElement(true);
        front.getElement(true);
        back.getElement(true);

        const { container, split } = hostPanes([paged, makePane(makeChild()), makePane(makeChild())]);

        expect(front.isDisplayed()).toBe(true);
        expect(back.isDisplayed()).toBe(false);

        split.setPaneCollapsedImmediate(0, true);

        expect(front.isDisplayed()).toBe(false);

        // An idle resize lays every pane out again.
        container.setWidth(500);
        container.doLayout();

        expect(front.isDisplayed()).toBe(false);

        // A sibling's animation lays every participant out on each frame.
        split.setPaneCollapsed(1, true);
        settle();

        expect(front.isDisplayed()).toBe(false);

        split.setPaneCollapsedImmediate(0, false);
        container.doLayout();

        expect(front.isDisplayed()).toBe(true);
        expect(back.isDisplayed()).toBe(false);

        container.dispose();
    });

    it('takes a child something else put back out again on the next idle layout', () => {
        install();

        const { container, split, children } = hostSplit(2);

        split.setPaneCollapsedImmediate(0, true);

        expect(children[0].isDisplayed()).toBe(false);

        children[0].setDisplayed(true);
        container.doLayout();

        expect(children[0].isDisplayed()).toBe(false);

        container.dispose();
    });

    it("keeps a Tab-managed pane's selected page out across a drag of the divider beside it", () => {
        install();

        const tab   = new Tab();
        const paged = new Container({ layoutManager: tab });
        const front = makeChild();
        const back  = makeChild();

        paged.addComponent(front);
        paged.addComponent(back);
        tab.createTab(front);
        tab.createTab(back);
        paged.getElement(true);
        front.getElement(true);
        back.getElement(true);

        // The middle pane collapses toward the start through gutter 1, which
        // leaves gutter 0 a plain movable divider whose trailing neighbour is
        // the collapsed pane.
        const { container, split } = hostPanes([makePane(makeChild()), paged, makePane(makeChild())]);

        split.setPaneCollapsedImmediate(1, true);
        container.doLayout();

        expect(front.isDisplayed()).toBe(false);

        const gutter = (split as unknown as { _gutters: Array<unknown> })._gutters[0] as Parameters<Split['onDrag']>[1];

        split.onDragStart(container, gutter, 100);
        split.onDrag(container, gutter, 110);

        expect(front.isDisplayed()).toBe(false);

        container.dispose();
    });
});

describe('The recorded children stop being this manager\'s once they leave the pane', () => {
    it('neither re-hides a re-homed child on an idle layout nor redisplays it on expand', () => {
        install();

        const { container, split, children } = hostSplit(2);
        const elsewhere = new Container();

        elsewhere.getElement(true);

        split.setPaneCollapsedImmediate(0, true);

        expect(children[0].isDisplayed()).toBe(false);

        // Re-homed while the pane stays collapsed, and shown by its new owner.
        elsewhere.moveComponent(children[0]);
        children[0].setDisplayed(true);
        container.doLayout();

        expect(children[0].isDisplayed()).toBe(true);

        // Hidden by its new owner; the old pane's expand must not override that.
        children[0].setDisplayed(false);
        split.setPaneCollapsedImmediate(0, false);
        container.doLayout();

        expect(children[0].isDisplayed()).toBe(false);

        container.dispose();
        elsewhere.dispose();
    });
});

describe('A detaching manager leaves a child re-homed under another owner alone', () => {
    it('leaves a child re-homed under another owner alone when the old container is disposed', () => {
        install();

        const { container, split, children } = hostSplit(2);
        const elsewhere = new Container();

        elsewhere.getElement(true);

        split.setPaneCollapsedImmediate(0, true);
        container.doLayout();

        expect(children[0].isDisplayed()).toBe(false);

        // Re-homed while the old pane stays collapsed, and kept hidden by its
        // new owner (an inactive Tab page, say). Disposing the old container
        // detaches the old Split with the child still recorded — it is the
        // new owner's now and must not be force-displayed.
        elsewhere.moveComponent(children[0]);
        children[0].setDisplayed(false);

        container.dispose();

        expect(children[0].isDisplayed()).toBe(false);

        elsewhere.dispose();
    });
});

describe('revealDescendant expands the pane and redisplays its content synchronously (case 9)', () => {
    it("leaves the target's ancestor chain displayed before returning", () => {
        install();

        const { container, split, children } = hostSplit(2);

        split.setPaneCollapsed(0, true);
        settle();

        expect(children[0].isDisplayed()).toBe(false);

        const target = DOM.sink.createElement('div');

        DOM.sink.appendChild(children[0].getElement()!, target);

        split.revealDescendant(target);

        expect(split.isPaneCollapsed(0)).toBe(false);
        expect(children[0].isDisplayed()).toBe(true);
        expect(children[0].isEffectivelyVisible()).toBe(true);

        container.dispose();
    });
});

describe('transferPaneSize moves the undisplayed-content state onto the replacement (case 10)', () => {
    it('gives the outgoing pane its content back and undisplays the replacement\'s own content against its own report', () => {
        install();

        const { container, split, panes, children } = hostSplit(2);

        split.setPaneCollapsedImmediate(0, true);

        expect(children[0].isDisplayed()).toBe(false);

        const r1          = makeChild();
        const replacement = makePane(r1);
        const replacementPreferred = replacement.getPreferredSize();

        container.replaceComponent(panes[0], replacement);
        split.transferPaneSize(panes[0], replacement);

        expect(split.isPaneCollapsed(0)).toBe(true);
        expect(children[0].isDisplayed()).toBe(true);
        expect(r1.isDisplayed()).toBe(false);
        expect(internals(split)._undisplayedPaneContent.has(panes[0])).toBe(false);
        expect(internals(split)._undisplayedPaneContent.get(replacement)?.preferred).toEqual(replacementPreferred);

        container.doLayout();

        expect(r1.isDisplayed()).toBe(false);
        expect(children[0].isDisplayed()).toBe(true);

        container.dispose();
    });

    it("snapshots a wrapper's complete report when the outgoing pane is nested inside it", () => {
        install();

        const big = new Component({ preferredSize: { width: 200, height: 120 } });
        const { container, split } = hostPanes([makePane(big), makePane(makeChild())]);
        const unit = big.getParentComponent()!;

        split.setPaneCollapsedImmediate(0, true);

        expect(big.isDisplayed()).toBe(false);

        // Mirrors DockRegion's wrap: a fresh wrapper takes the unit's slot and
        // the unit moves inside it, then the size transfers onto the wrapper.
        const wrapper = new Container({ layoutManager: new Fit() });

        wrapper.getElement(true);
        container.replaceComponent(unit, wrapper);
        wrapper.addComponent(unit);
        split.transferPaneSize(unit, wrapper);

        // The unit's own content came back (it is the wrapper's business now),
        // the wrapper's direct child — the unit — is what left, and the
        // wrapper's snapshot is its report with the unit's content present,
        // not the childless one a snapshot taken a step earlier would hold.
        expect(big.isDisplayed()).toBe(true);
        expect(unit.isDisplayed()).toBe(false);
        expect(split.isPaneCollapsed(0)).toBe(true);
        expect(internals(split)._undisplayedPaneContent.get(wrapper)?.preferred).toEqual({ width: 200, height: 120 });

        container.doLayout();

        expect(unit.isDisplayed()).toBe(false);
        expect(big.isDisplayed()).toBe(true);

        container.dispose();
    });

    it('keeps a hoisted child laid out as the collapsed strip when it was itself one of the undisplayed children', () => {
        install();

        // A single-pane wrapper (the Dock's collapsing nested Split) holding
        // one child, collapsed: the wrapper's direct child — the very
        // component about to be hoisted into the wrapper's slot — is what
        // this manager undisplayed.
        const h1      = makeChild();
        const hoisted = makePane(h1);
        const wrapper = new Container({ layoutManager: new Fit() });

        wrapper.addComponent(hoisted);
        wrapper.getElement(true);

        const { container, split } = hostPanes([wrapper, makePane(makeChild())]);

        split.setPaneCollapsedImmediate(0, true);

        expect(hoisted.isDisplayed()).toBe(false);

        // Mirrors Dock.collapseSinglePaneSplit: transfer, then move the child
        // into the wrapper's slot and drop the wrapper.
        split.transferPaneSize(wrapper, hoisted);
        container.moveComponent(hoisted, 0);
        container.removeComponent(wrapper);

        expect(hoisted.isDisplayed()).toBe(true);
        expect(h1.isDisplayed()).toBe(false);
        expect(container.getLaidOutComponents()[0]).toBe(hoisted);
        expect(split.isPaneCollapsed(0)).toBe(true);

        container.doLayout();

        // Laid out as a collapsed pane: full stored size behind the strip,
        // not dropped out of the split as a non-displayed pane would be.
        expect(container.getLaidOutComponents()[0]).toBe(hoisted);
        expect(hoisted.getWidth()).toBeGreaterThan(COLLAPSE_STRIP_SIZE);
        expect(h1.isDisplayed()).toBe(false);

        container.dispose();
    });
});

describe('Content comes back when a collapsed pane stops being clipped', () => {
    it('redisplays and restores a still-flagged pane that lost its serving gutter to a removed trailing sibling', () => {
        install();

        const { container, split, panes, children } = hostSplit(3);

        split.setPaneCollapsedImmediate(1, true);

        expect(children[1].isDisplayed()).toBe(false);

        // The middle pane collapses toward the start through its trailing
        // gutter; once the last pane leaves it is the last pane itself, has no
        // serving gutter, and is laid out expanded — with a flag neither
        // toggle will accept any more.
        container.removeComponent(panes[2]);

        const restoreSpy = vi.spyOn(panes[1], 'restoreSubtreeScroll');

        container.doLayout();

        expect(split.isPaneCollapsed(1)).toBe(true);
        expect(panes[1].getWidth()).toBeGreaterThan(COLLAPSE_STRIP_SIZE);
        expect(children[1].isDisplayed()).toBe(true);
        expect(children[1].getWidth()).toBeGreaterThan(0);
        expect(internals(split)._undisplayedPaneContent.has(panes[1])).toBe(false);
        expect(restoreSpy).toHaveBeenCalledTimes(1);

        container.dispose();
    });
});

describe('A pane removed while collapsed-and-undisplayed leaves no bookkeeping behind', () => {
    it('prunes the snapshot and any queued scroll restore on the next layout', () => {
        install();

        const { container, split, panes } = hostSplit(2);

        split.setPaneCollapsedImmediate(0, true);

        expect(internals(split)._undisplayedPaneContent.has(panes[0])).toBe(true);

        container.removeComponent(panes[0]);
        container.doLayout();

        expect(internals(split)._undisplayedPaneContent.has(panes[0])).toBe(false);
        expect(internals(split)._pendingScrollRestore.has(panes[0])).toBe(false);

        container.dispose();
    });

    it('does not write scroll offsets into a pane removed and disposed before its expand settled', () => {
        const sink = install();

        // The pane is itself the natively scrolled Panel, so the drain would
        // write straight through the pane's own — by then released — handle.
        // The offline sink records such a write instead of throwing on the
        // released handle as the production sink does, so the contract is
        // pinned as "no write reaches the removed pane".
        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });

        panel.addComponent(makeChild());
        panel.getElement(true);

        const { container, split } = hostPanes([panel, makePane(makeChild())]);
        const panelEl = panel.getElement()!;

        DOM.sink.apply(panelEl, { scrollTop: 40 });
        split.setPaneCollapsed(0, true);
        settle();

        expect(panel.getScrollTop()).toBe(40);

        // Expand (queuing the restore), then take the pane away and release
        // its handles before the animation's last frame runs the drain.
        split.setPaneCollapsed(0, false);
        flushFrames(MID_ANIMATION_MS);
        container.removeComponent(panel);
        panel.dispose();

        const before = sink.writes.length;

        settle();

        const strayWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && w.args[0] === panelEl
            && (w.args[1] as { scrollTop?: number }).scrollTop !== undefined
        );

        expect(strayWrite).toBe(false);
        expect(internals(split)._pendingScrollRestore.size).toBe(0);

        container.dispose();
    });
});

describe('Reduced motion undisplays and redisplays in the same call (case 18)', () => {
    it('lands the undisplay synchronously with no timer advance or frame', () => {
        install();
        vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true);

        const { container, split, children } = hostSplit(2);

        split.setPaneCollapsed(0, true);

        expect(children[0].isDisplayed()).toBe(false);

        split.setPaneCollapsed(0, false);

        expect(children[0].isDisplayed()).toBe(true);

        container.dispose();
    });
});
