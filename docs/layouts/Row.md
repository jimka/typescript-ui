# Row

[`Row`](/api/layout/classes/Row) divides the container height equally among all children and places them top-to-bottom with a configurable gap. Unlike [`VBox`](/layouts/VBox) (which honours each child's preferred height), `Row` allocates equal slots regardless.

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
import { Component } from '@jimka/typescript-ui/core';
import { Row } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const sidebar = new Component();
sidebar.setLayoutManager(new Row({ gap: 4 }));

sidebar.addComponent(new Button('Section 1'));
sidebar.addComponent(new Button('Section 2'));
sidebar.addComponent(new Button('Section 3'));
```

[`RowOptions`](/api/layout/interfaces/RowOptions) accepts `gap` declaratively; the `setGap` setter still works for runtime updates.

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

- [API: Row](/api/layout/classes/Row)
- [`Column`](/layouts/Column) — horizontal counterpart
- [`VBox`](/layouts/VBox) — vertical, preferred-height-driven
