// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { FillType } from "./FillType.js";

/**
 * A layout manager that places children in a single horizontal row,
 * using each child's preferred width and an optional height-stretching mode.
 */
export class HBox extends LayoutManager {

    private spacing: number;
    private stretching: boolean;
    private defaultComponentWidth: number = 100;

    constructor() {
        super();

        this.spacing = 5;
        this.stretching = false;
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
    setComponentSpacing(spacing: number) {
        this.spacing = spacing || 0;
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
    setStretching(stretching: boolean) {
        this.stretching = stretching;
    }

    /**
     * Returns the preferred size: the sum of child widths plus spacing, and the tallest child height.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize() {
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
            let size = component.getPreferredSize();

            if (size) {
                width += size.width;
                height = height == Number.MAX_SAFE_INTEGER ? Math.min(height, size.height) : Math.max(height, size.height);
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
     * Returns the minimum size: the sum of child minimum widths plus spacing, and the tallest child minimum height.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let containerBorderSize = container.getBorderSize();
        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let width = containerInsets.getLeft() + containerInsets.getRight();
        let height = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width += size.width;
                height = Math.max(height, size.height);
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
     * Returns the maximum size: the sum of child widths plus spacing, and the minimum of child maximum heights.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize() {
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

        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        for (let idx in components) {
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
                height = Math.min(maxSize.height, containerSize.height);
            } else {
                height = Math.min(size.height, containerSize.height);
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
