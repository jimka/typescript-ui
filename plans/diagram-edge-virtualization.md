---
depends-on: [diagram-node-virtualization]
touches-shared:
  - packages/lib/src/typescript/lib/component/diagram/DiagramView.ts
  - packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Diagram Edge Virtualization — Implementation Plan

## Overview

[`DiagramEdgeLayer`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts) draws two or three SVG elements for every edge in the graph — a visible `<path>`, a wider invisible hit `<path>`, and an optional `<text>` label — and keeps all of them in the document for the layer's whole life. [`rebuildPaths`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L643) releases and recreates the lot wholesale, and it runs on the first render, on [`setEdges`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L410), and on [`setEdgeEmphasis`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L433) — never on a pan or a zoom. Nothing about the drawn set depends on where the viewport is, so a several-hundred-edge graph puts every edge's elements on the page at once, however small a slice of the graph is on screen.

This plan makes the drawn set viewport-driven, the way [`diagram-node-virtualization`](plans/implemented/diagram-node-virtualization.md) already made the mounted node set viewport-driven. `DiagramView` keeps owning every viewport fact: it already computes a **residency rect** — the visible graph rectangle grown by half a viewport on each side — and now hands that rectangle to the edge layer on the same pass that mounts and unmounts nodes. The layer computes a box per edge from the edge's own route, draws only the edges whose box reaches the residency rect, and reconciles that set by difference: an edge that stays admitted is never touched.

That pass does not run on every frame. `residencyNeedsRefresh` recomputes the residency rect only when the viewport's extents change (a zoom or a resize) or when the live visible rectangle escapes the **trigger rect** — the rectangle the set was last computed for, grown by a quarter viewport. So an ordinary pan reconciles a few times per screen of travel, and edges inherit that cadence unchanged.

Two source files change — `DiagramEdgeLayer.ts` and `DiagramView.ts` — plus one new module holding the residency rules both of them need, their tests, one docs page, and the changelog. No consumer-facing API is added, removed, or altered.

---

## Architecture Decisions

### The layer owns the cull; the view tells it where the viewport is

