// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BoxLayout, BoxLayoutOptions } from "~/layout/BoxLayout.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
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

        for (const component of container.getComponents()) {
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
        let components = container.getComponents();
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
        let components = container.getComponents();
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
     * Returns the maximum size. In `"preferred"` mode width is the sum of
     * child widths plus spacing, height is the minimum of child max heights.
     * In `"equal"` mode width is `count * (minChildMaxWidth + spacing) - spacing`.
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
        let width = perimiterSize.left + perimiterSize.right;
        let height = Number.MAX_SAFE_INTEGER;

        if (this._mode === "equal") {
            let minChildMaxWidth = Number.MAX_SAFE_INTEGER;

            for (let idx in components) {
                let component = components[idx];
                let size = component.getMaxSize();

                if (size) {
                    minChildMaxWidth = Math.min(minChildMaxWidth, size.width);
                    height = Math.min(height, size.height);
                }
            }

            width += components.length * (minChildMaxWidth + this._spacing) - this._spacing;
        } else {
            for (let idx in components) {
                let component = components[idx];
                let size = component.getMinSize();

                if (size) {
                    width += size.width;
                    height = Math.min(height, size.height);
                }
            }

            width += this._spacing * (components.length - 1);
        }

        height += perimiterSize.top + perimiterSize.bottom;

        return {
            width: width,
            height: height
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

        const components = container.getComponents();
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
     * Places children left-to-right. In `"preferred"` mode each child takes
     * its preferred width (with `weight` cells dividing the remainder).
     * In `"equal"` mode the container width is divided equally among
     * children, clamped to the largest child's min width.
     *
     * @remarks When `stretching` is enabled, each child's height is clamped
     * to its max size rather than its preferred size. Children without a
     * preferred size fall back to `defaultComponentWidth` (preferred mode
     * only). `weight` constraints are honoured only in `"preferred"` mode;
     * `"equal"` mode silently ignores them.
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

        // Real inner size, captured before the overflow inflation below may
        // replace `containerSize` with the (larger) min total. Equal mode needs
        // the true viewport to decide whether the row actually overflows.
        const innerSize = containerSize;

        let containerInsets = container.getContentInsets();
        let components = container.getComponents();
        let spacing = this.getComponentSpacing();

        // Universal scroll: when the host has opted into per-axis overflow, lay
        // out against the children's combined minSize so trailing children land
        // past the viewport and the host's CSS `overflow: auto` scrolls.
        containerSize = this.inflateForOverflow(containerSize);

        if (this._mode === "equal") {
            // Equal-mode: divide the container width equally among children,
            // clamped to a per-cell floor. The widest child's min width and
            // preferred width drive that floor (see the cases below).
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

            // Measure the equal share against the *real* viewport — the working
            // `containerSize` may have been inflated to the min total above.
            const equalShare = (innerSize.width - spacing * (components.length - 1)) / components.length;

            // Three cases:
            //   1. Share clears the min floor → the row fits; divide equally.
            //   2. Share is below the min floor (row overflows), the host opted
            //      into scrolling, and `overflowSizing` is `"preferred"` → give
            //      every cell the widest child's preferred width (equal mode's
            //      uniform "preferred" — see getPreferredSize) so cells regain
            //      preferred size instead of sticking at min when scrolling.
            //   3. Otherwise (no scroll, or `overflowSizing` is `"min"`) → clamp
            //      to the min floor; with no scroll the host's `overflow:
            //      hidden` clips the surplus.
            const columnWidth = equalShare >= maxChildMinWidth
                ? equalShare
                : this.isOverflowingX() && this._overflowSizing === "preferred"
                    ? Math.max(maxChildMinWidth, maxChildPreferredWidth)
                    : maxChildMinWidth;

            if (this.isStretching()) {
                const columnHeight = containerSize.height;
                let x = containerInsets.getLeft();
                const y = containerInsets.getTop();

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

                    x += columnWidth + spacing;
                }

                this.reserveContentFrame();

                return;
            }

            const heights: number[] = [];
            const baselines: Array<number | null> = [];

            for (let idx = 0; idx < components.length; idx += 1) {
                let component = components[idx];
                let size = component.getPreferredSize();
                let height = size ? size.height : 0;

                heights.push(height);
                baselines.push(component.getBaseline());
            }

            const { rowAscent, rowDescent } = this.computeRowMetrics(heights, baselines);

            let x = containerInsets.getLeft();

            for (let idx = 0; idx < components.length; idx += 1) {
                let component = components[idx];
                const height = heights[idx];

                let y: number;

                if (rowAscent !== null) {
                    const b = baselines[idx];

                    if (b !== null) {
                        y = containerInsets.getTop() + (rowAscent - b);
                    } else {
                        y = containerInsets.getTop() + this.nullChildY(height, rowAscent, rowDescent);
                    }
                } else {
                    y = containerInsets.getTop();
                }

                this.placeComponent(
                    component,
                    x,
                    y,
                    columnWidth,
                    height,
                    FillType.BOTH
                );

                x += columnWidth + spacing;
            }

            this.reserveContentFrame();

            return;
        }

        // Preferred-mode: each child takes its preferred width; weight cells
        // split the remainder; non-weighted children shrink proportionally
        // toward their min sizes when the row overflows.
        let totalWeight = 0;
        let fixedPreferredWidth = spacing * (components.length - 1);
        let fixedMinWidth       = spacing * (components.length - 1);

        for (let idx in components) {
            let component = components[idx];
            let constraints = this.getLayoutConstraints(component);
            let weight = constraints?.weight ?? 0;

            if (weight > 0) {
                totalWeight += weight;
            } else {
                let size = component.getPreferredSize();
                let minSize = component.getMinSize();
                // Nullish-coalesce, not `||`: a component with an explicit
                // preferred width of 0 (e.g. an empty `Text` label) must
                // contribute 0, not fall through to `_defaultComponentWidth`
                // and inflate the row's fixed total past the container, which
                // would force the shrink path to squeeze every non-weighted
                // child (including glyphs) toward its min size. The
                // `minSize.width > 0` guard prevents
                // `LayoutManager._defaultMinSize = {0,0}` from short-circuiting
                // the chain into a 0 width (would land a layout-managed Table
                // on width 0 even though no preferred size was set).
                const pref = (size ? size.width : undefined)
                    ?? (minSize && minSize.width > 0 ? minSize.width : undefined)
                    ?? this._defaultComponentWidth;
                const min  = minSize ? minSize.width : 0;
                fixedPreferredWidth += pref;
                fixedMinWidth       += min;
            }
        }

        // Non-weighted children shrink toward their min widths when their
        // preferred widths overflow the row, so the last child's right edge
        // lands inside the container; weighted children share the remainder.
        // The shrink is skipped when the host scrolls on this axis (the working
        // width was already inflated above). See BoxLayout.computeShrink.
        const { remaining: remainingWidth, shrinkRatio } = this.computeShrink(
            fixedPreferredWidth,
            fixedMinWidth,
            containerSize.width,
            this.isOverflowingX()
        );

        const widths: number[] = [];
        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (let idx = 0; idx < components.length; idx += 1) {
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
                // See the fixed-total loop above for why `??` and the
                // `minSize.width > 0` guard.
                const pref = (size ? size.width : undefined)
                    ?? (minSize && minSize.width > 0 ? minSize.width : undefined)
                    ?? this._defaultComponentWidth;
                const min  = minSize ? minSize.width : 0;
                width = pref - shrinkRatio * (pref - min);
            }

            if (minSize) width = Math.max(width, minSize.width);
            if (maxSize) width = Math.min(width, maxSize.width);

            let height: number;

            if (!size || this.isStretching()) {
                height = maxSize ? Math.min(maxSize.height, containerSize.height) : containerSize.height;
            } else {
                height = Math.min(size.height, containerSize.height);
            }

            widths.push(width);
            heights.push(height);
            baselines.push(component.getBaseline());
        }

        // Stretching forces every child to fill the row vertically, which makes
        // baseline alignment meaningless — fall back to top-alignment.
        // rowAscent is driven only by text-bearing children; tall null-baseline
        // children (a List, TextArea, etc.) must NOT drag the baseline down or
        // every text label in the row would be pushed off the top.
        let rowAscent: number | null = null;
        let rowDescent = 0;

        if (!this.isStretching()) {
            const metrics = this.computeRowMetrics(heights, baselines);
            rowAscent = metrics.rowAscent;
            rowDescent = metrics.rowDescent;
        }

        let x = containerInsets.getLeft();

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            const width = widths[idx];
            const height = heights[idx];

            let y: number;

            if (rowAscent !== null) {
                const b = baselines[idx];
                if (b !== null) {
                    y = containerInsets.getTop() + (rowAscent - b);
                } else {
                    y = containerInsets.getTop() + this.nullChildY(height, rowAscent, rowDescent);
                }
            } else {
                y = containerInsets.getTop();
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

        this.reserveContentFrame();
    }
}

const HBoxCallable = callable(HBox);
type HBoxCallable = HBox;
export {
    HBox         as _HBox,
    HBoxCallable as HBox
};
