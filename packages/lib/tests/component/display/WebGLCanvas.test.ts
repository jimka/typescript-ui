import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebGLCanvas } from '~/component/display/WebGLCanvas';
import type { WebGLContextInitCallback, WebGLFrameCallback, WebGLCanvasOptions } from '~/component/display/WebGLCanvas';
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

describe('WebGLCanvas pause-when-hidden (P1, P3-P8)', () => {
    const rafCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'requestAnimationFrame').length;

    const cancelCount = (recorder: Recorder): number =>
        recorder.writes.filter(w => w.op === 'cancelAnimationFrame').length;

    it('round-trips the animateWhenHidden option (P1)', () => {
        expect(new WebGLCanvas({ animateWhenHidden: true }).getAnimateWhenHidden()).toBe(true);
        expect(new WebGLCanvas().getAnimateWhenHidden()).toBe(false);

        const canvas = new WebGLCanvas();
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

        new WebGLCanvas({ animateWhenHidden: true });

        expect(cancelCount(recorder)).toBe(0);
    });

    it('does not start when explicitly hidden (P3)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.setVisible(false);

        // Baseline after setVisible, whose own effective-visibility reconcile
        // enqueue also schedules a (framework-internal) requestAnimationFrame —
        // isolate the assertion to whether startAnimation adds its own.
        const rafBefore = rafCount(recorder);

        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(false);
        expect(rafCount(recorder)).toBe(rafBefore);
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

    it('doLayout alone no longer resumes the loop — only the flush does (P5, case 8)', () => {
        const canvas = new WebGLCanvas();

        canvas.getElement(true);
        canvas.setVisible(false);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(false);

        canvas.setVisible(true);
        canvas.doLayout();

        expect(canvas.isAnimating()).toBe(false);

        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(true);
    });

    it('reacts to the effective-visibility event: pauses on hide, resumes on show (case 6)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);

        const cancelBefore = cancelCount(recorder);

        canvas.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(false);
        expect(cancelCount(recorder)).toBeGreaterThan(cancelBefore);

        const rafBefore = rafCount(recorder);

        canvas.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(true);
        expect(rafCount(recorder)).toBeGreaterThan(rafBefore);
    });

    it('an ancestor hide pauses a started descendant Canvas (case 7)', () => {
        const container = new Component({});
        const canvas = new WebGLCanvas();

        container.addComponent(canvas);
        container.getElement(true);
        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);

        container.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(false);
    });

    it('setDisplayed(false) also pauses a started Canvas (case 10)', () => {
        const canvas = new WebGLCanvas();

        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);

        canvas.setDisplayed(false);
        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(false);
    });

    it('keeps animating while hidden when animateWhenHidden is set (P6)', () => {
        const canvas = new WebGLCanvas({ animateWhenHidden: true });

        canvas.getElement(true);
        canvas.setVisible(false);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);
    });

    it('a manual stop clears intent, so a later doLayout does not resurrect the loop (P7)', () => {
        const canvas = new WebGLCanvas();
        const recorder = DOM.sink as unknown as Recorder;

        canvas.getElement(true);
        canvas.startAnimation();
        canvas.stopAnimation();
        canvas.doLayout();

        expect(canvas.isAnimating()).toBe(false);
        expect(rafCount(recorder)).toBe(1);
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

// The rAF timestamp reaching onFrame, and the optional frame cap. Mirrors
// tests/component/display/Canvas.test.ts: TestDOM's requestAnimationFrame
// swallows its callback, so these capture it off the sink and drive it with
// chosen timestamps, and getContext is stubbed because renderFrame bails on a
// null context before it can reach onFrame.
describe('WebGLCanvas frame timing and frame cap', () => {
    let frames: Map<number, FrameRequestCallback>;
    let nextHandle: number;

    function captureFrames(): void {
        frames = new Map();
        nextHandle = 1;
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const handle = nextHandle++;
            frames.set(handle, cb);

            return handle;
        });
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((handle: number) => {
            frames.delete(handle);
        });
    }

    function runFrame(timestamp: number): void {
        const pending = [...frames.values()];
        frames.clear();
        for (const cb of pending) {
            cb(timestamp);
        }
    }

    function withStubContext(canvas: WebGLCanvas): void {
        vi.spyOn(canvas, 'getContext')
            .mockReturnValue({ viewport() {}, clear() {}, clearColor() {} } as unknown as WebGL2RenderingContext);
    }

    afterEach(() => vi.restoreAllMocks());

    it('passes elapsed milliseconds since the animation started to onFrame', () => {
        const seen: number[] = [];
        // maxFps: 0 opts out of the class default cap, which would otherwise
        // skip these deliberately close-together frames.
        const canvas = new WebGLCanvas({ maxFps: 0, onFrame: (_gl, _w, _h, elapsedMs) => { seen.push(elapsedMs); } });

        canvas.getElement(true);
        withStubContext(canvas);
        captureFrames();
        canvas.startAnimation();

        runFrame(2000);
        runFrame(2016);
        runFrame(2050);

        expect(seen).toEqual([0, 16, 50]);
    });

    it('skips frames that arrive faster than the cap allows', () => {
        const seen: number[] = [];
        const canvas = new WebGLCanvas({
            maxFps:  30,
            onFrame: (_gl, _w, _h, elapsedMs) => { seen.push(elapsedMs); },
        });

        canvas.getElement(true);
        withStubContext(canvas);
        captureFrames();
        canvas.startAnimation();

        runFrame(0);    // draws
        runFrame(16);   // skipped
        runFrame(34);   // draws
        runFrame(50);   // skipped
        runFrame(68);   // draws

        expect(seen).toEqual([0, 34, 68]);
    });

    it('reads maxFps back and treats 0 as uncapped', () => {
        const canvas = new WebGLCanvas({ maxFps: 24 });

        expect(canvas.getMaxFps()).toBe(24);

        canvas.setMaxFps(0);

        expect(canvas.getMaxFps()).toBe(0);
    });
});

