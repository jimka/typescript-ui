# Sizing

Every [`Component`](/api/core/classes/Component) carries up to four pieces of size information. Understanding how they interact is the difference between layouts that "just work" and layouts that mysteriously collapse to 0×0.

## The four size hints

| Hint | Set via | Meaning |
| --- | --- | --- |
| **Preferred** | `setPreferredSize(w, h)` | The component's wish: "given the chance, make me this size." |
| **Minimum** | `setMinSize(w, h)` | Lower bound. The layout manager won't shrink the component below this. |
| **Maximum** | `setMaxSize(w, h)` | Upper bound. The layout manager won't grow the component above this. |
| **Actual** | `setSize(w, h)` (set by layout) | The size the layout manager actually assigned. Read with `getSize()`. |

The first three are *hints* you set. The fourth is the *outcome* the layout pass produces.

## Reading the assigned size

```typescript
const size = component.getSize();      // Size | null
component.getWidth();                  // number | null
component.getHeight();                 // number | null
```

These return `null` for components that haven't been laid out yet. If your code needs to compute geometry against actual pixels, defer it until at least one layout pass has run.

## Preferred-size auto-calculation

Some components compute their preferred size from content rather than asking you to set it:

- [`Text`](/components/Text), [`Label`](/components/Label), [`Header`](/components/Header) — measure their text on every change and on every theme change.
- [`Image`](/components/Image) — adopts the image's natural width and height once it loads.
- [`ComboBox`](/components/ComboBox) — measures a probe `<select>` element to match the browser's native height.
- [`NumberSpinner`](/components/NumberSpinner) — derives its height from its inner `TextField`.

For these you usually don't call `setPreferredSize` unless you need to override the auto-computed value.

Single-line inputs — [`TextField`](/components/TextField), [`PasswordField`](/components/PasswordField), [`UsernameField`](/components/UsernameField), [`ComboBox`](/components/ComboBox), the picker fields ([`DateField`](/components/DateField)/[`TimeField`](/components/TimeField)/[`DateTimeField`](/components/DateTimeField)), [`NumberSpinner`](/components/NumberSpinner), and [`AutoCompleteField`](/components/AutoCompleteField) — also pin their **minimum** height to that same one-line box, with minimum width left at `0`. A stacked layout (`VBox`, or a [`LabeledFieldSet`](/components/LabeledFieldSet) row) can therefore never compress one of these fields shorter than one line; it can still shrink or stretch them horizontally.

## Min / max as floors and ceilings

Min and max are particularly important inside flexible layouts. In a [`Border`](/layouts/Border)'s east region, the layout assigns the column's preferred width by default, but `setMinSize(200, 0)` keeps the column at least 200 pixels wide even if there's room to shrink. `setMaxSize(0, 0)` (the default for a freshly-constructed `Component`) means "no upper bound".

```typescript
sidebar.setPreferredSize(240, 0);  // 240 wide, height filled by layout
sidebar.setMinSize(180, 0);
sidebar.setMaxSize(360, 0);
```

A `0` value for either width or height is conventionally a "don't care" — the layout manager treats it as unbounded.

## The size invariant

The three hints satisfy `min ≤ preferred ≤ max` on each axis. When you set them in conflict, the framework resolves on read with **min winning**: a preferred below the minimum is lifted to the minimum, and a minimum above the maximum still wins (the maximum is treated as at least the minimum). So `setMinSize(120, 0)` followed by `setPreferredSize(0, 0)` reports a preferred width of 120, not 0. How that range binds the *committed* size — and whether the binding minimum is your explicit one or one derived from the component's children — depends on the component; see [Content size vs. allocated size](#content-size-vs-allocated-size) below.

## Content size vs. allocated size

A container reports an *effective* minimum and maximum: the merger of its own `setMinSize` / `setMaxSize` and the minimum/maximum its layout manager derives from its children. This effective range is what the component reports **upward** so its parent can size it and decide whether to scroll. Whether the component then holds *itself* to that range depends on its type:

