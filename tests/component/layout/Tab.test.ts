// Tab is ~1900 LOC and heavily DOM-coupled; this file scopes to the active-index
// + tab-registration STATE surface that LayoutSerialization.populateContainer
// relies on. Strip geometry is a Non-Goal here.
//
// The host is intentionally NOT given a materialised element / size: createTab
// and setActiveTabIndex resolve their state (registration + clamp) without a
// layout pass, and skipping the element avoids scheduling an rAF layout of the
// Tab's internal strip Panels that would otherwise flush against the production
// DOM after teardown.
import { describe, it, expect, afterEach } from 'vitest';
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
});
