// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { Size } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";

/**
 * Which axes of a {@link FlowLayout}'s cells are made uniform so wrapped items
 * line up into a grid.
 *
 * - `"none"` (the default) — each item keeps its own preferred size and lines
 *   pack independently, so columns do not align across lines.
 * - `"width"` — every cell takes the widest item's width, so columns align
 *   horizontally; each line still uses its own (tallest-item) height.
 * - `"height"` — every cell takes the tallest item's height, so lines align
 *   vertically; widths still vary per item.
 * - `"both"` — every cell is identical (widest × tallest), a full grid.
 *
 * @category Layouts
 */
export type FlowUniformity = "none" | "width" | "height" | "both";

/**
 * How a {@link FlowLayout} packs each wrapped line's content block along the
 * line's main axis within the container's inner main extent.
 *
 * - `"start"` (the default) — the content packs at the leading edge, leaving the
 *   trailing residual empty. For {@link HFlow} this is the west edge; for
 *   {@link VFlow} the north edge.
 * - `"center"` — the residual is split, centring the content block.
 * - `"end"` — the content packs at the trailing edge (HFlow east, VFlow south).
 *
 * @remarks This positions each line's content as a single block; it does not
 * redistribute inter-item spacing (no justify/space-between). It is also
 * distinct from a child's {@link AnchorType}, which positions a child within its
 * own (possibly uniform) cell — both still apply.
 *
 * @category Layouts
 */
export type FlowAlign = "start" | "center" | "end";

/**
 * Construction-time options shared by {@link HFlow} and {@link VFlow}.
 *
 * @category Layouts
 */
export interface FlowLayoutOptions extends LayoutManagerOptions {
    spacing?:     number;
    lineSpacing?: number;
    uniform?:     FlowUniformity;
    align?:       FlowAlign;
}

/**
 * Abstract base for the wrapping flow layouts {@link HFlow} and {@link VFlow}.
 * Holds the axis-agnostic configuration plumbing — item spacing, line spacing,
 * cell uniformity, and line alignment — and the shared cell-measurement
 * helpers, and dispatches a {@link FlowLayoutOptions} bag.
 *
 * @remarks This deliberately does not extend {@link BoxLayout}. That base models
 * a non-wrapping single-axis box — `mode`, `stretching`, `weight`, proportional
 * shrink, and a min-total overflow inflation — none of which a wrapping flow
 * uses. The geometric algorithms (`getPreferredSize`, `getMinSize`,
 * `getMaxSize`, `doLayout`) are mirror-image per axis and stay concrete on each
 * subclass.
 *
 * @category Layouts
 */
export abstract class FlowLayout extends LayoutManager {

    // `protected`, not `private`: the subclasses' geometric methods
    // (getPreferredSize/getMinSize/getMaxSize/doLayout) read these fields
    // directly, so they must be visible to HFlow/VFlow.
    protected _spacing: number = 5;
    protected _lineSpacing: number = 5;
    protected _uniform: FlowUniformity = "none";
    protected _align: FlowAlign = "start";

