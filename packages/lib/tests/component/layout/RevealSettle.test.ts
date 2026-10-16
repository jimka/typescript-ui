// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A reveal that opens an `Accordion` section, a `Split` pane or a `Border`
// region scrolls after the open has finished. Cases K1–K6 of
// plans/implemented/nested-scroll-reveal.md, and K7–K11 the implementation and
// its reviews added.
//
// Each of the three layout managers answers `isRevealSettled()`: `false` from
// a toggle until its animation ends. `FocusReveal.reveal` opens at once and
// puts its scroll off, one layout flush at a time, until every opener around
// the control answers `true`. Two things depend on that wait. The boxes below
// an opening `Accordion` section keep moving for the 200 ms the section takes
// to grow. And a `Split` pane or a `Border` region is given back the scroll
// offsets it was collapsed with when its expand settles, not before.
//
// `transitionend` never fires offline and the modelled DOM swallows
// `requestAnimationFrame`, so an animated toggle is settled here the way
// `Split.collapseUndisplay.test.ts` settles one: frame callbacks are captured
// through a `DOM.sink.requestAnimationFrame` spy and run with a timestamp past
// the animation's duration, and the fake clock is advanced past the primed CSS
// transitions' fallback timers.
//
// A browser reads 0 for the scroll offsets of an element under
// `display: none`, which is what a collapsed pane's content is. The modelled
// DOM keeps the recorded offset instead, so each case writes that 0 by hand.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Split } from '~/layout/Split';
import { Border } from '~/layout/Border';
import { Tab } from '~/layout/Tab';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Placement } from '~/primitive/Placement';
import { Fit } from '~/layout/Fit';
import { Absolute } from '~/layout/Absolute';
import { Animation } from '~/core/Animation';
import { FocusReveal } from '~/core/FocusReveal';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { _Tree } from '~/component/tree/Tree';
import { Menu } from '~/overlay/Menu';
import { Tooltip } from '~/overlay/Tooltip';
import { installTestDOM, makeEvent, setConnected, setScrollExtent, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Comfortably past the 200 ms collapse and section-toggle durations plus their
 * 40 ms fallback buffer, so one flush lands every geometry frame on its end
 * state and every primed transition's fallback timer fires. The value
 * `Split.collapseUndisplay.test.ts` uses.
 */
const PAST_FALLBACK_MS = 1000;

/**
 * Upper bound on flush rounds. At a past-duration timestamp an animation
 * settles in one frame and the reveal's scroll pass follows on the next, so a
 * run that needs more than a handful is a loop, not progress. The value
 * `Split.collapseUndisplay.test.ts` uses.
 */
const MAX_FLUSH_ROUNDS = 8;

// The page a case nests an opener in: a scrolling panel 300 × 200.
const PAGE_WIDTH  = 300;
const PAGE_HEIGHT = 200;

let frames: FrameRequestCallback[] = [];
let built: Component[] = [];

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
    flushFrames(PAST_FALLBACK_MS);

    // A scrolling panel stays in the reveal registry until it is disposed, and
    // the next test's fresh handle table reuses its element's number.
    for (const component of built) {
        component.dispose();
    }

    built = [];
    vi.restoreAllMocks();
    vi.useRealTimers();

    // A `Tree` starts `Menu`'s input watch when it is built.
    Menu._stopInputWatch();
    Tooltip._stopPointerWatch();
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

/** Runs the captured frames one time at the current clock: one layout flush, mid-animation. */
function flushOnce(): void {
    const pending = frames;

    frames = [];

    for (const cb of pending) {
        cb(performance.now());
    }
}

/**
 * Settles an in-flight collapse, expand or section toggle: the geometry loop
 * reaches its last frame, then the transition fallbacks fire.
 */
function settle(): void {
    flushFrames(PAST_FALLBACK_MS);
    vi.advanceTimersByTime(PAST_FALLBACK_MS);
    flushFrames(PAST_FALLBACK_MS);
}

/** The element of the panel that really scrolls. */
function scroller(panel: Panel): Handle {
    return (panel as any).getScrollElement();
}

/** The offset the scrolling element itself is at, as opposed to the one the panel remembers. */
function live(panel: Panel): number {
    return DOM.source.getScrollTop(scroller(panel));
}

/** How many writes the sink has recorded so far: the mark `scrollWrites` counts from. */
function writeMark(): number {
    return (DOM.sink as RecordingDOMSink).writes.length;
}

/**
 * How many scroll-offset writes the sink recorded after `from`.
 *
 * @param from - A mark taken with {@link writeMark}.
 * @returns The number of `apply` writes carrying `scrollTop` or `scrollLeft`.
 */
function scrollWrites(from: number): number {
    return (DOM.sink as RecordingDOMSink).writes.slice(from).filter(write => {
        const patch = write.args[1] as { scrollTop?: number; scrollLeft?: number } | undefined;

        return write.op === 'apply' && (patch?.scrollTop !== undefined || patch?.scrollLeft !== undefined);
    }).length;
}

/**
 * Renders each component, marks it connected, and records the first one for
 * disposal. The broker drops a revealer whose element is not connected.
 *
 * @param components - The outermost component first, then everything under it a case touches.
 */
function connect(...components: Component[]): void {
    built.push(components[0]);

    for (const component of components) {
        setConnected(component.getElement(true)!, true);
    }
}

/**
 * A pane holding one scrolling panel, which holds a 40 × 30 control.
 *
 * @param targetY - How far down the panel's content the control sits.
 * @returns The pane, the panel and the control.
 */
function scrollPane(targetY: number): { pane: Container; panel: Panel; target: Component } {
    const pane   = new Container({ layoutManager: new Fit() });
    const panel  = new Panel({ layoutManager: new Absolute(), flush: true, autoScroll: 'y' });
    const target = new Component({ preferredSize: { width: 40, height: 30 } });

    target.setX(10);
    target.setY(targetY);
    panel.addComponent(target);
    pane.addComponent(panel);

    return { pane, panel, target };
}

/** A pane holding one 50 × 50 component: the pane beside the one under test. */
function fillerPane(): Container {
    const pane = new Container({ layoutManager: new Fit() });

    pane.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));

    return pane;
}

