# TreeNode Payload Slot — Implementation Plan

## Overview

Add an optional `data` field to the component-layer `TreeNode` interface so callers can attach arbitrary domain data to a node and read it back from any API that already hands them the node. The motivating consumer is the planned SQLAdmin app, which needs to answer "which database schema/table does this node represent?" without maintaining an app-side node→object side-map.

`TreeNode` is a plain data interface (a `label`/`children` POJO), not a `Component` subclass — see [TreeNode.ts:18](../src/typescript/lib/component/tree/TreeNode.ts#L18). So **no typed-setter / backing-field / `XOptions` machinery applies**: the change is a single optional interface field plus documentation. The `Tree` already keys every node by object identity ([Tree.ts:93-103](../src/typescript/lib/component/tree/Tree.ts#L93-L103)) and never reads node fields it doesn't recognise, so the new field is a passive carrier that needs no behavioural code.

The retrieval path already exists end to end: the `"selection"` event hands back the actual `TreeNode` objects ([Tree.ts:452](../src/typescript/lib/component/tree/Tree.ts#L452)), `getSelectedNode()` / `getSelectedNodes()` return them ([Tree.ts:169](../src/typescript/lib/component/tree/Tree.ts#L169), [Tree.ts:178](../src/typescript/lib/component/tree/Tree.ts#L178)), the `"loaderror"` event hands back the node ([Tree.ts:407](../src/typescript/lib/component/tree/Tree.ts#L407)), and `loadChildren`-returned children are stored by reference ([Tree.ts:399](../src/typescript/lib/component/tree/Tree.ts#L399)). Because these all surface the same `TreeNode` reference the caller authored, a `data` field on it is reachable everywhere without any new API.

This plan touches the **component-layer** `TreeNode` only. There is an unrelated **data-layer** `TreeNode` class at [src/typescript/lib/data/TreeNode.ts](../src/typescript/lib/data/TreeNode.ts) (a `ModelRecord` wrapper produced by `TreeStore`); it is explicitly out of scope (see `## Non-Goals`).

---

## Architecture Decisions

### `data?: unknown`, not a type parameter

The field type is `unknown` — the caller casts on read. Making `TreeNode` generic (`TreeNode<T>`) would force the type parameter through the entire stack that names `TreeNode`: `Tree`'s state (`_nodes`, the four identity `Set<TreeNode>`s, `_anchorNode`, `_focusNode`, `FlatRow.node`), every method signature (`setNodes`, `getNodes`, `getSelectedNode(s)`, `on`/`off`/`emit` overloads, `TreeOptions.listeners`), `TreeRow` (`_node`, `getNode`, `setRowData`), `TreeNodeRenderer.update`, and `TreeNodeRenderContext.node` — across [Tree.ts](../src/typescript/lib/component/tree/Tree.ts), [TreeRow.ts](../src/typescript/lib/component/tree/TreeRow.ts), [TreeNodeRenderer.ts](../src/typescript/lib/component/tree/TreeNodeRenderer.ts), and [TreeNodeRenderContext.ts](../src/typescript/lib/component/tree/TreeNodeRenderContext.ts). That is large, churny, and buys little: the `Tree` never reads `data`, so it gains nothing from knowing its type, and a single `Tree` instance can legitimately hold nodes with heterogeneous payloads (the SQLAdmin case mixes schema nodes and table nodes). `unknown` (over `any`) keeps the cast explicit at the call site while leaving the framework type-agnostic. This trades compile-time payload typing for zero framework churn — the right call for a passive carrier.

### `data` does not participate in node identity

The `Tree` keys nodes purely by object reference: `_expandedNodes`, `_selectedNodes`, `_loadedNodes`, `_loadingNodes` are all `Set<TreeNode>` ([Tree.ts:93-103](../src/typescript/lib/component/tree/Tree.ts#L93-L103)), `_flatten` pushes node references into `_flatRows` ([Tree.ts:309](../src/typescript/lib/component/tree/Tree.ts#L309)), and lookups use `===` / `findIndex(r => r.node === …)` ([Tree.ts:466](../src/typescript/lib/component/tree/Tree.ts#L466), [Tree.ts:654](../src/typescript/lib/component/tree/Tree.ts#L654)). No code reads `node.label`, `node.children`, or any field for keying. Adding `data` therefore cannot affect expansion, selection, loading, or dedup — it is orthogonal by construction. The plan asserts this; no code guards it because the identity mechanism never looks at the field.

### No setter machinery, no new accessor

Because `TreeNode` is a data interface and `data` is consumer-authored, the consumer reads it directly off the node it already holds (`node.data`). Adding a `Tree.getNodeData(...)` accessor or a `data`-typed event payload would be speculative API duplicating what `node.data` already gives. The minimal surface is exactly one optional interface field. The existing `"selection"`/`"loaderror"` events and `getSelectedNode(s)` already deliver the node, so retrieval needs no new code (verified above) — this is the crux the brief flagged, and it is already covered.

### `loadChildren` payloads need no special handling

Children returned by `loadChildren` are assigned to `node.children` by reference ([Tree.ts:399](../src/typescript/lib/component/tree/Tree.ts#L399)) and flow through `_flatten` → `setRowData` → events as the same objects the loader created. A `data` field set on a lazily-loaded child therefore survives unchanged and is reachable from that child's selection event with no extra work.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/component/tree/TreeNode.ts
export interface TreeNode {
    label: string;
    children?: TreeNode[];
    hasChildren?: boolean;
    loadChildren?: () => Promise<TreeNode[]>;

    /**
     * Optional caller-supplied payload. The tree treats this as opaque: it is
     * never read, rendered, or used for identity/dedup. Attach any domain object
     * here and read it back from a node handed to you by `getSelectedNode`,
     * `getSelectedNodes`, the `"selection"` event, or the `"loaderror"` event.
     */
    data?: unknown;
}
```

No other signatures change. `TreeNode` is the only modified symbol.

---

## Internal Structure

None. No private state, no method bodies, no DOM. The field is declarative on an existing interface.

---

## Ordered Implementation Steps

1. **Add the field.** In [src/typescript/lib/component/tree/TreeNode.ts](../src/typescript/lib/component/tree/TreeNode.ts), add `data?: unknown;` to the `TreeNode` interface after `loadChildren`, with a JSDoc block matching the existing field-doc style (description, then `@remarks` noting it is opaque and how to read it back). Do not name internal symbols in the JSDoc (`_selectedNodes` etc. are private — describe the retrieval API by its public method/event names only, per CODE_CONVENTIONS "Don't `{@link}` internal symbols").

2. **No barrel change needed.** `TreeNode` is already re-exported from [src/typescript/lib/component/tree/index.ts:5](../src/typescript/lib/component/tree/index.ts#L5). Confirm: `grep -n 'TreeNode' src/typescript/lib/component/tree/index.ts` — expect the existing `export type { TreeNode }` line, unchanged.

3. **No Tree/TreeRow/renderer changes.** Confirm the field is purely passive: `grep -rn '\.data\b' src/typescript/lib/component/tree/` — expect **zero** matches (nothing in the tree stack reads `data`).

4. **Update docs** (see `## Documentation Impact`): extend the `TreeNode` interface block in [docs/components/Tree.md:26-32](../docs/components/Tree.md#L26-L32) and add a short prose paragraph on the payload slot.

5. **Add unit tests** (see `## Expected Behaviour`) to [tests/component/tree/Tree.test.ts](../tests/component/tree/Tree.test.ts).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/component/tree/TreeNode.ts` (add `data?: unknown` + JSDoc) |
| Modify | `docs/components/Tree.md` (document the payload slot) |
| Modify | `tests/component/tree/Tree.test.ts` (round-trip + identity-orthogonality tests) |

---

## Expected Behaviour

All of the following are **offline unit-testable** — they exercise the interface and the existing in-memory node-flow/identity logic, with no DOM events, focus, geometry, or visual output involved. The existing `TestTree` white-box subclass in [tests/component/tree/Tree.test.ts:34-38](../tests/component/tree/Tree.test.ts#L34-L38) exposes a `fire(nodes)` seam over the protected `emit`, which lets the selection-event round-trip be asserted without a real click gesture.

1. **`data` round-trips through `setNodes`/`getNodes` by reference.** A node authored with `data: someObj`, passed to `setNodes`, is returned by `getNodes()` (which returns the same array, [Tree.ts:159](../src/typescript/lib/component/tree/Tree.ts#L159)) with `node.data === someObj`. *(Unit-testable.)*

2. **`data` is retrievable from a selection event.** Firing `"selection"` with nodes that carry `data` delivers the same node references to the listener, so `nodes[0].data` equals the authored payload. *(Unit-testable via `TestTree.fire`.)*

3. **`data` survives the lazy-load path and is reachable from the loaded child.** A node whose `loadChildren` resolves to children each carrying `data` stores those children by reference ([Tree.ts:399](../src/typescript/lib/component/tree/Tree.ts#L399)); after expansion the child reachable through `getNodes()` traversal (or a fired selection containing it) carries the same `data`. *(Unit-testable: stub `loadChildren` with a resolved promise, toggle, await, assert the stored child's `data`.)*

4. **`data` does not affect expansion or selection identity.** Two distinct node objects with identical `data` (and identical `label`) are treated as separate nodes: expanding one does not expand the other; selecting one does not select the other. Identity is by object reference, not by `data`. *(Unit-testable: build two such nodes, toggle/select one, assert the other's state is unchanged.)*

5. **A node without `data` behaves exactly as before.** Omitting `data` leaves `node.data` `undefined`; all existing flatten/render/selection behaviour is unchanged (this is the pre-existing test suite passing untouched). *(Unit-testable: existing suite is the regression guard.)*

---

## Verification

- **Typecheck:** `npm run build` (or the project's `tsc` check) — the added optional field must not break any existing `TreeNode` consumer.
- **Passive-field invariant:** `grep -rn '\.data\b' src/typescript/lib/component/tree/` — expect zero matches in the tree stack (nothing reads it).
- **Unit tests:** run `tests/component/tree/Tree.test.ts` — the five behaviours above, all green.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). Confirms the new JSDoc has no broken `{@link}` and the interface page regenerates.
- **Manual smoke:** none strictly required (no DOM/visual change). The MiscPanel Tree demo ([src/typescript/MiscPanel.ts](../src/typescript/MiscPanel.ts)) is the live screen if a visual sanity check is wanted; behaviour is identical with or without `data`.

---

## Documentation Impact

`TreeNode` is public API.

- **Barrel:** already exported from the per-subpath barrel [src/typescript/lib/component/tree/index.ts:5](../src/typescript/lib/component/tree/index.ts#L5) — no barrel edit. No root barrel exists.
- **Curated page:** [docs/components/Tree.md](../docs/components/Tree.md) is the Tree page (linked in the sidebar at [docs/.vitepress/config.mts:140](../docs/.vitepress/config.mts#L140)). Add `data?: unknown;` to the `interface TreeNode` code block ([docs/components/Tree.md:26-32](../docs/components/Tree.md#L26-L32)) and a short paragraph after it explaining the opaque payload slot and that it is read back off the node delivered by `getSelectedNode(s)` / the `"selection"` event. No new page, no `index.md` catalog change (the page already exists and is listed), no sidebar change.
- **JSDoc:** the new field's JSDoc is the API-doc source for the generated [TreeNode interface page](/api/component/tree/interfaces/TreeNode). Keep it free of `{@link}` to private symbols — refer to the public retrieval methods/events by name in prose only (CODE_CONVENTIONS / docs-conventions "never link an internal symbol").
- **No cross-bucket links needed:** the field references only same-bucket public API (`Tree`).

---

## Critical Files

- [src/typescript/lib/component/tree/TreeNode.ts](../src/typescript/lib/component/tree/TreeNode.ts) — the interface being extended; match its existing field-JSDoc style.
- [src/typescript/lib/component/tree/Tree.ts](../src/typescript/lib/component/tree/Tree.ts) — proves the identity Sets, the `"selection"`/`"loaderror"` events, and the lazy-load store-by-reference path that make `data` reachable and orthogonal.
- [tests/component/tree/Tree.test.ts](../tests/component/tree/Tree.test.ts) — test harness, the `TestTree.fire` seam, and the `fruitTree()` fixture style to mirror.
- [docs/components/Tree.md](../docs/components/Tree.md) — the doc page to extend.
- `CODE_CONVENTIONS.md` — JSDoc rules and the no-internal-`{@link}` constraint.

---

## Non-Goals

- **The data-layer `TreeNode`** ([src/typescript/lib/data/TreeNode.ts](../src/typescript/lib/data/TreeNode.ts)) is a separate `ModelRecord`-wrapping class owned by `TreeStore`; it is unrelated and untouched.
- **Generic `TreeNode<T>`** — rejected for framework-wide churn (see Architecture Decisions).
- **Serialization, deep-clone, or change events for `data`** — the carrier is passive; the tree never copies or watches it. None requested, none added.
- **A dedicated `getNodeData` accessor or `data`-typed event payload** — redundant; the consumer reads `node.data` off the node already returned by existing APIs.
- **Any SQLAdmin-specific typing or schema/table modelling** — this is a generic reusable primitive; the consuming app casts `data` to its own type.
