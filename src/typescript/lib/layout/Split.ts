// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { SplitGutter } from "~/component/container/SplitGutter.js";
import { Component } from "~/core/Component.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

// Pixel thickness of a single draggable gutter. The main-axis sizing math
// subtracts the gutters' combined footprint before dividing space among
// panes, so this constant is the single source of truth for both the size
// reservation and the gutter placement in `doLayout`.
const GUTTER_SIZE = 4;

/**
 * Construction-time options for {@link Split}.
 *
 * @category Layouts
 */
export interface SplitOptions extends LayoutManagerOptions {
    direction?: string;
}

/**
 * A layout manager that splits the container into two or more resizable panels
 * separated by draggable gutter elements.
 * The split direction can be `'horizontal'` (panels side by side) or `'vertical'` (panels stacked).
 *
 * @category Layouts
 */
class Split extends LayoutManager {

    private _direction: String = "horizontal";
    private _sizes: Map<Component, number> = new Map<Component, number>();
    private _gutters: Array<SplitGutter> = [];

    private _dragOriginPointer: number = 0;
    private _dragOriginLhsSize: number = 0;
    private _dragOriginRhsSize: number = 0;

    // The available (net-of-gutters) main-axis extent the stored `_sizes`
    // were last normalised against. Lets `recalculateSizes` rescale the
    // frozen pane sizes when the container grows or shrinks, so panes keep
    // filling the container across viewport resizes. `0` until the first
    // connected layout, which correctly suppresses the rescale pass.
    private _lastAvailableMain: number = 0;

    constructor(direction?: String | SplitOptions, options?: SplitOptions) {
        super();

        if (direction === undefined || typeof direction === 'string' || direction instanceof String) {
            if (direction) {
                this._direction = direction;
            }

            if (options) {
                this.applyOptions(options);
            }
        } else {
            this.applyOptions(direction);
        }
    }

    /**
     * Applies a {@link SplitOptions} bag, dispatching the split direction
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: SplitOptions): void {
        super.applyOptions(options);

        if (options.direction !== undefined) {
            this.setDirection(options.direction);
        }
    }

    /**
     * Returns the split direction.
     *
     * @returns `'horizontal'` or `'vertical'`.
     */
    getDirection() {
        return this._direction;
    }

    /**
     * Sets the split direction.
     *
     * @param direction - `'horizontal'` for side-by-side panels, `'vertical'` for stacked panels.
     */
    setDirection(direction: String) : this {
        this._direction = direction;

        return this;
    }

    /**
     * Captures the drag origin when a gutter's drag begins: the absolute
     * pointer coordinate and the current sizes of the two adjacent panels.
     * Subsequent `drag` events derive the new sizes from these origins so
     * over-travel past a panel's minimum is absorbed without decoupling the
     * gutter from the cursor on reversal.
     *
     * @param container - The container component that owns the panels.
     * @param gutter - The gutter whose drag is starting.
     * @param position - The absolute pointer coordinate (`clientX`/`clientY`)
     *   in the split axis at the moment the drag began.
     */
    onDragStart(container: Component, gutter: SplitGutter, position: number) {
        let gutterIdx = this._gutters.indexOf(gutter);
        let lhs = container.getComponents()[gutterIdx];
        let rhs = container.getComponents()[gutterIdx + 1];

        this._dragOriginPointer = position;

        if (this._direction === "horizontal") {
            this._dragOriginLhsSize = lhs.getWidth();
            this._dragOriginRhsSize = rhs.getWidth();
        } else {
            this._dragOriginLhsSize = lhs.getHeight();
            this._dragOriginRhsSize = rhs.getHeight();
        }
    }

