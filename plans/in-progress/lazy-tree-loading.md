# Lazy (Async, On-Demand) Tree Child Loading — Implementation Plan

## Overview

Today the `Tree` treats a node as expandable **only** when it already carries a non-empty `children` array. `TreeNode` is a flat interface (`{ label; children? }`) at [TreeNode.ts:12](../src/typescript/lib/component/tree/TreeNode.ts#L12). The "has children" decision is derived from `children.length > 0` in three places — `_flatten()` at [Tree.ts:277](../src/typescript/lib/component/tree/Tree.ts#L277), `_bindAndMeasure()` at [Tree.ts:772](../src/typescript/lib/component/tree/Tree.ts#L772), and the keyboard handler at [Tree.ts:470](../src/typescript/lib/component/tree/Tree.ts#L470) / [Tree.ts:490](../src/typescript/lib/component/tree/Tree.ts#L490). Expansion is committed synchronously in `_onToggle(node)` at [Tree.ts:291](../src/typescript/lib/component/tree/Tree.ts#L291).

This plan adds **per-node async child loading**: a node declared with `hasChildren: true` + `loadChildren()` renders a caret while collapsed, and on first expansion shows a loading affordance, awaits the loader, populates `node.children`, then re-flattens and re-renders. Eager nodes (populated `children`) keep working unchanged.

Touched files: `TreeNode.ts` (interface), `Tree.ts` (toggle/flatten/has-children logic, load-state Sets, new event), `TreeRow.ts` (loading affordance on the toggle). The existing `ProgressSpinner` at [ProgressSpinner.ts](../src/typescript/lib/component/display/ProgressSpinner.ts) is reused for the affordance.

---

## Architecture Decisions

### Extend `TreeNode` with two optional fields, not a subclass

`hasChildren?: boolean` marks a node as expandable before its children exist; `loadChildren?: () => Promise<TreeNode[]>` supplies them on first expand. Both optional, so every existing `TreeNode` literal keeps compiling. This is the locked decision from the request.

### "Expandable" becomes a single predicate

The repeated `!!(node.children && node.children.length > 0)` test must now also return true when `node.hasChildren` is set. Introduce one private helper `_isExpandable(node): boolean` returning `!!(node.children && node.children.length > 0) || node.hasChildren === true`, and route all three current call sites (`_flatten`, `_bindAndMeasure`, the two keyboard branches) through it. Centralising prevents the caret/aria/flatten decisions from drifting apart.

### Load state lives in two `Set<TreeNode>` on the Tree, keyed by identity

Mirror the existing `_expandedNodes` / `_selectedNodes` identity-Sets ([Tree.ts:90](../src/typescript/lib/component/tree/Tree.ts#L90), [Tree.ts:98](../src/typescript/lib/component/tree/Tree.ts#L98)):

- `_loadingNodes: Set<TreeNode>` — a load promise is in flight; guards against duplicate concurrent loads and drives the spinner affordance.
- `_loadedNodes: Set<TreeNode>` — `loadChildren` already resolved for this node; prevents refetching on later expand/collapse cycles.

Identity keying is consistent with the rest of the component and needs no node mutation beyond writing `node.children`. Both Sets are cleared in `setNodes()` alongside the other per-node state ([Tree.ts:126](../src/typescript/lib/component/tree/Tree.ts#L126)) so a fresh dataset starts clean.

### Expansion commits only after children resolve

`_onToggle` keeps its synchronous fast path for eager nodes and already-loaded nodes. For an unloaded async node (`loadChildren` present, not in `_loadedNodes`, not in `_loadingNodes`), it does **not** add to `_expandedNodes` immediately. Instead it marks `_loadingNodes`, repaints the row's affordance, awaits the promise, and only on success writes `node.children`, marks `_loadedNodes`, adds to `_expandedNodes`, then re-flattens and re-renders. This satisfies "expansion must only commit after children resolve."

### Loading affordance: swap the caret for a `ProgressSpinner` on the loading row

`TreeRow` already owns its toggle slot and rebuilds it on every `setRowData` ([TreeRow.ts:129](../src/typescript/lib/component/tree/TreeRow.ts#L129)). Add a `loading: boolean` parameter to `setRowData`; when true the row mounts a small `ProgressSpinner` into the toggle position (same `TOGGLE_WIDTH` box, laid out by `layoutChildren`) instead of the caret `Glyph`. The spinner is sized to the row via the existing inline diameter (`new ProgressSpinner(ROW_HEIGHT - margin)` — see Internal Structure), so it occupies the caret's footprint with no layout shift. This is preferred over an overlay (`showOverlay`) because the affordance must be on a single recycled row, not over the whole tree.

Because rows are recycled, the spinner must be torn down on the next rebind exactly like the caret is (the existing `_toggle` teardown block at [TreeRow.ts:133](../src/typescript/lib/component/tree/TreeRow.ts#L133) is extended to also remove a `_spinner`).

### `_renderWindow` reads loading state per row

`_bindAndMeasure` ([Tree.ts:764](../src/typescript/lib/component/tree/Tree.ts#L764)) gains a `loading = this._loadingNodes.has(node)` lookup and forwards it to `setRowData`. After a load resolves, the Tree calls the existing re-render path (`_boundIndices.fill(-1)` + `_invalidateGeom()` + `_renderWindow()`), so the now-loaded row rebinds with `loading=false` and the real caret/children appear. Because the affordance is derived state read fresh each bind, no extra invalidation bookkeeping is needed beyond forcing a rebind when `_loadingNodes` changes.

### Error handling: revert to collapsed/unloaded and emit an event

If `loadChildren` rejects, remove the node from `_loadingNodes`, do **not** add it to `_loadedNodes` or `_expandedNodes` (so the user can retry by toggling again), re-render to drop the spinner back to a collapsed caret, and emit a new `"loaderror"` event carrying `(node, error)`. Empty resolved arrays are treated as success: `node.children = []`, marked loaded and expanded; the node then flattens to zero children and renders as an expanded-but-empty parent (caret stays, consistent with how an eager `children: []` node is handled by `_isExpandable`). This is the locked "recover gracefully" behaviour.

### New `"loaderror"` event added to `TreeEvent`

Extend the `TreeEvent` union ([Tree.ts:18](../src/typescript/lib/component/tree/Tree.ts#L18)) to `"selection" | "loaderror"`, add the typed `on`/`emit` overloads ([Tree.ts:186](../src/typescript/lib/component/tree/Tree.ts#L186), [Tree.ts:215](../src/typescript/lib/component/tree/Tree.ts#L215)), and add the optional `loaderror?: (node, error) => void` listener to `TreeOptions.listeners` ([Tree.ts:55](../src/typescript/lib/component/tree/Tree.ts#L55)) wired in the constructor ([Tree.ts:116](../src/typescript/lib/component/tree/Tree.ts#L116)). Selection stays untouched; this is purely additive.

---

## Public API (TypeScript Signatures)

```typescript
// TreeNode.ts
export interface TreeNode {
    label: string;
    children?: TreeNode[];

    /** Marks the node expandable before children load; renders a caret. */
    hasChildren?: boolean;

    /** Invoked once on first expansion of an unloaded node. */
    loadChildren?: () => Promise<TreeNode[]>;
}
```

```typescript
// Tree.ts
export type TreeEvent = "selection" | "loaderror";

export interface TreeOptions extends ComponentOptions {
    listeners?: {
        selection?: (nodes: TreeNode[]) => void;
        loaderror?: (node: TreeNode, error: unknown) => void;
    };
}

class Tree extends Component<TreeOptions> {
    // new private fields:
    private _loadingNodes: Set<TreeNode>;
    private _loadedNodes:  Set<TreeNode>;

    on(event: "selection", listener: (nodes: TreeNode[]) => void): this;
    on(event: "loaderror", listener: (node: TreeNode, error: unknown) => void): this;

    protected emit(event: "selection", nodes: TreeNode[]): void;
    protected emit(event: "loaderror", node: TreeNode, error: unknown): void;

    private _isExpandable(node: TreeNode): boolean;
    private _loadAndExpand(node: TreeNode): Promise<void>;  // async branch of _onToggle
}
```

```typescript
// TreeRow.ts — setRowData gains a trailing `loading` flag
setRowData(
    node: TreeNode, depth: number, hasChildren: boolean, expanded: boolean,
    siblingCount: number, posInSet: number, selected: boolean, loading: boolean,
): this;
```

No new typed Component setter / cached DOM field is introduced — `loading` is ephemeral per-bind state on a recycled row (handled the same way `expanded`/`selected` already are), not a persisted Component property.

---

## Internal Structure

`_onToggle` splits into the sync path plus an async helper:

```
private _onToggle(node):
    if expandedNodes.has(node):           // collapse — always sync
        expandedNodes.delete(node); reflattenAndRender(); return
    if children populated OR loadedNodes.has(node) OR no loadChildren:
        expandedNodes.add(node); reflattenAndRender(); return   // eager / already-loaded / static
    if loadingNodes.has(node): return     // duplicate-load guard
    void this._loadAndExpand(node)        // unloaded async node

private async _loadAndExpand(node):
    loadingNodes.add(node)
    rebindAndRender()                     // show spinner on the row
    try:
        const kids = await node.loadChildren!()
        node.children = kids
        loadedNodes.add(node)
        expandedNodes.add(node)
    catch (err):
        emit("loaderror", node, err)      // stays collapsed/unloaded → retryable
    finally:
        loadingNodes.delete(node)
        reflattenAndRender()
```

`reflattenAndRender()` is the existing 4-line sequence already inlined in `_onToggle` (`_flatten` + `_boundIndices.fill(-1)` + `_invalidateGeom` + `_renderWindow`); per CODE_CONVENTIONS "decompose" guidance it should be extracted to a private method since it is now called from three points.

`TreeRow` spinner field and teardown:

```typescript
private _spinner: ProgressSpinner | null = null;

// in setRowData, after the existing _toggle teardown:
if (this._spinner) { /* remove element */ this._spinner = null; }

if (loading) {
    // spinner inset by 2px inside the TOGGLE_WIDTH box so its 20px arc reads
    // as the same visual weight as the caret glyph it replaces.
    this._spinner = new ProgressSpinner(ROW_HEIGHT - SPINNER_INSET_PX * 2);
    // append to row el; positioned by layoutChildren in the toggle slot
} else if (hasChildren) {
    // existing caret branch
}
```

`layoutChildren` ([TreeRow.ts:170](../src/typescript/lib/component/tree/TreeRow.ts#L170)) positions `_spinner` in the same `[indent, TOGGLE_WIDTH]` box the caret uses when `_spinner` is set. `ROW_HEIGHT` is owned by `Tree`; pass the row height into `setRowData`'s layout via the existing `layoutChildren(rowHeight, indentPx)` call, so the spinner constructor's size argument should instead be derived inside `layoutChildren` (construct the spinner with no explicit size in `setRowData`, letting it track theme font-size, then it auto-fits `TOGGLE_WIDTH`). Decide at implementation: theme-tracked size keeps it consistent with surrounding text and needs no magic number — preferred.

---

## Ordered Implementation Steps

1. **`TreeNode.ts`** — add `hasChildren?` and `loadChildren?` with JSDoc; update the interface-level `@remarks` to mention lazy nodes. → verify: `npx tsc --noEmit` clean.
2. **`Tree.ts` — `_isExpandable` helper** — add the predicate; replace the three inline `node.children && node.children.length > 0` checks in `_flatten`, `_bindAndMeasure`, and the two keyboard branches with it. → verify: caret shows for a `{ hasChildren: true }` node in the demo.
3. **`Tree.ts` — load-state Sets** — declare `_loadingNodes` / `_loadedNodes`; clear both in `setNodes`. → verify: `grep -n "_loadingNodes\|_loadedNodes" src/typescript/lib/component/tree/Tree.ts` shows declare + clear + reads.
4. **`Tree.ts` — extract `reflattenAndRender`** from the existing `_onToggle` tail; call it from the collapse and sync-expand paths.
5. **`Tree.ts` — async `_onToggle` + `_loadAndExpand`** per Internal Structure, including the duplicate-load guard and the empty-array-as-success case.
6. **`Tree.ts` — `loaderror` event** — extend `TreeEvent`, `on`/`emit` overloads, `TreeOptions.listeners`, and constructor wiring.
7. **`Tree.ts` — `_bindAndMeasure`** — compute `loading = this._loadingNodes.has(flatRow.node)` and pass it as the new trailing `setRowData` argument.
8. **`TreeRow.ts`** — add `_spinner` field, extend `setRowData` signature + teardown + loading branch, position the spinner in `layoutChildren`, import `ProgressSpinner`. → verify: expanding an async node shows a spinner that is replaced by children on resolve.
9. **Demo (`MiscPanel.ts`)** — add one lazy node to the existing tree demo (`{ label: "Lazy folder", hasChildren: true, loadChildren: () => new Promise(r => setTimeout(() => r([{label:"Loaded A"},{label:"Loaded B"}]), 800)) }`) so the behaviour is exercisable. Optionally a second node whose loader rejects to demo `loaderror`. → verify: manual smoke in the running app.
10. **Docs** — see Documentation Impact.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/component/tree/TreeNode.ts` |
| Modify | `src/typescript/lib/component/tree/Tree.ts` |
| Modify | `src/typescript/lib/component/tree/TreeRow.ts` |
| Modify | `src/typescript/MiscPanel.ts` (demo) |
| Modify | `docs/components/Tree.md` |

No new files. `TreeNodeRenderContext` already exposes `hasChildren` to renderers, so renderers see lazy parents for free; no change there.

---

## Verification

- `npx tsc --noEmit` — clean.
- `grep -n "node.children && node.children.length > 0" src/typescript/lib/component/tree/Tree.ts` — expect zero matches after step 2 (all routed through `_isExpandable`).
- Manual smoke in the Tree demo window (MiscPanel "Show tree component"): an eager node still expands instantly; the lazy node shows a caret while collapsed, a spinner on click, then its children after the delay.
- Re-collapse and re-expand the lazy node → no second load (network/console quiet; `_loadedNodes` hit). Rapid double-click while loading → only one loader invocation (`_loadingNodes` guard).
- A rejecting loader → spinner reverts to a collapsed caret, `loaderror` listener fires, re-toggling retries.
- Keyboard: `ArrowRight` on a collapsed lazy node triggers the same load path (it calls `_onToggle`).
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc TS-version notice excepted).

---

## Documentation Impact

- `TreeNode` is already exported from the tree barrel ([tree/index.ts](../src/typescript/lib/component/tree/index.ts)); the two new optional fields need no new export. The new `TreeEvent` member and `TreeOptions.listeners.loaderror` ride the existing exports.
- Update `docs/components/Tree.md`: the `TreeNode` block currently lists only `label` / `children` — add `hasChildren?` / `loadChildren?` and a short "Lazy loading" subsection with the demo snippet and the `loaderror` event. The page also documents non-existent `expandAll`/`collapseAll` methods (pre-existing doc drift) — leave them; out of scope.
- JSDoc: `loadChildren`'s return type references `TreeNode` within the same file/bucket, so `{@link TreeNode}` is fine. The `loaderror` overload doc lives in `Tree.ts` (same bucket) — plain references.
- Sidebar (`docs/.vitepress/config.mts`) already lists Tree; no new page, no sidebar change.

---

## Potential Challenges

- **Stale render after async resolve** — between toggle and resolve the user may scroll, collapse, or call `setNodes`. Mitigation: after `await`, check the node is still reachable before committing; at minimum `setNodes` clears the Sets, so a dataset swap during a flight resolves into cleared state — guard `_loadAndExpand` to no-op its commit if `this._nodes` no longer transitively contains the node, or accept that an orphaned resolve just writes `node.children` on a detached object (harmless). Pick the simple guard.
- **Spinner teardown on recycle** — pooled rows rebind constantly; forgetting to null `_spinner` on rebind would leave a stuck spinner. Mitigation: extend the existing toggle-teardown block, covered in step 8.
- **`setRowData` arity change** — the single call site is `_bindAndMeasure` ([Tree.ts:778](../src/typescript/lib/component/tree/Tree.ts#L778)); update it in the same step. No other callers (`grep -n "setRowData" src/typescript`).
- **Spinner animation cost on long lists** — only loading rows mount a spinner, and at most a few load concurrently, so the rotating-arc keyframe cost is bounded.

---

## Critical Files

- [Tree.ts](../src/typescript/lib/component/tree/Tree.ts) — `_flatten`, `_onToggle`, `_bindAndMeasure`, `setNodes`, the `_expandedNodes`/`_selectedNodes` Set semantics, `on`/`emit`/`TreeEvent`.
- [TreeRow.ts](../src/typescript/lib/component/tree/TreeRow.ts) — toggle build/teardown in `setRowData` and `layoutChildren` positioning.
- [TreeNode.ts](../src/typescript/lib/component/tree/TreeNode.ts) — the interface to extend.
- [ProgressSpinner.ts](../src/typescript/lib/component/display/ProgressSpinner.ts) — inline-mode sizing (`new ProgressSpinner(size?)`), theme-tracked default, baseline behaviour.
- [TreeNodeRenderContext.ts](../src/typescript/lib/component/tree/TreeNodeRenderContext.ts) — already carries `hasChildren`; confirms renderers need no change.
- `CODE_CONVENTIONS.md` — typed-setter rule (n/a here, no persisted property), function decomposition (drives the `reflattenAndRender` / `_loadAndExpand` extraction), magic-number documentation (spinner inset / size).

---

## Non-Goals

- **No tree-wide bulk lazy loading** (`expandAll` that walks loaders) — out of scope; the docs' `expandAll` is pre-existing drift.
- **No caching/invalidation API** to force a reload of an already-loaded node — `_loadedNodes` is permanent for the dataset's lifetime; a fresh `setNodes` resets it. Adding a `reload(node)` is deferred.
- **No loading overlay over the whole tree** — the affordance is per-row only.
- **No retry/backoff policy** — rejection simply reverts to retryable-collapsed; the consumer decides whether to surface `loaderror`.
