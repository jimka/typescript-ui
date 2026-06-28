// Covers the panel-lifecycle additions to Tab: the public `closeTab(content)`
// programmatic-close entry point (sharing the user-✕ teardown via the extracted
// `closeEntry`) and the new `"activated"` event fired from the active-tab-change
// path. Scopes to the offline state surface the same way Tab.test.ts does — no
// materialised element, no layout pass — relying on createTab/setActiveTabIndex/
// closeTab resolving their state synchronously under the recording sink.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab } from '~/layout/Tab';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function hostTab(): { host: Container; tab: Tab; a: Component; b: Component } {
    const tab  = new Tab();
    const host = new Container({ layoutManager: tab });
    const a    = new Component({});
    const b    = new Component({});

    host.addComponent(a);
    host.addComponent(b);

    tab.createTab(a);
    tab.createTab(b);

    return { host, tab, a, b };
}

describe('Tab.closeTab', () => {
    afterEach(() => DOM.reset());

    it('closes the tab hosting the given content and returns true', () => {
        installTestDOM(CONFIG);

        const { host, tab, a } = hostTab();

        const ok = tab.closeTab(a);

        expect(ok).toBe(true);
        // Closing the first of two tabs leaves one component in the container.
        expect(host.getComponents()).not.toContain(a);
    });

    it('emits "tabclose" with the removed content', () => {
        installTestDOM(CONFIG);

        const { tab, a } = hostTab();
        const closed: Component[] = [];

        tab.on('tabclose', c => closed.push(c));
        tab.closeTab(a);

        expect(closed).toEqual([a]);
    });

    it('returns false when no tab hosts the content', () => {
        installTestDOM(CONFIG);

        const { tab } = hostTab();
        const stranger = new Component({});
        const spy = vi.fn();

        tab.on('tabclose', spy);

        expect(tab.closeTab(stranger)).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('Tab "activated" event', () => {
    afterEach(() => DOM.reset());

    it('fires once on setActiveTabIndex with (content, index)', () => {
        installTestDOM(CONFIG);

        const { tab, b } = hostTab();
        const events: Array<[Component, number]> = [];

        tab.on('activated', (content, index) => events.push([content, index]));
        tab.setActiveTabIndex(1);

        expect(events).toEqual([[b, 1]]);
    });

    it('does not fire on the post-close setActiveVisual re-selection', () => {
        installTestDOM(CONFIG);

        const { tab, a } = hostTab();

        // Make the closing tab the active one so selectNextContent runs its
        // setActiveVisual re-selection of the surviving sibling.
        tab.setActiveTabIndex(0);

        const spy = vi.fn();

        tab.on('activated', spy);
        tab.closeTab(a);

        // The re-selection of the survivor goes through setActiveVisual, which
        // must NOT route through _onBarTabPressed / emit "activated".
        expect(spy).not.toHaveBeenCalled();
    });
});
