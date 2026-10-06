import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { Drawer } from '~/overlay/Drawer';
import { Placement } from '~/primitive/Placement';
import { LayerManager } from '~/core/LayerManager';
import { Component } from '~/core/Component';
import { _Button as Button } from '~/component/button/Button';
import { Tooltip } from '~/overlay/Tooltip';
import { FOCUSABLE_SELECTOR } from '~/core/Focusable';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM, setConnected, setQuerySelectorAllResult } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('Drawer (option round-trips + layer integration)', () => {
    afterEach(() => DOM.reset());

    it('defaults: edge WEST, non-modal, 320px, 220ms, closed', () => {
        installTestDOM(CONFIG);

        const drawer = new Drawer();

        expect(drawer.getEdge()).toBe(Placement.WEST);
        expect(drawer.isModal()).toBe(false);
        expect(drawer.getDrawerSize()).toBe(320);
        expect(drawer.getDurationMs()).toBe(220);
        expect(drawer.isOpen()).toBe(false);
    });

    it('round-trips edge / modal / size / duration from the options bag', () => {
        installTestDOM(CONFIG);

        const drawer = new Drawer({
            edge:       Placement.EAST,
            modal:      true,
            size:       400,
            durationMs: 120,
        });

        expect(drawer.getEdge()).toBe(Placement.EAST);
        expect(drawer.isModal()).toBe(true);
        expect(drawer.getDrawerSize()).toBe(400);
        expect(drawer.getDurationMs()).toBe(120);
    });

    it('round-trips edge / modal / size via the runtime setters', () => {
        installTestDOM(CONFIG);

        const drawer = new Drawer();

        drawer.setEdge(Placement.SOUTH);
        drawer.setModal(true);
        drawer.setDrawerSize(280);
        drawer.setDurationMs(300);

        expect(drawer.getEdge()).toBe(Placement.SOUTH);
        expect(drawer.isModal()).toBe(true);
        expect(drawer.getDrawerSize()).toBe(280);
        expect(drawer.getDurationMs()).toBe(300);
    });

    it('getDismissMode() is "manual" for a non-modal drawer and "modal" for a modal one', () => {
        installTestDOM(CONFIG);

        expect(new Drawer({ modal: false }).getDismissMode()).toBe('manual');
        expect(new Drawer({ modal: true }).getDismissMode()).toBe('modal');
    });

    it('isLayerRoot() is true (a drawer is an independent top-level peer)', () => {
        installTestDOM(CONFIG);

        expect(new Drawer().isLayerRoot()).toBe(true);
    });

    it('getBand() is the Drawer band when non-modal and the Dialog band when modal', () => {
        installTestDOM(CONFIG);

        expect(new Drawer({ modal: false }).getBand()).toBe(LayerManager.Band.Drawer);
        expect(new Drawer({ modal: true }).getBand()).toBe(LayerManager.Band.Dialog);
    });

    it('getLayerElement() is null before open()', () => {
        installTestDOM(CONFIG);

        expect(new Drawer().getLayerElement()).toBeNull();
    });
});

