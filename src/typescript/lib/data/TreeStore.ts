// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Model } from '~/data/Model.js';
import { Proxy, ReadParams } from '~/data/proxy/Proxy.js';
import { ModelRecord } from '~/data/ModelRecord.js';
import { AbstractStore, StoreEvent, StoreListener } from '~/data/AbstractStore.js';
import { StoreOptions } from '~/data/Store.js';
import { TreeNode } from '~/data/TreeNode.js';

/**
 * Names of the tree-structure events fired by {@link TreeStore}, in addition to
 * the inherited {@link StoreEvent}s.
 *
 * @category Data
 */
export type TreeStoreEvent = 'expand' | 'collapse' | 'append' | 'removenode';

/**
 * Payload for the `'expand'` event, carrying the node that was expanded.
 *
 * @category Data
 */
export interface TreeExpandEvent {
    node: TreeNode;
}

/**
 * Payload for the `'collapse'` event, carrying the node that was collapsed.
 *
 * @category Data
 */
export interface TreeCollapseEvent {
    node: TreeNode;
}

/**
 * Payload for the `'append'` event, carrying the parent and the nodes appended
 * under it (after a lazy load or nested-eager ingest).
 *
 * @category Data
 */
export interface TreeAppendEvent {
    parent: TreeNode;
    nodes:  TreeNode[];
}

/**
 * Payload for the `'removenode'` event, carrying the node whose subtree was
 * removed.
 *
 * @category Data
 */
export interface TreeRemoveEvent {
    node: TreeNode;
}

/**
 * Construction-time options for a {@link TreeStore}.
 *
 * @category Data
 */
export interface TreeStoreOptions extends StoreOptions {
    /** Field carrying each record's id (the join key). Defaults to the model primary key. */
    idField?:          string;
    /** Field carrying each record's parent id; null/unresolved means root. Required. */
    parentField:       string;
    /** Boolean field declaring a record a leaf (no caret). Optional. */
    leafField?:        string;
    /** Boolean field hinting a lazy node has server-side children. Optional. */
    hasChildrenField?: string;
    /** Raw-payload key holding an embedded child array for nested eager loads. Optional. */
    childrenKey?:      string;
}

/**
 * A store that manages records arranged in a parent/child hierarchy. Each
 * record names its parent's id via {@link TreeStoreOptions.parentField}; roots
 * carry `null` (or an unresolved parent id, treated as a root). Over that flat
 * record set the store layers a navigable node index, a synthetic root, and a
 * flattened "visible nodes" view kept in sync with per-node expansion.
 *
 * @remarks
 * Extends {@link AbstractStore}, reusing model/proxy wiring, the
 * `allRecords`/`records` discipline, CRUD, sync, sort, filter, and the
 * `on`/`off`/`emit` event surface. Tree structure is a pure function of the
 * flat records, rebuilt whenever the view changes via an overridden
 * `applyView()`. The hierarchy encoding matches
 * [`TreeBody`](/api/component/table/classes/TreeBody), so a `TreeStore` is
 * drop-in compatible with it.
 *
 * **Eager** trees hydrate the whole hierarchy from a flat (or, with
 * `childrenKey`, nested) payload. **Lazy** trees load a node's children on
 * first {@link expand} through the proxy, scoped by a parent-id filter.
 *
 * Pagination is inherited but unsupported for trees — it would paginate the
 * flat set and break the hierarchy.
 *
 * @category Data
 */
export class TreeStore extends AbstractStore {

    readonly model: Model;
    readonly proxy: Proxy | undefined;

    private _idField:      string;
    private _parentField:  string;
    private _leafField:    string | undefined;
    private _hasChildrenField: string | undefined;
    private _childrenKey:  string | undefined;

