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

## Min / max as floors and ceilings

Min and max are particularly important inside flexible layouts. In a [`Border`](/layouts/Border)'s east region, the layout assigns the column's preferred width by default, but `setMinSize(200, 0)` keeps the column at least 200 pixels wide even if there's room to shrink. `setMaxSize(0, 0)` (the default for a freshly-constructed `Component`) means "no upper bound".

```typescript
sidebar.setPreferredSize(240, 0);  // 240 wide, height filled by layout
sidebar.setMinSize(180, 0);
sidebar.setMaxSize(360, 0);
```

A `0` value for either width or height is conventionally a "don't care" — the layout manager treats it as unbounded.

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
