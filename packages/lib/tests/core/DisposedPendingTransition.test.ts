// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for the dispose-during-transition fix: `Component.destructor()`
// cancels every `Animation.play` transition still running against a handle
// it is about to release, so a deferred write from that transition's
// two-frame entrance dance (or its `transition: null` completion reset)
// never lands on a handle already returned to the pool. Before this fix,
// only the handful of classes that hand-roll their own cancel in their own
// `destructor()` (`Dialog`, `Notification`, …) were safe; a plain
// `Component` with an externally-started `Animation.play` was not — this
// file proves the base class now protects any component, unconditionally.
//
// `Animation.afterTransition` registers its wait with the same registry, so
// three cases below pin the wait's side of it: a component disposed mid-wait
// abandons the wait instead of completing it against a released handle, an
// undisposed one still completes at the fallback, and the `transitionend`
// removal the abandoned wait owes is recorded during the dispose, ahead of
// the release of the very handle it names.
//
// Mirrors `DisposedPendingLayout.test.ts`'s discipline: assert on whether
// the write happened, not on `not.toThrow()` — the offline sink's
// `release()` keeps serving a released handle, so a throw-based assertion
// would pass vacuously with or without the fix.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Animation } from '~/core/Animation';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { registerTransition, unregisterTransition, cancelTransitions } from '~/core/PendingTransitions';
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

/** Duration used by the entrance animation in every test in this file. */
const DURATION_MS = 100;

/** Comfortably past DURATION_MS + the 40 ms default fallback buffer. */
const PAST_FALLBACK_MS = 200;

describe('Component.destructor cancels pending transitions', () => {
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

    /** A rendered component's element handle, with an entrance transition started against it. */
    function playEntrance(): { component: Component; el: Handle } {
        const component = new Component();
        const el = component.getElement(true)!;

        Animation.play(el, {
            from:       { opacity: '0' },
            to:         { opacity: '1' },
            durationMs: DURATION_MS,
            properties: ['opacity'],
        });

        return { component, el };
    }

    /** A rendered component with an `afterTransition` wait running against it. */
    function startWait(): { component: Component; el: Handle; onComplete: ReturnType<typeof vi.fn> } {
        const component  = new Component();
        const el         = component.getElement(true)!;
        const onComplete = vi.fn();

        Animation.afterTransition({
            component,
            durationMs: DURATION_MS,
            onComplete,
        });

        return { component, el, onComplete };
    }

    /** Style-carrying `apply` writes recorded against `handle` since `from`. */
    function stylesSince(from: number, handle: Handle): Array<Record<string, string | null>> {
        return sink.writes
            .slice(from)
            .filter((entry) => entry.op === 'apply' && entry.args[0] === handle)
            .map((entry) => (entry.args[1] as { style?: Record<string, string | null> }).style)
            .filter((style): style is Record<string, string | null> => style !== undefined);
    }

    it('performs no write against a disposed component\'s released handle when both entrance frames land', () => {
        const { component, el } = playEntrance();
        const mark = sink.writes.length;

        component.dispose();

        flushFrame();
        flushFrame();

        expect(stylesSince(mark, el)).toEqual([]);
    });

    it('control: an undisposed component still receives the transition write across both frames', () => {
        const { el } = playEntrance();
        const mark = sink.writes.length;

        flushFrame();
        flushFrame();

        const keys = stylesSince(mark, el).flatMap((style) => Object.keys(style));

        expect(keys).toContain('transition');
    });

    it('disarms the fallback timer, so advancing past durationMs + 40 after dispose performs no write', () => {
        const { component, el } = playEntrance();

        flushFrame();
        flushFrame();

        const mark = sink.writes.length;

        component.dispose();

        vi.advanceTimersByTime(DURATION_MS + PAST_FALLBACK_MS);

        expect(stylesSince(mark, el)).toEqual([]);
    });

    it('suppresses an afterTransition completion when its component is disposed mid-wait', () => {
        const { component, onComplete } = startWait();

        component.dispose();

        vi.advanceTimersByTime(DURATION_MS + PAST_FALLBACK_MS);

        expect(onComplete).not.toHaveBeenCalled();
    });

    it('control: an undisposed component\'s afterTransition still completes at the fallback', () => {
        const { onComplete } = startWait();

        vi.advanceTimersByTime(DURATION_MS + PAST_FALLBACK_MS);

        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    // The removal is what makes the cancel path reach the DOM, so it has to
    // land while the handle can still be resolved: one removal per in-flight
    // wait, recorded ahead of the release of the very handle it names.
    it('removes the wait\'s transitionend during dispose, before the handle is released', () => {
        const { component, el } = startWait();
        const mark = sink.writes.length;

        component.dispose();

        const ops          = sink.writes.slice(mark);
        const removalIndex = ops.findIndex((entry) => entry.op === 'removeListener' && entry.args[0] === 'transitionend');
        const releaseIndex = ops.findIndex((entry) => entry.op === 'release' && entry.args[0] === el);

        expect(ops.filter((entry) => entry.op === 'removeListener' && entry.args[0] === 'transitionend')).toHaveLength(1);
        expect(removalIndex).toBeGreaterThanOrEqual(0);
        expect(releaseIndex).toBeGreaterThan(removalIndex);
    });

    it('a completed transition leaves no registry entry for cancelTransitions to invoke', () => {
        const el = new Component().getElement(true)!;
        const fn = vi.fn();

        registerTransition(el, fn);
        unregisterTransition(el, fn);
        cancelTransitions(el);

        expect(fn).not.toHaveBeenCalled();
    });
});
