// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { AbstractCanvasSurface, AbstractCanvasSurfaceOptions } from "~/component/display/AbstractCanvasSurface.js";
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
export interface CanvasOptions extends AbstractCanvasSurfaceOptions {

    /** Draw hook, re-invoked on demand and after every resize / DPR change. */
    onDraw?: CanvasDrawCallback;
}

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
class Canvas extends AbstractCanvasSurface<CanvasOptions> {

    /** Cached 2D context; `null` offline or before the element renders. */
    private _ctx: CanvasRenderingContext2D | null = null;

    /**
     * Constructs a raster canvas.
     *
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: CanvasOptions, subclassDefaults?: Partial<CanvasOptions>) {
        super(options, subclassDefaults);

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
     * Whether the 2D context is available.
     *
     * @returns `true` when a context exists.
     */
    protected hasRenderingContext(): boolean {
        return this.getContext() !== null;
    }

    /**
     * Re-applies the dpr scale — reassigning the backing-store attributes
     * reset the context, so without this a context unit would no longer be
     * one CSS pixel.
     *
     * @param _backingWidth - Unused; the 2D transform scales rather than sizing.
     * @param _backingHeight - Unused; the 2D transform scales rather than sizing.
     * @param dpr - The device-pixel ratio the resize was computed against.
     */
    protected onBackingStoreResized(_backingWidth: number, _backingHeight: number, dpr: number): void {
        this.getContext()!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** Redraws via {@link Canvas.redraw}. */
    protected drawFrame(): void {
        this.redraw();
    }
}

const CanvasCallable = callable(Canvas);
type CanvasCallable = Canvas;
export {
    Canvas         as _Canvas,
    CanvasCallable as Canvas
};
