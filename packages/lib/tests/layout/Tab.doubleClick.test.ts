// Pins Tab's "tabdblclick" event: TabBar resolves a DOM dblclick to the cell
// it landed on and emits "tabdblclick"(id); Tab resolves that id against its
// own content records and re-emits the public "tabdblclick"(content, index).
// Modelled on Tab.renameAndVeto.test.ts: same installTestDOM(CONFIG) setup,
// same hostTab() / barEntries() helpers, same private-field reach for `_bar`.
// Driving a private `dblclick` handler with a synthesized event mirrors
// Window.headerMoveTrigger.test.ts.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab, TabOptions } from '~/layout/Tab';
import { TabBar } from '~/component/container/TabBar';
import { TabButton } from '~/component/button/TabButton';
import { TabCloseButton } from '~/component/button/TabCloseButton';
import { Button } from '~/component/button/Button';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
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

/** Reaches TabBar's private `_entries`, widened to expose the close button a closeable cell builds. */
function barEntries(tab: Tab): Array<{ id: string; button: TabButton; closeButton?: TabCloseButton; name: string }> {
    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return (bar as unknown as {
        _entries: Array<{ id: string; button: TabButton; closeButton?: TabCloseButton; name: string }>;
    })._entries;
}

/** Reaches `tab`'s private `_bar`. */
function bar(tab: Tab): TabBar {
    return (tab as unknown as { _bar: TabBar })._bar;
}

/** Drives the bar's private `onTabDoubleClick` with a synthesized `dblclick` targeting `target`. */
function driveBarDoubleClick(tab: Tab, target: Handle): void {
    (bar(tab) as unknown as { onTabDoubleClick(e: MouseEvent): void })
        .onTabDoubleClick(makeEvent(target, 'dblclick') as unknown as MouseEvent);
}

afterEach(() => DOM.reset());

describe('Tab "tabdblclick"', () => {
    it('1 — a double-click on a tab button emits the event with that tab\'s content and index', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const first  = new Component({});
        const second = new Component({});

        host.addComponent(first);
        host.addComponent(second);
        host.doLayout();

        const tabdblclick = vi.fn();

        tab.on('tabdblclick', tabdblclick);

        driveBarDoubleClick(tab, barEntries(tab)[1].button.getElement(true)!);

        expect(tabdblclick).toHaveBeenCalledTimes(1);
        expect(tabdblclick).toHaveBeenCalledWith(second, 1);
    });

    it('2 — a double-click on a descendant of the tab button resolves to the same tab', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content, { closeable: true });
        host.doLayout();

        const tabdblclick = vi.fn();

        tab.on('tabdblclick', tabdblclick);

        driveBarDoubleClick(tab, barEntries(tab)[0].closeButton!.getElement(true)!);

        expect(tabdblclick).toHaveBeenCalledTimes(1);
        expect(tabdblclick).toHaveBeenCalledWith(content, 0);
    });

    it('3 — a double-click on the strip\'s blank area emits nothing', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        const tabdblclick = vi.fn();

        tab.on('tabdblclick', tabdblclick);

        driveBarDoubleClick(tab, bar(tab).getElement(true)!);

        expect(tabdblclick).not.toHaveBeenCalled();
    });

    it('4 — a double-click on the strip\'s tool group emits nothing', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});
        const tool = new Button({ text: 'Tool' });

        host.addComponent(content);
        tab.addTool(tool);
        host.doLayout();

        const tabdblclick = vi.fn();

        tab.on('tabdblclick', tabdblclick);

        driveBarDoubleClick(tab, tool.getElement(true)!);

        expect(tabdblclick).not.toHaveBeenCalled();
    });

    it('5 — a lazy tab whose content has not been built emits nothing', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const eager = new Component({});
        const factory = vi.fn(() => new Component({}));

        host.addComponent(eager);
        tab.addLazyTab(factory, 'Later');
        host.doLayout();

        const tabdblclick = vi.fn();

        tab.on('tabdblclick', tabdblclick);

        driveBarDoubleClick(tab, barEntries(tab)[1].button.getElement(true)!);

        expect(tabdblclick).not.toHaveBeenCalled();
        expect(factory).not.toHaveBeenCalled();
    });

    it('6 — a reordered strip reports the new index', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const first  = new Component({});
        const second = new Component({});

        host.addComponent(first);
        host.addComponent(second);
        host.doLayout();

        const firstId = barEntries(tab)[0].id;

        bar(tab).moveBarEntry(firstId, 1);
        (tab as unknown as { _onBarReordered(fromId: string, toIndex: number): void })
            ._onBarReordered(firstId, 1);

        const tabdblclick = vi.fn();

        tab.on('tabdblclick', tabdblclick);

        const movedEntry = barEntries(tab).find(entry => entry.id === firstId)!;

        driveBarDoubleClick(tab, movedEntry.button.getElement(true)!);

        expect(tabdblclick).toHaveBeenCalledTimes(1);
        expect(tabdblclick).toHaveBeenCalledWith(first, 1);
    });
});
