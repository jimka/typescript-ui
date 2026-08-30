// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Util } from "~/core/Util.js";
import type { Rect } from "~/core/DOM.js";
import type { Size } from "~/primitive/Size.js";
import type { AxisOrientation } from "~/primitive/Axis.js";

/**
 * Options controlling how {@link positionAnchored} places an element against an
 * anchor rect.
 *
 * @category Core
 */
interface AnchorOptions {
    /** Primary growth axis: `"vertical"` grows below/above, `"horizontal"` right/left. */
    axis:    AxisOrientation;
    /** Gap in px between the anchor edge and the element on the primary axis. Default 0. */
    gap?:    number;
    /** Viewport-edge margin in px kept on the cross axis. Default 0. */
    margin?: number;
}

/**
 * Chooses a top-left coordinate on the primary axis. Prefers growing past the
 * anchor's far edge (`farEdge + gap`); flips to the near edge
 * (`nearEdge - extent - gap`) only when the far side lacks room AND the near
 * side has it. When neither side fits, saturates on-screen toward the side with
 * more room — pinned to the viewport's far end when the far side is roomier,
 * otherwise to `0` — so the element never overflows off-screen.
 *
 * @param nearEdge - The anchor's near edge (top / left) on this axis.
 * @param farEdge - The anchor's far edge (bottom / right) on this axis.
 * @param extent - The element's size on this axis.
 * @param viewportExtent - The viewport's size on this axis.
 * @param gap - Gap in px kept between the anchor edge and the element.
 * @returns The chosen top-left coordinate on this axis.
 *
 * @category Core
 */
export function positionAdjacent(nearEdge: number, farEdge: number, extent: number, viewportExtent: number, gap: number): number {
    const farStart  = farEdge + gap;
    const spaceFar  = viewportExtent - farStart;
    const spaceNear = nearEdge - gap;

    if (extent <= spaceFar) {
        return farStart;
    }

    if (extent <= spaceNear) {
        return nearEdge - extent - gap;
    }

    // Neither side fits: pin to whichever side has more room, saturated so the
    // element stays on-screen (mirrors placeAnchored's spaceBelow/spaceAbove
    // fallback, axis-agnostic).
    if (spaceFar >= spaceNear) {
        return Math.max(0, viewportExtent - extent);
    }

    return 0;
}

/**
 * Chooses a top-left coordinate on the cross axis for a **fixed-size** element
 * that ALIGNS WITH (and overlaps) its anchor rather than sitting beside it.
 * Prefers the element's near edge flush with the anchor's near edge
 * (`nearEdge`); flips to the element's FAR edge flush with the anchor's far
 * edge (`farEdge - extent`) only when the near alignment overflows the
 * viewport. This is alignment, not adjacency — the element overlaps the
 * anchor either way; only which pair of edges is made flush changes. It is
 * fixed-size and returns no `available` (contrast {@link
 * positionFlexibleAnchored}); `margin` binds on **this** axis. When neither
 * alignment fits on-screen (an anchor whose own far edge is off-viewport, or
 * an element wider than the viewport), falls back to {@link clampAxis} — the
 * right answer when no placement fits, not a flip substitute.
 *
 * @param nearEdge - The anchor's near edge (left / top) on this axis.
 * @param farEdge - The anchor's far edge (right / bottom) on this axis.
 * @param extent - The element's fixed size on this axis.
 * @param viewportExtent - The viewport's size on this axis.
 * @param margin - Viewport-edge margin in px kept on this axis.
 * @returns The chosen top-left coordinate on this axis.
 *
 * @category Core
 */
export function positionAligned(
    nearEdge: number, farEdge: number, extent: number, viewportExtent: number, margin: number,
): number {
    // Preferred: the element's near edge aligns with the anchor's near edge.
    if (nearEdge >= margin && nearEdge + extent <= viewportExtent - margin) {
        return nearEdge;
    }

    // Flipped: the element's FAR edge aligns with the anchor's far edge. Note this
    // is alignment, not adjacency — the element overlaps the anchor either way; only
    // which pair of edges is made flush changes.
    const farStart = farEdge - extent;

    if (farStart >= margin && farStart + extent <= viewportExtent - margin) {
        return farStart;
    }

    // Neither alignment fits on-screen (an anchor whose own far edge is off-viewport,
    // or an element wider than the viewport): fall back to the clamp. Clamping is the
    // right answer when NO placement fits — it is only wrong as a substitute for a flip.
    return clampAxis(nearEdge, extent, viewportExtent, margin);
}

/**
 * Clamps a top-left coordinate into `[margin, extent - size - margin]`, pinning
 * to `margin` (top-aligned) when the element is larger than the available span
 * so the coordinate never goes below `margin` and off-screen. The upper bound is
 * floored to `margin` before clamping, because `Util.clamp` resolves a `min >
 * max` range to the max — the opposite of the `Math.max(margin, Math.min(...))`
 * this replaces; flooring keeps `min <= max`, so an over-large element pins to
 * `margin` and the caller's height-cap / scroll carries the overflow.
 *
 * @param value - The proposed coordinate.
 * @param size - The element's extent on this axis.
 * @param extent - The viewport's extent on this axis.
 * @param margin - Viewport-edge margin kept on this axis.
 * @returns The clamped coordinate.
 */
function clampAxis(value: number, size: number, extent: number, margin: number): number {
    return Util.clamp(value, margin, Math.max(margin, extent - size - margin));
}

/**
 * The chosen coordinate for a size-flexible anchored element, plus the room
 * available on the side it landed on.
 *
 * @category Core
 */
