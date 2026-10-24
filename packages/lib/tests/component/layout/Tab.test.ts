// Tab is ~1900 LOC and heavily DOM-coupled; this file scopes to the active-index
// + tab-registration STATE surface that LayoutSerialization.populateContainer
// relies on. Strip geometry is a Non-Goal here.
//
// The host is intentionally NOT given a materialised element / size: createTab
// and setActiveTabIndex resolve their state (registration + clamp) without a
// layout pass, and skipping the element avoids scheduling an rAF layout of the
// Tab's internal strip Panels that would otherwise flush against the production
// DOM after teardown.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab } from '~/layout/Tab';
import { DOM, type Handle } from '~/core/DOM';
import { Button } from '~/component/button/Button';
import { TabButton } from '~/component/button/TabButton';
import { MenuItemConfig } from '~/component/container/MenuItem';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { tabDragRegistry } from '~/overlay/DragManager';
import { installTestDOM, setConnected } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function hostTab(tab: Tab): { host: Container; tab: Tab; a: Component; b: Component } {
    const host = new Container({ layoutManager: tab });
    const a = new Component({});
    const b = new Component({});

    host.addComponent(a);
    host.addComponent(b);

    return { host, tab, a, b };
}

describe('Tab options', () => {
    afterEach(() => DOM.reset());

    it('round-trips reorderable and compact', () => {
        // Under the recording sink so the strip Panels' scheduled rAF stays inert
        // (the recording sink never fires the callback), not the production sink.
        installTestDOM(CONFIG);

        const tab = new Tab({ reorderable: false, compact: true });

        expect(tab.isReorderable()).toBe(false);
        expect(tab.isCompact()).toBe(true);
    });
});

