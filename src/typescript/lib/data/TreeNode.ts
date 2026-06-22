// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';
import type { TreeStore } from '~/data/TreeStore.js';

/**
 * A node in a {@link TreeStore}'s hierarchy: a thin structural wrapper around a
 * {@link ModelRecord}, carrying parent/child links, depth, and leaf state. The
 * synthetic root has a null record and depth -1.
 *
 * @remarks
 * Distinct from the unrelated component-layer
 * [`TreeNode`](/api/component/tree/interfaces/TreeNode), which is a `label`/
 * `children` POJO consumed by the `Tree` widget. This data-layer `TreeNode`
 * references a real {@link ModelRecord} and is produced by a {@link TreeStore}
 * as it indexes its flat record set into a hierarchy.
 *
 * Node fields are owned by the store: it builds the wrappers during its index
 * rebuild, and expansion is read live from the store (keyed by record id) so a
 * reload that swaps record instances preserves expansion. Mutate expansion
 * through the store ({@link TreeStore.expand} / {@link TreeStore.collapse}),
 * never by poking node fields.
 *
 * @category Data
 */
export class TreeNode {

    private _store:    TreeStore;
    private _record:   ModelRecord | null;
    private _parent:   TreeNode | null;
    private _children: TreeNode[] = [];
    private _depth:    number;
    private _leaf:     boolean = false;
    private _loaded:   boolean = true;

    /**
     * Constructs a tree node wrapping a record. Called by {@link TreeStore}
     * during its index rebuild; consumers obtain nodes through the store's
     * traversal API rather than constructing them directly.
     *
     * @param store - The owning store, consulted for live expansion state.
     * @param record - The wrapped record, or null for the synthetic root.
     * @param parent - The parent node, or null for the synthetic root.
     * @param depth - The nesting depth; -1 for the synthetic root, 0 for visible roots.
     */
    constructor(store: TreeStore, record: ModelRecord | null, parent: TreeNode | null, depth: number) {
        this._store  = store;
        this._record = record;
        this._parent = parent;
        this._depth  = depth;
    }

    /**
     * Returns the wrapped record, or null for the synthetic root.
     *
     * @returns The {@link ModelRecord} this node represents, or null for the root.
     */
    getRecord(): ModelRecord | null {
        return this._record;
    }

    /**
     * Returns this node's id — the value at the store's id field.
     *
     * @returns The record's id, or undefined for the synthetic root.
     */
    getId(): any {
        return this._record ? this._record.get(this._store.getIdField()) : undefined;
    }

    /**
     * Returns the parent node, or null for the synthetic root.
     *
     * @returns The parent {@link TreeNode}, or null at the top of the tree.
     */
    getParent(): TreeNode | null {
        return this._parent;
    }

    /**
     * Returns this node's resolved child nodes.
     *
     * @returns The child {@link TreeNode}s; empty until loaded for a lazy node.
     */
    getChildren(): TreeNode[] {
        return this._children;
    }

    /**
     * Returns this node's nesting depth.
     *
     * @returns 0 for a visible root, increasing per level; -1 for the synthetic root.
     */
    getDepth(): number {
        return this._depth;
    }

    /**
     * Returns whether this node is currently expanded.
     *
     * @returns True when the store's expansion set holds this node's id; a live
     *   view of store state, not independent flag.
     */
    isExpanded(): boolean {
        return this._store.isExpanded(this);
    }

    /**
     * Returns whether this node is a leaf (renders no expand caret).
     *
     * @returns True when leaf-determination resolved this node as childless.
     */
    isLeaf(): boolean {
        return this._leaf;
    }

    /**
     * Returns whether this node's children have been fetched.
     *
     * @returns True once children are loaded; always true for eager nodes.
     */
    isLoaded(): boolean {
        return this._loaded;
    }

    /**
     * Sets the resolved child nodes. Store-internal: called during the index
     * rebuild.
     *
     * @param children - The child nodes to attach.
     */
    setChildren(children: TreeNode[]): void {
        this._children = children;
    }

    /**
     * Sets the leaf flag. Store-internal: called during the index rebuild once
     * leaf determination resolves.
     *
     * @param leaf - Whether this node is a leaf.
     */
    setLeaf(leaf: boolean): void {
        this._leaf = leaf;
    }

    /**
     * Sets the loaded flag. Store-internal: cleared for a lazy branch awaiting
     * its first fetch, set once children arrive.
     *
     * @param loaded - Whether this node's children have been fetched.
     */
    setLoaded(loaded: boolean): void {
        this._loaded = loaded;
    }
}
