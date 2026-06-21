# Card

[`Card`](/api/layout/classes/Card) shows exactly one child component at a time, sized to fill the container's inner bounds. The visible child is selected by component ID; all others are hidden.

```
+--------------------------+
|                          |
|     [active child]       |
|                          |
+--------------------------+
   one of N children visible at a time
```

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Card } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const stack = Component();
stack.setLayoutManager(Card({ visibleComponentId: contentPanel.getId() }));

stack.addComponent(loadingPanel);
stack.addComponent(contentPanel);
stack.addComponent(errorPanel);
```

[`CardOptions`](/api/layout/interfaces/CardOptions) accepts `visibleComponentId` declaratively. The `setVisibleComponentId` setter still works for runtime switching:

```typescript
card.setVisibleComponentId(errorPanel.getId());
```

## Per-child constraints

None. The active child is selected by ID via `card.setVisibleComponentId(id)`.

## When to use it

- Wizard / step-by-step flows where one screen is visible at a time.
- Loading / content / error state machines.
- Any "show one of N panels" pattern that doesn't need tab buttons (otherwise use [`Tab`](/layouts/Tab)).

## Notes

- Hidden children remain in the component tree and keep their state. Use this property to preserve form inputs across step transitions.
- For a tabbed UI with toolbar buttons, use [`Tab`](/layouts/Tab).

## See also

- [API: Card](/api/layout/classes/Card)
- [`Tab`](/layouts/Tab) — same one-at-a-time semantics, plus a button toolbar
- [`Fit`](/layouts/Fit) — single fixed child
