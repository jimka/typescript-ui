// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js"
import { Component } from "~/core/Component.js"
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { FillType } from "~/layout/FillType.js";
import { Placement } from "~/primitive/Placement.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for the {@link Border} layout manager.
 *
 * @remarks Re-exported as `BorderLayoutOptions` from the package barrel to
 * disambiguate from the line-style `Border`'s {@link BorderOptions}.
 *
 * @category Layouts
 */
export interface BorderOptions extends LayoutManagerOptions {
    gap?: number;
}

/**
 * A layout manager that divides a container into five named regions:
 * north, south, east, west, and center.
 * North and south regions span the full width; east and west regions flank the center.
 *
 * Exported from `@jimka/typescript-ui/layout`. Disambiguate from the line-style
 * [`Border`](/api/primitive/classes/Border) utility (in `@jimka/typescript-ui/primitive`)
 * by aliasing one of them on import — e.g. `import { Border as BorderLayout } from '@jimka/typescript-ui/layout';`.
 *
 * @category Layouts
 */
class Border extends LayoutManager {

    private _northComponent: Component | null = null;
    private _southComponent: Component | null = null;
    private _westComponent: Component | null = null;
    private _eastComponent: Component | null = null;
    private _centerComponent: Component | null = null;
    private _gap: number = 5;

