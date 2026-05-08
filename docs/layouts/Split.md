# Split

[`Split`](/api/classes/Split) divides the container into two or more resizable panels separated by draggable [`SplitGutter`](/api/classes/SplitGutter) elements. Direction can be `'horizontal'` (panels side by side) or `'vertical'` (panels stacked).

```
+--------+║+----------------+
|        |║|                |
|  left  |║|     right      |   horizontal split
|        |║|                |
+--------+║+----------------+
         draggable gutter
```

## Usage

```typescript
import { Component, Split, Tree, Table } from '@jika/typescript-ui';

const workspace = new Component();
const layout = new Split();
layout.setDirection('horizontal');
workspace.setLayoutManager(layout);

workspace.addComponent(treeView);   // left
workspace.addComponent(detailTable); // right
```

## Three+ panes

Add more components to get more panes; `Split` inserts a gutter between each pair:

```typescript
workspace.addComponent(navigator);  // left
workspace.addComponent(content);    // centre
workspace.addComponent(properties); // right
```

## Per-child constraints

The constraint object can carry a `weight` to specify the initial size ratio. Without weights, panels start at equal size.

## Common methods

| Method | Purpose |
| --- | --- |
| `setDirection(value)` | `'horizontal'` (default) or `'vertical'`. |
| `setSize(component, px)` | Programmatically set a pane's pixel size. |

## Notes

- Gutter visuals are themed via the `gutter.background` token — see [Theming](/concepts/theming#theme-keys).
- Drag interactions disable body pointer events during the drag to suppress text selection.
- For a non-resizable two-region split, use [`Border`](/layouts/Border) instead.

## See also

- [API: Split](/api/classes/Split)
- [`SplitGutter`](/api/classes/SplitGutter) — the drag handle
- [`Border`](/layouts/Border) — fixed dividers