    /**
     * Constructs the layout manager, applying any supplied options.
     *
     * @param options - Optional construction-time configuration.
     */
    constructor(options?: FlowLayoutOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link FlowLayoutOptions} bag after the inherited LayoutManager
     * defaults, dispatching the item and line spacings, the uniformity mode, and
     * the line alignment.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: FlowLayoutOptions): void {
        super.applyOptions(options);

        if (options.spacing !== undefined) {
            this.setComponentSpacing(options.spacing);
        }

        if (options.lineSpacing !== undefined) {
            this.setLineSpacing(options.lineSpacing);
        }

        if (options.uniform !== undefined) {
            this.setUniform(options.uniform);
        }

        if (options.align !== undefined) {
            this.setAlign(options.align);
        }
    }

    /**
     * Returns the pixel spacing between items along a line.
     *
     * @returns The current item spacing in pixels.
     */
    getComponentSpacing(): number {
        return this._spacing || 0;
    }

    /**
     * Sets the pixel spacing between items along a line.
     *
     * @param spacing - Spacing in pixels.
     *
     * @returns This layout manager, for method chaining.
     */
    setComponentSpacing(spacing: number): this {
        this._spacing = spacing || 0;

        return this;
    }

    /**
     * Returns the pixel spacing between wrapped lines.
     *
     * @returns The current line spacing in pixels.
     */
    getLineSpacing(): number {
        return this._lineSpacing || 0;
    }

    /**
     * Sets the pixel spacing between wrapped lines.
     *
     * @param lineSpacing - Spacing in pixels.
     *
     * @returns This layout manager, for method chaining.
     */
    setLineSpacing(lineSpacing: number): this {
        this._lineSpacing = lineSpacing || 0;

        return this;
    }

    /**
     * Returns which axes are made uniform so wrapped items align into a grid.
     *
     * @returns The current uniformity mode.
     */
    getUniform(): FlowUniformity {
        return this._uniform;
    }

    /**
     * Sets which axes are made uniform so wrapped items align into a grid.
     *
     * @param uniform - `"width"` aligns columns, `"height"` aligns rows,
     *   `"both"` produces a full grid, `"none"` packs each item at its own
     *   size. See {@link FlowUniformity}.
     *
     * @returns This layout manager, for method chaining.
     */
    setUniform(uniform: FlowUniformity): this {
        this._uniform = uniform;

        return this;
    }

    /**
     * Returns how each wrapped line's content block is packed along the main
     * axis within the container's inner main extent.
     *
     * @returns The current line alignment.
     */
    getAlign(): FlowAlign {
        return this._align;
    }

    /**
     * Sets how each wrapped line's content block is packed along the main axis.
     *
     * @param align - `"start"` packs at the leading edge (the default),
     *   `"center"` centres the block, `"end"` packs at the trailing edge. The
     *   leading/trailing edges are west/east for {@link HFlow} and north/south
     *   for {@link VFlow}. See {@link FlowAlign}.
     *
     * @returns This layout manager, for method chaining.
     */
    setAlign(align: FlowAlign): this {
        this._align = align;

        return this;
    }

    /**
     * Whether cells are made uniform on the horizontal axis (columns align).
     *
     * @returns `true` for the `"width"` and `"both"` uniformity modes.
     */
    protected isUniformWidth(): boolean {
        return this._uniform === "width" || this._uniform === "both";
    }

    /**
     * Whether cells are made uniform on the vertical axis (rows align).
     *
     * @returns `true` for the `"height"` and `"both"` uniformity modes.
     */
    protected isUniformHeight(): boolean {
        return this._uniform === "height" || this._uniform === "both";
    }

    /**
     * Computes the uniform cell extent: the widest and tallest clamped preferred
     * size across the children, used to size cells in a `uniform` mode.
     *
     * @param components - The children sharing the flow.
     * @returns The `{width, height}` every uniform cell uses on its axis.
     */
    protected computeUniformExtents(components: Component[]): Size {
        let width = 0;
        let height = 0;

        for (const component of components) {
            const cell = this.clampedPreferredSize(component);

            width  = Math.max(width,  cell.width);
            height = Math.max(height, cell.height);
        }

        return {
            width: width,
            height: height
        };
    }

    /**
     * Resolves a child's placed size: its preferred size clamped to its own
     * min and max sizes.
     *
     * @param component - The child to measure.
     * @returns The clamped `{width, height}`.
     */
    protected clampedPreferredSize(component: Component): Size {
        const pref = component.getPreferredSize();
        const min  = component.getMinSize();
        const max  = component.getMaxSize();

        let width  = pref ? pref.width : 0;
        let height = pref ? pref.height : 0;

        if (min) {
            width  = Math.max(width,  min.width);
            height = Math.max(height, min.height);
        }

        if (max) {
            width  = Math.min(width,  max.width);
            height = Math.min(height, max.height);
        }

        return {
            width: width,
            height: height
        };
    }

    /**
     * Computes the per-line leading offset that packs a content block of the
     * given main extent within the inner main extent per the alignment mode.
     *
     * @param contentMain - The line's content main-extent (sum of placed cell
     *   main-extents plus inter-item spacing).
     * @param innerMain - The container's inner extent along the main axis.
     * @returns The leading offset in pixels — `0` for `"start"`, half the
     *   residual for `"center"`, the full residual for `"end"`. An over-long
     *   line (content exceeding the inner extent) clamps to `0`.
     */
    protected alignLead(contentMain: number, innerMain: number): number {
        const residual = Math.max(0, innerMain - contentMain);

        if (this._align === "center") {
            return residual / 2;
        }

        if (this._align === "end") {
            return residual;
        }

        return 0;
    }
}
