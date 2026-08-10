# VBox

[`VBox`](/api/layout/classes/VBox) places children in a single vertical column. A `mode` option selects between honouring each child's preferred height (the default) and dividing the container height equally among children.

```
+----------------+
| [A]            |
| [B]            |
| [C  ]          |
| [D]            |
| [E]            |
+----------------+
   children stacked vertically
```

<!-- demo: vbox-stack -->
> **Live demo** — four labelled panels stacked with `spacing: 8` and
> `stretching: true`.
> [Open the VBox page](https://jimka.github.io/typescript-ui/layouts/VBox)
<!-- /demo -->

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Label, TextField } from '@jimka/typescript-ui/component/input';
const form = Component();
form.setLayoutManager(VBox({ spacing: 8 }));

const nameField  = TextField();
const emailField = TextField();

form.addComponent(Label('Name',  nameField.getId()));
form.addComponent(nameField);
form.addComponent(Label('Email', emailField.getId()));
form.addComponent(emailField);
```

[`VBoxOptions`](/api/layout/interfaces/VBoxOptions) accepts `mode`, `spacing`, `stretching`, `itemAlign`, `overflowSizing`, and `justify` declaratively. The `setMode` / `setComponentSpacing` / `setStretching` / `setItemAlign` / `setOverflowSizing` / `setJustify` setters work for runtime updates.

## Sizing modes

`mode: "preferred"` (default) honours each child's preferred height. Non-weighted children take their preferred sizes; cells carrying a `weight` layout constraint share the remaining height. When the children's preferred heights sum past the container, non-weighted children shrink proportionally toward their min heights.

`mode: "equal"` divides the container's inner height equally among children, clamped to a per-cell floor. `weight` constraints are silently ignored in this mode. `mode` and `stretching` are independent: `"equal"` only equalises the vertical (main-axis) heights. Children keep their preferred width and are left-aligned unless you also pass `stretching: true`, which is what makes every cell fill the column's full width.

While the equal share clears the largest child's min height the column fits and each cell takes that equal share. When it does not — the column overflows — the cell floor depends on `overflowSizing` (see below).

```typescript
import { VBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
// Vertical strip of equally sized, full-width buttons.
const sidebar = Component();
sidebar.setLayoutManager(VBox({ mode: "equal", stretching: true, spacing: 4 }));

sidebar.addComponent(Button('Section 1'));
sidebar.addComponent(Button('Section 2'));
sidebar.addComponent(Button('Section 3'));
```

```
+----------------+
| [A]            |   ← 1/N height
+----------------+
| [B]            |   ← 1/N height
+----------------+
| [C]            |   ← 1/N height
+----------------+
```

Despite the visual, equal-mode `VBox` is the vertical-equal-share form: every child occupies the same height regardless of its preferred size.

<!-- demo: vbox-sizing-modes -->
> **Live demo** — two columns over the same four children: `mode:
> "preferred"` and `mode: "equal"`.
> [Open the VBox page](https://jimka.github.io/typescript-ui/layouts/VBox)
<!-- /demo -->

## Overflow sizing (equal mode)

When an `"equal"`-mode column no longer fits — the equal share would drop below the largest child's min height — what the cells do depends on whether the host scrolls and on `overflowSizing` ([`BoxOverflowSizing`](/api/layout/type-aliases/BoxOverflowSizing)):

- **Host does not scroll** (`Panel.setAutoScroll("none")`, the default): cells clamp to the min-height floor and the host's `overflow: hidden` clips the surplus. `overflowSizing` has no effect.
- **Host scrolls** on the vertical axis (`autoScroll` `"auto"`, `"y"`, or `"both"`): `overflowSizing` chooses the cell height:
  - `"preferred"` (default) — every cell grows to the **tallest child's preferred height**, so cells keep their preferred size and the host scrolls.
  - `"min"` — every cell stays at the **min-height floor** and the host scrolls at the minimum cell size.

```typescript
import { Component, Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
// Scrolls at the tallest child's preferred height once the column overflows.
const col = Panel({ autoScroll: "y" });
col.setLayoutManager(VBox({ mode: "equal", overflowSizing: "preferred" }));
```

This option only applies to `"equal"` mode. In `"preferred"` mode each child already keeps its own preferred height and the host scrolls when their heights sum past the container, so no knob is needed.

## Justify (preferred mode)

In `"preferred"` mode, when the children's combined height is shorter than the inner height and no `weight` cell consumes the slack, that leftover height sits at the bottom by default. `justify` ([`BoxJustify`](/api/layout/type-aliases/BoxJustify)) distributes it instead, mirroring CSS `justify-content`:

- `"start"` (default) — children pack at the top; slack sits below.
- `"center"` — the child block is centred; equal slack above and below.
- `"end"` — children pack at the bottom; slack sits above.
- `"between"` — first child at the top, last at the bottom, slack split evenly into the gaps between them.
- `"around"` — equal space around every child: a half-unit at each end, a full unit between neighbours.

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const stack = Component();
stack.setLayoutManager(VBox({ justify: "center" }));

stack.addComponent(Button('Sign in'));
stack.addComponent(Button('Register'));
```

`justify` is silently ignored when a `weight` cell is present (the weight cell already eats the slack) and when the column fills or overflows the inner height (it clamps to `"start"` so the top child is never pushed out of view). It has no effect in `"equal"` mode, where the cells always tile the full height, and it acts only on the vertical (main) axis — positioning a child within its column width stays the domain of `fill` / `anchor` constraints.

## Item alignment

By default `VBox` places children at the column's west edge, at their preferred width. The `itemAlign` option ([`BoxItemAlign`](/api/layout/type-aliases/BoxItemAlign)) chooses a different cross-axis (horizontal) placement for children that set no explicit per-child align-self:

- `"start"` — left of the column (today's default placement).
- `"center"` — centred in the column width.
- `"end"` — right of the column.
- `"baseline"` (default) — a column exposes no shared cross-axis text baseline, so this degrades to `"start"`, matching [`VFlow`](/layouts/VFlow#item-alignment).
- `"stretch"` — fills the column width. This is what the deprecated `stretching: true` sets under the hood; `stretching` stays as a shorthand for `itemAlign: "stretch"` / `itemAlign: "baseline"`.

```typescript
import { VBox } from '@jimka/typescript-ui/layout';
// Mixed-width controls centre horizontally instead of west-aligning.
column.setLayoutManager(VBox({ itemAlign: "center", spacing: 8 }));
```

A per-child `anchor`/`fill` [align-self](#per-child-cross-axis-alignment-align-self) still overrides `itemAlign` for that one child.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/layout/enumerations/FillType).
- `anchor` — [`AnchorType`](/api/layout/enumerations/AnchorType).
- `weight` — proportional share of the remaining height, honoured only when `mode === "preferred"`.

```typescript
import { FillType } from '@jimka/typescript-ui/layout';
form.addComponent(textField, { fill: FillType.HORIZONTAL });
```

## Per-child cross-axis alignment (align-self)

A single child can override the column's default cross-axis (horizontal) placement without touching its siblings, by setting the **cross component** of its `anchor` or `fill` constraint. This works in both `"preferred"` and `"equal"` mode and mirrors CSS `align-self`. The column's default cross placement is the **leading (west) edge at the child's preferred width**:

- `anchor: AnchorType.WEST` (or the `NORTHWEST` / `SOUTHWEST` corners) — pin the child to the **left** of the column (this matches the default).
- `anchor: AnchorType.EAST` (or `NORTHEAST` / `SOUTHEAST`) — pin the child to the **right** of the column.
- `fill: FillType.HORIZONTAL` (or `FillType.BOTH`) — stretch the child to the **full column width** (align-self: stretch), regardless of the box's column-wide `stretching`.

`AnchorType.CENTER` and the main-axis-only anchors (`NORTH` / `SOUTH`) carry no cross component and are **inert**: the child keeps the column's default `itemAlign` placement (WEST-origin by default — see [Item alignment](#item-alignment) above). Only a west/east anchor edge or a horizontal fill counts as an explicit align-self.

```typescript
import { FillType, AnchorType } from '@jimka/typescript-ui/layout';
// One badge pins right, one rule fills the column width; the rest stay west.
column.addComponent(title);                                      // default: west origin
column.addComponent(badge, { anchor: AnchorType.EAST });         // pinned to the right
column.addComponent(rule,  { fill:   FillType.HORIZONTAL });     // full column width
```

An explicit per-child cross intent overrides the box's global `itemAlign` for that child only: with `itemAlign: "center"`, a child carrying `anchor: AnchorType.EAST` pins to the right of the column while its siblings still centre.

## Baseline alignment

A VBox-managed container reports **its first laid-out child's baseline** as its own (via `getContentBaseline`). So when a column is placed inside a baseline-aware parent — a non-stretching [`HBox`](/layouts/HBox), `HFlow`, or `Grid` — it aligns by its first row's text baseline instead of floating to the row's vertical centre as a baseline-less element would. A two-field login column dropped next to a taller control lines its first field up on the surrounding text baseline.

The first child's baseline is forwarded **verbatim**: if that first child is graphical (returns `null` from `getBaseline()`), the column reports `null` too — it does not scan for a later baseline-bearing child. This differs from `HBox`, which takes the largest baseline across the whole row. Unlike `HBox`, baseline forwarding is **not** disabled by `setStretching(true)`, because a VBox's `stretching` fills the cross (width) axis and leaves each child's height and intrinsic baseline untouched.

## Common methods

| Method | Purpose |
| --- | --- |
| `setMode("preferred" | "equal")` | Switch the sizing strategy along the vertical axis. |
| `setComponentSpacing(px)` | Gap between children. |
| `setItemAlign("start" | "center" | "end" | "baseline" | "stretch")` | Cross-axis (horizontal) placement for children with no per-child align-self; `"baseline"` (the default) degrades to `"start"`. |
| `setStretching(boolean)` | *(deprecated, use `setItemAlign`)* Equivalent to `itemAlign: "stretch"` / `itemAlign: "baseline"`. |
| `setOverflowSizing("preferred" | "min")` | Equal mode: cell height when an overflowing column scrolls — preferred height or min floor. |
| `setJustify("start" | "center" | "end" | "between" | "around")` | Preferred mode: distribute leftover main-axis height along the column. |

## See also

- [API: VBox](/api/layout/classes/VBox)
- [`BoxItemAlign`](/api/layout/type-aliases/BoxItemAlign) — the `itemAlign` option values
- [`HBox`](/layouts/HBox) — horizontal equivalent, with the same `mode` option
- [Layout constraints reference](/layouts/Constraints)