interface FlexiblePlacement {
    /** Top-left coordinate on the primary axis. */
    start:     number;
    /** Room (px) on the side actually chosen — the caller's height/width cap. */
    available: number;
}

/**
 * Chooses a top-left coordinate on the primary axis for a **size-flexible**
 * element — one whose extent may be capped and the overflow scrolled, rather
 * than being placed at a fixed size. Grows from `farEdge`; flips to end at
 * `nearEdge` only when the content overflows the far room **and** the near
 * side is roomier. Unlike {@link positionAdjacent}, the far-fits check is against the
 * *room*, not the raw `extent` — so a flip that still doesn't fully fit on
 * the near side still flips (and clamps) rather than falling back to filling
 * the viewport over the anchor. The returned `available` is the room on the
 * chosen side, so a caller that caps the extent measures the correct side —
 * re-deriving it from `start` would measure the wrong side for a flipped
 * element. `viewportMargin` binds on **this** (primary) axis, unlike
 * {@link positionAnchored}'s cross-axis-only `margin`. Always flush against
 * the anchor edge — no `gap` parameter, because every current caller sits
 * flush.
 *
 * @param nearEdge - The anchor's near edge (top / left) on this axis — the
 *   edge a flipped element's far edge meets.
 * @param farEdge - The anchor's far edge (bottom / right) on this axis — the
 *   edge an unflipped element grows from.
 * @param extent - The element's unclamped preferred size on this axis.
 * @param viewportExtent - The viewport's size on this axis.
 * @param viewportMargin - Viewport-edge margin in px kept on this axis.
 * @returns The chosen coordinate and the room available at it.
 *
 * @category Core
 */
export function positionFlexibleAnchored(
    nearEdge:       number,
    farEdge:        number,
    extent:         number,
    viewportExtent: number,
    viewportMargin: number,
): FlexiblePlacement {
    const roomFar  = viewportExtent - farEdge - viewportMargin;
    const roomNear = nearEdge - viewportMargin;

    if (extent <= roomFar || roomFar >= roomNear) {
        return { start: farEdge, available: roomFar };
    }

    return { start: nearEdge - Math.min(extent, roomNear), available: roomNear };
}

/**
 * The chosen coordinate for a size-flexible anchored element, plus the room
 * available on the vertical side it landed on.
 *
 * @category Core
 */
export interface AnchoredFlexiblePlacement {
    x:         number;
    y:         number;
    /** Room (px) on the vertical side the element landed on — the caller's height cap. */
    available: number;
}

/**
 * Places a **size-flexible** element against `anchorRect` inside `viewport`:
 * {@link positionFlexibleAnchored} on the vertical axis (grows below, flips
 * above when the room below is short and above is roomier, and reports the
 * room at the chosen side) composed with {@link positionAligned} on the
 * horizontal axis (aligns to the anchor's left edge, flipping to the right
 * edge when that overflows). This is the placement every content-sized panel
 * anchored under a trigger needs — a fixed-size panel that only wants a
 * coordinate should use {@link positionAnchored} instead.
 *
 * @param anchorRect - The anchor element's bounding rect.
 * @param size - The element's unclamped preferred width/height.
 * @param viewport - The viewport size to clamp/flip within.
 * @param margin - Viewport-edge margin in px, applied on both axes.
 * @returns The resolved top-left `{ x, y }` plus the room available at the
 *   chosen vertical side.
 *
 * @category Core
 */
export function positionAnchoredFlexible(
    anchorRect: Rect,
    size:       Size,
    viewport:   Size,
    margin:     number,
): AnchoredFlexiblePlacement {
    const v = positionFlexibleAnchored(anchorRect.top, anchorRect.bottom, size.height, viewport.height, margin);
    const x = positionAligned(anchorRect.left, anchorRect.right, size.width, viewport.width, margin);

    // `available` is the room on the side the panel actually landed on — never
    // re-derive it from `v.start`, which measures the wrong side after a flip.
    return { x, y: v.start, available: v.available };
}

/**
 * Places an element of `size` against `anchorRect` inside `viewport`. On the
 * primary axis it grows past the anchor's far edge (below / right), flipping to
 * the near edge (above / left) only when the far side lacks room AND the near
 * side has more; on the cross axis it aligns to the anchor's near edge,
 * flipping to align with the anchor's far edge when the near alignment
 * overflows, and clamping only when neither alignment fits. Pure — all
 * viewport reads are supplied by the caller, so it is directly unit-testable
 * with no DOM.
 *
 * @param anchorRect - The anchor element's bounding rect.
 * @param size - The element's width/height to place.
 * @param viewport - The viewport size to clamp/flip within.
 * @param opts - Axis, gap, and cross-axis margin.
 * @returns The resolved top-left `{ x, y }` for the element.
 *
 * @category Core
 */
export function positionAnchored(anchorRect: Rect, size: Size, viewport: Size, opts: AnchorOptions): { x: number; y: number } {
    const gap    = opts.gap    ?? 0;
    const margin = opts.margin ?? 0;

    if (opts.axis === "vertical") {
        const y = positionAdjacent(anchorRect.top, anchorRect.bottom, size.height, viewport.height, gap);
        const x = positionAligned(anchorRect.left, anchorRect.right, size.width, viewport.width, margin);

        return { x, y };
    }

    const x = positionAdjacent(anchorRect.left, anchorRect.right, size.width, viewport.width, gap);
    const y = positionAligned(anchorRect.top, anchorRect.bottom, size.height, viewport.height, margin);

    return { x, y };
}
