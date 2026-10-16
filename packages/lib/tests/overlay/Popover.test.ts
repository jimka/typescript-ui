import { describe, it, expect, afterEach, vi } from 'vitest';
import { Popover, PopoverPlacement } from '~/overlay/Popover';
import { LayerManager } from '~/core/LayerManager';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { DOM, type Handle, type Rect } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
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

/** Mounts a bare anchor handle at a fixed non-zero rect directly under the
 *  document root — mirrors how `LayerManager.mount` itself portals a shown
 *  surface, without needing a full component tree just to give the popover
 *  something to anchor against. A zero-size anchor would make `_reposition`
 *  treat it as "removed from the DOM" and immediately `hide()` again (see
 *  `_reposition`'s own comment), so every non-zero-size caller shares this
 *  one helper rather than risking a zero-size ad hoc element. */
function mountAnchor(): ReturnType<typeof DOM.sink.createElement> {
    const anchor = DOM.sink.createElement('div');

    DOM.sink.apply(anchor, { style: { left: '100px', top: '100px', width: '40px', height: '20px' } });
    DOM.sink.appendChild(DOM.source.getDocumentElement(), anchor);

    return anchor;
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

// Mirrors Menu.test.ts's own "requestClose() ... fires its ... onClose"
// coverage: `onClose` fires once whenever the popover closes, whether via an
// explicit `hide()` or the manager's advisory `requestClose()` (the path an
// outside-click dismissal drives — LayerManager calls `requestClose()`
// directly, so invoking it here exercises exactly what a real outside click
// would trigger, without needing a simulated pointerdown).
describe('Popover onClose', () => {
    afterEach(() => DOM.reset());

    it('hide() fires onClose exactly once per open→close transition', () => {
        installTestDOM(CONFIG);

        const onClose = vi.fn();
        const popover = new Popover({ onClose });

        (popover as any)._attachToElement(mountAnchor());
        popover.show();

        popover.hide();
        expect(onClose).toHaveBeenCalledOnce();

        // hide() while already closed is a no-op (the `_isOpen` guard), so a
        // second call must not refire the callback.
        popover.hide();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('requestClose() (the manager\'s outside-click / advisory close path) fires onClose exactly once', () => {
        installTestDOM(CONFIG);

        const onClose = vi.fn();
        const popover = new Popover({ onClose });

        (popover as any)._attachToElement(mountAnchor());
        popover.show();

        popover.requestClose();

        expect(onClose).toHaveBeenCalledOnce();
        expect(popover.isOpen()).toBe(false);
    });

    it('a popover with no onClose configured closes without throwing', () => {
        installTestDOM(CONFIG);

        const popover = new Popover();

        (popover as any)._attachToElement(mountAnchor());
        popover.show();

        expect(() => popover.hide()).not.toThrow();
    });
});

describe('Popover — accessible name', () => {
    afterEach(() => DOM.reset());

    /** The id of the component that shows the popover's title. */
    function titleId(popover: Popover): string {
        return (popover as any)._titleComponent.getId();
    }

    // P1
    it('is named by reference to its title, and stays a dialog', () => {
        installTestDOM(CONFIG);

        const popover = new Popover();

        popover.setTitle('Confirm delete');

        expect(popover.getAria().getLabelledBy()).toBe(titleId(popover));
        expect(popover.getAria().getRole()).toBe('dialog');
        expect(DOM.source.getAttribute(popover.getElement(true)!, 'aria-labelledby')).toBe(titleId(popover));
    });

    // P2
    it('keeps the same reference when the title text changes', () => {
        installTestDOM(CONFIG);

        const popover = new Popover();

        popover.setTitle('Confirm delete');

        const id = titleId(popover);

        popover.setTitle('Really?');

        expect(titleId(popover)).toBe(id);
        expect(popover.getAria().getLabelledBy()).toBe(id);
    });

    // P3
    it('drops the reference when the title is cleared, by either route', () => {
        installTestDOM(CONFIG);

        const cleared = new Popover();
        const nulled  = new Popover();

        cleared.setTitle('Confirm delete');
        cleared.clearTitle();

        nulled.setTitle('Confirm delete');
        nulled.setTitle(null);

        expect(cleared.getAria().getLabelledBy()).toBeNull();
        expect(nulled.getAria().getLabelledBy()).toBeNull();
    });

    it('points at the new title component when a cleared title is set again', () => {
        installTestDOM(CONFIG);

        const popover = new Popover();

        popover.setTitle('Confirm delete');
        popover.clearTitle();
        popover.setTitle('Really?');

        expect(popover.getAria().getLabelledBy()).toBe(titleId(popover));
    });

    // P4
    it('takes its name from a title given at construction, and has none without one', () => {
        installTestDOM(CONFIG);

        const titled   = new Popover({ title: 'T' });
        const untitled = new Popover();

        expect(titled.getAria().getLabelledBy()).toBe(titleId(titled));
        expect(untitled.getAria().getLabelledBy()).toBeNull();
        expect(untitled.getAria().getLabel()).toBeNull();
    });

    it('keeps a name the consumer put in place of the title when the title text changes', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ title: 'T' });

        popover.getAria().clearLabelledBy().setLabel('Mine');
        popover.setTitle('T2');

        expect(popover.getAria().getLabelledBy()).toBeNull();
        expect(popover.getAria().getLabel()).toBe('Mine');
    });

    it('leaves a reference the consumer set alone when the title is cleared', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ title: 'T' });

        popover.getAria().setLabelledBy('heading-of-my-own');
        popover.clearTitle();

        expect(popover.getAria().getLabelledBy()).toBe('heading-of-my-own');
    });

    it('does not point at a new title when the consumer already named the popover', () => {
        installTestDOM(CONFIG);

        const labelled   = new Popover();
        const referenced = new Popover();

        labelled.getAria().setLabel('Row actions');
        labelled.setTitle('T');

        referenced.getAria().setLabelledBy('heading-of-my-own');
        referenced.setTitle('T');

        expect(labelled.getAria().getLabelledBy()).toBeNull();
        expect(labelled.getAria().getLabel()).toBe('Row actions');
        expect(referenced.getAria().getLabelledBy()).toBe('heading-of-my-own');
    });

    it('keeps the consumer\'s name when the title is cleared and set again', () => {
        installTestDOM(CONFIG);

        const popover = new Popover({ title: 'T' });

        popover.getAria().clearLabelledBy().setLabel('Mine');
        popover.clearTitle();
        popover.setTitle('T2');

        expect(popover.getAria().getLabelledBy()).toBeNull();
        expect(popover.getAria().getLabel()).toBe('Mine');
    });

    it('leaves a name the consumer gave an untitled popover alone', () => {
        installTestDOM(CONFIG);

        const popover = new Popover();

        popover.getAria().setLabel('Row actions');
        popover.clearTitle();

        expect(popover.getAria().getLabel()).toBe('Row actions');
    });
});

