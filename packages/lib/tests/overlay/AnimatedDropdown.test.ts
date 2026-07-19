//
// Coverage for AnimatedDropdown's layer-z behaviour. The bug a live combo
// cell first surfaced: a dropdown reads its z-index once in showAnimated and,
// without an onZIndexChanged hook, never updates it — so raising its host
// window (a mousedown brings the window to front, re-stamping the layer
// subtree) lands the window ABOVE the still-open dropdown, hiding the panel
// and its fade-out behind the window. The fix implements onZIndexChanged to
// mirror the manager's fresh z onto the element, mirroring Window / Drawer.
import { describe, it, expect, afterEach } from 'vitest';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { DOM, type Handle } from '~/core/DOM';
import { Component } from '~/core/Component';
import { AnimatedDropdown } from '~/core/AnimatedDropdown';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// LayerManager is a module singleton, so every registered layer is drained.
const registered: DismissableLayer[] = [];

/** A root opener stub standing in for a window: registers in its own band. */
function rootOpener(): DismissableLayer {
    const el: Handle = DOM.sink.createElement('div');

    return {
        getLayerElement: () => el,
        getDismissMode:  () => 'click-outside',
        requestClose:    () => {},
        isLayerRoot:     () => true,
        getBand:         () => LayerManager.Band.Window,
    };
}

/** Reads the z-index Component mirrors onto the element (cached in `_options`). */
function elementZ(c: Component): number | undefined {
    return (c as any)._options.zIndex;
}

afterEach(() => {
    for (let i = registered.length - 1; i >= 0; i--) {
        LayerManager.unregister(registered[i]);
    }

    registered.length = 0;
    DOM.reset();
});

describe('AnimatedDropdown layer z-index', () => {
    it('onZIndexChanged mirrors the assigned z onto the element', () => {
        installTestDOM(CONFIG);

        const dropdown = new AnimatedDropdown();
        dropdown.getElement(true);

        dropdown.onZIndexChanged(4321);

        expect(elementZ(dropdown)).toBe(4321);
    });

    it('stays above its opener when the opener is brought to front (the window-raise case)', () => {
        installTestDOM(CONFIG);

        // An open dropdown nested under a window-like opener: register the
        // opener first so it is the topmost layer, then the dropdown nests
        // under it (it is not a layer root).
        const opener = rootOpener();
        LayerManager.register(opener);
        registered.push(opener);

        const dropdown = new AnimatedDropdown();
        dropdown.getElement(true);
        LayerManager.register(dropdown);
        registered.push(dropdown);
        dropdown.setZIndex(LayerManager.getZIndex(dropdown));  // show-time stamp (as showAnimated does)

        // A mousedown in the window raises it; the manager re-stamps the
        // window's subtree, which now includes the dropdown.
        LayerManager.bringToFront(opener);

        // The dropdown's mirrored element z must end up above the opener's so
        // the open panel (and its fade-out) is not hidden behind the window.
        expect(elementZ(dropdown)!).toBeGreaterThan(LayerManager.getZIndex(opener));
    });
});
