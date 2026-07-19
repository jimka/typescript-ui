// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TreeNode } from "~/component/tree/TreeNode.js";

/**
 * The bound-node state passed to a {@link TreeNodeRenderer} on every
 * `update()` call.
 *
 * @remarks
 * Renderers receive a fresh `TreeNodeRenderContext` whenever the owning pool
 * slot is mapped to a different node, or when the selection/expansion state of
 * the currently bound node changes.
 *
 * @category Components
 */
export interface TreeNodeRenderContext {

    /** The tree node being rendered. */
    node: TreeNode;

    /** Zero-based depth level (0 = root). */
    depth: number;

    /** True if the node is currently expanded. */
    expanded: boolean;

    /** True if the node is currently selected. */
    selected: boolean;

    /** True if the node has one or more children. */
    hasChildren: boolean;
}
