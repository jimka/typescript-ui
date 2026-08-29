# Split

[`Split`](/api/layout/classes/Split) divides the container into two or more resizable panels separated by draggable [`SplitGutter`](/api/component/container/classes/SplitGutter) elements. Orientation can be `'horizontal'` (panels side by side) or `'vertical'` (panels stacked).

```
+--------+║+----------------+
|        |║|                |
|  left  |║|     right      |   horizontal split
|        |║|                |
+--------+║+----------------+
         draggable gutter
```

<!-- demo: split-panes -->
> **Live demo** — two panes divided by a draggable gutter.
> [Open the Split page](https://jimka.github.io/typescript-ui/layouts/Split)
<!-- /demo -->

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Split } from '@jimka/typescript-ui/layout';
import { Table } from '@jimka/typescript-ui/component/table';
import { Tree } from '@jimka/typescript-ui/component/tree';
const workspace = Component();
workspace.setLayoutManager(Split({ orientation: 'horizontal' }));

workspace.addComponent(treeView);   // left
workspace.addComponent(detailTable); // right
```

[`SplitOptions`](/api/layout/interfaces/SplitOptions) accepts `orientation` declaratively, typed as the [`AxisOrientation`](/api/primitive/type-aliases/AxisOrientation) union (`'horizontal' | 'vertical'`); the `setOrientation` setter still works for runtime updates.

## Three+ panes

Add more components to get more panes; `Split` inserts a gutter between each pair:

```typescript
workspace.addComponent(navigator);  // left
workspace.addComponent(content);    // centre
workspace.addComponent(properties); // right
```

## Per-child constraints

Each panel starts at its **preferred size** (explicit or class-default), clamped to its min/max — the same base-plus-weight model as [`HBox`](/layouts/HBox) / [`VBox`](/layouts/VBox). The `weight` constraint distributes the leftover space among the weighted panels, so a fixed panel sits beside a `weight: 1` panel that absorbs the remainder; a panel with neither a preferred size nor a weight falls back to an equal share. A later change to a panel's preferred size is ignored (the seed is a one-time hint), but **min/max are enforced live** — setting `min == max` pins a panel to that width (a collapse), and the other panels reflow to fill.

## Collapsible panels

Each gutter carries a small chevron grip. By default (`collapseTrigger:
'dblclick'`), **double-clicking** it collapses the adjacent pane: the gutter
slides to that pane's outer edge and widens into a themed, button-styled strip
(cross-fading its fill in), while the collapsing pane keeps its full size and
reveals away under a clip-path, and the freed space is redistributed to the
remaining panes. The whole pass is one coordinated animation — the toggled
pane clip-reveals while every other pane and the gutters interpolate their
geometry together, re-laying out their contents each frame so nothing snaps —
mirroring [`Accordion`](/layouts/Accordion). A drag never collapses — only the
configured trigger does, so resizing is never ambiguous. Repeating the gesture
on the same chevron once it's a strip slides the gutter back and restores the
pane to its previous ratio. Collapsed state is in-memory only.

Pass `collapseTrigger: 'click'` to switch every gutter's chevron to a single
click instead — useful when double-click is already claimed by something else
in the pane:

```typescript
workspace.setLayoutManager(Split({ orientation: 'horizontal', collapseTrigger: 'click' }));
```

By default a pane collapses toward the split's leading edge (`west`/`north`),
using the gutter on its **trailing** side. Set `collapseDirection` on a pane's
constraint to collapse it toward the trailing edge (`east`/`south`) instead,
using the gutter on its **leading** side — which is how the otherwise-gutterless
**last pane** becomes collapsible:

```typescript
const split = Split({ orientation: 'horizontal', collapsedPanes: [0] });

split.addComponent(sidebar);                                   // collapses west (default)
split.addComponent(content);
split.addComponent(inspector, { collapseDirection: 'east' }); // last pane collapses east

