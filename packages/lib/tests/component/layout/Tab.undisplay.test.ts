// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for undisplay-inactive-tab-pages.md: `Tab.doLayout` now undisplays
 * (CSS `display: none`) an inactive page instead of merely hiding it
 * (`visibility: hidden`), never touches `setVisible`, skips the page the
 * current pass is about to select in its hide loop, and captures/restores a
 * page's native scroll offsets around the flip. Case numbers below refer to
 * the plan's `## Expected Behaviour` list (1-8).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab } from '~/layout/Tab';
import { Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** Builds a Tab-managed, sized, inset-free host. */
function hostTab(width: number, height: number): { host: Container; tab: Tab } {
    const tab  = new Tab();
    const host = new Container({ layoutManager: tab });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return { host, tab };
}

/** The recorded `apply` writes against `handle` whose patch carries `key`. */
function classWrites(handle: ReturnType<typeof DOM.sink.createElement>, key: 'addClass' | 'removeClass', token: string): number {
    const sink = DOM.sink as RecordingDOMSink;

    return sink.writes.filter(w =>
        w.op === 'apply' && w.args[0] === handle
        && (w.args[1] as Record<string, readonly string[] | undefined>)[key]?.includes(token)
    ).length;
}

describe('Tab.doLayout undisplays inactive pages (case 1)', () => {
    it('displays only the selected page after the first layout, and writes no visibility at all', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab(400, 300);
        const a = new Component({});
        const b = new Component({});
        const c = new Component({});

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        tab.createTab(a);
        tab.createTab(b);
        tab.createTab(c);
        a.getElement(true);
        b.getElement(true);
        c.getElement(true);

        host.doLayout();

        expect(a.isDisplayed()).toBe(true);
        expect(b.isDisplayed()).toBe(false);
        expect(c.isDisplayed()).toBe(false);

        expect(a.isVisible()).toBeNull();
        expect(b.isVisible()).toBeNull();
        expect(c.isVisible()).toBeNull();
    });
});

describe('Tab.doLayout undisplay/redisplay class writes (case 2)', () => {
    it('switching tabs records an undisplayed add on the outgoing page and a remove on the incoming one', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab(400, 300);
        const a = new Component({});
        const b = new Component({});

        host.addComponent(a);
        host.addComponent(b);
        tab.createTab(a);
        tab.createTab(b);

        const aEl = a.getElement(true)!;
        const bEl = b.getElement(true)!;

        host.doLayout(); // a selected, b undisplayed

        tab.setActiveTabIndex(1);
        host.doLayout(); // b selected, a undisplayed

        expect(classWrites(aEl, 'addClass', 'undisplayed')).toBe(1);
        expect(classWrites(bEl, 'removeClass', 'undisplayed')).toBe(1);
    });
});

describe('The page a pass selects is never undisplayed within that pass (case 3)', () => {
    it('the initially-selected page receives no undisplayed add on the first layout pass', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab(400, 300);
        const a = new Component({});
        const b = new Component({});

        host.addComponent(a);
        host.addComponent(b);
        tab.createTab(a);
        tab.createTab(b);

        const aEl = a.getElement(true)!;

        host.doLayout(); // a is selected by this very pass

        expect(classWrites(aEl, 'addClass', 'undisplayed')).toBe(0);
        expect(a.isDisplayed()).toBe(true);
    });
});

describe('Native scroll offsets survive an undisplay/redisplay round trip (case 4)', () => {
    it("restores a scrolled Panel page's offset after switching away and back", () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab(400, 300);
        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const page  = new Component({});
        const other = new Component({});

        page.addComponent(panel);
        host.addComponent(page);
        host.addComponent(other);
        tab.createTab(page);
        tab.createTab(other);

        page.getElement(true);
        other.getElement(true);
        const panelEl = panel.getElement(true)!;

        host.doLayout(); // page selected

        panel.setScrollTop(40);
        expect(panel.getScrollTop()).toBe(40);

        tab.setActiveTabIndex(1);
        host.doLayout(); // switches away — captures then undisplays page's subtree

        expect(page.isDisplayed()).toBe(false);

        // Simulate the browser dropping the native offset once display: none
        // removed the subtree's boxes.
        DOM.sink.apply(panelEl, { scrollTop: 0 });

        const sink = DOM.sink as RecordingDOMSink;
        const before = sink.writes.length;

        tab.setActiveTabIndex(0);
        host.doLayout(); // switches back — restores after placeComponent relays out

        expect(panel.getScrollTop()).toBe(40);

        const restoreWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && w.args[0] === panelEl
            && (w.args[1] as { scrollTop?: number }).scrollTop === 40
        );
        expect(restoreWrite).toBe(true);
    });
});

