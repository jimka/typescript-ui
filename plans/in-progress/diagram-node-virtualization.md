# Diagram Node Virtualization — Implementation Plan

## Overview

[`DiagramView`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) mounts every node in a graph as a live DOM component and leaves it mounted for the view's whole life. [`rebuildNodes`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L473) builds one component per node, and [`promoteIncomingNodes`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L517) adds all of them to the content host unconditionally. Pan and zoom are a single CSS transform on that host ([`applyTransformToHost`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L786)), so every mounted node rides one transform and repaints with it. On a real 325-node graph this puts roughly 6,300 elements in one view, and produces poor interaction latency and parts of the graph painting empty.[^measured]

This plan makes *mounting* viewport-driven. Every node component is still built, measured, and positioned exactly as today — only the set that is attached to the content host changes. A node is **resident** when its laid-out box intersects a *residency rect*: the visible graph rectangle inflated by half a viewport on each side. The residency rect is sized from the viewport alone and is re-centred only when the live viewport travels past a quarter of a viewport, so an ordinary pan changes the mounted set a few times per screen instead of every frame.

Only one source file changes — `DiagramView.ts` — plus its tests, one docs page, and the changelog. No consumer-facing API is added, removed, or altered. Edge virtualization is deliberately left to a named follow-on plan.

---

## Architecture Decisions

### Only mounting is windowed — every node component is still built and positioned

`rebuildNodes`, [`collectNodeSizes`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L647), and the positioning loop in [`applyLayout`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L680) are untouched: every node in the graph gets a component, is measured for ELK, and receives its `setX` / `setY` / `setPreferredSize`. What changes is that `promoteIncomingNodes` adds only the resident subset to the content host.[^build-all]

A component that is never added to a rendered parent never creates a DOM element, so the document only ever holds elements for nodes that have been resident at some point.

### The residency rect is sized from the viewport and re-centred by hysteresis

Two pure rules, both derived from the viewport alone and never from which nodes happen to be nearby:

- **Size** — the residency rect is the visible graph rectangle inflated by `NODE_RESIDENCY_MARGIN` (`0.5`) of its own extent on each of the four sides, so it is twice the viewport in each axis.
- **Placement** — the rect is recomputed only when the live visible rectangle has different extents from the committed one (a zoom or a viewport resize), or when it is no longer fully inside the *trigger rect*: the committed rectangle inflated by half that margin.

