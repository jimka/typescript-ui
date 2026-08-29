// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";

/**
 * GL-resource (re)build hook: receives the live WebGL2 context. Called once on
 * first context acquisition and again after every context restore — build (or
 * rebuild) shaders, programs, buffers, VAOs, and textures here.
 *
 * @param gl - The live `WebGL2RenderingContext`.
 *
 * @category Components
 */
export type WebGLContextInitCallback = (gl: WebGL2RenderingContext) => void;

/**
 * Per-frame draw hook: receives the live WebGL2 context and the logical
 * (CSS-px) size. Issue draw calls here; the component has already set the
 * drawing-buffer viewport in device pixels.
 *
 * @param gl - The live `WebGL2RenderingContext`.
 * @param width - The drawing surface width in CSS pixels.
 * @param height - The drawing surface height in CSS pixels.
 *
 * @category Components
 */
export type WebGLFrameCallback = (
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    elapsedMs: number,
) => void;

/**
 * Construction-time options for {@link WebGLCanvas}.
 *
 * @category Components
 */
export interface WebGLCanvasOptions extends ComponentOptions {

    /** GL-resource (re)build hook; runs on init and after each context restore. */
    onContextInit?: WebGLContextInitCallback;

    /**
     * Per-frame draw hook. Its fourth argument is the milliseconds elapsed
     * since the current animation run started — derive motion from that rather
     * than advancing a counter once per call, since frames arrive at the
     * display's refresh rate and a per-call increment runs three times faster
     * on a 180Hz monitor than on a 60Hz one.
     */
    onFrame?: WebGLFrameCallback;

    /**
     * Keeps the animation loop running while the canvas is not effectively
     * on-screen (e.g. on an inactive `Tab` panel). Default `false`: the loop
     * pauses automatically when hidden and resumes when shown again.
     */
    animateWhenHidden?: boolean;

    /**
     * Upper bound, in frames per second, on how often the animation loop
     * renders. Defaults to 30 — enough for smooth motion at a predictable cost,
     * and independent of the display's refresh rate, so the same animation
     * costs the same on a 60Hz and a 180Hz monitor. Pass `0` to opt out and
     * render on every animation frame the browser delivers. A positive value
     * skips frames that arrive sooner than `1000 / maxFps` after the last
     * one; the loop itself keeps running, so the cap trades smoothness for
     * CPU rather than pausing anything.
     */
    maxFps?: number;
}

/**
 * Class-level defaults forwarded to `super` so the cascade hits Component's
 * applyOptions with `{ tag: "canvas" }` already merged into `_defaultOptions`.
 */
const _defaultWebGLCanvasOptions: Partial<WebGLCanvasOptions> = {
    tag: "canvas",
    maxFps: 30,
};

// Sentinel for the last-synced width/height/dpr guard. A real size is always
// >= 0 and a real dpr always >= 1, so -1 can never equal a genuine value and
// therefore forces the first `syncBackingStore` to run rather than short-circuit.
const NOT_YET_SYNCED = -1;

/**
 * A GPU drawing surface backed by a `<canvas>` element and a live
 * `WebGL2RenderingContext`.
 *
 * The component owns the canvas element, the GL context, the animation loop,
 * and context-loss recovery; the consumer owns shaders, buffers, and draw calls
 * through two hooks. {@link WebGLCanvasOptions.onContextInit | onContextInit}
 * (re)builds GPU resources — it runs once on first acquisition and again after
 * every context restore. {@link WebGLCanvasOptions.onFrame | onFrame} draws each
 * frame; the drawing-buffer viewport is already set in device pixels, and the
 * hook receives the logical (CSS-px) size for projection math.
 *
 * Backing-store sizing mirrors the 2D sibling: the element's `width` / `height`
 * attributes are kept at CSS × device-pixel-ratio for a crisp HiDPI result, and
 * every resize re-emits `gl.viewport(0, 0, backingW, backingH)` in device pixels
 * (reassigning the attributes resizes the drawing buffer but leaves GL resources
 * intact). The render loop starts automatically on the first connected layout,
 * pauses automatically while the surface is not effectively on-screen (e.g. on
 * an inactive `Tab` panel) — resuming once it's shown again — and stops on
 * teardown; call {@link WebGLCanvas.startAnimation | startAnimation} /
 * {@link WebGLCanvas.stopAnimation | stopAnimation} to drive a static or on-demand
 * surface explicitly.
 *
 * `WebGLCanvas` is **live-only**: a GL context cannot be modelled offline or
 * forwarded across a worker, so under a modelled sink `getContext` returns `null`
 * and every render path no-ops. It is WebGL2 only.
 *
 * @category Components
 */
