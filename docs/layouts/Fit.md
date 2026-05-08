# Fit

[`Fit`](/api/classes/Fit) sizes a single child component to fill the container's entire inner bounds. It throws if the container holds more than one component.

```
+--------------------------+
|                          |
|         [child]          |
|     fills entire box     |
|                          |
+--------------------------+
   exactly one child, sized to inner bounds
```

## Usage

```typescript
import { Component, Fit, Table } from '@jimka/typescript-ui';

const wrapper = new Component();
wrapper.setLayoutManager(new Fit());
wrapper.addComponent(table);
```

## Per-child constraints

None. The single child fills the container regardless.

## When to use it

- You have a wrapper component that should expand its single child to fill the available space — e.g. a content panel inside a [`Border`](/layouts/Border) layout's centre region.
- You want a single child to participate in viewport-resize updates without writing your own size logic.

For multiple children, use [`HBox`](/layouts/HBox), [`VBox`](/layouts/VBox), or [`Card`](/layouts/Card).

## See also

- [API: Fit](/api/classes/Fit)
- [`Card`](/layouts/Card) — multiple children, one visible at a time
- [`Border`](/layouts/Border) — five regions, one fills the centre