// modal-dialog-focus-trap plan, Expected Behaviour "Drawer". A modal drawer
// had the scrim, the band and the dismiss mode of a modal layer and no focus
// handling at all: focus stayed on the opener behind the scrim. It now takes
// focus when it opens and returns it when it has closed; a non-modal drawer
// still moves none.
describe('Drawer — modal focus', () => {
    // Every background surface a case adds, so the teardown can remove it.
    const pages: Array<{ onInertChanged: Mock<(inert: boolean) => void> }> = [];

    afterEach(() => {
        for (const page of pages) {
            LayerManager.removeBackgroundSurface(page);
        }

        pages.length = 0;

        // A Button attaches a tooltip, whose static pointer watch pins a
        // viewport listener across the DOM reset.
        Tooltip._stopPointerWatch();
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** Collects `Component.afterNextLayout` callbacks instead of scheduling them. */
    function collectLayoutCallbacks(): { run(): void; cancel: ReturnType<typeof vi.fn> } {
        const scheduled: Array<() => void> = [];
        const cancel = vi.fn();

        vi.spyOn(Component, 'afterNextLayout').mockImplementation((cb: () => void) => {
            scheduled.push(cb);

            return { cancel };
        });

        return { run: (): void => scheduled.forEach(cb => cb()), cancel };
    }

    /** Makes every animation complete synchronously, as reduced motion does. */
    function reduceMotion(): void {
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });
    }

    /** A connected, focused button standing in for whatever opened the drawer. */
    function focusedOpener(): { opener: Button; openerEl: Handle } {
        const opener   = new Button({ text: 'Open' });
        const openerEl = opener.getElement(true)!;

        setConnected(openerEl, true);
        DOM.sink.focus(openerEl);

        return { opener, openerEl };
    }

    /** A stand-in for the page, told whether a modal layer is open. */
    function page(): { onInertChanged: Mock<(inert: boolean) => void> } {
        const surface = { onInertChanged: vi.fn<(inert: boolean) => void>() };

        LayerManager.addBackgroundSurface(surface);
        pages.push(surface);

        return surface;
    }

    /** A drawer whose element holds `count` seeded stops. */
    function drawerWithStops(modal: boolean, count: number): { drawer: Drawer; stops: Handle[] } {
        const drawer = new Drawer({ modal });
        const el     = drawer.getElement(true)!;
        const stops  = Array.from({ length: count }, () => {
            const stop = DOM.sink.createElement('button');

            DOM.sink.appendChild(el, stop);

            return stop;
        });

        setQuerySelectorAllResult(el, FOCUSABLE_SELECTOR, stops);

        return { drawer, stops };
    }

    it('R1: a modal drawer focuses its first stop after its first layout, and the page is inert', () => {
        installTestDOM(CONFIG);

        const layout = collectLayoutCallbacks();
        const behind = page();

        focusedOpener();

        const { drawer, stops } = drawerWithStops(true, 2);
        const focus = vi.spyOn(DOM.sink, 'focus');

        drawer.open();

        // Not focused inline: the first layout re-parents a Panel child into
        // its scroll frame, which would blur it.
        expect(focus).not.toHaveBeenCalled();

        layout.run();

        // preventScroll: the panel is still sliding in from off-screen.
        expect(focus).toHaveBeenCalledTimes(1);
        expect(focus).toHaveBeenCalledWith(stops[0], { preventScroll: true });
        expect(behind.onInertChanged).toHaveBeenLastCalledWith(true);
        expect(drawer.getInertAttribute()).toBe(false);

        drawer.dispose();
    });

    it('R2: a modal drawer with nothing focusable takes focus itself', () => {
        installTestDOM(CONFIG);

        const layout = collectLayoutCallbacks();
        const drawer = new Drawer({ modal: true });

        focusedOpener();
        drawer.open();
        layout.run();

        expect(DOM.source.getActiveElement()).toBe(drawer.getElement());
        // -1: focusable from script, never a Tab stop.
        expect(drawer.getAria().getTabIndex()).toBe(-1);

        drawer.dispose();
    });

    it('R3: closing returns focus to the opener, once the page is live again', () => {
        installTestDOM(CONFIG);
        reduceMotion();

        const layout = collectLayoutCallbacks();
        const behind = page();
        const { openerEl } = focusedOpener();
        const { drawer }   = drawerWithStops(true, 2);

        drawer.open();
        layout.run();

        const order: string[] = [];

        behind.onInertChanged.mockImplementation((inert: boolean) => { order.push(`page inert=${inert}`); });
        vi.spyOn(DOM.sink, 'focus').mockImplementation((handle) => { order.push(handle === openerEl ? 'focus opener' : 'focus other'); });

        drawer.close();

        // Restoring before the unregister would focus an element that is still
        // inert, which a browser refuses.
        expect(order).toEqual(['page inert=false', 'focus opener']);
        expect(LayerManager.hasModalLayer()).toBe(false);
        expect(drawer.isOpen()).toBe(false);

        drawer.dispose();
    });

    it('R3b: reads the opener before the page goes inert', () => {
        installTestDOM(CONFIG);
        reduceMotion();

        const layout = collectLayoutCallbacks();
        const { openerEl } = focusedOpener();
        const { drawer }   = drawerWithStops(true, 1);

        // What a browser does to a focused element that goes inert.
        const behind = {
            onInertChanged: vi.fn<(inert: boolean) => void>((inert) => {
                if (inert) {
                    DOM.sink.focus(DOM.source.getBody());
                }
            }),
        };

        LayerManager.addBackgroundSurface(behind);
        pages.push(behind);

        drawer.open();
        layout.run();

        const focus = vi.spyOn(DOM.sink, 'focus');

        drawer.close();

        expect(focus).toHaveBeenCalledTimes(1);
        expect(focus).toHaveBeenCalledWith(openerEl);

        drawer.dispose();
    });

    it('R4: an opener that was disposed or detached meanwhile is not refocused', () => {
        installTestDOM(CONFIG);
        reduceMotion();

        const layout = collectLayoutCallbacks();

        const first    = focusedOpener();
        const disposed = drawerWithStops(true, 1).drawer;

        disposed.open();
        layout.run();
        first.opener.dispose();

        const focus = vi.spyOn(DOM.sink, 'focus');

        expect(() => disposed.close()).not.toThrow();
        expect(focus).not.toHaveBeenCalledWith(first.openerEl);

        const second   = focusedOpener();
        const detached = drawerWithStops(true, 1).drawer;

        detached.open();
        layout.run();
        setConnected(second.openerEl, false);
        focus.mockClear();

        expect(() => detached.close()).not.toThrow();
        expect(focus).not.toHaveBeenCalledWith(second.openerEl);

        disposed.dispose();
        detached.dispose();
    });

    it('R5: a non-modal drawer moves no focus and makes nothing inert', () => {
        installTestDOM(CONFIG);
        reduceMotion();

        const layout = collectLayoutCallbacks();
        const behind = page();

        focusedOpener();

        const { drawer } = drawerWithStops(false, 2);
        const focus = vi.spyOn(DOM.sink, 'focus');

        drawer.open();
        layout.run();
        drawer.close();

        expect(focus).not.toHaveBeenCalled();
        expect(drawer.getAria().getTabIndex()).toBeNull();
        expect(behind.onInertChanged.mock.calls.every(([inert]) => inert === false)).toBe(true);

        drawer.dispose();
    });

    it('R6: closing before the first layout withdraws the pending focus', () => {
        installTestDOM(CONFIG);
        reduceMotion();

        const layout = collectLayoutCallbacks();
        const { drawer } = drawerWithStops(true, 2);

        drawer.open();

        expect(layout.cancel).not.toHaveBeenCalled();

        drawer.close();

        expect(layout.cancel).toHaveBeenCalledTimes(1);

        drawer.dispose();
    });

    it('R7: disposing an open modal drawer leaves the page live and restores no focus', () => {
        installTestDOM(CONFIG);

        const layout = collectLayoutCallbacks();
        const behind = page();
        const { openerEl } = focusedOpener();
        const { drawer }   = drawerWithStops(true, 2);

        drawer.open();
        layout.run();

        const focus = vi.spyOn(DOM.sink, 'focus');

        expect(() => drawer.dispose()).not.toThrow();
        expect(behind.onInertChanged).toHaveBeenLastCalledWith(false);
        expect(LayerManager.hasModalLayer()).toBe(false);
        expect(focus).not.toHaveBeenCalledWith(openerEl);
    });

    it('disposing before the first layout withdraws the pending focus', () => {
        installTestDOM(CONFIG);

        const layout = collectLayoutCallbacks();
        const { drawer } = drawerWithStops(true, 2);

        drawer.open();
        drawer.dispose();

        expect(layout.cancel).toHaveBeenCalledTimes(1);
    });

    it('gives up its own focusability again when it closes', () => {
        installTestDOM(CONFIG);
        reduceMotion();

        const layout = collectLayoutCallbacks();
        const drawer = new Drawer({ modal: true });

        focusedOpener();
        drawer.open();
        layout.run();

        expect(drawer.getAria().getTabIndex()).toBe(-1);

        drawer.close();

        // The drawer is reused: with content added later, or reopened
        // non-modal, a click on its background must not focus it.
        expect(drawer.getAria().getTabIndex()).toBeNull();

        drawer.dispose();
    });

    // setModal() documents that it takes effect on the next open(). The scrim
    // already works that way; the layer tree must too, or flipping the option
    // on an open drawer would leave the page inert under no scrim, or live
    // under one.
    it('keeps the modality it opened with until it has closed', () => {
        installTestDOM(CONFIG);
        reduceMotion();

        const layout = collectLayoutCallbacks();
        const behind = page();
        const { drawer } = drawerWithStops(true, 1);

        drawer.open();
        layout.run();
        drawer.setModal(false);

        expect(drawer.getDismissMode()).toBe('modal');
        expect(LayerManager.hasModalLayer()).toBe(true);

        // Any register re-reads every layer's mode.
        const other = { getLayerElement: () => null, getDismissMode: () => 'manual' as const, requestClose: () => {} };

        LayerManager.register(other);

        expect(behind.onInertChanged).toHaveBeenLastCalledWith(true);

        LayerManager.unregister(other);
        drawer.close();

        expect(drawer.getDismissMode()).toBe('manual');
        expect(behind.onInertChanged).toHaveBeenLastCalledWith(false);

        drawer.open();

        expect(LayerManager.hasModalLayer()).toBe(false);

        drawer.dispose();
    });

    it('reopening after a close records the new opener', () => {
        installTestDOM(CONFIG);
        reduceMotion();

        const layout = collectLayoutCallbacks();
        const { drawer } = drawerWithStops(true, 1);

        focusedOpener();
        drawer.open();
        layout.run();
        drawer.close();

        const second = focusedOpener();

        drawer.open();
        layout.run();

        const focus = vi.spyOn(DOM.sink, 'focus');

        drawer.close();

        expect(focus).toHaveBeenCalledTimes(1);
        expect(focus).toHaveBeenCalledWith(second.openerEl);

        drawer.dispose();
    });
});

