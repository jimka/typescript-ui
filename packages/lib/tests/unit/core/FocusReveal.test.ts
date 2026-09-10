// Two layers: the broker itself (containment, outermost-first ordering,
// disconnected-target guard, leak-guard pruning vs. "not yet rendered")
// exercised against minimal FocusRevealer test doubles, and each concrete
// revealer's own revealDescendant against a real Tab/Border/Accordion/Split/
// Panel instance. FocusHistory's own integration (navigate's skip-loop,
// reveal-before-focus, the table-cell record filter) lives in
// FocusHistory.test.ts instead.
//
// `_revealers` is a module-level Set, so every test that registers a revealer
// (a test double or a real Tab/Border/Accordion/Split/Panel) unregisters it
// before returning — nothing here relies on DOM.reset() to clean the registry,
// since a stale handle number from a torn-down table could otherwise collide
// with an unrelated handle in the next test's fresh table.
import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { FocusReveal, type FocusRevealer } from '~/core/FocusReveal';
import { DOM, type Handle, type Rect } from '~/core/DOM';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab } from '~/layout/Tab';
import { Border } from '~/layout/Border';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { Split } from '~/layout/Split';
import { Panel } from '~/core/Panel';
import { Placement } from '~/primitive/Placement';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { installTestDOM, setConnected } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

// A minimal FocusRevealer test double: `el` fixes containment, `revealDescendant` is a spy.
interface FakeRevealer extends FocusRevealer {
    revealDescendant: Mock<(target: Handle) => void>;
}

function fakeRevealer(el: Handle | null): FakeRevealer {
    return {
        getRevealElement: () => el,
        revealDescendant: vi.fn<(target: Handle) => void>(),
    };
}

describe('FocusReveal broker', () => {
    it('invokes revealDescendant only on a revealer whose element contains the target', () => {
        installTestDOM(CONFIG);

        const containerEl = DOM.sink.createElement('div');
        const outsideEl   = DOM.sink.createElement('div');
        const target       = DOM.sink.createElement('div');

        DOM.sink.appendChild(containerEl, target);
        setConnected(containerEl, true);
        setConnected(outsideEl, true);
        setConnected(target, true);

        const inside  = fakeRevealer(containerEl);
        const outside = fakeRevealer(outsideEl);

        FocusReveal.register(inside);
        FocusReveal.register(outside);

        expect(FocusReveal.reveal(target)).toBe(true);
        expect(inside.revealDescendant).toHaveBeenCalledWith(target);
        expect(outside.revealDescendant).not.toHaveBeenCalled();

        FocusReveal.unregister(inside);
        FocusReveal.unregister(outside);
    });

    it('reveals outermost-first, and containing() reports the same order without invoking either', () => {
        installTestDOM(CONFIG);

        const outerEl = DOM.sink.createElement('div');
        const innerEl = DOM.sink.createElement('div');
        const target   = DOM.sink.createElement('div');

        DOM.sink.appendChild(outerEl, innerEl);
        DOM.sink.appendChild(innerEl, target);
        setConnected(outerEl, true);
        setConnected(innerEl, true);
        setConnected(target, true);

        const order: string[] = [];
        const outer = fakeRevealer(outerEl);
        const inner = fakeRevealer(innerEl);

        outer.revealDescendant.mockImplementation(() => { order.push('outer'); });
        inner.revealDescendant.mockImplementation(() => { order.push('inner'); });

        // Registered inner-first, to prove the order comes from containment,
        // not registration order.
        FocusReveal.register(inner);
        FocusReveal.register(outer);

        expect(FocusReveal.reveal(target)).toBe(true);
        expect(order).toEqual(['outer', 'inner']);

        outer.revealDescendant.mockClear();
        inner.revealDescendant.mockClear();

        expect(FocusReveal.containing(target)).toEqual([outer, inner]);
        expect(outer.revealDescendant).not.toHaveBeenCalled();
        expect(inner.revealDescendant).not.toHaveBeenCalled();

        FocusReveal.unregister(inner);
        FocusReveal.unregister(outer);
    });

    it('returns false and invokes nothing when the target is disconnected', () => {
        installTestDOM(CONFIG);

        const containerEl = DOM.sink.createElement('div');
        const target       = DOM.sink.createElement('div');

        DOM.sink.appendChild(containerEl, target);
        setConnected(containerEl, true);
        setConnected(target, false);

        const revealer = fakeRevealer(containerEl);

        FocusReveal.register(revealer);

        expect(FocusReveal.reveal(target)).toBe(false);
        expect(revealer.revealDescendant).not.toHaveBeenCalled();

        FocusReveal.unregister(revealer);
    });

    it('prunes a revealer whose element rendered then disconnected, but keeps one still unrendered', () => {
        installTestDOM(CONFIG);

        const containerEl = DOM.sink.createElement('div');
        const target       = DOM.sink.createElement('div');

        DOM.sink.appendChild(containerEl, target);
        setConnected(containerEl, true);
        setConnected(target, true);

        const gone = fakeRevealer(containerEl);

        FocusReveal.register(gone);
        expect(FocusReveal.containing(target)).toEqual([gone]);

        // Rendered, then gone (a container GC'd without detach): dropped, and
        // reconnecting its element does not resurrect the registration.
        setConnected(containerEl, false);
        expect(FocusReveal.containing(target)).toEqual([]);
        setConnected(containerEl, true);
        expect(FocusReveal.containing(target)).toEqual([]);

        // Not yet rendered (`attach()` ran before first render): skipped for
        // this query but stays registered — found once it does render.
        let rendered = false;
        const notYetRendered = fakeRevealer(null);

        vi.spyOn(notYetRendered, 'getRevealElement').mockImplementation(() => rendered ? containerEl : null);

        FocusReveal.register(notYetRendered);
        expect(FocusReveal.containing(target)).toEqual([]);

        rendered = true;
        expect(FocusReveal.containing(target)).toEqual([notYetRendered]);

        FocusReveal.unregister(notYetRendered);
    });
});

