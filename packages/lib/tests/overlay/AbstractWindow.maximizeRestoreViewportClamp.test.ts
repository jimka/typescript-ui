// Regression: restoring a maximized window to "normal" replayed the stale
// pre-maximize rect (`_restoreRect`) verbatim via animateRect(), with no
// viewport clamping. A "normal" window is kept on-screen on every resize by
// fitNormalWindowToViewport(), but that clamp never ran against the rect
// captured before maximizing — so if the viewport shrank while the window sat
// maximized, un-maximizing landed it back at coordinates now outside the
// viewport. Fixed by routing the stored restore rect through the same
// viewport-margin clamp (AbstractWindow.clampRectToViewport) before handing
// it to animateRect() as the restore target.
//
// Forces prefers-reduced-motion (mirroring Dock.lifecycle.test.ts's
// convention) so Animation.tween commits the restore target synchronously —
// offline there is no driven requestAnimationFrame loop to advance the tween
// otherwise.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const MARGIN = 50;

describe('AbstractWindow — restoring from maximized clamps the stale restore rect into the viewport', () => {
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
        config = makeConfig(1600, 1200);
        installTestDOM(config);

        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(() => 0);
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((): number => 0) as typeof setTimeout);
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });
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

    it('clamps a bottom-left window back into a viewport that shrank while maximized', () => {
        const win = new Window('W');
        win.setSize({ width: 300, height: 220 });
        win.show();

        // Bottom-left corner of the large starting viewport.
        win.setX(20);
        win.setY(1200 - 220 - 20);

        win.toggleMaximize();
        expect(win.getWindowState()).toBe('maximized');

        // Shrink the viewport so the pre-maximize position is now off-screen.
        resizeViewport(win, 480, 400);

        win.toggleMaximize();
        expect(win.getWindowState()).toBe('normal');

        // Same margin-clamped placement fitNormalWindowToViewport would have
        // produced had the window been "normal" (not maximized) throughout.
        expect(win.getWidth()).toBe(300);
        expect(win.getHeight()).toBe(220);
        expect(win.getX()).toBe(MARGIN);
        expect(win.getY()).toBe(400 - MARGIN - 220);
    });
});