describe('Drawer — role and name', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** The rendered value of `name` on the drawer's own element, or null when absent. */
    function attribute(drawer: Drawer, name: string): string | null {
        return DOM.source.getAttribute(drawer.getElement(true)!, name);
    }

    it('is a dialog, modal or not', () => {
        installTestDOM(CONFIG);

        const nonModal = new Drawer();
        const modal    = new Drawer({ modal: true });

        expect(attribute(nonModal, 'role')).toBe('dialog');
        expect(attribute(modal, 'role')).toBe('dialog');
    });

    it('carries no aria-modal while a modal drawer is open', () => {
        installTestDOM(CONFIG);

        const drawer = new Drawer({ modal: true });

        drawer.open();

        expect(LayerManager.hasModalLayer()).toBe(true);
        expect(attribute(drawer, 'aria-modal')).toBeNull();

        drawer.dispose();
    });

    it('has no name of its own, and keeps the one a consumer gives it across open and close', () => {
        installTestDOM(CONFIG);
        // Reduced motion: the close animation completes synchronously.
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });

        const drawer = new Drawer();

        expect(drawer.getAria().getLabel()).toBeNull();
        expect(drawer.getAria().getLabelledBy()).toBeNull();

        drawer.getAria().setLabel('Filters');
        drawer.open();
        drawer.close();

        expect(drawer.isOpen()).toBe(false);
        expect(drawer.getAria().getLabel()).toBe('Filters');
        expect(attribute(drawer, 'aria-label')).toBe('Filters');

        drawer.dispose();
    });
});
