// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

/**
 * Sizing strategy along an {@link HBox} or {@link VBox}'s main axis.
 *
 * - `"preferred"` — each child gets its preferred width (height for VBox);
 *   `weight`-constrained children split the remaining space; an overflow
 *   shrinks non-weighted children proportionally toward their min sizes.
 * - `"equal"` — children split the container's inner extent equally; the
 *   per-cell floor is `max(child.minSize.width)` (height for VBox);
 *   `weight` constraints are ignored.
 *
 * @category Layouts
 */
export type BoxMode = "preferred" | "equal";

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
export interface HBoxOptions extends LayoutManagerOptions {
    spacing?:    number;
    stretching?: boolean;
    mode?:       BoxMode;
}

/**
 * A layout manager that places children in a single horizontal row. The
 * `mode` option selects between preferred-width sequencing (with weight-cell
 * support) and equal-width division of the container.
 *
 * @category Layouts
 */
class HBox extends LayoutManager {

    private _spacing: number = 5;
    private _stretching: boolean = false;
    private _mode: BoxMode = "preferred";
    private _defaultComponentWidth: number = 100;

    constructor(options?: HBoxOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link HBoxOptions} bag, dispatching mode, spacing, and
     * stretching after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @remarks `mode` is dispatched before `stretching` so the
     * mode-dependent stretching default (`true` for `"equal"`, `false` for
     * `"preferred"`) can be resolved when the options bag does not pass
     * an explicit `stretching` value.
     */
    protected applyOptions(options: HBoxOptions): void {
        super.applyOptions(options);

        if (options.mode !== undefined) {
            this.setMode(options.mode);
        }

        if (options.spacing !== undefined) {
            this.setComponentSpacing(options.spacing);
        }

        if (options.stretching !== undefined) {
            this.setStretching(options.stretching);
        } else if (options.mode === "equal") {
            this.setStretching(true);
        }
    }

    /**
     * Returns the pixel spacing between child components.
     *
     * @returns The current spacing in pixels.
     */
    getComponentSpacing() {
        return this._spacing || 0;
    }

    /**
     * Sets the pixel spacing between child components.
     *
     * @param spacing - Spacing in pixels.
     */
    setComponentSpacing(spacing: number) : this {
        this._spacing = spacing || 0;

        return this;
    }

    /**
     * Returns whether children stretch to fill the container height.
     *
     * @returns `true` if stretching is enabled.
     */
    isStretching() {
        return this._stretching || false;
    }

    /**
     * Sets whether children stretch to fill the container height.
     *
     * @param stretching - Pass `true` to enable height stretching.
     */
    setStretching(stretching: boolean) : this {
        this._stretching = stretching;

        return this;
    }

    /**
     * Returns the current sizing mode along the horizontal axis.
     *
     * @returns Either `"preferred"` or `"equal"`.
     */
    getMode(): BoxMode {
        return this._mode;
    }

    /**
     * Sets the sizing mode along the horizontal axis.
     *
     * @param mode - `"preferred"` honours each child's preferred width;
     *   `"equal"` divides the container width equally among children.
     */
    setMode(mode: BoxMode): this {
        this._mode = mode;

        return this;
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

        let containerInsets = container.getContentInsets();
        let components = container.getComponents();
        let spacing = this.getComponentSpacing();

        // Universal scroll: when the host enabled per-axis overflow and the
        // children's combined minSize exceeds the host's inner rect on that
        // axis, lay out against the minSize total instead of clamping. The
        // trailing children then land past `innerSize` and the host's CSS
        // `overflow: auto` produces the scrollbar.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        if (this._mode === "equal") {
            // Equal-mode: divide the container width equally among children
            // and clamp the per-cell width to the largest child's min width,
            // mirroring preferred-mode's `Math.max(width, minSize.width)`
            // invariant. When the equal-share is smaller than a child's min
            // width, the row total exceeds the container and trailing cells
            // spill past the right edge — the host's `overflow: hidden` (or
            // `setAutoScroll`) takes over. Without the clamp, equal-mode
            // silently squeezes children with fixed-graphic minSizes (e.g.
            // RadioButton rings) below their min width and clips them.
            let maxChildMinWidth = 0;

            for (const component of components) {
                const min = component.getMinSize();
                if (min) {
                    maxChildMinWidth = Math.max(maxChildMinWidth, min.width);
                }
            }

            const equalShare = (containerSize.width - spacing * (components.length - 1)) / components.length;
            const columnWidth = Math.max(equalShare, maxChildMinWidth);

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

        // When non-weighted children's preferred widths sum past the
        // container's inner width, shrink each non-weighted child toward its
        // min size proportionally — preserves visual balance and ensures the
        // last child's right edge lands inside the container (so a trailing
        // child's own scrollbar isn't clipped by an `overflow: hidden`
        // ancestor). Weighted children get whatever is left over. When the
        // host has opted into horizontal overflow (`Panel.setAutoScroll`),
        // the working `containerSize.width` was already inflated above;
        // children should land at their preferred widths so the host's CSS
        // `overflow: auto` engages — skip the shrink in that case.
        let shrinkRatio = 0;
        let remainingWidth: number;

        if (fixedPreferredWidth <= containerSize.width || this.isOverflowingX()) {
            remainingWidth = Math.max(0, containerSize.width - fixedPreferredWidth);
        } else {
            remainingWidth = 0;
            const excess     = fixedPreferredWidth - containerSize.width;
            const shrinkable = fixedPreferredWidth - fixedMinWidth;
            shrinkRatio = shrinkable > 0 ? Math.min(1, excess / shrinkable) : 1;
        }

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
