// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FillType } from "~/layout/FillType.js";
import { Size, UNBOUNDED, isUnbounded } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";
import { Component } from "~/core/Component.js";
import { BoxLayout, BoxLayoutOptions } from "~/layout/BoxLayout.js";
import type { ResolvedPlacement } from "~/layout/LayoutManager.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link VBox}.
 *
 * @remarks `mode` selects the sizing strategy along the vertical axis.
 * `"preferred"` (the default) honours each child's preferred height and
 * supports `weight` cells. `"equal"` divides the container height equally
 * and ignores `weight`. `mode` is independent of `stretching` (the cross-axis
 * fill): `stretching` defaults to `false` in both modes, so `"equal"` divides
 * the height but leaves children at their preferred width unless
 * `stretching: true` is passed.
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
     * Returns the column's baseline — the first laid-out child's baseline,
     * measured from the container's content-top — so a baseline-aware parent
     * aligns this VBox container by its first row's text baseline rather than
     * auto-centring the whole container.
     *
     * @returns The first child's baseline offset in pixels, or `null` when there
     * is no container, no laid-out children, or the first child reports no
     * baseline of its own.
     *
     * @remarks Forwards the **first** child's baseline verbatim — unlike
     * {@link HBox}, which takes the maximum baseline across the row's children.
     * A column has a single well-defined first row, so forwarding it (including
     * a `null` when that first row is graphical) is the most predictable
     * contract. The first child stacks at the container's content-top in every
     * mode, so its own baseline is already content-relative — `Component`'s
     * `getBaseline` then adds the container's chrome. Unlike `HBox`, this is not
     * disabled while stretching: VBox `stretching` fills the cross (width) axis
     * and leaves each child's height and intrinsic baseline untouched.
     */
    getContentBaseline(): number | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const components = container.getLaidOutComponents();
        if (components.length === 0) {
            return null;
        }

        return components[0].getBaseline();
    }

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

        let perimeterSize = container.getPerimeterSize();
        let components = container.getLaidOutComponents();

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

            const width  = innerWidth + perimeterSize.left + perimeterSize.right;
            const height = components.length * (innerHeight + this._spacing) - this._spacing
                         + perimeterSize.top + perimeterSize.bottom;

            return { width, height };
        }

        let width = UNBOUNDED;
        let height = perimeterSize.top + perimeterSize.bottom;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                width = isUnbounded(width) ? Math.min(width, size.width) : Math.max(width, size.width);
                height += size.height;
            }
        }

        width += perimeterSize.left + perimeterSize.right;
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

        let perimeterSize = container.getPerimeterSize();
        let components = container.getLaidOutComponents();

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

            const width  = innerWidth + perimeterSize.left + perimeterSize.right;
            const height = components.length * (innerHeight + this._spacing) - this._spacing
                         + perimeterSize.top + perimeterSize.bottom;

            return { width, height };
        }

        let width = 0;
        let height = perimeterSize.top + perimeterSize.bottom;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width = Math.max(width, size.width);
                height += size.height;
            }
        }

        width += perimeterSize.left + perimeterSize.right;
        height += this._spacing * (components.length - 1);

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the maximum size the column can usefully occupy. Along the main
     * axis (height) it sums the children's *maximum* heights plus spacing; in
     * `"equal"` mode it is `count * maxChildMaxHeight` plus spacing, since every
     * cell shares the tallest child's allowance. The cross axis (width) takes
     * the *largest* child maximum — the widest a child permits the column to
     * grow to. A child whose maximum is `null` or at the unbounded sentinel
     * makes that axis unbounded.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        return this.aggregateMaxSize(false);
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

        const components = container.getLaidOutComponents();
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

        const components      = container.getLaidOutComponents();
        const containerInsets = container.getContentInsets();
        const spacing         = this.getComponentSpacing();

        // Universal scroll: when the host has opted into per-axis overflow, lay
        // out against the children's combined minSize so trailing children land
        // past the viewport and the host's CSS `overflow: auto` scrolls.
        // `innerSize` stays the real viewport for equal mode's overflow test.
        const containerSize = this.inflateForOverflow(innerSize);

        let placements: ResolvedPlacement[];

        if (this._mode === "equal") {
            placements = this.layoutEqualMode(components, innerSize, containerSize, containerInsets, spacing);
        } else {
            placements = this.layoutPreferredMode(components, containerSize, containerInsets, spacing);
        }

        this.commitPlacements(placements);

        this.reserveContentFrame();
    }

    /**
     * Places children in equal-height cells stacked top-to-bottom. Every cell
     * takes the same height (see {@link VBox.computeEqualCellHeight}); when
     * stretching, cells fill the container width, otherwise children keep their
     * preferred width and are left-aligned within the column.
     *
     * @param components - The children to place, in order.
     * @param innerSize - The host's real inner size (pre-inflation), used to
     *   measure the equal share against the true viewport.
     * @param containerSize - The working size, possibly inflated for overflow.
     * @param insets - The container's content insets.
     * @param spacing - Inter-child spacing in pixels.
     * @returns The resolved placements, ready for {@link LayoutManager.commitPlacements}.
     */
    private layoutEqualMode(components: Component[], innerSize: Size, containerSize: Size, insets: Insets, spacing: number): ResolvedPlacement[] {
        const cellHeight = this.computeEqualCellHeight(components, innerSize.height, spacing);

        const x = insets.getLeft();
        let y = insets.getTop();

        if (this.isStretching()) {
            const cellWidth = containerSize.width;
            const placements: ResolvedPlacement[] = [];

            for (const component of components) {
                placements.push({ component, ...this.resolveBounds(component, x, y, cellWidth, cellHeight, FillType.BOTH) });

                y += cellHeight + spacing;
            }

            return placements;
        }

        // Match the equal-stretch band exactly: the stretch branch fills
        // containerSize.width from insets.left with no right-inset subtraction,
        // so an EAST/fill align-self child reaches the same trailing edge.
        const crossLead   = insets.getLeft();
        const crossExtent = containerSize.width;
        const placements: ResolvedPlacement[] = [];

        for (const component of components) {
            const size  = component.getPreferredSize();
            const width = size ? size.width : 0;

            const cross = this.crossPlacement(component, crossLead, crossExtent, width, false);

            if (cross) {
                placements.push({ component, ...this.resolveBounds(component, cross.offset, y, cross.extent, cellHeight, FillType.BOTH) });
            } else if (this._itemAlign === "start" || this._itemAlign === "center" || this._itemAlign === "end") {
                const cx = crossLead + this.crossItemOffset(width, crossExtent);

                placements.push({ component, ...this.resolveBounds(component, cx, y, width, cellHeight, FillType.BOTH) });
            } else {
                placements.push({ component, ...this.resolveBounds(component, x, y, width, cellHeight, FillType.BOTH) });
            }

            y += cellHeight + spacing;
        }

        return placements;
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
     * @returns The resolved placements, ready for {@link LayoutManager.commitPlacements}.
     */
    private layoutPreferredMode(components: Component[], containerSize: Size, insets: Insets, spacing: number): ResolvedPlacement[] {
        const { totalWeight, fixedPreferred, fixedMin } = this.measureFixedHeights(components, spacing);

        const { remaining: remainingHeight, shrinkRatio } = this.computeShrink(
            fixedPreferred,
            fixedMin,
            containerSize.height,
            this.isOverflowingY()
        );

        // Pre-pass: resolve each child's height into an array so the trailing
        // slack can be measured before placement (mirrors HBox's widths[]).
        const heights: number[] = [];

        for (const component of components) {
            const weight  = this.getLayoutConstraints(component)?.weight ?? 0;
            const size    = component.getPreferredSize();
            const minSize = component.getMinSize();
            const maxSize = component.getMaxSize();

            heights.push(this.resolveChildHeight(size, minSize, maxSize, weight, totalWeight, remainingHeight, shrinkRatio));
        }

        // Sum the placed main extents to find the trailing slack, then ask the
        // shared helper how to distribute it. Weight cells already consume all
        // slack, so justify is a no-op when any are present.
        let lead = 0;
        let gap  = 0;

        if (totalWeight === 0) {
            let contentHeight = spacing * (components.length - 1);

            for (const h of heights) {
                contentHeight += h;
            }

            ({ lead, gap } = this.justifyOffsets(contentHeight, containerSize.height, components.length));
        }

        // Cross band for per-child align-self: the horizontal band. `containerSize`
        // is already the container's inner size (insets excluded, per
        // `getInnerSize()`), so it is used as-is — subtracting the insets again
        // here would trim the band twice.
        const crossLead   = insets.getLeft();
        const crossExtent = containerSize.width;

        const x = insets.getLeft();
        let y = insets.getTop() + lead;
        const placements: ResolvedPlacement[] = [];

        for (let idx = 0; idx < components.length; idx += 1) {
            const component = components[idx];
            const size    = component.getPreferredSize();
            const maxSize = component.getMaxSize();

            // Cross-axis (width): give the child the column's available width —
            // the full inner width when stretching or sizeless, otherwise its
            // preferred width capped to the column. Cap to the child's maximum,
            // but do NOT floor to its minimum: enforcing the minimum here would
            // dogmatically inflate a child back up to its content size even when
            // the column is narrower, defeating a scrolling/clipping child. The
            // child's own setWidth → clampWidth applies its minimum (its content
            // minimum for a general component, or nothing for a Panel, which fits
            // its allocation and scrolls). When the host opts into horizontal
            // scroll, `containerSize` is already inflated to the content extent
            // upstream, so `min(pref, containerSize)` still yields the full width
            // without a floor here.
            let defaultWidth: number;

            if (!size || this.isStretching()) {
                defaultWidth = containerSize.width;
            } else {
                defaultWidth = Math.min(size.width, containerSize.width);
            }

            if (maxSize) {
                defaultWidth = Math.min(defaultWidth, maxSize.width);
            }

            // Align-self sizes from the child's *preferred* width (capped to the
            // band + max), independent of global stretching, so an anchored child
            // shrinks-and-anchors even when the column is stretching.
            let naturalWidth = size ? Math.min(size.width, crossExtent) : crossExtent;

            if (maxSize) {
                naturalWidth = Math.min(naturalWidth, maxSize.width);
            }

            const cross = this.crossPlacement(component, crossLead, crossExtent, naturalWidth, false);

            if (cross) {
                placements.push({ component, ...this.resolveBounds(component, cross.offset, y, cross.extent, heights[idx], FillType.BOTH) });
            } else if (this._itemAlign === "start" || this._itemAlign === "center" || this._itemAlign === "end") {
                const cx = crossLead + this.crossItemOffset(naturalWidth, crossExtent);

                placements.push({ component, ...this.resolveBounds(component, cx, y, naturalWidth, heights[idx], FillType.BOTH) });
            } else {
                placements.push({ component, ...this.resolveBounds(component, x, y, defaultWidth, heights[idx], FillType.BOTH) });
            }

            // Advance by the resolved height, not getHeight(): the gap is
            // measured against the same extent contentHeight summed, so a
            // placeComponent clamp must not skew the trailing edge.
            y += heights[idx];
            y += spacing + gap;
        }

        return placements;
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
     *
     * The result is floored at the child's own min height: a child placed at
     * `max(preferred, min)` (see {@link VBox.resolveChildHeight}) must reserve
     * that same height in the fixed total, or a child reporting `preferred < min`
     * (a `min ≤ preferred` invariant violation) would be under-reserved and push
     * the weighted cells out, overflowing the column.
     */
    private preferredChildHeight(size: Size | null, minSize: Size | null): number {
        const preferred = (size ? size.height : undefined)
            ?? (minSize && minSize.height > 0 ? minSize.height : undefined)
            ?? this._defaultComponentHeight;

        return minSize ? Math.max(preferred, minSize.height) : preferred;
    }

    /**
     * Resolves a child's final height within the column, clamped to its
     * min/max — the minimum wins when the two conflict. Weight cells take a
     * share of `remainingHeight`; non-weighted children take their preferred
     * height reduced by the shrink ratio toward their min height.
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

        if (maxSize) {
            height = Math.min(height, maxSize.height);
        }

        if (minSize) {
            height = Math.max(height, minSize.height);
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