describe('Tab.revealDescendant', () => {
    it('selects the tab containing the target and forces it visible synchronously', () => {
        installTestDOM(CONFIG);

        const tab  = new Tab();
        const host = new Container({ layoutManager: tab });

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);

        const a = new Component({});
        const b = new Component({});

        host.addComponent(a);
        host.addComponent(b);
        tab.createTab(a);
        tab.createTab(b);

        a.getElement(true);
        b.getElement(true);

        // `a` (index 0) is active by default; `b` is hidden.
        expect(tab.getVisibleComponent()).toBe(a);

        const target = DOM.sink.createElement('div');
        DOM.sink.appendChild(b.getElement()!, target);

        tab.revealDescendant(target);

        expect(tab.getVisibleComponent()).toBe(b);
        // The forced synchronous doLayout() means visibility is already
        // flipped by the time revealDescendant returns — no async wait needed.
        expect(b.isVisible()).toBe(true);

        tab.detach();
    });
});

describe('Border.revealDescendant', () => {
    function collapsiblePlacement(p: Placement): LayoutConstraints {
        return Object.assign(new LayoutConstraints(), { placement: p, collapsible: true });
    }

    it('expands a collapsed region containing the target, and leaves an expanded one untouched', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host   = new Container({ layoutManager: border });

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);
        host.clearInsets();

        const north  = new Component({ preferredSize: { width: 100, height: 40 } });
        const center = new Component({ preferredSize: { width: 100, height: 100 } });

        host.addComponent(north, collapsiblePlacement(Placement.NORTH));
        host.addComponent(center); // defaults to CENTER

        border.setRegionCollapsed(Placement.NORTH, true);
        expect(border.isRegionCollapsed(Placement.NORTH)).toBe(true);

        north.getElement(true);
        const northTarget = DOM.sink.createElement('div');
        DOM.sink.appendChild(north.getElement()!, northTarget);

        border.revealDescendant(northTarget);
        expect(border.isRegionCollapsed(Placement.NORTH)).toBe(false);

        // A target inside the already-expanded CENTER region triggers no
        // redundant collapse toggle.
        const spy = vi.spyOn(border, 'setRegionCollapsed');

        center.getElement(true);
        const centerTarget = DOM.sink.createElement('div');
        DOM.sink.appendChild(center.getElement()!, centerTarget);

        border.revealDescendant(centerTarget);
        expect(spy).not.toHaveBeenCalled();

        border.detach();
    });
});

describe('Accordion.revealDescendant', () => {
    function hostAccordion(width: number, height: number, acc: Accordion): Container {
        const host = new Container({ layoutManager: acc });

        host.getElement(true);
        host.setWidth(width);
        host.setHeight(height);
        host.clearInsets();

        return host;
    }

    function content(pref: { width: number; height: number }): Component {
        const c = new Component({ preferredSize: pref });
        c.getElement(true);

        return c;
    }

    function constraints(label: string, open: boolean): AccordionConstraints {
        return new AccordionConstraints(label, open);
    }

    it('opens a closed section containing the target, and leaves an open one untouched', () => {
        installTestDOM(CONFIG);

        const acc  = new Accordion();
        const host = hostAccordion(400, 300, acc);

        const a = content({ width: 100, height: 50 });
        const b = content({ width: 100, height: 50 });

        host.addComponent(a, constraints('A', true));  // open
        host.addComponent(b, constraints('B', false)); // closed
        host.doLayout(); // populates _openState

        expect(acc.isSectionOpen(1)).toBe(false);

        const targetB = DOM.sink.createElement('div');
        DOM.sink.appendChild(b.getElement()!, targetB);

        acc.revealDescendant(targetB);
        expect(acc.isSectionOpen(1)).toBe(true);

        // A target inside the already-open section triggers no redundant open.
        const spy = vi.spyOn(acc, 'openSection');

        const targetA = DOM.sink.createElement('div');
        DOM.sink.appendChild(a.getElement()!, targetA);

        acc.revealDescendant(targetA);
        expect(spy).not.toHaveBeenCalled();

        acc.detach();
    });
});