split.setPaneCollapsed(0, true);   // collapse the first pane
split.isPaneCollapsed(0);          // → true
split.setPaneCollapsed(0, false);  // restore it
```

A pane and its neighbour share the gutter between them, so opting the trailing
pane into `east` claims that gutter and makes the leading pane non-collapsible
(only one of the two can fold into a given gutter). A gutter's
[context menu](#gutter-context-menu) offers the same choice interactively,
without editing constraints by hand.

The chevron is a [`CollapseButton`](/api/component/container/classes/CollapseButton)
carried by the [`SplitGutter`](/api/component/container/classes/SplitGutter); the
strip fill and chevron colour are themed via the `collapse` tokens — see
[Theming](/concepts/theming#theme-keys).

### Resizable but not collapsible

Set `collapsible: false` on a pane's constraint to keep its gutter a plain
**draggable divider** — it still resizes, but shows no chevron and cannot be
collapsed by the chevron gesture, `setPaneCollapsed`/`setPaneCollapsedImmediate`,
or the `collapsedPanes` option. Panes are collapsible by default; this is the
opt-out.

```typescript
split.addComponent(content, { collapsible: false }); // drag to resize, never collapses
```

Note the default is the **opposite** of [`Border`](/layouts/Border), where a
region is non-collapsible until it opts in with `collapsible: true`; the two
managers read the same constraint field with opposite defaults.

## Gutter context menu

Right-clicking a gutter's chevron opens a context menu, rebuilt from live state
on every open, with three groups of controls. The menu stays open across a
click either way: the first three rows are real
[`CheckboxMenuRow`](/components/CheckboxMenuRow)s, and the collapse pair is a
real [`RadioMenuRow`](/components/RadioMenuRow) each — so several controls can
be flipped in one open:

- **Lock gutter** — disables dragging (and the resize cursor) on that gutter
  without affecting its collapse chevron. Wraps
  [`SplitGutter.setMovable`](/api/component/container/classes/SplitGutter#setmovable),
  which is live at runtime.
- **Fix `<lead>` pane `<extent>`** / **Fix `<next>` pane `<extent>`** — pins
  either neighbouring pane's size against container resizes, equivalent to
  `setPaneResizeWeight(pane, 0)`. Toggling a checked row off clears the pin
  (`setPaneResizeWeight(pane, undefined)`) and restores proportional resizing.
  A toggle produces no immediate visual change — the pin only bites on the next
  container resize.
- **Collapse `<lead>` pane** / **Collapse `<next>` pane** — chooses which
  neighbour this gutter collapses, by writing the neighbour's
  `collapseDirection` constraint (see [Collapsible panels](#collapsible-panels))
  and re-syncing the chevron on the next layout pass. Disabled for a
  `collapsible: false` neighbour, and both disabled while the gutter itself is
  a collapsed strip. The two rows are radio rows, not independent toggles:
  picking one clears the other, and clicking the already-selected one changes
  nothing. A gutter whose neighbours' `collapseDirection` constraints leave it
  collapsing neither pane starts with both rows unselected until one is
  picked.

Row labels follow the split's orientation: `left`/`right`/`width` on a
horizontal split, `top`/`bottom`/`height` on a vertical one. [`Border`](/layouts/Border)'s
gutters build no menu — right-clicking one shows nothing, since none of the
six rows has a meaningful analog on a fixed, placement-driven region.

## Saving and restoring layout

[`getPaneSizes`](/api/layout/classes/Split#getpanesizes) / [`applyPaneSizes`](/api/layout/classes/Split#applypanesizes) and the `paneSizes` option capture and restore pane sizes for **cross-session persistence** — a consumer's own store (`localStorage`, a backend), not built into the library. Each entry's unit follows the pane's resize weight: a pane pinned with `weight: 0` (declaratively, or via `setPaneResizeWeight`) persists as **px** and restores at exactly that size regardless of the window size on reload — the pane exists precisely so it does not scale with the viewport. Every other pane persists as a **ratio** of the space the pinned panes leave. `paneresize` fires once a completed gutter drag settles the sizes — never per frame — and `panecollapse` fires whenever a pane's collapsed state changes, so a listener can persist on every commit without debouncing:

```typescript
import { LayoutSize } from '@jimka/typescript-ui/layout';

split.on("paneresize", (sizes: LayoutSize[]) => {
    localStorage.setItem("split-sizes", JSON.stringify(sizes));
});
split.on("panecollapse", (index, collapsed) => {
    localStorage.setItem("split-collapsed", JSON.stringify({ index, collapsed }));
});

// On the next session:
const saved = localStorage.getItem("split-sizes");
const split = Split({
    orientation: 'horizontal',
    paneSizes  : saved ? JSON.parse(saved) : undefined,
});
```

A saved array whose length or per-index unit no longer matches the live panes (e.g. a pane's `weight` changed between releases) is **discarded whole**, and the split falls back to its normal first-layout sizing — the same all-or-nothing rule `collapsedPanes` never needed because it carries no unit.

> **`getPaneRatios` / `applyPaneRatios` are a different surface.** They serve [Layout serialization](/layouts/LayoutSerialization)'s same-session topology switching — a weight-agnostic ratio of the *whole* pane set, with no unit tag. Using them for cross-session persistence would restore a `weight: 0` pane at the wrong px on a differently-sized window; use `getPaneSizes` / `applyPaneSizes` for that instead.

## Common methods

| Method | Purpose |
| --- | --- |
| `setOrientation(value)` | `'horizontal'` (default) or `'vertical'`. |
| `setPaneSize(pane, px)` | Seed or override a pane's stored main-axis size in pixels. |
| `getPaneSize(pane)` | Read a pane's stored main-axis size, or `undefined` when unset. |
| `setPaneCollapsed(index, value)` | Collapse or restore the pane at `index`. |
| `isPaneCollapsed(index)` | Whether the pane at `index` is collapsed. |
| `getPaneSizes()` | Weight-aware, mixed-unit sizes for cross-session persistence. See [Saving and restoring layout](#saving-and-restoring-layout). |
| `applyPaneSizes(sizes)` | Restore sizes captured by `getPaneSizes`. |
| `setPaneResizeWeight(pane, weight)` | Pin (`0`) or weight a pane's share of a container resize; `undefined` clears the pin. |

## Notes

- A `Split` reports a content-derived **preferred** (and **minimum**) size, like [`HBox`](/layouts/HBox) / [`VBox`](/layouts/VBox): pane sizes summed along the split axis plus the gutter footprint, and the largest pane across it. So a host layout sizes the split to fit its panes (a vertical split prefers the sum of its panes' heights; a horizontal split, the sum of their widths). This is a hint to the host and is separate from the dragged per-pane sizes, which only distribute the split's actual extent.
- Gutter visuals are themed via the `gutter.background` token — see [Theming](/concepts/theming#theme-keys).
- Drag interactions disable body pointer events during the drag to suppress text selection.
- For a non-resizable two-region split, use [`Border`](/layouts/Border) instead.

## See also

- [API: Split](/api/layout/classes/Split)
- [API: LayoutSize](/api/layout/interfaces/LayoutSize) — the persisted-size vocabulary `getPaneSizes` / `applyPaneSizes` share with [`Accordion`](/layouts/Accordion#saving-and-restoring-section-sizes)
- [`SplitGutter`](/api/component/container/classes/SplitGutter) — the drag handle
- [`Border`](/layouts/Border) — fixed dividers
- [Layout serialization](/layouts/LayoutSerialization) — capture and restore pane ratios
