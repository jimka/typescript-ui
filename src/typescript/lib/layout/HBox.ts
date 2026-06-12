// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BoxLayout, BoxLayoutOptions } from "~/layout/BoxLayout.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";
import { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link HBox}.
 *
 * @remarks `mode` selects the sizing strategy along the horizontal axis.
 * `"preferred"` (the default) honours each child's preferred width and
 * supports `weight` cells. `"equal"` divides the container width equally
 * and ignores `weight`. The `stretching` default depends on `mode`:
 * `false` for `"preferred"`, `true` for `"equal"`. An explicit
 * `stretching` value in the options bag always wins.
 *
 * @category Layouts
 */
export interface HBoxOptions extends BoxLayoutOptions {}

/**
 * A layout manager that places children in a single horizontal row. The
 * `mode` option selects between preferred-width sequencing (with weight-cell
 * support) and equal-width division of the container.
 *
 * @category Layouts
 */
class HBox extends BoxLayout {

    private _defaultComponentWidth: number = 100;

    /**
     * Returns the row's baseline (the maximum child text baseline) measured from
     * the container's content-top, so a baseline-aware parent aligns this HBox
     * container by the same baseline its own children align to — rather than
     * auto-centring the whole container.
     *
     * @returns The inner baseline offset in pixels, or `null` while stretching
     * (baseline alignment is disabled) or when no child reports a baseline.
     */
    getContentBaseline(): number | null {
        if (this.isStretching()) {
            return null;
        }

        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (const component of container.getLaidOutComponents()) {
            const size = component.getPreferredSize();
            heights.push(size ? size.height : 0);
            baselines.push(component.getBaseline());
        }

        return this.computeRowMetrics(heights, baselines).rowAscent;
    }

