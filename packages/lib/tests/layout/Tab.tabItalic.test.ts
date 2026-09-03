// Pins Tab.setTabItalic / isTabItalic — the runtime label-italics API
// plans/in-progress/tab-label-styling.md adds alongside the existing setTabGlyph.
// Modelled on Tab.tabGlyph.test.ts: same CONFIG, same hostTab() helper, same
// private-field reach for `_bar._entries`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab, TabOptions } from '~/layout/Tab';
import { TabBar } from '~/component/container/TabBar';
import { TabButton } from '~/component/button/TabButton';
import { AbstractWindow } from '~/overlay/AbstractWindow';
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
function hostTab(options?: TabOptions): { host: Container; tab: Tab } {
    const tab  = new Tab(options);
    const host = new Container({ layoutManager: tab });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);
    host.clearInsets();

    return { host, tab };
}

/** Reaches TabBar's private `_entries`, the same private surface Tab.closeDisposal.test.ts casts through. */
function barEntries(tab: Tab): Array<{ id: string; button: TabButton; name: string }> {
    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return (bar as unknown as { _entries: Array<{ id: string; button: TabButton; name: string }> })._entries;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    DOM.reset();
});

describe('Tab label italics', () => {
    it('13 — setTabItalic italicises a tab\'s label', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.setTabItalic(content, true)).toBe(true);
        expect(tab.isTabItalic(content)).toBe(true);
    });

    it('14 — setTabItalic(content, false) restores the label upright', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        tab.setTabItalic(content, true);

        expect(tab.setTabItalic(content, false)).toBe(true);
        expect(tab.isTabItalic(content)).toBe(false);
    });

    it('15 — setTabItalic on a component never added to the strip is a no-op', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content    = new Component({});
        const neverAdded = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.setTabItalic(neverAdded, true)).toBe(false);
        expect(tab.isTabItalic(neverAdded)).toBe(false);
        expect(barEntries(tab)[0].button.getFontStyle()).toBe('normal');
    });

    it('16 — setTabItalic marks the owning container\'s layout dirty', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(host.isLayoutDirty()).toBe(false);

        tab.setTabItalic(content, true);

        expect(host.isLayoutDirty()).toBe(true);
    });

    it('17 — setTabItalic leaves the tab\'s LayoutConstraints untouched', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.getLayoutConstraints(content)).toBeUndefined();

        tab.setTabItalic(content, true);

        expect(tab.getLayoutConstraints(content)).toBeUndefined();
    });

    it('18 — setTabName after setTabItalic keeps the tab italic', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        tab.setTabItalic(content, true);
        tab.setTabName(content, 'Renamed');

        expect(tab.isTabItalic(content)).toBe(true);
        expect(barEntries(tab)[0].name).toBe('Renamed');
    });
});
