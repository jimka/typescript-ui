// Covers the `alwaysOnTop` window option: it defaults to false, reaches both
// concrete window subclasses, moves the window's z-order band via
// `LayerManager.setBand`, and lets a pinned window stay above an unpinned one
// through raises. Construction and the setter's dispatch stay JS-only, so
// these are exercised offline under the recording sink and modelled read
// source. See plan's Expected Behaviour cases 14-18.
import { describe, it, expect, afterEach } from 'vitest';
import { Window } from '~/overlay/Window';
import { TabWindow } from '~/overlay/TabWindow';
import { LayerManager } from '~/core/LayerManager';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('AbstractWindow alwaysOnTop option', () => {
    afterEach(() => DOM.reset());

    it('defaults to false', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        expect(win.isAlwaysOnTop()).toBe(false);
    });

    it('reaches Window via the constructor option', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { alwaysOnTop: true });

        expect(win.isAlwaysOnTop()).toBe(true);
    });

    it('reaches TabWindow via the constructor option', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow({ alwaysOnTop: true });

        expect(win.isAlwaysOnTop()).toBe(true);
    });

    it('getBand returns Window by default and PinnedWindow when always-on-top', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        expect(win.getBand()).toBe(LayerManager.Band.Window);

        win.setAlwaysOnTop(true);

        expect(win.getBand()).toBe(LayerManager.Band.PinnedWindow);
    });

    it('setAlwaysOnTop(true) raises the z-index above the pinned band base for a shown window, and (false) returns it below', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.show();

        win.setAlwaysOnTop(true);
        expect(LayerManager.getZIndex(win)).toBeGreaterThanOrEqual(LayerManager.Band.PinnedWindow);
        expect(LayerManager.getZIndex(win)).toBeLessThan(LayerManager.Band.Popover);

        win.setAlwaysOnTop(false);
        expect(LayerManager.getZIndex(win)).toBeGreaterThanOrEqual(LayerManager.Band.Window);
        expect(LayerManager.getZIndex(win)).toBeLessThan(LayerManager.Band.PinnedWindow);
    });

    it('leaves a pinned window above an unpinned window even after the unpinned one is raised', () => {
        installTestDOM(CONFIG);

        const a = new Window('A');
        const b = new Window('B');
        a.show();
        b.show();

        a.setAlwaysOnTop(true);
        b.bringToFront();

        expect(LayerManager.getZIndex(a)).toBeGreaterThan(LayerManager.getZIndex(b));
    });

    it('lets two pinned windows still reorder against each other, both staying above an unpinned peer', () => {
        installTestDOM(CONFIG);

        const a = new Window('A');
        const b = new Window('B');
        const peer = new Window('Peer');
        a.show();
        b.show();
        peer.show();

        a.setAlwaysOnTop(true);
        b.setAlwaysOnTop(true);

        a.bringToFront();
        b.bringToFront();

        expect(LayerManager.getZIndex(b)).toBeGreaterThan(LayerManager.getZIndex(a));
        expect(LayerManager.getZIndex(a)).toBeGreaterThan(LayerManager.getZIndex(peer));
        expect(LayerManager.getZIndex(b)).toBeGreaterThan(LayerManager.getZIndex(peer));
    });
});