describe('Tab active-index state', () => {
    afterEach(() => DOM.reset());

    it('createTab registers a tab synchronously', () => {
        installTestDOM(CONFIG);

        const tab = new Tab();
        const { a, b } = hostTab(tab);

        tab.createTab(a);
        tab.createTab(b);

        // The active index defaults to a valid tab once tabs exist.
        expect(tab.getActiveTabIndex()).toBe(0);
    });

    it('setActiveTabIndex moves the active tab to a valid index', () => {
        installTestDOM(CONFIG);

        const tab = new Tab();
        const { a, b } = hostTab(tab);

        tab.createTab(a);
        tab.createTab(b);

        tab.setActiveTabIndex(1);

        expect(tab.getActiveTabIndex()).toBe(1);
    });

    it('clamps an over-range index to the last tab', () => {
        installTestDOM(CONFIG);

        const tab = new Tab();
        const { a, b } = hostTab(tab);

        tab.createTab(a);
        tab.createTab(b);

        tab.setActiveTabIndex(99);

        // Clamp upper bound: [0, tabCount - 1] = [0, 1].
        expect(tab.getActiveTabIndex()).toBe(1);
    });

    it('clamps an under-range (negative) index to the first tab', () => {
        installTestDOM(CONFIG);

        const tab = new Tab();
        const { a, b } = hostTab(tab);

        tab.createTab(a);
        tab.createTab(b);

        tab.setActiveTabIndex(1);
        tab.setActiveTabIndex(-5);

        expect(tab.getActiveTabIndex()).toBe(0);
    });

    // dock-reveal-panel-without-focus plan, cases T1–T8: a tab change made
    // from code leaves keyboard focus where it is unless the strip holds it,
    // nothing holds it, or it sits inside the content the change hides or
    // removes; an explicit `focus` option overrides that rule.
    describe('keyboard focus for a change made from code', () => {
        interface TabProbe {
            _contents: Array<{ id: string; component: Component | null }>;
            _bar:      { _entries: Array<{ id: string; button: Component }> };
        }

        /** The tab button of the cell hosting `content`. */
        function buttonOf(tab: Tab, content: Component): Component {
            const probe = tab as unknown as TabProbe;
            const id    = probe._contents.find(entry => entry.component === content)!.id;

            return probe._bar._entries.find(entry => entry.id === id)!.button;
        }

        /** A rendered host with tabs `a` (active) and `b`, every button and both contents materialised. */
        function renderedTabs(): { host: Container; tab: Tab; a: Component; b: Component } {
            const built = hostTab(new Tab());

            built.tab.createTab(built.a);
            built.tab.createTab(built.b);
            built.host.getElement(true);

            for (const content of [built.a, built.b]) {
                content.getElement(true);
                buttonOf(built.tab, content).getElement(true);
            }

            return built;
        }

        /** A connected button outside the strip, focused. */
        function focusOutside(): Handle {
            const outside = new Button('Outside').getElement(true)!;

            setConnected(outside, true);
            DOM.sink.focus(outside);

            return outside;
        }

        /** An element appended inside `content`'s element. */
        function elementInside(content: Component): Handle {
            const el = DOM.sink.createElement('button');

            DOM.sink.appendChild(content.getElement(true)!, el);

            return el;
        }

        it('T1: leaves focus on an outside control and still activates the tab', () => {
            installTestDOM(CONFIG);

            const { tab, b } = renderedTabs();
            const outside    = focusOutside();
            const activated  = vi.fn();

            tab.on('activate', activated);
            tab.setActiveTabIndex(1);

            expect(tab.getActiveTabIndex()).toBe(1);
            expect(activated).toHaveBeenCalledWith(b, 1);
            expect(DOM.source.getActiveElement()).toBe(outside);
        });

        it('T2: moves focus onto the new tab when focus is inside the content it hides', () => {
            installTestDOM(CONFIG);

            const { tab, a, b } = renderedTabs();

            DOM.sink.focus(elementInside(a));
            tab.setActiveTabIndex(1);

            expect(DOM.source.getActiveElement()).toBe(buttonOf(tab, b).getElement());
        });

        it('T3: focus: false moves no focus even when nothing holds it', () => {
            installTestDOM(CONFIG);

            const { tab } = renderedTabs();

            tab.setActiveTabIndex(1, { focus: false });

            expect(DOM.source.getActiveElement()).toBeNull();
        });

        it('T4: a deferred setActiveContent applies the rule when the layout pass runs it', () => {
            installTestDOM(CONFIG);

            const { host, tab } = renderedTabs();
            const c             = new Component({});

            host.addComponent(c);
            tab.setActiveContent(c);

            const outside = focusOutside();

            host.doLayout();

            expect(tab.getActiveContent()).toBe(c);
            expect(DOM.source.getActiveElement()).toBe(outside);
        });

        it('T5: closing the tab whose content holds focus moves focus onto the surviving tab', () => {
            installTestDOM(CONFIG);

            const { tab, a, b } = renderedTabs();

            DOM.sink.focus(elementInside(a));
            tab.closeTab(a);

            expect(DOM.source.getActiveElement()).toBe(buttonOf(tab, b).getElement());
        });

        it('T6: closing the active tab from code leaves focus on an outside control', () => {
            installTestDOM(CONFIG);

            const { tab, a, b } = renderedTabs();
            const outside       = focusOutside();

            tab.closeTab(a);

            expect(DOM.source.getActiveElement()).toBe(outside);
            expect(tab.getActiveContent()).toBe(b);
        });

        it('T7: revealDescendant shows the tab without focusing its button', () => {
            installTestDOM(CONFIG);

            const { tab, b } = renderedTabs();
            const target     = elementInside(b);

            tab.revealDescendant(target);

            expect(tab.getVisibleComponent()).toBe(b);
            expect(DOM.source.getActiveElement()).toBeNull();
        });

        it('T8: focus: true moves focus onto the new tab from an outside control', () => {
            installTestDOM(CONFIG);

            const { tab, b } = renderedTabs();

            focusOutside();
            tab.setActiveTabIndex(1, { focus: true });

            expect(DOM.source.getActiveElement()).toBe(buttonOf(tab, b).getElement());
        });

        /** The strip's private surface the strip-close cases drive: its emit, context menu and roving group. */
        interface StripProbe {
            emit(event: string, ...args: unknown[]): void;
            _entries:        Array<{ id: string }>;
            _contextMenu:    { show(x: number, y: number, configs: MenuItemConfig[]): void };
            _rovingTabIndex: { getItems(): Component[]; moveTo(index: number): void };
            openTabMenu(entry: unknown, x: number, y: number): void;
        }

        /** The strip of `tab`, through its private surface. */
        function stripOf(tab: Tab): StripProbe {
            return (tab as unknown as { _bar: StripProbe })._bar;
        }

        /** The cell id of the tab hosting `content`. */
        function idOf(tab: Tab, content: Component): string {
            return (tab as unknown as TabProbe)._contents.find(entry => entry.component === content)!.id;
        }

        /** The ✕ of the tab hosting `content`. */
        function closeOf(tab: Tab, content: Component): Component {
            return (buttonOf(tab, content) as TabButton).getCloseButton()!;
        }

        /** The strip's members that carry `tabindex="0"`: a single tab stop has exactly one. */
        function tabStopsOf(tab: Tab): Component[] {
            return stripOf(tab)._rovingTabIndex.getItems().filter(item => item.getAria().getTabIndex() === 0);
        }

        /** Emits the strip's `"tabclose"` for the tab hosting `content`, as its ✕, `Delete` or the menu's *Close* does. */
        function stripClose(tab: Tab, content: Component): void {
            stripOf(tab).emit('tabclose', idOf(tab, content));
        }

        /**
         * Asserts the strip-close contract: `content`'s tab is the active one,
         * and both keyboard focus and the strip's only tab stop are on its button.
         */
        function expectFocusOnActive(tab: Tab, content: Component): void {
            const button = buttonOf(tab, content);

            expect(tab.getActiveContent()).toBe(content);
            expect(DOM.source.getActiveElement()).toBe(button.getElement());
            expect(tabStopsOf(tab)).toEqual([button]);
        }

        /**
         * A rendered host with tabs `a` (active), `b`, `c` and `d`, every tab
         * button, ✕ and content materialised. Every tab is closeable except
         * those whose index is in `pinned`.
         */
        function renderedCloseableTabs(pinned: number[] = []): { tab: Tab; a: Component; b: Component; c: Component; d: Component } {
            const tab      = new Tab();
            const host     = new Container({ layoutManager: tab });
            const contents = [0, 1, 2, 3].map(() => new Component({}));

            contents.forEach((content, index) => {
                const constraints = new LayoutConstraints();

                constraints.closeable = !pinned.includes(index);
                host.addComponent(content, constraints);
                tab.createTab(content);
            });

            host.getElement(true);

            for (const content of contents) {
                const button = buttonOf(tab, content) as TabButton;

                content.getElement(true);
                button.getElement(true);
                button.getCloseButton()?.getElement(true);
            }

            const [a, b, c, d] = contents;

            return { tab, a, b, c, d };
        }

        /**
         * Runs the bulk-close item `text` from the context menu opened on the
         * tab hosting `clicked`, the same action a click on that row runs.
         */
        function runMenuItem(tab: Tab, clicked: Component, text: string): void {
            const strip = stripOf(tab);
            let configs: MenuItemConfig[] = [];

            strip._contextMenu.show = (_x, _y, built): void => {
                configs = built;
            };
            strip.openTabMenu(strip._entries.find(entry => entry.id === idOf(tab, clicked)), 0, 0);
            configs.find(config => config.text === text)!.action!();
        }

        // A close made on the strip (✕, Delete, the menu's Close and its bulk
        // closes) ends with focus and the tab stop on the active tab, wherever
        // focus was, and never re-announces a tab that was already active.
        it('T11: a strip close of the active tab lands on the tab that becomes active, not where the stop was', () => {
            installTestDOM(CONFIG);

            // `b` is active and the user arrowed onto `d`'s ✕, which holds
            // focus and the tab stop. Safari and Firefox do not focus a button
            // on click, so a click on `b`'s ✕ leaves focus there.
            const { tab, a, b, d } = renderedCloseableTabs();
            const strip            = stripOf(tab);

            tab.setActiveTabIndex(1, { focus: false });
            strip._rovingTabIndex.moveTo(strip._rovingTabIndex.getItems().indexOf(closeOf(tab, d)));

            const announced = vi.fn();

            tab.on('select', announced);
            tab.on('activate', announced);
            stripClose(tab, b);

            expectFocusOnActive(tab, a);
            expect(announced).not.toHaveBeenCalled();
        });

        it('T12: a strip close of a non-active tab lands on the active tab, which stays selected', () => {
            installTestDOM(CONFIG);

            const { tab, a, c } = renderedCloseableTabs();
            const announced     = vi.fn();

            focusOutside();
            tab.on('select', announced);
            tab.on('activate', announced);
            stripClose(tab, c);

            expectFocusOnActive(tab, a);
            expect(announced).not.toHaveBeenCalled();
        });

        it('T13: Close all to the right opened on a non-active tab ends on the active tab', () => {
            installTestDOM(CONFIG);

            const { tab, a, b } = renderedCloseableTabs();

            focusOutside();
            runMenuItem(tab, b, 'Close all to the right');

            expectFocusOnActive(tab, a);
        });

        it('T14: Close all to the left opened on a non-active tab ends on the active tab', () => {
            installTestDOM(CONFIG);

            const { tab, c, d } = renderedCloseableTabs();

            tab.setActiveTabIndex(3, { focus: false });
            focusOutside();
            runMenuItem(tab, c, 'Close all to the left');

            expectFocusOnActive(tab, d);
        });

        it('T15: Close others opened beside a pinned active tab ends on the active tab', () => {
            installTestDOM(CONFIG);

            // `a` has no ✕, so *Close others* on `b` closes only `c` and `d`.
            const { tab, a, b } = renderedCloseableTabs([0]);

            focusOutside();
            runMenuItem(tab, b, 'Close others');

            expectFocusOnActive(tab, a);
        });

        it('T16: a strip close of the active tab after a background close lands on the tab that becomes active', () => {
            installTestDOM(CONFIG);

            const { tab, a, b, c } = renderedCloseableTabs();

            tab.setActiveTabIndex(2, { focus: false });
            focusOutside();
            stripClose(tab, a);
            stripClose(tab, c);

            expectFocusOnActive(tab, b);
        });

        it('T17: a bulk close ends on the active tab when one of its targets vetoes', () => {
            installTestDOM(CONFIG);

            const { tab, a, c } = renderedCloseableTabs();

            tab.on('beforetabclose', (content, controller) => {
                if (content === c) {
                    controller.preventDefault();
                }
            });
            focusOutside();
            runMenuItem(tab, a, 'Close all to the right');

            expect(tab.indexOfContent(c)).toBe(1);
            expectFocusOnActive(tab, a);
        });

        it('T18: a strip close of the focused cell moves focus straight to the active tab, not through a neighbour', () => {
            installTestDOM(CONFIG);

            // `Delete` on `c`'s ✕ (or a click on it in Chrome, which focuses
            // the ✕ on mousedown): the closed cell holds focus.
            const { tab, a, c } = renderedCloseableTabs();
            const strip         = stripOf(tab);

            strip._rovingTabIndex.moveTo(strip._rovingTabIndex.getItems().indexOf(closeOf(tab, c)));

            const focusWrites = vi.spyOn(DOM.sink, 'focus');

            stripClose(tab, c);

            expect(focusWrites.mock.calls.map(call => call[0])).toEqual([buttonOf(tab, a).getElement()]);
            expectFocusOnActive(tab, a);
        });

        it('T9: a deferred setActiveContent keeps an explicit focus option for the layout pass', () => {
            installTestDOM(CONFIG);

            const moved = renderedTabs();
            const c     = new Component({});

            moved.host.addComponent(c);
            moved.tab.setActiveContent(c, { focus: true });
            focusOutside();
            moved.host.doLayout();

            expect(moved.tab.getActiveContent()).toBe(c);
            expect(DOM.source.getActiveElement()).toBe(buttonOf(moved.tab, c).getElement());

            DOM.reset();
            installTestDOM(CONFIG);

            const kept = renderedTabs();
            const d    = new Component({});

            kept.host.addComponent(d);
            kept.tab.setActiveContent(d, { focus: false });
            kept.host.doLayout();

            expect(kept.tab.getActiveContent()).toBe(d);
            expect(DOM.source.getActiveElement()).toBeNull();
        });

        it('T10: a tab dropped onto another strip takes focus from the dragged button its source strip still holds', () => {
            installTestDOM(CONFIG);

            // The drop runs before the source strip drops the dragged button
            // (DragManager runs the target's onDrop, then the source's
            // onDragEnd), so the button is still focused when the target
            // activates the docked tab.
            const target = renderedTabs();
            const source = renderedTabs();

            DOM.sink.focus(buttonOf(source.tab, source.b).getElement()!);
            tabDragRegistry.set(source.b.getId(), source.b);

            const bar = (target.tab as unknown as { _bar: { emit(event: string, ...args: unknown[]): void } })._bar;

            bar.emit('dockrequested', source.b.getId(), 0);

            expect(target.tab.getActiveContent()).toBe(source.b);
            expect(DOM.source.getActiveElement()).toBe(buttonOf(target.tab, source.b).getElement());
        });
    });
});

