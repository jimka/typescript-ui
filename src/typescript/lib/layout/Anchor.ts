// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { AnchorConstraints } from "~/layout/AnchorConstraints.js";
import { callable } from "~/core/Callable.js";

/**
 * A length used by an {@link Anchor} constraint, expressed either in **pixels**
 * (a bare `number`) or as a **percentage** of the container's inner extent
 * (`{ percent }`, on a 0–100 scale). The percentage resolves against inner width
 * for horizontal fields (`left` / `right` / `width`) and inner height for
 * vertical fields (`top` / `bottom` / `height`).
 *
 * @category Layouts
 */
export type AnchorValue = number | { percent: number };

/**
 * Construction-time options for {@link Anchor}.
 *
 * @category Layouts
 */
export interface AnchorOptions extends LayoutManagerOptions {
}

/**
 * The resolved placement of a child along one axis: a `start` offset in the
 * container's coordinate space and the `extent` (width or height) to commit.
 */
interface AxisResult {
    start: number;
    extent: number;
}

/**
 * A resize-reactive layout manager that positions each child by edge-relative
 * and proportional offsets, re-resolving them on every `doLayout` pass so a
 * child stays pinned to a container edge — or stretched between two edges — as
 * the container resizes. It is the reactive counterpart to the static
 * [`Absolute`](/api/layout/classes/Absolute) manager, which never reads the
 * container's inner size.
 *
 * Per child (via {@link AnchorConstraints}) an axis can: pin a fixed distance
 * from one edge (`left` / `right` / `top` / `bottom`), derive its extent from
 * the container when both opposing edges are set (stretch), or take an explicit
 * `width` / `height`. Any offset or size may be a pixel `number` or an
 * {@link AnchorValue} percentage of the container's inner extent.
 *
 * Like `Absolute`, `Anchor` commits rects directly through `commitBounds`,
 * bypassing the cell clamp — a child sized larger than the container is
 * committed at its computed size and may overflow, which a host `Panel` with
 * `autoScroll: "auto"` scrolls natively. It imposes no intrinsic preferred,
 * min, or max size on its host.
 *
 * @category Layouts
 */
class Anchor extends LayoutManager {

    constructor(options?: AnchorOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Resolves an {@link AnchorValue} to pixels against the given extent.
     * Returns the number unchanged for a pixel value, `extent * percent / 100`
     * for a percentage tag, and `undefined` when the field is unset.
     *
     * @param value - The pixel-or-percent value, or `undefined` if unset.
     * @param extent - The container inner extent the percentage resolves against.
     * @returns The resolved pixel value, or `undefined` when `value` is unset.
     */
    private resolve(value: AnchorValue | undefined, extent: number): number | undefined {
        if (value === undefined) {
            return undefined;
        }

        if (typeof value === "number") {
            return value;
        }

        // Percent is on a 0–100 (CSS-style) scale, resolved against the inner extent.
        return extent * value.percent / 100;
    }

    /**
     * Resolves one axis's placement from its near edge, far edge, and explicit
     * size against the container inner extent, applying the precedence rules:
     * both edges stretch (size ignored); near edge pins the start; far edge pins
     * the end; neither edge falls back to the child's own start. The `origin`
     * (the inset on this axis) is added for every anchored row but **not** for
     * the no-edge fallback, matching {@link Absolute}, which commits the child's
     * own `getX` / `getY` without an inset offset.
     *
     * @param near - Resolved `left` / `top` offset, or `undefined` if unset.
     * @param far - Resolved `right` / `bottom` offset, or `undefined` if unset.
     * @param size - Resolved explicit `width` / `height`, or `undefined` if unset.
     * @param inner - The container's inner extent on this axis.
     * @param preferred - The child's preferred extent on this axis.
     * @param ownStart - The child's own `getX` / `getY` on this axis.
     * @param origin - The inset on this axis added to anchored placements.
     * @returns The `{ start, extent }` to commit on this axis.
     */
    private resolveAxis(near: number | undefined, far: number | undefined, size: number | undefined,
                        inner: number, preferred: number, ownStart: number, origin: number): AxisResult {
        if (near !== undefined && far !== undefined) {
            // Stretch between both edges; explicit size is ignored. Clamp the
            // derived extent at 0 so an over-constrained pair never goes negative.
            const extent = Math.max(0, inner - near - far);

            return { start: origin + near, extent };
        }

        const extent = size ?? preferred;

        if (near !== undefined) {
            return { start: origin + near, extent };
        }

        if (far !== undefined) {
            return { start: origin + inner - far - extent, extent };
        }

        // No edge constrained: keep the child's own position, like Absolute, and
        // do not add the inset origin so mixed Anchor/Absolute usage is consistent.
        return { start: ownStart, extent };
    }

    /**
     * Resolves each child's rect from its {@link AnchorConstraints} against the
     * container's current inner size and insets, then commits via the base
     * `commitBounds` (bypassing the cell clamp). Bails before the container
     * connects, when `getInnerSize` is still `null`.
     */
    doLayout(): void {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        const inner = container.getInnerSize();

        if (!inner) {
            return;
        }

        const insets = container.getContentInsets();
        const originX = insets.getLeft();
        const originY = insets.getTop();

        for (const component of container.getLaidOutComponents()) {
            const cons = this.getLayoutConstraints(component) as AnchorConstraints | undefined;

            const preferredSize = component.getPreferredSize();
            const size = component.getSize();
            const prefW = preferredSize?.width ?? size?.width ?? 0;
            const prefH = preferredSize?.height ?? size?.height ?? 0;

            const xAxis = this.resolveAxis(this.resolve(cons?.left, inner.width),
                this.resolve(cons?.right, inner.width), this.resolve(cons?.width, inner.width),
                inner.width, prefW, component.getX(), originX);

            const yAxis = this.resolveAxis(this.resolve(cons?.top, inner.height),
                this.resolve(cons?.bottom, inner.height), this.resolve(cons?.height, inner.height),
                inner.height, prefH, component.getY(), originY);

            this.commitBounds(component, xAxis.start, yAxis.start, xAxis.extent, yAxis.extent);
        }
    }
}

const AnchorCallable = callable(Anchor);
type AnchorCallable = Anchor;
export {
    Anchor         as _Anchor,
    AnchorCallable as Anchor
};