class WebGLCanvas extends Component<WebGLCanvasOptions> {

    /** Cached WebGL2 context; `null` offline or before the element renders. */
    private _gl: WebGL2RenderingContext | null = null;

    /** Active animation-frame handle; `null` when the loop is idle. */
    private _rafId: number | null = null;

    // Frame clock for the animation loop. `_animationStartMs` is null until the
    // first frame of a run anchors it, so elapsed time starts at 0 for that
    // frame however long the run waited to be scheduled. `_lastDrawMs` gates
    // the maxFps cap and `_elapsedMs` is what the frame hook is handed, kept as
    // a field so renders from outside the loop repeat the last frame's value.
    private _animationStartMs: number | null = null;
    private _lastDrawMs      : number | null = null;
    private _elapsedMs                       = 0;

    /** Consumer/auto intent to animate; the loop actually runs only while also
     *  effectively visible (or animateWhenHidden is set). Plain initializer:
     *  never written during the super() cascade (only startAnimation /
     *  stopAnimation, which run post-render, write it), so it needs no
     *  `declare`. */
    private _animationRequested = false;

    /** True between `webglcontextlost` and `webglcontextrestored`; frames skip. */
    private _contextLost: boolean = false;

    private readonly _onContextLost: () => void = () => {
        this._contextLost = true;
    };

    // Stable reference, not an inline closure, so re-registering on a rebuilt
    // element dedupes against the existing entry. Mirrors `_onContextLost`.
    private readonly _onContextRestored: () => void = () => {
        this._contextLost        = false;
        this._contextInitialised = false;
        this.syncBackingStore();
    };

    /**
     * False until `onContextInit` has run for the current context; reset on
     * restore (and by `setOnContextInit`) so the next frame re-runs the hook.
     * Written by `setOnContextInit`, which `applyOptions` can dispatch during the
     * `super()` cascade, so it is `declare`d and assigned in the constructor body.
     */
    declare private _contextInitialised: boolean;

    /** Last-synced CSS width; guards against a redundant buffer resize. */
    private _syncedWidth: number = NOT_YET_SYNCED;

    /** Last-synced CSS height; guards against a redundant buffer resize. */
    private _syncedHeight: number = NOT_YET_SYNCED;

    /** Last-synced device-pixel ratio; guards against a redundant buffer resize. */
    private _syncedDpr: number = NOT_YET_SYNCED;

    /** Generation counter so only the newest DPR-watch arm acts on a change. */
    private _dprToken: number = 0;

    /**
     * Constructs a WebGL2 canvas.
     *
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: WebGLCanvasOptions, subclassDefaults?: Partial<WebGLCanvasOptions>) {
        super(options, { ..._defaultWebGLCanvasOptions, ...(subclassDefaults ?? {}) });

        this._contextInitialised = false;

        this.clearInsets();
    }

    /**
     * Forwards the consumer-configurable hooks to their setters.
     *
     * @param options - The construction options.
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: WebGLCanvasOptions): this {
        super.applyOptions(options);

        if (options.onContextInit !== undefined) {
            this.setOnContextInit(options.onContextInit);
        }

        if (options.onFrame !== undefined) {
            this.setOnFrame(options.onFrame);
        }

        if (options.animateWhenHidden !== undefined) {
            this.setAnimateWhenHidden(options.animateWhenHidden);
        }

        if (options.maxFps !== undefined) {
            this.setMaxFps(options.maxFps);
        }

        return this;
    }

    /**
     * Returns the WebGL2 rendering context, lazily obtaining it from the seam on
     * first access once the element exists and narrowing the generic seam result
     * to `WebGL2RenderingContext`.
     *
     * @returns The context, or `null` offline / before the element renders.
     */
    getContext(): WebGL2RenderingContext | null {
        if (this._gl) {
            return this._gl;
        }

        const element = this.getElement();
        if (!element) {
            return null;
        }

        this._gl = DOM.sink.getContext(element, "webgl2") as WebGL2RenderingContext | null;

        return this._gl;
    }

