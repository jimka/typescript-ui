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

[`VBoxOptions`](/api/layout/interfaces/VBoxOptions) accepts `mode`, `spacing`, `stretching`, and `overflowSizing` declaratively. The `setMode` / `setSpacing` / `setStretching` / `setOverflowSizing` setters work for runtime updates.

## Sizing modes

`mode: "preferred"` (default) honours each child's preferred height. Non-weighted children take their preferred sizes; cells carrying a `weight` layout constraint share the remaining height. When the children's preferred heights sum past the container, non-weighted children shrink proportionally toward their min heights.

`mode: "equal"` divides the container's inner height equally among children, clamped to a per-cell floor. `weight` constraints are silently ignored in this mode. `mode` and `stretching` are independent: `"equal"` only equalises the vertical (main-axis) heights. Children keep their preferred width and are left-aligned unless you also pass `stretching: true`, which is what makes every cell fill the column's full width.

While the equal share clears the largest child's min height the column fits and each cell takes that equal share. When it does not — the column overflows — the cell floor depends on `overflowSizing` (see below).

```typescript
import { VBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
// Vertical strip of equally sized, full-width buttons.
const sidebar = Component();
sidebar.setLayoutManager(VBox({ mode: "equal", stretching: true, spacing: 4 }));

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

## Overflow sizing (equal mode)

When an `"equal"`-mode column no longer fits — the equal share would drop below the largest child's min height — what the cells do depends on whether the host scrolls and on `overflowSizing` ([`BoxOverflowSizing`](/api/layout/type-aliases/BoxOverflowSizing)):

- **Host does not scroll** (`Panel.setAutoScroll("none")`, the default): cells clamp to the min-height floor and the host's `overflow: hidden` clips the surplus. `overflowSizing` has no effect.
- **Host scrolls** on the vertical axis (`autoScroll` `"auto"`, `"y"`, or `"both"`): `overflowSizing` chooses the cell height:
  - `"preferred"` (default) — every cell grows to the **tallest child's preferred height**, so cells keep their preferred size and the host scrolls.
  - `"min"` — every cell stays at the **min-height floor** and the host scrolls at the minimum cell size.

```typescript
import { Component, Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
// Scrolls at the tallest child's preferred height once the column overflows.
const col = Panel({ autoScroll: "y" });
col.setLayoutManager(VBox({ mode: "equal", overflowSizing: "preferred" }));
```

This option only applies to `"equal"` mode. In `"preferred"` mode each child already keeps its own preferred height and the host scrolls when their heights sum past the container, so no knob is needed.

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
| `setOverflowSizing("preferred" | "min")` | Equal mode: cell height when an overflowing column scrolls — preferred height or min floor. |

## See also

- [API: VBox](/api/layout/classes/VBox)
- [`HBox`](/layouts/HBox) — horizontal equivalent, with the same `mode` option
- [Layout constraints reference](/layouts/Constraints)
