# Border

[`Border`](/api/layout/classes/Border) divides a container into five named regions: north, south, east, west, and centre. North and south span the full width; east and west flank the centre.

`Border` is exported from `@jimka/typescript-ui/layout`; the line-style border utility of the same name lives in `@jimka/typescript-ui/primitive`. In code that touches both, alias the layout one on import: `import { Border as BorderLayout } from '@jimka/typescript-ui/layout';`.

```
+----------------------------------+
|             north                |
+--------+----------------+--------+
|        |                |        |
|  west  |     center     |  east  |
|        |                |        |
+--------+----------------+--------+
|             south                |
+----------------------------------+
```

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Border as BorderLayout } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';
import { MenuBar } from '@jimka/typescript-ui/component/menubar';
import { Table } from '@jimka/typescript-ui/component/table';
const app = Component();
app.setLayoutManager(BorderLayout({ gap: 4 }));

app.addComponent(MenuBar([/* ... */]),       { placement: Placement.NORTH  });
app.addComponent(Header('Status'),           { placement: Placement.SOUTH  });
app.addComponent(sidebar,                         { placement: Placement.WEST   });
app.addComponent(detailPanel,                     { placement: Placement.EAST   });
app.addComponent(Table(store),                { placement: Placement.CENTER });
```

[`BorderOptions`](/api/layout/interfaces/BorderOptions) accepts `gap` declaratively (the inter-region pixel gap); the `setComponentGap` setter still works for runtime updates.

## Per-child constraints

The constraint is `{ placement: Placement }` — see [`Placement`](/api/primitive/enumerations/Placement). Each region holds at most one child:

- `NORTH` / `SOUTH` span full width; height = child's preferred height.
- `WEST` / `EAST` consume their preferred width; height fills the remaining vertical space (between north and south).
- `CENTER` fills whatever remains.

If you omit `region`, the child goes to `CENTER` by default.

## Collapsible regions

Collapsing is **opt-in**: a plain Border adds no collapse affordances (so the
Border layouts used internally by `Header`, `Window`, `Dialog`, and the table
panels stay clean). Opt an edge region (north, south, east, west) in with
`collapsible: true` on its constraint; the centre can never collapse. A
collapsible region shows a single chevron handle on a transparent track at its
inner edge (the layout stays divider-less until you use it) — **double-click**
it and the track slides to the region's outer edge and widens into an opaque strip
(cross-fading its fill in), while the region keeps its full size and reveals away
under a clip-path and the centre grows into the reclaimed space. The whole pass is
one coordinated animation — the toggled region clip-reveals while the centre and
the gutter interpolate their geometry together, re-laying out their contents each
frame so nothing snaps — mirroring the [`Accordion`](/layouts/Accordion). Double-clicking the same chevron slides it
back and restores the region. Only a `dblclick` collapses, never a single click.
Collapsed state is in-memory only.

```typescript
app.addComponent(sidebar, { placement: Placement.WEST, collapsible: true }); // opt in

app.getLayoutManager().setRegionCollapsed(Placement.WEST, true);   // collapse west
app.getLayoutManager().isRegionCollapsed(Placement.WEST);          // → true
app.getLayoutManager().setRegionCollapsible(Placement.SOUTH, false); // hide its chevron
```

Each region's affordance is a fixed [`SplitGutter`](/api/component/container/classes/SplitGutter)
carrying a [`CollapseButton`](/api/component/container/classes/CollapseButton); the
strip fill and chevron colour are themed via the `collapse` tokens — see
[Theming](/concepts/theming#theme-keys).

## Notes

- The classic desktop-app shell pattern. Most "app frame" layouts (toolbar + sidebar + content + status bar) are a single Border layout.
- For nested splits (resizable sidebars), use [`Split`](/layouts/Split) inside the centre region.

## See also

- [API: Border (layout)](/api/layout/classes/Border)
- [API: Placement](/api/primitive/enumerations/Placement)
- [`Split`](/layouts/Split) — for resizable region dividers
