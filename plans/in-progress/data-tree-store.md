---
depends-on: [data-proxy-reader-writer]
touches-shared: [src/typescript/lib/data/index.ts]
---

# TreeStore (Hierarchical Data) — Implementation Plan

## Overview

This plan adds a `TreeStore` to the data layer ([`src/typescript/lib/data/`](../src/typescript/lib/data)) that manages records arranged in a parent/child hierarchy: a synthetic root, depth-aware traversal, eager and lazy child loading, expand/collapse, and a flattened "visible nodes" view kept in sync with expansion state for a virtualized renderer. It lives in two new files — [`TreeStore.ts`](../src/typescript/lib/data/TreeStore.ts) and [`TreeNode.ts`](../src/typescript/lib/data/TreeNode.ts) (data-layer `TreeNode`, distinct from the unrelated component-layer [`TreeNode`](../src/typescript/lib/component/tree/TreeNode.ts)) — plus barrel exports in [`index.ts`](../src/typescript/lib/data/index.ts).

`TreeStore` **extends [`AbstractStore`](../src/typescript/lib/data/AbstractStore.ts#L72)**: it reuses the model/proxy wiring, the `allRecords`/`records` two-array discipline, CRUD, sync, sort, filter, and the full `on`/`off`/`emit` event surface, and it *layers* tree structure on top of that flat record set rather than replacing it. The hierarchy is encoded the same way the existing [`TreeTable`](../src/typescript/lib/component/table/TreeTable.ts#L87)/[`TreeBody`](../src/typescript/lib/component/table/TreeBody.ts#L111) already encode it — each record names its parent's id via a configured `parentField`, roots carry `null` — so a `TreeStore` is consumable by `TreeBody`'s id-keyed model with no schema change, and the new structural machinery (node index, flatten, expand) moves from the component into the store where it can be reused by any virtualized list.

The lazy path reuses the `remoteFilter` mechanism from [`data-proxy-reader-writer`](./data-proxy-reader-writer.md): a node's children load on demand by serializing an `eq` filter on `parentField === node.id` into `ReadParams.filters`. That dependency is the only hard prerequisite.

---

## Architecture Decisions

### `TreeStore extends AbstractStore` — reuse the flat record set, layer structure on top

The hierarchy is **derivable from flat records** (`parentField` → parent id), exactly as `TreeBody.rebuildIndex()` ([`TreeBody.ts:906`](../src/typescript/lib/component/table/TreeBody.ts#L906)) already proves. So `TreeStore` keeps `AbstractStore`'s `allRecords`/`records` as the source of truth and adds a parent/child index + flatten over it — it does **not** stand alongside `AbstractStore` with a parallel storage model. Extending wins three things for free: (1) loading/CRUD/sync/sort/filter and the `on`/`off`/`emit`/`ListenerBag` event plumbing are inherited verbatim; (2) `getById` (the `_idIndex` from [`data-store-collection-and-aggregation`](./data-store-collection-and-aggregation.md), or today's linear find) resolves a node's record by id; (3) `TreeBody` already accepts any `AbstractStore`, so a `TreeStore` drops in unchanged while *also* exposing structure to non-table consumers.

**Members reused as-is:** `model`/`proxy`, `allRecords`/`records`, `load`/`loadData`/`ingestRaw`, `add`/`remove`/`removeAll`, `sync`/`reject`/`hasPendingChanges`, `on`/`off`/`emit`, `getById`/`getAt`/`getRecords`.

**Members that need a tree-aware reaction (not override of semantics, just an extra rebuild step):** every mutation that changes `allRecords` must rebuild the node index and re-flatten. Rather than overriding each of `add`/`remove`/`removeAll`/`ingestRaw`, `TreeStore` overrides the single funnel **`applyView()`** ([`AbstractStore.ts:853`](../src/typescript/lib/data/AbstractStore.ts#L853)) — already called by every one of those paths — to call `super.applyView()` then rebuild `_nodesById`/`_childIds` and re-flatten. This mirrors the id-index-funnel strategy the collection plan uses and keeps tree state a pure function of `records` with no per-method edits. (Note `applyView()` returns a `Promise`; the override chains the rebuild via `.then`, see *Internal Structure*.)

**Members deliberately left to the base, usable but not tree-specialized:** `sort()`/`filter()` operate on the flat `records` view; a sort reorders siblings (the flatten walk picks children up under each parent in the new order, matching `TreeBody`'s "sort walks the sorted records" note at [`TreeBody.ts:104`](../src/typescript/lib/component/table/TreeBody.ts#L104)); a filter that drops a parent takes its subtree out of the visible flatten. **Pagination (`setPageSize`/`nextPage`/…) is a Non-Goal for trees** — server-paginated hierarchies are out of scope (documented), and `TreeStore` does not override or forbid the inherited methods, it simply does not use them.

### Node state is a separate `TreeNode` wrapper, not a `ModelRecord` subclass or mixed-in fields

The brief asks to decide between a `ModelRecord` subclass (`NodeRecord`) and mixed-in state. **Chosen: a distinct `TreeNode` descriptor object that *references* a `ModelRecord`**, holding `{ record, parent, children, depth, expanded, leaf, loaded }`. Rationale, weighed against one-element-per-class:

- **Not a `ModelRecord` subclass.** `ModelRecord` is created by `AbstractModel.createRecord()` ([`AbstractModel.ts:107`](../src/typescript/lib/data/AbstractModel.ts#L107)), which hard-codes `new ModelRecord(...)`. Subclassing would force a `createRecord` override / factory seam across the model layer purely to stamp tree state onto records that may not even be tree records — leaking hierarchy into the universal record type. The associations plan made the same call for child stores (descriptor separate from record); this plan stays consistent.
- **Not mixed-in fields on `ModelRecord`.** Putting `parent`/`children`/`expanded` on every `ModelRecord` pollutes the flat record type with tree-only state that `getData()`/proxy writers must then exclude (the associations plan's `_associatedSeed` dance). Tree structure is per-*tree*, not per-record: the same record could appear under different roots in different trees.
- **One-element-per-class** is the framework's **DOM** rule (one DOM element per `Component`). `TreeNode` is a plain data descriptor, not a `Component` — it owns no DOM — so the rule does not apply, exactly as `Field`/`Association`/`SortDescriptor` are plain descriptors. `TreeNode` is the structural twin of [`TreeBody.FlatRecord`](../src/typescript/lib/component/table/TreeBody.ts#L44) (which already carries `record`/`depth`/`hasChildren`/`expanded`), promoted to a first-class, navigable node with `parent`/`children` links.

`TreeNode` exposes typed getters (`getRecord`, `getParent`, `getChildren`, `getDepth`, `isExpanded`, `isLeaf`, `isLoaded`) per CODE_CONVENTIONS; mutation of node state goes through the **store** (`expand`/`collapse`), never by poking node fields, so the store can re-flatten and emit.

### Expansion is keyed by record id, not by node/record reference

`TreeBody` keys expansion by `record.get(idField)` so "a store sync that replaces records preserves expansion" ([`TreeBody.ts:101`](../src/typescript/lib/component/table/TreeBody.ts#L101)). `TreeStore` adopts the identical contract: `_expandedIds: Set<any>` keyed by the value at `idField`. After a `load()`/`sync()` swaps `ModelRecord` instances, the rebuilt nodes re-read their expanded flag from `_expandedIds`, so the tree visually survives a reload. `TreeNode.isExpanded()` is a *view* of `_expandedIds.has(node.id)`, not independent state.

### Synthetic root node, never rendered

`getRootNode()` returns a single synthetic `TreeNode` with `record: null`, `depth: -1`, whose `children` are the real root records (those whose `parentField` is `null` or unresolved — the orphan-as-root fallback from [`TreeBody.ts:922`](../src/typescript/lib/component/table/TreeBody.ts#L922)). The synthetic root is the traversal anchor and is **excluded from the visible flatten** (visible nodes start at depth 0). This avoids a "null parent vs. is-root" ambiguity in traversal code and gives `getChildren(root)` and `getChildren(someNode)` one uniform shape.

### Flattened visible view mirrors `AbstractStore`'s `records`-from-`allRecords` pattern

`AbstractStore` keeps `records` (the view) derived from `allRecords` (the master) via `applyView()`. `TreeStore` adds a third derived array, **`_visibleNodes: TreeNode[]`**, derived from the node tree + `_expandedIds` via `flatten()`, rebuilt whenever `applyView()` runs (data change) **or** an expand/collapse mutates `_expandedIds`. `getVisibleNodes()` returns the depth-ordered, expansion-respecting node list — the exact input a virtualized list needs (it already carries `depth`, sibling count, and position the way `FlatRecord` does). This is the store-level equivalent of `TreeBody.flatten()` ([`TreeBody.ts:941`](../src/typescript/lib/component/table/TreeBody.ts#L941)), now reusable by any renderer, not just `TreeBody`.

### Eager + lazy loading, mirroring the associations plan's split

- **Eager.** A `load()`/`loadData()` payload of flat records (each with `parentField`) hydrates the whole tree at once: `applyView()`'s rebuild reads every record's `parentField` and assembles the index in one pass — no per-node fetch. This is the default and needs no extra machinery beyond the rebuild override. A payload may also arrive as **nested `children` arrays** (a node carrying an embedded child array); `TreeStore` flattens nested payloads into the flat record set during `ingestRaw` via an overridable `flattenNested()` step that stamps `parentField` from the enclosing node's id before handing the flattened array to the base ingest. (Off by default; enabled by a `childrenKey` option — see Public API.)
- **Lazy.** A node declared expandable-but-unloaded (`leaf: false, loaded: false`) loads its children on first `expand()` through the proxy, scoped by `remoteFilter`: `loadChildren(node)` issues a proxy read whose `ReadParams.filters` carries `{ type: 'eq', field: parentField, value: node.id }` (the dependency plan's mechanism), appends the returned records to `allRecords`, marks the node `loaded`, and re-flattens. A node with no children-count hint is treated as a potential branch when `leafField`/`hasChildrenField` says so (see *leaf determination*). Concurrent expands of the same node are de-duplicated by a `_loadingIds: Set<any>` guard, mirroring `Tree._loadingNodes` ([`Tree.ts:365`](../src/typescript/lib/component/tree/Tree.ts#L365)).

The split is per-tree, not per-node-kind: a tree is eager when its records arrive pre-populated, lazy when nodes are loaded on expand. Both can coexist (an eagerly-loaded subtree under a lazily-loaded root) because `loaded`/`leaf` are per-node flags.

### Leaf determination is configurable, defaulting to "has children in the current record set"

Whether a node renders an expand caret needs a source of truth. Three modes, resolved per node in priority order:
1. `leafField` — if the model has a boolean field naming leaf-ness, `node.leaf = record.get(leafField)` (explicit, supports lazy nodes with no loaded children yet).
2. `hasChildrenField` — a boolean "this branch has children server-side" hint for lazy nodes (so a caret shows before the fetch), mirroring the component `TreeNode.hasChildren` ([`component/tree/TreeNode.ts:35`](../src/typescript/lib/component/tree/TreeNode.ts#L35)).
3. Default — `leaf = childIds(node.id).length === 0`, i.e. a node is a branch iff some loaded record names it as parent (exactly `TreeBody.isDirectoryRecord` semantics, [`TreeBody.ts:241`](../src/typescript/lib/component/table/TreeBody.ts#L241)).

This keeps eager trees zero-config (default mode) while letting lazy trees declare branch-ness before children exist.

### Events fit `AbstractStore`'s model and the sync-and-events plan's additive convention

New tree events ride the inherited `StoreEvent` union / `ListenerBag`. Following the [`data-store-sync-and-events`](./data-store-sync-and-events.md) convention (each plan appends its own literals; whichever lands second concatenates), `TreeStore` adds `'expand' | 'collapse' | 'append' | 'removenode'` to `StoreEvent` and a payload interface per event. They are **additive companions** to the existing `'datachanged'`/`'add'`/`'remove'` (which still fire from the inherited mutation methods), not replacements — `expand`/`collapse` carry the toggled `TreeNode`; `append` carries `{ parent, nodes }` after children are appended (eager-nested or lazy-loaded); `removenode` carries `{ node }` after a subtree is removed. Because `StoreEvent` is widened in `AbstractStore.ts`, this is the plan's **one** edit to a shared base file beyond the barrel (flagged below); the payload interfaces themselves live in `TreeStore.ts`.

### No Tree *widget* in scope; the consumer is `TreeBody` and any future virtualized list

A Tree UI component (`component/tree/Tree`) and a `TreeTable`/`TreeBody` already exist (see *Critical Files*). `Tree` operates on its own POJO `TreeNode` and is **not** retrofitted here. `TreeBody` already consumes a flat `AbstractStore` — a `TreeStore` is drop-in compatible with it, and the structural API (`getVisibleNodes`, `expand`, `collapse`) is shaped to be the data-side counterpart `TreeBody` *could* delegate to later. This plan does **not** rewire `TreeBody` to use `TreeStore` (that is a component-layer follow-up); it only ensures the store's API composes with the existing flat-store convention so no schema or `TreeBody` change is forced.

### Surgical edit to `AbstractStore` only where unavoidable

The `AbstractStore.ts` changes are: (1) widening the `StoreEvent` union with four literals, and (2) adding one minimal `protected appendRecords(records: ModelRecord[])` hook for the lazy path (pre-authorized in *Potential Challenges*). `applyView()` is `protected` and is **overridden** in `TreeStore` (no base edit). `TreeStore` reads the flat set through the public `getRecords()`/`getAll()` — the same surface `TreeBody.rebuildIndex()` uses ([`TreeBody.ts:910`](../src/typescript/lib/component/table/TreeBody.ts#L910)). **Drift note (2026-06-22):** the original plan assumed the lazy path could "push to the master set" through the public surface alone, but `_allRecords` is fully private with no append seam, and re-ingesting via `loadData(getData())` is lossy when a field's `mapping` differs from its `name` (and would drop dirty/new state). So `appendRecords` is added as the surgical second base edit (additive `protected` method, touches no existing base code), committed atomically with the union widening in the shared-file commit. Both base edits are additive and conflict-free with sibling plans.

---

## Public API (TypeScript Signatures)

New file `data/TreeNode.ts`:

```ts
/**
 * A node in a {@link TreeStore}'s hierarchy: a thin structural wrapper around a
 * {@link ModelRecord}, carrying parent/child links, depth, and expansion/leaf
 * state. The synthetic root has a null record and depth -1. @category Data
 */
export class TreeNode {
    getRecord(): ModelRecord | null;        // null only for the synthetic root
    getId(): any;                            // record.get(idField), undefined for root
    getParent(): TreeNode | null;
    getChildren(): TreeNode[];               // resolved children (empty until loaded for lazy)
    getDepth(): number;                      // 0 for visible roots; -1 for the synthetic root
    isExpanded(): boolean;                   // view of the store's _expandedIds
    isLeaf(): boolean;                       // per the leaf-determination rules
    isLoaded(): boolean;                     // children fetched (always true for eager nodes)
}
```

New file `data/TreeStore.ts`:

```ts
/** Names of the tree-structure events fired by {@link TreeStore}, in
 *  addition to the inherited {@link StoreEvent}s. @category Data */
export type TreeStoreEvent = 'expand' | 'collapse' | 'append' | 'removenode';

/** @category Data */ export interface TreeExpandEvent   { node: TreeNode; }
/** @category Data */ export interface TreeCollapseEvent { node: TreeNode; }
/** @category Data */ export interface TreeAppendEvent   { parent: TreeNode; nodes: TreeNode[]; }
/** @category Data */ export interface TreeRemoveEvent   { node: TreeNode; }

/** @category Data */
export interface TreeStoreOptions extends StoreOptions {     // model + optional proxy + AbstractStoreOptions
    /** Field carrying each record's id (the join key). Defaults to the model primary key. */
    idField?:           string;
    /** Field carrying each record's parent id; null/unresolved ⇒ root. Required. */
    parentField:        string;
    /** Boolean field declaring a record a leaf (no caret). Optional. */
    leafField?:         string;
    /** Boolean field hinting a lazy node has server-side children. Optional. */
    hasChildrenField?:  string;
    /** Raw-payload key holding an embedded child array for nested eager loads. Optional. */
    childrenKey?:       string;
}

export class TreeStore extends AbstractStore {
    readonly model: Model;
    readonly proxy: Proxy | undefined;

    constructor(options: TreeStoreOptions);

    // ── Traversal ──
    getRootNode(): TreeNode;                              // synthetic root (depth -1)
    getNodeById(id: any): TreeNode | undefined;
    getNodeForRecord(record: ModelRecord): TreeNode | undefined;
    getChildren(node: TreeNode): TreeNode[];
    getParent(node: TreeNode): TreeNode | null;
    getDepth(node: TreeNode): number;
    eachNode(fn: (node: TreeNode) => void): void;         // depth-first over the whole tree (renamed from `each` — see drift note)

    // ── Visible (flattened) view ──
    getVisibleNodes(): TreeNode[];                        // depth-ordered, expansion-respecting
    getVisibleCount(): number;

    // ── Expansion ──
    expand(node: TreeNode): Promise<void>;               // lazy-loads children if needed, fires 'expand'/'append'
    collapse(node: TreeNode): void;                       // fires 'collapse'
    toggle(node: TreeNode): Promise<void>;
    isExpanded(node: TreeNode): boolean;
    expandToDepth(depth: number): void;
    collapseAll(): void;

    // ── Tree-typed event subscription (delegates to inherited on/off) ──
    onTree(event: TreeStoreEvent, listener: StoreListener): this;

    // applyView() overridden (protected) to rebuild the node index + flatten.
}
```

`AbstractStore.ts` — `StoreEvent` union widened (the only base edit):

```ts
export type StoreEvent =
    | /* …existing… */
    | 'expand' | 'collapse' | 'append' | 'removenode';   // ← added by THIS plan
```

---

## Internal Structure

**Private state on `TreeStore`** (plain initialized fields — `TreeStore` is not a `Component`, so the cascade-`declare` trap does not apply, but `applyOptions` runs from the base constructor, so config fields the constructor reads must be set *before* `super` would dispatch them — see the construction note):

```ts
private _parentField:  string;
private _idField:      string;
private _root:         TreeNode;                 // synthetic, depth -1
private _nodesById:    Map<any, TreeNode> = new Map();
private _childIds:     Map<any, ModelRecord[]> = new Map();   // parentId → child records (null key = roots)
private _expandedIds:  Set<any> = new Set();
private _loadingIds:   Set<any> = new Set();     // lazy de-dup guard
private _visibleNodes: TreeNode[] = [];
```

**Construction.** `AbstractStore` has no constructor; subclasses assign `model`/`proxy` then call `applyOptions`. `TreeStore`'s constructor assigns `model`/`proxy` from the options bag (mirroring [`Store`](../src/typescript/lib/data/Store.ts#L36)), then assigns `_parentField`/`_idField`/`childrenKey` etc. from the bag, creates the synthetic `_root`, and **then** calls `this.applyOptions(options)` (so an `autoLoad: true` runs `load()` after the tree config is in place). Because `applyView()` is overridden and reads `_parentField`, the field must be set before any `applyView()` can fire — and it is, since `applyOptions`/`load` run after the assignments.

**`applyView()` override** (the rebuild funnel):

```ts
protected applyView(): Promise<void> {
    return super.applyView().then(() => {
        this.rebuildNodeIndex();   // from getRecords(): _childIds, _nodesById, parent/child links
        this.flatten();            // _visibleNodes from _root + _expandedIds
    });
}
```

`rebuildNodeIndex()` mirrors [`TreeBody.rebuildIndex`](../src/typescript/lib/component/table/TreeBody.ts#L906) + node construction: build `_childIds` keyed by `parentField` (null/unresolved → root bucket), then walk from the root building `TreeNode` wrappers (re-reading `expanded` from `_expandedIds`, `leaf` per the leaf rules), and populate `_nodesById`. `flatten()` mirrors [`TreeBody.flatten`](../src/typescript/lib/component/table/TreeBody.ts#L941): depth-first from the root's children, recursing into a node only when `_expandedIds.has(node.id)`.

**`expand(node)`** (lazy-aware):

```ts
async expand(node: TreeNode): Promise<void> {
    const id = node.getId();
    if (this._expandedIds.has(id) || node.isLeaf()) { return; }

    if (!node.isLoaded() && this.proxy) {
        if (this._loadingIds.has(id)) { return; }       // de-dup concurrent expands
        this._loadingIds.add(id);
        try {
            const children = await this.loadChildren(node);   // remoteFilter on parentField === id
            this.appendRecords(children, id);                 // push to allRecords, mark node loaded
            this.emit('append', { parent: node, nodes: /* new child nodes */ });
        } finally {
            this._loadingIds.delete(id);
        }
    }

    this._expandedIds.add(id);
    this.flatten();
    this.emit('expand', { node });
}
```

`loadChildren(node)` builds `ReadParams.filters = [{ type: 'eq', field: this._parentField, value: id }]` and calls `this.proxy!.read(params)` — the `remoteFilter` path from the dependency plan. `appendRecords` runs records through `model.createRecord`, marks them committed (loaded, not new), pushes to the master set, and triggers a rebuild via `applyView()` (which re-flattens). `collapse(node)` deletes from `_expandedIds`, re-flattens, emits `'collapse'`.

**Nested eager flatten** (when `childrenKey` is set): `ingestRaw` is `private` in the base, so `TreeStore` overrides `loadData` and the `load()` ingest seam minimally — the cleanest hook is a `protected normalizeIncoming(data)` the override applies before delegating to the base. Given `ingestRaw` is private, the plan instead **flattens nested payloads in `loadData`/a `read`-post-processing step**: a recursive walk that, for each node carrying `data[childrenKey]`, stamps `child[parentField] = node[idField]` and collects all nodes into one flat array, then calls the base ingest path. (Implementer confirms the exact seam against the base at write time — preferred: override `loadData`, and for proxy `load()` post-process the proxy result before `super`-style ingest, or widen the base with a tiny `protected` hook if no clean seam exists. If a base hook is needed, it is an additional surgical `AbstractStore.ts` edit, flagged in Potential Challenges.)

---

## Ordered Implementation Steps

1. **`data/TreeNode.ts`** — new file: the `TreeNode` class with the typed getters. Node fields are set by the store during `rebuildNodeIndex`; `isExpanded`/`isLeaf` read store-owned state passed in at construction (store reference or snapshot flags). `@category Data`. → verify: `npm run typecheck` clean.

2. **`AbstractStore.ts`** — widen the `StoreEvent` union ([`AbstractStore.ts:29`](../src/typescript/lib/data/AbstractStore.ts#L29)) with `'expand' | 'collapse' | 'append' | 'removenode'`. Append-only; composes with the sibling plans' union edits. → verify: typecheck; `grep -n "'expand'" src/typescript/lib/data/AbstractStore.ts`.

3. **`data/TreeStore.ts`** — new file: `TreeStoreEvent`, the four payload interfaces, `TreeStoreOptions`, and the `TreeStore` class. Implement constructor (model/proxy + tree config + synthetic root, then `applyOptions`), `applyView()` override, `rebuildNodeIndex`, `flatten`, traversal (`getRootNode`/`getNodeById`/`getChildren`/`getParent`/`getDepth`/`eachNode` — renamed from `each` to avoid clashing with the inherited record-iterating `AbstractStore.each`), visible view (`getVisibleNodes`/`getVisibleCount`), expansion (`expand`/`collapse`/`toggle`/`isExpanded`/`expandToDepth`/`collapseAll`), lazy `loadChildren`/`appendRecords` with the `_loadingIds` guard, and `onTree`. Each method `@category Data` + typed return. Decompose `expand` and `rebuildNodeIndex` per the long-function rule. → verify: typecheck.

4. **`data/TreeStore.ts` — leaf determination** — implement the 3-mode resolver (`leafField` → `hasChildrenField` → child-count default) used by `rebuildNodeIndex` when stamping each node's `leaf`. → verify: a record with children is a branch; a `leafField:true` record is a leaf even with zero loaded children.

5. **`data/TreeStore.ts` — nested eager flatten** — implement the `childrenKey` recursive flatten in the load/loadData seam (confirm the base seam first; widen `AbstractStore` with a `protected` ingest hook only if unavoidable, and flag it). → verify: a nested payload `[{id:1, children:[{id:2}]}]` ingests as two flat records with `parentField` stamped, and `getChildren(rootChild)` returns the nested node.

6. **`index.ts`** — export `TreeStore`, `TreeNode`, and `type { TreeStoreOptions, TreeStoreEvent, TreeExpandEvent, TreeCollapseEvent, TreeAppendEvent, TreeRemoveEvent }`. → verify: `grep -n "TreeStore" src/typescript/lib/data/index.ts`.

7. **Regression checkpoint** — `grep -rn "extends AbstractStore" src/typescript/lib/data/` shows `TreeStore` alongside `Store`/`MemoryStore`/`AjaxStore`; `npm run typecheck` clean; existing `TreeBody`/`TreeTable` untouched (`git status` shows no edits under `component/table/`).

8. **Docs** (see *Documentation Impact*). → verify: `npm run docs:build` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/data/TreeNode.ts` (data-layer node descriptor) |
| Create | `src/typescript/lib/data/TreeStore.ts` (the store + events + options) |
| Modify | `src/typescript/lib/data/AbstractStore.ts` (widen `StoreEvent` union — four literals only) |
| Modify | `src/typescript/lib/data/index.ts` (export the new symbols) |
| Modify | `docs/data/store.md` (TreeStore section) |
| Modify | `docs/data/index.md` (catalog mention) |

---

## Verification

- **Typecheck:** `npm run typecheck` (or `npx tsc --noEmit`) — 0 errors. Watch the `TreeStore` → `Proxy`/`ReadParams.filters` edge picks up the dependency plan's widened `ReadParams`.
- **Eager build:** loading flat records `[{id:1,parentId:null},{id:2,parentId:1},{id:3,parentId:null}]` yields `getRootNode().getChildren()` of length 2; `getNodeById(1).getChildren()` of length 1; `getDepth(getNodeById(2)!)` === 1.
- **Visible view sync:** with nothing expanded, `getVisibleNodes()` lists only the two roots; after `expand(node1)`, it includes node 2 between them in depth order; after `collapse(node1)`, node 2 is gone again. Each toggle fires exactly one `'expand'`/`'collapse'`.
- **Expansion survives reload:** expand a node, `load()` a payload that re-creates the same ids, assert the node is still expanded (id-keyed `_expandedIds`).
- **Lazy load:** a node with `hasChildrenField:true` and no loaded children shows `isLeaf() === false`; `expand(node)` issues one proxy `read` whose `ReadParams.filters` contains `{ type:'eq', field: parentField, value: nodeId }`, appends the returned records, marks the node `isLoaded()`, fires `'append'` then `'expand'`; a second concurrent `expand` during the in-flight load is a no-op (`_loadingIds` guard).
- **Nested eager flatten:** a `childrenKey`-configured payload with embedded child arrays ingests as flat records with `parentField` stamped; traversal reflects the nesting.
- **`TreeBody` compatibility:** a `TreeStore` passed where `TreeBody` expects an `AbstractStore` (via `parentField`/`idField`) renders without error — the flat `records` convention is preserved.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning); confirm `TreeStore`/`TreeNode` land under `docs/api/data/`.
- **Manual smoke:** no dedicated TreeStore demo exists; exercise via a `TreeTable` (the project's tree demo) bound to a `TreeStore` instead of a plain `MemoryStore`, expand/collapse a few nodes.

---

## Documentation Impact

- **Barrel:** `TreeStore`, `TreeNode` (classes) and `TreeStoreOptions`/`TreeStoreEvent`/`TreeExpandEvent`/`TreeCollapseEvent`/`TreeAppendEvent`/`TreeRemoveEvent` (types) re-export from [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts) (the `data` subpath barrel — there is no root barrel). Each carries `@category Data`. The `StoreEvent` union (already exported) just grows.
- **Curated page:** extend [`docs/data/store.md`](../docs/data/store.md) with a `## TreeStore` section: the `parentField`/`idField` hierarchy convention, `getRootNode`/`getVisibleNodes`/traversal, eager vs lazy loading (with the `remoteFilter` parent-scoping note), expand/collapse + the four tree events. The page is already linked in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts#L183) and catalogued in [`docs/data/index.md`](../docs/data/index.md) — no sidebar/catalog *page* add needed; extend the Store catalog bullet to mention `TreeStore`.
- **Cross-bucket JSDoc:** all new references stay within the `data` bucket (`TreeStore`/`TreeNode`/`ModelRecord`/`StoreEvent`), so `{@link …}` resolves; no markdown-link form needed. The data-layer `TreeNode` JSDoc must disambiguate from the component-layer [`component/tree/TreeNode`](../src/typescript/lib/component/tree/TreeNode.ts) (different bucket, different concept) to avoid a reader conflating them.
- **No renames/removals** — additive only.

---

## Potential Challenges

- **Name collision with the component-layer `TreeNode`.** Two distinct `TreeNode` types now exist (`data/TreeNode.ts` vs `component/tree/TreeNode.ts`). Mitigation: they live in separate subpath barrels (never co-exported), and `@category Data` vs `@category Components` keeps the docs apart; JSDoc on each cross-disambiguates. An alternative name (`TreeStoreNode`) was considered but rejected — within the `data` bucket `TreeNode` is the natural name and there is no same-bucket clash.
- **`ingestRaw` is private — nested-flatten seam.** The base `ingestRaw` ([`AbstractStore.ts:365`](../src/typescript/lib/data/AbstractStore.ts#L365)) is private, so nested-payload flattening must hook `loadData`/the proxy result before ingest, or add one small `protected` hook to the base. Mitigation: prefer overriding `loadData` and post-processing the proxy `read` result; widen `AbstractStore` only as a last resort and flag it as a second surgical base edit. The `childrenKey` feature is gated behind an option, so a flat-only TreeStore needs none of this.
- **Sort/filter interaction with the tree.** Inherited `sort()`/`filter()` reorder/prune the flat `records`; the next `applyView()` re-flattens, so siblings reorder and filtered-out parents drop their subtrees — matching `TreeBody`'s documented behaviour. Mitigation: document that sort acts within sibling groups via the flatten walk; no special multi-level sort is added (Non-Goal).
- **Lazy load with an unsynced/idless parent.** A brand-new parent (no id yet) has nothing to fetch. Mitigation: `expand()` on a node whose `getId()` is undefined does not auto-load (mirrors the associations plan's "no auto-load without parent id"); children added in-memory still flatten.
- **`applyView()` returns a Promise the base callers `void` or `.then`.** The override must preserve the contract (rebuild *after* the base view resolves). Mitigation: chain via `super.applyView().then(...)`; the rebuild is synchronous so the returned promise still settles in order.
- **Pagination inherited but meaningless for trees.** Calling `setPageSize` on a `TreeStore` would paginate the flat set and break the hierarchy. Mitigation: documented as unsupported (Non-Goal); not overridden (no runtime guard), consistent with the library not policing misuse elsewhere.

---

## Critical Files

- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) — the base being extended: `applyView()` ([L853](../src/typescript/lib/data/AbstractStore.ts#L853)) is the rebuild funnel to override; `StoreEvent` ([L29](../src/typescript/lib/data/AbstractStore.ts#L29)) is widened; `getRecords`/`getById`/`on`/`off`/`emit` are the reused surface; `ingestRaw` ([L365](../src/typescript/lib/data/AbstractStore.ts#L365)) is private (nested-flatten seam concern).
- [`src/typescript/lib/component/table/TreeBody.ts`](../src/typescript/lib/component/table/TreeBody.ts) — the **existing** hierarchy logic this plan promotes to the store: `rebuildIndex` ([L906](../src/typescript/lib/component/table/TreeBody.ts#L906)), `flatten` ([L941](../src/typescript/lib/component/table/TreeBody.ts#L941)), `FlatRecord` ([L44](../src/typescript/lib/component/table/TreeBody.ts#L44)), id-keyed expansion ([L101](../src/typescript/lib/component/table/TreeBody.ts#L101)), orphan-as-root ([L922](../src/typescript/lib/component/table/TreeBody.ts#L922)). Read first — the store must match its semantics so `TreeStore` is `TreeBody`-compatible.
- [`src/typescript/lib/component/table/TreeTable.ts`](../src/typescript/lib/component/table/TreeTable.ts) — proves the flat-store + `parentField`/`idField` convention ([L113](../src/typescript/lib/component/table/TreeTable.ts#L113), example at [L57](../src/typescript/lib/component/table/TreeTable.ts#L57)) "no new store subtype required" — the contract `TreeStore` must not break.
- [`src/typescript/lib/component/tree/TreeNode.ts`](../src/typescript/lib/component/tree/TreeNode.ts) — the **unrelated** component-layer node POJO (`label`/`children`/`hasChildren`/`loadChildren`); read to avoid conflating it with the new data-layer `TreeNode` and to mirror its lazy `hasChildren` hint.
- [`src/typescript/lib/data/Store.ts`](../src/typescript/lib/data/Store.ts) / [`MemoryStore.ts`](../src/typescript/lib/data/MemoryStore.ts) — the concrete-store construction pattern (`model`/`proxy` from the bag, then `applyOptions`) `TreeStore`'s constructor mirrors.
- [`src/typescript/lib/data/FilterDescriptor.ts`](../src/typescript/lib/data/FilterDescriptor.ts) — the `eq` descriptor ([L11](../src/typescript/lib/data/FilterDescriptor.ts#L11)) the lazy path serializes into `ReadParams.filters`.
- [`plans/data-proxy-reader-writer.md`](./data-proxy-reader-writer.md) — the `remoteFilter` / `ReadParams.filters` mechanism the lazy path hard-requires (`depends-on`).
- [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts) — the export surface.

---

## Non-Goals

- **No Tree *widget*** — a Tree UI component (`component/tree/Tree`) and `TreeTable`/`TreeBody` already exist; this plan adds only the data-layer store, shaped to be `TreeBody`-compatible. Rewiring `TreeBody` to delegate to `TreeStore` is a separate component-layer effort.
- **No server-side pagination of trees** — inherited pagination operates on the flat set and would break the hierarchy; trees load eagerly or lazily-per-node, not by page. The inherited methods are left present but unsupported, not overridden.
- **No multi-level/nested sort or grouping over the tree** — `sort()`/`filter()` act on the flat `records` and reorder/prune siblings via the flatten walk; deeper hierarchical sort is out (matches `TreeBody`).
- **No reparent / drag-and-drop API in the store** — `TreeTable`/`TreeBody` already own reparent + DnD ([`TreeTable.reparentRow`](../src/typescript/lib/component/table/TreeTable.ts#L303)); `TreeStore` exposes structure/traversal only. Moving a node is `record.set(parentField, newParentId)` + a rebuild via the inherited `notifyRecordChanged`/`applyView`, not a new store method.
- **No `ModelRecord` subclass (`NodeRecord`)** — node state is a separate `TreeNode` wrapper to keep tree-only state off the universal record type; justified in Architecture Decisions.
- **No reuse of the associations `hasMany` machinery** — a TreeStore is a *self-referential* hierarchy on one model (parent id on the same record type), not an owner→target association across two models. ExtJS keeps `TreeStore` separate from associations for the same reason: the parent/child relation is homogeneous and id-keyed within one record set, whereas an association joins two distinct models through a child store. Reusing `HasManyAssociation` would force a single model to associate with itself and build a child `Store` per node (defeating the single-flat-record-set + flatten design that makes `TreeBody` compatibility free). They stay independent; the only shared primitive is the `remoteFilter` load path, consumed by both.