/** A scrolling page, not yet sized: `Absolute` layout, no insets, vertical scroll. */
function makePage(): Panel {
    return new Panel({ layoutManager: new Absolute(), flush: true, autoScroll: 'y' });
}

/**
 * Sizes `page` to 300 × 200 and lays it out.
 *
 * @param page - The page, with its content already added.
 */
function layOutPage(page: Panel): void {
    page.getElement(true);
    page.setWidth(PAGE_WIDTH);
    page.setHeight(PAGE_HEIGHT);
    page.doLayout();
}

/**
 * A 400 × 300 horizontal `Split` whose first pane is a scrolling panel 300 px
 * high, laid out and connected.
 *
 * @param targetY - How far down the panel's content the control sits.
 * @returns The manager, its host, the scrolling panel and the control.
 */
function splitRig(targetY: number): { split: Split; container: Container; panel: Panel; target: Component } {
    const { pane, panel, target } = scrollPane(targetY);
    const split     = new Split({ orientation: 'horizontal' });
    const container = new Container({ layoutManager: split });

    container.getElement(true);
    container.setWidth(400);
    container.setHeight(300);
    container.clearInsets();
    container.addComponent(pane);
    container.addComponent(fillerPane());
    container.doLayout();
    connect(container, pane, panel, target);
    flushFrames(0);

    return { split, container, panel, target };
}

/**
 * A scrolling page 300 × 200 holding an `Accordion` 100 px down: section A is
 * open and 150 px high, section B is closed, 400 px high, and holds a 40 × 30
 * control 350 px down.
 *
 * @returns The page, the accordion's host, its manager and the control.
 */
