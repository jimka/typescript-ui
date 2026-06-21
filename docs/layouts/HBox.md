# HBox

[`HBox`](/api/layout/classes/HBox) places children in a single horizontal row. A `mode` option selects between honouring each child's preferred width (the default) and dividing the container width equally among children.

```
+--------------------------+
| [A] [B]  [C  ] [D] [E]   |
+--------------------------+
   children in a row, configurable spacing
```

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const toolbar = Component();
toolbar.setLayoutManager(HBox({ spacing: 8 }));

toolbar.addComponent(Button('Cut'));
toolbar.addComponent(Button('Copy'));
toolbar.addComponent(Button('Paste'));
```

The same options ([`HBoxOptions`](/api/layout/interfaces/HBoxOptions)) can be passed to set `mode`, `spacing`, `stretching`, `overflowSizing`, and `justify` declaratively. The `setMode` / `setSpacing` / `setStretching` / `setOverflowSizing` / `setJustify` setters work for runtime updates.

## Sizing modes

`mode: "preferred"` (default) honours each child's preferred width. Non-weighted children take their preferred sizes; cells carrying a `weight` layout constraint share the remaining width. When the children's preferred widths sum past the container, non-weighted children shrink proportionally toward their min widths.

`mode: "equal"` divides the container's inner width equally among children, clamped to a per-cell floor. `weight` constraints are silently ignored in this mode. `mode` and `stretching` are independent: `"equal"` only equalises the horizontal (main-axis) widths. Children keep their preferred height and are baseline-aligned unless you also pass `stretching: true`, which is what makes every cell fill the row's full height.

While the equal share clears the largest child's min width the row fits and each cell takes that equal share. When it does not — the row overflows — the cell floor depends on `overflowSizing` (see below).

```typescript
import { HBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
// Equal-share row, no vertical stretching → baseline-aligned children.
const tabs = Component();
tabs.setLayoutManager(HBox({ mode: "equal", stretching: false, spacing: 2 }));

tabs.addComponent(Button('Files'));
tabs.addComponent(Button('Edit'));
tabs.addComponent(Button('Help'));
```

```
+--------+--------+--------+
|  [A]   |  [B]   |  [C]   |   ← 1/N width each (mode: "equal")
+--------+--------+--------+
```

Despite the name, equal-mode `HBox` is the horizontal-equal-share form: every child occupies the same width regardless of its preferred size.

## Overflow sizing (equal mode)

When an `"equal"`-mode row no longer fits — the equal share would drop below the largest child's min width — what the cells do depends on whether the host scrolls and on `overflowSizing` ([`BoxOverflowSizing`](/api/layout/type-aliases/BoxOverflowSizing)):

- **Host does not scroll** (`Panel.setAutoScroll("none")`, the default): cells clamp to the min-width floor and the host's `overflow: hidden` clips the surplus. `overflowSizing` has no effect.
- **Host scrolls** on the horizontal axis (`autoScroll` `"auto"`, `"x"`, or `"both"`): `overflowSizing` chooses the cell width:
  - `"preferred"` (default) — every cell grows to the **widest child's preferred width**, so cells keep their preferred size and the host scrolls.
  - `"min"` — every cell stays at the **min-width floor** and the host scrolls at the minimum cell size.

```typescript
import { Component, Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
// Scrolls at the widest child's preferred width once the row overflows.
const row = Panel({ autoScroll: "x" });
row.setLayoutManager(HBox({ mode: "equal", overflowSizing: "preferred" }));
```

This option only applies to `"equal"` mode. In `"preferred"` mode each child already keeps its own preferred width and the host scrolls when their widths sum past the container, so no knob is needed.

## Justify (preferred mode)

In `"preferred"` mode, when the children's combined width is shorter than the inner width and no `weight` cell consumes the slack, that leftover width sits at the trailing edge by default. `justify` ([`BoxJustify`](/api/layout/type-aliases/BoxJustify)) distributes it instead, mirroring CSS `justify-content`:

- `"start"` (default) — children pack at the leading (west) edge; slack sits east.
- `"center"` — the child block is centred; equal slack on both sides.
- `"end"` — children pack at the trailing (east) edge; slack sits west.
- `"between"` — first child west, last child east, slack split evenly into the gaps between them.
- `"around"` — equal space around every child: a half-unit at each end, a full unit between neighbours.

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const bar = Component();
bar.setLayoutManager(HBox({ justify: "between" }));

bar.addComponent(Button('Back'));
bar.addComponent(Button('Next'));
```

`justify` is silently ignored when a `weight` cell is present (the weight cell already eats the slack) and when the row fills or overflows the inner width (it clamps to `"start"` so the leading child is never pushed out of view). It has no effect in `"equal"` mode, where the cells always tile the full width, and it acts only on the horizontal (main) axis — positioning a child within its row height stays the domain of `fill` / `anchor` constraints.

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/layout/enumerations/FillType): `NONE` (preferred size), `HORIZONTAL`, `VERTICAL`, `BOTH`.
- `anchor` — [`AnchorType`](/api/layout/enumerations/AnchorType): used when the cell is larger than the child.
- `weight` — proportional share of the remaining width, honoured only when `mode === "preferred"`.

```typescript
import { FillType, AnchorType } from '@jimka/typescript-ui/layout';
toolbar.addComponent(button, {
    fill:   FillType.VERTICAL,    // stretch to row height
    anchor: AnchorType.CENTER,    // center horizontally within its slot
});
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setMode("preferred" | "equal")` | Switch the sizing strategy along the horizontal axis. |
| `setSpacing(px)` | Gap between children. |
| `setStretching(boolean)` | When `true`, all children fill the row's full height. |
| `setOverflowSizing("preferred" | "min")` | Equal mode: cell width when an overflowing row scrolls — preferred width or min floor. |
| `setJustify("start" | "center" | "end" | "between" | "around")` | Preferred mode: distribute leftover main-axis width along the row. |

## Baseline alignment

When children of mixed heights share a row (e.g. a `Text` label next to a `TextField`, `Button`, `ComboBox`, `Checkbox`, or `ProgressBar`), `HBox` aligns them by their visual baseline — the same way CSS `vertical-align` aligns inline-block elements.

Each component reports a baseline via `getBaseline()`:

- Text-bearing components (`Text`, `Label`, `Button`, `TextField`, `ComboBox`, `NumberSpinner`, …) return their inner-text baseline (font ascent), measured from the top of the component. `HBox` lines up these baselines.
- Graphical / replaced components (`ProgressBar`, `Image`, `Slider`, `Checkbox`, the inner radio of `RadioButton`, …) return `null`. `HBox` treats them like CSS `vertical-align: middle`: their **vertical center sits on the row baseline**, so a radio circle or checkbox aligns nicely with the surrounding text rather than sitting on top of the line.

`HBox` picks the largest reported baseline in the row, augments it with half the tallest null-baseline child (so a tall graphical control like `ProgressSpinner` doesn't push the row off-screen), and offsets each child so the rule above holds. The row's preferred height grows to `ascent + descent` where `ascent` and `descent` each take the larger of the text-baseline contribution and the null-child half-height.

If no child reports a baseline, `HBox` falls back to the legacy top-aligned layout. Baseline alignment is also skipped when `setStretching(true)` is enabled, since stretching forces every child to fill the row vertically and there is no shared baseline to align.

In `mode: "equal"` baseline alignment kicks in only when `stretching` is `false` (the default); passing `stretching: true` instead stretches every child to the row's full height.

## See also

- [API: HBox](/api/layout/classes/HBox)
- [`VBox`](/layouts/VBox) — vertical equivalent, with the same `mode` option
- [Layout constraints reference](/layouts/Constraints)