    /**
     * Adjusts the sizes of the two panels adjacent to a gutter when it is dragged.
     *
     * @param container - The container component that owns the panels.
     * @param gutter - The gutter being dragged.
     * @param position - The absolute pointer coordinate (`clientX`/`clientY`) in
     *   the split axis for this move.
     *
     * @remarks The new panel sizes are computed from the drag origin captured in
     * {@link onDragStart} as `origin + (position − originPointer)`, then clamped
     * against each panel's minimum size while conserving the pair's combined
     * size. Clamping the absolute result (rather than accumulating per-move
     * deltas) means dragging past a panel's minimum is idempotent: the panel
     * stays at its floor until the pointer returns past the boundary
     * coordinate. The stored sizes for both affected panels are updated so the
     * next `doLayout` call preserves the user-defined split ratio.
     */
    onDrag(container: Component, gutter: SplitGutter, position: number) {
        let gutterIdx = this._gutters.indexOf(gutter);
        let lhs = container.getComponents()[gutterIdx];
        let rhs = container.getComponents()[gutterIdx + 1];

        const horizontal = this._direction === "horizontal";
        const total      = this._dragOriginLhsSize + this._dragOriginRhsSize;

        const lhsMin = lhs.getMinSize();
        const rhsMin = rhs.getMinSize();
        const minLhs = lhsMin ? (horizontal ? lhsMin.width : lhsMin.height) : 0;
        const minRhs = rhsMin ? (horizontal ? rhsMin.width : rhsMin.height) : 0;

        const offset = position - this._dragOriginPointer;

        let newLhs = this._dragOriginLhsSize + offset;
        newLhs = Math.max(minLhs, Math.min(total - minRhs, newLhs));

        const newRhs    = total - newLhs;
        const dragAmount = newLhs - (horizontal ? lhs.getWidth() : lhs.getHeight());

        if (horizontal) {
            lhs.setWidth(newLhs);
            gutter.setX(gutter.getX() + dragAmount);
            rhs.setX(rhs.getX() + dragAmount);
            rhs.setWidth(newRhs);
        } else {
            lhs.setHeight(newLhs);
            gutter.setY(gutter.getY() + dragAmount);
            rhs.setY(rhs.getY() + dragAmount);
            rhs.setHeight(newRhs);
        }

        this._sizes.set(lhs, newLhs);
        this._sizes.set(rhs, newRhs);

        lhs.doLayout();
        rhs.doLayout();
    }

    /**
     * Detaches from the container and removes all gutter elements from the DOM.
     */
    detach() : this {
        super.detach();

        for (let idx in this._gutters) {
            let gutter = this._gutters[idx];

            let gutterElement = gutter.getElement();
            (gutterElement.parentNode as Node).removeChild(gutterElement);
            gutter.destroy();
        }

        this._gutters = [];

        return this;
    }

    /**
     * Returns the combined pixel footprint of all gutters for a given pane
     * count: one gutter sits between each adjacent pane pair.
     *
     * @param componentCount - The number of panes in the container.
     *
     * @returns The total gutter thickness along the split axis.
     */
    private gutterTotal(componentCount: number): number {
        return Math.max(0, componentCount - 1) * GUTTER_SIZE;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * along the split axis the per-pane `_sizes` are the user's floor (their
     * sum is the total); the cross-axis follows the max child minSize. Used
     * by `doLayout` to inflate the working size when the host has opted into
     * `setOverflowing`.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent.
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

        let splitTotal = this.gutterTotal(components.length);
        let crossMax = 0;

        for (const component of components) {
            const stored = this._sizes.get(component);
            if (stored != null) {
                splitTotal += stored;
            } else {
                const min = component.getMinSize();
                if (min) {
                    splitTotal += this._direction === "horizontal" ? min.width : min.height;
                }
            }

            const min = component.getMinSize();
            if (min) {
                crossMax = Math.max(crossMax, this._direction === "horizontal" ? min.height : min.width);
            }
        }

