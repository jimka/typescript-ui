# Column

[`Column`](/api/classes/Column) divides the container width equally among all children and places them left-to-right with a configurable gap. Unlike [`HBox`](/layouts/HBox) (which honours each child's preferred width), `Column` allocates equal slots regardless.

Despite the name, `Column` lays children out **horizontally**. The name describes the column of equally sized slots that result.

```
+--------+--------+--------+
|  [A]   |  [B]   |  [C]   |   ← 1/N width each
+--------+--------+--------+
   each child gets the same width
```

## Usage

```typescript
import { Component, Column, Button } from '@jimka/typescript-ui';

const tabs = new Component();
tabs.setLayoutManager(new Column({ gap: 2 }));

tabs.addComponent(new Button('Files'));
tabs.addComponent(new Button('Edit'));
tabs.addComponent(new Button('Help'));
```

[`ColumnOptions`](/api/interfaces/ColumnOptions) accepts `gap` and `stretching` declaratively; the `setGap` / `setStretching` setters still work for runtime updates.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints) — `fill` and `anchor` apply when a child's preferred size is smaller than its slot.

## Common methods

| Method | Purpose |
| --- | --- |
| `setGap(px)` | Horizontal gap between children. |
| `setStretching(boolean)` | When `true` (default), every child fills the full row height. When `false`, children use their preferred heights and are baseline-aligned within the row. |

## Baseline alignment

By default, `Column` stretches every child to fill the row's full height, so baselines are irrelevant. Call `setStretching(false)` to opt into the same baseline-aware placement that [`HBox`](/layouts/HBox#baseline-alignment) uses: text-bearing children line up by their inner-text baseline, and graphical children (checkboxes, progress bars, etc.) center on the row's text line.

```typescript
const layout = new Column({ stretching: false }); // baseline-align children
```

## When to use it

- A horizontal strip of equally sized buttons or tabs.
- A grid where you only need one row of equal-width cells.

For preferred-width-driven sequencing, use [`HBox`](/layouts/HBox).

## See also

- [API: Column](/api/classes/Column)
- [`Row`](/layouts/Row) — vertical counterpart
- [`HBox`](/layouts/HBox) — horizontal, preferred-width-driven