    /**
     * Returns the preferred size. In `"preferred"` mode this is the sum
     * of child widths plus spacing. In `"equal"` mode it is
     * `count * (maxChildWidth + spacing) - spacing`. Row height in both
     * modes is the baseline-aware row height of the children.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        let components = container.getLaidOutComponents();
        let width = perimiterSize.left + perimiterSize.right;

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        if (this._mode === "equal") {
            let maxChildWidth = 0;

            for (let idx in components) {
                let component = components[idx];
                let size = component.getPreferredSize();

                if (size) {
                    maxChildWidth = Math.max(maxChildWidth, size.width);
                    heights.push(size.height);
                    baselines.push(component.getBaseline());
                }
            }

            width += components.length * (maxChildWidth + this._spacing) - this._spacing;
        } else {
            for (let idx in components) {
                let component = components[idx];
                let size = component.getPreferredSize();

                if (size) {
                    width += size.width;
                    heights.push(size.height);
                    baselines.push(component.getBaseline());
                }
            }

            width += this._spacing * (components.length - 1);
        }

        let height = this.computeRowHeight(heights, baselines);

        height += perimiterSize.top + perimiterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the minimum size. In `"preferred"` mode this is the sum of
     * child min widths plus spacing. In `"equal"` mode it is
     * `count * (maxChildMinWidth + spacing) - spacing`. Row height in
     * both modes is the baseline-aware row height of the children's
     * minimums.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        let components = container.getLaidOutComponents();
        let width = perimiterSize.left + perimiterSize.right;

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        if (this._mode === "equal") {
            let maxChildMinWidth = 0;

            for (let idx in components) {
                let component = components[idx];
                let size = component.getMinSize();

                if (size) {
                    maxChildMinWidth = Math.max(maxChildMinWidth, size.width);
                    heights.push(size.height);
                    baselines.push(component.getBaseline());
                }
            }

            width += components.length * (maxChildMinWidth + this._spacing) - this._spacing;
        } else {
            for (let idx in components) {
                let component = components[idx];
                let size = component.getMinSize();

                if (size) {
                    width += size.width;
                    heights.push(size.height);
                    baselines.push(component.getBaseline());
                }
            }

            width += this._spacing * (components.length - 1);
        }

        let height = this.computeRowHeight(heights, baselines);

        height += perimiterSize.top + perimiterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the maximum size the row can usefully occupy. Along the main axis
     * (width) it sums the children's *maximum* widths plus spacing; in `"equal"`
     * mode it is `count * maxChildMaxWidth` plus spacing, since every cell shares
     * the widest child's allowance. The cross axis (height) takes the *largest*
     * child maximum — the tallest a child permits the row to grow to. A child
     * whose maximum is `null` or at the unbounded sentinel makes that axis
     * unbounded (`Number.MAX_SAFE_INTEGER`).
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        let components = container.getLaidOutComponents();
        let width = perimiterSize.left + perimiterSize.right;
        let height = 0;
        let widthUnbounded = false;
        let heightUnbounded = false;

        if (this._mode === "equal") {
            let maxChildMaxWidth = 0;

            for (const component of components) {
                const size = component.getMaxSize();

                if (!size) {
                    widthUnbounded = true;
                    heightUnbounded = true;
                    continue;
                }

                if (size.width >= Number.MAX_SAFE_INTEGER) {
                    widthUnbounded = true;
                } else {
                    maxChildMaxWidth = Math.max(maxChildMaxWidth, size.width);
                }

                if (size.height >= Number.MAX_SAFE_INTEGER) {
                    heightUnbounded = true;
                } else {
                    height = Math.max(height, size.height);
                }
            }

            width += components.length * maxChildMaxWidth + this._spacing * Math.max(0, components.length - 1);
        } else {
            for (const component of components) {
                const size = component.getMaxSize();

                if (!size) {
                    widthUnbounded = true;
                    heightUnbounded = true;
                    continue;
                }

                if (size.width >= Number.MAX_SAFE_INTEGER) {
                    widthUnbounded = true;
                } else {
                    width += size.width;
                }

                if (size.height >= Number.MAX_SAFE_INTEGER) {
                    heightUnbounded = true;
                } else {
                    height = Math.max(height, size.height);
                }
            }

            width += this._spacing * Math.max(0, components.length - 1);
        }

        height += perimiterSize.top + perimiterSize.bottom;

        return {
            width:  widthUnbounded  ? Number.MAX_SAFE_INTEGER : width,
            height: heightUnbounded ? Number.MAX_SAFE_INTEGER : height
        };
    }

    /**
     * Computes the children's combined minSize along this manager's geometry.
     * In `"preferred"` mode width is the sum of per-child `minSize.width`
     * plus spacing. In `"equal"` mode width is
     * `count * maxChildMinWidth + spacing*(n-1)` (HBox distributes width
     * equally so the per-cell floor is the max of every child's min width).
     * Height in both modes is the max per-child `minSize.height`. Used by
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

        let height = 0;

        if (this._mode === "equal") {
            let maxWidth = 0;

            for (const component of components) {
                const min = component.getMinSize();
                if (min) {
                    maxWidth = Math.max(maxWidth, min.width);
                    height   = Math.max(height,   min.height);
                }
            }

            return {
                width:  components.length * (maxWidth + this._spacing) - this._spacing,
                height,
            };
        }

        let width = this._spacing * (components.length - 1);

        for (const component of components) {
            const min = component.getMinSize();
            if (min) {
                width  += min.width;
                height  = Math.max(height, min.height);
            }
        }

        return { width, height };
    }

    /**
     * Lays out the children left-to-right, dispatching to `layoutEqualMode` or
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

        if (this._mode === "equal") {
            this.layoutEqualMode(components, innerSize, containerSize, containerInsets, spacing);
        } else {
            this.layoutPreferredMode(components, containerSize, containerInsets, spacing);
        }

        this.reserveContentFrame();
    }

    /**
     * Places children in equal-width cells. Every cell takes the same width
     * (see {@link HBox.computeEqualCellWidth}); when stretching, cells fill the
     * container height, otherwise children keep their preferred height and are
     * baseline-aligned within the row.
     *
     * @param components - The children to place, in order.
     * @param innerSize - The host's real inner size (pre-inflation), used to
     *   measure the equal share against the true viewport.
     * @param containerSize - The working size, possibly inflated for overflow.
     * @param insets - The container's content insets.
     * @param spacing - Inter-child spacing in pixels.
     */
    private layoutEqualMode(components: Component[], innerSize: Size, containerSize: Size, insets: Insets, spacing: number): void {
        const cellWidth = this.computeEqualCellWidth(components, innerSize.width, spacing);

        if (this.isStretching()) {
            const y = insets.getTop();
            let x = insets.getLeft();

            for (const component of components) {
                this.placeComponent(component, x, y, cellWidth, containerSize.height, FillType.BOTH);

                x += cellWidth + spacing;
            }

            return;
        }

        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (const component of components) {
            const size = component.getPreferredSize();

            heights.push(size ? size.height : 0);
            baselines.push(component.getBaseline());
        }

        const { rowAscent, rowDescent } = this.computeRowMetrics(heights, baselines);

        let x = insets.getLeft();

        for (let idx = 0; idx < components.length; idx += 1) {
            const y = this.rowChildY(insets.getTop(), heights[idx], baselines[idx], rowAscent, rowDescent);

            this.placeComponent(components[idx], x, y, cellWidth, heights[idx], FillType.BOTH);

            x += cellWidth + spacing;
        }
    }

