// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for collapsed-panes-leave-render-tree.md, `Border` half: once an
 * edge region's collapse animation settles, its direct children leave the
 * render tree (`display: none`) while the region itself stays displayed and
 * keeps its full-size, clipped placement; an expand puts the children back
 * synchronously; the border's own size reports and the region's geometry stay
 * exactly what they were before the content left. Case numbers below refer to
 * the plan's `## Expected Behaviour` list (12, 14-16, 19).
 *
 * Settling works as in `Split.collapseUndisplay.test.ts`: the modelled DOM
 * swallows `requestAnimationFrame`, so frames are captured through a spy and
 * run past the collapse duration to reach `runCollapse`'s `onIdle` — which,
 * for `Border`, is the `container.doLayout()` whose tail reconciles the
 * collapsed regions.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Border } from '~/layout/Border';
import { Fit } from '~/layout/Fit';
import { VBox } from '~/layout/VBox';
import { Card } from '~/layout/Card';
import { Tab } from '~/layout/Tab';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Placement } from '~/primitive/Placement';
import { Animation } from '~/core/Animation';
import { COLLAPSE_STRIP_SIZE } from '~/layout/CollapseSupport';
import { Size, UNBOUNDED } from '~/primitive/Size';
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
 * Upper bound on flush rounds. At a past-duration timestamp the geometry loop
 * settles in one frame, and an effective-visibility reconcile schedules at most
 * one more, so a run that needs more than a handful is a loop, not progress.
 */
const MAX_FLUSH_ROUNDS = 8;

/** The private per-region bookkeeping this suite peeks at — framework state, not public surface. */
interface BorderInternals {
    _undisplayedRegionContent: Map<Placement, { preferred: Size | null; min: Size | null; max: Size | null; displayed: Component[]; component: Component }>;
    _pendingScrollRestore:     Set<Placement>;
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

/** Runs every captured frame past the collapse duration, then any frames those callbacks scheduled in turn. */
function flushFrames(): void {
    for (let round = 0; round < MAX_FLUSH_ROUNDS && frames.length > 0; round += 1) {
        const pending = frames;

        frames = [];

        for (const cb of pending) {
            cb(performance.now() + PAST_FALLBACK_MS);
        }
    }
}

/**
 * Settles an in-flight collapse/expand: the geometry loop reaches its last
 * frame (firing `onIdle`), then the transition fallbacks fire.
 */
function settle(): void {
    flushFrames();
    vi.advanceTimersByTime(PAST_FALLBACK_MS);
    flushFrames();
}

/**
 * A region that fills its slot and derives its own size from one child of a
 * known size — the common "content wrapped in a plain Container" shape.
 *
 * @param child - The region's single content child.
 * @returns The rendered region.
 */
function makeRegion(child: Component): Container {
    const region = new Container({ layoutManager: new Fit() });

    region.addComponent(child);
    region.getElement(true);
    child.getElement(true);

    return region;
}

/**
 * A content child of the given size.
 *
 * @param width - Preferred width.
 * @param height - Preferred height.
 * @returns The child.
 */
function makeChild(width = 50, height = 50): Component {
    return new Component({ preferredSize: { width, height } });
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
 * A sized, inset-free Border host with the given regions (every edge
 * collapsible), laid out once.
 *
 * @param regions - The region component per slot.
 * @returns The host and its manager.
 */
function hostBorder(regions: Partial<Record<Placement, Container>>): { host: Container; border: Border } {
    const border = new Border();
    const host   = new Container({ layoutManager: border });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);
    host.clearInsets();

    for (const [placement, region] of Object.entries(regions) as Array<[Placement, Container]>) {
        host.addComponent(region, collapsiblePlacement(placement));
    }

    host.doLayout();

    return { host, border };
}

/** Narrow access to the manager's private bookkeeping. */
function internals(border: Border): BorderInternals {
    return border as unknown as BorderInternals;
}

describe("A settled collapse undisplays the region's children, not the region (case 12)", () => {
    it('leaves the region displayed, full-size and clipped on the next layout while its children report undisplayed', () => {
        install();

        const child  = makeChild(80, 80);
        const west   = makeRegion(child);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(child.isDisplayed()).toBe(false);
        expect(west.isDisplayed()).toBe(true);

        const clipSpy = vi.spyOn(west, 'setClipPath');

        host.doLayout();

        expect(west.getWidth()).toBe(80);
        expect(clipSpy).toHaveBeenCalledWith('inset(0 100% 0 0)');

        host.dispose();
    });
});

describe('An expand redisplays the children synchronously (case 14)', () => {
    it('reports a settled-collapsed NORTH region\'s children displayed before any timer advances or frame runs', () => {
        install();

        const child  = makeChild(80, 40);
        const north  = makeRegion(child);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.NORTH]: north, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.NORTH, true);
        settle();

        expect(child.isDisplayed()).toBe(false);

        border.setRegionCollapsed(Placement.NORTH, false);

        expect(child.isDisplayed()).toBe(true);

        host.dispose();
    });
});