    constructor(options?: BorderOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link BorderOptions} bag, dispatching the inter-region gap
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: BorderOptions): void {
        super.applyOptions(options);

        if (options.gap !== undefined) {
            this.setComponentGap(options.gap);
        }
    }

    /**
     * Registers a component in the north, south, east, west, or center slot
     * based on `constraints.placement`.
     *
     * @param component - The component to register.
     * @param constraints - Optional. Layout constraints specifying the target placement slot.
     *
     * @returns The resolved constraints object, or `undefined` if none were provided.
     *
     * @remarks When `constraints` or `constraints.placement` is absent the component
     * defaults to the center slot.
     */
    setLayoutConstraints(component: Component, constraints?: LayoutConstraints): LayoutConstraints | undefined {
        if (!constraints) {
            constraints = new LayoutConstraints();
            constraints.placement = Placement.CENTER;
        }

        if (!constraints.placement) {
            constraints.placement = Placement.CENTER;
        }

        switch (constraints.placement) {
            case Placement.NORTH:
                this._northComponent = component;
                break;
            case Placement.SOUTH:
                this._southComponent = component;
                break;
            case Placement.WEST:
                this._westComponent = component;
                break;
            case Placement.EAST:
                this._eastComponent = component;
                break;
            case Placement.CENTER:
                this._centerComponent = component;
                break;
        }

        return super.setLayoutConstraints(component, constraints);
    }

    /**
     * Returns the pixel gap between adjacent border regions.
     *
     * @returns The current gap in pixels.
     */
    getComponentGap() {
        return this._gap;
    }

    /**
     * Sets the pixel gap between adjacent border regions.
     *
     * @param gap - Gap size in pixels.
     */
    setComponentGap(gap: number) : this {
        this._gap = gap;

        return this;
    }

    /**
     * Computes the preferred size by summing the preferred sizes of all occupied border regions.
     *
     * @returns The preferred `{width, height}` or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let innerWidth = 0;
        let innerHeight = 0;

        let middleWidth = 0;
        let middleHeight = 0;

        if (this._northComponent) {
            let size = this._northComponent.getPreferredSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this._southComponent) {
            let size = this._southComponent.getPreferredSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this._westComponent) {
            let size = this._westComponent.getPreferredSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this._centerComponent) {
            let size = this._centerComponent.getPreferredSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this._eastComponent) {
            let size = this._eastComponent.getPreferredSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        innerWidth = Math.max(innerWidth, middleWidth);
        innerHeight += middleHeight;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the minimum size by summing the minimum sizes of all occupied border regions.
     *
     * @returns The minimum `{width, height}` or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let innerWidth = 0;
        let innerHeight = 0;

        let middleWidth = 0;
        let middleHeight = 0;

        if (this._northComponent) {
            let size = this._northComponent.getMinSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this._southComponent) {
            let size = this._southComponent.getMinSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this._westComponent) {
            let size = this._westComponent.getMinSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this._centerComponent) {
            let size = this._centerComponent.getMinSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this._eastComponent) {
            let size = this._eastComponent.getMinSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        innerWidth = Math.max(innerWidth, middleWidth);
        innerHeight += middleHeight;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the maximum size from the occupied border regions.
     *
     * @returns The maximum `{width, height}` or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let innerWidth = Number.MAX_SAFE_INTEGER;
        let innerHeight = Number.MAX_SAFE_INTEGER;

        let middleWidth = 0;
        let middleHeight = 0;

        if (this._northComponent) {
            let size = this._northComponent.getMaxSize();
            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this._southComponent) {
            let size = this._southComponent.getMaxSize();
            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this._westComponent) {
            let size = this._westComponent.getMaxSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.min(middleHeight, size.height);
            }
        }

        if (this._centerComponent) {
            let size = this._centerComponent.getMaxSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.min(middleHeight, size.height);
            }
        }

        if (this._eastComponent) {
            let size = this._eastComponent.getMaxSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.min(middleHeight, size.height);
            }
        }

        innerWidth = Math.min(innerWidth, middleWidth);
        innerHeight += middleHeight;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the children's combined minSize along this manager's
     * 5-region geometry: width = west.minWidth + center.minWidth +
     * east.minWidth + gaps; height = north.minHeight + center.minHeight +
     * south.minHeight + gaps. Used by `doLayout` to inflate the working
     * size when the host has opted into `setOverflowing`.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const westMin   = this._westComponent  ?.getMinSize();
        const centerMin = this._centerComponent?.getMinSize();
        const eastMin   = this._eastComponent  ?.getMinSize();
        const northMin  = this._northComponent ?.getMinSize();
        const southMin  = this._southComponent ?.getMinSize();

        // Horizontal regions contribute to width; vertical regions contribute
        // to height. Each inter-region gap is added only when both adjacent
        // regions exist so single-region layouts (only center, for instance)
        // don't gain phantom gap pixels.
        const hRegions = [westMin, centerMin, eastMin].filter(s => s != null);
        const vRegions = [northMin, centerMin, southMin].filter(s => s != null);

        let width  = 0;
        let height = 0;

        for (const r of hRegions) {
            width += r!.width;
        }
        width += Math.max(0, hRegions.length - 1) * this._gap;

        // For width we also need to ensure the height-region's own width is
        // honoured: the center column may need at least the wider of
        // north.minWidth / south.minWidth (which span the full row).
        if (northMin) {
            width = Math.max(width, northMin.width);
        }
        if (southMin) {
            width = Math.max(width, southMin.width);
        }

        for (const r of vRegions) {
            height += r!.height;
        }
        height += Math.max(0, vRegions.length - 1) * this._gap;

        return { width, height };
    }

    /**
     * Positions north, south, east, west, and center children within the container's inner bounds.
     *
     * @remarks The north component may opt out of parent insets via `constraints.ignoreParentInsets`,
     * which is useful for components such as toolbars that should span the full container width.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            throw new Error("Unable to determine component size.");
        }

        let containerInsets = container.getInsets();
        if (!containerInsets) {
            throw new Error("Unable to determine component insets.");
        }

        // Universal scroll: see HBox.doLayout for the rationale. Inflates the
        // working size to the children's combined minSize on the axes the
        // host has marked as overflowing.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        let width = containerSize.width;
        let height = containerSize.height;
        let centerX;
        let middleY;
        let centerWidth;
        let middleHeight;

        if (this._northComponent) {
            let constraints = this.getLayoutConstraints(this._northComponent);
            if (!constraints) {
                throw new Error("Unable to determine layout constraints for north component.");
            }

            let preferredSize = this._northComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for north component.");
            }

            middleY = preferredSize.height + (constraints.ignoreParentInsets ? containerInsets.getTop() : 0);

            this.placeComponent(
                this._northComponent,
                constraints.ignoreParentInsets ? 0 : containerInsets.getLeft(),
                constraints.ignoreParentInsets ? 0 : containerInsets.getTop(),
                width + (constraints.ignoreParentInsets ? containerInsets.getLeft() + containerInsets.getRight() : 0),
                middleY,
                FillType.BOTH
            );

            if (this._westComponent || this._centerComponent || this._eastComponent || this._southComponent) {
                middleY += this._gap;
            }
        } else {
            middleY = 0;
        }

        middleHeight = height - middleY;
        if (this._southComponent) {
            let preferredSize = this._southComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for south component.");
            }

            middleHeight -= this._gap;
            middleHeight -= preferredSize.height;

            this.placeComponent(
                this._southComponent,
                containerInsets.getLeft(),
                containerInsets.getTop() + height - preferredSize.height,
                width,
                preferredSize.height,
                FillType.BOTH
            );
        }

        // Reserve east's preferred width up front so west can be clamped
        // to avoid overlapping east when west.preferred + east.preferred
        // exceeds the container width (e.g. a Window header where the
        // title is wider than the available space between the icon and
        // the trailing buttons).
        let eastPreferredWidth = 0;
        if (this._eastComponent) {
            let eastPreferred = this._eastComponent.getPreferredSize();
            if (!eastPreferred) {
                throw new Error("Unable to determine preferred size for east component.");
            }
            eastPreferredWidth = eastPreferred.width;
        }

        if (this._westComponent) {
            let preferredSize = this._westComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for west component.");
            }

            let westWidth = Math.max(0, Math.min(preferredSize.width, width - eastPreferredWidth));
            centerX = westWidth;

            this.placeComponent(
                this._westComponent,
                containerInsets.getLeft(),
                containerInsets.getTop() + middleY,
                westWidth,
                middleHeight,
                FillType.BOTH
            );

            if (this._centerComponent) {
                centerX += this._gap;
            }
        } else {
            centerX = 0;
        }

        centerWidth = width - centerX;

        if (this._eastComponent) {
            centerWidth -= this._gap;
            centerWidth -= eastPreferredWidth;

            this.placeComponent(
                this._eastComponent,
                containerInsets.getLeft() + width - eastPreferredWidth,
                containerInsets.getTop() + middleY,
                eastPreferredWidth,
                middleHeight,
                FillType.BOTH
            );
        }

        if (this._centerComponent) {
            this.placeComponent(this._centerComponent,
                containerInsets.getLeft() + centerX,
                containerInsets.getTop() + middleY,
                centerWidth,
                middleHeight,
                FillType.BOTH
            );
        }
    }
}

const BorderCallable = callable(Border);
type BorderCallable = Border;
export {
    Border         as _Border,
    BorderCallable as Border
};
