---
touches-shared:
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
---

# Tree Expand/Collapse Observability — Implementation Plan

## Overview

`Tree` keeps its expanded nodes in a private set with no public getter and no event, so a consuming app cannot persist which nodes are open and restore them on reload. This plan adds three things to [packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts): a `getExpandedNodes()` snapshot getter, an `"expand"` / `"collapse"` event pair, and an `expandNodeAsync(node)` method that resolves once the expansion has committed — including after an unloaded lazy node's `loadChildren` has settled.

The state already exists. `_expandedNodes` ([Tree.ts:124](packages/lib/src/typescript/lib/component/tree/Tree.ts#L124)) is the single source of truth for expansion, and every toggle funnels through `_onToggle` ([Tree.ts:673](packages/lib/src/typescript/lib/component/tree/Tree.ts#L673)) — from a caret click, `ArrowRight`/`ArrowLeft`, a double-click on a parent row, and today's `expandNode` ([Tree.ts:655](packages/lib/src/typescript/lib/component/tree/Tree.ts#L655)). A lazy node's expansion is deferred to `_loadAndExpand` ([Tree.ts:715](packages/lib/src/typescript/lib/component/tree/Tree.ts#L715)), which commits only once the loader resolves. No new state machine is introduced: the change splits `_onToggle`'s two halves into named `_expand` / `_collapse` helpers, gives `_loadAndExpand` a boolean result, and adds one map so a second caller can join a load already in flight.

Only `Tree.ts` changes in source. `TreeRow`, the renderers, and `VirtualRowView` are untouched — the rows already re-read `_expandedNodes` on every rebind ([Tree.ts:1237](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1237)).

---

## Architecture Decisions

### Two events named `"expand"` and `"collapse"`, following `TreeStore`

The framework's data-layer tree already emits exactly this pair: `TreeStoreEvent` is `'expand' | 'collapse' | 'append' | 'removenode'` ([TreeStore.ts:16](packages/lib/src/typescript/lib/data/TreeStore.ts#L16)), fired from `TreeStore.expand` ([TreeStore.ts:514](packages/lib/src/typescript/lib/data/TreeStore.ts#L514)) and `TreeStore.collapse` ([TreeStore.ts:578](packages/lib/src/typescript/lib/data/TreeStore.ts#L578)). The component-layer `Tree` uses the same two names for the same two transitions.[^two-events]

Each listener receives the bare `TreeNode`, matching `Tree`'s own existing `"dblclick"` payload style ([Tree.ts:503](packages/lib/src/typescript/lib/component/tree/Tree.ts#L503)) rather than `TreeStore`'s wrapper-object payloads.

The wiring follows the framework's standard four-part shape for a custom event, most recently applied when `Tab` gained `"select"` (commit `fcf76411`): widen the `XEvent` union, add a key to the `listeners` option bag, add an `on()` overload carrying the full JSDoc for that event, and add an `emit()` overload. `Tree` already owns a `ListenerBag<TreeEvent>` and already calls `applyListeners` from its constructor ([Tree.ts:151](packages/lib/src/typescript/lib/component/tree/Tree.ts#L151)), so no constructor change is needed.

### One commit path shared by the synchronous and awaitable methods

`expandNode` and `expandNodeAsync` both delegate to a new private `_expand(node)`, and `_onToggle` calls the same `_expand` for its expand half and a new `_collapse` for its collapse half. `_expand` returns `Promise<boolean>` but performs the non-lazy commit synchronously before returning, so `expandNode` and every click/keyboard path keep committing in the same tick they are called.[^shared-commit]

### The events fire after the rows have been rebuilt

Both emissions happen after `_reflattenAndRender()` ([Tree.ts:637](packages/lib/src/typescript/lib/component/tree/Tree.ts#L637)), so a listener calling `getExpandedNodes()` — or reading anything else off the tree — sees the state the event announces, not the state before it.[^emit-after-render]

For a lazy node the `"expand"` emission sits at the very end of `_loadAndExpand`, after its `finally` block. The node's children are loaded, attached, and flattened into the visible rows by then. The existing `"loaderror"` emission stays exactly where it is, inside the `catch`.

### A second `expandNodeAsync` on a loading node joins the first load

A new private `_pendingExpansions: Map<TreeNode, Promise<boolean>>` holds the in-flight promise for each node being loaded. A second call for the same node returns that promise instead of starting a second load, so both callers resolve with one load's outcome and `"expand"` fires at most once.[^join-map]

`setNodes` clears the map alongside `_loadingNodes` and `_loadedNodes`, so a dataset swap drops every in-flight expansion the same way it drops every other piece of per-node bookkeeping.

### Only single-node toggles emit; the bulk methods stay silent

`setNodes` ([Tree.ts:218](packages/lib/src/typescript/lib/component/tree/Tree.ts#L218)), `expandAll` ([Tree.ts:244](packages/lib/src/typescript/lib/component/tree/Tree.ts#L244)), and `revealByPredicate` ([Tree.ts:364](packages/lib/src/typescript/lib/component/tree/Tree.ts#L364)) write `_expandedNodes` in bulk without going through the toggle path, and none of them emits `"expand"` or `"collapse"`. A consumer reads `getExpandedNodes()` after calling one of them.[^bulk-silent]

A programmatic `expandNode` / `expandNodeAsync` *does* emit, unlike the deliberately silent `selectNode` ([Tree.ts:317](packages/lib/src/typescript/lib/component/tree/Tree.ts#L317)).[^programmatic-emits]

### Which calls emit what

This table is the contract. Every row is a unit test (see `## Expected Behaviour`).

| Call | Change to the expanded set | Emits | `expandNodeAsync` resolves |
|---|---|---|---|
| caret click / `ArrowRight` on a collapsed node | node added | `"expand"` | — |
| caret click / `ArrowLeft` on an expanded node | node removed | `"collapse"` | — |
| `expandNode(collapsed)` | node added | `"expand"` | — |
| `expandNode(alreadyExpanded)` | none | nothing | — |
| `expandNodeAsync(collapsed, eager)` | node added, in the same tick | `"expand"` | `true` |
| `expandNodeAsync(collapsed, lazy)`, loader resolves | node added, after the load | `"expand"` | `true` |
| `expandNodeAsync(collapsed, lazy)`, loader rejects | none | `"loaderror"` only | `false` |
| `expandNodeAsync(alreadyExpanded)` | none | nothing | `true` |
| `expandNodeAsync(node already loading)` | joins the first call | at most one `"expand"` | the first call's result |
| `expandNodeAsync(leaf)` | leaf added, nothing becomes visible | `"expand"` | `true` |
| `setNodes()` mid-load, then the load settles | none | nothing | `false` |
| `expandAll()` | many added | nothing | — |
| `revealByPredicate()` | ancestors added | nothing | — |
| `setNodes()` | all cleared | nothing | — |

A rejected load emits only the existing `"loaderror"`: the node never entered the expanded set, so there is no transition to report. There is no public collapse method, so `"collapse"` can only follow a real removal from the set — an already-collapsed node has no call that could re-fire it.

`expandNodeAsync(leaf)` adds a childless node to the expanded set and emits. That is today's `expandNode` behaviour, kept unchanged: the node has no toggle glyph and `_flatten` ignores it, so nothing renders differently.[^no-guard-leaf]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/tree/Tree.ts

export type TreeEvent = "selection" | "loaderror" | "contextmenu" | "dblclick" | "expand" | "collapse";

export interface TreeOptions extends ComponentOptions {
    rowOverflow?: TreeRowOverflow;

    listeners?: {
        selection?:   (nodes: TreeNode[]) => void;
        loaderror?:   (node: TreeNode, error: unknown) => void;
        contextmenu?: (node: TreeNode, event: MouseEvent) => void;
        dblclick?:    (node: TreeNode) => void;
        expand?:      (node: TreeNode) => void;
        collapse?:    (node: TreeNode) => void;
    };
}

class Tree extends VirtualRowView<TreeRow, TreeOptions> {

    /** Every currently expanded node, in no guaranteed order. A snapshot copy. */
    getExpandedNodes(): TreeNode[];

    /** Unchanged signature; now emits `"expand"` when it commits. */
    expandNode(node: TreeNode): this;

    /** Expands `node` and resolves once the expansion has committed. */
    expandNodeAsync(node: TreeNode): Promise<boolean>;

    on(event: "expand",   listener: (node: TreeNode) => void): this;
    on(event: "collapse", listener: (node: TreeNode) => void): this;

    protected emit(event: "expand",   node: TreeNode): void;
    protected emit(event: "collapse", node: TreeNode): void;
}
```

New private state backing `expandNodeAsync`'s join behaviour. The map is framework-internal bookkeeping, not consumer configuration, so it gets a private field with **no** `TreeOptions` key and **no** accessor — the options bag is reserved for consumer-configurable properties ([ARCHITECTURE.md](ARCHITECTURE.md), *Three non-negotiable rules for every DOM write*, rule 3). A plain initializer is correct: no setter dispatched during the `super()` cascade writes the map, so the `declare` rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) does not apply.

```typescript
private _pendingExpansions : Map<TreeNode, Promise<boolean>> = new Map();
```

---

## Internal Structure

The three new private helpers, in full.

```typescript
/**
 * Commits `node`'s expansion, loading a lazy node's children first.
 *
 * @remarks
 * An already-loaded node commits synchronously — the returned promise is
 * already resolved by the time this returns, so a caller that ignores it
 * still sees the expansion in the same tick.
 */
private _expand(node: TreeNode): Promise<boolean> {
    const needsLoad = node.loadChildren !== undefined
        && !this._loadedNodes.has(node)
        && !(node.children && node.children.length);

    if (needsLoad) {
        return this._expandLazy(node);
    }

    this._expandedNodes.add(node);
    this._reflattenAndRender();
    this.emit("expand", node);

    return Promise.resolve(true);
}

/** Removes `node` from the expanded set, re-renders, then reports the change. */
private _collapse(node: TreeNode): void {
    this._expandedNodes.delete(node);
    this._reflattenAndRender();
    this.emit("collapse", node);
}

/**
 * Starts a lazy node's load-and-expand, or joins the one already running for
 * that node so a second caller never triggers a second `loadChildren`.
 */
private _expandLazy(node: TreeNode): Promise<boolean> {
    const inFlight = this._pendingExpansions.get(node);

    if (inFlight !== undefined) {
        return inFlight;
    }

    const pending = this._loadAndExpand(node);

    this._pendingExpansions.set(node, pending);

    // Identity-checked so a `setNodes` that cleared the map mid-flight, followed
    // by a fresh load for the same node object, is not un-registered by the
    // orphaned load's own cleanup.
    void pending.then(() => {
        if (this._pendingExpansions.get(node) === pending) {
            this._pendingExpansions.delete(node);
        }
    });

    return pending;
}
```

`_onToggle` becomes a two-branch dispatcher:

```typescript
private _onToggle(node: TreeNode): void {
    if (this._expandedNodes.has(node)) {
        this._collapse(node);

        return;
    }

    void this._expand(node);
}
```

`_loadAndExpand` keeps every existing statement and adds a result flag plus the tail emission. The two early `return false` statements are the orphan path — `setNodes` swapped the dataset while the loader ran — and they still run the `finally` before returning, exactly as today, while skipping the emission:

```typescript
private async _loadAndExpand(node: TreeNode): Promise<boolean> {
    this._loadingNodes.add(node);
    this._reflattenAndRender();

    let expanded = false;

    try {
        const children = await node.loadChildren!();

        if (!this._loadingNodes.has(node)) {
            return false;
        }

        node.children = children;
        this._loadedNodes.add(node);
        this._expandedNodes.add(node);
        expanded = true;
    } catch (error) {
        if (!this._loadingNodes.has(node)) {
            return false;
        }

        this.emit("loaderror", node, error);
    } finally {
        this._loadingNodes.delete(node);
        this._reflattenAndRender();
    }

    if (expanded) {
        this.emit("expand", node);
    }

    return expanded;
}
```

The two public methods:

```typescript
expandNode(node: TreeNode): this {
    if (!this._expandedNodes.has(node)) {
        void this._expand(node);
    }

    return this;
}

async expandNodeAsync(node: TreeNode): Promise<boolean> {
    if (this._expandedNodes.has(node)) {
        return true;
    }

    return this._expand(node);
}
```

---

## Ordered Implementation Steps

Every step is in [packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts) unless stated otherwise. Line numbers are as of writing; find the symbol by name if they have drifted.

1. **Widen the event union.** At [Tree.ts:22](packages/lib/src/typescript/lib/component/tree/Tree.ts#L22), append `| "expand" | "collapse"` to `TreeEvent`. Leave the union's JSDoc block above it unchanged.

2. **Widen the listener bag.** In `TreeOptions.listeners` ([Tree.ts:78-83](packages/lib/src/typescript/lib/component/tree/Tree.ts#L78)), add `expand?: (node: TreeNode) => void;` and `collapse?: (node: TreeNode) => void;` after `dblclick`. No constructor change: `applyListeners` at [Tree.ts:151](packages/lib/src/typescript/lib/component/tree/Tree.ts#L151) already dispatches every key in the bag.

3. **Add the private map.** After `_loadedNodes` ([Tree.ts:136](packages/lib/src/typescript/lib/component/tree/Tree.ts#L136)), add `private _pendingExpansions : Map<TreeNode, Promise<boolean>> = new Map();`, keeping the column alignment of the surrounding field block.

4. **Clear it on `setNodes`.** In `setNodes` ([Tree.ts:218](packages/lib/src/typescript/lib/component/tree/Tree.ts#L218)), add `this._pendingExpansions.clear();` immediately after `this._loadedNodes.clear();`.

5. **Add `getExpandedNodes`.** Insert it directly after `getSelectedNodes` ([Tree.ts:299-301](packages/lib/src/typescript/lib/component/tree/Tree.ts#L299)), copying that method's shape exactly — `return Array.from(this._expandedNodes);` with a `@returns` line. Add one `@remarks` sentence stating that `expandAll` and `revealByPredicate` fill the set without emitting `"expand"`, so this getter is how you read the state after either.

6. **Add the `on()` overloads.** After the `"dblclick"` overload ([Tree.ts:503](packages/lib/src/typescript/lib/component/tree/Tree.ts#L503)) and before the implementation signature at [Tree.ts:504](packages/lib/src/typescript/lib/component/tree/Tree.ts#L504), add one overload per new event, each with the full JSDoc block the sibling overloads carry. Content to cover, matching the depth of the `"select"` overload added to `Tab` ([Tab.ts:2329](packages/lib/src/typescript/lib/layout/Tab.ts#L2329)): `"expand"` fires after the expansion has committed and the rows have been rebuilt — for an unloaded lazy node, after `loadChildren` resolved and the children were attached, not when the toggle was requested; `"collapse"` fires after the node leaves the expanded set; neither fires from `setNodes`, `expandAll`, or `revealByPredicate`; a rejected lazy load fires only `"loaderror"`. Do not `{@link}` any private symbol, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (*Don't `{@link}` internal symbols from public JSDoc*).

7. **Add the `emit()` overloads.** After the `"dblclick"` overload ([Tree.ts:535](packages/lib/src/typescript/lib/component/tree/Tree.ts#L535)): `protected emit(event: "expand", node: TreeNode): void;` and the same for `"collapse"`.

8. **Update `_loadAndExpand` first**, so the helpers added next can rely on its result. Change the return type to `Promise<boolean>`, add the `expanded` flag, return `false` from both orphan checks, and add the tail `if (expanded) { this.emit("expand", node); }` before `return expanded;` — per `## Internal Structure`. Do not move the `"loaderror"` emit. Extend its `@remarks` with one sentence: the `"expand"` emission is the last thing it does, after the re-render, so a listener sees the loaded children already flattened. `_onToggle`'s existing `void this._loadAndExpand(node)` call still compiles unchanged.

9. **Add `_expand`, `_collapse`, and `_expandLazy`.** Place all three immediately after `_onToggle`, before `_loadAndExpand`, with the bodies given in `## Internal Structure`. They are unreferenced until the next step.

10. **Rewrite `_onToggle`.** Replace its body ([Tree.ts:673-697](packages/lib/src/typescript/lib/component/tree/Tree.ts#L673)) with the two-branch dispatcher from `## Internal Structure`. This deletes the inline `needsLoad` computation (it moved to `_expand`) and the `if (this._loadingNodes.has(node)) { return; }` guard (`_expandLazy` now owns in-flight de-duplication).[^drop-loading-guard] Update its `@remarks` to name the two helpers instead of describing the inline branches.

11. **Rewrite `expandNode` and add `expandNodeAsync`.** Replace `expandNode`'s body ([Tree.ts:655-661](packages/lib/src/typescript/lib/component/tree/Tree.ts#L655)) with the `_expand` delegation, and add `expandNodeAsync` directly after it. Give `expandNodeAsync` a full JSDoc block: what it resolves to (`true` when the node ends up expanded, including when it already was; `false` when a lazy load rejected and the node stayed collapsed), that a second call while a load is in flight joins that load instead of starting another, and that it emits `"expand"` on a real transition. Add a `@see`-style sentence to `expandNode` pointing at `expandNodeAsync` for callers that need to know when a lazy expansion finished.

12. **Note the bulk paths in the existing docs.** Add one sentence to `revealByPredicate`'s JSDoc ([Tree.ts:364](packages/lib/src/typescript/lib/component/tree/Tree.ts#L364)) beside its existing "does not emit `"selection"`" paragraph: it expands ancestors without emitting `"expand"` either — read `getExpandedNodes()` afterwards. `expandAll`'s JSDoc ([Tree.ts:238-243](packages/lib/src/typescript/lib/component/tree/Tree.ts#L238)) already says it emits no event and needs no change.

13. **Checkpoint — the emit sites are where the plan says.** From the repo root, `grep -n 'emit("expand"\|emit("collapse"' packages/lib/src/typescript/lib/component/tree/Tree.ts` — expect exactly three matches: one in `_expand`, one at the tail of `_loadAndExpand`, one in `_collapse`. Then `grep -n '_onToggle(' packages/lib/src/typescript/lib/component/tree/Tree.ts` — expect the declaration plus exactly four call sites (two in `_onKeyDown`, one in `_handleClick`, one in `_handleDblClick`); `expandNode` must no longer be among them.

14. **Fix the test's inline type for `_loadAndExpand`.** In [packages/lib/tests/component/tree/Tree.test.ts:454](packages/lib/tests/component/tree/Tree.test.ts#L454), change the cast's `Promise<void>` to `Promise<boolean>`. The cast goes through `unknown`, so this is accuracy, not a compile fix.

15. **Add the unit tests.** In [packages/lib/tests/component/tree/Tree.test.ts](packages/lib/tests/component/tree/Tree.test.ts), add a `describe('Tree — expand / collapse observability', …)` block after the existing `_onToggle` block ([Tree.test.ts:393](packages/lib/tests/component/tree/Tree.test.ts#L393)), covering every case in `## Expected Behaviour`. Use `new _Tree()` (no element — the render paths already guard on `getElement()`), the existing `fruitTree()` fixture, and the existing `asPrivate` helper ([Tree.test.ts:251](packages/lib/tests/component/tree/Tree.test.ts#L251)) where a test needs `_flatRows` or `_expandedNodes`. The new events are reachable through the public `on()`, so no widening of the `TestTree` white-box subclass is needed.

16. **Update the docs.** Per `## Documentation Impact`.

17. **Run the checks.** Per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row of the emission table in `## Architecture Decisions` is one unit test. All of them are offline-testable: the tree needs no element, `_reflattenAndRender` is safe without one, and lazy loads are driven by a hand-written `loadChildren` returning a resolved or rejected promise (the pattern already used at [Tree.test.ts:448](packages/lib/tests/component/tree/Tree.test.ts#L448) and [Tree.test.ts:555](packages/lib/tests/component/tree/Tree.test.ts#L555)).

Beyond that table, pin these:

- **`getExpandedNodes()` on a fresh tree returns `[]`**, and after `expandNode(nodes[0])` returns `[nodes[0]]`.
- **`getExpandedNodes()` returns a snapshot.** Mutating the returned array (push/pop) does not change what the tree reports on the next call.
- **`setNodes` empties it.** Expand a node, call `setNodes(fresh)`, expect `[]` and zero `"collapse"` emissions.
- **The listener sees current state.** Inside an `"expand"` listener for an eager parent, `getExpandedNodes()` already contains the node and `_flatRows` already contains its children. Inside a `"collapse"` listener, `_flatRows` no longer contains them.
- **The eager commit is synchronous.** Call `expandNodeAsync(eagerParent)` and assert `_expandedNodes.has(eagerParent)` *before* awaiting the returned promise.
- **A rejected lazy load leaves the node retryable.** After the `false` resolution, the node is absent from `_expandedNodes` and `_loadedNodes`; a second `expandNodeAsync` calls `loadChildren` again.
- **Two overlapping `expandNodeAsync` calls run one load.** With a deferred `loadChildren` (a promise resolved by the test), call `expandNodeAsync(lazy)` twice before resolving it; expect `loadChildren` invoked once, both promises `true`, and exactly one `"expand"`.
- **`expandNode` then `expandNodeAsync` on the same lazy node also runs one load**, one `"expand"`, and the async call resolves `true`.
- **A `setNodes` during an in-flight load orphans it.** Start `expandNodeAsync(lazy)`, call `setNodes(other)` before resolving the loader, then resolve it: the promise resolves `false`, no `"expand"` and no `"loaderror"` fire, and the node is not in `_expandedNodes`.
- **`expandAll()` and `revealByPredicate()` emit nothing** while `getExpandedNodes()` reflects what they expanded.
- **The construction-time bag wires both events.** `new _Tree({ listeners: { expand: fn, collapse: fn } })` then a toggle fires each once.

Manual verification (not reachable from the offline harness — real clicks, keyboard, and the spinner affordance):

- In the library demo app (`npm run dev` in `packages/lib`), the Content Box panel's trees ([ContentBoxPanel.ts:443](packages/lib/src/typescript/ContentBoxPanel.ts#L443)) still expand and collapse on caret click, `ArrowRight` / `ArrowLeft`, and double-click on a parent row, with no visible change in timing or flicker.
- In the docs app (`npm run dev` in `packages/docs`), the sidebar's Guide and Reference sections still open on load — they are opened by `expandNode` ([DocsSidebar.ts:98-99](packages/docs/src/shell/DocsSidebar.ts#L98)) — and the search path that calls `expandAll` ([DocsSidebar.ts:317](packages/docs/src/shell/DocsSidebar.ts#L317)) still expands everything.
- A lazy node still shows its spinner while loading and swaps to an expanded caret when the loader resolves.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — the library build's type check.
- `npm run typecheck:test && npx vitest run tests/component/tree/Tree.test.ts` — the new and existing Tree tests.
- `npm run test` — the full library suite; `MarkdownMinimap` embeds a `Tree` and drives it through `expandAll`, so its tests cover a second consumer of the expansion path.
- `npm run lint` — the local ESLint rules, including the DOM and options-forwarding guards.
- `npm run docs:api` — must finish with **zero** warnings; a `{@link}` from the new public JSDoc to a private symbol is exactly what it flags.
- `grep -n 'emit("expand"\|emit("collapse"' src/typescript/lib/component/tree/Tree.ts` — expect three matches (step 13).
- `grep -n '_loadingNodes.has' src/typescript/lib/component/tree/Tree.ts` — expect exactly two matches, both the orphan checks inside `_loadAndExpand`; the `_onToggle` guard is gone.

From `packages/docs`, `npm run test` — [DocsSidebar.test.ts](packages/docs/tests/DocsSidebar.test.ts) exercises the sidebar tree's `expandAll` and the sidebar itself calls `expandNode`, so it is the closest thing to an integration check for this change.

Manual smoke tests: the three bullets at the end of `## Expected Behaviour`.

---

## Documentation Impact

- **Barrel** — no change. `TreeEvent` and `TreeOptions` are already re-exported from [packages/lib/src/typescript/lib/component/tree/index.ts:4](packages/lib/src/typescript/lib/component/tree/index.ts#L4); widening them needs no new export, and the new methods ride on the already-exported `Tree`.
- **`packages/lib/docs/components/Tree.md`** — add three rows to the *Common methods* table ([Tree.md:78-87](packages/lib/docs/components/Tree.md#L78)): `getExpandedNodes()`, `expandNodeAsync(node)`, and `on("expand", fn)` / `on("collapse", fn)`. Add a short `## Expansion state` section after *Lazy loading* showing the persist-and-restore shape the events exist for — subscribe to both events, store `getExpandedNodes()`, and on reload `await expandNodeAsync(node)` per stored node — and stating plainly that `expandAll` and `revealByPredicate` change the expansion without emitting.
- **`packages/lib/docs/reference/changelog/next.md`** — under `## Added` → `### Tree` ([next.md:234](packages/lib/docs/reference/changelog/next.md#L234)), add bullets in the house style (bold lead, what it does, closing "No consumer action is needed."): one for the `"expand"` / `"collapse"` event pair, one for `getExpandedNodes()`, one for `expandNodeAsync(node)`.
- **`packages/lib/llms.txt`** — no change and no regeneration needed. It is generated from a curated manifest plus each symbol's first JSDoc paragraph, and the `Tree` class summary is untouched.

---

## Potential Challenges

- **A listener that toggles during dispatch.** Both emissions are the last statement on their path, after the state and the rows have settled, so a `"collapse"` listener that immediately re-expands the node behaves like any other caller. Keep the emissions last when editing these methods.
- **`_loadAndExpand`'s `finally` runs on the orphan path too.** The two early `return false` statements still execute the `finally` (deleting the loading marker and re-rendering) before returning — that is today's behaviour and must stay. Do not move the cleanup out of `finally`.
- **The `"loaderror"` emit stays inside `catch`, before the re-render.** It is deliberately not moved to the tail; changing its position would alter an already-published contract for no gain.

---

## Critical Files

| File | Why |
|---|---|
| [packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts) | The only source file changed. Read `_onToggle`, `_loadAndExpand`, `expandNode`, `_reflattenAndRender`, and the `on`/`off`/`emit` block in full first. |
| [packages/lib/src/typescript/lib/data/TreeStore.ts:514-590](packages/lib/src/typescript/lib/data/TreeStore.ts#L514) | The precedent this design mirrors: `'expand'` / `'collapse'` named the same way, an async `expand` that awaits the lazy load, and both emissions placed after the re-flatten. |
| [packages/lib/src/typescript/lib/layout/Tab.ts:52](packages/lib/src/typescript/lib/layout/Tab.ts#L52), [Tab.ts:2329](packages/lib/src/typescript/lib/layout/Tab.ts#L2329) | The most recent worked example of widening an `XEvent` union: union, `listeners` key, `on()` overload with full JSDoc, `emit()` overload. |
| [packages/lib/src/typescript/lib/core/ListenerBag.ts](packages/lib/src/typescript/lib/core/ListenerBag.ts) | The fan-out `emit` delegates to; registration-order firing is a documented guarantee. |
| [packages/lib/tests/component/tree/Tree.test.ts](packages/lib/tests/component/tree/Tree.test.ts) | The offline harness, the `fruitTree()` fixture, `asPrivate`, and the existing lazy-load test patterns. |
| [ARCHITECTURE.md](ARCHITECTURE.md) (*Event handling*) | The `on` / `off` / `emit` + `ListenerBag` contract and the closed `listeners` bag rule. |

---

## Non-Goals

- **No `collapseNode` / `collapseAll` on `Tree`.** Neither is asked for here. (Note that [Tree.md:83](packages/lib/docs/components/Tree.md#L83) already lists a `collapseAll()` that `Tree` does not have — a pre-existing docs error, left alone rather than fixed or implemented under this plan.)
- **No `"expand"` / `"collapse"` from `expandAll`, `revealByPredicate`, or `setNodes`.** See the emission table; `getExpandedNodes()` covers reading the state after a bulk change.
- **No expansion persistence in the library.** `Tree` reports transitions and exposes the set; storing and restoring it is the consuming app's job.
- **No change to `TreeBody` / `TreeTable`.** They are a separate table-layer hierarchy with their own expansion state and are untouched.
- **No guard rejecting a non-expandable node.** `expandNode`'s current behaviour on a leaf is preserved rather than tightened.

---

## Implementation Notes

- **`next.md` had already been reset by the 0.5.0 release.** The plan's
  `## Documentation Impact` pointed at `next.md:234`, under an existing
  `## Added` → `### Tree` section — that content was accurate when the plan
  was written, but the repo tagged 0.5.0 afterward (see `0.5.0.md`, itself
  built from that same `next.md` content) and reset `next.md` to its empty
  template. There was no section to add three bullets to; instead the
  `## Added` → `### Tree` structure was created fresh in `next.md`, copying
  the exact house style (bold lead, description, closing "No consumer action
  is needed.") from `0.5.0.md`'s own `### Tree` entries.
- **The `_loadingNodes.has` verification grep finds three matches, not the
  plan's expected two.** Step 13 and `## Verification` both expect exactly
  two — the orphan checks inside `_loadAndExpand`. A third, pre-existing
  match already lived in `_bindAndMeasure` (`const loading =
  this._loadingNodes.has(flatRow.node);`), reading loading state to bind a
  row's spinner affordance — unrelated to the `_onToggle` guard this plan
  removed and present before this change. The plan's count only tracked the
  guard being deleted and didn't account for this unrelated site, so the
  grep now legitimately returns three: the two orphan checks plus this one.
- **The three manual-verification bullets under `## Expected Behaviour` were
  performed live against this branch**, not merely left as a documented
  intent. Both dev servers were started from inside this worktree (port 8016
  for `packages/lib`, port 5174 for `packages/docs`), with a `node_modules/
  @jimka/typescript-ui` symlink added at the worktree root pointing at this
  worktree's own `packages/lib` — without it, Node's module resolution walks
  up past the worktree into the main tree's `node_modules/@jimka/
  typescript-ui`, silently exercising the main tree's unfixed `Tree.ts`
  instead of this branch's. Findings, via Chrome DevTools MCP: (1) in the
  library demo app's Content Box panel, caret click, `ArrowRight` /
  `ArrowLeft`, and double-click on a parent row all still expand/collapse
  correctly, with no visible flicker; (2) in the docs app, the sidebar's
  Guide and Reference sections are open on load (`expandNode`) and typing
  "tree" into search still expands every matching branch down to leaf API
  entries (`expandAll`); (3) the Misc panel's "Lazy folder" node (an 800ms
  `loadChildren`) loads and renders its children correctly on first
  expansion — confirmed by screenshot, both freshly and after a re-open —
  showing the resolve half of the loading→settle state machine this plan
  modifies live end to end. (The reject half was also triggered via
  "Lazy folder (fails)", but the page closed before a screenshot could
  confirm its rendered result; that path stays covered by the automated
  suite's dedicated reject-path tests, not by this manual check.) Both dev
  servers were meant to be stopped immediately afterward via `kill` on the
  PID `$!` reported for each backgrounded `nohup ... &` launch — but `npm
  exec vite` interposes an `npm exec` process and a `sh -c "vite"` shell
  between that reported PID and the actual `vite` child, so the `kill` hit
  neither and both servers (and the `node_modules/@jimka/typescript-ui`
  symlink used to point them at this worktree) were still running — and this
  note's original wording wrongly claimed otherwise — until the second audit
  round of this branch caught the discrepancy. Both were killed and the
  symlink removed once found.

---

## Notes

[^two-events]: Two named events, not one `sectiontoggle`-style event carrying a boolean. `Accordion` takes the other route — `emit("sectiontoggle", index, open)` ([Accordion.ts:913](packages/lib/src/typescript/lib/layout/Accordion.ts#L913)) — so both shapes exist in the codebase. `TreeStore` is the closer precedent by every measure: it is a *tree*, it keys expansion by node, and it already publishes `'expand'` / `'collapse'` under those exact names. Matching it means a consumer moving between the data-layer tree and the component-layer tree learns one vocabulary. Two events also let a consumer subscribe to only the half it cares about without a boolean test in the handler.

[^shared-commit]: The alternative — a separate async implementation beside the existing synchronous one — was rejected because the two would have to stay behaviourally identical for a non-lazy node forever, with the lazy-load branch, the `_loadedNodes` cache write, and the re-render duplicated in both. The shared `_expand` keeps one commit path, so there is exactly one place that adds to `_expandedNodes` for a single-node expansion and exactly one place that emits `"expand"` for it. The sharing costs nothing at the click and keyboard call sites: `_expand`'s non-lazy branch runs to completion before it returns, and `Promise.resolve(true)` is discarded by the `void` at those sites. The one visible difference from today is that a non-lazy expansion now allocates a resolved promise per toggle, which is not measurable against the re-flatten and re-render it sits beside.

[^emit-after-render]: Emitting before `_reflattenAndRender()` would hand the listener a tree whose `getExpandedNodes()` is current but whose visible rows are one step stale — a listener that measured, scrolled, or read row state would see the pre-toggle layout. `TreeStore.expand` orders it the same way (`flatten()` then `emit('expand', …)`, [TreeStore.ts:530-531](packages/lib/src/typescript/lib/data/TreeStore.ts#L530)). The existing `"loaderror"` emission is the one exception in this file and is deliberately left where it is: it reports a failure, not a committed state change, and moving it would change published behaviour for no benefit.

[^join-map]: `_loadingNodes` cannot itself carry the promise. `_loadAndExpand` adds the node to that set and re-renders in its first two statements, before the promise it returns exists, so nothing can key a map by node with the promise as its value from inside that method. A separate map written by the caller (`_expandLazy`) is the smallest structure that lets a second caller receive the first call's promise. The `.then` cleanup — rather than a `_pendingExpansions.delete` in `_loadAndExpand`'s `finally` — matters for one reachable case: a `loadChildren` that throws *synchronously* runs `catch` and `finally` before `_loadAndExpand` returns, so a `finally`-based delete would fire before the map entry was ever written and leave a settled `false` promise in the map permanently, making that node impossible to expand ever again. A `.then` callback always runs in a later microtask, after the `set`. The identity check inside it covers the other direction: `setNodes` clears the map while a load is in flight, and without the check the orphan's cleanup would later delete a *fresh* entry for the same node object. A resolver-list design (`Map<TreeNode, Array<(ok: boolean) => void>>` drained on every settle path) was considered and rejected as more code for the same behaviour.

[^bulk-silent]: `expandAll` already documents that it emits no event, and firing one `"expand"` per node would turn a single call into thousands of emissions on a large tree. `revealByPredicate` expands an arbitrary number of ancestors as a side effect of a search; per-ancestor events would report path plumbing rather than a user-meaningful transition. `setNodes` drops the whole dataset — the nodes it clears are about to stop existing, so a `"collapse"` naming each of them would report the disposal of state, not a collapse. The rule a consumer learns is simple: the toggle path reports, the bulk paths do not, and `getExpandedNodes()` is the read after a bulk change.

[^programmatic-emits]: `selectNode` is silent by design ([Tree.ts:305-310](packages/lib/src/typescript/lib/component/tree/Tree.ts#L305)) because it exists to sync the tree *to* an external source of truth, and re-emitting would re-trigger the selection-driven side effects that source just finished performing. `expandNode` is documented as the opposite kind of method — "the same commit path as clicking its collapsed caret" — so silence would make it the odd one out against its own contract. It also matters for the motivating consumer: an app that persists expansion needs its stored set to stay true after a programmatic expansion, and a silent `expandNode` would let the store drift from the tree. Re-emission during a restore loop is harmless, because the handler writes back the set it just restored.

[^no-guard-leaf]: `_onToggle` today adds any non-lazy node to `_expandedNodes`, leaf or not, and `_flatten` ignores the entry because it also tests `_isExpandable` ([Tree.ts:619](packages/lib/src/typescript/lib/component/tree/Tree.ts#L619)). Adding an `_isExpandable` guard to `_expand` would be a behaviour change unrelated to observability, would silently alter what `expandNode` does for existing callers, and would need its own decision about what `expandNodeAsync` then resolves to. The case is pinned as a test so nobody adds the guard while implementing this plan.

[^drop-loading-guard]: `_onToggle`'s `if (this._loadingNodes.has(node)) { return; }` guard exists to stop a second click from starting a second `loadChildren`. `_expandLazy` now enforces that for every caller by returning the in-flight promise, and `_onToggle` discards the return value, so its net behaviour is unchanged. Keeping both would leave two independent answers to "is this node already loading?" — one keyed on `_loadingNodes`, one on `_pendingExpansions` — which is exactly the kind of pair that drifts apart when one of them later gains a condition.
