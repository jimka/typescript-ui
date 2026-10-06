---
depends-on: [scroll-reveal-geometry-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/core/Panel.ts
  - packages/lib/src/typescript/lib/core/FocusReveal.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/component/container/ScrollStrip.ts
  - packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/tests/component/container/ScrollStrip.test.ts
  - packages/lib/docs/concepts/accessibility.md      # also edited by feature/spatial-navigation-redesign and the sibling plans dialog-aria-semantics, focus-history-transient-layers
  - packages/lib/docs/reference/changelog/next.md    # also edited by those, and by tree-page-keys
  - packages/lib/docs/components/Tree.md             # also edited by tree-page-keys
---

# Nested Scroll Reveal — Implementation Plan

## Overview

The library *reveals* a control before it focuses one that is out of sight: it opens whatever hides the control and scrolls it into view. Focus history, spatial navigation and any consumer call do that through one broker, [`FocusReveal.reveal`](../packages/lib/src/typescript/lib/core/FocusReveal.ts#L103). The broker asks every container around the control to reveal it, the outermost one first. That order is wrong for scrolling. The broker also measures while the containers it has just opened are still moving. This plan fixes both, and makes a list, a tree and a table show their current row when they sit in a scrolling page. It is a library-only change.

Five terms are used throughout.

- The **scroll viewport** is the visible window onto scrolled content: the scrolling component's box inside its border, less the band each visible scrollbar occupies.
- A **revealer** is a container registered with the broker (the [`FocusRevealer`](../packages/lib/src/typescript/lib/core/FocusReveal.ts#L15) interface). An **opener** reveals by changing state: a `Tab` selects a tab, an `Accordion` opens a section, a `Split` or a `Border` expands a pane or a region. A **scroller** reveals by scrolling: a scrolling `Panel`, a `ScrollStrip`.
- A **layout flush** is the library's once-per-frame pass that lays out every component queued with `scheduleLayout()`. [`Component.afterNextLayout(callback)`](../packages/lib/src/typescript/lib/core/Component.ts#L8296) runs a callback right after the next one.
- The geometry around a control is **settled** when no layout pass is queued for a component around it and no opener around it is still animating.
- A **scrolling page** is a scrolling `Panel` that holds other components, among them a list, a tree or a table that scrolls its own rows.

The branch this plan builds on, `feature/scroll-reveal-geometry-fixes`, is called **the dependency** below. It gave the library one rule for the least scroll that shows a span, and one viewport answer per scroll system.

Every defect below was measured in Chromium on the dependency's branch. The numbers are in [the addendum](#addendum-what-was-measured).

| # | Defect | Measured |
|---|---|---|
| 1 | With two scrollers nested, the outer one scrolls before the inner one | one `reveal` scrolled the outer panel to its end (1191) and then the inner one (1282); the control ended 342 px above the outer viewport. A second call put it right. Three levels needed three calls |
| 2 | A scroller around a collapsed `Split` pane, a collapsed `Border` region or a closed `Accordion` section scrolls before the opener opens | a page scrolled to 300 jumped to 254, and the control ended 206 px below its bottom edge |
| 3 | The reveal measures while an `Accordion` section is still opening | the page stopped at the old end of its scroll range (500 of 920) and the control ended 409 px below the bottom edge. In single-open mode the control moved 420 px in the 200 ms after it was measured |
| 4 | A reveal into a pane or region that has just expanded throws away the position the pane was left at | a pane left at 1400 with the control in view came back at 1193 |
| 5 | A reveal asked for before the first layout of a new panel is lost | in the same task as `Drawer.open()` the panel's viewport was 0 px high, nothing scrolled, and the control stayed 682 px below the view |
| 6 | A control that is not rendered still moves panels | defect 2's jump from 300 to 254: a control under `display: none` measures as an empty rectangle at the window's origin |
| 7 | A list, a tree and a table scroll only themselves | in a scrolling page, `End` in a list left the current row 90 px below the page's bottom edge. A tree row: 61 px. A table row: 3, 23 and 43 px on three presses of `ArrowDown` |

Three cases were measured and found correct, and stay as they are.[^fine]

**The common cause.** The broker has one loop for two jobs. Opening has to run outermost first, because an inner container cannot be measured before the outer one shows it. Scrolling has to run innermost first, because an outer scroller has to scroll to where the inner one left the control. And the loop runs at once, whether or not the boxes it measures are where they will stay.

The fix has four parts: two passes in the broker, a rectangle handed from scroller to scroller, a wait until the geometry has settled, and one broker call that lets a list, a tree or a table continue its own reveal outward.

---

## Architecture Decisions

### One reveal, two passes — openers outermost first, then scrollers innermost first

[`FocusReveal.reveal`](../packages/lib/src/typescript/lib/core/FocusReveal.ts#L103) keeps finding the revealers around the control with [`containing()`](../packages/lib/src/typescript/lib/core/FocusReveal.ts#L66), outermost first. It then works through them in two passes. The **open pass** calls `revealDescendant(target)` on every opener, in that order. The **scroll pass** then takes the scrollers in the reverse order.

A revealer is a scroller when it implements a new optional member of `FocusRevealer`, `revealRect`. Every other revealer is an opener.[^two-kinds] An optional member that only some implementers answer is how [`DismissableLayer`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L116) already tells its kinds of layer apart (`keepsOwnBand?()`, `onInertChanged?()`).

For a control inside a tab `T`, a scrolling panel `A`, a `Split` `S` and a scrolling panel `B`, nested in that order:

| Step | Today | This plan |
|---|---|---|
| 1 | `T` selects the tab | `T` selects the tab |
| 2 | `A` scrolls. The pane is still collapsed, so the control has no box | `S` expands the pane |
| 3 | `S` expands the pane | `B` scrolls the control into its viewport |
| 4 | `B` scrolls, which moves the control after `A` measured it | `A` scrolls to where `B` left the control |

The open pass still runs inside the `reveal` call, so the control can take focus when `reveal` returns. [`FocusHistory`](../packages/lib/src/typescript/lib/core/FocusHistory.ts#L161) and [`SpatialNavigation`](../packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L627) focus it on the next line, and neither changes.

### Each scroller is handed a rectangle and hands back what it shows — `revealRect`

The broker measures the control once. It hands that rectangle to the innermost scroller's `revealRect(rect)`. The scroller scrolls by the least distance that shows the rectangle, with the dependency's rule ([`nearestRevealOffset`](../packages/lib/src/typescript/lib/core/ScrollReveal.ts#L19)), and returns the rectangle as its viewport now shows it. The broker hands that result to the next scroller out.

No scroller measures the control again. The rectangle it returns is computed: the one it was handed, moved by the distance the scroll really covered.[^computed]

An outer panel 200 px high holds an inner panel 120 px high, 600 px down its content. The control is 30 px high and 500 px down the inner panel's content. Neither panel is scrolled. "In the window" means in browser-viewport coordinates, which is what a measured rectangle is in.

| Step | Who | Shows | Is handed (in its own content) | Scrolls to | Hands on (in the window) |
|---|---|---|---|---|---|
| 1 | the broker | | | | measures the control: 1100–1130 |
| 2 | inner panel | 0–120 | 500–530 | 410 (530 − 120) | 690–720: the rectangle moved up by 410 |
| 3 | outer panel | 0–200 | 690–720 | 520 (720 − 200) | 170–200 |

Today the outer panel goes first and scrolls to 930 (1130 − 200). The inner panel then scrolls to 410, which puts the control at 690–720 of the outer content while the outer panel shows 930–1130.

`Panel.revealDescendant(target)` stays, with its signature. It measures `target` and runs the same code as `revealRect`.

### What a scroller hands on is cut to its viewport

The rectangle a scroller returns is the moved rectangle with each edge held inside the scroller's viewport. A scroller cannot show more of a control than its own viewport, so that part is all the next scroller has to show. A rectangle that ends up wholly outside the viewport along an axis becomes the viewport's nearer edge on that axis.

For a viewport that covers 100–400 across and 100–300 down, with rectangles written as left, top, right, bottom:

| Rectangle | Moved by | Handed on | Why |
|---|---|---|---|
| 150, 150, 190, 180 | 0, 0 | 150, 150, 190, 180 | inside the viewport |
| 150, 400, 190, 430 | 0, −130 | 150, 270, 190, 300 | moved into view, flush with the bottom edge |
| 150, 100, 190, 500 | 0, 0 | 150, 100, 190, 300 | taller than the viewport: cut to it |
| 450, 150, 490, 180 | 0, 0 | 400, 150, 400, 180 | right of the viewport: its right edge, no width |

Two results follow.[^clip] A control taller than the inner viewport makes the outer panel show the whole inner viewport, not a stretch of the control that the inner panel hides. A control the inner panel clips sideways does not scroll the outer panel sideways.

### The two rectangle helpers live in `core/ScrollReveal.ts`

`revealedRect(rect, dx, dy, view)` is the rule of the section above. `spanRect(view, axis, from, to)` builds the rectangle of a row or a column. Both are pure functions, added to [`core/ScrollReveal.ts`](../packages/lib/src/typescript/lib/core/ScrollReveal.ts#L19), the dependency's module for the one reveal rule that `Panel` and the virtual views share. Neither is exported from `core/index.ts`.

### The scroll pass waits until the geometry around the control has settled

The scroll pass runs inside the `reveal` call when the geometry is settled. Otherwise it puts itself off with `Component.afterNextLayout`, and asks again after each layout flush until the geometry is settled. It then scrolls once.[^settle]

Two things make the geometry unsettled, and the broker asks each where it is known:

| What is unsettled | Who knows | How the broker asks |
|---|---|---|
| a layout pass is queued for a component around the control | `Component`'s layout queue | `Component.isLayoutQueuedAround(target)` — new, `@internal` |
| an `Accordion` section is animating open or shut | [`Accordion._toggleAnimations`](../packages/lib/src/typescript/lib/layout/Accordion.ts#L281) | `isRevealSettled()` — a second new optional member of `FocusRevealer` |
| a `Split` pane or a `Border` region is animating | `_collapsing` ([Split](../packages/lib/src/typescript/lib/layout/Split.ts#L270), [Border](../packages/lib/src/typescript/lib/layout/Border.ts#L133)) | `isRevealSettled()` |
| a `Tab` | it selects and lays out inside its own `revealDescendant` | nothing: a revealer without `isRevealSettled` is always settled |

When the scroll pass runs:

| Reveal into | The scroll pass runs | Measured with the change |
|---|---|---|
| nothing to open, no layout queued | inside the `reveal` call | 510 / 1282, in the call |
| a closed `Accordion` section | after the flush that follows the end of the 200 ms height transition | 909, after the animation |
| a collapsed `Split` pane or `Border` region | after the flush that follows the end of the 200 ms expand. The pane has its remembered offsets back by then | pane back at 1400, nothing scrolled |
| a panel mounted in the same task, as in a `Drawer` just opened | after the second layout flush | 682, on the second frame |
| the same openers under `prefers-reduced-motion: reduce` | `Split`, `Border`: inside the call. `Accordion`: after the next flush | offline only |

The wait is bounded. After 60 layout flushes the scroll pass scrolls with whatever it finds.[^bound]

The precedents are [`Tab._pendingActiveContent`](../packages/lib/src/typescript/lib/layout/Tab.ts#L333), a request that cannot be met yet and is applied on the next layout pass, and the focus that [`Drawer`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L408) and [`Dialog`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1017) put off with `Component.afterNextLayout`. Asking again from inside an `afterNextLayout` callback is what [`ScrollStrip`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L636) and [`VirtualRowView`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1064) already do to reach the following frame.

### Only a newer `reveal` replaces a waiting scroll pass

The broker keeps at most one waiting scroll pass. A new `reveal` call withdraws it before it starts its own. A scroll pass whose control has left the document while it waited does nothing.[^newest]

| Sequence | Result |
|---|---|
| `reveal(a)` waits; `reveal(b)` | only `b` is scrolled to |
| `reveal(a)` waits; a list's own row reveal runs | the list scrolls at once; `a` is still scrolled to when the geometry settles |
| `reveal(a)` waits; `a` is removed | nothing scrolls |

### A control that is not rendered scrolls nothing

The scroll pass asks [`DOM.source.isRenderedVisible(target)`](../packages/lib/src/typescript/lib/core/DOM.ts#L1786) after the wait and before it measures. When the control, or anything around it, is `display: none` or `visibility: hidden`, the scroll pass ends there. `reveal` still returns `true`, as it does today, and the caller's focus attempt fails as it does today.[^not-rendered]

### A scroller is not asked to show itself

When the control is a scroller's own element, that scroller is left out of the scroll pass. The scrollers around it still show it.[^self]

### A list, a tree and a table continue their reveal outward — `FocusReveal.revealRectAround`

A list, a tree and a table scroll their own rows, and do not go through `FocusReveal.reveal` to do it. After such a component has scrolled a row into its own viewport, it calls the new `FocusReveal.revealRectAround(origin, measure, axis)`. That call hands the row's rectangle to every scroller around the component, innermost first, with the same code as the scroll pass.

| Component | Its own reveal | Continues outward from | Axis |
|---|---|---|---|
| `List`, `MultiSelectList` | [`scrollIndexIntoView`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2331) → `Panel.revealSpan("y", …)` | inside [`Panel.revealSpan`](../packages/lib/src/typescript/lib/core/Panel.ts#L680) | y |
| `Tree`, `Table`, `TreeTable`: a row | [`VirtualRowView.scrollRowIntoView`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1125) | a new protected `VirtualRowView.revealSpanAround("y", …)` | y |
| `Table`, `TreeTable`: a column | [`Body.scrollColumnIntoView`](../packages/lib/src/typescript/lib/component/table/Body.ts#L3247) | `revealSpanAround("x", …)` | x |

Four rules hold for this call.[^widget]

- **It scrolls at once and never waits.** Shift+F10 reads the row's position on the line after the reveal ([`resolveContextMenuTarget`](../packages/lib/src/typescript/lib/component/shared/resolveContextMenuTarget.ts#L94)).
- **It scrolls along one axis.** A row reveal never moves a page sideways, and a column reveal never moves it up or down.
- **The rectangle is computed, not measured from a row.** It is the scroll viewport's rectangle, with the row's position in the content less the scroll offset. The row does not have to be rendered.
- **Nothing is measured when no scroller surrounds the component.** `measure` is a callback, called only when there is a scroller to hand its result to. A table that fills a window pays one walk of the revealer registry per reveal and reads no geometry.

`AbstractSelectableList` is not edited: the list's fix arrives through `Panel.revealSpan`.

### The virtual views get their viewport rectangle from the `VirtualScroller` — `getViewportRect()`

`VirtualScroller` gains `getViewportRect()`, the rectangle of its clip box in browser-viewport coordinates. It is the twin of `Panel.getScrollViewportRect()` for the second scroll system, beside the existing [`getViewportWidth()` / `getViewportHeight()`](../packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L391). It measures the DOM, so only a reveal calls it.[^clipbox]

### `ScrollStrip` answers `revealRect` itself

`ScrollStrip` extends `Panel`, so it inherits `Panel.revealRect`. The inherited method measures the strip's band, which never scrolls, and would return every rectangle untouched. The broker would then treat the strip as a scroller and never call its `revealDescendant`. So `ScrollStrip` overrides `revealRect` to scroll its clip, with the arithmetic [`revealItem`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L981) already has. `revealItem` keeps its own rule and its behaviour.[^strip]

### The dependency's three rules still hold

| Rule | How this plan keeps it |
|---|---|
| Offsets are never re-read under `display: none` | every `Panel` reveal still starts with `getScrollViewportRect()`, which is `null` for a hidden panel. `revealRect` then returns before `syncScrollOffsets()` and hands the rectangle on untouched (case P3). The scroll pass also ends before it measures when the control is not rendered |
| A scroll a panel does not take passes to the parent | an axis a panel does not scroll is not moved by it, and the rectangle is handed on along that axis, cut to the panel's viewport. The scroller outside reveals along it (case B9) |
| No layout read on the table's scroll or render path | the new reads are in reveals only, which run from key handlers, the edit-entry handler and Shift+F10. A scroll tick and a render pass read no geometry (case G5), and a reveal with no scroller around the component reads none either (case G2) |

### `Panel.revealDescendant` and `Panel.revealRect` act on one panel

Both scroll the panel they are called on and nothing around it. The broker is what walks outward. [`Menu`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1643) keeps calling `revealDescendant` on its own item panel.

`Panel.revealSpan` is the one `Panel` method that continues outward, through `revealRectAround`.[^one-level]

### The plan stands alone from `feature/spatial-navigation-redesign`

That unmerged branch adds an optional `getScrollViewportElement()` to `FocusRevealer`, implemented by `Panel` and `ScrollStrip`. This plan does not use it and does not depend on the branch. The two can merge in either order.[^spatial]

After both have merged, a scroller implements both optional members. They do different jobs: `getScrollViewportElement()` names the element that scrolls, for an ancestor walk, and `revealRect()` scrolls it.

| That branch's code | What it calls | Effect of this plan |
|---|---|---|
| `landOn`, target tier | `FocusReveal.reveal(landing)`, then focus | the open pass has run when `reveal` returns, so the landing takes focus as before. The scroll may follow after a layout flush |
| `landOn`, component tier | focus, then `FocusReveal.reveal(landing)` | the same |
| `scrollViewportsOf` | `FocusReveal.containing()` and `getScrollViewportElement?.()` | none: `containing()` is unchanged |
| a test double with no `revealRect` | registered as a revealer | it is an opener: `revealDescendant` is called, outermost first, as today |

The merge has two conflicts in source files. `## Potential Challenges` gives the resolution of each.

**Assumed merge order:** `context-menu-keyboard-operation` → `table-tree-keyboard-context-menu` → `modal-dialog-focus-trap` → `list-scroll-index-into-view` → `scroll-reveal-geometry-fixes` → this plan, each branch created from the tip of the one before. `spatial-navigation-redesign` merges into `master` at any point in that sequence.

---

## Public API

No symbol is added to a barrel. Members are added to an interface, a namespace and classes that are already exported.

```typescript
// core/FocusReveal.ts
export interface FocusRevealer {
    getRevealElement(): Handle | null;                 // unchanged
    revealDescendant(target: Handle): void;            // unchanged
    revealRect?(rect: Rect, axis?: ScrollAxis): Rect;  // new, optional: implemented by a scroller
    isRevealSettled?(): boolean;                       // new, optional: implemented by an opener that animates
}

export namespace FocusReveal {
    export function reveal(target: Handle): boolean;   // signature unchanged
    export function revealRectAround(origin: Handle, measure: () => Rect, axis?: ScrollAxis): void;   // new
}

// core/Panel.ts — class Panel
revealRect(rect: Rect, axis?: ScrollAxis): Rect;       // new
revealDescendant(target: Handle): void;                // signature unchanged
revealSpan(axis: ScrollAxis, start: number, end: number): this;   // signature unchanged; now continues outward

// component/container/ScrollStrip.ts — class ScrollStrip
revealRect(rect: Rect, axis?: ScrollAxis): Rect;       // new: overrides Panel's

// component/container/VirtualScroller.ts — class VirtualScroller
getViewportRect(): Rect;                               // new

// layout/Accordion.ts, layout/Split.ts, layout/Border.ts
isRevealSettled(): boolean;                            // new
```

`Rect` is the existing type in `core/DOM.ts`. `ScrollAxis` (`"x" | "y"`) is the existing type in `core/SmoothScroller.ts`. Both are already exported from `core/index.ts`.

Not public:

```typescript
// core/Component.ts — class Component, @internal
static isLayoutQueuedAround(target: Handle): boolean;

// core/ScrollReveal.ts — NOT re-exported from core/index.ts
export function revealedRect(rect: Rect, dx: number, dy: number, view: Rect): Rect;
export function spanRect(view: Rect, axis: ScrollAxis, from: number, to: number): Rect;

// component/shared/VirtualRowView.ts — protected
protected revealSpanAround(axis: ScrollAxis, start: number, end: number): void;
```

None of these is a state-bearing property: there is no setter, no backing field and no options field. The broker's one piece of state is the module-level `_waiting` in `FocusReveal.ts`.

---

## Internal Structure

Every block below was compiled, linted and run as a prototype.[^prototype] Copy the text as it stands.

### `core/ScrollReveal.ts` — two functions appended

Add `import type { Rect } from "~/core/DOM.js";` and `import type { ScrollAxis } from "~/core/SmoothScroller.js";` under the licence line, followed by a blank line. Append after `nearestRevealOffset`:

```typescript
/**
 * What a scroll viewport shows of a rectangle after scrolling it: `rect`
 * moved by (`dx`, `dy`), with each edge held inside `view`. A rectangle that
 * ends up wholly outside the viewport along an axis collapses to the
 * viewport's nearer edge on that axis.
 *
 * All four arguments and the result are in browser-viewport coordinates.
 *
 * @param rect - The rectangle before the scroll.
 * @param dx - How far the scroll moved the content to the right; negative for a move to the left.
 * @param dy - How far the scroll moved the content down; negative for a move up.
 * @param view - The scroll viewport.
 * @returns The part of the moved rectangle that shows through `view`.
 */
export function revealedRect(rect: Rect, dx: number, dy: number, view: Rect): Rect {
    const left   = Math.min(Math.max(rect.left   + dx, view.left), view.right);
    const right  = Math.min(Math.max(rect.right  + dx, view.left), view.right);
    const top    = Math.min(Math.max(rect.top    + dy, view.top),  view.bottom);
    const bottom = Math.min(Math.max(rect.bottom + dy, view.top),  view.bottom);

    return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * The rectangle a span of scrolled content shows through a scroll viewport:
 * the span along `axis`, the viewport's whole extent across it, cut to the
 * viewport. A list row is one — as high as the row and as wide as the list.
 *
 * All arguments and the result are in browser-viewport coordinates.
 *
 * @param view - The scroll viewport.
 * @param axis - The axis the span runs along.
 * @param from - Where the span begins.
 * @param to - Where the span ends.
 * @returns The part of the span that shows through `view`.
 */
export function spanRect(view: Rect, axis: ScrollAxis, from: number, to: number): Rect {
    const span: Rect = axis === "y"
        ? { ...view, y: from, top: from, bottom: to, height: to - from }
        : { ...view, x: from, left: from, right: to, width: to - from };

    return revealedRect(span, 0, 0, view);
}
```

### `core/Component.ts` — one static method

Inserted between the closing brace of [`afterNextLayout`](../packages/lib/src/typescript/lib/core/Component.ts#L8296) (line 8312) and the JSDoc of `currentLayoutPass` (line 8314):

```typescript
    /**
     * Whether the next layout flush lays out a component whose element
     * contains `target`. While one is queued, the geometry around `target` is
     * not final: the flush may move or resize it. A queued component that has
     * been laid out directly since it was queued no longer owes its pass, and
     * does not count.
     *
     * @param target - The element to test.
     * @returns `true` when a layout pass is queued, and still owed, around `target`.
     *
     * @internal
     */
    static isLayoutQueuedAround(target: Handle): boolean {
        for (const component of pendingLayouts) {
            const element = component.getElement();
            const owed    = component.isLayoutDirty();
            const around  = element !== undefined && owed && DOM.source.contains(element, target);

            if (around) {
                return true;
            }
        }

        return false;
    }
```

### `core/FocusReveal.ts` — the file, less three unchanged functions

`register`, `unregister` and `containing` keep their text and their JSDoc, and are left out of the block below. Everything else is new or rewritten.

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, Rect } from "~/core/DOM.js";
import type { ScrollAxis } from "~/core/SmoothScroller.js";

/**
 * A container that can bring one of its hidden descendants into a focusable
 * state — select its tab, expand its collapsed region, scroll it into view.
 * Implemented by [`Tab`](/api/layout/classes/Tab), [`Border`](/api/layout/classes/Border),
 * [`Accordion`](/api/layout/classes/Accordion), [`Split`](/api/layout/classes/Split),
 * and the scroll {@link Panel}.
 *
 * A revealer is one of two kinds. One that reveals by changing state — a
 * tab, a collapsed region — implements the two required members. One that
 * reveals by scrolling also implements {@link FocusRevealer.revealRect}.
 *
 * @category Core
 */
export interface FocusRevealer {
    /** The container's own element, used for containment + outermost-first ordering. Null when unrendered. */
    getRevealElement(): Handle | null;
    /** Reveal whichever of this container's regions/children is on the DOM path to `target`. */
    revealDescendant(target: Handle): void;
    /**
     * Implemented only by a revealer that reveals by scrolling. Scrolls the
     * least distance that brings `rect` into this revealer's scroll viewport,
     * and returns what is then on show of it: the rectangle moved by the
     * scroll and cut to the viewport. The next scroller out is handed that
     * rectangle. A revealer that cannot scroll right now returns `rect` as
     * given.
     *
     * @param rect - The rectangle to show, in browser-viewport coordinates.
     * @param axis - Reveal along this axis only; along both when omitted.
     * @returns The part of `rect` this revealer shows after the scroll.
     */
    revealRect?(rect: Rect, axis?: ScrollAxis): Rect;
    /**
     * Implemented only by a revealer whose reveal leaves geometry moving:
     * `false` while a section, pane or region is still animating open or
     * shut. A revealer without it is always settled.
     *
     * @returns Whether every box this revealer positions is where it will stay.
     */
    isRevealSettled?(): boolean;
}

const _revealers = new Set<FocusRevealer>();

// How many layout flushes the scroll pass of a reveal waits for the geometry
// around its target to settle before it scrolls regardless. One flush runs
// per animation frame, so 60 is one second at 60 Hz: five times the 200 ms
// the library's own open and expand animations take. It is a count of
// flushes, not a duration, so a test can run it out without a clock.
const MAX_SETTLE_FLUSHES = 60;

// The scroll pass of the latest `reveal`, while it waits for the geometry
// around its target to settle. The next `reveal` withdraws it.
let _waiting: { cancel(): void } | null = null;

/** Withdraws the scroll pass that is still waiting, if there is one. */
function withdrawWaiting(): void {
    _waiting?.cancel();
    _waiting = null;
}

/**
 * Whether the geometry around `target` is final: no layout pass is queued for
 * a component around it, and no revealer around it is still animating.
 *
 * @param target - The element being revealed.
 * @param around - The revealers whose element contains `target`.
 * @returns `true` when a measurement taken now will still hold.
 */
function isSettled(target: Handle, around: readonly FocusRevealer[]): boolean {
    const layoutQueued = Component.isLayoutQueuedAround(target);

    return !layoutQueued && around.every(revealer => revealer.isRevealSettled?.() !== false);
}

/**
 * The revealers in `around` that reveal by scrolling, innermost first. One
 * whose own element is `origin` is left out: a scroller does not scroll to
 * show itself.
 *
 * @param origin - The element being revealed, or the one a rectangle belongs to.
 * @param around - The revealers whose element contains `origin`, outermost first.
 * @returns The scrolling revealers around `origin`, innermost first.
 */
function scrollersOf(origin: Handle, around: readonly FocusRevealer[]): FocusRevealer[] {
    return around
        .filter(revealer => revealer.revealRect !== undefined && revealer.getRevealElement() !== origin)
        .reverse();
}

/**
 * Hands `rect` from scroller to scroller, innermost first. Each one scrolls
 * to show the rectangle it is handed, and what it returns is handed to the
 * next.
 *
 * @param scrollers - The scrolling revealers, innermost first.
 * @param rect - The rectangle to show, in browser-viewport coordinates.
 * @param axis - Reveal along this axis only; along both when omitted.
 */
function scrollThrough(scrollers: readonly FocusRevealer[], rect: Rect, axis?: ScrollAxis): void {
    let onShow = rect;

    for (const scroller of scrollers) {
        onShow = scroller.revealRect!(onShow, axis);
    }
}

/**
 * Broker that lets {@link FocusHistory} (or any other consumer) surface a
 * hidden focus target before focusing it. Hiding containers register
 * themselves as {@link FocusRevealer}s, and {@link reveal} works through the
 * ones whose element contains a given target in two passes. First every
 * revealer that changes state acts, outermost first, so a `Tab` selects the
 * tab that makes an inner panel measurable. Then every revealer that scrolls
 * acts, innermost first, so an outer panel scrolls to where the inner one
 * left the target.
 *
 * @category Core
 */
export namespace FocusReveal {
    // register(), unregister() and containing(): unchanged, with their JSDoc.

    /**
     * Reveals `target`. Every revealer around it that changes state — a tab,
     * a collapsed region — acts at once, outermost first, so `target` can
     * take focus when this returns. Every revealer around it that scrolls
     * then acts, innermost first, each showing what the one inside it left on
     * show.
     *
     * The scrolling waits while the geometry around `target` is not final: a
     * layout pass is queued around it, or a section, pane or region is still
     * animating. It then runs after the layout flush that finds everything
     * settled, which can be after this call has returned. A later call
     * withdraws a scroll that is still waiting.
     *
     * @param target - The element to reveal.
     * @returns `false` when `target` is disconnected (nothing to reveal);
     *   `true` otherwise.
     */
    export function reveal(target: Handle): boolean {
        if (!DOM.source.isConnected(target)) {
            return false;
        }

        withdrawWaiting();

        for (const revealer of containing(target)) {
            if (revealer.revealRect === undefined) {
                revealer.revealDescendant(target);
            }
        }

        scrollIntoView(target, MAX_SETTLE_FLUSHES);

        return true;
    }

    /**
     * The scroll pass of {@link reveal}. Scrolls every scroller around
     * `target`, innermost first, once the geometry around it has settled;
     * until then it puts itself off to after the next layout flush.
     *
     * @param target - The element to scroll into view.
     * @param flushesLeft - How many more layout flushes to wait for the
     *   geometry to settle. At 0 the pass scrolls whatever it finds.
     */
    function scrollIntoView(target: Handle, flushesLeft: number): void {
        _waiting = null;

        const connected = DOM.source.isConnected(target);

        if (!connected) {
            return;
        }

        const around  = containing(target);
        const settled = flushesLeft === 0 || isSettled(target, around);

        if (!settled) {
            _waiting = Component.afterNextLayout(() => scrollIntoView(target, flushesLeft - 1));

            return;
        }

        // An element that is not rendered measures as an empty rectangle at
        // the window's origin. Scrolling towards that would move panels for
        // nothing.
        const rendered = DOM.source.isRenderedVisible(target);

        if (!rendered) {
            return;
        }

        scrollThrough(scrollersOf(target, around), DOM.source.getElementRect(target));
    }

    /**
     * Continues a reveal outward from `origin`: scrolls every scroller around
     * it, innermost first, to show a rectangle its owner worked out. For a
     * component that scrolls its own content and has just scrolled a row, a
     * cell or a span of it into view — a scrolling panel around the component
     * may still hide what it now shows.
     *
     * It scrolls at once and never waits. `measure` is called only when a
     * scroller surrounds `origin`, so a component that sits in no scrolling
     * panel measures nothing.
     *
     * @param origin - The element of the component the rectangle belongs to.
     * @param measure - Returns the rectangle to show, in browser-viewport coordinates.
     * @param axis - Reveal along this axis only; along both when omitted.
     */
    export function revealRectAround(origin: Handle, measure: () => Rect, axis?: ScrollAxis): void {
        const scrollers = scrollersOf(origin, containing(origin));

        if (scrollers.length === 0) {
            return;
        }

        scrollThrough(scrollers, measure(), axis);
    }
}
```

`scrollIntoView` is declared inside the namespace because it calls `containing`. It is not exported.

### `Panel` — `revealSpan`, `revealDescendant`, `revealRect`

[`revealSpan`](../packages/lib/src/typescript/lib/core/Panel.ts#L680) with its JSDoc (lines 668–695) becomes:

```typescript
    /**
     * Scrolls the least distance along `axis` that brings a span of the
     * scrolled content into the scroll viewport, and nothing when the span is
     * already in view. `start` and `end` are positions in the content, where
     * `0` is the content's leading edge. An axis this panel does not scroll
     * is left alone, and so is a panel that is not effectively visible.
     *
     * Every scrolling panel around this one then scrolls along the same axis
     * to show the part of the span this panel shows, so the span ends up
     * where the user can see it.
     *
     * @param axis - The axis to scroll along.
     * @param start - Where the span begins.
     * @param end - Where the span ends.
     * @returns This panel, for method chaining.
     */
    revealSpan(axis: ScrollAxis, start: number, end: number): this {
        const view    = this.getScrollViewportRect();
        const element = this.getElement();

        if (!view || !element) {
            return this;
        }

        // The browser also scrolls the panel on its own — a key press, a move
        // of focus, a touch pan — and the remembered offset does not hear of
        // it. Re-read it. This also stops a wheel scroll that is still easing,
        // which would otherwise carry the span out of view again.
        this.syncScrollOffsets();
        this.revealSpanWithin(view, axis, start, end);

        // Where the content's leading edge is drawn now, after the scroll.
        const origin = axis === "y" ? view.top - this.getScrollTop() : view.left - this.getScrollLeft();

        FocusReveal.revealRectAround(element, () => spanRect(view, axis, origin + start, origin + end), axis);

        return this;
    }
```

`revealSpanWithin` (lines 697–726) is unchanged. [`revealDescendant`](../packages/lib/src/typescript/lib/core/Panel.ts#L734) with its JSDoc (lines 728–751) becomes these three methods:

```typescript
    /**
     * {@link FocusRevealer.revealDescendant}: scrolls `target` into the scroll
     * viewport by the least distance, along each axis this panel scrolls.
     * This panel only: a scrolling panel around it is not touched.
     *
     * @param target - The element to scroll into view.
     */
    revealDescendant(target: Handle): void {
        const view = this.getScrollViewportRect();

        if (view) {
            this.revealRectWithin(view, DOM.source.getElementRect(target));
        }
    }

    /**
     * {@link FocusRevealer.revealRect}: scrolls the least distance that brings
     * `rect` into the scroll viewport, and returns what the viewport then
     * shows of it. This panel only: a scrolling panel around it is not
     * touched. A panel that does not scroll, is not rendered or is not
     * effectively visible moves nothing and returns `rect` as given.
     *
     * @param rect - The rectangle to show, in browser-viewport coordinates.
     * @param axis - Reveal along this axis only; along both when omitted.
     * @returns The part of `rect` the scroll viewport shows after the scroll.
     */
    revealRect(rect: Rect, axis?: ScrollAxis): Rect {
        const view = this.getScrollViewportRect();

        return view ? this.revealRectWithin(view, rect, axis) : rect;
    }

    /**
     * {@link revealRect} against a viewport already measured.
     *
     * @param view - The scroll viewport, from {@link getScrollViewportRect}.
     * @param rect - The rectangle to show, in browser-viewport coordinates.
     * @param axis - Reveal along this axis only; along both when omitted.
     * @returns The part of `rect` the viewport shows after the scroll.
     */
    private revealRectWithin(view: Rect, rect: Rect, axis?: ScrollAxis): Rect {
        this.syncScrollOffsets();

        // The rectangle is where it is drawn now. Adding the current offset
        // turns it into a position in the scrolled content.
        const left = this.getScrollLeft();
        const top  = this.getScrollTop();
        const dx   = left - view.left;
        const dy   = top  - view.top;

        if (axis !== "y") {
            this.revealSpanWithin(view, "x", rect.left + dx, rect.right + dx);
        }

        if (axis !== "x") {
            this.revealSpanWithin(view, "y", rect.top + dy, rect.bottom + dy);
        }

        // The setters read the offset back after writing it, so the two
        // differences are how far the browser really moved the content.
        return revealedRect(rect, left - this.getScrollLeft(), top - this.getScrollTop(), view);
    }
```

### `ScrollStrip` — `revealItem`, `revealRect`, `revealRectInClip`

The method [`revealItem`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L981) (lines 981–1015) is replaced by the three methods below. The JSDoc above `revealItem` stays. The private method is named `revealRectInClip`, not `revealRectWithin`: `Panel` has a private method of that name, and a subclass cannot declare a second one.

```typescript
    revealItem(itemElement: Handle): void {
        const clipElement = this._clip.getElement();

        if (!clipElement) {
            return;
        }

        const clip = DOM.source.getElementRect(clipElement);
        const item = DOM.source.getElementRect(itemElement);

        this.revealRectInClip(clip, item);
    }

    /**
     * {@link FocusRevealer.revealRect}: scrolls the clip the least distance
     * along the strip's main axis that brings `rect` into it, and returns
     * what the clip then shows of it. Overrides `Panel`'s own inherited
     * implementation, which would measure this band element — the band itself
     * never scrolls; the clip does.
     *
     * @param rect - The rectangle to show, in browser-viewport coordinates.
     * @param axis - Reveal along this axis only; along both when omitted. A
     *   strip scrolls along its main axis alone, so the other one moves nothing.
     * @returns The part of `rect` the clip shows after the scroll.
     */
    revealRect(rect: Rect, axis?: ScrollAxis): Rect {
        const clipElement = this._clip.getElement();

        if (!clipElement) {
            return rect;
        }

        const clip     = DOM.source.getElementRect(clipElement);
        const mainAxis = this.isVertical() ? "y" : "x";

        if (axis !== undefined && axis !== mainAxis) {
            return revealedRect(rect, 0, 0, clip);
        }

        return this.revealRectInClip(clip, rect);
    }

    /**
     * Scrolls the clip along the main axis by the least distance that brings
     * `item` into it, from rectangles already measured.
     *
     * @param clip - The clip's rectangle, in browser-viewport coordinates.
     * @param item - The rectangle to show, in browser-viewport coordinates.
     * @returns The part of `item` the clip shows after the scroll.
     */
    private revealRectInClip(clip: Rect, item: Rect): Rect {
        const vertical = this.isVertical();

        const clipStart = vertical ? clip.top : clip.left;
        const clipEnd = vertical ? clip.bottom : clip.right;
        const itemStart = vertical ? item.top : item.left;
        const itemEnd = vertical ? item.bottom : item.right;

        let delta = 0;

        if (itemStart < clipStart) {
            delta = itemStart - clipStart;
        } else if (itemEnd > clipEnd) {
            delta = itemEnd - clipEnd;
        }

        // How far the content really moved along the main axis: positive is
        // towards the end. The browser clamps the write, so read it back.
        let scrolled = 0;

        // getBoundingClientRect already reflects the current scroll, so `delta` is
        // the screen-space correction; apply it to the native offset, then refresh
        // the arrows. Like scrollBy, a reveal that moves the scroll must re-derive
        // the arrows' enabled state — reveal-on-select can jump from the start to
        // the end (e.g. selecting the last tab while scrolled fully to the start),
        // which flips both arrows' limits.
        if (delta !== 0) {
            const before = this.mainScroll();

            this.setMainScroll(before + delta);
            this.refreshArrows();
            scrolled = this.mainScroll() - before;
        }

        return revealedRect(item, vertical ? 0 : -scrolled, vertical ? -scrolled : 0, clip);
    }
```

`revealItem` reads the clip's rectangle before the item's, as it does today. An existing test stages the two rectangles in that order.

### `isRevealSettled` on the three openers

Each is inserted directly after the manager's `getRevealElement()` and before the JSDoc of its `revealDescendant`.

```typescript
    // layout/Accordion.ts — after getRevealElement() (line 1220)
    /**
     * {@link FocusRevealer.isRevealSettled}: whether no section is animating
     * open or shut. While one is, the sections below it are still moving.
     *
     * @returns `false` from a toggle until its height transition ends.
     */
    isRevealSettled(): boolean {
        return this._toggleAnimations === 0;
    }
```

```typescript
    // layout/Split.ts — after getRevealElement() (line 1959)
    /**
     * {@link FocusRevealer.isRevealSettled}: whether no pane is animating
     * open or shut. While one is, the other panes are still moving, and an
     * expanded pane has not yet been given back the scroll offsets it was
     * collapsed with.
     *
     * @returns `false` from a collapse or an expand until its animation settles.
     */
    isRevealSettled(): boolean {
        return !this._collapsing;
    }
```

`layout/Border.ts` gets the `Split` block after its `getRevealElement()` (line 1632), with every "pane" replaced by "region" and "panes" by "regions".

### `VirtualScroller.getViewportRect`

Change line 6 to `import type { Handle, Rect } from "~/core/DOM.js";`. Add directly after [`getViewportHeight()`](../packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L403):

```typescript
    /**
     * The scroll viewport as a rectangle in browser-viewport coordinates: the
     * box the rows are clipped to, {@link getViewportWidth} wide and
     * {@link getViewportHeight} high, inside the owner's border. An owner
     * turns a row's position into a rectangle with it, for a scrolling panel
     * around the owner to show.
     *
     * Unlike the two size getters, this one measures the DOM. It is for a
     * reveal, not for a scroll or a render pass.
     *
     * @returns The viewport's rectangle.
     */
    getViewportRect(): Rect {
        return DOM.source.getElementRect(this._clipBox);
    }
```

### `VirtualRowView` — `scrollRowIntoView` and `revealSpanAround`

`scrollRowIntoView` gains one line at the end of its body, after the `if (target !== scrollTop)` block and a blank line:

```typescript
        this.revealSpanAround("y", top, top + rowHeight);
```

The new method goes directly after `scrollRowIntoView` and before the JSDoc of `scrollToCommittedY`:

```typescript
    /**
     * Asks every scrolling panel around this view to show a span of its
     * content along one axis — a row, or a column — by the least scroll.
     * Called after the view has scrolled the span into its own viewport: a
     * panel around the view may still hide what the view now shows.
     *
     * The span's rectangle is worked out from the scroller's viewport and
     * offset, so the row or cell need not be rendered. Nothing is measured
     * when no scrolling panel surrounds the view.
     *
     * @param axis - The axis the span runs along.
     * @param start - Where the span begins, in content coordinates.
     * @param end - Where the span ends, in content coordinates.
     */
    protected revealSpanAround(axis: ScrollAxis, start: number, end: number): void {
        const element  = this.getElement();
        const scroller = this._scroller;
        const visible  = this.isEffectivelyVisible();

        if (!element || !scroller || !visible) {
            return;
        }

        FocusReveal.revealRectAround(element, () => {
            const view   = scroller.getViewportRect();
            const origin = axis === "y" ? view.top - scroller.getScrollY() : view.left - scroller.getScrollX();

            return spanRect(view, axis, origin + start, origin + end);
        }, axis);
    }
```

### `Body.scrollColumnIntoView` — one line

At the end of the body, after the `if (target !== scrollLeft)` block and a blank line:

```typescript
        this.revealSpanAround("x", left, left + widths[colIndex]);
```

---

## Ordered Implementation Steps

Work test-first. Steps 1–2 write the tests and watch them fail; steps 3–9 make them pass. Every line number in this plan is that of `feature/scroll-reveal-geometry-fixes` at `27c9b7157`. All commands run from `packages/lib`.

1. **New test files.** Create the four files below with the cases of `## Expected Behaviour` and the harness in `## Verification`.
   - `tests/core/ScrollRevealRect.test.ts` — R1–R5, Q1–Q4.
   - `tests/core/FocusRevealNested.test.ts` — B1–B9, P1–P3, S1–S2, O1, W1–W7.
   - `tests/component/layout/RevealSettle.test.ts` — K1–K6.
   - `tests/component/shared/RevealInScrollingPage.test.ts` — G1–G5.

   Run `npx vitest run tests/core/ScrollRevealRect.test.ts tests/core/FocusRevealNested.test.ts tests/component/layout/RevealSettle.test.ts tests/component/shared/RevealInScrollingPage.test.ts`. Check: every case fails except B5, S2 and G2, which today's code already satisfies.

2. **`tests/component/container/ScrollStrip.test.ts`.** Make the three edits of *The one existing test that changes* in `## Expected Behaviour`, and add X1–X2. Check: `npx vitest run tests/component/container/ScrollStrip.test.ts` — X1, X2 and `'registers as a FocusRevealer, so FocusReveal.reveal scrolls a clipped-out item into view'` fail; the other 21 cases pass.

3. **`core/ScrollReveal.ts`.** Add the two imports and the two functions of `## Internal Structure`. Do not add them to `core/index.ts`. Check: `npx vitest run tests/core/ScrollRevealRect.test.ts tests/core/ScrollReveal.test.ts` passes.

4. **`core/Component.ts`.** Insert `isLayoutQueuedAround` where `## Internal Structure` says. Check: `npm run typecheck`.

5. **`core/FocusReveal.ts`.** Replace the two import lines (3–4) with the four of `## Internal Structure`. Replace everything from the JSDoc of `FocusRevealer` (line 6) to the line `const _revealers = new Set<FocusRevealer>();` (line 22) with the block that runs from that JSDoc to the end of `scrollThrough`. Replace the JSDoc of the namespace (lines 24–33). Replace `reveal` and its JSDoc (lines 95–113) with `reveal`, `scrollIntoView` and `revealRectAround`. Leave `register`, `unregister` and `containing` as they are.

   Check: `npm run typecheck`, then `npx vitest run tests/unit/core tests/core/PanelScrollReveal.test.ts tests/component/list` passes. No `Panel` has `revealRect` yet, so every panel is still an opener and the old order still holds. The new test files stay red.

6. **`core/Panel.ts`.** Change line 14 to `import { nearestRevealOffset, revealedRect, spanRect } from "~/core/ScrollReveal.js";`. Replace `revealSpan` and `revealDescendant` as `## Internal Structure` says. Do not run the strip's tests yet: between this step and the next, `ScrollStrip` inherits `Panel.revealRect` and its reveal through the broker is broken.

7. **`component/container/ScrollStrip.ts`.** Change line 6 to `import type { Handle, Rect } from "~/core/DOM.js";`. Add `import type { ScrollAxis } from "~/core/SmoothScroller.js";` and `import { revealedRect } from "~/core/ScrollReveal.js";` after it. Replace the method `revealItem` with the three methods of `## Internal Structure`.

   Check: `npx vitest run tests/core/FocusRevealNested.test.ts tests/component/container/ScrollStrip.test.ts tests/core/PanelScrollReveal.test.ts tests/unit/core` passes. In `RevealInScrollingPage.test.ts`, G3 now passes.

8. **`layout/Accordion.ts`, `layout/Split.ts`, `layout/Border.ts`.** Add `isRevealSettled()` to each. Check: `npx vitest run tests/component/layout/RevealSettle.test.ts tests/component/layout` passes.

9. **The virtual views.**
   - `component/container/VirtualScroller.ts` — the import change and `getViewportRect()`.
   - `component/shared/VirtualRowView.ts` — after line 5 (`import type { Handle } …`) add `import type { ScrollAxis } from "~/core/SmoothScroller.js";` and `import { FocusReveal } from "~/core/FocusReveal.js";`. Change line 7 to `import { nearestRevealOffset, spanRect } from "~/core/ScrollReveal.js";`. Add the line to `scrollRowIntoView` and the method `revealSpanAround`. In the JSDoc of `scrollRowIntoView`, after "thumb stay in sync." add: "A scrolling panel around the view then scrolls to show the row as well (see {@link revealSpanAround})."
   - `component/table/Body.ts` — add the line to `scrollColumnIntoView`. In its JSDoc, after "of {@link scrollRecordIntoView}." add: "A scrolling panel around the body then scrolls sideways to show the column as well." `Body.ts` needs no new import.

   Check: `npx vitest run tests/component/shared/RevealInScrollingPage.test.ts tests/component/tree tests/component/table` passes.

10. **Grep checks.**
    - `grep -rn "revealRect" src/typescript/lib --include=*.ts -l` — exactly `core/FocusReveal.ts`, `core/Panel.ts`, `component/container/ScrollStrip.ts`, `component/shared/VirtualRowView.ts`.
    - `grep -rn "isRevealSettled" src/typescript/lib --include=*.ts -l` — exactly `core/FocusReveal.ts`, `layout/Accordion.ts`, `layout/Split.ts`, `layout/Border.ts`.
    - `grep -rn "revealRectAround" src/typescript/lib --include=*.ts` — one definition in `FocusReveal.ts` and two calls: `Panel.ts`, `VirtualRowView.ts`.
    - `grep -n "revealedRect\|spanRect\|ScrollReveal" src/typescript/lib/core/index.ts` — no output.
    - `grep -n "FocusReveal\|revealSpanAround" src/typescript/lib/component/list/AbstractSelectableList.ts` — no output.
    - `grep -n "revealer.revealDescendant(target)" src/typescript/lib/core/FocusReveal.ts` — exactly one line, inside the `revealRect === undefined` test.

11. **Neighbouring tests.** `npx vitest run tests/core tests/unit tests/component/container tests/component/layout tests/component/list tests/component/tree tests/component/table tests/component/input tests/component/shared tests/component/display tests/overlay`. Check: all pass. No existing test file other than `ScrollStrip.test.ts` needs an edit.

12. **Docs and changelog.** Make the edits in `## Documentation Impact`.

13. **Full verification.** Run the commands and the manual cases in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/ScrollRevealRect.test.ts` |
| Create | `packages/lib/tests/core/FocusRevealNested.test.ts` |
| Create | `packages/lib/tests/component/layout/RevealSettle.test.ts` |
| Create | `packages/lib/tests/component/shared/RevealInScrollingPage.test.ts` |
| Modify | `packages/lib/tests/component/container/ScrollStrip.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ScrollReveal.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusReveal.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` |
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/VirtualScroller.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

`FocusHistory.ts`, `SpatialNavigation.ts`, `Tab.ts`, `Menu.ts`, `AbstractSelectableList.ts`, `Tree.ts`, `CollapseSupport.ts`, `Drawer.ts` and `core/index.ts` are not edited.

---

## Expected Behaviour

Every numbered case is testable offline unless it is in the *Needs manual verification* table. Offline means the modelled DOM (`installTestDOM`), which has no layout engine. The dependency's plan, [`plans/implemented/scroll-reveal-geometry-fixes.md`](implemented/scroll-reveal-geometry-fixes.md), has a table of how offline tests get scroll geometry. Five more points matter here.

| Point | What to do |
|---|---|
| The modelled DOM keeps connectedness per element | call `setConnected(element, true)` on the control **and on every panel around it**. The broker drops, for good, a revealer whose element is rendered and not connected |
| Scroll offsets are not clamped | assert the exact numbers in the tables |
| An animation frame never runs by itself | capture `requestAnimationFrame` in `beforeEach` and run the captured callbacks by hand. One layout flush is one captured callback |
| A CSS transition never ends by itself | use fake timers and run the fallback timer out, as [`Split.collapseUndisplay.test.ts`](../packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts#L77) does |
| A collapsed pane's scroll offset stays in the model | write `{ scrollTop: 0 }` on the scrolling element after the collapse settles. A browser does that under `display: none` |

Helpers the new files define. `FocusRevealNested.test.ts` needs all of them; `RevealInScrollingPage.test.ts` needs the first five.

- `flushFrame()` → runs the animation-frame callbacks captured so far, once. `drainFrames()` → calls `flushFrame()` until none is left, ten times at most.
- `scroller(panel)`, `writeMark()`, `scrollWrites(from)` → as in [`PanelScrollReveal.test.ts:92–115`](../packages/lib/tests/core/PanelScrollReveal.test.ts#L92).
- `tops(...panels)` → each panel's `getScrollTop()`, after asserting that it equals `DOM.source.getScrollTop(scroller(panel))`.
- `root(options)` → `new Panel({ layoutManager: new Absolute(), flush: true, ...options })`.
- `mount(rootPanel, ...inside)` → pushes `rootPanel` on the list of components to dispose, then in this order: `setConnected(rootPanel.getElement(true), true)`, `setWidth(300)`, `setHeight(200)`, `doLayout()`, `drainFrames()`, and `setConnected(c.getElement(), true)` for each component of `inside`.
- `child(options, x, y, width, height)` → a panel like `root`'s with `preferredSize: { width, height }`, then `setX(x)` and `setY(y)`.
- `box(x, y, width, height)` → `new Component({ preferredSize: { width, height } })`, then `setX(x)` and `setY(y)`.
- `rect(left, top, right, bottom)` → a `Rect` with all eight fields. `edges(r)` → `[r.left, r.top, r.right, r.bottom]`.

Every panel's viewport is its whole box in these fixtures: no scrollbar band is seeded and the model has no border.

### The rectangle helpers — `ScrollRevealRect.test.ts`

`view` is `rect(100, 100, 400, 300)`.

| # | Call | `edges` of the result |
|---|---|---|
| R1 | `revealedRect(rect(150, 150, 190, 180), 0, 0, view)` | `[150, 150, 190, 180]` |
| R2 | `revealedRect(rect(150, 400, 190, 430), 0, -130, view)` | `[150, 270, 190, 300]`; `x` 150, `y` 270, `width` 40, `height` 30 |
| R3 | `revealedRect(rect(150, 100, 190, 500), 0, 0, view)` | `[150, 100, 190, 300]` |
| R4 | `revealedRect(rect(450, 150, 490, 180), 0, 0, view)` | `[400, 150, 400, 180]`; `width` 0 |
| R5 | `revealedRect(rect(20, 150, 60, 180), 0, 0, view)` | `[100, 150, 100, 180]` |
| Q1 | `spanRect(view, 'y', 150, 180)` | `[100, 150, 400, 180]`; `width` 300, `height` 30 |
| Q2 | `spanRect(view, 'x', 150, 180)` | `[150, 100, 180, 300]` |
| Q3 | `spanRect(view, 'y', 280, 340)` | `[100, 280, 400, 300]` |
| Q4 | `spanRect(view, 'y', 20, 60)` | `[100, 100, 400, 100]` |

### Nested panels through the broker — `FocusRevealNested.test.ts`

B1–B9 run once per scrollbar style (`'overlay'`, `'native'`), passed as `scrollbarStyle` to every panel. Unless a row says otherwise: `outer` is `root({ autoScroll: 'y' })`, `inner` is `child({ autoScroll: 'y' }, 0, 600, 250, 120)` added to `outer`, `target` is `box(10, 500, 40, 30)` added to `inner`, mounted with `mount(outer, inner, target)`. "Tops" is `tops(outer, inner)`.

| # | Given | Then |
|---|---|---|
| B1 | `FocusReveal.reveal(target.getElement())` | returns `true`; tops `[520, 410]`. The same call again: 0 scroll writes |
| B2 | a middle panel: `mid` is `child(…, 0, 600, 250, 150)` in `outer`, `inner` is `child(…, 0, 400, 200, 100)` in `mid`, `target` is `box(10, 300, 40, 30)`; `mount(outer, mid, inner, target)`; reveal | `tops(outer, mid, inner)` is `[550, 350, 230]` |
| B3 | `target` is `box(10, 500, 40, 300)`: taller than the inner viewport; reveal | tops `[520, 500]`. Without the cut to the viewport the outer panel goes to 600 |
| B4 | `outer` is `root({ autoScroll: 'auto' })`; `target` is `box(400, 500, 40, 30)`: clipped sideways by the inner panel; reveal | tops `[520, 410]`; `outer.getScrollLeft()` and `inner.getScrollLeft()` are 0 |
| B5 | `inner` at `(0, 20)`, `target` is `box(10, 40, 40, 30)`; reveal | 0 scroll writes |
| B6 | `outer.setScrollTop(300)`; `setRenderedVisible(target.getElement(), false)`; reveal | returns `true`; 0 scroll writes; tops `[300, 0]` |
| B7 | `inner` holds any box; `mount(outer, inner)`; `inner.setScrollTop(77)`; `vi.spyOn(inner, 'revealRect')`; `FocusReveal.reveal(inner.getElement())` | the spy was not called; tops `[520, 77]` |
| B8 | `outer.setScrollTop(800)` before the reveal | tops `[690, 410]`: the outer panel shows the whole control, not only the edge the inner panel put it on |
| B9 | `outer` is `root({ autoScroll: 'auto' })`; `inner` is `child({ autoScroll: 'y' }, 400, 600, 250, 120)`: cut at the page's right edge; reveal | tops `[520, 410]`; `inner.getScrollLeft()` 0; `outer.getScrollLeft()` 150 (450 − 300): the axis the inner panel does not scroll is left to the outer one |

### `Panel.revealRect`, `revealSpan`, `revealDescendant` — same file

Once per scrollbar style. P1–P3 use `panel = root({ autoScroll: 'auto' })`, `mount(panel)`.

| # | Given | Then |
|---|---|---|
| P1 | `panel.revealRect(rect(50, 500, 90, 540))`; then `panel.revealRect(rect(50, 20, 90, 60))`; then `panel.revealRect(rect(50, 50, 90, 550))` | returns `[50, 160, 90, 200]` and the offset is 340; returns `[50, 20, 90, 60]` and the offset stays 340; returns `[50, 0, 90, 200]` and the offset is 390 |
| P2 | `panel.revealRect(rect(500, 500, 540, 540), 'y')`; then `panel.revealRect(rect(500, 160, 540, 200), 'x')` | returns `[300, 160, 300, 200]`, `getScrollLeft()` 0, offset 340; then returns `[260, 160, 300, 200]`, `getScrollLeft()` 240 |
| P3 | `panel.setScrollTop(120)`; `panel.setDisplayed(false)`; `panel.revealRect(rect(50, 500, 90, 540))` | returns `[50, 500, 90, 540]`; 0 scroll writes; `getScrollTop()` 120 |
| S1 | `outer` is `root({ autoScroll: 'auto' })`; `inner` is `child({ autoScroll: 'y' }, 400, 600, 250, 120)`: cut at the page's right edge; `mount(outer, inner)`; `inner.revealSpan('y', 500, 530)`; then `inner.revealSpan('y', 420, 450)`; then `inner.revealSpan('y', 100, 130)` | tops `[520, 410]` and `outer.getScrollLeft()` 0; then 0 scroll writes; then tops `[520, 100]` |
| S2 | the default fixture; `inner.revealDescendant(target.getElement())` | tops `[0, 410]`: one panel only |

### Order and waiting — same file

The default fixture, with the library's default scrollbar style. `double(element, extra?)` registers `{ getRevealElement: () => element, revealDescendant: vi.fn(), ...extra }` with `FocusReveal.register` and records it; `afterEach` unregisters every recorded double.

| # | Given | Then |
|---|---|---|
| O1 | a double on `outer`'s element and one on `inner`'s; each `revealDescendant` records its name and `tops(outer, inner)` at the moment it is called; reveal | the record is `['outside:0,0', 'between:0,0']`; tops `[520, 410]` afterwards |
| W1 | a double on `outer`'s element with `isRevealSettled: () => settled`, `settled` false; reveal; `flushFrame()` twice; `settled = true`; `flushFrame()`; `flushFrame()` twice more | `reveal` returns `true` and makes 0 scroll writes; still 0 after the two flushes; tops `[520, 410]` after the third; 0 scroll writes in the last two |
| W2 | a double with `isRevealSettled: () => false`; reveal; `flushFrame()` 59 times; once more | 0 scroll writes after 59; tops `[520, 410]` after the 60th |
| W3 | `inner.scheduleLayout()`; reveal; `flushFrame()` | 0 scroll writes before the flush; tops `[520, 410]` after it |
| W4 | `aside` is `box(0, 0, 10, 10)` added to `outer`, then `outer.doLayout()`, `drainFrames()`, `aside.scheduleLayout()`; reveal | tops `[520, 410]` at once: a layout queued beside the control does not delay |
| W5 | `other` is `box(10, 0, 40, 30)` added to `inner`, laid out, drained and connected; a double with `isRevealSettled: () => settled`, `settled` false; `reveal(target)`; `settled = true`; `inner.setScrollTop(200)`; `reveal(other)`; `flushFrame()` twice | tops `[430, 0]` after the second reveal; 0 scroll writes in the two flushes |
| W6 | W1's double, not settled; reveal; `setConnected(target.getElement(), false)`; `settled = true`; `flushFrame()` | 0 scroll writes; tops `[0, 0]` |
| W7 | W1's double, not settled; reveal; `inner.revealSpan('y', 200, 230)`; `settled = true`; `flushFrame()` | tops `[520, 110]` right after `revealSpan`; tops `[520, 410]` after the flush |

### Openers that animate — `RevealSettle.test.ts`

The harness is [`Split.collapseUndisplay.test.ts`](../packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts#L77)'s: `install()` (modelled DOM, fake timers, frame capture), `flushFrames(offsetMs)` and `settle()`, copied with their constants. Add `flushOnce()`, which runs the captured frames one time at the current clock. `connect(...components)` calls `getElement(true)` and `setConnected(…, true)` on each and records the first for disposal.

`scrollPane(targetY)` builds `pane = new Container({ layoutManager: new Fit() })` holding `panel = new Panel({ layoutManager: new Absolute(), flush: true, autoScroll: 'y' })`, which holds `target = new Component({ preferredSize: { width: 40, height: 30 } })` at `setX(10)`, `setY(targetY)`.

The `Split` rig: `container = new Container({ layoutManager: new Split({ orientation: 'horizontal' }) })`, then `getElement(true)`, `setWidth(400)`, `setHeight(300)`, `clearInsets()`; panes `scrollPane(targetY).pane` and a `Fit` container with one 50 × 50 component; `doLayout()`; `connect(container, pane, panel, target)`; `flushFrames(0)`. The panel's `getScrollViewportRect().height` is 300. "Live" is `DOM.source.getScrollTop(scroller(panel))`.

| # | Given | Then |
|---|---|---|
| K1 | the `Split` rig with `targetY` 800; `panel.setScrollTop(700)`; `split.setPaneCollapsed(0, true)`; `settle()`; write `{ scrollTop: 0 }` on the scroller; reveal; `flushOnce()`; `settle()` | before the reveal `split.isRevealSettled()` is `true`. After it: `isPaneCollapsed(0)` false, `isRevealSettled()` false, live 0, `panel.getScrollTop()` 700. After `flushOnce()`: still not settled, live 0. After `settle()`: settled, live 700, `getScrollTop()` 700. Today's code ends at 530 |
| K2 | `vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true)` first; the `Split` rig with `targetY` 1100; `panel.setScrollTop(700)`; collapse; write `{ scrollTop: 0 }`; reveal | right after the reveal: `isRevealSettled()` true; live 830 and `getScrollTop()` 830 (the pane came back at 700, then 1130 − 300) |
| K3 | the same as K1 with a `Border`: `pane.setPreferredSize({ width: 150, height: 0 })`, added with `Object.assign(new LayoutConstraints(), { placement: Placement.WEST, collapsible: true })`, beside a 100 × 100 component; `border.setRegionCollapsed(Placement.WEST, true)`; the steps of K1 without `flushOnce()` | as K1, with `border.isRegionCollapsed(Placement.WEST)` and `border.isRevealSettled()` |
| K4 | `page = new Panel({ layoutManager: new Absolute(), flush: true, autoScroll: 'y' })`; `host = new Container({ layoutManager: acc })` with `acc = new Accordion()`, `host.clearInsets()`, `setX(0)`, `setY(100)`; section A: `a`, a 100 × 150 component, `new AccordionConstraints('A', true)`; section B: `b`, `new Container({ layoutManager: new Absolute(), preferredSize: { width: 100, height: 400 } })` holding `target` (40 × 30 at `setX(10)`, `setY(350)`), `new AccordionConstraints('B', false)`; `page.addComponent(host)`, `page.getElement(true)`, 300 × 200, `doLayout()`, `connect(page, host, a, b, target)`, `flushFrames(0)`; reveal; `flushOnce()`; `settle()` | before: `acc.isRevealSettled()` true, `host.getHeight()` 206. After the reveal: `isSectionOpen(1)` true, not settled, 0 scroll writes. After `flushOnce()`: `host.getHeight()` 606, not settled, 0 scroll writes. After `settle()`: settled; `page.getScrollTop()` and the scrolling element's `scrollTop` are 486 (100 + 28 + 150 + 28 + 380 − 200) |
| K5 | K4 with `Animation.isReducedMotion` mocked to `true` before the rig is built; reveal; `flushOnce()` | after the reveal: `isRevealSettled()` true, 0 scroll writes, `host.getHeight()` 206. After `flushOnce()`: 606 and `page.getScrollTop()` 486 |
| K6 | a page as in K4 holding the `Split` container of K1, built with `preferredSize: { width: 280, height: 300 }`, `setX(0)`, `setY(400)` and no `setWidth` / `setHeight` of its own; `connect(page, container, pane, panel, target)`; `flushFrames(0)`; `panel.setScrollTop(700)`; collapse; `settle()`; write `{ scrollTop: 0 }`; `page.setScrollTop(300)`; reveal; `settle()` | the container is 280 × 300 and the panel's viewport 300 high. Right after the reveal `page.getScrollTop()` is still 300. After `settle()`: `panel.getScrollTop()` 700 and `page.getScrollTop()` 330, on the element too. Today's code scrolls the page to 1030 |

### A tree, a list and a table in a scrolling page — `RevealInScrollingPage.test.ts`

`page(options?)` is `root({ autoScroll: 'y', ...options })`. Each component is given a `preferredSize`, `setX` / `setY`, added to the page, and mounted with `mount(outer, component)`.

| # | Given | Then |
|---|---|---|
| G1 | `tree = new _Tree({ preferredSize: { width: 200, height: 120 } })` at `(0, 300)`; mounted; `tree.setNodes` of the ten labels `['H','e','l','o','W','r','d','x','X','o']`; `drainFrames()`; `scrollRowIntoView(9)`; then `scrollRowIntoView(4)`; then write `{ scrollTop: 0 }` on the page's scrolling element and `scrollRowIntoView(4)` again | `_scroller.getViewportRect()` is left 0, top 300, 188 × 120. Then `_scroller.getScrollY()` 120 and the page at 220 (300 + 120 − 200). Then scroll Y 96 and 0 scroll writes on any panel. Then the page at 124 (300 + 24 − 200) |
| G2 | a `_Tree` that is not in any panel: `getElement(true)`, 200 × 120, the same ten nodes; `vi.spyOn(DOM.source, 'getElementRect')`; `scrollRowIntoView(9)` | scroll Y 120; the spy was not called |
| G3 | `list = new _List({ items: 30 rows, preferredSize: { width: 200, height: 110 } })` at `(0, 300)`; `mount(outer, list, list._innerPanel)`; focus the list; a real `ArrowDown` `keydown`; a real `End` | after `ArrowDown`: focused index 0, page at 122 (300 + 22 − 200). After `End`: focused index 29; the inner panel's viewport is 108 high and at 552 (660 − 108); page at 208 (300 + 108 − 200) |
| G4 | `outer = page({ autoScroll: 'auto' })`; `body = new Body(store, { preferredSize: { width: 300, height: 100 } })` at `(200, 300)`, with the 100-record store and model of [`Body.test.ts`](../packages/lib/tests/component/table/Body.test.ts#L55)'s `bodyWith`; mounted; `renderWindow(300, [100, 100, 100])`; `drainFrames()`; `scrollRecordIntoView(recs[50])`; then `scrollColumnIntoView(2)` | viewport 288 × 88, row height 20. After the row: scroll Y 932, page at top 188 (300 + 88 − 200) and left 0. After the column: scroll X 12, page left 188 (200 + 288 − 300) and top still 188 |
| G5 | the G4 fixture; `vi.spyOn(DOM.source, 'getElementRect')`; twenty times `setScrollY(i * 13)` and `setScrollX(i % 12)`; five times `renderWindow(300, [100, 100, 100])`; `drainFrames()`; then `scrollRecordIntoView(recs[50])` | 0 calls to the spy after the ticks and renders; 2 calls after the one reveal (the scroller's clip box, the page's box) |

`scrollRowIntoView`, `scrollRecordIntoView`, `scrollColumnIntoView`, `renderWindow`, `setScrollX` and `setScrollY` are protected; reach them through an `any` cast, as the existing tree and table tests do.

### `ScrollStrip.revealRect` — added to `ScrollStrip.test.ts`

A strip built as in the file's `'refreshes the arrows after a reveal that moves the scroll'` case, with `getElementRect` mocked to return `rect(0, 0, 100, 20)` for `strip.getClipElement()`. `rect` here is a four-argument helper, `rect(left, top, right, bottom)`; the file's existing cases each define a two-argument one of their own.

| # | Given | Then |
|---|---|---|
| X1 | `strip.revealRect(rect(150, 0, 200, 20))`; then `strip.revealRect(rect(20, 0, 60, 20))` | returns `[50, 0, 100, 20]` and `mainScroll()` is 100; then returns `[20, 0, 60, 20]` and `mainScroll()` stays 100 |
| X2 | `strip.revealRect(rect(150, 0, 200, 20), 'y')`; then the same with `'x'` | returns `[100, 0, 100, 20]` and `mainScroll()` is 0; then returns `[50, 0, 100, 20]` and `mainScroll()` is 100 |

### The one existing test that changes

`'registers as a FocusRevealer, so FocusReveal.reveal scrolls a clipped-out item into view'` in `ScrollStrip.test.ts` (line 234) stages its two rectangles by call order, clip first. The broker now measures the item first. The test also reveals into a strip that has never been laid out, so the scroll now waits for the queued layout pass. Three edits:

1. Replace the file's `beforeEach` / `afterEach` (lines 25–29) with the frame harness: a module-level `let frames: FrameRequestCallback[]`, a `drainFrames()` as above, a `beforeEach` that calls `installTestDOM(CONFIG)`, resets `frames` and installs the `requestAnimationFrame` capture, and an `afterEach` that calls `drainFrames()`, `vi.restoreAllMocks()` and `DOM.reset()`. The capture has to be file-wide.[^harness]
2. In the test, stage the rectangles per element: `vi.spyOn(DOM.source, 'getElementRect').mockImplementation(handle => handle === itemEl ? rect(150, 200) : rect(0, 100))`.
3. After `expect(FocusReveal.reveal(itemEl)).toBe(true)`, assert `strip.mainScroll()` is still `before`, call `drainFrames()`, then assert it is greater than `before`.

The other 21 cases of the file pass with the new harness and no edit.

### Unchanged (offline)

Every other existing test file passes without an edit. That includes the four `describe` blocks of real revealers and the broker cases in `tests/unit/core/FocusReveal.test.ts`, `FocusHistory.test.ts`, `SpatialNavigation.test.ts`, `PanelScrollReveal.test.ts`, the list plan's three files, `KeyboardContextMenu.test.ts`, `Menu.keyboardSession.test.ts`, `Split.collapseUndisplay.test.ts`, `Border.collapseUndisplay.test.ts` and `Accordion.manager.test.ts`.

### Needs manual verification

In Chromium, on the demo app (`npm run dev`). MV1–MV5 need rigs the demo does not have; build each in a `Window` from a script loaded into the page with a dynamic import, and measure against the scrolling element's client box.[^probe] The numbers are those of a 420 × 380 window, whose page viewport is 339 px high. Repeat MV1, MV4 and MV6 in Firefox and in WebKit; the planner ran neither.

| # | Where | Do | Expect |
|---|---|---|---|
| MV1 | rig: an `autoScroll: "y"` panel holding a second one (300 × 250, 600 px down); a button 1500 px down the inner one | `FocusReveal.reveal` of the button, once | the button is fully visible, flush with the bottom edge of both panels (outer 510, inner 1282). A second call scrolls nothing |
| MV2 | the same with three panels; with `autoScroll: "both"`; and with a button 400 px high | one `reveal` each | three panels: visible (510 / 541 / 1342). Both axes: visible. Tall button: the whole inner viewport is inside the outer one |
| MV3 | rig: a `Split`, then a `Border`, whose first pane / `WEST` region is a scrolling panel with a button 1500 px down; once alone, once 500 px down a scrolling page | scroll the pane to 1400; collapse it; wait; `reveal` the button | the pane expands; when the animation ends it is back at 1400 and the button is in view. In the page: the button is in view of the page too, and the page did not jump when the call was made |
| MV4 | rig: a scrolling page holding an `AccordionPanel` of four sections 420 px high, a button 380 px down each, the first open; once multi-open, once `singleOpen` | `reveal` the last section's button | the section opens. When the animation ends the button is fully visible, flush with the page's bottom edge (page at 909, and at 489 in single-open). The page does not scroll during the animation |
| MV5 | rig: `new Drawer(…)` holding a scrolling panel with a button 1500 px down | `drawer.open()` and `reveal` in the same task | the button is in view once the drawer has been laid out (panel at 682) |
| MV6 | `#/content-box`, browser window about 500 px high | scroll the page until "Tree (VirtualScroller)" is cut by the bottom edge; click a visible tree row; `ArrowDown` until past the last row; `ArrowUp` back | after every press the current row is fully visible in the page. The page follows by the least distance |
| MV7 | `#/content-box`, the two lists of the row-renderer row, cut by the page's bottom edge | click a row; `End`; `Home`; Shift+F10 | the focused row is fully visible in the page after every key; the menu opens under the row |
| MV8 | `#/misc`, window about 500 px high | the dependency's MV4: click the first button of the left column; `Tab` until the column has scrolled; `Alt+[` once per `Tab` | as on the base branch: every control that takes focus on the way back is fully visible in the column |
| MV9 | `#/split` | collapse the list's pane with its gutter button; press `Alt+[` until focus returns to the list | as on the base branch: the pane expands and the list takes focus |
| MV10 | any tab strip with more tabs than fit | move focus along the strip with the keyboard onto a clipped tab | as on the base branch: the strip scrolls the tab into view |
| MV11 | MV3 and MV4 with `prefers-reduced-motion: reduce` emulated | the same steps | the scroll lands with no visible delay |

---

## Verification

Harness for the new test files:

- Node environment. `beforeEach`: `installTestDOM(CONFIG)` with the `CONFIG` object every neighbouring test file uses, then the frame capture of [`PanelScrollReveal.test.ts:180`](../packages/lib/tests/core/PanelScrollReveal.test.ts#L180).
- `afterEach`: drain the captured frames, `vi.restoreAllMocks()`, unregister every test double, **dispose every component the test built**, then `DOM.reset()`. A scrolling panel that is not disposed stays in the reveal registry. The next test's fresh handle table reuses its element's number, and the broker then scrolls the stale panel.
- `RevealInScrollingPage.test.ts` also calls `Menu._stopInputWatch()` and `Tooltip._stopPointerWatch()` before `DOM.reset()`: a `List` starts `Menu`'s input watch when it is built.
- `RevealSettle.test.ts` uses fake timers and `vi.useRealTimers()` in `afterEach`, and calls `detach()` on each `Split`, `Border` and `Accordion` at the end of its case.
- Keys: `DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key }))`, after `DOM.sink.focus(el)`.

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. The commands of steps 1, 2 and 11, from `packages/lib`.
4. `npm test` — the whole suite.
5. `npm run lint`
6. `npm run build:lib`, `npm run docs:api`, `npm run docs:llms:check`
7. The MV cases, on `npm run dev`.

Grep checks: the six greps of step 10.

Mutations to try on the finished code, each of which the named cases catch:[^prototype]

| Mutation | Cases that fail |
|---|---|
| scrollers taken outermost first | B1–B4, B8, O1, W1–W5, W7 |
| the open pass runs after the scroll pass | O1, K2, K4, K5, K6 |
| the scroll pass never runs | B1–B4, B7, B8, O1, W1–W5, W7, K2, K4–K6, the edited strip case |
| the scroll pass never waits | W1–W3, W5–W7, K1, K3, K4, the edited strip case |
| a queued layout is ignored | W3, K5, the edited strip case |
| `isRevealSettled` is ignored | W1, W2, W5–W7, K1, K3, K4 |
| the wait is 61 flushes | W2 |
| a new `reveal` does not withdraw the waiting one | W5 |
| no test for a rendered control | B6 |
| a scroller reveals itself | B7 |
| the rectangle handed on is not moved by the scroll | B8, P1, P2 |
| the rectangle handed on is not cut to the viewport | B3, B4, P1, P2, R3–R5, Q3, Q4, X2 |
| `revealSpan` does not continue outward | G3, S1, W7 |
| `revealSpan` continues along both axes | S1 |
| `Panel.revealRect` ignores `axis` | P2, S1, G4 |
| a row reveal does not continue outward | G1, G4 |
| a column reveal does not continue outward | G4 |
| the viewport is measured before the scrollers are looked for | G2 |
| `Accordion`, `Split` or `Border` always reports settled | K4; K1 and K6; K3 |
| `ScrollStrip` has no `revealRect` of its own | X1, X2, the edited strip case |
| `ScrollStrip.revealRect` ignores `axis` | X2 |

---

## Documentation Impact

**Exports.** No barrel changes. `FocusReveal` and `FocusRevealer` (`core`), `Panel` (`core`), `ScrollStrip` and `VirtualScroller` (`component/container`), `Accordion`, `Split` and `Border` (`layout`) are already exported and catalogued, so the new members appear on their existing API pages. `Component.isLayoutQueuedAround` is `@internal`. `revealedRect` and `spanRect` are internal: they are not added to `core/index.ts`, and no public JSDoc may `{@link}` them. No `llms.txt` manifest entry changes; `docs:llms:check` confirms it.

**Pages.**

- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md#L323)** — append to the last paragraph of the page, the one that begins "`back()` / `forward()` reveal a hidden trail entry": "Scrolling panels inside one another each move, the innermost first, so the control ends up in view of all of them. When the reveal opened a section, a pane or a region, the scroll follows once the open animation has finished." Do not touch the "Spatial focus navigation" section.
- **[`docs/components/List.md`](../packages/lib/docs/components/List.md#L55)** — in the paragraph that begins "A keyboard move, type-ahead and `setFocusedIndex` scroll the focused row into view", add after its second sentence: "A scrolling panel around the list then scrolls as well, up or down only, so the row is also in view of the page."
- **[`docs/components/Tree.md`](../packages/lib/docs/components/Tree.md#L245)** — under `## Notes`, add a bullet after the "Scrolling" one: "**In a scrolling page** — a call or a key that scrolls a row into view also scrolls a scrolling `Panel` around the tree, by the least distance that shows the row." Do not touch the `## Keyboard` table.
- **[`docs/components/Table.md`](../packages/lib/docs/components/Table.md#L364)** — under `## Keyboard`, add a paragraph after the key table: "A move that scrolls the current row or column into view also scrolls a scrolling `Panel` around the table: up or down for a row, sideways for a column."
- **[`docs/components/VirtualScroller.md`](../packages/lib/docs/components/VirtualScroller.md#L66)** — in the `## API` table, add a row after `getViewportWidth()` / `getViewportHeight()`: `` `getViewportRect()` `` | "The visible window as a rectangle in browser-viewport coordinates. It measures the DOM: use it for a reveal, to hand a row's rectangle to `FocusReveal.revealRectAround`, and not on a scroll or render path."

**Changelog — [`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md).**

- `## Added` → `### Core`, after the `Panel` entry for `getScrollViewportRect()` and `revealSpan()`: **`FocusRevealer` gains two optional members, and `FocusReveal` gains `revealRectAround()`.** Say that a revealer that scrolls implements `revealRect(rect, axis?)`, which scrolls to show a rectangle and returns what it then shows of it; that one whose open animates implements `isRevealSettled()`; that `Panel` and `ScrollStrip` implement the first and `Accordion`, `Split` and `Border` the second; and that `revealRectAround(origin, measure, axis?)` lets a component that scrolls its own rows ask the scrolling panels around it to show a rectangle it worked out. End with: "A custom revealer that scrolls should implement `revealRect`; without it, it is called before every scroller."
- `## Added` → `### Components`: **`VirtualScroller` gains `getViewportRect()`,** the visible window as a rectangle.
- `## Fixed` → `### Core`, after "A `Panel` scrolls a control into view correctly": **A control inside nested scrolling panels is scrolled into view in one step.** Say what was wrong, in this order: the outer panel scrolled before the inner one, so the control could end out of sight until a second attempt; a panel around a collapsed `Split` pane, `Border` region or closed `Accordion` section scrolled before the control had a box; the scroll ran while an `Accordion` section was still opening and stopped short; a pane or region that had just expanded lost the position it had been left at; and a reveal asked for before a new panel's first layout did nothing. Say what happens now: openers act first, then each scrolling panel from the innermost out, after the layout and any open animation have settled. Name what uses it: focus history, spatial navigation, `FocusReveal.reveal`. Say that `FocusReveal.reveal` still opens at once, and that its scroll can follow after the call returns. End with "No consumer action is needed."
- `## Fixed` → `### Components`: **A `List`, `Tree`, `Table` or `TreeTable` in a scrolling panel keeps its current row in view of that panel.** Say that a key, Shift+F10 or a call that scrolls a row into view (`setFocusedIndex`, `selectNode`, `selectRecord`) scrolled only the component, so the row could sit below the panel's edge; that the panel now follows by the least distance, up or down for a row and sideways for a table column; and that `Panel.revealSpan` does the same for any caller.

**JSDoc.** The comment edits of steps 5–9 and the JSDoc in `## Internal Structure`. Every `{@link}` in a public comment names a public symbol: `FocusRevealer.revealRect`, `FocusRevealer.isRevealSettled`, `FocusRevealer.revealDescendant`, `getViewportWidth`, `getViewportHeight`, `reveal`.

---

## Potential Challenges

- **`ScrollStrip` breaks between steps 6 and 7.** It inherits `Panel.revealRect` until it has its own. Do the two steps back to back and run the strip's tests only after step 7.
- **A test that reveals through the broker must leave no layout queued.** The modelled DOM never runs an animation frame, so a queued layout stays queued and the scroll pass waits for it. Capture the frames and drain them, as every new file does.
- **A test that builds a scrolling panel must dispose it.** See the harness note in `## Verification`. The symptom is a scroll offset that lands on the element and not on the panel under test.
- **`FocusReveal.reveal` no longer always scrolls before it returns.** Library code that reads a position right after a reveal must use the component's own reveal (`scrollIndexIntoView`, `scrollRowIntoView`, `Panel.revealSpan`), which is synchronous. The one such reader today, `resolveContextMenuTarget`, already does.
- **A reveal into a collapsed pane now scrolls about 200 ms later than today.** That is the price of keeping the pane's remembered position.[^split-wait] Under reduced motion there is no delay.
- **`core/FocusReveal.ts` conflicts with `feature/spatial-navigation-redesign`.** Both add members to `FocusRevealer` after `revealDescendant`. Keep all three: that branch's `getScrollViewportElement?()`, then `revealRect?()` and `isRevealSettled?()`. Keep this plan's JSDoc for the interface.
- **`core/Panel.ts` conflicts with that branch in the place the dependency already recorded.** Keep `getRevealElement()`, then that branch's `getScrollViewportElement()`, then this branch's block from the JSDoc of `getScrollViewportRect()` to the end of `revealRectWithin`. Drop the old `revealDescendant` the other side still carries.
- **`ScrollStrip.ts`, `Component.ts`, `Body.ts` and `ScrollStrip.test.ts` merge cleanly with that branch.** A three-way merge of every touched file was run outside the repository.[^spatial]
- **`docs/concepts/accessibility.md` and `changelog/next.md` are edited by other unmerged work.** `spatial-navigation-redesign` rewrites the "Spatial focus navigation" section. The sibling plans `dialog-aria-semantics`, `focus-history-transient-layers` and `tree-page-keys` add their own sentences and entries. This plan appends two sentences to the last paragraph of the accessibility page and adds four changelog entries. Keep both sides in a merge.
- **`Tree.md` is also edited by `tree-page-keys`,** in its `## Keyboard` table. This plan adds a bullet under `## Notes`, 100 lines below.
- **A list, tree or table reveal now scrolls a scrolling panel around the component.** That includes a programmatic `setFocusedIndex`, `selectNode` or `selectRecord` made while the component is partly out of the page's view. The changelog says so.

---

## Critical Files

- [`core/FocusReveal.ts`](../packages/lib/src/typescript/lib/core/FocusReveal.ts#L15) — the interface (:15), `containing` (:66), `reveal` (:103).
- [`core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L116) — read only: `DismissableLayer.keepsOwnBand?()` (:116) and `onInertChanged?()` (:128), the precedent for an optional member that marks a kind of implementer.
- [`core/Panel.ts`](../packages/lib/src/typescript/lib/core/Panel.ts#L648) — `getScrollViewportRect` (:648), `revealSpan` (:680), `revealSpanWithin` (:706), `revealDescendant` (:734), `getRevealElement` (:634).
- [`core/ScrollReveal.ts`](../packages/lib/src/typescript/lib/core/ScrollReveal.ts#L19) — `nearestRevealOffset`; the precedent for a pure reveal helper shared by both scroll systems.
- [`core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L8296) — `afterNextLayout` (:8296), the layout queue `pendingLayouts` (:182) and its flush (:265), `scheduleLayout` (:8232), `isLayoutDirty` (:8217), `setScrollTop` (:5002), which reads the offset back after the write.
- [`component/container/ScrollStrip.ts`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L981) — `revealItem` (:981), `revealDescendant` (:969), `mainScroll` (:860), the two-frame relay (:636).
- [`component/container/VirtualScroller.ts`](../packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L391) — `getViewportWidth` / `getViewportHeight` (:391 / :403), `_clipBox` (:48).
- [`component/shared/VirtualRowView.ts`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1125) — `scrollRowIntoView` (:1125), `scrollToCommittedY` (:1151).
- [`component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts#L3247) — `scrollColumnIntoView` (:3247), `revealFocusedCell` (:2366).
- [`component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2331) — read only: `scrollIndexIntoView` (:2331).
- [`layout/Accordion.ts`](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1230) — `revealDescendant` (:1230), `_toggleAnimations` (:281), `openSection` (:982), `primeWrapper` (:2967).
- [`layout/Split.ts`](../packages/lib/src/typescript/lib/layout/Split.ts#L1969) — `revealDescendant` (:1969), `_collapsing` (:270), `setPaneCollapsed` (:521), the scroll restore in `reconcileCollapsedContent` (:698).
- [`layout/Border.ts`](../packages/lib/src/typescript/lib/layout/Border.ts#L1642) — `revealDescendant` (:1642), `_collapsing` (:133).
- [`layout/CollapseSupport.ts`](../packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L482) — read only: `runCollapse` (:482) lays the end state out before it animates.
- [`layout/Tab.ts`](../packages/lib/src/typescript/lib/layout/Tab.ts#L2342) — read only: `revealDescendant` (:2342) lays out before it returns; `_pendingActiveContent` (:333) is the precedent for a request applied on the next layout pass.
- [`overlay/Drawer.ts`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L408), [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1017) — read only: the precedent for putting work off with `Component.afterNextLayout`.
- [`component/shared/resolveContextMenuTarget.ts`](../packages/lib/src/typescript/lib/component/shared/resolveContextMenuTarget.ts#L94) — read only: reads the row's position right after the component's own reveal.
- Tests: [`tests/core/PanelScrollReveal.test.ts`](../packages/lib/tests/core/PanelScrollReveal.test.ts#L92), [`tests/unit/core/FocusReveal.test.ts`](../packages/lib/tests/unit/core/FocusReveal.test.ts#L40), [`tests/component/layout/Split.collapseUndisplay.test.ts`](../packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts#L77), [`tests/component/container/ScrollStrip.test.ts`](../packages/lib/tests/component/container/ScrollStrip.test.ts#L234), [`tests/core/AfterNextLayout.test.ts`](../packages/lib/tests/core/AfterNextLayout.test.ts#L32), [`tests/dom/TestDOM.ts`](../packages/lib/tests/dom/TestDOM.ts#L1998).
- [`plans/implemented/scroll-reveal-geometry-fixes.md`](implemented/scroll-reveal-geometry-fixes.md) — the dependency: the reveal rule, the viewport answers, and its Non-Goal that this plan closes.

---

## Non-Goals

- **A reveal during the scale-in of a `Window` or a `Dialog`.** For 150 ms a window is drawn at 97% and growing, and every rectangle measures small by that factor. Measured two frames after `show()`: the control ended 32 px below the inner viewport and 45 px below the outer one. Nothing in the library reveals during that animation, and a window is not a revealer.[^scale]
- **`Body.scrollToRecord`** and its callers (`Table.addRow`, `Table.selectRecord`). It puts the record at the top of the table by its own rule, and does not scroll a page.
- **`HeadingScrollTracker`** and **`PickerColumn`.** Each keeps its own rule (top of the pane, centre of the column) and scrolls only its own pane.
- **Converting `ScrollStrip.revealItem` to `nearestRevealOffset`.** The strip keeps its own copy of the rule, as the dependency left it.
- **`Card`.** It is not a revealer, so a control on a hidden card is not shown. With this plan it also scrolls nothing.
- **Restoring a pane's scroll offsets before its expand animation ends.** `Split` and `Border` keep restoring when the animation settles. The reveal waits for that.
- **Making `Window`, `Dialog`, `Drawer` or `AnimatedDropdown` report that they are animating.** A slide and a fade do not disturb a reveal; see the addendum.
- **What `SpatialNavigation` counts as in view,** on its branch.
- **Exporting `revealedRect` or `spanRect`,** and a public way to register a waiting reveal's callback.
- **The demo app, the docs app and SQLAdmin.**

---

## Addendum: What was measured

Chromium, through chrome-devtools, in a 1400 × 850 window, on the demo dev server of a worktree at `27c9b7157`. Rigs were built in a 420 × 380 `Window` from a script in the page; the page viewport there is 339 px high. Keys were real key presses. "With the change" is the prototype of this plan, served from a copy of the library outside the repository.[^prototype]

**Nested scrolling panels.** An outer `autoScroll: "y"` panel (largest offset 1191) holds an inner one, 250 px high, 600 px down, with a 1 px border. The button is 30 px high, 1500 px down the inner panel.

| Case | Today, one `reveal` | Today, more calls | With the change, one call |
|---|---|---|---|
| two panels | outer 1191, inner 1282; the button 342 px above the outer viewport | second: outer 819, visible | outer 510, inner 1282; flush with both bottom edges; a second call writes nothing |
| three panels | 1191 / 1282 / 1342 | second: 78 / 759 / 1342, not visible; third: 292 / 759 / 1342, visible | 510 / 541 / 1342, visible |
| `autoScroll: "both"`, button also 900 px across | not visible | second: visible | visible |
| button 400 px high (inner viewport 248) | outer 1191, inner 1500 | second: outer 662, which leaves the top 61 px of the inner viewport above the outer one | outer 510, inner 1500: the whole inner viewport is inside the outer one |

**`Split` and `Border`.** The first pane, or the `WEST` region, is a scrolling panel 339 px high with a button 1500 px down.

- Alone, today: a reveal into the collapsed pane lands at once (1193, flush with the bottom edge) and stays right through the animation. The pane's box is the same collapsed and expanded.
- Pane left at 1400, where the button is in view; collapsed; revealed. Today: 1193. With the change: back at 1400, nothing scrolled.
- The `Split` or `Border` 500 px down a scrolling page that is at 300. Today: the page jumps to 254 (by 46 px, the page viewport's top in the window), the pane goes to 1232, and the button is 206 px below the page's bottom edge; a second call scrolls the page to 460. With the change: the page goes to 460 once, or stays at 300 when the button is in view there.
- With the change the scroll lands when the 200 ms expand settles.

**`Accordion` in a scrolling page.** Four sections 420 px high, a button 380 px down each, the first open.

| Case | Today | With the change |
|---|---|---|
| multi-open | the page scrolls to 500, the end of its old range. The range is 920 from the next frame. The button is 409 px below the bottom edge after the animation. A second call: 909 | 909 after the animation, flush |
| single-open | the button is drawn at 764 when the call is made and at 344 when the 200 ms are over, because the first section closes above it | 489, flush |
| each section a scrolling panel 200 px high, button 900 px down | section panel 732, right; page 280, the old range; the button 198 px below. A second call: 478 | 478 / 732 |

**`Drawer`.** An `EAST` drawer holding a scrolling panel with a button 1500 px down.

- `reveal` in the same task as `open()`, today: the panel's viewport is 0 px high, nothing scrolls, and the button stays 682 px below the view. With the change: 682 on the second layout flush.
- `reveal` one frame and three frames later, while the drawer is still sliding in (its left edge at 1400, 1360, on its way to 1080), today: 682, flush, and it stays right. A slide is a `translate`, which moves the button and its viewport alike. `AnimatedDropdown` animates the same two properties, `opacity` and `translateY`, and the dependency measured a `ComboBox` reveal in the same task as its open.

**`Window` scale-in**, with the change (the geometry rule is the dependency's). `reveal` two frames after `show()`, at scale 0.97: inner 1250 where 1282 is right, outer 497 where 510 is right. Eight frames after, at 0.995: 6 and 8 px short.

**A list, a tree and a table in a scrolling page**, real keys.

| Component | Today | With the change |
|---|---|---|
| `List` 230 px high, 600 px down; page at 400 | `End`: the row is 90 px below the page's bottom edge and the page has not moved. `ArrowUp`: 68 px | `End`: page at 490, the row flush with the bottom edge. `ArrowUp`, `Home`: visible |
| `Tree` 200 px high, 1000 px down; page at 800 | `End`: 61 px below. `ArrowUp`: 37 px | `End`: page at 861, flush |
| `Table`, 1400 px down; page at 1200 | `ArrowDown` three times past the edge: 3, 23, 43 px below | every row visible; Shift+F10 opens the menu under the current cell |

**Cost**, with the change, for a table in a scrolling page: one `FocusReveal.containing()` call took 3.5 µs, and a row reveal that had nothing to scroll took 14 µs. Offline, twenty scroll ticks and five render passes made no geometry read, and one row reveal made two.

**Not run:** Firefox and WebKit; a touch pan; `prefers-reduced-motion` in the browser (offline only, K2 and K5); a `Tab` inside a scrolling page (the same order as the `Split` case, with a synchronous open).

---

## Notes

[^fine]: Measured and correct today. *A reveal into a pane that `Split` or `Border` has just expanded, with no scroller around the `Split`*: `runCollapse` lays the end state out before it starts the animation, and the pane keeps its box while its `clip-path` opens, so the panel inside measures right in the same task (1193, flush, unchanged through the animation). What is lost there is only the pane's remembered position, which is defect 4. *A reveal while a `Drawer` slides in*: the slide is a `translate`, which moves the control and its viewport together. *A reveal while a dropdown opens*: `AnimatedDropdown` animates `opacity` and `translateY` only.

[^two-kinds]: An optional member is how the interface says "this revealer scrolls" without a second registry or a `kind` field, and the member is the thing the scroll pass needs anyway. `feature/spatial-navigation-redesign` marks scrollers the same way, with an optional `getScrollViewportElement()`; the dependency's notes suggested reusing that member as the test. This plan does not, because that would make it depend on a 3,700-line branch for one `typeof` check, and because that member names an element where the scroll pass needs an action. A revealer written by a consumer that scrolls and does not implement `revealRect` keeps working: it is called in the open pass. It then runs before every scroller, where today it runs in nesting order.

[^computed]: What is read from the DOM for a reveal through *n* scrollers: the control's rectangle once, each scroller's own box once (`getScrollViewportRect()`), each scroller's offsets once (`syncScrollOffsets()`), and the read-back `setScrollTop` / `setScrollLeft` already make after every write. Today's code reads the control's rectangle once per scroller. Measuring the control again after each inner scroll would also give the right order, and was rejected for three reasons. A list, a tree or a table has no element to measure for a row that is not rendered, so a rectangle is the only thing that can travel outward from them. The cut to the viewport needs the rectangle arithmetic in any case. And the setter's read-back makes the computed rectangle exact: it is the distance the browser really scrolled, clamped and rounded as the browser did it. None of these reads forces a layout by itself, since a scroll write does not make layout dirty.

[^clip]: The CSS Object Model's `scrollIntoView` hands every ancestor the element's whole box. The cut differs from that in exactly the two cases named, and both were measured or reproduced. A 400 px button in a 248 px inner viewport: without the cut the outer panel scrolled to show the button's far end, and left the top 61 px of the inner viewport outside itself. A control clipped sideways by an inner panel that only scrolls vertically (case B4): without the cut the outer panel scrolls 140 px sideways towards a control the inner panel still hides.

[^settle]: Three designs were compared. *Scroll at once, and again when things settle*: in single-open mode the first scroll chases a control that is still moving 420 px, so the page would scroll one way and then back. *Compute the final geometry from the library's own layout numbers*: the positions are right but the browser clamps the scroll write to the range of the moment, which is the old one while a height transition runs. *Wait, then scroll once*: chosen. The wait asks again on each layout flush instead of taking a completion callback from each opener. `Accordion` and `Split` end their animations in different ways (a `transitionend` with a fallback timer; the last frame of a JS animation), neither exposes that today, and a callback that is never called would lose the reveal without a trace. A boolean per opener cannot be lost, and an opener that is detached mid-animation leaves the registry and stops counting. The queued-layout test reads `Component`'s layout queue, not `isLayoutDirty()` alone: a queued pass is certain to run on the next flush, while a component can be marked stale by `invalidateLayout()` with nothing queued, which would make the wait run its full length. The flag is still checked, so a component laid out directly after it was queued does not count. Waiting costs nothing visible when a layout is queued: the callback runs in the same frame, before the browser paints.

[^bound]: The bound exists for a component around the control that queues a layout on every frame without end, and for an animation flag left set by a bug. Without it the control would never be scrolled to. Sixty flushes is one second at 60 Hz, five times the library's 200 ms. An `Accordion` whose `animationDuration` a consumer sets above one second is scrolled to mid-animation, as today.

[^newest]: A waiting scroll pass belongs to one move of focus, and only the next move of focus should replace it. A list's own row reveal is left out of that rule on purpose: lists and tables also reveal rows from data loads and programmatic selection, anywhere in the application, and one of those must not cancel the scroll that follows a keyboard move elsewhere.

[^not-rendered]: `isRenderedVisible` reads computed style up the ancestor chain, so it also sees a control hidden by something that is not a revealer: a `Card` page, a consumer's `setDisplayed(false)`. Focus history walks its trail past such entries and tries the next one; today each skipped entry scrolls every panel around it towards the window's origin. The test runs after the wait, because a control can be rendered by the layout pass the scroll pass was waiting for.

[^self]: Today the panel is asked, and nothing moves only because its own rectangle happens to cover its viewport. With `revealRect` the panel would also hand on its viewport, which is smaller than its box by the border and the scrollbar band, so the scrollers around it would stop a few pixels short of showing the whole panel.

[^widget]: *At once*: `resolveContextMenuTarget` calls the component's reveal and measures the row on the next line to place the menu. A page scroll that came a frame later would leave the menu where the row used to be. A component reveals its own row on a tree that is not in the middle of opening, so there is nothing to wait for. *One axis*: a row's rectangle is as wide as the component's viewport. Handed outward on both axes, every `ArrowDown` in a table wider than its page would pull the page back to the table's left edge. *Lazy measurement*: the table and the tree have had scroll-performance work, and their reveals are on the keyboard path, which repeats at the key-repeat rate. The reveals are called from key handlers, the edit-entry handler and Shift+F10, never from a scroll tick or a render pass; G5 pins that the latter two read no geometry. *Through `Panel.revealSpan`, not through the list*: the list would otherwise have to turn a content position into a window rectangle, which needs the panel's viewport that `revealSpan` has just measured.

[^clipbox]: `VirtualScroller` sizes its clip box to the effective viewport on every `layoutScrollbars` call, inside the owner's border and clear of both scrollbar tracks. The dependency measured the clip box against the effective viewport in four trees and two tables and found them equal. The modelled DOM composes the clip box's rectangle from the same writes, so the offline cases need no stub.

[^strip]: `ScrollStrip` registers itself with the broker by hand, because its band has `autoScroll: "none"` and `Panel` would otherwise leave it out. With `Panel.revealRect` inherited and not overridden, a keyboard move onto a clipped tab would no longer scroll the tab strip. The existing test `'registers as a FocusRevealer, …'` fails in exactly that state, and step 7 exists to prevent it. The override also makes the strip a real scroller in the scroll pass, so a strip inside a scrolling panel, or a scrolling panel inside a strip item, is ordered like any other pair.

[^one-level]: `revealDescendant` and `revealRect` are the two members the broker calls on each scroller in turn. Either one walking outward by itself would scroll every outer panel once per inner panel. `revealSpan` has no counterpart in the broker, because the broker works with elements and a span of content is not one. So `revealSpan` is where a caller that knows content positions says "make this visible", and it finishes the job. It is new on the dependency's branch and has one caller, the list.

[^spatial]: Every touched file was merged three ways against that branch (`2851125b0`) outside the repository, with the common base `87c5ff0cc`. `core/FocusReveal.ts` conflicts once, new with this plan: both sides add members after `revealDescendant`. `core/Panel.ts` conflicts once, in the block the dependency's notes already describe; this plan adds no second conflict there. `Component.ts` (that branch edits lines 172–2420, this plan line 8313), `ScrollStrip.ts` (that branch inserts `getScrollViewportElement()` above `revealItem`'s JSDoc, this plan changes the body below it), `Body.ts`, `VirtualRowView.ts`, `VirtualScroller.ts`, the three layout managers and `ScrollStrip.test.ts` merge cleanly. That branch's tests assert focus and spy on `FocusReveal.reveal`; none asserts a scroll offset right after a reveal.

[^harness]: `Component` keeps its layout queue and its frame handle at module level. A test file that never runs the queued frame leaves the handle set, so no later test in the file can capture a frame at all, and leaves earlier tests' components in the queue, where a stale handle number can match a new element. `ScrollStrip.test.ts` has no frame capture today. It needs one for the whole file for this one case to be able to run its queued layout.

[^split-wait]: Two ways to keep the pane's position were compared. *`Split.revealDescendant` restores the pane's offsets itself, as `Tab` does, and the scroll runs at once*: the pane's content is laid out at that point, but only when the toggled pane's box does not change, and `Split` restores at the end of the animation for every other expand. Two restore paths would have to agree. *The scroll waits for the animation*: chosen. It needs one boolean on each manager, and the same wait covers the other panes that are still moving. A pane that is expanded by a reveal already shows its content from the top during the animation and jumps to its remembered position at the end; the scroll now follows that jump where today it runs before it.

[^scale]: `getBoundingClientRect()` returns transformed boxes, and a reveal adds a difference of two such rectangles to an untransformed scroll offset. A fix would divide by the scale, or wait for the window's animation. Either is a change to how a `Panel` measures, for a case no library path reaches: `Dialog` and `Drawer` put their own focus off with `afterNextLayout` and focus without revealing, and focus history and spatial navigation run on a key press, not during an open.

[^probe]: The script the planner used, `zznested.ts`, is kept outside the repository at `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/nested-scroll/`, with `measurements.md`. It was copied to `packages/lib/src/typescript/` of the worktree, loaded with `await import('/src/typescript/zznested.ts')` from the page, and deleted afterwards. It is a reference only and may be gone: the rigs are described in the table and in the addendum.

[^prototype]: The prototype is kept in the same folder: `prototype-src.diff` (the source change, the text of `## Internal Structure`), `prototype-tests.diff` (the cases of `## Expected Behaviour` as scratch files, and the `ScrollStrip.test.ts` edit) and `proto/`, the copy of the library both were run in. They are a reference only and may be gone: write the code and the tests from this plan. On the copy: every case of `## Expected Behaviour` passes; on the unchanged base 45 of them fail and B5, S2 and G2 pass; the state after each of steps 5, 7, 8 and 9 is as those steps say; 395 test files near the change pass (6,552 tests) with the one edited test; the library and its tests type-check, ESLint is clean on the touched files, and `typedoc` reports no link warning. The mutations of `## Verification` were each applied to the prototype and each was caught by the cases named. Not run on the copy: the whole suite, `docs:llms:check`, and `tests/unit/readme-mirror.test.ts`, which needs the repository's root `README.md`.
