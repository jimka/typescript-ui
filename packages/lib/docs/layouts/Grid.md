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

<!-- demo: grid-tracks -->
> **Live demo** — a 3-column grid with fixed, weight, and content column
> tracks; resizing the pane moves only the weighted column.
> [Open the Grid page](https://jimka.github.io/typescript-ui/layouts/Grid)
<!-- /demo -->

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

[`GridOptions`](/api/layout/interfaces/GridOptions) accepts `rows`, `columns`, `spacing`, `defaultFill`, `defaultAnchor`, `baselineAlign`, `columnTracks`, and `rowTracks` declaratively; the corresponding setters still work for runtime updates.

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

When a child's minimum size exceeds the cell block assigned to it (for example, a wide button in a narrow `"fixed"` column), the grid wraps the child in a cell-sized clip frame with `overflow: hidden`, so the child is clipped at the cell edge rather than spilling into neighbours. The clip is per-axis: on the axis that overflows, the child renders at its natural extent (its preferred size, falling back to its minimum) so the content shows at full size up to the clip edge; on the axis that still fits, the child keeps its normal [fill/anchor](#per-child-fill-and-anchor) placement — so a `FillType.BOTH` child clipped horizontally still fills its cell vertically. A child in a `"content"` track is never clipped — the track grows to fit it.

## Per-child fill and anchor

Every cell is sized by its tracks; how a child sits *inside* its cell is driven by `fill` and `anchor`. The grid supplies defaults — `defaultFill` (initially [`FillType.BOTH`](/api/layout/enumerations/FillType), so children fill their cells out of the box) and `defaultAnchor` (initially [`AnchorType.CENTER`](/api/layout/enumerations/AnchorType)) — and each child overrides them through its own [`GridConstraints`](/api/layout/classes/GridConstraints) `fill`/`anchor`:

```typescript
panel.setLayoutManager(Grid({ columns: 3 })); // defaultFill = FillType.BOTH

const shrink = new GridConstraints();
shrink.fill   = FillType.NONE;          // opt out of the grid default
shrink.anchor = AnchorType.SOUTHEAST;   // park at the cell's SE corner
panel.addComponent(Button("no fill"), shrink);
```

A child with `fill = FillType.NONE` shrinks to its preferred size and parks at its `anchor`; a child that leaves `fill` unset inherits `defaultFill`. Set `defaultFill: FillType.NONE` to flip the whole grid to preferred-size placement while still letting individual children opt back into filling.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints) — `fill` and `anchor` (see above) override the grid's `defaultFill`/`defaultAnchor` per child. [`GridConstraints`](/api/layout/classes/GridConstraints) additionally carries `col`/`row` (explicit placement) and `colSpan`/`rowSpan` (cell spanning).

## Common methods

| Method | Purpose |
| --- | --- |
| `setRows(n)` / `setColumns(n)` | Explicit grid dimensions. `0` = auto. |
| `setComponentSpacing(px)` | Horizontal and vertical gap between cells. |
| `setDefaultFill(FillType)` | Grid-wide fill for children without their own `fill`. Default [`FillType.BOTH`](/api/layout/enumerations/FillType) (children fill their cells). |
| `setDefaultAnchor(AnchorType)` | Grid-wide anchor for non-filling children without their own `anchor`. Default [`AnchorType.CENTER`](/api/layout/enumerations/AnchorType). |
| `setBaselineAlign(boolean)` | When `true`, columns stay uniform-width but each row uses its children's preferred heights and baseline-aligns them. Default `false`. |
| `setColumnTracks(tracks)` / `setRowTracks(tracks)` | Per-axis [`GridTrack`](/api/layout/interfaces/GridTrack) sizing (weight / fixed / content). |

## Baseline alignment

By default, `Grid` makes every cell the same size and (via `defaultFill = FillType.BOTH`) stretches children to fill them. Set `baselineAlign: true` to keep the uniform cell grid (so the layout still fills its container) but let children inside each row use their preferred heights and baseline-align with each other — the same alignment rules as [`HBox`](/layouts/HBox#baseline-alignment). This is orthogonal to `defaultFill`: baseline alignment owns the vertical axis while fill/anchor still drive the horizontal axis.

```typescript
panel.setLayoutManager(Grid({
    columns      : 2,
    baselineAlign: true, // per-row baseline alignment
}));

// Useful for label/field form grids:
panel.addComponent(Text('Name:'));
panel.addComponent(TextField());
panel.addComponent(Text('Age:'));
panel.addComponent(NumberSpinner());
```

## When to use it

- Calculator / numpad layouts (default fill).
- Photo galleries / icon grids (default fill).
- Form grids where each row should baseline-align label and input (`baselineAlign: true`).
- Any tabular UI where every cell is the same size (default fill).
- Dashboards with mixed fixed / fluid / content columns and spanning tiles (track sizing).

For variable column widths, use `columnTracks` / `rowTracks`, or build a [`Table`](/components/Table) for true tabular data.

## See also

- [API: Grid](/api/layout/classes/Grid)
- [API: GridTrack](/api/layout/interfaces/GridTrack), [API: GridConstraints](/api/layout/classes/GridConstraints)
- [`HBox`](/layouts/HBox), [`VBox`](/layouts/VBox) — single-axis equivalents (use `mode: "equal"` for the equal-share layout)
- [Layout constraints reference](/layouts/Constraints)