// A popover keeps the handle of its anchor and of the anchor's scrolling
// ancestors. Disposing the panel that holds the anchor releases those handles;
// every later read or write through one of them has to ask `isRegistered`.
describe('Popover — anchor disposed while open', () => {
    const FIXTURE_ANCHOR_SIZE = { width: 40, height: 20 };

    /** Mounts the panel at (50, 50), 200 by 100, and gives the anchor a fixed rect inside it. */
    function mountPanel(panelEl: Handle, anchorEl: Handle): void {
        DOM.sink.apply(panelEl, { style: { left: '50px', top: '50px', width: '200px', height: '100px' } });
        DOM.sink.apply(anchorEl, { style: { left: '10px', top: '10px', width: '40px', height: '20px' } });
        DOM.sink.appendChild(DOM.source.getDocumentElement(), panelEl);
    }

    /**
     * Builds the fixture: a scrolling panel mounted on the document element
     * holding an anchor component, with a popover attached to the anchor and
     * shown. The modelled DOM reports no overflow, so the panel's element is
     * reported as scrollable here and `_scrollAncestors` holds the panel and
     * the document element.
     *
     * @param onClose - Passed to the popover as its `onClose`.
     */
    function openPopoverInPanel(onClose?: () => void): { panel: Panel; popover: Popover } {
        installTestDOM(CONFIG);

        const panel  = new Panel({ autoScroll: 'y' });
        const anchor = new Component({ preferredSize: FIXTURE_ANCHOR_SIZE });

        panel.addComponent(anchor);

        const panelEl = panel.getElement(true)!;

        mountPanel(panelEl, anchor.getElement(true)!);

        const realOverflow = DOM.source.getComputedOverflow.bind(DOM.source);

        vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((handle) =>
            handle === panelEl
                ? { overflow: 'auto', overflowX: 'auto', overflowY: 'auto' }
                : realOverflow(handle));

        const popover = new Popover({ placement: 'bottom', onClose });

        popover.setBody(new Component({ preferredSize: { width: 120, height: 20 } }));
        popover.attachToComponent(anchor);
        popover.show();

        expect(popover.isOpen()).toBe(true);
        expect((popover as any)._scrollAncestors).toHaveLength(2);

        return { panel, popover };
    }

    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('P1: a window resize after the anchor is disposed closes the popover without throwing', () => {
        const { panel, popover } = openPopoverInPanel();

        panel.dispose();

        expect(() => (popover as any)._onWindowResize()).not.toThrow();
        expect(popover.isOpen()).toBe(false);
    });

    it('P2: closing after the anchor panel is disposed removes only live listeners', () => {
        const { panel, popover } = openPopoverInPanel();
        const removeListener = vi.spyOn(DOM.sink, 'removeListener');
        const ancestors      = [...(popover as any)._scrollAncestors as Handle[]];
        const documentEl     = ancestors[ancestors.length - 1];

        panel.dispose();
        popover.hide();

        const handles = removeListener.mock.calls.map((call) => call[0]);

        for (const handle of handles) {
            const registered = DOM.source.isRegistered(handle);

            expect(registered).toBe(true);
        }

        // The live ancestor's listener is still removed, not skipped with the dead one.
        expect(handles).toContain(documentEl);
    });

    it('P3: show() with an anchor disposed since attachToComponent warns and stays closed', () => {
        const { panel, popover } = openPopoverInPanel();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        popover.hide();
        panel.dispose();

        expect(() => popover.show()).not.toThrow();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('disposed');
        expect(popover.isOpen()).toBe(false);
    });

    it('P4: control: a resize with the anchor alive keeps the popover open', () => {
        const { popover } = openPopoverInPanel();

        expect(() => (popover as any)._onWindowResize()).not.toThrow();
        expect(popover.isOpen()).toBe(true);
    });

    it('P1b: onClose fires when the resize closes the popover', () => {
        const onClose            = vi.fn();
        const { panel, popover } = openPopoverInPanel(onClose);

        panel.dispose();
        (popover as any)._onWindowResize();

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('A1: setTitle after the anchor is disposed closes the popover without throwing', () => {
        const onClose            = vi.fn();
        const { panel, popover } = openPopoverInPanel(onClose);

        panel.dispose();

        expect(() => popover.setTitle('x')).not.toThrow();
        expect(popover.isOpen()).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('A2: a relayout after the anchor is disposed closes the popover without throwing', () => {
        const onClose            = vi.fn();
        const { panel, popover } = openPopoverInPanel(onClose);

        panel.dispose();

        expect(() => popover.doLayout()).not.toThrow();
        expect(popover.isOpen()).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('L1: a press outside the page after the anchor is disposed does not throw', () => {
        const { panel, popover } = openPopoverInPanel();

        // Production's `contains` resolves both handles and throws on a
        // released one; the modelled DOM's walks the parent table and answers.
        const realContains = DOM.source.contains.bind(DOM.source);

        vi.spyOn(DOM.source, 'contains').mockImplementation((ancestor, node) => {
            const registered = DOM.source.isRegistered(ancestor);

            if (!registered) {
                throw new Error(`DOM handle ${ancestor} is not registered`);
            }

            return realContains(ancestor, node);
        });

        const outside = DOM.sink.createElement('div');

        DOM.sink.appendChild(DOM.source.getDocumentElement(), outside);
        panel.dispose();

        expect(() => DOM.sink.dispatchEvent(outside, makeEvent(outside, 'pointerdown'))).not.toThrow();
        expect(popover.getAnchorElement()).toBeNull();
    });

    it('A3: a layout pass on a closed popover does not forget a disposed anchor', () => {
        const { panel, popover } = openPopoverInPanel();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        popover.hide();
        panel.dispose();

        expect(() => popover.doLayout()).not.toThrow();

        popover.show();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('disposed');
    });
});
