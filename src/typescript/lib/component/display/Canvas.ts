// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { callable } from "~/core/Callable.js";

/**
 * Draw callback: receives the live 2D context and the logical (CSS-px) size.
 *
 * @param ctx - The canvas 2D rendering context, pre-scaled so one unit is one
 *   CSS pixel (the device-pixel-ratio transform is already applied).
 * @param width - The drawing surface width in CSS pixels.
 * @param height - The drawing surface height in CSS pixels.
 *
 * @category Components
 */
export type CanvasDrawCallback = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
) => void;

/**
 * Construction-time options for {@link Canvas}.
 *
 * @category Components
 */
export interface CanvasOptions extends ComponentOptions {

    /** Draw hook, re-invoked on demand and after every resize / DPR change. */
    onDraw?: CanvasDrawCallback;

    /**
     * Keeps the animation loop running while the canvas is not effectively
     * on-screen (e.g. on an inactive `Tab` panel). Default `false`: the loop
     * pauses automatically when hidden and resumes when shown again.
     */
    animateWhenHidden?: boolean;
}

/**
 * Class-level defaults forwarded to `super` so the cascade hits Component's
 * applyOptions with `{ tag: "canvas" }` already merged into `_defaultOptions`.
 */
const _defaultCanvasOptions: Partial<CanvasOptions> = {
    tag: "canvas",
};

// Sentinel for the last-synced width/height/dpr guard. A real size is always
// >= 0 and a real dpr always >= 1, so -1 can never equal a genuine value and
// therefore forces the first `syncBackingStore` to run rather than short-circuit.
const NOT_YET_SYNCED = -1;

/**
 * A raster drawing surface backed by a `<canvas>` element and a live
 * `CanvasRenderingContext2D`.
 *
 * The component keeps two sizes in lockstep: the CSS size the framework commits
 * (`setWidth` / `setHeight`) and the backing store (the element's `width` /
 * `height` attributes, sized CSS × device-pixel-ratio for a crisp HiDPI
 * result). Callers draw in CSS pixels via the {@link CanvasDrawCallback} `onDraw`
 * hook — the dpr transform is applied for them. Because reassigning the backing
 * store wipes it, `onDraw` is re-invoked after every resize / DPR change; content
 * that must survive a resize belongs there rather than in a one-off
 * {@link Canvas.getContext} draw.
 *
 * `Canvas` is **live-only**: a rendering context cannot be modelled offline or
 * forwarded across a worker, so under a modelled sink `getContext` returns `null`
 * and every draw path no-ops.
 *
 * @category Components
 */
class Canvas extends Component<CanvasOptions> {

    /** Cached 2D context; `null` offline or before the element renders. */
    private _ctx: CanvasRenderingContext2D | null = null;

    /** Active animation-frame handle; `null` when the loop is idle. */
    private _rafId: number | null = null;

    /** Consumer/auto intent to animate; the loop actually runs only while also
     *  effectively visible (or animateWhenHidden is set). Plain initializer:
     *  never written during the super() cascade (only startAnimation /
     *  stopAnimation, which run post-render, write it), so it needs no
     *  `declare`. */
    private _animationRequested = false;

    /** Last-synced CSS width; guards against a redundant backing-store wipe. */
    private _syncedWidth: number = NOT_YET_SYNCED;

    /** Last-synced CSS height; guards against a redundant backing-store wipe. */
    private _syncedHeight: number = NOT_YET_SYNCED;

    /** Last-synced device-pixel ratio; guards against a redundant wipe. */
    private _syncedDpr: number = NOT_YET_SYNCED;

    /** Generation counter so only the newest DPR-watch arm acts on a change. */
    private _dprToken: number = 0;

    /**
     * Constructs a raster canvas.
     *
     * @param options - Optional construction options.
     */
    constructor(options?: CanvasOptions) {
        super(options, _defaultCanvasOptions);

        this.clearInsets();
    }

    /**
     * Forwards the consumer-configurable `onDraw` hook to its setter.
     *
     * @param options - The construction options.
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: CanvasOptions): this {
        super.applyOptions(options);

        if (options.onDraw !== undefined) {
            this.setOnDraw(options.onDraw);
        }

        if (options.animateWhenHidden !== undefined) {
            this.setAnimateWhenHidden(options.animateWhenHidden);
        }

        return this;
    }

    /**
     * Returns the 2D rendering context, lazily obtaining it from the seam on
     * first access once the element exists.
     *
     * @returns The context, or `null` offline / before the element renders.
     */
    getContext(): CanvasRenderingContext2D | null {
        if (this._ctx) {
            return this._ctx;
        }

        const element = this.getElement();
        if (!element) {
            return null;
        }

        this._ctx = DOM.sink.getContext(element, "2d") as CanvasRenderingContext2D | null;

        return this._ctx;
    }

