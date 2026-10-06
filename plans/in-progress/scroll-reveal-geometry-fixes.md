---
depends-on: [list-scroll-index-into-view, table-tree-keyboard-context-menu]
touches-shared:
  - packages/lib/src/typescript/lib/core/Panel.ts
  - packages/lib/src/typescript/lib/component/container/VirtualScroller.ts
  - packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
  - packages/lib/src/typescript/lib/component/input/ComboBox.ts
  - packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts
  - packages/lib/tests/component/table/Body.test.ts
  - packages/lib/docs/concepts/accessibility.md      # also edited by feature/spatial-navigation-redesign and the pending plan modal-dialog-focus-trap
  - packages/lib/docs/reference/changelog/next.md    # also edited by those two
  - plans/dom-only-state-inventory.md
---

# Scroll Reveal Geometry Fixes — Implementation Plan

## Overview

The library scrolls a row, a cell or a control into view from several places, and most of them land in the wrong spot under some condition. This plan fixes all of them with one shared rule and one place per scroll system that answers "what is visible right now". It is a library-only change.

Two terms are used throughout.

- The **scroll viewport** is the visible window onto scrolled content: the scrolling component's box inside its border, less the band each visible scrollbar occupies.
- A [`Panel`](../packages/lib/src/typescript/lib/core/Panel.ts#L192) **remembers** its scroll offsets: `getScrollTop()` returns the value last written through `setScrollTop()`, without reading the DOM. A **browser-made scroll** is one the browser performs without calling the library: keyboard scrolling, the scroll that follows focus when `Tab` moves it, a touch pan, a drag of a native scrollbar. It leaves the remembered offset stale.

Every defect below was measured in Chromium before this plan was written, including the three the earlier survey had only read from the code. The numbers are in [the addendum](#addendum-what-was-measured).

| # | Defect | Where | Real? |
|---|---|---|---|
| 1a | A reveal adds its distance to the stale remembered offset | [`Panel.revealDescendant`](../packages/lib/src/typescript/lib/core/Panel.ts#L648) | yes — but not after a wheel scroll or a drag of an overlay scrollbar, which both keep the remembered offset current. After a browser-made scroll: `Tab` ×3 scrolled a panel by 153 px, and the next reveal landed 153 px short |
| 1b | Under `scrollbarStyle: "native"` the border and the scrollbars count as viewport | same | yes — the revealed control ends 17 px under the bar and border (15 + 2) |
| 1c | A reveal scrolls an axis the panel does not scroll | same | yes, newly found — an `autoScroll: "y"` panel was scrolled 538 px sideways, with no bar or wheel to bring it back |
| 1d | A control wider than the viewport loses its start | same | yes, newly found — a 700 px row in a 162 px viewport was scrolled to its far end |
| 2a | A revealed row is hidden by the border and the horizontal scrollbar | [`VirtualRowView.scrollRowIntoView`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1121) (`Tree`, `Table`, `TreeTable`) | yes — 4 / 12 / 16 px |
| 2b | A revealed column is hidden by the border and the vertical scrollbar | [`Body.scrollColumnIntoView`](../packages/lib/src/typescript/lib/component/table/Body.ts#L3245) | yes — 12 / 16 px (was read only) |
| 3 | A minimap click scrolls from the stale remembered offset | [`HeadingScrollTracker.scrollToHeading`](../packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L116) | yes — after one `PageDown` the heading landed 307 px below the top (was read only) |
| 4 | `PageUp` / `PageDown` move one row too many | [`AbstractSelectableList.handleNavigationKey`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2182), [`VirtualRowView.computePageSize`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L286) | yes — nine rows fit, the key moved ten, and one row per page was never shown whole (was read only; the `Table` has the same defect) |
| 5 | A dropdown opens scrolled to the top, its selected option out of view | [`ComboBoxDropdown.showAt`](../packages/lib/src/typescript/lib/component/input/ComboBox.ts#L273) | yes for `ComboBox` — the selected option, the 31st of 40, was 484 px below the view. `AutoCompleteField` is not affected and the date field's year list is fixed by the dependency[^other-dropdowns] |

**The common cause.** No single place answers "what is this scroller's viewport, and where is it scrolled to now". Each call site works those two things out for itself. Some take the component's outer box for the viewport. Some take the remembered offset for the current one. The reveal sites also each carry their own copy of the "least scroll" rule, and no copy handles a target larger than the viewport.

The fix has three parts: one pure rule shared by every call site, one viewport answer on `Panel` and one on `VirtualScroller`, and one reveal method on `Panel` that every panel reveal goes through.

---

## Architecture Decisions

### One rule decides the least scroll — a pure function in `core/ScrollReveal.ts`

A new module exports `nearestRevealOffset(start, end, offset, extent)`. Everything is measured along one axis of the scrolled content: the span to show runs from `start` to `end`, and the viewport, `extent` long, currently shows `offset` to `offset + extent`. The function returns the offset to scroll to.

- The span is in view, or it covers the whole viewport: return `offset` (no move).
- The span fits and is cut at one edge: bring that edge flush with the viewport.
- The span does not fit and is cut at one edge: bring its *other* edge flush, which fills the viewport with the span in the shortest move.
- The viewport has no extent: return `offset`.

For a viewport showing 100–400 (`offset` 100, `extent` 300):

| Span | Result | Why |
|---|---|---|
| 150–190 | 100 | in view |
| 20–60 | 20 | fits, cut at the start: start edge |
| 420–460 | 160 | fits, cut at the end: end edge (460 − 300) |
| 50–650 | 100 | covers the viewport |
| 200–800 | 200 | too long, cut at the end: its start goes to the start edge |
| −150–350 | 50 | too long, cut at the start: its end goes to the end edge (350 − 300) |

The module mirrors [`core/ScrollShadow.ts`](../packages/lib/src/typescript/lib/core/ScrollShadow.ts#L52), the existing module of pure scroll helpers that `Panel` and `VirtualScroller` both import so the two scroll systems behave alike.[^rule]

### A panel answers "what is my scroll viewport" in one place — `Panel.getScrollViewportRect()`

`Panel` gains one public method that returns the scroll viewport as a rectangle in browser-viewport coordinates. It measures the panel's own element once and subtracts two things the panel already tracks: its border ([`getBorderSize()`](../packages/lib/src/typescript/lib/core/Component.ts#L4167)) and the band its scrollbars have reserved (`_scrollbarGutter`, the same value [`getInnerSize()`](../packages/lib/src/typescript/lib/core/Panel.ts#L682) subtracts).

The result is the same rectangle under both scrollbar styles, and it equalled the scrolling element's real client box in every combination measured.[^viewport]

| Panel 178 × 281, 2 px border, both bars shown | Element that scrolls | Its real client box | `getScrollViewportRect()` |
|---|---|---|---|
| `"overlay"` | inner element, 162 × 265 at (2, 2) | 162 × 265 | 162 × 265 at (2, 2) |
| `"native"` | the panel's own, 178 × 281 | 159 × 262 at (2, 2) | 159 × 262 at (2, 2) |

The method returns `null` when the panel does not scroll (`autoScroll: "none"`), is not rendered, or is not effectively visible.

### A panel reveals through one method — `Panel.revealSpan()`

`Panel` gains `revealSpan(axis, start, end)`. It scrolls the least distance that brings a span of the content into the scroll viewport. `start` and `end` are positions in the scrolled content, where 0 is the content's leading edge. The method does four things in order: measures the viewport, re-reads the scroll offset, applies the rule, and writes through `setScrollTop()` / `setScrollLeft()` only when the offset changes.

`revealDescendant(target)` stays the entry point for an element. It converts the element's rectangle into a content span and calls the same code for both axes.

| Caller | Reveals | Calls |
|---|---|---|
| `FocusReveal.reveal` (`FocusHistory`, `SpatialNavigation`), `Menu` | an element, both axes | `panel.revealDescendant(el)` — unchanged call |
| `AbstractSelectableList.scrollIndexIntoView` | row `i`, vertically | `this._innerPanel.revealSpan("y", i * 22, i * 22 + 22)` |
| `ComboBoxDropdown.showAt` | the selected row | `this._list.setFocusedIndex(selectedIndex)`, which ends in the line above |

The split mirrors `VirtualRowView`, where [`scrollRowIntoView`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1121) works in content positions and the scroller owns the offset.[^span]

### The offset is re-read inside the reveal, never by the caller

`revealSpan` and `revealDescendant` call [`syncScrollOffsets()`](../packages/lib/src/typescript/lib/core/Component.ts#L5060) before they read `getScrollTop()` / `getScrollLeft()`. No caller has to remember to.[^stale]

| What scrolled the panel | Remembered offset afterwards | Measured |
|---|---|---|
| the wheel; a drag of an overlay scrollbar; any library call | current | yes |
| a scrolling key such as `PageDown`, with focus inside the panel | stale | yes, real key |
| `Tab` moving focus to a control out of view | stale | yes, real key |
| a touch pan; a drag of a native scrollbar; a text-selection drag; find-in-page | stale | no — the same mechanism: the browser scrolls and calls nothing |

The precedent is [`ScrollStrip.mainScroll`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L860), which re-syncs before every read of its offset.

### A reveal moves only the axes the panel scrolls

`revealSpan` does nothing for an axis the panel's `autoScroll` mode does not scroll. It asks the panel's existing [`scrollableAxes()`](../packages/lib/src/typescript/lib/core/Panel.ts#L1180).

| `autoScroll` | `revealSpan("x", …)` | `revealSpan("y", …)` |
|---|---|---|
| `"y"` | nothing | scrolls |
| `"x"` | scrolls | nothing |
| `"auto"`, `"both"` | scrolls | scrolls |
| `"none"` | nothing | nothing |

An axis left alone is not lost: `FocusReveal.reveal` calls every scrolling panel around the target, so an outer panel that does scroll that axis reveals along it. This is the reveal's counterpart of the library rule that an unconsumed wheel scroll passes to the parent.[^axes]

### A hidden panel is neither revealed nor re-read

When the panel is not effectively visible, `getScrollViewportRect()` returns `null` and both reveal methods return before reading or writing anything. The remembered offset is untouched, so `Tab` and `Card` restore it when the panel is shown again.[^hidden] The precedent is the same guard in [`Panel.remeasureScrollMetrics`](../packages/lib/src/typescript/lib/core/Panel.ts#L1044).

### Virtual views take their viewport from the `VirtualScroller`

`Tree`, `Table` and `TreeTable` do not scroll natively: a [`VirtualScroller`](../packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L44) moves their rows and already computes its viewport, inside the owner's border and clear of the cross-axis scrollbar. The width is public as [`getViewportWidth()`](../packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L391). This plan adds the twin `getViewportHeight()`.

`scrollRowIntoView`, `scrollColumnIntoView` and `computePageSize` then read the scroller's viewport where they read the component's outer size today, and the two reveals apply `nearestRevealOffset`. Their writes do not change: the row reveal still writes through `scrollToCommittedY`, the column reveal through `setScrollX`.[^virtual]

| `Tree` 180 × 281 | Outer height (used today) | Scroller's viewport height | Row hidden today |
|---|---|---|---|
| no border, no horizontal bar | 281 | 281 | 0 |
| 2 px border | 281 | 277 | 4 |
| horizontal bar | 281 | 269 | 12 |
| both | 281 | 265 | 16 |

### `HeadingScrollTracker` reads the current offset from the element it is handed

`scrollToHeading(scrollElement, id)` starts from `DOM.source.getScrollTop(scrollElement)` where it starts from `this._host.getScrollTop()` today. The write still goes through `this._host.setScrollTop()`. [`trackScroll`](../packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L78), in the same class, already reads the element this way. The exported `HeadingScrollHost` interface does not change.[^tracker]

The tracker keeps its own rule: it puts the heading at the top of the pane. It does not use `nearestRevealOffset`.

### A page is the number of whole rows the viewport shows

`PageUp` and `PageDown` move by the number of whole rows that fit in the scroll viewport, and by at least one row.

| Component | Viewport height read from | Today |
|---|---|---|
| `List`, `MultiSelectList` | `this._innerPanel.getScrollViewportRect()?.height` | `this.getHeight()` |
| `Table`, `TreeTable` | `this._scroller.getViewportHeight()` | `this.getHeight()` |

For 22 px list rows: a 221 px list with a 1 px border has a 219 px viewport. Nine rows fit. The outer height gives ten.

### A `ComboBox` dropdown opens on its selected option

`ComboBoxDropdown.showAt` ends with `this._list.setFocusedIndex(selectedIndex)`, after the layout pass that places the rows. `setFocusedIndex` is the list's existing public call that marks a row and scrolls it into view. The row is revealed by the least scroll, like every later arrow key: an option below the first page opens flush with the dropdown's bottom edge.[^combo]

### The plan stands alone from `feature/spatial-navigation-redesign`

That unmerged branch adds `Panel.getScrollViewportElement()` and an optional `FocusRevealer.getScrollViewportElement()`. This plan does not use them and does not depend on the branch. The two can merge in either order.[^spatial]

Neither that branch nor `feature/table-tree-keyboard-context-menu` needs an edit afterwards. Their reveal code keeps calling what it calls today, and the fix arrives underneath.

| Branch | Its reveal code | What that code calls, before and after |
|---|---|---|
| `spatial-navigation-redesign` | `landOn` in `SpatialNavigation.ts` | `FocusReveal.reveal(landing)` → `Panel.revealDescendant` |
| `spatial-navigation-redesign` | `scrollViewportsOf` | `revealer.getScrollViewportElement?.()` — identifies a viewport, measures nothing |
| `table-tree-keyboard-context-menu` | [`Tree._revealFocusRow`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2098) | `_scrollIntoView(index)` → `VirtualRowView.scrollRowIntoView` |
| `table-tree-keyboard-context-menu` | [`Body.revealFocusedCell`](../packages/lib/src/typescript/lib/component/table/Body.ts#L2365) | `scrollRowIntoView(index)`, `scrollColumnIntoView(col)` |
| `table-tree-keyboard-context-menu` | [`AbstractSelectableList.revealFocusedRow`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1875) | `scrollIndexIntoView(idx)` → `Panel.revealSpan` |

**Assumed merge order:** `context-menu-keyboard-operation` → `table-tree-keyboard-context-menu` → `list-scroll-index-into-view` → this plan, each branch created from the tip of the one before. `spatial-navigation-redesign` merges into `master` at any point in that sequence.

---

## Public API

No symbol is added to a barrel. Three public methods are added to classes that are already exported.

```typescript
// core/Panel.ts — class Panel
getScrollViewportRect(): Rect | null;
revealSpan(axis: ScrollAxis, start: number, end: number): this;
revealDescendant(target: Handle): void;            // signature unchanged

// component/container/VirtualScroller.ts — class VirtualScroller
getViewportHeight(): number;
```

`Rect` is the existing type in `core/DOM.ts`; `ScrollAxis` (`"x" | "y"`) is the existing type in `core/SmoothScroller.ts`. Both are already exported from `core/index.ts`.

```typescript
// core/ScrollReveal.ts — new module, NOT re-exported from core/index.ts
export function nearestRevealOffset(start: number, end: number, offset: number, extent: number): number;
```

None of the three methods is a state-bearing property: there is no setter, no backing field and no options field.

---

## Internal Structure

### `core/ScrollReveal.ts` — the whole file

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The scroll offset that brings a span of content into a scroll viewport by
 * the least movement. Shared by both scroll systems — `Panel` over native
 * `overflow` scrolling and `VirtualScroller` over transform-based virtual
 * lists — so "least scroll into view" means the same in a panel, a list, a
 * tree and a table.
 *
 * Every argument is a position along one axis of the scrolled content. The
 * viewport shows the content from `offset` to `offset + extent`.
 *
 * @param start - Where the span begins.
 * @param end - Where the span ends.
 * @param offset - The current scroll offset.
 * @param extent - The viewport's size along the axis.
 * @returns The offset to scroll to; `offset` itself when nothing should move.
 */
export function nearestRevealOffset(start: number, end: number, offset: number, extent: number): number {
    // A viewport with no extent shows nothing wherever it is scrolled to.
    // Written as a negated `>` so an unsized (NaN) extent takes this branch too.
    if (!(extent > 0)) {
        return offset;
    }

    const cutAtStart = start < offset;
    const cutAtEnd   = end > offset + extent;

    // Neither edge is cut: the span is in view. Both are cut: the span covers
    // the whole viewport, and no offset shows more of it.
    if (cutAtStart === cutAtEnd) {
        return offset;
    }

    const fits = end - start <= extent;

    // A span that fits moves until its cut edge is flush with the viewport.
    // One that does not fit moves until its other edge is flush, which fills
    // the viewport with it in the shortest move.
    if (cutAtStart === fits) {
        return start;
    }

    return end - extent;
}
```

### `Panel` — the reveal block

This block replaces [`revealDescendant`](../packages/lib/src/typescript/lib/core/Panel.ts#L636) and its JSDoc (lines 636–669). The imports change as step 4 says.

```typescript
    /**
     * The panel's scroll viewport: the visible window onto its scrolled
     * content, as a rectangle in browser-viewport coordinates. It is the
     * panel's box inside its border, less the band each visible scrollbar
     * occupies, and is the same rectangle under either scrollbar style.
     *
     * @returns The rectangle, or null when the panel does not scroll
     *   (`autoScroll: "none"`), is not rendered, or is not effectively
     *   visible — a hidden element measures as empty.
     */
    getScrollViewportRect(): Rect | null {
        const element = this.getElement();
        const scrolls = this._autoScroll !== "none";
        const visible = this.isEffectivelyVisible();

        if (!element || !scrolls || !visible) {
            return null;
        }

        const box    = DOM.source.getElementRect(element);
        const border = this.getBorderSize();
        const gutter = this._scrollbarGutter;
        const left   = box.left + border.left;
        const top    = box.top  + border.top;
        const width  = Math.max(0, box.width  - border.left - border.right  - gutter.right);
        const height = Math.max(0, box.height - border.top  - border.bottom - gutter.bottom);

        return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
    }

    /**
     * Scrolls the least distance along `axis` that brings a span of the
     * scrolled content into the scroll viewport, and nothing when the span is
     * already in view. `start` and `end` are positions in the content, where
     * `0` is the content's leading edge. An axis this panel does not scroll
     * is left alone, and so is a panel that is not effectively visible.
     *
     * @param axis - The axis to scroll along.
     * @param start - Where the span begins.
     * @param end - Where the span ends.
     * @returns This panel, for method chaining.
     */
    revealSpan(axis: ScrollAxis, start: number, end: number): this {
        const view = this.getScrollViewportRect();

        if (!view) {
            return this;
        }

        // The browser also scrolls the panel on its own — a key press, a move
        // of focus, a touch pan — and the remembered offset does not hear of
        // it. Re-read it. This also stops a wheel scroll that is still easing,
        // which would otherwise carry the span out of view again.
        this.syncScrollOffsets();
        this.revealSpanWithin(view, axis, start, end);

        return this;
    }

    /**
     * {@link revealSpan} against a viewport already measured and offsets
     * already re-read, so a caller revealing along both axes measures once.
     *
     * @param view - The scroll viewport, from {@link getScrollViewportRect}.
     * @param axis - The axis to scroll along.
     * @param start - Where the span begins, in content coordinates.
     * @param end - Where the span ends, in content coordinates.
     */
    private revealSpanWithin(view: Rect, axis: ScrollAxis, start: number, end: number): void {
        const axes = this.scrollableAxes();

        if (axis === "x" && axes.x) {
            const offset = this.getScrollLeft();
            const target = nearestRevealOffset(start, end, offset, view.width);

            if (target !== offset) {
                this.setScrollLeft(target);
            }
        }

        if (axis === "y" && axes.y) {
            const offset = this.getScrollTop();
            const target = nearestRevealOffset(start, end, offset, view.height);

            if (target !== offset) {
                this.setScrollTop(target);
            }
        }
    }

    /**
     * {@link FocusRevealer.revealDescendant}: scrolls `target` into the scroll
     * viewport by the least distance, along each axis this panel scrolls.
     *
     * @param target - The element to scroll into view.
     */
    revealDescendant(target: Handle): void {
        const view = this.getScrollViewportRect();

        if (!view) {
            return;
        }

        this.syncScrollOffsets();

        // The target's rectangle is where it is drawn now. Adding the current
        // offset turns it into a position in the scrolled content.
        const rect = DOM.source.getElementRect(target);
        const dx   = this.getScrollLeft() - view.left;
        const dy   = this.getScrollTop()  - view.top;

        this.revealSpanWithin(view, "x", rect.left + dx, rect.right  + dx);
        this.revealSpanWithin(view, "y", rect.top  + dy, rect.bottom + dy);
    }
```

### `VirtualScroller.getViewportHeight`

Added directly after `getViewportWidth()`:

```typescript
    /**
     * Effective viewport height — the vertical twin of {@link getViewportWidth}:
     * the owner's content-box height minus the horizontal scrollbar's track
     * reservation when that bar is visible. An owner tests a row against this,
     * not against its own height, to tell whether the row is in view.
     *
     * @returns The effective viewport height in pixels.
     */
    getViewportHeight(): number {
        return this.effectiveViewportH();
    }
```

### `VirtualRowView.computePageSize` and `scrollRowIntoView`

```typescript
    protected computePageSize(): number {
        const rowHeight      = this.getRowHeight();
        const viewportHeight = this._scroller?.getViewportHeight() || rowHeight;

        return Math.max(1, Math.floor(viewportHeight / rowHeight));
    }
```

```typescript
    protected scrollRowIntoView(index: number): void {
        if (index < 0 || !this._scroller) {
            return;
        }

        const rowHeight = this.getRowHeight();
        const top       = index * rowHeight;
        const scrollTop = this._scroller.getScrollY();
        const target    = nearestRevealOffset(top, top + rowHeight, scrollTop, this._scroller.getViewportHeight());

        if (target !== scrollTop) {
            this.scrollToCommittedY(target);
        }
    }
```

### `Body.scrollColumnIntoView` — from the loop's end to the method's end

```typescript
        const scrollLeft = this._scroller.getScrollX();
        const target     = nearestRevealOffset(left, left + widths[colIndex], scrollLeft, this._scroller.getViewportWidth());

        if (target !== scrollLeft) {
            this.setScrollX(target);
        }
    }
```

### `HeadingScrollTracker.scrollToHeading` — the three lines after the `!heading` guard

```typescript
        const headingTop = DOM.source.getElementRect(heading).top;
        const paneTop    = DOM.source.getElementRect(scrollElement).top;
        // The host's own offset is the value last written through it. The
        // browser also scrolls the pane on its own — a key press, a text
        // selection drag — so the starting offset is read from the element.
        const current    = DOM.source.getScrollTop(scrollElement);

        this._host.setScrollTop(current + (headingTop - paneTop));
        this._pendingClickScrollTop = this._host.getScrollTop();
```

### `AbstractSelectableList` — two edits

In `handleNavigationKey`:

```typescript
        const viewportH = this._innerPanel.getScrollViewportRect()?.height || ROW_HEIGHT_PX;
```

The whole of `scrollIndexIntoView`:

```typescript
    protected scrollIndexIntoView(idx: number): void {
        if (idx < 0 || idx >= this._items.length) {
            return;
        }

        const top = idx * ROW_HEIGHT_PX;

        this._innerPanel.revealSpan("y", top, top + ROW_HEIGHT_PX);
    }
```

### `ComboBoxDropdown.showAt` — inserted after the `this.doLayout();` call

```typescript
        // Open on the selected option. The rows were laid out just above, so
        // the list can scroll that row into view the way a keyboard move does.
        this._list.setFocusedIndex(selectedIndex);
```

---

## Ordered Implementation Steps

Work test-first. Steps 1–2 write the tests and watch them fail; steps 3–9 make them pass. Every line number in this plan is that of `feature/table-tree-keyboard-context-menu` at `773854a24`. The dependency `list-scroll-index-into-view` moves the lines of `AbstractSelectableList.ts` below line 1549 by a few; find each symbol by name there.

1. **New test files.** Create the four files below with the cases of `## Expected Behaviour` and the harness in `## Verification`.
   - `packages/lib/tests/core/ScrollReveal.test.ts` — N1–N12.
   - `packages/lib/tests/core/PanelScrollReveal.test.ts` — V1–V8, S1–S9, D1–D11.
   - `packages/lib/tests/component/list/AbstractSelectableList.pageSize.test.ts` — L1–L3.
   - `packages/lib/tests/component/input/ComboBoxDropdownReveal.test.ts` — C1–C3.

   Run `cd packages/lib && npx vitest run tests/core/ScrollReveal.test.ts tests/core/PanelScrollReveal.test.ts tests/component/list/AbstractSelectableList.pageSize.test.ts tests/component/input/ComboBoxDropdownReveal.test.ts`. Check: the first file fails to load (the module does not exist); every case of the second fails; L1, L2 and C1 fail; L3, C2 and C3 pass, because today's code already behaves that way there.

2. **Cases added to existing test files.**
   - `packages/lib/tests/component/container/VirtualScroller.test.ts` — T1–T2, in a new `describe('VirtualScroller getViewportHeight', …)` after the `getViewportWidth` block ([line 157](../packages/lib/tests/component/container/VirtualScroller.test.ts#L157)).
   - `packages/lib/tests/component/table/Body.test.ts` — T3–T8.
   - `packages/lib/tests/component/tree/Tree.test.ts` — T9–T11, in a new `describe` after `'Tree — rows fill the effective viewport width'` ([line 1206](../packages/lib/tests/component/tree/Tree.test.ts#L1206)).
   - `packages/lib/tests/component/display/MarkdownViewer.test.ts` — H1, in the `'MarkdownViewer minimap-select scrolls to the heading'` block ([line 294](../packages/lib/tests/component/display/MarkdownViewer.test.ts#L294)).

   Check: every new case fails except T8, which today's code already satisfies. (T1–T3, T7 and T9–T11 fail at the call to `getViewportHeight`, which does not exist yet.)

3. **`core/ScrollReveal.ts`.** Create the file exactly as in `## Internal Structure`. Do not add it to `core/index.ts`. Check: `npx vitest run tests/core/ScrollReveal.test.ts` passes.

4. **`core/Panel.ts`.**
   - Change line 11 to `import type { Handle, Rect, ScrollMetrics } from "~/core/DOM.js";`.
   - After line 13 (the `FocusRevealer` import) add `import { nearestRevealOffset } from "~/core/ScrollReveal.js";` and `import type { ScrollAxis } from "~/core/SmoothScroller.js";`.
   - Replace lines 636–669 (the JSDoc and body of `revealDescendant`) with the block in `## Internal Structure`. `getRevealElement()` stays directly above the block and `getInnerSize()` directly below.

   Check: `npx vitest run tests/core/PanelScrollReveal.test.ts tests/unit/core/FocusReveal.test.ts` passes. The five existing `Panel.revealDescendant` cases in `FocusReveal.test.ts` pass without an edit.

5. **`component/container/VirtualScroller.ts`.** Add `getViewportHeight()` after `getViewportWidth()` ([line 391](../packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L391)). Check: T1–T2 pass.

6. **`component/shared/VirtualRowView.ts`.**
   - After line 6 (the `VirtualScroller` import) add `import { nearestRevealOffset } from "~/core/ScrollReveal.js";`.
   - Replace the body of [`computePageSize`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L286). In its JSDoc, replace "one viewport height, floored to at least one row" with "the whole rows the scroller's viewport shows, and at least one".
   - Replace the body of [`scrollRowIntoView`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1121). Replace the first sentence of its JSDoc with: "Scrolls the view by the least distance so the row at `index` is fully visible inside the scroller's viewport — clear of a border and of the horizontal scrollbar — and not at all when it already is."

   Check: `npx vitest run tests/component/tree/Tree.test.ts` — T9–T11 pass.

7. **`component/table/Body.ts`.**
   - After line 19 (the `VirtualRowView` import) add `import { nearestRevealOffset } from "~/core/ScrollReveal.js";`. Put it there, not at the end of the import list.[^import-spot]
   - In [`scrollColumnIntoView`](../packages/lib/src/typescript/lib/component/table/Body.ts#L3245), replace everything from `const right = left + widths[colIndex];` to the method's closing brace with the lines in `## Internal Structure`. In its JSDoc, replace "is fully visible, without moving the viewport unless necessary" with "is fully visible inside the scroller's viewport — clear of a border and of the vertical scrollbar — moving the least distance", and re-wrap the paragraph.

   Check: `npx vitest run tests/component/table/Body.test.ts` — T3–T8 pass, and exactly two older cases fail. Step 8 updates them.

8. **Two existing cases in `Body.test.ts` that pin the defect.**
   - In the `body()` helper ([line 66](../packages/lib/tests/component/table/Body.test.ts#L66)), add `b.setHeight(100);` after `b.setWidth(viewportWidth);`, and extend the comment: "and a height, so the scroller does not reserve a vertical bar for a zero-height viewport". The case at line 181 then passes with its expectation of `200` unchanged.[^body-fixture]
   - In `'reveals a record below the viewport by scrolling to its bottom edge'` ([line 495](../packages/lib/tests/component/table/Body.test.ts#L495)), replace `expect(p._scroller.getScrollY()).toBe(51 * rh - 100);` with `expect(p._scroller.getViewportHeight()).toBe(88);` followed by `expect(p._scroller.getScrollY()).toBe(51 * rh - 88);`, and add the comment: "100 rows and three 100 px columns in a 300 × 100 body raise both scrollbars, so the viewport is 88 px high."

   Check: `npx vitest run tests/component/table/Body.test.ts` passes.

9. **The remaining three source files.**
   - `component/display/HeadingScrollTracker.ts` — change [`scrollToHeading`](../packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L116) as shown. Add to its JSDoc, as a new paragraph before the `@param` lines: "The scroll starts from the element's current offset, not from the host's remembered one: the browser also scrolls the pane on its own, and the host does not hear of it."
   - `component/list/AbstractSelectableList.ts` — make the two edits shown. Replace the JSDoc of `scrollIndexIntoView` (as the dependency left it) with: "Scrolls the inner panel vertically, by the least distance, so the row at `idx` is fully visible; writes nothing when it already is. The horizontal offset is never touched. Delegates to the inner panel's `revealSpan`, which measures the viewport, re-reads the scroll offset, and does nothing while the panel is unrendered or not effectively visible." Keep the `@param` line.
   - `component/input/ComboBox.ts` — insert the three lines after `this.doLayout();` in [`showAt`](../packages/lib/src/typescript/lib/component/input/ComboBox.ts#L316). In `showAt`'s JSDoc, after "anchored below `anchorEl`." add: "The selected row is scrolled into view."

   Check: `npx vitest run tests/component/display tests/component/list tests/component/input` passes, including the dependency's `AbstractSelectableList.scrollIndexIntoView.test.ts` and `PickerColumn.scrollSelectedIntoView.test.ts` without an edit.

10. **Grep checks**, from `packages/lib`:
    - `grep -n "this.getHeight()" src/typescript/lib/component/shared/VirtualRowView.ts` — exactly one line, the `viewportRows` line of `mayAnimateRowMotion`.
    - `grep -n "visibleRight\|visibleBottom" src/typescript/lib/component/table/Body.ts src/typescript/lib/component/shared/VirtualRowView.ts` — no output.
    - `grep -n "this.getHeight() || ROW_HEIGHT_PX" src/typescript/lib/component/list/AbstractSelectableList.ts` — no output.
    - `grep -rn "nearestRevealOffset" src/typescript/lib --include=*.ts -l` — exactly `core/ScrollReveal.ts`, `core/Panel.ts`, `component/shared/VirtualRowView.ts`, `component/table/Body.ts`.
    - `grep -n "_host.getScrollTop() +" src/typescript/lib/component/display/HeadingScrollTracker.ts` — no output.
    - `grep -n "ScrollReveal" src/typescript/lib/core/index.ts` — no output.

11. **Neighbouring tests.** `cd packages/lib && npx vitest run tests/core tests/unit/core tests/component/table tests/component/tree tests/component/list tests/component/input tests/component/shared tests/component/display tests/component/container tests/component/layout tests/overlay`. Check: all pass. No existing test file other than `Body.test.ts` needs an edit.

12. **Docs, changelog, catalogue.** Make the edits in `## Documentation Impact`.

13. **Full verification.** Run the commands and the manual cases in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/ScrollReveal.ts` |
| Create | `packages/lib/tests/core/ScrollReveal.test.ts` |
| Create | `packages/lib/tests/core/PanelScrollReveal.test.ts` |
| Create | `packages/lib/tests/component/list/AbstractSelectableList.pageSize.test.ts` |
| Create | `packages/lib/tests/component/input/ComboBoxDropdownReveal.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` |
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/tests/component/container/VirtualScroller.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/tests/component/display/MarkdownViewer.test.ts` |
| Modify | `packages/lib/docs/components/VirtualScroller.md` |
| Modify | `packages/lib/docs/components/ComboBox.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/dom-only-state-inventory.md` |

`Tree.ts`, `FocusReveal.ts`, `Component.ts`, `PickerColumn.ts`, `Menu.ts` and `ScrollStrip.ts` are not edited.

---

## Expected Behaviour

Every numbered case is testable offline unless it is in the *Needs manual verification* table. Offline means the modelled DOM (`installTestDOM`), which has no layout engine. How a test gives it scroll geometry comes first.

### How offline tests get scroll geometry

| Input | Where it comes from offline |
|---|---|
| an element's rectangle | the modelled DOM composes it from the sizes and positions the library wrote: `setWidth` / `setHeight` / `setX` / `setY`, then `doLayout()`. It subtracts each ancestor's recorded scroll offset. Or the test stages rectangles by hand with `vi.spyOn(DOM.source, 'getElementRect')`, as [`FocusReveal.test.ts:366`](../packages/lib/tests/unit/core/FocusReveal.test.ts#L366) does. |
| a scroll offset | the recording sink stores each `scrollTop` / `scrollLeft` write and `DOM.source.getScrollTop(handle)` reads it back. It is **not clamped**, unlike a browser. |
| a browser-made scroll | `DOM.sink.apply(scroller(panel), { scrollTop: 200 })` — a write straight on the scrolling element, which goes around `Panel.setScrollTop`. |
| a visible scrollbar's band | [`setScrollExtent(handle, extent)`](../packages/lib/tests/dom/TestDOM.ts#L2085) on the scrolling element **before** the first sized layout. The panel's layout pass then reserves the band: 12 px under `"overlay"`, 15 px under `"native"` (`CONFIG.scrollBarWidth`). |
| a border on a connected element | the modelled DOM reports every border as 0 px. Stub it: `vi.spyOn(DOM.source, 'getBorderWidths').mockReturnValue({ top: '2px', right: '2px', bottom: '2px', left: '2px' })` after `installTestDOM` and before the component is mounted. |
| a border on an element that is not connected | nothing to stub: `getBorderSize()` estimates the width from the spec string (`'2px solid red'` → 2). The `Body` and `Tree` fixtures and the staged-rectangle `Panel` cases are not connected. |
| a `VirtualScroller` viewport | the owner's committed `setWidth` / `setHeight` and the content size of its last render. The `bodyWith` and `mount` fixtures already do this. |

Helpers the new `Panel` test file defines:

- `scroller(panel)` → `(panel as any).getScrollElement()`, the element that really scrolls.
- `scrollWrites(from)` → the number of recorded `apply` writes after index `from` whose patch carries `scrollTop` or `scrollLeft`.
- `mountPanel(options, seed?)` → builds `new Panel({ layoutManager: new Absolute(), flush: true, ...options })`, then in this order: `getElement(true)`, `setConnected(el, true)`, the optional `setScrollExtent(scroller(panel), seed)`, `setWidth(300)`, `setHeight(200)`, `doLayout()`, drain the captured frames.
- `stageRects(panel, target, targetRect)` and `panelWithTarget(options)` → copied from [`FocusReveal.test.ts:366–383`](../packages/lib/tests/unit/core/FocusReveal.test.ts#L366): the panel's own rectangle is staged as left 0, top 100, 300 × 300, and `panelWithTarget` takes extra `Panel` options. The panel is rendered but neither sized nor connected.

### The rule — `nearestRevealOffset(start, end, offset, extent)`

| # | start | end | offset | extent | Result |
|---|---|---|---|---|---|
| N1 | 150 | 190 | 100 | 300 | 100 |
| N2 | 100 | 140 | 100 | 300 | 100 |
| N3 | 360 | 400 | 100 | 300 | 100 |
| N4 | 20 | 60 | 100 | 300 | 20 |
| N5 | 420 | 460 | 100 | 300 | 160 |
| N6 | 50 | 650 | 100 | 300 | 100 |
| N7 | 100 | 700 | 100 | 300 | 100 |
| N8 | 200 | 800 | 100 | 300 | 200 |
| N9 | −150 | 350 | 100 | 300 | 50 |
| N10 | 20 | 60 | 100 | 0 | 100 |
| N11 | 20 | 60 | 100 | −12 | 100 |
| N12 | 20 | 60 | 100 | `NaN` | 100 |

### `Panel.getScrollViewportRect()`

`mountPanel` with `autoScroll: 'auto'` unless stated. "Rect" is `[left, top, width, height]`.

| # | Given | Rect |
|---|---|---|
| V1 | `scrollbarStyle: 'overlay'`, no seed | `[0, 0, 300, 200]` |
| V2 | `'native'`, no seed | `[0, 0, 300, 200]` |
| V3 | `'overlay'`, seed `{ width: 900, height: 800 }` | `[0, 0, 288, 188]` |
| V4 | `'native'`, same seed | `[0, 0, 285, 185]` |
| V5 | `'native'`, `border: '2px solid red'`, the `getBorderWidths` stub | `[2, 2, 296, 196]`; `right` is 298 and `bottom` is 198 |
| V6 | V1, then `panel.setDisplayed(false)` | `null` |
| V7 | `new Panel({ autoScroll: 'y' })`, never rendered | `null` |
| V8 | `autoScroll: 'none'` | `null` |

### `Panel.revealSpan()`

Each case runs once per scrollbar style unless it names one. "Offset" means both `DOM.source.getScrollTop(scroller(panel))` and `panel.getScrollTop()`: assert the two are equal to the stated number.

| # | Given | Then |
|---|---|---|
| S1 | `mountPanel({ autoScroll: 'auto' })`; `revealSpan('y', 100, 140)` | 0 scroll writes; offset 0 |
| S2 | S1, then `revealSpan('y', 500, 540)` | offset 340 |
| S3 | S2, then `DOM.sink.apply(scroller(panel), { scrollTop: 1000, scrollLeft: 70 })`, then `revealSpan('y', 900, 940)` | before the call `panel.getScrollTop()` is still 340; after it offset 900; `scrollLeft` is 70 on the element and `panel.getScrollLeft()` is 70 |
| S4 | S3, then `revealSpan('y', 950, 990)` | 0 scroll writes |
| S5 | `autoScroll: 'y'`; `revealSpan('x', 500, 540)` | 0 scroll writes; `panel.getScrollLeft()` is 0 |
| S6 | `autoScroll: 'auto'`; `panel.setScrollTop(300)`; `panel.setDisplayed(false)`; `DOM.sink.apply(scroller(panel), { scrollTop: 0 })`; `revealSpan('y', 0, 10)`; `revealDescendant(scroller(panel))` | the two reveal calls make 0 scroll writes; `panel.getScrollTop()` is 300 |
| S7 | seed `{ width: 900, height: 800 }`; `revealSpan('y', 500, 540)`; `revealSpan('x', 500, 540)` | `'overlay'`: offset 352, `scrollLeft` 252. `'native'`: offset 355, `scrollLeft` 255 |
| S8 | `autoScroll: 'none'`; `revealSpan('y', 500, 540)` | 0 scroll writes |
| S9 | a `Panel({ autoScroll: 'y' })` never rendered; `revealSpan('y', 500, 540)` | does not throw; `getScrollTop()` is 0 |

S6's direct write stands in for what a `display: none` element reports: an offset of 0.

### `Panel.revealDescendant()`

D1–D10 use `panelWithTarget` (`autoScroll: 'both'`, `scrollbarStyle: 'native'` unless stated) and `stageRects`. The staged viewport is left 0, top 100, 300 × 300. A target rectangle is given as its edges where it is drawn now.

| # | Given | Then |
|---|---|---|
| D1 | `DOM.sink.apply(panel.getElement(), { scrollTop: 200 })`; target top 420, bottom 460, left 50, right 90 | `panel.getScrollTop()` is 260 and so is the element's `scrollTop`; `getScrollLeft()` is 0 |
| D2 | `border: '2px solid red'`; `panel.getBorderSize().top` is 2; target top 420, bottom 460, left 320, right 360 | `getScrollTop()` 62; `getScrollLeft()` 62 |
| D3 | `border: '2px solid red'`; target top 20, bottom 60, left −30, right 10 | `getScrollTop()` −82; `getScrollLeft()` −32 |
| D4 | `autoScroll: 'y'`; target top 420, bottom 460, left 320, right 360 | `getScrollTop()` 60; `getScrollLeft()` 0 |
| D5 | `autoScroll: 'x'`; same target | `getScrollTop()` 0; `getScrollLeft()` 60 |
| D6 | target top 150, bottom 190, left 50, right 650, width 600 | `getScrollLeft()` 50; `getScrollTop()` 0 |
| D7 | target top 150, bottom 190, left 0, right 600, width 600 | 0 scroll writes |
| D8 | `DOM.sink.apply(panel.getElement(), { scrollLeft: 100 })`; target top 150, bottom 190, left −100, right 500, width 600 | 0 scroll writes; `getScrollLeft()` 100 |
| D9 | target top 150, bottom 190, left 400, right 1000, width 600 | `getScrollLeft()` 400 |
| D10 | `panel.setScrollTop(120)`; `panel.setDisplayed(false)`; target top 420, bottom 460 | 0 scroll writes; `getScrollTop()` 120 |
| D11 | once per style: `mountPanel({ autoScroll: 'auto' })` with two children added before a second `doLayout()` — `child`: `Component({ preferredSize: { width: 40, height: 40 } })` at `setX(50)`, `setY(500)`; `wide`: `Component({ preferredSize: { width: 700, height: 40 } })` at `setX(0)`, `setY(100)` | `revealDescendant(child.getElement())` → offset 340, `scrollLeft` 0. Then `DOM.sink.apply(scroller(panel), { scrollTop: 0 })` and the same call → offset 340 again. Then `revealDescendant(wide.getElement())` → offset 100, `scrollLeft` 0 |

The five existing cases under `describe('Panel.revealDescendant', …)` in `FocusReveal.test.ts` keep their expectations.

### `Tree`, `Table`, `TreeTable`

`TRACK_WIDTH` is `new Scrollbar('vertical').getTrackWidth()` (12). `rh` is the body's `_rowHeight` (20 offline); the tree's `ROW_HEIGHT` is 24.

| # | Given | Then |
|---|---|---|
| T1 | `makeScroller(200, 400)`; `scroller.layoutScrollbars(1000, 100)` | `getViewportHeight()` is `400 - TRACK_WIDTH` |
| T2 | `makeScroller(200, 400)`; `scroller.layoutScrollbars(100, 300)` | `getViewportHeight()` is 400 |
| T3 | `bodyWith(100, 100)` | `_scroller.getViewportHeight()` 88; `_scroller.getViewportWidth()` 288 |
| T4 | T3; `scrollRecordIntoView(recs[50])` | `_scroller.getScrollY()` is `51 * rh - 88` (932) |
| T5 | T3; `scrollColumnIntoView(2)` | `_scroller.getScrollX()` is 12 |
| T6 | `computePageSize()` on `bodyWith(100, 100)`, `bodyWith(100, 240)`, `bodyWith(100, 252)` | 4, 11, 12 |
| T7 | a body built like `bodyWith(100, 100)` with `b.setBorder('2px solid red')` before `getElement(true)` | `b.getBorderSize().top` 2; viewport 284 × 84; `scrollRecordIntoView(recs[50])` → `51 * rh - 84` (936); `scrollColumnIntoView(2)` → 16 |
| T8 | `body(300, [100, 100, 100, 100, 100])`; `_scroller.setScrollX(150)`; `scrollColumnIntoView(0)` | `scrollX` is 0 |
| T9 | a `_Tree`: `getElement(true)`, `setWidth(200)`, `setHeight(120)`, `setNodes` of the ten labels `['H','e','l','o','W','r','d','x','X','o']`; `scrollRowIntoView(9)` | `_scroller.getViewportHeight()` 120; `getScrollY()` 120 |
| T10 | T9 with the first label replaced by `'Hello World Hello World Hello World Hello World Hello World'` | viewport height 108; `getScrollY()` 132 |
| T11 | T10 with `tree.setBorder('2px solid red')` before `getElement(true)` | `tree.getBorderSize().top` 2; viewport height 104; `getScrollY()` 136 |

`scrollRecordIntoView`, `scrollColumnIntoView`, `scrollRowIntoView` and `computePageSize` are protected; reach them through an `any` cast, as both test files already do.

### `MarkdownViewer`

| # | Given | Then |
|---|---|---|
| H1 | the fixture of `'clicking a minimap row scrolls the viewer to that heading'` (pane staged 400 × 300, the second heading staged at top 500); then `DOM.sink.apply(viewer._content.getContentScrollElement(), { scrollTop: 300 })`; then `viewer._minimap.emit('select', id)` | before the click `viewer.getScrollTop()` is 0; after it the scrolling element's `scrollTop` is 500 and `viewer.getScrollTop()` is 500 |

### List paging

A `_List` of 40 items `Row 0` … `Row 39`. Keys are real `keydown` events dispatched at the list's element. L1 and L2 run once per scrollbar style, set with `(list as any)._innerPanel.setScrollbarStyle(style)` before the first `getElement(true)`.

| # | Given | Then |
|---|---|---|
| L1 | `horizontalScrolling: true`; the inner panel's scrolling element seeded `setScrollExtent(…, { width: 440, height: 880 })` before the first sized layout; mounted 200 × 230 | the inner panel's `getScrollViewportRect().height` is 218 (`'overlay'`) or 215 (`'native'`) — nine whole rows either way, where the outer height gives ten |
| L2 | L1; `ArrowDown`, `PageDown`, `PageDown`, `PageUp` | focused index 0 → 9 → 18 → 9 |
| L3 | no horizontal scrolling, 30 items, mounted 200 × 110; `ArrowDown`, `PageDown`, `PageDown`, `PageUp` | focused index 0 → 5 → 10 → 5 |

### `ComboBox` dropdown

A `ComboBox` given the 40 items `Option 0` … `Option 39` through `setItems`, mounted 160 × 24 (`getElement(true)`, `setConnected`, `setWidth`, `setHeight`, `doLayout()`, drain). `list` is `(combo as any)._dropdown.getList()` and `inner` is `list._innerPanel`.

| # | Given | Then |
|---|---|---|
| C1 | `combo.setSelectedIndex(30, false)`; listeners registered through `combo.on('change', …)` and `combo.on('action', …)`; `combo.openDropdown()` | `inner.getScrollViewportRect().height` is 200; `inner.getScrollTop()` and the scrolling element's `scrollTop` are both 482 (`31 * 22 - 200`); `list.getFocusedIndex()` and `list.getSelectedIndex()` are 30; neither listener ran |
| C2 | `combo.setSelectedIndex(2, false)`; `combo.openDropdown()` | `inner.getScrollTop()` is 0 |
| C3 | no selection (`setSelectedIndex(-1, false)`); `combo.openDropdown()` | `inner.getScrollTop()` is 0; `list.getFocusedIndex()` is −1 |

### Unchanged (offline)

Every existing test file passes without an edit, except the two cases of step 8. That includes the dependency's two files, `KeyboardContextMenu.test.ts`, `Menu.keyboardSession.test.ts`, `ScrollStrip.test.ts`, `Tab.undisplay.test.ts`, `Card.undisplay.test.ts` and `Split.collapseUndisplay.test.ts`.

### Needs manual verification

On the demo app (`npm run dev`), in Chromium. Repeat MV1, MV3, MV5 and MV6 in Firefox and in WebKit; the planner ran neither.[^engines]

| # | Where | Do | Expect |
|---|---|---|---|
| MV1 | `#/content-box`, "Tree (VirtualScroller)" | click `src`, `ArrowDown` ×6, then `ArrowUp` ×6 | after every press the current row is fully visible: its bottom edge never sits under the horizontal scrollbar or the border |
| MV2 | `#/misc` → "Show large tree (variable-width rows)" | click a row, hold `ArrowDown` for a few seconds, then `ArrowUp` | the current row is always fully visible above the horizontal scrollbar |
| MV3 | `#/misc` → "Show window with wide table (45 columns)!" | click a cell; `ArrowRight` until the table scrolls; `ArrowDown` past the last visible row; `PageDown` ×3; Shift+F10 | the current cell is fully visible, left of the vertical scrollbar and above the horizontal one; after each `PageDown` that scrolls, the row just below the previously current one is fully visible at the top, so no row is skipped; the menu opens under the cell |
| MV4 | `#/misc`, window about 500 px high | click the first button of the left column; press `Tab` until the column has scrolled by itself and the first button is out of view; press `Alt+[` (focus history, back) once per `Tab` pressed | every control that takes focus on the way back is fully visible inside the column, clear of its scrollbar |
| MV5 | `#/misc` → "Right-click for a tall (scrolling) menu" | right-click the button; `ArrowDown` through every item, then `ArrowUp` back | the highlighted item is fully visible after every press |
| MV6 | `#/markdown` | click on a paragraph; press `PageDown` twice; click a heading in the minimap that is not in view | that heading lands at the top of the pane, and the minimap highlights it |
| MV7 | `#/split`, the list | click `One`, `End`, `Home`, `PageDown`, `PageUp` | as before this plan: the focused row is fully visible after every press |
| MV8 | `#/misc`, the left column | click in the column, press `PageDown` twice; choose another section in the navigator; come back to "Misc." | the column is scrolled where it was left |
| MV9 | optional, SQLAdmin against `npm run build:lib` | open a combo box with more than nine options whose value is far down the list; close it; open it again | both times the selected option is visible, flush with the dropdown's bottom edge |

---

## Verification

Harness for the new test files:

- Node environment. `beforeEach`: `installTestDOM(CONFIG)` with the `CONFIG` object every neighbouring test file uses, and capture `requestAnimationFrame` registrations into an array, as [`PanelOverlayScrollbar.test.ts:40`](../packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L40) does. A scrolling panel schedules a follow-up layout frame, and an undrained one swallows the next test's registration.
- `afterEach`: drain the captured frames, `vi.restoreAllMocks()`, dispose every component the test built, then `DOM.reset()`. The list and combo files also call `Menu._stopInputWatch()` and `Tooltip._stopPointerWatch()` before `DOM.reset()`, as [`KeyboardContextMenu.test.ts:163`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L163) does: a `List` starts `Menu`'s input watch when it is built.
- `ComboBoxDropdownReveal.test.ts` is its own file for the reason given at the top of [`ComboBoxDropdownClose.test.ts`](../packages/lib/tests/component/input/ComboBoxDropdownClose.test.ts#L1): an undisposed combo in a shared file breaks later `"change"` dispatch.
- Keys: `DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key }))`, after `DOM.sink.focus(el)`.

The cases were run as a throwaway prototype against a temporary copy of the change before this plan was written.[^prototype]

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. The commands of steps 1, 2 and 11.
4. `npm test` — the whole suite.
5. `npm run lint`
6. `npm run build:lib`, `npm run docs:api`, `npm run docs:llms:check`
7. `npm -w packages/docs run test` — the docs app's `DocsContent` uses `HeadingScrollTracker`; it needs the two builds of item 6 first.
8. The MV cases, on `npm run dev`.

Grep checks: the six greps of step 10.

---

## Documentation Impact

**Exports.** No barrel changes. `Panel` (`core`) and `VirtualScroller` (`component/container`) are already exported and catalogued, so their three new methods appear on the existing API pages. `nearestRevealOffset` is internal: it is not added to `core/index.ts`, and no public JSDoc may `{@link}` it. No `llms.txt` manifest entry changes; `docs:llms:check` confirms it.

**Pages.**

- **[`docs/components/VirtualScroller.md`](../packages/lib/docs/components/VirtualScroller.md#L61)** — in the `## API` table, add a row after `getScrollX()` / `getScrollY()`: `` `getViewportWidth()` / `getViewportHeight()` `` | "Size of the visible window: the owner's content box, less the track of a visible scrollbar on the other axis. Test a row or a column against this, not against the owner's own size, to tell whether it is in view."
- **[`docs/components/ComboBox.md`](../packages/lib/docs/components/ComboBox.md#L119)** — under `## Notes`, add a bullet: "The dropdown opens scrolled to the selected option. An option below the first page appears at the dropdown's bottom edge, where the next `↓` continues from."
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md#L310)** — append to the last paragraph of the page, the one that begins "`back()` / `forward()` reveal a hidden trail entry": "A scrolling `Panel` moves the least distance that shows the control, only along the axes it scrolls, and keeps the control clear of its border and scrollbars."

**Changelog — [`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md).**

- `## Added` → `### Core`: **`Panel` gains `getScrollViewportRect()` and `revealSpan()`.** Say that the first returns the visible window onto the scrolled content — inside the border, clear of the scrollbars — or `null` for a panel that does not scroll or is hidden; and that the second scrolls the least distance that shows a span of the content along one axis.
- `## Added` → `### Components`: **`VirtualScroller` gains `getViewportHeight()`,** the twin of `getViewportWidth()`.
- `## Fixed` → `### Core`: **A `Panel` scrolls a control into view correctly.** Say what was wrong, in this order: after the browser had scrolled the panel itself — a key press, `Tab` moving focus, a touch pan, a native scrollbar — the reveal started from an out-of-date position and stopped short; with `scrollbarStyle: "native"` the control could end under the scrollbar or the border; a panel was scrolled along an axis its `autoScroll` mode does not scroll; and a control wider or taller than the panel lost its start. Name what uses it: focus history, spatial navigation, and a `Menu`'s highlighted row. End with "No consumer action is needed."
- `## Fixed` → `### Components`, three entries:
  - **A `Tree`, `Table` or `TreeTable` no longer leaves its current row or cell partly hidden.** With a border or the other axis's scrollbar showing, the row or column scrolled into view by the keyboard — or for Shift+F10 — stayed clipped by up to 16 px. `PageUp` / `PageDown` in a `Table`, `TreeTable`, `List` or `MultiSelectList` also moved one row too many in the same situation, so a row was skipped.
  - **A `ComboBox` dropdown opens on its selected option.** It opened scrolled to the top.
  - **A `MarkdownViewer` minimap click lands on the heading after the prose was scrolled from the keyboard.** It stopped short by the distance scrolled.

**JSDoc.** The comment edits of steps 6, 7 and 9, and the JSDoc in `## Internal Structure`. `revealSpan`, `getScrollViewportRect` and `getViewportHeight` are public: none of their comments names a private or `@internal` symbol.

**Catalogue — [`plans/dom-only-state-inventory.md`](dom-only-state-inventory.md).** Append one sentence to the last cell of two rows:

- the `Component` row for `setScrollLeft` / `setScrollTop` (line 83): "The mirror also goes stale after a scroll the browser makes on its own — keyboard scrolling, focus scrolling, a touch pan, a native scrollbar (measured in `scroll-reveal-geometry-fixes`); `Panel.revealSpan` / `revealDescendant` and `HeadingScrollTracker` re-read the offset before they use it."
- the `AbstractSelectableList` row for `scrollIndexIntoView` (line 131): "Now delegates to `Panel.revealSpan` (`scroll-reveal-geometry-fixes`)."

---

## Potential Challenges

- **The modelled DOM does not clamp scroll offsets.** A wrong target shows up offline as a wrong number, not a clamped one. Assert the exact numbers in the tables, including the negative ones of D3, and never read an expectation back from the code.
- **A seeded scroll extent has no effect after the first sized layout.** `mountPanel` and the L1 fixture seed before `setWidth` / `setHeight`, in the order given.
- **`Panel.ts` conflicts with `feature/spatial-navigation-redesign` when the two merge.** That branch inserts `getScrollViewportElement()` directly above `revealDescendant`'s JSDoc, which this plan rewrites. Keep both: `getRevealElement()`, then that branch's `getScrollViewportElement()`, then this plan's block.
- **`docs/concepts/accessibility.md` and `changelog/next.md` are edited by other unmerged work.** `spatial-navigation-redesign` rewrites the "Spatial focus navigation" section and the pending plan `modal-dialog-focus-trap` edits "Tab traversal". This plan appends one sentence to the last paragraph of the page and adds changelog entries. Keep both sides in a merge.
- **Two other pending plans list files this plan edits.** `directional-panel-navigation` changes the first line of `AbstractSelectableList.handleNavigationKey`, 30 lines above the page-size line. `overlay-scrollbars-non-panel` moves the `ScrollbarStyle` type and a class rule out of `Panel.ts`, near the top of the file. The hunks do not meet.
- **A reveal into a pane that `Split` or `Border` has just expanded starts from the top.** Those two restore a pane's remembered offsets on a layout pass after the reveal, so the reveal re-reads an offset of 0. The control is still scrolled into view. `Tab` lays out and restores inside its own reveal, so a tab page is not affected. (Read from the code, not measured.) Do not add a deferred reveal for this; see `## Non-Goals`.
- **`ScrollStrip` extends `Panel` and inherits the two new methods.** Its band does not scroll (`autoScroll: "none"`), so `getScrollViewportRect()` returns `null` and `revealSpan` does nothing there. Its own `revealDescendant` override is untouched.
- **`syncScrollOffsets()` stops a wheel scroll that is still easing.** That is wanted: a leftover ease would carry the revealed span out of view again.
- **The docs app already re-syncs before one of its two heading scrolls** (`DocsContent.onScrollToFragment`). That call is now redundant and harmless. Leave it.

---

## Critical Files

- [`core/Panel.ts`](../packages/lib/src/typescript/lib/core/Panel.ts#L648) — `revealDescendant` (:648), `getScrollElement` (:627), `getInnerSize` (:682), `_scrollbarGutter` (:200), `scrollableAxes` (:1180), the hidden-panel guard in `remeasureScrollMetrics` (:1044).
- [`core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L5060) — read only: `syncScrollOffsets` (:5060), `getScrollTop` / `setScrollTop` (:4963 / :5000), `getBorderSize` (:4167), `isEffectivelyVisible` (:2578), `captureSubtreeScroll` / `restoreSubtreeScroll` (:5121 / :5150), the wheel path that keeps the remembered offset current (`writeNativeScroll`, :5542).
- [`core/ScrollShadow.ts`](../packages/lib/src/typescript/lib/core/ScrollShadow.ts#L52) — the precedent for a pure scroll helper shared by `Panel` and `VirtualScroller`.
- [`component/container/VirtualScroller.ts`](../packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L391) — `getViewportWidth` (:391), `effectiveViewportH` (:366), `computeScrollbarVisibility` (:329).
- [`component/shared/VirtualRowView.ts`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1121) — `scrollRowIntoView` (:1121), `computePageSize` (:286), `scrollToCommittedY` (:1155).
- [`component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts#L3245) — `scrollColumnIntoView` (:3245), `revealFocusedCell` (:2365).
- [`component/tree/Tree.ts`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2098) — read only: `_revealFocusRow` (:2098), `_scrollIntoView` (:1874).
- [`component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2182) — the page-size line (:2182), `scrollIndexIntoView` (:2319), `setFocusedIndex` (:1989), the inner panel (:900).
- [`component/input/ComboBox.ts`](../packages/lib/src/typescript/lib/component/input/ComboBox.ts#L273) — `ComboBoxDropdown.showAt` (:273).
- [`component/display/HeadingScrollTracker.ts`](../packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L116) — `scrollToHeading` (:116), `trackScroll` (:78).
- [`component/container/ScrollStrip.ts`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L860) — read only: `mainScroll` (:860), the precedent for re-syncing before a read.
- [`layout/Tab.ts`](../packages/lib/src/typescript/lib/layout/Tab.ts#L2333) — read only: `revealDescendant` (:2333) lays out and restores scroll before it returns.
- Tests: [`tests/unit/core/FocusReveal.test.ts`](../packages/lib/tests/unit/core/FocusReveal.test.ts#L362), [`tests/core/PanelOverlayScrollbar.test.ts`](../packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L40), [`tests/component/table/Body.test.ts`](../packages/lib/tests/component/table/Body.test.ts#L227), [`tests/component/tree/Tree.test.ts`](../packages/lib/tests/component/tree/Tree.test.ts#L1206), [`tests/component/container/VirtualScroller.test.ts`](../packages/lib/tests/component/container/VirtualScroller.test.ts#L157), [`tests/component/display/MarkdownViewer.test.ts`](../packages/lib/tests/component/display/MarkdownViewer.test.ts#L294), [`tests/dom/TestDOM.ts`](../packages/lib/tests/dom/TestDOM.ts#L2085).
- [`plans/list-scroll-index-into-view.md`](list-scroll-index-into-view.md) — the dependency. Its addendum is the survey this plan answers, and its two test files are this plan's regression net for the list.

---

## Non-Goals

- **Nested scroll panels.** `FocusReveal.reveal` calls the outermost panel first. That order is right for a `Tab` or an `Accordion`, which must open before anything inside can be measured, and wrong for two nested scrollers: the outer one chases the target's position before the inner one has moved it. Measured: the target ended 375 px above the outer viewport. It is a different cause from the five defects — the order of the calls, not their geometry — and needs its own plan.[^nested]
- **`ScrollStrip.revealItem`** and its callers (`TabBar`). It measures its clip and re-syncs its offset correctly today. It keeps its own copy of the rule.
- **`PickerColumn.scrollSelectedIntoView`.** It centres its target, which is a different rule, and the dependency fixes it.
- **The row and column windows in `Tree.renderWindow` and `Body.renderWindow`,** which also read the outer size. They render a few pixels more than is visible; nothing is hidden.
- **Applying a reveal later** when it was asked for while the panel was hidden, or restoring a pane's remembered offset before a reveal into a pane `Split` or `Border` has just expanded.
- **What `SpatialNavigation` counts as in view.** On its branch it reads the rectangle of the element `getScrollViewportElement()` names, which under `"native"` includes the border and the scrollbars. It could read `getScrollViewportRect()`; that is a change to that branch.
- **A heading landing under a bordered pane's top border.** `HeadingScrollTracker` aligns to the scrolling element's outer top edge. Neither host has a border there.
- **Scrolling on `List.setSelectedIndex` / `setValue`,** and any change to `AutoCompleteField`.
- **Exporting `nearestRevealOffset`,** and changing `FocusRevealer` or `HeadingScrollHost`.
- **The demo app, the docs app and SQLAdmin.**

---

## Addendum: What was measured

Chromium, through chrome-devtools, on the demo dev server of `feature/table-tree-keyboard-context-menu` (`773854a24`) with the dependency's two-file change applied on top. Panels, trees, tables and lists were built from a script in the page. Keys were dispatched from the script unless a row says "real key".

**`Panel` geometry.** Eight panels, 178 × 281 with a 2 px border, one per scrollbar style and `autoScroll` mode (`"auto"`, `"x"`, `"y"`, `"both"`), each holding thirty 700 × 30 rows. In all eight, the panel's rectangle less its border and `_scrollbarGutter` equalled the scrolling element's client box. A second set with insets 4 and padding (5, 6, 7, 8) gave the same equality, while `getInnerSize()` was smaller by the insets and padding.

**`Panel.revealDescendant`, today.**

| Case | `"overlay"` | `"native"` |
|---|---|---|
| reveal row 20 from offset 0: bottom hidden | 0 | 17 (2 in `"y"` mode) |
| same: `scrollLeft` afterwards | 538 (525 in `"x"` mode) | 524 |
| `autoScroll: "y"`: `scrollLeft` afterwards | 538 | 524 |
| `autoScroll: "x"`: `scrollTop` afterwards | 365 | 351 |
| real offset 200, remembered 0, reveal row 25: bottom hidden | 200 | 217 |
| real offset 500, remembered 0, reveal row 5: lands at | 0 (150 is right) | 0 |

**Which scrolls leave the remembered offset stale.**

| Scroll | Real offset | Remembered |
|---|---|---|
| wheel event, both styles | 240 | 240 |
| drag of the overlay scrollbar's thumb | 389 | 389 |
| real key `PageDown`, focus on a button in the panel | 231 | 0 |
| real key `Tab` ×3, focus moving to a button out of view | 153 | 0 |

After the `Tab` case a reveal of row 20 landed at 212 where 365 is right, leaving the row 153 px below the viewport.

**`Tree` and `Table`.** Four trees (180 × 281) and two tables. The scroller's clip box equalled its effective viewport in all six. After `ArrowDown` ×16 the current tree row's bottom was hidden by 0 / 4 / 12 / 16 px (plain / border / horizontal bar / both). A table's current cell was hidden by 12 / 16 px at the bottom after `ArrowDown` ×25 and by 12 / 16 px at the right after `ArrowRight` ×5. With a horizontal bar, a table body 240 px high has a 228 px viewport: eleven 20 px rows fit and `PageDown` moved twelve. The same held at 244 and 248.

**`HeadingScrollTracker`.** A `MarkdownViewer` with twelve sections. From a fresh state a minimap scroll was exact. After a direct scroll to 2000 (remembered 838), `scrollToHeading` for a heading at 3087 landed at 1925. After a real `PageDown` with the pane focused (real 307, remembered 0), it landed 307 px short. After a wheel scroll it was exact.

**List paging.** Three lists of 40 rows. 221 px high: viewport 219, nine rows fit, `PageDown` moved ten (0 → 10 → 20), and row 11 was never shown whole. 230 px high with a horizontal bar: viewport 216, same. 242 px high: viewport 240, ten fit, moved eleven.

**`ComboBox`.** Forty options, the 31st selected. In the same task as `openDropdown()`: `scrollTop` 0, viewport 198, content 880, selected row 484 px below the view, panel effectively visible. After close and reopen the element's `scrollTop` was 0 again while the panel remembered 506.

**With the change applied temporarily** (reverted afterwards).

- `getScrollViewportRect()` equalled the client box in all eight panels. Row 20 landed at 365 / 353 / 368 with nothing hidden and `scrollLeft` 0; the stale cases landed at 515 / 503 / 518 and 150; `"x"` panels did not move vertically.
- Trees and tables: nothing hidden on any side, in all six.
- List paging moved nine rows where nine fit (0 → 9 → 18 → 9) and no row was skipped.
- The `ComboBox` opened at 484 with the selected row flush with the bottom edge, in the same task as the open; reopened at 506.
- `scrollToHeading` landed on the heading from every stale state.
- A panel scrolled by the browser to 300, then hidden by a tab switch: `getScrollViewportRect()` was `null`, reveals while hidden changed nothing, and it came back at 300.
- Real `ArrowDown` ×6 on the bordered tree of `#/content-box`: the row was flush with the clip's bottom edge.

**Not run:** Firefox and WebKit; a touch pan; a real drag of a native scrollbar (replaced by a direct `scrollTop` write, which the library sees the same way: as a scroll it did not make).

---

## Notes

[^other-dropdowns]: `AutoCompleteDropdown.show` sizes its dropdown to exactly its rows with no cap, and selects nothing on open, so there is nothing to scroll to. The date field's year list is a `PickerColumn`, which centres its selected cell through `scrollSelectedIntoView`; `list-scroll-index-into-view` fixes that method.

[^rule]: The rule is the CSS Object Model's definition of `scrollIntoView` with `"nearest"`, which is the standard meaning of "least scroll". For a span that fits, it is exactly what the five existing copies do (`Panel.revealDescendant` twice, `VirtualRowView.scrollRowIntoView`, `Body.scrollColumnIntoView`, `AbstractSelectableList.scrollIndexIntoView`). They differ only for a span larger than the viewport, where each copy pushes the span's start out of view: that is defect 1d. Two homes for the function were rejected. `Util` holds general helpers, not scroll geometry. A method on `Panel` could not be reached by `VirtualScroller`'s owners, which are not panels. The function is not exported from `core/index.ts`, like `ScrollShadow`'s helpers, because no consumer needs it.

[^viewport]: Three ways to get the viewport were compared against the scrolling element's real client box, in eight style-and-mode combinations and again with insets and padding. *The scrolling element's own rectangle*, which today's code uses: exact under `"overlay"`, 4 px and up to 19 px too large under `"native"`. *`getInnerSize()`*: exact for a panel with no insets or padding, too small by them otherwise, because that space scrolls with the content. *The panel's rectangle less border and gutter*: exact in every case, and the choice. It needs one DOM read. The cached `getWidth()` / `getHeight()` were not used for the size because they can carry a fraction of a pixel the DOM box does not have (214.5 cached against a 214 or 215 px box). `getScrollViewportRect()` is a measurement, like `getMaxScrollTop()`; the architecture rule that reads return cached state is about values a setter stores. It also lets the existing five `revealDescendant` tests, which stage the panel's rectangle, pass without an edit.

[^span]: `revealSpan` takes content positions, not an element, so a caller that knows its row arithmetic need not measure a row element, and a virtual row that has no element yet can still be revealed. The dependency's footnote rejected a "new `Panel` method that reveals a span of content" because the list would have been its only caller. The span reveal now serves three: the list directly, `revealDescendant` for each of its two axes, and the `ComboBox` through the list. Extending `revealDescendant` with an axis argument and having the list pass a row element was the alternative. It was rejected because the list plan had just settled on row arithmetic, for the reason above. Rewriting `scrollIndexIntoView` here is a deliberate second edit of a method the dependency rewrites; `depends-on` orders the two, and the dependency's test file pins the behaviour across the change.

[^stale]: The wheel and the overlay scrollbars are handled in library code that writes the remembered offset as it goes (`Component.writeNativeScroll`, `Panel._onOverlayScrollV`). Everything else the browser does by itself. The earlier survey and the spatial-navigation branch's notes both recorded the stale offset as something only a direct `scrollTop` write produces; the two real-key rows in the addendum show a user reaches it with `Tab` or `PageDown`. `Panel` has a `scroll` listener, but it updates the scrollbar thumbs and edge shadows, not the offset; making it do so would also be a fix, but the offset would still be one event behind inside the task that scrolled, so the reveal re-reads regardless.

[^axes]: Writing `scrollLeft` on an `overflow-x: hidden` element works in every browser, which is how defect 1c happens. The panel then shows no scrollbar for that axis and its wheel handler refuses the axis, so the user cannot scroll back.

[^hidden]: An element inside a `display: none` subtree reports its scroll offsets as 0 and ignores writes. `syncScrollOffsets()` there would overwrite the remembered offset with 0. `Tab`, `Card`, `Split` and `Border` capture each panel's offset before hiding it and write it back on show (`Component.captureSubtreeScroll` / `restoreSubtreeScroll`), so that 0 would be "restored". `isEffectivelyVisible()` is the library's one predicate that walks the ancestors. It is also false for a panel hidden with `visibility`, which could still scroll; skipping that case too is the cautious choice.

[^virtual]: `VirtualScroller` keeps its offsets in its own fields, and every scroll goes through its setters, so they are never stale. Only the viewport size was wrong at the call sites. A `revealSpan` method on `VirtualScroller` was considered and rejected: the row reveal must write through `VirtualRowView.scrollToCommittedY`, which settles a running row animation first, and the column reveal through `Body.setScrollX`. The scroller cannot make those writes itself.

[^tracker]: The tracker is independent of `Component` by design and is used by the docs app as well as by `MarkdownViewer`. Changing `HeadingScrollHost` would be a breaking change for both hosts for no gain: the tracker already holds the element.

[^combo]: `setSelectedIndex`, called earlier in `showAt`, already sets the list's focus mark to the same index, so `setFocusedIndex` changes no state. It repaints, updates `aria-activedescendant` to the same row, and reveals. It fires neither `"change"` nor `"action"`. Centring the option, as `PickerColumn` does for its cells, was considered. The least-scroll reveal was chosen so that opening and the next arrow key follow one rule. The call must come after `showAt`'s `doLayout()`: before it, the rows have no positions and the panel no size.

[^spatial]: `getScrollViewportElement()` names an element. Everything this plan needs lives inside `Panel`, which reaches its scrolling element through the protected `getScrollElement()` already. Depending on that 3,700-line branch would buy nothing and would force its merge first. The two accessors do not duplicate each other: one identifies a viewport for an ancestor walk, the other measures it.

[^import-spot]: `feature/spatial-navigation-redesign` adds an import after the last import of `Body.ts`. Adding this one beside the `VirtualRowView` import, eleven lines up, keeps the two hunks apart.

[^body-fixture]: The `body()` helper never gave the body a height. With a height of 0 the scroller's viewport height is negative once a horizontal bar is reserved, it then reserves a vertical bar as well, and the viewport width drops from 300 to 288. The old code never read the scroller's width, so the fixture's gap did not show.

[^engines]: Only Chromium was driven. Nothing in the change is engine-specific: it reads `getBoundingClientRect()`, `scrollTop` and `scrollLeft` and writes the two offsets. MV4 and MV6 depend on the browser scrolling a panel by itself for `Tab` and `PageDown`, which every engine does, with different step sizes.

[^nested]: A fix needs to tell revealers that scroll from revealers that open something, then call the first kind innermost-first after the second kind. `FocusRevealer.getScrollViewportElement?()` from `spatial-navigation-redesign` is exactly that test, so the follow-up plan should depend on that branch.

[^prototype]: The prototype diff, the three page scripts, the scratch test files and the raw numbers are kept outside the repository, at `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/scroll-reveal/` (`prototype-fix.diff`, `probe*.ts`, `zz*.scratch.test.ts`, `measurements.md`). They are a reference only and may be gone: write the code and tests from this plan. With the change applied, 385 existing test files near the change passed except the two cases of step 8, the dependency's 74 cases passed unchanged, the docs app's `DocsContent.test.ts` passed, and the library typecheck and ESLint on the touched files were clean. Not run, because each follows from the same arithmetic as a case that was: T1, T2, T8, S9, C2, C3, the two listeners of C1, and the second and third key presses of L2.

---

## Implementation Notes

Built on `feature/list-scroll-index-into-view` (`2ff05d2a3`), which sits on `feature/modal-dialog-focus-trap` → `feature/table-tree-keyboard-context-menu` → `feature/context-menu-keyboard-operation` → local `master` (`87c5ff0cc`). The plan was drafted two branches lower, on `feature/table-tree-keyboard-context-menu` at `773854a24`, with the list plan's two-file change applied as a prototype.

### What differed on the base

Nothing the plan reads or writes had changed in a way that altered what had to be done.

| File | What the newer base changed | Effect here |
|---|---|---|
| `core/Panel.ts` | nothing in the reveal block | the plan's line numbers for `revealDescendant`, `getInnerSize` and `scrollableAxes` matched |
| `core/Component.ts` | the `inert` attribute, from `modal-dialog-focus-trap` | the scroll methods sit two lines lower than the plan's numbers; their behaviour is unchanged |
| `component/list/AbstractSelectableList.ts` | `scrollIndexIntoView` as `list-scroll-index-into-view` left it: an `isEffectivelyVisible()` guard, a `syncScrollOffsets()` call and a two-branch comparison | everything after the index guard became the one `revealSpan` call, as that plan's notes foresaw; `handleNavigationKey`'s page-size line is at 2183 |
| `component/input/PickerColumn.ts` | `scrollCellIntoView(cell)` added, `scrollSelectedIntoView()` delegates to it, both with their own hidden-column guard | not edited here; the time picker addition below calls `scrollSelectedIntoView()` |
| `tests/component/input` | a third file from the list plan, `AbstractCalendarDropdown.yearScrollerReveal.test.ts` | the regression net for the list and the picker is three files, and all three pass without an edit |
| `docs/reference/changelog/next.md`, `docs/concepts/accessibility.md` | entries and sections from the two branches in between | the new entries follow the list plan's; the accessibility sentence is still appended to the page's last paragraph |
| `plans/dom-only-state-inventory.md` | rows 83, 103 and 131 already carry the list plan's sentences | this plan's two sentences are appended after them, on rows 83 and 131; row 103 is untouched |

### Deviations from the plan

1. **The time picker opens on its selected time: added here, by decision.** The list plan's notes recorded it as found and left: with `09:30` in a `TimeField` the hour column opened at the top and `09` was below the view. It is the plan's defect 5 in another dropdown, which the plan's footnote on other dropdowns does not mention, and no plan owned it. What changed:
   - `TimeColumns` gained `scrollSelectedIntoView()`, which asks each of its two or three columns to do the same. `TimePickerDropdown.showAt` calls it after the layout pass that places the cells. Neither file is in the plan's file table.
   - **The rule is the column's own: centring.** The columns are `PickerColumn`s, and `PickerColumn.scrollSelectedIntoView()` is how a calendar's year list opens on its year: the cell in the middle of the view, clamped to the scrollable range. The `ComboBox` dropdown is a `List` and opens by the list's rule, the least scroll. So each dropdown opens through the reveal its own list component already has, and no dropdown does scroll arithmetic of its own. Using `Panel.revealSpan` on the cell list was the alternative. It was rejected because a time column would then open with its hour on the bottom edge while the year list beside it, the same component, opens centred. `PickerColumn.ts` is not edited.
   - **`showAt` is the one entry point.** `TimeField`, the `TimeField` that a `DateTimePickerDropdown` embeds as its time row, and the table's `TimeEditor` all open the picker through it, and the table's `DateTimeEditor` opens the calendar that embeds that time row. `ComboEditor` wraps a `ComboBox`, so the table's combo cells get the plan's own fix the same way.
   - **A pick does not scroll.** The reveal runs on open only. A column the user scrolled stays where it is when a cell is clicked, which the class comment of `TimeColumns` already promised.
   - **A value with no cell leaves its column alone.** The minute and second columns hold multiples of five. `09:33` highlights no minute cell, and that column is not scrolled.
   - Cases TP1–TP9 below, in `tests/component/input/TimePickerDropdownReveal.test.ts`. Docs: one bullet in `TimeField.md`, one in `DateTimeField.md`, a changelog entry under `Fixed` → `Components`, and the JSDoc of `TimePickerDropdown.showAt`.
   - **It rides in the plan's one code commit and one documentation commit.** The review pointed out that the addition could stand as a functionality of its own, since it needs only `PickerColumn.scrollSelectedIntoView` from the base. It was kept with the rest because it is the plan's defect 5 in a second dropdown, as the `ComboBox` insertion is in the first, and because the list plan folded its year-list fix into its one code commit on the same grounds.
2. **`AutoCompleteField` needed nothing.** Its dropdown is sized to exactly its rows, with no cap, and selects nothing when it opens, as the plan's footnote says. Checked in Chromium: ten suggestions, content and viewport both 220 px, no row selected or focused.
3. **One case beyond the plan's `ComboBox` table: C4.** The same dropdown element is shown again each time the combo opens. It comes back scrolled to the top while the list's panel still remembers the offset it was left at, which the plan measured (506 remembered, 0 real) but did not turn into a case. C4 closes the dropdown, puts the scrolling element at 0 and reopens: the dropdown is at 482 again. It fails when `revealSpan` does not re-read the offset.
4. **`Body.scrollColumnIntoView` has a blank line after its `for` loop.** The plan's replacement text starts on the line after the loop. The code conventions ask for a blank line after a multi-line statement, and the new `const` would otherwise have touched it.
5. **Three documentation edits beyond the plan's list.** `docs/components/List.md`: the keyboard table said `PageUp` / `PageDown` "jump by one visible-row count" and now says "by the number of whole rows the list shows". The changelog entry for trees and tables ends by saying what a page now is. The `ComboBox` entry says a table's combo cell editor opens the same dropdown.
6. **`plans/dom-only-state-inventory.md` is committed with these notes,** not with the documentation. A file under `plans/` is housekeeping, and the branch's one extra bookkeeping commit is where that goes, as the list plan did.
7. **Assertions beyond the plan's tables.** V5 also asserts the rectangle's `x` and `y`. One case asserts that `revealSpan` returns the panel. L1 states the two row counts, nine from the viewport and ten from the outer height. T4 and T7 state the literal offsets (932, 936) beside the formula. S1–S4 run as one sequence from a helper, each case stopping one step later, since each starts from the state the one before left.
8. **A `List` measures its viewport for a page size on `PageUp` and `PageDown` only: changed after the review.** The plan's line computes the page size at the top of `handleNavigationKey`, before the key is looked at. With the outer height that cost nothing; with `getScrollViewportRect()` it read the panel's rectangle on every arrow key, `Home` and `End` as well, for a number only the two page keys use. The line became a private `computePageSize()`, named after `VirtualRowView.computePageSize`, which the two page-key branches call. Case L4 pins it: an arrow key, `Home` and `End` measure the viewport once, for the reveal, and a page key twice.
9. **Not run from the plan's manual list:** MV9, the optional SQLAdmin case. Firefox and WebKit were not run.

Nothing else differs. `core/ScrollReveal.ts`, the `Panel` block, `VirtualScroller.getViewportHeight`, the two `VirtualRowView` methods, `Body.scrollColumnIntoView`, `HeadingScrollTracker.scrollToHeading`, the list's `scrollIndexIntoView` and the `ComboBox` insertion are the plan's text. No demo was added: the plan lists the demo app under `## Non-Goals`.

### Existing tests whose expected value changed

Two, both in `tests/component/table/Body.test.ts`, and both the ones the plan's step 8 names. After step 7 exactly these two failed, as the plan predicted.

| Case | Before | After | Why |
|---|---|---|---|
| `body()` fixture, used by `'scrolls a right-edge column fully into view through the scroll model'` | no height committed | `b.setHeight(100)` | The expectation, 200, is unchanged. Without a height the scroller's viewport height was negative once a horizontal bar was reserved, a vertical bar was then reserved as well, and the viewport width dropped from 300 to 288. The old code never read the scroller's width |
| `'reveals a record below the viewport by scrolling to its bottom edge'` | `51 * rh - 100` | `51 * rh - 88`, and the viewport height asserted as 88 | The old value pinned the defect: 100 rows and three 100 px columns in a 300 × 100 body raise both scrollbars, and the row ended 12 px under the horizontal one |

No other existing case was edited. `VirtualScroller.test.ts`, `Tree.test.ts` and `MarkdownViewer.test.ts` gained the cases the plan's step 2 names and nothing in them changed. The five `Panel.revealDescendant` cases of `FocusReveal.test.ts`, the list plan's three files, `KeyboardContextMenu.test.ts`, `Menu.keyboardSession.test.ts`, `ScrollStrip.test.ts`, `Tab.undisplay.test.ts`, `Card.undisplay.test.ts` and `Split.collapseUndisplay.test.ts` pass as they were.

### The time picker: expected behaviour

Written before the change. A `TimePickerDropdown` opened through `showAt`; the panel is 220 px high, so offline each cell list's viewport is 192 px (220, less 4 px insets top and bottom, the 18 px header and the 2 px gap; the modelled DOM has no box for the panel's 1 px border, and in Chromium the viewport is 190 px). Cells are 22 px: 24 in the hour column (content 528, largest offset 336), 12 in the minute and second columns (content 264, largest offset 72). Centring the cell at index `i` gives `i × 22 − 85`, clamped to the range. "Offset" means the scrolling element's `scrollTop` and the cell list's remembered offset, which must agree; each case that states an offset also asserts that the cell is selected and lies wholly inside the viewport. Every case runs under both scrollbar styles of the cell lists.

| # | Given | Then |
|---|---|---|
| TP1 | opened on `09:30` | viewport 192; hour column at 113, minute column at 47 |
| TP2 | opened on `23:55` | hour column at 336, minute column at 72: clamped at the end |
| TP3 | opened on `23:55`, closed, opened on `02:05` | both columns at 0: clamped at the start |
| TP4 | opened on `09:30`, closed; the scrolling elements put at 0 while the cell lists still remember 113 and 47; opened on `09:30` again | 113 and 47 |
| TP5 | the minute column's scrolling element at 50; opened on `09:33` | hour column at 113; no minute cell selected; the minute column's element still at 50 and its remembered offset still 0 |
| TP6 | both columns' scrolling elements at 50; opened with no time | no cell selected; both elements still at 50, remembered offsets still 0 |
| TP7 | `showSeconds`, opened on `09:30:45` | 113, 47, and the second column at 72 |
| TP8 | opened on `09:30`; the hour column's element put at 336; a click on `17` | `17` selected; 0 scroll writes; hour element at 336, minute element at 47 |
| TP9 | a `TimeField` on `09:30`: real `ArrowDown` in its input (opens the picker), `Escape`, the elements put at 0, `ArrowDown` again | 113 and 47 |

Before the change TP1, TP2, TP4, TP5, TP7, TP8 and TP9 failed, every column staying at 0. TP3 and TP6 passed, since nothing scrolled at all. TP6 first counted scroll writes and failed for another reason: the first layout pass puts a column's cells in a content frame and writes the offsets it found back around that move. It compares offsets instead.

### Mutations

Each rule was checked by breaking the finished code and running the new and the neighbouring test files. Every mutation was caught. The case ids are those of `## Expected Behaviour` and of the tables above; R and K are the list plan's cases, and where a row says so, C1 is that plan's Shift+F10 case and not the `ComboBox` one.

| Mutation | Cases that fail |
|---|---|
| `revealSpan` does not re-read the offset | S3, S4, C4, and the list plan's R5–R7, R9, K7 and C1 |
| `revealDescendant` does not re-read the offset | D1, D8, D11 |
| the viewport ignores the border | V5, D2, D3 |
| the viewport ignores the scrollbar band | V3, V4, S7, L1, L2, K8 |
| a reveal ignores which axes the panel scrolls | S5, D4, D5 |
| the viewport has no visibility guard | V6, S6, D10, K9 |
| the viewport has no `autoScroll: "none"` guard | V8 |
| a span larger than the viewport is treated like one that fits | N7, N8, N9, D6, D7, D9, D11 |
| a span that covers the viewport is scrolled anyway | N6, D8 |
| the rule has no guard for a viewport without extent | N10, N11, N12 |
| the `ComboBox` dropdown does not reveal on open | C1, C4 |
| the time picker does not reveal on open | TP1, TP2, TP4, TP5, TP7, TP8, TP9 |
| a pick scrolls the time columns | TP8 |
| the minute column is not revealed | TP1, TP2, TP4, TP7, TP8, TP9 |
| the second column is not revealed | TP7 |
| the table's page size comes from the outer height | T6 |
| the list's page size comes from the outer height, or rounds up | L2 |
| the list computes a page size on every navigation key | L4 |
| a row is revealed against the outer height | T4, T7, T10, T11, and the updated `Body` case |
| a column is revealed against the outer width | T5, T7 |
| `getViewportHeight` ignores the horizontal bar | T1, T3, T4, T6, T7, T10, T11, and the updated `Body` case |
| a heading scroll starts from the remembered offset | H1 |
| the list scrolls its row to the top edge every time | the `ComboBox` cases C1, C2 and C4, and 18 of the list plan's R and K cases |

### No layout read was added to scrolling

The table and the tree have had scroll-performance work, so this was checked two ways.

By reading: no `DOM.source` call was added to `VirtualRowView`, `Body` or `VirtualScroller`. `getViewportHeight()` computes from the owner's cached content box and the content size of the last render, as `getViewportWidth()` does. The three changed methods are called from key handlers, the edit-entry handler, Shift+F10 and `scrollToRecord`, never from a scroll tick or `renderWindow`.

By counting: a scratch test counted every `DOM.source` call during 60 vertical scroll ticks, 20 horizontal ones and 10 `renderWindow` passes on a bordered table body, and the same on a bordered tree, once on the base branch's sources and once on this branch's. The counts are identical, method by method, and hold no geometry read on either: only `isConnected` and, for the tree, text metrics. The reveals themselves (`scrollRowIntoView`, `scrollColumnIntoView`, `computePageSize`) differ by four `isConnected` calls, from the border lookup, and read no geometry either.

A `Panel` reveal does read geometry: one rectangle for the viewport, one for the target in `revealDescendant`, and the two offsets. A `List`'s `PageUp` and `PageDown` read the panel's rectangle once more, to size the page; no other key does (deviation 8).

### Verification that was run

Offline: every case of `## Expected Behaviour` is a test, written before the code. Before the change the four new files and the four extended ones failed exactly as the plan's steps 1 and 2 predict: `ScrollReveal.test.ts` did not load; all of `PanelScrollReveal.test.ts` failed; L1, L2 and C1 failed while L3, C2 and C3 passed; T1–T7, T9–T11 and H1 failed while T8 passed. The command of step 11 passes (395 test files). The six greps of step 10 print what the plan says. `typecheck`, `typecheck:test`, `lint`, the whole `vitest` suite (552 files, 9,599 tests), `docs:api` (no warnings), `docs:llms:check`, `build:lib` and the docs app's tests (13 files, 2,615 tests) pass.

Chromium, through chrome-devtools, on this worktree's demo dev server, with real key presses. The demo offers no switch for the scrollbar style and no bordered scroll panel, so most rows were run on rigs built in a `Window` from a script, with the keys pressed for real and the geometry measured against the scrolling element's client box (or, for a tree and a table, the scroller's clip box). Clicks are real where a row says so. MV2, MV3 on the demo's own table and MV7 were run after the review, on the code as it is now. Firefox and WebKit were not run; MV1, MV3, MV5 and MV6 are still to be repeated there by hand.

| Case | Result |
|---|---|
| `getScrollViewportRect()` | Eight panels: `"overlay"` and `"native"`, `autoScroll` `"auto"` and `"y"`, without a border and with a 3 px one. The rectangle equalled the scrolling element's client box in all eight, for example 168 × 263 inset by 3 px (overlay, both bars, border) and 165 × 260 (native) |
| `Panel.revealDescendant` after keyboard scrolling | All eight panels. Focus on the first of thirty 30 px rows, one real `PageDown`: the panel is at 227–245 and remembers 0. Revealing row 25 lands at 499–520, the row flush with the viewport's bottom edge, the horizontal offset still 0, and the remembered offset equal to the real one |
| `Panel.revealDescendant` after `Tab` focus scrolling | Four panels (overlay and native, with and without a border, `"auto"` and `"y"`). Real `Tab` ×3 from row 7: the browser scrolls the panel to 154–178, remembered 0. Revealing row 20 lands at 367, 370, 349 and 355, flush with the bottom edge |
| a reveal from an offset the panel never heard of, through `FocusReveal.reveal` | All eight, with the offset written directly: row 5 lands at 150, flush with the top edge. A 700 px row in a panel scrolled 200 px sideways stays at 200, since it covers the viewport. A `"y"` panel never moved sideways |
| MV1, a bordered `Tree` with a horizontal scrollbar (`#/content-box`, 200 × 120, 2 px border) | pass. Real `ArrowDown` ×7 and `ArrowUp` ×6: the current row is whole after every press, and flush with the clip box's bottom edge and then its top edge when the tree scrolls. The tree was focused from a script, since the tool clicks a row's centre and the wide rows' centre is outside the clip box |
| a bordered `Tree` with a horizontal scrollbar, 188 × 281 | Real `ArrowDown` ×13 and `End`: the current row never sits under the bar or the border; the tree scrolls to 23, 47, 71 and 695, the row flush each time. The scroller's viewport equalled the clip box in four trees (281, 277, 269 and 265 px high) and two tables |
| MV2, the large tree (`#/misc`, 350 × 439 with a horizontal scrollbar) | pass. Real `ArrowDown` ×20 and `ArrowUp`: the current row is whole after every press, and flush with the clip box's bottom edge, above the scrollbar, once the tree scrolls |
| MV3, the 45-column table (`#/misc`, body 880 × 462, both scrollbars) | pass. A real click on a cell, real `ArrowRight` ×6: the cell is whole every time and flush with the vertical scrollbar's left edge when the table scrolls. `PageDown`, `ArrowDown`, `PageDown` ×3: the cell is flush with the bottom edge each time, above the horizontal bar; 22 whole rows are in view and the page is 22, so the row below the previous current one is the first whole row. Shift+F10 opens the menu at the cell's bottom-left corner |
| `Table` row and column reveal, on a rig table with a 2 px border and both scrollbars | pass. Real `PageDown`, `ArrowDown`, `ArrowRight` ×4, `PageDown` ×2, `PageUp`, `ArrowLeft` ×4: the current cell is whole after every press, left of the vertical bar and above the horizontal one |
| `PageDown` in a `Table` with a horizontal scrollbar | Body 240 px high, viewport 228: the page is 11 rows where the outer height gives 12. Real `PageDown` ×3 moves `r0` → `r11` → `r22` → `r33`, and after each the first whole row in view is the one below the previous current row. Shift+F10 then opens the menu at the cell's bottom-left corner with focus in the menu |
| `PageUp` / `PageDown` in a list | Four lists with real keys: 221 px with the 1 px border (overlay), 230 px with a horizontal bar (overlay and native) and a 242 px `MultiSelectList` (native). `ArrowDown`, `PageDown`, `PageDown`, `PageUp` gives 0 → 9 → 18 → 9, and 0 → 10 → 20 → 10 for the last. The rows whole in view after the second page start at the row after the first page's last: no row is skipped. The panel's viewport height equalled the client height in six lists |
| `ComboBox` | pass, opened with real clicks. 40 options, the 31st selected: opens at 484 with the option flush with the bottom edge. `ArrowDown`, `Escape`, a click: reopens at 506 on the 32nd. With the third option selected it opens at 0 |
| `AutoCompleteField` | nothing to reveal: see deviation 2 |
| time picker | pass. `TimeField` on `09:30`, opened with a real click on its button: hour column at 114 with `09` exactly centred, minute column at 48 with `30` centred, viewport 190. Closed and reopened: the same. With the hour column scrolled to its end, a real click on `17` leaves it there and the field reads `17:30`. With seconds, on `21:40:45`: 338, 74 and 74, each column at its largest offset with the cell in view. The time row of a `DateTimeField` on `17:45`: hour column at 290 with `17` centred, minute column at 74. The table's time editor (`#/misc`, "table (column spec)", a real double click on `04:45:50 PM`): 268 with `16` centred, 74 and 74 |
| a hidden `Tab` page and a hidden `Card` page | pass. Each page holds an overlay panel, a native panel and a `List`. Real `PageDown` ×2 in each panel (404 and 398 on the tab page, 456 and 450 on the card page; the panels remember 0) and `End` in each list (639, 609). With the page hidden, `getScrollViewportRect()` is `null`, the panels remember the offsets captured on hide, and `revealSpan` on both axes, `revealDescendant` and `setFocusedIndex(0)` change none of them. Shown again, all six are where they were left |
| a reveal into a hidden `Tab` page | `FocusReveal.reveal` of a control on the hidden page selects the tab, which restores the panel's offset, and the panel then scrolls the control into view |
| MV4, focus history (`#/misc`, 500 px high) | pass. Real `Tab` ×13 from the first button: the column scrolls itself to 336. Real `Alt+[` ×13: every control that takes focus on the way back is whole inside the column, each one flush with the top edge once the column has to move (330, 297, 264, … 4) |
| MV5, the tall menu | pass for the items pressed: real `ArrowDown` ×12, `End`, `ArrowUp` ×11 of 40 items. The highlighted item is whole after every press. The menu was opened by a `contextmenu` event from a script; the tool has no right click |
| MV6, heading tracker | pass. `#/markdown`: a real click on the prose, real `PageDown` ×2 (the pane is at 986), a real click on "Ordered list" in the minimap: the pane is at 361 with the heading 0.2 px from the pane's top, and the minimap highlights it |
| MV8, a hidden section keeps its offset | pass. Real `PageDown` ×2 in the left column of `#/misc` (864), another section chosen, back: 864 |
| MV7, the list of `#/split` at 420 px | pass, as before this plan. Real `ArrowDown`, `End`, `Home`, `PageDown`, `PageDown`, `PageUp`: `One`, `Thirteen` (82, flush with the bottom edge), `One` (0), `Ten` (16), `Thirteen` (82), `Four` (66, flush with the top edge) |
| MV9 | not run |

The console showed no library error or warning during the run. The only errors came from the probe's own key logger after a rig had been closed.

### Candidates for a follow-up plan

- **Nested scroll panels: the outer one scrolls before the inner one.** It is the plan's first Non-Goal and stays one. Measured on this branch, with the fix in place: an outer `autoScroll: "y"` panel (viewport 339 px, largest offset 1191) holds an inner one, 250 px high, 600 px down; the target is 1500 px down the inner one. One `FocusReveal.reveal(target)` scrolls the outer panel to 1191, its end, chasing where the target was drawn before the inner panel moved, and then the inner one to 1282. The target is inside the inner viewport, but that viewport is now above the outer one: the target ends 342 px above what the user can see. A second call puts it right (outer 819, target flush with the top edge). The cause is the order of the calls, not their geometry: `FocusReveal.reveal` runs revealers outermost first, which a `Tab` or an `Accordion` needs and two scrollers do not. The plan's footnote says how a fix can tell the two kinds apart, with `FocusRevealer.getScrollViewportElement?()` from `feature/spatial-navigation-redesign`.
- **A time column whose value has no cell opens at the top.** `09:33` highlights no minute cell. Revealing the nearest cell would be new behaviour.
- **`Tree` has no `PageUp` / `PageDown`.** The key does nothing there, so the plan's page-size change reaches `Table` and `TreeTable` only, as its table says.
- **`TimeColumns`' comments still say the grid is shared with `DateTimePickerDropdown`.** That dropdown embeds a `TimeField` now, and `TimePickerDropdown` is the grid's only host. Left as found.
- What the plan lists under `## Non-Goals` and `## Potential Challenges` is otherwise as it says: a reveal into a pane `Split` or `Border` has just expanded was not measured, and `SpatialNavigation` on its branch still reads the scrolling element's outer rectangle.

### Merging with `feature/spatial-navigation-redesign`

`git merge-tree` of this branch and that one (`2851125b0`) reports three conflicts.

| File | Conflict | Resolution |
|---|---|---|
| `core/Panel.ts` | new with this plan. Both sides insert between `getRevealElement()` and `revealDescendant`: that branch its `getScrollViewportElement()`, this one the reveal block, and this one also rewrites the JSDoc of `revealDescendant` that sits between them | keep `getRevealElement()`, then that branch's `getScrollViewportElement()` with its JSDoc, then this plan's block from the JSDoc of `getScrollViewportRect()` to the end of `revealDescendant`. Drop the old JSDoc of `revealDescendant` that the other side still carries |
| `docs/reference/changelog/next.md`, `Added` → `Core` | the one `feature/modal-dialog-focus-trap` already has with that branch: both append after the `Aria` description entry. This plan's `Panel` entry now sits in the same block | keep both blocks |
| `docs/concepts/accessibility.md`, "The service stands down while a transient overlay" | from `feature/modal-dialog-focus-trap`; no line of this plan | as that plan's notes say: take that branch's sentence and replace "a dialog's focus trap" with "a modal layer's focus containment" |

Everything else of this plan merges cleanly: the sentence appended to the accessibility page, the changelog's other entries, `Body.ts` (that branch adds an import at the end of the import list and this one beside the `VirtualRowView` import), and the files that branch does not touch. No name is shared: that branch's `getScrollViewportElement()` names the element that scrolls, for an ancestor walk, and measures nothing; `getScrollViewportRect()` measures the visible window, inside the border and clear of the scrollbars, and `revealSpan()` scrolls to it.

The resolution was tried on a copy of the merged tree outside the repository: with the three files resolved as above, the library and its tests type-check, and 231 test files near the change pass (3,837 tests), that branch's own among them. The whole suite was not run on the copy, and it was not opened in a browser.
