// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { AbstractCanvasSurface, AbstractCanvasSurfaceOptions } from "~/component/display/AbstractCanvasSurface.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";

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
export interface WebGLCanvasOptions extends AbstractCanvasSurfaceOptions {

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
}

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
class WebGLCanvas extends AbstractCanvasSurface<WebGLCanvasOptions> {

    /** Cached WebGL2 context; `null` offline or before the element renders. */
    private _gl: WebGL2RenderingContext | null = null;

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

    /**
     * Constructs a WebGL2 canvas.
     *
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: WebGLCanvasOptions, subclassDefaults?: Partial<WebGLCanvasOptions>) {
        super(options, subclassDefaults);

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
     * Whether the WebGL2 context is available.
     *
     * @returns `true` when a context exists.
     */
    protected hasRenderingContext(): boolean {
        return this.getContext() !== null;
    }

    /**
     * Re-emits `gl.viewport` in device pixels — reassigning the backing-store
     * attributes resizes the drawing buffer but leaves GL resources intact, so
     * only the viewport needs refreshing.
     *
     * @param backingWidth - The new backing-store width, in device pixels.
     * @param backingHeight - The new backing-store height, in device pixels.
     * @param _dpr - Unused; the viewport is sized from the backing dimensions directly.
     */
    protected onBackingStoreResized(backingWidth: number, backingHeight: number, _dpr: number): void {
        this.getContext()!.viewport(0, 0, backingWidth, backingHeight);
    }

    /** Renders via {@link WebGLCanvas.renderFrame}. */
    protected drawFrame(): void {
        this.renderFrame();
    }

    /**
     * Renders the element, wires context loss / restore, and starts the
     * render loop on the first connected layout.
     *
     * @returns The created element handle.
     */
    protected render(): Handle {
        const element = super.render();

        // `prevent: true` is REQUIRED — without it the browser never fires
        // `webglcontextrestored`.
        Event.addListener(this, "webglcontextlost", { prevent: true, handler: this._onContextLost });
        Event.addListener(this, "webglcontextrestored", this._onContextRestored);

        this.onFirstLayout(() => this.startAnimation());

        return element;
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
}

const WebGLCanvasCallable = callable(WebGLCanvas);
type WebGLCanvasCallable = WebGLCanvas;
export {
    WebGLCanvas         as _WebGLCanvas,
    WebGLCanvasCallable as WebGLCanvas
};