function accordionRig(): { page: Panel; host: Container; acc: Accordion; target: Component } {
    const page   = makePage();
    const acc    = new Accordion();
    const host   = new Container({ layoutManager: acc });
    const a      = new Component({ preferredSize: { width: 100, height: 150 } });
    const b      = new Container({ layoutManager: new Absolute(), preferredSize: { width: 100, height: 400 } });
    const target = new Component({ preferredSize: { width: 40, height: 30 } });

    target.setX(10);
    target.setY(350);
    b.addComponent(target);
    host.clearInsets();
    host.addComponent(a, new AccordionConstraints('A', true));
    host.addComponent(b, new AccordionConstraints('B', false));
    host.setX(0);
    host.setY(100);
    page.addComponent(host);
    layOutPage(page);
    connect(page, host, a, b, target);
    flushFrames(0);

    return { page, host, acc, target };
}

// Where the accordion cases land. The control's bottom edge in the page's
// content: the host's top (100), section A's 28 px header and 150 px body,
// section B's 28 px header, and the control's own 350 + 30. Less the page's
// 200 px viewport.
const ACCORDION_REVEAL_TOP = 100 + 28 + 150 + 28 + 380 - PAGE_HEIGHT;

describe('A reveal into a collapsed Split pane', () => {
    it('K1: waits for the expand, and finds the pane back at the offset it was left at', () => {
        install();

        const { split, panel, target } = splitRig(800);

        expect(panel.getScrollViewportRect()!.height).toBe(300);

        // The control spans 800–830; at 700 the panel shows 700–1000, so it
        // is in view where the pane was left.
        panel.setScrollTop(700);
        split.setPaneCollapsed(0, true);
        settle();
        DOM.sink.apply(scroller(panel), { scrollTop: 0 });

        expect(split.isRevealSettled()).toBe(true);
        expect(FocusReveal.reveal(target.getElement()!)).toBe(true);

        expect(split.isPaneCollapsed(0)).toBe(false);
        expect(split.isRevealSettled()).toBe(false);
        expect(live(panel)).toBe(0);
        expect(panel.getScrollTop()).toBe(700);

        flushOnce();

        expect(split.isRevealSettled()).toBe(false);
        expect(live(panel)).toBe(0);

        settle();

        // A scroll made before the restore would have started from 0 and
        // ended at 830 − 300.
        expect(split.isRevealSettled()).toBe(true);
        expect(live(panel)).toBe(700);
        expect(panel.getScrollTop()).toBe(700);

        split.detach();
    });

    it('K2: under reduced motion the pane is restored and scrolled inside the call', () => {
        install();
        vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true);

        const { split, panel, target } = splitRig(1100);

        panel.setScrollTop(700);
        split.setPaneCollapsed(0, true);
        DOM.sink.apply(scroller(panel), { scrollTop: 0 });

        FocusReveal.reveal(target.getElement()!);

        // The pane came back at 700, where the control (1100–1130) is below
        // the 300 px viewport: 1130 − 300.
        expect(split.isRevealSettled()).toBe(true);
        expect(live(panel)).toBe(830);
        expect(panel.getScrollTop()).toBe(830);

        split.detach();
    });

    it('K6: a page around the Split scrolls once, after the pane has opened', () => {
        install();

        const page = makePage();
        const { pane, panel, target } = scrollPane(800);
        const split     = new Split({ orientation: 'horizontal' });
        const container = new Container({ layoutManager: split, preferredSize: { width: 280, height: 300 } });

        container.clearInsets();
        container.addComponent(pane);
        container.addComponent(fillerPane());
        container.setX(0);
        container.setY(400);
        page.addComponent(container);
        layOutPage(page);
        connect(page, container, pane, panel, target);
        flushFrames(0);

        expect([container.getWidth(), container.getHeight()]).toEqual([280, 300]);
        expect(panel.getScrollViewportRect()!.height).toBe(300);

        panel.setScrollTop(700);
        split.setPaneCollapsed(0, true);
        settle();
        DOM.sink.apply(scroller(panel), { scrollTop: 0 });
        page.setScrollTop(300);

        FocusReveal.reveal(target.getElement()!);

        expect(page.getScrollTop()).toBe(300);

        settle();

        // The pane is back at 700, which draws the control 100 px down the
        // pane: 500–530 of the page's content. The page showed 300–500, so
        // it moves by the control's 30 px. A scroll made before the restore
        // would have measured the control 800 px down the pane and sent the
        // page to 400 + 830 − 200.
        expect(panel.getScrollTop()).toBe(700);
        expect(page.getScrollTop()).toBe(330);
        expect(live(page)).toBe(330);

        split.detach();
    });

    it('K7: a Split detached mid-expand no longer holds the scroll back', () => {
        install();

        const page = makePage();
        const { pane, panel, target } = scrollPane(800);
        const split     = new Split({ orientation: 'horizontal' });
        const container = new Container({ layoutManager: split, preferredSize: { width: 280, height: 300 } });

        container.clearInsets();
        container.addComponent(pane);
        container.addComponent(fillerPane());
        container.setX(0);
        container.setY(400);
        page.addComponent(container);
        layOutPage(page);
        connect(page, container, pane, panel, target);
        flushFrames(0);

        split.setPaneCollapsed(0, true);
        settle();

        const mark = writeMark();

        FocusReveal.reveal(target.getElement()!);

        expect(split.isRevealSettled()).toBe(false);
        expect(scrollWrites(mark)).toBe(0);

        // The manager leaves the reveal registry here, still mid-animation.
        split.detach();
        flushFrames(0);

        // Panel: 830 − 300. Page: the control is then at the pane's bottom
        // edge, 400 + 300 − 200.
        expect(panel.getScrollTop()).toBe(530);
        expect(page.getScrollTop()).toBe(500);
    });
});