`DiagramView.updateResidency` (today's `updateNodeResidency`) gains one line: it passes the residency rect to `this._edgeLayer.setResidency(rect)`. The layer stores that rectangle, works out which edges it admits, and reconciles its own drawn set. The view holds no per-edge state.[^layer-owns]

A rectangle is the right thing to hand over because it describes the viewport, not the graph, so it stays correct across a graph swap. The layer re-derives which edges the standing rectangle admits every time the routes change, and the order of `setEdges` and `setResidency` inside `applyLayout` stops mattering.

### The residency rules move to a module both files import

`DiagramRect`, `inflateRect`, `residencyNeedsRefresh`, and `computeResidentNodes` currently live in `DiagramView.ts`. The edge layer needs the last two, and `DiagramView.ts` already imports `DiagramEdgeLayer.ts` — so importing back would make the two modules circular. All four move to a new `packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts`, mirroring [`component/shared/selectionsEqual.ts`](packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts): a module of `@internal` pure functions shared by two components and deliberately kept out of the barrel.[^shared-module]

`computeResidentNodes` is renamed `computeResidentIds` in the move, `NODE_RESIDENCY_MARGIN` becomes `RESIDENCY_MARGIN`, and `updateNodeResidency` becomes `updateResidency` — all three now govern edges as well as nodes.[^rename]

### An edge's box is its route's point bounds, padded

`routeBounds(sections)` returns the smallest rectangle containing every point on the routed polyline — start point, bend points, end point of every section — grown by `EDGE_BOUNDS_PADDING` (`EDGE_MARKER_EXTENT`, `18` graph units) on each of the four sides. A route with no points returns `null`, and `computeResidentIds` already admits an id with no box unconditionally.[^padding]

| Sections | Point bounds | Edge box |
|---|---|---|
| `(0,0) → (100,0)` | `{0, 0, 100, 0}` | `{-18, -18, 136, 36}` |
| `(0,0) → bend (100,0) → (100,100)` | `{0, 0, 100, 100}` | `{-18, -18, 136, 136}` |
| `(0,0) → (10,10)` plus `(-50,-50) → (0,0)` | `{-50, -50, 60, 60}` | `{-68, -68, 96, 96}` |
| none (empty `sections`) | — | `null` |

An edge is **admitted** when its box intersects the residency rect — the same inclusive test `computeResidentIds` already applies to node boxes. Worked against the residency rect the node plan uses for its own tables, `{-500, -300, 2000, 1200}` (a 1000×600 viewport at zoom 1, panned to the origin), which spans `x ∈ [-500, 1500]` and `y ∈ [-300, 900]`:

| Route | Edge box | Admitted? | Why |
|---|---|---|---|
| `(0,0) → (100,0)` | `{-18, -18, 136, 36}` | yes | inside the rect |
| `(1400,0) → (1600,0)` | `{1382, -18, 236, 36}` | yes | crosses the rect's right edge (1500) |
| `(1600,0) → (1800,0)` | `{1582, -18, 236, 36}` | no | starts past 1500 |
| `(-600,-400) → (1400,800)` | `{-618, -418, 2036, 1236}` | yes | a long route straddling the rect |
| no sections | `null` | yes | no box to test — and nothing is drawn for it anyway |

### A residency change is a difference, never a rebuild

`updateDrawnEdges` walks `_edges` once and, per edge, either keeps the record already drawn for it, draws it fresh, or leaves it out; anything drawn that is no longer admitted is released at the end. An edge that stays admitted across the change costs zero DOM writes.[^diff-not-rebuild]

With `_edges` = `[e1, e2, e3]`, `_drawn` = `[e1, e2]`, and a new rectangle admitting `{e2, e3}`:

| Edge | Drawn before | Admitted now | Action |
|---|---|---|---|
| `e1` | yes | no | released |
| `e2` | yes | yes | left alone — no DOM write |
| `e3` | no | yes | drawn |

`_drawn` becomes `[e2, e3]` — rebuilt in `_edges` order every pass, so the order `edgesNear` reports never depends on the pan history.

`rebuildPaths` stays as the wholesale path, and `setEdges` / `setEdgeEmphasis` keep calling it: it releases everything and then delegates to `updateDrawnEdges`, so it too draws only the admitted edges.

### An edge that leaves the rect is released, not detached

Leaving the rect calls the existing [`releaseDrawnEdge`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L763), which removes each element from its group, untracks the handle, and releases it. Re-entering draws fresh elements. This is the opposite of the node plan's detach-and-keep decision, and deliberately so.[^release-not-detach]

Because nothing survives in a detached state, `destructor` needs no new step: a released handle is already untracked, and the layer's `<defs>`, markers, and two groups are unaffected by culling.

### No residency rect means no culling

A layer that has never been given a rectangle draws every edge, exactly as today. `DiagramView` pushes a rectangle only from `updateResidency`, which does nothing while the view has no committed size — so an unsized view leaves every edge on its layer drawn, and a `DiagramEdgeLayer` used on its own behaves as it always has.[^null-means-all]

### Hit-testing follows the drawn set, and that is already correct

`edgeIdAt` and `edgesNear` keep reading `_drawn`, so they answer only for edges currently drawn. No guard is added, because a culled edge can never be the one under the pointer: the residency rect extends half a viewport beyond the visible rectangle on every side, so anything culled is at least that far off screen.[^hit-testing]

Both methods get their JSDoc amended to say the answer covers the edges the layer is currently drawing. Neither may name `setResidency` through `{@link}` — both are public members of a barrel-exported class and `setResidency` is `@internal`, so the reference is prose, per the `{@link}` rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

### Emphasis is id state, so it survives a round trip with no new machinery

`_edgeEmphasis` is a `Set<string>` held independently of what is drawn, and `groupFor(id)` consults it at draw time. An edge culled while emphasised is drawn into the full-strength group when it re-enters; one culled while dimmed is drawn into the dimmed group. `getEdgeEmphasis()` reports an id whether or not its edge is drawn.[^emphasis]

### No consumer-facing API change

`DiagramView` gains no option to disable or tune edge culling, matching the node plan. `DiagramEdgeLayer.setResidency` closes its JSDoc with the tag line *"@internal Framework wiring between `DiagramView` and its edge layer; application code does not call this."*, following [`TreeBody.ts:711`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L711) — TypeDoc's `excludeInternal` keeps the method and its `DiagramRect` parameter out of the rendered docs entirely.[^no-api]

---

## Public API

No consumer-facing API changes. `DiagramView`'s exported surface, `DiagramEdgeLayer`'s documented methods, `EDGE_MARKER_EXTENT`, the options bags, and every event are untouched, and [`component/diagram/index.ts`](packages/lib/src/typescript/lib/component/diagram/index.ts) is not edited.

New internal module, `packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts` — the four symbols moved out of `DiagramView.ts`, unchanged except for the rename on the last:

```typescript
/** An axis-aligned box in unscaled graph coordinates. @internal */
export interface DiagramRect { x: number; y: number; width: number; height: number; }

/** Inflates `rect` by `fraction` of its own width on the left/right and its own height on the top/bottom. @internal */
export function inflateRect(rect: DiagramRect, fraction: number): DiagramRect;

/** Whether the residency set must be rebuilt for `live`, given the rectangle it was last committed for. @internal */
export function residencyNeedsRefresh(committed: DiagramRect | null, live: DiagramRect, margin: number): boolean;

/** Every id whose box intersects `residency`; an id with no entry in `rects` is always resident. @internal */
export function computeResidentIds(ids: Iterable<string>, rects: Map<string, DiagramRect>, residency: DiagramRect): Set<string>;
```

New `@internal` export from `DiagramEdgeLayer.ts`, alongside the module's other route-geometry helpers and **not** added to the barrel:

```typescript
/** The box an edge's drawing occupies, padded for markers, hit stroke, and label. @internal */
export function routeBounds(sections: ElkEdgeSection[]): DiagramRect | null;
```

New `@internal` method on `DiagramEdgeLayer`:

```typescript
setResidency(rect: DiagramRect | null): this;
```

---

## Internal Structure

### New constant in `DiagramEdgeLayer.ts`

```typescript
/**
 * How far outside its own polyline an edge paints, in unscaled graph units.
 * Three things reach past the bare line — the end markers, the 12px-wide
 * invisible hit stroke, and the label's halo — and the widest end marker's
 * own reach covers all three, so a route's box is grown by this much on
 * every side before it is tested against the residency rect. Without it an
 * edge whose route stops just outside the rect could still have a marker or
 * label glyph reaching into it.
 */
const EDGE_BOUNDS_PADDING = EDGE_MARKER_EXTENT;
```

### New private state on `DiagramEdgeLayer`

```typescript
/**
 * Box per edge id, rebuilt by `setEdges` from each route. An edge whose
 * route has no points has no entry, which `computeResidentIds` treats as
 * always admitted — and `drawEdge` skips it anyway for having no path data.
 */
private _edgeRects: Map<string, DiagramRect> = new Map();

/**
 * The rectangle an edge's box must reach to be drawn, in unscaled graph
 * coordinates, or `null` when nothing has told this layer where the
 * viewport is — in which case every edge is drawn.
 */
private _residency: DiagramRect | null = null;

/** The admitted edge ids, or `null` when `_residency` is `null` (every edge is admitted). */
private _residentIds: Set<string> | null = null;
```

### The layer's reconciliation

```typescript
/** Recomputes the admitted-id set from the standing residency rect and the current routes. */
private recomputeResidentEdges(): void {
    this._residentIds = this._residency === null
        ? null
        : computeResidentIds(this._edges.map(edge => edge.id), this._edgeRects, this._residency);
}

/** Whether `id` is admitted by the standing residency rect. */
private isResident(id: string): boolean {
    return this._residentIds === null || this._residentIds.has(id);
}

private updateDrawnEdges(): void {
    if (!this.getElement()) {
        return;
    }

    const previous = new Map(this._drawn.map(drawn => [drawn.id, drawn]));
    const next: DrawnEdge[] = [];

    for (const edge of this._edges) {
        if (!this.isResident(edge.id)) {
            continue;
        }

        const already = previous.get(edge.id);

        if (already) {
            previous.delete(edge.id);
            next.push(already);

            continue;
        }

        const drawn = this.drawEdge(edge);

        if (drawn) {
            next.push(drawn);
        }
    }

    for (const drawn of previous.values()) {
        this.releaseDrawnEdge(drawn);
    }

    this._drawn = next;
}
```

`drawEdge(edge)` is today's `rebuildPaths` body for one edge, lifted out unchanged: build the path data, return `null` when it is empty, otherwise take `groupFor(edge.id)`, draw the hit path, the visible path, and the optional label into it, and return the `DrawnEdge` record.

`rebuildPaths` keeps its element guard and its release loop, then ends with `this.updateDrawnEdges()` instead of its own draw loop.

### `setEdges`, extended

Between caching `edges` / clearing `_edgeEmphasis` and the existing draw-or-defer branch, `setEdges` rebuilds `_edgeRects` from the new routes (skipping any route whose `routeBounds` is `null`) and then calls `recomputeResidentEdges()`.

### `setResidency`

```typescript
setResidency(rect: DiagramRect | null): this {
    this._residency = rect;
    this.recomputeResidentEdges();
    this.updateDrawnEdges();

    return this;
}
```

### The view's residency pass

`updateResidency` hoists the inflated rectangle into a local and passes it on:

```typescript
const residency = inflateRect(live, RESIDENCY_MARGIN);
const next = computeResidentIds(this._nodeComponents.keys(), this._nodeRects, residency);

// … the existing unmount / mount loops and `this._residentIds = next;` …

this._edgeLayer.setResidency(residency);
```

---

## Ordered Implementation Steps

Tests come first for each behavioural change, per the `implement` skill's test-first flow. Steps 1–5 move and rename existing code with no behaviour change; run the suite green before starting step 6.

1. **Create `packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts`.** Move `DiagramRect` ([DiagramView.ts:119](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L119)), `inflateRect` (131), `residencyNeedsRefresh` (158), and `computeResidentNodes` (188) into it verbatim, keeping every doc comment and `@internal` tag. Rename `computeResidentNodes` to `computeResidentIds` and drop the word "node" from its doc comment's first line. Add the file's SPDX header, matching `component/shared/selectionsEqual.ts`.

2. **Import them into `DiagramView.ts`.** Delete the four moved declarations and add `import { computeResidentIds, inflateRect, residencyNeedsRefresh } from "~/component/diagram/DiagramResidency.js";` plus `import type { DiagramRect } from "~/component/diagram/DiagramResidency.js";`, placed with the file's other `~/component/diagram/` imports. Update the one call site at [DiagramView.ts:980](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L980).

3. **Rename the residency test file.** `git mv packages/lib/tests/component/diagram/NodeResidency.test.ts packages/lib/tests/component/diagram/DiagramResidency.test.ts`, repoint both imports at `~/component/diagram/DiagramResidency`, rename the third `describe` block and every call inside it from `computeResidentNodes` to `computeResidentIds`, and update the header comment's function list. → verify: `npm test` green.

4. **Rename `NODE_RESIDENCY_MARGIN` to `RESIDENCY_MARGIN`** ([DiagramView.ts:116](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L116)) and amend its doc comment's first sentence to say nodes stay mounted and edges stay drawn within it.

5. **Rename `updateNodeResidency` to `updateResidency`** ([DiagramView.ts:971](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L971)) at both call sites — [`promoteIncomingNodes`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L679) and [`applyTransformToHost`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L939). → verify: `npm run typecheck` clean, `npm test` green, and `grep -rn 'computeResidentNodes\|NODE_RESIDENCY_MARGIN\|updateNodeResidency' packages/lib/src packages/lib/tests` — expect zero matches.

6. **Add the failing `routeBounds` tests** to `packages/lib/tests/component/diagram/DiagramEdgeLayer.test.ts` in a new `describe('routeBounds')` block covering `## Expected Behaviour` §A, importing `routeBounds` from `~/component/diagram/DiagramEdgeLayer`.

7. **Add `EDGE_BOUNDS_PADDING` and `routeBounds` to `DiagramEdgeLayer.ts`**, at module level beside `buildPathData` ([DiagramEdgeLayer.ts:233](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L233)) and `distanceToRoute` (285), in the file's existing JSDoc style and marked `@internal`. `routeBounds` walks the same `[startPoint, ...bendPoints, endPoint]` points per section that `distanceToRoute` walks. Import `DiagramRect` as a type from `~/component/diagram/DiagramResidency.js`. → verify: `npm run typecheck` clean and the new block passes.

8. **Add the failing layer-culling tests** to `DiagramEdgeLayer.test.ts` in a new `describe('DiagramEdgeLayer — viewport culling')` block covering `## Expected Behaviour` §B, asserting against `layer._drawn`, `layer._residency`, and `layer._residentIds`. Expect them to fail.

9. **Extract `drawEdge`** in `DiagramEdgeLayer.ts`: lift the per-edge body of [`rebuildPaths`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L643) into a private `drawEdge(edge: DiagramEdgeRoute): DrawnEdge | null` that returns `null` for empty path data, placed directly after `rebuildPaths`. `rebuildPaths` now keeps its element guard and release loop and ends with `this.updateDrawnEdges()`.

10. **Add the three private fields** from `## Internal Structure` to the class body, beside `_edges` / `_drawn` ([DiagramEdgeLayer.ts:323-326](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L323)), each with a doc comment. Plain initializers are correct — no setter `applyOptions` dispatches writes them, so the `declare` rule in `CODE_CONVENTIONS.md` does not apply.

11. **Add `recomputeResidentEdges`, `isResident`, `updateDrawnEdges`, and `setResidency`** exactly as given in `## Internal Structure`, placed after `rebuildPaths` / `drawEdge`. Mark `setResidency` `@internal` with the `TreeBody` wording from `## Architecture Decisions`.

12. **Extend `setEdges`** ([DiagramEdgeLayer.ts:410](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L410)): after `this._edgeEmphasis = new Set();` and before the draw-or-defer branch, rebuild `this._edgeRects` from `edges` (skipping any whose `routeBounds` is `null`) and call `this.recomputeResidentEdges()`. Extend the method's doc comment: it also re-derives which edges the standing residency rect admits. → verify: `npm test` green, including the new §B block.

13. **Amend the `edgeIdAt` and `edgesNear` doc comments** ([DiagramEdgeLayer.ts:463](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L463) and 482) to say the answer covers the edges the layer is currently drawing, which on a large graph is those near the visible area. Prose only — no `{@link setResidency}`.

14. **Add the failing view-wiring tests** to `packages/lib/tests/component/diagram/DiagramView.test.ts`, in a new `describe('DiagramView — edge virtualization: only the admitted edges are drawn')` block placed after the node-virtualization block ([DiagramView.test.ts:2919](packages/lib/tests/component/diagram/DiagramView.test.ts#L2919)), covering `## Expected Behaviour` §C and reusing that block's `farGraph` / `farResult` shape with an edge added.

15. **Wire the view to the layer.** In `updateResidency` ([DiagramView.ts:971](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L971)) hoist `inflateRect(live, RESIDENCY_MARGIN)` into a `const residency`, pass it to `computeResidentIds`, and end the method with `this._edgeLayer.setResidency(residency);`. Extend the method's doc comment to say it reconciles the drawn edge set as well as the mounted node set, and amend `applyTransformToHost`'s doc comment (934) the same way. → verify: `npm test` green.

16. **Checkpoint:** `grep -n 'rebuildPaths\|updateDrawnEdges' packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts` — expect `rebuildPaths` at its definition plus exactly four calls (`setEdges`'s two branches, `setEdgeEmphasis`, and `render`), and `updateDrawnEdges` at its definition plus exactly two calls (`rebuildPaths` and `setResidency`). And `grep -rn 'DiagramResidency' packages/lib/src/typescript/lib/component/diagram/index.ts` — expect zero matches.

17. **Update the docs page and the changelog** per `## Documentation Impact`.

18. **Run the full gate:** `npm run typecheck`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings).

19. **Verify in sqladmin** per `## Verification`'s manual section.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Create | `packages/lib/tests/component/diagram/DiagramResidency.test.ts` (renamed from `NodeResidency.test.ts`) |
| Delete | `packages/lib/tests/component/diagram/NodeResidency.test.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramEdgeLayer.test.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

§A, §B, and §C are unit-testable offline. §D lists behaviours that must stay exactly as they are. §E is manual.

### §A — `routeBounds`

The four rows of the *Sections / Point bounds / Edge box* table in `## Architecture Decisions`, plus:

- A section whose start and end are the same point (`(5,5) → (5,5)`) returns `{-13, -13, 36, 36}` — a zero-area point bounds, padded.
- A section with bend points outside the straight line between its endpoints includes those bends: `(0,0) → bend (50,-200) → (100,0)` returns `{-18, -218, 136, 236}`.
- Sections are combined, not taken one at a time: two sections at opposite corners produce one box spanning both (third row of the table).

### §B — the layer

Using `DiagramEdgeLayer` directly, as the existing file's cases do:

- **No residency rect draws every edge.** A layer that is never given one draws both of a two-edge set — the state every pre-existing case in the file already exercises.
- **A rect admitting one of two edges draws only that one.** With `e1` routed at `(0,0) → (10,10)` and `far` at `(40000,0) → (40010,10)`, `setResidency({x: -500, y: -500, width: 2000, height: 2000})` leaves `_drawn` holding `e1` alone.
- **Moving the rect draws what enters without touching what stayed.** From that state, a second `setResidency` whose rect admits both creates exactly two new `path` elements and issues no `removeChild`; `_drawn` is then `[e1, far]`, in `_edges` order.
- **Moving the rect away releases what leaves.** A rect admitting neither releases both edges' elements — four `removeChild` calls for two label-less edges — and leaves `_drawn` empty.
- **`setResidency(null)` re-admits everything**, drawing every edge that is not currently drawn.
- **`setEdges` re-derives against the standing rect.** After `setResidency` with a rect that admits only near routes, a `setEdges` carrying one near and one far route draws only the near one.
- **An edge with no sections is never drawn**, whatever the rect, and neither `setResidency` nor `setEdges` throws for it.
- **A rect set before the element exists draws nothing then**, and the deferred first draw honours it.
- **`edgesNear` reports only drawn edges**: a point on a culled edge's route returns an empty array.
- **`edgeIdAt` cannot answer for a culled edge** — its hit path no longer exists, and a handle from a released element resolves to `null`.
- **Emphasis survives a cull round trip.** With `setEdgeEmphasis(['far'])` active while `far` is culled, `getEdgeEmphasis()` still reports `['far']`, and a later rect admitting `far` draws it into `_normalLayer` while `e1` sits in `_dimLayer`.
- **Emphasis applied while culled reaches the drawn set.** With `far` culled, `setEdgeEmphasis(['far'])` moves the drawn `e1` into `_dimLayer` without throwing.

### §C — the view

Using the existing `StubDiagramView` + `StubEngine` fixtures:

- **A sized view hands its edge layer the residency rect.** After a layout on a view sized 1280×800, `view._edgeLayer._residency` equals `inflateRect(view.viewportGraphRect(), 0.5)`.
- **An unsized view hands over nothing.** A view that is never sized leaves `view._edgeLayer._residency` at `null` and every edge drawn.
- **A far edge is not drawn on a sized view.** With nodes at `(10,20)` and `(40000,0)`, an edge `spanning` routed between them, and an edge `far` routed entirely near `x = 40000`, a view sized 1280×800 with `initialFocusNode: 'a'` draws `spanning` (its box straddles the residency rect) and not `far`.
- **Panning far enough draws what comes into range.** Driving `_handlePointerDown` / `_handlePointerMove` toward `far` until the live rectangle escapes the trigger rect adds `far` to `view._edgeLayer._drawn`.
- **A zoom pushes a new rect.** After `zoomOut()` on a sized, laid-out view, `view._edgeLayer._residency` carries different extents than before.
- **A replaced graph re-derives against the standing rect.** A second `setData` whose layout lands leaves `view._edgeLayer._drawn` holding only new-graph edges that the current rect admits.
- **`setEdgeEmphasis` still round-trips through the view** on a sized view with a culled edge: `view.getEdgeEmphasis()` reports the id.

### §D — unchanged behaviours the existing suite already pins

These must keep passing with **no edit to any assertion**:

- Every **pre-existing** case in `DiagramEdgeLayer.test.ts` — style-driven markers, the detached-`setEdges` deferral, the invisible hit paths and their append order, `edgeIdAt`, `edgesNear`, the whole emphasis block, and `EDGE_MARKER_EXTENT`. None of them sets a residency rect, so none is culled.
- Every `DiagramView.test.ts` case that reads `view._edgeLayer._drawn[0].hit` — the option-routing case, the edge-press-pans block, and the `edgehover` / `edgeleave` block. All of them construct a view that is never sized, so no rectangle is ever pushed.
- The edge-style re-join cases reading `view._edgeLayer._edges`.
- The whole node-virtualization block, `whenLaidOut`, the stale-layout guard, "hidden until placed", compound graphs and their z-index order, selection, `activate`, `contextmenu`, wheel zoom, the pan drag, and the `initialFocusNode` / `focusNode` retry semantics.

### §E — manual, in the sqladmin consuming app

- The Tables-mode whole-database diagram opens, centres, and shows the same edges it does today at a working zoom, with arrowheads, crow's-foot markers, and labels intact.
- Panning across the diagram stays smooth, with no edge appearing late at the viewport edge and no visible redraw of edges that were already on screen.
- Hovering an edge still fires the app's edge tooltip; hovering a bundle still reports every edge in it.
- Pressing and dragging an edge still pans the canvas; a press without movement still leaves the selection alone.
- Selecting a table still dims the unrelated edges and leaves the related ones at full strength; panning the selection off screen and back leaves that emphasis intact.
- Zooming all the way out to fit shows the whole graph with every edge drawn — no improvement is expected there.
- Closing the diagram tab leaves no growth in the page's element count.

---

## Verification

Automated, from the repo root:

- `npm run typecheck` — clean.
- `npm test` — the whole suite, with `tests/component/diagram/` green. Every case listed in `## Expected Behaviour` §D must pass **unmodified**; a case needing an edit means the change is not behaviour-preserving and should be re-examined rather than the test relaxed.
- `npm run lint` — clean.
- `npm run docs:api` — zero warnings.
- `grep -rn 'computeResidentNodes\|NODE_RESIDENCY_MARGIN\|updateNodeResidency' packages/lib/src packages/lib/tests` — expect zero matches.
- `grep -rn 'DiagramResidency\|routeBounds\|setResidency' packages/lib/src/typescript/lib/component/diagram/index.ts` — expect zero matches.

Manual, in the sqladmin consuming app at `/home/jika/typescript/sqladmin`:

- Build the library with `npm run build:lib` and consume it through the symlink override, then open the Tables-mode database diagram at a maximized viewport.
- Walk `## Expected Behaviour` §E.
- Read the element count from the DiagnosticsOverlay (About dialog → Debug) with the diagram open at a working zoom, before and after. The node fix already cut the mounted node share; the remaining fall here is the edge elements, at two or three per culled edge.
- Take a Chrome performance trace over a pan / zoom / hover burst under 6× CPU throttling and compare the DOMSize and ForcedReflow insights against the numbers the node-virtualization pass recorded.
- Time one `setEdgeEmphasis` (the app fires one per table selection) before and after, against the ~20ms-per-1000-edges figure `setEdgeEmphasis`'s own comment records — it should fall in proportion to the admitted share.
- Record the result in `/home/jika/typescript/sqladmin/LIBRARY_NOTES.md` whichever way it goes.

---

## Documentation Impact

No public API changes, so no TypeDoc page moves and no barrel edit. `setResidency` and `routeBounds` are `@internal`, and `typedoc.json` sets `excludeInternal: true`, so neither reaches the rendered docs.

`packages/lib/docs/components/DiagramView.md` — amend the last *Notes* bullet ([DiagramView.md:167](packages/lib/docs/components/DiagramView.md#L167)), which currently covers nodes only, to cover both:

> - **Only the nodes and edges near the visible area are attached to the document.** On a large graph, a node more than about half a viewport outside the visible area is built, measured, and positioned but not mounted until panning or zooming brings it into range, and an edge whose route stays that far outside is not drawn until then either. Selection, emphasis, and every centring method (`focusNode`, `revealNode`, `zoomToFit`, `resetView`) work against a node whether or not it is currently mounted, and `setEdgeEmphasis` works against an edge whether or not it is currently drawn. A custom `nodeRenderer`'s component may therefore have no element for part of the view's life.

`packages/lib/docs/reference/changelog/next.md` — add one bullet to the `### Components` list under the **first** `## Changed` heading, directly after the existing diagram-node bullet:

> - **A large diagram now only draws the edges near the visible area.** `DiagramView` still lays out and routes every edge in the graph, but an edge whose route stays more than about half a viewport outside the visible area is kept off the page until panning or zooming brings it into range, and edges already on screen are never redrawn when that happens. Edge hover, edge emphasis, and dragging an edge to pan all behave the same as before. No consumer action is needed.

---

## Potential Challenges

- **A large zoom change can release hundreds of edges in one pass.** `Component.untrackHandle` scans the owned-handle array per handle, so releasing most of a large drawn set costs the same quadratic pass `rebuildPaths` already pays today — the worst case is no worse than the current every-`setEdges` cost, and it is reached only on a big zoom-in, not on a pan.
- **Every wheel notch changes the viewport extents, so each one recomputes.** `residencyNeedsRefresh` returns `true` on any extent change, so a wheel-zoom burst runs one residency pass per notch. Each pass is a difference, so it draws only the edges that actually entered; the node pass already runs at the same cadence and this adds no new refresh points.
- **The admission scan is linear in the edge count.** Every refresh tests every edge's box. At a thousand edges and a handful of refreshes per screen of travel that is far below the cost of the draws it drives; a spatial index is a Non-Goal.
- **The layer's `<svg>` still spans the whole graph bounds.** Culling removes the per-edge elements, not the one root element sized to the graph in `applyLayout`. That is unchanged and out of scope.
- **An edge is admitted by its bounding box, not its route.** A long diagonal route whose box covers the viewport is drawn even when the line itself passes nowhere near it. The test is deliberately over-inclusive — under-inclusion would drop a visible line — and costs at most a few extra edges.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts) — the main file being changed. Read `setEdges` (410), `setEdgeEmphasis` (433) and its cost comment, `edgeIdAt` (463), `edgesNear` (482), `groupFor` (495), `rebuildPaths` (643), `drawHitPath` (687), `drawVisiblePath` (718), `releaseDrawnEdge` (763), and `drawLabel` (782) as a unit before editing.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — read `promoteIncomingNodes` (650), `applyLayout` (822) and its edge-layer block (844-847), `applyTransformToHost` (934), `viewportGraphRect` (950), `updateNodeResidency` (971), `mountNode` (1010), and `unmountNode` (1037) together; they are the shape this plan extends.
- [`plans/implemented/diagram-node-virtualization.md`](plans/implemented/diagram-node-virtualization.md) — the plan this one follows on from. Its `## Architecture Decisions` state the residency rules reused here unchanged — sized from the viewport, moved only once the viewport has travelled past the trigger rect — and its `## Non-Goals` name this plan.
- [`packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts`](packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts) — the precedent for the new `DiagramResidency.ts`: a module of `@internal` pure functions shared by two components and kept out of the barrel.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `computePoolTarget` (296) is the fixed-pool precedent this plan deliberately does **not** follow; read its doc comment for why a pool needs a uniform row pitch to size itself from.
- [`packages/lib/src/typescript/lib/component/table/TreeBody.ts`](packages/lib/src/typescript/lib/component/table/TreeBody.ts) — line 711 is the `@internal Framework wiring` wording `setResidency` copies.
- [`packages/lib/tests/component/diagram/DiagramEdgeLayer.test.ts`](packages/lib/tests/component/diagram/DiagramEdgeLayer.test.ts) — the `RecordingDOMSink` helpers (`attrWrites`, `edgePathAttrsAll`) and the white-box style the new cases extend.
- [`packages/lib/tests/component/diagram/DiagramView.test.ts`](packages/lib/tests/component/diagram/DiagramView.test.ts) — the node-virtualization block (2919) the new §C block is modelled on, and every case reading `_edgeLayer._drawn` that must keep passing.

---

## Non-Goals

- **Anything at fit-the-whole-graph zoom.** Every edge is inside the viewport by definition there, so the admitted set is the whole graph and nothing improves. That is inherent to a viewport cull and is being addressed separately.
- **Culling the layer's root `<svg>`,** which stays sized to the graph bounds.
- **Recycling a fixed pool of `<path>` elements** across edges. There is no uniform pitch bounding how many routes cross a viewport, so a pool sized from the viewport cannot be sized at all.
- **Level-of-detail edge rendering** — dropping labels or markers at low zoom. That is a feature, not a cull.
- **A spatial index** for the admission scan.
- **Reshaping `_drawn`.** It stays a `DrawnEdge[]`, scanned linearly by `edgeIdAt` and `edgesNear` on every `mousemove`. Culling shortens that scan without changing its shape, and the existing tests index `_drawn` positionally.
- **Any new option** on `DiagramView` or `DiagramEdgeLayer` to disable or tune edge culling.
- **Changing the residency margin's value or the refresh rule.** Both are reused from the node plan exactly as they are, so nodes and edges reconcile on the same pass.

---

## Notes

[^layer-owns]: The alternative was to keep every residency fact in `DiagramView` — a `_edgeRects` map on the view, a resident id set computed beside the node one, and a `setResidentEdges(ids)` call on the layer. It was rejected because an id set is a fact about the graph, and the graph is replaced under the view: in `applyLayout` the residency pass runs from `promoteIncomingNodes` *before* `this._edgeLayer.setEdges(...)`, so any id set pushed there describes the incoming graph while the layer still holds the outgoing one, and the layer would diff one against the other. Reordering the two calls does not fix it — `setEdges` needs the routes and the residency pass needs the promoted node rects, and whichever runs first leaves the other stale. A rectangle has no such problem: it describes the viewport, is valid before, during, and after a graph swap, and lets the layer re-derive admission whenever *it* knows the routes changed. It also keeps the edge geometry (`routeBounds`, beside `buildPathData` and `distanceToRoute`) in the file that already owns route geometry, instead of splitting it across two.

[^shared-module]: `DiagramView.ts` imports `DiagramEdgeLayer` as a value ([DiagramView.ts:38](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L38)), so an import back would close a runtime cycle. It would probably work — neither module reads the other at evaluation time — but it is exactly the kind of ordering dependency that breaks silently under a bundler's chunking, and there is no lint rule here to catch it. `component/shared/selectionsEqual.ts` and `component/shared/reduceModifierSelection.ts` are the established shape for a pure helper two components share: `@internal`, documented, and absent from the barrel. The new module sits in `component/diagram/` rather than `component/shared/` because both of its consumers are in that folder; the `shared/` directory holds helpers shared *across* component folders (`Tree` and `Body`, `Body` and `MultiSelectList`).

[^rename]: `computeResidentNodes` takes `Iterable<string>` and `Map<string, DiagramRect>` and has no node-specific behaviour at all — only its name is node-specific, and leaving it while calling it on edges would be actively misleading. `NODE_RESIDENCY_MARGIN` and `updateNodeResidency` are the same case: one margin and one pass now govern both, which is the point of hanging edge culling off the node plan's existing refresh gate rather than giving edges their own. All three are module-private or `@internal` and not barrel-exported, so nothing outside the library sees the rename; the move to a new module already forces the test file's imports to change, which is what makes the rename nearly free. `DiagramView`'s own `_residentIds` and `_residencyViewport` fields are **not** renamed — they stay node-scoped, and the existing white-box tests read them by name.

[^padding]: Three things paint outside an edge's bare polyline: the end markers (up to `EDGE_MARKER_EXTENT`, 18 units, and 12 units across), the invisible hit path's 12-unit-wide stroke (6 either side), and a label's `<text>` plus its 4-unit halo at the route's midpoint. The widest marker's reach covers all three for the label lengths this component draws (short cardinality and key names), so one constant does. The padding is insurance rather than load-bearing: the residency rect already extends half a viewport past the visible rectangle, which is hundreds of graph units at any ordinary zoom, so 18 units of overhang could only matter in a viewport under about 36 graph units wide. Testing the bare point bounds instead would work in practice and fail obscurely at extreme zoom; a single added constant closes it.

[^diff-not-rebuild]: Two cheaper-looking shapes were rejected. The first is calling `rebuildPaths` on every residency change: `setEdgeEmphasis`'s own comment records a full redraw of a 1000-edge graph at around 20ms, so even a redraw restricted to an admitted tenth of the graph would be a couple of milliseconds thrown away on every pan that forces a refresh, for edges that did not move. A difference pays only for the edges actually crossing the boundary, which for a quarter-viewport of travel is a thin band of them. The second is a fixed pool of pre-built `<path>` elements shown/hidden or re-targeted, mirroring `VirtualRowView`'s row pool. `computePoolTarget` sizes that pool as `visibleHeight / rowHeight` — it works because rows have a uniform pitch, so the number in a viewport is bounded. Edge routes have no pitch: a hub node's fan-out puts hundreds of routes through one screen while a sparse region puts none, and at fit-the-whole-graph zoom every route is on screen at once. A pool sized for the worst case is the whole graph, which is what we are removing; a pool sized smaller would have to drop routes, which is visibly wrong. The node plan reached the same conclusion for the same reason, and expressed its buffer in viewports rather than in a count. Toggling `display`/`visibility` per edge instead of releasing was also rejected: it costs a DOM write per edge either way, and it leaves the elements in the document, which is precisely the cost being removed.

[^release-not-detach]: The node plan detaches an unmounted node component and keeps its element, because a node component comes from a consumer's `nodeRenderer`, can be an arbitrarily deep subtree, and may hold state that re-running the factory would discard. An edge's elements are two or three leaf SVG nodes built from four to eight attribute writes off a route the layer already caches, so recreating one is cheap and there is nothing to lose. Keeping them detached would also defeat the purpose: the memory held by every edge's elements is exactly what the cull is meant to release, and `releaseDrawnEdge` — which already removes, untracks, and releases — is the existing code path, so reusing it adds nothing new.

[^null-means-all]: Culling off by default rather than on falls out of the same rule `computeResidentIds` already documents for a node with no box: absent information means admitted, never culled. It buys two things. `DiagramEdgeLayer` stays usable on its own — every one of the 506 lines of `DiagramEdgeLayer.test.ts` constructs a bare layer and asserts on what it drew, and none of them needs to know culling exists. And a `DiagramView` that is never sized keeps drawing every edge, which is what every edge-related case in `DiagramView.test.ts` relies on when it reaches for `view._edgeLayer._drawn[0].hit`. The node plan's equivalent decision went the other way — an unsized view mounts *nothing* — and cost three pre-existing tests a one-line edit each. Nothing forces the same choice here: a node with no residency set has no box written yet either way, whereas an edge layer with no rectangle has a complete, drawable set of routes and no reason to withhold them.

[^hit-testing]: The proof is one line in each direction. A culled edge cannot be under the pointer: the residency rect is the visible rectangle grown by half a viewport on each side, so an edge whose padded box fails to reach it has every point of its route at least half a viewport off screen, and the pointer is by definition on screen. And no edge within tolerance of a visible point can be culled: `EDGE_HIT_TOLERANCE` is 6 graph units, so such an edge has a route point within 6 units of the visible rectangle, its box (already padded by 18) therefore intersects the visible rectangle, and the residency rect contains that. The one asymmetry is harmless — the box test is over-inclusive, so `edgesNear` may consider an edge whose box reaches the viewport but whose route does not, which `distanceToRoute` then rejects exactly as it does today.

[^no-api]: The node plan's reasoning carries over unchanged: `Table` exposes no switch for row or column virtualization and `Tree` none for its row pool, so a windowed rendering strategy is an internal property of the component here; and an opt-in flag would leave the consumer with the largest graph — the one that needs it — on the old path until they discovered it. `setResidency` is the one new method, and it exists because the layer is a separate `Component` with no access to the view's pan and zoom. Marking it `@internal` keeps it out of the rendered docs (`typedoc.json` sets `excludeInternal: true`) and, with it, `DiagramRect`, which would otherwise have to be barrel-exported and documented to appear in a public signature. `TreeBody`'s `@internal Framework wiring; application code does not call this.` is the same situation — one component driving another it owns — and supplies the wording.

[^emphasis]: `_edgeEmphasis` is a `Set<string>` populated from ids and never from drawn state; `groupFor(id)` reads it at the moment an edge is drawn and returns `_normalLayer` or `_dimLayer`. So an emphasis change while an edge is culled updates the set, `rebuildPaths` redraws the admitted edges into their new groups, and the culled edge picks its group up when it is next drawn. `getEdgeEmphasis()` copies the set out and never consults `_drawn`, so it reports a culled edge's id as it always did. This mirrors how the node plan handled selection and node emphasis on an unmounted node — the state lives on something that outlives the element — except that there the state is cached on the component and replayed at render, and here it is a set on the layer consulted at draw.
