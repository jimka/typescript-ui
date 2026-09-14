// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for undisplay-inactive-tab-pages.md: `Card` now undisplays (CSS
 * `display: none`) the child it switches away from instead of merely hiding
 * it (`visibility: hidden`), never touches `setVisible`, and defers the
 * scroll restore to the `doLayout` pass that follows a switch (via
 * `_pendingScrollRestore`), since `syncVisible` itself runs without a layout
 * pass. Case numbers below refer to the plan's `## Expected Behaviour` list
 * (11-15).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Card } from '~/layout/Card';
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

function hostCard(width: number, height: number, card: Card): Container {
    const host = new Container({ layoutManager: card });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

afterEach(() => DOM.reset());

describe('Card.setVisibleComponentId undisplays instead of hiding (case 11)', () => {
    it('leaves the resolved child displayed and the other undisplayed, with isVisible() null on both', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const host = hostCard(200, 150, card);
        const a = new Component({ preferredSize: { width: 10, height: 10 } });
        const b = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(a);
        host.addComponent(b);

        card.setVisibleComponentId(b.getId());

        expect(b.isDisplayed()).toBe(true);
        expect(a.isDisplayed()).toBe(false);
        expect(a.isVisible()).toBeNull();
        expect(b.isVisible()).toBeNull();
    });
});

describe('The first syncVisible undisplays every non-resolved child (case 12)', () => {
    it('undisplays a non-resolved sibling even when no visibleComponentId was set', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const host = hostCard(200, 150, card);
        const a = new Component({ preferredSize: { width: 10, height: 10 } });
        const b = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(a);
        host.addComponent(b);

        // No setVisibleComponentId call: getVisibleComponent() triggers the
        // first syncVisible, which falls through to the first child (a).
        expect(card.getVisibleComponent()).toBe(a);
        expect(a.isDisplayed()).toBe(true);
        expect(b.isDisplayed()).toBe(false);
    });
});

describe("A switched-away child's scroll offset survives to the next layout (case 13)", () => {
    it("restores a scrolled Panel child's offset on the layout pass following a switch back", () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const host = hostCard(200, 150, card);
        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const other = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(panel);
        host.addComponent(other);

        card.setVisibleComponentId(panel.getId());
        host.doLayout();

        panel.setScrollTop(40);
        expect(panel.getScrollTop()).toBe(40);

        card.setVisibleComponentId(other.getId());
        host.doLayout(); // switches away — captures then undisplays the panel

        expect(panel.isDisplayed()).toBe(false);

        const panelEl = panel.getElement()!;

        // Simulate the browser dropping the native offset once display: none
        // removed the subtree's boxes.
        DOM.sink.apply(panelEl, { scrollTop: 0 });

        const sink = DOM.sink as RecordingDOMSink;
        const before = sink.writes.length;

        card.setVisibleComponentId(panel.getId());
        host.doLayout(); // switches back — restores after placeComponent relays out

        expect(panel.getScrollTop()).toBe(40);

        const restoreWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && w.args[0] === panelEl
            && (w.args[1] as { scrollTop?: number }).scrollTop === 40
        );
        expect(restoreWrite).toBe(true);
    });
});

describe("The capture guard checks effective visibility, not just the child's own displayed flag", () => {
    // Audit regression: a child's own isDisplayed() stays true when an
    // ancestor entirely outside this Card's own management is what actually
    // has no boxes. Guarding the capture on the child's own isDisplayed()
    // alone would still perform a live read against a boxless element and
    // clobber its cached offset.
    it("does not read a child's live scroll when this Card's own container sits inside an externally undisplayed ancestor", () => {
        installTestDOM(CONFIG);

        const outer = new Component({});
        outer.getElement(true);

        const card = new Card();
        const host = hostCard(200, 150, card);
        outer.addComponent(host);

        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        const other = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(panel);
        host.addComponent(other);

        card.setVisibleComponentId(panel.getId());
        host.doLayout();

        panel.setScrollTop(40);

        // Undisplayed from entirely outside Card's own management — panel's
        // own displayed flag is untouched, but it has no boxes.
        outer.setDisplayed(false);
        expect(panel.isDisplayed()).toBe(true);
        expect(panel.isEffectivelyVisible()).toBe(false);

        const syncSpy = vi.spyOn(panel, 'syncScrollOffsets');

        card.setVisibleComponentId(other.getId());

        expect(syncSpy).not.toHaveBeenCalled();
    });
});

describe('Switching twice before a layout restores only the final target once (case 14)', () => {
    it('a -> b -> a before any doLayout restores only a, and a second doLayout restores nothing further', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const host = hostCard(200, 150, card);
        const a = new Component({ preferredSize: { width: 10, height: 10 } });
        const b = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(a);
        host.addComponent(b);

        card.setVisibleComponentId(a.getId());
        host.doLayout();

        card.setVisibleComponentId(b.getId());
        card.setVisibleComponentId(a.getId());

        // `_pendingScrollRestore` is narrow shape access — the field is
        // private framework bookkeeping, not part of the public surface.
        const pending = (card as unknown as { _pendingScrollRestore: Component | null });

        expect(pending._pendingScrollRestore).toBe(a);

        host.doLayout(); // consumes the pending record

        expect(pending._pendingScrollRestore).toBeNull();

        const restoreSpy = vi.spyOn(a, 'restoreSubtreeScroll');

        host.doLayout(); // a second pass — nothing pending, nothing to restore

        expect(restoreSpy).not.toHaveBeenCalled();
    });
});

describe('Size reports are unaffected by the undisplay switch (case 15)', () => {
    it("getPreferredSize/getMinSize/getMaxSize still report the visible child's size plus the container perimeter after a switch", () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const host = hostCard(200, 150, card);
        const a = new Component({
            preferredSize: { width: 120, height: 80 },
            minSize:       { width: 40, height: 20 },
            maxSize:       { width: 200, height: 150 },
        });
        const b = new Component({ preferredSize: { width: 900, height: 900 } });

        host.addComponent(a);
        host.addComponent(b);

        card.setVisibleComponentId(b.getId());
        card.setVisibleComponentId(a.getId());

        expect(card.getPreferredSize()).toEqual({ width: 120, height: 80 });
        expect(card.getMinSize()).toEqual({ width: 40, height: 20 });
        expect(card.getMaxSize()).toEqual({ width: 200, height: 150 });
    });
});