describe('A key pressed in a tree while an opener around it is still animating', () => {
    /**
     * Dispatches a real `keydown` on a tree, cancelled by the tree as in a
     * browser.
     *
     * @param tree - The tree holding focus.
     * @param key - The key's `KeyboardEvent.key`.
     */
    function press(tree: InstanceType<typeof _Tree>, key: string): void {
        const element = tree.getElement()!;

        DOM.sink.focus(element);
        DOM.sink.dispatchEvent(element, makeEvent(element, 'keydown', { key }));
    }

    it('K9: during a Split expand the key scrolls the tree only, the pane comes back at its offset, and the next key follows', () => {
        install();

        const pane  = new Container({ layoutManager: new Fit() });
        const panel = new Panel({ layoutManager: new Absolute(), flush: true, autoScroll: 'y' });
        const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });
        const split = new Split({ orientation: 'horizontal' });
        const host  = new Container({ layoutManager: split });

        tree.setX(0);
        tree.setY(750);
        panel.addComponent(new Component({ preferredSize: { width: 10, height: 2000 } }));
        panel.addComponent(tree);
        pane.addComponent(panel);

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);
        host.clearInsets();
        host.addComponent(pane);
        host.addComponent(fillerPane());
        host.doLayout();
        connect(host, pane, panel, tree);
        flushFrames(0);

        // The panel's content is taller than the pane.
        setScrollExtent(scroller(panel), { width: 200, height: 2000 });
        panel.scheduleLayout();
        flushFrames(0);
        tree.setNodes(['H', 'e', 'l', 'o', 'W', 'r', 'd', 'x', 'X', 'o'].map(label => ({ label })));
        flushFrames(0);

        expect(panel.hasScrollRange('y')).toBe(true);
        expect(panel.getScrollViewportRect()!.height).toBe(300);

        // The tree spans 750–870. At 600 the panel shows 600–900.
        panel.setScrollTop(600);
        split.setPaneCollapsed(0, true);
        settle();
        DOM.sink.apply(scroller(panel), { scrollTop: 0 });

        // The user expands the pane and presses End in the tree before the
        // 200 ms are over.
        split.setPaneCollapsed(0, false);

        const mark = writeMark();

        press(tree, 'End');

        // The tree scrolled its own rows. The panel around it is left alone
        // while the pane is still opening: it would be measured, and its
        // offset re-read as 0, before the expand gives it back.
        expect(split.isRevealSettled()).toBe(false);
        expect((tree as any)._scroller.getScrollY()).toBe(120);
        expect(scrollWrites(mark)).toBe(0);
        expect(panel.getScrollTop()).toBe(600);

        settle();

        expect(panel.getScrollTop()).toBe(600);
        expect(live(panel)).toBe(600);

        // The browser scrolls the panel away; the next key follows as usual.
        // Row 0 is at the tree's top edge, 750 of the panel.
        DOM.sink.apply(scroller(panel), { scrollTop: 0 });
        press(tree, 'Home');

        expect(panel.getScrollTop()).toBe(750 + 24 - 300);

        split.detach();
    });

    it('K11: during an Accordion section\'s opening the key scrolls the tree only, and the next key follows', () => {
        install();

        const page  = makePage();
        const acc   = new Accordion();
        const host  = new Container({ layoutManager: acc });
        const first = new Component({ preferredSize: { width: 100, height: 150 } });
        const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });

        host.clearInsets();
        host.addComponent(first, new AccordionConstraints('A', true));
        host.addComponent(tree, new AccordionConstraints('B', false));
        host.setX(0);
        host.setY(600);
        page.addComponent(new Component({ preferredSize: { width: 10, height: 2000 } }));
        page.addComponent(host);
        layOutPage(page);
        connect(page, host, first, tree);
        flushFrames(0);
        setScrollExtent(scroller(page), { width: PAGE_WIDTH, height: 2000 });
        page.scheduleLayout();
        flushFrames(0);
        tree.setNodes(['H', 'e', 'l', 'o', 'W', 'r', 'd', 'x', 'X', 'o'].map(label => ({ label })));
        flushFrames(0);

        expect(page.hasScrollRange('y')).toBe(true);

        // The user opens the tree's section and presses End in the tree
        // while the section is still growing.
        acc.openSection(1);

        const mark = writeMark();

        press(tree, 'End');

        expect(acc.isRevealSettled()).toBe(false);
        expect(scrollWrites(mark)).toBe(0);
        expect(page.getScrollTop()).toBe(0);

        flushOnce();

        expect(scrollWrites(mark)).toBe(0);

        settle();

        // Still nothing: the key took no outward step, and none was kept.
        expect(page.getScrollTop()).toBe(0);

        // The next key brings its row into the page's view.
        press(tree, 'Home');

        const view = page.getScrollViewportRect()!;
        const row  = DOM.source.getElementRect(tree.getElement()!);

        expect(page.getScrollTop()).toBeGreaterThan(0);

        // Row 0 is the tree's top 24 px, flush with the page's bottom edge.
        expect(row.top + 24).toBe(view.bottom);

        acc.detach();
    });
});

