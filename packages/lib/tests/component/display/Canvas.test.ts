import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Canvas } from '~/component/display/Canvas';
import type { CanvasDrawCallback, CanvasOptions } from '~/component/display/Canvas';
import { WebGLCanvas } from '~/component/display/WebGLCanvas';
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
        const canvas = new Canvas();

        container.addComponent(canvas);
        container.setVisible(false);

        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(false);
    });

    it('doLayout alone no longer resumes the loop — only the flush does (P5, case 8)', () => {
        const canvas = new Canvas();

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
        const canvas = new Canvas();
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
        const canvas = new Canvas();

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
        const canvas = new Canvas();

        canvas.getElement(true);
        canvas.startAnimation();

        expect(canvas.isAnimating()).toBe(true);

        canvas.setDisplayed(false);
        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(false);
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

// E6 — the device-pixel-ratio watch collapses onto one module-level arm
// shared by every `AbstractCanvasSurface`, instead of one `matchMedia` call
// per instance. Both old and new code arm from `render()`, so the render
// (not just construction) is what makes this case meaningful. Phrased as an
// upper bound, not an equality: the module arms at most once per process, and
// an earlier test in this run may already have done so.
describe('Canvas + WebGLCanvas — shared device-pixel-ratio watch (E6)', () => {
    it('renders three Canvas instances and one WebGLCanvas with at most one matchMedia call total', () => {
        const spy = vi.spyOn(DOM.source, 'matchMedia');

        const canvases = [new Canvas(), new Canvas(), new Canvas()];
        const webgl = new WebGLCanvas();

        for (const canvas of canvases) {
            canvas.getElement(true);
        }

        webgl.getElement(true);

        expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    });
});

// The rAF timestamp reaching onDraw, and the optional frame cap. TestDOM's
// requestAnimationFrame swallows its callback, so these capture it off the sink
// the way tests/core/AfterNextLayout.test.ts does and invoke it with chosen
// timestamps. getContext is stubbed because the offline sink returns null and
// redraw() would otherwise bail before reaching onDraw.
describe('Canvas frame timing and frame cap', () => {
    // Keyed by handle, and cancelAnimationFrame really removes: stopAnimation
    // cancels its pending frame, and a fake that ignored that would let the
    // dead callback fire alongside the next run's and double-count a draw.
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

    /** Invokes every still-live scheduled frame callback with `timestamp`. */
    function runFrame(timestamp: number): void {
        const pending = [...frames.values()];
        frames.clear();
        for (const cb of pending) {
            cb(timestamp);
        }
    }

    /** Gives the canvas a context so redraw() reaches onDraw offline. */
    function withStubContext(canvas: Canvas): void {
        vi.spyOn(canvas, 'getContext')
            .mockReturnValue({ clearRect() {}, save() {}, restore() {}, setTransform() {} } as unknown as CanvasRenderingContext2D);
    }

    afterEach(() => vi.restoreAllMocks());

    it('passes elapsed milliseconds since the animation started to onDraw', () => {
        const seen: number[] = [];
        // maxFps: 0 opts out of the class default cap, which would otherwise
        // skip these deliberately close-together frames.
        const canvas = new Canvas({ maxFps: 0, onDraw: (_ctx, _w, _h, elapsedMs) => { seen.push(elapsedMs); } });

        canvas.getElement(true);
        withStubContext(canvas);
        captureFrames();
        canvas.startAnimation();

        runFrame(1000);   // first frame anchors the clock — elapsed 0
        runFrame(1016);
        runFrame(1033);

        expect(seen).toEqual([0, 16, 33]);
    });

    it('draws every frame when the cap is explicitly removed', () => {
        const canvas = new Canvas({ maxFps: 0 });

        canvas.getElement(true);
        const redraw = vi.spyOn(canvas, 'redraw');

        captureFrames();
        canvas.startAnimation();

        runFrame(0);
        runFrame(16);
        runFrame(32);

        expect(redraw).toHaveBeenCalledTimes(3);
    });

    it('skips frames that arrive faster than the cap allows', () => {
        const canvas = new Canvas({ maxFps: 30 });   // one draw per 33.3ms

        canvas.getElement(true);
        const redraw = vi.spyOn(canvas, 'redraw');

        captureFrames();
        canvas.startAnimation();

        runFrame(0);    // draws — anchors
        runFrame(16);   // 16ms < 33.3 — skipped
        runFrame(34);   // 34ms >= 33.3 — draws
        runFrame(50);   // 16ms since last draw — skipped
        runFrame(68);   // draws

        expect(redraw).toHaveBeenCalledTimes(3);
    });

    it('keeps the loop alive across a skipped frame', () => {
        const canvas = new Canvas({ maxFps: 30 });

        canvas.getElement(true);
        captureFrames();
        canvas.startAnimation();

        runFrame(0);
        runFrame(16);   // skipped — must still reschedule

        expect(frames.size).toBe(1);
    });

    it('reads maxFps back and treats 0 as uncapped', () => {
        const canvas = new Canvas({ maxFps: 24 });

        expect(canvas.getMaxFps()).toBe(24);

        canvas.setMaxFps(0);

        expect(canvas.getMaxFps()).toBe(0);
    });

    it('restarts the elapsed clock on a fresh startAnimation', () => {
        const seen: number[] = [];
        const canvas = new Canvas({ onDraw: (_ctx, _w, _h, elapsedMs) => { seen.push(elapsedMs); } });

        canvas.getElement(true);
        withStubContext(canvas);
        captureFrames();

        canvas.startAnimation();
        runFrame(500);
        runFrame(600);
        canvas.stopAnimation();

        canvas.startAnimation();
        runFrame(5000);   // clock re-anchors here, not at 500

        expect(seen).toEqual([0, 100, 0]);
    });
});

// Class-level defaults reach every consumer of the option. A default bag lands
// in `_defaultOptions`, never `_options`, so each getter has to fold it in per
// ARCHITECTURE.md "Class-level defaults must survive the getter" — and the draw
// path has to read through those getters, not `_options` directly.
class DefaultedCanvas extends Canvas {
    constructor(options?: CanvasOptions) {
        super(options, {
            maxFps:            15,   // deliberately not the class default of 30
            animateWhenHidden: true,
            onDraw:            () => { defaultedDraws++; },
        } as Partial<CanvasOptions>);
    }
}

let defaultedDraws = 0;

describe('Canvas class-level defaults', () => {
    beforeEach(() => { defaultedDraws = 0; });
    afterEach(() => vi.restoreAllMocks());

    it('resolves each defaulted field through its getter', () => {
        const canvas = new DefaultedCanvas();

        expect(canvas.getMaxFps()).toBe(15);
        expect(canvas.getAnimateWhenHidden()).toBe(true);
        expect(canvas.getOnDraw()).not.toBeNull();
    });

    it('keeps the defaults out of the _options bag', () => {
        const canvas = new DefaultedCanvas() as unknown as { _options: Record<string, unknown> };

        expect(canvas._options.maxFps).toBeUndefined();
        expect(canvas._options.animateWhenHidden).toBeUndefined();
        expect(canvas._options.onDraw).toBeUndefined();
    });

    it('lets an explicit option win over each default', () => {
        const canvas = new DefaultedCanvas({ maxFps: 12, animateWhenHidden: false });

        expect(canvas.getMaxFps()).toBe(12);
        expect(canvas.getAnimateWhenHidden()).toBe(false);
    });

    it('falls back to the class defaults with no subclass default and no option', () => {
        const canvas = new Canvas();

        expect(canvas.getMaxFps()).toBe(30);              // Canvas's own class default
        expect(canvas.getAnimateWhenHidden()).toBe(false); // no class default — plain fallback
        expect(canvas.getOnDraw()).toBeNull();
    });

    it('lets an explicit 0 opt out of the class default cap', () => {
        expect(new Canvas({ maxFps: 0 }).getMaxFps()).toBe(0);
    });

    it('actually draws with a defaulted onDraw', () => {
        const canvas = new DefaultedCanvas();

        canvas.getElement(true);
        vi.spyOn(canvas, 'getContext')
            .mockReturnValue({ clearRect() {} } as unknown as CanvasRenderingContext2D);

        canvas.redraw();

        expect(defaultedDraws).toBe(1);
    });

    it('applies a defaulted cap from the very first frame', () => {
        const frames = new Map<number, FrameRequestCallback>();
        let nextHandle = 1;

        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const handle = nextHandle++;
            frames.set(handle, cb);

            return handle;
        });
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((handle: number) => {
            frames.delete(handle);
        });

        const runFrame = (timestamp: number): void => {
            const pending = [...frames.values()];
            frames.clear();
            for (const cb of pending) {
                cb(timestamp);
            }
        };

        const canvas = new DefaultedCanvas();

        canvas.getElement(true);

        const redraw = vi.spyOn(canvas, 'redraw');

        canvas.startAnimation();
        runFrame(0);    // draws
        runFrame(34);   // skipped — under the subclass's 15fps (66.6ms) cap
        runFrame(70);   // draws

        expect(redraw).toHaveBeenCalledTimes(2);
    });
});
