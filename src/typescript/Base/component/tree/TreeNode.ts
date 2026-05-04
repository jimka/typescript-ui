// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * A node in a hierarchical tree data structure.
 *
 * Pass an array of `TreeNode` objects to {@link Tree.setNodes} to populate the tree.
 * Nodes with a non-empty `children` array render as expandable parents; nodes
 * without children (or with an empty array) render as leaves.
 */
export interface TreeNode {

    /** The text label displayed for this node. */
    label: string;

    /**
     * Child nodes nested under this node.
     *
     * @remarks Omit or pass an empty array for leaf nodes.
     */
    children?: TreeNode[];
}