    /**
     * Sets (or clears) the GL-resource build hook. Marks the context
     * uninitialised so the new hook runs on the next frame.
     *
     * @param handler - The context-init callback, or `null` to clear it.
     * @returns This component, for method chaining.
     */
    setOnContextInit(handler: WebGLContextInitCallback | null): this {
        this._options.onContextInit = handler ?? undefined;
        this._contextInitialised = false;

        return this;
    }

    /**
     * Returns the current GL-resource build hook.
     *
     * @returns The context-init callback, or `null` when none is set.
     */
    getOnContextInit(): WebGLContextInitCallback | null {
        return this._options.onContextInit ?? this._defaultOptions.onContextInit ?? null;
    }

    /**
     * Sets (or clears) the per-frame draw hook.
     *
     * @param handler - The frame callback, or `null` to clear it.
     * @returns This component, for method chaining.
     */
    setOnFrame(handler: WebGLFrameCallback | null): this {
        this._options.onFrame = handler ?? undefined;

        return this;
    }

    /**
     * Returns the current per-frame draw hook.
     *
     * @returns The frame callback, or `null` when none is set.
     */
    getOnFrame(): WebGLFrameCallback | null {
        return this._options.onFrame ?? this._defaultOptions.onFrame ?? null;
    }

    /**
     * Starts the per-frame render loop. Idempotent: a second call while already
     * animating does not schedule a second frame. Records the intent to
     * animate; the loop only actually runs while the canvas is also
     * effectively on-screen (or {@link setAnimateWhenHidden} opts out).
     *
     * @returns This component, for method chaining.
     */
    startAnimation(): this {
        this._animationRequested = true;
        this._animationStartMs   = null;
        this._lastDrawMs         = null;
        this._elapsedMs          = 0;
        this.reconcileAnimation();

        return this;
    }

    /**
     * Stops the per-frame render loop, cancelling any pending frame. Clears
     * the intent to animate, so a later resize/show cannot resurrect it.
     *
     * @returns This component, for method chaining.
     */
    stopAnimation(): this {
        this._animationRequested = false;
        this.reconcileAnimation();

        return this;
    }

    /**
     * Whether the per-frame render loop is currently running. `false` while
     * paused for being effectively hidden, even if animation was requested.
     *
     * @returns `true` while animating.
     */
    isAnimating(): boolean {
        return this._rafId !== null;
    }

    /**
     * Keeps the animation loop running while the canvas is not effectively
     * on-screen. Reconciles immediately, so toggling it can start or pause
     * the loop right away.
     *
     * @param value - `true` to animate regardless of visibility.
     * @returns This component, for method chaining.
     */
    setAnimateWhenHidden(value: boolean): this {
        this._options.animateWhenHidden = value;
        this.reconcileAnimation();

        return this;
    }

    /**
     * Returns whether the animation loop keeps running while hidden.
     *
     * @returns `true` if the loop ignores effective visibility.
     */
    getAnimateWhenHidden(): boolean {
        return this._options.animateWhenHidden ?? this._defaultOptions.animateWhenHidden ?? false;
    }

    /**
     * Caps how often the animation loop renders, in frames per second. Takes
     * effect on the next frame; the loop keeps running either way, so this
     * thins renders rather than pausing anything. Because frames are delivered
     * at the display's refresh rate, an uncapped loop costs proportionally more
     * on a high-refresh monitor — a cap makes that cost predictable.
     *
     * @param fps - Maximum renders per second, or `0` to remove the cap entirely.
     *   Negative values are treated as `0`. The class default is 30.
     * @returns This component, for method chaining.
     */
    setMaxFps(fps: number): this {
        // On the options bag rather than a private field, matching
        // `animateWhenHidden`: `applyOptions` runs inside the `super()`
        // cascade, before this class's field initializers, so a plain
        // `_maxFps = 0` initializer would overwrite a construction-time value.
        this._options.maxFps = Math.max(0, fps);

        return this;
    }

