# Tree

[`Tree`](/api/component/tree/classes/Tree) is a hierarchical data view with collapsible nodes and virtual scrolling. Pass root nodes via `setNodes(nodes[])` — the tree flattens the visible subtree into a single scrollable list and recycles internal row components, rebinding rows only when their data index changes.

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
    label:     string;
    children?: TreeNode[];
}
```

Nodes with a non-empty `children` array render as expandable parents; nodes without children render as leaves.

## Common methods

| Method | Purpose |
| --- | --- |
| `setNodes(nodes[])` | Replace the entire tree. |
| `expandAll()` / `collapseAll()` | Bulk-toggle expansion. |
| `on("selection", fn)` | Subscribe to user-driven selection changes. |
| `setRendererFactory(fn)` | Replace the content renderer used for every row. |

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
- `layoutChildren(width, height)` — position internal sub-components within the allocated box.

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
