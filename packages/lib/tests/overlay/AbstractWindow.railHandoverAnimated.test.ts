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
//
// R15-R18 are plans/implemented/animation-finish-transition-clear.md's rows — a
// close arriving inside a rail collapse fades out from the window's resting
// state rather than from the genie, a close arriving at any other time still
// fades from wherever the window already is, and a reverse genie with a rect
// animation beside it still clears its own transition.
//
// R19-R22 are plans/implemented/rail-minimize-restore-event-pairing.md's rows,
// which also invert R9 and R11 — a restore that interrupts the collapse pays
// the deferred `"minimize"` instead of voiding it, so the pair balances.
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

/**
 * The duration `Animation.play` writes into the `transition` shorthand for a
 * window animation, as it appears in the declaration. Spelled out rather than
 * imported because `WINDOW_ANIM_DURATION_MS` is module-private to
 * `AbstractWindow`, and what these rows read is the rendered shorthand text.
 */
const WINDOW_ANIM_DURATION_DECL = '150ms';

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

    /**
     * A shown window with no rail at all, its entrance fade's own two-frame
     * yield already drained. `_railCollapseActive` is `false` on one of these,
     * so `endRailCollapse()` no-ops and the close fade must arm in its own
     * calling task — the arm R17 and R18 read.
     *
     * @returns The shown window.
     */
    function plainShownWindow(): Window {
        const win = new Window('W');

        win.show();
        flushFrame();
        flushFrame();

        return win;
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

    it('R9: a restore pays the collapse\'s debt, so the next minimize announces on its own', () => {
        const events: string[] = [];

        const { win, rail } = collapsingWindow();

        win.on('minimize', () => { events.push('minimize'); });
        win.on('restore',  () => { events.push('restore');  });

        // Restoring mid-collapse pays the debt rather than voiding it: the
        // window did enter `"minimized"`, so the event is owed, and it lands
        // before the `"restore"` that superseded it. The debt is settled by
        // that payment, so the `minimize()` below announces once on its own
        // account and the `setRail` after it adds nothing.
        win.restore();
        win.setRail(null);
        win.minimize();
        win.setRail(rail);

        expect(events).toEqual(['minimize', 'restore', 'minimize']);
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

    it('R11: a restore mid-collapse announces the minimize it owed, before the restore', () => {
        const events: string[] = [];

        const { win } = collapsingWindow(events);

        win.restore();

        // Asserted before the drain, and as an ordered sequence: the owed
        // `"minimize"` lands first, in the same task as the `"restore"`.
        expect(events).toEqual(['minimize', 'restore']);

        runAnimationToCompletion();

        // And the collapse the restore cancelled adds nothing behind them.
        expect(events).toEqual(['minimize', 'restore']);
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

        // Captured before the minimize so the filter below reads removals on
        // this window's own element — one on the body host's cannot satisfy it.
        const element = win.getElement();

        const apply          = vi.spyOn(DOM.sink, 'apply');
        const removeListener = vi.spyOn(DOM.sink, 'removeListener');

        // The collapse supersedes the armed expansion. Both fallback deadlines
        // now sit at the same virtual time, and the expansion's was registered
        // first, so left uncancelled it fires first — which is what used to
        // clear the `transition` the live collapse is animating through and cut
        // the genie short at whatever frame it had reached. `Animation` refuses
        // that clear for a superseded transition now, so the clear count below
        // no longer distinguishes the cancel's presence from the fix's.
        win.minimize();

        // Read before any drain or advance: this is `animateRailCollapse`'s
        // expand cancel releasing the superseded expansion's `transitionend`
        // handle here, rather than one deadline later. It is what pins those two
        // lines — the clear count below no longer does, because with the central
        // fix in `Animation.finish` the cancel and the fix each satisfy it
        // alone. After the central fix a superseded expansion's `finish` writes
        // nothing and calls nothing (`animateRailExpand`'s `play` has no
        // `onComplete`), so the listener release is the only trace left.
        expect(removeListener.mock.calls.filter(
            (args: unknown[]) => args[0] === element && args[1] === 'transitionend',
        )).toHaveLength(1);

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

        const apply          = vi.spyOn(DOM.sink, 'apply');
        const removeListener = vi.spyOn(DOM.sink, 'removeListener');

        // R12's other arm, and the only row that reaches `onExitAction`'s
        // *expand* cancel: the close fade arms a transition of its own, and the
        // superseded expansion's deadline — registered first — used to clear it
        // out from under the fade, before `Animation` stopped a superseded
        // transition from clearing at all.
        win.requestClose();

        // Read before any drain or advance, and for the same reason as R13's:
        // this is `onExitAction`'s expand cancel releasing the superseded
        // expansion's `transitionend` handle, and it is the only trace that
        // cancel still leaves once the central fix has shipped.
        expect(removeListener.mock.calls.filter(
            (args: unknown[]) => args[0] === element && args[1] === 'transitionend',
        )).toHaveLength(1);

        flushFrame();
        flushFrame();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        flushFrame();

        const transitions = styleWritesFor(apply, win, 'transition', element);

        expect(transitions[0]).not.toBeNull();
        expect(transitions.filter((value) => value === null)).toEqual([null]);
    });

    it('R16: a reverse genie with a rect animation beside it still clears its own transition', () => {
        const { win } = collapsingWindow();

        // The collapse is allowed to land, so the restore below plays a reverse
        // genie with nothing of the collapse's own left live beside it.
        runAnimationToCompletion();

        const element = win.getElement();

        // `restoringWindow`'s steps are inlined rather than called, because the
        // helper drains the two frames that run `applyTransitionAndTo`: the
        // genie's `transition` shorthand would be written inside it and a spy
        // installed afterwards would never see it. R8 installs its spy ahead of
        // `collapsingWindow()` for the same reason.
        const apply = vi.spyOn(DOM.sink, 'apply');

        win.restore();
        flushFrame();
        flushFrame();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        flushFrame();

        const transitions = styleWritesFor(apply, win, 'transition', element);

        // A guard rather than a pin: it holds with or without the central fix,
        // because `animateRect`'s `Animation.tween` registers nothing with the
        // transition registry, so the genie is the only live transition on this
        // element. What it catches is an over-application of the fix — most
        // plausibly a later refactor giving `tween` a handle and a
        // `registerTransition` call. The genie would then read as superseded and
        // skip its own clear, leaving `transition` declared on a window that is
        // back on screen and every later write to it animated. A3 does not catch
        // that: its `play` runs on a bare element with no tween beside it.
        //
        // Read at the list's ends rather than by its length, so an unrelated
        // write appearing between them cannot redden the row.
        expect(transitions[0]).toContain(WINDOW_ANIM_DURATION_DECL);
        expect(transitions[transitions.length - 1]).toBeNull();
    });

    it('R15: a close arriving mid-collapse fades out from the window\'s resting state', () => {
        const { win } = collapsingWindow();

        // Captured before the close, as R14's is: the fade's completion
        // releases the handle, and nothing here may read a stale one.
        const element = win.getElement();

        const apply = vi.spyOn(DOM.sink, 'apply');

        // No timer advance may follow before the first assertions: any advance
        // lets the fade arm, and every "last value" below reads the fade's own.
        win.requestClose();

        // `onExitAction` cancels the collapse, which writes no styles, so the
        // genie's transform and opacity would still be on the element when the
        // fade starts. `endRailCollapse` takes them and the collapse's own
        // `transition` back off, and the fade's `from` then re-commits the
        // resting state — the last word on both properties in this task.
        expect(styleWritesFor(apply, win, 'transition', element).pop()).toBeNull();
        expect(styleWritesFor(apply, win, 'transform',  element).pop()).toBe('translate(0, 0) scale(1)');
        expect(styleWritesFor(apply, win, 'opacity',    element).pop()).toBe('1');

        // The `from` is also what defers the arm: `play` writes it, yields two
        // animation frames so the browser reaches a style recalculation with
        // the resting state in place, and only then arms the transition. Phase
        // one alone would pass for a close that never faded at all, because
        // `endRailCollapse`'s writes would be the only ones left.
        flushFrame();
        flushFrame();

        expect(styleWritesFor(apply, win, 'transition', element).pop()).toContain(WINDOW_ANIM_DURATION_DECL);
        expect(styleWritesFor(apply, win, 'transform',  element).pop()).toBe('scale(0.97)');
    });

    it('R17: an ordinary close arms its fade in the same task, with no resting-state write', () => {
        const win = plainShownWindow();

        const element = win.getElement();

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.requestClose();

        // No rail collapse to undo, so no `from` and no two-frame yield: an
        // unconditional `from` would defer `applyTransitionAndTo` by two
        // frames and this list would be empty — roughly 32 ms of dead time on
        // the commonest overlay gesture in the library.
        expect(styleWritesFor(apply, win, 'transition', element)).toHaveLength(1);
        expect(styleWritesFor(apply, win, 'transition', element)[0]).toContain(WINDOW_ANIM_DURATION_DECL);

        // And the window is not moved to a resting transform it is already at.
        expect(styleWritesFor(apply, win, 'transform', element)).not.toContain('translate(0, 0) scale(1)');
    });

    it('R18: a close mid-drag fades from where the window is, not from its resting transform', () => {
        const win = plainShownWindow();

        const element = win.getElement();

        // Before the spy, so the drag's own write is not in the list below.
        win.setTranslate(20, 20);

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.requestClose();

        // R17's other side. An unconditional `from` would write
        // `translate(0, 0) scale(1)` synchronously here, snapping the window
        // back off the drag's position and holding it there for two frames
        // before the fade even starts; the fade's own `to` is the only
        // transform that may land.
        expect(styleWritesFor(apply, win, 'transform', element)).toEqual(['scale(0.97)']);
    });

    it('R19: the owed minimize announces `"minimized"`, the restore `"normal"`', () => {
        const seen: string[] = [];

        const { win } = collapsingWindow();

        win.on('minimize', () => { seen.push(`minimize:${win.getWindowState()}`); });
        win.on('restore',  () => { seen.push(`restore:${win.getWindowState()}`);  });

        // A consumer that reads the state in the handler must see the state the
        // event names. That is what the debt is for: the window's state reads
        // `"minimized"` for the whole shrink, so an interrupted restore that
        // announced only `"restore"` left a transition no event ever reported.
        win.restore();

        expect(seen).toEqual(['minimize:minimized', 'restore:normal']);
    });

    it('R20: the reverse genie replays from the transform the collapse aimed at', () => {
        const { win } = collapsingWindow();

        const target = (win as unknown as { railGenieTransform(): string }).railGenieTransform();

        // Guard: the comparison below is a string equality, so a degenerate
        // target would satisfy it from both sides at once.
        expect(target).not.toContain('NaN');

        const apply = vi.spyOn(DOM.sink, 'apply');

        // The owed `"minimize"` makes the rail raise a handle, and
        // `Rail.handleMainAxisOffset` reads that handle's laid-out position
        // instead of the slot the collapse predicted — but the handle has not
        // been laid out, so it answers `NaN`. Paying the debt before the
        // expansion reads its target therefore hands `Animation.play` a
        // transform the browser drops, and the window expands from nowhere
        // rather than out of the rail.
        win.restore();

        expect(styleWritesFor(apply, win, 'transform')).toEqual([target]);
    });

    it('R21: the handle the owed minimize raises is gone again by the end of the restore', () => {
        const { win, rail } = collapsingWindow();

        const handles: number[] = [];

        // Registered after `collapsingWindow`, so the rail's own listeners are
        // ahead of these in the bucket and each reading is post-rail.
        win.on('minimize', () => { handles.push(rail.getComponents().length); });
        win.on('restore',  () => { handles.push(rail.getComponents().length); });

        win.restore();

        // The rail treats the owed `"minimize"` as any other: it raises a
        // handle, and the `"restore"` behind it takes the handle off. An
        // interrupted restore is therefore indistinguishable from a completed
        // shrink followed at once by a restore, which is the point.
        expect(handles).toEqual([1, 0]);
        expect(rail.getComponents().length).toBe(0);
    });

    it('R22: a maximize mid-collapse pays the debt the same way a restore does', () => {
        const events: string[] = [];

        const { win } = collapsingWindow(events);

        // The payment is gated on leaving `"minimized"` with a rail attached,
        // not on the state being entered — a condition narrowed to
        // `state === "normal"` would drop this arm silently.
        win.setWindowState('maximized');

        expect(events).toEqual(['minimize', 'restore']);
        expect(win.getWindowState()).toBe('maximized');
    });
});
