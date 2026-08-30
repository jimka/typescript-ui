# Tree

[`Tree`](/api/component/tree/classes/Tree) is a hierarchical data view with collapsible nodes and virtual scrolling. Pass root nodes via `setNodes(nodes[])` — the tree flattens the visible subtree into a single scrollable list and recycles internal row components, rebinding rows only when their data index changes.

<!-- demo: tree-nodes -->
> **Live demo** — a small file/folder hierarchy as node literals, with
> expand / collapse and selection.
> [Open the Tree page](https://jimka.github.io/typescript-ui/components/Tree)
<!-- /demo -->

## Usage

```typescript
import { Tree } from '@jimka/typescript-ui/component/tree';
const tree = Tree();
tree.setNodes([
    { label: 'Fruits', children: [
        { label: 'Apple' },
        { label: 'Banana' },
    ]},
    { label: 'Vegetables' },
]);

container.addComponent(tree);
```

## TreeNode

Each node follows [`TreeNode`](/api/component/tree/interfaces/TreeNode):

```typescript
interface TreeNode {
    label:         string;
    children?:     TreeNode[];
    hasChildren?:  boolean;
    loadChildren?: () => Promise<TreeNode[]>;
    data?:         unknown;
}
```

Nodes with a non-empty `children` array render as expandable parents; nodes without children render as leaves. Set `hasChildren: true` with a `loadChildren` loader to make a node load its children lazily (see below).

### Attaching domain data

The optional `data` field is an opaque payload slot: attach any domain object to a node and read it back, unchanged, from any node the tree hands you — `getSelectedNode()`, `getSelectedNodes()`, the `selection` event, or the `loaderror` event. The tree never reads, renders, or uses `data` for identity, so two nodes with identical `data` are still independent. This lets a node carry the object it represents without a side-map:

```typescript
tree.setNodes([
    { label: 'public', data: { kind: 'schema', name: 'public' } },
]);

tree.on('selection', nodes => {
    const meta = nodes[0].data as { kind: string; name: string };
    console.log(`selected ${meta.kind} ${meta.name}`);
});
```

## Lazy loading

A node whose children are fetched on demand declares `hasChildren: true` so it renders an expandable caret before its children exist, and supplies a `loadChildren` function returning a promise. On first expansion the row shows a spinner in place of the caret, awaits `loadChildren`, populates `children`, then re-renders. The result is cached, so re-collapsing and re-expanding never refetches.

```typescript
tree.setNodes([
    {
        label: 'Lazy folder',
        hasChildren: true,
        loadChildren: () => fetch('/api/children').then(r => r.json()),
    },
]);

tree.on('loaderror', (node, error) => {
    console.error(`Failed to load ${node.label}`, error);
});
```

If `loadChildren` rejects, the node reverts to a collapsed, unloaded caret — toggling it again retries the load — and the tree fires a `loaderror` event carrying the node and the rejection reason. A loader that resolves to an empty array succeeds: the node renders as an expanded, empty parent.

## Expansion state

`getExpandedNodes()` returns a snapshot of every currently expanded node, and the `"expand"` / `"collapse"` events fire whenever a single node's expansion changes — a caret click, `ArrowRight` / `ArrowLeft`, a double-click on a parent row, or a programmatic `expandNode(node)` / `expandNodeAsync(node)`. This is enough to persist which nodes are open and restore them: subscribe to both events, store `getExpandedNodes()`, and on reload `await expandNodeAsync(node)` per stored node — `expandNodeAsync` resolves only once the expansion has committed, including after an unloaded lazy node's `loadChildren` settles.

```typescript
tree.on('expand', node => saveExpanded(node));
tree.on('collapse', node => saveCollapsed(node));

for (const node of loadStoredExpandedNodes()) {
    await tree.expandNodeAsync(node);
}
```

`expandAll()` and `revealByPredicate()` change the expansion without emitting `"expand"` — call `getExpandedNodes()` after either to read what changed. `setNodes()` clears the expanded set (also silently), so a persisted set covers a single dataset instance.

## Common methods

| Method | Purpose |
| --- | --- |
| `setNodes(nodes[])` | Replace the entire tree. |
| `expandAll()` / `collapseAll()` | Bulk-toggle expansion. |
| `getExpandedNodes()` | Snapshot the currently expanded nodes (see [Expansion state](#expansion-state)). |
| `expandNodeAsync(node)` | Expand a node and resolve once the expansion has committed, including a lazy load (see [Expansion state](#expansion-state)). |
| `on("selection", fn)` | Subscribe to user-driven selection changes. |
| `on("loaderror", fn)` | Subscribe to lazy-load failures (see [Lazy loading](#lazy-loading)). |
| `on("expand", fn)` / `on("collapse", fn)` | Subscribe to a single node's expansion changing (see [Expansion state](#expansion-state)). |
| `setRendererFactory(fn)` | Replace the content renderer used for every row, disposing each row's previous renderer. |
| `getRowOverflow()` / `setRowOverflow(mode)` | Get/set how a row wider than the viewport is handled — see [Row overflow](#row-overflow). |
| `getExpandTrigger()` / `setExpandTrigger(mode)` | Get/set which click gesture on a row's body expands it — see [Expand trigger](#expand-trigger). |

## Row overflow

By default (`rowOverflow: "scroll"`), a row wider than the viewport grows the whole row set to fit it and the horizontal scrollbar reveals the rest — every row shares one width, the widest label seen so far, so the bar stays stable instead of jittering as different-width rows scroll through. This is the right choice when a label's exact text matters, e.g. a file path in a file-browser-style tree.

Pass `rowOverflow: "clip"` when reading a label matters more than its exact text and scrolling sideways to read one would be worse than truncating it — a table-of-contents-style outline, for instance. Every row caps at the viewport width instead of growing, and [`LabelTreeNodeRenderer`](/api/component/tree/classes/LabelTreeNodeRenderer) (the default renderer) truncates with an ellipsis rather than letting the tree's own clipping cut it off with no visual cue:

```typescript
const tree = Tree({ rowOverflow: 'clip' });
```

A custom [`TreeNodeRenderer`](#custom-row-renderers) opts into the same behaviour by clamping its own content to the `width` its `layoutChildren(width, height)` receives, the way `LabelTreeNodeRenderer` clamps its label to `Math.min(getContentWidth(), width)` — under `"scroll"` this is a no-op (the row is never narrower than `getContentWidth()` there), so an existing renderer that ignores `width` keeps its current behaviour either way.

## Expand trigger

By default (`expandTrigger: "dblclick"`), a row's body expands or collapses it only on a double-click — the file-explorer convention. The caret always toggles on a single click regardless of this setting.

Pass `expandTrigger: "click"` to switch a row's body to the IDE-sidebar convention of toggling on a plain click instead:

```typescript
const tree = Tree({ expandTrigger: 'click' });
```

Ctrl/Cmd-click and an anchored Shift-click never toggle in either mode — they keep their existing selection-only meaning. A Shift-click with no anchor set falls back to plain-click behaviour and does toggle, the same as an unmodified click.

## Preferred size

A `Tree` with no explicit `preferredSize` reports a width of `200` and a height derived live from the current flattened row count (visible rows × row height) — so a tree sized by its preferred size rather than stretched (a corner-pinned [`FloatingPanel`](/components/FloatingPanel) child, for instance) grows and shrinks with its actual content instead of a fixed guess. An explicit `preferredSize` set via the constructor or `setPreferredSize` always wins outright, on both axes. This only matters when something reads the tree's preferred size to size it — a tree placed in a stretching layout (a `Border` centre region, say) ignores it entirely and fills whatever space it's given, staying shrinkable and internally scrollable either way.

## Custom row renderers

Each pool slot's content (everything to the right of the expand/collapse toggle) is owned by a [`TreeNodeRenderer`](/api/component/tree/classes/TreeNodeRenderer) instance. The tree holds a zero-argument factory; one renderer is created per pool slot when the pool grows and rebound via `update(context)` when the slot is mapped to a different node.

Built-in renderers:

| Class | Output |
| --- | --- |
| [`LabelTreeNodeRenderer`](/api/component/tree/classes/LabelTreeNodeRenderer) | Plain text label. Used as the default factory. |
| [`IconLabelTreeNodeRenderer`](/api/component/tree/classes/IconLabelTreeNodeRenderer) | [`Glyph`](/api/component/display/classes/Glyph) icon + label. The glyph name is resolved per row by a caller-supplied [`IconLabelGlyphResolver`](/api/component/tree/type-aliases/IconLabelGlyphResolver). |

```typescript
import { IconLabelTreeNodeRenderer, Tree } from '@jimka/typescript-ui/component/tree';

const tree = Tree();
tree.setRendererFactory(() => new IconLabelTreeNodeRenderer(
    (node) => (node.children && node.children.length > 0) ? 'chevron-down' : 'file',
));
tree.setNodes(rootNodes);
```

To write a fully custom renderer, subclass [`TreeNodeRenderer`](/api/component/tree/classes/TreeNodeRenderer) and implement three methods:

- `update(context)` — bind the renderer to the new node. The [`TreeNodeRenderContext`](/api/component/tree/interfaces/TreeNodeRenderContext) carries the node, depth, expanded/selected flags, and whether the node has children.
- `getContentWidth()` — return the natural pixel width of the rendered content so the tree can size its horizontal scroll extent.
- `layoutChildren(width, height)` — position internal sub-components within the allocated box. `width` is the row's available width — under `rowOverflow: "clip"` it can be narrower than `getContentWidth()`; a renderer that wants to clip/truncate rather than overflow should clamp to it (see [Row overflow](#row-overflow)).

The renderer never sees the toggle or the row-level selection highlight — those stay under the tree's structural control. Plain selection style changes (background, focus ring) do not flow through `update()`; expansion changes do, because they force a full re-bind.

## Notes

- **Virtual scrolling** — only the visible rows plus a small buffer are in the DOM at any time. Resizing the tree does not re-render every row.
- **Scrolling** is delegated to a [`VirtualScroller`](/components/VirtualScroller): JS-owned transform scroll with two custom [`Scrollbar`](/components/Scrollbar) overlays, wheel, touch (with fling momentum), and keyboard navigation.
- **Horizontal scrolling** is supported when node labels exceed the tree's width — the horizontal scrollbar appears automatically.
- **Indentation depth** is taken from the level of each node in the tree; you don't set it manually.
- For tabular hierarchical data (multi-column tree), build a [`Table`](/components/Table) with a custom cell type for the first column.

## See also

- [API: Tree](/api/component/tree/classes/Tree)
- [API: TreeNode](/api/component/tree/interfaces/TreeNode)
- [API: TreeNodeRenderer](/api/component/tree/classes/TreeNodeRenderer)
- [API: LabelTreeNodeRenderer](/api/component/tree/classes/LabelTreeNodeRenderer)
- [API: IconLabelTreeNodeRenderer](/api/component/tree/classes/IconLabelTreeNodeRenderer)
- [Performance › Virtual scrolling](/concepts/performance)