describe('Size reports are frozen at their pre-collapse values while the content is undisplayed (case 15)', () => {
    it('reports the same preferred/min/total-min sizes after the collapse settles as the instant before it', () => {
        install();

        const big    = new Component({ preferredSize: { width: 200, height: 120 }, minSize: { width: 60, height: 40 } });
        const west   = makeRegion(big);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        const westBefore = west.getPreferredSize();

        expect(westBefore).not.toBeNull();

        border.setRegionCollapsed(Placement.WEST, true);

        // The collapsed flag legitimately swaps the region's main-axis
        // contribution for the strip in every report, so the baseline is the
        // instant before the content leaves: flag set, content still present.
        // The cross axis (the region's 120 px height) must not move on top.
        const preferredDuring = border.getPreferredSize();
        const minDuring       = border.getMinSize();
        const totalMinDuring  = internals(border).computeTotalMinSize();

        expect(preferredDuring?.height).toBe(120);

        settle();

        expect(big.isDisplayed()).toBe(false);

        // The region's own live report has changed — the snapshot is what
        // keeps the border's report stable.
        expect(west.getPreferredSize()).not.toEqual(westBefore);

        expect(border.getPreferredSize()).toEqual(preferredDuring);
        expect(border.getMinSize()).toEqual(minDuring);
        expect(internals(border).computeTotalMinSize()).toEqual(totalMinDuring);

        host.dispose();
    });

    it('keeps laying the collapsed region out at its full pre-collapse extent across a resize', () => {
        install();

        const big    = new Component({ preferredSize: { width: 200, height: 120 } });
        const west   = makeRegion(big);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(big.isDisplayed()).toBe(false);

        // `doLayout` sizes the region's full (clipped) box from its preferred
        // extent; a childless region would report nothing here and the pass
        // would throw.
        host.setWidth(500);
        host.doLayout();

        expect(west.getWidth()).toBe(200);
        expect(centre.getWidth()).toBe(500 - COLLAPSE_STRIP_SIZE - border.getComponentSpacing());

        host.dispose();
    });
});

describe("The border's max report survives a collapsed region's childless max", () => {
    it('keeps reporting an unbounded width with a box-managed NORTH region collapsed', () => {
        install();

        // A box manager reports its bare perimeter as its max the moment it
        // has no laid-out children; `getMaxSize` caps the border's width to a
        // north/south region's max.
        const boxed = new Container({ layoutManager: new VBox() });

        boxed.addComponent(makeChild(80, 40));
        boxed.getElement(true);

        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.NORTH]: boxed, [Placement.CENTER]: centre });
        const maxBefore = border.getMaxSize();

        expect(maxBefore?.width).toBe(UNBOUNDED);

        border.setRegionCollapsed(Placement.NORTH, true);
        settle();

        expect(boxed.getLaidOutComponents()).toEqual([]);
        expect(border.getMaxSize()).toEqual(maxBefore);

        host.dispose();
    });
});

describe('An expand puts back only the children the collapse took out', () => {
    it("leaves a Card-managed region's inactive page undisplayed across the round trip", () => {
        install();

        const card  = new Card();
        const paged = new Container({ layoutManager: card, preferredSize: { width: 80, height: 80 } });
        const front = makeChild();
        const back  = makeChild();

        paged.addComponent(front);
        paged.addComponent(back);
        paged.getElement(true);
        card.setVisibleComponentId(front.getId());

        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: paged, [Placement.CENTER]: centre });

        expect(front.isDisplayed()).toBe(true);
        expect(back.isDisplayed()).toBe(false);

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(front.isDisplayed()).toBe(false);
        expect(back.isDisplayed()).toBe(false);

        border.setRegionCollapsed(Placement.WEST, false);
        settle();

        // `Card` only re-hides on a page switch, so a page this manager had
        // not taken out must not come back through it.
        expect(front.isDisplayed()).toBe(true);
        expect(back.isDisplayed()).toBe(false);

        host.dispose();
    });
});

