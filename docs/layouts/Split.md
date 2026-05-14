# Split

[`Split`](/api/layout/classes/Split) divides the container into two or more resizable panels separated by draggable [`SplitGutter`](/api/component/container/classes/SplitGutter) elements. Direction can be `'horizontal'` (panels side by side) or `'vertical'` (panels stacked).

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
import { Component } from '@jimka/typescript-ui/core';
import { Split } from '@jimka/typescript-ui/layout';
import { Table } from '@jimka/typescript-ui/component/table';
import { Tree } from '@jimka/typescript-ui/component/tree';
const workspace = new Component();
workspace.setLayoutManager(new Split({ direction: 'horizontal' }));

workspace.addComponent(treeView);   // left
workspace.addComponent(detailTable); // right
```

[`SplitOptions`](/api/layout/interfaces/SplitOptions) accepts `direction` declaratively. The legacy positional `new Split('horizontal')` form and the `setDirection` setter still work.

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

- [API: Split](/api/layout/classes/Split)
- [`SplitGutter`](/api/component/container/classes/SplitGutter) — the drag handle
- [`Border`](/layouts/Border) — fixed dividers
