// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Which axes of an {@link HFlow}'s cells are made uniform so wrapped items
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
 * Construction-time options for {@link HFlow}.
 *
 * @category Layouts
 */
export interface HFlowOptions extends LayoutManagerOptions {
    spacing?:     number;
    lineSpacing?: number;
    uniform?:     FlowUniformity;
}

/**
 * A layout manager that packs children in horizontal rows, wrapping to a new
 * line when the next child would exceed the container's inner width. Unlike
 * {@link HBox} it never shrinks or stretches children: each keeps its preferred
 * size and lines stack downward. A scroll-enabled host (`Panel.setAutoScroll`)
 * gains a vertical scrollbar once the stacked lines exceed its inner height.
 *
 * @remarks This deliberately does not extend {@link BoxLayout}. That base models
 * a non-wrapping single-axis box — `mode`, `stretching`, `weight`, proportional
 * shrink, and a min-total overflow inflation — none of which a wrapping flow
 * uses; the scroll extent here comes entirely from the children's committed
 * positions read by `reserveContentFrame`. The `uniform` option grows every
 * cell to the widest and/or tallest item so wrapped items line up into a grid;
 * each item is positioned within its cell by its own {@link AnchorType}
 * constraint (default centre).
 *
 * @category Layouts
 */
class HFlow extends LayoutManager {

    private _spacing: number = 5;
    private _lineSpacing: number = 5;
    private _uniform: FlowUniformity = "none";

