// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Hover-state wiring for a movable SplitGutter's widened hit box: gating on
// movable/opaque, and the boundary-vs-descendant distinction onMouseOver /
// onMouseOut use to decide a real leave/enter from an internal move onto the
// gutter's own chevron child.
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

describe('SplitGutter hover state', () => {
    afterEach(() => DOM.reset());

    it('sets .hover on mouseover when movable and not opaque', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);

        gutter.onMouseOver({ relatedTarget: null } as MouseEvent);

        expect(gutter.isStyleState('.hover')).toBe(true);
    });

    it('leaves .hover false on mouseover while locked (setMovable(false))', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);
        gutter.setMovable(false);

        gutter.onMouseOver({ relatedTarget: null } as MouseEvent);

        expect(gutter.isStyleState('.hover')).toBe(false);
    });

    it('leaves .hover false on mouseover while opaque (collapsed strip)', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);
        gutter.setOpaque(true);

        gutter.onMouseOver({ relatedTarget: null } as MouseEvent);

        expect(gutter.isStyleState('.hover')).toBe(false);
    });

    it('ignores a mouseout onto its own chevron child, staying hovered', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const gutterHandle = gutter.getElement(true)!;
        const chevronHandle = (gutter as unknown as { _collapseButton: { getElement: (create?: boolean) => Handle } })
            ._collapseButton.getElement(true);

        gutter.onMouseOver({ relatedTarget: null } as MouseEvent);
        expect(gutter.isStyleState('.hover')).toBe(true);

        const moveToChevron = makeEvent(gutterHandle, 'mouseout', { relatedTarget: chevronHandle });
        gutter.onMouseOut(moveToChevron as unknown as MouseEvent);

        expect(gutter.isStyleState('.hover')).toBe(true);
    });

    it('clears .hover on mouseout to outside the gutter', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);

        gutter.onMouseOver({ relatedTarget: null } as MouseEvent);
        expect(gutter.isStyleState('.hover')).toBe(true);

        gutter.onMouseOut({ relatedTarget: null } as MouseEvent);

        expect(gutter.isStyleState('.hover')).toBe(false);
    });

    it('clears .hover when locked mid-hover — a stationary cursor fires no mouseout to do it', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);

        gutter.onMouseOver({ relatedTarget: null } as MouseEvent);
        expect(gutter.isStyleState('.hover')).toBe(true);

        gutter.setMovable(false);

        expect(gutter.isStyleState('.hover')).toBe(false);
    });

    // Bug: `beginPointerDrag` (PointerDrag.ts) suppresses pointer events on
    // every <body> descendant for the duration of a drag — including the
    // gutter itself, since it lives under <body> like everything else in the
    // app. That takes the gutter out of hit-testing, so the browser fires a
    // real mouseout on it (hit-testing falls through to <html>, which is what
    // holds the drag cursor) the instant the drag starts — clearing `.hover`
    // immediately instead of letting it persist for the drag, as intended.
    it('turns the hover wash on for a drag even with no prior real hover', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);

        gutter.onDragStart({ clientX: 10 } as MouseEvent);

        expect(gutter.isStyleState('.hover')).toBe(true);

        gutter.onDragStop();
    });

    it('keeps the hover wash on through the mouseout beginPointerDrag\'s suppression fires mid-drag', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);

        gutter.onMouseOver({ relatedTarget: null } as MouseEvent);
        expect(gutter.isStyleState('.hover')).toBe(true);

        gutter.onDragStart({ clientX: 10 } as MouseEvent);

        // The suppression-triggered mouseout: relatedTarget is <html>, which
        // is outside the gutter's own element, so this is indistinguishable
        // from a genuine leave from the gutter's own perspective.
        gutter.onMouseOut({ relatedTarget: null } as MouseEvent);

        expect(gutter.isStyleState('.hover')).toBe(true);

        gutter.onDragStop();

        // Mirrors Scrollbar's `_onDragEnd`: the wash drops once the drag ends
        // unless the pointer is still (really) hovering — which, per the
        // mouseout above, it currently is not.
        expect(gutter.isStyleState('.hover')).toBe(false);
    });
});
