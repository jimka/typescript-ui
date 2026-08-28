---
depends-on: [diagram-node-virtualization, diagram-edge-virtualization]
touches-shared:
  - packages/lib/src/typescript/lib/component/diagram/DiagramView.ts
  - packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts
  - packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts
  - packages/lib/tests/component/diagram/DiagramView.test.ts
  - packages/lib/tests/component/default-options-fallback.test.ts
  - packages/lib/docs/components/DiagramView.md
  - packages/lib/docs/reference/changelog/next.md
---

# Diagram Level-of-Detail Rendering — Implementation Plan

## Overview

[`DiagramView`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) now mounts only the nodes and draws only the edges whose box reaches the *residency rect* — the visible area grown by half a viewport on each side. At "fit the whole graph" zoom that saves nothing: everything is inside the viewport, so nothing is outside the residency rect to cull. Measured in the offline harness on a 332-node graph, `zoomToFit` leaves **332 of 332 node components mounted and 331 of 331 edges drawn** — the same cost as before either cull. Each node in that state renders about **38 × 7 CSS pixels**, so its label, glyph, and border are not readable at all.[^measured]

This plan makes the *content* cheaper in exactly that regime. Below a rendered-size threshold, `DiagramView` stops mounting node components altogether and instead draws one SVG `<rect>` per node into a new `DiagramNodeLayer` — a sibling of the existing [`DiagramEdgeLayer`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts) inside the same content host. A node costs 8 DOM elements and ~47 seam patches as a component, against 1 element and 1 patch as a rect — a *seam patch* being one batched DOM write through the framework's DOM seam.[^cost] Selection, node emphasis, clicking, double-clicking, and right-clicking all keep working against the rects.

Three source files change — `DiagramView.ts`, `DiagramNode.ts`, `DiagramGroupNode.ts` — plus one new component file, two new test files and two existing ones, one docs page, and the changelog. One consumer-facing option is added: `simplifyAtLowZoom`, defaulting to `true`. Edge simplification is deliberately left to a named follow-on plan.

---

## Architecture Decisions

### Simplified nodes are seam-drawn `<rect>`s in one layer, not cheaper components

Below the threshold, no node component is mounted. A new `DiagramNodeLayer` owns one `<svg>` and draws one `<rect>` per node through the DOM seam, tracked with `trackHandle` — the shape [`DiagramEdgeLayer:601`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L601) and [`AbstractChart.createMark:803`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L803) already use for "one Component, many seam-created leaf marks".[^layer-not-component]

The measured cost of one node, warmed up so one-time per-class work is excluded:

| Representation | DOM elements | per-instance CSS rules | seam patches |
|---|---|---|---|
| `DiagramNode` with a glyph + label (what sqladmin's Tables mode builds) | 8 | 0 | 47 |
| `DiagramNode` with a bare label | 2 | 0 | 22 |
| A bare `Component` with an instance `backgroundColor` | 1 | 1 | 32 |
| An `<svg>` `<rect>` through the seam, no Component | 1 | 0 | 1 |

The default node renderer costs **no per-instance stylesheet rule at all** — its colours come from class-level defaults — so stylesheet-rule count is not the cost to attack. Elements and seam patches are, and only the rect route removes both.[^cost]

### Nothing about layout, measurement, or the node components changes

`rebuildNodes`, `collectNodeSizes`, and `applyLayout`'s positioning loop are untouched: every node still gets a component, is measured for ELK, and receives its `setX` / `setY` / `setPreferredSize`. What changes is only whether that component is added to the content host.[^build-all] `centreNode`, `focusNode`, `revealNode`, and `zoomToFit` keep working unchanged, because they read the component's cached position and preferred size rather than its element.

### The trigger is rendered node height plus a node-count floor

`DiagramView` simplifies when **both** hold:

1. the graph has at least `LOD_MIN_NODES` (200) node components, and
2. the median leaf node renders shorter than `LOD_ENGAGE_HEIGHT` (16 CSS pixels) — its laid-out height times the current zoom.

Once simplified, it stays simplified until the rendered height reaches `LOD_DISENGAGE_HEIGHT` (20 CSS pixels). The gap between the two is hysteresis, so a wheel notch either side of the boundary cannot flip the whole graph back and forth.[^trigger]

| Graph | nodes | median leaf height | zoom | rendered | currently simplified | result |
|---|---|---|---|---|---|---|
| 325-table Tables mode, zoom 1 | 332 | 30 | 1 | 30 px | no | no — 30 ≥ 16 |
| 325-table Tables mode, fit | 332 | 30 | 0.237 | 7.1 px | no | **yes** — 7.1 < 16 |
| same, zoomed part-way back in | 332 | 30 | 0.6 | 18 px | yes | **yes** — 18 < 20, inside the band |
| same, zoomed further in still | 332 | 30 | 0.7 | 21 px | yes | no — 21 ≥ 20 |
| a 12-node schema diagram at min zoom | 12 | 30 | 0.25 | 7.5 px | no | no — under the 200-node floor |
| a 240-card FK diagram at min zoom | 240 | 200 | 0.25 | 50 px | no | no — tall cards stay legible |
| any graph before its first layout | 332 | 0 | 1 | — | no | no — no leaf boxes yet |

The node-count floor is what makes this change a no-op for every small diagram, including every graph the existing test suite builds.[^floor]

### The decision is made in `updateResidency`, the existing single reconciliation point

`updateResidency` already runs past a gate that opens on any zoom change, any viewport-extent change, and any graph replacement — which is every input the trigger reads. So the simplification decision is made there and nowhere else, and no new call site or scheduling is introduced.[^one-site]

### The layer redraws only when the graph or the mode changes

`DiagramNodeLayer.setNodes(rects, containerIds)` compares both arguments by object identity against what it already holds and returns immediately when neither moved. `DiagramView` passes `this._nodeRects` when simplified and a shared module-level `EMPTY_RECTS` when not, so a pan or a zoom that changes nothing costs zero DOM writes.[^identity]

Selection and emphasis do not redraw either — the layer holds both as its own state and patches only the affected rects, mirroring how `DiagramEdgeLayer` holds `_edgeEmphasis` and consults it at draw time.

### A rect's paint follows the component it stands in for

Selection decides a rect's colours; emphasis decides only its opacity; a container rect ignores selection, exactly as `DiagramGroupNode` does today (it has no `setSelected`, so `applySelectedVisual`'s duck-typed call is already a no-op for it).

| Node | Selected | Emphasis set non-empty and excludes it | `fill` | `stroke` | `opacity` |
|---|---|---|---|---|---|
| leaf | no | no | node background | node border | — |
| leaf | yes | no | node selected background | accent | — |
| leaf | no | yes | node background | node border | `0.35` |
| leaf | yes | yes | node selected background | accent | `0.35` |
| container | either | no | group background | group border | — |
| container | either | yes | group background | group border | `0.35` |

The six colours come from constants exported `@internal` by `DiagramNode.ts` and `DiagramGroupNode.ts` rather than being restated, so a simplified node cannot drift away from the component it replaces.[^shared-colours]

### Clicks resolve geometrically while simplified; presses still pan

`nodeIdAt(target)` cannot answer once no node component is mounted. A new `nodeIdAtEvent(event)` resolves the node from the pointer's graph coordinate against `_nodeRects` while simplified, and delegates to `nodeIdAt(event.target)` otherwise. It is used by `_handleClick`, `_handleDoubleClick`, and `_handleContextMenu`.

