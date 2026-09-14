// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for `Component.captureSubtreeScroll()` / `restoreSubtreeScroll()` —
 * the subtree scroll-preserving walk `Tab` and `Card` run around undisplaying
 * an inactive page (plan undisplay-inactive-tab-pages.md). Case numbers below
 * refer to that plan's `## Expected Behaviour` list (24-26); cases 1-23 are
 * exercised through `Tab`/`Card`/`Panel`/`CodeEditor`'s own test files, since
 * those need a real layout host to observe the capture/restore pairing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Points its scroll at a separate inner element, like Panel's overlay scroller or CodeEditor's `.cm-scroller`. */
class InnerScrollHost extends Component {
    innerHandle: Handle | null = null;

    protected getScrollElement(): Handle | undefined {
        return this.innerHandle ?? super.getScrollElement();
    }
}

describe('Component.captureSubtreeScroll / restoreSubtreeScroll', () => {
    it('captureSubtreeScroll visits a node whose getScrollElement() differs from its own element, even with a non-scrollable own overflow (case 24)', () => {
        const host = new InnerScrollHost({});
        host.getElement(true);
        host.innerHandle = DOM.sink.createElement('div');

        // The host's own overflow is left at its default (not scrollable) —
        // ownsNativeScroll() must still return true, because it is decided by
        // getScrollElement() resolving to a different element than the host's
        // own, not by the host's own overflow.
        const spy = vi.spyOn(host, 'syncScrollOffsets');

        host.captureSubtreeScroll();

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('restoreSubtreeScroll writes nothing for a node whose cached offsets are both zero (case 25)', () => {
        const scrollable = new Component({ overflow: 'auto' });
        scrollable.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const before = sink.writes.length;

        scrollable.restoreSubtreeScroll();

        const scrollWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && (w.args[1] as { scrollLeft?: number; scrollTop?: number }).scrollLeft !== undefined
        );

        expect(scrollWrite).toBe(false);
    });

    it('both walks are safe on a subtree whose components have never rendered — no throw, no writes (case 26)', () => {
        const root = new Component({});
        const mid  = new Component({});
        const leaf = new Component({ overflow: 'auto' });

        root.addComponent(mid);
        mid.addComponent(leaf);

        const sink = DOM.sink as RecordingDOMSink;
        const before = sink.writes.length;

        expect(() => root.captureSubtreeScroll()).not.toThrow();
        expect(() => root.restoreSubtreeScroll()).not.toThrow();

        expect(sink.writes.slice(before)).toEqual([]);
    });

    // Audit regression: an already-undisplayed descendant (e.g. an inactive
    // page of a nested Tab/Card) has no boxes, so a live read against it
    // returns zero and would silently clobber the cache its own, earlier
    // capture already holds correctly. The walk must skip such a node —
    // and everything under it — entirely, not just decline to write.
    it('captureSubtreeScroll does not read (and so cannot clobber) an already-undisplayed descendant', () => {
        const root = new Component({});
        const alreadyHidden = new Component({ overflow: 'auto' });

        root.addComponent(alreadyHidden);
        root.getElement(true);
        alreadyHidden.getElement(true);
        alreadyHidden.setDisplayed(false);

        const spy = vi.spyOn(alreadyHidden, 'syncScrollOffsets');

        root.captureSubtreeScroll();

        expect(spy).not.toHaveBeenCalled();
    });

    it('restoreSubtreeScroll writes nothing onto an already-undisplayed descendant', () => {
        const root = new Component({});
        const alreadyHidden = new Component({ overflow: 'auto' });

        root.addComponent(alreadyHidden);
        root.getElement(true);
        alreadyHidden.getElement(true);

        // A non-zero cached offset, set while still displayed, so the write
        // reapplyCachedScroll would otherwise perform is not skipped by its
        // own zero-offset guard — this is what makes the assertion below
        // meaningful rather than vacuous.
        alreadyHidden.setScrollTop(40);
        const hiddenElement = alreadyHidden.getElement()!;

        alreadyHidden.setDisplayed(false);

        const sink = DOM.sink as RecordingDOMSink;
        const before = sink.writes.length;

        root.restoreSubtreeScroll();

        const scrollWrite = sink.writes.slice(before).some(w =>
            w.op === 'apply' && w.args[0] === hiddenElement
            && (w.args[1] as { scrollLeft?: number; scrollTop?: number }).scrollLeft !== undefined
        );

        expect(scrollWrite).toBe(false);
    });
});