    /**
     * Returns the current render cap in frames per second.
     *
     * @returns The cap, or `0` when the loop is uncapped. Resolves the class
     *   default (30) when no explicit value was set.
     */
    getMaxFps(): number {
        // Consults `_defaultOptions` as well as `_options`, matching the
        // framework's getter convention (`getZIndex` is
        // `_options.zIndex ?? _defaultOptions.zIndex ?? 0`). A class-level
        // default bag lands in `_defaultOptions`, never in `_options`, so
        // reading only the latter would silently ignore a default-supplied cap
        // and leave the loop uncapped from the first frame.
        return this._options.maxFps ?? this._defaultOptions.maxFps ?? 0;
    }

    /**
     * Resizes the backing store to CSS × dpr, sets `gl.viewport` in device
     * pixels (WebGL's replacement for the 2D transform), and re-emits one frame.
     * Called from `doLayout` on every size change. Reads only cached CSS sizes —
     * never DOM geometry, which inside `doLayout` is still buffered — and
     * short-circuits when width/height/dpr are unchanged so idle layout passes
     * never resize the drawing buffer. Reassigning the attributes resizes the
     * buffer but leaves GL resources intact, so only the viewport is refreshed.
     */
    protected syncBackingStore(): void {
        const gl = this.getContext();
        if (!gl) {
            return;
        }

        const width  = this.getWidth();
        const height = this.getHeight();
        const dpr    = DOM.source.getDevicePixelRatio();

        if (width === this._syncedWidth && height === this._syncedHeight && dpr === this._syncedDpr) {
            return;
        }

        const backingW = Math.round(width  * dpr);
        const backingH = Math.round(height * dpr);

        DOM.sink.apply(this.getElement()!, { setAttr: {
            width:  String(backingW),
            height: String(backingH),
        }});

        // Device pixels, not CSS px — the drawing buffer is CSS × dpr and the
        // viewport must cover it fully for a crisp, unstretched result.
        gl.viewport(0, 0, backingW, backingH);

        this._syncedWidth  = width;
        this._syncedHeight = height;
        this._syncedDpr    = dpr;

        this.renderFrame();
    }

    /**
     * Delegates to the base layout then syncs the backing store — the single
     * settled hook that fires once after both axes are committed, on initial
     * mount and every subsequent resize.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();
        this.syncBackingStore();

        return this;
    }

    /**
     * Renders the element, wires context loss / restore, arms the DPR-change
     * watcher, and starts the render loop on the first connected layout.
     *
     * @returns The created element handle.
     */
    protected render(): Handle {
        const element = super.render();

        // `prevent: true` is REQUIRED — without it the browser never fires
        // `webglcontextrestored`.
        Event.addListener(this, "webglcontextlost", { prevent: true, handler: this._onContextLost });
        Event.addListener(this, "webglcontextrestored", this._onContextRestored);

        this.watchDevicePixelRatio();
        this.onFirstLayout(() => this.startAnimation());

        return element;
    }

    /**
     * Stops the render loop before the inherited destructor detaches the
     * element, so no stray frame survives teardown.
     */
    protected destructor(): void {
        this.stopAnimation();
        super.destructor();
    }

    /**
     * Whether the loop should be scheduled right now: animation was
     * requested, and either the canvas is effectively on-screen or the
     * consumer opted out of pausing via `animateWhenHidden`.
     */
    private shouldAnimate(): boolean {
        return this._animationRequested
            && (this.getAnimateWhenHidden() || this.isEffectivelyVisible());
    }

