// The rail hand-over's animated cases, from
// plans/implemented/rail-minimized-dock-slot.md's audit: changing a window's
// rail while the shrink-into-the-rail collapse is still in flight — detaching
// it (R1-R6, R8-R9) or swapping it for another rail (R7).
//
// `setRail` on an already-minimized window hands it between the rail and the
// dock, showing or hiding it as it goes. That hide has a second source: the
// collapse `setWindowState` starts when a rail-held window minimizes ends in
// `setDisplayed(false)`. A detach arriving while that animation is still
// running must therefore cancel it, or the completion lands afterwards and
// re-hides a window that is by then a dock strip again, with no rail and no
// handle left to bring it back.
//
// Own file, because these cases need the animation to actually be pending:
// AbstractWindow.minimizedViewportResize.test.ts mocks
// `prefers-reduced-motion` to commit every transition synchronously, which
// runs the collapse's completion before a detach could ever race it. The
// frame-and-fake-timer harness is AbstractWindow.largeResizeFade.test.ts's,
// itself copied from Animation.test.ts: transitionend never fires offline, so
// Animation.play's completion always arrives through its fallback setTimeout,
// and the offline sink discards its rAF callback, so requestAnimationFrame is
// spied and drained by hand.
//
// R10-R14 are plans/implemented/rail-handover-follow-ups.md's rows — every path that
// supersedes or ends the collapse/expand pair cancels both of its handles.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Rail } from '~/overlay/Rail';
import { Placement } from '~/primitive/Placement';
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

/**
 * Comfortably past WINDOW_ANIM_DURATION_MS (150ms) plus Animation.play's
 * 40ms default fallback buffer — enough for a collapse left running to reach
 * its completion.
 */
const PAST_FALLBACK_MS = 400;

