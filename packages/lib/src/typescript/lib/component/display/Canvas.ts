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
 * @param elapsedMs - Milliseconds since the current animation run started, or
 *   `0` when the canvas is not animating. Derive motion from this rather than
 *   advancing a counter once per call: frames arrive at the display's refresh
 *   rate, so a per-call increment runs three times faster on a 180Hz monitor
 *   than on a 60Hz one. Outside the animation loop (a resize, a DPR change, an
 *   explicit {@link Canvas.redraw}) this repeats the most recent frame's value,
 *   so a redraw re-renders the same moment rather than jumping.
 *
 * @category Components
 */
export type CanvasDrawCallback = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedMs: number,
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

    /**
     * Upper bound, in frames per second, on how often the animation loop
     * redraws. Defaults to 30 — enough for smooth motion at a predictable cost,
     * and independent of the display's refresh rate, so the same animation
     * costs the same on a 60Hz and a 180Hz monitor. Pass `0` to opt out and
     * redraw on every animation frame the browser delivers. A positive value
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
const _defaultCanvasOptions: Partial<CanvasOptions> = {
    tag: "canvas",
    maxFps: 30,
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

    // Frame clock for the animation loop. `_animationStartMs` is null until the
    // first frame of a run anchors it, so elapsed time starts at 0 for that
    // frame however long the run waited to be scheduled. `_lastDrawMs` gates
    // the maxFps cap and `_elapsedMs` is what the draw hook is handed, kept as
    // a field so redraws from outside the loop repeat the last frame's value.
    private _animationStartMs: number | null = null;
    private _lastDrawMs      : number | null = null;
    private _elapsedMs                       = 0;

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
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: CanvasOptions, subclassDefaults?: Partial<CanvasOptions>) {
        super(options, { ..._defaultCanvasOptions, ...(subclassDefaults ?? {}) });

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

        if (options.maxFps !== undefined) {
            this.setMaxFps(options.maxFps);
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
        return this._options.onDraw ?? this._defaultOptions.onDraw ?? null;
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
        this.getOnDraw()?.(ctx, width, height, this._elapsedMs);

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
        this._animationStartMs   = null;
        this._lastDrawMs         = null;
        this._elapsedMs          = 0;
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
     * Caps how often the animation loop redraws, in frames per second. Takes
     * effect on the next frame; the loop keeps running either way, so this
     * thins redraws rather than pausing anything. Because frames are delivered
     * at the display's refresh rate, an uncapped loop costs proportionally more
     * on a high-refresh monitor — a cap makes that cost predictable.
     *
     * @param fps - Maximum redraws per second, or `0` to remove the cap entirely.
     *   Negative values are treated as `0`. The class default is 30.
     * @returns This component, for method chaining.
     */
    setMaxFps(fps: number): this {
        // On the options bag rather than a private field, matching
        // `animateWhenHidden` above: `applyOptions` runs inside the `super()`
        // cascade, before this class's field initializers, so a plain
        // `_maxFps = 0` initializer would overwrite a construction-time value.
        this._options.maxFps = Math.max(0, fps);

        return this;
    }

    /**
     * Returns the current redraw cap in frames per second.
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
     * Returns whether the animation loop keeps running while hidden.
     *
     * @returns `true` if the loop ignores effective visibility.
     */
    getAnimateWhenHidden(): boolean {
        return this._options.animateWhenHidden ?? this._defaultOptions.animateWhenHidden ?? false;
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
     * requested, otherwise redraws and reschedules. Effective-visibility
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

        // A skipped frame still reschedules: the cap thins out redraws, it does
        // not stop the loop, so raising maxFps again takes effect immediately.
        const maxFps        = this.getMaxFps();
        const minIntervalMs = maxFps > 0 ? 1000 / maxFps : 0;
        const dueForRedraw  = this._lastDrawMs === null
            || timestamp - this._lastDrawMs >= minIntervalMs;

        if (dueForRedraw) {
            this._lastDrawMs = timestamp;
            this._elapsedMs  = timestamp - this._animationStartMs;
            this.redraw();
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