describe('Tab content-area overflow inflation', () => {
    afterEach(() => DOM.reset());

    // A sized, materialised host so doLayout produces real content-area
    // geometry. Under the recording sink the strip Panels' scheduled rAF stays
    // inert. The default "north" strip keeps the content width equal to the
    // host inner width, so X-axis inflation is observable directly on the
    // visible child's committed width.
    function hostSizedTab(child: Component): { tab: Tab; host: Container; child: Component } {
        const tab = new Tab();
        const host = new Container({ layoutManager: tab });

        host.getElement(true);
        host.setWidth(200);
        host.setHeight(150);
        host.clearInsets();
        host.addComponent(child);

        return { tab, host, child };
    }

    it('does not inflate the content area when the visible child reports no min', () => {
        installTestDOM(CONFIG);

        // No setMinSize → getMinSize() is null → computeTotalMinSize is {0,0},
        // so Math.max(contentW, 0) is a no-op: the child fills the content area
        // (host inner width, 200) rather than inflating past it.
        const { tab, host, child } = hostSizedTab(new Component({ preferredSize: { width: 50, height: 50 } }));
        tab.setOverflowing(true, true);
        host.doLayout();

        expect(child.getWidth()).toBe(200);
    });

    it('inflates the content area to the visible child min when it exceeds the content width', () => {
        installTestDOM(CONFIG);

        // A child min wider than the 200 content width drives the inflation;
        // the contrast with the null-min case above isolates the no-inflation
        // branch.
        const wide = new Component({ preferredSize: { width: 50, height: 50 } });
        wide.setMinSize({ width: 500, height: 10 });
        const { tab, host, child } = hostSizedTab(wide);
        tab.setOverflowing(true, true);
        host.doLayout();

        expect(child.getWidth()).toBe(500);
    });
});
