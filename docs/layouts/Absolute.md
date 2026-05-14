# Absolute

[`Absolute`](/api/layout/classes/Absolute) is the **no-op** layout manager. It performs no automatic positioning; children are expected to be positioned manually via `setPosition`, `setX`, `setY`.

```
+--------------------------+
|                          |
|     [child @ 50,30]      |
|                          |
|             [child @ 200,80]
|                          |
+--------------------------+
   each child positioned manually
```

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Absolute } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const canvas = new Component();
canvas.setLayoutManager(new Absolute());

const button = new Button('Drag me');
button.setPosition(50, 30);
button.setPreferredSize(120, 32);
canvas.addComponent(button);
```

## Per-child constraints

None. The layout doesn't read any constraint object; `addComponent`'s second argument is ignored.

## When to use it

- You're building a draggable canvas where the user controls each item's position.
- You have an overlay layer (markers, annotations) where coordinates are computed externally.
- You're prototyping and don't want a layout manager dictating positions.

For everything else, prefer one of the structural managers ([`Border`](/layouts/Border), [`HBox`](/layouts/HBox), [`Grid`](/layouts/Grid), etc.).

## See also

- [API: Absolute](/api/layout/classes/Absolute)
- [Layouts overview](/layouts/)
