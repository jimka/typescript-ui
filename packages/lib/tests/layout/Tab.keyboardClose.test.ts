// tab-and-dialog-key-routing plan, Expected Behaviour "Delete": pressing
// Delete on a focused closeable tab drives the same close the ✕ does, through
// the strip's `"tabclose"` emit and `Tab`'s own handler, and focus ends up on a
// surviving cell's tab button rather than on the ✕ that `RovingTabIndex.remove`
// transiently lands it on.
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab } from '~/layout/Tab';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { TabBar } from '~/component/container/TabBar';
import { TabButton } from '~/component/button/TabButton';
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

/** A Tab-managed strip, sized and rendered so tab cells materialise on doLayout. */
function hostTab(): { host: Container; tab: Tab } {
    const tab  = new Tab();
    const host = new Container({ layoutManager: tab });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);
    host.clearInsets();

    return { host, tab };
}

/** Reaches TabBar's private `_entries`, the same private surface Tab.closeDisposal.test.ts casts through. */
function barEntries(tab: Tab): Array<{ id: string; button: TabButton }> {
    return (tabBar(tab) as unknown as { _entries: Array<{ id: string; button: TabButton }> })._entries;
}

/** Reaches the Tab layout's private strip. */
function tabBar(tab: Tab): TabBar {
    return (tab as unknown as { _bar: TabBar })._bar;
}

/** A `closeable: true` constraints object. */
function closeable(): LayoutConstraints {
    const c = new LayoutConstraints();

    c.closeable = true;

    return c;
}

/** A three-child closeable `Tab`, laid out so the strip holds three real cells. */
function threeCloseableTabs(): { host: Container; tab: Tab } {
    const { host, tab } = hostTab();

    for (let i = 0; i < 3; i++) {
        host.addComponent(new Component({}), closeable());
    }

    host.flushLayout();

    return { host, tab };
}

afterEach(() => DOM.reset());

describe('Tab — Delete on a focused tab closes it', () => {
    it('removes the focused active cell from the strip', () => {
        installTestDOM(CONFIG);

        const { tab } = threeCloseableTabs();
        const bar     = tabBar(tab);
        const closed  = bar.getActiveEntryId()!;

        barEntries(tab).find(entry => entry.id === closed)!.button.focus();

        (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        expect(bar.getEntryIds()).toHaveLength(2);
        expect(bar.getEntryIds()).not.toContain(closed);
    });

    // Deliberately the MIDDLE cell. `RovingTabIndex.remove` activates the
    // member before the one it removed, and `Math.max(0, idx - 1)` clamps back
    // onto a tab button for cell 0 whatever is interleaved — so closing the
    // first cell cannot see a ✕ land in the active slot, and an assertion made
    // there would hold however the group is composed.
    it('leaves focus on a surviving cell\'s tab button, never on a ✕', () => {
        installTestDOM(CONFIG);

        const { tab } = threeCloseableTabs();
        const bar     = tabBar(tab);
        const closed  = bar.getEntryIds()[1];

        bar.setActiveEntry(closed);
        barEntries(tab).find(entry => entry.id === closed)!.button.focus();

        (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        // Scoped to the cells that outlived the close: focus resting on the
        // closed cell's own button would satisfy a bare "is a tab button"
        // check while proving nothing.
        const active    = DOM.source.getActiveElement();
        const survivors = barEntries(tab).filter(entry => entry.id !== closed);

        expect(survivors.map(entry => entry.button.getElement())).toContain(active);
        expect(survivors.map(entry => entry.button.getCloseButton()?.getElement() ?? null)).not.toContain(active);
    });
});
