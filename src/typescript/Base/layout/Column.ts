// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { FillType } from "./FillType.js";

/**
 * A layout manager that divides the container width equally among all children
 * and places them left-to-right with a configurable gap.
 */
export class Column extends LayoutManager {

    private gap: number = 5;

    constructor() {
        super()
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
     * Computes the preferred size as the maximum child preferred dimensions
     * arranged horizontally with gaps.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize() {
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

        innerWidth = components.length * (innerWidth + this.gap) - this.gap;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the minimum size as the maximum child minimum dimensions
     * arranged horizontally with gaps.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize() {
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
    getMaxSize() {
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
    }
}
