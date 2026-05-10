# HBox

[`HBox`](/api/classes/HBox) places children in a single horizontal row, using each child's preferred width. An optional stretching mode expands children vertically to fill the row's height.

```
+--------------------------+
| [A] [B]  [C  ] [D] [E]   |
+--------------------------+
   children in a row, configurable spacing
```

## Usage

```typescript
import { Component, HBox, Button } from '@jimka/typescript-ui';

const toolbar = new Component();
const layout  = new HBox();
layout.setSpacing(8);
toolbar.setLayoutManager(layout);

toolbar.addComponent(new Button('Cut'));
toolbar.addComponent(new Button('Copy'));
toolbar.addComponent(new Button('Paste'));
```

## Per-child constraints

[`LayoutConstraints`](/layouts/Constraints):

- `fill` — [`FillType`](/api/enumerations/FillType): `NONE` (preferred size), `HORIZONTAL`, `VERTICAL`, `BOTH`.
- `anchor` — [`AnchorType`](/api/enumerations/AnchorType): used when the cell is larger than the child.

```typescript
import { FillType, AnchorType } from '@jimka/typescript-ui';

toolbar.addComponent(button, {
    fill:   FillType.VERTICAL,    // stretch to row height
    anchor: AnchorType.CENTER,    // center horizontally within its slot
});
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setSpacing(px)` | Gap between children. |
| `setStretching(boolean)` | When `true`, all children fill the row's full height. |

## Baseline alignment

When children of mixed heights share a row (e.g. a `Text` label next to a `TextField`, `Button`, `ComboBox`, `Checkbox`, or `ProgressBar`), `HBox` aligns them by their visual baseline — the same way CSS `vertical-align` aligns inline-block elements.

Each component reports a baseline via `getBaseline()`:

- Text-bearing components (`Text`, `Label`, `Button`, `TextField`, `ComboBox`, `NumberSpinner`, …) return their inner-text baseline (font ascent), measured from the top of the component. `HBox` lines up these baselines.
- Graphical / replaced components (`ProgressBar`, `Image`, `Slider`, `Checkbox`, the inner radio of `RadioButton`, …) return `null`. `HBox` treats them like CSS `vertical-align: middle`: their **vertical center sits on the row baseline**, so a radio circle or checkbox aligns nicely with the surrounding text rather than sitting on top of the line.

`HBox` picks the largest reported baseline in the row, augments it with half the tallest null-baseline child (so a tall graphical control like `ProgressSpinner` doesn't push the row off-screen), and offsets each child so the rule above holds. The row's preferred height grows to `ascent + descent` where `ascent` and `descent` each take the larger of the text-baseline contribution and the null-child half-height.

If no child reports a baseline, `HBox` falls back to the legacy top-aligned layout. Baseline alignment is also skipped when `setStretching(true)` is enabled, since stretching forces every child to fill the row vertically and there is no shared baseline to align.

## See also

- [API: HBox](/api/classes/HBox)
- [`Column`](/layouts/Column) — equal-width horizontal sequence
- [`VBox`](/layouts/VBox) — vertical equivalent
- [Layout constraints reference](/layouts/Constraints)
