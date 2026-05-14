# Border

[`Border`](/api/classes/BorderLayout) divides a container into five named regions: north, south, east, west, and centre. North and south span the full width; east and west flank the centre.

Re-exported as **`BorderLayout`** from the package barrel to disambiguate from the line-style [`Border`](/api/classes/Border) utility.

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
const app = new Component();
app.setLayoutManager(new BorderLayout({ gap: 4 }));

app.addComponent(new MenuBar([/* ... */]),       { region: Placement.NORTH  });
app.addComponent(new Header('Status'),           { region: Placement.SOUTH  });
app.addComponent(sidebar,                         { region: Placement.WEST   });
app.addComponent(detailPanel,                     { region: Placement.EAST   });
app.addComponent(new Table(store),                { region: Placement.CENTER });
```

[`BorderLayoutOptions`](/api/interfaces/BorderLayoutOptions) accepts `gap` declaratively (the inter-region pixel gap); the `setComponentGap` setter still works for runtime updates.

## Per-child constraints

The constraint is `{ region: Placement }` — see [`Placement`](/api/enumerations/Placement). Each region holds at most one child:

- `NORTH` / `SOUTH` span full width; height = child's preferred height.
- `WEST` / `EAST` consume their preferred width; height fills the remaining vertical space (between north and south).
- `CENTER` fills whatever remains.

If you omit `region`, the child goes to `CENTER` by default.

## Notes

- The classic desktop-app shell pattern. Most "app frame" layouts (toolbar + sidebar + content + status bar) are a single Border layout.
- For nested splits (resizable sidebars), use [`Split`](/layouts/Split) inside the centre region.

## See also

- [API: BorderLayout](/api/classes/BorderLayout)
- [API: Placement](/api/enumerations/Placement)
- [`Split`](/layouts/Split) — for resizable region dividers
