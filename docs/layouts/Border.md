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
const app = new Component();
app.setLayoutManager(new BorderLayout({ gap: 4 }));

app.addComponent(new MenuBar([/* ... */]),       { region: Placement.NORTH  });
app.addComponent(new Header('Status'),           { region: Placement.SOUTH  });
app.addComponent(sidebar,                         { region: Placement.WEST   });
app.addComponent(detailPanel,                     { region: Placement.EAST   });
app.addComponent(new Table(store),                { region: Placement.CENTER });
```

[`BorderOptions`](/api/layout/interfaces/BorderOptions) accepts `gap` declaratively (the inter-region pixel gap); the `setComponentGap` setter still works for runtime updates.

## Per-child constraints

The constraint is `{ region: Placement }` — see [`Placement`](/api/primitive/enumerations/Placement). Each region holds at most one child:

- `NORTH` / `SOUTH` span full width; height = child's preferred height.
- `WEST` / `EAST` consume their preferred width; height fills the remaining vertical space (between north and south).
- `CENTER` fills whatever remains.

If you omit `region`, the child goes to `CENTER` by default.

## Notes

- The classic desktop-app shell pattern. Most "app frame" layouts (toolbar + sidebar + content + status bar) are a single Border layout.
- For nested splits (resizable sidebars), use [`Split`](/layouts/Split) inside the centre region.

## See also

- [API: Border (layout)](/api/layout/classes/Border)
- [API: Placement](/api/primitive/enumerations/Placement)
- [`Split`](/layouts/Split) — for resizable region dividers
