// The minimized dock's viewport-resize handling, after
// plans/implemented/environment-read-caching.md — Expected Behaviour rows
// W1-W9, plus W10 for the show-while-minimized path the plan's
// `[^stack-listener]` footnote missed (see the plan's Implementation Notes).
//
// The dock used to be re-anchored by each docked window's own `resize`
// listener, so M docked windows cost M whole-dock relayouts per event. It now
// answers a resize through one listener of its own, owned by a static
// sentinel, installed while it holds a docked window and removed once it holds
// none — the shape `Notification` uses for its toast stack. W1 is this file's
// original regression (a minimized window did not follow a shrinking
// viewport), re-driven through the dock's handler instead of the window's.
//
// Own file, mirroring Dock.lifecycle.test.ts's rAF/timer-mocking convention:
// Window.show() schedules a real entrance rAF plus a fallback timer, neither
// of which needs to fire for these cases, and letting the fallback timer fire
// later against a reset DOM throws. The reduced-motion mock
// (AbstractWindow.maximizeRestoreViewportClamp.test.ts:43) makes every state
// change commit synchronously, so the dock's install/remove — which runs from
// each transition's animation completion — is observable inline.
//
// The dock's listener is driven by calling its static handler directly: a real
// `resize` dispatch needs a file of its own, since `Event`'s viewport listener
// map is module-level (see AbstractWindow.minimizedStackResize.test.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Rail } from '~/overlay/Rail';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

describe('AbstractWindow — the minimized dock answers a viewport resize through one listener', () => {
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
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });
    });

    // Drop any window left registered before the DOM resets, so a later
    // test's own relayoutMinimizedStack() sweep doesn't touch a dead handle,
    // then relayout once against the emptied set so the dock releases its
    // listener — it outlives DOM.reset() otherwise.
    afterEach(() => {
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
        relayoutStack();

        vi.restoreAllMocks();
        DOM.reset();
    });

    /** Models a live viewport resize: change the size, then run the dock's own handler. */
    function resizeViewport(height: number): void {
        config.viewport.height = height;
        (AbstractWindow as unknown as { onStackViewportResize(): void }).onStackViewportResize();
    }

    /** Runs the dock's relayout, which owns the listener's install and removal. */
    function relayoutStack(): void {
        (AbstractWindow as unknown as { relayoutMinimizedStack(): void }).relayoutMinimizedStack();
    }

    /** Whether the dock currently holds its viewport `resize` listener. */
    function listenerInstalled(): boolean {
        return (AbstractWindow as unknown as { stackResizeListenerInstalled: boolean }).stackResizeListenerInstalled;
    }

    /** Spies on the whole-dock relayout, to assert a handler does not run it. */
    function spyOnRelayout(): ReturnType<typeof vi.spyOn> {
        return vi.spyOn(AbstractWindow as unknown as { relayoutMinimizedStack(): void }, 'relayoutMinimizedStack');
    }

    /** Runs one window's own viewport-resize handler. */
    function runOwnResizeHandler(win: Window): void {
        (win as unknown as { onViewportResize(): void }).onViewportResize();
    }

    /** Whether a window holds a viewport `resize` listener of its own. */
    function ownListenerBound(win: Window): boolean {
        return (win as unknown as { _viewportResizeBound: boolean })._viewportResizeBound;
    }

    /** Shows a window, the state every case starts its windows in. */
    function shownWindow(title: string): Window {
        const win = new Window(title);

        win.show();

        return win;
    }

    it('W1: relayouts a minimized window onto the new viewport height', () => {
        const win = shownWindow('W');

        win.minimize();

        // Baseline: position the already-minimized window against the
        // current (800px) viewport height.
        resizeViewport(800);

        const y1 = win.getY();

        // Shrinking the viewport must move the dock strip up with it, by
        // exactly the height delta (same dock slot, same header-height floor
        // on both calls).
        resizeViewport(500);

        expect(win.getY()).toBe(y1 - 300);
    });

    it('W2: the listener follows the dock from empty to occupied and back', () => {
        const win = shownWindow('W');

        expect(listenerInstalled()).toBe(false);

        win.minimize();

        expect(listenerInstalled()).toBe(true);

        win.setWindowState('normal');

        expect(listenerInstalled()).toBe(false);
    });

    it('W3: the listener survives one docked window leaving and goes with the last', () => {
        const a = shownWindow('A');
        const b = shownWindow('B');

        a.minimize();
        b.minimize();

        a.setWindowState('normal');

        expect(listenerInstalled()).toBe(true);

        b.onExitAction();

        expect(listenerInstalled()).toBe(false);
    });

    it('W4: a docked window keeps no viewport listener of its own', () => {
        const win = shownWindow('W');

        win.minimize();

        expect(ownListenerBound(win)).toBe(false);

        win.setWindowState('normal');

        expect(ownListenerBound(win)).toBe(true);
    });

    it('W5: a minimized window\'s own handler no longer relayouts the dock', () => {
        const win = shownWindow('W');

        win.minimize();

        const relayout = spyOnRelayout();

        runOwnResizeHandler(win);

        expect(relayout).not.toHaveBeenCalled();
    });

    it('W6: a maximized window\'s own handler no longer relayouts the dock', () => {
        const open = shownWindow('Open');
        const dock = shownWindow('Docked');

        dock.minimize();
        open.toggleMaximize();

        const relayout = spyOnRelayout();

        runOwnResizeHandler(open);

        expect(relayout).not.toHaveBeenCalled();
    });

    it('W7: a rail-minimized window alone in the dock installs no listener', () => {
        const rail = new Rail({ edge: Placement.WEST });

        rail.mount();

        const win = shownWindow('W');

        win.setRail(rail);
        win.minimize();

        relayoutStack();

        expect(listenerInstalled()).toBe(false);
    });

    it('W8: a window disposed without being closed leaves the open set and the dock', () => {
        const win = shownWindow('W');

        win.minimize();
        win.dispose();

        expect(AbstractWindow.getOpenWindows()).not.toContain(win);
        expect(listenerInstalled()).toBe(false);
    });

    it('W9: disposing a docked window closes the gap it leaves', () => {
        const a = shownWindow('A');
        const b = shownWindow('B');

        a.minimize();
        b.minimize();
        a.dispose();

        expect(b.getX()).toBe(0);
    });

    it('W10: a window shown straight into the minimized state is answered by the dock', () => {
        // Constructed minimized, so `initChrome`'s own `setWindowState`
        // short-circuited and the docked branch never ran. The dock still has
        // to answer its resizes, or nothing does — the window's own handler
        // returns while it is minimized.
        const win = new Window('M', { windowState: 'minimized', x: 100, y: 100 });

        win.show();

        expect(listenerInstalled()).toBe(true);

        // Untouched by `show` itself: the docked branch's preparation never
        // ran, so the dock leaves its rect alone until a resize, as it did
        // before the dock owned the listener.
        expect(win.getX()).toBe(100);
        expect(win.getY()).toBe(100);

        resizeViewport(800);

        const y1 = win.getY();

        resizeViewport(500);

        expect(win.getY()).toBe(y1 - 300);
    });
});
