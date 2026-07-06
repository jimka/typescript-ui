# Diagram Viewer — Implementation Plan

## Overview

Add a **read-only** graph/diagram viewer to the library: a `DiagramView` component that takes a framework-native node/edge model, runs it through [ElkJS](https://github.com/kieler/elkjs) for automatic layout, and renders themed nodes plus an SVG edge layer, with pan + zoom + node selection. ElkJS is **layout-only** (JSON graph in → the same JSON annotated with `x`/`y` on nodes and `sections`/bend-points on edges); it does no rendering, styling, or interaction, and it never touches the DOM. That boundary is what makes it fit cleanly: ELK is pure compute off to one side, and every pixel goes through the existing framework seams.

The family lives under a new component subpath `src/typescript/lib/component/diagram/` (mirroring the per-family granularity of `component/tree`, `component/table`). It ships four classes — `DiagramView` (specialized `Panel` coordinator), `DiagramNode` (default themed node renderer), `DiagramEdgeLayer` (one `<svg>` Component drawing edge paths), and an `ElkLayoutEngine` mapping/adapter module — plus the `DiagramNodeData` / `DiagramEdgeData` model interfaces. ELK is an **optional peer dependency**, dynamically `import()`-ed only when a `DiagramView` first lays out, and marked `external` in the library build so it never lands in the core bundle.

Precedents this plan leans on: [`Glyph`](src/typescript/lib/component/display/Glyph.ts#L634) for the SVG-through-the-seam pattern, [`Absolute`](src/typescript/lib/layout/Absolute.ts#L40) for placing children at pre-computed coordinates, [`Tree`](src/typescript/lib/component/tree/Tree.ts#L20) for the `"selection"` custom-event surface, [`StoreWorkerClient`](src/typescript/lib/data/StoreWorkerClient.ts#L26) for the lazy off-thread-compute idiom, and the sibling [`canvas-component.md`](plans/canvas-component.md) / [`video-player.md`](plans/video-player.md) plans for new-component structure (barrel, docs, demo, default-options registry).

---

## Architecture Decisions

### `DiagramView` is a specialized `Panel` — the compose-vs-specialize count

Run the [§"Compose before specializing"](ARCHITECTURE.md) test in both directions. A diagram viewer's substance is **coordination**, not arrangement: an async layout lifecycle (`model change → build ELK graph → await elk.layout() → place nodes + redraw edges`), a node/edge model with an ELK mapping layer, a pan/zoom viewport, and selection state with hit-testing. None of that is expressible as "these existing pieces, positioned thus." A composition (say an `HBox` of pre-built pieces) could only *relocate* the coordinator across a seam — it would still need the same state machine, plus extra wiring — so it adds code rather than deleting it. The only genuinely arrangement-shaped sub-part (placing nodes at absolute coordinates) is already owned by an existing manager (`Absolute`, below). So `DiagramView extends Panel<DiagramViewOptions>` earns its specialized class, exactly as `Tab` does. `Panel` (not bare `Container`) because we want its native-scroll machinery for pan (`setAutoScroll`, the scroll-shadow/gutter handling) — see the pan decision.

### Placement reuses the `Absolute` manager — no new `LayoutManager`, no `doLayout` override

ARCHITECTURE [§"Positioning is always absolute"](ARCHITECTURE.md) lists three escalating options (extend a manager / override `doLayout` / write a new manager). ELK output is *pure absolute coordinates*, and [`Absolute`](src/typescript/lib/layout/Absolute.ts#L40) already does exactly "place each child at the position the application has set on it, at its preferred size, without clamping, so an `autoScroll` host scrolls the overflow." So the honest answer is **the first-and-cheapest tier: reuse `Absolute`**. After `elk.layout()` returns, `DiagramView` writes each node component's coordinates via the public [`setX`](src/typescript/lib/core/Component.ts#L2922) / [`setY`](src/typescript/lib/core/Component.ts#L2955) (in the node's own coordinate space), then the `Absolute` manager re-commits them on the next layout pass. No `DiagramLayout` subclass and no `doLayout` override — either would only re-implement what `Absolute` already does, relocating complexity across a seam (the anti-pattern the guideline names). The one thing `Absolute` doesn't derive — the content-size the host must scroll — is a pure data write: `DiagramView` calls `setPreferredSize(graphW × zoom, graphH × zoom)` on the content host from the ELK-returned graph bounds. *(Rejected: a bespoke `DiagramLayout` manager whose `getPreferredSize` returns the graph bounds. It buys nothing over an explicit `setPreferredSize` and adds a class.)*

### Two-node hierarchy: scroll viewport (`DiagramView`) wraps a transform content host

`DiagramView` (the `Panel`, `autoScroll: "auto"`) is the scroll viewport. Its single child is a **content host** `Container` (`Absolute` layout) that holds the node components + the edge layer and carries the zoom transform. This split is required: pan is native scroll on the viewport, and zoom is a CSS `transform: scale(z)` that must live on the *scrolled content*, not the scroll container, so the scrollable extent reflects the zoomed size. The content host is *mostly arrangement* (a `Container` + `Absolute`, no behaviour of its own — `DiagramView` drives its size/transform), so per compose-before-specialize it stays a plain `Container`, **not** a new class. Node coordinates are written **unscaled** (raw ELK values); the host's box is sized to `graphBounds × zoom` and `transform: scale(z)` with `transform-origin: 0 0` scales the unscaled children to fill it — so the outer `Panel` sees a correctly-sized oversized child and scrolls it. Zoom uses the existing [`Component.setTransform`](src/typescript/lib/core/Component.ts#L2186) (options-bag-cached, no new setter).

### ELK is off-seam pure compute, lazily imported, externalized from the bundle

ELK takes JSON and returns JSON — it never reads or writes the DOM, so it does **not** go through `DOM.sink`/`DOM.source` and needs no seam extension (unlike `Canvas`/`VideoPlayer`, which added seam methods). It is an **optional peer dependency**: `peerDependencies.elkjs` + `peerDependenciesMeta.elkjs.optional = true`, plus `devDependencies.elkjs` so the demo app runs. `DiagramView` imports it lazily the first time it lays out — `const { default: ELK } = await import("elkjs/lib/elk.bundled.js")` — inside the `ElkLayoutEngine` adapter, mirroring [`StoreWorkerClient.ensureWorker`](src/typescript/lib/data/StoreWorkerClient.ts#L30)'s lazy-singleton-with-graceful-fallback idiom. Consumers who never mount a `DiagramView` pull in zero ELK bytes. The concrete build change: `vite.lib.config.ts` currently has **no** `rollupOptions.external`, so a bare dependency would be code-split into `dist/`. Add `external: [/^elkjs(\/|$)/]` so the dynamic `import("elkjs/...")` survives verbatim in the output for the consumer to resolve (documented under Potential Challenges — the sink/source seam is untouched, so this is the only place ELK is special-cased).

### Main-thread bundled build by default; worker is opt-in

ELK ships a main-thread build (`elk.bundled.js`) and a worker build (`elk-worker.js` + `new ELK({ workerUrl })`). The worker path does **not** complicate our DOM seam (ELK's worker is a compute worker it constructs itself from a URL — it never crosses `DOM.sink`/`DOM.source`), but it *does* complicate bundling and consumer setup: `workerUrl` must resolve to a consumer-hosted asset, which is fragile for an externalized optional peer dep. So the default is the **main-thread `elk.bundled.js`** for zero-config consumption; layout is still async (ELK returns a `Promise`), so there is a clean `await` boundary, though the GWT compute runs on the main thread. `DiagramView` exposes an optional `elkWorkerUrl?: string` that, when set, is forwarded to `new ELK({ workerUrl })` so consumers who want off-thread layout opt in with their own hosted worker script. This keeps the frictionless path default and the worker path available.

### Node API designed for swappable content; phase 1 ships one default renderer

`DiagramNodeData` (the model) is engine-agnostic and carries a `label` + optional `glyph`. `DiagramView` builds node components through a `nodeRenderer?: (data: DiagramNodeData) => Component` factory option; the default factory constructs a `DiagramNode`. Phase 1 ships only the default `DiagramNode` (a themed shape + `IconText`-style glyph/label). Because node components are produced through the factory and consumed only via `Component` + `getPreferredSize()`, a future arbitrary-Component renderer slots in with **no breaking change** — the extension seam exists from day one but is not built out. (This mirrors `Tree`'s `TreeNodeRenderer` seam.)

### Selection is a framework-custom `"selection"` event; pan/zoom are DOM-routed

Per ARCHITECTURE [§"Event handling"](ARCHITECTURE.md)'s two-surface split:
- **Selection** doesn't originate as a DOM event (it's a semantic state change) → the typed `on`/`off`/`emit` + `ListenerBag<DiagramViewEvent>` surface with a `"selection"` union member, copied structurally from [`Tree`](src/typescript/lib/component/tree/Tree.ts#L20) (union at L20, bag at L100, `on` overloads at L345, `emit` overloads at L414). The click that *drives* selection is a DOM event caught with `Event.addSubtreeListener(this, "click", this._handleNodeClick)` — the exact pattern [`Tree`](src/typescript/lib/component/tree/Tree.ts#L1090) uses to delegate child clicks to itself (self-listening, never reaching into a node's event surface).
- **Pan/zoom** originate as DOM `wheel` / `pointer*` events → the `Event` class, `Event.addListener(this, "wheel", this._handleWheel)` / `pointerdown`/`pointermove`/`pointerup`, all **named handler methods** (never inline arrows). Pan writes the viewport's cached scroll offsets via [`setScrollLeft`/`setScrollTop`](src/typescript/lib/core/Component.ts#L3004); zoom writes the content host's `setTransform` + recomputes its scaled size. Construction-time listener wiring uses the closed `listeners` bag dispatched by `applyListeners` from the **constructor body** (after `super()`), per the ARCHITECTURE listeners-bag rule.

### Edge layer: one `<svg>` Component, raw NS children through the seam

`DiagramEdgeLayer extends Component` owns exactly one element — an `<svg>` — created by overriding `createRootElement` to call [`DOM.sink.createElementNS(svgNs, "svg")`](src/typescript/lib/core/DOM.ts#L517), verbatim the [`Glyph`](src/typescript/lib/component/display/Glyph.ts#L634) pattern. Edge `<path>`/`<polyline>` and `<marker>` arrowheads are non-interactive leaf children created through the seam (`createElementNS` + `DOM.sink.apply(h, { setAttr })` + `DOM.sink.appendChild` + `this.trackHandle`), exactly as `Glyph` creates its `<use>` child (Glyph.ts [L640-L649](src/typescript/lib/component/display/Glyph.ts#L640)). Per one-element-per-class these leaves are acceptable raw children (like the resize-handle carve-out). Redraw on layout change clears and rebuilds the children from the ELK edge `sections`. All coordinate/colour writes go through `StyleRule`/`setAttr`, never raw `.style`.

---

## Public API

New subpath `@jimka/typescript-ui/component/diagram`. All components wrapped with `callable()` and exported under the callable name ([ARCHITECTURE.md §"Components are exported through callable()"](ARCHITECTURE.md)).

### Model interfaces — `component/diagram/DiagramModel.ts`

```typescript
/** A node in the framework-native graph model (maps to an ELK node). */
export interface DiagramNodeData {
    id:      string;
    label?:  string;
    glyph?:  string;                       // registered Glyph name
    width?:  number;                       // overrides renderer preferred width fed to ELK
    height?: number;
    layoutOptions?: Record<string, string>; // per-node ELK options (passthrough)
}

/** An edge (maps to an ELK edge with single source/target). */
export interface DiagramEdgeData {
    id:     string;
    source: string;                        // source node id
    target: string;                        // target node id
    label?: string;
}

/** The whole graph plus optional graph-level ELK layout options. */
export interface DiagramData {
    nodes: DiagramNodeData[];
    edges: DiagramEdgeData[];
    layoutOptions?: Record<string, string>; // e.g. { "elk.algorithm": "layered", "elk.direction": "RIGHT" }
}
```

### `DiagramView` — the coordinator (`component/diagram/DiagramView.ts`)

```typescript
export type DiagramNodeRenderer = (data: DiagramNodeData) => Component;
export type DiagramViewEvent = "selection" | "layout";

export interface DiagramViewOptions extends PanelOptions {
    data?:          DiagramData;
    nodeRenderer?:  DiagramNodeRenderer;   // default builds DiagramNode
    layoutOptions?: Record<string, string>; // default ELK options for every layout
    elkWorkerUrl?:  string;                // opt-in off-thread ELK
    minZoom?:       number;                // default 0.25
    maxZoom?:       number;                // default 4
    zoom?:          number;                // initial zoom, default 1
    listeners?: {
        selection?: (nodes: DiagramNodeData[]) => void;
        layout?:    () => void;            // fires after each successful ELK pass
    };
}

class DiagramView extends Panel<DiagramViewOptions> {
    constructor(options?: DiagramViewOptions);

    setData(data: DiagramData): this;      // rebuilds nodes/edges, triggers async layout
    getData(): DiagramData | null;

    getZoom(): number;                     // cache = _options.zoom (folding getter, default 1)
    setZoom(zoom: number): this;           // clamped [minZoom, maxZoom]; writes host transform + size
    zoomToFit(): this;                     // fit graph bounds to viewport (manual-verify)

    getSelection(): DiagramNodeData[];
    selectNode(id: string | null): this;   // programmatic; does NOT emit (Tree.selectNode precedent)

    on(event: "selection", listener: (nodes: DiagramNodeData[]) => void): this;
    on(event: "layout",    listener: () => void): this;
    off(event: DiagramViewEvent, listener: Function): this;
    protected emit(event: "selection", nodes: DiagramNodeData[]): void;
    protected emit(event: "layout"): void;
}
```

State-bearing property routing (per [ARCHITECTURE.md §"Three non-negotiable rules"](ARCHITECTURE.md)):

| Property | Setter/Getter | Cache | On `XOptions`? |
|---|---|---|---|
| `zoom` | `setZoom`/`getZoom` | `_options.zoom` (folding getter → `?? _defaultOptions.zoom ?? 1`) | yes |
| `data` | `setData`/`getData` | `_options.data` | yes |
| `nodeRenderer` | (option-only, read in `setData`) | `_options.nodeRenderer` | yes |
| `_selection` | `getSelection`/`selectNode` | private field (runtime state) | **no** |
| `_nodeComponents` | — | private `Map<string, Component>` (runtime) | **no** |
| `_engine` | — | private `ElkLayoutEngine` (runtime) | **no** |

`zoom` is class-defaulted → it needs a **folding getter** and a row in the default-options-fallback registry (the "class-level defaults must survive the getter" trap). `_selection` / `_nodeComponents` / `_engine` are framework-managed runtime state → private fields, off the options bag.

### `DiagramNode` — default node renderer (`component/diagram/DiagramNode.ts`)

```typescript
export interface DiagramNodeOptions extends PanelOptions {
    label?:    string;
    glyph?:    string;
    selected?: boolean;
}

class DiagramNode extends Panel<DiagramNodeOptions> {
    constructor(options?: DiagramNodeOptions);
    setSelected(v: boolean): this;   isSelected(): boolean;   // toggles a themed .selected state rule
    setLabel(v: string): this;       getLabel(): string | null;
}
```

Themed shape via theme tokens (background / border / radius through `StyleRule`, same token vocabulary as other components); composes an `IconText`/glyph+label inside. Its `getPreferredSize()` (derived by its layout manager from the label+glyph) is what `DiagramView` reads to size the ELK node when `DiagramNodeData.width/height` are absent.

### `DiagramEdgeLayer` — SVG edge layer (`component/diagram/DiagramEdgeLayer.ts`)

```typescript
class DiagramEdgeLayer extends Component<ComponentOptions> {
    /** Rebuilds all edge paths + arrowheads from ELK edge sections. */
    setEdges(edges: ElkEdgeRoute[]): this;   // ElkEdgeRoute = { id, sections, bendPoints }
    protected createRootElement(): Handle;    // <svg> via DOM.sink.createElementNS
}
```

### `ElkLayoutEngine` — mapping/adapter (`component/diagram/ElkLayoutEngine.ts`)

```typescript
export interface DiagramLayoutResult {
    nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>;
    edges: Array<{ id: string; sections: ElkEdgeSection[] }>;
    width: number; height: number;          // graph bounding box
}

export class ElkLayoutEngine {
    constructor(workerUrl?: string);
    /** Lazily imports ELK, maps model → ELK JSON, runs layout, maps result back. */
    layout(data: DiagramData, sizes: Map<string, { width: number; height: number }>,
           defaults?: Record<string, string>): Promise<DiagramLayoutResult>;
}
```

The adapter is the **only** module that names ELK types or imports `elkjs`; everything else speaks `DiagramData` / `DiagramLayoutResult`, keeping the engine swappable.

---

## Internal Structure

**Async layout lifecycle** (`DiagramView.setData` / initial render):

```
setData(data):
  1. tear down old node components + clear edge layer + selection
  2. build node components via nodeRenderer (default → new DiagramNode), add to content host
  3. collect each node's size: data.width/height ?? nodeComponent.getPreferredSize()
  4. this._engine.layout(data, sizes, mergedLayoutOptions).then(applyLayout)   // named method
applyLayout(result):
  5. for each node: nodeComponent.setX(result.nodes[i].x); setY(...)
  6. content host.setPreferredSize(result.width * zoom, result.height * zoom); host.setTransform(`scale(${zoom})`)
  7. edgeLayer.setPreferredSize(result.width, result.height); edgeLayer.setEdges(result.edges)
  8. this.scheduleLayout()   // Absolute re-commits nodes at their new x/y; Panel scrolls overflow
  9. this.emit("layout")
```

Because layout is a `Promise`, `applyLayout` is a **named method** passed to `.then` (a generation token guards against a stale in-flight layout landing after a newer `setData`, mirroring `Canvas`'s `_dprToken`).

**Zoom** (`setZoom`): clamp to `[minZoom, maxZoom]`; write `contentHost.setTransform("scale(z)")` and `contentHost.setPreferredSize(graphW*z, graphH*z)` (cached graph bounds from the last result); `scheduleLayout()`. Wheel zoom keeps the pointer anchored by adjusting scroll offsets after the scale — computed from the cached scroll + pointer position (hit-testing math below).

**Coordinate/hit-testing math** (the transform gotcha, resolved): a screen point maps to graph space as `graph = (screen − viewportOrigin + scroll) / zoom`. Node placement is unscaled and the transform does the scaling, so this single division is the whole mapping. Node-click selection uses `event.target` identity (which node component's element was hit) rather than coordinate math, so hit-testing needs no manual geometry — the browser resolves it through the transform. Only wheel-anchored zoom needs the division, and it reads cached scroll (`getScrollLeft`/`getScrollTop`) not live geometry.

**Selection**: `_handleNodeClick(event)` walks from `event.target` to the owning node id (via a `data-node-id` set through a typed attribute setter, or a `Map` from element handle), updates `_selection`, toggles each node's `setSelected`, and `emit("selection", …)`.

---

## Ordered Implementation Steps

1. **Model module** — create `component/diagram/DiagramModel.ts` with `DiagramNodeData` / `DiagramEdgeData` / `DiagramData`. → verify: `tsc` clean.
2. **ELK adapter** — create `component/diagram/ElkLayoutEngine.ts`: lazy `await import("elkjs/lib/elk.bundled.js")` (singleton per instance), model→ELK-JSON mapping, `elk.layout()`, result→`DiagramLayoutResult` mapping; optional `workerUrl`. Add a local ambient `declare module "elkjs/lib/elk.bundled.js"` type shim (or `@ts-ignore` on the import, as `StoreWorkerClient` does at [L14](src/typescript/lib/data/StoreWorkerClient.ts#L14)) since `elkjs` is not a hard dep. → verify: `tsc` clean; `grep -n 'import("elkjs' src/…/ElkLayoutEngine.ts`.
3. **`DiagramEdgeLayer`** — `<svg>` via `createRootElement` (Glyph pattern); `setEdges` builds `<path>`/`<marker>` through the seam + `trackHandle`; `callable()` export. → verify: `tsc`; lint (`no-raw-dom`) clean — only `createElementNS`/`setAttr`/`appendChild` seam calls.
4. **`DiagramNode`** — themed `Panel` subclass composing glyph+label; `setSelected` state rule; `getPreferredSize` from content; option→setter routing; `callable()` export. → verify: `tsc`; default-options registry row if it defaults a folding field.
5. **`DiagramView`** — `Panel` subclass: content-host `Container` (`Absolute`) as single child; `setData`/`applyLayout` lifecycle with generation token; `Absolute` node placement; `setZoom`/`zoomToFit`; `_engine` wiring; `wheel`/`pointer` pan+zoom handlers via `Event.addListener`; `"selection"`/`"layout"` `ListenerBag` + `on`/`off`/`emit`; `listeners`-bag `applyListeners` in constructor body; `setAutoScroll("auto")` default. → verify: `tsc`; unit tests (Expected Behaviour).
6. **Barrel** — `component/diagram/index.ts` exporting the four classes + `*Options` + model types (Tree-barrel shape). → verify: `grep -n DiagramView src/…/diagram/index.ts`.
7. **Subpath registration** (the known subpath gotcha — five sites): `package.json` `exports["./component/diagram"]`; `vite.lib.config.ts` `lib.entry["component/diagram"]`; `tsconfig.json` `paths["@jimka/typescript-ui/component/diagram"]`; `typedoc.json` `entryPoints`; **and** add `rollupOptions.external: [/^elkjs(\/|$)/]` to `vite.lib.config.ts`. → verify: `npm run build:lib` emits `dist/lib/component/diagram.es.js` and the ELK dynamic import is **not** inlined (`grep -c elkjs dist/lib/component/diagram.es.js` shows the bare specifier, not bundled source).
8. **peerDependency** — `package.json`: `peerDependencies.elkjs`, `peerDependenciesMeta.elkjs.optional=true`, `devDependencies.elkjs`; `npm install`. → verify: `npm ls elkjs`.
9. **Unit tests** — `tests/component/diagram/*.test.ts` per Expected Behaviour (mapping, model round-trip, selection state, option routing) with a stub engine. → verify: `npm test`.
10. **Docs** — see Documentation Impact. → verify: `npm run docs:build` zero warnings.
11. **Demo panel** — create `src/typescript/DiagramPanel.ts` and register it in `main.ts` via `addLazyTab` ([main.ts L36-L60](src/typescript/main.ts#L39)). → verify: `npm run dev`, open the `Diagram` tab at `http://localhost:8015`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/diagram/DiagramModel.ts` |
| Create | `src/typescript/lib/component/diagram/ElkLayoutEngine.ts` |
| Create | `src/typescript/lib/component/diagram/DiagramEdgeLayer.ts` |
| Create | `src/typescript/lib/component/diagram/DiagramNode.ts` |
| Create | `src/typescript/lib/component/diagram/DiagramView.ts` |
| Create | `src/typescript/lib/component/diagram/index.ts` |
| Modify | `package.json` (exports subpath, peer/optional/dev `elkjs`) |
| Modify | `vite.lib.config.ts` (entry + `rollupOptions.external` for elkjs) |
| Modify | `tsconfig.json` (paths entry) |
| Modify | `typedoc.json` (entryPoints) |
| Create | `tests/component/diagram/DiagramView.test.ts` |
| Create | `tests/component/diagram/ElkLayoutEngine.test.ts` |
| Modify | `tests/component/default-options-fallback.test.ts` (rows for defaulted folding fields, e.g. `zoom`) |
| Create | `src/typescript/DiagramPanel.ts` (demo) |
| Modify | `src/typescript/main.ts` (register demo tab) |
| Create | `docs/components/DiagramView.md` |
| Modify | `docs/components/index.md` (catalog row) |
| Modify | `docs/.vitepress/config.mts` (sidebar group) |

---

## Expected Behaviour

**Unit-testable** (offline; inject a stub `ElkLayoutEngine` returning a fixed `DiagramLayoutResult`, so no real ELK/`await import` is exercised — the modelled sink records DOM writes):

- **U1 — model→ELK mapping.** `ElkLayoutEngine` maps `DiagramNodeData` → `{ id, width, height, layoutOptions }` and `DiagramEdgeData{source,target}` → ELK `{ sources:[source], targets:[target] }`; graph `layoutOptions` merge (per-node wins over graph wins over defaults). Test the pure mapping function directly (no `import()`).
- **U2 — result→coords.** Given a stub result, `applyLayout` calls `setX`/`setY` on each node component with the mapped coordinates (assert via cached `getX`/`getY`), and sizes the content host to `graphBounds × zoom`.
- **U3 — node sizing input.** When `DiagramNodeData.width/height` are set they feed ELK; when absent, the node component's `getPreferredSize()` value is used.
- **U4 — selection state + event.** A synthesized node click updates `getSelection()`, toggles the clicked `DiagramNode.isSelected()`, and fires `"selection"` with the node data; `selectNode(id)` updates state **without** emitting (Tree precedent); `selectNode(null)` clears.
- **U5 — zoom clamp + transform.** `setZoom(10)` clamps to `maxZoom`; `setZoom(0)` clamps to `minZoom`; the content host `getTransform()` reads `scale(z)` and its preferred size scales with `z`.
- **U6 — zoom default survives the getter.** `new DiagramView().getZoom() === 1` (folding-getter trap) — covered by the default-options-fallback registry row.
- **U7 — stale-layout guard.** Two `setData` calls in flight: the older `applyLayout` (older generation token) is a no-op; only the newer result is applied.
- **U8 — edge routing.** `DiagramEdgeLayer.setEdges(sections)` records the expected number of `<path>` `createElementNS` + `setAttr` seam calls on the recording sink; a re-`setEdges` clears prior path handles first (no leak).
- **U9 — option→setter routing.** Every `DiagramViewOptions` field reaches its setter; `listeners` bag members (`selection`, `layout`) are wired via `applyListeners`.
- **U10 — graceful ELK-absent.** With `elkjs` unavailable (stub import throws), `setData` rejects/handles without throwing synchronously and the view stays empty (mirrors `StoreWorkerClient` fallback).

**Manual-verify** (offline harness can't exercise real ELK layout, transforms, native scroll, wheel/pointer, or paint):

- **M1 — static render.** A fixed graph lays out and renders themed nodes + drawn edges with arrowheads on the demo tab.
- **M2 — pan.** Drag / trackpad / scrollbar pans the diagram (native scroll); no focus-scroll pollution.
- **M3 — zoom.** Wheel (or ctrl+wheel) zoom scales crisply about the pointer; scrollable extent grows/shrinks with zoom; `zoomToFit` frames the whole graph.
- **M4 — selection.** Clicking a node highlights it (themed `.selected`) and fires `"selection"`; clicking empty space clears.
- **M5 — data change re-layout.** `setData` with a new graph re-runs ELK and re-renders without stale nodes/edges.
- **M6 — theming.** Node shape/label and edge stroke honour the active theme (toggle Classic/Dark/Modern in the demo).
- **M7 — bundle exclusion.** Building the lib and a diagram-free consumer confirms `elkjs` bytes are absent unless a `DiagramView` mounts (network tab shows ELK chunk loading lazily on first mount).

---

## Verification

- **Typecheck / build:** `npm run typecheck` and `npm run build:lib` clean; `dist/lib/component/diagram.es.js` emitted with the ELK import left external (`grep elkjs dist/lib/component/diagram.es.js` shows the bare specifier, not GWT source).
- **Lint:** `npm run lint` clean; the edge layer adds **zero** `no-raw-dom` findings (only `createElementNS`/`setAttr`/`appendChild` seam calls), no baseline edit.
- **Unit tests:** U1–U10 via `npm test` with a stub engine; `tests/component/default-options-fallback.test.ts` passes with the new rows.
- **Docs:** `npm run docs:build` finishes with **zero** warnings (only `{@link}` public symbols per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- **Manual smoke (live):** `npm run dev` → `http://localhost:8015`, open the **Diagram** tab; verify M1–M7. Scope DevTools queries to `.DiagramView` (many components coexist per the DevTools-scoping memory).

---

## Documentation Impact

- **Barrel / subpath:** the family is exported from the new `component/diagram` barrel. This introduces a **new directory subpath**, which per the [subpath-barrel-resolution gotcha](ARCHITECTURE.md) needs explicit entries in **all five** of: `package.json` `exports`, `vite.lib.config.ts` `lib.entry`, `tsconfig.json` `paths`, `typedoc.json` `entryPoints`, and the docs sidebar — a wildcard is not enough. Enumerated in Step 7.
- **TypeDoc:** add `src/typescript/lib/component/diagram/index.ts` to `typedoc.json` `entryPoints` (alongside the `tree`/`table` entries at [typedoc.json L16-L17](typedoc.json#L16)); JSDoc every exported symbol, `{@link}` only public symbols.
- **Guide page:** create `docs/components/DiagramView.md` (Usage: `DiagramView({ data })`, model shape, `setZoom`/`zoomToFit`, `on("selection")`; a Notes section on read-only scope, the optional-peer-dep install (`npm i elkjs`), and the `elkWorkerUrl` opt-in). Add a `Diagram` group to [docs/.vitepress/config.mts](docs/.vitepress/config.mts#L140) near the Tree/Table groups, and a catalog row in `docs/components/index.md`. API cross-links use the `[X](/api/component/diagram/classes/X)` form.

---

## Potential Challenges

- **Zoom transform vs. absolute-layout containing block.** A `transform` on the content host makes it the containing block for its absolute children — which is exactly what we want (nodes are positioned relative to the host), and ARCHITECTURE forbids `position: relative/sticky`, not `transform`. Mitigation: keep nodes at **unscaled** coords and let the single `scale()` do all scaling; size the host box to `graphBounds × zoom` so native scroll extent stays correct; map screen→graph with one `/zoom` division; use `event.target` identity for hit-testing so no manual geometry is needed.
- **ELK import must stay external.** Without `rollupOptions.external`, Rollup inlines the hundreds-of-KB GWT blob into `dist/`. Mitigation: the `external: [/^elkjs/]` regex (Step 7) + the `grep` bundle check in Verification.
- **`elkjs` has no bundled types visible to `tsc`.** As an optional dep it may be absent at typecheck. Mitigation: an ambient `declare module` shim or the `@ts-ignore` idiom `StoreWorkerClient` already uses ([L14](src/typescript/lib/data/StoreWorkerClient.ts#L14)); confine all ELK typing to `ElkLayoutEngine.ts`.
- **Stale async layout.** A fast second `setData` can let an older `elk.layout()` resolve last and clobber the newer render. Mitigation: a monotonic generation token gate in `applyLayout` (Canvas `_dprToken` precedent).
- **Node sizing before render.** ELK needs node width/height up front; a content-derived `getPreferredSize()` may need text measurement. Mitigation: prefer explicit `DiagramNodeData.width/height`; otherwise read `getPreferredSize()` (the framework's modelled text metrics work offline), falling back to a default node size.
- **Worker path fragility.** `elkWorkerUrl` requires a consumer-hosted `elk-worker.js`. Mitigation: default to the main-thread build; document the opt-in and that the consumer must serve the worker asset.
- **Edge redraw leaks.** Re-`setEdges` must release prior `<path>` handles (tracked via `trackHandle`) before rebuilding. Mitigation: clear-then-build, asserted by U8.

---

## Critical Files

- [src/typescript/lib/component/display/Glyph.ts](src/typescript/lib/component/display/Glyph.ts#L634) — `createRootElement` SVG-through-the-seam (`createElementNS`, `setAttr`, `appendChild`, `trackHandle`) — the edge-layer template.
- [src/typescript/lib/layout/Absolute.ts](src/typescript/lib/layout/Absolute.ts#L40) — places children at app-set `getX`/`getY` without clamp; the node-placement manager.
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `setX` (L2922) / `setY` (L2955); scroll cache `getScrollLeft`/`setScrollLeft` (L2981-L3011); `setTransform` (L2186); `getPreferredSize`/`setPreferredSize`.
- [src/typescript/lib/core/Panel.ts](src/typescript/lib/core/Panel.ts#L117) — base coordinator; `setAutoScroll` (L220), `doLayout` (L361), `clampsToContentSize`=false (per ARCHITECTURE) — the scroll/pan machinery.
- [src/typescript/lib/component/tree/Tree.ts](src/typescript/lib/component/tree/Tree.ts#L20) — `"selection"` `XEvent` union (L20), `ListenerBag` (L100), `on`/`emit` overloads (L345/L414), `Event.addSubtreeListener(this,"click",…)` (L1090); the selection-event + click-delegation template.
- [src/typescript/lib/data/StoreWorkerClient.ts](src/typescript/lib/data/StoreWorkerClient.ts#L26) — lazy-singleton off-thread compute with graceful fallback + the `@ts-ignore` non-typed-import idiom.
- [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts#L507) — `createElement` (L507/L1230), `createElementNS` (L517/L1235) seam; ELK needs **no** seam addition.
- [src/typescript/lib/layout/LayoutManager.ts](src/typescript/lib/layout/LayoutManager.ts#L453) — `commitBounds` (L453) proves layout drives `setWidth`+`setHeight`+`doLayout`.
- `vite.lib.config.ts` / `package.json` / `tsconfig.json` / `typedoc.json` — the five subpath-registration sites + the new `external` array.
- [plans/canvas-component.md](plans/canvas-component.md) / [plans/video-player.md](plans/video-player.md) — new-component structure, default-options registry, docs/demo conventions.

---

## Non-Goals

- **Interactive editing.** No node dragging, no in-place label/shape editing, no edge drawing/reconnection, no add/delete gestures. The API (node factory, model, `Absolute` placement) is shaped so a future edit layer can be added without breaking changes, but none of it is built here — ELK lays out once per data change and the view is read-only.
- **Arbitrary-Component node content.** Phase 1 ships only the default `DiagramNode` renderer. The `nodeRenderer` factory is the extension seam for custom-Component nodes later; wiring rich content (and its ELK sizing) is out of scope now.
- **Edge selection / edge labels routing polish.** Selection targets nodes only; edge hit-testing and label placement beyond ELK's own routing are deferred.
- **Nested/compound graphs, ports, hierarchical expand-collapse.** ELK supports children/ports; the model reserves `layoutOptions` passthrough but phase 1 renders a flat graph.
- **Bundling ELK into core.** ELK is never in the core bundle — optional peer dep, lazily imported, externalized. Shipping a vendored ELK is out of scope.
- **A headless/offline layout model.** Real `elk.layout()` runs only live; unit tests use a stub engine. Making ELK layout deterministic offline is out of scope.
