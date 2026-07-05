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
        wide.setMinSize(500, 10);
        const { tab, host, child } = hostSizedTab(wide);
        tab.setOverflowing(true, true);
        host.doLayout();

        expect(child.getWidth()).toBe(500);
    });
});