    private _root:         TreeNode;
    private _nodesById:    Map<any, TreeNode>       = new Map();
    private _childRecords: Map<any, ModelRecord[]>  = new Map();
    private _expandedIds:  Set<any>                 = new Set();
    private _loadingIds:   Set<any>                 = new Set();
    private _loadedIds:    Set<any>                 = new Set();
    private _visibleNodes: TreeNode[]               = [];

    /**
     * Constructs a tree store from a {@link TreeStoreOptions} bag. The tree
     * config (id/parent fields, synthetic root) is assigned before
     * `applyOptions` runs so an `autoLoad: true` rebuild sees it in place.
     *
     * @param treeOptions - The model, optional proxy, and tree-field configuration.
     */
    constructor(treeOptions: TreeStoreOptions) {
        super();

        this.model = treeOptions.model;
        this.proxy = treeOptions.proxy;

        this._parentField      = treeOptions.parentField;
        this._idField          = treeOptions.idField ?? this.model.getPrimaryKeyField()?.getName() ?? 'id';
        this._leafField        = treeOptions.leafField;
        this._hasChildrenField = treeOptions.hasChildrenField;
        this._childrenKey      = treeOptions.childrenKey;

        this._root = new TreeNode(this, null, null, -1);

        this.applyOptions(treeOptions);
    }

    /**
     * Returns the field name carrying each record's id.
     *
     * @returns The id field — the configured `idField`, else the model primary key.
     */
    getIdField(): string {
        return this._idField;
    }

    /**
     * Returns the field name carrying each record's parent id.
     *
     * @returns The configured `parentField`.
     */
    getParentField(): string {
        return this._parentField;
    }

    // ── View rebuild ───────────────────────────────────────────────────────────

    /**
     * Loads raw data, flattening any nested `childrenKey` arrays into the flat
     * record set first when `childrenKey` is configured.
     *
     * @param data - The raw payload; may carry embedded child arrays when
     *   `childrenKey` is set.
     *
     * @remarks
     * Overrides {@link AbstractStore.loadData} so a nested eager payload
     * (`[{ id: 1, children: [{ id: 2 }] }]`) is flattened — each child gets its
     * enclosing node's id stamped into `parentField` — before the base ingest.
     */
    override loadData(data: any[]): void {
        super.loadData(this._childrenKey ? this.flattenNested(data) : data);
    }

    /**
     * Rebuilds the node index and the flattened visible view after the base
     * recomputes its filtered/sorted record view.
     *
     * @returns A promise that resolves once the view and node index are rebuilt.
     *
     * @remarks
     * The in-process base path sets the record view synchronously before
     * returning, so the rebuild runs synchronously here (letting
     * `loadData`/`add`/`remove` callers read the tree immediately) and again on
     * the returned promise's settle, which covers the worker-offload path that
     * updates the record view only inside its own `.then`.
     */
    protected override applyView(): Promise<void> {
        const settled = super.applyView();

        // Sync path: the base has already set its record view, so rebuild now
        // (idempotently) — a synchronous loadData/add caller reads a fresh tree.
        this.rebuildNodeIndex();
        this.flatten();

        // Worker path: the record view updates inside the returned promise's
        // .then, so rebuild again once it settles.
        return settled.then(() => {
            this.rebuildNodeIndex();
            this.flatten();
        });
    }

    /**
     * Recursively flattens a nested payload into a flat array, stamping each
     * embedded child's parent-id raw key from its enclosing node's id.
     *
     * @param data - The (possibly nested) raw payload.
     *
     * @returns A flat array of raw records with the parent-id key populated.
     *
     * @remarks
     * Operates on the *raw* payload before `createRecord`, so it reads and
     * writes the fields' raw mapping keys ({@link Field.getMapping}), not their
     * model names — keeping nested loads correct when a model maps an id/parent
     * field to a different raw key. Falls back to the configured field name when
     * the model declares no such field.
     */
    private flattenNested(data: any[]): any[] {
        const idKey     = this.model.getField(this._idField)?.getMapping() ?? this._idField;
        const parentKey = this.model.getField(this._parentField)?.getMapping() ?? this._parentField;

        const flat: any[] = [];

        const walk = (nodes: any[], parentId: any): void => {
            for (const node of nodes) {
                const children = node[this._childrenKey!];
                const rest     = { ...node };

                delete rest[this._childrenKey!];

                if (parentId != null && rest[parentKey] == null) {
                    rest[parentKey] = parentId;
                }

                flat.push(rest);

                if (Array.isArray(children) && children.length > 0) {
                    walk(children, rest[idKey]);
                }
            }
        };

        walk(data, null);

        return flat;
    }

