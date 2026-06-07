// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";
import { Component } from "~/core/Component.js";
import { BoxLayout, BoxLayoutOptions } from "~/layout/BoxLayout.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link VBox}.
 *
 * @remarks `mode` selects the sizing strategy along the vertical axis.
 * `"preferred"` (the default) honours each child's preferred height and
 * supports `weight` cells. `"equal"` divides the container height equally
 * and ignores `weight`. The `stretching` default depends on `mode`:
 * `false` for `"preferred"`, `true` for `"equal"`. An explicit
 * `stretching` value in the options bag always wins.
 *
 * @category Layouts
 */
export interface VBoxOptions extends BoxLayoutOptions {}

/**
 * A layout manager that places children in a single vertical column. The
 * `mode` option selects between preferred-height sequencing (with weight-cell
 * support) and equal-height division of the container.
 *
 * @category Layouts
 */
class VBox extends BoxLayout {

    private _defaultComponentHeight: number = 100;

    /**
     * Returns the preferred size. In `"preferred"` mode this is the widest
     * child width and the sum of child heights plus spacing. In `"equal"`
     * mode height is `count * (maxChildHeight + spacing) - spacing`.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        let components = container.getComponents();

        if (this._mode === "equal") {
            let innerWidth = 0;
            let innerHeight = 0;

            for (let idx in components) {
                let component = components[idx];
                let size = component.getPreferredSize();

                if (size) {
                    innerWidth  = Math.max(innerWidth,  size.width);
                    innerHeight = Math.max(innerHeight, size.height);
                }
            }

            const width  = innerWidth + perimiterSize.left + perimiterSize.right;
            const height = components.length * (innerHeight + this._spacing) - this._spacing
                         + perimiterSize.top + perimiterSize.bottom;

            return { width, height };
        }

        let width = Number.MAX_SAFE_INTEGER;
        let height = perimiterSize.top + perimiterSize.bottom;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                width = width == Number.MAX_SAFE_INTEGER ? Math.min(width, size.width) : Math.max(width, size.width);
                height += size.height;
            }
        }

        width += perimiterSize.left + perimiterSize.right;
        height += this._spacing * (components.length - 1);

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the minimum size. In `"preferred"` mode this is the widest
     * child minimum width and the sum of child minimum heights plus
     * spacing. In `"equal"` mode height is
     * `count * (maxChildMinHeight + spacing) - spacing`.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        let components = container.getComponents();

        if (this._mode === "equal") {
            let innerWidth = 0;
            let innerHeight = 0;

            for (let idx in components) {
                let component = components[idx];
                let size = component.getMinSize();

                if (size) {
                    innerWidth  = Math.max(innerWidth,  size.width);
                    innerHeight = Math.max(innerHeight, size.height);
                }
            }

            const width  = innerWidth + perimiterSize.left + perimiterSize.right;
            const height = components.length * (innerHeight + this._spacing) - this._spacing
                         + perimiterSize.top + perimiterSize.bottom;

            return { width, height };
        }

        let width = 0;
        let height = perimiterSize.top + perimiterSize.bottom;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width = Math.max(width, size.width);
                height += size.height;
            }
        }

        width += perimiterSize.left + perimiterSize.right;
        height += this._spacing * (components.length - 1);

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the maximum size. In `"preferred"` mode width is the narrowest
     * child maximum width and height is the sum of child maximum heights
     * plus spacing. In `"equal"` mode height is
     * `count * (minChildMaxHeight + spacing) - spacing`.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        let components = container.getComponents();

        if (this._mode === "equal") {
            let innerWidth = Number.MAX_SAFE_INTEGER;
            let innerHeight = Number.MAX_SAFE_INTEGER;

            for (let idx in components) {
                let component = components[idx];
                let size = component.getMaxSize();

                if (size) {
                    innerWidth  = Math.min(innerWidth,  size.width);
                    innerHeight = Math.min(innerHeight, size.height);
                }
            }

            const width  = innerWidth + perimiterSize.left + perimiterSize.right;
            const height = components.length * (innerHeight + this._spacing) - this._spacing
                         + perimiterSize.top + perimiterSize.bottom;

            return { width, height };
        }

        let width = Number.MAX_SAFE_INTEGER;
        let height = perimiterSize.top + perimiterSize.bottom;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMaxSize();

            if (size) {
                width = Math.min(width, size.width);
                height += size.height;
            }
        }

        width += perimiterSize.left + perimiterSize.right;
        height += this._spacing * (components.length - 1);

        return {
            width: width,
            height: height
        };
    }

    /**
     * Computes the children's combined minSize along this manager's geometry.
     * In `"preferred"` mode height is the sum of per-child `minSize.height`
     * plus spacing. In `"equal"` mode height is
     * `count * maxChildMinHeight + spacing*(n-1)` (VBox distributes height
     * equally so the per-cell floor is the max of every child's min height).
     * Width in both modes is the max per-child `minSize.width`. Used by
     * `doLayout` to inflate the working size when the host has opted into
     * `setOverflowing` on the corresponding axis.
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

        let width = 0;

        if (this._mode === "equal") {
            let maxHeight = 0;

            for (const component of components) {
                const min = component.getMinSize();
                if (min) {
                    width     = Math.max(width,     min.width);
                    maxHeight = Math.max(maxHeight, min.height);
                }
            }

            return {
                width,
                height: components.length * (maxHeight + this._spacing) - this._spacing,
            };
        }

        let height = this._spacing * (components.length - 1);

        for (const component of components) {
            const min = component.getMinSize();
            if (min) {
                width   = Math.max(width, min.width);
                height += min.height;
            }
        }

        return { width, height };
    }

    /**
     * Lays out the children top-to-bottom, dispatching to `layoutEqualMode` or
     * `layoutPreferredMode` per the sizing mode after inflating the working
     * size for any scroll-enabled axis.
     */
    doLayout(): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const innerSize = container.getInnerSize();
        if (!innerSize) {
            return;
        }