// Mirror of the Canvas class-default coverage: a default bag lands in
// `_defaultOptions`, so every getter folds it in and the render path reads
// through those getters rather than `_options` directly.
class DefaultedWebGL extends WebGLCanvas {
    constructor(options?: WebGLCanvasOptions) {
        super(options, {
            maxFps:            15,   // deliberately not the class default of 30
            animateWhenHidden: true,
            onFrame:           () => { defaultedFrames++; },
            onContextInit:     () => { defaultedInits++; },
        } as Partial<WebGLCanvasOptions>);
    }
}

let defaultedFrames = 0;
let defaultedInits  = 0;

describe('WebGLCanvas class-level defaults', () => {
    beforeEach(() => { defaultedFrames = 0; defaultedInits = 0; });
    afterEach(() => vi.restoreAllMocks());

    it('resolves each defaulted field through its getter', () => {
        const canvas = new DefaultedWebGL();

        expect(canvas.getMaxFps()).toBe(15);
        expect(canvas.getAnimateWhenHidden()).toBe(true);
        expect(canvas.getOnFrame()).not.toBeNull();
        expect(canvas.getOnContextInit()).not.toBeNull();
    });

    it('keeps the defaults out of the _options bag', () => {
        const canvas = new DefaultedWebGL() as unknown as { _options: Record<string, unknown> };

        expect(canvas._options.maxFps).toBeUndefined();
        expect(canvas._options.animateWhenHidden).toBeUndefined();
        expect(canvas._options.onFrame).toBeUndefined();
        expect(canvas._options.onContextInit).toBeUndefined();
    });

    it('lets an explicit option win over each default', () => {
        const canvas = new DefaultedWebGL({ maxFps: 12, animateWhenHidden: false });

        expect(canvas.getMaxFps()).toBe(12);
        expect(canvas.getAnimateWhenHidden()).toBe(false);
    });

    it('falls back to the class defaults with no subclass default and no option', () => {
        const canvas = new WebGLCanvas();

        expect(canvas.getMaxFps()).toBe(30);              // WebGLCanvas's own class default
        expect(canvas.getAnimateWhenHidden()).toBe(false); // no class default — plain fallback
        expect(canvas.getOnFrame()).toBeNull();
        expect(canvas.getOnContextInit()).toBeNull();
    });

    it('lets an explicit 0 opt out of the class default cap', () => {
        expect(new WebGLCanvas({ maxFps: 0 }).getMaxFps()).toBe(0);
    });

    it('actually runs a defaulted onFrame and onContextInit', () => {
        const canvas = new DefaultedWebGL();

        canvas.getElement(true);
        vi.spyOn(canvas, 'getContext')
            .mockReturnValue({ viewport() {}, clear() {}, clearColor() {} } as unknown as WebGL2RenderingContext);

        (canvas as unknown as { renderFrame(): void }).renderFrame();

        expect(defaultedInits).toBe(1);
        expect(defaultedFrames).toBe(1);
    });
});