describe('The capture walk skips non-scrolling nodes (case 5)', () => {
    it('does not call syncScrollOffsets on a plain child, but calls it once on a scrolling sibling Panel', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab(400, 300);
        const plainChild = new Component({});
        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const page  = new Component({});
        const other = new Component({});

        page.addComponent(plainChild);
        page.addComponent(panel);
        host.addComponent(page);
        host.addComponent(other);
        tab.createTab(page);
        tab.createTab(other);

        page.getElement(true);
        other.getElement(true);
        plainChild.getElement(true);
        panel.getElement(true);

        host.doLayout(); // page selected

        const plainSpy = vi.spyOn(plainChild, 'syncScrollOffsets');
        const panelSpy = vi.spyOn(panel, 'syncScrollOffsets');

        tab.setActiveTabIndex(1);
        host.doLayout(); // switches away — captures page's subtree

        expect(plainSpy).not.toHaveBeenCalled();
        expect(panelSpy).toHaveBeenCalledTimes(1);
    });
});

describe("The capture guard checks effective visibility, not just the page's own displayed flag", () => {
    // Audit regression: a page's own isDisplayed() stays true when an
    // ancestor entirely outside this Tab's own management (e.g. the Dock
    // region this Tab sits in) is what actually has no boxes. Guarding the
    // capture on the page's own isDisplayed() alone would still perform a
    // live read against a boxless element and clobber its cached offset.
    it("does not read a page's live scroll when this Tab's own container sits inside an externally undisplayed ancestor", () => {
        installTestDOM(CONFIG);

        const outer = new Component({});
        outer.getElement(true);

        const { host, tab } = hostTab(400, 300);
        outer.addComponent(host);

        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const page  = new Component({});
        const other = new Component({});

        page.addComponent(panel);
        host.addComponent(page);
        host.addComponent(other);
        tab.createTab(page);
        tab.createTab(other);

        page.getElement(true);
        other.getElement(true);
        panel.getElement(true);

        host.doLayout(); // page selected

        panel.setScrollTop(40);

        // Undisplayed from entirely outside Tab's own management — page's
        // own displayed flag is untouched, but it has no boxes.
        outer.setDisplayed(false);
        expect(page.isDisplayed()).toBe(true);
        expect(page.isEffectivelyVisible()).toBe(false);

        const syncSpy = vi.spyOn(panel, 'syncScrollOffsets');

        tab.setActiveTabIndex(1);
        host.doLayout(); // switches away while externally hidden

        expect(syncSpy).not.toHaveBeenCalled();
    });
});

describe('ARIA is unchanged by the undisplay switch (case 6)', () => {
    it('unselected pages carry aria-hidden=true and the selected page carries aria-hidden=false', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab(400, 300);
        const a = new Component({});
        const b = new Component({});
        const c = new Component({});

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        tab.createTab(a);
        tab.createTab(b);
        tab.createTab(c);
        a.getElement(true);
        b.getElement(true);
        c.getElement(true);

        host.doLayout();

        expect(a.getAria().getHidden()).toBe(false);
        expect(b.getAria().getHidden()).toBe(true);
        expect(c.getAria().getHidden()).toBe(true);
    });
});

describe('Size reports are unaffected by an undisplayed sibling (case 7)', () => {
    it("getPreferredSize/getMinSize/getMaxSize report only the selected page's size plus strip thickness and perimeter", () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab(400, 300);
        const a = new Component({
            preferredSize: { width: 120, height: 80 },
            minSize:       { width: 40, height: 20 },
            maxSize:       { width: 200, height: 150 },
        });
        // b's own reported sizes are wildly different from a's, so a leak
        // from the undisplayed sibling into the composed report would show.
        const b = new Component({
            preferredSize: { width: 900, height: 900 },
            minSize:       { width: 900, height: 900 },
            maxSize:       { width: 900, height: 900 },
        });

        host.addComponent(a);
        host.addComponent(b);
        tab.createTab(a);
        tab.createTab(b);
        a.getElement(true);
        b.getElement(true);

        host.doLayout(); // a selected, b undisplayed

        const preferred = tab.getPreferredSize()!;
        const minimum   = tab.getMinSize()!;
        const maximum   = tab.getMaxSize()!;

        // The insets are cleared and the default strip side (north) occupies
        // the height axis only, so the width report is exactly a's own —
        // b's very different sizes must not leak into it.
        expect(preferred.width).toBe(120);
        expect(minimum.width).toBe(40);
        expect(maximum.width).toBe(200);
    });
});

describe('Tab.revealDescendant displays the revealed page synchronously (case 8)', () => {
    it('selects the non-selected page and leaves it displayed before returning', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab(400, 300);
        const a = new Component({});
        const b = new Component({});

        host.addComponent(a);
        host.addComponent(b);
        tab.createTab(a);
        tab.createTab(b);

        a.getElement(true);
        b.getElement(true);

        host.doLayout(); // a selected

        expect(b.isDisplayed()).toBe(false);

        const target = DOM.sink.createElement('div');
        DOM.sink.appendChild(b.getElement()!, target);

        tab.revealDescendant(target);

        expect(tab.getVisibleComponent()).toBe(b);
        expect(b.isDisplayed()).toBe(true);

        tab.detach();
    });
});