`_handlePointerDown` is **not** changed: while simplified, a press anywhere pans, including on a node. The canvas therefore shows `grab` everywhere and the cursor stays honest, and a press that does not travel is still delivered as a click and still selects.[^press-pans]

Worked against a container `public` at `{0, 0, 400, 300}` holding leaves `users` at `{20, 40, 160, 30}` and `orders` at `{220, 40, 160, 30}`:

| Graph point | Result | Why |
|---|---|---|
| `(100, 50)` | `users` | inside a leaf box — a leaf beats the container it sits in |
| `(300, 200)` | `public` | inside the container only |
| `(180, 70)` | `users` | on the leaf box's bottom-right corner — the test is inclusive |
| `(500, 50)` | `null` | outside every box |

### `simplifyAtLowZoom` is an opt-**out**, and the only new public API

`DiagramViewOptions` gains `simplifyAtLowZoom?: boolean`, defaulting to `true`, with the matching `setSimplifyAtLowZoom` / `isSimplifyAtLowZoom` pair. `DiagramNodeRenderer` keeps its exact `(data) => Component` signature: a consumer's factory is never asked to render cheaply, because the library draws the simplified form itself.[^opt-out]

No sqladmin panel needs any change. Its two custom-renderer diagrams (`RelationDiagramPanel`'s `TableCardNode`, `ExplainDiagramPanel`'s `ExplainNode`) are well under the 200-node floor, and a card's height keeps it above the 16-pixel threshold at any reachable zoom; its 325-table Tables-mode diagram uses the default renderer and is exactly the case this targets.

### Edge simplification is a separate, named follow-on plan

Edges keep their current treatment at every zoom. On the same measured graph at fit, nodes account for 2,656 of the 3,318 graph elements and about 96% of the seam patches; edges account for 662 elements and 662 patches. Node simplification alone cuts the graph's element count by roughly 70%, and it lands with no change to `DiagramEdgeLayer.ts` at all.[^split-edges]

---

## Public API

One new option and its accessor pair on `DiagramView`:

```typescript
export interface DiagramViewOptions extends PanelOptions {
    /** Draw a simplified node box instead of the node component at low zoom (default true). */
    simplifyAtLowZoom?: boolean;
}

setSimplifyAtLowZoom(value: boolean): this;
isSimplifyAtLowZoom(): boolean;
```

Backing field: none — the options bag is the cache (`this._options.simplifyAtLowZoom`), per ARCHITECTURE.md's *Always cache in memory* rule. The getter folds the class default: `return this._options.simplifyAtLowZoom ?? this._defaultOptions.simplifyAtLowZoom ?? true;`, and `true` is seeded in the constructor's defaults bag beside `controls`.

`DiagramNodeRenderer`, `DiagramView`'s events, and every other method are untouched.

New internal module, `packages/lib/src/typescript/lib/component/diagram/DiagramNodeLayer.ts` — **not** added to [`component/diagram/index.ts`](packages/lib/src/typescript/lib/component/diagram/index.ts):

```typescript
/** Opacity of a node outside a non-empty node-emphasis set. @internal */
export const DIMMED_NODE_OPACITY: number;

class DiagramNodeLayer extends Component<ComponentOptions> {
    /** @internal Framework wiring between `DiagramView` and its node layer; application code does not call this. */
    setNodes(rects: Map<string, DiagramRect>, containerIds: ReadonlySet<string>): this;
    /** @internal */
    setSelected(id: string | null): this;
    /** @internal */
    setEmphasis(ids: ReadonlySet<string>): this;
}
```

`DIMMED_NODE_OPACITY` **moves** here from `DiagramView.ts` (with its existing doc comment), so both the component path and the rect path read one constant; `DiagramView` imports it back. The class is wrapped with `callable()` and exported under the two names ARCHITECTURE.md requires, exactly as `DiagramEdgeLayer` is.

Two new module-level pure functions in `DiagramView.ts`, marked `@internal`, exported for the offline tests only and **not** barrel-exported:

```typescript
/** The median height of the leaf boxes in `rects`; `0` when there are none. @internal */
export function medianLeafHeight(rects: Map<string, DiagramRect>, containerIds: ReadonlySet<string>): number;

/** Whether the view should draw simplified node boxes rather than mounting node components. @internal */
export function shouldSimplify(nodeCount: number, medianHeight: number, zoom: number, simplified: boolean): boolean;
```

New `@internal` colour constants, exported from the two renderer files so the layer can reuse them:

```typescript
// DiagramNode.ts
export const DIAGRAM_NODE_BACKGROUND_COLOR: string;
export const DIAGRAM_NODE_BORDER_COLOR: string;
export const DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR: string;   // already exists, now exported
export const DIAGRAM_NODE_SELECTED_BORDER_COLOR: string;       // already exists, now exported

// DiagramGroupNode.ts
export const DIAGRAM_GROUP_BACKGROUND_COLOR: string;
export const DIAGRAM_GROUP_BORDER_COLOR: string;
```

---

## Internal Structure

### New constants in `DiagramView.ts`

```typescript
/**
 * Fewest node components a graph must have before low-zoom simplification
 * engages at all. Below this there is nothing worth saving — a hundred nodes
 * is a few hundred elements, not the several thousand that make a fit-zoom
 * repaint expensive — and a small diagram the user deliberately zoomed out
 * of should keep rendering what it always rendered.
 */
const LOD_MIN_NODES = 200;

/**
 * Rendered height, in CSS pixels, below which a node's own content stops
 * being worth drawing. `DiagramNode` spends 8px of its box on interior
 * insets, so at 16px the label's glyphs resolve to about 6px — under the
 * point where a table name can be read, and under the point where a 1px
 * border and a 4px corner radius resolve at all.
 */
const LOD_ENGAGE_HEIGHT = 16;

/**
 * Rendered height at which full node components come back. Higher than
 * LOD_ENGAGE_HEIGHT so the two form a hysteresis band: two wheel notches
 * (1.1x each) inside the band cannot flip the mode back, which is what keeps
 * a zoom burst near the boundary from mounting and unmounting every node
 * component repeatedly. Same idea as the residency trigger rect, on the
 * zoom axis instead of the pan axis.
 */
const LOD_DISENGAGE_HEIGHT = 20;

/** The empty rect map handed to the node layer when the view is not simplified;
 *  a shared instance so the layer's identity check sees no change between passes. */
const EMPTY_RECTS: Map<string, DiagramRect> = new Map();
```

### The two pure functions

```typescript
export function medianLeafHeight(rects: Map<string, DiagramRect>, containerIds: ReadonlySet<string>): number {
    const heights: number[] = [];

    for (const [id, rect] of rects) {
        if (!containerIds.has(id)) {
            heights.push(rect.height);
        }
    }

    if (heights.length === 0) {
        return 0;
    }

    heights.sort((a, b) => a - b);

    return heights[Math.floor(heights.length / 2)];
}

export function shouldSimplify(nodeCount: number, medianHeight: number, zoom: number, simplified: boolean): boolean {
    if (nodeCount < LOD_MIN_NODES || !(medianHeight > 0)) {
        return false;
    }

    const rendered = medianHeight * zoom;

    return rendered < (simplified ? LOD_DISENGAGE_HEIGHT : LOD_ENGAGE_HEIGHT);
}
```

Containers are excluded from the median because a compound graph's few container boxes are hundreds of units tall and would drag the statistic away from what the user is actually reading. The median (rather than the mean) keeps one outsized leaf from doing the same.

