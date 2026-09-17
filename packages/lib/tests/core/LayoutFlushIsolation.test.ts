// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for the batched layout flush isolating a throwing entry.
//
// `flushPendingLayouts` snapshots and clears both `pendingLayouts` and
// `afterLayoutCallbacks` before it starts, so a single throw used to take down
// every *later* component's layout in that frame and destroy the frame's whole
// post-layout callback queue — one-shot consumer work ("focus the editor once
// it is laid out", "measure the revealed panel") that nothing retries and
// nothing reports as dropped. Each entry now runs inside its own try/catch,
// and a throw is counted on `Diagnostics` and reported through `console.error`
// with the original error passed on so the browser console keeps its stack.
//
// The offline sink's `requestAnimationFrame` is a no-op recorder, so these spy
// on it to drive the flush deterministically — the same shim
// `DisposedPendingLayout.test.ts` and `AfterNextLayout.test.ts` use. The
// throwing manager is purpose-built rather than one of the framework's own
// former crashes, all of which this branch has fixed.
//
// Cases are numbered to match `plans/implemented/layout-flush-degenerate-inputs.md`'s
// `## Expected Behaviour` "The batched layout flush" table (X1-X6). X7 and X8
// are manual-verify and live in that plan's Implementation Notes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Diagnostics } from '~/core/Diagnostics';
import { LayoutManager } from '~/layout/LayoutManager';
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

/** A manager whose every layout pass fails, standing in for any component-level bug. */
class ThrowingLayout extends LayoutManager {
    doLayout(): void {
        throw new Error('deliberate layout failure');
    }
}

describe('batched layout flush — a throwing entry', () => {
    let frames: Array<FrameRequestCallback>;

    beforeEach(() => {
        installTestDOM(CONFIG);
        Diagnostics._reset();
        frames = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
    });

    afterEach(() => { frames = []; vi.restoreAllMocks(); DOM.reset(); });

    /** Invokes every animation-frame callback captured since the last flush (the layout pass). */
    function flushFrame(): void {
        const pending = frames;
        frames = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    /**
     * Queues a doomed root and a healthy root, in that order — the queue is a
     * `Set`, so the throwing entry has to come first for these to mean
     * anything, and both must be rendered roots or the flush skips or prunes
     * them for unrelated reasons.
     */
    function queueDoomedThenSurvivor(): { doomed: Container; survivor: Container } {
        const doomed   = new Container({ layoutManager: new ThrowingLayout() });
        const survivor = new Container();

        doomed.getElement(true);
        survivor.getElement(true);
        doomed.scheduleLayout();
        survivor.scheduleLayout();

        return { doomed, survivor };
    }

    it('X1: still lays out the components queued behind it', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { survivor } = queueDoomedThenSurvivor();
        const survivorLayout = vi.spyOn(survivor, 'doLayout');

        flushFrame();

        expect(survivorLayout).toHaveBeenCalledTimes(1);
    });

    it('X2: still drains the frame\'s post-layout callbacks', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        queueDoomedThenSurvivor();

        const callback = vi.fn();

        Component.afterNextLayout(callback);
        flushFrame();

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('X3: isolates a throwing post-layout callback from the ones behind it', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const second = vi.fn();

        Component.afterNextLayout(() => { throw new Error('deliberate callback failure'); });
        Component.afterNextLayout(second);
        flushFrame();

        expect(second).toHaveBeenCalledTimes(1);
    });

    it('X4: counts exactly one isolated layout error', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        queueDoomedThenSurvivor();

        const before = Diagnostics.counters().layoutErrors;

        flushFrame();

        expect(Diagnostics.counters().layoutErrors - before).toBe(1);
    });

    it('X5: reports the failing component once, passing the original error on', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { doomed } = queueDoomedThenSurvivor();

        flushFrame();

        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(String(consoleError.mock.calls[0][0])).toContain(doomed.getId());
        expect(consoleError.mock.calls[0][1]).toBeInstanceOf(Error);
        expect((consoleError.mock.calls[0][1] as Error).message).toBe('deliberate layout failure');
    });

    it('X6: a clean flush neither counts nor reports anything', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const component = new Component();

        component.getElement(true);
        component.scheduleLayout();

        const before = Diagnostics.counters().layoutErrors;

        flushFrame();

        expect(Diagnostics.counters().layoutErrors).toBe(before);
        expect(consoleError).not.toHaveBeenCalled();
    });
});
