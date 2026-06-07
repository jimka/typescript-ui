// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";

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
 * equally and ignores `weight`. The `stretching` default depends on `mode`:
 * `false` for `"preferred"`, `true` for `"equal"`. An explicit `stretching`
 * value in the options bag always wins.
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
     * @remarks `mode` is dispatched before `stretching` so the
     * mode-dependent stretching default (`true` for `"equal"`, `false` for
     * `"preferred"`) can be resolved when the options bag does not pass
     * an explicit `stretching` value.
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
        } else if (options.mode === "equal") {
            this.setStretching(true);
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
}
