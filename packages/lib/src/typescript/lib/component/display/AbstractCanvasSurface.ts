// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Construction-time options shared by every {@link AbstractCanvasSurface}
 * subclass.
 *
 * @category Components
 */
export interface AbstractCanvasSurfaceOptions extends ComponentOptions {

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
const _defaultAbstractCanvasSurfaceOptions: Partial<AbstractCanvasSurfaceOptions> = {
    tag: "canvas",
    maxFps: 30,
};

// Sentinel for the last-synced width/height/dpr guard. A real size is always
// >= 0 and a real dpr always >= 1, so -1 can never equal a genuine value and
// therefore forces the first `syncBackingStore` to run rather than short-circuit.
const NOT_YET_SYNCED = -1;

/** Live canvas surfaces, weakly held so an unrooted one stays collectable. */
const _surfaces: Set<WeakRef<AbstractCanvasSurface>> = new Set();

/** The ratio the current watch is armed for; 0 before the first arm. */
let _watchedDpr = 0;

/**
 * Re-syncs every live surface at the new ratio and re-arms for it. Dead
 * `WeakRef`s are pruned.
 */
function _onDevicePixelRatioChange(): void {
    for (const ref of Array.from(_surfaces)) {
        const surface = ref.deref();

        if (!surface) {
            _surfaces.delete(ref);
            continue;
        }

        surface._syncForDevicePixelRatioChange();
    }

    _armDevicePixelRatioWatch();
}

/**
 * Arms a one-shot `matchMedia` watch for the current ratio, unless one is
 * already armed for it. The seam's `matchMedia` degrades to an inert result
 * off-browser, so no environment guard is needed.
 */
function _armDevicePixelRatioWatch(): void {
    const dpr = DOM.source.getDevicePixelRatio();

    if (dpr === _watchedDpr) {
        return;
    }

    _watchedDpr = dpr;
    DOM.source.matchMedia(`(resolution: ${dpr}dppx)`).addChangeListener(_onDevicePixelRatioChange);
}

/**
 * Shared foundation for `Canvas` and `WebGLCanvas`: the animation loop, the
 * frame clock, the backing-store sync, the visibility reconciliation, and the
 * process-wide device-pixel-ratio watch. A subclass keeps its own rendering
 * context field, its own draw hooks, and three short protected seam methods —
 * whether it currently holds a live rendering context, how it re-applies
 * context state after a backing-store resize, and how it draws one frame.
 *
 * @remarks Abstract, so it is deliberately **not** wrapped with `callable()` (a
 * base with abstract members cannot be constructed); the concrete `Canvas` /
 * `WebGLCanvas` subclasses carry the callable export.
 *
 * @typeParam O - The subtype's options interface.
 *
 * @category Components
 */
export abstract class AbstractCanvasSurface<
    O extends AbstractCanvasSurfaceOptions = AbstractCanvasSurfaceOptions,
> extends Component<O> {

    /** Last-synced CSS width; guards against a redundant backing-store wipe. */
    protected _syncedWidth: number = NOT_YET_SYNCED;

    /** Last-synced CSS height; guards against a redundant backing-store wipe. */
    protected _syncedHeight: number = NOT_YET_SYNCED;

    /** Last-synced device-pixel ratio; guards against a redundant wipe. */
    protected _syncedDpr: number = NOT_YET_SYNCED;

    /** Active animation-frame handle; `null` when the loop is idle. */
    private _rafId: number | null = null;

    // Frame clock for the animation loop. `_animationStartMs` is null until the
    // first frame of a run anchors it, so elapsed time starts at 0 for that
    // frame however long the run waited to be scheduled. `_lastDrawMs` gates
    // the maxFps cap and `_elapsedMs` is what the draw hook is handed, kept as
    // a field so redraws from outside the loop repeat the last frame's value.
    private _animationStartMs: number | null = null;
    private _lastDrawMs      : number | null = null;
    /** Milliseconds since the current animation run started; read by a subclass's draw hook. */
    protected _elapsedMs = 0;

    /** Consumer/auto intent to animate; the loop actually runs only while also
     *  effectively visible (or animateWhenHidden is set). Plain initializer:
     *  never written during the super() cascade (only startAnimation /
     *  stopAnimation, which run post-render, write it), so it needs no
     *  `declare`. */
    private _animationRequested = false;

    /** This surface's registration in the module-level ratio registry, or `null` before the first render. */
    private _surfaceRef: WeakRef<AbstractCanvasSurface> | null = null;

    /**
     * Constructs a canvas surface.
     *
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: O, subclassDefaults?: Partial<O>) {
        super(options, { ..._defaultAbstractCanvasSurfaceOptions, ...(subclassDefaults ?? {}) } as Partial<O>);
    }

    /**
     * Forwards the consumer-configurable animation options to their setters.
     *
     * @param options - The construction options.
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: O): this {
        super.applyOptions(options);

        if (options.animateWhenHidden !== undefined) {
            this.setAnimateWhenHidden(options.animateWhenHidden);
        }

        if (options.maxFps !== undefined) {
            this.setMaxFps(options.maxFps);
        }

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
     * Returns whether the animation loop keeps running while hidden.
     *
     * @returns `true` if the loop ignores effective visibility.
     */
    getAnimateWhenHidden(): boolean {
        return this._options.animateWhenHidden ?? this._defaultOptions.animateWhenHidden ?? false;
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
     * Reusable seam shared with the WebGL sibling: resizes the backing store to
     * CSS × dpr, hooks the subclass's context-specific re-sync (reassigning the
     * attributes resets all context state), and draws a frame. Called from
     * `doLayout` on every size change. Reads only cached CSS sizes — never DOM
     * geometry, which inside `doLayout` is still buffered — and short-circuits
     * when width/height/dpr are unchanged so idle layout passes never wipe the
     * buffer.
     */
    protected syncBackingStore(): void {
        if (!this.hasRenderingContext()) {
            return;
        }

        const width  = this.getWidth();
        const height = this.getHeight();
        const dpr    = DOM.source.getDevicePixelRatio();

        if (width === this._syncedWidth && height === this._syncedHeight && dpr === this._syncedDpr) {
            return;
        }

        const backingWidth  = Math.round(width  * dpr);
        const backingHeight = Math.round(height * dpr);

        DOM.sink.apply(this.getElement()!, { setAttr: {
            width:  String(backingWidth),
            height: String(backingHeight),
        }});

        this.onBackingStoreResized(backingWidth, backingHeight, dpr);

        this._syncedWidth  = width;
        this._syncedHeight = height;
        this._syncedDpr    = dpr;

        this.drawFrame();
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
     * Renders the element, registers this surface in the module-level
     * device-pixel-ratio registry, and arms the watch.
     *
     * @returns The created element handle.
     */
    protected render(): Handle {
        const element = super.render();

        // Guarded so a re-render (an element released and rebuilt) does not
        // register a second `WeakRef` for the same surface.
        if (this._surfaceRef === null) {
            this._surfaceRef = new WeakRef(this);
            _surfaces.add(this._surfaceRef);
        }

        _armDevicePixelRatioWatch();

        return element;
    }

    /**
     * Re-syncs the backing store at the current device-pixel ratio. Called by
     * the module-level watch when the ratio changes; a no-op before the
     * element exists (e.g. a post-teardown fire against a stale `WeakRef`
     * this surface's own destructor already dropped, or one about to be).
     *
     * @internal — called by this module's device-pixel-ratio watcher.
     */
    _syncForDevicePixelRatioChange(): void {
        if (!this.getElement()) {
            return;
        }

        this.syncBackingStore();
    }

    /**
     * Stops the animation loop and drops this surface's registration before
     * the inherited destructor detaches the element, so no stray frame and no
     * stale `WeakRef` survive teardown.
     */
    protected destructor(): void {
        if (this._surfaceRef !== null) {
            _surfaces.delete(this._surfaceRef);
            this._surfaceRef = null;
        }

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
     * requested, otherwise draws a frame and reschedules. Effective-visibility
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
            this.drawFrame();
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
     * Whether this surface currently holds a live rendering context. Guards
     * {@link syncBackingStore}, which no-ops without one (e.g. offline, under
     * a modelled sink, or before the element renders).
     *
     * @returns `true` when a rendering context is available.
     */
    protected abstract hasRenderingContext(): boolean;

    /**
     * Re-applies whatever context state a backing-store resize resets — the
     * 2D dpr transform, or the WebGL viewport.
     *
     * @param backingWidth - The new backing-store width, in device pixels.
     * @param backingHeight - The new backing-store height, in device pixels.
     * @param dpr - The device-pixel ratio the resize was computed against.
     */
    protected abstract onBackingStoreResized(backingWidth: number, backingHeight: number, dpr: number): void;

    /** Draws (or renders) one frame against the live context. */
    protected abstract drawFrame(): void;
}
