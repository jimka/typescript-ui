# VBox

[`VBox`](/api/classes/VBox) places children in a single vertical column, using each child's preferred height. An optional stretching mode expands children horizontally to fill the column's width.

```
+----------------+
| [A]            |
| [B]            |
| [C  ]          |
| [D]            |
| [E]            |
+----------------+
   children stacked vertically
```

## Usage

```typescript
import { Component, VBox, Label, TextField } from '@jika/typescript-ui';

const form = new Component();
const layout = new VBox();
layout.setSpacing(8);
form.setLayoutManager(layout);

form.addComponent(new Label('Name'));
form.addComponent(new TextField());
form.addComponent(new Label('Email'));
form.addComponent(new TextField());
```

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/enumerations/FillType).
- `anchor` — [`AnchorType`](/api/enumerations/AnchorType).

```typescript
import { FillType } from '@jika/typescript-ui';

form.addComponent(textField, { fill: FillType.HORIZONTAL });
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setSpacing(px)` | Gap between children. |
| `setStretching(boolean)` | When `true`, all children fill the column's full width. |

## See also

- [API: VBox](/api/classes/VBox)
- [`Row`](/layouts/Row) — equal-height vertical sequence
- [`HBox`](/layouts/HBox) — horizontal equivalent
- [Layout constraints reference](/layouts/Constraints)