describe("A region's own layout manager cannot put its content back while it stays collapsed", () => {
    it("keeps a Tab-managed WEST region's selected page out across an idle resize and a sibling's animated toggle", () => {
        install();

        const tab   = new Tab();
        const paged = new Container({ layoutManager: tab, preferredSize: { width: 80, height: 80 } });
        const front = makeChild();
        const back  = makeChild();

        paged.addComponent(front);
        paged.addComponent(back);
        tab.createTab(front);
        tab.createTab(back);
        paged.getElement(true);
        front.getElement(true);
        back.getElement(true);

        const east   = makeRegion(makeChild(80, 80));
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: paged, [Placement.EAST]: east, [Placement.CENTER]: centre });

        expect(front.isDisplayed()).toBe(true);
        expect(back.isDisplayed()).toBe(false);

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(front.isDisplayed()).toBe(false);

        // An idle resize lays every region out again.
        host.setWidth(500);
        host.doLayout();

        expect(front.isDisplayed()).toBe(false);

        // A sibling's animation lays every participant out on each frame.
        border.setRegionCollapsed(Placement.EAST, true);
        settle();

        expect(front.isDisplayed()).toBe(false);

        border.setRegionCollapsed(Placement.WEST, false);
        settle();

        expect(front.isDisplayed()).toBe(true);
        expect(back.isDisplayed()).toBe(false);

        host.dispose();
    });

    it('takes a child something else put back out again on the next idle layout', () => {
        install();

        const child  = makeChild(80, 80);
        const west   = makeRegion(child);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(child.isDisplayed()).toBe(false);

        child.setDisplayed(true);
        host.doLayout();

        expect(child.isDisplayed()).toBe(false);

        host.dispose();
    });
});

describe('The recorded children stop being this manager\'s once they leave the region', () => {
    it('neither re-hides a re-homed child on an idle layout nor redisplays it on expand', () => {
        install();

        const child  = makeChild(80, 80);
        const stays  = makeChild(80, 80);
        const west   = new Container({ layoutManager: new VBox() });
        const centre = makeRegion(makeChild());

        // A second child keeps the region sized once the first is re-homed —
        // Border throws for a region that reports no preferred size at all.
        west.addComponent(child);
        west.addComponent(stays);
        west.getElement(true);
        child.getElement(true);
        stays.getElement(true);

        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });
        const elsewhere = new Container();

        elsewhere.getElement(true);

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(child.isDisplayed()).toBe(false);
        expect(stays.isDisplayed()).toBe(false);

        // Re-homed while the region stays collapsed, and shown by its new
        // owner. The region keeps its snapshot, so it still lays out.
        elsewhere.moveComponent(child);
        child.setDisplayed(true);
        host.doLayout();

        expect(child.isDisplayed()).toBe(true);

        // Hidden by its new owner; the old region's expand must not override
        // that, while the child that stayed comes back as usual.
        child.setDisplayed(false);
        border.setRegionCollapsed(Placement.WEST, false);
        settle();

        expect(child.isDisplayed()).toBe(false);
        expect(stays.isDisplayed()).toBe(true);

        host.dispose();
        elsewhere.dispose();
    });
});

describe('Content comes back when a collapsed region stops being clipped', () => {
    it('redisplays and restores a still-flagged region once collapsible is switched off', () => {
        install();

        const child  = makeChild(80, 80);
        const west   = makeRegion(child);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(child.isDisplayed()).toBe(false);

        // A non-collapsible region takes the unclipped frame branch whatever
        // its flag says, and `setRegionCollapsed` refuses it from then on.
        border.setRegionCollapsible(Placement.WEST, false);

        const restoreSpy = vi.spyOn(west, 'restoreSubtreeScroll');

        host.doLayout();

        expect(border.isRegionCollapsed(Placement.WEST)).toBe(true);
        expect(child.isDisplayed()).toBe(true);
        expect(child.getWidth()).toBeGreaterThan(0);
        expect(internals(border)._undisplayedRegionContent.has(Placement.WEST)).toBe(false);
        expect(restoreSpy).toHaveBeenCalledTimes(1);

        host.dispose();
    });
});

