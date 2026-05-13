# Layouts

A [`LayoutManager`](/api/classes/LayoutManager) is attached to a container [`Component`](/api/classes/Component) and positions its children on each `doLayout()` call. All managers extend `LayoutManager`, which handles fill / anchor constraint resolution.

## Available layouts

| Manager | Description |
| --- | --- |
| [`Absolute`](/api/classes/Absolute) | No-op — children are positioned manually |
| [`Accordion`](/api/classes/Accordion) | Collapsible vertical sections, one or many open at a time |
| [`Border`](/api/classes/Border) | Five-region layout: north, south, east, west, center |
| [`Card`](/api/classes/Card) | Stacked layers — one visible at a time |
| [`Column`](/api/classes/Column) | Horizontal sequence with gap control |
| [`Fit`](/api/classes/Fit) | Expands one child to fill the entire container |
| [`Grid`](/api/classes/Grid) | Two-dimensional grid |
| [`HBox`](/api/classes/HBox) | Horizontal stack with configurable spacing |
| [`Row`](/api/classes/Row) | Vertical sequence with gap control |
| [`Split`](/api/classes/Split) | Two panes with a draggable resize gutter |
| [`Tab`](/api/classes/Tab) | Tabbed interface with a button toolbar |
| [`VBox`](/api/classes/VBox) | Vertical stack with configurable spacing |

## Attach a layout

```typescript
import { Component, Border } from '@jimka/typescript-ui';

const panel = Component({
    layoutManager: Border(),
    components: [
        { component: header,  constraints: { region: 'north'  } },
        { component: content, constraints: { region: 'center' } },
        { component: footer,  constraints: { region: 'south'  } }
    ]
});
```

The second argument to `addComponent` (or the `constraints` field of a `ConstrainedComponent` pair) is the layout's constraint — its shape is specific to the manager. `Border` takes a region; `Grid` takes a row + column; `Absolute` ignores it.

The same can be expressed imperatively if you need refs along the way:

```typescript
const panel = Component();
panel.setLayoutManager(Border());
panel.addComponents(
    { component: header,  constraints: { region: 'north'  } },
    { component: content, constraints: { region: 'center' } },
    { component: footer,  constraints: { region: 'south'  } }
);
```

## When `doLayout` runs

Layout runs in three situations:

1. **Initial render** — when a component first becomes visible.
2. **Viewport resize** — `Body` listens for `window.resize` and re-runs layout from the root.
3. **Explicit call** — you call `parent.doLayout()` after changing a child's preferred size or adding / removing children.

There is no automatic re-layout on size changes. If you change a child's preferred size, you must trigger a layout pass on its parent (or an ancestor) for the change to take effect.

## See also

- [Layout system](/concepts/layout-system) — deep-dive on constraint resolution.
- [Sizing](/concepts/sizing) — preferred / min / max / fixed size semantics.
- [`LayoutConstraints`](/api/classes/LayoutConstraints) — the constraint base class.
- [`AnchorType`](/api/enumerations/AnchorType), [`FillType`](/api/enumerations/FillType), [`Placement`](/api/enumerations/Placement) — constraint enums.
