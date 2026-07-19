import { describe, it, expect, afterEach } from 'vitest';
import { Drawer } from '~/overlay/Drawer';
import { Placement } from '~/primitive/Placement';
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

    it('getLayerElement() is null before open()', () => {
        installTestDOM(CONFIG);

        expect(new Drawer().getLayerElement()).toBeNull();
    });
});
