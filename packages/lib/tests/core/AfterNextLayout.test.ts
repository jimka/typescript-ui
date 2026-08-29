//
// Coverage for Component.afterNextLayout — the post-flush callback hook.
//
// Layout is coalesced onto an animation frame, so geometry a consumer just
// triggered (revealing a view, opening a section) is not final on the same
// synchronous tick. afterNextLayout defers work until after the next flush has
// laid out every dirty component, so focus/measure work observes the settled
// tree instead of racing the batched pass on a bare requestAnimationFrame.
//
// The offline DOM's requestAnimationFrame is a no-op recorder, so these spy on
// it to capture the flush callback and drive it deterministically.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { VBox } from '~/layout/VBox';
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

describe('Component.afterNextLayout', () => {
    let frames: Array<FrameRequestCallback>;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
    });

    // Drain any frame a test left pending so the module-level rafHandle resets to
    // null (flushPendingLayouts clears it) — otherwise a test that schedules but
    // never flushes would block the next test's frame from being captured.
    afterEach(() => { flushFrame(); vi.restoreAllMocks(); DOM.reset(); });

    /** Invokes every animation-frame callback captured since the last flush (the layout pass). */
    function flushFrame(): void {
        const pending = frames;
        frames = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    it('does not run the callback synchronously', () => {
        const ran = vi.fn();

        Component.afterNextLayout(ran);

        expect(ran).not.toHaveBeenCalled();
    });

    it('runs the callback on the next flush', () => {
        const ran = vi.fn();

        Component.afterNextLayout(ran);
        flushFrame();

        expect(ran).toHaveBeenCalledTimes(1);
    });

    it('runs the callback only once across repeated flushes', () => {
        const ran = vi.fn();

        Component.afterNextLayout(ran);
        flushFrame();
        flushFrame();

        expect(ran).toHaveBeenCalledTimes(1);
    });

    it('runs the callback after every dirty component has laid out', () => {
        const order: string[] = [];
        const host  = new Container({ layoutManager: new VBox() });
        host.getElement(true);
        vi.spyOn(host, 'doLayout').mockImplementation(() => {
            order.push('layout');

            return host;
        });

        host.scheduleLayout();
        Component.afterNextLayout(() => order.push('after'));
        flushFrame();

        expect(order).toEqual(['layout', 'after']);
    });

    it('defers a callback registered from within a callback to the following frame', () => {
        const order: string[] = [];

        Component.afterNextLayout(() => {
            order.push('first');
            Component.afterNextLayout(() => order.push('second'));
        });

        flushFrame();
        expect(order).toEqual(['first']);

        flushFrame();
        expect(order).toEqual(['first', 'second']);
    });

    it('cancelling the returned handle before the flush withdraws the callback', () => {
        const ran = vi.fn();

        const handle = Component.afterNextLayout(ran);
        handle.cancel();
        flushFrame();

        expect(ran).not.toHaveBeenCalled();
    });

    it('cancelling a second time, or after the callback already ran, is a no-op', () => {
        const ran = vi.fn();

        const handle = Component.afterNextLayout(ran);

        expect(() => handle.cancel()).not.toThrow();
        expect(() => handle.cancel()).not.toThrow();
        flushFrame();
        expect(ran).not.toHaveBeenCalled();

        const alreadyRan = vi.fn();
        const ranHandle  = Component.afterNextLayout(alreadyRan);
        flushFrame();
        expect(alreadyRan).toHaveBeenCalledTimes(1);

        expect(() => ranHandle.cancel()).not.toThrow();
        expect(alreadyRan).toHaveBeenCalledTimes(1);
    });

    it('cancelling one of two callbacks queued in the same frame only withdraws that one', () => {
        const cancelled = vi.fn();
        const kept      = vi.fn();

        const handle = Component.afterNextLayout(cancelled);
        Component.afterNextLayout(kept);
        handle.cancel();
        flushFrame();

        expect(cancelled).not.toHaveBeenCalled();
        expect(kept).toHaveBeenCalledTimes(1);
    });
});
