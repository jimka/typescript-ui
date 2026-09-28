# Absolute

[`Absolute`](/api/layout/classes/Absolute) **positions** nothing: every child stays at the `x` / `y` the application already set on it via `setPosition`, `setX`, `setY`. It does size each child — at its preferred size, or at its current size when it reports none — which the `sizing` option below switches off.

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

<!-- demo: absolute-placement -->
> **Live demo** — three labelled panels pinned at literal pixel positions
> via `setX`/`setY`; unlike `Anchor`, nothing re-anchors on resize.
> [Open the Absolute page](https://jimka.github.io/typescript-ui/layouts/Absolute)
<!-- /demo -->

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Absolute } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
const canvas = Component();
canvas.setLayoutManager(Absolute());

const button = Button('Drag me');
button.setPosition(50, 30);
button.setPreferredSize({ width: 120, height: 32 });
canvas.addComponent(button);
```

## Per-child constraints

None. The layout doesn't read any constraint object; `addComponent`'s second argument is ignored.

## Sizing

`sizing` ([`AbsoluteSizing`](/api/layout/type-aliases/AbsoluteSizing)) chooses where each child's width and height come from. Both modes leave the position alone.

| `sizing` | Each child is committed at |
|---|---|
| `"preferred"` (the default) | its preferred size, falling back to its current size, then to `0` |
| `"committed"` | the width and height it already holds; a child nobody has sized yet is skipped |

Use `"committed"` for a container whose children are sized by the code that owns them, not by this manager — otherwise the container's own layout pass would resize them back to whatever they report:

```typescript
canvas.setLayoutManager(Absolute({ sizing: 'committed' }));
```

The library's own user of `"committed"` is the table's `Row`: the body's render window, the header, and the footer each size every cell to its column, and the row's pass has to keep that rectangle rather than shrink each cell to its preferred size.

`setSizing` switches the mode at runtime and marks the container's layout pass as owed.

<!-- demo: absolute-sizing -->
> **Live demo** — the same child in two `Absolute` containers: `sizing:
> "preferred"` re-sizes it to the 90x40 it reports, `sizing: "committed"`
> keeps the 200x40 it already holds, and neither moves it.
> [Open the Absolute page](https://jimka.github.io/typescript-ui/layouts/Absolute)
<!-- /demo -->

## When to use it

- You're building a draggable canvas where the user controls each item's position.
- You have an overlay layer (markers, annotations) where coordinates are computed externally.
- You're prototyping and don't want a layout manager dictating positions.

For everything else, prefer one of the structural managers ([`Border`](/layouts/Border), [`HBox`](/layouts/HBox), [`Grid`](/layouts/Grid), etc.).

## See also

- [API: Absolute](/api/layout/classes/Absolute)
- [`AbsoluteSizing`](/api/layout/type-aliases/AbsoluteSizing) — the `sizing` option values
- [Layouts overview](/layouts/)
