# VBox

[`VBox`](/api/layout/classes/VBox) places children in a single vertical column. A `mode` option selects between honouring each child's preferred height (the default) and dividing the container height equally among children.

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

[`VBoxOptions`](/api/layout/interfaces/VBoxOptions) accepts `mode`, `spacing`, and `stretching` declaratively. The `setMode` / `setSpacing` / `setStretching` setters work for runtime updates.

## Sizing modes

`mode: "preferred"` (default) honours each child's preferred height. Non-weighted children take their preferred sizes; cells carrying a `weight` layout constraint share the remaining height. When the children's preferred heights sum past the container, non-weighted children shrink proportionally toward their min heights.

`mode: "equal"` divides the container's inner height equally among children, clamped to the largest child's min height. `weight` constraints are silently ignored in this mode. The `stretching` default for `"equal"` mode is `true`, matching the historical `Row` behaviour.

```typescript
import { VBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
// Vertical strip of equally sized buttons.
const sidebar = Component();
sidebar.setLayoutManager(VBox({ mode: "equal", spacing: 4 }));

sidebar.addComponent(Button('Section 1'));
sidebar.addComponent(Button('Section 2'));
sidebar.addComponent(Button('Section 3'));
```

```
+----------------+
| [A]            |   ← 1/N height
+----------------+
| [B]            |   ← 1/N height
+----------------+
| [C]            |   ← 1/N height
+----------------+
```

Despite the visual, equal-mode `VBox` is the vertical-equal-share form: every child occupies the same height regardless of its preferred size.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/layout/enumerations/FillType).
- `anchor` — [`AnchorType`](/api/layout/enumerations/AnchorType).
- `weight` — proportional share of the remaining height, honoured only when `mode === "preferred"`.

```typescript
import { FillType } from '@jimka/typescript-ui/layout';
form.addComponent(textField, { fill: FillType.HORIZONTAL });
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setMode("preferred" | "equal")` | Switch the sizing strategy along the vertical axis. |
| `setSpacing(px)` | Gap between children. |
| `setStretching(boolean)` | When `true`, all children fill the column's full width. |

## See also

- [API: VBox](/api/layout/classes/VBox)
- [`HBox`](/layouts/HBox) — horizontal equivalent, with the same `mode` option
- [Layout constraints reference](/layouts/Constraints)
