//
// Coverage for the cancellation contract on Animation's helpers.
//
// Every helper arms a fallback setTimeout so its completion work still runs
// when transitionend never arrives. Left uncancelled, that timer outlives the
// element it targets: teardown releases the handle, the timer fires anyway, and
// the write throws "DOM handle N is not registered". These tests pin the three
// escapes from that — transitionend disarms the fallback, cancel() disarms it
// without touching the DOM, and DOM.reset() sweeps whatever is still armed.
//
// transitionend never fires offline, so the fallback path is the *normal* path
// here; it is driven with vi.useFakeTimers(). play()'s two-frame yield needs the
// same treatment as AfterNextLayout.test.ts: the offline sink discards its rAF
// callback, so the queue is spied and drained by hand.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Animation } from '~/core/Animation';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Dialog } from '~/overlay/Dialog';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
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

/** Duration used by every play() in this file; the fallback lands at 100 + 40 ms. */
const DURATION_MS = 100;

/** Comfortably past DURATION_MS + the 40 ms default fallback buffer. */
const PAST_FALLBACK_MS = 300;

describe('Animation cancellation', () => {
    let sink:   RecordingDOMSink;
    let frames: Array<FrameRequestCallback>;

    beforeEach(() => {
        sink = installTestDOM(CONFIG);
        frames = [];
        vi.useFakeTimers();
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        DOM.reset();
    });

    /** Runs every frame callback captured since the last drain. */
    function flushFrame(): void {
        const pending = frames;

        frames = [];

        for (const cb of pending) {
            cb(0);
        }
    }

    /** A rendered component's element handle — the target play() animates. */
    function makeElement(): Handle {
        return new Component().getElement(true)!;
    }

    /**
     * Fires the `transitionend` that `play` registered on `el`. The offline
     * sink's own dispatchEvent only reaches window-handle listeners, so the
     * handler is taken from the recorded addListener call instead.
     */
    function fireTransitionEnd(spy: ReturnType<typeof vi.spyOn>, propertyName = 'opacity'): void {
        const call = spy.mock.calls.find((args: unknown[]) => args[1] === 'transitionend');

        expect(call).toBeDefined();

        (call![2] as (event: unknown) => void)({ propertyName });
    }

    /** Style writes recorded since `from`, flattened to their style patches. */
    function stylesSince(from: number): Array<Record<string, string | null>> {
        return sink.writes
            .slice(from)
            .filter((entry) => entry.op === 'apply')
            .map((entry) => (entry.args[1] as { style?: Record<string, string | null> }).style)
            .filter((style): style is Record<string, string | null> => style !== undefined);
    }

    describe('play', () => {
        it('runs onComplete once and disarms the fallback when transitionend wins', () => {
            const onComplete = vi.fn();
            const listen = vi.spyOn(DOM.sink, 'addListener');

            Animation.play(makeElement(), {
                to:         { opacity: '1' },
                durationMs: DURATION_MS,
                properties: ['opacity'],
                onComplete,
            });

            fireTransitionEnd(listen);

            expect(onComplete).toHaveBeenCalledTimes(1);

            // The fallback must have been cleared, not merely guarded: advancing
            // past it produces no second call.
            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(sink.writes.some((entry) => entry.op === 'clearTimeout')).toBe(true);
        });

        it('runs onComplete once when the fallback timer wins', () => {
            const onComplete = vi.fn();

            Animation.play(makeElement(), {
                to:         { opacity: '1' },
                durationMs: DURATION_MS,
                properties: ['opacity'],
                onComplete,
            });

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(onComplete).toHaveBeenCalledTimes(1);
        });

        it('suppresses onComplete and every DOM write when cancelled before the fallback', () => {
            const onComplete = vi.fn();

            const handle = Animation.play(makeElement(), {
                to:         { opacity: '1' },
                durationMs: DURATION_MS,
                properties: ['opacity'],
                onComplete,
            });

            const mark = sink.writes.length;

            handle.cancel();
            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(onComplete).not.toHaveBeenCalled();

            // cancel() must touch nothing on the element — the whole point is
            // that it stays safe after the handle has been released.
            expect(stylesSince(mark)).toEqual([]);
        });

        it('is a no-op when cancelled after onComplete has already run', () => {
            const onComplete = vi.fn();

            const handle = Animation.play(makeElement(), {
                to:         { opacity: '1' },
                durationMs: DURATION_MS,
                properties: ['opacity'],
                onComplete,
            });

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(onComplete).toHaveBeenCalledTimes(1);

            expect(() => handle.cancel()).not.toThrow();
            expect(onComplete).toHaveBeenCalledTimes(1);
        });

        it('is idempotent across repeated cancels', () => {
            const handle = Animation.play(makeElement(), {
                to:         { opacity: '1' },
                durationMs: DURATION_MS,
                properties: ['opacity'],
            });

            handle.cancel();

            const clearsAfterFirst = sink.writes.filter((entry) => entry.op === 'clearTimeout').length;

            handle.cancel();

            expect(sink.writes.filter((entry) => entry.op === 'clearTimeout').length).toBe(clearsAfterFirst);
        });

        it('applies the to-styles synchronously and cancels harmlessly under reduced motion', () => {
            vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({
                matches:           true,
                addChangeListener: (): void => {},
            });

            const onComplete = vi.fn();
            const el   = makeElement();
            const mark = sink.writes.length;

            const handle = Animation.play(el, {
                to:         { opacity: '1' },
                durationMs: DURATION_MS,
                properties: ['opacity'],
                onComplete,
            });

            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(stylesSince(mark)).toContainEqual({ opacity: '1' });

            expect(() => handle.cancel()).not.toThrow();
        });

        it('never applies the transition when cancelled during the two-frame yield', () => {
            const onComplete = vi.fn();
            const el = makeElement();

            const handle = Animation.play(el, {
                from:       { opacity: '0' },
                to:         { opacity: '1' },
                durationMs: DURATION_MS,
                properties: ['opacity'],
                onComplete,
            });

            const mark = sink.writes.length;

            handle.cancel();

            // Drain both yielded frames: neither may reach applyTransitionAndTo.
            flushFrame();
            flushFrame();
            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(onComplete).not.toHaveBeenCalled();

            const keys = stylesSince(mark).flatMap((style) => Object.keys(style));

            expect(keys).not.toContain('transition');
            expect(keys).not.toContain('opacity');
        });
    });

    describe('afterTransition', () => {
        it('removes the listener and disarms the fallback when transitionend wins', () => {
            const onComplete = vi.fn();
            const component  = new Component();

            component.getElement(true);

            const listen = vi.spyOn(DOM.sink, 'addListener');

            Animation.afterTransition({
                component,
                property:   'height',
                durationMs: DURATION_MS,
                onComplete,
            });

            fireTransitionEnd(listen, 'height');

            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(sink.writes.some((entry) => entry.op === 'removeListener')).toBe(true);

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(onComplete).toHaveBeenCalledTimes(1);
        });

        it('removes the listener when the fallback timer wins', () => {
            const onComplete = vi.fn();
            const component  = new Component();

            component.getElement(true);

            const mark = sink.writes.length;

            Animation.afterTransition({
                component,
                durationMs: DURATION_MS,
                onComplete,
            });

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(sink.writes.slice(mark).some((entry) => entry.op === 'removeListener')).toBe(true);
        });

        it('suppresses onComplete and the listener removal when cancelled first', () => {
            const onComplete = vi.fn();
            const component  = new Component();

            component.getElement(true);

            const mark = sink.writes.length;

            const handle = Animation.afterTransition({
                component,
                durationMs: DURATION_MS,
                onComplete,
            });

            handle.cancel();
            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(onComplete).not.toHaveBeenCalled();
            expect(sink.writes.slice(mark).some((entry) => entry.op === 'removeListener')).toBe(false);
        });

        it('completes synchronously and cancels harmlessly when the component has no element', () => {
            const onComplete = vi.fn();

            const handle = Animation.afterTransition({
                component:  new Component(),
                durationMs: DURATION_MS,
                onComplete,
            });

            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(() => handle.cancel()).not.toThrow();
        });
    });

    describe('materialize', () => {
        it('attaches nothing and disposes the built component when cancelled mid-factory', async () => {
            const host    = new Container();
            const spinner = new Component();
            const built   = new Component();
            const disposed = vi.spyOn(built, 'dispose');

            host.getElement(true);

            let settle: (component: Component) => void = () => {};

            const handle = Animation.materialize({
                host,
                spinnerComponent: spinner,
                factory:          () => new Promise<Component>((resolve) => { settle = resolve; }),
            });

            flushFrame();
            flushFrame();

            handle.cancel();
            settle(built);
            await Promise.resolve();

            expect(host.getComponents()).not.toContain(built);
            expect(disposed).toHaveBeenCalled();
        });
    });

    describe('owner teardown', () => {
        // The integration proof: an owner disposed mid-animation is exactly the
        // shape that produced "DOM handle N is not registered" across the suite.
        // Dispose releases the panel and backdrop handles; without the cancel in
        // Dialog.destructor the entrance fade's fallback would then write to
        // both and throw out of the timer callback.
        it('leaves no fallback timer behind when a Dialog is disposed mid-entrance', () => {
            const dialog = new Dialog({ title: 'Confirm', message: 'Proceed?' });

            void dialog.show();

            // Drain the entrance fade's two-frame yield so the fallback is armed
            // against live handles, then tear the dialog down underneath it.
            flushFrame();
            flushFrame();

            const armed = sink.writes.filter((entry) => entry.op === 'setTimeout').length;

            expect(armed).toBeGreaterThan(0);

            const mark = sink.writes.length;

            dialog.dispose();

            // Asserting on the writes, not on a throw: the offline sink's
            // release() keeps the stub alive, so a use-after-free is silent
            // here and `not.toThrow()` would hold with or without the fix.
            expect(sink.writes.slice(mark).some((entry) => entry.op === 'clearTimeout')).toBe(true);

            const afterDispose = sink.writes.length;

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            // The fade's finish() would write `transition: null` through the
            // panel's now-released handle. Nothing may reach the element.
            expect(stylesSince(afterDispose)).toEqual([]);
        });
    });

    describe('DOM.reset', () => {
        it('disarms a sink timer that is still outstanding', () => {
            const ran = vi.fn();

            DOM.sink.setTimeout(ran, DURATION_MS);
            DOM.reset();
            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(ran).not.toHaveBeenCalled();
        });
    });
});
