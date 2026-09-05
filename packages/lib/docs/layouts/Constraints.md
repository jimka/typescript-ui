# Layout constraints reference

Constraints are passed as the second argument to `addComponent` and tell a [`LayoutManager`](/api/layout/classes/LayoutManager) how to position a child. Each manager defines its own constraint shape — see the per-layout pages for specifics.

This page covers the **shared** constraint primitives that several managers consume.

## LayoutConstraints

The base [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) exposes two universally relevant fields:

| Field | Purpose |
| --- | --- |
| `fill` | [`FillType`](#filltype) — how the child expands to use available cell space. |
| `anchor` | [`AnchorType`](#anchortype) — where to position the child within its cell when it doesn't fill it. |

Beyond the grid-style managers, the box layouts [`HBox`](/layouts/HBox#per-child-cross-axis-alignment-align-self) and [`VBox`](/layouts/VBox#per-child-cross-axis-alignment-align-self) read the **cross-axis component** of `fill` / `anchor` as per-child align-self (in both `"preferred"` and `"equal"` mode): a cross-axis fill stretches the child across its row/column, and a cross-axis anchor edge pins it to the leading/trailing cross edge. `CENTER` and the main-axis component are ignored by the box, which owns main-axis sequencing. The wrapping flows [`HFlow`](/layouts/HFlow#per-child-cross-axis-alignment-align-self) and [`VFlow`](/layouts/VFlow#per-child-cross-axis-alignment-align-self) read the same cross-axis `fill` component as align-self, but only `fill` — they do not consult `anchor` for it — and stretch the child against its own **wrapped line** rather than the container's full cross band.

Plus optional metadata:

| Field | Purpose |
| --- | --- |
| `name` | Label / identifier; consumed by [`Tab`](/layouts/Tab) for tab button text. |
| `description` | Free-form descriptive string for accessibility / debugging. |
| `lazy` | Defers a factory passed to `addComponent` until first activation; consumed by [`Tab`](/layouts/Tab), where it defaults to `true`. Ignored for an already-constructed component. |

Each manager subclasses this to add its own fields:

- [`AccordionConstraints`](/api/layout/classes/AccordionConstraints) — `label`, `initiallyOpen`
- [`AnchorConstraints`](/api/layout/classes/AnchorConstraints) — `left`, `right`, `top`, `bottom`, `width`, `height` (pixels or `{ percent }`; see [Anchor](/layouts/Anchor#per-child-constraints))
- [`GridConstraints`](/api/layout/classes/GridConstraints) — `col`, `row`, `colSpan`, `rowSpan` (see [Grid](/layouts/Grid#cell-spanning-and-explicit-placement)); the grid supplies `defaultFill` / `defaultAnchor` fallbacks behind each child's own `fill` / `anchor` (see [Grid](/layouts/Grid#per-child-fill-and-anchor))
- The plain `{ placement: Placement }` object passed to [`Border`](/layouts/Border)

## FillType

[`FillType`](/api/layout/enumerations/FillType) controls how a child expands to fill its allocated cell:

| Value | Behaviour |
| --- | --- |
| `NONE` | Use the child's preferred size; no expansion. |
| `HORIZONTAL` | Stretch horizontally to fill the cell width. |
| `VERTICAL` | Stretch vertically to fill the cell height. |
| `BOTH` | Fill the entire cell. |

```typescript
import { FillType } from '@jimka/typescript-ui/layout';
container.addComponent(input, { fill: FillType.HORIZONTAL });
```

## AnchorType

[`AnchorType`](/api/layout/enumerations/AnchorType) tells the layout where to position a child when its preferred size is smaller than its allocated cell. The values follow compass directions plus the centre:

```
NORTHWEST  NORTH  NORTHEAST
WEST      CENTER  EAST
SOUTHWEST  SOUTH  SOUTHEAST
```

```typescript
import { AnchorType } from '@jimka/typescript-ui/layout';
container.addComponent(label, {
    fill:   FillType.NONE,
    anchor: AnchorType.NORTHEAST,
});
```

## Placement

[`Placement`](/api/primitive/enumerations/Placement) is a separate enum used by [`Border`](/layouts/Border) for region selection (and by [`Window`](/components/Window) to describe edge-resize handles):

| Value | Region |
| --- | --- |
| `NORTH` | Top |
| `SOUTH` | Bottom |
| `WEST` | Left |
| `EAST` | Right |
| `CENTER` | Middle |

## See also

- [Layouts overview](/layouts/)
- [API: LayoutConstraints](/api/layout/classes/LayoutConstraints)
- [API: AnchorType](/api/layout/enumerations/AnchorType), [FillType](/api/layout/enumerations/FillType), [Placement](/api/primitive/enumerations/Placement)
