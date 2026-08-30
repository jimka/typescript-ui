// Pins Tab.setTabName (a live tab rename) and the "beforetabclose" veto — the
// two library additions plans/in-progress/code-editor-desktop-app.md needs
// before the desktop editor app can label a dirty tab and guard a tab close
// on unsaved changes. Modelled on Tab.closeDisposal.test.ts: same
// installTestDOM(CONFIG) setup, same hostTab() helper, same private-field
// reach for `_bar._entries`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab, TabCloseController } from '~/layout/Tab';
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
function barEntries(tab: Tab): Array<{ id: string; button: TabButton; name: string }> {
    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return (bar as unknown as { _entries: Array<{ id: string; button: TabButton; name: string }> })._entries;
}

/** Reaches Tab's private `_onBarTabClose`, the handler the ✕ and the context menu both reach. */
function driveBarClose(tab: Tab, id: string): void {
    (tab as unknown as { _onBarTabClose(id: string): void })._onBarTabClose(id);
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Tab rename and close veto', () => {
    it('1 — rename updates the strip', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.setTabName(content, 'renamed')).toBe(true);

        expect(tab.getActiveTabLabel()).toBe('renamed');
        expect(barEntries(tab)[0].button.getText()).toBe('renamed');
    });

    it('2 — rename on an unknown component is a no-op', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content    = new Component({});
        const neverAdded = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.setTabName(neverAdded, 'x')).toBe(false);
        expect(barEntries(tab)[0].name).not.toBe('x');
    });

    it('3 — a veto keeps the tab', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        const tabclose = vi.fn();

        tab.on('tabclose', tabclose);
        tab.on('beforetabclose', (_c: Component, controller: TabCloseController) => {
            controller.preventDefault();
        });

        const id = barEntries(tab)[0].id;

        driveBarClose(tab, id);

        expect(content.getParentComponent()).toBe(host);
        expect(barEntries(tab).some(e => e.id === id)).toBe(true);
        expect(tabclose).not.toHaveBeenCalled();
    });

    it('4 — no veto closes normally', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        const tabclose = vi.fn();

        tab.on('tabclose', tabclose);
        tab.on('beforetabclose', () => { /* no veto */ });

        const id = barEntries(tab)[0].id;

        driveBarClose(tab, id);

        expect(barEntries(tab).some(e => e.id === id)).toBe(false);
        expect(tabclose).toHaveBeenCalledTimes(1);
    });

    it('5 — closeTab is unguarded', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        const tabclose = vi.fn();

        tab.on('tabclose', tabclose);
        tab.on('beforetabclose', (_c: Component, controller: TabCloseController) => {
            controller.preventDefault();
        });

        expect(tab.closeTab(content)).toBe(true);
        expect(tabclose).toHaveBeenCalledTimes(1);
    });
});