describe('Split.revealDescendant', () => {
    it('expands a collapsed pane containing the target, and leaves an expanded one untouched', () => {
        installTestDOM(CONFIG);

        const split = new Split();
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);

        const a = new Component({ preferredSize: { width: 100, height: 50 } });
        const b = new Component({ preferredSize: { width: 100, height: 50 } });

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout(); // builds the gutters setPaneCollapsed needs

        split.setPaneCollapsed(0, true);
        expect(split.isPaneCollapsed(0)).toBe(true);

        a.getElement(true);
        const targetA = DOM.sink.createElement('div');
        DOM.sink.appendChild(a.getElement()!, targetA);

        split.revealDescendant(targetA);
        expect(split.isPaneCollapsed(0)).toBe(false);

        // A target inside the already-expanded pane triggers no redundant collapse toggle.
        const spy = vi.spyOn(split, 'setPaneCollapsed');

        b.getElement(true);
        const targetB = DOM.sink.createElement('div');
        DOM.sink.appendChild(b.getElement()!, targetB);

        split.revealDescendant(targetB);
        expect(spy).not.toHaveBeenCalled();

        split.detach();
    });
});

describe('Panel.revealDescendant', () => {
    afterEach(() => vi.restoreAllMocks());

    /** Stages a fixed viewport rect for the panel and a movable one for the target. */
    function stageRects(panel: Panel, target: Handle, targetRect: Partial<Rect>): void {
        const view: Rect = { x: 0, y: 100, width: 300, height: 300, top: 100, left: 0, right: 300, bottom: 400 };
        const rect: Rect = { x: 0, y: 0, width: 40, height: 40, top: 0, left: 0, right: 40, bottom: 40, ...targetRect };
        const rects = new Map<Handle, Rect>([[panel.getElement()!, view], [target, rect]]);

        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((h: Handle) => rects.get(h)!);
    }

    function panelWithTarget(): { panel: Panel; target: Handle } {
        const panel = new Panel({ autoScroll: 'both', scrollbarStyle: 'native' });

        panel.getElement(true);

        const target = DOM.sink.createElement('div');

        return { panel, target };
    }

    it('scrolls up by exactly view.top - rect.top when the target sits above the viewport', () => {
        installTestDOM(CONFIG);

        const { panel, target } = panelWithTarget();

        stageRects(panel, target, { top: 20, bottom: 60, left: 50, right: 90 }); // above view.top (100)

        panel.revealDescendant(target);

        expect(panel.getScrollTop()).toBe(-(100 - 20));
        expect(panel.getScrollLeft()).toBe(0);
    });

    it('scrolls down by exactly rect.bottom - view.bottom when the target sits below the viewport', () => {
        installTestDOM(CONFIG);

        const { panel, target } = panelWithTarget();

        stageRects(panel, target, { top: 420, bottom: 460, left: 50, right: 90 }); // below view.bottom (400)

        panel.revealDescendant(target);

        expect(panel.getScrollTop()).toBe(460 - 400);
        expect(panel.getScrollLeft()).toBe(0);
    });

    it('scrolls left when the target sits left of the viewport', () => {
        installTestDOM(CONFIG);

        const { panel, target } = panelWithTarget();

        stageRects(panel, target, { top: 150, bottom: 190, left: -30, right: 10 }); // left of view.left (0)

        panel.revealDescendant(target);

        expect(panel.getScrollLeft()).toBe(-(0 - -30));
        expect(panel.getScrollTop()).toBe(0);
    });

    it('scrolls right when the target sits right of the viewport', () => {
        installTestDOM(CONFIG);

        const { panel, target } = panelWithTarget();

        stageRects(panel, target, { top: 150, bottom: 190, left: 320, right: 360 }); // right of view.right (300)

        panel.revealDescendant(target);

        expect(panel.getScrollLeft()).toBe(360 - 300);
        expect(panel.getScrollTop()).toBe(0);
    });

    it('leaves both scroll offsets unchanged when the target is already inside the viewport', () => {
        installTestDOM(CONFIG);

        const { panel, target } = panelWithTarget();

        stageRects(panel, target, { top: 150, bottom: 190, left: 50, right: 90 }); // fully inside

        panel.revealDescendant(target);

        expect(panel.getScrollTop()).toBe(0);
        expect(panel.getScrollLeft()).toBe(0);
    });
});
