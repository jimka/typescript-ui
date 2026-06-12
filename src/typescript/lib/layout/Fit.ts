// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { Size } from "~/primitive/Size.js";
import { FillType } from "~/layout/FillType.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Fit}.
 *
 * @category Layouts
 */
export interface FitOptions extends LayoutManagerOptions {
    fill?: FillType;
}

/**
 * A layout manager that expects exactly one child component and positions it
 * inside the container's entire inner bounds. The default fill mode is
 * `FillType.BOTH` — the child stretches to fill the bounds. Pass
 * `fill: FillType.NONE` (or call {@link Fit.setFill}) to centre the child at
 * its preferred size instead; `HORIZONTAL` / `VERTICAL` stretch on one axis
 * and centre on the other. Throws if the container holds more than one
 * component.
 *
 * @category Layouts
 */
class Fit extends LayoutManager {

    private _fill: FillType = FillType.BOTH;

    constructor(options?: FitOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link FitOptions} bag, dispatching the fill mode after the
     * inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: FitOptions): void {
        super.applyOptions(options);

        if (options.fill !== undefined) {
            this.setFill(options.fill);
        }
    }

    /**
     * Returns the fill mode applied to the single child.
     *
     * @returns The current [`FillType`](/api/layout/enumerations/FillType).
     */
    getFill(): FillType {
        return this._fill;
    }

    /**
     * Sets the fill mode applied to the single child.
     *
     * @param fill - `BOTH` stretches the child to fill (default), `NONE`
     * centres it at its preferred size, `HORIZONTAL` / `VERTICAL` stretch on
     * one axis and centre on the other.
     *
     * @returns This layout manager, for method chaining.
     */
    setFill(fill: FillType): this {
        this._fill = fill;

        return this;
    }

    /**
     * Returns the preferred size of the single child component plus the container perimeter.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or no displayed child.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        // Size the displayed child only: a hidden sole child contributes no
        // size, so the Fit container reports none and its own parent reserves
        // nothing for it (honouring `displayed`, matching doLayout below).
        let component = container.getLaidOutComponents()[0] ?? null;
        if (!component) {
            return null;
        }

        let size = component.getPreferredSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Returns the minimum size of the single child component plus the container perimeter.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or no displayed child.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        // Size the displayed child only: a hidden sole child contributes no
        // size, so the Fit container reports none and its own parent reserves
        // nothing for it (honouring `displayed`, matching doLayout below).
        let component = container.getLaidOutComponents()[0] ?? null;
        if (!component) {
            return null;
        }

        let size = component.getMinSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Returns the maximum size of the single child component plus the container perimeter.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or no displayed child.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        // Size the displayed child only: a hidden sole child contributes no
        // size, so the Fit container reports none and its own parent reserves
        // nothing for it (honouring `displayed`, matching doLayout below).
        let component = container.getLaidOutComponents()[0] ?? null;
        if (!component) {
            return null;
        }

        let size = component.getMaxSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Returns the single child component of the container, or `undefined` if the container is empty.
     *
     * @returns The child component, or `undefined`.
     *
     * @remarks Throws if the container holds more than one component.
     */
    getComponent() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let components = container.getComponents();

        if (components.length > 1) {
            throw new Error("Container contains more then one component.");
        }

        let component;

        if (components.length == 1) {
            component = components[0];
        }

        return component;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * the single child's minSize. Used by `doLayout` to inflate the working
     * size when the host has opted into `setOverflowing`.
     *
     * @returns The single child's min-size; `{ width: 0, height: 0 }` when
     *   the container is absent or empty.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const component = container.getLaidOutComponents()[0];
        if (!component) {
            return { width: 0, height: 0 };
        }

        const min = component.getMinSize();

        return min ?? { width: 0, height: 0 };
    }

    /**
     * Places the single child component inside the container's inner bounds
     * using the configured fill mode.
     *
     * @remarks Throws if the container holds more than one component. With
     * the default `FillType.BOTH` the child is sized to the full bounds;
     * with `FillType.NONE` it is placed at its preferred size and centred
     * via the inherited anchor-displacement logic in `placeComponent`.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        // Honour `displayed`: a hidden sole child contributes nothing and a
        // hidden first-of-two is skipped, so the visible child still fits.
        let components = container.getLaidOutComponents();

        if (components.length > 1) {
            throw new Error("Container contains more then one component.");
        }

        let component;

        if (components.length == 1) {
            component = components[0];
        }

        if (!component) {
            return;
        }

        let containerSize = container.getInnerSize();
        let containerInsets = container.getContentInsets();

        // Universal scroll: see HBox.doLayout for the rationale. When the
        // host has marked the corresponding axis as overflowing, grow the
        // working size past the host's inner rect to the child's minSize so
        // the host's CSS `overflow: auto` produces a scrollbar.
        if (containerSize && (this.isOverflowingX() || this.isOverflowingY())) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        this.placeComponent(
            component,
            containerInsets ? containerInsets.getLeft() : 0,
            containerInsets ? containerInsets.getTop() : 0,
            containerSize ? containerSize.width : 0,
            containerSize ? containerSize.height : 0,
            this._fill
        );
    }
}

const FitCallable = callable(Fit);
type FitCallable = Fit;
export {
    Fit         as _Fit,
    FitCallable as Fit
};
