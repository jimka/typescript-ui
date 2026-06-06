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
const workspace = Component();
workspace.setLayoutManager(Split({ direction: 'horizontal' }));

workspace.addComponent(treeView);   // left
workspace.addComponent(detailTable); // right
```

[`SplitOptions`](/api/layout/interfaces/SplitOptions) accepts `direction` declaratively. The legacy positional `Split('horizontal')` form and the `setDirection` setter still work.

## Three+ panes

Add more components to get more panes; `Split` inserts a gutter between each pair:

```typescript
workspace.addComponent(navigator);  // left
workspace.addComponent(content);    // centre
workspace.addComponent(properties); // right
```

## Per-child constraints

The constraint object can carry a `weight` to specify the initial size ratio. Without weights, panels start at equal size.

## Collapsible panels

Each gutter carries a small chevron grip. **Double-clicking** it collapses the
adjacent pane: the gutter slides to that pane's outer edge and widens into a
themed, button-styled strip (cross-fading its fill in), while the collapsing pane
keeps its full size and reveals away under a clip-path, and the freed space is
redistributed to the remaining panes. The whole pass is one coordinated
animation — the toggled pane clip-reveals while every other pane and the gutters
interpolate their geometry together, re-laying out their contents each frame so
nothing snaps — mirroring [`Accordion`](/layouts/Accordion). A single click or a drag never collapses —
only a `dblclick` does, so resizing is never ambiguous. Double-clicking the same
chevron on the strip slides the gutter back and restores the pane to its previous
ratio. Collapsed state is in-memory only.

By default a pane collapses toward the split's leading edge (`west`/`north`),
using the gutter on its **trailing** side. Set `collapseDirection` on a pane's
constraint to collapse it toward the trailing edge (`east`/`south`) instead,
using the gutter on its **leading** side — which is how the otherwise-gutterless
**last pane** becomes collapsible:

```typescript
const split = Split({ direction: 'horizontal', collapsedPanes: [0] });

split.addComponent(sidebar);                                   // collapses west (default)
split.addComponent(content);
split.addComponent(inspector, { collapseDirection: 'east' }); // last pane collapses east

split.setPaneCollapsed(0, true);   // collapse the first pane
split.isPaneCollapsed(0);          // → true
split.setPaneCollapsed(0, false);  // restore it
```

A pane and its neighbour share the gutter between them, so opting the trailing
pane into `east` claims that gutter and makes the leading pane non-collapsible
(only one of the two can fold into a given gutter).

The chevron is a [`CollapseButton`](/api/component/container/classes/CollapseButton)
carried by the [`SplitGutter`](/api/component/container/classes/SplitGutter); the
strip fill and chevron colour are themed via the `collapse` tokens — see
[Theming](/concepts/theming#theme-keys).

## Common methods

| Method | Purpose |
| --- | --- |
| `setDirection(value)` | `'horizontal'` (default) or `'vertical'`. |
| `setSize(component, px)` | Programmatically set a pane's pixel size. |
| `setPaneCollapsed(index, value)` | Collapse or restore the pane at `index`. |
| `isPaneCollapsed(index)` | Whether the pane at `index` is collapsed. |

## Notes

- Gutter visuals are themed via the `gutter.background` token — see [Theming](/concepts/theming#theme-keys).
- Drag interactions disable body pointer events during the drag to suppress text selection.
- For a non-resizable two-region split, use [`Border`](/layouts/Border) instead.

## See also

- [API: Split](/api/layout/classes/Split)
- [`SplitGutter`](/api/component/container/classes/SplitGutter) — the drag handle
- [`Border`](/layouts/Border) — fixed dividers