    /**
     * Constructs the layout manager, applying any supplied options.
     *
     * @param options - Optional construction-time configuration.
     */
    constructor(options?: HFlowOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link HFlowOptions} bag after the inherited LayoutManager
     * defaults, dispatching the item and line spacings and the uniformity mode.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: HFlowOptions): void {
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
    }

    /**
     * Returns the horizontal pixel spacing between items on a line.
     *
     * @returns The current item spacing in pixels.
     */
    getComponentSpacing(): number {
        return this._spacing || 0;
    }

    /**
     * Sets the horizontal pixel spacing between items on a line.
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
     * Returns the vertical pixel spacing between wrapped lines.
     *
     * @returns The current line spacing in pixels.
     */
    getLineSpacing(): number {
        return this._lineSpacing || 0;
    }

    /**
     * Sets the vertical pixel spacing between wrapped lines.
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
     * Returns the preferred size: the single-line shape of the children — the
     * sum of their preferred widths plus item spacing, and the baseline-aware
     * row height of the tallest child. In a `uniform` width mode the width is
     * instead `count * columnWidth`; in a `uniform` height mode the height is
     * the tallest cell.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     *
     * @remarks This is an approximation. The real height depends on how many
     * lines the children wrap into, which is only known once the parent assigns
     * a width — unavailable when the hint is queried. The parent absorbs the
     * difference: a scroll-enabled host scrolls vertically when the real wrapped
     * height exceeds this single-line estimate.
     */
    getPreferredSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimiterSize = container.getPerimiterSize();
        const components = container.getComponents();
        const uniformWidth  = this.isUniformWidth();
        const uniformHeight = this.isUniformHeight();
        const extents = (uniformWidth || uniformHeight) ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        let width = perimiterSize.left + perimiterSize.right;
        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (const component of components) {
            const size = component.getPreferredSize();

            if (size) {
                if (!uniformWidth) {
                    width += size.width;
                }

                heights.push(size.height);
                baselines.push(component.getBaseline());
            }
        }

        if (uniformWidth) {
            width += components.length * extents.width;
        }

        width += this._spacing * Math.max(0, components.length - 1);

        let height = uniformHeight ? extents.height : this.computeRowHeight(heights, baselines);

        height += perimiterSize.top + perimiterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the minimum size: the widest child's min width (the floor below
     * which not even one child per line fits) and the baseline-aware row height
     * of the children's min heights.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimiterSize = container.getPerimiterSize();
        const components = container.getComponents();

        let maxChildMinWidth = 0;
        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (const component of components) {
            const size = component.getMinSize();

            if (size) {
                maxChildMinWidth = Math.max(maxChildMinWidth, size.width);
                heights.push(size.height);
                baselines.push(component.getBaseline());
            }
        }

        const width = perimiterSize.left + perimiterSize.right + maxChildMinWidth;

        let height = this.computeRowHeight(heights, baselines);

        height += perimiterSize.top + perimiterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the maximum size: the sum of the children's preferred widths
     * (or `count * columnWidth` in a `uniform` width mode) plus item spacing,
     * and the smallest of their max heights.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimiterSize = container.getPerimiterSize();
        const components = container.getComponents();
        const uniformWidth = this.isUniformWidth();
        const extents = uniformWidth ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        let width = perimiterSize.left + perimiterSize.right;
        let height = Number.MAX_SAFE_INTEGER;

        for (const component of components) {
            if (!uniformWidth) {
                const pref = component.getPreferredSize();

                if (pref) {
                    width += pref.width;
                }
            }

            const max = component.getMaxSize();

            if (max) {
                height = Math.min(height, max.height);
            }
        }

        if (uniformWidth) {
            width += components.length * extents.width;
        }

        width += this._spacing * Math.max(0, components.length - 1);
        height += perimiterSize.top + perimiterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Packs the children left-to-right at their cell size, wrapping to a new
     * line when the next cell's right edge would exceed the inner width, and
     * lets `y` accumulate so trailing lines land past the viewport. In a
     * `uniform` mode every cell grows to the widest and/or tallest item so the
     * wrapped items line up into a grid. A scroll-enabled host then scrolls the
     * overflow via `reserveContentFrame`, which sizes the content frame to the
     * children's committed extent.
     */
    doLayout(): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const innerSize = container.getInnerSize();
        if (!innerSize) {
            return;
        }

        const components  = container.getComponents();
        const insets      = container.getContentInsets();
        const spacing     = this.getComponentSpacing();
        const lineSpacing = this.getLineSpacing();

        const uniformWidth  = this.isUniformWidth();
        const uniformHeight = this.isUniformHeight();
        const extents = (uniformWidth || uniformHeight) ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        const lineStartX = insets.getLeft();
        let x = lineStartX;
        let y = insets.getTop();
        let lineHeight = 0;

        for (const component of components) {
            const cell = this.clampedPreferredSize(component);
            const cellWidth  = uniformWidth  ? extents.width  : cell.width;
            const cellHeight = uniformHeight ? extents.height : cell.height;

            // Wrap before placing when this is not the first cell on the line
            // and its right edge would spill past the inner width.
            if (x > lineStartX && (x - lineStartX) + cellWidth > innerSize.width) {
                y += lineHeight + lineSpacing;
                x  = lineStartX;
                lineHeight = 0;
            }

            // A cell wider than the inner width occupies its own line clamped to
            // that width, so its right edge stays inside a scrolling host.
            const placedWidth = (x === lineStartX) ? Math.min(cellWidth, innerSize.width) : cellWidth;

            // FillType.NONE keeps each child at its preferred size; the child's
            // own anchor (default CENTER) positions it within the cell, which
            // only matters in a uniform mode where the cell exceeds the child.
            this.placeComponent(component, x, y, placedWidth, cellHeight, FillType.NONE);

            x += placedWidth + spacing;
            lineHeight = Math.max(lineHeight, cellHeight);
        }

        this.reserveContentFrame();
    }

    /**
     * Whether cells are made uniform on the horizontal axis (columns align).
     *
     * @returns `true` for the `"width"` and `"both"` uniformity modes.
     */
    private isUniformWidth(): boolean {
        return this._uniform === "width" || this._uniform === "both";
    }

    /**
     * Whether cells are made uniform on the vertical axis (rows align).
     *
     * @returns `true` for the `"height"` and `"both"` uniformity modes.
     */
    private isUniformHeight(): boolean {
        return this._uniform === "height" || this._uniform === "both";
    }

    /**
     * Computes the uniform cell extent: the widest and tallest clamped preferred
     * size across the children, used to size cells in a `uniform` mode.
     *
     * @param components - The children sharing the flow.
     * @returns The `{width, height}` every uniform cell uses on its axis.
     */
    private computeUniformExtents(components: Component[]): Size {
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
    private clampedPreferredSize(component: Component): Size {
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
}

const HFlowCallable = callable(HFlow);
type HFlowCallable = HFlow;
export {
    HFlow         as _HFlow,
    HFlowCallable as HFlow
};
