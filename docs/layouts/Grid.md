# Grid

[`Grid`](/api/layout/classes/Grid) tiles children in a uniform grid of equal-sized cells. Row and column counts can be set explicitly or left at `0` for auto-calculation.

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
const keypad = Component();
keypad.setLayoutManager(Grid({ rows: 4, columns: 3 }));

['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].forEach(text => {
    keypad.addComponent(Button(text));
});
```

[`GridOptions`](/api/layout/interfaces/GridOptions) accepts `rows`, `columns`, `spacing`, `stretching`, `columnTracks`, and `rowTracks` declaratively; the corresponding setters still work for runtime updates.

## Auto-sizing

If you set only one of `setRows` or `setColumns` (leaving the other at `0`), the layout computes the other dimension from the child count. With both at `0`, it picks a near-square arrangement.

## Flexible track sizing

By default every column and every row shares the available space equally. Pass [`GridTrack`](/api/layout/interfaces/GridTrack) descriptors to size each track independently. A track is one of three modes:

- `"weight"` — takes a proportional share of the space left after fixed and content tracks (`value` is the weight).
- `"fixed"` — exactly `value` pixels.
- `"content"` — sizes to its children, using `max(preferred, min)` so a child that only set a min size still widens the track.

```typescript
panel.setLayoutManager(Grid({
    columns     : 3,
    columnTracks: [
        { mode: "fixed",  value: 120 },  // column 0 is exactly 120px
        { mode: "weight", value: 1 },    // column 1 absorbs the remaining width
        { mode: "content" },             // column 2 hugs its content
    ],
}));
```

`setRowTracks` works the same way for rows. When fewer tracks are supplied than the grid has columns/rows, the missing tracks default to `{ mode: "weight", value: 1 }`. If no track carries weight, leftover space is left unused (cells pack to the top-left).

## Cell spanning and explicit placement

Pass a [`GridConstraints`](/api/layout/classes/GridConstraints) per child to make it span a rectangular block or pin it to an exact cell:

```typescript
const span = new GridConstraints();
span.colSpan = 2;
span.rowSpan = 2;
panel.addComponent(Button("2x2"), span);   // occupies a 2x2 block

const pinned = new GridConstraints();
pinned.col = 2;
pinned.row = 0;
panel.addComponent(Button("top-right"), pinned);
```

Explicitly-placed children (those declaring `col` and/or `row`) are reserved first; the remaining children auto-flow into the free cells around them. A child counts as explicitly placed if **either** axis is set — the missing axis defaults to `0`. `col`/`row` and `colSpan`/`rowSpan` clamp to the grid bounds. When two explicit children overlap, the later one (in document order) wins the contested cells and a `console.warn` names the conflict.

## Clip instead of spill

When a child's minimum size exceeds the cell block assigned to it (for example, a wide button in a narrow `"fixed"` column), the grid wraps the child in a cell-sized clip frame with `overflow: hidden`, so the child is clipped at the cell edge rather than spilling into neighbours — the child keeps its own (min-floored) box; the frame does the clipping. A child in a `"content"` track is never clipped — the track grows to fit it.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints) — `fill` and `anchor` apply when a child's preferred size is smaller than its cell. [`GridConstraints`](/api/layout/classes/GridConstraints) additionally carries `col`/`row` (explicit placement) and `colSpan`/`rowSpan` (cell spanning).

## Common methods

| Method | Purpose |
| --- | --- |
| `setRows(n)` / `setColumns(n)` | Explicit grid dimensions. `0` = auto. |
| `setComponentSpacing(px)` | Horizontal and vertical gap between cells. |
| `setStretching(boolean)` | When `true` (default), every child fills its cell. When `false`, cells stay uniformly sized and the grid still fills the container, but children inside each cell use their preferred heights and are baseline-aligned within the row. |
| `setColumnTracks(tracks)` / `setRowTracks(tracks)` | Per-axis [`GridTrack`](/api/layout/interfaces/GridTrack) sizing (weight / fixed / content). |

## Baseline alignment

By default, `Grid` makes every cell the same size and stretches children to fill them. Call `setStretching(false)` to keep the uniform cell grid (so the layout still fills its container) but let children inside each row use their preferred heights and baseline-align with each other — the same alignment rules as [`HBox`](/layouts/HBox#baseline-alignment).

```typescript
panel.setLayoutManager(Grid({
    columns   : 2,
    stretching: false, // per-row baseline alignment
}));

// Useful for label/field form grids:
panel.addComponent(Text('Name:'));
panel.addComponent(TextField());
panel.addComponent(Text('Age:'));
panel.addComponent(NumberSpinner());
```

## When to use it

- Calculator / numpad layouts (stretching mode).
- Photo galleries / icon grids (stretching mode).
- Form grids where each row should baseline-align label and input (non-stretching mode).
- Any tabular UI where every cell is the same size (stretching mode).
- Dashboards with mixed fixed / fluid / content columns and spanning tiles (track sizing).

For variable column widths, use `columnTracks` / `rowTracks`, or build a [`Table`](/components/Table) for true tabular data.

## See also

- [API: Grid](/api/layout/classes/Grid)
- [API: GridTrack](/api/layout/interfaces/GridTrack), [API: GridConstraints](/api/layout/classes/GridConstraints)
- [`HBox`](/layouts/HBox), [`VBox`](/layouts/VBox) — single-axis equivalents (use `mode: "equal"` for the equal-share layout)
- [Layout constraints reference](/layouts/Constraints)
