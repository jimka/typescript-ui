// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { LayerManager } from '~/core/LayerManager';
import { ReorderIndicator } from '~/overlay/ReorderIndicator';
import { DragFeedback } from '~/overlay/DragFeedback';
import { DragGhost } from '~/overlay/DragGhost';
import { DropZoneOverlay } from '~/overlay/DropZoneOverlay';
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

/** Reads the cached z-index off `_options` — Component exposes setZIndex but no
 *  public getter, so the backing field is the seam. */
function zIndex(c: Component): number | undefined {
    return (c as any)._options.zIndex;
}

// Mirrored contract constants (documented, not positioning magic).
const BAR_HEIGHT      = 2;   // ReorderIndicator bar height
const BAR_HALF        = 1;   // half the bar height
const GHOST_WIDTH     = 160; // DragGhost default width
const GHOST_HEIGHT    = 28;  // DragGhost default height
const GHOST_Z         = 10200;

describe('ReorderIndicator', () => {
    afterEach(() => DOM.reset());

    it('constructs below the Window band, BAR_HEIGHT tall, pointer-events none', () => {
        installTestDOM(CONFIG);

        const bar = new ReorderIndicator();

        expect(zIndex(bar)).toBe(LayerManager.Band.Window - 1);
        expect(bar.getHeight()).toBe(BAR_HEIGHT);
        expect(bar.getPointerEvents()).toBe('none');
    });

    it('setInsertionY centres the bar (y - BAR_HALF)', () => {
        installTestDOM(CONFIG);

        const bar = new ReorderIndicator();

        bar.setInsertionY(50);

        expect(bar.getY()).toBe(50 - BAR_HALF);
    });

    it('attachTo mirrors the target width and zeroes x', () => {
        installTestDOM(CONFIG);

        const target = new Component();
        target.getElement(true);
        target.setWidth(120);

        const bar = new ReorderIndicator();
        bar.attachTo(target);

        expect(bar.getWidth()).toBe(120);
        expect(bar.getX()).toBe(0);
        // NOTE: the idempotent re-attach guard (getParentElement === targetEl
        // early-return) is unverifiable offline — getParentElement returns null
        // in the modelled source, so the guard never short-circuits.
    });
});

describe('DragFeedback', () => {
    afterEach(() => DOM.reset());

    it('constructs below the Window band, pointer-events none, valid by default', () => {
        installTestDOM(CONFIG);

        const fb = new DragFeedback();

        expect(zIndex(fb)).toBe(LayerManager.Band.Window - 1);
        expect(fb.getPointerEvents()).toBe('none');
        expect(fb.isValid()).toBe(true);
    });

    it('setValid toggles the validity flag', () => {
        installTestDOM(CONFIG);

        const fb = new DragFeedback();

        fb.setValid(false);
        expect(fb.isValid()).toBe(false);

        fb.setValid(true);
        expect(fb.isValid()).toBe(true);
    });

    it('attachTo a target mirrors its box and zeroes the local origin', () => {
        installTestDOM(CONFIG);

        const target = new Component();
        target.getElement(true);
        target.setWidth(200);
        target.setHeight(60);

        const fb = new DragFeedback();
        fb.attachTo(target);

        // No host: the tint covers the target's own body as a child of it.
        expect(fb.getX()).toBe(0);
        expect(fb.getY()).toBe(0);
        expect(fb.getWidth()).toBe(200);
        expect(fb.getHeight()).toBe(60);
    });
});

describe('DragGhost', () => {
    afterEach(() => DOM.reset());

    it('constructs at the ghost z-ceiling with default size, pointer-events none, 0.85 opacity', () => {
        installTestDOM(CONFIG);

        const ghost = new DragGhost();

        expect(zIndex(ghost)).toBe(GHOST_Z);
        expect(ghost.getWidth()).toBe(GHOST_WIDTH);
        expect(ghost.getHeight()).toBe(GHOST_HEIGHT);
        expect(ghost.getPointerEvents()).toBe('none');
        expect(ghost.getOpacity()).toBe(0.85);
    });

    it('honours explicit width / height', () => {
        installTestDOM(CONFIG);

        const ghost = new DragGhost('label', 240, 40);

        expect(ghost.getWidth()).toBe(240);
        expect(ghost.getHeight()).toBe(40);
    });

    it('moveTo sets the top-left corner', () => {
        installTestDOM(CONFIG);

        const ghost = new DragGhost();

        ghost.moveTo(300, 400);

        expect(ghost.getX()).toBe(300);
        expect(ghost.getY()).toBe(400);
    });
});

describe('DropZoneOverlay', () => {
    afterEach(() => DOM.reset());

    it('constructs below the Window band with pointer-events none', () => {
        installTestDOM(CONFIG);

        const overlay = new DropZoneOverlay();

        expect(zIndex(overlay)).toBe(LayerManager.Band.Window - 1);
        expect(overlay.getPointerEvents()).toBe('none');
    });

    it('attachTo a region mirrors its box', () => {
        installTestDOM(CONFIG);

        const region = new Component();
        region.getElement(true);
        region.setWidth(300);
        region.setHeight(150);

        const overlay = new DropZoneOverlay();
        overlay.attachTo(region);

        expect(overlay.getWidth()).toBe(300);
        expect(overlay.getHeight()).toBe(150);
        expect(overlay.getX()).toBe(0);
        expect(overlay.getY()).toBe(0);
    });
});
