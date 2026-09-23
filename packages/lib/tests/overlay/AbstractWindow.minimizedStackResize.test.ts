// The minimized dock's response to a real viewport `resize`, in its own file —
// plans/implemented/environment-read-caching.md, Expected Behaviour row S1.
//
// `Event`'s viewportListenerMap is module-level state and the window listener
// is attached only when a type is first registered (core/Event.ts), while
// `DOM.reset()` replaces the sink without clearing that map. Once an earlier
// case in the same file has registered "resize" against a stale window handle,
// a later registration silently never re-attaches and no dispatch reaches it —
// the reasoning `tests/overlay/Notification.resize.test.ts` records for
// itself. So this file holds the one dispatching case, and the dock's other
// rows (W1-W9) drive its handler directly from
// `AbstractWindow.minimizedViewportResize.test.ts`.
//
// What the case pins is the cost of one event: before the fix each of the four
// docked windows answered it with a whole-dock relayout, so the dock read the
// viewport 16 times and the dock-slot theme variable 16 more; now one listener
// answers it once, the relayout reads each once, and the theme variable is
// served from the cache `core/ThemeVars.ts` filled while the windows were
// minimized.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

/** Windows the case shows, and how many of them it docks. */
const WINDOW_COUNT    = 7;
const MINIMIZED_COUNT = 4;

/**
 * One viewport read for the dock's own relayout plus one for each window that
 * still answers a resize itself — the three that stay in the normal state.
 */
const EXPECTED_VIEWPORT_READS = 1 + (WINDOW_COUNT - MINIMIZED_COUNT);

function config() {
    return {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics,
        themeVars:       {},
    };
}

describe('AbstractWindow — one dispatched resize re-anchors the dock once', () => {
    afterEach(() => {
        // The static open-window set outlives the DOM, and the dock writes
        // setX/setY to each minimized entry — drain it, then relayout once so
        // the dock releases its listener before the sink is replaced.
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
        (AbstractWindow as unknown as { relayoutMinimizedStack(): void }).relayoutMinimizedStack();

        vi.restoreAllMocks();
        DOM.reset();
    });

    it('S1: one relayout, one viewport read per listener, and no theme-variable read', () => {
        installTestDOM(config());

        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(() => 0);
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((): number => 0) as typeof setTimeout);
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });

        const windows = Array.from({ length: WINDOW_COUNT }, (_, i) => new Window(`W${i}`));

        for (const win of windows) {
            win.show();
        }

        const docked = windows.slice(0, MINIMIZED_COUNT);

        for (const win of docked) {
            win.minimize();
        }

        const restingY = docked.map((win) => win.getY());

        // Installed only now, so the counts below are the resize event's own.
        const relayout     = vi.spyOn(AbstractWindow as unknown as { relayoutMinimizedStack(): void }, 'relayoutMinimizedStack');
        const viewportRead = vi.spyOn(DOM.source, 'getViewportSize');
        const themeVarRead = vi.spyOn(DOM.source, 'getThemeVar');

        const windowHandle = DOM.source.getWindow();

        DOM.sink.dispatchEvent(windowHandle, makeEvent(windowHandle, 'resize'));

        expect(relayout).toHaveBeenCalledTimes(1);
        expect(viewportRead).toHaveBeenCalledTimes(EXPECTED_VIEWPORT_READS);
        expect(themeVarRead).not.toHaveBeenCalled();
        expect(docked.map((win) => win.getY())).toEqual(restingY);
    });
});
