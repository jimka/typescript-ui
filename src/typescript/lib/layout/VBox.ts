// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
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
     * Places children top-to-bottom. In `"preferred"` mode each child takes
     * its preferred height (with `weight` cells dividing the remainder).
     * In `"equal"` mode the container height is divided equally among
     * children, clamped to the largest child's min height.
     *
     * @remarks When `stretching` is enabled, each child's width is clamped
     * to its max size rather than its preferred size. Children without a
     * preferred size fall back to `defaultComponentHeight` (preferred mode
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
        // the true viewport to decide whether the column actually overflows.
        const innerSize = containerSize;

        let containerInsets = container.getContentInsets();
        let components = container.getComponents();
        let spacing = this.getComponentSpacing();

        // Universal scroll: when the host has opted into per-axis overflow, lay
        // out against the children's combined minSize so trailing children land
        // past the viewport and the host's CSS `overflow: auto` scrolls.
        containerSize = this.inflateForOverflow(containerSize);

        if (this._mode === "equal") {
            // Equal-mode: divide the container height equally among children,
            // clamped to a per-cell floor. The tallest child's min height and
            // preferred height drive that floor (see the cases below).
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

            // Measure the equal share against the *real* viewport — the working
            // `containerSize` may have been inflated to the min total above.
            const equalShare = (innerSize.height - spacing * (components.length - 1)) / components.length;

            // Three cases (see HBox.doLayout for the full rationale):
            //   1. Share clears the min floor → the column fits; divide equally.
            //   2. Share below the min floor (overflow), host opted into
            //      scrolling, and `overflowSizing` is `"preferred"` → tallest
            //      child's preferred height so cells regain preferred size
            //      instead of sticking at min when scrolling.
            //   3. Otherwise (no scroll, or `overflowSizing` is `"min"`) → clamp
            //      to the min floor; with no scroll the host clips the surplus.
            const rowHeight = equalShare >= maxChildMinHeight
                ? equalShare
                : this.isOverflowingY() && this._overflowSizing === "preferred"
                    ? Math.max(maxChildMinHeight, maxChildPreferredHeight)
                    : maxChildMinHeight;
            const rowWidth  = containerSize.width;

            const x = containerInsets.getLeft();
            let y = containerInsets.getTop();

            for (let idx in components) {
                let component = components[idx];

                this.placeComponent(
                    component,
                    x,
                    y,
                    rowWidth,
                    rowHeight,
                    FillType.BOTH
                );

                y += rowHeight + spacing;
            }

            this.reserveContentFrame();

            return;
        }

        // Preferred-mode: each child takes its preferred height; weight cells
        // split the remainder; non-weighted children shrink proportionally
        // toward their min sizes when the column overflows.
        let totalWeight = 0;
        let fixedPreferredHeight = spacing * (components.length - 1);
        let fixedMinHeight       = spacing * (components.length - 1);

        for (let idx in components) {
            let component = components[idx];
            let constraints = this.getLayoutConstraints(component);
            let weight = constraints?.weight ?? 0;

            if (weight > 0) {
                totalWeight += weight;
            } else {
                let size = component.getPreferredSize();
                let minSize = component.getMinSize();
                // See HBox for the `??` rationale: a component with an
                // explicit preferred height of 0 must contribute 0, not fall
                // through to `_defaultComponentHeight`. The minSize.height>0
                // guard prevents `LayoutManager._defaultMinSize = {0,0}` from
                // short-circuiting the fallback (which would land children
                // like a layout-managed Table on a 0 height because the
                // managers's default minSize technically satisfies `??`).
                const pref = (size ? size.height : undefined)
                    ?? (minSize && minSize.height > 0 ? minSize.height : undefined)
                    ?? this._defaultComponentHeight;
                const min  = minSize ? minSize.height : 0;
                fixedPreferredHeight += pref;
                fixedMinHeight       += min;
            }
        }

        // Non-weighted children shrink toward their min heights when their
        // preferred heights overflow the column, so the last child's bottom edge
        // lands inside the container; weighted children share the remainder.
        // The shrink is skipped when the host scrolls on this axis (the working
        // height was already inflated above). See BoxLayout.computeShrink.
        const { remaining: remainingHeight, shrinkRatio } = this.computeShrink(
            fixedPreferredHeight,
            fixedMinHeight,
            containerSize.height,
            this.isOverflowingY()
        );

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
                // See the fixed-total loop above for why `??` and the
                // `minSize.height > 0` guard.
                const pref = (size ? size.height : undefined)
                    ?? (minSize && minSize.height > 0 ? minSize.height : undefined)
                    ?? this._defaultComponentHeight;
                const min  = minSize ? minSize.height : 0;
                height = pref - shrinkRatio * (pref - min);
            }

            if (minSize) height = Math.max(height, minSize.height);
            if (maxSize) height = Math.min(height, maxSize.height);

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

        this.reserveContentFrame();
    }
}

const VBoxCallable = callable(VBox);
type VBoxCallable = VBox;
export {
    VBox         as _VBox,
    VBoxCallable as VBox
};
