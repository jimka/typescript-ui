# DiagramView

[`DiagramView`](/api/component/diagram/classes/DiagramView) is a **read-only** graph/diagram viewer. You give it a framework-native node/edge model; it runs the graph through [ElkJS](https://github.com/kieler/elkjs) for automatic layout, renders themed nodes plus an SVG edge layer with arrowheads, and supports free (unbounded) pan, zoom, and node selection. ELK is layout-only — it takes JSON and returns the same JSON annotated with coordinates; every pixel is drawn through the framework's own component and DOM seams.

## Installation

ELK is an **optional peer dependency**, so install it alongside the library when you use a diagram:

```bash
npm install elkjs
```

Consumers who never mount a `DiagramView` pull in zero ELK bytes — it is lazily imported the first time a diagram lays out and kept out of the core bundle.

## Usage

```typescript
import { DiagramView } from '@jimka/typescript-ui/component/diagram';

const view = DiagramView({
    data: {
        nodes: [
            { id: 'start',   label: 'Start',   glyph: 'circle-play' },
            { id: 'process', label: 'Process', glyph: 'gears'       },
            { id: 'done',    label: 'Done'                          },
        ],
        edges: [
            { id: 'e1', source: 'start',   target: 'process' },
            { id: 'e2', source: 'process', target: 'done'    },
        ],
        layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
    },
});

view.on('selection', (nodes) => console.log('selected', nodes));

panel.addComponent(view);
```

The model is three plain interfaces — [`DiagramNodeData`](/api/component/diagram/interfaces/DiagramNodeData), [`DiagramEdgeData`](/api/component/diagram/interfaces/DiagramEdgeData), and [`DiagramData`](/api/component/diagram/interfaces/DiagramData). A node's size fed to ELK is its explicit `width`/`height` when given, else the node component's preferred size. `layoutOptions` (per-node and graph-level) pass straight through to ELK. A node's optional `badge` is a short marker the default renderer draws after the label, for annotations such as "N neighbours not shown".

## Edge style

An edge's optional `style` ([`DiagramEdgeStyle`](/api/component/diagram/interfaces/DiagramEdgeStyle)) draws crow's-foot cardinality markers, a dashed stroke, a themed stroke override, and a mid-edge label — additive over the default plain, single-arrowhead edge:

```typescript
edges: [
    // Default: a plain arrow at the target end, no style needed.
    { id: 'e1', source: 'start', target: 'process' },
    // 1:N mandatory-at-the-many-end, e.g. an FK backed by a NOT NULL column
    // with no unique constraint: a crow's foot at the child, a bar at the parent.
    { id: 'e2', source: 'process', target: 'store', style: { startMarker: 'oneOrMany', endMarker: 'one' } },
]
```

`startMarker` / `endMarker` are each a [`DiagramEdgeMarker`](/api/component/diagram/type-aliases/DiagramEdgeMarker): `"arrow"` (the default arrowhead), `"one"` (mandatory-one, two bars), `"zeroOrOne"` (optional-one, a bar plus a circle), `"oneOrMany"` (mandatory-many, a crow's foot plus a bar), or `"zeroOrMany"` (optional-many, a crow's foot plus a circle). `dashed` switches the stroke to a dash pattern; `stroke` overrides the themed edge colour (e.g. a warning tint); `label` renders centred on the route. Every marker is defined once per `DiagramEdgeLayer` instance and reused at both ends via `orient="auto-start-reverse"`, so the same marker id reads correctly whether it is a `startMarker` or `endMarker`.

Edge emphasis (`setEdgeEmphasis`) is a *view-level* concern layered over `DiagramEdgeStyle`: it dims every edge outside the given set rather than restyling anything, so a consumer's own `stroke` / marker choices on the emphasised edges are preserved unchanged. Node emphasis (`setNodeEmphasis`) is the same kind of view-level dimming, applied as opacity directly on each node component's own root, so a custom `nodeRenderer` needs no cooperation to support it.

The dimming lives on a group, not on each dimmed edge: `DiagramEdgeLayer` keeps two `<g>` children and redraws each edge into whichever one matches its emphasis state. That matters wherever routes coincide — per-element alpha composites at an overlap, so two dimmed hairlines would resolve to a stronger line than one, and a bundle of overlapping routes would read as emphasised exactly where it was densest. Group opacity composites the whole group once instead. The full-strength group is painted second, so an emphasised edge always draws over a dimmed edge it crosses.

`EDGE_MARKER_EXTENT` is how far, in unscaled graph units, the longest end marker reaches back along an edge from the point it attaches to. Anything a consumer places on a route within that distance of an endpoint sits underneath the marker glyph rather than beside it — so a consumer that rewrites routes (to branch a bundle away from a node, say) should keep clear of it.

## Ports

A node's optional `ports` ([`DiagramPortData`](/api/component/diagram/interfaces/DiagramPortData)) let an edge attach to a fixed anchor on the node instead of the node as a whole — e.g. a per-row anchor on a card-shaped node, so a relationship edge can run row-to-row:

```typescript
nodes: [
    { id: 'a', width: 200, height: 80, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [{ id: 'a::x::out', x: 199, y: 30, width: 1, height: 1, side: 'EAST' }] },
    { id: 'b', width: 200, height: 40, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [{ id: 'b::id::in', x: 0, y: 20, width: 1, height: 1, side: 'WEST' }] },
],
edges: [
    { id: 'e', source: 'a', target: 'b', sourcePort: 'a::x::out', targetPort: 'b::id::in' },
],
```

Each port carries a stable `id` (referenced by an edge's `sourcePort` / `targetPort`), an optional `side` hint, and — to pin it at an exact coordinate rather than let ELK spread ports along a side — an explicit `x`/`y` relative to the node's top-left. Pinning requires the node to also set `layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }`. An edge with no `sourcePort`/`targetPort` anchors to the node as a whole, unchanged from today's behaviour. Ports are inert until an edge references one — omit them entirely for a plain node-to-node graph.

## Compound and container nodes

A node's optional `children` ([`DiagramNodeData.children`](/api/component/diagram/interfaces/DiagramNodeData)) groups a set of nodes inside a labelled container box — e.g. clustering a database's tables into one box per schema:

```typescript
nodes: [
    {
        id: 'schema:public', label: 'public',
        children: [
            { id: 'public.users',  label: 'users',  glyph: 'table' },
            { id: 'public.orders', label: 'orders', glyph: 'table' },
        ],
    },
],
edges: [
    { id: 'e', source: 'public.users', target: 'public.orders' },
],
```

A node with a non-empty `children` is a *container*: ELK computes its size and position from its contents, so a container never carries an explicit `width`/`height`. Edges are still declared flat at the graph's top level (as always) and may cross container boundaries — `buildElkGraph` sets `elk.hierarchyHandling: 'INCLUDE_CHILDREN'` on the root so ELK routes them correctly; override it via `layoutOptions` if a graph needs `SEPARATE_CHILDREN` instead. A container renders via the `groupRenderer` factory (default: [`DiagramGroupNode`](/api/component/diagram/classes/DiagramGroupNode), a titled translucent box); its children render through the normal `nodeRenderer` path as flat siblings — not DOM children — of the container, so clicking, selecting, and `nodeIdAt` hit-testing all resolve to the leaf even though it sits visually inside its box. A graph with no `children` anywhere is unaffected: no container is built and paint order is untouched.

## Common methods

| Method | Purpose |
| --- | --- |
| `setData(data)` | Replace the graph; rebuilds nodes/edges and triggers an async layout. |
| `getData()` | The current graph, or `null`. |
| `setZoom(z)` / `getZoom()` | Set (clamped to `[minZoom, maxZoom]`, adaptively lowered so a huge graph can still reach its fit zoom) or read the zoom factor. |
| `zoomIn()` / `zoomOut()` | Step the zoom by a fixed multiplicative factor about the viewport centre. |
| `zoomToFit()` | Scale so the whole graph fits the viewport, then centre it. |
| `resetView()` | Reset to the default zoom, then re-centre on the focus node (`initialFocusNode`, or the last `focusNode` target) if there is one, else on the graph bounds. |
| `revealNode(id)` | Pan so the given node is centred, and lower the zoom if it does not fit the viewport whole (never raise it) — without changing selection or emitting. |
| `focusNode(id)` | Centre a node, retried after each layout pass until it succeeds, lowering the zoom the same way `revealNode` does — the durable form of `revealNode`. |
| `selectNode(id)` | Select a node programmatically (or `null` to clear) — does **not** emit. |
| `getSelection()` | The selected node data (single-select). |
| `setControlsVisible(v)` / `isControlsVisible()` | Show/hide, or read the visibility of, the built-in zoom / fit / reset control cluster. |
| `setSimplifyAtLowZoom(v)` / `isSimplifyAtLowZoom()` | Draw plain node boxes instead of node components once a large graph is zoomed out far enough that node content is no longer legible (default `true`). |
| `whenLaidOut()` | Resolves once the layout pass in flight has placed its nodes; resolves at once when idle, and never rejects. |
| `on('selection', fn)` | Fires when the selected node changes (a click), with the selected node data. |
| `on('layout', fn)` | Fires after each successful ELK layout pass. |
| `on('contextmenu', fn)` | Fires when a node is right-clicked, with the node data and the originating `MouseEvent`; suppresses the browser's native menu. `DiagramView` does not suppress it on empty canvas — [`Body`](/components/Body)'s page-wide default does, unless the app set `nativeContextMenu: true`. |
| `setEdgeEmphasis(ids)` / `getEdgeEmphasis()` | Dim every edge outside the given set, so the named ones stand out; `null` clears. Reset by the next layout. |
| `setNodeEmphasis(ids)` / `getNodeEmphasis()` | Dim every node outside the given set; `null` clears. Reset by the next layout. |
| `on('edgehover', fn)` | Fires with **every** model edge within the pointer's hit tolerance and the originating `MouseEvent` — several where routes overlap. |
| `on('edgeleave', fn)` | Fires when the pointer leaves whatever edge(s) it was hovering. |
| `dispose()` | Tear the view down and terminate its ELK Web Worker — call before discarding a `DiagramView` that is not a child of something else being disposed. |

## Interaction

- **Initial view** — the first render centres the graph in the viewport, at whatever `zoom` was configured (default `1`) — the same placement the built-in Reset control returns to. It does **not** auto-fit: a graph larger than the viewport stays at its configured zoom and overflows. For auto-fit, call `zoomToFit()` from a `"layout"` listener: `view.on('layout', () => view.zoomToFit())`. Pass `initialFocusNode` to centre that node instead of the graph's bounds — an id naming no node in the graph falls back to the bounds, and the configured zoom stands unless the focus node is too large to fit the viewport, in which case it is lowered until the node fits.
- **First paint** — node components are built and measured off the component tree, then positioned and revealed together once ELK has placed them, and mounted as the viewport reaches them, so a diagram never paints an unplaced graph (stacked nodes snapping into position after the fact) and a graph superseded by a newer `setData` before its layout lands is never rendered at all. A `setData` on an already-laid-out view keeps the previous graph on screen, visible, until the new one is placed — a re-layout never blanks the canvas mid-round-trip. Await `whenLaidOut()` to gate a spinner (or any other "is it ready" state) on placement rather than on `setData` returning.
- **Busy indicator** — while a layout pass is in flight the view covers itself with a translucent overlay carrying a centred spinner, so a live update reads as "working" rather than as a frozen canvas. It is shown by the view itself, needs no wiring, and cannot be turned off. A view with no committed size shows none, so the first pass — which every diagram runs before its host has sized it — stays uncovered and does not compete with a consumer's own loading placeholder. The overlay takes pointer events, so canvas interaction and the control cluster are unavailable until the pass settles.
- **Pan** — drag **empty canvas or an edge** to pan freely, in any direction, with no clamping — the graph can be dragged into empty space past its own bounds (an infinite canvas). There are no scrollbars; content panned outside the viewport is simply clipped. Only a drag that starts on a node (leaf or container) or the control cluster does not pan, so the cursor always says what a drag will do: `grab` / `grabbing` over pannable canvas (including an edge), `pointer` over a clickable node.
- **Resize** — a viewport resize keeps whatever was at the centre of the viewport at the centre, so the diagram does not drift toward a corner as the window grows or shrinks. The zoom is never changed by a resize.
- **Zoom** — the mouse wheel zooms about the pointer; `setZoom` / `zoomIn` / `zoomOut` / `zoomToFit` / `resetView` zoom programmatically. `revealNode` / `focusNode` can also change the zoom, but only ever lower it, to fit a node too large for the viewport.
- **Low zoom on a large graph** — a graph of at least a couple of hundred nodes, zoomed out until a node renders under about 16 pixels tall, draws each node as a plain themed box instead of its node component. Selection, double-click activation, and the context menu keep working against those boxes; a press anywhere pans, so the cursor is `grab` across the whole canvas. Pass `simplifyAtLowZoom: false` to keep full node components at every zoom.
- **Select** — click a node to select and highlight it (a themed `.selected` state) and fire `"selection"`; click empty space to clear. A drag never changes the selection: a press that travels more than a few pixels before release is treated as a pan, not a click, however it ends.
- **Edges** — edges take pointer events through an invisible wide hit path, so hovering one fires `"edgehover"` while the canvas around it still pans. Dragging an edge pans the canvas exactly like empty canvas does; a press without movement still leaves the selection alone — this component adds no edge selection or edge context menu.
- **Context menu** — right-click a node to fire `"contextmenu"` with its data (see [Common methods](#common-methods)).
- **Control cluster** — a built-in zoom-in / zoom-out / fit / reset button cluster is pinned to the bottom-right corner by default (`controls: true`), staying put as the viewport resizes; pass `controls: false` to hide it, e.g. when driving the view from your own toolbar instead.

## Running ELK layout in a Web Worker

Layout runs on the main thread by default. For a large graph, move ELK's compute off the main thread by passing a worker factory your bundler can resolve:

```typescript
const view = DiagramView({
    data,
    elkWorkerFactory: () =>
        new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" }),
});
```

- **Why `type: "classic"`** — `elk-worker.min.js` is a classic browserify script that references `module.exports` at top level; a `{ type: "module" }` worker would fail to load.
- **Bundler requirement** — the factory lives in your app, so *your* bundler must understand `new Worker(new URL(..., import.meta.url))`. Vite and webpack 5 do, and emit the worker from your own `node_modules/elkjs`. Nothing is hosted by hand.
- **If the worker fails to construct or errors**, the view transparently falls back to main-thread layout for the rest of its lifetime — a worker problem never breaks the diagram, but it also never recovers once the fallback fires.
- **`elkWorkerUrl` (a URL string) does not achieve off-thread layout here.** It exists for parity with elkjs's own API, but this component always imports elkjs's `elk.bundled.js`, whose own worker-availability check can never succeed in that module — passing `elkWorkerUrl` alone still runs on the main thread (with a console warning logged by elkjs itself). Use `elkWorkerFactory` for real off-thread execution; it takes precedence when both are set.
- **Dispose to release the worker.** The worker lives as long as the view. Call `dispose()` when you permanently discard a `DiagramView` (closing its tab, replacing a panel) and its worker thread is terminated; a view torn down as part of a disposed parent is covered automatically. A layout still running at that moment is abandoned — it never writes back into the view.

## Notes

- **Read-only.** There is no node dragging, in-place editing, or edge drawing. The node-renderer factory and model are shaped so an edit layer could be added later without breaking changes, but none of it is built here — ELK lays out once per data change.
- **Custom node content.** `nodeRenderer` is a `(data) => Component` factory; the default builds a [`DiagramNode`](/api/component/diagram/classes/DiagramNode) (a themed box with an optional glyph + label). Supply your own to render arbitrary components — the view consumes them only through `Component` + `getPreferredSize()`. A custom `nodeRenderer` receives `badge` like every other field on the data and must draw it itself; the default `groupRenderer` ignores it, so a container box never shows one. `groupRenderer` is the same shape for container nodes (see [Compound / container nodes](#compound-and-container-nodes)); its default builds a `DiagramGroupNode`.
- **Growing a node to fit its edges needs `elk.nodeSize.constraints`.** The view always feeds ELK an explicit size for every leaf node — the model's `width`/`height` when set, else the node component's preferred size — and ELK treats a sized node with the default (empty) `elk.nodeSize.constraints` as fixed. To let ELK enlarge a node so its edge anchors clear each other, set `elk.nodeSize.constraints: 'PORTS'` (optionally `'PORTS,NODE_LABELS'`) plus `elk.portConstraints: 'FIXED_SIDE'` in that node's `layoutOptions`, and give `elk.nodeSize.minimum` so the node cannot shrink below its rendered content. The returned size is written back through `setPreferredSize`, so a grown node renders grown — which only helps if the node's renderer fills the extra space.
- **Off-thread layout (opt-in).** Layout runs on the main thread by default (still `await`-ed). Pass `elkWorkerFactory` to move ELK's compute into a worker instead — see [Running ELK layout in a Web Worker](#running-elk-layout-in-a-web-worker) for why `elkWorkerUrl` alone does not. That worker lives as long as the view, so call `dispose()` when you discard one.
- **Graceful when ELK is absent.** If `elkjs` is not installed, a layout attempt fails quietly and the view stays empty rather than throwing. A *re*-layout that fails this way leaves the previously laid-out graph on screen rather than emptying the view.
- **Edges sharing a route cannot be told apart along the shared segment.** When several edges are routed through the same pixels (e.g. under ELK's `elk.layered.mergeEdges`), `"edgehover"` reports every one of them there, in draw order — a consumer describing the bundle (a tooltip listing each) is the intended way to disambiguate, since no per-edge styling can separate lines occupying the same pixels.
- **Only the nodes and edges near the visible area are attached to the document.** On a large graph, a node more than about half a viewport outside the visible area is built, measured, and positioned but not mounted until panning or zooming brings it into range, and an edge whose route stays that far outside is not drawn until then either. Selection, emphasis, and every centring method (`focusNode`, `revealNode`, `zoomToFit`, `resetView`) work against a node whether or not it is currently mounted, and `setEdgeEmphasis` works against an edge whether or not it is currently drawn. A custom `nodeRenderer`'s component may therefore have no element for part of the view's life. Below the low-zoom simplification threshold no node component is mounted at all and plain boxes are drawn instead, so a custom `nodeRenderer`'s component is not what the viewer sees there.

## See also

- [API: DiagramView](/api/component/diagram/classes/DiagramView)
- [API: DiagramNode](/api/component/diagram/classes/DiagramNode)
- [`Tree`](/components/Tree) — for a hierarchical (non-graph) data view
