import { describe, it, expect, afterEach, vi } from 'vitest';
import { Popover, PopoverPlacement } from '~/overlay/Popover';
import { LayerManager } from '~/core/LayerManager';
import { Component } from '~/core/Component';
import { DOM, type Rect } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const VP = { width: 1280, height: 800 };

/** Synthetic anchor rect with the DOMRect-style derived edges filled in, so
 *  `resolvePlacement`'s `.bottom` / `.right` reads are valid — the same shape
 *  the production `getElementRect` returns. */
function rect(x: number, y: number, width: number, height: number): Rect {
    return {
        x, y, width, height,
        top:    y,
        left:   x,
        right:  x + width,
        bottom: y + height,
    };
}

/** Bracket-accesses the private `resolvePlacement` with explicit args, the seam
 *  the harness leaves open (synthetic rect bypasses the zero getElementRect). */
function resolve(p: Popover, anchor: Rect, w: number, h: number): PopoverPlacement {
    return (p as any).resolvePlacement(anchor, w, h, VP);
}

describe('Popover.resolvePlacement', () => {
    afterEach(() => DOM.reset());

    it('"auto" picks the side with the most space', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ placement: 'auto' });

        // Anchor near the top-centre: spaceBottom (800 - 100 = 700) dominates
        // spaceTop (80), spaceLeft (620), spaceRight (620). All four sides fit a
        // 100x60 bubble, so the fitting pool is sorted by space and "bottom"
        // (the most room) wins.
        const anchor = rect(620, 80, 40, 20);

        expect(resolve(popover, anchor, 100, 60)).toBe('bottom');
    });

    it('"auto" resolves to "top" when the anchor is pinned to the bottom edge', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ placement: 'auto' });

        // Anchor near the bottom: almost no room below, plenty above.
        const anchor = rect(640, 780, 40, 18);

        expect(resolve(popover, anchor, 100, 60)).toBe('top');
    });

    it('"auto" resolves to "right" when the anchor hugs the left edge', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ placement: 'auto' });

        // Tall anchor against the left edge with little vertical room: the
        // horizontal sides outscore top/bottom, and right has the most room.
        const anchor = rect(0, 380, 30, 40);

        expect(resolve(popover, anchor, 100, 60)).toBe('right');
    });

    it('honours an explicit side that fits', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ placement: 'top' });
        const anchor  = rect(640, 400, 40, 20);

        // Plenty of room above => the requested side is kept.
        expect(resolve(popover, anchor, 100, 60)).toBe('top');
    });

    it('flips an explicit side to its opposite when it overflows and warns', () => {
        installTestDOM(CONFIG);

        const warn   = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const popover = new Popover({ placement: 'top' });

        // Anchor pinned to the top edge: no room above for "top" => flips to
        // "bottom" and logs a warning (contract clause in resolvePlacement).
        const anchor = rect(640, 0, 40, 20);

        expect(resolve(popover, anchor, 100, 60)).toBe('bottom');
        expect(warn).toHaveBeenCalledOnce();

        warn.mockRestore();
    });

    it('falls back to the most-absolute-space side when no side fits', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ placement: 'auto' });

        // A bubble larger than the viewport in both axes fits nowhere, so the
        // fitting pool is empty and the candidate with the most absolute space
        // wins. spaceLeft = anchor.left = 700 is the largest of {top:500,
        // bottom:280, left:700, right:540}, so "left" is returned.
        const anchor = rect(700, 500, 40, 20);

        expect(resolve(popover, anchor, 4000, 4000)).toBe('left');
    });
});

