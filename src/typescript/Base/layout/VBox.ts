// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { FillType } from "./FillType.js";

/**
 * A layout manager that places children in a single vertical column,
 * using each child's preferred height and an optional width-stretching mode.
 */
export class VBox extends LayoutManager {

    private spacing: number;
    private stretching: boolean;
    private defaultComponentHeight: number = 100;

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
        this.spacing = spacing;
    }

    /**
     * Returns whether children stretch to fill the container width.
     *
     * @returns `true` if stretching is enabled.
     */
    isStretching() {
        return this.stretching || false;
    }

    /**
     * Sets whether children stretch to fill the container width.
     *
     * @param stretching - Pass `true` to enable width stretching.
     */
    setStretching(stretching: boolean) {
        this.stretching = !!stretching;
    }

    /**
     * Returns the preferred size: the widest child width and the sum of child heights plus spacing.
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
        let width = Number.MAX_SAFE_INTEGER;
        let height = containerInsets.getTop() + containerInsets.getBottom();

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                width = width == Number.MAX_SAFE_INTEGER ? Math.min(width, size.width) : Math.max(width, size.width);
                height += size.height;
            }
        }

        width += containerInsets.getLeft() + containerInsets.getRight() + containerBorderSize.left + containerBorderSize.right;
        height += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the minimum size: the widest child minimum width and the sum of child minimum heights plus spacing.
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
        let width = 0;
        let height = containerInsets.getTop() + containerInsets.getBottom();

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width = Math.max(width, size.width);
                height += size.height;
            }
        }

        width += containerInsets.getLeft() + containerInsets.getRight() + containerBorderSize.left + containerBorderSize.right;
        height += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the maximum size: the narrowest child maximum width and the sum of child maximum heights plus spacing.
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
        let width = Number.MAX_SAFE_INTEGER;
        let height = containerInsets.getTop() + containerInsets.getBottom();

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMaxSize();

            if (size) {
                width = Math.min(width, size.width);
                height += size.height;
            }
        }

        width += containerInsets.getLeft() + containerInsets.getRight() + containerBorderSize.left + containerBorderSize.right;
        height += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Places children top-to-bottom using their preferred heights, with optional width stretching.
     *
     * @remarks When `stretching` is enabled, each child's width is clamped to its max size rather
     * than its preferred size. Children without a preferred size fall back to `defaultComponentHeight`.
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

        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        for (let idx in components) {
            let component = components[idx];

            let size = component.getPreferredSize();
            let minSize = component.getMinSize();
            let maxSize = component.getMaxSize();

            let width;
            let height = (size ? size.height : undefined)
                || (minSize ? minSize.height : undefined)
                || this.defaultComponentHeight;

            if (!size || this.isStretching()) {
                width = Math.min(maxSize.width, containerSize.width);
            } else {
                width = Math.min(size.width, containerSize.width);
            }

            this.placeComponent(
                component,
                x,
                y,
                width,
                height,
                FillType.BOTH
            )

            y += component.getHeight();
            y += this.getComponentSpacing();
        }
    }
}