    /**
     * Brings the raw rAF loop into agreement with `shouldAnimate()`.
     * Idempotent — safe to call every `doLayout` and from the option setter.
     * A no-op during the construction cascade because `_animationRequested`
     * is still false.
     */
    private reconcileAnimation(): void {
        if (this.shouldAnimate()) {
            if (this._rafId === null) {
                this._rafId = DOM.sink.requestAnimationFrame(this.animationStep);
            }
        } else if (this._rafId != null) {
            // Loose comparison: during the super() cascade (a construction-time
            // animateWhenHidden option), this class's own field initializers
            // haven't run yet, so _rafId briefly reads as `undefined` rather than
            // its declared `null` default — treat both as "nothing scheduled".
            DOM.sink.cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /**
     * One animation-frame step: self-pauses when animation is no longer
     * requested, otherwise renders a frame and reschedules. Effective-visibility
     * pausing is handled by {@link onEffectiveVisibilityChange} reconciling the
     * loop on the change event, not by this step re-checking visibility every
     * frame. Arrow field so the rAF callback keeps a stable bound ref.
     */
    private readonly animationStep = (timestamp: number): void => {
        if (!this._animationRequested) {
            this._rafId = null;
            return;
        }

        if (this._animationStartMs === null) {
            this._animationStartMs = timestamp;
        }

        // A skipped frame still reschedules: the cap thins out renders, it does
        // not stop the loop, so raising maxFps again takes effect immediately.
        const maxFps        = this.getMaxFps();
        const minIntervalMs = maxFps > 0 ? 1000 / maxFps : 0;
        const dueForRender  = this._lastDrawMs === null
            || timestamp - this._lastDrawMs >= minIntervalMs;

        if (dueForRender) {
            this._lastDrawMs = timestamp;
            this._elapsedMs  = timestamp - this._animationStartMs;
            this.renderFrame();
        }

        this._rafId = DOM.sink.requestAnimationFrame(this.animationStep);
    };

    /**
     * Reacts to an effective-visibility change by reconciling the animation
     * loop — the replacement for the old per-frame `isEffectivelyVisible()`
     * poll inside `doLayout`.
     *
     * @param effective - The component's new effective-visibility state.
     */
    protected onEffectiveVisibilityChange(effective: boolean): void {
        super.onEffectiveVisibilityChange(effective);
        this.reconcileAnimation();
    }

    /**
     * One frame: lazily runs `onContextInit` the first time (and after a
     * restore), then invokes `onFrame` with the logical CSS-px size. Skips while
     * the context is lost or unavailable.
     */
    private renderFrame(): void {
        const gl = this.getContext();
        if (!gl || this._contextLost) {
            return;
        }

        if (!this._contextInitialised) {
            this.getOnContextInit()?.(gl);
            this._contextInitialised = true;
        }

        this.getOnFrame()?.(gl, this.getWidth(), this.getHeight(), this._elapsedMs);
    }

    /**
     * Arms a one-shot `matchMedia` watch for the current device-pixel ratio. A
     * window dragged to a different-DPI monitor changes the ratio without a
     * resize/relayout, which `doLayout` would miss; on change this re-syncs the
     * backing store and re-arms for the new ratio. A generation token keeps only
     * the newest arm active, so re-arming cannot fan out — and the seam has no
     * unsubscribe, so each change leaves one inert native listener behind
     * (bounded by the number of DPR changes in a session).
     */
    private watchDevicePixelRatio(): void {
        const token = ++this._dprToken;
        const dpr   = DOM.source.getDevicePixelRatio();

        DOM.source
            .matchMedia(`(resolution: ${dpr}dppx)`)
            .addChangeListener(() => this.onDevicePixelRatioChange(token));
    }

    /**
     * Handles a device-pixel-ratio change from the newest armed watch: re-syncs
     * the backing store at the fresh ratio and re-arms. Superseded arms (a stale
     * token) and post-teardown fires (no element) are inert.
     *
     * @param token - The generation token this listener was armed with.
     */
    private onDevicePixelRatioChange(token: number): void {
        if (token !== this._dprToken) {
            return;
        }

        if (!this.getElement()) {
            return;
        }

        this.syncBackingStore();
        this.watchDevicePixelRatio();
    }
}

const WebGLCanvasCallable = callable(WebGLCanvas);
type WebGLCanvasCallable = WebGLCanvas;
export {
    WebGLCanvas         as _WebGLCanvas,
    WebGLCanvasCallable as WebGLCanvas
};
