// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { TreeNodeRenderContext } from "~/component/tree/TreeNodeRenderContext.js";

/**
 * Abstract base class for tree node renderers.
 *
 * @remarks
 * A `TreeNodeRenderer` controls the content area of a single
 * [`TreeRow`](/api/component/tree/classes/TreeRow) — that is, everything to
 * the right of the expand/collapse toggle. The owning [`Tree`](/api/component/tree/classes/Tree)
 * holds a renderer factory; each pool slot calls that factory once at
 * construction and rebinds via {@link update} when the slot is remapped to a
 * different node or its selection/expansion state changes.
 *
 * The toggle remains under `TreeRow`'s control because click detection routes
 * through it; renderers never see toggle clicks.
 *
 * Subclasses must implement {@link update}, {@link getContentWidth}, and
 * {@link layoutChildren}. See [`LabelTreeNodeRenderer`](/api/component/tree/classes/LabelTreeNodeRenderer)
 * for the canonical default.
 *
 * @category Components
 */
export abstract class TreeNodeRenderer extends Component {

    constructor() {
        super();
    }

    /**
     * Rebinds this renderer to new node data.
     *
     * @param context - The bound-node state for this render pass.
     *
     * @remarks
     * Called every time the owning pool slot is mapped to a different node, or
     * when an expansion-state change forces a full re-bind. Plain selection
     * style changes (background highlight, focus ring) are handled by the
     * `Tree` directly on the row element and do not flow through `update()`.
     */
    abstract update(context: TreeNodeRenderContext): void;

    /**
     * Returns the natural pixel width this renderer would render at given the
     * current bound node.
     *
     * @returns Content width in pixels.
     *
     * @remarks
     * Used by [`Tree`](/api/component/tree/classes/Tree) to compute the
     * horizontal scroll extent. Renderers that auto-measure their children
     * should return the sum of those measured widths.
     */
    abstract getContentWidth(): number;

    /**
     * Positions this renderer's internal children inside its content box.
     *
     * @param width - The horizontal extent of the renderer in pixels.
     * @param height - The vertical extent of the renderer in pixels.
     *
     * @remarks
     * Called by `TreeRow.layoutChildren` after the renderer's own size has
     * been set via `setX`/`setY`/`setWidth`/`setHeight`.
     *
     * The `width` and `height` arguments are this renderer's **outer** box, so
     * an implementation must not place children against them directly: take the
     * rectangle from [`getContentBounds()`](/api/core/classes/Component), which
     * subtracts any border and padding the renderer carries, and fall back to
     * the arguments only when it returns `null` (no element yet). A child's
     * containing block is already this renderer's padding box, so one placed
     * at `(0, 0)` sized to `width` / `height` starts inside the border and
     * overruns the opposite edge by its width, where the `overflow: hidden`
     * every component carries clips it.
     */
    abstract layoutChildren(width: number, height: number): void;
}
