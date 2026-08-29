# Accordion

[`Accordion`](/api/layout/classes/Accordion) stacks vertically collapsible sections, each with a clickable [`AccordionHeader`](/api/component/container/classes/AccordionHeader) and a content panel. Sections expand and collapse independently by default; opt into single-open mode for "only one section at a time" behaviour.

```
▾ Section 1
  +----------------------+
  |  expanded content    |
  +----------------------+
▸ Section 2
▸ Section 3
```

<!-- demo: accordion-sections -->
> **Live demo** — three collapsible sections; clicking a header animates it
> open or shut.
> [Open the Accordion page](https://jimka.github.io/typescript-ui/layouts/Accordion)
<!-- /demo -->

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Accordion, AccordionConstraints } from '@jimka/typescript-ui/layout';
import { Text } from '@jimka/typescript-ui/component/input';
const sidebar = Component();
sidebar.setLayoutManager(Accordion({
    singleOpen       : true,        // only one section open at a time
    headerHeight     : 32,
    animationDuration: 150,
    listeners        : { sectiontoggle: (idx, open) => console.log(idx, open) },
}));

const section1 = Component();
section1.addComponent(Text('Content of section 1'));
sidebar.addComponent(section1, new AccordionConstraints('Section 1', true));

const section2 = Component();
section2.addComponent(Text('Content of section 2'));
sidebar.addComponent(section2, new AccordionConstraints('Section 2'));
```

[`AccordionOptions`](/api/layout/interfaces/AccordionOptions) accepts the following declaratively; each has a matching setter for runtime updates:

| Option | Setter / getter | Default | Purpose |
| --- | --- | --- | --- |
| `singleOpen` | `setSingleOpen` / `isSingleOpen` | `false` | Only one section open at a time. |
| `headerHeight` | `setHeaderHeight` / `getHeaderHeight` | `28` | Height of each section header, in pixels. |
| `animationDuration` | `setAnimationDuration` / `getAnimationDuration` | `200` | Open/close transition duration, in milliseconds. |
| `themed` | `setThemed` / `isThemed` | `true` | Paint the accordion theme tokens (header background/border/colour + an all-around container border). See [Themed appearance](#themed-appearance). |
| `spacing` | `setSpacing` / `getSpacing` | `0` | Vertical gap inserted *between* sections (never leading or trailing). |
| `compact` | `setCompact` / `isCompact` | `false` | Denser headers — a smaller default header height plus tighter padding. See [Compact mode](#compact-mode). |
| `chevronSide` | `setChevronSide` / `getChevronSide` | `"end"` | Which end of each header the chevron sits at. The label always stays left-aligned. |
| `chevronGlyph` | `setChevronGlyph` / `getChevronGlyph` | `"▶"` | The character drawn as the chevron (rotates 90° when expanded). |
| `fillHeight` | `setFillHeight` / `isFillHeight` | `false` | Open sections grow to absorb the container's leftover height, sharing it by `weight`. See [Fill mode](#fill-mode). |
| `resizable` | `setResizable` / `isResizable` | `false` | Draggable gutters between adjacent open sections, letting the user trade height between them. See [Resizable sections](#resizable-sections). |
| `sectionSizes` | `applySectionSizes` / `getSectionSizes` | — | Section sizes to restore on the first resizable layout; discarded whole when stale. Only meaningful with `resizable`. See [Saving and restoring section sizes](#saving-and-restoring-section-sizes). |
| `toolsVisibility` | `setToolsVisibility` / `getToolsVisibility` | `"hover"` | When per-section header tools are shown. See [Header tools](#header-tools). |
| `listeners` | `on("sectiontoggle", fn)` / `on("sectionresize", fn)` | — | `{ sectiontoggle, sectionresize }` callback bag (see [Toggle callback](#toggle-callback) / [Saving and restoring section sizes](#saving-and-restoring-section-sizes)). |

> **The header is no longer a `Button`.** [`AccordionHeader`](/api/component/container/classes/AccordionHeader) is a styled [`Component`](/api/core/classes/Component) hosting an [`HBox`](/api/layout/classes/HBox) row — an optional leading glyph + the title button (the clickable toggle and focus target), the tool group, and the chevron cell. Because tools are *siblings* of the title button rather than descendants, a tool click is structurally not a header toggle — there is nothing to stop from propagating.

## Themed appearance

With `themed` on (the **default**), each header paints the accordion theme tokens and the container draws an all-around border, so a stack reads as a flat boxed list whose section dividers never double. Turn it off (`themed: false`) for a chromeless accordion that inherits its surroundings.

| CSS custom property | Purpose |
| --- | --- |
| `--ts-ui-accordion-header-bg` | Header background. |
| `--ts-ui-accordion-header-border` | Header bottom divider between sections. |
| `--ts-ui-accordion-header-color` | Header text colour. |
| `--ts-ui-accordion-border` | All-around border on the accordion container. |
| `--ts-ui-accordion-indicator-color` | Chevron colour. |

The header border is a single **bottom** divider rather than a four-side box, so adjacent headers never paint a doubled line — there is no separate "flat"/border-collapse option to set. All values come from the active [`Theme`](/api/core/interfaces/Theme); switching Modern/Classic/Dark retints the accordion in lock-step.

```typescript
accordion.setThemed(false);   // chromeless
accordion.setSpacing(8);      // 8px gap between sections
```

## Compact mode

`compact` makes the headers denser: a smaller default header height (22px vs 28px) plus tighter horizontal padding and inter-cell spacing. The smaller height applies **only when you have not pinned an explicit `headerHeight`** — calling `setHeaderHeight` marks the height as explicit, so compact never silently overrides it.

## Header glyph

A section can show a registry [`Glyph`](/api/component/display/classes/Glyph) leading its title label, via the per-section `glyph` constraint (a registry **name**):

```typescript
sidebar.addComponent(profile, new AccordionConstraints('Profile', true, 'circle-user'));
```

This is distinct from `chevronGlyph`: the section **glyph** is a real registry icon leading the title, while **`chevronGlyph`** is a single raw character used for the rotating expand/collapse chevron. The two are different systems — a registry icon would not rotate cleanly, and a raw character is not a registry lookup.

## Header tools

Headers can carry tool buttons (or any [`Component`](/api/core/classes/Component)) in a tool group between the title and the chevron. There are two kinds:

- **Per-section tools** — passed via the `tools` constraint (or `AccordionPanel`'s `addSection`). Each is its own instance, lives permanently in that header, and obeys `toolsVisibility`: `"hover"` (default) reveals them only while the header is hovered; `"always"` keeps them visible.
- **Global tools** — registered with `addTool(button)` / removed with `removeTool(button)`, mirroring [`Tab.addTool`](/api/layout/classes/Tab#addtool).

```typescript
accordion.addTool(menuButton);                                   // global
sidebar.addComponent(prefs, new AccordionConstraints('Preferences', false, 'gear', [editButton])); // per-section
```

> **Single-instance constraint.** A global tool is a single `Component` — one DOM node — so it **cannot appear in every header at once**. It is re-parented into whichever header is currently hovered, so a global tool *follows the cursor* across headers rather than showing in all of them. If you need a tool present on every header simultaneously, give each section its own per-section instance.

> **Flat appearance is enforced.** A [`Button`](/api/component/button/classes/Button) tool is forced into `flat` mode when added, so header tools read as flat icons regardless of how the caller configured them. Non-`Button` tools are left untouched.

## Fill mode

By default every open section sits at its preferred height. With `fillHeight` on, **every open section grows to absorb the container's leftover height**, sharing it in proportion to each section's [`weight`](/api/layout/classes/LayoutConstraints#weight) constraint — unweighted sections count equally, so with no weights set the slack is split into equal slices. Each recipient is capped at its own max height; a section that hits its max has its surplus re-shared among the rest, so the sections always fill the container without any one being padded past its maximum. Fill is useful when the host stretches the accordion taller than its preferred height (e.g. inside a [`VBox`](/api/layout/classes/VBox) with `stretching`), and is the underflow counterpart to the shrink behaviour described under [Sizing](#sizing): when the content already overflows there is no leftover, so fill is a no-op and the two never both apply.

`weight` can also be set **without** `fillHeight` to fill from only specific sections (a single weighted section absorbs all the slack, in any position — not just the bottommost); when combined with `fillHeight`, the explicit weights bias the shares while unweighted sections still take a default weight of `1`.

## Resizable sections

With `resizable` on, a thin draggable gutter appears between every adjacent pair of **open** sections, letting the user trade height between them:

```typescript
accordion.setResizable(true);
```

The gutter reuses [`SplitGutter`](/api/component/container/classes/SplitGutter) — the same divider [`Split`](/api/layout/classes/Split) uses — but overlays the bottom edge of the upper section's content rather than sitting in the layout flow, so it reserves no height budget of its own.

The first resizable layout **seeds** each open section's height from exactly what `weight`/`fillHeight` would have given it, so with a fill option on (or when the content overflows) turning `resizable` on is visually seamless. Note that resizable mode always rescales the open set to fill the container, so if *no* fill option is set — where the non-resizable layout leaves trailing slack below the sections — enabling `resizable` grows the sections to close that gap. From then on, a drag is the authoritative split — it overrides the seeded ratio the same way a `Split` gutter-drag overrides its pane's resize weight. The dragged ratio survives a section closing and reopening (a closed section keeps its stored height, ready to reapply on reopen). On a container resize only the weighted sections absorb the change — an unweighted section (`weight` unset or `0`, with `fillHeight` off) holds its px, so a section sized to its content stays at that size as the viewport grows and shrinks. With no weighted section, or when the pinned sections alone would overrun the container, the whole open set rescales proportionally as before. A gutter drag is unaffected: an unweighted section still drags freely, and the pin then holds whatever px the drag gave it.

No gutter appears with fewer than two open sections, and none ever appears under [`singleOpen`](#usage) (which never has more than one section open at a time) — both are documented no-ops, not errors.

Resizable sections and [`Split`](/api/layout/classes/Split) solve different problems: reach for `resizable` when you want the accordion's own collapsible sections to also be reapportionable, and compose with `Split` instead when you want independent draggable panes that are not collapsible sections at all.

### Saving and restoring section sizes

[`getSectionSizes`](/api/layout/classes/Accordion#getsectionsizes) / [`applySectionSizes`](/api/layout/classes/Accordion#applysectionsizes) and the `sectionSizes` option capture and restore open sections' content sizes for **cross-session persistence** — a consumer's own store, not built into the library. Each entry's unit follows the same `weight`/`fillHeight` rule the resize pin above reads: a resize-pinned section (`weight` unset or `0`, with `fillHeight` off) persists as **px**, restored verbatim regardless of the window size on reload; every other section persists as a **ratio** of the space the pinned sections leave. `sectionresize` fires once a completed gutter drag settles the sizes — never per frame — so a listener can persist on every commit without debouncing:

```typescript
import { LayoutSize } from '@jimka/typescript-ui/layout';

