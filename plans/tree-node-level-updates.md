---
touches-shared:
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
  - packages/lib/tests/component/tree/Tree.test.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Tree Node-Level Updates — Implementation Plan

## Overview

`Tree` ([packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts)) takes data only through `setNodes(nodes)` ([Tree.ts:277](packages/lib/src/typescript/lib/component/tree/Tree.ts#L277)). That call collapses every node, clears the selection, anchor, focus and lazy-load state, and force-rebinds every visible row. A consumer that wants to add, remove, relabel, or re-list one node has to pay that reset and then replay what it lost. Loom's `FileTree.rebuild` does exactly that on every file-watcher event: `node.children = fresh; setNodes(getNodes())`, then `expandPaths` (which re-reads every expanded folder from disk), `reselect`, and `setScrollY`.

This plan adds four public methods to `Tree`:

- `insertNode(parent, index, node)` — add one node.
- `removeNode(node)` — remove one node and everything under it.
- `setChildren(parent, children)` — replace one node's child list (or, with `parent === null`, the root list).
- `notifyNodeChanged(node)` — repaint one node's row after the caller changed its `label`, `data`, or `hasChildren` in place.

The first three change which nodes the tree holds; the plan calls them **structural calls**. Every structural call keeps the scroll offset, and the expansion, selection, anchor, focus and lazy-load state of every node it leaves in the tree. It rebinds only rows whose content actually changed. No event fires from any of the four.

Only `Tree.ts` changes behaviour. `TreeNode.ts` gets one doc remark; `TreeRow`, the renderers, and `VirtualRowView` are untouched. Tests go in `Tree.test.ts`; `Tree.md` and the changelog get new sections. Loom's adoption is a separate Loom plan.

---

## Architecture Decisions

### Four methods, each named after an existing library method

The names and argument orders follow what the library already uses for the same operation on its other data holders.[^naming]

| New `Tree` method | Precedent | What it borrows |
|---|---|---|
| `insertNode(parent, index, node)` | `AbstractStore.insert(index, data)` ([AbstractStore.ts:815](packages/lib/src/typescript/lib/data/AbstractStore.ts#L815)) | index before item; index clamped to `[0, length]` ([AbstractStore.ts:845-849](packages/lib/src/typescript/lib/data/AbstractStore.ts#L845-L849)) |
| `removeNode(node)` | `AbstractStore.remove(record)` ([AbstractStore.ts:868](packages/lib/src/typescript/lib/data/AbstractStore.ts#L868)) | the item alone; an item not held is a no-op; returns `this` |
| `setChildren(parent, children)` | `Tree.setNodes(nodes)`; data-layer `TreeNode.setChildren(children)` ([data/TreeNode.ts:132](packages/lib/src/typescript/lib/data/TreeNode.ts#L132)) | the name; the array is stored by reference, not copied |
| `notifyNodeChanged(node)` | `AbstractStore.notifyRecordChanged(record)` ([AbstractStore.ts:948](packages/lib/src/typescript/lib/data/AbstractStore.ts#L948)) | "the caller changed this object in place; re-derive what depends on it" |

The `…Node` suffix matches `Tree`'s own `selectNode` / `expandNode`. A `parent` of `null` means the root level, the same way `TreeStore` and `TreeBody` treat a `null` parent id as a root.

### Node identity is the key; Loom re-lists a folder with `setChildren` and reused nodes

Every piece of `Tree` state is keyed by node object identity: the four `Set` fields and `_pendingExpansions` ([Tree.ts:135-155](packages/lib/src/typescript/lib/component/tree/Tree.ts#L135-L155)), the anchor and focus ([Tree.ts:156-157](packages/lib/src/typescript/lib/component/tree/Tree.ts#L156-L157)), and the pool reconciliation (`reconcilePoolByKey` keyed by `node`, [Tree.ts:1391-1396](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1391-L1396)). `setChildren` therefore needs no key option. A node object present before and after the call is the same node; the consumer expresses "this entry survived" by passing the same object again.

For Loom's watcher refresh, the consumer maps each fresh directory entry back to the existing node for that path, and hands the merged list to `setChildren(dirNode, merged)`:

| Step | Today (`FileTree.rebuild`) | With `setChildren` |
|---|---|---|
| Re-list `src/` | fresh node objects for every entry | fresh listing; each surviving entry replaced by its existing node object (looked up by path) |
| Install | `node.children = fresh; setNodes(getNodes())` — whole tree collapses, selection clears | `setChildren(srcNode, merged)` |
| Expansion below `src/` | replayed by `expandPaths`, re-reading every expanded folder from disk | kept; no disk reads |
| Selection, scroll | replayed by `reselect`, `setScrollY` | kept |

Passing reused node objects to `setChildren` follows how `Tree` already identifies nodes, and is the one option that needs neither a new concept nor one render per changed entry.[^identity-not-keys]

### A node keeps its state exactly while the tree still holds it

A node is **reachable** when it can be found from the root array by following `children` arrays, whether or not its ancestors are expanded. After every structural call, `Tree` walks the reachable nodes once and drops all state held for any node that is no longer reachable: membership in the expanded, selected, loading and loaded sets, a pending `expandNodeAsync` entry, and the anchor or focus. State for every reachable node is left untouched.[^reachability]

Worked example (the Loom case), starting from:

```
src          expanded, loaded
  a.ts
  lib        expanded, loaded
    x.ts     selected, anchor, focus
README
```

and calling `setChildren(src, [lib, bTs])`, where `lib` is the same object as before and `bTs` is new:

| Node after the call | Why | State |
|---|---|---|
| `lib` | same object, still under `src` | kept: expanded, loaded, still holds `x.ts` |
| `x.ts` | reachable through `lib` | kept: selected, anchor, focus |
| `bTs` | new object | collapsed, unloaded, unselected |
| `a.ts` | left out, so unreachable | forgotten |

Pruning by presence mirrors the "is it still present after the change?" check `Table.onSourceStoreChange` runs for its displayed record ([Table.ts:1357](packages/lib/src/typescript/lib/component/table/Table.ts#L1357)). It departs from `Body` (the `Table` row body), which leaves a removed record in its selection: `Tree` prunes, because otherwise `getSelectedNodes()` and `getExpandedNodes()` would report nodes the tree no longer holds, and the loaded set would grow with every refresh.

### No event fires; a removed selection is dropped silently

None of the four methods emits anything. Dropping a selected node does not emit `"selection"`; dropping an expanded node does not emit `"collapse"`; a lazy load dropped by a structural call emits neither `"expand"` nor `"loaderror"`. Staying silent is the rule `selectNode` ([Tree.ts:381-383](packages/lib/src/typescript/lib/component/tree/Tree.ts#L381-L383)) and `setNodes` already follow: a programmatic call made by the consumer does not report back to the same consumer. A caller that needs the new selection reads `getSelectedNodes()` / `getSelectedNode()` after the call.[^no-events]

| Call | Emits | `expandNodeAsync` in flight for an affected node resolves |
|---|---|---|
| `insertNode(parent, …)` | nothing | `false` for `parent`, if its lazy load was in flight (see next decision) |
| `removeNode(n)`, `n` selected and expanded | nothing — no `"selection"`, no `"collapse"` | `false` for `n` or any node under it |
| `setChildren(p, …)` | nothing | `false` for `p` and for any node left out |
| `notifyNodeChanged(n)` | nothing | unaffected |

### A structural call takes over its parent's children from any lazy load

After a structural call on `parent`, the caller owns that node's child list. Three rules follow, applied the same way by all three structural calls (for `removeNode`, `parent` is the removed node's parent):

| `parent` state before the call | After the call |
|---|---|
| lazy (`loadChildren` set), never loaded | counts as loaded: expanding it later never calls `loadChildren` |
| `expandNodeAsync` load in flight | load dropped the way `setNodes` drops it: result discarded, node not expanded by it, promise resolves `false`, spinner cleared |
| `revealByPredicate` load in flight | the reveal keeps the children the caller supplied and discards its own loader result |
| `null` (root level) | nothing to take over |

Dropping an `expandNodeAsync` load reuses `setNodes`' existing orphaning path: removing the node from `_loadingNodes` makes `_loadAndExpand` return `false` without writing `children` ([Tree.ts:918-920](packages/lib/src/typescript/lib/component/tree/Tree.ts#L918-L920)). The `revealByPredicate` case needs one guard in `_ensureChildrenLoaded`, because that path never consults `_loadingNodes`.[^supersede]

### Structural calls reuse the expand/collapse render path; `notifyNodeChanged` forces one row

A structural call runs the same `_reflattenAndRender()` that expand and collapse run ([Tree.ts:746-749](packages/lib/src/typescript/lib/component/tree/Tree.ts#L746-L749)). `_flatten` marks `_flatRowsDirty`, so `renderWindow` re-matches pool slots to nodes by identity, and `_bindAndMeasure` rebinds only a row whose `TreeRow.isBoundTo` tuple changed ([TreeRow.ts:183-192](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L183-L192)). No structural call touches `_boundIndices`, so nothing is force-rebound.

Worked example — roots `R0`, `R1`, `R2`, with `R1` expanded over children `C0`, `C1`, then `insertNode(R1, 1, X)`:

| Row | Before (level, set size, position) | After | Rebound? |
|---|---|---|---|
| `R0` | 1, 3, 1 | 1, 3, 1 | no |
| `R1` | 1, 3, 2 | 1, 3, 2 | no |
| `C0` | 2, 2, 1 | 2, 3, 1 | yes — `aria-setsize` changed |
| `X` | — | 2, 3, 2 | yes — new row |
| `C1` | 2, 2, 2 | 2, 3, 3 | yes — set size and position changed |
| `R2` | 1, 3, 3 | 1, 3, 3 | no |

`notifyNodeChanged(node)` does not reflatten: the structure did not change. It sets the forced-rebind sentinel (`_boundIndices[slot] = -1`) on each live pool slot showing `node` and calls `renderWindow()`. The sentinel is the channel `setNodes`, `setRendererFactory` and `onThemeReflow` already use for "content changed behind an identity `isBoundTo` cannot see" ([Tree.ts:1476-1491](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1476-L1491)); `notifyNodeChanged` applies it to one slot instead of all.[^targeted-sentinel]

### Scroll offset, content height, and row width follow expand/collapse

- **Scroll offset** is kept as a number. When the content gets shorter than the offset allows, the next render clamps it (`scroller.clampToContent`, [Tree.ts:1375](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1375)). Rows above the viewport that are inserted or removed shift what is on screen by whole rows, exactly as expanding or collapsing a node above the viewport does today.[^scroll]
- **Content height** and scrollbar metrics come from `_flatRows.length` on every render pass, so they are current after the call. `getPreferredSize()` also reads `_flatRows.length` live ([Tree.ts:259](packages/lib/src/typescript/lib/component/tree/Tree.ts#L259)); like expand and collapse, the new calls do not notify the parent that the preferred height changed.
- **Widest-row maximum**: a structural call goes through `_flatten`, which resets `_maxContentWidth` ([Tree.ts:713-717](packages/lib/src/typescript/lib/component/tree/Tree.ts#L713-L717)) — the same reset expand and collapse pay. `notifyNodeChanged` does not reset it: the flattened set is unchanged, so the running maximum stays valid and a grown label widens it on the same pass.[^width]

### Accessibility stays correct through the rebind and one extra call

`aria-level`, `aria-setsize`, `aria-posinset` and `aria-expanded` are written by `TreeRow.setRowData` ([TreeRow.ts:266-269](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L266-L269)). `isBoundTo` compares depth, set size, position and the caret flags, so every row whose values change is rebound (see the insert table above), and no other. Each structural call then calls `_updateActiveDescendant()` ([Tree.ts:1321](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1321)) after its render, so `aria-activedescendant` names the focused node's row, or is cleared when the focus node was removed.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/tree/Tree.ts — class Tree (unchanged base: VirtualRowView<TreeRow, TreeOptions>)

insertNode(parent: TreeNode | null, index: number, node: TreeNode): this;
removeNode(node: TreeNode): this;
setChildren(parent: TreeNode | null, children: TreeNode[]): this;
notifyNodeChanged(node: TreeNode): this;
```

No new state-bearing property, option, event, type export, or barrel change. The one new type, `NodeLocation`, is module-private (not exported), next to `FlatRow`.

---

## Internal Structure

### `NodeLocation` — new module-private interface, directly after `FlatRow` ([Tree.ts:56-61](packages/lib/src/typescript/lib/component/tree/Tree.ts#L56-L61))

```typescript
/**
 * Where a node sits in the tree: the array that holds it, that array's owner
 * (`null` for the root array), and the node's index in it.
 */
interface NodeLocation {
    parent:   TreeNode | null;
    siblings: TreeNode[];
    index:    number;
}
```

### Public methods — placed directly after `setNodes` ([Tree.ts:295](packages/lib/src/typescript/lib/component/tree/Tree.ts#L295)), in this order

```typescript
    /**
     * Inserts `node` among `parent`'s children at `index`, keeping every other
     * node's expansion, selection, lazy-load state and the scroll offset.
     *
     * @param parent - The node to insert under, or `null` for the root level.
     * @param index - The position among `parent`'s children, clamped to
     *   `[0, length]`: a negative index prepends, one past the end appends.
     * @param node - A node this tree does not already hold. It starts
     *   collapsed and unselected.
     *
     * @returns This tree, for method chaining.
     *
     * @remarks
     * Writes into the array the tree already holds — `parent.children`
     * (created when absent) or the root array — so {@link getNodes} and
     * `parent.children` show the insert. Emits no event. A lazy `parent`
     * counts as loaded afterwards; see {@link setChildren}.
     */
    insertNode(parent: TreeNode | null, index: number, node: TreeNode): this {
        const siblings = this._childrenOf(parent);
        const at       = Math.max(0, Math.min(index, siblings.length));

        siblings.splice(at, 0, node);
        this._commitStructureChange(parent);

        return this;
    }

    /**
     * Removes `node`, and every node under it, from the tree.
     *
     * @param node - The node to remove, at any depth. A node this tree does
     *   not hold is ignored.
     *
     * @returns This tree, for method chaining.
     *
     * @remarks
     * The removed nodes leave the expanded, selected and loaded sets; the
     * anchor and focus are cleared when either was among them; a lazy load in
     * flight for one of them is dropped and its `expandNodeAsync` promise
     * resolves `false`. No event fires — not `"selection"` when a selected
     * node goes, not `"collapse"` when an expanded one does — because, as with
     * {@link selectNode}, the caller made the change. Read
     * {@link getSelectedNodes} afterwards when the new selection matters.
     */
    removeNode(node: TreeNode): this {
        const location = this._locate(node);

        if (location === null) {
            return this;
        }

        location.siblings.splice(location.index, 1);
        this._commitStructureChange(location.parent);

        return this;
    }

    /**
     * Replaces `parent`'s children with `children`, keeping the state of
     * every node the tree still holds afterwards.
     *
     * @param parent - The node whose children to replace, or `null` for the
     *   root level.
     * @param children - The new child list, stored by reference. Pass the
     *   same node object for an entry that survives: it keeps its expansion,
     *   its loaded children and its selection. A new object starts collapsed
     *   and unselected. An object left out is removed as by
     *   {@link removeNode}.
     *
     * @returns This tree, for method chaining.
     *
     * @remarks
     * Unlike {@link setNodes}, which resets the whole tree,
     * `setChildren(null, roots)` replaces the root list and keeps every
     * surviving node's state.
     *
     * The caller owns `parent`'s children from here on: a lazy `parent`
     * counts as loaded, so expanding it never calls `loadChildren`, and a
     * load already in flight for it is dropped — its result is discarded and
     * its `expandNodeAsync` promise resolves `false`. {@link insertNode} and
     * {@link removeNode} treat the parent they change the same way. Emits no
     * event.
     */
    setChildren(parent: TreeNode | null, children: TreeNode[]): this {
        if (parent === null) {
            this._nodes = children;
        } else {
            parent.children = children;
        }

        this._commitStructureChange(parent);

        return this;
    }

    /**
     * Re-renders `node`'s row after the caller changed the node in place —
     * its `label`, its `data` (which a renderer such as
     * [`IconLabelTreeNodeRenderer`](/api/component/tree/classes/IconLabelTreeNodeRenderer)
     * may read to pick an icon), or `hasChildren`.
     *
     * @param node - The node that changed.
     *
     * @returns This tree, for method chaining.
     *
     * @remarks
     * Only a row currently showing `node` is rebuilt. A node with no row on
     * screen needs nothing: it renders its current fields whenever it next
     * scrolls into view. A change to `children` is not covered — use
     * {@link setChildren}, which also keeps the tree's state in step. Emits
     * no event.
     */
    notifyNodeChanged(node: TreeNode): this {
        let found = false;

        for (let slot = 0; slot < this._rowPool.length; slot++) {
            if (this._boundIndices[slot] >= 0 && this._rowPool[slot].getNode() === node) {
                // Forced-rebind sentinel, read by `_bindAndMeasure`: `isBoundTo`
                // cannot see a change to a node the row already holds.
                this._boundIndices[slot] = -1;
                found = true;
            }
        }

        if (found) {
            this.renderWindow();
        }

        return this;
    }
```

The `IconLabelTreeNodeRenderer` reference uses the markdown-link form `setRendererFactory`'s JSDoc already uses ([Tree.ts:645-651](packages/lib/src/typescript/lib/component/tree/Tree.ts#L645-L651)), since `Tree.ts` does not import that class. Do not `{@link}` any of the private helpers below from these public comments (CODE_CONVENTIONS.md, *Don't `{@link}` internal symbols from public JSDoc*).

### Private helpers — placed directly after `_reflattenAndRender` ([Tree.ts:749](packages/lib/src/typescript/lib/component/tree/Tree.ts#L749)), in this order

```typescript
    /**
     * Returns the array holding `parent`'s children — the root array for
     * `null` — first giving a node with no `children` an empty one.
     *
     * @param parent - The node whose child array to return, or `null`.
     * @returns The live array the tree reads when flattening.
     */
    private _childrenOf(parent: TreeNode | null): TreeNode[] {
        if (parent === null) {
            return this._nodes;
        }

        if (parent.children === undefined) {
            parent.children = [];
        }

        return parent.children;
    }

    /**
     * Finds where `node` sits: the root array first, then every node's
     * `children`, depth-first, collapsed branches included.
     *
     * @param node - The node to find.
     * @returns The node's location, or `null` when this tree does not hold it.
     */
    private _locate(node: TreeNode): NodeLocation | null {
        const search = (parent: TreeNode | null, siblings: TreeNode[]): NodeLocation | null => {
            const index = siblings.indexOf(node);

            if (index >= 0) {
                return { parent, siblings, index };
            }

            for (const child of siblings) {
                const found = child.children ? search(child, child.children) : null;

                if (found !== null) {
                    return found;
                }
            }

            return null;
        };

        return search(null, this._nodes);
    }

    /**
     * Collects every node reachable from the root array through `children`,
     * whether or not its ancestors are expanded.
     *
     * @returns The reachable nodes.
     */
    private _reachableNodes(): Set<TreeNode> {
        const reachable = new Set<TreeNode>();

        const walk = (nodes: TreeNode[]): void => {
            for (const node of nodes) {
                reachable.add(node);

                if (node.children) {
                    walk(node.children);
                }
            }
        };

        walk(this._nodes);

        return reachable;
    }

    /**
     * Drops every piece of per-node state held for a node the tree no longer
     * holds: expanded, selected, loading and loaded membership, a pending
     * expansion, and the anchor or focus. Dropping a loading node orphans its
     * in-flight load the same way `setNodes` does.
     */
    private _pruneDetachedState(): void {
        const reachable = this._reachableNodes();

        for (const set of [this._expandedNodes, this._selectedNodes, this._loadingNodes, this._loadedNodes]) {
            for (const node of set) {
                if (!reachable.has(node)) {
                    set.delete(node);
                }
            }
        }

        for (const node of this._pendingExpansions.keys()) {
            if (!reachable.has(node)) {
                this._pendingExpansions.delete(node);
            }
        }

        if (this._anchorNode !== null && !reachable.has(this._anchorNode)) {
            this._anchorNode = null;
        }

        if (this._focusNode !== null && !reachable.has(this._focusNode)) {
            this._focusNode = null;
        }
    }

    /**
     * Hands `parent`'s children to the caller: drops a lazy load in flight
     * for it and records a lazy `parent` as loaded. No-op for the root level.
     *
     * @param parent - The node a structural call just changed, or `null`.
     */
    private _supersedeLoad(parent: TreeNode | null): void {
        if (parent === null) {
            return;
        }

        this._loadingNodes.delete(parent);
        this._pendingExpansions.delete(parent);

        if (parent.loadChildren !== undefined) {
            this._loadedNodes.add(parent);
        }
    }

    /**
     * The shared tail of `insertNode`, `removeNode` and `setChildren`, run
     * after the child array has been changed.
     *
     * @param parent - The node whose children changed, or `null` for the root level.
     *
     * @remarks
     * `_supersedeLoad` runs before `_pruneDetachedState`, so a `parent` that
     * is itself no longer in the tree is removed from `_loadedNodes` again.
     * `_updateActiveDescendant` runs after the render, when the focused
     * node's row is bound.
     */
    private _commitStructureChange(parent: TreeNode | null): void {
        this._supersedeLoad(parent);
        this._pruneDetachedState();
        this._reflattenAndRender();
        this._updateActiveDescendant();
    }
```

Deleting from a `Set` or `Map` while a `for…of` iterates it is well-defined in JavaScript (an entry deleted before it is reached is skipped), so `_pruneDetachedState` needs no snapshot copy.

### `_ensureChildrenLoaded` — the reveal guard ([Tree.ts:514-520](packages/lib/src/typescript/lib/component/tree/Tree.ts#L514-L520))

Current:

```typescript
            try {
                const children = await node.loadChildren();

                node.children = children;
                this._loadedNodes.add(node);

                return children;
            } catch {
```

New:

```typescript
            try {
                const children = await node.loadChildren();

                // A structural call, or an expand-driven load, supplied this
                // node's children while this load was in flight. Keep those
                // rather than overwrite them with this result.
                if (this._loadedNodes.has(node)) {
                    return node.children ?? [];
                }

                node.children = children;
                this._loadedNodes.add(node);

                return children;
            } catch {
```

---

## Ordered Implementation Steps

1. **Tests first** — in `packages/lib/tests/component/tree/Tree.test.ts`, add a new top-level `describe('Tree — node-level updates', …)` after the `'Tree — rebind gating after a reflatten (isBoundTo)'` block (ends before [Tree.test.ts:1872](packages/lib/tests/component/tree/Tree.test.ts#L1872)). Write one `it` per case in `## Expected Behaviour`. Extend the `TreePrivate` interface ([Tree.test.ts:331-343](packages/lib/tests/component/tree/Tree.test.ts#L331-L343)) with `_loadingNodes: Set<TreeNode>`, `_pendingExpansions: Map<TreeNode, Promise<boolean>>`, `_focusNode: TreeNode | null`. For render-path cases, mount like `mountBranches` ([Tree.test.ts:1540-1548](packages/lib/tests/component/tree/Tree.test.ts#L1540-L1548)) inside `beforeEach(() => installTestDOM(CONFIG))` / `afterEach(() => DOM.reset())`, and reuse the module-level `ROW_HEIGHT` ([Tree.test.ts:1241](packages/lib/tests/component/tree/Tree.test.ts#L1241)). Check: `cd packages/lib && npx vitest run tests/component/tree/Tree.test.ts` — the new cases fail (methods missing), every existing case passes.
2. **`Tree.ts` — `NodeLocation`**: add the interface from `## Internal Structure` directly after `FlatRow` ([Tree.ts:56-61](packages/lib/src/typescript/lib/component/tree/Tree.ts#L56-L61)).
3. **`Tree.ts` — private helpers**: add `_childrenOf`, `_locate`, `_reachableNodes`, `_pruneDetachedState`, `_supersedeLoad`, `_commitStructureChange` directly after `_reflattenAndRender` ([Tree.ts:749](packages/lib/src/typescript/lib/component/tree/Tree.ts#L749)), exactly as in `## Internal Structure`.
4. **`Tree.ts` — public methods**: add `insertNode`, `removeNode`, `setChildren`, `notifyNodeChanged` directly after `setNodes` ([Tree.ts:295](packages/lib/src/typescript/lib/component/tree/Tree.ts#L295)), with the JSDoc shown. Check: `grep -n "_boundIndices.fill(-1)" packages/lib/src/typescript/lib/component/tree/Tree.ts` still reports exactly two lines (`setNodes`, `setRendererFactory`) — no structural call forces a blanket rebind.
5. **`Tree.ts` — `_ensureChildrenLoaded`**: add the `_loadedNodes.has(node)` guard after the `await` ([Tree.ts:515](packages/lib/src/typescript/lib/component/tree/Tree.ts#L515)), as in `## Internal Structure`.
6. **`Tree.ts` — doc comments** (no logic):
   - Class JSDoc, second paragraph ([Tree.ts:104](packages/lib/src/typescript/lib/component/tree/Tree.ts#L104)): after "Pass root nodes via {@link Tree.setNodes}." add "Change the tree afterwards one node at a time with {@link Tree.insertNode}, {@link Tree.removeNode}, {@link Tree.setChildren} and {@link Tree.notifyNodeChanged}, which keep every other node's expansion, selection and lazy-load state." Leave the first paragraph unchanged — `llms.txt` is generated from it.
   - `setNodes` `@remarks` ([Tree.ts:267-275](packages/lib/src/typescript/lib/component/tree/Tree.ts#L267-L275)): append a paragraph: "To change part of the tree without resetting the rest, use {@link insertNode}, {@link removeNode} or {@link setChildren}; to repaint one node changed in place, use {@link notifyNodeChanged}."
   - `on("selection")` `@param event` ([Tree.ts:532-533](packages/lib/src/typescript/lib/component/tree/Tree.ts#L532-L533)): replace "fires whenever the selection changes" with "fires whenever a click or key press changes the selection", and add "Programmatic changes do not fire it: {@link selectNode}, {@link setNodes}, or a {@link removeNode} / {@link setChildren} that drops a selected node."
   - `on("expand")` ([Tree.ts:586-588](packages/lib/src/typescript/lib/component/tree/Tree.ts#L586-L588)): extend "It never fires from `setNodes`, `expandAll`, or `revealByPredicate`" with ", nor from `insertNode`, `removeNode` or `setChildren` — a lazy load one of those drops fires nothing".
   - `on("collapse")` ([Tree.ts:599-600](packages/lib/src/typescript/lib/component/tree/Tree.ts#L599-L600)): extend the same sentence with ", nor when `removeNode` or `setChildren` removes an expanded node".
   - `_expandLazy` inline comment ([Tree.ts:875-877](packages/lib/src/typescript/lib/component/tree/Tree.ts#L875-L877)): "a `setNodes` that cleared the map mid-flight" → "a `setNodes` or structural call that cleared the entry mid-flight".
   - `_loadAndExpand` `@remarks` ([Tree.ts:899-901](packages/lib/src/typescript/lib/component/tree/Tree.ts#L899-L901)): "If `setNodes` swaps the dataset while the loader is in flight, it clears `_loadingNodes`" → "If `setNodes` swaps the dataset, or a structural call removes the node or takes over its children (`_pruneDetachedState`, `_supersedeLoad`), while the loader is in flight, the node leaves `_loadingNodes`".
   - `_bindAndMeasure` sentinel comment ([Tree.ts:1476-1489](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1476-L1489)): add `notifyNodeChanged` to the list of callers — "`notifyNodeChanged`, which forces only the slots showing a node its caller changed in place".
7. **`TreeNode.ts` — `children` remark** ([TreeNode.ts:23-28](packages/lib/src/typescript/lib/component/tree/TreeNode.ts#L23-L28)): extend `@remarks Omit or pass an empty array for leaf nodes.` with "Once the node is in a tree, change this list through {@link Tree.setChildren}, {@link Tree.insertNode} or {@link Tree.removeNode} rather than by assignment, so the tree keeps its rows and state in step." Check: `npx vitest run tests/component/tree/Tree.test.ts` — all cases pass.
8. **`docs/components/Tree.md`** — per `## Documentation Impact`.
9. **`docs/reference/changelog/next.md`** — per `## Documentation Impact`.
10. **Verification** — run everything in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeNode.ts` (JSDoc only) |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

`packages/lib/llms.txt` must come out of `npm run docs:llms` byte-identical (see `## Verification`); it is not edited.

---

## Expected Behaviour

All cases are unit-testable in `Tree.test.ts` unless marked **manual**. "Mounted" means `getElement(true)`, `setWidth(200)`, a `setHeight` tall enough to show every row unless the case says otherwise, then `renderWindow()`. "No event" means listeners on `"selection"`, `"expand"`, `"collapse"` and `"loaderror"` each saw zero calls.

The shared nested fixture is roots `R0` (leaf), `R1` (children `C0`, `C1`), `R2` (leaf), with `R1` expanded — flat rows `R0, R1, C0, C1, R2`.

### `insertNode`

1. On roots `[A, B]`: `insertNode(null, 1, X)` gives `getNodes()` `[A, X, B]`, the same array object as before; `insertNode(null, 99, X)` gives `[A, B, X]`; `insertNode(null, -3, X)` gives `[X, A, B]`.
2. Nested fixture, mounted: `insertNode(R1, 1, X)` gives flat rows `R0, R1, C0, X, C1, R2`; `X` is collapsed and unselected; `R1.children` is the same array object, now `[C0, X, C1]`.
3. Same call, with `setRowData` spied on every pool row beforehand: the rows showing `R0`, `R1`, `R2` get zero calls; the rows showing `C0` and `C1` get one call each (their ARIA values changed, per the insert table).
4. Same call: row `C0` reports `aria-setsize` 3 / `aria-posinset` 1; row `X` 3 / 2 and `aria-level` 2; row `C1` 3 / 3 (`getAria().getSetSize()`, `getPosInSet()`, `getLevel()`).
5. Mounted, `insertNode(P, 0, X)` where `P` is a root leaf with no `children`: `P.children` becomes `[X]`; `P`'s row now has a toggle caret (`getToggle()` non-null); `X` is not in the flat rows because `P` is collapsed.
6. Nested fixture, mounted, `selectNode(R2)`: after `insertNode(R1, 0, X)`, `getSelectedNodes()` is `[R2]`, `getSelectedNode()` is `R2`, `R1` is still in `getExpandedNodes()`, and `getAria().getActiveDescendant()` is the id of the row showing `R2`. No event.
7. Lazy `P` (`hasChildren: true`, `loadChildren` a `vi.fn`), never expanded: `insertNode(P, 0, X)`, then `expandNodeAsync(P)` resolves `true`, the flat rows are `P, X` in the same tick, and `loadChildren` was never called.

### `removeNode`

8. Nested fixture, mounted: `removeNode(C0)` gives `R1.children` `[C1]` and flat rows `R0, R1, C1, R2`. `setRowData` spies: zero calls on the rows showing `R0`, `R1`, `R2`; one call on the row showing `C1` (set size 2→1, position 2→1).
9. `removeNode` finds a node under a collapsed branch: build the nested fixture without expanding `R1`; `removeNode(C1)` leaves `R1.children` `[C0]`, and the flat rows stay `R0, R1, R2`.
10. `removeNode(Y)` for a node this tree does not hold: no array changes, and no `setRowData` call on any row.
11. Selected-and-expanded removal: nested fixture, mounted, `selectNode(C1)`, then `removeNode(R1)`: `getNodes()` is `[R0, R2]`; `getExpandedNodes()` is `[]`; `getSelectedNodes()` is `[]`; `getSelectedNode()` is `null`; `_focusNode` is `null`; `getAria().getActiveDescendant()` is `null`. No event.
12. Removing the focused node's sibling keeps focus: nested fixture, mounted, `selectNode(C1)`, `removeNode(C0)` → `getSelectedNode()` is `C1`, and `getActiveDescendant()` is the id of the row showing `C1`.
13. Emptying an eager parent: nested fixture, mounted, `removeNode(C0)` then `removeNode(C1)` → `R1`'s row loses its toggle caret (`getToggle()` null), and `R1` stays in `getExpandedNodes()` (same as `expandNodeAsync(leaf)` today). A lazy parent with `hasChildren: true` emptied the same way keeps its caret.
14. In-flight load of a removed node: lazy `L` whose loader is a held promise; `const p = tree.expandNodeAsync(L)`; `removeNode(L)`; resolve the loader with `[{ label: 'k' }]`. `await p` is `false`; `L.children` is still `undefined`; `_loadingNodes`, `_loadedNodes`, `_pendingExpansions` do not contain `L`. No event.
15. Scroll kept: mounted, 60 leaf roots, height 120 (5 rows), `setScrollY(20 * ROW_HEIGHT)`; `removeNode(nodes[0])` → `_scroller.getScrollY()` is still `480`. Scroll clamped: mounted, 10 leaf roots, height 120, `setScrollY(120)` (the maximum); remove three roots → scroll offset becomes `48` (7 rows × 24 − 120).

### `setChildren`

16. The Loom worked example (`## Architecture Decisions`): `src` and `lib` lazy with `vi.fn` loaders, loaded and expanded via `await expandNodeAsync`, `selectNode(x)`; attach the event listeners only after this setup, since the setup itself emits `"expand"`. After `setChildren(src, [lib, bTs])`: flat rows `src, lib, x, bTs, README`; `getExpandedNodes()` contains `src` and `lib`; `lib.loadChildren` was called once in total; `getSelectedNode()` is `x`; `a.ts` is in no state set. No event.
17. Stored by reference: `setChildren(P, arr)` → `P.children === arr`; `setChildren(null, roots)` → `getNodes() === roots`.
18. `setChildren(null, [R2, R1])` on the expanded nested fixture reorders the roots and keeps `R1` expanded: flat rows `R2, R1, C0, C1`; `R0` is forgotten.
19. Contrast with `setNodes`: `setChildren(null, getNodes().slice())` keeps `getExpandedNodes()` and the selection unchanged; `setNodes(getNodes())` clears both (existing behaviour, unchanged).
20. In-place-mutated array: nested fixture, `selectNode(C0)`, then `R1.children!.splice(0, 1)` (drops `C0`) and `setChildren(R1, R1.children!)` → `getSelectedNodes()` is `[]`.
21. New objects start fresh: nested fixture, `selectNode(C0)`, then `setChildren(R1, [{ label: 'C0' }, C1])` → the new object labelled `C0` is unselected (`getSelectedNodes()` is `[]`) and not expanded.
22. Superseding an expand load: lazy `P` whose loader is held; `const p = expandNodeAsync(P)`; `setChildren(P, [A])`; resolve the loader with `[B]`. `await p` is `false`; `P.children` is the `[A]` array passed; `P` is not in `getExpandedNodes()`; `_loadingNodes` does not contain `P`, and (mounted) the row showing `P` has its toggle caret back (`getToggle()` non-null). A second `expandNodeAsync(P)` then resolves `true` and the loader's call count stays 1.
23. Superseding a reveal load: lazy `P` (root), loader held; `const r = revealByPredicate(d => d === 'target')`; `setChildren(P, [T])` with `T.data === 'target'`; resolve the loader with `[{ label: 'other' }]`. `await r` is `T`; `P.children` is the `[T]` array passed.
24. Supersede marks loaded: lazy `P` (root) never expanded; `setChildren(P, [])` → `expandNodeAsync(P)` resolves `true`, `getExpandedNodes()` contains `P`, the flat rows are just `P` (an expanded, empty parent), and `loadChildren` was never called.

### `notifyNodeChanged`

25. Mounted `mountBranches(3, …)`-style tree: set `nodes[1].label = 'renamed'`, spy `setRowData` on every pool row, call `notifyNodeChanged(nodes[1])` → exactly one call in total, on the row showing `nodes[1]`, and that row's `LabelTreeNodeRenderer.getLabel().getText()` is `'renamed'`.
26. With `IconLabelTreeNodeRenderer(resolver)` where `resolver` is a `vi.fn` returning `(node.data as { dir: boolean }).dir ? 'folder' : 'file'`: change `node.data` to `{ dir: true }`, call `notifyNodeChanged(node)` → `resolver`'s last call received `node` and returned `'folder'`.
27. A node with no row on screen (under a collapsed parent, or not held at all): `notifyNodeChanged` makes no `setRowData` call on any row. After expanding the collapsed parent, the node's row shows its new label.
28. `notifyNodeChanged` changes no flat rows, no expansion and no selection, and emits no event. It is a no-op without throwing on a tree with no element.
29. Width: mounted, `rowOverflow` default, a visible node relabelled wider than the viewport (use a label from the test font's characters, e.g. `'WoWoWoWoWoWoWoWoWoWo'`, as the existing width tests do) → after `notifyNodeChanged`, `_lastRowWidth` is greater than the viewport width.

### Existing behaviour that must stay green

30. Every existing `Tree.test.ts` case passes unchanged, in particular `'setNodes() called again with the SAME node objects (content mutated in place) still re-renders the change'` and the `revealByPredicate` block.

### Manual

31. **manual** — in a real browser, on a scrolled, densely expanded tree with a selected row: `insertNode`, `removeNode` and `setChildren` above, inside and below the viewport show no collapse flash; the selection tint, focus ring and scroll offset stay; rows untouched by the change keep their DOM elements (same `id` in the Elements panel). `notifyNodeChanged` repaints only its row.

---

## Verification

From the worktree root:

- `npm run typecheck` — clean (clean on `master` at planning time).
- `npm run lint` — clean (the `component/tree/` files lint clean on `master` at planning time).
- `npm test` — clean (runs `typecheck:test`, then the whole vitest suite).
- `grep -n "_boundIndices.fill(-1)" packages/lib/src/typescript/lib/component/tree/Tree.ts` — exactly two matches, in `setNodes` and `setRendererFactory`.
- `npm run docs:api` — adds no warning. `master` already carries 14 unrelated warnings (`MarkdownViewer`, `MarkdownEditor`, `SpatialNavigation`, `FieldDecorator`) at planning time; the count must not rise, and no warning may name `Tree` or `TreeNode`.
- `npm run docs:llms:check` (coverage OK), then `npm run docs:llms` and `git status --short` — no `llms.txt` file changed (confirmed a no-op on `master` at planning time).
- **Manual (case 31)**: `npm run dev` (start it on a spare port if one is already running). In `packages/lib/src/typescript/MiscPanel.ts`'s "Show large tree (variable-width rows)" content factory, temporarily add `(globalThis as any).demoTree = tree;` after `tree.expandAll();` — **do not commit this line**. Open *Misc. → Show large tree*, scroll to the middle, click a row, then in the devtools console call `demoTree.removeNode(…)`, `demoTree.insertNode(…)`, `demoTree.setChildren(…)` with nodes read from `demoTree.getNodes()`, and relabel one visible node followed by `demoTree.notifyNodeChanged(…)`. Check the points in case 31, then revert `MiscPanel.ts`.

---

## Documentation Impact

No export or barrel change: the four methods are on the already-exported `Tree`, and `NodeLocation` is module-private. `packages/lib/llms.txt` indexes components by task, not methods, and its `Tree` row comes from the class JSDoc's first paragraph, which step 6 leaves alone — so it needs no edit (the same call `plans/implemented/tab-set-glyph.md` made for methods on existing components).

| Page | Change |
|---|---|
| `packages/lib/docs/components/Tree.md` | **Intro** ([Tree.md:3](packages/lib/docs/components/Tree.md#L3)): after the `setNodes(nodes[])` sentence, add "Change it afterwards one node at a time — see [Updating nodes](#updating-nodes)." **New section `## Updating nodes`**, placed after `## Expansion state` (before `## Common methods`): a four-row table (`insertNode(parent, index, node)`, `removeNode(node)`, `setChildren(parent, children)`, `notifyNodeChanged(node)` — one-line purpose each; `parent` `null` = root level); one paragraph stating the rule "a node keeps its expansion, selection and loaded children for as long as the tree holds it; reuse the same object to keep it"; the re-list example below; one paragraph "none of these emit events — read `getSelectedNodes()` after a removal"; one sentence that a structural call on a lazy node makes its children caller-owned (it counts as loaded; an in-flight load is dropped). **`## Expansion state`** ([Tree.md:91](packages/lib/docs/components/Tree.md#L91)): after "`setNodes()` clears the expanded set (also silently)" add "; `setChildren(null, roots)` replaces the roots without clearing it". **`## Common methods`** table: add rows for the four methods, linking to `#updating-nodes`. **`## Custom row renderers`** ([Tree.md:163](packages/lib/docs/components/Tree.md#L163)): add "`notifyNodeChanged(node)` re-runs `update()` for that node's row." |
| `packages/lib/docs/reference/changelog/next.md` | `## Added` → `### Components` ([next.md:115](packages/lib/docs/reference/changelog/next.md#L115)): one bullet — "**`Tree` gains `insertNode`, `removeNode`, `setChildren` and `notifyNodeChanged`**, for changing a tree one node at a time without `setNodes`' reset." Then: every node the tree still holds keeps its expansion, loaded children, selection and the scroll offset; a caller keeps a node by passing the same object again; removed nodes drop their state silently (no `"selection"` / `"collapse"`); a structural call on a lazy node counts as loading it and drops a load already in flight, including one `revealByPredicate` started; only rows whose content changed are rebound. "No consumer action is needed." |

The re-list example for `Tree.md`:

```typescript
// Re-list one folder. Reusing the node objects that survive keeps their
// expansion, their loaded children and their selection.
const existing = new Map((folder.children ?? []).map(child => [child.label, child]));
const next     = listing.map(entry => existing.get(entry.name) ?? toNode(entry));

tree.setChildren(folder, next);
```

`docs/concepts/performance.md` and `docs/recipes/virtualized-list.md` describe the pool-rebind mechanism, which this plan does not change; they need no edit.

---

## Potential Challenges

- **A node object must appear at most once in the tree.** This is already implied by identity-keyed state; `_locate` removes the first match in root-then-depth-first order. The `insertNode` JSDoc states the rule ("a node this tree does not already hold").
- **Assigning `children` directly still bypasses the tree.** A caller that assigns `node.children = …` without a tree call leaves the flattened rows stale, as today. `TreeNode.children`'s new remark points at the three calls.
- **A move is a remove plus an insert.** `removeNode(X)` then `insertNode(B, i, X)` drops `X`'s state in between, because `X` is unreachable after the first call. This is intended; see `## Non-Goals`.
- **Re-inserting a node whose own load is still in flight** can let the old load commit and the new `expandNodeAsync` resolve `false`. `setNodes` with the same node objects has the same edge today; the identity-checked `_pendingExpansions` cleanup ([Tree.ts:875-882](packages/lib/src/typescript/lib/component/tree/Tree.ts#L875-L882)) keeps the map consistent. Not addressed.
- **Cost of the walks.** Each structural call walks every node the tree holds once (`_reachableNodes`), plus once more for `removeNode` (`_locate`). This is linear in held nodes (a few thousand for a large project tree), run once per call — fine for user- or watcher-driven changes, not for a per-frame loop.
- **Offline render tests need a scroller.** `renderWindow` returns early without an element; the render-path cases must mount (`getElement(true)`, sizes, `renderWindow()`), as the `'rebind gating'` block does.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts) — `setNodes` (277), `selectNode` (391), `_ensureChildrenLoaded` (508), `_flatten` (709), `_reflattenAndRender` (746), `_expand` / `_expandLazy` / `_loadAndExpand` (829-942), `_updateActiveDescendant` (1321), `renderWindow` (1358), `_bindAndMeasure` (1463).
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts:447-517`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L447-L517) — `reconcilePoolByKey`, including why a `-1` slot is never matched.
- [`packages/lib/src/typescript/lib/component/tree/TreeRow.ts:183-272`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L183-L272) — `isBoundTo` and `setRowData` (the ARIA writes).
- [`packages/lib/src/typescript/lib/data/AbstractStore.ts:815-951`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L815-L951) — `insert`, `remove`, `notifyRecordChanged`: the naming precedent.
- [`packages/lib/src/typescript/lib/component/table/Table.ts:1349-1370`](packages/lib/src/typescript/lib/component/table/Table.ts#L1349-L1370) — `onSourceStoreChange`'s presence check, the precedent for pruning by presence.
- [`plans/implemented/tree-expand-observability.md`](plans/implemented/tree-expand-observability.md) — the "bulk methods stay silent" and orphaned-load decisions this plan extends.
- [`plans/implemented/tree-row-toggle-rebind-perf.md`](plans/implemented/tree-row-toggle-rebind-perf.md) and [`plans/implemented/tree-row-pool-identity-reconciliation.md`](plans/implemented/tree-row-pool-identity-reconciliation.md) — why `setNodes` keeps its blanket rebind and how the identity reconciliation works.
- [`packages/lib/tests/component/tree/Tree.test.ts`](packages/lib/tests/component/tree/Tree.test.ts) — `TreePrivate` (331), `ROW_HEIGHT` (1241), `mountBranches` (1540), the in-flight orphan test (759).
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — *Don't `{@link}` internal symbols from public JSDoc*.

---

## Non-Goals

- **No key option or keyed reconcile inside `Tree`.** Identity is the key; see `## Architecture Decisions`.
- **No new events** (`"insert"`, `"remove"`, …). The caller made the change.
- **No move or reparent primitive.** Moving a node with `removeNode` then `insertNode` drops its state in between; only a node that stays reachable through a single `setChildren` call keeps it.
- **No scroll anchoring** (keeping the first visible row still when rows above it change). The offset is kept as a number, matching expand/collapse and Loom's current replay.
- **No preferred-size notification when the row count changes.** Expand and collapse do not send one either; adding it is a separate change covering all four paths.
- **No ARIA-only fast path in `TreeRow.setRowData`.** A sibling whose `aria-setsize` / `aria-posinset` changes goes through a full rebind, as it does on expand today.
- **No change to `setNodes`' behaviour**: it keeps its reset and its blanket rebind (step 6 touches only its JSDoc).
- **No fix for `revealByPredicate` walking a subtree that a concurrent `removeNode` or `setNodes` detached.** That race predates this plan; the guard in step 5 covers only a parent whose children were taken over.
- **No fix for `_updateActiveDescendant` matching a hidden pool slot that still references the focused node.** Pre-existing and shared with plain scrolling.
- **`Tree.md`'s "Common methods" row for a `collapseAll()` that `Tree` does not have** is pre-existing and left alone.
- **No `TreeStore`, `TreeTable` or Loom change.** Loom's adoption is a separate Loom plan.

---

## Notes

[^naming]: `TabBar` (`createBarEntry` / `removeBarEntry` / `moveBarEntry`) and `ScrollStrip` (`addItem` / `removeItem` / `moveItem`) were also checked. Both manage child components, not a data model, so the store's record-level verbs are the closer match. `AbstractSelectableList` offers only `setItems` (reset) and `addItem` (append), with no positional insert, remove, or in-place update to borrow. For the in-place update, `updateNode(node, patch)` (the tree applies a patch) and `refreshNode(node)` were considered. The patch form conflicts with the idiom `setNodes`' own JSDoc already documents — the caller mutates node objects and hands them back — and `notifyRecordChanged` is the library's name for exactly that hand-back on a record. `Component.notifyIntrinsicSizeChanged()` uses "notify" the same way: the caller tells the component that something it cannot observe has changed.

[^identity-not-keys]: Three shapes were weighed for Loom's re-list.
    (1) **Keyed reconcile inside `Tree`** (a `nodeKey` option; the tree matches fresh objects to old ones by key). `TreeStore` and `TreeBody` key expansion by record id, and `AbstractSelectableList.refreshFromStore` re-locates its anchor by item key ([AbstractSelectableList.ts:1647-1672](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1647-L1672)). But they key by id because they rebuild their node wrappers on every change — `TreeStore.buildChildNodes` constructs a new `TreeNode` per record on every `applyView` ([TreeStore.ts:307-321](packages/lib/src/typescript/lib/data/TreeStore.ts#L307-L321)) — so identity cannot survive there. `Tree`'s nodes are caller-owned objects with no key field. Keying them would mean either grafting the old node's `children` onto the new object, or moving five sets, the anchor, the focus and every in-flight load closure (which captured the old object) across to the new one. Both are invasive, and the load closures cannot be moved at all.
    (2) **Consumer-composed `insertNode` / `removeNode`.** Loom would diff the listing itself, compute sorted insertion indexes, and make one call per changed entry — one reflatten and render each. `setChildren` does the whole directory in one pass, and the consumer only needs a path-to-node `Map` over the folder's current children.
    (3) **`setChildren` with reused survivors** is the chosen shape. It needs no new concept, and it matches `setNodes`' documented "hand back the same node objects" idiom.
    For the separate Loom plan: `FileTree.flushPendingRefresh` coalesces changed directories with `minimalRoots`, which assumes that refreshing `/a` also rebuilds every loaded directory beneath it (today `expandPaths` re-reads them). With `setChildren`, only the directory passed changes, so Loom will need to re-list each changed, loaded directory rather than only the minimal roots.

[^reachability]: The alternative was to compute the removed set directly — old children minus new children, then each removed node's subtree. That diff has two holes. A caller that mutates `children` in place and then passes the same array (`parent.children.splice(i, 1); setChildren(parent, parent.children)`) leaves nothing to diff against, so the removed node's selection and loaded state would leak. And a node moved up a level in one call (a folder flattened into its parent) would be pruned from under its old parent even though it is still in the tree. The reachability sweep answers "is it still in the tree?" directly, so both cases come out right, and the same code serves all three structural calls. `Body` does not prune: it tolerates "a since-removed/filtered record" in its selection ([Body.ts:322-324](packages/lib/src/typescript/lib/component/table/Body.ts#L322-L324)). `Tree` diverges for three reasons. A removed `Tree` node has no store to come back from, so keeping it only makes `getSelectedNodes()` and `getExpandedNodes()` report nodes that are not displayed. Without pruning, `_loadedNodes` in a long-running Loom session would grow by every node a watcher refresh drops. And the part of `Body`'s tolerance that is about filtering already has a `Tree` counterpart that this plan keeps: a node under a collapsed parent stays reachable, so its state survives.

[^no-events]: `Table.onSourceStoreChange` does emit `"selection"` when its rotated record disappears. There, a store the table does not control removed the record, so the table's consumer did not make the change. `Tree` has no external data source: the consumer is always the one calling. `plans/implemented/tree-expand-observability.md` ("Only single-node toggles emit; the bulk methods stay silent") set the same rule for `setNodes`, `expandAll` and `revealByPredicate`. Emitting `"selection"` here would also re-run selection-driven side effects for whichever node is still selected: Loom's `handleSelection` opens a selected file in its preview tab.

[^supersede]: Without the takeover, a load in flight for `parent` would overwrite the children the caller just supplied when it lands (`_loadAndExpand` writes `node.children = children`, [Tree.ts:922](packages/lib/src/typescript/lib/component/tree/Tree.ts#L922)), and the state of the caller's nodes would then leak. Dropping the load matches what `setNodes` already does to every load, so no new failure mode is introduced. Marking a lazy parent loaded keeps one rule for all three calls. Otherwise `insertNode(P, 0, X)` followed by `removeNode(X)` would leave `P` with an empty, unloaded child list, and the next expansion would call the loader again and replace whatever the caller had arranged. The reveal path (`_ensureChildrenLoaded`) calls `loadChildren` directly and writes the result unconditionally, so it needs its own check. Checking `_loadedNodes` after the `await` also fixes a pre-existing race between a reveal and an expand-driven load of the same node, where the later result used to overwrite the earlier one. Loom itself is not expected to hit these cases, since it refreshes only directories that have already loaded; the rule exists so the API behaves predictably for every consumer.

[^targeted-sentinel]: A slot whose `_boundIndices` entry is already `-1` is skipped. It is either past the window (hidden, and rebound when it comes back) or already due a forced rebind. So `found` is true only for a live binding, and a node with no row on screen costs a pool scan and no render. When `notifyNodeChanged` runs, `_flatRowsDirty` is false, so `renderWindow` takes `alignPoolWindow` (no rotation, since the window did not move) and the marked slot rebinds in place. If a reflatten were somehow still pending, `reconcilePoolByKey` would skip the `-1` slot and hand the node another slot, which is rebound anyway — correct either way. `invalidateGeom()` is not needed: `_positionRows` already re-lays out a rebound row's children.

[^scroll]: Anchoring to the first visible row was rejected for this plan. It is a separate behaviour that expand and collapse do not have either, and Loom's current rebuild restores the numeric offset (`setScrollY(scrollY)`), so keeping the number matches what users see today without the collapse-and-replay flash.

[^width]: Resetting `_maxContentWidth` on every structural call keeps one rule — every change to the flattened set resets it, as the field's own comment says ([Tree.ts:144-151](packages/lib/src/typescript/lib/component/tree/Tree.ts#L144-L151)). A removal needs the reset so the horizontal extent can shrink. An insert would not strictly need it, but expand (also add-only) already resets, and the next render re-derives the width from the visible rows. `notifyNodeChanged` keeps the maximum because nothing left the flattened set. A label that shrank therefore leaves the old width until the next reflatten — the same "never shrinks while the set is unchanged" behaviour that keeps the horizontal scrollbar from jittering during scroll.
