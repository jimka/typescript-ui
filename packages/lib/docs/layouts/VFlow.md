# VFlow

[`VFlow`](/api/layout/classes/VFlow) packs children top-to-bottom at their preferred size and wraps to a new column when the next child would exceed the container's inner height. It is the vertical transpose of [`HFlow`](/layouts/HFlow): where `HFlow` fills rows left-to-right and wraps downward, `VFlow` fills columns top-to-bottom and wraps rightward. Like `HFlow` it never shrinks a child — wrapping *is* its overflow relief — and stretches one only on the cross axis, and only when that child asks for it with a cross-axis `fill`.

```
+----------------------+
| [A]  [E]  [H]        |
| [B]  [F]            |   ← wraps to a new column when the next child won't fit
| [C]  [G]            |
| [D]                 |
+----------------------+
   items wrap into columns; spacing + lineSpacing configurable
```

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { VFlow } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const tags = Component();
tags.setLayoutManager(VFlow({ spacing: 6, lineSpacing: 6 }));

tags.addComponent(Button('typescript'));
tags.addComponent(Button('layout'));
tags.addComponent(Button('flow'));
```

The same options ([`VFlowOptions`](/api/layout/interfaces/VFlowOptions)) can be passed to set `spacing`, `lineSpacing`, `uniform`, `align`, `itemAlign`, and `justify` declaratively. The `setComponentSpacing` / `setLineSpacing` / `setUniform` / `setAlign` / `setItemAlign` / `setJustify` setters work for runtime updates.

## Wrapping

Children are placed at their preferred size (clamped to their own min / max) from the top of the current column. Before each child, `VFlow` checks whether its bottom edge would pass the container's inner height; if so — and the child is not the first item in the column — the column wraps and the child starts a fresh column to the right. A child taller than the inner height takes its own column, clamped to the inner height so its bottom edge stays inside the container.

`VFlow` never shrinks or weights its children, and stretches one only on the cross axis when that child asks for it with a `fill` constraint (see [Per-child cross-axis alignment](#per-child-cross-axis-alignment-align-self)). There is no `mode`, `stretching`, or `weight` knob; for an equal-height single column, use [`VBox`](/layouts/VBox) with `mode: "equal"` instead.

## Spacing

Two independent gaps control the layout — the same fields as `HFlow`, transposed:

- `spacing` — the **vertical** gap between items in a column (never applied before the first item of a column).
- `lineSpacing` — the **horizontal** gap between wrapped columns (never applied before the first column or after the last).

Both default to `5` pixels.

```typescript
import { VFlow } from '@jimka/typescript-ui/layout';
// Tight item gaps, airier column gaps.
panel.setLayoutManager(VFlow({ spacing: 4, lineSpacing: 12 }));
```

## Row alignment (uniform cells)

By default each item keeps its own height, so rows do not line up between wrapped columns. The `uniform` option ([`FlowUniformity`](/api/layout/type-aliases/FlowUniformity)) grows every cell to the largest item so the items align into a grid:

- `"none"` (default) — each item at its own size; columns pack independently.
- `"width"` — every cell takes the widest item's width, so **columns** align horizontally.
- `"height"` — every cell takes the tallest item's height, so **rows** align vertically.
- `"both"` — every cell is identical (widest × tallest), a full grid.

```typescript
import { VFlow } from '@jimka/typescript-ui/layout';
// Wrapped items snap into an aligned grid.
panel.setLayoutManager(VFlow({ uniform: "both", spacing: 8, lineSpacing: 8 }));
```

Because a uniform cell is larger than the item it holds, each item is positioned within its cell by its own [`AnchorType`](/api/layout/enumerations/AnchorType) constraint (default centre — see [Per-child constraints](#per-child-constraints)). The widest/tallest extents are measured from each item's preferred size clamped to its own min / max.

## Column alignment

By default each wrapped column packs from the north edge, so the residual space when a column wraps is left empty at the bottom. The `align` option ([`AxisPosition`](/api/primitive/type-aliases/AxisPosition)) packs each column's content block along the vertical (main) axis instead:

- `"start"` (default) — content at the north edge; residual at the south.
- `"center"` — the residual is split, centring each column's content.
- `"end"` — content at the south edge; residual at the north.

```typescript
import { VFlow } from '@jimka/typescript-ui/layout';
// Centre each wrapped column within the available height.
panel.setLayoutManager(VFlow({ align: "center", spacing: 8, lineSpacing: 8 }));
```

Alignment moves each column's content as a single block. To redistribute the inter-item gaps instead, use `justify` (see [Distribution](#distribution)). `align` is independent of the per-child [`AnchorType`](/api/layout/enumerations/AnchorType), which positions a child *within its own cell* — both apply.

## Item alignment

Within a wrapped column the items can differ in width. By default each item sits at the column's left edge (using its own width), so a narrow item left-aligns against a wide one. The `itemAlign` option ([`FlowItemAlign`](/api/layout/type-aliases/FlowItemAlign)) positions each item within the **column width** (the line's cross extent) instead:

- `"start"` (default) — left of the column.
- `"center"` — centred in the column width.
- `"end"` — right of the column.
- `"baseline"` — a column exposes no shared text baseline, so this degrades to `"start"`. (The baseline mode is meaningful only for [`HFlow`](/layouts/HFlow) rows.)

```typescript
import { VFlow } from '@jimka/typescript-ui/layout';
// Mixed-width items centre horizontally within each column.
panel.setLayoutManager(VFlow({ itemAlign: "center", spacing: 8, lineSpacing: 8 }));
```

`itemAlign` positions the *cell* within the column; the per-child [`AnchorType`](/api/layout/enumerations/AnchorType) still positions the *child* within its cell. In a `uniform` width (or `"both"`) mode every cell already equals the column width, so `itemAlign` is a visual no-op there.

## Per-child cross-axis alignment (align-self)

A single child can stretch to fill its wrapped column's full width, ignoring the column's `itemAlign`, by setting the **cross component** of its `fill` constraint. This is the flow's version of CSS `align-self: stretch` under `flex-wrap`, and it mirrors [`HFlow`'s per-child align-self](/layouts/HFlow#per-child-cross-axis-alignment-align-self):

- `fill: FillType.HORIZONTAL` (or `FillType.BOTH`) — stretch the child to the **column it wrapped into**, not the container. Overrides `itemAlign` for that child only; the rest of the column keeps its usual placement.

```typescript
import { FillType } from '@jimka/typescript-ui/layout';
// A horizontal rule spans whichever column it wraps into.
tags.addComponent(rule, { fill: FillType.HORIZONTAL });
```

The child's own `maxSize` still caps the stretch — `VFlow` hands over the full column width without clamping it itself. A child alone on a wrapped column still collapses to zero width: a column's cross extent comes from its members, and a lone filled child has no sibling to set one.

`fill` is inert when `uniform` already fixes the column width (`uniform: "width"` or `"both"`): every cell is already that wide, so a cross-filled child changes nothing there.

The **main component** of `fill` (`VERTICAL`/`BOTH` in `VFlow`) is always inert — `VFlow` owns main-axis sizing and wrapping — even under `uniform: "height"` or `"both"`, where the column's cells are taller than an unfilled child's own preferred height. A child stays at its own preferred height there rather than stretching into the uniform cell.

## Distribution

Where `align` moves a column's content as one block, the `justify` option ([`AxisSpread`](/api/primitive/type-aliases/AxisSpread)) spreads a column's items across the inner height by growing the gaps between them:

- `"start"` (default) — items packed with the fixed `spacing`; the residual is handled by `align`.
- `"between"` — first and last items flush to the column's edges, with an equal extra gap between the interior items (CSS `space-between`).
- `"around"` — an equal gap surrounds every item, so the end half-gaps are half the interior gaps (CSS `space-around`).

```typescript
import { VFlow } from '@jimka/typescript-ui/layout';
// Spread each column's items top-to-bottom.
panel.setLayoutManager(VFlow({ justify: "around", spacing: 8, lineSpacing: 8 }));
```

When `justify` is `"between"` or `"around"` the column fills the inner height, so it **owns the residual** and `align` is ignored. A single-item column or an over-long column (one whose content already exceeds the inner height) degrades to `"start"` spacing, so the gaps are never negative.

## Scrolling

`VFlow` only wraps vertically; it never overflows downward past the inner height. On the horizontal axis the columns simply grow rightward. When the columns exceed the host's inner width and the host has opted into horizontal scroll (`Panel.setAutoScroll`), a horizontal scrollbar appears — the children's committed extent drives the scroll, with no special inflation step.

```typescript
import { Component, Panel } from '@jimka/typescript-ui/core';
import { VFlow } from '@jimka/typescript-ui/layout';
// Wraps within the height; scrolls horizontally once the columns overflow.
const gallery = Panel({ autoScroll: 'auto' });
gallery.setLayoutManager(VFlow({ spacing: 8, lineSpacing: 8 }));
```

Scrolling is not the only way the columns fit. `VFlow` reports the wrapped width it measured at its last layout as its preferred width, so a parent that honours preferred sizes — an [`HBox`](/layouts/HBox) sizing a child to its content, say — grows the host wide enough for every column and no scrollbar is needed. Scrolling matters when the parent cannot grow, because it is itself constrained.

When the host neither scrolls nor is allowed to grow, columns past the inner width are clipped by the host's `overflow: hidden`, exactly as a non-scrolling [`VBox`](/layouts/VBox) clips its overflow.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/layout/enumerations/FillType): `NONE` (preferred size, the default `VFlow` placement), `HORIZONTAL`, `VERTICAL`, `BOTH`. A stored constraint on the child takes precedence over `VFlow`'s default `NONE`; the cross component (`HORIZONTAL`/`BOTH`) is a per-child align-self stretch to the column width — see [Per-child cross-axis alignment](#per-child-cross-axis-alignment-align-self).
- `anchor` — [`AnchorType`](/api/layout/enumerations/AnchorType): positions the child when its cell is larger than the child — i.e. in a `uniform` mode. Defaults to centre.
- `weight` — ignored; `VFlow` has no fixed column to distribute remainder across.

## Common methods

| Method | Purpose |
| --- | --- |
| `setComponentSpacing(px)` | Vertical gap between items in a column. |
| `setLineSpacing(px)` | Horizontal gap between wrapped columns. |
| `setUniform("none" \| "width" \| "height" \| "both")` | Make cells uniform so wrapped items align into a grid. |
| `setAlign("start" \| "center" \| "end")` | Pack each column's content at the north edge (default), centred, or the south edge. |
| `setItemAlign("start" \| "center" \| "end" \| "baseline")` | Position each item within its column width (cross axis); `"baseline"` degrades to `"start"` (no shared baseline). |
| `setJustify("start" \| "between" \| "around")` | Distribute each column's items across the inner height by growing the gaps; owns the residual over `align`. |

## Baseline alignment

A multi-column wrapped block exposes no single text baseline, so `VFlow` reports a `null` content baseline: a baseline-aware parent auto-centres or top-aligns the whole `VFlow` container rather than aligning it by an interior baseline. A column's cross axis is width, which has no text baseline, so `itemAlign: "baseline"` degrades to `"start"`. For baseline-aligned controls on a single row, use [`HBox`](/layouts/HBox).

## See also

- [API: VFlow](/api/layout/classes/VFlow)
- [`AxisPosition`](/api/primitive/type-aliases/AxisPosition) — the `align` option values
- [`FlowUniformity`](/api/layout/type-aliases/FlowUniformity) — the `uniform` option values
- [`FlowItemAlign`](/api/layout/type-aliases/FlowItemAlign) — the `itemAlign` option values
- [`AxisSpread`](/api/primitive/type-aliases/AxisSpread) — the `justify` option values
- [`HFlow`](/layouts/HFlow) — the horizontal-wrapping counterpart
- [`VBox`](/layouts/VBox) — single-column vertical stack with sizing modes
- [Layout constraints reference](/layouts/Constraints)