### New private state on `DiagramView`

```typescript
/** The simplified-node layer, a persistent child of the content host beside the edge layer. */
private _nodeLayer!: DiagramNodeLayer;

/** Whether the view is currently drawing simplified node boxes instead of mounting node components. */
private _simplified: boolean = false;
```

Plain initializers are correct: neither field is written by a setter that `applyOptions` dispatches, so `CODE_CONVENTIONS.md`'s `declare` rule does not apply.

### `updateResidency`, extended

```typescript
private updateResidency(): void {
    const live = this.viewportGraphRect();

    if (live === null || !residencyNeedsRefresh(this._residencyViewport, live, RESIDENCY_MARGIN)) {
        return;
    }

    this._residencyViewport = live;

    const residency  = inflateRect(live, RESIDENCY_MARGIN);
    const simplified = this.isSimplifyAtLowZoom()
        && shouldSimplify(this._nodeComponents.size,
            medianLeafHeight(this._nodeRects, this._containerIds), this.getZoom(), this._simplified);

    this._simplified = simplified;
    this._nodeLayer.setNodes(simplified ? this._nodeRects : EMPTY_RECTS, this._containerIds);

    const next = simplified
        ? new Set<string>()
        : computeResidentIds(this._nodeComponents.keys(), this._nodeRects, residency);

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

    this._edgeLayer.setResidency(residency);
}
```

`shouldSimplify` is passed the *previous* `this._simplified` for its hysteresis branch, which is why the result lands in a local before the field is written.

### The geometric hit test

```typescript
private nodeIdAtEvent(event: MouseEvent): string | null {
    if (!this._simplified) {
        return this.nodeIdAt(event.target);
    }

    const host = this._contentHost.getElement();

    if (host === undefined || event.target === null) {
        return null;
    }

    const handle = DOM.source.intern(event.target);

    // Only a target inside the content host can be over a node box. This is
    // what keeps a press on the control cluster or on the busy overlay —
    // both children of the view root, not of the content host — from
    // resolving to whatever node happens to sit under them.
    if (handle !== host && !DOM.source.contains(host, handle)) {
        return null;
    }

    const rect = DOM.source.getViewportRect(this);
    const zoom = this.getZoom();

    return this.nodeIdAtGraphPoint((event.clientX - rect.left - this._panX) / zoom,
        (event.clientY - rect.top - this._panY) / zoom);
}

private nodeIdAtGraphPoint(x: number, y: number): string | null {
    let container: string | null = null;

    for (const [id, rect] of this._nodeRects) {
        if (x < rect.x || y < rect.y || x > rect.x + rect.width || y > rect.y + rect.height) {
            continue;
        }

        if (!this._containerIds.has(id)) {
            return id;
        }

        container ??= id;
    }

    return container;
}
```

The pointer-to-graph mapping is the one `_handleEdgeMouseMove` ([DiagramView.ts:1704-1707](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1704)) already applies.

### `DiagramNodeLayer` internals

```typescript
/** Corner radius (SVG user units) of a simplified rect — the unitless twin of the
 *  4px borderRadius both DiagramNode and DiagramGroupNode declare, so a simplified
 *  node keeps the silhouette of the component it stands in for. */
const RECT_RADIUS = "4";

/** Stroke width of a simplified rect, matching the 1px border both renderers declare. */
const RECT_STROKE_WIDTH = "1";

private _rects: Map<string, DiagramRect> = new Map();
private _containerIds: ReadonlySet<string> = new Set();
/** The rect drawn per node id, in paint order: containers first, then leaves. */
private _drawn: Map<string, Handle> = new Map();
private _selected: string | null = null;
private _emphasis: ReadonlySet<string> = new Set();
```

`setNodes` returns immediately when both arguments are identical (`===`) to what it holds; otherwise it stores them and calls `redraw()` when an element exists, else defers with `this.onFirstLayout(() => this.redraw())` — the deferral `DiagramEdgeLayer.setEdges` already uses. `render()` calls `redraw()` too.

`redraw()` releases every entry in `_drawn` (remove from the root, untrack, release), clears it, then draws every id in `_containerIds` first and every other id second, so document order puts container washes behind leaf boxes.

`drawRect(id, rect, container)` creates one `<rect>` through the seam, applies `rectAttrs(id, rect, container)`, appends it to the root, and tracks the handle. `rectAttrs` returns `x` / `y` / `width` / `height` / `rx` / `fill` / `stroke` / `stroke-width`, plus `opacity` when a non-empty `_emphasis` excludes the id — the table in `## Architecture Decisions` is the whole rule.

`setSelected(id)` stores the id and re-applies `rectAttrs` to the outgoing and incoming rects only. `setEmphasis(ids)` stores the set and re-applies `rectAttrs` to every drawn rect. Neither creates or releases an element.

The layer's root carries `pointer-events: none` (nothing hit-tests against a rect — `nodeIdAtGraphPoint` does that geometrically) and `cursor: inherit`, both for the reasons `DiagramEdgeLayer`'s constructor already documents.

---

## Ordered Implementation Steps

Tests come first for each behavioural change, per the `implement` skill's test-first flow. Steps 1–3 are a mechanical export change with no behaviour; run the suite green before step 4.

1. **Export the node palette from `DiagramNode.ts`.** Lift `DIAGRAM_NODE_BACKGROUND_COLOR` out of [`_defaultDiagramNodeOptions.backgroundColor`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L43) and `DIAGRAM_NODE_BORDER_COLOR` out of the `border` shorthand on the next line (which becomes `` `1px solid ${DIAGRAM_NODE_BORDER_COLOR}` ``), and add `export` to the two existing `DIAGRAM_NODE_SELECTED_*` constants ([DiagramNode.ts:56](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L56), [60](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L60)). Mark all four `@internal`. The rendered strings must not change — `tests/component/default-options-fallback.test.ts:296` and `:437` assert them verbatim.