    /**
     * Computes the shared cell width for equal mode: the equal share of the
     * inner width, floored at the widest child's min width.
     *
     * @param components - The children sharing the row.
     * @param innerWidth - The host's real inner width (pre-inflation).
     * @param spacing - Inter-child spacing in pixels.
     * @returns The width every equal-mode cell receives.
     *
     * @remarks Three cases drive the floor: (1) the share clears the widest
     * child's min width → the row fits, divide equally; (2) the share is below
     * the min floor, the host scrolls on this axis, and `overflowSizing` is
     * `"preferred"` → every cell takes the widest child's preferred width so
     * cells regain preferred size instead of sticking at min while scrolling;
     * (3) otherwise → clamp to the min floor (a non-scrolling host's
     * `overflow: hidden` clips the surplus).
     */
    private computeEqualCellWidth(components: Component[], innerWidth: number, spacing: number): number {
        let maxChildMinWidth = 0;
        let maxChildPreferredWidth = 0;

        for (const component of components) {
            const min = component.getMinSize();
            if (min) {
                maxChildMinWidth = Math.max(maxChildMinWidth, min.width);
            }

            const pref = component.getPreferredSize();
            if (pref) {
                maxChildPreferredWidth = Math.max(maxChildPreferredWidth, pref.width);
            }
        }

        const equalShare = (innerWidth - spacing * (components.length - 1)) / components.length;

        if (equalShare >= maxChildMinWidth) {
            return equalShare;
        }

        if (this.isOverflowingX() && this._overflowSizing === "preferred") {
            return Math.max(maxChildMinWidth, maxChildPreferredWidth);
        }

        return maxChildMinWidth;
    }

    /**
     * Places children at their preferred widths. Weight cells split the space
     * left after the non-weighted children; when the row overflows, the
     * non-weighted children shrink proportionally toward their min widths.
     * Children keep their preferred height (or fill the row height when
     * stretching) and are baseline-aligned unless stretching.
     *
     * @param components - The children to place, in order.
     * @param containerSize - The working size, possibly inflated for overflow.
     * @param insets - The container's content insets.
     * @param spacing - Inter-child spacing in pixels.
     */
    private layoutPreferredMode(components: Component[], containerSize: Size, insets: Insets, spacing: number): void {
        const { totalWeight, fixedPreferred, fixedMin } = this.measureFixedWidths(components, spacing);

        const { remaining: remainingWidth, shrinkRatio } = this.computeShrink(
            fixedPreferred,
            fixedMin,
            containerSize.width,
            this.isOverflowingX()
        );

        const widths: number[] = [];
        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (const component of components) {
            const weight  = this.getLayoutConstraints(component)?.weight ?? 0;
            const size    = component.getPreferredSize();
            const minSize = component.getMinSize();
            const maxSize = component.getMaxSize();

            widths.push(this.resolveChildWidth(size, minSize, maxSize, weight, totalWeight, remainingWidth, shrinkRatio));

            // Cross-axis (height): give the child the row's available height —
            // the full inner height when stretching or sizeless, otherwise its
            // preferred height capped to the row. Cap to the child's maximum, but
            // do NOT floor to its minimum: enforcing the minimum here would
            // dogmatically inflate a child back up to its content size even when
            // the row is shorter, defeating a scrolling/clipping child. The
            // child's own setHeight → clampHeight applies its minimum (its
            // content minimum for a general component, or nothing for a Panel,
            // which fits its allocation and scrolls). When the host opts into
            // vertical scroll, `containerSize` is already inflated to the content
            // extent upstream, so `min(pref, containerSize)` still yields the full
            // height without a floor here.
            let height: number;

            if (!size || this.isStretching()) {
                height = containerSize.height;
            } else {
                height = Math.min(size.height, containerSize.height);
            }

            if (maxSize) {
                height = Math.min(height, maxSize.height);
            }

            heights.push(height);

            baselines.push(component.getBaseline());
        }

        // Stretching forces every child to fill the row vertically, which makes
        // baseline alignment meaningless — fall back to top-alignment. rowAscent
        // is driven only by text-bearing children; tall null-baseline children
        // (a List, TextArea, etc.) must NOT drag the baseline down or every text
        // label in the row would be pushed off the top.
        const { rowAscent, rowDescent } = this.isStretching()
            ? { rowAscent: null, rowDescent: 0 }
            : this.computeRowMetrics(heights, baselines);

        let x = insets.getLeft();

        for (let idx = 0; idx < components.length; idx += 1) {
            const component = components[idx];
            const y = this.rowChildY(insets.getTop(), heights[idx], baselines[idx], rowAscent, rowDescent);

            this.placeComponent(component, x, y, widths[idx], heights[idx], FillType.BOTH);

            x += component.getWidth();
            x += spacing;
        }
    }

