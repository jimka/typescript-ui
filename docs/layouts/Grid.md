# Grid

[`Grid`](/api/classes/Grid) tiles children in a uniform grid of equal-sized cells. Row and column counts can be set explicitly or left at `0` for auto-calculation.

```
+------+------+------+
|  A   |  B   |  C   |
+------+------+------+
|  D   |  E   |  F   |
+------+------+------+
   uniform M × N grid
```

## Usage

```typescript
import { Component, Grid, Button } from '@jimka/typescript-ui';

const keypad = new Component();
const layout = new Grid();
layout.setRows(4);
layout.setColumns(3);
keypad.setLayoutManager(layout);

['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].forEach(text => {
    keypad.addComponent(new Button(text));
});
```

## Auto-sizing

If you set only one of `setRows` or `setColumns` (leaving the other at `0`), the layout computes the other dimension from the child count. With both at `0`, it picks a near-square arrangement.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints) — `fill` and `anchor` apply when a child's preferred size is smaller than its cell.

## Common methods

| Method | Purpose |
| --- | --- |
| `setRows(n)` / `setColumns(n)` | Explicit grid dimensions. `0` = auto. |

## When to use it

- Calculator / numpad layouts.
- Photo galleries / icon grids.
- Any tabular UI where every cell is the same size.

For variable cell sizes (per-row or per-column), use a [`Border`](/layouts/Border) at top level with [`HBox`](/layouts/HBox) / [`VBox`](/layouts/VBox) inside, or build a [`Table`](/components/Table).

## See also

- [API: Grid](/api/classes/Grid)
- [`Column`](/layouts/Column), [`Row`](/layouts/Row) — single-axis equivalents
- [Layout constraints reference](/layouts/Constraints)
