// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Kept in its own file rather than folded into SplitGutter.hover.test.ts:
// this is the one test in the hover-highlight feature that needs a REAL
// event dispatched through the window-capture path (DOM.sink.dispatchEvent),
// not a direct onMouseOver/onMouseOut method call, so it can actually
// exercise Event.addSubtreeListener's ancestor walk. None of
// SplitGutter.hover.test.ts's (or this feature's other test files')
// SplitGutter instances are ever disposed, so `Event`'s
// `installedListenerTypes` bookkeeping (see Event.ts) — which outlives
// `DOM.reset()` — would otherwise already show "mouseover"/"mouseout" as
// installed against a stale window/sink by the time this test runs,
// silently dropping the dispatch below. See the identical, already-
// documented gotcha in Link.test.ts's file header, and this session's
// ComboBoxDropdownClose.test.ts for the same fix applied to a different
// component.
import { describe, it, expect, afterEach } from 'vitest';
import { SplitGutter } from '~/component/container/SplitGutter';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

// Bug: `Event.addListener` only invokes its handler when a real DOM event's
// exact `target` is the registered element — it does not walk ancestors the
// way native bubbling does. The chevron (`_collapseButton`) is a real
// hit-testable descendant raw-appended into the gutter's element, so a
// mouseout whose target is the chevron itself (the pointer leaving straight
// from the chevron to somewhere outside the whole gutter, without first
// re-crossing the gutter's own background) never reached the gutter's
// `addListener`-registered `onMouseOut` at all, leaving `.hover` stuck on —
// reported live: "hover the gutter, move onto the gutter button, move away
// from the gutter — it locks into a highlighted state."
describe('SplitGutter hover — subtree routing through the chevron', () => {
    it('clears .hover on a real mouseout whose target is the chevron, leaving the gutter entirely', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const gutterHandle = gutter.getElement(true)!;
        const chevronHandle = (gutter as unknown as { _collapseButton: { getElement: (create?: boolean) => Handle } })
            ._collapseButton.getElement(true)!;
        const outsideHandle = DOM.source.getDocumentElement();

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(gutterHandle, 'mouseover'));
        expect(gutter.isStyleState('.hover')).toBe(true);

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(chevronHandle, 'mouseout', { relatedTarget: outsideHandle }));

        expect(gutter.isStyleState('.hover')).toBe(false);
    });
});