describe('Popover lifecycle / getters', () => {
    afterEach(() => DOM.reset());

    it('isOpen() is false on a fresh popover', () => {
        installTestDOM(CONFIG);

        expect(new Popover().isOpen()).toBe(false);
    });

    it('show() with no anchor warns and stays closed', () => {
        installTestDOM(CONFIG);

        const warn    = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const popover = new Popover();

        popover.show();

        expect(warn).toHaveBeenCalledOnce();
        expect(popover.isOpen()).toBe(false);

        warn.mockRestore();
    });

    it('hide() while closed is a no-op', () => {
        installTestDOM(CONFIG);

        const popover = new Popover();

        expect(() => popover.hide()).not.toThrow();
        expect(popover.isOpen()).toBe(false);
    });

    it('round-trips placement / dismissOn / showArrow', () => {
        installTestDOM(CONFIG);

        const popover = new Popover();

        popover.setPlacement('left');
        expect(popover.getPlacement()).toBe('left');

        popover.setDismissOn('blur');
        expect(popover.getDismissOn()).toBe('blur');

        popover.setShowArrow(false);
        expect(popover.isShowArrow()).toBe(false);
    });

    it('round-trips title (set / get / clear) and body', () => {
        installTestDOM(CONFIG);

        const popover = new Popover();

        expect(popover.getTitle()).toBeNull();

        popover.setTitle('Hello');
        expect(popover.getTitle()).toBe('Hello');

        popover.clearTitle();
        expect(popover.getTitle()).toBeNull();

        popover.setBody('Body text');
        expect(popover.getBody()).not.toBeNull();
    });

    it('reflects the placement option supplied at construction', () => {
        installTestDOM(CONFIG);

        expect(new Popover({ placement: 'right' }).getPlacement()).toBe('right');
        // Default placement is "auto".
        expect(new Popover().getPlacement()).toBe('auto');
    });

    it('getBand() is the Popover band', () => {
        installTestDOM(CONFIG);

        expect(new Popover().getBand()).toBe(LayerManager.Band.Popover);
    });

    it('getDismissMode() maps 1:1 onto the configured dismissOn', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ dismissOn: 'manual' });

        // The public PopoverDismissMode union maps directly onto LayerDismissMode.
        expect(popover.getDismissMode()).toBe('manual');

        popover.setDismissOn('click-outside');
        expect(popover.getDismissMode()).toBe('click-outside');
    });
});

describe('Popover re-measures while open', () => {
    afterEach(() => DOM.reset());

    /** Mounts a bare anchor handle at a fixed rect directly under the document
     *  root — mirrors how `LayerManager.mount` itself portals a shown surface,
     *  without needing a full component tree just to give the popover
     *  something non-zero to anchor against. */
    function mountAnchor(): ReturnType<typeof DOM.sink.createElement> {
        const anchor = DOM.sink.createElement('div');

        DOM.sink.apply(anchor, { style: { left: '100px', top: '100px', width: '40px', height: '20px' } });
        DOM.sink.appendChild(DOM.source.getDocumentElement(), anchor);

        return anchor;
    }

    it('setBody while open grows the popover to the new body\'s preferred size', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ placement: 'bottom' });

        // Bracket-access the private attach seam (mirrors this file's existing
        // resolvePlacement idiom above) rather than attachToComponent, which
        // needs a full Component — a bare mounted handle is enough to give
        // `show()` a non-zero anchor rect to resolve against.
        (popover as any)._attachToElement(mountAnchor());

        popover.setBody(new Component({ preferredSize: { width: 120, height: 20 } }));
        popover.show();

        const openedHeight = popover.getHeight();

        // A taller body than the one shown with: without setBody triggering a
        // reposition, getHeight() would keep reporting the opened height until
        // an unrelated resize/scroll happened to run _reposition() next.
        popover.setBody(new Component({ preferredSize: { width: 120, height: 300 } }));

        expect(popover.getHeight()).toBeGreaterThan(openedHeight);
        expect(popover.getHeight()).toBe(popover.getPreferredSize()!.height);
    });

    it('setBody before the first show() does not reposition (no anchor rect to resolve against yet)', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ placement: 'bottom' });

        (popover as any)._attachToElement(mountAnchor());

        const reposition = vi.spyOn(popover as any, '_reposition');

        popover.setBody(new Component({ preferredSize: { width: 120, height: 20 } }));

        expect(reposition).not.toHaveBeenCalled();

        reposition.mockRestore();
    });

    it('setTitle while open re-measures the popover for the added title row', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ placement: 'bottom' });

        (popover as any)._attachToElement(mountAnchor());

        popover.setBody(new Component({ preferredSize: { width: 120, height: 20 } }));
        popover.show();

        const openedHeight = popover.getHeight();

        popover.setTitle('A title row');

        expect(popover.getHeight()).toBeGreaterThan(openedHeight);
        expect(popover.getHeight()).toBe(popover.getPreferredSize()!.height);
    });
});
