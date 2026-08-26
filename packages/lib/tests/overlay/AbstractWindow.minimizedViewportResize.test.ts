// Regression: minimized windows did not reposition when the viewport was
// resized. AbstractWindow.onViewportResize() short-circuited for every
// window state except "maximized", so a window docked in the minimized
// stack never triggered AbstractWindow.relayoutMinimizedStack() in reaction
// to a live resize — it only relaid the stack when some *other* window's own
// state transition (minimize/restore/maximize) happened to trigger it. Fixed
// by also relaying out the stack (without touching the resized window's own
// geometry) when the resizing window itself is minimized.
//
// Own file, mirroring Dock.lifecycle.test.ts's rAF/timer-mocking convention:
// Window.show() schedules a real entrance rAF plus a fallback timer, neither
// of which needs to fire for this test (only the synchronous state flip and
// the resize handler under test matter), and letting the fallback timer fire
// later against a reset DOM throws.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

describe('AbstractWindow — minimized stack repositions on viewport resize', () => {
    let config: ReturnType<typeof makeConfig>;

    function makeConfig(height: number) {
        return {
            rootMountOffset: { x: 0, y: 0 },
            viewport:        { width: 1280, height },
            scrollBarWidth:  15,
            fontMetrics,
            themeVars:       {},
        };
    }

    beforeEach(() => {
        config = makeConfig(800);
        installTestDOM(config);

        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(() => 0);
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((): number => 0) as typeof setTimeout);
    });

    // Drop any window left registered before the DOM resets, so a later
    // test's own relayoutMinimizedStack() sweep doesn't touch a dead handle.
    afterEach(() => {
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** Models a live viewport resize: change the size, then run the resize handler. */
    function resizeViewport(win: Window, height: number): void {
        config.viewport.height = height;
        (win as unknown as { onViewportResize(): void }).onViewportResize();
    }

    it('relayouts a minimized window onto the new viewport height', () => {
        const win = new Window('W');
        win.show();
        win.minimize();

        // Baseline: position the already-minimized window against the
        // current (800px) viewport height.
        resizeViewport(win, 800);
        const y1 = win.getY();

        // Shrinking the viewport must move the dock strip up with it, by
        // exactly the height delta (same dock slot, same header-height floor
        // on both calls). Before the fix, onViewportResize() no-oped for a
        // minimized window and y2 stayed equal to y1.
        resizeViewport(win, 500);
        const y2 = win.getY();

        expect(y2).toBe(y1 - 300);
    });
});
