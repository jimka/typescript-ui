// The toast's auto-dismiss timer, in its own file.
//
// Auto-dismiss is the only `Notification` concern that needs a fake clock: the
// stack's other behaviours are synchronous, so the sibling files run under real
// timers and would have to opt every case out of the fake one. `vi.useFakeTimers()`
// also fakes `Date`, which is what makes the pause/resume arithmetic below exact
// rather than approximate — the elapsed term in `pauseTimer`'s subtraction is
// exactly what a case advanced the clock by.
//
// This supersedes half of `Notification.test.ts`'s SCOPE note. That header
// claimed the entrance animation *and* the auto-dismiss both need a real-DOM
// (jsdom-event or browser) harness. Only the entrance animation does: its `from`
// styles defer through a double `requestAnimationFrame`, which the offline
// harness records as a no-op, so the transition never advances. Auto-dismiss
// needs a clock rather than a real DOM, and a fake one drives it fine.
//
// Two cases deliberately outlive their DOM — the whole point of the fix is that
// `DOM.reset()` cancels a dismiss still waiting — so the teardown blanks the
// static fields instead of disposing the survivors; see the `beforeEach` comment.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Notification } from '~/overlay/Notification';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import type { RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * The toast duration every case below opens with. Spelled out rather than taken
 * from `show`'s default so a change to that default cannot silently retune the
 * arithmetic the expected op lists encode.
 */
const DISMISS_MS = 3000;

/**
 * `MIN_RESUMED_MS`, mirrored from `Notification` (`:76`) so E2's clamped
 * remainder is derived rather than guessed. Private, hence the copy.
 */
const MIN_RESUMED_MS = 8000;

/**
 * `DISMISS_DURATION_MS` (`Notification:77`) plus `Animation`'s default
 * `fallbackBufferMs` of 40 — the deadline `Animation.play` arms for the exit
 * transition. Both are private, hence the copy; E10 advances past this to reach
 * `finishDismiss`, which is what takes the toast out of the static stack.
 */
const DISMISS_ANIMATION_DEADLINE_MS = 200 + 40;

/**
 * Toasts shown by E8, matching `NotificationHistory.test.ts`'s eviction-cap
 * case — one past the 50-entry `HISTORY_CAP`, which is the shape that leaves
 * the most timers armed at once anywhere in the suite.
 */
const CAP_CASE_TOASTS = 51;

let sink: RecordingDOMSink;

type NotificationStatics = {
    activeNotifications: Notification[];
    history:             unknown[];
    modalCount:          number;
    hoverCount:          number;
};

/** The class's private static state; the constructor is private, as in the sibling files. */
function statics(): NotificationStatics {
    return Notification as unknown as NotificationStatics;
}

/** The toast most recently shown. */
function liveToast(): Notification {
    const active = statics().activeNotifications;

    return active[active.length - 1];
}

/**
 * Replaces a toast's private dismiss entry point with a recording no-op.
 *
 * The implementation must stay empty. The real `dismiss()` writes through an
 * element handle a preceding `DOM.reset()` has discarded, so letting it run
 * would throw out of `vi.advanceTimersByTime` and a red run would report a
 * crash instead of a failed assertion.
 *
 * @param toast - The toast to spy on.
 * @returns The spy, for asserting it was never called.
 */
function spyOnDismiss(toast: Notification): MockInstance<() => void> {
    return vi.spyOn(toast as unknown as { dismiss(): void }, 'dismiss').mockImplementation(() => {});
}

/**
 * A toast's own pause/resume pair. `resumeAllTimers(false)` — the unclamped
 * resume — is reachable only from `releaseHoverHold`, which needs a synthesized
 * `mouseover`/`mouseout` pair, so E3 drives the instance methods the hover path
 * calls instead.
 *
 * @param toast - The toast whose timer to drive.
 * @returns The toast, typed down to its two private timer methods.
 */
function timerControls(toast: Notification): { pauseTimer(): void; restartTimer(clampMin: boolean): void } {
    return toast as unknown as { pauseTimer(): void; restartTimer(clampMin: boolean): void };
}

/** The toast's private auto-dismiss timer field. */
function dismissTimer(toast: Notification): unknown {
    return (toast as unknown as { _dismissTimer: unknown })._dismissTimer;
}

/**
 * The seam timer ops recorded since `from`, as `['setTimeout', 3000]`-style
 * pairs. A `clearTimeout`'s recorded argument is the host's opaque timer id, so
 * it is flattened to `null` — the op's presence and position is the contract,
 * not which id it carried.
 *
 * @param recording - The installed recording sink.
 * @param from - Index into `writes` to start at, so a case can ignore the setup's ops.
 * @returns One pair per recorded `setTimeout` / `clearTimeout`, in order.
 */
function timerOps(recording: RecordingDOMSink, from: number): Array<[string, unknown]> {
    return recording.writes
        .slice(from)
        .filter(w => w.op === 'setTimeout' || w.op === 'clearTimeout')
        .map(w => [w.op, w.op === 'setTimeout' ? w.args[0] : null] as [string, unknown]);
}

