# Anchor

[`Anchor`](/api/layout/classes/Anchor) positions each child by **edge-relative and proportional offsets** and re-resolves them on every `doLayout()` pass, so children stay pinned to a container edge — or stretched between two edges — as the container resizes. It is the resize-reactive counterpart to [`Absolute`](/layouts/Absolute), which places each child statically at its own position and never reads the container's inner size.

```
+--------------------------+
| header (left:0 right:0)  |  full-width band, fixed height
+--------------------------+
|      +------------+      |
|      |  50% box   |      |  left/top 25%, 50% x 50%
|      +------------+      |
|                +-------+ |
|                |pinned | |  right:8 bottom:8
+----------------+-------+-+
   re-anchors on every resize
```

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Anchor, AnchorConstraints } from '@jimka/typescript-ui/layout';

const canvas = Component();
canvas.setLayoutManager(Anchor());

// Full-width header band pinned to the top, 40px tall.
const headerCons = new AnchorConstraints();
headerCons.left = 0;
headerCons.right = 0;
headerCons.top = 0;
headerCons.height = 40;
canvas.addComponent(header, headerCons);

// Button pinned 8px from the bottom-right corner.
const pinnedCons = new AnchorConstraints();
pinnedCons.right = 8;
pinnedCons.bottom = 8;
pinnedCons.width = 120;
pinnedCons.height = 32;
canvas.addComponent(button, pinnedCons);
```

## Per-child constraints

Children take an [`AnchorConstraints`](/api/layout/classes/AnchorConstraints) with six optional fields. Each is an `AnchorValue` — a bare `number` is **pixels**, while `{ percent }` is a **percentage** (0–100 scale) of the container's inner extent on that axis:

| Field | Meaning |
| --- | --- |
| `left` | Distance from the inner left edge to the child's left edge. |
| `right` | Distance from the inner right edge to the child's right edge. |
| `top` | Distance from the inner top edge to the child's top edge. |
| `bottom` | Distance from the inner bottom edge to the child's bottom edge. |
| `width` | Explicit width; used when at most one horizontal edge is set. |
| `height` | Explicit height; used when at most one vertical edge is set. |

Each axis resolves independently. The horizontal axis uses `left` / `right` / `width` against the inner width; the vertical axis uses `top` / `bottom` / `height` against the inner height. The precedence is identical per axis (shown here for the horizontal axis, where `L` / `R` / `W` are the resolved pixel values and `I` is the inner width):

| `left` | `right` | `width` | Resulting `x` | Resulting `width` | Meaning |
| --- | --- | --- | --- | --- | --- |
| set | set | (ignored) | `L` | `max(0, I − L − R)` | Stretch between both edges |
| set | unset | set | `L` | `W` | Pin left, explicit width |
| set | unset | unset | `L` | preferred | Pin left at preferred width |
| unset | set | set | `I − R − W` | `W` | Pin right, explicit width |
| unset | set | unset | `I − R − preferred` | preferred | Pin right at preferred width |
| unset | unset | set | child's own `x` | `W` | Explicit width, app-positioned |
| unset | unset | unset | child's own `x` | preferred | Falls back like Absolute |

Notes:

- When **both** edges of an axis are set, `width` / `height` is ignored (the pair derives the extent), mirroring CSS `position: absolute`.
- When **neither** edge of an axis is set, the child keeps its own `getX` / `getY` on that axis, behaving like [`Absolute`](/layouts/Absolute) there — so you can anchor one axis and hand-place the other.
- An over-constrained stretch (`left` + `right` exceeding the inner extent) clamps the derived extent to `0` rather than going negative.
- Percentages resolve against the container's **inner** size (post-insets), the same coordinate space the committed rect lives in — not its border box.

## When to use it

- Edge-pinned toolbars, status bars, or header bands that must span the full width however the container resizes.
- Panes that stretch between two edges (`left` + `right`, or `top` + `bottom`) to track the container's inner size.
- Percentage overlays — a box sized and positioned as a fraction of the container.

For static, application-controlled coordinates that should **not** react to resize, use [`Absolute`](/layouts/Absolute). For everything structural, prefer [`Border`](/layouts/Border), [`HBox`](/layouts/HBox), [`Grid`](/layouts/Grid), and friends.

`Anchor` commits children directly without the cell clamp, so a child sized larger than the container overflows; a host `Panel` with `autoScroll: "auto"` scrolls it natively.

## See also

- [API: Anchor](/api/layout/classes/Anchor)
- [API: AnchorConstraints](/api/layout/classes/AnchorConstraints)
- [Absolute](/layouts/Absolute) — the static counterpart
- [Layouts overview](/layouts/)
