// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/Size.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time options for {@link VBox}.
 *
 * @category Layouts
 */
export interface VBoxOptions extends LayoutManagerOptions {
    spacing?:    number;
    stretching?: boolean;
}

/**
 * A layout manager that places children in a single vertical column,
 * using each child's preferred height and an optional width-stretching mode.
 *
 * @category Layouts
 */
class VBox extends LayoutManager {

    private spacing: number = 5;
    private stretching: boolean = false;
    private defaultComponentHeight: number = 100;

    constructor(spacing: number | VBoxOptions = 5, options?: VBoxOptions) {
        super();

        if (typeof spacing === 'number') {
            this.spacing = spacing;

            if (options) {
                this.applyOptions(options);
            }
        } else {
            this.applyOptions(spacing);
        }
    }

    /**
     * Applies a {@link VBoxOptions} bag, dispatching spacing and stretching
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: VBoxOptions): void {
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
        this.spacing = spacing;

        return this;
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
    setStretching(stretching: boolean) : this {
        this.stretching = !!stretching;

        return this;
    }

    /**
     * Returns the preferred size: the widest child width and the sum of child heights plus spacing.
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
    getMinSize(): Size | null {
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
    getMaxSize(): Size | null {
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
     * Children with a `weight` layout constraint share the remaining height (after unweighted children
     * have taken their preferred heights) proportionally to their weight values.
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
        let fixedHeight = spacing * (components.length - 1);

        for (let idx in components) {
            let component = components[idx];
            let constraints = this.getLayoutConstraints(component);
            let weight = constraints?.weight ?? 0;

            if (weight > 0) {
                totalWeight += weight;
            } else {
                let size = component.getPreferredSize();
                let minSize = component.getMinSize();
                fixedHeight += (size ? size.height : undefined)
                    || (minSize ? minSize.height : undefined)
                    || this.defaultComponentHeight;
            }
        }

        let remainingHeight = Math.max(0, containerSize.height - fixedHeight);

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
            let height: number;

            if (weight > 0 && totalWeight > 0) {
                height = (weight / totalWeight) * remainingHeight;
            } else {
                height = (size ? size.height : undefined)
                    || (minSize ? minSize.height : undefined)
                    || this.defaultComponentHeight;
            }

            if (!size || this.isStretching()) {
                width = maxSize ? Math.min(maxSize.width, containerSize.width) : containerSize.width;
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
            );

            y += component.getHeight();
            y += spacing;
        }
    }
}

const VBoxCallable = callable(VBox);
type VBoxCallable = VBox;
export {
    VBox         as _VBox,
    VBoxCallable as VBox
};
