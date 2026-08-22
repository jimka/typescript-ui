// Regression: setWindowState("minimized")'s dock animation shrinks the window
// toward computeDockRect() (a compact header-height strip) via setWidth/
// setHeight, but those setters also clamp to the window's own explicit
// minSize — the 200px body floor initChrome seeds for ordinary border-drag
// resizing. That floor was never relaxed for the dock transition, so the
// window could never actually collapse below it: it stayed pinned at its
// normal-resize minimum (mostly off-screen, since it is still positioned at
// the dock strip's y) instead of reaching the intended strip height. Fixed by
// relaxing the explicit minSize to 0x0 while minimized and restoring it
// before the window is allowed to grow back.
import { describe, it, expect, afterEach } from 'vitest';
import { Window } from '~/overlay/Window';
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

describe('AbstractWindow minimize — normal-resize min size must not block the dock shrink', () => {
    afterEach(() => DOM.reset());

    it('relaxes the explicit min size while minimized, and restores it on un-minimize', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const normalMin = win.getMinSizeConstraint();
        expect(normalMin).not.toBeNull();
        expect(normalMin!.height).toBe(200);

        win.minimize();
        expect(win.getMinSizeConstraint()).toEqual({ width: 0, height: 0 });

        win.toggleMinimize(); // back to "normal"
        expect(win.getMinSizeConstraint()).toEqual(normalMin);
    });

    it('lets setHeight/setWidth shrink below the normal floor once minimized', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.setWidth(400);
        win.setHeight(200);

        win.minimize();

        // Below the 200px normal-resize floor: must stick now that it is relaxed,
        // where before the fix these were clamped straight back up to 200/180.
        win.setHeight(26);
        win.setWidth(120);
        expect(win.getHeight()).toBe(26);
        expect(win.getWidth()).toBe(120);
    });

    it('re-enforces the normal floor once the window leaves the minimized state', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.minimize();
        win.toggleMinimize(); // back to "normal"

        win.setHeight(10);
        expect(win.getHeight()).toBe(200);
    });
});
