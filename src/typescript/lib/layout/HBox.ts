// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link HBox}.
 *
 * @category Layouts
 */
export interface HBoxOptions extends LayoutManagerOptions {
    spacing?:    number;
    stretching?: boolean;
}

/**
 * A layout manager that places children in a single horizontal row,
 * using each child's preferred width and an optional height-stretching mode.
 *
 * @category Layouts
 */
class HBox extends LayoutManager {

    private spacing: number = 5;
    private stretching: boolean = false;
    private defaultComponentWidth: number = 100;

    constructor(options?: HBoxOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link HBoxOptions} bag, dispatching spacing and stretching
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: HBoxOptions): void {
        super.applyOptions(options);

        if (options.spacing !== undefined) {
            this.setComponentSpacing(options.spacing);
        }

        if (options.stretching !== undefined) {
            this.setStretching(options.stretching);
        }
    }

    /**
     * Returns the pixel spacing between child components.
     *
     * @returns The current spacing in pixels.
     */
    getComponentSpacing() {
        return this.spacing || 0;
    }

    /**
     * Sets the pixel spacing between child components.
     *
     * @param spacing - Spacing in pixels.
     */
    setComponentSpacing(spacing: number) : this {
        this.spacing = spacing || 0;

        return this;
    }

    /**
     * Returns whether children stretch to fill the container height.
     *
     * @returns `true` if stretching is enabled.
     */
    isStretching() {
        return this.stretching || false;
    }

    /**
     * Sets whether children stretch to fill the container height.
     *
     * @param stretching - Pass `true` to enable height stretching.
     */
    setStretching(stretching: boolean) : this {
        this.stretching = stretching;

        return this;
    }

    /**
     * Returns the preferred size: the sum of child widths plus spacing, and a row
     * height computed from the children's preferred heights and reported baselines.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let containerBorderSize = container.getBorderSize();
        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let width = containerInsets.getLeft() + containerInsets.getRight();

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                width += size.width;
                heights.push(size.height);
                baselines.push(component.getBaseline());
            }
        }

        let height = this.computeRowHeight(heights, baselines);

        width += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.left + containerBorderSize.right;
        height += containerInsets.getTop() + containerInsets.getBottom() + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the minimum size: the sum of child minimum widths plus spacing, and the
     * row height required by the children's minimum heights and reported baselines.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let containerBorderSize = container.getBorderSize();
        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let width = containerInsets.getLeft() + containerInsets.getRight();

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width += size.width;
                heights.push(size.height);
                baselines.push(component.getBaseline());
            }
        }

        let height = this.computeRowHeight(heights, baselines);

        width += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.left + containerBorderSize.right;
        height += containerInsets.getTop() + containerInsets.getBottom() + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the maximum size: the sum of child widths plus spacing, and the minimum of child maximum heights.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let containerBorderSize = container.getBorderSize();
        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let width = containerInsets.getLeft() + containerInsets.getRight();
        let height = Number.MAX_SAFE_INTEGER;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width += size.width;
                height = Math.min(height, size.height);
            }
        }

        width += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.left + containerBorderSize.right;
        height += containerInsets.getTop() + containerInsets.getBottom() + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Places children left-to-right using their preferred widths, with optional height stretching.
     *
     * @remarks When `stretching` is enabled, each child's height is clamped to its max size rather
     * than its preferred size. Children without a preferred size fall back to `defaultComponentWidth`.
     * Children with a `weight` layout constraint share the remaining width (after unweighted children
     * have taken their preferred widths) proportionally to their weight values.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let containerInsets = container.getInsets();
        let components = container.getComponents();
        let spacing = this.getComponentSpacing();

        let totalWeight = 0;
        let fixedWidth = spacing * (components.length - 1);

        for (let idx in components) {
            let component = components[idx];
            let constraints = this.getLayoutConstraints(component);
            let weight = constraints?.weight ?? 0;

            if (weight > 0) {
                totalWeight += weight;
            } else {
                let size = component.getPreferredSize();
                let minSize = component.getMinSize();
                fixedWidth += (size ? size.width : undefined)
                    || (minSize ? minSize.width : undefined)
                    || this.defaultComponentWidth;
            }
        }

        let remainingWidth = Math.max(0, containerSize.width - fixedWidth);

        const widths: number[] = [];
        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            let constraints = this.getLayoutConstraints(component);
            let weight = constraints?.weight ?? 0;

            let size = component.getPreferredSize();
            let minSize = component.getMinSize();
            let maxSize = component.getMaxSize();

            let width: number;

            if (weight > 0 && totalWeight > 0) {
                width = (weight / totalWeight) * remainingWidth;
            } else {
                width = (size ? size.width : undefined)
                    || (minSize ? minSize.width : undefined)
                    || this.defaultComponentWidth;
            }

            let height: number;

            if (!size || this.isStretching()) {
                height = maxSize ? Math.min(maxSize.height, containerSize.height) : containerSize.height;
            } else {
                height = Math.min(size.height, containerSize.height);
            }

            widths.push(width);
            heights.push(height);
            baselines.push(component.getBaseline());
        }

        // Stretching forces every child to fill the row vertically, which makes
        // baseline alignment meaningless — fall back to top-alignment.
        // rowAscent is driven only by text-bearing children; tall null-baseline
        // children (a List, TextArea, etc.) must NOT drag the baseline down or
        // every text label in the row would be pushed off the top.
        let rowAscent: number | null = null;
        let rowDescent = 0;

        if (!this.isStretching()) {
            const metrics = this.computeRowMetrics(heights, baselines);
            rowAscent = metrics.rowAscent;
            rowDescent = metrics.rowDescent;
        }

        let x = containerInsets.getLeft();

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            const width = widths[idx];
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
                width,
                height,
                FillType.BOTH
            );

            x += component.getWidth();
            x += spacing;
        }
    }
}

const HBoxCallable = callable(HBox);
type HBoxCallable = HBox;
export {
    HBox         as _HBox,
    HBoxCallable as HBox
};
