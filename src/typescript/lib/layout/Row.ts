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

    private _gap: number = 5;

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
            this.setGap(options.gap);
        }
    }

    /**
     * Returns the pixel gap between rows.
     *
     * @returns The current gap in pixels.
     */
    getGap() {
        return this._gap;
    }

    /**
     * Sets the pixel gap between rows and triggers a re-layout.
     *
     * @param gap - Gap size in pixels.
     */
    setGap(gap : number) : this {
        this._gap = gap;
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

        innerHeight = components.length * (innerHeight + this._gap) - this._gap;

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

        innerHeight = components.length * (innerHeight + this._gap) - this._gap;

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

        innerHeight = components.length * (innerHeight + this._gap) - this._gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * height is `count * maxChildMinHeight + gaps` (Row distributes height
     * equally so the per-cell floor is the max of every child's min height);
     * width is `max(children.minWidth)`. Used by `doLayout` to inflate the
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
            width:  maxWidth,
            height: components.length * (maxHeight + this._gap) - this._gap,
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

        // Universal scroll: see HBox.doLayout for the rationale. Inflates the
        // working size to the children's combined minSize on the axes the
        // host has marked as overflowing.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        let columnWidth = containerSize.width;
        let columnHeight = (containerSize.height - (this._gap * components.length) + this._gap) / components.length;

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

            y += columnHeight + this._gap;
        }
    }
}

const RowCallable = callable(Row);
type RowCallable = Row;
export {
    Row         as _Row,
    RowCallable as Row
};
