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
//
// W11-W17 are plans/implemented/rail-minimized-dock-slot.md's rows — the
// dock's row holds only the minimized windows no rail holds. W18-W28 are that
// plan's audit: attaching a rail to an already-docked window hides it (or the
// slot its attach gives away is laid out under a window still on screen),
// detaching one shows it again (or it holds that slot invisibly, with its
// handle gone and no way back), and a detach undoes everything the collapse
// installed rather than writing a resting state of its own over the top — see
// the plan's Implementation Notes. The in-flight half of that is in
// AbstractWindow.railHandoverAnimated.test.ts, which this file's
// reduced-motion mock rules out.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Rail } from '~/overlay/Rail';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// One dock slot's pitch: DEFAULT_MIN_DOCK_WIDTH_PX (200) plus
// SNAP_DOCK_GAP_PX (4), both module-private to AbstractWindow.ts.
const DOCK_SLOT_PITCH_PX = 204;

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

    /** A mounted WEST rail, the minimize target a rail-held window gets. */
    function mountedRail(): Rail {
        const rail = new Rail({ edge: Placement.WEST });

        rail.mount();

        return rail;
    }

    /** Shows a window at an explicit position, so a dock write to it is unmistakable. */
    function shownWindowAt(title: string, x: number, y: number): Window {
        const win = new Window(title, { x, y });

        win.show();

        return win;
    }

    /** One window's dock slot index — the slot its minimize tween aims at. */
    function dockSlotIndex(win: Window): number {
        return (win as unknown as { computeDockSlotIndex(): number }).computeDockSlotIndex();
    }

    /**
     * The values `spy` (a `DOM.sink.apply` spy) wrote for one style property
     * against `win`'s element, in call order — the only way to see a property
     * `Animation` wrote through its own buffer, which leaves the component's
     * cached value untouched.
     */
    function styleWritesFor(
        spy:  ReturnType<typeof vi.spyOn>,
        win:  Window,
        prop: string,
    ): Array<string | null> {
        const target = win.getElement();

        return spy.mock.calls
            .filter((args: unknown[]) => args[0] === target)
            .map((args: unknown[]) => (args[1] as { style?: Record<string, string | null> }).style)
            .filter((style: Record<string, string | null> | undefined): style is Record<string, string | null> =>
                style !== undefined && prop in style)
            .map((style: Record<string, string | null>) => style[prop]);
    }

    /**
     * The style properties `spy` wrote against `win`'s element, flattened into
     * one list in write order — what the per-property lists above cannot show:
     * which property was written before which.
     */
    function styleWriteOrder(spy: ReturnType<typeof vi.spyOn>, win: Window): string[] {
        const target = win.getElement();

        return spy.mock.calls
            .filter((args: unknown[]) => args[0] === target)
            .map((args: unknown[]) => (args[1] as { style?: Record<string, string | null> }).style)
            .filter((style: Record<string, string | null> | undefined): style is Record<string, string | null> =>
                style !== undefined)
            .flatMap((style: Record<string, string | null>) => Object.keys(style));
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
        const rail = mountedRail();

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

    it('W11: a rail-held window between two docked ones leaves no gap in the row', () => {
        const rail = mountedRail();

        const a = shownWindow('A');
        const b = shownWindow('B');
        const c = shownWindow('C');

        b.setRail(rail);

        a.minimize();
        b.minimize();
        c.minimize();

        expect(a.getX()).toBe(0);
        expect(c.getX()).toBe(DOCK_SLOT_PITCH_PX);
        expect(c.getY()).toBe(a.getY());
    });

    it('W12: the dock writes no geometry to a window its rail holds', () => {
        const rail = mountedRail();

        const a = shownWindow('A');
        const b = shownWindow('B');

        b.setRail(rail);
        b.minimize();

        const rectBefore = b.getRect();

        a.minimize();
        relayoutStack();

        expect(b.getRect()).toEqual(rectBefore);
    });

    it('W13: a viewport resize moves the docked window and leaves the rail-held one alone', () => {
        const rail = mountedRail();

        const a = shownWindow('A');
        const b = shownWindow('B');

        b.setRail(rail);

        a.minimize();
        b.minimize();

        resizeViewport(800);

        const y1        = a.getY();
        const rectBefore = b.getRect();

        resizeViewport(500);

        expect(a.getY()).toBe(y1 - 300);
        expect(b.getRect()).toEqual(rectBefore);
    });

    it('W14: attaching a rail to a docked window closes the slot it leaves', () => {
        const rail = mountedRail();

        const a = shownWindow('A');
        const b = shownWindow('B');

        a.minimize();
        b.minimize();

        expect(b.getX()).toBe(DOCK_SLOT_PITCH_PX);

        a.setRail(rail);

        expect(b.getX()).toBe(0);
    });

    it('W15: detaching a rail from a minimized window joins it into the next free slot', () => {
        const rail = mountedRail();

        const a = shownWindow('A');
        const b = shownWindowAt('B', 300, 200);

        b.setRail(rail);

        a.minimize();
        b.minimize();

        expect(b.getX()).toBe(300);

        b.setRail(null);

        expect(b.getX()).toBe(DOCK_SLOT_PITCH_PX);
        expect(b.getY()).toBe(a.getY());
    });

    it('W16: setRail re-derives the dock listener on attach and detach', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        win.minimize();

        expect(listenerInstalled()).toBe(true);

        win.setRail(rail);

        expect(listenerInstalled()).toBe(false);

        win.setRail(null);

        expect(listenerInstalled()).toBe(true);
    });

    it('W17: a rail-held window takes no dock slot in another window\'s own index', () => {
        const rail = mountedRail();

        const b = shownWindow('B');
        const a = shownWindow('A');

        b.setRail(rail);
        b.minimize();

        expect(dockSlotIndex(a)).toBe(0);
    });

    it('W18: attaching a rail to a docked window hides it, handing it to the rail', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        win.minimize();

        // Docked: the window itself is the strip the user sees.
        expect(win.isDisplayed()).toBe(true);

        win.setRail(rail);

        // Handed over: the rail's handle is now its representation, so the
        // window leaves the screen along with its slot.
        expect(win.isDisplayed()).toBe(false);
    });

    it('W19: the slot a rail attach gives away holds no second visible window', () => {
        const rail = mountedRail();

        const a = shownWindow('A');
        const b = shownWindow('B');
        const c = shownWindow('C');

        a.minimize();
        b.minimize();
        c.minimize();

        expect(b.getX()).toBe(DOCK_SLOT_PITCH_PX);

        // The middle window goes to the rail: C closes up into slot 1, which
        // is the rect B is frozen at, so only B's hide keeps the two off each
        // other.
        b.setRail(rail);

        expect(a.getX()).toBe(0);
        expect(c.getX()).toBe(DOCK_SLOT_PITCH_PX);
        expect(b.getX()).toBe(DOCK_SLOT_PITCH_PX);
        expect(b.isDisplayed()).toBe(false);
        expect(c.isDisplayed()).toBe(true);
    });

    it('W20: detaching the rail again returns the window to the row it came from', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        win.minimize();
        win.setRail(rail);
        win.setRail(null);

        // The attach's hide is undone by its own reverse: the window is a
        // docked strip again, not an invisible occupant of the slot the
        // relayout just handed back to it.
        expect(win.isDisplayed()).toBe(true);
        expect(win.getX()).toBe(0);
    });

    it('W21: a window round-tripped through a rail still restores', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        win.minimize();
        win.setRail(rail);
        win.setRail(null);

        // The rail is gone, so `setWindowState`'s rail re-show cannot run and
        // the handle that would restore it has been removed — the window has
        // to come back through the ordinary dock path.
        win.restore();

        expect(win.getWindowState()).toBe('normal');
        expect(win.isDisplayed()).toBe(true);
    });

    it('W22: detaching after a collapse clears the genie the collapse left behind', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        // Rail-attached before minimizing, so this takes the collapse path:
        // the reduced-motion mock commits the genie's end state — the
        // shrink-into-the-rail transform and `opacity: 0` — synchronously.
        win.setRail(rail);
        win.minimize();

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.setRail(null);

        // Back in the dock, so the collapse's visuals are *undone*, not
        // overwritten with a resting state of the window's own: the element
        // ends carrying neither property, indistinguishable from a window no
        // collapse ever touched. Read from the writes themselves — the
        // window's cached transform / opacity never saw the animation, which
        // wrote through an inline-style buffer of its own.
        expect(styleWritesFor(apply, win, 'transform').pop()).toBeNull();
        expect(styleWritesFor(apply, win, 'opacity').pop()).toBeNull();

        // And the caches end as they began, so nothing is folded into a later
        // transform write or replayed after an inline-style wipe.
        expect(win.getTransform()).toBeNull();
        expect(win.getOpacity()).toBeNull();
    });

    it('W23: a detach undoes nothing when no collapse ever applied', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        // Minimized while docked, so no collapse ever ran and there is no
        // genie to undo.
        win.minimize();

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.setRail(rail);
        win.setRail(null);

        // Nothing is written at all — asserting the caches end null would pass
        // either way, since undoing a collapse ends by clearing those very
        // caches. Only the absence of the writes distinguishes the two.
        expect(styleWritesFor(apply, win, 'transform')).toEqual([]);
        expect(styleWritesFor(apply, win, 'opacity')).toEqual([]);
        expect(styleWritesFor(apply, win, 'transition')).toEqual([]);
    });

    it('W25: a restore ends the collapse\'s ownership, so a later detach undoes nothing', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        // A real collapse, then the expansion that supersedes it.
        win.setRail(rail);
        win.minimize();
        win.restore();
        win.setRail(null);

        // Docked from here, with no collapse in the picture: the window's
        // styles belong to the dock, and a later rail round-trip must leave
        // them alone.
        win.minimize();

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.setRail(rail);
        win.setRail(null);

        expect(styleWritesFor(apply, win, 'transform')).toEqual([]);
        expect(styleWritesFor(apply, win, 'opacity')).toEqual([]);
        expect(styleWritesFor(apply, win, 'transition')).toEqual([]);
    });

    it('W27: a detach after a completed collapse does not announce a second minimize', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        const minimizes: number[] = [];

        win.on('minimize', () => { minimizes.push(1); });

        // The collapse runs to completion here, so it has already emitted and
        // owes nothing: the debt it settled must not be paid twice.
        win.setRail(rail);
        win.minimize();

        expect(minimizes.length).toBe(1);

        win.setRail(null);

        expect(minimizes.length).toBe(1);
    });

    it('W28: attaching a rail to a docked window does not announce a second minimize', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        const minimizes: number[] = [];

        win.on('minimize', () => { minimizes.push(1); });

        // The docked path emits synchronously and defers nothing, so the
        // hand-over has no debt of its own to settle.
        win.minimize();

        expect(minimizes.length).toBe(1);

        win.setRail(rail);

        expect(minimizes.length).toBe(1);
    });

    it('W26: the undo takes the transition off before it writes through it', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        win.setRail(rail);
        win.minimize();

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.setRail(null);

        // Order is load-bearing: a transform or opacity written while the
        // collapse's transition is still installed animates through the very
        // rule being removed.
        const order = styleWriteOrder(apply, win);

        expect(order.lastIndexOf('transition')).toBeLessThan(order.indexOf('transform'));
        expect(order.lastIndexOf('transition')).toBeLessThan(order.indexOf('opacity'));
    });

    it('W24: a window detached after a collapse still frees its layer on drop', () => {
        const rail = mountedRail();

        const win = shownWindow('W');

        win.setRail(rail);
        win.minimize();
        win.setRail(null);

        const apply = vi.spyOn(DOM.sink, 'apply');

        // A drag and its drop. `onMouseUp`'s contract is that the closing
        // setTranslate(0, 0) frees the compositor layer — which it can only
        // do while nothing else is cached into the composed transform.
        win.setTranslate(20, 20);
        win.setTranslate(0, 0);

        expect(styleWritesFor(apply, win, 'transform').pop()).toBeNull();
    });
});
