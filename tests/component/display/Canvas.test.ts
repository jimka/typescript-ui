import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Canvas } from '~/component/display/Canvas';
import type { CanvasDrawCallback } from '~/component/display/Canvas';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Canvas is a live-only component: the modelled sink returns `null` from
// getContext and the modelled source reports dpr 1, so every context-dependent
// path (draw, backing-store sync, rAF paint) no-ops offline. These tests pin the
// offline-observable contract — construction, options plumbing, the animation
// flag/teardown, and the two new seam signatures — while the crisp-render and
// resize behaviour is the manual M-series in the plan.
beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

type Recorder = { writes: { op: string; args: unknown[] }[] };

describe('Canvas construction & tag', () => {
    it('builds a <canvas>-tagged element (U1)', () => {
        const canvas = new Canvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);

        expect(canvas.getTag()).toBe('canvas');

        const created = recorder.writes.some(w =>
            w.op === 'createElement' && w.args[0] === 'canvas');

        expect(created).toBe(true);
    });

    it('supports options-bag construction (U1)', () => {
        const canvas = Canvas({});

        expect(canvas.getTag()).toBe('canvas');
    });

    it('clears its insets (U2)', () => {
        const canvas = new Canvas();
        const insets = canvas.getInsets();

        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()])
            .toEqual([0, 0, 0, 0]);
    });
});

describe('Canvas offline no-op (U3)', () => {
    it('returns null from getContext under the modelled source', () => {
        const canvas = new Canvas();

        canvas.getElement(true);

        expect(canvas.getContext()).toBeNull();
    });

    it('redraws / syncs / animates without throwing when the context is null', () => {
        const canvas = new Canvas({ onDraw: () => { throw new Error('onDraw must not run when the context is null'); } });

        canvas.getElement(true);

        expect(() => canvas.redraw()).not.toThrow();
        expect(() => (canvas as unknown as { syncBackingStore(): void }).syncBackingStore()).not.toThrow();
        expect(() => canvas.startAnimation()).not.toThrow();
    });
});

describe('Canvas onDraw plumbing (U4)', () => {
    it('reads back a constructor-supplied onDraw', () => {
        const fn: CanvasDrawCallback = () => {};
        const canvas = new Canvas({ onDraw: fn });

        expect(canvas.getOnDraw()).toBe(fn);
    });

    it('defaults onDraw to null', () => {
        const canvas = new Canvas();

        expect(canvas.getOnDraw()).toBeNull();
    });

    it('updates and clears onDraw via the setter', () => {
        const fn1: CanvasDrawCallback = () => {};
        const fn2: CanvasDrawCallback = () => {};
        const canvas = new Canvas({ onDraw: fn1 });

        canvas.setOnDraw(fn2);
        expect(canvas.getOnDraw()).toBe(fn2);

        canvas.setOnDraw(null);
        expect(canvas.getOnDraw()).toBeNull();
    });
});

describe('Canvas animation loop (U5, U6)', () => {
    const rafCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'requestAnimationFrame').length;

    const cancelCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'cancelAnimationFrame').length;

    it('sets the animating flag and schedules a frame (U5)', () => {
        const canvas = new Canvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);
        expect(rafCount(recorder)).toBe(1);
    });

    it('does not stack a second frame on a repeated start (U5)', () => {
        const canvas = new Canvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();
        canvas.startAnimation();

        expect(rafCount(recorder)).toBe(1);
    });

    it('cancels the frame and clears the flag on stop (U5)', () => {
        const canvas = new Canvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();
        canvas.stopAnimation();

        expect(canvas.isAnimating()).toBe(false);
        expect(cancelCount(recorder)).toBe(1);
    });

    it('cancels the loop on teardown (U6)', () => {
        const canvas = new Canvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();

        (canvas as unknown as { destructor(): void }).destructor();

        expect(cancelCount(recorder)).toBe(1);
    });
});

describe('Canvas pause-when-hidden (P1, P3-P8)', () => {
    const rafCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'requestAnimationFrame').length;

    const cancelCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'cancelAnimationFrame').length;

    it('round-trips the animateWhenHidden option (P1)', () => {
        expect(new Canvas({ animateWhenHidden: true }).getAnimateWhenHidden()).toBe(true);
        expect(new Canvas().getAnimateWhenHidden()).toBe(false);

        const canvas = new Canvas();
        canvas.setAnimateWhenHidden(true);
        expect(canvas.getAnimateWhenHidden()).toBe(true);

        canvas.setAnimateWhenHidden(false);
        expect(canvas.getAnimateWhenHidden()).toBe(false);
    });

    it('does not spuriously cancel during the super() cascade when animateWhenHidden is constructor-supplied', () => {
        // setAnimateWhenHidden -> reconcileAnimation runs from inside applyOptions,
        // before this class's own field initializers (_rafId, _animationRequested)
        // have executed — regression guard for reading them mid-cascade.
        const recorder = DOM.sink as unknown as Recorder;

        new Canvas({ animateWhenHidden: true });

        expect(cancelCount(recorder)).toBe(0);
    });

    it('does not start when explicitly hidden (P3)', () => {
        const canvas = new Canvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.setVisible(false);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(false);
        expect(rafCount(recorder)).toBe(0);
    });

    it('does not start when a hidden ancestor makes it effectively hidden (P4)', () => {
        const container = new Component({});
        const canvas = new Canvas();

        container.addComponent(canvas);
        container.setVisible(false);

        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(false);
    });

    it('resumes once shown again via doLayout (P5)', () => {
        const canvas = new Canvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.setVisible(false);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(false);

        canvas.setVisible(true);
        canvas.doLayout();

        expect(canvas.isAnimating()).toBe(true);
        expect(rafCount(recorder)).toBe(1);
    });

    it('keeps animating while hidden when animateWhenHidden is set (P6)', () => {
        const canvas = new Canvas({ animateWhenHidden: true });

        canvas.getElement(true);
        canvas.setVisible(false);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);
    });

    it('a manual stop clears intent, so a later doLayout does not resurrect the loop (P7)', () => {
        const canvas = new Canvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();
        canvas.stopAnimation();
        canvas.doLayout();

        expect(canvas.isAnimating()).toBe(false);
        expect(rafCount(recorder)).toBe(1);
    });

    it('stays static across doLayout when never started (P8)', () => {
        const canvas = new Canvas();

        canvas.getElement(true);
        canvas.doLayout();
        canvas.doLayout();

        expect(canvas.isAnimating()).toBe(false);
    });
});

describe('Canvas seam signatures (U7)', () => {
    it('RecordingDOMSink.getContext records and returns null', () => {
        const recorder = DOM.sink as unknown as Recorder;
        const handle = DOM.sink.createElement('canvas');

        const ctx = DOM.sink.getContext(handle, '2d');

        expect(ctx).toBeNull();

        const recorded = recorder.writes.some(w =>
            w.op === 'getContext' && w.args[0] === '2d');

        expect(recorded).toBe(true);
    });

    it('ModelledDOMSource.getDevicePixelRatio returns 1', () => {
        expect(DOM.source.getDevicePixelRatio()).toBe(1);
    });
});