2. **Export the group palette from `DiagramGroupNode.ts`** the same way: `DIAGRAM_GROUP_BACKGROUND_COLOR` and `DIAGRAM_GROUP_BORDER_COLOR` out of [`_defaultDiagramGroupNodeOptions`](packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts#L34), both `@internal`, with the `border` shorthand rebuilt from the colour constant.

3. **Checkpoint:** `npm run typecheck` clean and `npm test` green, with no test edited.

4. **Add the failing pure-function tests.** Create `packages/lib/tests/component/diagram/DiagramLevelOfDetail.test.ts` with a `describe` block per function covering `## Expected Behaviour` §A, importing `medianLeafHeight` and `shouldSimplify` from `~/component/diagram/DiagramView`. Model the file on [`tests/component/diagram/DiagramResidency.test.ts`](packages/lib/tests/component/diagram/DiagramResidency.test.ts). Expect the import to fail.

5. **Add the four constants and the two pure functions** to `DiagramView.ts`, at module level directly below `RESIDENCY_MARGIN` ([DiagramView.ts:119](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L119)), each with the doc comment from `## Internal Structure`, and mark the two exported functions `@internal`. → verify: `npm run typecheck` clean and the new file passes.

6. **Add the failing layer tests.** Create `packages/lib/tests/component/diagram/DiagramNodeLayer.test.ts` covering `## Expected Behaviour` §B, modelled on [`tests/component/diagram/DiagramEdgeLayer.test.ts`](packages/lib/tests/component/diagram/DiagramEdgeLayer.test.ts)'s `RecordingDOMSink` helpers and white-box style. Expect them to fail.

7. **Create `packages/lib/src/typescript/lib/component/diagram/DiagramNodeLayer.ts`** per `## Public API` and `## Internal Structure`, with the SPDX header and a file-header comment in `DiagramEdgeLayer.ts`'s style. Import the six colour constants from steps 1–2 and `DiagramRect` as a type from `~/component/diagram/DiagramResidency.js`. **Move** `DIMMED_NODE_OPACITY` here from [DiagramView.ts:83](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L83), keeping its doc comment, and export it `@internal` — in the same step, delete its declaration from `DiagramView.ts` and import it back from the layer, so the tree never holds two of it. → verify: `npm run typecheck` clean and the layer tests pass.

8. **Checkpoint:** `grep -n 'DiagramNodeLayer\|DIMMED_NODE_OPACITY' packages/lib/src/typescript/lib/component/diagram/index.ts` — expect zero matches.

9. **Add the `simplifyAtLowZoom` option** to `DiagramViewOptions` ([DiagramView.ts:126](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L126)), forward it in `applyOptions` ([DiagramView.ts:441](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L441)) as a cache-only write beside `controls`, seed `simplifyAtLowZoom: true` in the constructor's defaults bag ([DiagramView.ts:338](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L338)), and add `setSimplifyAtLowZoom` / `isSimplifyAtLowZoom` beside `setControlsVisible` / `isControlsVisible` ([DiagramView.ts:1937](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1937)). The setter writes the option, sets `this._residencyViewport = null`, and calls `this.updateResidency()` so a mid-life change takes effect at once. The getter folds the default, per `## Public API`.

10. **Add the `DiagramView simplifyAtLowZoom` row** to the registry in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) beside the two existing `DiagramView` rows (412-413): `resolve: () => new DiagramView().isSimplifyAtLowZoom(), expected: true`. → verify: `npm test` green.

11. **Add the two private fields** (`_nodeLayer`, `_simplified`) beside `_edgeLayer` ([DiagramView.ts:206](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L206)) and `_residencyViewport` ([DiagramView.ts:240](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L240)), each with a doc comment. Import `DiagramNodeLayer` beside the existing `DiagramEdgeLayer` import ([DiagramView.ts:38](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L38)). In the constructor, build the layer and add it to the content host on the line after the edge layer ([DiagramView.ts:360-361](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L360)) — the order matters, because in a flat graph both layers sit at `DEFAULT_Z_INDEX` and document order is what paints node rects over edges.

12. **Set the layer's z-index in `applyContainerZIndex`** ([DiagramView.ts:786](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L786)): `LEAF_Z_INDEX` in the compound branch and `DEFAULT_Z_INDEX` in the flat branch, in both cases on the line after that branch's existing `_edgeLayer.setZIndex(...)` call — in the flat branch that means before its `return`. Extend the method's doc comment: the node layer is the second persistent child needing the flat-mode restore.