describe('An opener says whether it hides a control', () => {
    it('K10: Split, Border, Accordion and Tab answer hidesDescendant for the part the control is in', () => {
        install();

        // Split: pane 0 collapsed.
        const split  = splitRig(800);

        expect(split.split.hidesDescendant(split.target.getElement()!)).toBe(false);

        split.split.setPaneCollapsed(0, true);
        settle();

        expect(split.split.hidesDescendant(split.target.getElement()!)).toBe(true);
        expect(split.split.hidesDescendant(split.container.getElement()!)).toBe(false);

        split.split.detach();

        // Accordion: section B closed, section A open.
        const accordion = accordionRig();
        const sectionA  = accordion.host.getComponents()[0];

        expect(accordion.acc.hidesDescendant(accordion.target.getElement()!)).toBe(true);
        expect(accordion.acc.hidesDescendant(sectionA.getElement()!)).toBe(false);

        accordion.acc.openSection(1);
        settle();

        expect(accordion.acc.hidesDescendant(accordion.target.getElement()!)).toBe(false);

        accordion.acc.detach();

        // Border: the WEST region collapsed.
        const west      = scrollPane(800);
        const border    = new Border();
        const borderBox = new Container({ layoutManager: border });

        borderBox.getElement(true);
        borderBox.setWidth(400);
        borderBox.setHeight(300);
        borderBox.clearInsets();
        west.pane.setPreferredSize({ width: 150, height: 0 });
        borderBox.addComponent(west.pane, Object.assign(new LayoutConstraints(), { placement: Placement.WEST, collapsible: true }));
        borderBox.addComponent(new Component({ preferredSize: { width: 100, height: 100 } }));
        borderBox.doLayout();
        connect(borderBox, west.pane, west.panel, west.target);
        flushFrames(0);

        expect(border.hidesDescendant(west.target.getElement()!)).toBe(false);

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        expect(border.hidesDescendant(west.target.getElement()!)).toBe(true);

        border.detach();

        // Tab: the second tab's content while the first is selected.
        const tab     = new Tab();
        const tabBox  = new Container({ layoutManager: tab });
        const shown   = new Component({ preferredSize: { width: 50, height: 50 } });
        const hidden  = scrollPane(800);

        tabBox.getElement(true);
        tabBox.setWidth(400);
        tabBox.setHeight(300);
        tabBox.addComponent(shown);
        tabBox.addComponent(hidden.pane);
        tab.createTab(shown);
        tab.createTab(hidden.pane);
        tabBox.doLayout();
        connect(tabBox, shown, hidden.pane, hidden.panel, hidden.target);
        flushFrames(0);

        expect(tab.hidesDescendant(hidden.target.getElement()!)).toBe(true);
        expect(tab.hidesDescendant(shown.getElement()!)).toBe(false);

        tab.setActiveContent(hidden.pane);
        flushFrames(0);

        expect(tab.hidesDescendant(hidden.target.getElement()!)).toBe(false);

        tab.detach();
    });
});

