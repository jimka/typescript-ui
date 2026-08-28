// Regression surface for the large-resize fade path: maximizing, minimizing
// or restoring a window whose target rect changes width or height by more
// than WINDOW_FADE_THRESHOLD_PX (960px) fades the body host out, glides to
// the target rect over WINDOW_ANIM_DURATION_MS with the body host's own
// layout paused (so every glide frame's doLayout still repositions the
// chrome and the body's own box, cheaply, without recursing into the body's
// potentially expensive content relayout), runs that one deferred relayout
// once the glide lands, then fades the body host back in. Smaller
// transitions keep the existing tween untouched.
//
// Frame-and-fake-timer harness copied from Animation.test.ts: transitionend
// never fires offline, so Animation.play's completion always runs through its
// fallback setTimeout, driven with vi.useFakeTimers(). The offline sink
// discards its rAF callback, so requestAnimationFrame is spied and drained by
// hand via flushFrame() — which also cancels correctly, via a matching
// cancelAnimationFrame spy, so a superseded glide's stale frame is dropped
// exactly as it would be in a real browser. flushFrame() passes the current
// (fake-clock-driven) performance.now() as each callback's timestamp, since
// Animation.tween — unlike Animation.play's own rAF use — reads that
// argument to compute progress; vitest's fake timers do advance
// performance.now() in step with vi.advanceTimersByTime(), confirmed
// empirically, which is what makes driving a glide to completion in fake
// time possible at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Component } from '~/core/Component';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 2000, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Comfortably past WINDOW_FADE_DURATION_MS (200ms) + the 40ms default fallback buffer. */
const PAST_FALLBACK_MS = 400;

/**
 * Exactly WINDOW_FADE_DURATION_MS (200ms) + Animation.play's default 40ms
 * fallback buffer — the fade-out leg's own fallback deadline, no more.
 * Advancing by exactly this much fires the fade-out's completion, which
 * pauses the body host's layout and starts the glide to the target rect, in
 * that same synchronous step.
 */
const FADE_LEG_FALLBACK_MS = 240;

/**
 * Mirrors AbstractWindow's own private WINDOW_ANIM_DURATION_MS — the glide's
 * duration. Advancing the fake clock by at least this much after the glide
 * starts, then draining one frame, is enough to land it: Animation.tween
 * clamps its progress to 1 once elapsed time reaches this, regardless of how
 * many intermediate frames actually ran.
 */
const GLIDE_DURATION_MS = 150;

/**
 * The fade-in leg's own fallback deadline: WINDOW_FADE_DURATION_MS (200ms) +
 * WINDOW_FADE_IN_FALLBACK_BUFFER_MS (1000ms, see AbstractWindow.ts) — padded
 * well past the fade-out leg's deadline above so the fallback survives the
 * relayout the glide's landing runs just before this leg is armed.
 */
const FADE_IN_DEADLINE_MS = 1200;

/** Comfortably past FADE_IN_DEADLINE_MS. */
const PAST_FADE_IN_FALLBACK_MS = 1300;

