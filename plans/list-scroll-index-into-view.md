---
depends-on: [table-tree-keyboard-context-menu]
touches-shared:
  - packages/lib/docs/components/List.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
  - packages/lib/src/typescript/lib/component/input/PickerColumn.ts
  - plans/dom-only-state-inventory.md
---

# List Scrolls Its Focused Row Into View — Implementation Plan

## Overview

A [`List`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L796) or `MultiSelectList` does not scroll when the keyboard moves its focused row out of sight. The arrow keys, `Home` / `End`, `PageUp` / `PageDown`, type-ahead, `setFocusedIndex` and the keyboard context menu all end in one method, [`scrollIndexIntoView`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2319), and that method scrolls the wrong element.

The list's rows sit in an inner [`Panel`](../packages/lib/src/typescript/lib/core/Panel.ts#L192) with `autoScroll: "y"`. A scrolling `Panel` draws its scrollbar in one of two styles. With `scrollbarStyle: "overlay"`, [the default](../packages/lib/src/typescript/lib/core/Panel.ts#L111), the panel's own element never scrolls: a second element inside it does. `scrollIndexIntoView` reads and writes `scrollTop` on the panel's own element, so under the default style nothing moves.[^measured]

| Scrollbar style | What `End` does today on a 30-row list |
|---|---|
| `"overlay"` (default) | nothing scrolls; the focused row stays out of view |
| `"native"` | the list scrolls correctly, but the write bypasses `Panel.setScrollTop`, so the panel's remembered offset stays `0` |

A `Panel` remembers its scroll offset: `getScrollTop()` returns the value last written through `setScrollTop()`, without touching the DOM. A write that goes around `setScrollTop()` leaves the remembered offset wrong.

[`PickerColumn.scrollSelectedIntoView`](../packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L351) makes the same mistake: the year list of a `DateField` opens at its first year instead of the current one. `ComboBox` forwards its keys to an embedded `List`, so its dropdown has the list's defect too.