    /**
     * Sets (or clears) the draw hook and triggers an immediate redraw.
     *
     * @param handler - The draw callback, or `null` to clear it.
     * @returns This component, for method chaining.
     */
    setOnDraw(handler: CanvasDrawCallback | null): this {
        this._options.onDraw = handler ?? undefined;
        this.redraw();

        return this;
    }

    /**
     * Returns the current draw hook.
     *
     * @returns The draw callback, or `null` when none is set.
     */
    getOnDraw(): CanvasDrawCallback | null {
        return this._options.onDraw ?? null;
    }

    /**
     * Clears the surface (in CSS pixels) and re-invokes `onDraw` against the
     * current context. Public so a consumer can force a repaint after mutating
     * its own model without a resize. No-ops when the context is unavailable.
     *
     * @returns This component, for method chaining.
     */
    redraw(): this {
        const ctx = this.getContext();
        if (!ctx) {
            return this;
        }

        const width  = this.getWidth();
        const height = this.getHeight();

        ctx.clearRect(0, 0, width, height);
        this._options.onDraw?.(ctx, width, height);

        return this;
    }

    /**
     * Starts a per-frame redraw loop. Idempotent: a second call while already
     * animating does not schedule a second frame. Records the intent to
     * animate; the loop only actually runs while the canvas is also
     * effectively on-screen (or {@link setAnimateWhenHidden} opts out).
     *
     * @returns This component, for method chaining.
     */
    startAnimation(): this {
        this._animationRequested = true;
        this.reconcileAnimation();

        return this;
    }

    /**
     * Stops the per-frame redraw loop, cancelling any pending frame. Clears
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
     * Whether the per-frame redraw loop is currently running. `false` while
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
        return this._options.animateWhenHidden ?? false;
    }

    /**
     * Reusable seam shared with the WebGL sibling: resizes the backing store to
     * CSS × dpr, re-applies the dpr transform (reassigning the attributes resets
     * all context state), and redraws. Called from `doLayout` on every size
     * change. Reads only cached CSS sizes — never DOM geometry, which inside
     * `doLayout` is still buffered — and short-circuits when width/height/dpr are
     * unchanged so idle layout passes never wipe the buffer.
     */
    protected syncBackingStore(): void {
        const ctx = this.getContext();
        if (!ctx) {
            return;
        }

        const width  = this.getWidth();
        const height = this.getHeight();
        const dpr    = DOM.source.getDevicePixelRatio();

        if (width === this._syncedWidth && height === this._syncedHeight && dpr === this._syncedDpr) {
            return;
        }

        const element = this.getElement()!;

        DOM.sink.apply(element, { setAttr: {
            width:  String(Math.round(width  * dpr)),
            height: String(Math.round(height * dpr)),
        }});

        // Reassigning the backing-store attributes reset the context, so re-apply
        // the dpr scale (identity skew/translate, dpr on both axes) — one context
        // unit is then one CSS pixel and callers draw in logical coordinates.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this._syncedWidth  = width;
        this._syncedHeight = height;
        this._syncedDpr    = dpr;

        this.redraw();
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
        this.reconcileAnimation();

        return this;
    }

    /**
     * Renders the element and arms the DPR-change watcher.
     *
     * @returns The created element handle.
     */
    protected render(): Handle {
        const element = super.render();

        this.watchDevicePixelRatio();

        return element;
    }

    /**
     * Stops the animation loop before the inherited destructor detaches the
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
        } else if (this._rafId !== null) {
            DOM.sink.cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /**
     * One animation-frame step: self-pauses when it should no longer animate
     * — the ONLY signal a hidden-tab surface receives, because `Tab` does not
     * lay out an inactive panel — otherwise redraws and reschedules. Arrow
     * field so the rAF callback keeps a stable bound ref.
     */
    private readonly animationStep = (): void => {
        if (!this.shouldAnimate()) {
            this._rafId = null;
            return;
        }

        this.redraw();
        this._rafId = DOM.sink.requestAnimationFrame(this.animationStep);
    };

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

const CanvasCallable = callable(Canvas);
type CanvasCallable = Canvas;
export {
    Canvas         as _Canvas,
    CanvasCallable as Canvas
};
