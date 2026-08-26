// Regression: a "normal" (not minimized, not maximized) window kept its old
// x/y/size when the viewport shrank underneath it, so a window near the
// trailing or bottom edge — or one simply too large for the shrunk viewport —
// could end up positioned partly or wholly off-screen with its header
// unreachable. AbstractWindow.onViewportResize() short-circuited for every
// state except "minimized"/"maximized", and even if it hadn't, the listener
// itself was never attached while a window sat in the normal state
// (setWindowState's "normal" branch detached it).
//
// Fixed by attaching the listener for the window's whole open lifetime (from
// show()) and, on resize while normal, calling fitNormalWindowToViewport():
// it shrinks the window down to fit a VIEWPORT_RESIZE_MARGIN_PX (50px) margin
// on every side — never below the window's own min-size — then repositions
// it inside that margin. When the min-size itself exceeds the margin-shrunk
// viewport, the window is pinned 50px from the top-left corner and left to
// spill past the bottom/right edge rather than forced below its floor.
//
// Own file, mirroring AbstractWindow.minimizedViewportResize.test.ts's
// rAF/timer-mocking convention: Window.show() schedules a real entrance rAF
// plus a fallback timer, neither of which needs to fire for this test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const MARGIN = 50;

describe('AbstractWindow — normal-state window refits the viewport on resize', () => {
    let config: ReturnType<typeof makeConfig>;

    function makeConfig(width: number, height: number) {
        return {
            rootMountOffset: { x: 0, y: 0 },
            viewport:        { width, height },
            scrollBarWidth:  15,
            fontMetrics,
            themeVars:       {},
        };
    }

    beforeEach(() => {
        config = makeConfig(1280, 800);
        installTestDOM(config);

        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(() => 0);
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((): number => 0) as typeof setTimeout);
    });

    afterEach(() => {
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** Models a live viewport resize: change the size, then run the resize handler. */
    function resizeViewport(win: Window, width: number, height: number): void {
        config.viewport.width  = width;
        config.viewport.height = height;
        (win as unknown as { onViewportResize(): void }).onViewportResize();
    }

    /**
     * A window's true min-size (the combined floor `setWidth`/`setHeight`
     * enforce) depends on measured header text and isn't a documented
     * constant — discover it empirically by driving the setters to 1px and
     * reading back what they actually clamped to.
     */
    function discoverMinSize(win: Window): { width: number; height: number } {
        win.setWidth(1);
        win.setHeight(1);

        return { width: win.getWidth(), height: win.getHeight() };
    }

    it('leaves an in-bounds window untouched', () => {
        const win = new Window('W');
        win.setSize({ width: 300, height: 220 });
        win.setX(200);
        win.setY(200);
        win.show();

        resizeViewport(win, 1280, 800);

        expect(win.getWidth()).toBe(300);
        expect(win.getHeight()).toBe(220);
        expect(win.getX()).toBe(200);
        expect(win.getY()).toBe(200);
    });

    it('pulls a window inside the margin without resizing it, when it still fits', () => {
        const win = new Window('W');
        win.setSize({ width: 300, height: 220 });
        win.setX(10);
        win.setY(800 - 220 - 5); // near the bottom edge, inside the old but not the new margin
        win.show();

        resizeViewport(win, 1280, 800);

        expect(win.getWidth()).toBe(300);
        expect(win.getHeight()).toBe(220);
        expect(win.getX()).toBe(MARGIN);
        expect(win.getY()).toBe(800 - MARGIN - 220);
    });

    it('shrinks a too-large window down to the margin-shrunk viewport, not below it', () => {
        const win = new Window('W');
        win.show();
        const min = discoverMinSize(win);

        win.setSize({ width: 1000, height: min.height + 50 });
        win.setX(50);
        win.setY(50);

        // Shrink the viewport width; height is untouched so only width refits.
        resizeViewport(win, 700, 800);

        const availWidth = 700 - 2 * MARGIN;
        expect(availWidth).toBeGreaterThanOrEqual(min.width); // sanity: not the spill case
        expect(win.getWidth()).toBe(availWidth);
        expect(win.getHeight()).toBe(min.height + 50);
        expect(win.getX()).toBe(MARGIN);
    });

    it('pins to the margin and spills over when the min-size exceeds the shrunk viewport', () => {
        const win = new Window('W');
        win.show();
        const min = discoverMinSize(win);

        win.setSize({ width: min.width + 100, height: min.height + 100 });
        win.setX(50);
        win.setY(50);

        // Narrower than the window's own min-size even before subtracting the
        // margin twice over.
        const tinyViewportWidth = min.width + 20;
        resizeViewport(win, tinyViewportWidth, 800);

        expect(win.getWidth()).toBe(min.width);
        expect(win.getX()).toBe(MARGIN);
        // Spills past the shrunk viewport's right edge rather than being
        // forced below its min-size.
        expect(win.getX() + win.getWidth()).toBeGreaterThan(tinyViewportWidth - MARGIN);
    });
});