    /**
     * Rebuilds `_childRecords` and `_nodesById` from the current record view,
     * then builds the node tree under the synthetic root.
     *
     * @remarks
     * Records whose parent id is null or does not resolve to a known record are
     * treated as roots (orphan fallback), matching `TreeBody`.
     */
    private rebuildNodeIndex(): void {
        const records = this.getRecords();

        this.bucketChildRecords(records);
        this._nodesById.clear();
        this._root.setChildren(this.buildChildNodes(null, this._root, 0));
    }

    /**
     * Buckets the records by parent id into `_childRecords`. Roots (null or
     * unresolved parent) land under the `null` key.
     *
     * @param records - The current record view.
     */
    private bucketChildRecords(records: ModelRecord[]): void {
        this._childRecords.clear();

        const byId = new Set<any>();

        for (const record of records) {
            byId.add(record.get(this._idField));
        }

        for (const record of records) {
            const parentId = record.get(this._parentField);
            const key      = parentId != null && byId.has(parentId) ? parentId : null;
            const list     = this._childRecords.get(key);

            if (list) {
                list.push(record);
            } else {
                this._childRecords.set(key, [record]);
            }
        }
    }

    /**
     * Builds the {@link TreeNode} wrappers for the children of one parent id,
     * recursing into each so the whole subtree is constructed.
     *
     * @param parentId - The parent id whose child records to wrap; null for roots.
     * @param parentNode - The parent node the built nodes attach under.
     * @param depth - The depth to assign the built nodes.
     *
     * @returns The child nodes, each with its own children and leaf flag resolved.
     */
    private buildChildNodes(parentId: any, parentNode: TreeNode, depth: number): TreeNode[] {
        const records = this._childRecords.get(parentId) ?? [];

        return records.map(record => {
            const id   = record.get(this._idField);
            const node = new TreeNode(this, record, parentNode, depth);

            node.setLeaf(this.resolveLeaf(record, id));
            node.setLoaded(this.resolveLoaded(id));
            this._nodesById.set(id, node);
            node.setChildren(this.buildChildNodes(id, node, depth + 1));

            return node;
        });
    }

    /**
     * Resolves whether a node's children are considered loaded. Eager nodes are
     * always loaded; a lazy branch (declared via `hasChildrenField`) is unloaded
     * until its first fetch records the id in `_loadedIds`.
     *
     * @param id - The node's id.
     *
     * @returns True when the node's children are present or it is not a lazy branch.
     */
    private resolveLoaded(id: any): boolean {
        if (!this._hasChildrenField || this._loadedIds.has(id)) {
            return true;
        }

        const children = this._childRecords.get(id);

        return !!children && children.length > 0;
    }

    /**
     * Resolves whether a record is a leaf, in priority order: explicit
     * `leafField`, then `hasChildrenField` (a lazy branch hint), then the
     * default "has no child records in the current set".
     *
     * @param record - The record to classify.
     * @param id - The record's id, used for the default child-count check.
     *
     * @returns True when the node should render as a leaf (no expand caret).
     */
    private resolveLeaf(record: ModelRecord, id: any): boolean {
        if (this._leafField) {
            return record.get(this._leafField) === true;
        }

        if (this._hasChildrenField) {
            return record.get(this._hasChildrenField) !== true;
        }

        const children = this._childRecords.get(id);

        return !children || children.length === 0;
    }

