# Layouts

A [`LayoutManager`](/api/layout/classes/LayoutManager) is attached to a container [`Component`](/api/core/classes/Component) and positions its children on each `doLayout()` call. All managers extend `LayoutManager`, which handles fill / anchor constraint resolution.

## Available layouts

| Manager | Description |
| --- | --- |
| [`Absolute`](/api/layout/classes/Absolute) | No-op — children are positioned manually |
| [`Anchor`](/api/layout/classes/Anchor) | Edge-relative & percentage positioning; pins children to edges or stretches between them, reactive to container resize |
| [`Accordion`](/api/layout/classes/Accordion) | Collapsible vertical sections, one or many open at a time |
| [`Border`](/api/layout/classes/Border) | Five-region layout: north, south, east, west, center |
| [`Card`](/api/layout/classes/Card) | Stacked layers — one visible at a time |
| [`Fit`](/api/layout/classes/Fit) | Places one child inside the container — stretch to fill (default) or centre at preferred size via `FillType.NONE` |
| [`Grid`](/api/layout/classes/Grid) | Two-dimensional grid with weight/fixed/content track sizing, cell spanning, and explicit placement |
| [`HBox`](/api/layout/classes/HBox) | Horizontal stack; `mode: "preferred"` honours per-child widths, `mode: "equal"` divides the row into equal cells |
| [`Split`](/api/layout/classes/Split) | Two panes with a draggable resize gutter |
| [`Tab`](/api/layout/classes/Tab) | Tabbed interface with a button toolbar |
| [`VBox`](/api/layout/classes/VBox) | Vertical stack; `mode: "preferred"` honours per-child heights, `mode: "equal"` divides the column into equal cells |
| [`HFlow`](/api/layout/classes/HFlow) | Wrapping horizontal stack; packs children left-to-right and wraps to new lines, scrolling vertically on overflow; supports cross-axis [`itemAlign`](/api/layout/type-aliases/FlowItemAlign) and inter-item [`justify`](/api/layout/type-aliases/FlowJustify) |
| [`VFlow`](/api/layout/classes/VFlow) | Wrapping vertical stack; packs children top-to-bottom and wraps to new columns, scrolling horizontally on overflow; supports cross-axis [`itemAlign`](/api/layout/type-aliases/FlowItemAlign) and inter-item [`justify`](/api/layout/type-aliases/FlowJustify) |

## Edge-drop docking

[`DockRegion`](/layouts/DockRegion) wraps a container so a dragged tab can be dropped on its edges to **split** it (creating or extending a [`Split`](/layouts/Split)) or on its centre to add it as a [`Tab`](/layouts/Tab) — the single-region primitive a dock/tab manager composes.

## Serializing arrangements

[Layout serialization](/layouts/LayoutSerialization) captures the `Split` / `Tab` / `Window` arrangement of a container tree to a plain object and restores it — including switching between saved layouts at runtime while preserving each panel's state.

## Attach a layout

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Border } from '@jimka/typescript-ui/primitive';
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
- [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) — the constraint base class.
- [`AnchorType`](/api/layout/enumerations/AnchorType), [`FillType`](/api/layout/enumerations/FillType), [`Placement`](/api/primitive/enumerations/Placement) — constraint enums.