describe('AbstractWindow — large-resize fade path', () => {
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
        // A real cancelAnimationFrame drops a callback before it ever fires;
        // without mirroring that here, a cancelled glide's stale step would
        // still run on the next flushFrame() and no cancellation test below
        // could tell a real cancel from a no-op one.
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
            frames.delete(id);
        });
    });

    afterEach(() => {
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
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

    /** Builds a shown window with a single body child, ready for state toggles. */
    function makeWindow(width: number, height: number): { win: Window; body: Component } {
        const win  = new Window('W');
        const body = new Component();

        win.addComponent(body, { placement: Placement.CENTER });
        win.setSize({ width, height });
        win.show();
        flushFrame();   // drain the two frames show()'s entrance play() queued
        flushFrame();

        return { win, body };
    }

    /** Whether `spy` (a `DOM.sink.addListener` spy) recorded a `transitionend` registration against `target`. */
    function hasTransitionEndListener(spy: ReturnType<typeof vi.spyOn>, target: Handle): boolean {
        return spy.mock.calls.some((args: unknown[]) => args[0] === target && args[1] === 'transitionend');
    }

    /** `opacity` values `spy` (a `DOM.sink.apply` spy) wrote against `target`, in call order. */
    function opacityWritesFor(spy: ReturnType<typeof vi.spyOn>, target: Handle): Array<string | null> {
        return spy.mock.calls
            .filter((args: unknown[]) => args[0] === target)
            .map((args: unknown[]) => (args[1] as { style?: Record<string, string | null> }).style)
            .filter((style: Record<string, string | null> | undefined): style is Record<string, string | null> =>
                style !== undefined && 'opacity' in style)
            .map((style: Record<string, string | null>) => style.opacity);
    }

    /** The handler of the most recent `type` registration `spy` recorded against `target`. */
    function lastListenerFor(spy: ReturnType<typeof vi.spyOn>, target: Handle, type: string): (event: unknown) => void {
        const call = spy.mock.calls.filter((args: unknown[]) => args[0] === target && args[1] === type).pop();

        expect(call).toBeDefined();

        return call![2] as (event: unknown) => void;
    }

    /**
     * Runs a fade-path maximize all the way to the point where the fade-in
     * leg has just been armed: the fade-out lands through its fallback, the
     * glide it starts runs to completion, and the deferred relayout and the
     * fade-in's transition are triggered in that same synchronous step.
     */
    function maximizeToFadeIn(win: Window): void {
        win.toggleMaximize();
        // toggleMaximize's own header-button glyph swap (reflectMaximizeState)
        // schedules a coalesced layout through the unrelated
        // Component.scheduleLayout() queue, which shares this suite's rAF
        // mock. Draining it now keeps it from mixing into the glide's own
        // frames below.
        flushFrame();
        vi.advanceTimersByTime(FADE_LEG_FALLBACK_MS);   // lands the fade-out, pausing the body and starting the glide
        vi.advanceTimersByTime(GLIDE_DURATION_MS);       // the glide's own duration
        flushFrame();                                    // lands the glide: resumes the body (its one relayout) and arms the fade-in
    }

    it('1. a transition exactly at the threshold tweens', () => {
        const { win, body } = makeWindow(1040, 800);
        const doLayout      = vi.spyOn(win, 'doLayout');
        const addListener   = vi.spyOn(DOM.sink, 'addListener');

        win.toggleMaximize();
        flushFrame();

        expect(doLayout).toHaveBeenCalled();
        expect(hasTransitionEndListener(addListener, body.getElement()!)).toBe(false);
        expect(win.getWidth()).not.toBe(2000);
    });

    it('2. one pixel over the threshold fades', () => {
        const { win, body } = makeWindow(1039, 800);
        const doLayout      = vi.spyOn(win, 'doLayout');
        const addListener   = vi.spyOn(DOM.sink, 'addListener');

        win.toggleMaximize();

        expect(doLayout).not.toHaveBeenCalled();
        expect(win.getWidth()).toBe(1039);
        expect(hasTransitionEndListener(addListener, body.getElement()!)).toBe(true);
    });

    it('3. the glide lands the rect and its one deferred relayout runs once', () => {
        const { win } = makeWindow(1039, 800);
        const doLayout = vi.spyOn(win, 'doLayout');

        win.toggleMaximize();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        vi.advanceTimersByTime(GLIDE_DURATION_MS);
        flushFrame();

        expect(win.getX()).toBe(0);
        expect(win.getY()).toBe(0);
        expect(win.getWidth()).toBe(2000);
        expect(win.getHeight()).toBe(800);
        // The glide's own landing step is the only call: every earlier step
        // ran too, but they were all coalesced into this single flush since
        // it happens well past the glide's whole duration.
        expect(doLayout).toHaveBeenCalledTimes(1);
    });

    it('4. the chrome is not what fades', () => {
        const { win, body } = makeWindow(1039, 800);
        const apply = vi.spyOn(DOM.sink, 'apply');

        win.toggleMaximize();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        vi.advanceTimersByTime(GLIDE_DURATION_MS);
        flushFrame();

        expect(opacityWritesFor(apply, body.getElement()!).length).toBeGreaterThan(0);
        expect(opacityWritesFor(apply, win.getElement()!).length).toBe(0);
    });

    it('5. the min-size floor is reinstated only after the rect landed', () => {
        const { win } = makeWindow(1900, 700);

        win.minimize();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        vi.advanceTimersByTime(GLIDE_DURATION_MS);
        flushFrame();

        win.toggleMinimize();

        expect(win.getMinSizeConstraint()).toEqual({ width: 0, height: 0 });
        expect(win.getWidth()).toBe(200);

        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        vi.advanceTimersByTime(GLIDE_DURATION_MS);
        flushFrame();

        expect(win.getWidth()).toBe(1900);
        expect(win.getMinSizeConstraint()!.height).toBe(200);
    });

    it('6. a fade-path minimize hides the body and leaves no fade pending', () => {
        const { win, body } = makeWindow(1900, 700);

        win.minimize();
        vi.advanceTimersByTime(PAST_FALLBACK_MS);
        vi.advanceTimersByTime(GLIDE_DURATION_MS);
        flushFrame();

        expect(body.isDisplayed()).toBe(false);
        expect((win as unknown as { _bodyFadeActive: boolean })._bodyFadeActive).toBe(false);
    });

    it('7. re-toggling mid-fade restores the body\'s opacity', () => {
        const { win, body } = makeWindow(1039, 800);

        win.toggleMaximize();

        const apply = vi.spyOn(DOM.sink, 'apply');

        win.toggleMaximize();

        expect(opacityWritesFor(apply, body.getElement()!)).toContainEqual(null);
        expect((win as unknown as { _bodyFadeActive: boolean })._bodyFadeActive).toBe(false);
    });

    it('8. reduced motion lands in one tick', () => {
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });

        const { win } = makeWindow(1039, 800);
        const doLayout = vi.spyOn(win, 'doLayout');

        win.toggleMaximize();

        expect(win.getWidth()).toBe(2000);
        expect(win.getHeight()).toBe(800);
        expect(doLayout).toHaveBeenCalledTimes(1);
    });

    it('9. a window with no body host still transitions', () => {
        const win = new Window('W');
        win.setSize({ width: 1039, height: 800 });
        win.show();
        flushFrame();
        flushFrame();

        const doLayout = vi.spyOn(win, 'doLayout');

        win.toggleMaximize();

        expect(win.getWidth()).toBe(2000);
        expect(doLayout).toHaveBeenCalledTimes(1);
    });

    // Cases 1-9 all stop at (or skip) the glide; none of them ever reached
    // the fade-in leg. These two cover it.
    it('10. the fade-in leg fades the body back in and then releases the opacity', () => {
        const { win, body } = makeWindow(1039, 800);
        const apply = vi.spyOn(DOM.sink, 'apply');

        maximizeToFadeIn(win);
        vi.advanceTimersByTime(PAST_FADE_IN_FALLBACK_MS);

        // Out to 0, straight to 1 (no `from` restatement — opacity is already
        // 0), then the inline opacity released once the fade owns it no longer.
        expect(opacityWritesFor(apply, body.getElement()!)).toEqual(['0', '1', null]);
        expect((win as unknown as { _bodyFadeActive: boolean })._bodyFadeActive).toBe(false);
    });

    it('11. a late transition start does not cut the fade-in short', () => {
        const { win, body } = makeWindow(1039, 800);
        const addListener   = vi.spyOn(DOM.sink, 'addListener');
        const element       = body.getElement()!;

        maximizeToFadeIn(win);

        const apply = vi.spyOn(DOM.sink, 'apply');

        // The deferred relayout leaves the main thread busy, so the browser
        // only reaches the style recalculation that starts the fade-in 90ms
        // after its styles were written.
        vi.advanceTimersByTime(90);
        lastListenerFor(addListener, element, 'transitionstart')({ propertyName: 'opacity' });

        // Past the write-time fallback deadline (240ms, Animation.play's
        // default). The fade-in is still running, so the body must not have
        // been snapped to full opacity.
        vi.advanceTimersByTime(160);

        expect(opacityWritesFor(apply, element)).toEqual([]);
        expect((win as unknown as { _bodyFadeActive: boolean })._bodyFadeActive).toBe(true);

        // It still completes, on a deadline measured from the real start
        // (90ms in) plus the fade-in leg's own padded buffer — FADE_IN_DEADLINE_MS
        // (1200ms) from that real start, not from the original write.
        vi.advanceTimersByTime(FADE_IN_DEADLINE_MS - 160 + 10);

        expect(opacityWritesFor(apply, element)).toEqual([null]);
        expect((win as unknown as { _bodyFadeActive: boolean })._bodyFadeActive).toBe(false);
    });

    // Regression test for the actual requirement this path exists to serve —
    // a real, visible glide on large monitors, not an instant jump — and for
    // the mechanism that makes it affordable: the body host's own layout
    // stays paused for the glide's whole duration (so every frame's doLayout
    // only ever repositions the cheap chrome and the body's own box), and
    // resumes for its one deferred relayout only once the glide lands, in
    // the same step the fade-in arms.
    it("12. the window glides to the target rect with the body host's layout paused throughout, resuming only once it lands", () => {
        const { win, body } = makeWindow(1039, 800);
        const element  = body.getElement()!;
        const doLayout = vi.spyOn(win, 'doLayout');

        win.toggleMaximize();
        flushFrame();   // drains toggleMaximize's own unrelated glyph-swap layout (see maximizeToFadeIn)

        vi.advanceTimersByTime(FADE_LEG_FALLBACK_MS);

        // The fade-out landed and the glide started: the body host's layout
        // is paused before its first step, and no relayout has run yet.
        expect(body.isLayoutPaused()).toBe(true);
        expect(doLayout).not.toHaveBeenCalled();

        // Partway through the glide: this is the point of it — the window is
        // genuinely mid-flight, not sitting at either end of the transition.
        vi.advanceTimersByTime(GLIDE_DURATION_MS / 2);
        flushFrame();

        expect(win.getWidth()).toBeGreaterThan(1039);
        expect(win.getWidth()).toBeLessThan(2000);
        expect(body.isLayoutPaused()).toBe(true);
        // One call so far: the chrome-only pass this step's commitRect ran.
        expect(doLayout).toHaveBeenCalledTimes(1);

        const addListener = vi.spyOn(DOM.sink, 'addListener');

        vi.advanceTimersByTime(GLIDE_DURATION_MS);
        flushFrame();

        // The glide lands, the body host's layout resumes for its one
        // deferred relayout, and the fade-in arms — all in this same step.
        expect(win.getWidth()).toBe(2000);
        expect(body.isLayoutPaused()).toBe(false);
        expect(hasTransitionEndListener(addListener, element)).toBe(true);
    });

    // Regression test for the fade-in leg being cut off before the browser
    // ever painted a frame of it: on real content whose relayout is
    // expensive (a wide virtualized table), the deferred relayout the glide's
    // landing runs leaves the main thread too busy to reach the style
    // recalculation that starts the fade-in's transition before
    // Animation.play's plain default 40ms fallback buffer already expires.
    // That pre-rearm fallback then fires first and clears the fade before
    // anything paints, so real users saw an instant pop with no visible
    // fade-in — even though every write was individually correct and this
    // same suite's cases 10-12 passed, because they exercise only the tight,
    // synchronous timing an inexpensive body produces. The fade-in leg now
    // pads its fallback buffer (see WINDOW_FADE_IN_FALLBACK_BUFFER_MS in
    // AbstractWindow.ts) so it survives past that default deadline without a
    // transitionstart signal.
    it('13. the fade-in leg is not snapped at the old, unpadded fallback deadline', () => {
        const { win, body } = makeWindow(1039, 800);
        const apply = vi.spyOn(DOM.sink, 'apply');

        maximizeToFadeIn(win);

        // No transitionstart ever arrives (the offline harness never fires
        // one) — advance to exactly the deadline Animation.play's plain
        // default 40ms buffer would have used. Before the fix this is where
        // the fade-in's own fallback fired and cleared the opacity.
        vi.advanceTimersByTime(FADE_LEG_FALLBACK_MS);

        // '0' is the fade-out's own write, captured by this spy inside
        // maximizeToFadeIn; '1' is the fade-in leg arming. No `null` yet.
        expect(opacityWritesFor(apply, body.getElement()!)).toEqual(['0', '1']);
        expect((win as unknown as { _bodyFadeActive: boolean })._bodyFadeActive).toBe(true);

        // The padded buffer's own deadline still completes it eventually.
        vi.advanceTimersByTime(PAST_FADE_IN_FALLBACK_MS - FADE_LEG_FALLBACK_MS);

        expect(opacityWritesFor(apply, body.getElement()!)).toEqual(['0', '1', null]);
        expect((win as unknown as { _bodyFadeActive: boolean })._bodyFadeActive).toBe(false);
    });

    // Regression test for the cancellation guard the glide relies on:
    // beginStateAnimation cancels _stateAnimHandle at the start of every
    // animateRect call, but until this case nothing ever exercised that
    // cancellation while a glide from a *fade* swap was actually in flight
    // and the body host's layout still paused — every other re-toggle in
    // this suite (case 7) interrupts the fade-out leg, before the glide ever
    // starts. Without beginStateAnimation resuming a still-paused body host,
    // a re-toggle here would leave it paused forever — the very next
    // doLayout pass (e.g. a plain small-delta tween) would silently skip
    // laying out its content. This also exercises the harness's
    // cancelAnimationFrame spy: without it correctly dropping the stale
    // step from `frames`, the cancelled glide would still commit a
    // superseded rect on the next flushFrame().
    it("14. cancelling mid-glide resumes the body host's paused layout and drops the stale step", () => {
        // A wider starting gap than the other cases (500, not 1039): a
        // mid-glide cancellation leaves the window at an interpolated width,
        // and isLargeRectChange measures the restore's delta from *that*
        // position, not the original 500. With only ~961px of total travel
        // (as the other cases use), the halfway point's distance back is
        // already under the 960px threshold, so the restore would silently
        // take the small-delta tween path instead of the one this test means
        // to exercise. ~1500px of travel keeps the halfway point's distance
        // back comfortably above the threshold regardless of easing.
        const { win, body } = makeWindow(500, 800);

        win.toggleMaximize();
        flushFrame();   // drains toggleMaximize's own unrelated glyph-swap layout (see maximizeToFadeIn)
        vi.advanceTimersByTime(FADE_LEG_FALLBACK_MS);   // lands the fade-out, pausing the body and starting the glide
        vi.advanceTimersByTime(GLIDE_DURATION_MS / 2);
        flushFrame();   // one glide step, mid-flight — not landed

        expect(body.isLayoutPaused()).toBe(true);
        expect(win.getWidth()).not.toBe(2000);

        // Spied before the re-toggle below, so it also catches that second
        // toggle's own fade-out writing opacity "0" synchronously (no `from`,
        // same as every other fade-out in this suite).
        const apply = vi.spyOn(DOM.sink, 'apply');

        // Re-toggle mid-glide, before it ever reaches its target.
        win.toggleMaximize();

        // beginStateAnimation resumed the paused layout synchronously, right
        // here, before this second toggle's own fade-out even starts.
        expect(body.isLayoutPaused()).toBe(false);

        // The direct proof cancellation actually worked: the pending glide
        // step's id is gone from the harness's own frame map, dropped by
        // cancelAnimationFrame above, not just harmless if it somehow still
        // fired later. Without that, this size would still be 1 — and yet
        // every assertion below would still pass regardless, since the
        // stale step only ever re-commits the same interpolated (opacity-
        // free) rect, and the correct transition's own later landing step
        // overwrites whatever it left behind anyway.
        expect(frames.size).toBe(0);

        // `null` is beginStateAnimation's own endBodyFade restoring opacity
        // before the re-toggle's fade-out writes its opacity "0"; nothing
        // else contributed (no spurious "1" from a fade-in armed against
        // the superseded maximize target).
        expect(opacityWritesFor(apply, body.getElement()!)).toEqual([null, '0']);

        // The restore itself still completes correctly afterward.
        vi.advanceTimersByTime(FADE_LEG_FALLBACK_MS);
        vi.advanceTimersByTime(GLIDE_DURATION_MS);
        flushFrame();

        expect(win.getWidth()).toBe(500);
    });
});
