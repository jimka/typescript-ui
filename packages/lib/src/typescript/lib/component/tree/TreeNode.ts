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
     * @remarks Omit or pass an empty array for leaf nodes. Once the node is in
     * a tree, change this list through {@link Tree.setChildren},
     * {@link Tree.insertNode} or {@link Tree.removeNode} rather than by
     * assignment, so the tree keeps its rows and state in step.
     */
    children?: TreeNode[];

    /**
     * Marks the node as expandable before its children have loaded, so it
     * renders a caret while collapsed. Pair with {@link loadChildren} for a
     * lazily loaded node.
     */
    hasChildren?: boolean;

    /**
     * Supplies this node's children the first time the tree needs them: on
     * first expansion, or when {@link Tree.revealByPredicate} searches beneath
     * the node. The resolved array is written to `children` and cached so
     * later expand/collapse cycles do not refetch. Only a rejection counts as
     * a failure: a resolved `null` or `undefined` — which an untyped caller
     * can hand back where this signature promises an array — is a resolve
     * with no children, and loads the node with an empty one. A rejection
     * leaves the node collapsed and unloaded so the user can retry by
     * toggling again.
     *
     * @returns A promise resolving to this node's child {@link TreeNode} array.
     *
     * @remarks
     * The tree calls this only while the node has no children and has not
     * loaded, and never while it is still waiting on an earlier call for the
     * node: every expand and reveal that needs the children meanwhile waits
     * on that one call. So it is called again only after a call rejected, or
     * once the tree has dropped the node — {@link Tree.removeNode} or
     * {@link Tree.setChildren} took it or an ancestor out, or
     * {@link Tree.setNodes} replaced every node — and holds it again with no
     * children. A call still in flight when the node was dropped, or when
     * {@link Tree.insertNode}, {@link Tree.removeNode} or
     * {@link Tree.setChildren} changed its children, is discarded: its result
     * is never committed, and the next call can start while it is still
     * pending, so a loader must not assume its calls for one node never
     * overlap. The tree does still hold whatever is waiting on a discarded
     * call until it settles, so a loader that never settles leaves those
     * callers pending. Calling back into the tree from inside the loader —
     * to set a placeholder, say — counts as any other change to the node.
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