This plan changes those two methods, in two files, to scroll through the panel's own scroll API. No `Panel` code changes and no public API changes. It also removes the three doc statements that record the list's behaviour as a known limitation of the keyboard context menu. A survey of every other place in the library that reads or writes a scroll offset is in [the addendum](#addendum-survey-of-scroll-call-sites); what it found beyond these two methods is listed under `## Non-Goals`.

---

## Architecture Decisions

### The list scrolls through its panel's scroll API — it holds no element

`scrollIndexIntoView` stops touching an element. It asks the inner panel for two things and writes one, all through methods `Panel` already has:

| Needed | Today | After |
|---|---|---|
| height of the visible window | `clientHeight` of the panel's own element | `panel.getInnerSize().height` |
| current scroll offset | `scrollTop` of the panel's own element | `panel.syncScrollOffsets()`, then `panel.getScrollTop()` |
| the write | `DOM.sink.apply(panelEl, { scrollTop })` | `panel.setScrollTop(value)` |

[`setScrollTop`](../packages/lib/src/typescript/lib/core/Component.ts#L5000) and [`syncScrollOffsets`](../packages/lib/src/typescript/lib/core/Component.ts#L5060) resolve the element that really scrolls through [`Panel.getScrollElement`](../packages/lib/src/typescript/lib/core/Panel.ts#L627), so the same code is right under both scrollbar styles.

The row arithmetic stays in the list. This mirrors how `Tree` and the `Table` body reveal their current row: [`VirtualRowView.scrollRowIntoView`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1121) computes `index * rowHeight` itself, reads the offset from its scroller and writes through its scroller. `Tree._revealFocusRow` and `Body.revealFocusedCell` both call it.[^no-panel-api]

### The viewport height is the panel's inner size

The *viewport* is the visible window onto the scrolled rows. [`Panel.getInnerSize`](../packages/lib/src/typescript/lib/core/Panel.ts#L682) returns the panel's size minus its border, its insets, its padding and the band a visible scrollbar occupies. The list's panel and the picker's panel are both built with no border, no padding and zero insets ([list](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L900), [picker](../packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L93)), so for them the inner size is exactly the viewport.[^inner-size]

| List panel, 249 px high | `getInnerSize().height` | Scrolling element's `clientHeight` |
|---|---|---|
| overlay, no horizontal bar | 249 | 249 |
| overlay, horizontal bar shown | 237 | 237 |
| native, horizontal bar shown | 234 | 234 |

The value is cached component state, so reading it touches no DOM. No scrollbar thickness is written into the list.

### The reveal is vertical only and moves the least distance

`scrollIndexIntoView` writes `scrollTop` and nothing else, so a list with `horizontalScrolling` keeps its horizontal position on a row move.

A row at index `i` covers `top = i * 22` to `bottom = top + 22` in the content (22 is `ROW_HEIGHT_PX`). With scroll offset `s` and viewport height `H`:

- `top < s` → scroll to `top` (the row lands on the top edge);
- otherwise `bottom > s + H` → scroll to `bottom - H` (the row lands on the bottom edge);
- otherwise write nothing.

For 30 rows and `H = 110` (five rows):

| Offset before | Row | Row spans | Offset after | Why |
|---|---|---|---|---|
| 0 | 4 | 88–110 | 0 | ends exactly on the bottom edge: visible |
| 0 | 5 | 110–132 | 22 | below: bottom edge |
| 0 | 29 | 638–660 | 550 | below: bottom edge |
| 300 | 14 | 308–330 | 300 | inside 300–410: visible |
| 300 | 13 | 286–308 | 286 | cut by the top edge: top edge |
| 300 | 18 | 396–418 | 308 | cut by the bottom edge: bottom edge |
| 300 | 12 | 264–286 | 264 | above: top edge |

The method already has this rule; only where `s` and `H` come from changes.

### The scroll offset is read fresh before every reveal

`Panel.getScrollTop()` returns the remembered offset. The remembered offset is updated by the wheel and by a drag of an overlay scrollbar, but not by a scroll the browser performs on its own, such as a touch pan or a drag of a native scrollbar. `scrollIndexIntoView` therefore calls `panel.syncScrollOffsets()` first, which re-reads the offset from the scrolling element.[^resync]

| Remembered offset | Real offset | Row 12 (264–286), `H = 110` | Without the re-read | With it |
|---|---|---|---|---|
| 0 | 300 | above the view | "below 0–110" → writes 176 | writes 264 |

The precedent is [`ScrollStrip.mainScroll`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L860), which re-syncs its clip before every read of the offset.

### A hidden list does not reveal

When the inner panel is not effectively visible — the list or an ancestor is hidden or undisplayed, for example on an inactive tab — `scrollIndexIntoView` returns before reading or writing anything.[^hidden] The focus index still changes; only the scroll is skipped. The precedent is [`Panel.remeasureScrollMetrics`](../packages/lib/src/typescript/lib/core/Panel.ts#L1055), which withholds its own scroll reads behind the same `isEffectivelyVisible()` check.

### Which calls reveal does not change

`scrollIndexIntoView` keeps its three call sites. No call site is added or removed.[^callers]

| Trigger | Path | Reveals |
|---|---|---|
| `ArrowUp` / `ArrowDown`, `Home` / `End`, `PageUp` / `PageDown` — on the list, or forwarded by a host through `handleKey` | [`moveFocus`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2238) | yes |
| type-ahead; a host's `setFocusedIndex(i)` | [`setFocusedIndex`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1989) | yes |
| `Shift+F10` / ContextMenu key | [`revealFocusedRow`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1875) | yes |
| `setSelectedIndex`, `setValue`, `setValues`, a row click | — | no, as today |

### `PickerColumn` gets the same routing and keeps centring

`scrollSelectedIntoView` keeps its rule — put the selected cell in the middle of the viewport, clamped to the scrollable range — and changes only its sources: viewport height from `this._cellList.getInnerSize()`, the range's end from [`this._cellList.getMaxScrollTop()`](../packages/lib/src/typescript/lib/core/Component.ts#L5203), the write through `this._cellList.setScrollTop()`.[^picker]

For 40 cells of 22 px in a 154 px viewport (content 880, largest offset 726), the target is `cellTop - (154 - 22) / 2`, clamped to 0–726:

| Selected cell | `cellTop` | Unclamped | Offset written |
|---|---|---|---|
| index 30 | 660 | 594 | 594 |
| index 0 | 0 | −66 | 0 |
| index 39 | 858 | 792 | 726 |

### Nothing is built on `feature/spatial-navigation-redesign`

That unmerged branch adds `Panel.getScrollViewportElement()` and an optional `FocusRevealer.getScrollViewportElement()`. This plan does not use them, adds no method to `Panel` or `FocusRevealer`, and edits neither `Panel.ts` nor `FocusReveal.ts`. The two branches can merge in either order.[^spatial]

---

## Internal Structure

### `AbstractSelectableList.scrollIndexIntoView`

The whole method after the change. The index guard at the top is unchanged.

```typescript
protected scrollIndexIntoView(idx: number): void {
    if (idx < 0 || idx >= this._items.length) {
        return;
    }

    const panel    = this._innerPanel;
    const viewport = panel.getInnerSize();
    const visible  = panel.isEffectivelyVisible();

    if (!viewport || !visible) {
        return;
    }

    // The browser also scrolls the panel on its own — a touch pan, a drag of
    // a native scrollbar — and the panel's remembered offset does not hear
    // of it. Re-read it, or the comparison below is against a stale value.
    panel.syncScrollOffsets();

    const top       = idx * ROW_HEIGHT_PX;
    const bottom    = top + ROW_HEIGHT_PX;
    const scrollTop = panel.getScrollTop();

    if (top < scrollTop) {
        panel.setScrollTop(top);
    } else if (bottom > scrollTop + viewport.height) {
        panel.setScrollTop(bottom - viewport.height);
    }
}
```

`getInnerSize()` returns `null` before the panel is rendered, which replaces the old `if (!panelEl)` guard. The `isEffectivelyVisible()` result is assigned to a constant before the `if`, per the project rule against a call inside a condition.

### `PickerColumn.scrollSelectedIntoView`

Only the first guard and the last block change. The loop that finds the selected cell and the two `return this` guards after it stay as they are.

```typescript
scrollSelectedIntoView(): this {
    const viewport = this._cellList.getInnerSize();

    if (!viewport) {
        return this;
    }

    // … unchanged: find `target`, resolve `cellEl`, return early when either is missing …

    // `offsetTop` is the cell's top edge relative to its offsetParent — the
    // element the list scrolls. Centring = top minus half the viewport plus
    // half the cell.
    const cellBox    = DOM.source.getOffsetSize(cellEl);
    const desiredTop = cellBox.offsetTop - (viewport.height - cellBox.offsetHeight) / 2;
    const maxTop     = this._cellList.getMaxScrollTop();

    this._cellList.setScrollTop(Util.clamp(desiredTop, 0, maxTop));

    return this;
}
```

---

## Ordered Implementation Steps

Work test-first: steps 1 and 2 write the tests and watch them fail, steps 3 and 4 make them pass.

1. **List tests.** Create `packages/lib/tests/component/list/AbstractSelectableList.scrollIndexIntoView.test.ts` with the fixture and cases G0, R1–R9, K1–K12 and C1 of `## Expected Behaviour`, using the harness described under `## Verification`. Run `cd packages/lib && npx vitest run tests/component/list/AbstractSelectableList.scrollIndexIntoView.test.ts`. Check: G0, R1, R2 and K11 pass; every other case fails under both styles. (Under `"native"` today's code moves the right element, and the cases fail on the panel's remembered offset.)

2. **Picker tests.** Create `packages/lib/tests/component/input/PickerColumn.scrollSelectedIntoView.test.ts` with cases P1–P7. Run it. Check: P6 and P7 pass; P1–P5 fail under `"overlay"`; under `"native"` P1, P3 and P5 fail. (P2 and P4 pass there by coincidence: today's code writes 0 to the right element, and the remembered offset was 0 already.)

3. **`AbstractSelectableList.ts`.**
   - Replace the body of [`scrollIndexIntoView`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2319) with the body in `## Internal Structure`.
   - Replace its JSDoc (lines 2309–2318) with: "Scrolls the inner panel vertically, by the least distance, so the row at `idx` is fully visible; writes nothing when it already is. The horizontal offset is never touched. Reads the viewport height from the panel's inner size and the offset through the panel's scroll API, so the same code serves both scrollbar styles. Does nothing while the panel is unrendered or not effectively visible." Keep the `@param` line.
   - In the JSDoc of [`revealFocusedRow`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1865), replace "after asking for it to be scrolled into view the way a keyboard move does (see {@link scrollIndexIntoView}). Where that leaves the row out of view, the menu point is clamped to the list's own box." with "after scrolling it into view the way a keyboard move does (see {@link scrollIndexIntoView})."
   - In the JSDoc of `on()` ([lines 1549–1551](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1549)), replace "sit under that row, or on the list's nearest edge when the row is scrolled out of view; the synthetic event's `target` is `null`." with "sit under that row, which is scrolled into view first; the synthetic event's `target` is `null`."
   - Leave the `DOM` import: the file still uses it elsewhere.

   Check: `npx vitest run tests/component/list/AbstractSelectableList.scrollIndexIntoView.test.ts` — every case passes.

4. **`PickerColumn.ts`.**
   - Change [`scrollSelectedIntoView`](../packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L351) as shown in `## Internal Structure`: the first guard, and the block from the `offsetTop` comment to the write.
   - Replace its JSDoc (lines 341–350) with: "Scrolls the cell list so the first selected cell lands in the middle of the viewport, clamped to the scrollable range. Reads the viewport height from the cell list's inner size and writes through the cell list's scroll API, so the same code serves both scrollbar styles." Keep the `@returns` line.
   - Leave the `DOM` and `Util` imports: both are still used.

   Check: `npx vitest run tests/component/input/PickerColumn.scrollSelectedIntoView.test.ts` — every case passes.

5. **Grep checks.**
   - `grep -n "getScrollMetrics\|scrollTop:" packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts packages/lib/src/typescript/lib/component/input/PickerColumn.ts` — no output.
   - `git diff --stat` lists no file under `packages/lib/src/typescript/lib/core/`.

6. **Existing tests.** `cd packages/lib && npx vitest run tests/component/list tests/component/shared tests/component/input tests/core/PanelScrollChaining.test.ts tests/core/PanelOverlayScrollbar.test.ts tests/core/ComponentSubtreeScroll.test.ts tests/component/dispose-listener-teardown.test.ts tests/component/dispose-full-teardown.test.ts tests/component/element-release.test.ts`. Check: all pass with no edit to an existing test.

7. **Docs and changelog.** Make the edits listed in `## Documentation Impact`. Check: `grep -rn "nearest edge" packages/lib/src packages/lib/docs/components packages/lib/docs/concepts packages/lib/docs/reference` — no output.

8. **Catalogue rows.** In [`plans/dom-only-state-inventory.md`](dom-only-state-inventory.md), append one sentence to the last cell of three table rows:
   - the `Component` row for `setScrollLeft` / `setScrollTop` (line 83): "Both call sites now write through `setScrollTop()` (`list-scroll-index-into-view`)."
   - the `PickerColumn` row (line 103) and the `AbstractSelectableList` row for `scrollIndexIntoView` (line 131): "Fixed by `list-scroll-index-into-view`: the write goes through `setScrollTop()`, so the mirror is current."

9. **Full verification.** Run the commands and the manual cases in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/list/AbstractSelectableList.scrollIndexIntoView.test.ts` |
| Create | `packages/lib/tests/component/input/PickerColumn.scrollSelectedIntoView.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/PickerColumn.ts` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/dom-only-state-inventory.md` |

---

## Expected Behaviour

Every numbered case below is testable offline unless it is in the *Needs manual verification* table. The offline DOM is the modelled one (`installTestDOM`); how it is given scroll geometry is described first.

### How offline tests get scroll geometry

| Input | Where it comes from offline |
|---|---|
| viewport height | the size the test commits: `list.setWidth(200)`, `list.setHeight(110)`, `list.doLayout()`. `getInnerSize()` is cached state, so nothing is injected. The modelled DOM does not model the list's 1 px border, so the inner panel is 110 high. |
| scroll offset | the recording sink stores each `scrollTop` / `scrollLeft` write on the element's stub and `DOM.source.getScrollTop(handle)` reads it back. It is **not clamped**, unlike a browser. |
| a scroll the browser made on its own | `DOM.sink.apply(scroller(list), { scrollTop: 300 })` — a write straight on the scrolling element, which goes around `Panel.setScrollTop`. `scroller` is defined below. |
| content extent (`scrollHeight` / `scrollWidth`) | [`setScrollExtent(handle, extent)`](../packages/lib/tests/dom/TestDOM.ts#L2085). Without it the extent equals the client box, so nothing overflows. |
| a visible scrollbar's band | seed `setScrollExtent` on the scrolling element **before** the first sized layout; the panel's layout pass then reserves the band and `getInnerSize()` shrinks by it. Seeding after the first layout had no effect when tried: a layout pass that commits nothing new does not re-measure. |

Helpers the new test files define (each is one line):

- `innerPanel(list)` → `(list as any)._innerPanel`, as [`horizontalScrolling.test.ts:41`](../packages/lib/tests/component/list/horizontalScrolling.test.ts#L41) does.
- `scroller(list)` → `innerPanel(list).getScrollElement()`, the element that really scrolls.
- `nativeScroll(list, patch)` → `DOM.sink.apply(scroller(list), patch)`.
- `scrollWrites()` → the number of recorded `apply` writes whose patch carries `scrollTop` or `scrollLeft`.

### List fixture

A `List` of 30 items: `Row 0` … `Row 28`, and `Zulu` as the last. Mounted 200 × 110, focused. Content height 660, viewport 110, largest offset 550. Each case runs twice, once per scrollbar style, set with `innerPanel(list).setScrollbarStyle(style)` before the first `getElement(true)`. K11 mounts nothing and runs once.

"Offset" below means both `DOM.source.getScrollTop(scroller(list))` and `innerPanel(list).getScrollTop()`: assert the two are equal to the stated number. Under `"overlay"` additionally assert `DOM.source.getScrollTop(innerPanel(list).getElement())` is `0`: the panel's own element is never written.

| # | Given | Then |
|---|---|---|
| G0 | the mounted fixture | `innerPanel(list).getInnerSize().height` is 110; `scroller(list) === innerPanel(list).getElement()` is `true` under `"native"` and `false` under `"overlay"` |

### The nearest-edge rule (offline)

Each row: `nativeScroll(list, { scrollTop: <before> })`, then `list.setFocusedIndex(<row>)`.

| # | Offset before | Row | Offset after | Scroll writes made by the call |
|---|---|---|---|---|
| R1 | 0 | 2 | 0 | 0 |
| R2 | 0 | 4 | 0 | 0 |
| R3 | 0 | 5 | 22 | 1 |
| R4 | 0 | 29 | 550 | 1 |
| R5 | 550 | 24 | 528 | 1 |
| R6 | 300 | 14 | 300 | 0 |
| R7 | 300 | 13 | 286 | 1 |
| R8 | 300 | 18 | 308 | 1 |
| R9 | 300 | 12 | 264 | 1 |

R6–R9 start from an offset the panel never heard of, so they also pin the fresh read.

### Triggers (offline)

Keys are real `keydown` events dispatched at the list's element.

| # | Given | Then |
|---|---|---|
| K1 | `End` | focused index 29; offset 550 |
| K2 | K1, then `Home` | focused index 0; offset 0 |
| K3 | `ArrowDown` ×6 (the first lands on row 0), then `ArrowUp` | after the six: focused index 5, offset 22; after `ArrowUp`: offset still 22 |
| K4 | `ArrowDown`, `PageDown`, `PageDown`, `PageUp` | focused index 0 → 5 → 10 → 5; offset 0 → 22 → 132 → 110 |
| K5 | the key `z` | focused index 29; `getSelectedIndex()` is `-1`; offset 550 |
| K6 | a `MultiSelectList` of the same items: `ArrowDown`, then `ArrowDown` with `shiftKey` ×6 | focused index 6; offset 44 |
| K7 | a list with `horizontalScrolling: true`; `nativeScroll(list, { scrollLeft: 100 })`; `End` | `scrollLeft` of the scrolling element is 100 and `innerPanel(list).getScrollLeft()` is 100; offset 550 |
| K8 | a list with `horizontalScrolling: true` whose scrolling element was seeded `setScrollExtent(…, { width: 440, height: 660 })` before the first sized layout; `End` | `innerPanel(list).getInnerSize().height` is less than 110; offset is `660 −` that height |
| K9 | `End`; `list.setDisplayed(false)`; `list.setFocusedIndex(0)` | focused index 0; the call made 0 scroll writes; `innerPanel(list).getScrollTop()` is still 550 |
| K10 | `End`; `list.setFocusedIndex(-1)`; `list.setFocusedIndex(30)` | 0 scroll writes; offset 550 |
| K11 | a list that was never rendered: `list.setFocusedIndex(20)` | does not throw; `getFocusedIndex()` is 20; `innerPanel(list).getScrollTop()` is 0; 0 scroll writes in total |
| K12 | `list.handleKey(…)` with an `End` key object built like `key()` in [`List.test.ts:40`](../packages/lib/tests/component/list/List.test.ts#L40) — the entry point `ComboBox` forwards its keys to | returns `true`; offset 550 |

K8 reads the viewport height from the panel instead of hardcoding a scrollbar thickness, which differs between the two styles.

### Keyboard context menu (offline)

| # | Given | Then |
|---|---|---|
| C1 | a `"contextmenu"` listener; `End`; `nativeScroll(list, { scrollTop: 0 })`; `keydown` `F10` with `shiftKey`; a `contextmenu` event dispatched at the list's element | the listener runs once with index 29; offset 550; `event.clientY` equals `DOM.source.getViewportRect(row29).bottom`; that rectangle lies inside `DOM.source.getViewportRect(list)` (top and bottom) |

`row29` is `(list as any)._rowPool[29]`. C1 is the list's counterpart of `T3` in [`KeyboardContextMenu.test.ts:262`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L262).

### `PickerColumn` (offline)

A `PickerColumn(null)` with 40 `PickerCell`s labelled `1990` … `2029`, mounted 100 × 154. The cell list's scrolling element is seeded `setScrollExtent(…, { width: 100, height: 880 })` before the first sized layout. Each case runs once per scrollbar style, set with `column.getCellList().setScrollbarStyle(style)` before the first `getElement(true)`. Before each call the offset is moved to 300 with a direct write on the scrolling element, so a case that writes nothing cannot pass by accident.

"Offset" means both the scrolling element's `scrollTop` and `column.getCellList().getScrollTop()`. Under `"overlay"` the cell list's own element stays at `0`.

| # | `setSelectedValue(…)` | Offset after `scrollSelectedIntoView()` |
|---|---|---|
| P1 | `'2020'` (cell top 660) | 594 |
| P2 | `'1990'` (cell top 0) | 0 |
| P3 | `'2029'` (cell top 858) | 726 |
| P4 | `'1993'` (cell top 66) | 0 |
| P5 | `'1994'` (cell top 88) | 22 |
| P6 | `null` | the scrolling element's `scrollTop` is still 300; the call made 0 scroll writes |
| P7 | a column that was never rendered, one cell selected | does not throw; 0 scroll writes |

### Unchanged (offline)

Every existing test file passes without an edit. Step 6 names the ones nearest the change.

### Needs manual verification

Real key presses on the demo app (`npm run dev`), in a browser window about 420 px high so the 13-row list on `#/split` shows nine rows. Run every case in Chromium. Repeat MV1, MV5 and MV6 in Firefox and in WebKit; the planner ran neither.[^engines]

| # | Where | Do | Expect |
|---|---|---|---|
| MV1 | `#/split`, the list | click `One`, `End`, then `Home` | `Thirteen` is the last visible row, flush with the list's bottom edge, and the scrollbar thumb is at the bottom; `Home` brings `One` back to the top |
| MV2 | same | click `One`, `ArrowDown` ×12, `ArrowUp` ×12 | the list does not move until the focused row would leave the view, then moves one row per press; the focused row is fully visible after every press |
| MV3 | same | click `One`, `PageDown`, `PageDown`, `PageUp` | the focused row is fully visible after every press |
| MV4 | same | click `One`, type `el` | `Eleven` is focused and visible; the selection is still `One` |
| MV5 | same | `End`, drag the scrollbar thumb to the top, Shift+F10 | the list scrolls back so `Thirteen` is visible; the menu opens at that row (above it when there is no room below) with `Open` highlighted |
| MV6 | `#/baseline`, the `DateField` | open the calendar, click the month-and-year label, then `ArrowDown` ×5 | the year list opens with the current year in the middle; the highlighted year stays in the middle after each press |
| MV7 | `#/split`, the list | `End`, turn the wheel up, and press `ArrowUp` while the list is still moving | the list settles with `Twelve` as its last visible row and does not drift afterwards |
| MV8 | optional, SQLAdmin against `npm run build:lib` | in the saved-queries list, scroll right, then `ArrowDown` past the last visible row; in any combo box with more than nine options, `ArrowDown` past the ninth | the list follows the focused row and its horizontal position does not move; the combo's dropdown follows the highlighted option |

---

## Verification

Harness for the two new test files:

- Node environment. `beforeEach`: `installTestDOM(CONFIG)` with the `CONFIG` object every neighbouring test file uses, and capture `requestAnimationFrame` registrations into an array, as [`PanelOverlayScrollbar.test.ts:40`](../packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L40) does. A scrolling panel schedules a follow-up layout frame, and an undrained one swallows the next test's registration.
- `afterEach`: drain the captured frames, `vi.restoreAllMocks()`, dispose every component the test built, `Menu._stopInputWatch()`, `Tooltip._stopPointerWatch()`, then `DOM.reset()` — the teardown of [`KeyboardContextMenu.test.ts:163`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L163) plus the frame drain. A `List` starts `Menu`'s input watch when it is constructed.
- Mounting, in this order: `setScrollbarStyle(style)` on the inner panel, `getElement(true)`, `setConnected(el, true)`, the optional `setScrollExtent` seed, `setWidth` / `setHeight`, `doLayout()`, drain the frames, `DOM.sink.focus(el)`.
- Keys: `DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key }))`, as [`KeyboardContextMenu.test.ts:102`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L102) does.
- Import `PickerCell`, `PickerColumn` and `PICKER_CELL_HEIGHT` by module path (`~/component/input/PickerColumn`); they are not barrel-exported.

The cases were run as a throwaway prototype against a temporary copy of the change before this plan was written. All pass with it; without it only the cases named in the checks of steps 1 and 2 pass.[^prototype]

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. The two commands of steps 1–2 and the command of step 6.
4. `npm test` — the whole suite.
5. `npm run lint`
6. `npm run docs:api`, `npm run docs:llms:check`
7. The MV cases, on `npm run dev`.

Grep checks: the two greps and the `git diff --stat` of steps 5 and 7.

---

## Documentation Impact

No public API changes: `scrollIndexIntoView` is `protected` and keeps its signature, `PickerColumn` is not barrel-exported, and nothing is added to `Panel`. No barrel, catalogue or `llms.txt` entry changes.

**The three statements that record the limitation, all removed:**

1. [`docs/components/List.md:106`](../packages/lib/docs/components/List.md#L106) — delete the whole "**Known limitation:** …" paragraph (lines 106–108) and the blank line after it.
2. [`docs/concepts/accessibility.md:227`](../packages/lib/docs/concepts/accessibility.md#L227) — in the `List` / `MultiSelectList` row of the "Context menus from the keyboard" table, replace the third cell with `under that row, scrolled into view first`, the wording of the `Tree` row above it.
3. [`docs/reference/changelog/next.md:297`](../packages/lib/docs/reference/changelog/next.md#L297) — in the entry "**Shift+F10 opens the context menu of the current tree row, list row or table cell.**", replace the two sentences from "A `Tree`, a `Table` and a `TreeTable` scroll that item into view first." through "…when that row is out of view." (lines 297–301) with the one sentence "Each scrolls that item into view first." Re-wrap the paragraph.

**Other page edits:**

- **[`docs/components/List.md`](../packages/lib/docs/components/List.md)**
  - `## Context menu` table ([line 95](../packages/lib/docs/components/List.md#L95)): change the second cell of the `Shift+F10` row from "the focused row" to "the focused row, scrolled into view first", as [`Tree.md`](../packages/lib/docs/components/Tree.md#L163) words it.
  - `## Keyboard`: add one paragraph after the paragraph that ends "no `change` event fires." ([line 53](../packages/lib/docs/components/List.md#L53)): "A keyboard move, type-ahead and `setFocusedIndex` scroll the focused row into view. The list moves the least distance that shows the whole row, and never sideways, so a list with [horizontal scrolling](#horizontal-scrolling) keeps its horizontal position. `setSelectedIndex` and `setValue` do not scroll."
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)** — `## Fixed` → `### Components`, a new entry after the Shift+F10 entry: **A `List` scrolls its focused row into view.** Say what was wrong: with the default overlay scrollbars, moving the focused row with the arrow keys, `Home` / `End`, `PageUp` / `PageDown`, type-ahead or `setFocusedIndex` did not scroll the list, so the row could sit out of view. Say that `List` and `MultiSelectList` now scroll the least distance that shows the row, vertically only; that the dropdown of a `ComboBox` follows its highlighted option for the same reason; and that the year list of a `DateField` / `DateTimeField` calendar opens on the current year again. End with "No consumer action is needed."

**JSDoc:** the four comment edits of steps 3 and 4. `on()` is public: its new sentence names no protected or `@internal` symbol.

---

## Potential Challenges

- **The modelled DOM does not clamp scroll offsets.** A wrong target shows up offline as a wrong number, not as a clamped one; assert the exact numbers in the tables and never read an expectation back from the code.
- **`syncScrollOffsets()` stops a wheel scroll that is still easing.** The library eases a wheel scroll over a few frames, and both `syncScrollOffsets()` and `setScrollTop()` cancel what is left of it. That is wanted here: a leftover ease would pull the revealed row out of view again. MV7 checks the combination.
- **A reveal asked for in the same task as a content change runs before the new rows are laid out.** The viewport height and the scrollable range are then still the old ones, exactly as with today's code. Do not add a forced layout or a deferred reveal for this; it is listed under `## Non-Goals`.
- **A seeded scroll extent has no effect after the first layout.** K8 and the picker fixture seed before `setWidth` / `setHeight`, in the order `## Verification` gives.
- **`docs/concepts/accessibility.md` and `changelog/next.md` are edited by other unmerged work.** `feature/spatial-navigation-redesign` rewrites the "Tab traversal" and "Spatial focus navigation" sections of the accessibility page and adds changelog entries under `Changed` and `Added`; the pending plan `modal-dialog-focus-trap` edits the same two sections and the changelog. This plan edits one table row in "Context menus from the keyboard" and the `Fixed` → `Components` subsection. Keep both sides in a merge; re-read the two files first if either lands before this is implemented.
- **`directional-panel-navigation`, a pending plan, lists `AbstractSelectableList.ts`.** It concerns the first line of `handleNavigationKey`, 170 lines above `scrollIndexIntoView`; the hunks do not meet.

---

## Critical Files

Every line number in this plan is that of the dependency's branch tip, `feature/table-tree-keyboard-context-menu` at `773854a24`.

- [`component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2319) — `scrollIndexIntoView` (:2319), its callers `revealFocusedRow` (:1875), `setFocusedIndex` (:1989) and `moveFocus` (:2238), the inner panel (:900), `ROW_HEIGHT_PX` (:83), `on()`'s JSDoc (:1549).
- [`component/input/PickerColumn.ts`](../packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L351) — `scrollSelectedIntoView` (:351), `PickerCellList` (:87).
- [`core/Panel.ts`](../packages/lib/src/typescript/lib/core/Panel.ts#L627) — read only: `getScrollElement` (:627), `getInnerSize` (:682), the hidden-panel guard in `remeasureScrollMetrics` (:1055), the default `scrollbarStyle` (:111).
- [`core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L5000) — read only: `getScrollTop` (:4963), `setScrollTop` (:5000), `syncScrollOffsets` (:5060), `getMaxScrollTop` (:5203), `isEffectivelyVisible` (:2578).
- [`component/shared/VirtualRowView.ts`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1121) — `scrollRowIntoView`, the precedent for "row arithmetic in the view, offset and write through the scroller".
- [`component/container/ScrollStrip.ts`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L860) — `mainScroll`, the precedent for re-syncing the offset before a read.
- [`tests/component/shared/KeyboardContextMenu.test.ts`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L359), [`tests/core/PanelOverlayScrollbar.test.ts`](../packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L40), [`tests/dom/TestDOM.ts`](../packages/lib/tests/dom/TestDOM.ts#L2085) — the test recipes: mounting and teardown, frame capture, `setScrollExtent`.
- [`plans/implemented/table-tree-keyboard-context-menu.md`](implemented/table-tree-keyboard-context-menu.md) — the dependency; its "Found, and left as it is" note is the report this plan answers.

---

## Non-Goals

- **Changing `Panel.revealDescendant`.** The survey found two defects in it (a stale remembered offset; under `"native"` it counts the border and the scrollbars as viewport). Neither is on the list's path after this plan, and both affect `Menu`, `FocusHistory` and spatial navigation, which need their own cases.
- **`Tree` and `Table` rows clipped by a border or a horizontal scrollbar.** `VirtualRowView.scrollRowIntoView` and `Body.scrollColumnIntoView` take the component's outer size for the viewport. Different code, different tests.
- **`HeadingScrollTracker.scrollToHeading`'s use of the remembered offset.**
- **The page size of `PageUp` / `PageDown`.** It is computed from the list's outer height and can be one row too long when a border or a horizontal bar takes room. The focused row is still revealed.
- **Scrolling on `setSelectedIndex`, `setValue` or `setValues`,** and opening a `ComboBox` dropdown on its selected option. Neither happens today; both would be new behaviour.
- **Scrolling an outer panel to show the list itself.** The reveal moves only the list's own panel, as `Tree` and `Table` move only their own scroller.
- **Applying a reveal later** when it was asked for while the list was hidden, or before a layout pass had laid out rows just added.
- **Any change to `Panel.ts`, `FocusReveal.ts`, the demo app or SQLAdmin.**

---

## Addendum: Survey of scroll call sites

Every place in `packages/lib/src/typescript/lib` that reads or writes `scrollTop` / `scrollLeft`, or reveals something by scrolling. "Measured" means in Chromium on the demo app; "read" means from the code only. No library code calls the browser's own `Element.scrollIntoView`; the `scrollIntoView` names in `CodeEditor.ts` are CodeMirror options.

| Site | Verdict | Detail |
|---|---|---|
| `AbstractSelectableList.scrollIndexIntoView` (:2319) | **wrong — this plan** | Reads and writes the panel's own element. Reached by the arrow keys, `Home` / `End`, `PageUp` / `PageDown`, type-ahead, `setFocusedIndex`, the keyboard context menu, and through `handleKey` by the `ComboBox` dropdown. Measured. |
| `PickerColumn.scrollSelectedIntoView` (:351) | **wrong in the same way — this plan** | Same element, same direct write. Called when a calendar's year list opens and on each move of its highlight. Measured. |
| `AutoCompleteField` dropdown | same defect, not reachable by default | It embeds the same `List` and forwards its keys the same way, but shows at most ten rows by default and all fit, so nothing has to scroll (measured: content and viewport both 220 px). A host that raises `maxSuggestions` past what fits gets the list's fix. |
| `AbstractSelectableList.handleNavigationKey` page size (:2182) | wrong differently, harmless | `this.getHeight()` is the list's outer height: it includes the border and a horizontal bar's band, so a page can be one row too long. Read. |
| `Panel.revealDescendant` (:648) — used by `FocusReveal.reveal` and by `Menu` | right element; wrong differently, twice | (a) Adds its delta to the remembered offset without re-reading it. Measured: real offset 200, remembered 0, a row whose bottom is 57 px below the view → writes 57, the view jumps up and the row ends 200 px below it. (b) Takes the scrolling element's outer rectangle for the viewport. Under `"overlay"` that is exact. Under `"native"` it includes the panel's border and its native bars. Measured: a revealed row's bottom 15 px under the horizontal scrollbar. It also scrolls both axes, which is right for its purpose. |
| `Menu` (:511, :1640) | correct routing | `setScrollTop(getMaxScrollTop())` and `_itemPanel.revealDescendant(row)`. Inherits (a) above; its panel is always `"overlay"`, so (b) does not apply. |
| `ScrollStrip.revealItem` (:981), `mainScroll` (:860); `TabBar` (:2970) | correct | Measures the clip, which is the element that scrolls; main axis only; re-syncs the offset before reading it. |
| `VirtualRowView.scrollRowIntoView` (:1121) — `Tree`, `Table` body, `TreeBody` | wrong differently | Not native scrolling: a `VirtualScroller` moves the rows. The viewport is taken as `this.getHeight()`, the outer height, while the scroller's real viewport is the content box minus a visible horizontal bar. Measured on a `Tree` (script-dispatched keys): the revealed row's bottom is hidden by 4 px with a 2 px border, 12 px with a horizontal bar, 16 px with both. |
| `Body.scrollColumnIntoView` (:3245) | wrong differently | The horizontal twin: `this.getWidth()` where `VirtualScroller.getViewportWidth()` exists. Read. |
| `Tab` (:2333), `Accordion` (:1220), `Border` (:1633), `Split` (:1959) `revealDescendant` | correct | They reveal by selecting a tab or expanding a region; no scroll offset is involved. |
| `HeadingScrollTracker.scrollToHeading` (:116) — `MarkdownViewer` | right element; wrong differently | Adds its delta to the remembered offset, like `Panel.revealDescendant` (a). `trackScroll` and `findActiveHeading` read live values. Read. |
| `CodeEditor` | correct | Overrides `getScrollElement()` to CodeMirror's scroller and reveals through CodeMirror. |
| `Component` scroll plumbing — `setScrollTop` / `setScrollLeft`, the wheel scroller, capture and restore around `display: none` | correct | Everything resolves `getScrollElement()`. |
| `Table` `Header.setScrollX` (:1695) | correct | A transform that mirrors the body's scroller; no native offset. |

---

## Addendum: What was measured

Chromium, through chrome-devtools, on the demo dev server of branch `feature/table-tree-keyboard-context-menu` (`773854a24`). The `#/split` measurements used real key presses. Everything else was built and driven from a script in the page — `keydown` events dispatched at the focused element, or the method called directly — which reaches the same library code.

**The defect.** `#/split`, window 420 px high, list focused, `End`: the row `Thirteen` spans 475–497 and the viewport 211–415; the inner scrolling element has `scrollHeight` 286, `clientHeight` 204, `scrollTop` 0; the panel's own element has `scrollHeight` = `clientHeight` = 204.

**Every style and mode.** Six 30-row lists in one window, each 251 px high, differing only in the inner panel's `scrollbarStyle` and `autoScroll`. `"auto"` is what `horizontalScrolling` sets. `"native"` and `"both"` are not reachable through the list's API and were forced on the inner panel for the measurement. After `End`:

| Style | `autoScroll` | Scrolling element's `scrollTop` | Row 29 visible | Panel's remembered offset |
|---|---|---|---|---|
| overlay | `"y"` | 0 | no | 0 |
| overlay | `"auto"` | 0 | no | 0 |
| overlay | `"both"` | 0 | no | 0 |
| native | `"y"` | 411 | yes | 0 |
| native | `"auto"` | 426 | yes | 0 |
| native | `"both"` | 426 | yes | 0 |

`getInnerSize().height` equalled the scrolling element's `clientHeight` in all six: 249 / 237 / 249 (overlay) and 249 / 234 / 234 (native), in the table's row order.

**Hosts.** A `ComboBox` with 40 options: after 15 `ArrowDown` the highlighted option is 154 px below the dropdown's viewport and `scrollTop` is 0. A `DateField`'s year list: opens at `scrollTop` 0 with the current year 2,640 px down.

**With the change applied temporarily** (as a patched method in the page for the lists and the year list, as the real two-file edit for the `ComboBox`; all reverted afterwards).

- The six lists: `End` gives 411 / 423 / 411 (overlay) and 411 / 426 / 426 (native), the row flush with the viewport's bottom edge and the remembered offset equal to the real one. `Home` gives 0. `ArrowUp` after `End` writes nothing. After a direct scroll to 300, `ArrowDown` lands on 264. A horizontal offset of 100 is still 100 after `End`.
- `#/split` at 420 px, real keys: `End` scrolls to 82 and `Thirteen` spans 393–415. Shift+F10 opens the menu at that row's left edge, flipped above it, with focus in the menu.
- The `ComboBox` dropdown follows its highlight: 154 after 15 presses, 682 after `End`.
- The year list opens at 2,574 with the current year exactly centred, in the same task as the open.

**Not run:** Firefox and WebKit; a touch pan; a drag of a native scrollbar (replaced by a direct `scrollTop` write, which the library sees the same way: as a `scroll` event it did not cause).

---

## Notes

[^measured]: Measured in Chromium, with real key presses, on the dependency's branch tip. The numbers are in *Addendum: What was measured*. The scrolling moved onto an inner element in `plans/implemented/overlay-scrollbar-cross-axis-overlap.md`, which also introduced `getScrollElement()` and routed `Component`'s own scroll methods through it. That plan lists the list and the picker as needing no change ("the restructure is internal to `Panel`"). Their two direct element writes were missed, and no offline test asserted which element they wrote to.

[^no-panel-api]: Three other routes were considered and rejected.
    *`Panel.revealDescendant(rowElement)`*, which `Menu` uses for its highlighted row. It scrolls both axes: on a list with `horizontalScrolling` every row is wider than the viewport, and the call jumped the list 279 px sideways when measured. Under `scrollbarStyle: "native"` it also left the revealed row 15 px under the horizontal scrollbar, where today's list code is exact, so the list would have got worse there. Adding an axis argument and fixing its two measurement defects would change behaviour for `Menu`, `FocusHistory` and spatial navigation — a wider change than this defect needs.
    *A new `Panel` method that reveals a span of content.* It would work, but the list would be its only nearest-edge caller (the picker centres), and the existing methods already give the list everything it needs. A new public method on `Panel` to save twelve lines in one caller is not worth its API surface.
    *Reading the scrolling element through `Panel.getScrollViewportElement()`* from the spatial-navigation branch — see the decision on that branch.

[^inner-size]: The report that led to this plan says the list cannot read the inner viewport's height today. It can: `Panel.getInnerSize()` is public and already subtracts the scrollbar band, because layout managers need the same number to lay rows out beside a bar. The equality with `clientHeight` was measured for all six combinations of style and mode (addendum). It holds by construction under `"overlay"`: the panel sizes its inner scrolling element to its own client box minus the reserved band. For a panel with insets or padding the two would differ by them, since that space scrolls with the content; neither panel here has any (measured: a perimeter of 0 on every side). Taking the list's own `getHeight()`, as `Tree` and `Table` take theirs, would repeat the defect the survey found in them: an outer height counts the border and the bar.

[^resync]: Scrolls that update the remembered offset: the wheel (the eased scroller writes it back) and a drag of an overlay scrollbar (it calls `setScrollTop`). Scrolls that do not: a touch pan, middle-button autoscroll, a drag of a native scrollbar under `scrollbarStyle: "native"`, and any scroll the browser starts itself. `Panel`'s `scroll` listener updates the scrollbar thumb and the edge shadows but not the offset. `syncScrollOffsets()` is the public method `Component` provides for exactly this. Besides `ScrollStrip.mainScroll`, the docs app's `DocsContent.onScrollToFragment` calls it before a computed scroll for the same reason. The call also stops a wheel ease that is still running; the reveal's own write does the same, and a leftover ease would otherwise pull the row out of view again.

[^hidden]: An element inside a `display: none` subtree reports `scrollTop` as 0 and ignores writes. `syncScrollOffsets()` there would overwrite the panel's remembered offset with 0. `Tab` and `Card` capture each panel's offset before hiding it and write it back on show (`Component.captureSubtreeScroll` / `restoreSubtreeScroll`), so that 0 would be "restored" and the list would come back scrolled to the top. Today's code is harmless in this state only by accident: it reads zeros, writes to an element that ignores it, and never touches the remembered offset. The guard keeps that outcome on purpose. `isEffectivelyVisible()` is the library's one predicate that walks the ancestors; it is also false for a list hidden with `visibility`, which could still scroll. No open host is in that state: a `Window` and a dropdown are visible from `show()` on (measured for the `ComboBox` dropdown).

[^callers]: "Programmatic" reveal is `setFocusedIndex`, which a host uses to highlight a row; it scrolls today and keeps scrolling. `setSelectedIndex`, `setValue` and `setValues` have never scrolled. `Table`'s `selectRecord` does not scroll either (`scrollToRecord` is separate), while `Tree.selectNode` does, so the library has no single rule to follow, and a data binding that writes the value should not move the user's scroll position as a side effect. Changing it is listed under `## Non-Goals`.

[^picker]: The cell's `offsetTop` read stays: every component is absolutely positioned, so the cell's offset parent is the element the cells scroll in under both styles (measured: `offsetTop` 2640 equals the cell's cached `getY()`). No re-sync is needed here because the target is absolute, not relative to the current offset. No visibility guard is added either: the method runs right after the dropdown's own layout pass, and the year list is rebuilt and re-centred on every open.

[^spatial]: `Panel.getScrollViewportElement()` returns the element that scrolls. With it the list could keep today's code and swap the element. That was rejected for three reasons. First, it would make a small fix for a visible keyboard defect wait on a 3,700-line branch for one four-line accessor. Second, an implementation worktree cannot be based on two unmerged sibling branches, and this plan already depends on `table-tree-keyboard-context-menu`. Third, the list does not need an element at all: holding one is what let the two call sites drift when the scrolling element moved inward. Nothing is duplicated either way — this plan adds no accessor. Overlap with that branch is limited to two doc files (`## Potential Challenges`); a merge of the two touches no common source line, because this plan edits neither `Panel.ts`, `FocusReveal.ts`, `Tree.ts` nor `Body.ts`. If a recommendation is wanted: merge this one first, since it is small and fixes a defect users hit today.

[^engines]: Only Chromium was driven. The change contains nothing engine-specific — it sets `scrollTop` on an `overflow: auto` element and reads it back — but the year list's centring depends on the browser having laid the cells out by the time `scrollSelectedIntoView` runs, which was confirmed in Chromium only.

[^prototype]: The throwaway test file and the temporary diff were kept outside the repository, at `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/list-scroll/` (`planCases.scratch.test.ts`, `prototype-fix.diff`). They are a reference only and may be gone: write the test files from the tables above and to the project's conventions. With the change applied, the 74 existing test files of step 6 (1,083 tests), the library typecheck and ESLint on the two source files also passed.
