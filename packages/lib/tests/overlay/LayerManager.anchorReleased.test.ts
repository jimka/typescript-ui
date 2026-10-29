import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { AnimatedDropdown } from '~/core/AnimatedDropdown';
import { Component } from '~/core/Component';
import { Menu } from '~/overlay/Menu';
import { DOM, type Handle, type Rect } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import { throwOnReleasedHandle } from '../helpers/throwOnReleasedHandle';
import { Window } from '~/overlay/Window';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Any on-screen trigger rect: (100, 100), 80 by 24.
const TRIGGER_RECT: Rect = {
    x:      100,
    y:      100,
    left:   100,
    top:    100,
    right:  180,
    bottom: 124,
    width:  80,
    height: 24,
};

interface StubLayer extends DismissableLayer {
    requestClose: Mock<() => boolean | void>;
}

interface StubLayerOpts {
    anchor?:  Handle;
    band?:    number;
    isRoot?:  boolean;
}

/** Dispatches a `pointerdown` on a fresh element outside every layer and every anchor. */
function pressOutside(): void {
    const outside = DOM.sink.createElement('div');

    DOM.sink.appendChild(DOM.source.getDocumentElement(), outside);
    DOM.sink.dispatchEvent(outside, makeEvent(outside, 'pointerdown'));
}

// The manager is a module singleton; drain every layer, before and after, so
// a layer left by another case cannot be walked with a released element.
function drainLayers(): void {
    for (const layer of LayerManager.getLayers()) {
        LayerManager.unregister(layer);
    }
}

function mountedDiv(): Handle {
    const el = DOM.sink.createElement('div');

    DOM.sink.appendChild(DOM.source.getDocumentElement(), el);

    return el;
}

/** A mounted opener: a component whose element is in the document. */
function mountedOpener(): { component: Component; element: Handle } {
    const component = new Component();
    const element   = component.getElement(true)!;

    DOM.sink.appendChild(DOM.source.getDocumentElement(), element);

    return { component, element };
}

function stubLayer(opts: StubLayerOpts = {}): StubLayer {
    const el = mountedDiv();

    const layer: StubLayer = {
        getLayerElement: () => el,
        getDismissMode:  () => 'click-outside',
        requestClose:    vi.fn<() => boolean | void>(),
    };

    if (opts.anchor !== undefined) {
        const anchor = opts.anchor;

        layer.getAnchorElement = () => anchor;
    }

    if (opts.band !== undefined) {
        const band = opts.band;

        layer.getBand = () => band;
    }

    if (opts.isRoot !== undefined) {
        const isRoot = opts.isRoot;

        layer.isLayerRoot = () => isRoot;
    }

    return layer;
}

describe('LayerManager: an anchor released while its layer is open', () => {
    beforeEach(() => {
        installTestDOM(CONFIG);
        drainLayers();
        throwOnReleasedHandle();
    });

    afterEach(() => {
        drainLayers();
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('H1: an outside press does not throw and closes the layer', () => {
        const anchor = mountedDiv();
        const layer  = stubLayer({ anchor });

        LayerManager.register(layer);
        DOM.sink.release(anchor);

        expect(() => pressOutside()).not.toThrow();
        expect(layer.requestClose).toHaveBeenCalledTimes(1);
    });

    it('H2: the walk continues to the layers beneath the stale one', () => {
        const anchor = mountedDiv();
        const lower  = stubLayer();
        const upper  = stubLayer({ anchor });

        LayerManager.register(lower);
        LayerManager.register(upper);
        DOM.sink.release(anchor);

        expect(() => pressOutside()).not.toThrow();
        expect(upper.requestClose).toHaveBeenCalledTimes(1);
        expect(lower.requestClose).toHaveBeenCalledTimes(1);
    });

    it('H3: a focus move does not throw and a click-outside layer ignores it', () => {
        const anchor = mountedDiv();
        const layer  = stubLayer({ anchor });

        LayerManager.register(layer);
        DOM.sink.release(anchor);

        const target = mountedDiv();

        expect(() => DOM.sink.dispatchEvent(target, makeEvent(target, 'focusin'))).not.toThrow();
        expect(layer.requestClose).not.toHaveBeenCalled();
    });

    it('H4: registering with a released anchor falls back to the last-registered layer', () => {
        const windowLayer = stubLayer({ band: LayerManager.Band.Window, isRoot: true });

        LayerManager.register(windowLayer);

        const anchor = mountedDiv();

        DOM.sink.release(anchor);

        const dropdown = stubLayer({ anchor, band: LayerManager.Band.Dropdown });

        expect(() => LayerManager.register(dropdown)).not.toThrow();

        const windowZ   = LayerManager.getZIndex(windowLayer);
        const dropdownZ = LayerManager.getZIndex(dropdown);

        expect(dropdownZ).toBeGreaterThan(windowZ);
        expect(dropdownZ).toBeLessThan(LayerManager.Band.PinnedWindow);
    });

    it('H5: a press on a live anchor is not an outside press', () => {
        const anchor = mountedDiv();
        const layer  = stubLayer({ anchor });

        LayerManager.register(layer);
        DOM.sink.dispatchEvent(anchor, makeEvent(anchor, 'pointerdown'));

        expect(layer.requestClose).not.toHaveBeenCalled();
    });

    it('M1: a toggled menu whose opener is disposed closes on the next outside press', () => {
        const opener  = mountedOpener();
        const onClose = vi.fn();
        const menu    = new Menu();

        menu.toggleFor(opener.element, TRIGGER_RECT, [{ text: 'A' }], onClose);
        opener.component.dispose();

        expect(LayerManager.getLayers()).toContain(menu);
        expect(() => pressOutside()).not.toThrow();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(LayerManager.getLayers()).not.toContain(menu);

        menu.dispose();
    });

    it('M2: a persistent menu whose excluded element is disposed closes on the next outside press', () => {
        const bar     = mountedOpener();
        const onClose = vi.fn();
        const menu    = new Menu([{ text: 'A' }], onClose);

        menu.setExcludedElement(bar.element);
        menu.open(bar.element);
        bar.component.dispose();

        expect(LayerManager.getLayers()).toContain(menu);
        expect(() => pressOutside()).not.toThrow();
        expect(onClose).toHaveBeenCalledTimes(1);

        menu.dispose();
    });

    it('D1: a dropdown whose anchor is disposed closes on the next outside press', () => {
        const opener   = mountedOpener();
        const dropdown = new AnimatedDropdown({ animated: false });

        dropdown.setAnchorElement(opener.element);
        dropdown.showAnimated();
        opener.component.dispose();

        expect(dropdown.isOpen()).toBe(true);
        expect(() => pressOutside()).not.toThrow();
        expect(dropdown.isOpen()).toBe(false);
        expect(LayerManager.getLayers()).not.toContain(dropdown);

        dropdown.dispose();
    });

    it('W1: a window menu whose title icon is cleared closes on the next outside press', () => {
        const win = new Window('W');

        win.getElement(true);
        win.show();

        const layersBefore = LayerManager.getLayers().length;

        (win as unknown as { onTitleGlyphClick(): void }).onTitleGlyphClick();

        const layersOpen = LayerManager.getLayers().length;

        expect(layersOpen).toBe(layersBefore + 1);

        win.getHeader().clearGlyph();

        expect(() => pressOutside()).not.toThrow();
        expect(LayerManager.getLayers().length).toBe(layersBefore);

        win.dispose();
    });
});