describe('A replaced or removed region component leaves no stale bookkeeping (case 16)', () => {
    it('setLayoutConstraints with a different WEST component drops the snapshot; the next layout undisplays the new content against its own report', () => {
        install();

        const oldChild = makeChild(80, 80);
        const west     = makeRegion(oldChild);
        const centre   = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(internals(border)._undisplayedRegionContent.has(Placement.WEST)).toBe(true);

        const newChild = new Component({ preferredSize: { width: 120, height: 90 } });
        const newWest  = makeRegion(newChild);
        const newWestPreferred = newWest.getPreferredSize();

        host.addComponent(newWest, collapsiblePlacement(Placement.WEST));

        expect(internals(border)._undisplayedRegionContent.has(Placement.WEST)).toBe(false);
        expect(internals(border)._pendingScrollRestore.has(Placement.WEST)).toBe(false);
        expect(newChild.isDisplayed()).toBe(true);

        // The region itself is still collapsed (collapse is per placement),
        // so the next layout hides the new component's content — with the
        // new component's own snapshot, never the outgoing one's.
        host.doLayout();

        expect(newChild.isDisplayed()).toBe(false);
        expect(internals(border)._undisplayedRegionContent.get(Placement.WEST)?.preferred).toEqual(newWestPreferred);

        host.dispose();
    });

    it('removing the collapsed WEST component drops its snapshot', () => {
        install();

        const west   = makeRegion(makeChild(80, 80));
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(internals(border)._undisplayedRegionContent.has(Placement.WEST)).toBe(true);

        host.removeComponent(west);

        expect(internals(border)._undisplayedRegionContent.has(Placement.WEST)).toBe(false);
        expect(internals(border)._pendingScrollRestore.has(Placement.WEST)).toBe(false);

        host.dispose();
    });
});

describe('Native scroll offsets survive a collapse/expand round trip', () => {
    it("captures a natively scrolled Panel's offset before the collapse hides it and restores it once the expand settles", () => {
        const sink = install();

        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native', preferredSize: { width: 80, height: 80 } });
        const west   = makeRegion(panel);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });
        const panelEl = panel.getElement()!;

        // A wheel/keyboard scroll moves the native offset without going
        // through the component's setters, so its cache is stale until the
        // collapse captures the live value.
        DOM.sink.apply(panelEl, { scrollTop: 40 });
        expect(panel.getScrollTop()).toBe(0);

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(panel.isDisplayed()).toBe(false);
        expect(panel.getScrollTop()).toBe(40);

        // Simulate the browser dropping the native offset once display: none
        // removed the subtree's boxes.
        DOM.sink.apply(panelEl, { scrollTop: 0 });

        const before = sink.writes.length;

        border.setRegionCollapsed(Placement.WEST, false);
        settle();

        const restoreWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && w.args[0] === panelEl
            && (w.args[1] as { scrollTop?: number }).scrollTop === 40
        );

        expect(restoreWrite).toBe(true);
        expect(DOM.source.getScrollTop(panelEl)).toBe(40);

        host.dispose();
    });

    it('keeps the cached offset when the region is re-collapsed before its expand settles, and restores it on the next expand', () => {
        const sink = install();

        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native', preferredSize: { width: 80, height: 80 } });
        const west   = makeRegion(panel);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });
        const panelEl = panel.getElement()!;

        DOM.sink.apply(panelEl, { scrollTop: 40 });
        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(panel.getScrollTop()).toBe(40);

        // The engine dropped the native offset while the subtree had no boxes.
        DOM.sink.apply(panelEl, { scrollTop: 0 });

        // Expand (queuing the restore) and collapse again before it settles.
        border.setRegionCollapsed(Placement.WEST, false);
        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(panel.isDisplayed()).toBe(false);
        // The re-collapse must not have captured the engine's reset zero over
        // the offset the region was collapsed with.
        expect(panel.getScrollTop()).toBe(40);

        const before = sink.writes.length;

        border.setRegionCollapsed(Placement.WEST, false);
        settle();

        const restoreWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && w.args[0] === panelEl
            && (w.args[1] as { scrollTop?: number }).scrollTop === 40
        );

        expect(restoreWrite).toBe(true);
        expect(DOM.source.getScrollTop(panelEl)).toBe(40);

        host.dispose();
    });
});