describe('A reveal into a collapsed Border region', () => {
    it('K3: waits for the expand, and finds the region back at the offset it was left at', () => {
        install();

        const { pane, panel, target } = scrollPane(800);
        const border    = new Border();
        const container = new Container({ layoutManager: border });

        container.getElement(true);
        container.setWidth(400);
        container.setHeight(300);
        container.clearInsets();
        pane.setPreferredSize({ width: 150, height: 0 });
        container.addComponent(pane, Object.assign(new LayoutConstraints(), { placement: Placement.WEST, collapsible: true }));
        container.addComponent(new Component({ preferredSize: { width: 100, height: 100 } }));
        container.doLayout();
        connect(container, pane, panel, target);
        flushFrames(0);

        expect(panel.getScrollViewportRect()!.height).toBe(300);

        panel.setScrollTop(700);
        border.setRegionCollapsed(Placement.WEST, true);
        settle();
        DOM.sink.apply(scroller(panel), { scrollTop: 0 });

        expect(border.isRevealSettled()).toBe(true);
        expect(FocusReveal.reveal(target.getElement()!)).toBe(true);

        expect(border.isRegionCollapsed(Placement.WEST)).toBe(false);
        expect(border.isRevealSettled()).toBe(false);
        expect(live(panel)).toBe(0);
        expect(panel.getScrollTop()).toBe(700);

        settle();

        expect(border.isRevealSettled()).toBe(true);
        expect(live(panel)).toBe(700);
        expect(panel.getScrollTop()).toBe(700);

        border.detach();
    });
});

