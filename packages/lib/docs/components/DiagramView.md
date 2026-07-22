# DiagramView

[`DiagramView`](/api/component/diagram/classes/DiagramView) is a **read-only** graph/diagram viewer. You give it a framework-native node/edge model; it runs the graph through [ElkJS](https://github.com/kieler/elkjs) for automatic layout, renders themed nodes plus an SVG edge layer with arrowheads, and supports pan, zoom, and node selection. ELK is layout-only — it takes JSON and returns the same JSON annotated with coordinates; every pixel is drawn through the framework's own component and DOM seams.

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

The model is three plain interfaces — [`DiagramNodeData`](/api/component/diagram/interfaces/DiagramNodeData), [`DiagramEdgeData`](/api/component/diagram/interfaces/DiagramEdgeData), and [`DiagramData`](/api/component/diagram/interfaces/DiagramData). A node's size fed to ELK is its explicit `width`/`height` when given, else the node component's preferred size. `layoutOptions` (per-node and graph-level) pass straight through to ELK.

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
| `setZoom(z)` / `getZoom()` | Set (clamped to `[minZoom, maxZoom]`) or read the zoom factor. |
| `zoomToFit()` | Scale so the whole graph fits the viewport. |
| `selectNode(id)` | Select a node programmatically (or `null` to clear) — does **not** emit. |
| `getSelection()` | The selected node data (single-select). |
| `on('selection', fn)` | Fires when the selected node changes (a click), with the selected node data. |
| `on('layout', fn)` | Fires after each successful ELK layout pass. |

## Interaction

- **Pan** — drag with the pointer, or use the trackpad / scrollbars (native scroll).
- **Zoom** — the mouse wheel zooms about the pointer; `setZoom` / `zoomToFit` zoom programmatically.
- **Select** — click a node to select and highlight it (a themed `.selected` state) and fire `"selection"`; click empty space to clear.

## Notes

- **Read-only.** There is no node dragging, in-place editing, or edge drawing. The node-renderer factory and model are shaped so an edit layer could be added later without breaking changes, but none of it is built here — ELK lays out once per data change.
- **Custom node content.** `nodeRenderer` is a `(data) => Component` factory; the default builds a [`DiagramNode`](/api/component/diagram/classes/DiagramNode) (a themed box with an optional glyph + label). Supply your own to render arbitrary components — the view consumes them only through `Component` + `getPreferredSize()`. `groupRenderer` is the same shape for container nodes (see [Compound / container nodes](#compound-and-container-nodes)); its default builds a `DiagramGroupNode`.
- **Off-thread layout (opt-in).** Layout runs on the main thread by default (still `await`-ed). Pass `elkWorkerUrl` pointing at a consumer-hosted `elk-worker.js` to run ELK's compute in a worker.
- **Graceful when ELK is absent.** If `elkjs` is not installed, a layout attempt fails quietly and the view stays empty rather than throwing.

## See also

- [API: DiagramView](/api/component/diagram/classes/DiagramView)
- [API: DiagramNode](/api/component/diagram/classes/DiagramNode)
- [`Tree`](/components/Tree) — for a hierarchical (non-graph) data view
