---
touches-shared:
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
  - packages/lib/tests/component/tree/TreeExpandMotion.test.ts
  - packages/lib/docs/components/Tree.md
  - packages/lib/docs/reference/changelog/next.md
---

# Tree Move Node — Implementation Plan

## Overview

`Tree` ([packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts)) keeps every piece of per-node state — expansion, selection, the selection anchor, the focus node, loaded and loading lazy nodes — in sets keyed by node identity ([Tree.ts:241-293](packages/lib/src/typescript/lib/component/tree/Tree.ts#L241-L293)). Its node-level calls `insertNode`, `removeNode`, `setChildren` and `notifyNodeChanged` ([Tree.ts:471-583](packages/lib/src/typescript/lib/component/tree/Tree.ts#L471-L583)) keep that state for every node the tree still holds after the call, and drop it for every node it no longer holds. There is no call that moves a node. The only way to move one is `removeNode` then `insertNode`, and the remove drops the state of the node and of every node under it before the insert brings the node back. The Loom code editor hits this when a renamed or moved folder collapses and loses its selection.

This plan adds one public method, `Tree.moveNode(node, parent, index)`. It moves a node the tree holds, with everything under it, to position `index` among `parent`'s children, in one structural change. Because the node never leaves the tree, it and every node under it keep their state. A rename that changes where a node sorts is a move within the same parent, followed by the existing `notifyNodeChanged(node)` to repaint the new label. No other public API is added.

The change touches `Tree.ts` (the method, one private helper, and JSDoc that lists the node-level calls), `TreeNode.ts` (two JSDoc lists), two test files and two doc pages. The data-layer `TreeStore` does not have this gap and is not changed.[^treestore] *Addendum: Structural calls today* records what each existing call does to the tree's state and what Loom can and cannot do with them.[^addendum]

---

## Architecture Decisions

### `moveNode` is a fourth structural call on the same shared tail

`moveNode` follows `removeNode` ([Tree.ts:498](packages/lib/src/typescript/lib/component/tree/Tree.ts#L498)) and `insertNode` ([Tree.ts:471](packages/lib/src/typescript/lib/component/tree/Tree.ts#L471)) step for step: find the node with `_locate`, get the target array with `_childrenOf`, clamp the index the way `insertNode` does, splice the live arrays, then run `_commitStructureChange` ([Tree.ts:1441](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1441)). That tail bumps `_structureGeneration`, hands the changed parent's children to the caller, prunes detached state, reflattens, renders and re-points `aria-activedescendant`.[^precedent] Nothing is detached by a move, so the prune finds nothing to drop, and every node keeps its state with no new bookkeeping.

### Signature mirrors `insertNode`, with the node first

```typescript
moveNode(node: TreeNode, parent: TreeNode | null, index: number): this
```

`parent` and `index` mean what they mean in `insertNode(parent, index, node)`. The node comes first because it is a node the tree already holds, as in `removeNode(node)`. `index` is required, as in `insertNode`.[^index-required]

### `index` is the node's position after the move

The node is taken out of its current array first; `index` is then clamped to `[0, length]` of the target array and the node is inserted there. So `index` is always where the node ends up, whether or not it changes parent.[^index-meaning]

| Before | Call | After |
|---|---|---|
| `P: [a, b, c, d]` | `moveNode(b, P, 3)` | `P: [a, c, d, b]` |
| `P: [a, b, c, d]` | `moveNode(c, P, 0)` | `P: [c, a, b, d]` |
| `P: [a, b, c, d]` | `moveNode(b, P, 99)` | `P: [a, c, d, b]` |
| `P: [a, b, c, d]` | `moveNode(b, P, -1)` | `P: [b, a, c, d]` |
| `P: [a, b, c, d]`, `Q: [x]` | `moveNode(b, Q, 0)` | `P: [a, c, d]`, `Q: [b, x]` |

### A move to the current position does nothing

When `parent` is the node's current parent and the clamped index equals its current index, `moveNode` returns before touching anything: no generation bump, no reflatten, no render.[^noop]

| Before | Call | Result |
|---|---|---|
| `P: [a, b, c, d]` | `moveNode(b, P, 1)` | no-op |
| `P: [a, b, c, d]` | `moveNode(d, P, 99)` | no-op (clamps to 3, d's index) |
| `P: [a, b, c, d]` | `moveNode(d, P, 2)` | `P: [a, b, d, c]` |

### A move the tree cannot make is ignored

`moveNode` returns without changing anything when `node` is not in the tree, when `parent` is a node not in the tree, or when `parent` is `node` itself or any node under it. This mirrors `removeNode`, which ignores a node the tree does not hold, and `TreeTable.reparentRow`, which refuses a cycle ([TreeTable.ts:308](packages/lib/src/typescript/lib/component/table/TreeTable.ts#L308), [TreeTable.ts:343](packages/lib/src/typescript/lib/component/table/TreeTable.ts#L343)).[^reject] The cycle test is one walk: `_locate(parent).path` lists every node from the root down to `parent`, both ends included, so it contains `node` exactly when `parent` is `node` or sits under it.

### Both parents count as changed

A move changes two child lists, so both parents get the treatment the existing calls give the one parent they change: a lazy parent counts as loaded afterwards, and a load in flight for it is dropped (its `expandNodeAsync` resolves `false`). `moveNode` calls `_supersedeLoad(oldParent)` itself and passes the new parent to `_commitStructureChange`.[^both-parents]

Consequences, each the same as an existing call already produces:

| Situation | Result | Same as today's |
|---|---|---|
| Target is a lazy node that never loaded | Its children become `[node]`; expanding it never calls `loadChildren` | `insertNode` under it |
| Target's lazy load is in flight | The load is dropped; `expandNodeAsync` resolves `false`; the target stays collapsed with `[node]` | `insertNode` under it |
| Target is a childless leaf | It gets a `children` array and a caret, and stays collapsed | `insertNode` under it |
| Target is collapsed | The node's rows are hidden; the node keeps its own expansion and selection | collapsing an ancestor |
| Source parent left with no children | An eager parent loses its caret but stays in the expanded set; a lazy one (`hasChildren: true`) keeps its caret | `removeNode` of its last child |
| `node` or a node under it has a lazy load in flight | The load keeps running and commits where the node now is; its spinner stays | — (new: a remove-then-insert drops it) |

### No event, no scroll, no animation

`moveNode` emits nothing, like every node-level call.[^no-events] It keeps the scroll offset as a number; the render clamps it only when the content becomes too short, as `removeNode` does. It does not scroll the moved node into view.[^no-reveal] It never animates: it renders through `_reflattenAndRender`, not `_reflattenWithMotion`, and `_flatten` calls `stopRowMotion()` first ([Tree.ts:1193](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1193)), so a running expand or collapse motion stops and the rows render in their new places at once.

The focus and anchor are kept because the nodes they name stay in the tree. The tree element keeps DOM focus throughout (rows are never focused; `aria-activedescendant` names the focused row), and `_commitStructureChange` re-points `aria-activedescendant` after the render. When the focused node lands under a collapsed parent, it has no row, and `aria-activedescendant` is cleared, as it is when a collapse hides the focused node today.

### A rename is `moveNode` plus `notifyNodeChanged`

`moveNode` does not repaint a row's content. A row is rebound only when one of the eight values `TreeRow.isBoundTo` compares changes ([TreeRow.ts:181](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L181)), and `label` is not among them. A rename therefore changes `label`, moves the node to its new sorted position, and calls the existing `notifyNodeChanged(node)` ([Tree.ts:566](packages/lib/src/typescript/lib/component/tree/Tree.ts#L566)), which force-rebinds exactly the row showing the node.[^rename]

```typescript
node.label = newName;
tree.moveNode(node, parent, sortedIndex);
tree.notifyNodeChanged(node);
```

### The row-motion plan is not a dependency

`plans/tree-row-motion-no-snap.md` (in progress on `feature/tree-row-motion-no-snap`) changes `_reflattenWithMotion` and the shared `VirtualRowView` motion. `moveNode` uses neither: it reaches `_flatten`'s `stopRowMotion()`, which that plan leaves alone. The two plans edit four files in common (listed in `touches-shared`); the edits below are placed so that only `next.md` can conflict.[^shared-files]

---

## Public API

On `class Tree extends VirtualRowView<TreeRow, TreeOptions>`, placed directly after `removeNode`:

```typescript
/**
 * Moves `node`, and every node under it, to position `index` among
 * `parent`'s children. The node never leaves the tree, so it and every node
 * under it keep their expansion, selection, loaded children and any lazy
 * load in flight, and the anchor, the focus and the scroll offset stay as
 * they were.
 *
 * @param node - The node to move, at any depth.
 * @param parent - The node to move it under, or `null` for the root level.
 *   Pass `node`'s current parent to change only its position.
 * @param index - The position `node` ends up at among `parent`'s children,
 *   clamped to the valid range: a negative index puts it first, an index at
 *   or past the end puts it last.
 *
 * @returns This tree, for method chaining.
 *
 * @remarks
 * Writes into the arrays the tree already holds, as {@link insertNode} and
 * {@link removeNode} do. Both the old and the new parent count as changed:
 * a lazy one counts as loaded afterwards, and a load in flight for it is
 * dropped — see {@link setChildren}. A load in flight for `node` or a node
 * under it keeps running and commits where the node now is.
 *
 * A move to where `node` already is changes nothing. A move the tree cannot
 * make is ignored the same way: `node` or `parent` is not in this tree, or
 * `parent` is `node` itself or a node under it.
 *
 * Emits no event and never animates: a running expand or collapse animation
 * stops, and the rows render in their new places at once. The moved node is
 * not scrolled into view. Its row content is not repainted either, so after
 * changing its `label` for a rename, call {@link notifyNodeChanged}.
 */
moveNode(node: TreeNode, parent: TreeNode | null, index: number): this;
```

No option, no event, no new type. `TreeOptions`, `TreeEvent` and the `listeners` bag are unchanged: `moveNode` is a method call with no state of its own to configure.

---

## Internal Structure

```typescript
moveNode(node: TreeNode, parent: TreeNode | null, index: number): this {
    const from = this._locate(node);

    if (from === null || !this._canMoveUnder(node, parent)) {
        return this;
    }

    const sameParent = from.parent === parent;
    const siblings   = this._childrenOf(parent);
    // The node's own slot does not count when it stays in the same array.
    const last       = sameParent ? siblings.length - 1 : siblings.length;
    const at         = Math.max(0, Math.min(index, last));

    if (sameParent && at === from.index) {
        return this;
    }

    from.siblings.splice(from.index, 1);
    siblings.splice(at, 0, node);

    this._supersedeLoad(from.parent);
    this._commitStructureChange(parent);

    return this;
}
```

```typescript
/**
 * Reports whether `parent` can take `node` as a child: it is the root level
 * or a node this tree holds, and it is neither `node` nor a node under it.
 *
 * @param node - The node being moved, which the tree holds.
 * @param parent - The candidate parent, or `null` for the root level.
 * @returns `true` when the move would not detach a node or form a cycle.
 */
private _canMoveUnder(node: TreeNode, parent: TreeNode | null): boolean {
    if (parent === null) {
        return true;
    }

    const location = this._locate(parent);

    return location !== null && !location.path.includes(node);
}
```

Ordering rules the snippet encodes:

- `_canMoveUnder` runs before `_childrenOf`, because `_childrenOf` writes `parent.children = []` on a childless node; a rejected move must leave every node untouched.
- The no-op check runs before any splice, so a no-op changes no array.
- `_supersedeLoad(from.parent)` runs before `_commitStructureChange(parent)`. When both are the same node it runs twice; the second run changes nothing.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Work test-first: write Phase 1, run it, see it fail, then implement.

### Phase 1 — Tests (red first)

1. **`tests/component/tree/Tree.test.ts`**:
   - Add `_structureGeneration: number;` to the `TreePrivate` interface, after `_focusNode` (line 411).
   - Inside `describe('Tree — node-level updates', …)` (line 2048), insert a `// --- moveNode ---…` divider (same width as the `// --- notifyNodeChanged ---…` one) and the cases MV1–MV13 from *Expected Behaviour*, directly above the `// --- notifyNodeChanged ---` divider (line 3694). Use the block's own helpers: `nestedNodes`, `mount`, `nested`, `mountedNested`, `flatLabels`, `rowFor`, `labelShownFor`, `countEvents`, `countRebinds`, `heldLazy`, `asPool`, and the file-level `asPrivate` and `ROW_HEIGHT`. Title each `it` starting with `moveNode …`.
2. **`tests/component/tree/TreeExpandMotion.test.ts`**:
   - Add one row to `STOPPERS`, directly after the `'removeNode(C)'` row (lines 418–420):
     ```typescript
     ['moveNode(C, B, 0)',
         (tree, fx) => { tree.moveNode(fx.C, fx.B, 0); },
         (tree) => { expect(asPrivate(tree)._flatRows.map(r => r.node.label)).toEqual(['A', 'B', 'C', 'b1', 'b2', 'b3', 'D']); }],
     ```
   - Add case MV14 as a new `it` directly after the `it.each(STOPPERS)` block (which ends at line 447) and before M8. Do not edit the file's header comment or M8–M15.[^shared-files]
3. **Run** `npx vitest run tests/component/tree/Tree.test.ts tests/component/tree/TreeExpandMotion.test.ts`. Expect every new case to fail with `tree.moveNode is not a function`; every existing case must still pass.

### Phase 2 — `Tree.moveNode`

4. **`src/typescript/lib/component/tree/Tree.ts`** — add `moveNode` with the JSDoc from *Public API* and the body from *Internal Structure*, directly after `removeNode` (ends line 509) and before `setChildren`'s JSDoc.
5. **Same file** — add `_canMoveUnder` from *Internal Structure* directly after `_locate` (ends line 1352).
6. **Same file** — internal JSDoc that lists the structural calls:
   - `_commitStructureChange` (line 1430): "The shared tail of `insertNode`, `removeNode` and `setChildren`" → "The shared tail of `insertNode`, `removeNode`, `setChildren` and `moveNode`".
   - `_locate`'s `@remarks` (lines 1316–1320): after "{@link removeNode} the holding array and index," insert "{@link moveNode} the moved node's array and index and the target's path,".
7. **Check**: `npm run typecheck`; rerun step 3's command — all green.

### Phase 3 — Public JSDoc lists

Edit by the quoted text; line numbers are as of this plan.

8. **`Tree.ts`** class JSDoc (lines 197–198): "{@link Tree.insertNode}, {@link Tree.removeNode},\n * {@link Tree.setChildren} and {@link Tree.notifyNodeChanged}" → "{@link Tree.insertNode}, {@link Tree.removeNode},\n * {@link Tree.moveNode}, {@link Tree.setChildren} and\n * {@link Tree.notifyNodeChanged}". Reflow only these lines.
9. **`Tree.ts`** class JSDoc line 218 only: " * structural calls (the `*` key, `expandAll`, `revealByPredicate`," → " * structural calls (the `*` key, `expandAll`, `revealByPredicate`, `moveNode`,". Leave line 219 and everything after it exactly as it is.[^shared-files]
10. **`Tree.ts`** `setNodes` `@remarks` (lines 428–430): "use\n * {@link insertNode}, {@link removeNode} or {@link setChildren}" → "use\n * {@link insertNode}, {@link removeNode}, {@link moveNode} or\n * {@link setChildren}".
11. **`Tree.ts`** `setChildren` `@remarks` (lines 533–535): "{@link insertNode} and\n * {@link removeNode} treat the parent they change the same way." → "{@link insertNode},\n * {@link removeNode} and {@link moveNode} treat the parents they change the\n * same way."
12. **`Tree.ts`** `revealByPredicate` JSDoc (lines 750–751): "The walk follows an {@link insertNode}, {@link removeNode},\n * {@link setChildren} or {@link setNodes}" → "The walk follows an {@link insertNode}, {@link removeNode},\n * {@link moveNode}, {@link setChildren} or {@link setNodes}".
13. **`Tree.ts`** `on("expand", …)` JSDoc (lines 1068–1069): "nor from `insertNode`, `removeNode` or\n *   `setChildren`" → "nor from `insertNode`, `removeNode`,\n *   `moveNode` or `setChildren`".
14. **`Tree.ts`** `expandNodeAsync` `@remarks` (lines 1513–1514): "an {@link insertNode}, {@link removeNode} or\n * {@link setChildren} that takes over" → "an {@link insertNode}, {@link removeNode},\n * {@link moveNode} or {@link setChildren} that takes over".
15. **`src/typescript/lib/component/tree/TreeNode.ts`** `children` `@remarks` (lines 27–29): "through {@link Tree.setChildren},\n     * {@link Tree.insertNode} or {@link Tree.removeNode}" → "through {@link Tree.setChildren},\n     * {@link Tree.insertNode}, {@link Tree.removeNode} or {@link Tree.moveNode}".
16. **`TreeNode.ts`** `loadChildren` `@remarks` (lines 61–63): "or when\n     * {@link Tree.insertNode}, {@link Tree.removeNode} or\n     * {@link Tree.setChildren} changed its children" → "or when\n     * {@link Tree.insertNode}, {@link Tree.removeNode}, {@link Tree.moveNode}\n     * or {@link Tree.setChildren} changed its children".
17. **Check**: `grep -n "moveNode" src/typescript/lib/component/tree/Tree.ts src/typescript/lib/component/tree/TreeNode.ts` — matches in the class JSDoc (2), `setNodes`, `setChildren`, `revealByPredicate`, `on("expand")`, `expandNodeAsync`, `_locate`, `_commitStructureChange`, the method itself, and `TreeNode.ts` (2). `npm run typecheck`.

### Phase 4 — Documentation

18. **`docs/components/Tree.md`**, *Updating nodes* section:
    - In the method table (lines 105–110), add a row after `removeNode(node)`:
      `| \`moveNode(node, parent, index)\` | Move a node, at any depth, and everything under it to position \`index\` among \`parent\`'s children, keeping its state — see [Moving and renaming a node](#moving-and-renaming-a-node). |`
    - Line 127: replace "An `insertNode`, `removeNode` or `setChildren` that changes a lazy node's children" with "An `insertNode`, `removeNode`, `setChildren` or `moveNode` that changes a lazy node's children", and replace "moving a node with `removeNode` then `insertNode` brings it back as a new node" with "`removeNode` then `insertNode` brings a node back as a new node". At the end of that same sentence ("…calls `loadChildren` afresh on its next expand."), append " Use `moveNode` to move a node and keep its state."
    - Line 129: replace "follows all three calls, and `setNodes()` too" with "follows `insertNode`, `removeNode`, `setChildren` and `moveNode`, and `setNodes()` too".
    - Insert the subsection from *Documentation Impact* after line 131 (the "Two consequences are worth knowing…" paragraph) and before `## Keyboard`.
    - Do not edit line 99 (the *Animation* paragraph).[^shared-files]
19. **`docs/components/Tree.md`**, *Common methods* table: add a row after the `setChildren(parent, children)` row (line 187):
    `| \`moveNode(node, parent, index)\` | Move one node and everything under it, keeping their state — see [Moving and renaming a node](#moving-and-renaming-a-node). |`
20. **`docs/reference/changelog/next.md`**: add the entry from *Documentation Impact* under `## Added` → `### Components`. If `## Added` does not exist, create it with its `### Components` subheading after any `## Changed` section, else after the intro paragraph. Section order on a release page is `## Breaking changes`, `## Changed`, `## Added`, `## Fixed`.
21. **Check**: `npm run docs:api` finishes with zero warnings; `npm run docs:llms:check` passes (no new class, so `llms.txt` needs no regeneration).

### Phase 5 — Whole suite

22. **Run** `npm run lint` and `npm test`. A failure outside the cases this plan adds is unexpected: stop and report it rather than changing its expectations.
23. **Manual** check V1 from *Expected Behaviour*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeNode.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/tests/component/tree/TreeExpandMotion.test.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case is unit-testable offline except V1. "Mounted" cases use the node-level block's `mount` / `mountedNested` helpers (200 px wide, 10 rows tall unless stated). `mountedNested()` gives roots `R0` (leaf), `R1{C0, C1}` (expanded), `R2` (leaf); flat rows `R0 R1 C0 C1 R2`. "Generation" is `asPrivate(tree)._structureGeneration`.

### `Tree.test.ts` — node-level updates

- **MV1 — index semantics, root level.** Unmounted `new _Tree()`, `setNodes(roots)` with `roots = [a, b, c, d]` (fresh per call). `moveNode(b, null, 3)` → `['a','c','d','b']`; `moveNode(c, null, 0)` → `['c','a','b','d']`; `moveNode(b, null, 99)` → `['a','c','d','b']`; `moveNode(b, null, -1)` → `['b','a','c','d']`. Each call returns the tree, and `getNodes()` is still the same `roots` array object.
- **MV2 — index semantics, new parent.** Roots `P{a, b, c, d}`, `Q{x}`. `moveNode(b, Q, 0)` → `P.children` is `[a, c, d]` and `Q.children` is `[b, x]`, both the same array objects as before the call. `moveNode(b, Q, 99)` on a fresh tree → `Q.children` is `[x, b]`.
- **MV3 — same position is a no-op.** Mounted roots `[a, b, c, d]`. Read generation and `_flatRows`, start `countRebinds`. `moveNode(b, null, 1)` and `moveNode(d, null, 99)`: roots unchanged, generation unchanged, `_flatRows` is the same array object (no reflatten), zero rebinds. Then `moveNode(d, null, 2)` → roots `['a','b','d','c']` and generation +1.
- **MV4 — rename within a parent keeps the subtree's state.** Mounted root `P{alpha{a1}, beta, gamma{g1}}`; expand `P`, `alpha`, `gamma`; `selectNode(g1)`; start `countEvents`. Then `gamma.label = 'aaa'`, `moveNode(gamma, P, 0)`, `notifyNodeChanged(gamma)`. `P.children` is `[gamma, alpha, beta]`; `flatLabels` is `['P','aaa','g1','alpha','a1','beta']`; `getExpandedNodes()` contains `P`, `alpha`, `gamma`; `getSelectedNodes()` is `[g1]`; `getSelectedNode()` is `g1`; `getAria().getActiveDescendant()` is `rowFor(tree, g1).getId()`; `labelShownFor(tree, gamma)` is `'aaa'`; zero events.
- **MV5 — move to a collapsed new parent keeps state, hidden.** `mountedNested()`, `selectNode(C1)`, start `countEvents`. `moveNode(R1, R2, 0)`: roots are `[R0, R2]`, `R2.children` is `[R1]`, `flatLabels` is `['R0','R2']`, `rowFor(tree, R2).getToggle()` is not null, `getExpandedNodes()` contains `R1` and not `R2`, `getSelectedNodes()` is `[C1]`, `getSelectedNode()` is `C1`, `asPrivate(tree)._focusNode` is `C1`, `getActiveDescendant()` is `null`, zero events. Then `expandNode(R2)`: `flatLabels` is `['R0','R2','R1','C0','C1']`.
- **MV6 — move into an expanded parent keeps the node's pool row.** `mountedNested()`; `const row = rowFor(tree, R0)`. `moveNode(R0, R1, 2)`: `R1.children` is `[C0, C1, R0]`; `flatLabels` is `['R1','C0','C1','R0','R2']`; `rowFor(tree, R0)` is `row` (same object); `R0`'s row ARIA `[level, setsize, posinset]` is `[2, 3, 3]`, `C0`'s is `[2, 3, 1]`.
- **MV7 — emptied source parent.** `mountedNested()`. `moveNode(C0, null, 0)` then `moveNode(C1, null, 0)`: `R1.children` is `[]`, `rowFor(tree, R1).getToggle()` is `null`, `getExpandedNodes()` contains `R1`.
- **MV8 — rejected moves.** `mountedNested()`; read generation; start `countRebinds`. Each of `moveNode(R1, C0, 0)` (into a descendant), `moveNode(R1, R1, 0)` (into itself), `moveNode({ label: 'Y' }, null, 0)` (node not held) and `moveNode(R0, { label: 'Z' }, 0)` (parent not held) returns the tree. Afterwards roots equal `[R0, R1, R2]`, `R1.children` equals `[C0, C1]`, `C0.children` is `undefined`, generation unchanged, zero rebinds.
- **MV9 — lazy target that never loaded.** Unmounted. `load = vi.fn(async () => [{ label: 'loaded' }])`, `P = { label: 'P', hasChildren: true, loadChildren: load }`, roots `[P, X]`. `moveNode(X, P, 0)`; `expanded = expandNodeAsync(P)`: `flatLabels` is `['P','X']`, `await expanded` is `true`, `load` not called.
- **MV10 — lazy target with a load in flight.** Unmounted. `P = heldLazy('P')`, roots `[P.node, X]`. `expanded = expandNodeAsync(P.node)`; `moveNode(X, P.node, 0)`; `P.resolve([{ label: 'B' }])`: `await expanded` is `false`, `P.node.children` equals `[X]`, `getExpandedNodes()` does not contain `P.node`, `P.load` called once.
- **MV11 — the moved node's own load survives.** Unmounted. `L = heldLazy('L')`, `Q = { label: 'Q', children: [{ label: 'q' }] }`, roots `[L.node, Q]`. Register an `"expand"` spy. `expanded = expandNodeAsync(L.node)`; `moveNode(L.node, Q, 0)`; `asPrivate(tree)._loadingNodes.has(L.node)` is `true`; `L.resolve([k])`: `await expanded` is `true`, `L.node.children` equals `[k]`, `getExpandedNodes()` contains `L.node`, the spy was called once with `L.node`, `L.load` called once.
- **MV12 — scroll offset.** Mounted 5 rows tall (`5 * ROW_HEIGHT`). (a) 60 leaves; `setScrollY(20 * ROW_HEIGHT)`; `moveNode(nodes[0], null, 59)`: offset is still `20 * ROW_HEIGHT`. (b) Roots `n0…n9` then `F{f0}` collapsed (11 rows); `setScrollY(6 * ROW_HEIGHT)`; move `n0`, `n1`, `n2` under `F` at index 0 each: 8 rows remain, offset is `(8 - 5) * ROW_HEIGHT`.
- **MV13 — generation bump.** Unmounted roots `[a, b]`; `moveNode(a, null, 1)`: generation +1 (a running `revealByPredicate` restarts its open levels on exactly this bump).

### `TreeExpandMotion.test.ts`

- **M7 row `moveNode(C, B, 0)`.** Mid-motion of `expandNode(B)` (frames 0 and 80), the move stops the motion and renders `A B C b1 b2 b3 D` at once; later frames change nothing (the shared `it.each` body checks this).
- **MV14 — never animates.** `mountFixture()`, `expandNode(fx.B)`, `settle()`, then `const tweenSpy = vi.spyOn(Animation, 'tween')`. `moveNode(fx.b3, null, 0)`: `tweenSpy` not called; `_flatRows` labels are `['b3','A','B','b1','b2','C','D']`; `expectFinalRender(tree)` holds.

### Manual

- **V1 (manual).** `npm run dev` (on a spare port if a server is already running; never kill one). In `packages/lib/src/typescript/MiscPanel.ts`, in the *Show large tree (variable-width rows)* factory, temporarily add `(globalThis as any).demoTree = tree;` after `tree.expandAll();` (line 1131) — do not commit it. Open *Misc. → Show large tree*, scroll to the middle, click a row inside an expanded branch. In the console, move that branch's parent with `demoTree.moveNode(…)` to another root (above, inside and below the viewport), then within its own parent, then rename one visible node (`label`, `moveNode`, `notifyNodeChanged`). Each time: the branch stays expanded, the clicked row keeps its `selected`/`focused` classes, `aria-activedescendant` still names it when it is on screen, the scroll offset does not move, no event fires, and the console shows no error. Revert `MiscPanel.ts`.

---

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test` — in particular `tests/component/tree/Tree.test.ts`, `tests/component/tree/TreeExpandMotion.test.ts`, `tests/component/dispose-deferred-work.test.ts` (no new scheduling call, so no row is needed)
- `npm run docs:api` (zero warnings) and `npm run docs:llms:check`
- `grep -n "moveNode" packages/lib/docs/components/Tree.md` — matches in both tables, line 127's paragraph, line 129's paragraph and the new subsection
- Manual V1

---

## Documentation Impact

- **Export surface:** none. `moveNode` is a method on `Tree`, already exported from `component/tree`. No new class, so no `llms.txt` manifest row.
- **JSDoc:** the method's own block, plus the lists in Phase 3. Every `{@link}` added names a public `Tree` member in the same `component/tree` bucket.
- **`docs/components/Tree.md`:** the table rows, the edits to lines 127 and 129, and this subsection, inserted before `## Keyboard`:

  ````markdown
  ### Moving and renaming a node

  `moveNode(node, parent, index)` moves a node the tree holds, with everything under it, to position `index` among `parent`'s children. The node never leaves the tree, so it and every node under it keep their expansion, selection, loaded children and any load in flight, and the focus and selection anchor stay where they were. `index` is where the node ends up, clamped as in `insertNode`:

  | Before | Call | After |
  | --- | --- | --- |
  | `P: [a, b, c, d]` | `moveNode(b, P, 3)` | `P: [a, c, d, b]` |
  | `P: [a, b, c, d]` | `moveNode(c, P, 0)` | `P: [c, a, b, d]` |
  | `P: [a, b, c, d]`, `Q: [x]` | `moveNode(b, Q, 0)` | `P: [a, c, d]`, `Q: [b, x]` |

  A move to where the node already is does nothing. A move the tree cannot make — a node or a parent it does not hold, or a parent that is the node itself or sits under it — is ignored. Like the other methods here, `moveNode` emits no event, keeps the scroll offset and never animates; it does not scroll the moved node into view. Moving into a collapsed parent hides the node's rows until the parent is expanded. A parent left with no children loses its caret, as after `removeNode`.

  Both parents count as changed, as in `insertNode` and `removeNode`. Moving into a lazy node that has not loaded makes the moved node its only child. When that folder's listing should still come from `loadChildren`, call `removeNode(node)` instead: the node comes back, as a new node, when the folder first loads.

  A rename that changes where a node sorts is a move within its own parent. `moveNode` does not repaint the node's label, so follow it with `notifyNodeChanged`:

  ```typescript
  // Rename an entry, keep the folder sorted, and keep the entry open and selected.
  node.label    = newName;
  const others  = (parent === null ? tree.getNodes() : parent.children!).filter(child => child !== node);
  const after   = others.findIndex(child => child.label.localeCompare(newName) > 0);

  tree.moveNode(node, parent, after < 0 ? others.length : after);
  tree.notifyNodeChanged(node);
  ```
  ````

- **`docs/reference/changelog/next.md`**, under `## Added` → `### Components`:

  ```markdown
  - **`Tree` gains `moveNode(node, parent, index)`**, which moves a node and
    everything under it to a new position or a new parent without it leaving
    the tree. The node and every node under it keep their expansion,
    selection, loaded children and any lazy load in flight, and the focus,
    anchor and scroll offset stay put, so renaming or moving a folder in a
    file explorer no longer collapses it. `index` is where the node ends up,
    clamped as in `insertNode`. A move to the node's current position does
    nothing, and a move into the node's own subtree, or of or under a node
    the tree does not hold, is ignored. Like the other node-level methods it
    emits no event and never animates. A rename that changes the sort order
    is `moveNode` followed by `notifyNodeChanged`. No consumer action is
    needed.
  ```

- **No migration note:** nothing existing changes behaviour.

---

## Potential Challenges

- **`next.md` conflicts with the row-motion branch.** Both plans add a section at the end of the page; whichever merges second keeps both sections in release order (`## Changed` before `## Added`).
- **`_locate` runs up to twice per move** (node, then parent), each a depth-first walk over every node, plus the prune's walk. `removeNode` already pays one walk and the prune; a file explorer's moves are user-paced, so accept.
- **A focused node moved under a collapsed parent clears `aria-activedescendant`**, and the keyboard then behaves as it does after collapsing the focused node's ancestor today. The tests pin that the focus node itself is kept (MV5).
- **A caller that mutates `label` and forgets `notifyNodeChanged`** sees the old label whenever the row was not rebound for another reason. The method JSDoc and the docs subsection both say to call it.

---

## Critical Files

- `packages/lib/src/typescript/lib/component/tree/Tree.ts` — `insertNode` (line 471), `removeNode` (line 498), `setChildren` (line 537), `notifyNodeChanged` (line 566), `_flatten` (line 1192), `_childrenOf` (line 1296), `_locate` (line 1322), `_pruneDetachedState` (line 1384), `_supersedeLoad` (line 1416), `_commitStructureChange` (line 1441): the precedent the new method mirrors.
- `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` — `isBoundTo` (line 181): why a relabel needs `notifyNodeChanged`.
- `packages/lib/src/typescript/lib/component/table/TreeTable.ts` — `reparentRow` / `canReparent` (lines 308, 343): the cycle-rejection precedent.
- `packages/lib/tests/component/tree/Tree.test.ts` — `describe('Tree — node-level updates')` (line 2048): the helpers and the insert/remove/setChildren cases the new cases mirror.
- `packages/lib/tests/component/tree/TreeExpandMotion.test.ts` — `STOPPERS` and M7 (lines 411–447).
- `plans/implemented/tree-node-level-updates.md` — the design of the four node-level calls; its *Non-Goals* deferred this move primitive.
- `plans/tree-row-motion-no-snap.md` — the in-flight plan sharing four files with this one.

---

## Non-Goals

- **Scrolling or selecting the moved node.** No structural call scrolls; `selectNode(node)` scrolls a selected node into view when the caller wants that.
- **Expanding the target parent.** The caller calls `expandNode(parent)` when the move should be visible.
- **Repainting the moved row's label inside `moveNode`.** `notifyNodeChanged` already does it.
- **Moving several nodes in one call.** One call per node; each is one reflatten.
- **Animating a move.** Structural calls never animate.
- **A `"move"` event, or a `boolean` return reporting a rejected move.** The node-level calls return `this` and emit nothing.
- **`TreeStore` or `TreeTable` changes.** Neither keys state by object identity. Whether `TreeStore` re-indexes after an in-place `parentField` edit is a separate question this plan did not investigate.[^treestore]

---

## Addendum: Structural calls today

What each existing node-level call does to the tree's state ([Tree.ts:432-583](packages/lib/src/typescript/lib/component/tree/Tree.ts#L432-L583), tail at [Tree.ts:1441](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1441)):

| Call | Child arrays | Expanded set | Loaded / loading / load in flight | Selection, anchor, focus | Render, scroll | Events, motion |
|---|---|---|---|---|---|---|
| `setNodes(nodes)` | replaces the root array | cleared | all cleared; every load dropped | all cleared | force-rebinds every row; offset clamped only | none; stops a motion |
| `insertNode(parent, i, node)` | splices into the live array (creates `children` on a leaf) | kept; new node collapsed | `parent` marked loaded if lazy; its load dropped | kept | rebinds changed rows; offset kept | none; stops a motion |
| `removeNode(node)` | splices out of the live array | removed subtree pruned | removed subtree's state and loads dropped; old parent marked loaded | removed nodes pruned; anchor / focus cleared if removed | as above | none; stops a motion |
| `setChildren(parent, list)` | stores `list` by reference | survivors kept, left-out pruned | `parent` marked loaded; its load dropped; left-out nodes' loads dropped | survivors kept | as above | none; stops a motion |
| `notifyNodeChanged(node)` | none | untouched | untouched | untouched | force-rebinds only the row showing `node` | none; motion untouched |

What Loom can do with them:

- **Rename (same parent, new position, new label).** Possible today without losing state: change `label`, then `setChildren(parent, sameObjectsResorted)`, then `notifyNodeChanged(node)`. The node stays reachable through the one `setChildren` call, so nothing is pruned. The cost is rebuilding and re-sorting the whole sibling list for one entry. Loom's remove-then-add is what loses the state.
- **Move (new parent).** No supported way. `removeNode` then `insertNode` prunes the whole subtree on the remove, and drops any load in flight for good (the existing docs say so). `setChildren(old, without)` then `setChildren(new, with)` prunes on the first call. Inserting into the new parent first holds the node twice: `insertNode` documents that its node must not already be in the tree, the intermediate render draws the node twice, and a following `removeNode(node)` removes whichever copy `_locate` finds first depth-first, which can be the new one. Only `setChildren(old, without)` after that insert happens to work, and only by accident of the implementation.

---

## Notes

[^treestore]: `TreeStore` keys expansion, loading and loaded state by record id (`_expandedIds`, `_loadingIds`, `_loadedIds`, [TreeStore.ts:114-116](packages/lib/src/typescript/lib/data/TreeStore.ts#L114-L116)) and rebuilds its node tree from each record's `parentField` ([TreeStore.ts:261-300](packages/lib/src/typescript/lib/data/TreeStore.ts#L261-L300)). A move there is a field write; the record's id does not change, so its state survives a rebuild. `TreeTable`'s `TreeBody` also keys `_expanded` by id ([TreeBody.ts:122](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L122)) and already has `TreeTable.reparentRow`. So neither has the identity gap this plan fixes, and Loom's need is the `Tree` widget only. One thing was noticed but not followed up: `TreeStore` rebuilds its index only from `applyView()`, and `AbstractStore.notifyRecordChanged` ([AbstractStore.ts:978](packages/lib/src/typescript/lib/data/AbstractStore.ts#L978)) emits `'update'` without calling it, so an in-place `parentField` edit may not re-index until the next view rebuild. That is a different question from this plan's and belongs in its own investigation.

[^addendum]: The request asked for the current structural surface and what Loom would have to do with it, so that research is kept in the addendum rather than repeated in the body. It also shows that a same-parent rename was already possible through `setChildren` without losing state; `moveNode` makes it a one-node call and adds the cross-parent move that had no supported path.

[^precedent]: Searched: the four node-level calls and their shared tail in `Tree.ts`; `TreeTable.reparentRow` / `canReparent` and `TreeBody`'s reparent drop handler; `TreeStore` and the data-layer `TreeNode.setChildren`. `Tree`'s own structural calls are the nearest precedent: the same widget, the same identity-keyed state, the same live child arrays. `_commitStructureChange` already does everything a move needs after the splice. `TreeTable.reparentRow` supplies the cycle rule but not the shape: it moves records by rewriting a parent-id field and fires a DOM event, while `Tree` holds node objects in arrays and its structural calls emit nothing. The earlier plan `plans/implemented/tree-node-level-updates.md` listed "No move or reparent primitive" in its *Non-Goals* because a remove-then-insert drops state; this plan is that follow-up.

[^index-required]: A default (append) was considered, matching the request's sketch `moveNode(node, newParent, index?)`. It was not taken: `insertNode` requires its index, a file explorer always knows the sorted position it wants, and an omitted index for a same-parent move would quietly push the node to the end. To append, pass the parent's child count; it clamps to the last position.

[^index-meaning]: The other reading — `index` counted in the target array as it was before the node was taken out — gives different results for a same-parent move toward the end (`moveNode(b, P, 3)` on `[a, b, c, d]` would land b at index 2). "Where the node ends up" needs no such adjustment, matches how a caller computes a sorted position (among the siblings other than the node), and is what `index` means for a cross-parent move anyway.

[^noop]: A rename that does not change the sort order is the common case in a file explorer. Returning early skips a full reflatten, a render and a generation bump, the last of which would make a running `revealByPredicate` restart its open levels for nothing. The clamp runs before the comparison, so an over-large index on the last child is recognised as a no-op.

[^reject]: Throwing was considered for a cycle, since it is a caller bug. No component under `component/tree` or `component/table` throws for a bad argument; `removeNode` ignores a node it does not hold and `reparentRow` returns `false` for a cycle or a no-op. A `boolean` return like `reparentRow`'s was rejected too: `Tree`'s node-level calls all return `this` for chaining. A caller that needs to know can compare `getNodes()` / `parent.children` before and after. In a file explorer the file system refuses a move into a folder's own subfolder before the tree is ever asked.

[^both-parents]: `_commitStructureChange` takes one parent. Widening it to take several would change the signature its three existing callers use for one extra caller; calling `_supersedeLoad` for the old parent beside it is one line and leaves the shared tail as it is. `removeNode` already supersedes the old parent's load (it passes `location.parent`), and `insertNode` the new parent's, so a move doing both is the union of the two calls it replaces. In practice the old parent holds children, so it has no load in flight and is already loaded or eager; the call matters only for consistency with `removeNode`.

[^no-events]: The node-level calls stay silent because the caller made the change (`plans/implemented/tree-node-level-updates.md`, *No event fires*). A move also changes no state any event reports: nothing is selected or deselected, expanded or collapsed. Moving into a collapsed parent hides a selected node, but so does collapsing its ancestor, which fires no `"selection"` either.

[^no-reveal]: VS Code and similar explorers reveal a renamed entry, but that is a caller policy, and no structural call scrolls today. `selectNode(node)` already selects and scrolls when the caller wants it.

[^rename]: Two alternatives were rejected. A `renameNode(node, label)` would bake the label field into a structural API, and the sort order still has to come from the caller. Having `moveNode` always force-rebind the moved node's row would repaint even when only the position changed, and would still miss the common case: a rename that keeps the sort order is a no-op move that renders nothing. `notifyNodeChanged` already exists for exactly "I changed this node in place", so the rename is two existing ideas composed. Order does not matter; calling it after `moveNode` repaints the row once at its final place.

[^shared-files]: The row-motion plan edits `Tree.ts` (`_reflattenWithMotion`, and the class JSDoc's snap sentence starting at line 220), `TreeExpandMotion.test.ts` (header comment, M9, M10, helpers after line 195, new cases after M15), `Tree.md` line 99 and `next.md`. This plan avoids every one of those lines. In the class JSDoc it changes line 218 and leaves line 219 untouched, so the two edits stay separated by an unchanged line and git merges them cleanly; adding `moveNode` to line 219's list instead would touch a line adjacent to the other plan's edit and conflict. `Tree.md` line 99 is one long line holding both the structural-call list and the snap sentence the other plan rewrites, so this plan leaves it alone and states "never animates" in the new subsection. The new motion test sits between M7 and M8, well clear of M9. Only `next.md`, where both plans append a section, can conflict, and resolving it means keeping both.
