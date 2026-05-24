// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Column}.
 *
 * @category Layouts
 */
export interface ColumnOptions extends LayoutManagerOptions {
    gap?:        number;
    stretching?: boolean;
}

/**
 * A layout manager that divides the container width equally among all children
 * and places them left-to-right with a configurable gap.
 *
 * @category Layouts
 */
class Column extends LayoutManager {

    private _gap: number = 5;
    private _stretching: boolean = true;

    constructor(options?: ColumnOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link ColumnOptions} bag, dispatching gap and stretching
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ColumnOptions): void {
        super.applyOptions(options);

        if (options.gap !== undefined) {
            this.setGap(options.gap);
        }

        if (options.stretching !== undefined) {
            this.setStretching(options.stretching);
        }
    }

    /**
     * Returns the pixel gap between columns.
     *
     * @returns The current gap in pixels.
     */
    getGap() {
        return this._gap;
    }

    /**
     * Sets the pixel gap between columns and triggers a re-layout.
     *
     * @param gap - Gap size in pixels.
     */
    setGap(gap : number) : this {
        this._gap = gap;
        this.doLayout();

        return this;
    }

    /**
     * Returns whether children stretch to fill the container height.
     *
     * @returns `true` if stretching is enabled (default).
     */
    isStretching(): boolean {
        return this._stretching;
    }

    /**
     * Sets whether children stretch to fill the container height. When `false`,
     * children use their preferred heights and are baseline-aligned within the row.
     *
     * @param stretching - Pass `false` to enable baseline alignment instead of stretching.
     */
    setStretching(stretching: boolean): this {
        this._stretching = stretching;

        return this;
    }

    /**
     * Computes the preferred size as the maximum child preferred dimensions
     * arranged horizontally with gaps. When stretching is disabled the height
     * reflects baseline-aligned row metrics.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = 0;
        let innerHeight = 0;

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
                heights.push(size.height);
                baselines.push(component.getBaseline());
            }
        }

        if (!this._stretching) {
            innerHeight = this.computeRowHeight(heights, baselines);
        }

        innerWidth = components.length * (innerWidth + this._gap) - this._gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the minimum size as the maximum child minimum dimensions
     * arranged horizontally with gaps. When stretching is disabled the height
     * reflects baseline-aligned row metrics.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = 0;
        let innerHeight = 0;

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
                heights.push(size.height);
                baselines.push(component.getBaseline());
            }
        }

        if (!this._stretching) {
            innerHeight = this.computeRowHeight(heights, baselines);
        }

        innerWidth = components.length * (innerWidth + this._gap) - this._gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the maximum size as the minimum child maximum dimensions
     * arranged horizontally with gaps.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = Number.MAX_SAFE_INTEGER;
        let innerHeight = Number.MAX_SAFE_INTEGER;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMaxSize();

            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight = Math.min(innerHeight, size.height);
            }
        }

        innerWidth = components.length * (innerWidth + this._gap) - this._gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * width is `count * maxChildMinWidth + gaps` (Column distributes width
     * equally so the per-cell floor is the max of every child's min width);
     * height is `max(children.minHeight)`. Used by `doLayout` to inflate the
     * working size when the host has opted into `setOverflowing`.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent or has no children.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const components = container.getComponents();
        if (components.length === 0) {
            return { width: 0, height: 0 };
        }

        let maxWidth = 0;
        let maxHeight = 0;

        for (const component of components) {
            const min = component.getMinSize();
            if (min) {
                maxWidth  = Math.max(maxWidth,  min.width);
                maxHeight = Math.max(maxHeight, min.height);
            }
        }

        return {
            width:  components.length * (maxWidth + this._gap) - this._gap,
            height: maxHeight,
        };
    }

    /**
     * Divides the container width equally among children and places them
     * left-to-right with gaps.
     *
     * @remarks When stretching is enabled (default) every child fills the full
     * container height. When stretching is disabled the children use their
     * preferred heights and are baseline-aligned within the row, mirroring
     * [`HBox`](/api/layout/classes/HBox)'s baseline-aware placement.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let containerInsets = container.getInsets();

        // Universal scroll: see HBox.doLayout for the rationale. Inflates the
        // working size to the children's combined minSize on the axes the
        // host has marked as overflowing.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        // Clamp the per-cell width to the largest child's minSize, mirroring
        // HBox.doLayout's `width = Math.max(width, minSize.width)` invariant.
        // When the equal-share is smaller than a child's min width, the row
        // total exceeds the container — trailing cells spill past the right
        // edge and the host's `overflow: hidden` (or `setAutoScroll`) takes
        // over. Without the clamp, Column silently squeezes children with
        // fixed-graphic minSizes (e.g. RadioButton rings) below their min
        // width and clips them.
        let maxChildMinWidth = 0;
        for (const component of components) {
            const min = component.getMinSize();
            if (min) {
                maxChildMinWidth = Math.max(maxChildMinWidth, min.width);
            }
        }

        const equalShare = (containerSize.width - this._gap * (components.length - 1)) / components.length;
        let columnWidth  = Math.max(equalShare, maxChildMinWidth);

        if (this._stretching) {
            let columnHeight = containerSize.height;
            let x = containerInsets.getLeft();
            let y = containerInsets.getTop();

            for (let idx in components) {
                let component = components[idx];

                this.placeComponent(
                    component,
                    x,
                    y,
                    columnWidth,
                    columnHeight,
                    FillType.BOTH
                );

                x += columnWidth + this._gap;
            }

            return;
        }

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            let size = component.getPreferredSize();
            let height = size ? size.height : 0;

            heights.push(height);
            baselines.push(component.getBaseline());
        }

        const { rowAscent, rowDescent } = this.computeRowMetrics(heights, baselines);

        let x = containerInsets.getLeft();

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            const height = heights[idx];

            let y: number;

            if (rowAscent !== null) {
                const b = baselines[idx];

                if (b !== null) {
                    y = containerInsets.getTop() + (rowAscent - b);
                } else {
                    y = containerInsets.getTop() + this.nullChildY(height, rowAscent, rowDescent);
                }
            } else {
                y = containerInsets.getTop();
            }

            this.placeComponent(
                component,
                x,
                y,
                columnWidth,
                height,
                FillType.BOTH
            );

            x += columnWidth + this._gap;
        }
    }
}

const ColumnCallable = callable(Column);
type ColumnCallable = Column;
export {
    Column         as _Column,
    ColumnCallable as Column
};