        return this._direction === "horizontal"
            ? { width: splitTotal, height: crossMax }
            : { width: crossMax,   height: splitTotal };
    }

    /**
     * Creates missing gutters, computes panel sizes, and positions all panels and gutters.
     *
     * @remarks New [`SplitGutter`](/api/component/container/classes/SplitGutter) instances are appended to the container's DOM element on first layout.
     * Existing gutters are reused on subsequent layouts.
     */
    doLayout() {
        let me = this;
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        // Universal scroll: see HBox.doLayout for the rationale. When the
        // host has marked the corresponding axis as overflowing, grow the
        // working size past the host's inner rect so trailing panes land
        // past `innerSize` and the host's CSS `overflow: auto` produces a
        // scrollbar.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        let element = container.getElement();
        let components = container.getComponents();
        let containerInsets = container.getContentInsets();

        let componentCount = components.length;
        let gutterCount = componentCount - 1;

        for (let i = this._gutters.length; i < gutterCount; i += 1) {
            let gutter = new SplitGutter(this._direction);
            gutter.on("dragstart", function (position: number) {
                me.onDragStart(<Component>container, gutter, position);
            });
            gutter.on("drag", function (position: number) {
                me.onDrag(<Component>container, gutter, position);
            });

            this._gutters.push(gutter);

            element.appendChild(gutter.getElement(true));
        }

        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        this.recalculateSizes();

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];

            let componentWidth;
            let componentHeight;

            if (this._direction === "horizontal") {
                componentWidth = this._sizes.get(component) as number;
                componentHeight = containerSize.height;
            } else {
                componentWidth = containerSize.width;
                componentHeight = this._sizes.get(component) as number;
            }

            this.placeComponent(
                component,
                x,
                y,
                componentWidth,
                componentHeight,
                FillType.BOTH
            );

            if (this._direction === "horizontal") {
                x += componentWidth;
            } else {
                y += componentHeight;
            }

            if (idx < gutterCount) {
                let gutter = this._gutters[idx];

                gutter.setX(x);
                gutter.setY(y);

                if (this._direction === "horizontal") {
                    gutter.setWidth(GUTTER_SIZE);
                    gutter.setHeight(componentHeight);

                    x += GUTTER_SIZE;
                } else {
                    gutter.setWidth(componentWidth);
                    gutter.setHeight(GUTTER_SIZE);

                    y += GUTTER_SIZE;
                }
            }
        }
    }

    /**
     * Assigns initial sizes to any components that do not yet have a stored size.
     *
     * @remarks When some panels already have stored sizes and a new panel is added,
     * its size is taken proportionally from the existing panels so the total remains constant.
     * When no panels have stored sizes the available container dimension is divided equally.
     */
    recalculateSizes() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let components = container.getComponents();

        // `getInnerSize` already removed the perimeter (insets + border +
        // padding); the only thing the panes don't get is the gutters, so the
        // space to divide is the inner main axis minus the gutter footprint.
        // `doLayout` places panes from `getContentInsets` and advances by this
        // same gutter total, so a pane sum of `available` lands flush with the
        // inner edge — no `gutterCount × GUTTER_SIZE` overflow.
        let main = this._direction === "horizontal" ? containerSize.width : containerSize.height;
        let available = Math.max(0, main - this.gutterTotal(components.length));

        // Rescale the frozen pane sizes to the new extent so they keep filling
        // the container across viewport resizes. Ratios are scale-invariant, so
        // multiplying every stored size by the same factor preserves any split
        // the user dragged. Skipped on the first connected layout
        // (`_lastAvailableMain` is still 0) and when nothing changed.
        if (this._lastAvailableMain > 0 && available > 0 && available !== this._lastAvailableMain && this._sizes.size > 0) {
            let factor = available / this._lastAvailableMain;

            for (let idx = 0; idx < components.length; idx += 1) {
                let component = components[idx];
                let stored = this._sizes.get(component);

                if (stored != undefined) {
                    this._sizes.set(component, stored * factor);
                }
            }
        }

        let componentsWithSize = 0;

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];

            if (this._sizes.has(component)) {
                componentsWithSize += 1;
            }
        }

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            let componentSize = this._sizes.get(component);

            if (componentSize == undefined) {
                if (this._sizes.size != 0) {
                    componentSize = 0;

                    for (let jdx = 0; jdx < components.length; jdx += 1) {
                        let c = components[jdx];
                        let cSize = this._sizes.get(c);

                        if(cSize == undefined) {
                            continue;
                        }

                        let sizeFraction = cSize * (1 / (componentsWithSize + 1));
                        componentSize += sizeFraction;
                        cSize -= sizeFraction;

                        this._sizes.set(c, cSize);
                    }
                } else {
                    componentSize = available;
                }

                this._sizes.set(component, componentSize);
                componentsWithSize += 1;
            }
        }

        // Only remember a positive extent. If the container collapsed below the
        // gutter footprint (`available == 0`) the stored sizes were left frozen,
        // so keeping the last positive baseline lets the next growth rescale
        // them back to fill instead of stranding the pre-collapse sizes.
        if (available > 0) {
            this._lastAvailableMain = available;
        }
    }
}

const SplitCallable = callable(Split);
type SplitCallable = Split;
export {
    Split         as _Split,
    SplitCallable as Split
};