This mirrors [`computeColumnWindowSize`](packages/lib/src/typescript/lib/component/table/Body.ts#L138) and [`computeColumnWindow`](packages/lib/src/typescript/lib/component/table/Body.ts#L186), which size the rendered column window from the viewport and then place it, rather than deriving it from the current scroll offset — and behind those, [`VirtualRowView.computePoolTarget`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L296), whose doc comment states the rule both follow.[^precedent]

Worked against a 1000×600 viewport at zoom 1 with the pan at the origin, so the visible graph rectangle is `{x: 0, y: 0, width: 1000, height: 600}`. The residency rect is then `{x: -500, y: -300, width: 2000, height: 1200}`, spanning `x ∈ [-500, 1500]` and `y ∈ [-300, 900]`:

| Node box | Resident? | Why |
|---|---|---|
| `{x: 100, y: 100, w: 80, h: 40}` | yes | inside the viewport |
| `{x: 1200, y: 0, w: 80, h: 40}` | yes | outside the viewport, inside the residency rect |
| `{x: 1600, y: 0, w: 80, h: 40}` | no | starts past the residency rect's right edge (1500) |
| `{x: -600, y: -400, w: 2000, h: 1000}` | yes | a container box straddling the rect intersects it |

And the refresh rule, with the same rectangle as the committed one. Its trigger rect is that rectangle inflated by `0.25`, spanning `x ∈ [-250, 1250]` and `y ∈ [-150, 750]`:

| Live visible rectangle | Refresh? | Why |
|---|---|---|
| `{0, 0, 1000, 600}` | no | identical to the committed one |
| `{200, 0, 1000, 600}` | no | right edge 1200 is inside the trigger rect |
| `{300, 0, 1000, 600}` | yes | right edge 1300 is past the trigger rect's 1250 |
| `{0, 0, 500, 300}` | yes | extents differ — the view zoomed in |
| `{0, 0, 2000, 1200}` | yes | extents differ — the view zoomed out |

### Unmounting detaches the element; it never disposes or releases the component

Leaving the residency set calls `_contentHost.removeComponent(component)`, which routes through [`unwireChild`](packages/lib/src/typescript/lib/core/Component.ts#L6313) and takes the element out of the document while leaving the component object and its (now detached) element intact. Re-entering calls `addComponent`, which re-appends the same element. Nothing is disposed and nothing is rebuilt.[^detach-not-release]

Because a detached element has no parent to dispose it, `destructor` must dispose every non-resident node component itself. Without that step, tearing a view down would strand the stylesheet rule of every node that had been mounted and then scrolled away.

### Visual state replays itself on mount; committed size does not

Selection, node emphasis, and z-index all go through setters that cache their value on the component and replay it at render time, so a node that is selected while off-screen renders selected when it comes back. `setSelection`, `applyNodeEmphasis`, and `applyContainerZIndex` therefore keep iterating every node component and need no change.[^state-replay]

The one value that is *not* replayed usefully is the committed width and height, which the content host's layout pass would otherwise write a frame later. The mount helper writes them from the cached node box before adding the component, so a node never paints one frame at its intrinsic size.

### `applyTransformToHost` is the single place the residency set is recomputed

Every pan, zoom, centring, and resize-anchoring path in the view ends at `applyTransformToHost`, so the residency check is called there and nowhere else, plus one forced pass at the end of `promoteIncomingNodes` when the graph itself is replaced.[^one-site] `doLayout` gains no call, keeping its existing promise that it writes no child rectangle and so cannot feed back into the layout pass it runs inside.

While the view has no committed size the check does nothing at all, leaving the residency set as it is: `getWidth()` / `getHeight()` are `NaN` before the first `setSize`, and there is no viewport to cull against.

### Virtualization is unconditional — no new option

`DiagramView` gains no `virtualizeNodes` option and no way to tune the margin. Row and column virtualization in this library are likewise unconditional properties of `Table`, not consumer choices, and an opt-in flag would leave every existing consumer on the slow path.[^no-option]

### `nodeIdAt` keeps scanning every node component

[`nodeIdAt`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1497) still iterates all of `_nodeComponents`. It is already correct against an unmounted node — a detached element never contains a live event target — and it runs on press-type events only, not on pointer move.[^nodeidat]

### Edge virtualization is a separate, named follow-on plan

[`DiagramEdgeLayer`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts) draws two or three SVG elements per edge and rebuilds all of them wholesale in [`rebuildPaths`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L643). Culling those to the viewport is worth doing and is **out of scope here**, deferred to a follow-on plan named `diagram-edge-virtualization`.[^split-edges] The three pure functions this plan adds are the ones that plan will reuse; no hook, option, or seam is added for it in advance.

---

## Public API

No public API changes. `DiagramView`'s exported surface, its options bag, its events, and every method on it are untouched.

Three new module-level pure functions are added to `DiagramView.ts`, marked `@internal` and exported for the offline tests only. They must **not** be added to [`component/diagram/index.ts`](packages/lib/src/typescript/lib/component/diagram/index.ts):

```typescript
/** An axis-aligned box in unscaled graph coordinates. @internal */
export interface DiagramRect { x: number; y: number; width: number; height: number; }

/** Inflates `rect` by `fraction` of its own width on the left/right and its own height on the top/bottom. @internal */
export function inflateRect(rect: DiagramRect, fraction: number): DiagramRect;

/** Whether the residency set must be rebuilt for `live`, given the rectangle it was last committed for. @internal */
export function residencyNeedsRefresh(committed: DiagramRect | null, live: DiagramRect, margin: number): boolean;

/** Every id whose box intersects `residency`; an id with no entry in `rects` is always resident. @internal */
export function computeResidentNodes(ids: Iterable<string>, rects: Map<string, DiagramRect>, residency: DiagramRect): Set<string>;
```

`DiagramRect` is declared locally rather than reusing `core/DOM.ts`'s `Rect`, which carries four derived edge fields (`top` / `left` / `right` / `bottom`) that every graph-space box would have to synthesise.

---

## Internal Structure

### New module constant

```typescript
/**
 * How far beyond the visible graph rectangle nodes stay mounted, as a fraction
 * of the viewport's own extent on each side — so the residency rect is twice
 * the viewport in each axis. The diagram's counterpart to the row pool's
 * ±2-row scroll buffer: rows have a uniform pitch to count in, diagram nodes
 * do not, so the buffer is expressed in viewports. Half a viewport is what
 * lets the refresh threshold (half of this margin, a quarter viewport of
 * travel) absorb a fast drag without a node appearing at the viewport edge.
 */
const NODE_RESIDENCY_MARGIN = 0.5;
```

### New private state

```typescript
/** Laid-out box per node id, from the last successful layout — the graph currently on screen. */
private _nodeRects: Map<string, DiagramRect> = new Map();

/** Boxes for the graph awaiting a layout; promoted beside `_incomingComponents`. */
private _incomingRects: Map<string, DiagramRect> = new Map();

/** Ids of the node components currently added to the content host. */
private _residentIds: Set<string> = new Set();

/** Visible graph rectangle the resident set was last computed for; `null` forces a rebuild. */
private _residencyViewport: DiagramRect | null = null;
```

### The residency pass

```typescript
/** The visible viewport as a box in unscaled graph coordinates, or `null` before the view is sized. */
private viewportGraphRect(): DiagramRect | null {
    const vw = this.getWidth();
    const vh = this.getHeight();

    if (!(vw > 0) || !(vh > 0)) {
        return null;
    }

    const zoom = this.getZoom();

    return { x: -this._panX / zoom, y: -this._panY / zoom, width: vw / zoom, height: vh / zoom };
}

private updateNodeResidency(): void {
    const live = this.viewportGraphRect();

    if (live === null || !residencyNeedsRefresh(this._residencyViewport, live, NODE_RESIDENCY_MARGIN)) {
        return;
    }

    this._residencyViewport = live;

    const next = computeResidentNodes(this._nodeComponents.keys(), this._nodeRects,
        inflateRect(live, NODE_RESIDENCY_MARGIN));

    for (const id of this._residentIds) {
        if (!next.has(id)) {
            this.unmountNode(id);
        }
    }

    for (const id of next) {
        if (!this._residentIds.has(id)) {
            this.mountNode(id);
        }
    }

    this._residentIds = next;
}
```

`mountNode(id)` writes the cached box's width and height onto the component — when the layout result gave it a box at all — and then calls `this._contentHost.addComponent(component)`; the size write comes first so the element renders already sized. `unmountNode(id)` calls `this._contentHost.removeComponent(component)`.

The `x` / `y` inversion in `viewportGraphRect` is the same one [`_handleEdgeMouseMove`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1526) already uses to map a pointer position back into graph space.

---

## Ordered Implementation Steps

Tests come first for each behavioural change, per the `implement` skill's test-first flow. Steps 1–3 are self-contained pure functions; run them green before touching the view.

1. **Add the failing pure-function tests.** Create `packages/lib/tests/component/diagram/NodeResidency.test.ts` with a `describe` block per function, covering `## Expected Behaviour` §A. Import `inflateRect`, `residencyNeedsRefresh`, and `computeResidentNodes` from `~/component/diagram/DiagramView`. Expect them to fail to import.

2. **Add `DiagramRect`, `NODE_RESIDENCY_MARGIN`, and the three pure functions** to `DiagramView.ts`, at module level above the `DiagramViewOptions` interface, in the file's existing JSDoc style and each marked `@internal`. `residencyNeedsRefresh` returns `true` when `committed` is `null`, when `live.width`/`live.height` differ from `committed`'s, or when `live` is not fully inside `inflateRect(committed, margin / 2)`. Name `VirtualRowView.computePoolTarget` and `computeColumnWindowSize` as the precedent in prose — do **not** `{@link}` them, per the `{@link}` rule in `CODE_CONVENTIONS.md`. → verify: `npm run typecheck` clean and `NodeResidency.test.ts` passes.

3. **Checkpoint:** `grep -n 'inflateRect\|residencyNeedsRefresh\|computeResidentNodes' packages/lib/src/typescript/lib/component/diagram/index.ts` — expect zero matches.

4. **Add the four private fields** from `## Internal Structure` to the `DiagramView` class body, each with a doc comment, beside the existing `_nodeComponents` / `_incomingComponents` declarations ([DiagramView.ts:197-215](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L197)). Plain initializers are correct here — no `applyOptions`-dispatched setter writes them, so the `super()`-cascade `declare` rule does not apply.

5. **Record node boxes during layout.** In `applyLayout`'s loop over `result.nodes` ([DiagramView.ts:685-693](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L685)), inside the existing `if (component)` branch, also `this._incomingRects.set(node.id, { x: node.x, y: node.y, width: node.width, height: node.height })`.

6. **Clear the incoming boxes with the incoming components.** Add `this._incomingRects.clear()` to [`discardIncomingNodes`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L502).

7. **Add `viewportGraphRect`, `updateNodeResidency`, `mountNode`, and `unmountNode`** as private methods, placed directly after `applyTransformToHost`, exactly as given in `## Internal Structure`.

8. **Call the residency pass from `applyTransformToHost`.** Append `this.updateNodeResidency();` after the `setTransform` write ([DiagramView.ts:789](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L789)), and extend the method's doc comment to say it is the single place the mounted node set is reconciled.

9. **Rework `promoteIncomingNodes`** ([DiagramView.ts:517](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L517)):
   - In the teardown loop, call `this._contentHost.removeComponent(component)` only for ids in `_residentIds`; still call `component.dispose()` for every one.
   - Clear `_residentIds` and set `_residencyViewport = null` after that loop.
   - Promote `_incomingRects` into `_nodeRects` alongside the existing three maps, and reset `_incomingRects` to a fresh `Map`.
   - Replace the final mount-and-reveal loop with a reveal-only loop (`component.setVisible(true)` for every promoted component, unchanged), then a single `this.updateNodeResidency()` call. The `_residencyViewport = null` above is what makes that call rebuild from scratch.
   - Update the method's doc comment: it now reveals every promoted component but mounts only the resident ones.

10. **Dispose non-resident node components on teardown.** In [`destructor`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L376), before `super.destructor()`, loop `this._nodeComponents` and `component.dispose()` each entry whose id is **not** in `_residentIds`. Comment why: a resident component is a content-host child the inherited destructor reaches, an unmounted one has no parent and would otherwise strand its per-instance stylesheet rule.

11. **Add the failing view-wiring tests** to `packages/lib/tests/component/diagram/DiagramView.test.ts`, covering `## Expected Behaviour` §B. Assert against `view._contentHost.getComponents()` and `view._residentIds`. → verify: `npm test` green.

12. **Confirm nothing else mounts nodes.** `grep -n '_contentHost.addComponent\|_contentHost.removeComponent' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — expect exactly four matches: the edge layer's construction-time add, the guarded removal in `promoteIncomingNodes`'s teardown loop, `mountNode`, and `unmountNode`.

13. **Update the docs page and the changelog** per `## Documentation Impact`.

14. **Run the full gate:** `npm run typecheck`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings).

15. **Verify in sqladmin** per `## Verification`'s manual section.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Create | `packages/lib/tests/component/diagram/NodeResidency.test.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

§A and §B are unit-testable offline. §C lists behaviours that must stay exactly as they are. §D is manual.

### §A — the pure functions

`inflateRect`:

| Input | `fraction` | Result |
|---|---|---|
| `{0, 0, 1000, 600}` | `0.5` | `{-500, -300, 2000, 1200}` |
| `{0, 0, 1000, 600}` | `0.25` | `{-250, -150, 1500, 900}` |
| `{100, 50, 200, 100}` | `0` | `{100, 50, 200, 100}` |

`residencyNeedsRefresh` with `margin = 0.5` and `committed = {0, 0, 1000, 600}` — the five rows of the second table in `## Architecture Decisions`, plus:

- `committed = null` with any `live` returns `true`.
- A `live` rectangle that has escaped on the *left* (`{-300, 0, 1000, 600}`) returns `true`; one that has not (`{-200, 0, 1000, 600}`) returns `false`.
- A `live` rectangle that has escaped vertically only (`{0, 200, 1000, 600}`) returns `true`.

`computeResidentNodes` with `residency = {-500, -300, 2000, 1200}` — the four rows of the first table in `## Architecture Decisions`, plus:

- A box touching the residency rect edge-to-edge (`{1500, 0, 80, 40}`) is resident: intersection is inclusive.
- An id present in `ids` but absent from `rects` is always in the result.
- An empty `ids` returns an empty set.
- A zero-area box inside the rect (`{100, 100, 0, 0}`) is resident.

### §B — the view

Using the existing `StubDiagramView` + `StubEngine` fixtures:

- **A sized view mounts only the nodes near the viewport.** With a layout result placing node `a` at `{10, 20}` and node `far` at `{40000, 0}`, a view sized 1280×800 and constructed with `initialFocusNode: 'a'` has `a` in `_contentHost.getComponents()` and `far` not; both are in `_nodeComponents` and both report their laid-out `getX()` / `getY()`.
- **An unsized view mounts nothing.** A view that is never sized has an empty `_residentIds` after its layout lands, while `_nodeComponents` holds every node.
- **Panning past the trigger rect mounts what comes into range.** After `_handlePointerDown` on empty canvas, driving `_handlePointerMove` far enough for the visible rectangle to escape the trigger rect mounts the newly-near node and unmounts the one left behind; a smaller pan that stays inside the trigger rect leaves `_residentIds` unchanged.
- **A zoom always recomputes.** After `zoomOut()` on a sized, laid-out view, `_residencyViewport` carries the new, larger extents rather than the pre-zoom ones — even though the smaller pre-zoom rectangle would still have been contained.
- **`focusNode` mounts its target.** Calling `focusNode('far')` on a sized view leaves `far` in `_contentHost.getComponents()` and centred by the transform.
- **`zoomToFit` needs no node mounted**, computing from `_graphWidth` / `_graphHeight` alone, and leaves the residency set matching the new viewport afterwards.
- **`resetView` re-centres on an unmounted focus node.** With `initialFocusNode: 'far'` and the view panned elsewhere so `far` is unmounted, `resetView()` centres `far` and mounts it.
- **Selection survives an unmount / remount cycle.** `selectNode('far')` while `far` is unmounted, then a pan that mounts it, leaves `far`'s component reporting `isSelected() === true`; `getSelection()` reports it throughout.
- **Node emphasis survives the same cycle.** `setNodeEmphasis(['a'])` while `far` is unmounted then mounting `far` leaves `far` dimmed and `a` undimmed.
- **A replaced graph rebuilds residency from scratch.** After a second `setData` whose layout lands, every previous node component has had `dispose()` called (resident or not), `_residentIds` holds only new-graph ids, and `_contentHost.getComponents()` holds only the new graph's resident nodes plus the edge layer.
- **A failed re-layout leaves the mounted set alone.** A rejecting second layout leaves `_residentIds` and `_contentHost.getComponents()` exactly as the first graph left them.
- **Disposal disposes unmounted node components.** After `view.dispose()`, a node component that was never mounted, and one that was mounted and then unmounted, have both had `dispose()` called.
- **A mounted node is sized before it renders.** Immediately after a mount, the component's `getWidth()` / `getHeight()` match its laid-out box, with no intervening layout pass.

### §C — unchanged behaviours the existing suite already pins

These must keep passing with no edit to the assertion:

- `whenLaidOut()` in all five of its cases, including the disposed-mid-pass one.
- The stale-layout guard: an older in-flight layout resolving after a newer `setData` is still dropped.
- "hidden until placed": every promoted component reports `isVisible() === true` and every incoming one `false`.
- Compound graphs: `_nodeComponents` still holds the container and its children as flat siblings, containers still get z-index `0`, the edge layer `1`, leaves `2`, and a flat `setData` after a compound one still resets the edge layer to `0`.
- Selection, `activate`, `contextmenu`, the control-cluster hit guard, the click-versus-drag slop guard, wheel zoom, and the pan drag.
- `edgehover` / `edgeleave`, edge emphasis, and the edge-press-pans behaviour.
- `initialFocusNode` / `focusNode` retry semantics, including the unsized-view retry.

### §D — manual, in the sqladmin consuming app

- The Tables-mode whole-database diagram (325 tables) opens, centres, and shows the same nodes it does today.
- Panning across the diagram at a working zoom stays smooth, with no node appearing late at the viewport edge and no part of the diagram painting empty.
- Zooming in and out, including all the way to fit, shows the same graph as today; at fit-the-whole-graph zoom every node is in view and therefore mounted, so no improvement is expected there.
- Selecting a table, panning it off-screen and back, leaves it still highlighted; the same for a node-emphasis set applied from the app.
- Right-click, double-click activate, and edge hover still work on visible nodes.
- Closing the diagram tab does not grow the stylesheet rule count.

---

## Verification

Automated, from the repo root:

- `npm run typecheck` — clean.
- `npm test` — the whole suite, with `tests/component/diagram/` green. Every existing `DiagramView.test.ts` case must pass **unmodified**; a case needing an edit means the change is not behaviour-preserving and should be re-examined rather than the test relaxed.
- `npm run lint` — clean.
- `npm run docs:api` — zero warnings.
- `grep -n 'inflateRect\|residencyNeedsRefresh\|computeResidentNodes' packages/lib/src/typescript/lib/component/diagram/index.ts` — expect zero matches.

Manual, in the sqladmin consuming app at `/home/jika/typescript/sqladmin`:

- Build the library with `npm run build:lib` and consume it through the symlink override, then open the Tables-mode database diagram at a maximized viewport.
- Walk `## Expected Behaviour` §D.
- Read the element count from the DiagnosticsOverlay (About dialog → Debug) with the diagram open at a working zoom, before and after. The mounted-node share should fall by roughly an order of magnitude; edges are unchanged by this plan, so the total will not.
- Take a Chrome performance trace over a pan / zoom / hover burst under 6× CPU throttling and compare the DOMSize and ForcedReflow insights plus INP against the current numbers.
- Record the result in `/home/jika/typescript/sqladmin/LIBRARY_NOTES.md` whichever way it goes.

---

## Documentation Impact

No public API changes, so no TypeDoc page moves and no barrel edit.

`packages/lib/docs/components/DiagramView.md`:

- The **First paint** bullet under *Interaction* ([DiagramView.md:131](packages/lib/docs/components/DiagramView.md#L131)) currently says node components are "mounted, positioned, and revealed together". Amend it: they are positioned and revealed together, and mounted as the viewport reaches them.
- Add one bullet to *Notes*: on a large graph only the nodes within about half a viewport of the visible area are attached to the document; the rest are built, measured, and positioned but not mounted until they come into range. Selection, emphasis, and every centring method work against a node whether or not it is currently mounted. A custom `nodeRenderer`'s component may therefore have no element for part of the view's life.

`packages/lib/docs/reference/changelog/next.md`: add one bullet to the `### Components` list under the **first** `## Changed` heading — the block that already carries the table header column-window entry. Frame it as what a consumer observes, then "No consumer action is needed":

> **A large diagram now only attaches the nodes near the visible area to the page.** `DiagramView` still builds, measures, and places every node in the graph, but a node more than about half a viewport outside the visible area is kept off the document until panning or zooming brings it into range, so panning a several-hundred-node diagram no longer repaints the whole graph. Selection, emphasis, `focusNode`, `revealNode`, `zoomToFit`, and `resetView` all behave the same against a node that is currently off the page. No consumer action is needed.

---

## Potential Challenges

- **Each mount and unmount schedules a layout and notifies the parent chain.** `insertComponent` and `removeComponent` both call `scheduleLayout` and the preferred-size-change callback, so a refresh that moves twenty nodes fires twenty of each. They collapse into one `requestAnimationFrame` flush, which is the same coalescing `moveComponent` already documents.
- **Unmounted components keep their detached element in memory.** `removeComponent` detaches the element but does not free it, so a view panned across the whole graph ends up holding as many detached subtrees as it has ever mounted — the same elements it holds today, just no longer in the document. What falls is the document-connected count, which is what style recalculation, layout, and paint cost is proportional to.
- **At fit-the-whole-graph zoom nothing is culled.** Every node is inside the viewport by definition, so the residency set is the whole graph and the view behaves exactly as it does today. This is inherent to a viewport cull — the same way a ten-row table gets nothing from a row pool — and is not worked around here.
- **The refresh scan is linear in the node count.** Every refresh tests every node's box against the residency rect. At a few hundred nodes and a handful of refreshes per screen of travel that is negligible; a spatial index is a Non-Goal.
- **`applyLayout` reaches the residency pass more than once.** It runs `promoteIncomingNodes` (which forces a rebuild), then `applyTransformToHost`, then `tryInitialCentre`, whose centring writes the transform again. Only the first pass after a centring does work — the committed-rectangle check makes the rest return immediately — so no guard against re-entry is needed.
- **The content host's layout-derived preferred size shifts as children come and go.** The shift is inert: `applyLayout` sets the host's preferred size explicitly to the graph bounds, and an explicit preferred size wins over the layout manager's derived one. The host's box is already documented in the `DiagramView` constructor as retained for consistency rather than necessity.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — the file being changed. Read `rebuildNodes` (473), `promoteIncomingNodes` (517), `relayout` (547), `applyLayout` (680), `applyContainerZIndex` (734), `applyTransformToHost` (786), `tryInitialCentre` (912), `centreNode` (1185), `setSelection` (1242), `doLayout` (1339), and `anchorCentreAcrossResize` (1360) as a unit before editing.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — the precedent. `computePoolTarget` (296) states the "window size shrinks near the edges, so do not derive the rendered set from it" rule this plan carries over; `hideExcessPoolRows` (436) is the row-side counterpart of `unmountNode`.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `COLUMN_BUFFER` (104), `computeColumnWindowSize` (138), and `computeColumnWindow` (186): the pure-function shape and `@internal` export convention this plan's three functions mirror.
- [`plans/implemented/column-window-edge-stability.md`](plans/implemented/column-window-edge-stability.md) — why a rendered window must be sized from the viewport rather than from the current offset, and why a window that changes size every tick is the expensive case.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `insertComponent` (6377), `removeComponent` (6483), `unwireChild` (6313), and `replayGeometryStyles` (6070), which is what makes a component built off-tree render at its cached position and size.
- [`packages/lib/tests/component/diagram/DiagramView.test.ts`](packages/lib/tests/component/diagram/DiagramView.test.ts) — the `StubEngine` / `StubDiagramView` fixtures and the white-box style the new cases extend.
- [`packages/lib/tests/component/table/ColumnWindow.test.ts`](packages/lib/tests/component/table/ColumnWindow.test.ts) — the pure-function test file `NodeResidency.test.ts` is modelled on.
- [`packages/lib/docs/components/DiagramView.md`](packages/lib/docs/components/DiagramView.md) — the consumer-facing page whose *Interaction* and *Notes* sections change.

---

## Non-Goals

- **Edge virtualization.** `DiagramEdgeLayer` still builds a path per edge for the whole graph. Deferred to a follow-on plan named `diagram-edge-virtualization`.
- **Recycling node components across ids.** `nodeRenderer` is a `(data) => Component` factory with no update contract, so a fixed pool of rebindable node components would be a breaking public API change.
- **Releasing an unmounted component's element** via `Component.release`. It needs a `canRelease()` override on the node component, which is consumer-supplied, and it would rebuild the whole subtree on re-entry.
- **A spatial index** for the intersection scan. The linear scan is far below the cost of the mounts it drives.
- **Level-of-detail rendering at low zoom** — a simplified node at small scale. That needs renderer cooperation and is a feature, not a cull.
- **Narrowing `nodeIdAt` to the resident set.** Already correct as written, and the scan is not on a hot path.
- **Any new option** to disable virtualization or tune the margin.

---

## Notes

[^measured]: The failure was reproduced live against sqladmin's Tables-mode database diagram: 325 tables, one schema being a roughly 150-table foreign-key chain, and about 6,300 DOM elements in one `DiagramView`. Synthetic pan / zoom / hover stress found no JS error, no DOM node leak, no heap growth, and no stylesheet-rule leak, which rules out a logic or lifecycle bug. A Chrome performance trace over the same interaction under 6× CPU throttling flagged both the DOMSize and ForcedReflow insights, with INP at 459 ms. The visual symptom — parts of the diagram painting empty, with page-wide flicker — reproduces in a real GPU-composited browser but not in the software-rendered one used for the investigation, which is consistent with compositor tile-drop under sustained repaint pressure over a very large live DOM rather than with a state bug.

[^build-all]: Two things force this. ELK needs a real size for every node, and `collectNodeSizes` gets it from each component's preferred size, measured through the DOM seam's font metrics before the component is mounted — so the components have to exist for the whole graph before layout can run at all. And `centreNode`, which backs `revealNode`, `focusNode`, and the focus branch of `tryInitialCentre`, reads its target's `getX()` / `getY()` / `getPreferredSize()`; keeping every component alive is what lets those work against a node that is nowhere near the viewport. Building all of them is cheap: a component that is never added to a rendered parent never creates an element, so the cost is JS objects, not DOM.

[^precedent]: The rule both cite is `computePoolTarget`'s: derive the rendered set's size from the viewport, never from the current window, because a window derived from the current position shrinks near an edge and changes size on almost every tick. `column-window-edge-stability` then found the cost of that empirically — a window whose width jittered across four values made every pooled row take the full reconcile — and fixed it by giving the window a fixed width placed by clamping its start. The literal transcription of that fix does not carry over here, because a diagram has no equivalent of a slot whose index maps to a column and no reconcile fast path keyed on the window's width; the property that does carry over is that the rendered set must not be re-derived from the exact current position on every frame. Hysteresis is how a two-dimensional, non-uniform layout expresses that: the residency rect is a fixed multiple of the viewport, and it moves in jumps rather than continuously. Two alternatives were rejected. Recomputing on every transform write with no hysteresis is the "mount on entering the viewport, unmount on leaving" shape that thrashes at exactly the boundary, which is the mistake the column plan already paid for once. Snapping the residency rect outward to a grid of viewport-sized cells also quantises the refreshes, but the margin it leaves collapses to nearly zero immediately after the viewport crosses a grid line, so a node can appear at the viewport edge; recovering a guaranteed margin means adding a whole extra cell of padding and gives up the fixed size anyway.

[^detach-not-release]: `Component.release` exists and would additionally free the element, but `canRelease()` defaults to `false` and nothing in the library overrides it; a node component comes from the consumer's `nodeRenderer`, so `DiagramView` cannot opt it in. Disposing instead of detaching would mean re-running the renderer on every re-entry, which for a rich custom node is far more expensive than an element re-append and would silently discard any state the renderer holds. Detaching costs a detached subtree in memory and buys the removal from the document, which is what style recalculation, layout, and paint are proportional to — and what the DOMSize insight counts.

[^state-replay]: `DiagramNode.setSelected` writes through `setStyleState`, which records the state on the component regardless of whether an element exists; `render` re-applies every active state token when the element is built. `setOpacity` (node emphasis) and `setZIndex` both go through `setElementStyle`, which buffers into the inline-style bag and flushes at render. So the three visual-state paths in this view already work on a component with no element, and a remounted node paints with the state the view last wrote. That is also why `applyNodeEmphasis`, `setSelection`, and `applyContainerZIndex` are left iterating every node component rather than only the resident ones — restricting them would silently drop state for a node that is off-screen when the call happens.

[^one-site]: Every pan and zoom entry point already funnels through `applyTransformToHost`: the drag in `_handlePointerMove`, `_handleWheel` via `zoomAboutViewportPoint`, the control-cluster buttons via `zoomIn` / `zoomOut`, `setZoom`, `centreGraph`, `centreNode`, and `anchorCentreAcrossResize`. The two paths that are not a transform write are covered too. The first sizing of a view whose layout has already landed reaches `tryInitialCentre` from `doLayout`, which centres and therefore writes the transform. A later resize reaches `anchorCentreAcrossResize`, which writes the transform whenever the extents actually changed. A first sizing with no layout yet needs nothing, because the graph that follows arrives through `promoteIncomingNodes`, which forces a rebuild by nulling the committed rectangle. Putting a call in `doLayout` instead was rejected: mounting a child from inside a layout pass would break that method's stated property that it writes no child rectangle and so cannot feed back into the pass it runs inside.

[^no-option]: `Table` exposes no switch for row or column virtualization, and `Tree` none for its row pool; in this library a windowed rendering strategy is an internal property of the component. An additive `virtualizeNodes` option would also invert the outcome: the consumer that most needs the fix is the one with the largest graph, and it would stay on the old path until it discovered and set the flag. The change is behaviour-preserving for everything a consumer can observe through the public surface — the same nodes are laid out at the same coordinates, the same events fire with the same payloads, and every programmatic navigation method behaves identically. The one observable difference is that a component obtained from a custom `nodeRenderer` may have no element while it is off-screen, which the docs page will state.

[^nodeidat]: `nodeIdAt` walks `_nodeComponents` and asks `DOM.source.contains(element, target)` per entry. An unmounted node's element is detached, so it can never contain a live event target, and the answer is already right without a residency check. Restricting the walk to `_residentIds` would make it cheaper, but it would also break the existing test fixtures, which build a hit target by calling `getElement(true)` on a node component in a view that was never sized — and an unsized view has an empty residency set. The scan costs a few hundred `contains` calls on `click`, `dblclick`, `contextmenu`, and `pointerdown` only, never on pointer move, so it is not what the trace measured.

[^split-edges]: Three reasons to split rather than bundle. The mechanisms do not share code: nodes are `Component`s mounted into a container, edges are raw SVG children of one persistent `<svg>` rebuilt wholesale by `rebuildPaths`, and the two reconcile through completely different seams. Edge culling also introduces a rebuild path that does not exist today — `rebuildPaths` currently runs only on `setEdges` and `setEdgeEmphasis`, never on pan — so making it viewport-driven adds new work to the pan hot path and needs its own incremental design and its own measurements. And node virtualization stands alone: it is the larger share of the elements on the real graph, and it lands with no change to `DiagramEdgeLayer` or its 506-line test file. The follow-on plan reuses `inflateRect`, `residencyNeedsRefresh`, and `computeResidentNodes` unchanged; nothing is added here in advance for it.
