import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebGLCanvas } from '~/component/display/WebGLCanvas';
import type { WebGLContextInitCallback, WebGLFrameCallback } from '~/component/display/WebGLCanvas';
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

// WebGLCanvas is a live-only component: the modelled sink returns `null` from
// getContext, so every context-dependent path (frame, backing-store sync, rAF
// paint, gl.viewport, context loss/restore) no-ops offline. These tests pin the
// offline-observable contract — construction, insets, options plumbing, the
// animation flag/teardown, and the "webgl2" context id — while the real GL
// render, HiDPI crispness, resize re-viewport, and loss/restore recovery are the
// manual M-series documented in the plan.
beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

type Recorder = { writes: { op: string; args: unknown[] }[] };

describe('WebGLCanvas construction & tag', () => {
    it('builds a <canvas>-tagged element (U1)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);

        expect(canvas.getTag()).toBe('canvas');

        const created = recorder.writes.some(w =>
            w.op === 'createElement' && w.args[0] === 'canvas');

        expect(created).toBe(true);
    });

    it('supports options-bag construction (U1)', () => {
        const canvas = WebGLCanvas({});

        expect(canvas.getTag()).toBe('canvas');
    });

    it('clears its insets (U2)', () => {
        const canvas = new WebGLCanvas();
        const insets = canvas.getInsets();

        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()])
            .toEqual([0, 0, 0, 0]);
    });
});

describe('WebGLCanvas offline no-op (U3)', () => {
    it('returns null from getContext under the modelled sink', () => {
        const canvas = new WebGLCanvas();

        canvas.getElement(true);

        expect(canvas.getContext()).toBeNull();
    });

    it('syncs / animates / frames without throwing when the context is null', () => {
        const canvas = new WebGLCanvas({
            onContextInit: () => { throw new Error('onContextInit must not run when the context is null'); },
            onFrame:       () => { throw new Error('onFrame must not run when the context is null'); },
        });

        canvas.getElement(true);

        expect(() => (canvas as unknown as { syncBackingStore(): void }).syncBackingStore()).not.toThrow();
        expect(() => canvas.startAnimation()).not.toThrow();
        expect(() => (canvas as unknown as { renderFrame(): void }).renderFrame()).not.toThrow();
    });
});

describe('WebGLCanvas hook plumbing (U4)', () => {
    it('reads back a constructor-supplied onFrame', () => {
        const fn: WebGLFrameCallback = () => {};
        const canvas = new WebGLCanvas({ onFrame: fn });

        expect(canvas.getOnFrame()).toBe(fn);
    });

    it('reads back a constructor-supplied onContextInit', () => {
        const fn: WebGLContextInitCallback = () => {};
        const canvas = new WebGLCanvas({ onContextInit: fn });

        expect(canvas.getOnContextInit()).toBe(fn);
    });

    it('defaults both hooks to null', () => {
        const canvas = new WebGLCanvas();

        expect(canvas.getOnFrame()).toBeNull();
        expect(canvas.getOnContextInit()).toBeNull();
    });

    it('updates and clears onFrame via the setter', () => {
        const fn1: WebGLFrameCallback = () => {};
        const fn2: WebGLFrameCallback = () => {};
        const canvas = new WebGLCanvas({ onFrame: fn1 });

        canvas.setOnFrame(fn2);
        expect(canvas.getOnFrame()).toBe(fn2);

        canvas.setOnFrame(null);
        expect(canvas.getOnFrame()).toBeNull();
    });

    it('updates and clears onContextInit via the setter', () => {
        const fn1: WebGLContextInitCallback = () => {};
        const fn2: WebGLContextInitCallback = () => {};
        const canvas = new WebGLCanvas({ onContextInit: fn1 });

        canvas.setOnContextInit(fn2);
        expect(canvas.getOnContextInit()).toBe(fn2);

        canvas.setOnContextInit(null);
        expect(canvas.getOnContextInit()).toBeNull();
    });
});

describe('WebGLCanvas animation loop (U5, U6)', () => {
    const rafCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'requestAnimationFrame').length;

    const cancelCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'cancelAnimationFrame').length;

    it('sets the animating flag and schedules a frame (U5)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);
        expect(rafCount(recorder)).toBe(1);
    });

    it('does not stack a second frame on a repeated start (U5)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();
        canvas.startAnimation();

        expect(rafCount(recorder)).toBe(1);
    });

    it('cancels the frame and clears the flag on stop (U5)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();
        canvas.stopAnimation();

        expect(canvas.isAnimating()).toBe(false);
        expect(cancelCount(recorder)).toBe(1);
    });

    it('cancels the loop on teardown (U6)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();

        (canvas as unknown as { destructor(): void }).destructor();

        expect(cancelCount(recorder)).toBe(1);
    });
});

describe('WebGLCanvas pause-when-hidden (P1, P3-P6, P8)', () => {
    const rafCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'requestAnimationFrame').length;

    it('round-trips the animateWhenHidden option (P1)', () => {
        expect(new WebGLCanvas({ animateWhenHidden: true }).getAnimateWhenHidden()).toBe(true);
        expect(new WebGLCanvas().getAnimateWhenHidden()).toBe(false);

        const canvas = new WebGLCanvas();
        canvas.setAnimateWhenHidden(true);
        expect(canvas.getAnimateWhenHidden()).toBe(true);

        canvas.setAnimateWhenHidden(false);
        expect(canvas.getAnimateWhenHidden()).toBe(false);
    });

    it('does not start when explicitly hidden (P3)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.setVisible(false);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(false);
        expect(rafCount(recorder)).toBe(0);
    });

    it('does not start when a hidden ancestor makes it effectively hidden (P4)', () => {
        const container = new Component({});
        const canvas = new WebGLCanvas();

        container.addComponent(canvas);
        container.setVisible(false);

        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(false);
    });

    it('resumes once shown again via doLayout (P5)', () => {
        const canvas = new WebGLCanvas();
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
        const canvas = new WebGLCanvas({ animateWhenHidden: true });

        canvas.getElement(true);
        canvas.setVisible(false);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);
    });

    it('stays static across doLayout when never started (P8)', () => {
        const canvas = new WebGLCanvas();

        canvas.getElement(true);
        canvas.doLayout();
        canvas.doLayout();

        expect(canvas.isAnimating()).toBe(false);
    });
});

describe('WebGLCanvas context id (U7)', () => {
    it('acquires the context with contextId "webgl2", not "2d"', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.getContext();

        const recorded = recorder.writes.find(w => w.op === 'getContext');

        expect(recorded).toBeDefined();
        expect(recorded!.args[0]).toBe('webgl2');
    });
});
