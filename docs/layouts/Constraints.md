# Layout constraints reference

Constraints are passed as the second argument to `addComponent` and tell a [`LayoutManager`](/api/layout/classes/LayoutManager) how to position a child. Each manager defines its own constraint shape — see the per-layout pages for specifics.

This page covers the **shared** constraint primitives that several managers consume.

## LayoutConstraints

The base [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) exposes two universally relevant fields:

| Field | Purpose |
| --- | --- |
| `fill` | [`FillType`](#filltype) — how the child expands to use available cell space. |
| `anchor` | [`AnchorType`](#anchortype) — where to position the child within its cell when it doesn't fill it. |

Plus optional metadata:

| Field | Purpose |
| --- | --- |
| `name` | Label / identifier; consumed by [`Tab`](/layouts/Tab) for tab button text. |
| `description` | Free-form descriptive string for accessibility / debugging. |

Each manager subclasses this to add its own fields:

- [`AccordionConstraints`](/api/layout/classes/AccordionConstraints) — `label`, `initiallyOpen`
- [`GridConstraints`](/api/layout/classes/GridConstraints) — `col`, `row`, `colSpan`, `rowSpan` (see [Grid](/layouts/Grid#cell-spanning-and-explicit-placement))
- The plain `{ region: Placement }` object passed to [`Border`](/layouts/Border)

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
