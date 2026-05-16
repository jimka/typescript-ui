# VBox

[`VBox`](/api/layout/classes/VBox) places children in a single vertical column, using each child's preferred height. An optional stretching mode expands children horizontally to fill the column's width.

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
import { Component } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Label, TextField } from '@jimka/typescript-ui/component/input';
const form = Component();
form.setLayoutManager(VBox({ spacing: 8 }));

const nameField  = TextField();
const emailField = TextField();

form.addComponent(Label('Name',  nameField.getId()));
form.addComponent(nameField);
form.addComponent(Label('Email', emailField.getId()));
form.addComponent(emailField);
```

[`VBoxOptions`](/api/layout/interfaces/VBoxOptions) accepts `spacing` and `stretching` declaratively. The legacy positional `VBox(spacing)` form and the `setSpacing` / `setStretching` setters still work.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/layout/enumerations/FillType).
- `anchor` — [`AnchorType`](/api/layout/enumerations/AnchorType).

```typescript
import { FillType } from '@jimka/typescript-ui/layout';
form.addComponent(textField, { fill: FillType.HORIZONTAL });
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setSpacing(px)` | Gap between children. |
| `setStretching(boolean)` | When `true`, all children fill the column's full width. |

## See also

- [API: VBox](/api/layout/classes/VBox)
- [`Row`](/layouts/Row) — equal-height vertical sequence
- [`HBox`](/layouts/HBox) — horizontal equivalent
- [Layout constraints reference](/layouts/Constraints)
