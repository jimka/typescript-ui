// Regression: setWindowState("minimized")'s dock animation shrinks the window
// toward computeDockRect() (a compact header-height strip) via setWidth/
// setHeight, but those setters also clamp to the window's own explicit
// minSize — the 200px body floor initChrome seeds for ordinary border-drag
// resizing. That floor was never relaxed for the dock transition, so the
// window could never actually collapse below it: it stayed pinned at its
// normal-resize minimum (mostly off-screen, since it is still positioned at
// the dock strip's y) instead of reaching the intended strip height. Fixed by
// relaxing the explicit minSize to 0x0 while minimized.
//
// A second regression sits on the way back out: the floor used to be
// restored synchronously, before the growth tween away from "minimized" had
// moved the window at all. Since the window's live size is still down at the
// dock strip's height at that point, reinstating a 200px CSS min-height
// instantly snapped the box back up to 200 — a visible flicker — before the
// tween's own interpolated values caught up past it. Fixed by deferring the
// restore to the growth tween's completion (AbstractWindow.restoreNormalMinSize),
// guarded so an interrupted restore can't clobber the real floor with the
// still-relaxed 0x0 it left behind.
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

type WithNormalMinSize = { _normalMinSize: { width: number; height: number } | null };

describe('AbstractWindow minimize — normal-resize min size must not block the dock shrink', () => {
    afterEach(() => DOM.reset());

    it('relaxes the explicit min size while minimized', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const normalMin = win.getMinSizeConstraint();
        expect(normalMin).not.toBeNull();
        expect(normalMin!.height).toBe(200);

        win.minimize();
        expect(win.getMinSizeConstraint()).toEqual({ width: 0, height: 0 });
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

    it('does not restore the floor synchronously when leaving the minimized state', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.minimize();
        win.toggleMinimize(); // starts the "normal" growth tween

        // The floor must stay relaxed until the growth tween's own completion
        // reinstates it — restoring it here, before the tween has grown the
        // window back past 200px, is exactly the flicker this test guards.
        expect(win.getMinSizeConstraint()).toEqual({ width: 0, height: 0 });

        win.setHeight(10);
        expect(win.getHeight()).toBe(10);
    });

    it('preserves the true floor across an interrupted restore, instead of re-capturing the still-relaxed 0x0', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const normalMin = win.getMinSizeConstraint();

        win.minimize();
        win.toggleMinimize(); // restore started; never completes offline (rAF is never driven)
        win.minimize();       // interrupts the restore before its own tween finished

        // Re-entering "minimized" must not re-capture getMinSizeConstraint() —
        // which would read back the still-relaxed 0x0 the interrupted restore
        // left in place — over the real floor a later restore needs to reinstate.
        expect((win as unknown as WithNormalMinSize)._normalMinSize).toEqual(normalMin);
    });
});
