# HFlow

[`HFlow`](/api/layout/classes/HFlow) packs children left-to-right at their preferred size and wraps to a new line when the next child would exceed the container's inner width. It is the wrapping counterpart to [`HBox`](/layouts/HBox): where `HBox` keeps every child on one row (shrinking or dividing the width), `HFlow` lets the row overflow into additional lines.

```
+--------------------------+
| [A] [B] [C] [D] [E]      |
| [F] [G] [H]              |   ← wraps when the next child won't fit
+--------------------------+
   items wrap into lines; spacing + lineSpacing configurable
```

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

The same options ([`HFlowOptions`](/api/layout/interfaces/HFlowOptions)) can be passed to set `spacing`, `lineSpacing`, and `uniform` declaratively. The `setComponentSpacing` / `setLineSpacing` / `setUniform` setters work for runtime updates.

## Wrapping

Children are placed at their preferred size (clamped to their own min / max) from the start of the current line. Before each child, `HFlow` checks whether its right edge would pass the container's inner width; if so — and the child is not the first item on the line — the line wraps and the child starts a fresh line below. A child wider than the inner width takes its own line, clamped to the inner width so its right edge stays inside the container.

`HFlow` never shrinks, stretches, or weights its children — wrapping *is* its overflow relief. There is no `mode`, `stretching`, or `weight` knob; for an equal-width single row, use [`HBox`](/layouts/HBox) with `mode: "equal"` instead.

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

## Scrolling

`HFlow` only wraps horizontally; it never overflows sideways. On the vertical axis the stacked lines simply grow downward. When the lines exceed the host's inner height and the host has opted into vertical scroll (`Panel.setAutoScroll`), a vertical scrollbar appears — the children's committed extent drives the scroll, with no special inflation step.

```typescript
import { Component, Panel } from '@jimka/typescript-ui/core';
import { HFlow } from '@jimka/typescript-ui/layout';
// Wraps within the width; scrolls vertically once the lines overflow.
const gallery = Panel({ autoScroll: 'auto' });
gallery.setLayoutManager(HFlow({ spacing: 8, lineSpacing: 8 }));
```

When the host does not scroll, lines past the inner height are clipped by the host's `overflow: hidden`, exactly as a non-scrolling [`HBox`](/layouts/HBox) clips its overflow.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/layout/enumerations/FillType): `NONE` (preferred size, the default `HFlow` placement), `HORIZONTAL`, `VERTICAL`, `BOTH`. A stored constraint on the child takes precedence over `HFlow`'s default `NONE`.
- `anchor` — [`AnchorType`](/api/layout/enumerations/AnchorType): positions the child when its cell is larger than the child — i.e. in a `uniform` mode. Defaults to centre.
- `weight` — ignored; `HFlow` has no fixed line to distribute remainder across.

## Common methods

| Method | Purpose |
| --- | --- |
| `setComponentSpacing(px)` | Horizontal gap between items on a line. |
| `setLineSpacing(px)` | Vertical gap between wrapped lines. |
| `setUniform("none" \| "width" \| "height" \| "both")` | Make cells uniform so wrapped items align into a grid. |

## Baseline alignment

A multi-line wrapped block exposes no single text baseline, so `HFlow` reports a `null` content baseline: a baseline-aware parent auto-centres or top-aligns the whole `HFlow` container rather than aligning it by an interior baseline. Within a non-uniform line each item sits at its own size; in a `uniform` height (or `"both"`) mode items are positioned within the taller shared cell by their anchor (default centre). For baseline-aligned controls on a single row, use [`HBox`](/layouts/HBox).

## See also

- [API: HFlow](/api/layout/classes/HFlow)
- [`FlowUniformity`](/api/layout/type-aliases/FlowUniformity) — the `uniform` option values
- [`HBox`](/layouts/HBox) — single-row horizontal stack with sizing modes
- [Layout constraints reference](/layouts/Constraints)
