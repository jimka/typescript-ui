// A scrolling Panel names the element its content scrolls inside through the
// optional `FocusRevealer.getScrollViewportElement()`. Spatial navigation's
// control chord reads it to learn which box is the visible window onto
// scrolled content. The element named must be the one that actually scrolls:
// the panel's own element with a native scrollbar, the inner scroll element
// with the overlay scrollbar.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Mounting an autoScroll Panel schedules a follow-up layout frame; capture and
// drain it so the registration cannot leak into the next test — the same
// guard PanelOverlayScrollbar.test.ts installs.
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
    installTestDOM(CONFIG);
    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
});

afterEach(() => {
    for (let guard = 0; guard < 10 && frames.length > 0; guard++) {
        const pending = frames;
        frames = [];

        for (const cb of pending) {
            cb(0);
        }
    }

    vi.restoreAllMocks();
    DOM.reset();
});

/** The panel's inner overlay-scroll element, reached without an `any` escape hatch. */
function overlayScrollElement(panel: Panel): Handle | null {
    return (panel as unknown as { _overlayScrollElement: Handle | null })._overlayScrollElement;
}

describe('Panel.getScrollViewportElement', () => {
    it('returns the panel\'s own element for a rendered panel with a native scrollbar', () => {
        const panel = new Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        const element = panel.getElement(true);

        expect(panel.getScrollViewportElement()).toBe(element);
    });

    it('returns null for a rendered panel that does not scroll — it is not a scroll viewport', () => {
        const panel = new Panel();

        panel.getElement(true);

        expect(panel.getAutoScroll()).toBe('none');
        expect(panel.getScrollViewportElement()).toBeNull();
    });

    it('follows a runtime change of autoScroll', () => {
        const panel = new Panel({ autoScroll: 'y', scrollbarStyle: 'native' });
        const element = panel.getElement(true);

        expect(panel.getScrollViewportElement()).toBe(element);

        panel.setAutoScroll('none');

        expect(panel.getScrollViewportElement()).toBeNull();
    });

    it('returns the inner scroll element, not the panel\'s own, with the overlay scrollbar', () => {
        const panel = new Panel({ autoScroll: 'y' });
        const element = panel.getElement(true);
        const inner = overlayScrollElement(panel);

        expect(inner).not.toBeNull();
        expect(panel.getScrollViewportElement()).toBe(inner);
        expect(panel.getScrollViewportElement()).not.toBe(element);
    });

    it('returns null before the panel is rendered', () => {
        expect(new Panel({ autoScroll: 'y' }).getScrollViewportElement()).toBeNull();
    });
});
