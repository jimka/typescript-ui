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
import { Component, VBox, Label, TextField } from '@jimka/typescript-ui';

const form = new Component();
form.setLayoutManager(new VBox({ spacing: 8 }));

const nameField  = new TextField();
const emailField = new TextField();

form.addComponent(new Label('Name',  nameField.getId()));
form.addComponent(nameField);
form.addComponent(new Label('Email', emailField.getId()));
form.addComponent(emailField);
```

[`VBoxOptions`](/api/interfaces/VBoxOptions) accepts `spacing` and `stretching` declaratively. The legacy positional `new VBox(spacing)` form and the `setSpacing` / `setStretching` setters still work.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/enumerations/FillType).
- `anchor` — [`AnchorType`](/api/enumerations/AnchorType).

```typescript
import { FillType } from '@jimka/typescript-ui';

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
