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

[`AccordionOptions`](/api/layout/interfaces/AccordionOptions) accepts `singleOpen`, `headerHeight`, `animationDuration`, and a `listeners: { sectiontoggle }` bag declaratively. The setters (`setSingleOpen`, `setHeaderHeight`, `setAnimationDuration`) still work for runtime updates; subscribe to toggles via `on("sectiontoggle", fn)`.

## Per-child constraints

[`AccordionConstraints`](/api/layout/classes/AccordionConstraints):

| Field | Purpose |
| --- | --- |
| `label` | Header button text (required). |
| `initiallyOpen` | When `true`, the section starts expanded. Default: `false`. |

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

The duration and easing are a layout concern, not a theme concern — encoding them in themes would invite drift between the panel, container, header, and indicator transitions — so they are not part of the [`Theme`](/api/core/classes/Theme) surface. Override the duration on a per-Accordion basis via `animationDuration`.

## See also

- [API: Accordion](/api/layout/classes/Accordion)
- [API: AccordionConstraints](/api/layout/classes/AccordionConstraints)
- [API: SectionToggleCallback](/api/layout/type-aliases/SectionToggleCallback)
- [`AccordionHeader`](/api/component/container/classes/AccordionHeader) — the section header