    /**
     * Sums the non-weighted children's preferred and minimum widths (each
     * including inter-child spacing) and the total weight of the weight cells.
     *
     * @param components - The children sharing the row.
     * @param spacing - Inter-child spacing in pixels.
     * @returns `totalWeight` of the weight cells, plus the `fixedPreferred` and
     *   `fixedMin` width totals of the non-weighted children.
     */
    private measureFixedWidths(components: Component[], spacing: number): { totalWeight: number; fixedPreferred: number; fixedMin: number } {
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

                fixedPreferred += this.preferredChildWidth(size, minSize);
                fixedMin       += minSize ? minSize.width : 0;
            }
        }

        return { totalWeight, fixedPreferred, fixedMin };
    }

    /**
     * Resolves a non-weighted child's preferred width, falling back through min
     * width to `_defaultComponentWidth`.
     *
     * @param size - The child's preferred size, or `null`.
     * @param minSize - The child's minimum size, or `null`.
     * @returns The width the child contributes before shrinking.
     *
     * @remarks Nullish-coalesce, not `||`: a component with an explicit
     * preferred width of 0 (e.g. an empty `Text` label) must contribute 0, not
     * fall through to `_defaultComponentWidth` and inflate the row's fixed total
     * past the container, which would force the shrink path to squeeze every
     * non-weighted child (including glyphs) toward its min size. The
     * `minSize.width > 0` guard prevents `LayoutManager._defaultMinSize =
     * {0,0}` from short-circuiting the chain into a 0 width (which would land a
     * layout-managed Table on width 0 even though no preferred size was set).
     */
    private preferredChildWidth(size: Size | null, minSize: Size | null): number {
        return (size ? size.width : undefined)
            ?? (minSize && minSize.width > 0 ? minSize.width : undefined)
            ?? this._defaultComponentWidth;
    }

    /**
     * Resolves a child's final width within the row, clamped to its min/max.
     * Weight cells take a share of `remainingWidth`; non-weighted children take
     * their preferred width reduced by the shrink ratio toward their min width.
     *
     * @param size - The child's preferred size, or `null`.
     * @param minSize - The child's minimum size, or `null`.
     * @param maxSize - The child's maximum size, or `null`.
     * @param weight - The child's weight constraint (0 when non-weighted).
     * @param totalWeight - The summed weight of all weight cells.
     * @param remainingWidth - The space available to weight cells.
     * @param shrinkRatio - How far (0–1) non-weighted children shrink to min.
     * @returns The child's width.
     */
    private resolveChildWidth(size: Size | null, minSize: Size | null, maxSize: Size | null, weight: number, totalWeight: number, remainingWidth: number, shrinkRatio: number): number {
        let width: number;

        if (weight > 0 && totalWeight > 0) {
            width = (weight / totalWeight) * remainingWidth;
        } else {
            const pref = this.preferredChildWidth(size, minSize);
            const min  = minSize ? minSize.width : 0;

            width = pref - shrinkRatio * (pref - min);
        }

        if (minSize) {
            width = Math.max(width, minSize.width);
        }

        if (maxSize) {
            width = Math.min(width, maxSize.width);
        }

        return width;
    }

    /**
     * Computes a child's y within the row, aligning text-bearing children on the
     * shared baseline and centring null-baseline children in the text line.
     *
     * @param top - The row's content-top (inside the insets).
     * @param height - The child's height.
     * @param baseline - The child's baseline, or `null` for graphical/replaced children.
     * @param rowAscent - The row's text baseline, or `null` when no child reports one.
     * @param rowDescent - The row's text descent.
     * @returns The child's y position.
     */
    private rowChildY(top: number, height: number, baseline: number | null, rowAscent: number | null, rowDescent: number): number {
        if (rowAscent === null) {
            return top;
        }

        if (baseline !== null) {
            return top + (rowAscent - baseline);
        }

        return top + this.nullChildY(height, rowAscent, rowDescent);
    }
}

const HBoxCallable = callable(HBox);
type HBoxCallable = HBox;
export {
    HBox         as _HBox,
    HBoxCallable as HBox
};