13. **Add the failing view tests** to `packages/lib/tests/component/diagram/DiagramView.test.ts`, in a new `describe('DiagramView — level-of-detail rendering at low zoom')` block placed after the edge-virtualization block (the one beginning at [DiagramView.test.ts:3274](packages/lib/tests/component/diagram/DiagramView.test.ts#L3274)), covering `## Expected Behaviour` §C. It needs a fixture building a 220-node graph and its layout result; keep it local to the block.

14. **Extend `updateResidency`** ([DiagramView.ts:881](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L881)) exactly as `## Internal Structure` gives it, and extend its doc comment: it also decides whether the view draws simplified node boxes.

15. **Push selection and emphasis to the layer.** In `setSelection` ([DiagramView.ts:1409](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1409)) add `this._nodeLayer.setSelected(data ? id : null);` after the existing branch. In `applyNodeEmphasis` ([DiagramView.ts:1307](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1307)) add `this._nodeLayer.setEmphasis(this._nodeEmphasis);` after the loop.

16. **Clear the layer's state on a graph swap.** In `promoteIncomingNodes` ([DiagramView.ts:558](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L558)), beside the existing `this._selection = []` / `this._nodeEmphasis = new Set()` writes, add `this._nodeLayer.setSelected(null);` and `this._nodeLayer.setEmphasis(new Set());`. Without this a new graph reusing an old id would paint that node selected or dimmed.

17. **Add `nodeIdAtEvent` and `nodeIdAtGraphPoint`** as private methods directly after `nodeIdAt` ([DiagramView.ts:1664](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1664)), exactly as `## Internal Structure` gives them.

18. **Route the three handlers through `nodeIdAtEvent`:** `_handleClick` ([DiagramView.ts:1620](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1620)), `_handleDoubleClick` ([DiagramView.ts:1645](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1645)), and `_handleContextMenu` ([DiagramView.ts:1764](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1764)). Leave `_handlePointerDown` ([DiagramView.ts:1834](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1834)) on `nodeIdAt(event.target)` — see the "presses still pan" decision. → verify: `npm test` green, including the new §C block.

19. **Checkpoint:** `grep -n 'nodeIdAt(event.target)' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — expect exactly two matches: the delegation inside `nodeIdAtEvent` and the call in `_handlePointerDown`. And `grep -n 'DIMMED_NODE_OPACITY' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — expect exactly two, the import and its use in `applyNodeEmphasis`.

20. **Update the docs page and the changelog** per `## Documentation Impact`.

21. **Run the full gate:** `npm run typecheck`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings).

22. **Verify in sqladmin** per `## Verification`'s manual section.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/diagram/DiagramNodeLayer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts` |
| Create | `packages/lib/tests/component/diagram/DiagramNodeLayer.test.ts` |
| Create | `packages/lib/tests/component/diagram/DiagramLevelOfDetail.test.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

§A, §B, and §C are unit-testable offline. §D lists behaviours that must stay exactly as they are. §E is manual.

### §A — the pure functions

`medianLeafHeight`:

| `rects` (heights) | `containerIds` | Result |
|---|---|---|
| `10, 20, 30` | none | `20` |
| `10, 20, 30, 40` | none | `30` — the upper of the two middle values |
| `10, 20, 900` | the `900` one | `20` |
| empty | none | `0` |
| `10, 20` | both | `0` — every box is a container |

`shouldSimplify` — the seven rows of the trigger table in `## Architecture Decisions`, plus:

- `nodeCount` exactly `200` with a rendered height of `7` returns `true`; `199` returns `false`.
- A rendered height exactly at `LOD_ENGAGE_HEIGHT` (`16`) with `simplified = false` returns `false` — the comparison is strict.
- A rendered height exactly at `LOD_DISENGAGE_HEIGHT` (`20`) with `simplified = true` returns `false`.
- A negative or `NaN` `medianHeight` returns `false`.

### §B — the layer

Using `DiagramNodeLayer` directly, as `DiagramEdgeLayer.test.ts`'s cases do:

- **A fresh layer draws nothing** and creates no element children.
- **`setNodes` with two leaves draws two `<rect>`s**, each carrying its box's `x` / `y` / `width` / `height`, `rx="4"`, the node background fill, the node border stroke, and `stroke-width="1"`.
- **Containers are drawn before leaves**, whatever order the rects map is in: with a container `c` listed after leaf `a`, `_drawn`'s key order is `['c', 'a']` and the container's `appendChild` is recorded first.
- **Calling `setNodes` again with the same two arguments issues no DOM write at all** — no `createElementNS`, no `apply`, no `removeChild`.
- **Calling `setNodes` with a different map redraws**: every previous rect is removed and released, and the new set is drawn.
- **`setNodes` with an empty map releases everything** and leaves `_drawn` empty.
- **`setSelected('a')` patches only `a`'s rect**, to the selected background and accent stroke, and issues no `createElementNS`; a following `setSelected('b')` patches `a` back to the resting colours and `b` to the selected ones — two patches, no more.
- **`setSelected` on a container id leaves that container's rect at the group colours** — a container never paints selected.
- **`setEmphasis(new Set(['a']))` writes `opacity="0.35"` on every other rect** and none on `a`; `setEmphasis(new Set())` removes the attribute from all of them.
- **Emphasis and selection compose**: a selected but unemphasised node draws the selected colours *and* the dimmed opacity.
- **State applied before a draw survives it**: `setSelected('a')` followed by `setNodes(...)` draws `a` already selected.
- **A `setNodes` before the element exists draws nothing then**, and the deferred first draw honours it.
- **Disposal releases every drawn rect** — the tracked-handle set is empty afterwards.

### §C — the view

Using the existing `StubDiagramView` + `StubEngine` fixtures with a 220-node graph laid out on a grid:

- **At zoom 1 the view is not simplified**: `view._simplified` is `false`, `view._nodeLayer._drawn.size` is `0`, and `_residentIds` holds the nodes near the viewport exactly as it does today.
- **After `zoomToFit` the view is simplified**: `view._simplified` is `true`, `_residentIds` is empty, `view._contentHost.getComponents()` contains neither node component, and `view._nodeLayer._drawn.size` is `220`.
- **Every node component still exists and still reports its laid-out coordinates** while simplified — `_nodeComponents.size` is `220` and a given node's `getX()` / `getY()` match its box.
- **Zooming back in past the disengage height remounts and clears**: `_simplified` is `false`, `_nodeLayer._drawn.size` is `0`, and the near nodes are back in `_contentHost.getComponents()`.
- **The hysteresis band holds**: from the simplified state, a `setZoom` whose rendered height lands between the two thresholds leaves `_simplified` `true`.
- **A 190-node graph never simplifies**, at fit or at any zoom.
- **`simplifyAtLowZoom: false` never simplifies**, at fit on the 220-node graph; `setSimplifyAtLowZoom(false)` while simplified disengages immediately (`_simplified` false, layer cleared, near nodes mounted), and `setSimplifyAtLowZoom(true)` re-engages.
- **A click on a simplified node selects it**: a `click` event whose target is the content host element and whose client coordinates fall inside a node's box emits `"selection"` with that node's data.
- **A click on empty canvas while simplified clears the selection**, as it does at normal zoom.
- **A click on the control cluster while simplified selects nothing**, even when a node box sits under the cluster's corner.
- **A double-click on a simplified node emits `"activate"`** with its data; a right-click emits `"contextmenu"` and returns `{ prevent: true }`.
- **A leaf beats its container**: on a compound simplified graph, a click inside a leaf that sits inside a container resolves to the leaf.
- **A press on a simplified node pans**: `_handlePointerDown` over a node box sets `_panning` true, and the following `_handlePointerMove` writes a new transform.
- **Selection paints on the rect**: `selectNode('n5')` while simplified patches `n5`'s rect to the selected colours.
- **Node emphasis paints on the rects**: `setNodeEmphasis(['n5'])` while simplified writes the dimmed opacity on every other rect.
- **A replaced graph resets the layer**: after a second `setData` whose layout lands while simplified, the layer draws the new graph's boxes and no rect carries the selected colours or a dimmed opacity.
- **The layer is a content-host child**: `view._contentHost.getComponents()` contains `view._nodeLayer` from construction, and it is disposed with the view.
- **Compound z-index covers both layers**: after a compound `setData`, `view._nodeLayer.getZIndex()` is `2` and `view._edgeLayer.getZIndex()` is `1`; after a following flat `setData`, both are `0`.

### §D — unchanged behaviours the existing suite already pins

These must keep passing with **no edit to any assertion**. Every graph in the existing suite has at most a handful of nodes, far under `LOD_MIN_NODES`, so `shouldSimplify` returns `false` for all of them and no existing case can reach the new path:

- Every case in `DiagramView.test.ts`, including the node-virtualization block (2947), the edge-virtualization block (3274), `whenLaidOut`, the stale-layout guard, "hidden until placed", compound graphs and their z-index order, selection, `activate`, `contextmenu`, the control-cluster hit guard, the click-versus-drag slop guard, wheel zoom, the pan drag, `edgehover` / `edgeleave`, and the `initialFocusNode` / `focusNode` retry semantics.
- Every case in `DiagramEdgeLayer.test.ts`, `DiagramNode.test.ts`, `DiagramGroupNode.test.ts`, `DiagramNode.selectedStateDedup.test.ts`, and `DiagramResidency.test.ts`.
- `tests/component/default-options-fallback.test.ts`'s existing `DiagramNode` rows (296, 437-439), which pin the exact colour and border strings steps 1–2 must preserve.

### §E — manual, in the sqladmin consuming app

- The Tables-mode whole-database diagram opens and centres as it does today, with full node components at the initial zoom.
- Pressing **Fit to view** replaces the table boxes with plain filled boxes at the same positions and sizes, with the edges unchanged; the picture still reads as the same graph.
- Clicking one of those boxes selects it (the box takes the accent colours and the app's edge emphasis updates); double-clicking it opens that table; right-clicking it opens the app's context menu.
- Dragging from anywhere, including from a box, pans; the cursor stays `grab` / `grabbing` throughout.
- Zooming back in restores full node components with the selection still applied to the right table.
- Wheel-zooming back and forth across the point where the boxes appear does not flicker between the two renderings on every notch.
- The Overview mode diagram (a dozen schema nodes) never simplifies, at any zoom including fit.
- The FK-explorer diagram (`RelationDiagramPanel`, custom `TableCardNode`s) never simplifies, at any zoom including fit — its cards keep rendering their column rows.
- Closing the diagram tab does not grow the page's element count or stylesheet rule count.

---

## Verification

Automated, from the repo root:

- `npm run typecheck` — clean.
- `npm test` — the whole suite, with `tests/component/diagram/` green. Every case listed in `## Expected Behaviour` §D must pass **unmodified**; a case needing an edit means the change is not behaviour-preserving and should be re-examined rather than the test relaxed.
- `npm run lint` — clean.
- `npm run docs:api` — zero warnings.
- `grep -n 'DiagramNodeLayer\|DIMMED_NODE_OPACITY' packages/lib/src/typescript/lib/component/diagram/index.ts` — expect zero matches.
- `grep -rn 'nodeIdAt(event.target)' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — expect exactly two matches: the delegation inside `nodeIdAtEvent` and the call in `_handlePointerDown`.

Manual, in the sqladmin consuming app at `/home/jika/typescript/sqladmin`:

- Build the library with `npm run build:lib` and consume it through the symlink override, then open the Tables-mode database diagram at a maximized viewport.
- Walk `## Expected Behaviour` §E.
- Read the element count from the DiagnosticsOverlay (About dialog → Debug) with the diagram at **Fit to view**, before and after. The prediction from the offline harness is a fall of roughly 7 elements per node — about 2,300 for a 332-node graph — with the edge elements unchanged.
- Take a Chrome performance trace over a fit / pan / zoom burst under 6× CPU throttling and compare the DOMSize and ForcedReflow insights against the numbers the two virtualization passes recorded.
- Check whether the canvas still flickers or paints partly empty while panning at fit zoom — the symptom neither cull could reach — and record the result in `/home/jika/typescript/sqladmin/LIBRARY_NOTES.md` whichever way it goes.

---

## Documentation Impact

`simplifyAtLowZoom`, `setSimplifyAtLowZoom`, and `isSimplifyAtLowZoom` land on the existing `DiagramView` TypeDoc page automatically — no barrel edit and no new page. `DiagramNodeLayer` is not re-exported from `component/diagram/index.ts`, so TypeDoc never sees it; no public JSDoc may `{@link}` it or any of the new `@internal` colour constants, per `CODE_CONVENTIONS.md` — refer to them in prose.

`packages/lib/docs/components/DiagramView.md`:

- Add a row to *Common methods* after the `setControlsVisible` row ([DiagramView.md:117](packages/lib/docs/components/DiagramView.md#L117)): `` `setSimplifyAtLowZoom(v)` / `isSimplifyAtLowZoom()` `` — "Draw plain node boxes instead of node components once a large graph is zoomed out far enough that node content is no longer legible (default `true`)."
- Add an *Interaction* bullet after **Zoom** ([DiagramView.md:135](packages/lib/docs/components/DiagramView.md#L135)): **Low zoom on a large graph** — a graph of at least a couple of hundred nodes, zoomed out until a node renders under about 16 pixels tall, draws each node as a plain themed box instead of its node component. Selection, double-click activation, and the context menu keep working against those boxes; a press anywhere pans, so the cursor is `grab` across the whole canvas. Pass `simplifyAtLowZoom: false` to keep full node components at every zoom.
- Amend the last *Notes* bullet ([DiagramView.md:167](packages/lib/docs/components/DiagramView.md#L167)), which covers the two culls, with a closing sentence: below that zoom no node component is mounted at all and the boxes are drawn instead, so a custom `nodeRenderer`'s component is not what the viewer sees there.

`packages/lib/docs/reference/changelog/next.md` — one bullet in the `### Components` list under the **first** `## Changed` heading, directly after the two existing diagram bullets ([next.md:184](packages/lib/docs/reference/changelog/next.md#L184)). One bullet rather than an `## Added` entry for the option plus a `## Changed` entry for the behaviour: the option exists only to refuse the behaviour, and splitting them would leave two half-entries a reader has to join up.

> - **A large diagram now draws plain node boxes once it is zoomed out past the point where node content is legible.** On a graph of at least a couple of hundred nodes, zoomed out until a node renders under about 16 pixels tall, `DiagramView` stops mounting node components and draws one themed box per node instead — the case "fit the whole graph" produces, and the one place viewport culling could never help, because nothing is off screen to cull. Selection, `"activate"`, `"contextmenu"`, node emphasis, and every centring method behave the same against a simplified node, and full node components come back on the way in. Pass `simplifyAtLowZoom: false` (or call `setSimplifyAtLowZoom(false)`) to keep full node components at every zoom.

---

## Potential Challenges

- **An edge hit path overlapping a node box wins the click while simplified.** `_handleClick` tests `edgeIdAt` before the node lookup, and an edge's 12-unit hit stroke reaches a little way into the node box it terminates at, so a click landing there leaves the selection unchanged instead of selecting the node. The band is a few graph units at the zooms this engages at; the outcome is "nothing happens", not a wrong selection, and reordering the two checks would disturb behaviour the existing suite pins.
- **A graph swap can draw the rects and then immediately throw them away.** `promoteIncomingNodes` runs its residency pass at the old zoom, and `tryInitialCentre` (or a consumer's `zoomToFit` on `"layout"`) may change the zoom right after. The wasted pass costs one draw of one layer's rects and happens only on a graph replacement, so no guard is added — the existing "applyLayout reaches the residency pass more than once" note covers the same ground.
- **The median is recomputed on every pass past the residency gate.** It allocates and sorts one array of node heights — a few hundred numbers on a zoom change, well below the cost of the mounts it decides. Caching it would need invalidation on every graph swap for no measurable gain.
- **A custom `nodeRenderer`'s colour coding is lost while simplified.** Every rect uses the library's own node palette, so a consumer painting meaning into its node components sees plain boxes at fit. `simplifyAtLowZoom: false` is the escape hatch; a per-node colour on the model is a Non-Goal.
- **Container rects paint over edges rather than under them.** Both layers are in the content host, and the node layer sits above the edge layer so leaf boxes read in front of the routes, as leaf components do today. A container's fill is an 8%-alpha wash, so the difference is not visible at the zooms this engages at.
- **The layer's identity check depends on `_nodeRects` never being mutated after promotion.** Nothing mutates it today — `applyLayout` writes into `_incomingRects`, and `promoteIncomingNodes` hands the whole map over and installs a fresh one — and §C's "a replaced graph resets the layer" case is what catches a future change that breaks that.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — the main file being changed. Read `promoteIncomingNodes` (558), `applyLayout` (730), `applyContainerZIndex` (786), `applyTransformToHost` (842), `viewportGraphRect` (858), `updateResidency` (881), `mountNode` (922), `unmountNode` (949), `applyNodeEmphasis` (1307), `setSelection` (1409), `_handleClick` (1601), `_handleDoubleClick` (1644), `nodeIdAt` (1664), `_handleEdgeMouseMove` (1693), `_handleContextMenu` (1763), `isControlsTarget` (1787), and `_handlePointerDown` (1821) as a unit before editing.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts) — the precedent `DiagramNodeLayer` mirrors: one Component owning one `<svg>`, seam-created leaf children tracked with `trackHandle`, a `pointer-events: none` root, `var(--…)` values written straight into SVG presentation attributes, and the `@internal Framework wiring` tag line. Read `createRootElement` (601), `createEdgeGroup` (630), `render` (722), `updateDrawnEdges` (801), `setResidency` (849), `drawHitPath` (867), and `releaseDrawnEdge` (943).
- [`packages/lib/src/typescript/lib/component/chart/AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts) — the second instance of the same pattern: `createMark` (803) and `clearMarks` (827) are the create-track-append and release loops `drawRect` / `redraw` follow.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts) — the residency rules this plan composes with rather than changes; `computeResidentIds` (73) is what the simplified branch bypasses.
- [`plans/implemented/diagram-node-virtualization.md`](plans/implemented/diagram-node-virtualization.md) and [`plans/implemented/diagram-edge-virtualization.md`](plans/implemented/diagram-edge-virtualization.md) — the two culls. Both name this gap in their `## Non-Goals`, and both explain why every node component is still built and positioned.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts) and [`DiagramGroupNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts) — the components the rects stand in for, and the source of the six colour constants.
- [`packages/lib/tests/component/diagram/DiagramEdgeLayer.test.ts`](packages/lib/tests/component/diagram/DiagramEdgeLayer.test.ts) — the `RecordingDOMSink` helpers and white-box style `DiagramNodeLayer.test.ts` follows.
- [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) — the registry a new defaulted field must be added to, and the rows pinning `DiagramNode`'s exact colour strings.

---

## Non-Goals

- **Edge simplification.** `DiagramEdgeLayer` is not touched. Dropping an edge's invisible hit path while simplified (hit-testing could go geometric there too, halving the edge element count), straightening bend points, or dropping labels and markers at low zoom are all deferred to a follow-on plan named `diagram-edge-level-of-detail`.
- **A per-node choice.** The whole view is either simplified or not; there is no mixed rendering where a tall node keeps its component while a short one becomes a box.
- **Any renderer cooperation.** `DiagramNodeRenderer` keeps its `(data) => Component` signature, gains no second callback and no mode argument, and is never invoked to produce a simplified form.
- **A consumer-supplied simplified appearance** — a colour on `DiagramNodeData`, a `simpleNodeRenderer`, or a theme hook for the rect palette. The rects use the library's own node colours.
- **Tuning the thresholds.** `LOD_MIN_NODES`, `LOD_ENGAGE_HEIGHT`, and `LOD_DISENGAGE_HEIGHT` are module constants with no option, matching how `RESIDENCY_MARGIN` is fixed.
- **A `<canvas>` node layer.** SVG is what the diagram and chart components already draw through the seam, and a canvas under the content host's CSS `scale()` would have to be re-rasterised on every zoom to stay crisp.
- **Changing residency, the residency margin, or the refresh rule.** They are reused exactly as they are.
- **Hit-testing against the rects through pointer events.** Nothing is added to the rects; the geometric test is both cheaper and free of the per-element cost the change exists to remove.
- **Reporting the simplified state to consumers** — no `isSimplified()` accessor and no event.

---

## Addendum: The measured cost breakdown

Taken in the offline test harness (`installTestDOM` + `RecordingDOMSink`), against a 332-node, 331-edge synthetic graph laid out on a grid in a 1280×800 viewport, with each node carrying a glyph and a label — the shape sqladmin's Tables-mode diagram builds. Per-component figures are the marginal cost of the tenth instance, so one-time class-tier rule creation and glyph `<defs>` are excluded.

**What the culls do and do not reach.** At the initial zoom of 1, residency mounts 90 of 332 nodes and draws 111 of 331 edges. After `zoomToFit` (which resolves to zoom `0.237` for this graph), it mounts **332 of 332** and draws **331 of 331** — culling delivers nothing, by construction. Each node's box renders at 37.9 × 7.1 CSS pixels there.

**Per-node cost.**

| Representation | DOM elements | per-instance CSS rules | seam patches |
|---|---|---|---|
| `DiagramNode`, glyph + label | 8 (4 HTML, 4 SVG) | 0 | 46.8 |
| `DiagramNode`, glyph + label + badge | 10 | 0 | 71.5 |
| `DiagramNode`, bare label | 2 | 0 | 22.3 |
| `DiagramGroupNode`, glyph + label | 8 | 0 | 62.0 |
| bare `Component`, instance `backgroundColor` | 1 | 1 | 32.1 |
| bare `Component`, no styling | 1 | 0 | 33.2 |
| `<rect>` through the seam, no Component | 1 | 0 | 1 |

Two conclusions drive the design. First, **stylesheet rules are not the cost**: the default node renderer's colours are class-level defaults, so a hundred nodes share one rule and add none of their own — attacking rule count would save nothing. Second, **a cheaper Component is barely cheaper**: it removes seven elements but keeps a per-instance rule, ~32 seam patches, and a place in the content host's layout pass. Only leaving the component model behind removes all three.

**Graph totals at fit, before and after.**

| | Node elements | Node patches | Edge elements | Edge patches | Total elements |
|---|---|---|---|---|---|
| today | 2,656 | ~15,500 | 662 | 662 | 3,318 |
| with this plan | 332 | 332 | 662 | 662 | 994 |

Edges are 20% of the elements before the change and 67% after it, which is what makes edge level-of-detail a real follow-on rather than a rounding error — and what makes doing nodes first the right order.

---

## Notes

[^measured]: Reproduced offline in the test harness rather than taken on faith from the app: a 332-node graph, sized 1280×800, laid out on a grid, `zoomToFit`. `_residentIds.size` is `332` of `332` and the edge layer's `_drawn.length` is `331` of `331` — identical to the pre-cull cost. The same measurement live against sqladmin's real 325-table Tables-mode diagram found all 332 node components mounted right after "Fit to view". The user reports the two culls made the real-world flicker "a lot better" but not gone, which is consistent: the culls fixed panning at a working zoom and could not, by construction, touch the fit-zoom case. The rendered size at fit — 37.9 × 7.1 CSS pixels for a 160 × 30 box at zoom `0.237` — is what makes the fix a rendering change rather than another cull: there is nothing to omit, because everything is legitimately on screen, and nothing to read, because none of it resolves.

[^cost]: The full breakdown, including how the figures were taken, is in `## Addendum: The measured cost breakdown`. The short version: the default node renderer costs 8 DOM elements, no per-instance stylesheet rule, and ~47 seam patches per node; a bare `Component` with one instance colour costs 1 element, 1 rule, and ~32 patches; a seam-drawn `<rect>` costs 1 element, no rule, and 1 patch. Since rules are already amortised to zero by the class tier, the only two costs left to attack are elements and patches, and the rect is the only option that removes both. A third option — keeping the components mounted and hiding their contents (`setVisible(false)` on the label child, say) — was rejected outright: it leaves every element in the document, which is exactly what style recalculation, layout, and paint are proportional to.

[^layer-not-component]: Three alternatives were considered. **A cheaper `nodeRenderer`** — the view swapping in a plain `Component` factory below the threshold — keeps one Component per node in the content host's layout pass and still pays a per-instance rule and ~32 patches each, for a saving of seven elements out of eight; it also forces a decision about what happens to the consumer's own factory. **A `<canvas>`** collapses the whole node set to one element, but the content host carries a CSS `scale()` transform, so a canvas would rasterise blurry and would have to be re-drawn at the new device scale on every zoom step; the library has no canvas-drawing precedent, while `DiagramEdgeLayer` and `AbstractChart` are two instances of the SVG-through-the-seam one. **Drawing the rects into the existing `DiagramEdgeLayer`** avoids a new class but fuses two unrelated reconciliation lifetimes into one component — the edge set changes with the routes, the node set with the layout and the zoom mode — and gives up the independent z-index that keeps leaf boxes in front of the routes. There is no in-repo precedent for reduced-fidelity rendering under load anywhere else: `Table` has no such mode, and `DiagramView` is the only component in the library with a zoom concept at all. So the *policy* (simplify by rendered size) is new and is justified here; the *mechanism* is not, and follows `DiagramEdgeLayer` in every respect it can.

[^trigger]: A bare zoom threshold was rejected: zoom alone says nothing about how big a node renders, so the same number would simplify a card-based diagram whose nodes are still perfectly readable and leave a compact one unsimplified at a zoom where nothing resolves. Rendered size is the quantity the decision is actually about — "can the user read this" — and it is derivable from what the view already holds, since `_nodeRects` carries every laid-out box and `getZoom()` the scale. A count-in-viewport threshold was also rejected: at fit it is the whole graph anyway, so it degenerates to the node-count floor while being more expensive to compute. The hysteresis band is the same device `residencyNeedsRefresh` already applies on the pan axis. Without it a graph sitting exactly at the boundary would mount and unmount every node component on each wheel notch — the most expensive operation in the whole feature, triggered by the cheapest gesture. With `LOD_ENGAGE_HEIGHT = 16` and `LOD_DISENGAGE_HEIGHT = 20`, two 1.1× notches inward from just below the engage height reach 19.4 px and stay simplified; three reach 21.2 px and disengage, and coming back out takes three notches too.

[^floor]: The floor does two things. It keeps the feature confined to the regime that motivated it — a graph small enough to render cheaply gains nothing from simplification and loses its labels, so engaging there is all cost. And it makes the change provably inert for the existing test suite and for every small consumer diagram: every graph in `DiagramView.test.ts` has at most a handful of nodes, and sqladmin's Overview, schema, FK-explorer, and query-plan diagrams are all far below 200 nodes, so none of them can reach the new path at any zoom. 200 is where a fit-zoom repaint starts costing thousands of elements with the default renderer (200 × 8 = 1,600), which is the point at which the trade — labels that cannot be read anyway, in exchange for an order of magnitude fewer elements — starts being worth making.

[^one-site]: `updateResidency` runs from `applyTransformToHost` (every pan, zoom, centring, and resize-anchoring path ends there) and from `promoteIncomingNodes` (which nulls the committed rectangle first, forcing a pass). Its gate, `residencyNeedsRefresh`, opens on any change to the visible rectangle's extents — which a zoom change always produces — and on a quarter-viewport of pan travel. The trigger reads three things: the node count and the median leaf height, which change only when the graph is replaced, and the zoom. So every input changes only on a pass that already runs, and no new call site, no `doLayout` hook, and no scheduling is needed. The one deliberate extra entry point is `setSimplifyAtLowZoom`, which nulls the committed rectangle and calls the pass directly so a mid-life change takes effect without waiting for the user to move the view.

[^identity]: Comparing the two arguments by object identity is exact here rather than approximate, because both are replaced wholesale and never mutated in place: `applyLayout` fills `_incomingRects` / `_incomingContainerIds`, and `promoteIncomingNodes` hands the whole objects over and installs fresh ones. So "same object" means "same graph" with no false negatives, and the not-simplified case passes a shared `EMPTY_RECTS` constant precisely so it holds there too. The alternative — comparing 332 boxes field by field on every pass — costs more than it can ever save, and a dirty flag set from `promoteIncomingNodes` would have to be cleared on a path that also runs when the mode flips, which is two pieces of state where one comparison does.

[^press-pans]: Routing `_handlePointerDown` through the geometric test as well would refuse to pan whenever a press happened to land on one of the tiny boxes, while the cursor — which comes from the view root, since no node component is mounted to override it — still said `grab`. `DiagramView.md` states as a promise that the cursor always says what a drag will do, so the honest resolution is to let every press pan while simplified. Nothing is lost: a press that does not travel past `CLICK_SLOP` is still delivered as a `click`, `_handleClick`'s `_pointerMoved` guard still tells a click from the tail of a drag, and the click still resolves the node geometrically and selects it. The three handlers that do change are the ones with no pan semantics to preserve.

[^shared-colours]: The six colours a rect can carry are the same six its component would paint, and a simplified node that did not match its full form would make crossing the threshold look like a redraw of a different graph. `DiagramNode.ts` already holds two of them as named constants; the other four are inline in the two `_default…Options` bags, so lifting them out is a mechanical extraction that changes no rendered string — which matters, because `default-options-fallback.test.ts` asserts three of them verbatim. Restating the `var(--ts-ui-diagram-node-bg, var(--ts-ui-button-bg, rgb(245, 245, 245)))` chains inside the layer instead would put the same three-deep fallback in two files with nothing to keep them in step.

[^opt-out]: The two culls added no option, on the reasoning that a windowed rendering strategy is an internal property of the component here (`Table` exposes no switch for row or column virtualization) and that an opt-in would leave the consumer with the largest graph on the slow path until they discovered the flag. The first half of that reasoning does not carry over, because this change is *visible*: labels stop being drawn. A consumer whose node components encode meaning the library cannot see — a colour, a shape, a badge that is the whole point of the diagram — must be able to refuse it. The second half does carry over, and is why the flag defaults to `true`: an opt-out gives everyone the fix without knowing it exists, while an opt-in would give it to nobody. Threading a mode into `nodeRenderer` instead — a second argument, or a second `simpleNodeRenderer` callback — was rejected on blast radius: it changes a public type every consumer implements, it makes the cheap path a consumer's responsibility to get right (the whole saving evaporates if their "simple" node is another `Panel` subtree), and it would leave the library with no cheap rendering of its own for the default renderer, which is the case that actually needs it.

[^build-all]: Unchanged from the node-virtualization plan, and for the same two reasons. ELK needs a real size for every node, and `collectNodeSizes` reads it from each component's preferred size before anything is mounted — so the components must exist for the whole graph before layout can run at all. And `centreNode`, which backs `revealNode`, `focusNode`, and `tryInitialCentre`'s focus branch, reads its target's `getX()` / `getY()` / `getPreferredSize()`, which is what lets those work against a node that is not mounted. A component that is never added to a rendered parent never creates an element, so keeping all of them costs JS objects, not DOM. `destructor` already disposes every non-resident node component explicitly, so the simplified state — where the resident set is empty and every component is unmounted — is already covered with no change.

[^split-edges]: The numbers say nodes first. At fit on the measured graph, node components account for 2,656 of 3,318 elements and about 96% of the seam patches, against 662 elements and 662 patches for the edges — an edge is two `<path>`s built from a handful of attribute writes, with no per-instance CSS rule and no place in a layout pass, which is roughly what a node *becomes* under this plan. The mechanisms also share nothing: this plan replaces mounted components with drawn rects, while an edge treatment would change what an already-drawn SVG path contains (dropping the hit path, straightening bends, dropping labels and markers), and each of those needs its own correctness argument about hit-testing and legibility. And there is a floor under how far edges can go: the routes are what makes a fit-zoom picture worth looking at, so unlike a 7-pixel label they cannot simply be dropped. Splitting also mirrors what already happened once here, when node and edge culling were deliberately taken as two plans for the same reason.

---

## Implementation Notes

- **Two pre-existing §D assertions had to change, contrary to the plan's "no edit to any assertion" claim.** `DiagramView.test.ts`'s "mounts nothing when the first layout fails" and "a replaced graph disposes every previous node component and rebuilds residency from scratch" both asserted `_contentHost.getComponents()` against an exact array/length that implicitly assumed `_edgeLayer` was the *only* persistent content-host child. Adding `_nodeLayer` as a second persistent child (per `## Public API`'s own design — mirroring `_edgeLayer` exactly, added the line after it in the constructor) mechanically changes both: the first now expects `[_edgeLayer, _nodeLayer]` instead of `[_edgeLayer]`, the second now expects a length of 4 (two layers + two resident nodes) instead of 3, both also asserting `_nodeLayer` is present. No other §D case needed a change — every other host-membership assertion in the suite checks `toContain`/`not.toContain` against a *specific* component, which a second persistent child doesn't affect. This is a defect in the plan's own §D survey, not a sign the change is behaviour-altering in a way that matters: both are pure bookkeeping updates to what "every persistent child" now includes, not a change to virtualization, culling, or any consumer-visible behaviour.
- **Manual verification (§E) confirmed the core mechanism against the real 325-table diagram** — Fit to view on the Tables-mode diagram replaced all 332 node components with plain themed boxes, and the 7-node Overview diagram never simplified — but could not re-confirm the interactive checks (selection/double-click/right-click/drag/hysteresis on a simplified node) live: reopening the Tables-mode diagram after the first successful pass left it permanently unmounted, a pre-existing issue confirmed to reproduce identically against this plan's own parent commit (none of this plan's changes present), so unrelated to this change. Full details, including the diagnostic trail, are recorded in `/home/jika/typescript/sqladmin/LIBRARY_NOTES.md`. The interactive behaviours this blocked from live re-confirmation are covered by the offline suite's new `DiagramView — level-of-detail rendering at low zoom` block instead.