    /**
     * Rebuilds `_visibleNodes` by a depth-first walk from the synthetic root's
     * children, recursing into a node only when it is expanded.
     */
    private flatten(): void {
        const visible: TreeNode[] = [];

        const recurse = (nodes: TreeNode[]): void => {
            for (const node of nodes) {
                visible.push(node);

                if (this._expandedIds.has(node.getId())) {
                    recurse(node.getChildren());
                }
            }
        };

        recurse(this._root.getChildren());

        this._visibleNodes = visible;
    }

    // ── Traversal ──────────────────────────────────────────────────────────────

    /**
     * Returns the synthetic root node — the traversal anchor whose children are
     * the real root records.
     *
     * @returns The synthetic root ({@link TreeNode} with a null record, depth -1).
     */
    getRootNode(): TreeNode {
        return this._root;
    }

    /**
     * Returns the node wrapping the record with the given id.
     *
     * @param id - The id (value at the id field) to look up.
     *
     * @returns The matching {@link TreeNode}, or undefined when no record has that id.
     */
    getNodeById(id: any): TreeNode | undefined {
        return this._nodesById.get(id);
    }

    /**
     * Returns the node wrapping the given record.
     *
     * @param record - The record to find a node for.
     *
     * @returns The matching {@link TreeNode}, or undefined when the record is not in the tree.
     */
    getNodeForRecord(record: ModelRecord): TreeNode | undefined {
        return this._nodesById.get(record.get(this._idField));
    }

    /**
     * Returns a node's resolved children.
     *
     * @param node - The node whose children to read.
     *
     * @returns The child {@link TreeNode}s; empty for a leaf or an unloaded lazy node.
     */
    getChildren(node: TreeNode): TreeNode[] {
        return node.getChildren();
    }

    /**
     * Returns a node's parent.
     *
     * @param node - The node whose parent to read.
     *
     * @returns The parent {@link TreeNode}, or null for a root.
     */
    getParent(node: TreeNode): TreeNode | null {
        return node.getParent();
    }

    /**
     * Returns a node's nesting depth.
     *
     * @param node - The node whose depth to read.
     *
     * @returns 0 for a visible root, increasing per level; -1 for the synthetic root.
     */
    getDepth(node: TreeNode): number {
        return node.getDepth();
    }

    /**
     * Invokes a callback for every node in depth-first order over the whole tree
     * (regardless of expansion), excluding the synthetic root.
     *
     * @param fn - The callback applied to each node.
     *
     * @remarks
     * Named `eachNode` (not `each`) to avoid clashing with the inherited
     * {@link AbstractStore.each}, which iterates the flat record view.
     */
    eachNode(fn: (node: TreeNode) => void): void {
        const recurse = (nodes: TreeNode[]): void => {
            for (const node of nodes) {
                fn(node);
                recurse(node.getChildren());
            }
        };

        recurse(this._root.getChildren());
    }

    // ── Visible (flattened) view ─────────────────────────────────────────────────

    /**
     * Returns the depth-ordered, expansion-respecting list of visible nodes —
     * the input a virtualized list renders.
     *
     * @returns A copy of the visible-node list.
     */
    getVisibleNodes(): TreeNode[] {
        return this._visibleNodes.slice();
    }

    /**
     * Returns the number of currently visible nodes.
     *
     * @returns The visible-node count.
     */
    getVisibleCount(): number {
        return this._visibleNodes.length;
    }

    // ── Expansion ──────────────────────────────────────────────────────────────