describe("A sibling's toggle does not prime the cross-fade on a collapsed-and-undisplayed region", () => {
    it('leaves the collapsed WEST region without a background-color transition when EAST collapses', () => {
        install();

        const west   = makeRegion(makeChild());
        const east   = makeRegion(makeChild());
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.EAST]: east, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(west.getComponents()[0].isDisplayed()).toBe(false);
        expect(west.getTransition()).toBeNull();

        // WEST moves as a box only during EAST's collapse; it must not be
        // mistaken for a gutter and carry the strip cross-fade.
        border.setRegionCollapsed(Placement.EAST, true);

        expect(west.getTransition()).toBeNull();
        expect(west.getWillChange()).toBeNull();

        settle();
        host.dispose();
    });
});

describe('A manager swap releases what the collapse took out', () => {
    it("puts a collapsed region's content back and resumes its clamp when the Border is detached", () => {
        install();

        const west  = new Component({ layoutManager: new VBox() });
        const child = makeChild(80, 80);

        west.getElement(true);
        west.addComponent(child);
        child.getElement(true);

        const centre = makeRegion(makeChild());
        const border = new Border();
        const host   = new Container({ layoutManager: border });

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);
        host.clearInsets();
        host.addComponent(west, collapsiblePlacement(Placement.WEST));
        host.addComponent(centre, collapsiblePlacement(Placement.CENTER));
        host.doLayout();

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(child.isDisplayed()).toBe(false);

        host.setLayoutManager(new VBox());
        host.doLayout();

        expect(child.isDisplayed()).toBe(true);

        // The clamp is the region's own again: with its child displayed the
        // content-derived max is unbounded, so a box write goes through.
        west.setWidth(198);
        expect(west.getWidth()).toBe(198);

        host.dispose();
    });
});

describe('A disposed host writes nothing to a collapsed region\'s destroyed children', () => {
    it('does not call setDisplayed on the child when the host is disposed while WEST is collapsed', () => {
        install();

        const child = makeChild();
        const west  = makeRegion(child);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(child.isDisplayed()).toBe(false);

        // The destructor destroys the children before the manager detaches
        // and leaves their parent links in place, so the detach must not
        // mistake them for a parked region's live children.
        const redisplay = vi.spyOn(child, 'setDisplayed');

        host.dispose();

        expect(redisplay).not.toHaveBeenCalled();
    });
});

describe('A general Component region keeps its own box while its content is out', () => {
    it('is laid out at its full pre-collapse extent across a resize while collapsed and expands from that box', () => {
        install();

        // A content-clamping component with a box manager — not a Container —
        // used directly as the WEST region: with its children undisplayed, its
        // merged max collapses to the bare perimeter, which its own
        // setWidth/setHeight clamp would otherwise honour.
        const west  = new Component({ layoutManager: new VBox() });
        const child = makeChild(80, 80);

        west.getElement(true);
        west.addComponent(child);
        child.getElement(true);

        const centre = makeRegion(makeChild());
        const border = new Border();
        const host   = new Container({ layoutManager: border });

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);
        host.clearInsets();
        host.addComponent(west, collapsiblePlacement(Placement.WEST));
        host.addComponent(centre, collapsiblePlacement(Placement.CENTER));
        host.doLayout();

        const width  = west.getWidth();
        const height = west.getHeight();

        expect(width).toBe(80);
        expect(height).toBe(300);

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        host.setWidth(500);
        host.doLayout();

        expect(child.isDisplayed()).toBe(false);
        expect(west.getWidth()).toBe(width);
        expect(west.getHeight()).toBe(height);

        border.setRegionCollapsed(Placement.WEST, false);
        settle();

        expect(child.isDisplayed()).toBe(true);
        expect(west.getWidth()).toBe(width);
        expect(west.getHeight()).toBe(height);

        host.dispose();
    });
});

describe('Reduced motion undisplays and redisplays in the same call (case 19)', () => {
    it('lands the undisplay synchronously with no timer advance or frame', () => {
        install();
        vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true);

        const child  = makeChild(80, 80);
        const west   = makeRegion(child);
        const centre = makeRegion(makeChild());
        const { host, border } = hostBorder({ [Placement.WEST]: west, [Placement.CENTER]: centre });

        border.setRegionCollapsed(Placement.WEST, true);

        expect(child.isDisplayed()).toBe(false);

        border.setRegionCollapsed(Placement.WEST, false);

        expect(child.isDisplayed()).toBe(true);

        host.dispose();
    });
});
