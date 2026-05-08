# HBox

[`HBox`](/api/classes/HBox) places children in a single horizontal row, using each child's preferred width. An optional stretching mode expands children vertically to fill the row's height.

```
+--------------------------+
| [A] [B]  [C  ] [D] [E]   |
+--------------------------+
   children in a row, configurable spacing
```

## Usage

```typescript
import { Component, HBox, Button } from '@jika/typescript-ui';

const toolbar = new Component();
const layout  = new HBox();
layout.setSpacing(8);
toolbar.setLayoutManager(layout);

toolbar.addComponent(new Button('Cut'));
toolbar.addComponent(new Button('Copy'));
toolbar.addComponent(new Button('Paste'));
```

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/enumerations/FillType): `NONE` (preferred size), `HORIZONTAL`, `VERTICAL`, `BOTH`.
- `anchor` — [`AnchorType`](/api/enumerations/AnchorType): used when the cell is larger than the child.

```typescript
import { FillType, AnchorType } from '@jika/typescript-ui';

toolbar.addComponent(button, {
    fill:   FillType.VERTICAL,    // stretch to row height
    anchor: AnchorType.CENTER,    // center horizontally within its slot
});
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setSpacing(px)` | Gap between children. |
| `setStretching(boolean)` | When `true`, all children fill the row's full height. |

## See also

- [API: HBox](/api/classes/HBox)
- [`Column`](/layouts/Column) — equal-width horizontal sequence
- [`VBox`](/layouts/VBox) — vertical equivalent
- [Layout constraints reference](/layouts/Constraints)