beforeEach(() => {
    sink = installTestDOM(CONFIG);

    // The static stack, the history ring and the two hold counters all outlive
    // DOM.reset(), so a case that ends with a live toast would otherwise leak
    // into the next one. A leaked hold matters most: a toast shown while a hold
    // is open clears its own timer immediately, which would make E1 fail for a
    // reason that has nothing to do with the seam.
    statics().activeNotifications = [];
    statics().history             = [];
    statics().modalCount          = 0;
    statics().hoverCount          = 0;

    vi.useFakeTimers();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    DOM.reset();
});

describe('Notification auto-dismiss timer — scheduled through the DOM seam', () => {
    it('arms the auto-dismiss through the seam, once, at the requested duration', () => {
        Notification.show('msg', 'info', DISMISS_MS);

        expect(timerOps(sink, 0)).toEqual([['setTimeout', DISMISS_MS]]);
    });

    it('clears and re-arms through the seam across a modal pause/resume, clamped', () => {
        Notification.show('msg', 'info', DISMISS_MS);
        Notification.pauseAll();
        Notification.resumeAll();

        // No time elapsed between the pause and the resume, so the captured
        // remainder is the full duration and the modal clamp raises it.
        expect(timerOps(sink, 0)).toEqual([
            ['setTimeout',   DISMISS_MS],
            ['clearTimeout', null],
            ['setTimeout',   MIN_RESUMED_MS],
        ]);
    });

    it('clears and re-arms through the seam across a hover pause/resume, unclamped', () => {
        const elapsedMs = 1000;

        Notification.show('msg', 'info', DISMISS_MS);
        vi.advanceTimersByTime(elapsedMs);

        const toast = liveToast();

        timerControls(toast).pauseTimer();
        timerControls(toast).restartTimer(false);

        expect(timerOps(sink, 0)).toEqual([
            ['setTimeout',   DISMISS_MS],
            ['clearTimeout', null],
            ['setTimeout',   DISMISS_MS - elapsedMs],
        ]);
    });

    it('clears the pending auto-dismiss through the seam when the toast dismisses itself', () => {
        Notification.show('msg', 'info', DISMISS_MS);

        const toast  = liveToast();
        const before = sink.writes.length;

        (toast as unknown as { dismiss(): void }).dismiss();

        const clears = timerOps(sink, before).filter(([op]) => op === 'clearTimeout');

        expect(clears).toEqual([['clearTimeout', null]]);
    });
});

describe('Notification auto-dismiss timer — cancelled by a teardown', () => {
    it('does not dismiss after DOM.reset() swept the armed timer', () => {
        Notification.show('msg', 'info', DISMISS_MS);

        // The spy goes in after show() — there is no instance to spy on before
        // it — and before the reset, since it is what keeps a red run from
        // throwing out of the clock advance.
        const dismiss = spyOnDismiss(liveToast());

        DOM.reset();
        vi.advanceTimersByTime(DISMISS_MS + 1000);

        expect(dismiss).not.toHaveBeenCalled();
    });

    it('does not dismiss after DOM.reset() swept a timer re-armed by a resume', () => {
        Notification.show('msg', 'info', DISMISS_MS);
        Notification.pauseAll();
        Notification.resumeAll();

        const dismiss = spyOnDismiss(liveToast());

        DOM.reset();
        vi.advanceTimersByTime(MIN_RESUMED_MS + 1000);

        expect(dismiss).not.toHaveBeenCalled();
    });

    it('does not dismiss after the toast was disposed by its owner', () => {
        Notification.show('msg', 'info', DISMISS_MS);

        const toast   = liveToast();
        const dismiss = spyOnDismiss(toast);

        // No DOM.reset() here: a dispose that arrives on its own leaves the
        // seam's sweep out of it, so the timer has to be cleared by the
        // destructor or nothing cancels it.
        toast.dispose();
        vi.advanceTimersByTime(DISMISS_MS + 1000);

        expect(dismiss).not.toHaveBeenCalled();
    });

    it('dismisses none of a full stack of toasts after DOM.reset()', () => {
        const dismissals: Array<MockInstance<() => void>> = [];

        for (let i = 0; i < CAP_CASE_TOASTS; i += 1) {
            Notification.show(`msg ${i}`, 'info', DISMISS_MS);
            dismissals.push(spyOnDismiss(liveToast()));
        }

        DOM.reset();
        vi.advanceTimersByTime(MIN_RESUMED_MS + 2000);

        expect(dismissals.filter(d => d.mock.calls.length > 0)).toEqual([]);
    });
});

describe('Notification auto-dismiss timer — unchanged behaviour', () => {
    it('arms nothing for a persistent toast', () => {
        Notification.show('msg', 'info', 0);

        expect(timerOps(sink, 0)).toEqual([]);
        expect(dismissTimer(liveToast())).toBeNull();
    });

    it('still dismisses on time, and still completes its own exit animation', () => {
        Notification.show('msg', 'info', DISMISS_MS);

        const toast = liveToast();

        // The exit animation arms its own deadline the moment the dismiss
        // starts, so the toast leaves the stack only once that has run too.
        vi.advanceTimersByTime(DISMISS_MS);
        expect(statics().activeNotifications).toContain(toast);

        vi.advanceTimersByTime(DISMISS_ANIMATION_DEADLINE_MS + 60);
        expect(statics().activeNotifications).not.toContain(toast);
    });
});