        const components      = container.getComponents();
        const containerInsets = container.getContentInsets();
        const spacing         = this.getComponentSpacing();

        // Universal scroll: when the host has opted into per-axis overflow, lay
        // out against the children's combined minSize so trailing children land
        // past the viewport and the host's CSS `overflow: auto` scrolls.
        // `innerSize` stays the real viewport for equal mode's overflow test.
        const containerSize = this.inflateForOverflow(innerSize);

        if (this._mode === "equal") {
            this.layoutEqualMode(components, innerSize, containerSize, containerInsets, spacing);
        } else {
            this.layoutPreferredMode(components, containerSize, containerInsets, spacing);
        }

        this.reserveContentFrame();
    }

    /**
     * Places children in equal-height cells stacked top-to-bottom. Every cell
     * takes the same height (see {@link VBox.computeEqualCellHeight}) and the
     * full container width.
     *
     * @param components - The children to place, in order.
     * @param innerSize - The host's real inner size (pre-inflation), used to
     *   measure the equal share against the true viewport.
     * @param containerSize - The working size, possibly inflated for overflow.
     * @param insets - The container's content insets.
     * @param spacing - Inter-child spacing in pixels.
     */
    private layoutEqualMode(components: Component[], innerSize: Size, containerSize: Size, insets: Insets, spacing: number): void {
        const cellHeight = this.computeEqualCellHeight(components, innerSize.height, spacing);
        const cellWidth  = containerSize.width;

        const x = insets.getLeft();
        let y = insets.getTop();

        for (const component of components) {
            this.placeComponent(component, x, y, cellWidth, cellHeight, FillType.BOTH);

            y += cellHeight + spacing;
        }
    }

    /**
     * Computes the shared cell height for equal mode: the equal share of the
     * inner height, floored at the tallest child's min height.
     *
     * @param components - The children sharing the column.
     * @param innerHeight - The host's real inner height (pre-inflation).
     * @param spacing - Inter-child spacing in pixels.
     * @returns The height every equal-mode cell receives.
     *
     * @remarks Three cases drive the floor: (1) the share clears the tallest
     * child's min height → the column fits, divide equally; (2) the share is
     * below the min floor, the host scrolls on this axis, and `overflowSizing`
     * is `"preferred"` → every cell takes the tallest child's preferred height
     * so cells regain preferred size instead of sticking at min while
     * scrolling; (3) otherwise → clamp to the min floor (a non-scrolling host's
     * `overflow: hidden` clips the surplus).
     */
    private computeEqualCellHeight(components: Component[], innerHeight: number, spacing: number): number {
        let maxChildMinHeight = 0;
        let maxChildPreferredHeight = 0;

        for (const component of components) {
            const min = component.getMinSize();
            if (min) {
                maxChildMinHeight = Math.max(maxChildMinHeight, min.height);
            }

            const pref = component.getPreferredSize();
            if (pref) {
                maxChildPreferredHeight = Math.max(maxChildPreferredHeight, pref.height);
            }
        }

        const equalShare = (innerHeight - spacing * (components.length - 1)) / components.length;

        if (equalShare >= maxChildMinHeight) {
            return equalShare;
        }

        if (this.isOverflowingY() && this._overflowSizing === "preferred") {
            return Math.max(maxChildMinHeight, maxChildPreferredHeight);
        }

        return maxChildMinHeight;
    }

    /**
     * Places children at their preferred heights stacked top-to-bottom. Weight
     * cells split the space left after the non-weighted children; when the
     * column overflows, the non-weighted children shrink proportionally toward
     * their min heights. Children keep their preferred width, or fill the
     * container width when stretching.
     *
     * @param components - The children to place, in order.
     * @param containerSize - The working size, possibly inflated for overflow.
     * @param insets - The container's content insets.
     * @param spacing - Inter-child spacing in pixels.
     */
    private layoutPreferredMode(components: Component[], containerSize: Size, insets: Insets, spacing: number): void {
        const { totalWeight, fixedPreferred, fixedMin } = this.measureFixedHeights(components, spacing);

        const { remaining: remainingHeight, shrinkRatio } = this.computeShrink(
            fixedPreferred,
            fixedMin,
            containerSize.height,
            this.isOverflowingY()
        );

        const x = insets.getLeft();
        let y = insets.getTop();

        for (const component of components) {
            const weight  = this.getLayoutConstraints(component)?.weight ?? 0;
            const size    = component.getPreferredSize();
            const minSize = component.getMinSize();
            const maxSize = component.getMaxSize();

            const height = this.resolveChildHeight(size, minSize, maxSize, weight, totalWeight, remainingHeight, shrinkRatio);

            let width: number;

            if (!size || this.isStretching()) {
                width = maxSize ? Math.min(maxSize.width, containerSize.width) : containerSize.width;
            } else {
                width = Math.min(size.width, containerSize.width);
            }

            // Cross-axis floor: the container cap above can drop the width below
            // the child's own minimum. Under the clip-at-preferred rule, when the
            // column overflows horizontally and overflowSizing is "preferred" (the
            // default), lift to the child's PREFERRED width (null-preferred falls
            // back to min); otherwise lift to the min floor (the "min" escape
            // hatch and the non-overflowing path). Re-apply max last so it always
            // caps.
            if (this.isOverflowingX() && this._overflowSizing === "preferred") {
                const floor = size ? size.width : (minSize ? minSize.width : 0);
                width = Math.max(width, floor);
            } else if (minSize) {
                width = Math.max(width, minSize.width);
            }

            if (maxSize) {
                width = Math.min(width, maxSize.width);
            }

            this.placeComponent(component, x, y, width, height, FillType.BOTH);

            y += component.getHeight();
            y += spacing;
        }
    }

    /**
     * Sums the non-weighted children's preferred and minimum heights (each
     * including inter-child spacing) and the total weight of the weight cells.
     *
     * @param components - The children sharing the column.
     * @param spacing - Inter-child spacing in pixels.
     * @returns `totalWeight` of the weight cells, plus the `fixedPreferred` and
     *   `fixedMin` height totals of the non-weighted children.
     */
    private measureFixedHeights(components: Component[], spacing: number): { totalWeight: number; fixedPreferred: number; fixedMin: number } {
        let totalWeight = 0;
        let fixedPreferred = spacing * (components.length - 1);
        let fixedMin       = spacing * (components.length - 1);

        for (const component of components) {
            const weight = this.getLayoutConstraints(component)?.weight ?? 0;

            if (weight > 0) {
                totalWeight += weight;
            } else {
                const size    = component.getPreferredSize();
                const minSize = component.getMinSize();

                fixedPreferred += this.preferredChildHeight(size, minSize);
                fixedMin       += minSize ? minSize.height : 0;
            }
        }

        return { totalWeight, fixedPreferred, fixedMin };
    }

    /**
     * Resolves a non-weighted child's preferred height, falling back through min
     * height to `_defaultComponentHeight`.
     *
     * @param size - The child's preferred size, or `null`.
     * @param minSize - The child's minimum size, or `null`.
     * @returns The height the child contributes before shrinking.
     *
     * @remarks Nullish-coalesce, not `||`: a component with an explicit
     * preferred height of 0 must contribute 0, not fall through to
     * `_defaultComponentHeight`. The `minSize.height > 0` guard prevents
     * `LayoutManager._defaultMinSize = {0,0}` from short-circuiting the chain
     * into a 0 height (which would land a layout-managed Table on a 0 height
     * even though no preferred size was set).
     */
    private preferredChildHeight(size: Size | null, minSize: Size | null): number {
        return (size ? size.height : undefined)
            ?? (minSize && minSize.height > 0 ? minSize.height : undefined)
            ?? this._defaultComponentHeight;
    }

    /**
     * Resolves a child's final height within the column, clamped to its
     * min/max. Weight cells take a share of `remainingHeight`; non-weighted
     * children take their preferred height reduced by the shrink ratio toward
     * their min height.
     *
     * @param size - The child's preferred size, or `null`.
     * @param minSize - The child's minimum size, or `null`.
     * @param maxSize - The child's maximum size, or `null`.
     * @param weight - The child's weight constraint (0 when non-weighted).
     * @param totalWeight - The summed weight of all weight cells.
     * @param remainingHeight - The space available to weight cells.
     * @param shrinkRatio - How far (0–1) non-weighted children shrink to min.
     * @returns The child's height.
     */
    private resolveChildHeight(size: Size | null, minSize: Size | null, maxSize: Size | null, weight: number, totalWeight: number, remainingHeight: number, shrinkRatio: number): number {
        let height: number;

        if (weight > 0 && totalWeight > 0) {
            height = (weight / totalWeight) * remainingHeight;
        } else {
            const pref = this.preferredChildHeight(size, minSize);
            const min  = minSize ? minSize.height : 0;

            height = pref - shrinkRatio * (pref - min);
        }

        if (minSize) {
            height = Math.max(height, minSize.height);
        }

        if (maxSize) {
            height = Math.min(height, maxSize.height);
        }

        return height;
    }
}

const VBoxCallable = callable(VBox);
type VBoxCallable = VBox;
export {
    VBox         as _VBox,
    VBoxCallable as VBox
};
