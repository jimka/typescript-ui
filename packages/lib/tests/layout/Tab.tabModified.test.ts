// Pins Tab.setTabModified / isTabModified — the runtime "unsaved changes" dot
// API plans/in-progress/tab-modified-glyph.md adds alongside setTabItalic.
// Modelled on Tab.tabItalic.test.ts: same CONFIG, same hostTab() helper, same
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

/** Reaches TabBar's private `_entries`, the same private surface Tab.tabItalic.test.ts casts through. */
function barEntries(tab: Tab): Array<{ id: string; button: TabButton; name: string }> {
    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return (bar as unknown as { _entries: Array<{ id: string; button: TabButton; name: string }> })._entries;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    DOM.reset();
});

describe('Tab modified indicator', () => {
    it('19 — setTabModified shows the modified dot on a tab\'s content', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.setTabModified(content, true)).toBe(true);
        expect(tab.isTabModified(content)).toBe(true);
    });

    it('20 — setTabModified(content, false) hides the dot again', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        tab.setTabModified(content, true);

        expect(tab.setTabModified(content, false)).toBe(true);
        expect(tab.isTabModified(content)).toBe(false);
    });

    it('21 — setTabModified on a component never added to the strip is a no-op', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content    = new Component({});
        const neverAdded = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.setTabModified(neverAdded, true)).toBe(false);
        expect(tab.isTabModified(neverAdded)).toBe(false);
        expect(barEntries(tab)[0].button.isModified()).toBe(false);
    });

    it('22 — setTabModified marks the owning container\'s layout dirty', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(host.isLayoutDirty()).toBe(false);

        tab.setTabModified(content, true);

        expect(host.isLayoutDirty()).toBe(true);
    });

    it('23 — setTabModified writes the flag back to the stored constraint', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.getLayoutConstraints(content)).toBeUndefined();

        tab.setTabModified(content, true);

        expect(tab.getLayoutConstraints(content)!.modified).toBe(true);
    });

    it('setTabModified on a tab added but not yet laid out still records durably and applies once the cell is created', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content); // no doLayout() yet — no strip cell exists

        expect(tab.setTabModified(content, true)).toBe(true);
        expect(tab.getLayoutConstraints(content)!.modified).toBe(true);

        host.doLayout();

        expect(barEntries(tab)[0].button.isModified()).toBe(true);
    });

    it('isTabModified reads the constraint back before the cell exists', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content); // no doLayout() yet — no strip cell exists

        tab.setTabModified(content, true);

        expect(tab.isTabModified(content)).toBe(true);
    });

    it('24 — setTabName after setTabModified keeps the dot shown', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        tab.setTabModified(content, true);
        tab.setTabName(content, 'Renamed');

        expect(tab.isTabModified(content)).toBe(true);
        expect(barEntries(tab)[0].name).toBe('Renamed');
    });
});