describe('AbstractWindow — changing a window\'s rail mid-collapse', () => {
    let frames:      Map<number, FrameRequestCallback>;
    let nextFrameId: number;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames      = new Map();
        nextFrameId = 1;
        vi.useFakeTimers();
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const id = nextFrameId++;

            frames.set(id, cb);

            return id;
        });
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
            frames.delete(id);
        });
        // Left unmocked, unlike the sibling file: these cases need the
        // collapse to run as a real animation.
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: false, addChangeListener: () => {} });
    });

    afterEach(() => {
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
        (AbstractWindow as unknown as { relayoutMinimizedStack(): void }).relayoutMinimizedStack();

        vi.restoreAllMocks();
        vi.useRealTimers();
        DOM.reset();
    });

    /** Runs every frame callback still pending (i.e. not cancelled) since the last drain. */
    function flushFrame(): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(performance.now());
        }
    }

    /** Drains the frames and fake time a pending animation needs to reach its completion. */
    function runAnimationToCompletion(): void {
        flushFrame();
        flushFrame();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        flushFrame();
    }

    /**
     * The values `spy` (a `DOM.sink.apply` spy) wrote for one style property,
     * in call order.
     *
     * @param spy - The `DOM.sink.apply` spy whose calls are read.
     * @param win - The window whose element the writes are filtered against.
     * @param prop - The style property to collect.
     * @param target - The element to filter on, defaulting to `win`'s current
     *   one. Passed explicitly by a case whose window is destroyed before the
     *   assertion runs, since `getElement()` is null by then.
     *
     * @returns The values written for `prop`, oldest first.
     */
    function styleWritesFor(
        spy:    ReturnType<typeof vi.spyOn>,
        win:    Window,
        prop:   string,
        target: ReturnType<Window['getElement']> = win.getElement(),
    ): Array<string | null> {
        return spy.mock.calls
            .filter((args: unknown[]) => args[0] === target)
            .map((args: unknown[]) => (args[1] as { style?: Record<string, string | null> }).style)
            .filter((style: Record<string, string | null> | undefined): style is Record<string, string | null> =>
                style !== undefined && prop in style)
            .map((style: Record<string, string | null>) => style[prop]);
    }

    /**
     * A shown window holding a mounted WEST rail, minimized so its collapse is
     * in flight *and armed*: the two frames `Animation.play` waits for before
     * `applyTransitionAndTo` are drained, so the `transition` shorthand and
     * the genie's end state are on the element. Cancelling before that point
     * would leave nothing installed to undo, which is the state these cases
     * exist to exercise.
     */
    function collapsingWindow(events?: string[]): { win: Window; rail: Rail } {
        const rail = new Rail({ edge: Placement.WEST });

        rail.mount();

        const win = new Window('W');

        win.show();
        flushFrame();   // drain the two frames show()'s entrance play() queued
        flushFrame();

        // Wired before `setRail`, not in the cases themselves: `ListenerBag.fire`
        // walks the live bucket array, and the rail's own `close` listener
        // unregisters the window mid-fire — so a listener sitting behind it is
        // shifted down and skipped entirely.
        if (events) {
            win.on('minimize', () => { events.push('minimize'); });
            win.on('restore',  () => { events.push('restore');  });
            win.on('close',    () => { events.push('close');    });
        }

        win.setRail(rail);
        win.minimize();
        flushFrame();   // and the two the collapse's own play() queues
        flushFrame();

        return { win, rail };
    }

    /**
     * A window whose *expand* is in flight and armed: the collapse is allowed
     * to land first, then a restore plays the reverse genie and its two frames
     * are drained so the `transition` shorthand and the expansion's end state
     * are on the element. No timer advance may follow before the case arms a
     * collapse of its own, or the expand's fallback deadline fires first and
     * the superseded-clear the R13/R14 rows are about can no longer happen.
     */
    function restoringWindow(events?: string[]): { win: Window; rail: Rail } {
        const { win, rail } = collapsingWindow(events);

        runAnimationToCompletion();

        win.restore();
        flushFrame();
        flushFrame();

        return { win, rail };
    }

    it('R1: a detach cancels the collapse, so its completion cannot re-hide the window', () => {
        const { win } = collapsingWindow();

        // Still on screen: the collapse hides it only at completion, which
        // has not arrived.
        expect(win.isDisplayed()).toBe(true);

        win.setRail(null);

        expect(win.isDisplayed()).toBe(true);

        // The window is a dock strip again. Letting the abandoned collapse
        // land would hide it, and nothing would bring it back — the rail that
        // held its handle is gone.
        runAnimationToCompletion();

        expect(win.isDisplayed()).toBe(true);
    });

    it('R2: a window detached mid-collapse still restores to a visible window', () => {
        const { win } = collapsingWindow();

        win.setRail(null);
        runAnimationToCompletion();

        win.restore();

        expect(win.getWindowState()).toBe('normal');
        expect(win.isDisplayed()).toBe(true);
    });

    it('R4: a cancelled collapse leaves no transition armed on the window', () => {
        const { win } = collapsingWindow();

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.setRail(null);

        // `Animation.cancel` writes no styles — only its `finish` clears the
        // transition it armed — so the detach has to take it off itself, or
        // every later write to this window animates through it.
        expect(styleWritesFor(apply, win, 'transition').pop()).toBeNull();
    });

    it('R5: a window detached mid-collapse drags without a leftover transition or transform', () => {
        const { win } = collapsingWindow();

        win.setRail(null);

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.setTranslate(20, 20);
        win.setTranslate(0, 0);

        // The drop frees the compositor layer, and nothing the cancelled
        // collapse installed is left to animate the drag through.
        expect(styleWritesFor(apply, win, 'transform').pop()).toBeNull();
        expect(styleWritesFor(apply, win, 'transition')).toEqual([]);
        expect(win.getTransform()).toBeNull();
    });

    it('R6: a detach mid-collapse still fires the minimize the collapse owed', () => {
        const events: string[] = [];

        const { win } = collapsingWindow();

        win.on('minimize', () => { events.push('minimize'); });
        win.on('restore',  () => { events.push('restore');  });

        // The collapse's completion is the rail path's only emitter, and the
        // detach cancels it — the event is deferred, not cancelled with it.
        win.setRail(null);

        expect(events).toEqual(['minimize']);

        runAnimationToCompletion();

        // Cancelled, so the completion cannot fire a second one.
        expect(events).toEqual(['minimize']);

        win.restore();

        // And the pair balances, rather than leaving an unmatched restore.
        expect(events).toEqual(['minimize', 'restore']);
    });

    it('R7: re-attaching a different rail mid-collapse fires it once, and the new rail holds the handle', () => {
        const events: string[] = [];

        const { win } = collapsingWindow();

        win.on('minimize', () => { events.push('minimize'); });

        const other = new Rail({ edge: Placement.EAST });

        other.mount();

        win.setRail(other);

        expect(events).toEqual(['minimize']);
        expect(win.getRail()).toBe(other);
    });

    it('R9: a restore voids the collapse\'s debt, so a later minimize announces once', () => {
        const events: string[] = [];

        const { win, rail } = collapsingWindow();

        win.on('minimize', () => { events.push('minimize'); });
        win.on('restore',  () => { events.push('restore');  });

        // Restoring mid-collapse ends the debt rather than parking it: the
        // window is not minimized any more, so there is nothing left to
        // announce, and carrying it forward would spend it on the *next*
        // minimize.
        win.restore();
        win.setRail(null);
        win.minimize();
        win.setRail(rail);

        expect(events).toEqual(['restore', 'minimize']);
    });

    it('R8: the collapse a case starts is actually armed before it is cancelled', () => {
        const apply = vi.spyOn(DOM.sink, 'apply');

        const { win } = collapsingWindow();

        // The guard on every case above: without the helper's frame drains the
        // collapse never reaches `applyTransitionAndTo`, so its end state is
        // never written and there is no genie to undo — R4 and R5 would be
        // asserting against a collapse that installed nothing. The genie
        // transform is what only the armed state puts on the element; a
        // transition alone would also match the entrance animation's.
        const genie = (win as unknown as { railGenieTransform(): string }).railGenieTransform();

        expect(styleWritesFor(apply, win, 'transform').pop()).toBe(genie);
    });

    it('R3: a collapse left alone still hides the window it minimizes into the rail', () => {
        const { win } = collapsingWindow();

        // The guard on R1: the cancel must be the detach's doing, not a
        // collapse that never completes on its own.
        runAnimationToCompletion();

        expect(win.isDisplayed()).toBe(false);
    });

    it('R10: a restore mid-collapse leaves the window on screen and restorable', () => {
        const { win } = collapsingWindow();

        win.restore();

        // The expansion supersedes the collapse, so the collapse's completion
        // must not land: it ends in `setDisplayed(false)`, and a window hidden
        // while its state already reads `"normal"` has no route back —
        // `restore()` early-returns on a window that is not minimized, and so
        // does `setWindowState` on the state it is already in.
        runAnimationToCompletion();

        expect(win.isDisplayed()).toBe(true);
        expect(win.getWindowState()).toBe('normal');
    });

    it('R11: a restore mid-collapse announces no minimize after it', () => {
        const events: string[] = [];

        const { win } = collapsingWindow(events);

        win.restore();
        runAnimationToCompletion();

        // The cancelled collapse owes nothing: the window is `"normal"` again,
        // so there is no minimize left to announce, and one arriving after the
        // restore would leave the pair inverted.
        expect(events).toEqual(['restore']);
    });

    it('R12: a close mid-collapse announces no minimize after the close', () => {
        const events: string[] = [];

        const { win } = collapsingWindow(events);

        win.requestClose();
        runAnimationToCompletion();

        // The close ends this window's animated life, so the collapse goes with
        // it — left running, its completion emits a `"minimize"` after the
        // `"close"`, on a window the rail has already dropped.
        expect(events).toEqual(['close']);
    });

    it('R13: a minimize mid-expand runs through a transition the expand cannot clear', () => {
        const { win } = restoringWindow();

        const apply = vi.spyOn(DOM.sink, 'apply');

        // The collapse supersedes the armed expansion. Both fallback deadlines
        // now sit at the same virtual time, and the expansion's was registered
        // first — so left uncancelled it fires first and `finish` clears the
        // `transition` the live collapse is animating through, cutting the genie
        // short at whatever frame it had reached.
        win.minimize();
        flushFrame();
        flushFrame();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        flushFrame();

        const transitions = styleWritesFor(apply, win, 'transition');

        // The collapse armed one of its own — without this the row could pass
        // on an empty list, which is the absence of the mechanism, not its
        // presence.
        expect(transitions[0]).not.toBeNull();

        // And exactly one clear landed: the collapse's own, at its own end.
        expect(transitions.filter((value) => value === null)).toEqual([null]);

        // The collapse still completed on its own terms, so the cancel took the
        // superseded half of the pair and not the live one.
        expect(win.isDisplayed()).toBe(false);
    });

    it('R14: a close mid-expand fades out through a transition the expand cannot clear', () => {
        const { win } = restoringWindow();

        // Captured before the close: `finalize` releases the window's element
        // handle at the fade's completion, and the writes are read afterwards.
        const element = win.getElement();

        const apply = vi.spyOn(DOM.sink, 'apply');

        // R12's other arm, and the only row that reaches `onExitAction`'s
        // *expand* cancel: the close fade arms a transition of its own, and the
        // superseded expansion's deadline — registered first — would clear it
        // out from under the fade.
        win.requestClose();
        flushFrame();
        flushFrame();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        flushFrame();

        const transitions = styleWritesFor(apply, win, 'transition', element);

        expect(transitions[0]).not.toBeNull();
        expect(transitions.filter((value) => value === null)).toEqual([null]);
    });
});