    /**
     * Expands a node, lazy-loading its children first when it is an unloaded
     * branch with a proxy.
     *
     * @param node - The node to expand.
     *
     * @returns A promise that resolves once the node is expanded (and any lazy
     *   load has settled).
     *
     * @remarks
     * No-op when the node is already expanded, is a leaf, or (for a lazy load)
     * has no id to scope the fetch. A lazy load fires `'append'` once children
     * are ingested, then `'expand'`. Concurrent expands of the same node are
     * de-duplicated, so an expand while a load is in flight is a no-op.
     */
    async expand(node: TreeNode): Promise<void> {
        const id = node.getId();

        if (this._expandedIds.has(id) || node.isLeaf()) {
            return;
        }

        if (!node.isLoaded() && this.proxy) {
            const loaded = await this.loadChildren(id);

            if (!loaded) {
                return;
            }
        }

        this._expandedIds.add(id);
        this.flatten();
        this.emit('expand', { node });
    }

    /**
     * Loads a node's children through the proxy, scoped to records whose parent
     * id equals the given id, then appends them and re-resolves the node.
     *
     * @param id - The node's id; the load is skipped when undefined.
     *
     * @returns A promise resolving to true once children are loaded (or the load
     *   was a de-duplicated/idless no-op the caller should abort on — false).
     */
    private async loadChildren(id: any): Promise<boolean> {
        if (id == null || this._loadingIds.has(id)) {
            return false;
        }

        this._loadingIds.add(id);

        try {
            const params: ReadParams = { filters: [{ type: 'eq', field: this._parentField, value: id }] };
            const raw = await this.proxy!.read(params);

            // Record loaded-ness before the append rebuilds nodes, so the fresh
            // node resolves as loaded (the rebuild discards the old instance).
            this._loadedIds.add(id);
            this.appendRecords(raw.map(item => this.model.createRecord(item)));

            const appended = this.getNodeById(id);

            if (appended) {
                this.emit('append', { parent: appended, nodes: appended.getChildren() });
            }

            return true;
        } finally {
            this._loadingIds.delete(id);
        }
    }

    /**
     * Collapses a node, re-flattening the visible view and firing `'collapse'`.
     *
     * @param node - The node to collapse.
     *
     * @remarks No-op when the node is not currently expanded.
     */
    collapse(node: TreeNode): void {
        const id = node.getId();

        if (!this._expandedIds.has(id)) {
            return;
        }

        this._expandedIds.delete(id);
        this.flatten();
        this.emit('collapse', { node });
    }

    /**
     * Toggles a node's expansion: expands a collapsed node, collapses an
     * expanded one.
     *
     * @param node - The node to toggle.
     *
     * @returns A promise that resolves once the toggle (and any lazy load) settles.
     */
    toggle(node: TreeNode): Promise<void> {
        if (this._expandedIds.has(node.getId())) {
            this.collapse(node);

            return Promise.resolve();
        }

        return this.expand(node);
    }

    /**
     * Returns whether a node is currently expanded.
     *
     * @param node - The node to test.
     *
     * @returns True when the node's id is in the expansion set.
     */
    isExpanded(node: TreeNode): boolean {
        return this._expandedIds.has(node.getId());
    }

    /**
     * Expands every non-leaf node down to (and including) the given depth, then
     * re-flattens once.
     *
     * @param depth - The deepest depth to expand; nodes deeper than this stay collapsed.
     */
    expandToDepth(depth: number): void {
        this.eachNode(node => {
            if (!node.isLeaf() && node.getDepth() <= depth) {
                this._expandedIds.add(node.getId());
            }
        });

        this.flatten();
    }

    /**
     * Collapses every node, then re-flattens once.
     */
    collapseAll(): void {
        this._expandedIds.clear();
        this.flatten();
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    /**
     * Subscribes a listener to a tree-structure event. A typed wrapper over the
     * inherited {@link AbstractStore.on} so consumers get key-checked tree events.
     *
     * @param event - The tree event to listen for.
     * @param listener - The callback invoked when the event fires.
     *
     * @returns This store, for chaining.
     */
    onTree(event: TreeStoreEvent, listener: StoreListener): this {
        return this.on(event as StoreEvent, listener);
    }
}
