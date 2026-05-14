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
import { Component } from '@jimka/typescript-ui/core';
import { Grid } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const keypad = new Component();
keypad.setLayoutManager(new Grid({ rows: 4, columns: 3 }));

['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].forEach(text => {
    keypad.addComponent(new Button(text));
});
```

[`GridOptions`](/api/interfaces/GridOptions) accepts `rows`, `columns`, `spacing`, and `stretching` declaratively; the corresponding setters still work for runtime updates.

## Auto-sizing

If you set only one of `setRows` or `setColumns` (leaving the other at `0`), the layout computes the other dimension from the child count. With both at `0`, it picks a near-square arrangement.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints) — `fill` and `anchor` apply when a child's preferred size is smaller than its cell.

## Common methods

| Method | Purpose |
| --- | --- |
| `setRows(n)` / `setColumns(n)` | Explicit grid dimensions. `0` = auto. |
| `setComponentSpacing(px)` | Horizontal and vertical gap between cells. |
| `setStretching(boolean)` | When `true` (default), every child fills its cell. When `false`, cells stay uniformly sized and the grid still fills the container, but children inside each cell use their preferred heights and are baseline-aligned within the row. |

## Baseline alignment

By default, `Grid` makes every cell the same size and stretches children to fill them. Call `setStretching(false)` to keep the uniform cell grid (so the layout still fills its container) but let children inside each row use their preferred heights and baseline-align with each other — the same alignment rules as [`HBox`](/layouts/HBox#baseline-alignment).

```typescript
panel.setLayoutManager(new Grid({
    columns   : 2,
    stretching: false, // per-row baseline alignment
}));

// Useful for label/field form grids:
panel.addComponent(new Text('Name:'));
panel.addComponent(new TextField());
panel.addComponent(new Text('Age:'));
panel.addComponent(new NumberSpinner());
```

## When to use it

- Calculator / numpad layouts (stretching mode).
- Photo galleries / icon grids (stretching mode).
- Form grids where each row should baseline-align label and input (non-stretching mode).
- Any tabular UI where every cell is the same size (stretching mode).

For variable column widths, use a [`Border`](/layouts/Border) at top level with [`HBox`](/layouts/HBox) / [`VBox`](/layouts/VBox) inside, or build a [`Table`](/components/Table).

## See also

- [API: Grid](/api/classes/Grid)
- [`Column`](/layouts/Column), [`Row`](/layouts/Row) — single-axis equivalents
- [Layout constraints reference](/layouts/Constraints)
