# HFlow

[`HFlow`](/api/layout/classes/HFlow) packs children left-to-right at their preferred size and wraps to a new line when the next child would exceed the container's inner width. It is the wrapping counterpart to [`HBox`](/layouts/HBox): where `HBox` keeps every child on one row (shrinking or dividing the width), `HFlow` lets the row overflow into additional lines.

```
+--------------------------+
| [A] [B] [C] [D] [E]      |
| [F] [G] [H]              |   ← wraps when the next child won't fit
+--------------------------+
   items wrap into lines; spacing + lineSpacing configurable
```

<!-- demo: hflow-wrap -->
> **Live demo** — a dozen buttons that reflow into more or fewer rows as
> the pane narrows.
> [Open the HFlow page](https://jimka.github.io/typescript-ui/layouts/HFlow)
<!-- /demo -->

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { HFlow } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const tags = Component();
tags.setLayoutManager(HFlow({ spacing: 6, lineSpacing: 6 }));

tags.addComponent(Button('typescript'));
tags.addComponent(Button('layout'));
tags.addComponent(Button('flow'));
```

The same options ([`HFlowOptions`](/api/layout/interfaces/HFlowOptions)) can be passed to set `spacing`, `lineSpacing`, `uniform`, `align`, `itemAlign`, and `justify` declaratively. The `setComponentSpacing` / `setLineSpacing` / `setUniform` / `setAlign` / `setItemAlign` / `setJustify` setters work for runtime updates.

## Wrapping

Children are placed at their preferred size (clamped to their own min / max) from the start of the current line. Before each child, `HFlow` checks whether its right edge would pass the container's inner width; if so — and the child is not the first item on the line — the line wraps and the child starts a fresh line below. A child wider than the inner width takes its own line, clamped to the inner width so its right edge stays inside the container.

`HFlow` never shrinks or weights its children, and stretches one only on the cross axis when that child asks for it with a `fill` constraint (see [Per-child cross-axis alignment](#per-child-cross-axis-alignment-align-self)) — wrapping *is* its overflow relief otherwise. There is no `mode`, `stretching`, or `weight` knob; for an equal-width single row, use [`HBox`](/layouts/HBox) with `mode: "equal"` instead.

## Spacing

Two independent gaps control the layout:

- `spacing` — the horizontal gap between items on a line (never applied before the first item of a line).
- `lineSpacing` — the vertical gap between wrapped lines (never applied before the first line or after the last).

Both default to `5` pixels.

```typescript
import { HFlow } from '@jimka/typescript-ui/layout';
// Tight item gaps, airier line gaps.
panel.setLayoutManager(HFlow({ spacing: 4, lineSpacing: 12 }));
```

## Column alignment (uniform cells)

By default each item keeps its own width, so columns do not line up between wrapped lines. The `uniform` option ([`FlowUniformity`](/api/layout/type-aliases/FlowUniformity)) grows every cell to the largest item so the items align into a grid:

- `"none"` (default) — each item at its own size; lines pack independently.
- `"width"` — every cell takes the widest item's width, so **columns** align horizontally; each line keeps its own (tallest-item) height.
- `"height"` — every cell takes the tallest item's height, so **rows** align vertically; widths still vary.
- `"both"` — every cell is identical (widest × tallest), a full grid.

```typescript
import { HFlow } from '@jimka/typescript-ui/layout';
// Wrapped items snap into an aligned grid.
panel.setLayoutManager(HFlow({ uniform: "both", spacing: 8, lineSpacing: 8 }));
```

```
+----------------------------+
| [AAAA] [BBBB] [CCCC]       |
| [DDDD] [EEEE]              |   ← uniform: "both" → columns and rows align
+----------------------------+
```

Because a uniform cell is larger than the item it holds, each item is positioned within its cell by its own [`AnchorType`](/api/layout/enumerations/AnchorType) constraint (default centre — see [Per-child constraints](#per-child-constraints)). The widest/tallest extents are measured from each item's preferred size clamped to its own min / max.

## Line alignment

By default each wrapped line packs from the west edge, so the residual space when a line wraps is left empty on the east. The `align` option ([`AxisPosition`](/api/primitive/type-aliases/AxisPosition)) packs each line's content block along the horizontal (main) axis instead:

- `"start"` (default) — content at the west edge; residual on the east (today's behaviour).
- `"center"` — the residual is split, centring each line's content.
- `"end"` — content at the east edge; residual on the west.

```typescript
import { HFlow } from '@jimka/typescript-ui/layout';
// Centre each wrapped line within the available width.
panel.setLayoutManager(HFlow({ align: "center", spacing: 8, lineSpacing: 8 }));
```

```
+----------------------------+
|     [A] [B] [C] [D]        |
|       [E] [F] [G]          |   ← align: "center" → each line centred
+----------------------------+
```

Alignment moves each line's content as a single block. To redistribute the inter-item gaps instead, use `justify` (see [Distribution](#distribution)). `align` is independent of the per-child [`AnchorType`](/api/layout/enumerations/AnchorType), which positions a child *within its own cell* — both apply.

## Item alignment

Within a wrapped row the items can differ in height. By default each item sits at the row's top edge (using its own height), so a short item top-aligns against a tall one. The `itemAlign` option ([`FlowItemAlign`](/api/layout/type-aliases/FlowItemAlign)) positions each item within the **row height** (the line's cross extent) instead:

- `"start"` (default) — top of the row.
- `"center"` — centred in the row height.
- `"end"` — bottom of the row.
- `"baseline"` — items are aligned on their shared text baseline across the row; a graphical (null-baseline) item centres in the text line. When no item in the row reports a baseline this falls back to `"start"`.

```typescript
import { HFlow } from '@jimka/typescript-ui/layout';
// Mixed-height items centre vertically within each row.
panel.setLayoutManager(HFlow({ itemAlign: "center", spacing: 8, lineSpacing: 8 }));
```

```
+----------------------------+
| [A] [bb] [C] [dd]          |   ← short items centred against the tall ones
+----------------------------+
```

`itemAlign` positions the *cell* within the row; the per-child [`AnchorType`](/api/layout/enumerations/AnchorType) still positions the *child* within its cell. In a `uniform` height (or `"both"`) mode every cell already equals the uniform cell height, so `"start"`, `"center"` and `"end"` are visual no-ops there — `"baseline"` is not, because it offsets each item by its own baseline rather than by the cell.

### How tall a row is

`itemAlign` also decides the row's height, which is what the next row is placed below.

| `itemAlign` | Row height |
| --- | --- |
| `"start"`, `"center"`, `"end"` | the tallest cell in the row |
| `"baseline"` | enough to hold the shared baseline plus the deepest descender below it |

The distinction matters only for `"baseline"`, where aligning a high-baseline item with a low-baseline one can push the latter's bottom past the tallest item. The row grows to cover it, so wrapped rows never overlap.

The table says *cell*, not *item*, because a `uniform` height (or `"both"`) mode makes every cell the tallest item in the whole flow rather than the tallest in its own row — so every row is that tall. `"baseline"` can still exceed it, since it offsets each item by its own baseline inside the uniform cell.

## Per-child cross-axis alignment (align-self)

A single child can stretch to fill its wrapped row's full height, ignoring the row's `itemAlign`, by setting the **cross component** of its `fill` constraint. This is the flow's version of CSS `align-self: stretch` under `flex-wrap`, and it mirrors [`HBox`'s per-child align-self](/layouts/HBox#per-child-cross-axis-alignment-align-self):

- `fill: FillType.VERTICAL` (or `FillType.BOTH`) — stretch the child to the **row it wrapped into**, not the container. Overrides `itemAlign` for that child only; the rest of the row keeps its usual placement.

```typescript
import { FillType } from '@jimka/typescript-ui/layout';
// A vertical rule spans whichever row it wraps into.
tags.addComponent(rule, { fill: FillType.VERTICAL });
```

The child's own `maxSize` still caps the stretch — `HFlow` hands over the full row height without clamping it itself. A child alone on a wrapped row still collapses to zero height: a row's cross extent comes from its members, and a lone filled child has no sibling to set one.

`fill` is inert when `uniform` already fixes the row height (`uniform: "height"` or `"both"`): every cell is already that tall, so a cross-filled child changes nothing there — except under `itemAlign: "baseline"`, whose row height (`rowAscent + rowDescent`) can exceed the uniform cell height and still stretch the filled child past it.

The **main component** of `fill` (`HORIZONTAL`/`BOTH` in `HFlow`) is always inert — `HFlow` owns main-axis sizing and wrapping — even under `uniform: "width"` or `"both"`, where the row's cells are wider than an unfilled child's own preferred width. A child stays at its own preferred width there rather than stretching into the uniform cell.

## Distribution

Where `align` moves a line's content as one block, the `justify` option ([`AxisSpread`](/api/primitive/type-aliases/AxisSpread)) spreads a line's items across the inner width by growing the gaps between them:

- `"start"` (default) — items packed with the fixed `spacing`; the residual is handled by `align`.
- `"between"` — first and last items flush to the line's edges, with an equal extra gap between the interior items (CSS `space-between`).
- `"around"` — an equal gap surrounds every item, so the end half-gaps are half the interior gaps (CSS `space-around`).

```typescript
import { HFlow } from '@jimka/typescript-ui/layout';
// Spread each row's items edge-to-edge.
panel.setLayoutManager(HFlow({ justify: "between", spacing: 8, lineSpacing: 8 }));
```

```
+----------------------------+
| [A]    [B]    [C]    [D]    |   ← justify: "between" → ends flush, even gaps
+----------------------------+
```

When `justify` is `"between"` or `"around"` the line fills the inner width, so it **owns the residual** and `align` is ignored. A single-item line or an over-long line (one whose content already exceeds the inner width) degrades to `"start"` spacing, so the gaps are never negative.

## Scrolling

`HFlow` only wraps horizontally; it never overflows sideways. On the vertical axis the stacked lines simply grow downward. When the lines exceed the host's inner height and the host has opted into vertical scroll (`Panel.setAutoScroll`), a vertical scrollbar appears — the children's committed extent drives the scroll, with no special inflation step.

```typescript
import { Component, Panel } from '@jimka/typescript-ui/core';
import { HFlow } from '@jimka/typescript-ui/layout';
// Wraps within the width; scrolls vertically once the lines overflow.
const gallery = Panel({ autoScroll: 'auto' });
gallery.setLayoutManager(HFlow({ spacing: 8, lineSpacing: 8 }));
```

Scrolling is not the only way the lines fit. `HFlow` reports the wrapped height it measured at its last layout as its preferred height, so a parent that honours preferred sizes — a [`VBox`](/layouts/VBox) sizing a child to its content, say — grows the host tall enough for every line and no scrollbar is needed. Scrolling matters when the parent cannot grow, because it is itself constrained.

When the host neither scrolls nor is allowed to grow, lines past the inner height are clipped by the host's `overflow: hidden`, exactly as a non-scrolling [`HBox`](/layouts/HBox) clips its overflow.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/layout/enumerations/FillType): `NONE` (preferred size, the default `HFlow` placement), `HORIZONTAL`, `VERTICAL`, `BOTH`. A stored constraint on the child takes precedence over `HFlow`'s default `NONE`; the cross component (`VERTICAL`/`BOTH`) is a per-child align-self stretch to the row height — see [Per-child cross-axis alignment](#per-child-cross-axis-alignment-align-self).
- `anchor` — [`AnchorType`](/api/layout/enumerations/AnchorType): positions the child when its cell is larger than the child — i.e. in a `uniform` mode. Defaults to centre.
- `weight` — ignored; `HFlow` has no fixed line to distribute remainder across.

## Common methods

| Method | Purpose |
| --- | --- |
| `setComponentSpacing(px)` | Horizontal gap between items on a line. |
| `setLineSpacing(px)` | Vertical gap between wrapped lines. |
| `setUniform("none" \| "width" \| "height" \| "both")` | Make cells uniform so wrapped items align into a grid. |
| `setAlign("start" \| "center" \| "end")` | Pack each line's content at the west edge (default), centred, or the east edge. |
| `setItemAlign("start" \| "center" \| "end" \| "baseline")` | Position each item within its row height (cross axis); `"baseline"` aligns text baselines across the row. |
| `setJustify("start" \| "between" \| "around")` | Distribute each row's items across the inner width by growing the gaps; owns the residual over `align`. |

## Baseline alignment

A multi-line wrapped block exposes no single text baseline, so `HFlow` reports a `null` content baseline: a baseline-aware parent auto-centres or top-aligns the whole `HFlow` container rather than aligning it by an interior baseline. Within a non-uniform line each item sits at its own size; in a `uniform` height (or `"both"`) mode items are positioned within the taller shared cell by their anchor (default centre). To align the items of a single wrapped row on their shared text baseline, use `itemAlign: "baseline"` (see [Item alignment](#item-alignment)); for baseline-aligned controls on a single non-wrapping row, use [`HBox`](/layouts/HBox).

## See also

- [API: HFlow](/api/layout/classes/HFlow)
- [`FlowUniformity`](/api/layout/type-aliases/FlowUniformity) — the `uniform` option values
- [`FlowItemAlign`](/api/layout/type-aliases/FlowItemAlign) — the `itemAlign` option values
- [`AxisSpread`](/api/primitive/type-aliases/AxisSpread) — the `justify` option values
- [`HBox`](/layouts/HBox) — single-row horizontal stack with sizing modes
- [Layout constraints reference](/layouts/Constraints)
