// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions, ResolvedPlacement } from "~/layout/LayoutManager.js";
import type { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * How an {@link Absolute} manager sizes each child.
 *
 * - `"preferred"` (the default) — each child is committed at its preferred
 *   size, falling back to its current size, then to `0`.
 * - `"committed"` — each child is committed at the width and height it already
 *   holds, for a container whose children are sized by the code that owns them
 *   rather than by this manager. A child nobody has sized yet is skipped.
 *
 * Either way the child keeps its own position; only the size differs.
 *
 * @category Layouts
 */
export type AbsoluteSizing = "preferred" | "committed";

/**
 * Construction-time options for {@link Absolute}.
 *
 * @category Layouts
 */
export interface AbsoluteOptions extends LayoutManagerOptions {
    /** How each child is sized. Default `"preferred"`. See {@link AbsoluteSizing}. */
    sizing?: AbsoluteSizing;
}

/**
 * A layout manager that places each child at its preferred (or current) size
 * at the position the application has already set on the child. The `sizing`
 * option switches that size to the width and height the child already holds,
 * for a container whose children are sized by whoever placed them. No clamp is
 * applied — a child larger than the container is committed at its full size,
 * letting a host `Panel` with `autoScroll: "auto"` scroll the overflow.
 *
 * @category Layouts
 */
class Absolute extends LayoutManager {

    private _sizing: AbsoluteSizing = "preferred";

    constructor(options?: AbsoluteOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link AbsoluteOptions} bag, dispatching `sizing` after the
     * inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AbsoluteOptions): void {
        super.applyOptions(options);

        if (options.sizing !== undefined) {
            this.setSizing(options.sizing);
        }
    }

    /**
     * Returns how each child is sized.
     *
     * @returns Either `"preferred"` or `"committed"`.
     */
    getSizing(): AbsoluteSizing {
        return this._sizing;
    }

    /**
     * Sets how each child is sized.
     * Marks the container's layout pass as owed.
     *
     * @param sizing - `"preferred"` commits each child at its preferred size,
     *   falling back to its current size, then `0`; `"committed"` commits it at
     *   the width and height it already holds. See {@link AbsoluteSizing}.
     *
     * @returns This layout manager, for method chaining.
     */
    setSizing(sizing: AbsoluteSizing): this {
        this._sizing = sizing;
        this.getContainer()?.invalidateLayout();

        return this;
    }

    /**
     * Places each child at the position declared by the child's own `getX` /
     * `getY`, sized as the `sizing` mode says: at its preferred size (falling
     * back to `size`, then `0`) in `"preferred"` mode, or at the width and
     * height it already holds in `"committed"` mode, where a child nobody has
     * sized yet is left alone entirely. Bypasses
     * {@link LayoutManager.placeComponent} so the cell clamp does not shrink an
     * oversized child.
     */
    doLayout(): void {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        const components = container.getLaidOutComponents();
        const placements: ResolvedPlacement[] = [];

        for (const component of components) {
            const placement = this._sizing === "committed"
                ? this.committedPlacement(component)
                : this.preferredPlacement(component);

            if (placement) {
                placements.push(placement);
            }
        }

        this.commitPlacements(placements);
    }

    /**
     * Resolves `component`'s placement in `"committed"` mode — its own position
     * at the width and height it already holds.
     *
     * @param component - The child being placed.
     *
     * @returns The resolved placement, or `null` for a child nobody has sized
     *   yet, which this mode leaves alone.
     */
    private committedPlacement(component: Component): ResolvedPlacement | null {
        const width  = component.getWidth();
        const height = component.getHeight();

        // A child nobody has sized yet holds no rectangle to keep — `getWidth`
        // / `getHeight` still report the "never assigned" NaN seed. Committing
        // that reports a change on every pass, since `NaN !== NaN` is what
        // `commitBounds` compares, and so lays the child out for ever; its
        // placer's first commit lays it out instead. A NaN *position* with a
        // real size is still committed, exactly as `"preferred"` mode does it,
        // because `commitBounds` handles an unknown position itself.
        if (Number.isNaN(width) || Number.isNaN(height)) {
            return null;
        }

        return { component, x: component.getX(), y: component.getY(), width, height };
    }

    /**
     * Resolves `component`'s placement in `"preferred"` mode — its own position
     * at its preferred size, falling back to its current size, then to `0`.
     *
     * @param component - The child being placed.
     *
     * @returns The resolved placement.
     */
    private preferredPlacement(component: Component): ResolvedPlacement {
        const preferredSize = component.getPreferredSize();
        const size = component.getSize();

        const width = preferredSize?.width ?? size?.width ?? 0;
        const height = preferredSize?.height ?? size?.height ?? 0;

        return { component, x: component.getX(), y: component.getY(), width, height };
    }
}

const AbsoluteCallable = callable(Absolute);
type AbsoluteCallable = Absolute;
export {
    Absolute         as _Absolute,
    AbsoluteCallable as Absolute
};
