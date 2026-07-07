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
- **Custom node content.** `nodeRenderer` is a `(data) => Component` factory; the default builds a [`DiagramNode`](/api/component/diagram/classes/DiagramNode) (a themed box with an optional glyph + label). Supply your own to render arbitrary components — the view consumes them only through `Component` + `getPreferredSize()`.
- **Off-thread layout (opt-in).** Layout runs on the main thread by default (still `await`-ed). Pass `elkWorkerUrl` pointing at a consumer-hosted `elk-worker.js` to run ELK's compute in a worker.
- **Graceful when ELK is absent.** If `elkjs` is not installed, a layout attempt fails quietly and the view stays empty rather than throwing.

## See also

- [API: DiagramView](/api/component/diagram/classes/DiagramView)
- [API: DiagramNode](/api/component/diagram/classes/DiagramNode)
- [`Tree`](/components/Tree) — for a hierarchical (non-graph) data view