- A **general component** clamps its committed size to its *effective* `[min, max]`. It never collapses below the size its children need to render — so a custom container you build keeps a content-based minimum. If its parent hands it less room than that, it overflows its parent, and an ancestor scroll host carries the overflow.
- A [**`Panel`**](/api/core/classes/Panel) clamps only to its *own explicit* `setMinSize` / `setMaxSize`. It fits whatever space its parent allocates and lets the overflow **clip, or scroll** when [`setAutoScroll`](/api/core/classes/Panel#setautoscroll) is configured, rather than inflating itself back up to its content size. This is what lets a tall form sit inside a short scrolling panel.

In both cases an explicit `setMinSize` / `setMaxSize` is a hard floor and ceiling.

## When a layout can't honour the minimum

A layout manager gives each child the space available in its cell or track, capped to the child's maximum, and **does not itself inflate the child back up to the child's content minimum** — it leaves the minimum to the child. A general child then holds its content minimum (overflowing the cell, for an ancestor scroll host to scroll); a [`Panel`](/api/core/classes/Panel) child fits the cell and scrolls or clips its own overflow.

[`Grid`](/layouts/Grid) goes further for a cell whose child genuinely cannot shrink to it — an explicit minimum wider or taller than the cell: it clips the child to a cell-sized frame, honouring the grid's fill/anchor on whichever axis the child *does* fit and rendering the child at its natural extent (its preferred size, falling back to its minimum) on the overflowing axis. [`HBox`](/layouts/HBox) and [`VBox`](/layouts/VBox) size each child to the available cross-axis space and let the child's own clamp and any scroll host handle a shortfall; their `overflowSizing` option (`"preferred"` by default, or `"min"`) tunes how the *main* axis packs when a scrollable host scrolls the row or column.

## When sizes change

Setting any size hint schedules a layout pass on the parent. The framework's rAF coalescing means multiple changes in the same frame produce one pass. Setting `setSize` directly is how the layout manager writes the assigned value back; user code rarely calls it.

## Always include "px" units in custom CSS

When you write raw CSS inside a `Component` subclass — e.g. `setElementStyle('padding', value)` or `setElementCSSRule('margin', value)` (both `protected`, reachable only from a subclass that needs a property the typed API doesn't yet expose) — include the `"px"` unit explicitly:

```typescript
// WRONG — silently ignored by the browser
this.setElementStyle('padding', '8');

// RIGHT
this.setElementStyle('padding', '8px');
```

Missing units silently produce zero-height components — an early bug fixed in the framework but still possible to reintroduce in custom subclass code.

## Inner size vs outer size

[`getSize()`](/api/core/classes/Component) returns the component's outer size — the rectangle including border and padding. [`getInnerSize()`](/api/core/classes/Component) returns the rectangle available *inside* the component for children to lay out within.

Layout managers operate on `getInnerSize()` of their container. Use this when you need the rectangle a child can actually occupy, accounting for the container's borders and padding.

Because every component is absolutely positioned, a child's containing block is its parent's *padding box* — a child at `left: 0` lands at the inner edge of the border, ignoring the padding. So a layout manager offsets each child's origin by [`getContentInsets()`](/api/core/classes/Component) (inset + padding, border excluded) rather than the bare insets, keeping padding symmetric on all sides.

## Baseline (for horizontal layouts)

Every component also exposes `getBaseline()`: the offset, in pixels, from the top of the component to its visual baseline. [`HBox`](/layouts/HBox) and [`Grid`](/layouts/Grid) use this to align children of mixed heights so their text baselines coincide — much like CSS `vertical-align`.

Text-bearing components (`Text`, `Label`, `Button`, `TextField`, `ComboBox`, `NumberSpinner`, `Header`, `MenuItem`, `RadioButton`, …) report a real baseline derived from the rendered font metrics. Graphical or replaced-element components (`ProgressBar`, `Image`, `Slider`, `Checkbox`, the inner radio of `RadioButton`, …) return `null`. The layout treats them like CSS `vertical-align: middle`: their vertical centre is placed on the row baseline so they align with the text content rather than sitting flush with the row top.

When a layout finds at least one child with a real baseline it picks the largest baseline as the row baseline (raising it as needed so a tall null-baseline child stays on-screen). The row's preferred height grows to `ascent + descent` where each side accommodates both the text contribution and half the tallest null-baseline child, ensuring nothing is clipped.

`HBox` baseline-aligns by default. `Column` and `Grid` opt in via `setStretching(false)` — by default they stretch every child to fill its cell, in which case baseline alignment doesn't apply.

## See also

- [Component lifecycle](/concepts/component-lifecycle)
- [Layout system](/concepts/layout-system)
- [`Insets`](/api/primitive/classes/Insets) — padding / margin values
- [API: Size](/api/primitive/interfaces/Size), [PerimeterSize](/api/core/interfaces/PerimeterSize)