accordion.on("sectionresize", (sizes: LayoutSize[]) => {
    localStorage.setItem("sidebar-sections", JSON.stringify(sizes));
});

// On the next session:
const saved = localStorage.getItem("sidebar-sections");
const sidebar = Accordion({
    resizable   : true,
    sectionSizes: saved ? JSON.parse(saved) : undefined,
});
```

`sectionSizes` is only meaningful **with `resizable`** — on a non-resizable accordion it stays pending until `setResizable(true)` enables the layout pass that can apply it. A saved array whose length or per-index unit no longer matches the live sections (e.g. a section's `weight` changed between releases) is **discarded whole**, and the accordion falls back to its normal seeded sizing.

## Expand / collapse all

`expandAll()` opens every section; `collapseAll()` closes every section. Both emit `sectiontoggle` as they open/close sections and schedule a single layout pass. `expandAll()` respects single-open mode — under `singleOpen` it opens only the first section rather than leaving the last-opened one visible.

```typescript
accordion.expandAll();
accordion.collapseAll();
```

## Per-child constraints

[`AccordionConstraints`](/api/layout/classes/AccordionConstraints):

| Field | Purpose |
| --- | --- |
| `label` | Header title text (required). |
| `initiallyOpen` | When `true`, the section starts expanded. Default: `false`. |
| `glyph` | Optional registry glyph name shown leading the title label. |
| `tools` | Optional per-section tool components for this header's tool group. |

## Toggle callback

Pass a `listeners: { sectiontoggle }` bag in the constructor (preferred) or call `on("sectiontoggle", fn)` later:

```typescript
import { SectionToggleCallback } from '@jimka/typescript-ui/layout';
const onToggle: SectionToggleCallback = (index, open) => {
    console.log(`section ${index} now ${open ? 'open' : 'closed'}`);
};

