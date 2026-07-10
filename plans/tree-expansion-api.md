# Tree Expansion API — Implementation Plan

## Overview

Three related additions to the [`Tree`](src/typescript/lib/component/tree/Tree.ts) component that give callers programmatic control over which nodes are expanded, without going through a user gesture:

1. An **`expanded?: boolean`** field on [`TreeNode`](src/typescript/lib/component/tree/TreeNode.ts#L18) so a node can be declared open on load. Today [`setNodes`](src/typescript/lib/component/tree/Tree.ts#L123) unconditionally clears `_expandedNodes`, so there is no way to render a node expanded on first paint.
2. Public **`expandAll(node?)` / `collapseAll(node?)`** — no-arg forms toggle every expandable node in the whole tree; the node-scoped forms toggle a given node plus its descendants.
3. The node-scoped variant of (2) is folded into the same two methods via an optional `node` parameter (see [Architecture Decisions](#architecture-decisions)).

**Motivating consumer:** the sqladmin app's roles rail builds a `Tree` with three group parents ("Users", "Groups", "Predefined") and wants "Users" open on load. Today it hacks that by calling `tree.revealByPredicate(data => data === firstUserName)` — expanding the Users parent as a side effect of revealing its first child. Capability 1 replaces that with a declarative `expanded: true` on the Users group node. (sqladmin is a separate repo; no changes are planned there — it is cited only as the driver.)

All work is in `src/typescript/lib/component/tree/`, its test file, and two doc pages. No new files, no new exports, no dependency changes.

---

## Architecture Decisions

### One overloaded method pair, not four methods — `expandAll(node?)` / `collapseAll(node?)`

Capability 2 (whole-tree) and capability 3 (subtree) collapse into a single optional parameter: `expandAll()` expands the whole tree, `expandAll(node)` expands `node` and its descendants; likewise for `collapseAll`. Reasons: (a) it reads naturally ("expand all [under X]"); (b) the no-arg whole-tree case is just the subtree walk rooted at the tree's roots, so the two share one recursive helper and add no second public name; (c) the sibling components in this repo already expose no-arg `expandAll()` / `collapseAll(): this` — [`TreeTable`](src/typescript/lib/component/table/TreeTable.ts#L231), [`TreeBody`](src/typescript/lib/component/table/TreeBody.ts#L391), [`Accordion`](src/typescript/lib/layout/Accordion.ts#L792) — so keeping the no-arg spelling and *widening* it with an optional node stays consistent with the established API surface rather than inventing `expandSubtree` / `collapseSubtree`. A plain optional parameter (`node?: TreeNode`) is used, not TypeScript overload declarations — both forms share the `this` return type and the only difference is the presence of the argument, so overloads would add ceremony without type benefit.

### The node-scoped `expandAll(node)` expands the node itself

Expanding `node` *and* its descendants (not just descendants) is the useful contract: a caller passing the currently-selected — and typically collapsed — node wants that node opened. `_expandAllIn([node])` naturally covers "node + descendants" in one walk. `collapseAll(node)` symmetrically removes `node` and every descendant from the expanded set.

### Lazy nodes are marked expanded but never force-loaded

A lazy node (`hasChildren: true` + `loadChildren`, children not yet materialised) is *expandable* per [`_isExpandable`](src/typescript/lib/component/tree/Tree.ts#L476) before its children exist. The policy across all three capabilities is: **seed it into `_expandedNodes`, but never trigger a synchronous or cascading `loadChildren`.** This mirrors how [`_flatten`](src/typescript/lib/component/tree/Tree.ts#L484) already behaves — it only recurses when `node.children` exists (`this._isExpandable(node) && this._expandedNodes.has(node) && node.children`), so a lazy-but-unloaded expanded node simply renders with a down-caret / `aria-expanded="true"` and **no visible children until something else loads them**. Consequences, all benign:

- **Capability 1** (`expanded: true` on a lazy node): the node is seeded into `_expandedNodes` in `setNodes`; no load is issued in `setNodes` (matching `revealByPredicate` / `_onToggle`, neither of which loads eagerly outside an explicit toggle). It shows as an expanded empty parent until its children arrive.
- **Capability 2/3** (`expandAll`): the walk adds every expandable node it *reaches through already-loaded `children`*, including lazy-unloaded nodes it encounters, but it cannot descend into an unloaded lazy subtree (there is no `children` array to recurse into) and **issues zero network calls**. This is the documented, deliberate limit: `expandAll` opens the currently-loaded tree, not the potential tree.

This is safe against later user interaction: if a lazy node sits in `_expandedNodes` unloaded and the user clicks its toggle, [`_onToggle`](src/typescript/lib/component/tree/Tree.ts#L530) sees `_expandedNodes.has(node)` is `true` and *collapses* it (removes it); a subsequent click re-expands and triggers the normal load path. No stuck state.

### Expansion changes are silent — no event

There is no expansion event in `Tree` today (`_onToggle` mutates `_expandedNodes` and re-renders without emitting), and the only custom event is `"selection"` (plus `"loaderror"` / `"contextmenu"` / `"dblclick"`). The new methods follow suit: they **emit nothing** — in particular never `"selection"` — exactly like `_onToggle` and `selectNode`. This keeps them pure state setters for syncing the tree to external truth, consistent with the `selectNode` precedent ([Tree.ts:189](src/typescript/lib/component/tree/Tree.ts#L189) documents the same "does not emit" rationale).

### No membership guard on the node-scoped forms

`selectNode` no-ops for a foreign node because it changes *visible* selection. `expandAll(node)` / `collapseAll(node)` need no such guard: `_flatten` only ever renders nodes reachable from `_nodes`, so adding a stray (non-tree) node to `_expandedNodes` is **inert** — it is never visited by the flatten walk and never rendered. Skipping the guard avoids an O(n) tree search on every call. This is documented in the method JSDoc.

### Re-render path: reuse `_reflattenAndRender`, unconditionally

All four call paths finish by calling the existing private [`_reflattenAndRender`](src/typescript/lib/component/tree/Tree.ts#L513) (flatten → `_boundIndices.fill(-1)` → `invalidateGeom` → `renderWindow`). It is already **offline-safe**: `renderWindow` early-returns when `!element || !this._scroller`, and `invalidateGeom` / `_boundIndices.fill` operate on base-class arrays initialised in the constructor. `_onToggle` calls it with no `getElement()` guard and the white-box tests exercise that path unmounted, so the new methods call it the same way — no `if (this.getElement())` wrapper needed. (`setNodes` guards its render block only because it hand-rolls the render steps inline rather than delegating to `_reflattenAndRender`; delegating is the cleaner path here.) Because `_reflattenAndRender` fills `_boundIndices` with `-1`, every visible pool row is force-rebound, so each row's [`setRowData`](src/typescript/lib/component/tree/TreeRow.ts#L135) re-runs and refreshes `aria-expanded` ([TreeRow.ts:182](src/typescript/lib/component/tree/TreeRow.ts#L182)).

---

## Public API

```typescript
// TreeNode.ts — new optional field
interface TreeNode {
    label:         string;
    children?:     TreeNode[];
    hasChildren?:  boolean;
    loadChildren?: () => Promise<TreeNode[]>;
    data?:         unknown;
    /** Declares this node initially expanded when the array is set via setNodes. */
    expanded?:     boolean;
}
```

```typescript
// Tree.ts — two new public methods
/**
 * Expands every expandable node — the whole tree when called with no
 * argument, or `node` plus all its descendants when a node is given.
 * Does not load lazy branches. Emits nothing. Returns this.
 */
expandAll(node?: TreeNode): this;

/**
 * Collapses every node — the whole tree when called with no argument,
 * or `node` plus all its descendants when a node is given.
 * Emits nothing. Returns this.
 */
collapseAll(node?: TreeNode): this;
```

New backing state: none. Reuses the existing `private _expandedNodes: Set<TreeNode>` (nodes tracked by object reference). No `TreeOptions` field (`expanded` lives on the node data, not on the component's options bag; the component-level options bag stays the listener bag only).

Private helpers added to `Tree`:

```typescript
// Recursively seed _expandedNodes from nodes declared expanded (capability 1).
private _seedInitiallyExpanded(nodes: TreeNode[]): void;

// Add node + loaded descendants that are expandable to _expandedNodes (expandAll).
private _expandAllIn(nodes: TreeNode[]): void;

// Remove node + loaded descendants from _expandedNodes (collapseAll(node)).
private _collapseAllIn(nodes: TreeNode[]): void;
```

---

## Internal Structure

The three helpers are near-identical depth-first walks over `nodes` and their loaded `children`; they differ only in the per-node action. Keep them as three small methods (each ~6 lines) rather than one predicate-parameterised walker — the actions diverge (conditional-add vs unconditional-add vs delete) and three explicit methods keep the implementer's job mechanical.

```typescript
private _seedInitiallyExpanded(nodes: TreeNode[]): void {
    for (const node of nodes) {
        if (node.expanded === true && this._isExpandable(node)) {
            this._expandedNodes.add(node);
        }
        if (node.children) {
            this._seedInitiallyExpanded(node.children);
        }
    }
}

private _expandAllIn(nodes: TreeNode[]): void {
    for (const node of nodes) {
        if (this._isExpandable(node)) {
            this._expandedNodes.add(node);
        }
        if (node.children) {
            this._expandAllIn(node.children);
        }
    }
}

private _collapseAllIn(nodes: TreeNode[]): void {
    for (const node of nodes) {
        this._expandedNodes.delete(node);
        if (node.children) {
            this._collapseAllIn(node.children);
        }
    }
}
```

Note both `_seedInitiallyExpanded` and `_expandAllIn` recurse into `node.children` **regardless of whether the current node is expanded** — a deeply-nested `expanded: true` node under a collapsed ancestor is still seeded, so it renders expanded the moment the ancestor opens. This matches the object-reference set semantics: membership is independent of visibility.

The two public methods:

```typescript
expandAll(node?: TreeNode): this {
    this._expandAllIn(node ? [node] : this._nodes);
    this._reflattenAndRender();
    return this;
}

collapseAll(node?: TreeNode): this {
    if (node) {
        this._collapseAllIn([node]);
    } else {
        this._expandedNodes.clear();
    }
    this._reflattenAndRender();
    return this;
}
```

`collapseAll()` (no arg) clears the whole set directly rather than walking, matching `TreeBody.collapseAll`'s `this._expanded.clear()`.

---

## Ordered Implementation Steps

1. **`TreeNode.ts` — add the `expanded` field.** Add `expanded?: boolean;` to the `TreeNode` interface after `data?` ([TreeNode.ts:58](src/typescript/lib/component/tree/TreeNode.ts#L58)), with a JSDoc block: it declares the node initially expanded when the array is handed to `setNodes`; note that for a lazy node it marks the node expanded without forcing a load, so the node shows an empty expanded parent until its children arrive. Do **not** `{@link}` any private symbol (per CODE_CONVENTIONS "Don't `{@link}` internal symbols"); reference `setNodes` (public) in prose or via link is fine.

2. **`Tree.ts` — seed initial expansion in `setNodes`.** In [`setNodes`](src/typescript/lib/component/tree/Tree.ts#L123), after the five `.clear()` / reset lines and **before** `this._flatten();`, insert `this._seedInitiallyExpanded(nodes);`. This ordering matters: the seed must populate `_expandedNodes` before `_flatten` reads it, or the first flatten won't include the expanded children.

3. **`Tree.ts` — update the `setNodes` JSDoc.** Its summary currently reads "collapses all nodes" ([Tree.ts:119](src/typescript/lib/component/tree/Tree.ts#L119)). Change to reflect that expansion is reset and then re-seeded from any node's `expanded: true` — e.g. "resets expansion (seeding any node declared `expanded: true`), clears selection, and re-renders."

4. **`Tree.ts` — add `_seedInitiallyExpanded`, `_expandAllIn`, `_collapseAllIn`.** Place them near [`_isExpandable`](src/typescript/lib/component/tree/Tree.ts#L476) / `_flatten` (the traversal cluster). Bodies per [Internal Structure](#internal-structure). Full JSDoc on each (private, so internal `{@link}` is allowed).

5. **`Tree.ts` — add the public `expandAll` / `collapseAll`.** Place them near `selectNode` / `revealByPredicate` (the public programmatic-control cluster, ~[Tree.ts:199](src/typescript/lib/component/tree/Tree.ts#L199)–266). Bodies per [Internal Structure](#internal-structure). JSDoc must mirror `selectNode`'s style: `@param node - ...` (optional), `@returns This tree, for method chaining.`, and an explicit sentence that the method does **not** emit `"selection"` and does **not** load lazy branches. Only `{@link}` public symbols (`selectNode`, `setNodes`) — describe `_expandedNodes` / `_flatten` in prose.

6. **Typecheck.** `npm run build` (or the project's typecheck) — expect zero errors. `grep -n "expandAll\|collapseAll" src/typescript/lib/component/tree/Tree.ts` — expect the two new definitions.

7. **Tests** — add cases per [Expected Behaviour](#expected-behaviour) to `tests/component/tree/Tree.test.ts`, reusing the existing white-box `asPrivate` / `TreePrivate` seam (widen `TreePrivate` with `_expandAllIn` etc. only if a test needs them; the public `expandAll` / `collapseAll` + the existing `_flatRows` / `_expandedNodes` fields already cover most assertions).

8. **Docs** — update `docs/components/Tree.md` and the TreeNode interface block per [Documentation Impact](#documentation-impact); run `npm run docs:build` — expect zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/component/tree/TreeNode.ts` (add `expanded?: boolean`) |
| Modify | `src/typescript/lib/component/tree/Tree.ts` (seed in `setNodes`; 3 private helpers; 2 public methods; `setNodes` JSDoc) |
| Modify | `tests/component/tree/Tree.test.ts` (new expected-behaviour cases) |
| Modify | `docs/components/Tree.md` (methods table already lists `expandAll`/`collapseAll`; add node-scoped + lazy-limit prose and an `expanded` note) |

---

## Expected Behaviour

All cases below are **unit-testable offline** via the existing white-box seam — `setNodes` / `expandAll` / `collapseAll` gate their `renderWindow()` behind `getElement()` (undefined for an unmounted tree), so the flatten/expand model runs without a `VirtualScroller`. Assert against the public `expandAll` / `collapseAll` plus the cast-reached `_flatRows` and `_expandedNodes` (mirroring the existing `asPrivate` block).

**Capability 1 — `expanded: true` seeding via `setNodes`:**

1. A root declared `{ label:'p', expanded:true, children:[{label:'c'}] }` → after `setNodes`, `_flatRows` includes `'c'` (parent flattened expanded) and `_expandedNodes.has(parent)` is `true`.
2. A **nested** expanded node under a collapsed parent — `{ label:'a', children:[{ label:'b', expanded:true, children:[{label:'c'}] }] }` → `_expandedNodes.has(b)` is `true` even though `a` is collapsed and `b`/`c` are not currently in `_flatRows`. Expanding `a` (via `_onToggle(a)`) then reveals `b` already-expanded so `c` is visible.
3. `expanded: true` on a **leaf** (`{ label:'x', expanded:true }`, no children, no `hasChildren`) → `_isExpandable` is false, so it is **not** added to `_expandedNodes`; `_flatRows` is just `['x']`.
4. `expanded: true` on a **lazy** node (`{ label:'l', expanded:true, hasChildren:true, loadChildren }`) → `_expandedNodes.has(node)` is `true`, `loadChildren` is **not** invoked by `setNodes`, and `_flatRows` contains only `['l']` (no children until loaded). (Assert the loader was not called, e.g. a spy count of 0.)
5. A second `setNodes` with a fresh array where the same-labelled node has `expanded` **absent/false** → the node is **not** expanded (each `setNodes` re-derives expansion from scratch after `clear()`).

**Capability 2 — whole-tree `expandAll()` / `collapseAll()`:**

6. Tree of nested eager parents all collapsed → `expandAll()` → `_expandedNodes` contains every expandable node and `_flatRows` lists every node in the tree (full depth-first order).
7. `collapseAll()` after an `expandAll()` → `_expandedNodes` is empty and `_flatRows` lists only the roots.
8. `expandAll()` does **not** invoke any node's `loadChildren` (lazy nodes with unloaded children get added to `_expandedNodes` but contribute no child rows) — assert loader spy count is 0 and the lazy node's row is present but childless.
9. `expandAll()` / `collapseAll()` emit **no** `"selection"` event (register a listener, assert count stays 0) and do not change `getSelectedNodes()`.
10. `expandAll()` returns the tree instance (chaining); same for `collapseAll()`.

**Capability 3 — node-scoped `expandAll(node)` / `collapseAll(node)`:**

11. `expandAll(parent)` on a collapsed multi-level `parent` → `parent` and all its descendant expandable nodes are in `_expandedNodes`; nodes **outside** `parent`'s subtree are untouched (a sibling parent stays collapsed).
12. `expandAll(node)` includes `node` **itself** (a collapsed `node` becomes expanded, not just its descendants).
13. `collapseAll(parent)` after a whole-tree `expandAll()` → `parent` and its descendants are removed from `_expandedNodes`, while an unrelated expanded sibling **remains** expanded.
14. `expandAll(leaf)` (a non-expandable node) → no change to `_expandedNodes`; safe no-op returning `this`.
15. `expandAll(foreignNode)` (a node not in the tree) → does not throw; the tree's `_flatRows` is unchanged because the foreign node is never reached by `_flatten` (inert-entry behaviour).

**Manual / rendered verification (not offline-unit-testable):** `aria-expanded` on rendered rows updating after `expandAll` / `collapseAll` and after an `expanded: true` initial load — needs a mounted tree (`getElement(true)`) and inspection of the pooled rows' ARIA (the row-binding block in the mounted test suites is the pattern). The offline model does not flush ARIA to the DOM.

---

## Verification

- **Typecheck / build:** `npm run build` — zero errors. New public methods appear in the emitted `.d.ts`.
- **Unit tests:** `npm test` (vitest) — the new cases in `tests/component/tree/Tree.test.ts` cover Expected Behaviour 1–15 (offline). Reuse `asPrivate` and the `beforeAll` glyph registration already in the file.
- **Grep invariants:**
  - `grep -n "expanded" src/typescript/lib/component/tree/TreeNode.ts` — the new field present.
  - `grep -n "_seedInitiallyExpanded" src/typescript/lib/component/tree/Tree.ts` — called from `setNodes`, defined once.
  - `grep -n "expandAll\|collapseAll" src/typescript/lib/component/tree/Tree.ts` — two public definitions.
- **Docs build:** `npm run docs:build` — zero warnings (CODE_CONVENTIONS requires it after touching public JSDoc; ensure no `{@link}` to a private symbol).
- **Manual smoke (mounted):** in a mounted tree, call `expandAll()` and confirm every parent row shows a down-caret and `aria-expanded="true"`; `collapseAll()` returns them to right-carets / `aria-expanded="false"`; a `setNodes` with one `expanded: true` group renders that group open on first paint. Entry point for a live check: the Tree demo panel, or the roles-rail consumer once it adopts `expanded: true`.

---

## Documentation Impact

- **`docs/components/Tree.md`:**
  - The **Common methods** table already lists ``expandAll() / collapseAll()`` → ``Bulk-toggle expansion.`` ([Tree.md:77](docs/components/Tree.md#L77)). Update the description to mention the optional node argument and the lazy limit, e.g. "Expand/collapse every node (or a node's subtree with `expandAll(node)`); does not fetch lazy branches."
  - The **TreeNode** interface code block ([Tree.md:26](docs/components/Tree.md#L26)–33) must gain `expanded?: boolean;`.
  - Add a short paragraph (near the TreeNode section or a new "Initial expansion" subsection) documenting `expanded: true` for declaring a node open on load, and noting the lazy behaviour (marked expanded, children load on first real expansion). This is the place to reference the motivating pattern ("prefer `expanded: true` over revealing a child to open a group").
- **API docs (TypeDoc-generated):** `Tree.expandAll` / `Tree.collapseAll` and `TreeNode.expanded` are picked up automatically from their JSDoc once exported (they already are — `Tree` via `callable`, `TreeNode` as an interface). No barrel/export change: `expandAll` / `collapseAll` are instance methods on the already-exported `Tree`, and `expanded` is a field on the already-exported `TreeNode`. No new entry point.
- **`llms.txt`:** no change needed — it indexes components at the file level ("Expandable tree of nodes → Tree"), not individual methods.
- **No renames/removals**, so no stale-reference sweep is required.

---

## Potential Challenges

- **Seed ordering in `setNodes`.** Seeding after `_flatten` would leave the first paint collapsed. Mitigation: Step 2 pins the insertion point *before* `_flatten()`.
- **Lazy `expanded: true` surprising a caller** who expects children immediately. Mitigation: documented in both the `TreeNode.expanded` JSDoc and Tree.md — expanded-but-unloaded renders as an empty open parent; children appear on first real expansion.
- **Double-expansion idempotency.** Adding an already-present node to a `Set` is a no-op, and `_onToggle` correctly collapses a lazy node that was pre-seeded expanded (it checks set membership first). No special-casing needed.
- **`{@link}` docs-build warnings.** The new public JSDoc must not link private symbols (`_expandedNodes`, `_flatten`, `_isExpandable`). Mitigation: describe them in prose; run `npm run docs:build` (Step 8) which fails the CI gate on such warnings.

---

## Critical Files

- [`src/typescript/lib/component/tree/Tree.ts`](src/typescript/lib/component/tree/Tree.ts) — the component; study `setNodes` (L123), `_isExpandable` (L476), `_flatten` (L484), `_reflattenAndRender` (L513), `_onToggle` (L530), `revealByPredicate` (L246), and the `selectNode` JSDoc (L185–216) as the public-method style to mirror.
- [`src/typescript/lib/component/tree/TreeNode.ts`](src/typescript/lib/component/tree/TreeNode.ts) — the interface the new field joins.
- [`src/typescript/lib/component/tree/TreeRow.ts`](src/typescript/lib/component/tree/TreeRow.ts#L135) — `setRowData` / `getAria().setExpanded` (L182); confirms a rebind refreshes `aria-expanded`.
- [`tests/component/tree/Tree.test.ts`](tests/component/tree/Tree.test.ts) — the white-box `asPrivate` / `TreePrivate` block (L202–300) and the `revealByPredicate` block (L371–454) are the patterns the new tests mirror.
- [`src/typescript/lib/component/table/TreeBody.ts`](src/typescript/lib/component/table/TreeBody.ts#L385) and [`TreeTable.ts`](src/typescript/lib/component/table/TreeTable.ts#L226) — the sibling `expandAll` / `collapseAll` precedent this API stays consistent with.
- [`docs/components/Tree.md`](docs/components/Tree.md) — the doc page; note the methods table already references the two methods.

---

## Non-Goals

- **No lazy cascade.** `expandAll` never fetches unloaded lazy branches (would fire O(branches) network calls). Documented limit, not a TODO.
- **No expansion event.** No `"expand"` / `"collapse"` custom event is added — expansion stays silent, matching `_onToggle`. If a consumer later needs to observe programmatic expansion, that is a separate widening of `TreeEvent`.
- **No `expandToDepth`** (TreeTable has one; not requested here).
- **No changes to sqladmin.** The roles-rail migration to `expanded: true` lives in that separate repo and is out of scope; this plan only enables it.
- **No `TreeOptions` expansion field.** Initial expansion is declared per-node on the data, not as a component-level option.
