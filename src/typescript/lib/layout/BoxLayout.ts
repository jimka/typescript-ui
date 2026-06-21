// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { Size, UNBOUNDED, isUnbounded } from "~/primitive/Size.js";

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
 * How an `"equal"`-mode {@link HBox}/{@link VBox} sizes its cells when the
 * row/column overflows the host's inner extent and the host has opted into
 * scrolling (`Panel.setAutoScroll`).
 *
 * - `"preferred"` (the default) — every cell takes the widest/tallest child's
 *   preferred extent, so cells keep their preferred size and the host scrolls.
 * - `"min"` — every cell stays at the min floor (`max(child.minSize)`), so the
 *   row/column scrolls at the minimum cell size instead of growing.
 *
 * Has no effect outside `"equal"` mode, nor when the cells fit (the equal share
 * clears the min floor), nor when the host does not scroll (cells always clamp
 * to the min floor and the host's `overflow: hidden` clips the surplus).
 *
 * @category Layouts
 */
export type BoxOverflowSizing = "preferred" | "min";

/**
 * Construction-time options shared by {@link HBox} and {@link VBox}.
 *
 * @remarks `mode` selects the sizing strategy along the box's main axis.
 * `"preferred"` (the default) honours each child's preferred main-axis extent
 * and supports `weight` cells. `"equal"` divides the container's main axis
 * equally and ignores `weight`. `mode` is independent of `stretching`, which
 * governs the cross axis: `stretching` defaults to `false` in both modes, so
 * `"equal"` divides the main axis but leaves children at their preferred
 * cross-axis extent unless `stretching: true` is passed.
 *
 * @category Layouts
 */
export interface BoxLayoutOptions extends LayoutManagerOptions {
    spacing?:         number;
    stretching?:      boolean;
    mode?:            BoxMode;
    overflowSizing?:  BoxOverflowSizing;
}

/**
 * Abstract base for the single-axis box layouts {@link HBox} and {@link VBox}.
 * Holds the axis-agnostic configuration plumbing — spacing, stretching, sizing
 * mode, and overflow sizing — and dispatches a {@link BoxLayoutOptions} bag.
 * The geometric algorithms (`getPreferredSize`, `getMinSize`, `getMaxSize`,
 * `computeTotalMinSize`, `doLayout`) are mirror-image per axis and stay
 * concrete on each subclass.
 *
 * @category Layouts
 */
export abstract class BoxLayout extends LayoutManager {

    // `protected`, not `private`: the subclasses' geometric methods
    // (getPreferredSize/getMinSize/getMaxSize/computeTotalMinSize/doLayout)
    // read these fields directly, so they must be visible to HBox/VBox.
    protected _spacing: number = 5;
    protected _stretching: boolean = false;
    protected _mode: BoxMode = "preferred";
    protected _overflowSizing: BoxOverflowSizing = "preferred";

    constructor(options?: BoxLayoutOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link BoxLayoutOptions} bag, dispatching mode, spacing, and
     * stretching after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @remarks `mode` and `stretching` are independent axes: `mode` governs the
     * main-axis sizing strategy, `stretching` governs whether children fill the
     * cross axis. Neither defaults from the other — `stretching` is `false`
     * unless the options bag passes it explicitly, in both `"preferred"` and
     * `"equal"` mode.
     */
    protected applyOptions(options: BoxLayoutOptions): void {
        super.applyOptions(options);

        if (options.mode !== undefined) {
            this.setMode(options.mode);
        }

        if (options.spacing !== undefined) {
            this.setComponentSpacing(options.spacing);
        }

        if (options.stretching !== undefined) {
            this.setStretching(options.stretching);
        }

        if (options.overflowSizing !== undefined) {
            this.setOverflowSizing(options.overflowSizing);
        }
    }

    /**
     * Returns the pixel spacing between child components.
     *
     * @returns The current spacing in pixels.
     */
    getComponentSpacing(): number {
        return this._spacing || 0;
    }

    /**
     * Sets the pixel spacing between child components.
     *
     * @param spacing - Spacing in pixels.
     *
     * @returns This layout manager, for method chaining.
     */
    setComponentSpacing(spacing: number): this {
        this._spacing = spacing || 0;

        return this;
    }

    /**
     * Returns whether children stretch to fill the container's cross axis.
     *
     * @returns `true` if stretching is enabled.
     */
    isStretching(): boolean {
        return this._stretching || false;
    }

    /**
     * Sets whether children stretch to fill the container's cross axis.
     *
     * @param stretching - Pass `true` to enable cross-axis stretching.
     *
     * @returns This layout manager, for method chaining.
     */
    setStretching(stretching: boolean): this {
        this._stretching = !!stretching;

        return this;
    }

    /**
     * Returns the current sizing mode along the main axis.
     *
     * @returns Either `"preferred"` or `"equal"`.
     */
    getMode(): BoxMode {
        return this._mode;
    }

    /**
     * Sets the sizing mode along the main axis.
     *
     * @param mode - `"preferred"` honours each child's preferred main-axis
     *   extent; `"equal"` divides the container's main axis equally among
     *   children.
     *
     * @returns This layout manager, for method chaining.
     */
    setMode(mode: BoxMode): this {
        this._mode = mode;

        return this;
    }

    /**
     * Returns the cell-sizing strategy used when an `"equal"`-mode row/column
     * overflows a scrolling host.
     *
     * @returns Either `"preferred"` or `"min"`.
     */
    getOverflowSizing(): BoxOverflowSizing {
        return this._overflowSizing;
    }

    /**
     * Sets the cell-sizing strategy used when an `"equal"`-mode row/column
     * overflows a scrolling host.
     *
     * @param overflowSizing - `"preferred"` grows every cell to the largest
     *   child's preferred extent and scrolls; `"min"` keeps cells at the min
     *   floor and scrolls at the minimum cell size. See {@link BoxOverflowSizing}.
     *
     * @returns This layout manager, for method chaining.
     */
    setOverflowSizing(overflowSizing: BoxOverflowSizing): this {
        this._overflowSizing = overflowSizing;

        return this;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry.
     * Implemented per-axis by each subclass; consumed here by
     * {@link BoxLayout.inflateForOverflow}.
     *
     * @returns The total min-size of the children.
     */
    protected abstract computeTotalMinSize(): Size;

    /**
     * Aggregates the children's maximum sizes per the box contract: main axis =
     * sum of child maxima (+ spacing; in `"equal"` mode count * widest-child-max),
     * cross axis = max of child maxima, a null or unbounded child max making that
     * axis unbounded. Saturated to {@link UNBOUNDED}. Includes the container
     * perimeter.
     *
     * @param horizontal - `true` for {@link HBox} (main = width), `false` for
     *   {@link VBox} (main = height).
     * @returns The aggregated maximum `{width, height}`, or `null` if no
     *   container is attached.
     */
    protected aggregateMaxSize(horizontal: boolean): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimiterSize = container.getPerimiterSize();
        const components = container.getLaidOutComponents();

        const mainStart  = horizontal ? perimiterSize.left + perimiterSize.right : perimiterSize.top + perimiterSize.bottom;
        const crossExtra = horizontal ? perimiterSize.top + perimiterSize.bottom : perimiterSize.left + perimiterSize.right;

        let main = mainStart;
        let cross = 0;
        let mainUnbounded = false;
        let crossUnbounded = false;
        let maxChildMain = 0;

        for (const component of components) {
            const size = component.getMaxSize();

            if (!size) {
                mainUnbounded = true;
                crossUnbounded = true;
                continue;
            }

            const mainExtent  = horizontal ? size.width  : size.height;
            const crossExtent = horizontal ? size.height : size.width;

            if (isUnbounded(mainExtent)) {
                mainUnbounded = true;
            } else if (this._mode === "equal") {
                maxChildMain = Math.max(maxChildMain, mainExtent);
            } else {
                main += mainExtent;
            }

            if (isUnbounded(crossExtent)) {
                crossUnbounded = true;
            } else {
                cross = Math.max(cross, crossExtent);
            }
        }

        if (this._mode === "equal") {
            main += components.length * maxChildMain + this._spacing * Math.max(0, components.length - 1);
        } else {
            main += this._spacing * Math.max(0, components.length - 1);
        }

        cross += crossExtra;

        const mainValue  = mainUnbounded  ? UNBOUNDED : main;
        const crossValue = crossUnbounded ? UNBOUNDED : cross;

        return {
            width:  horizontal ? mainValue  : crossValue,
            height: horizontal ? crossValue : mainValue
        };
    }

    /**
     * Inflates a working container size to the children's combined minSize on
     * whichever axes the host has marked as overflowing (`Panel.setAutoScroll`),
     * so trailing children land past the host's inner rect and its CSS
     * `overflow: auto` produces the scrollbar. Axes the host has not opted into
     * keep the original extent and clamp as before.
     *
     * @param containerSize - The host's real inner size.
     * @returns The working size to lay out against — the original when neither
     *   axis overflows, otherwise inflated to the min total on the active axes.
     */
    protected inflateForOverflow(containerSize: Size): Size {
        if (!this.isOverflowingX() && !this.isOverflowingY()) {
            return containerSize;
        }

        const totalMin = this.computeTotalMinSize();

        return {
            width:  this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width,
            height: this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height,
        };
    }

    /**
     * Resolves how much main-axis space the weight cells share and how hard the
     * non-weighted children must shrink. When the non-weighted children's
     * preferred extents fit (or the host scrolls on this axis), nothing shrinks
     * and the leftover is the weight remainder. Otherwise the children shrink
     * proportionally toward their min extents so the last child's far edge lands
     * inside the container.
     *
     * @param fixedPreferred - Summed preferred main-axis extent of the
     *   non-weighted children, including inter-child spacing.
     * @param fixedMin - Summed minimum main-axis extent of the same children,
     *   including spacing.
     * @param available - The working container's inner extent on the main axis.
     * @param overflowing - Whether the host has opted into scrolling on this
     *   axis; when `true` the shrink is skipped so the host's CSS overflow
     *   engages instead.
     * @returns `remaining` — the main-axis space left for weight cells — and
     *   `shrinkRatio` — `0` (no shrink) through `1` (shrink fully to min).
     */
    protected computeShrink(fixedPreferred: number, fixedMin: number, available: number, overflowing: boolean): { remaining: number; shrinkRatio: number } {
        if (fixedPreferred <= available || overflowing) {
            return { remaining: Math.max(0, available - fixedPreferred), shrinkRatio: 0 };
        }

        const excess     = fixedPreferred - available;
        const shrinkable = fixedPreferred - fixedMin;

        return { remaining: 0, shrinkRatio: shrinkable > 0 ? Math.min(1, excess / shrinkable) : 1 };
    }
}