const accordion = new Accordion({ listeners: { sectiontoggle: onToggle } });
// …or after construction:
accordion.on("sectiontoggle", onToggle);
```

For persisting section *sizes* rather than open/closed state, see [Saving and restoring section sizes](#saving-and-restoring-section-sizes).

## Sizing

The accordion's size hints follow its open state:

- **[`getPreferredSize`](/api/layout/classes/Accordion#getpreferredsize)** sums every header height plus the *preferred* content height of each **open** section. Closed sections contribute only their header.
- **[`getMinSize`](/api/layout/classes/Accordion#getminsize)** sums every header height plus the *minimum* content height of each open section — headers are always visible, so they always count. (It does not assume open content can collapse to nothing.)

When the container is shorter than the open sections' combined preferred height, the accordion **shrinks each open section to fit**, mirroring `"preferred"`-mode [`VBox`](/api/layout/classes/VBox): each open section's content shrinks proportionally from its preferred height toward its minimum so the last section's edge lands inside the container. Headers never shrink. If even the open sections' combined *minimum* exceeds the container, the sections fall back to their preferred height and let the host clip or scroll — a layout crammed below every section's minimum reads worse than a clean overflow. When the container can hold every open section at its preferred height, no shrinking happens.

## Animation

Each toggle animates four things in lock-step over the same duration and easing curve so the close reads as the frame-perfect reverse of the open:

- **Wrapper `height`** — the toggling section's panel grows from 0 to the section's laid-out height (its content's preferred height, or a smaller height when the accordion is shrinking open sections to fit — see [Sizing](#sizing)) and shrinks back to 0 on close. The wrapper has `overflow: hidden` and `contain: layout paint` so it clips its content as it grows or shrinks. A closing section's content stays at its full laid-out height while the wrapper clips it to 0 — the wrapper does the clipping, not a collapsing content box. `transform: scaleY` was considered and rejected because the wrapper needs to participate in document flow for siblings to reflow.
- **Header / wrapper `top`** — every header and wrapper below a toggling section transitions its vertical position so the stack moves as one piece with the toggling wrapper's edge instead of snapping.
- **Container `height`** — for the duration of each active toggle the accordion's own container element receives the same `height` transition. The parent layout's instant resize (after it re-queries `getPreferredSize` with the new open state) would otherwise clip the still-animating sections via the container's default `overflow: hidden`.
- **Indicator `transform`** — the [`AccordionHeader`](/api/component/container/classes/AccordionHeader) chevron rotates 90° on the same curve as the panel-height transition so the two motions read as a single gesture.

The easing curve is `cubic-bezier(0.4, 0, 0.6, 1)` — a symmetric variant of the Material standard curve. Symmetry matters because `easing(t) + easing(1 - t) = 1` is the exact condition for a close to be the time-reverse of an open. The asymmetric Material "standard" `cubic-bezier(0.4, 0, 0.2, 1)` was rejected for breaking that property — under it a close shrinks ~77% of the way in the first half of the duration and crawls through the final 23% for the second half, which reads visually as "content vanished, then nothing happened".

For the lifetime of each active toggle the toggling wrapper is pre-promoted to its own compositor layer via [`Component.setWillChange("height")`](/api/core/classes/Component#setwillchange); the layer and the container's transient `height` transition are released on `transitionend` (filtered to `height`) with a `setTimeout(_animationDuration + 40)` fallback for interrupted transitions. The transitionend-with-fallback bookkeeping is encapsulated in [`Animation.afterTransition`](/api/core/namespaces/Animation/functions/afterTransition) so all "out-of-band" transitions across the framework finish through the same one-finish-only shape. In single-open mode, every section being closed by single-open enforcement is primed alongside the section being opened so both transitions start in lock-step on the same frame.

When the user has `prefers-reduced-motion: reduce` set, the will-change prime and the container transition are skipped, and every header and wrapper's `transition` is briefly flipped to `"none"` so the layout writes land instantly; the transition strings are restored on the next animation frame so subsequent toggles animate normally once the user clears the preference.

The duration and easing are a layout concern, not a theme concern — encoding them in themes would invite drift between the panel, container, header, and indicator transitions — so they are not part of the [`Theme`](/api/core/interfaces/Theme) surface. Override the duration on a per-Accordion basis via `animationDuration`.

## See also

- [API: Accordion](/api/layout/classes/Accordion)
- [API: AccordionConstraints](/api/layout/classes/AccordionConstraints)
- [API: SectionToggleCallback](/api/layout/type-aliases/SectionToggleCallback)
- [API: SectionResizeCallback](/api/layout/type-aliases/SectionResizeCallback)
- [API: LayoutSize](/api/layout/interfaces/LayoutSize) — the persisted-size vocabulary shared with [`Split`](/layouts/Split#saving-and-restoring-layout)
- [`AccordionHeader`](/api/component/container/classes/AccordionHeader) — the section header
