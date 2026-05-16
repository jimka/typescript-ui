# Fit

[`Fit`](/api/layout/classes/Fit) places a single child component inside the container's inner bounds. The default fill mode stretches the child to fill the bounds; a configurable [`FillType`](/api/layout/enumerations/FillType) lets the same layout centre the child at its preferred size, or stretch on one axis and centre on the other. It throws if the container holds more than one component.

```
FillType.BOTH (default)            FillType.NONE
+--------------------------+      +--------------------------+
|                          |      |                          |
|         [child]          |      |         [child]          |
|     fills entire box     |      |    preferred size,       |
|                          |      |       centred            |
+--------------------------+      +--------------------------+
```

## Usage

Default — stretch to fill (e.g. wrap a `Table` so it tracks the bounds):

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';

const wrapper = Component();
wrapper.setLayoutManager(Fit());
wrapper.addComponent(table);
```

Centred at preferred size — useful for floating a single status icon or spinner inside otherwise empty bounds (this is how [`Tab.addLazyTab`](/layouts/Tab#lazy-panel-construction) and [`Window.setContentFactory`](/api/core/classes/Window#setcontentfactory) wire their loading spinner):

```typescript
import { Fit, FillType } from '@jimka/typescript-ui/layout';
import { ProgressSpinner } from '@jimka/typescript-ui/component/display';

const wrapper = Component();
wrapper.setLayoutManager(Fit({ fill: FillType.NONE }));
wrapper.addComponent(ProgressSpinner(24));
```

`FillType.HORIZONTAL` / `FillType.VERTICAL` stretch on one axis and centre on the other.

## Per-child constraints

None. The single child is placed according to the layout's `fill` mode.

## When to use it

- You have a wrapper component that should expand its single child to fill the available space — e.g. a content panel inside a [`Border`](/layouts/Border) layout's centre region.
- You want to float a single visual element (spinner, icon, placeholder) in the middle of an otherwise empty container — use `FillType.NONE`.
- You want a single child to participate in viewport-resize updates without writing your own size logic.

For multiple children, use [`HBox`](/layouts/HBox), [`VBox`](/layouts/VBox), or [`Card`](/layouts/Card).

## See also

- [API: Fit](/api/layout/classes/Fit)
- [`FillType`](/api/layout/enumerations/FillType)
- [`Card`](/layouts/Card) — multiple children, one visible at a time
- [`Border`](/layouts/Border) — five regions, one fills the centre
