// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * A node in a hierarchical tree data structure.
 *
 * Pass an array of `TreeNode` objects to {@link Tree.setNodes} to populate the tree.
 * Nodes with a non-empty `children` array render as expandable parents; nodes
 * without children (or with an empty array) render as leaves.
 *
 * @remarks
 * A node can also be declared **lazy**: set `hasChildren` to `true` (so it
 * renders an expandable caret before its children exist) and supply a
 * `loadChildren` function. On first expansion the tree shows a loading
 * affordance, awaits `loadChildren`, populates `children`, then re-renders.
 *
 * @category Components
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

    /**
     * Marks the node as expandable before its children have loaded, so it
     * renders a caret while collapsed. Pair with {@link loadChildren} for a
     * lazily loaded node.
     */
    hasChildren?: boolean;

    /**
     * Supplies this node's children on first expansion. Invoked once; the
     * resolved array is written to `children` and cached so later
     * expand/collapse cycles do not refetch. A rejection leaves the node
     * collapsed and unloaded so the user can retry by toggling again.
     *
     * @returns A promise resolving to this node's child {@link TreeNode} array.
     */
    loadChildren?: () => Promise<TreeNode[]>;

    /**
     * Optional caller-supplied payload attached to this node.
     *
     * @remarks
     * The tree treats this value as opaque: it is never read, rendered, or used
     * to establish node identity or deduplicate nodes. Attach any domain object
     * here and read it back, unchanged, from a node the tree hands you — via
     * {@link Tree.getSelectedNode}, {@link Tree.getSelectedNodes}, the
     * `"selection"` event, or the `"loaderror"` event. Typed as `unknown` so the
     * cast stays explicit at the read site; the tree itself stays payload-agnostic.
     */
    data?: unknown;
}
