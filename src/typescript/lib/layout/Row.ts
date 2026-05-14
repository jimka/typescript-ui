// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Row}.
 *
 * @category Layouts
 */
export interface RowOptions extends LayoutManagerOptions {
    gap?: number;
}

/**
 * A layout manager that divides the container height equally among all children
 * and places them top-to-bottom with a configurable gap.
 *
 * @category Layouts
 */
class Row extends LayoutManager {

    private gap: number = 5;

    constructor(options?: RowOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link RowOptions} bag, dispatching the inter-row gap after
     * the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: RowOptions): void {
        super.applyOptions(options);

        if (options.gap !== undefined) {
            this.gap = options.gap;
        }
    }

    /**
     * Returns the pixel gap between rows.
     *
     * @returns The current gap in pixels.
     */
    getGap() {
        return this.gap;
    }

    /**
     * Sets the pixel gap between rows and triggers a re-layout.
     *
     * @param gap - Gap size in pixels.
     */
    setGap(gap : number) : this {
        this.gap = gap;
        this.doLayout();

        return this;
    }

    /**
     * Computes the preferred size as the maximum child preferred dimensions
     * stacked vertically with gaps.
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

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
            }
        }

        innerHeight = components.length * (innerHeight + this.gap) - this.gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the minimum size as the maximum child minimum dimensions
     * stacked vertically with gaps.
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

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
            }
        }

        innerHeight = components.length * (innerHeight + this.gap) - this.gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the maximum size as the minimum child maximum dimensions
     * stacked vertically with gaps.
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

        innerHeight = components.length * (innerHeight + this.gap) - this.gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Divides the container height equally among children and places them
     * top-to-bottom with gaps.
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

        let components = container.getComponents();
        let containerInsets = container.getInsets();

        let columnWidth = containerSize.width;
        let columnHeight = (containerSize.height - (this.gap * components.length) + this.gap) / components.length;

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

            y += columnHeight + this.gap;
        }
    }
}

const RowCallable = callable(Row);
type RowCallable = Row;
export {
    Row         as _Row,
    RowCallable as Row
};
