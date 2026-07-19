// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { AnchorValue } from "~/layout/Anchor.js";

/**
 * Per-child layout constraints for components added to an {@link Anchor}
 * container. Each edge offset pins the child a fixed distance (pixels) or a
 * proportion ({@link AnchorValue} `{ percent }`, on a 0–100 scale) from that
 * side of the container's inner box; setting **both** opposing edges of an axis
 * stretches the child between them. `width` / `height` give an explicit extent
 * (pixels or percent) used when at most one edge of an axis is constrained.
 *
 * @remarks Each axis resolves independently from three inputs — the near edge,
 * the far edge, and the explicit size — against the container's inner extent
 * (post-insets) for that axis. When both edges of an axis are set, the explicit
 * size for that axis is ignored (the pair derives the extent), mirroring CSS
 * `position: absolute`. When neither edge of an axis is set, the child keeps its
 * own `getX` / `getY` on that axis, behaving like {@link Absolute} there, so an
 * application can anchor one axis and hand-place the other.
 *
 * Percentages resolve against the container's **inner** size (the same
 * coordinate space the committed rect lives in), not its border box.
 *
 * @category Layouts
 */
export class AnchorConstraints extends LayoutConstraints {

    /** Distance from the container's inner left edge to the child's left edge. */
    left?: AnchorValue;

    /** Distance from the container's inner right edge to the child's right edge. */
    right?: AnchorValue;

    /** Distance from the container's inner top edge to the child's top edge. */
    top?: AnchorValue;

    /** Distance from the container's inner bottom edge to the child's bottom edge. */
    bottom?: AnchorValue;

    /**
     * Explicit width; used when at most one horizontal edge is constrained.
     * Ignored when both {@link AnchorConstraints.left} and
     * {@link AnchorConstraints.right} are set (the pair derives the width).
     */
    width?: AnchorValue;

    /**
     * Explicit height; used when at most one vertical edge is constrained.
     * Ignored when both {@link AnchorConstraints.top} and
     * {@link AnchorConstraints.bottom} are set (the pair derives the height).
     */
    height?: AnchorValue;

    constructor() {
        super();
    }
}
