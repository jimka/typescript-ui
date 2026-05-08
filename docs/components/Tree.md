# Tree

[`Tree`](/api/classes/Tree) is a hierarchical data view with collapsible nodes and virtual scrolling. Pass root nodes via `setNodes(nodes[])` — the tree flattens the visible subtree into a single scrollable list and recycles internal row components, rebinding rows only when their data index changes.

## Usage

```typescript
import { Tree } from '@jika/typescript-ui';

const tree = new Tree();
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

Each node follows [`TreeNode`](/api/interfaces/TreeNode):

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
| `addSelectionListener(fn)` | Subscribe to user-driven selection changes. |

## Notes

- **Virtual scrolling** — only the visible rows plus a small buffer are in the DOM at any time. Resizing the tree does not re-render every row.
- **Indentation depth** is taken from the level of each node in the tree; you don't set it manually.
- For tabular hierarchical data (multi-column tree), build a [`Table`](/components/Table) with a custom cell type for the first column.

## See also

- [API: Tree](/api/classes/Tree)
- [API: TreeNode](/api/interfaces/TreeNode)
- [Performance › Virtual scrolling](/concepts/performance) (forthcoming)
