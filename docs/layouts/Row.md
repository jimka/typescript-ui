# Row

[`Row`](/api/classes/Row) divides the container height equally among all children and places them top-to-bottom with a configurable gap. Unlike [`VBox`](/layouts/VBox) (which honours each child's preferred height), `Row` allocates equal slots regardless.

Despite the name, `Row` lays children out **vertically**. The name describes the row of equally sized slots that result.

```
+----------------+
| [A]            |   ← 1/N height
+----------------+
| [B]            |   ← 1/N height
+----------------+
| [C]            |   ← 1/N height
+----------------+
   each child gets the same height
```

## Usage

```typescript
import { Component, Row, Button } from '@jimka/typescript-ui';

const sidebar = new Component();
const layout  = new Row();
layout.setGap(4);
sidebar.setLayoutManager(layout);

sidebar.addComponent(new Button('Section 1'));
sidebar.addComponent(new Button('Section 2'));
sidebar.addComponent(new Button('Section 3'));
```

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints) — `fill` and `anchor` apply when a child's preferred size is smaller than its slot.

## Common methods

| Method | Purpose |
| --- | --- |
| `setGap(px)` | Vertical gap between children. |

## When to use it

- A vertical strip of equally sized buttons (segmented control).
- Equally divided panels where you don't want preferred-height variance.

For preferred-height-driven stacking, use [`VBox`](/layouts/VBox).

## See also

- [API: Row](/api/classes/Row)
- [`Column`](/layouts/Column) — horizontal counterpart
- [`VBox`](/layouts/VBox) — vertical, preferred-height-driven
