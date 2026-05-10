// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "./LayoutManager.js";
import { FillType } from "./FillType.js";
import { Size } from "../Size.js";

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
export class Column extends LayoutManager {

    private gap: number = 5;
    private stretching: boolean = true;

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
            this.gap = options.gap;
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
        return this.gap;
    }

    /**
     * Sets the pixel gap between columns and triggers a re-layout.
     *
     * @param gap - Gap size in pixels.
     */
    setGap(gap : number) {
        this.gap = gap;
        this.doLayout();
    }

    /**
     * Returns whether children stretch to fill the container height.
     *
     * @returns `true` if stretching is enabled (default).
     */
    isStretching(): boolean {
        return this.stretching;
    }

    /**
     * Sets whether children stretch to fill the container height. When `false`,
     * children use their preferred heights and are baseline-aligned within the row.
     *
     * @param stretching - Pass `false` to enable baseline alignment instead of stretching.
     */
    setStretching(stretching: boolean): void {
        this.stretching = stretching;
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

        if (!this.stretching) {
            innerHeight = this.computeRowHeight(heights, baselines);
        }

        innerWidth = components.length * (innerWidth + this.gap) - this.gap;

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

        if (!this.stretching) {
            innerHeight = this.computeRowHeight(heights, baselines);
        }

        innerWidth = components.length * (innerWidth + this.gap) - this.gap;

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

        innerWidth = components.length * (innerWidth + this.gap) - this.gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Divides the container width equally among children and places them
     * left-to-right with gaps.
     *
     * @remarks When stretching is enabled (default) every child fills the full
     * container height. When stretching is disabled the children use their
     * preferred heights and are baseline-aligned within the row, mirroring
     * `HBox`'s baseline-aware placement.
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

        let columnWidth = (containerSize.width - (this.gap * components.length) + this.gap) / components.length;

        if (this.stretching) {
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

                x += columnWidth + this.gap;
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

            x += columnWidth + this.gap;
        }
    }
}