describe('A reveal into a hidden Tab page', () => {
    it('K8: selects the tab inside the call, and the page around it shows the control', () => {
        install();

        const page  = makePage();
        const tab   = new Tab();
        const host  = new Container({ layoutManager: tab, preferredSize: { width: 280, height: 300 } });
        const first = new Component({ preferredSize: { width: 50, height: 50 } });
        const { pane, panel, target } = scrollPane(800);

        host.clearInsets();
        host.addComponent(first);
        host.addComponent(pane);
        tab.createTab(first);
        tab.createTab(pane);
        host.setX(0);
        host.setY(400);
        page.addComponent(host);
        layOutPage(page);
        connect(page, host, first, pane, panel, target);
        flushFrames(0);

        // The control spans 800–830. Leave its page at 700, where it is in
        // view, and turn to the other tab.
        tab.setActiveContent(pane);
        flushFrames(0);
        panel.setScrollTop(700);
        tab.setActiveContent(first);
        flushFrames(0);
        DOM.sink.apply(scroller(panel), { scrollTop: 0 });

        expect(tab.getVisibleComponent()).toBe(first);
        expect(page.getScrollTop()).toBe(0);

        expect(FocusReveal.reveal(target.getElement()!)).toBe(true);

        // A `Tab` opens and lays out inside the call, and has no animation
        // to wait for.
        expect(tab.getVisibleComponent()).toBe(pane);

        flushFrames(0);

        // The tab's page is back where it was left, and nothing scrolled it.
        expect(panel.getScrollTop()).toBe(700);
        expect(live(panel)).toBe(700);

        // The page moved by the least distance that shows the control: its
        // bottom edge is on the page viewport's bottom edge.
        const view    = page.getScrollViewportRect()!;
        const control = DOM.source.getElementRect(target.getElement()!);

        expect(page.getScrollTop()).toBeGreaterThan(0);
        expect(control.bottom).toBe(view.bottom);
        expect(control.top).toBeGreaterThanOrEqual(view.top);

        tab.detach();
    });
});

describe('A reveal into a closed Accordion section', () => {
    it('K4: scrolls the page once the section has finished opening', () => {
        install();

        const { page, host, acc, target } = accordionRig();

        // Two 28 px headers and section A's 150 px body.
        expect(acc.isRevealSettled()).toBe(true);
        expect(host.getHeight()).toBe(206);

        const mark = writeMark();

        FocusReveal.reveal(target.getElement()!);

        expect(acc.isSectionOpen(1)).toBe(true);
        expect(acc.isRevealSettled()).toBe(false);
        expect(scrollWrites(mark)).toBe(0);

        flushOnce();

        // The layout has grown the host by section B's 400 px, and the
        // section's height transition is still running.
        expect(host.getHeight()).toBe(606);
        expect(acc.isRevealSettled()).toBe(false);
        expect(scrollWrites(mark)).toBe(0);

        settle();

        expect(acc.isRevealSettled()).toBe(true);
        expect(page.getScrollTop()).toBe(ACCORDION_REVEAL_TOP);
        expect(live(page)).toBe(ACCORDION_REVEAL_TOP);

        acc.detach();
    });

    it('K5: under reduced motion the scroll follows the next layout flush', () => {
        install();
        vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true);

        const { page, host, acc, target } = accordionRig();
        const mark = writeMark();

        FocusReveal.reveal(target.getElement()!);

        // Nothing animates, but the section's layout pass is still queued.
        expect(acc.isRevealSettled()).toBe(true);
        expect(scrollWrites(mark)).toBe(0);
        expect(host.getHeight()).toBe(206);

        flushOnce();

        expect(host.getHeight()).toBe(606);
        expect(page.getScrollTop()).toBe(ACCORDION_REVEAL_TOP);

        acc.detach();
    });
});
