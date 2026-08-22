---
touches-shared:
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/tests/dom/TestDOM.ts
---

# Table sub-cell text selection — Implementation Plan

## Overview

A click-drag inside a single table cell can no longer select that cell's text. [`Body.onCellMouseDown`](packages/lib/src/typescript/lib/component/table/Body.ts#L1751) arms a `selectstart` viewport listener on every mousedown, and [`Body.onCellDragSelectStart`](packages/lib/src/typescript/lib/component/table/Body.ts#L1824) suppresses every `selectstart` it sees for the whole press-to-release window. The cell content is already marked selectable — [`StringRenderer`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L9) sets `userSelect: "text"` on itself and its child `SelectableText` — so nothing is wrong with the CSS. Only the event suppression is.

The fix is to arm that suppression **late**. A gesture starts in text-selection mode and touches `selectstart` not at all. The moment the range covers more than the one cell the gesture started in, the drag widens: it clears whatever native selection had formed inside that cell, installs the `selectstart` suppressor, and stays widened until mouseup. Everything the rectangular range already does — [`getCellRangeBounds`](packages/lib/src/typescript/lib/component/table/Body.ts#L1564), [`refreshCellRangeHighlight`](packages/lib/src/typescript/lib/component/table/Body.ts#L1612), [`updateCellRangeVisualState`](packages/lib/src/typescript/lib/component/table/Body.ts#L1629)'s scroll-safe repaint from [`bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L1378), [`Cell.setRangeSelected`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L367), and both copy paths — is untouched.

Selecting text is only half of it: [`Body.onKeyDown`](packages/lib/src/typescript/lib/component/table/Body.ts#L2323) intercepts every Ctrl/Cmd+C on the focused body and returns `{ prevent: true }`, so the browser never copies a selected substring. That branch gains one guard, so it stands aside when a live text selection exists.

Clearing the native selection needs one new write on the DOM seam: `DOM.sink.clearDocumentSelection()`, implemented in `ProductionDOMSink` and recorded by the offline `RecordingDOMSink`. The change touches [`Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts), [`DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts), [`TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts), and two docs pages.

---

## Architecture Decisions

### Widen the drag mid-gesture, guarded by one boolean field

`Body` gains `_rangeDragWidened`. A private `widenRangeDragIfMultiCell()` checks that flag first, so the `selectstart` listener is installed at most once per gesture, and `resetRangeDragWidening()` removes it on mouseup. This mirrors [`Tooltip`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L299)'s `watching` flag, which guards the same lazy-install / paired-teardown shape around `Event.addViewportListener`.[^guard-precedent]

### The trigger is "the range covers more than one cell", not a pixel threshold

`widenRangeDragIfMultiCell()` reads the current bounds from the existing `getCellRangeBounds(this._rangeAnchor, this._rangeFocus)` and widens when they span more than one row or more than one column. It is called from `onCellMouseDown` (after the anchor/focus write) and from `onCellDragMove` (after the focus write), so a shift-click that already spans cells widens with no mousemove at all.[^trigger-shape]

### Widening is one-way within a gesture

Once widened, a drag stays widened until mouseup, even if the pointer returns to the cell it started in. The `_rangeDragWidened` early return in `widenRangeDragIfMultiCell()` is what makes it one-way.[^one-way]

### Clearing runs on every tick while widened, not once at the transition

`onCellDragMove` calls `DOM.sink.clearDocumentSelection()` unconditionally, before its same-cell early return, whenever `_rangeDragWidened` is already `true` — not only at the moment of the transition. A single clear at the crossing instant is not trustworthy: `selectstart` fires once per gesture and cannot be re-armed mid-drag to veto further extension, and this file's own existing comment on `onCellDragSelectStart` already documents that `preventDefault()` on `mousemove` does not by itself stop the browser from extending a selection — i.e. the browser's drag-select algorithm runs as native default handling that script cannot reliably race or veto on a single event. Re-clearing on every subsequent tick while widened closes that gap regardless of the exact internal ordering: whatever the browser tries to (re)build on this tick, the next tick erases it, so no native highlight can persist or visibly creep past the cell it started in. `removeAllRanges()` on an already-empty selection is a cheap no-op, so this costs nothing on the common case of a gesture that stays widened for many ticks.[^continuous-clear]

### Ctrl/Cmd+C defers to a live text selection

`onKeyDown`'s Ctrl/Cmd+C branch returns without acting when `DOM.source.getDocumentSelection()` reports a live, non-collapsed selection, so the browser runs its own copy and the substring reaches the clipboard. With no such selection — the normal state after a widened drag, which cleared it — the branch copies the cell range exactly as it does today.[^copy-substring]

### A new `DOM.sink.clearDocumentSelection()` seam write

Clearing the browser's selection is a DOM write, so per [ARCHITECTURE.md](ARCHITECTURE.md) (*Minimize direct DOM access*) it goes on `DOM.sink`, not into `Body`. The new member is page-level with no element receiver, exactly like the neighbouring `writeClipboardText(text)` added by the same feature, and is placed directly after `writeClipboardText` in the interface, in `ProductionDOMSink`, and in `RecordingDOMSink`.[^seam-shape]

---

## Public API

`DOMSink` gains one required member. No new type, so no barrel change is needed.[^no-barrel]

```typescript
export interface DOMSink {
    // …after writeClipboardText(text: string): void;

    /**
     * Clears the document's current text selection. Page-level; no element
     * receiver.
     */
    clearDocumentSelection(): void;
}
```

Everything added on `Body` is private; the class's public surface does not change.

---

## Internal Structure

New field, beside the existing range fields in [`Body.ts:268`](packages/lib/src/typescript/lib/component/table/Body.ts#L268):

```typescript
// True once the live drag has widened from native text selection into
// rectangular cell-range selection — the one-way switch that installs the
// `selectstart` suppressor. Framework-managed bookkeeping (reset on every
// mousedown and mouseup), so per ARCHITECTURE.md's DOM-write rule this gets
// no `BodyOptions` field and no public setter.
private _rangeDragWidened: boolean = false;
```

The two new private methods, placed after `onCellDragSelectStart`:

```typescript
private widenRangeDragIfMultiCell(): void {
    if (this._rangeDragWidened) {
        return;
    }

    const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);

    if (!bounds || (bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol)) {
        return;
    }

    this._rangeDragWidened = true;

    DOM.sink.clearDocumentSelection();
    Event.addViewportListener(this, "selectstart", this.onCellDragSelectStart);
}

private resetRangeDragWidening(): void {
    Event.removeViewportListener(this, "selectstart", this.onCellDragSelectStart);

    this._rangeDragWidened = false;
}
```

---

## Ordered Implementation Steps

1. **[`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts)** — add `clearDocumentSelection(): void;` with the JSDoc from `## Public API` to the `DOMSink` interface, directly after `writeClipboardText` ([`DOM.ts:679`](packages/lib/src/typescript/lib/core/DOM.ts#L679)) and before the `addListener` doc comment.

2. **`DOM.ts` — `ProductionDOMSink`** — implement it directly after `writeClipboardText` ([`DOM.ts:1783`](packages/lib/src/typescript/lib/core/DOM.ts#L1783)):

   ```typescript
   /** @inheritDoc */
   clearDocumentSelection(): void {
       window.getSelection()?.removeAllRanges();
   }
   ```

   *Check:* `grep -n 'clearDocumentSelection' packages/lib/src/typescript/lib/core/DOM.ts` — two matches.

3. **[`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts)** — in `RecordingDOMSink`, after `writeClipboardText` ([`TestDOM.ts:599`](packages/lib/tests/dom/TestDOM.ts#L599)):

   ```typescript
   clearDocumentSelection(): void {
       this.record('clearDocumentSelection');
   }
   ```

   *Check:* `npm run typecheck` — clean. Both `DOMSink` implementors now satisfy the interface.

4. **[`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts)** — add tests 1–6 from `## Expected Behaviour` to the existing `describe('Body range selection — mouse gestures', …)` block ([`Body.test.ts:512`](packages/lib/tests/component/table/Body.test.ts#L512)), reusing its `rangeBody` / `cellAt` / `recordAt` helpers, and test 7 to `describe('Body range selection — copy', …)` ([`Body.test.ts:643`](packages/lib/tests/component/table/Body.test.ts#L643)) beside the existing Ctrl+C test. They fail at this point; steps 5–10 make them pass.

5. **[`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts)** — add the `_rangeDragWidened` field from `## Internal Structure` immediately after `_contextMenuCell` ([`Body.ts:273`](packages/lib/src/typescript/lib/component/table/Body.ts#L273)).

6. **`Body.ts`** — add `widenRangeDragIfMultiCell()` and `resetRangeDragWidening()` from `## Internal Structure` directly after `onCellDragSelectStart` ([`Body.ts:1826`](packages/lib/src/typescript/lib/component/table/Body.ts#L1826)), each with a doc comment. `widenRangeDragIfMultiCell`: it is a no-op while the range is still one cell, so an ordinary click-drag inside a cell keeps the browser's own text selection; once widened it clears that selection and stays widened until mouseup. `resetRangeDragWidening`: `Event.removeViewportListener` no-ops for a listener that was never installed, so it is safe to call for a gesture that never widened.

7. **`Body.ts` — `onCellMouseDown`** ([`Body.ts:1751`](packages/lib/src/typescript/lib/component/table/Body.ts#L1751)) — replace the three-line arming block at lines 1771–1773 with:

   ```typescript
   this.resetRangeDragWidening();

   Event.addViewportListener(this, "mousemove", this.onCellDragMove);
   Event.addViewportListener(this, "mouseup",   this.onCellDragEnd);

   this.widenRangeDragIfMultiCell();
   ```

   The order matters: the reset must run before the widen check, or a stale flag from a gesture whose mouseup never arrived would block this gesture's install.[^stale-reset]

8. **`Body.ts` — `onCellDragMove`** ([`Body.ts:1785`](packages/lib/src/typescript/lib/component/table/Body.ts#L1785)) — two changes:
   - At the top of the method, before the existing `target`/`located` lookup, add:
     ```typescript
     if (this._rangeDragWidened) {
         DOM.sink.clearDocumentSelection();
     }
     ```
     This runs on every mousemove tick while widened — including ones where the resolved cell hasn't changed and the method returns early below — so a selection the browser tries to rebuild after the transition-time clear gets erased again before it can render.
   - Append `this.widenRangeDragIfMultiCell();` after the existing `this.refreshCellRangeHighlight();`, unchanged from the original plan.

9. **`Body.ts` — `onCellDragEnd`** ([`Body.ts:1809`](packages/lib/src/typescript/lib/component/table/Body.ts#L1809)) — replace the `selectstart` `Event.removeViewportListener` line with `this.resetRangeDragWidening();`, leaving the `mousemove` / `mouseup` removals as they are.

   *Check:* `grep -n 'selectstart' packages/lib/src/typescript/lib/component/table/Body.ts` — the only `Event.addViewportListener` / `removeViewportListener` hits are inside the two new private methods.

10. **`Body.ts` — `onKeyDown`** ([`Body.ts:2323`](packages/lib/src/typescript/lib/component/table/Body.ts#L2323)) — guard the Ctrl/Cmd+C branch so it stands aside for a live text selection:

    ```typescript
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        // A live sub-cell text selection wins: let the browser copy the
        // substring instead of overwriting the clipboard with whole cells.
        // Returns null for a collapsed caret too, so a plain click still
        // copies the range.
        if (DOM.source.getDocumentSelection()) {
            return;
        }

        this.copySelectionToClipboard();

        return { prevent: true };
    }
    ```

    Extend the method's doc comment ([`Body.ts:2306`](packages/lib/src/typescript/lib/component/table/Body.ts#L2306)) with the same rule in one sentence.

11. **`Body.ts` — comments** — three stale mentions of the old always-on wiring:
    - [`Body.ts:967-969`](packages/lib/src/typescript/lib/component/table/Body.ts#L967) — the `init()` comment says the mousedown "arms the move/up/selectstart viewport listeners". Say move/up, and that the `selectstart` suppressor arms only once a drag widens past its origin cell.
    - `onCellMouseDown`'s doc comment ([`Body.ts:1743`](packages/lib/src/typescript/lib/component/table/Body.ts#L1743)) — same correction.
    - `onCellDragSelectStart`'s doc comment ([`Body.ts:1815`](packages/lib/src/typescript/lib/component/table/Body.ts#L1815)) — it says the suppression runs "for the duration of a range drag". Change to: from the moment the drag widens past its origin cell until mouseup. Keep the `DragManager` cross-reference and the `preventDefault()`-on-`mousemove` explanation.

    *Check:* `npm test` — green, including the pre-existing range/copy/scroll tests, unmodified.

12. **[`packages/lib/docs/components/Table.md:263`](packages/lib/docs/components/Table.md#L263)** — the sentence "A range always copies whole cells; there is no longer a way to select or copy a substring of one cell's text." is now wrong. Replace with a statement of the two modes: a click-drag that stays inside one cell selects that cell's text natively and Ctrl/Cmd+C copies that text, while a drag that crosses into another cell switches to the rectangular range (discarding the partial text selection) for the rest of the gesture, and a copied range always covers whole cells. Leave the rest of the bullet — including the existing `TreeTable` reparent-drag caveat — alone.

13. **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — add two entries, matching the shape of the `0.7.0` page's own:
    - `## Breaking changes` → `### Core`: `DOMSink` gains one required member, `clearDocumentSelection()`. Only a consumer implementing its own `DOMSink` is affected.
    - `## Fixed` → `### Table`: selecting text inside a single cell works again, and Ctrl/Cmd+C copies that text; the cell-range drag now takes over only once the drag crosses into another cell.

14. **Verification** — run everything in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

The contract, gesture step by gesture step (`R`/`C` are row and visible-column index):

| Step | Range after | `_rangeDragWidened` | Native selection |
|---|---|---|---|
| mousedown (R1,C1) | R1–R1 × C1–C1 | `false` | untouched; the browser starts its own selection in that cell |
| drag still inside (R1,C1) | unchanged — `onCellDragMove` returns early | `false` | keeps extending — sub-cell text selection works |
| drag to (R2,C1) | R1–R2 × C1–C1 | `true` | cleared on this tick (the transition); `selectstart` suppressed from here on |
| further drag deeper into (R2,C1)'s own text, well past the boundary | unchanged — `onCellDragMove` returns early after the clear | stays `true` | cleared again on *every* such tick, before the early return — so any selection the browser tries to rebuild past the crossing point is erased before it can render |
| drag back to (R1,C1) | R1–R1 × C1–C1 | stays `true` | cleared again on this tick too — widening is one-way, and clearing keeps running every tick regardless of which cell the pointer is over |
| mouseup | unchanged | `false` | suppressor removed |
| shift-mousedown (R2,C0) while anchor is (R0,C2) | R0–R2 × C0–C2 | `true`, on the mousedown itself | cleared once; suppressed, with no mousemove |
| shift-mousedown on the anchor's own cell | single cell | `false` | untouched |
| drag onto a separator row, or off every cell | unchanged — `onCellDragMove` returns early | unchanged | still cleared first if already widened (the new top-of-method check runs before `locateCellFromTarget` is even consulted) |

And what Ctrl/Cmd+C on the focused body then does:

| `getDocumentSelection()` | `onKeyDown` returns | Clipboard receives |
|---|---|---|
| a non-collapsed range (a sub-cell text drag) | `undefined` | the selected substring, copied by the browser |
| `null` — collapsed caret (a plain click) | `{ prevent: true }` | the cell range, from `copySelectionToClipboard()` |
| `null` — nothing selected (after a widened drag) | `{ prevent: true }` | the cell range, from `copySelectionToClipboard()` |

All of this is unit-testable through the white-box pattern the file already uses: call `onCellMouseDown` / `onCellDragMove` / `onCellDragEnd` / `onKeyDown` directly with `makeEvent(handle, type, init)`, count `clearDocumentSelection` calls through `(DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'clearDocumentSelection')`, and count `selectstart` registrations with `vi.spyOn(Event, 'addViewportListener')` filtered to calls whose second argument is `'selectstart'`. The tests to add:

1. **A drag that never leaves its origin cell does not touch native selection.** mousedown on (0,0), then `onCellDragMove` resolving to (0,0) again: zero `clearDocumentSelection` writes, and `Event.addViewportListener` never called with `'selectstart'`.
2. **A cross-cell drag clears the selection and installs the suppressor.** mousedown (0,0) then one `onCellDragMove` to (1,0): exactly one `clearDocumentSelection` write (from the transition inside `widenRangeDragIfMultiCell`; the new top-of-method check in `onCellDragMove` does not fire on this same tick, since `_rangeDragWidened` is still `false` on entry), exactly one `'selectstart'` registration, `_rangeDragWidened === true`.
3. **A shift-click that already spans cells widens immediately.** mousedown (0,0), `onCellDragEnd()`, then shift-mousedown on (2,2): one `clearDocumentSelection` write and one `'selectstart'` registration, with no `onCellDragMove` in between.
4. **The suppressor is never registered twice in one gesture, but clearing keeps running every widened tick.** mousedown (0,0), then drags to (1,0), (2,0), (3,0): still exactly one `'selectstart'` registration (`widenRangeDragIfMultiCell`'s flag guard), but three `clearDocumentSelection` writes — one from the widen transition on the first move, and one more from the top-of-method check on each of the next two moves, since `_rangeDragWidened` is already `true` by then.
5. **Mouseup re-arms text mode.** After test 2's drag, `onCellDragEnd()` leaves `_rangeDragWidened === false` and calls `Event.removeViewportListener` with `'selectstart'`; a fresh mousedown on (0,0) then registers no `'selectstart'`.
6. **A shift-click landing on the anchor's own cell stays in text mode.** mousedown (1,1), `onCellDragEnd()`, shift-mousedown (1,1): no `clearDocumentSelection` write, no `'selectstart'` registration.
7. **Ctrl/Cmd+C defers to a live text selection.** Build the body the way the existing Ctrl+C test at [`Body.test.ts:733`](packages/lib/tests/component/table/Body.test.ts#L733) does, set a range, then stub the selection — `vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({ startContainer: b.getElement()!, startOffset: 0, endContainer: b.getElement()!, endOffset: 2 })`. `onKeyDown(makeEvent(b.getElement()!, 'keydown', { key: 'c', ctrlKey: true }))` returns `undefined`, and no `writeClipboardText` write is recorded.
8. **The existing tests pass unmodified** — the gesture-sequence, separator-row, editing-cell, no-cell, no-op-move, highlight, copy, scroll-out-of-pool, and context-menu tests all keep their current assertions and current expected values. The Ctrl+C/Cmd+C test at [`Body.test.ts:733`](packages/lib/tests/component/table/Body.test.ts#L733) is the negative half of item 7 and needs no change: `ModelledDOMSource.getDocumentSelection()` returns `null`, so the range copy still runs.

Manual verification only (the offline harness records synthetic events without letting the browser act on them, so neither a real text selection nor a real `selectstart` exists offline):

- Dragging across a word inside one cell highlights that text, and Ctrl/Cmd+C puts just that word on the clipboard.
- Dragging from that cell into a neighbouring cell makes the partial text highlight disappear and the blue range highlight appear, with no leftover text highlight underneath. Ctrl/Cmd+C then copies the whole rectangle. Do this slowly, releasing the mouse partway through the second cell's own text rather than right at the boundary — the case the automated tests cannot cover (see [^continuous-clear]) is a native highlight bleeding into and lingering across that second cell as the drag continues past the crossing point, not just at the instant of crossing.
- Scrolling during an active cross-cell drag keeps the highlight correct on rows entering the view, and the copied text matches the visible rectangle.
- Right-click → **Copy** still copies the range (or the single right-clicked cell), unaffected by either mode.

---

## Verification

1. `npm run typecheck` — clean.
2. `npm test` — green, including the eight items above.
3. `npm run lint` — clean. `window.getSelection()` in `ProductionDOMSink` is inside `core/DOM.ts`, the one module `local/no-raw-dom` exempts.
4. `npm run docs:api` — zero warnings (the new `DOMSink` member is public API, so its JSDoc must not `{@link}` anything excluded from the docs, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
5. `grep -rn 'selectstart' packages/lib/src/typescript/lib/component/table/Body.ts` — registration and removal appear only inside `widenRangeDragIfMultiCell` / `resetRangeDragWidening`.
6. Manual, in the demo app: `npm run dev`, open `http://localhost:8015`, the **Misc.** tab's table. Run the four manual checks listed in `## Expected Behaviour`.

---

## Documentation Impact

- `packages/lib/docs/components/Table.md:263` — the "no longer a way to select or copy a substring" sentence (step 12).
- `packages/lib/docs/reference/changelog/next.md` — a `Breaking changes → Core` entry for the new `DOMSink` member and a `Fixed → Table` entry for the restored selection (step 13). `next.md` currently holds only its header, so both headings are new.
- No barrel or sidebar change.[^no-barrel]
- `packages/lib/docs/concepts/dom-seams.md` is left alone: `writeClipboardText`, the closest precedent, was never added to its method list either.

---

## Potential Challenges

- **`onCellMouseDown` calls `this.focus()` before the browser starts its selection.** If the manual check shows that focus call collapsing the fresh selection, move the `this.focus()` at [`Body.ts:1769`](packages/lib/src/typescript/lib/component/table/Body.ts#L1769) into `widenRangeDragIfMultiCell`, so it runs only for a widened drag. A single-cell gesture keeps its focus either way, because it does fire a `click` and [`onRowClick`](packages/lib/src/typescript/lib/component/table/Body.ts#L1488) focuses the body itself. Do not reach for `preventDefault` on the mousedown — that kills the selection outright.
- **The child `Text` is `pointer-events: none`.** [`StringRenderer`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L30) makes the renderer the hit target and the `Text` transparent to the pointer. Both carry `userSelect: "text"` deliberately, so a selection is expected to paint across the text; confirm it in the manual check rather than assuming it.
- **A `TreeTable` with row reparenting enabled still cannot select cell text.** [`TreeBody.installRowDnD`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L609) makes each row a `DragManager` source, and `DragManager` installs its own always-on `selectstart` suppressor on mousedown ([`DragManager.ts:362`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L362)). That is the pre-existing drag conflict `Table.md` already documents; leave it as is.
- **A drag that starts mid-cell and ends mid-cell in a second cell is the exact case that motivates clearing on every widened tick, not just once.** See [^continuous-clear]: `selectstart` only fires once per gesture, so it cannot be re-armed to veto the browser's continued mousemove-driven extension after the origin cell's own selection was deliberately allowed to start. The unit tests can only assert `clearDocumentSelection` call counts (the offline harness never runs real browser selection logic); the manual check in `## Verification` item 6 — drag from partway through one cell's text to partway through a neighbour's — is the only test that actually confirms no native highlight bleeds across the boundary.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — the range fields (268–273), `getCellRangeBounds` (1564), `refreshCellRangeHighlight` (1612), `updateCellRangeVisualState` (1629) and its scroll-safe call from `bindAndPositionRows` (1378), the four gesture handlers (1751, 1785, 1809, 1824), and `onKeyDown`'s Ctrl/Cmd+C branch (2323).
- [`packages/lib/src/typescript/lib/overlay/Tooltip.ts`](packages/lib/src/typescript/lib/overlay/Tooltip.ts) — the `watching` flag (86), its guarded lazy install (299–302) and paired teardown (341–344). The precedent this plan's guard mirrors.
- [`packages/lib/src/typescript/lib/overlay/DragManager.ts`](packages/lib/src/typescript/lib/overlay/DragManager.ts) — `onSelectStart` (500) and the `session.committed` one-way mid-gesture switch (520–538).
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `DOMSink.writeClipboardText` (679) and its `ProductionDOMSink` implementation (1781), the shape the new seam write copies; `DOMSource.getDocumentSelection` (1136) and its implementation (2297), whose `null`-for-collapsed behaviour the Ctrl/Cmd+C guard relies on.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `RecordingDOMSink.record` (402), `writeClipboardText` (599), `makeEvent` (1480).
- [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts) — the `rangeBody` / `cellAt` / `recordAt` helpers (513–537) and the existing gesture tests (539–641).
- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — `addViewportListener` (762) pushes without deduping; `removeViewportListener` (799) no-ops for an unknown triple.

---

## Non-Goals

- **No auto-scroll while dragging near the table's edge.** None exists today — `onCellDragMove` treats a pointer that leaves every pool row as a no-op, and says so ([`Body.ts:1778-1780`](packages/lib/src/typescript/lib/component/table/Body.ts#L1778)). "Wide selections even when scrolling" is the existing virtualization-safe behaviour this plan must not break, not a new feature.[^scrolling-scope]
- **No change to double-click-to-edit or row-click selection.** Both are wired separately (`Cell`'s own `dblclick` listener, `Body.onRowClick`) and are unaffected.
- **No fall-back from widened mode to text mode inside one gesture.** Widening is one-way by design.
- **No change to the right-click Copy path.** `copyContextMenuSelection` keeps copying the range or the single right-clicked cell; it never consults the native selection.

---

## Notes

[^guard-precedent]: `Event.addViewportListener` ([`Event.ts:762`](packages/lib/src/typescript/lib/core/Event.ts#L762)) appends to a per-component listener array with no identity check, so calling it twice with the same `(component, type, listener)` triple registers the handler twice and fires it twice. Any lazy install therefore needs a caller-side guard. `Tooltip` already solves exactly this: `Tooltip.watching` gates the `mousemove` anchor-watch install and is cleared by the paired removal in `hide()`. `removeViewportListener` ([`Event.ts:799`](packages/lib/src/typescript/lib/core/Event.ts#L799)) is safe for a triple that was never added — it returns early on a missing type map, component entry, or listener — so only the *add* side needs guarding, which is why `resetRangeDragWidening` removes unconditionally.

[^trigger-shape]: The alternative was to record the mousedown's origin cell in its own field and compare each move against it. That needs a second field and a second identity comparison, and still has to special-case the shift-click, whose new range is not anchored at the mousedown cell at all. Reading the bounds that `getCellRangeBounds` already computes covers the drag case and the shift-click case with the same three-line test, and reuses the same record-identity resolution the highlight and both copy paths use — so a range whose anchor record has been filtered out of view (`getCellRangeBounds` returns `null`) simply does not widen, rather than needing its own branch.

[^one-way]: A two-way switch would have to reinstate native text selection when the pointer re-enters the origin cell, which means re-deriving where inside that cell the selection should resume from — the browser has already been told to abandon it. It would also flicker the range highlight off and on across a cell boundary the user is merely passing through. `DragManager` makes the same call for the same reason: `session.committed` is set once past the drag threshold and never cleared until the session ends ([`DragManager.ts:520-538`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L520)).

[^continuous-clear]: A single clear at the transition instant is not provably sufficient, and a quick spot-check argued for the defensive per-tick version rather than trusting it. `selectstart` is a start-of-gesture event — it does not re-fire as an already-running selection extends over a continued mousemove-while-button-held sequence, so once the initial `selectstart` for a gesture has passed uncancelled (which it must, for the origin cell's own text to become selectable at all), there is no later `selectstart` left to cancel for the rest of that same gesture. Whatever continues to extend the selection past that point is the browser's own default handling of each `mousemove`, and this file's existing comment on `onCellDragSelectStart` already records the lesson that `preventDefault()` on `mousemove` does not by itself stop that default handling — i.e. script cannot reliably veto it inline on a single event. A synthetic-drag spot-check (CDP-driven `mousedown` on one cell's text, `mousemove` into a second cell's text, `mouseup` there, instrumented to log `selectstart` firings and `getSelection().toString()` on every tick) came back with the final selection empty after a single `removeAllRanges()` call at the crossing tick — but the CDP drag helper only generated one or two coarse `mousemove` events for the whole gesture rather than the many closely-spaced ones a real mouse produces, so the check cannot rule out the browser re-building a selection over several fine-grained ticks after the one-shot clear. Re-clearing on every tick while widened does not depend on resolving that ambiguity: it bounds the worst case to "visible for a single frame" regardless of how the browser's internal timing actually works, at the cost of a `removeAllRanges()` call per mousemove tick that is a no-op once nothing is selected. Confirm the visual result directly against the real `Table` in the manual check (`## Verification`, item 6) once implemented — that is the only fully authoritative test for this.

[^seam-shape]: The seam has no way to *clear* a selection today — `DOM.source.getDocumentSelection()` ([`DOM.ts:1136`](packages/lib/src/typescript/lib/core/DOM.ts#L1136)) only reads. So a new member is needed rather than a reuse, and it belongs on the sink because it mutates. `writeClipboardText` is the closest existing member in every respect that matters: page-level, no `Handle` argument, `void`, and added by this same table-copy feature.

[^copy-substring]: Without this guard the restored selection would be inert: `onKeyDown` is registered on the body's own element, `onCellMouseDown` focuses the body, so every Ctrl/Cmd+C after a sub-cell drag lands on that branch, copies whole cells, and returns `{ prevent: true }` — the browser's own copy never runs. `getDocumentSelection()` is the right discriminator because it already returns `null` for a collapsed caret as well as for no selection at all ([`DOM.ts:2299`](packages/lib/src/typescript/lib/core/DOM.ts#L2299)), so the caret a plain single click leaves behind does not divert the range copy. There is no risk of a stale selection diverting it either: a widened drag clears the selection and then suppresses `selectstart`, and a fresh mousedown that does not widen lets the browser collapse the old selection itself. The guard also gives `getDocumentSelection` its first production call site — it was added for the copy path commit 9774d1fd replaced and has been dead since.

[^stale-reset]: A mouseup that lands outside the browser window never reaches the `mouseup` viewport listener, so `onCellDragEnd` can be skipped for a gesture. Without the reset in `onCellMouseDown`, `_rangeDragWidened` would still read `true` at the start of the next gesture and suppress that gesture's text selection. Resetting through `resetRangeDragWidening()` — rather than assigning the field directly — also removes the orphaned listener, so the next widen cannot register a second copy.

[^scrolling-scope]: The user's request was "reintroduce the ability to select a sub-set of the contents of a cell, while maintaining the ability to make wide selections, even when scrolling." Commit 9774d1fd exists precisely because the old native-selection copy path broke when a drag scrolled: it resolved the selection against the row pool, so scrolled rows copied the wrong cells. "Even when scrolling" names that guarantee. This plan preserves it untouched: the range is stored as record identity plus column index, and the highlight repaints both from the full sweep and per-row from the bind loop.

[^no-barrel]: `clearDocumentSelection` returns `void` and takes no arguments, so it introduces no type that TypeDoc would have to resolve. The contrasting case is `getDocumentSelection`, whose `DocumentSelectionRange` return type did need adding to `packages/lib/src/typescript/lib/core/index.ts` before `npm run docs:api` was warning-free.

---

## Addendum: StyleAuditPanel copies a pre-truncated CSS preview, not the full rule body

Unrelated to the text-selection fix above — found while manually verifying that Table's copy paths return full cell content, and bundled into this same plan file rather than a separate one, per instruction. Independently implementable: doing this addendum does not require doing the steps above, or vice versa, and it touches none of the same files.

### Overview

`StyleAuditPanel`'s `auditBaseStylesheet()` ([`StyleAuditPanel.ts:169`](packages/lib/src/typescript/StyleAuditPanel.ts#L169)) builds each `DuplicateRuleRow`'s `body` field as:

```typescript
body: stat.body.length > BODY_PREVIEW_LENGTH ? stat.body.slice(0, BODY_PREVIEW_LENGTH - 1) + "…" : stat.body,
```

`BODY_PREVIEW_LENGTH` is `160` ([`StyleAuditPanel.ts:16`](packages/lib/src/typescript/StyleAuditPanel.ts#L16)). This slicing runs before the row ever reaches `this._store.loadData(duplicates)` — the record's `body` field is already the truncated, ellipsis-appended preview string by the time the `Table` sees it, and no other field on `DuplicateRuleRow` carries the full text, so it's gone for good once loaded.

The Table's own copy pipeline is not at fault: `Body.buildCopyText` / `TableExporter.formatValue` copy a cell's record value verbatim and do no truncation of their own — confirmed as part of the investigation behind the plan above. Right-click **Copy** and Ctrl/Cmd+C on this column faithfully reproduce whatever the record holds; here that's already a 160-character preview with a literal "…" baked into the string, not a copy-path bug.

### Fix

Store the full `stat.body` as the row's `body` field value, and let the grid's own visual truncation provide the preview instead — `Text.truncate` defaults to `true` ([`Text.ts:73`](packages/lib/src/typescript/lib/component/input/Text.ts#L73)), so the column already ellipsizes visually with no extra configuration. This is the same pattern the framework's own cell renderers already follow (visually truncate via CSS `text-overflow: ellipsis`, keep the underlying value complete — see `StringRenderer`, `Overview` above), so copy then naturally returns the complete rule body.

### Steps

1. **[`packages/lib/src/typescript/StyleAuditPanel.ts:169`](packages/lib/src/typescript/StyleAuditPanel.ts#L169)** — replace:
   ```typescript
   body: stat.body.length > BODY_PREVIEW_LENGTH ? stat.body.slice(0, BODY_PREVIEW_LENGTH - 1) + "…" : stat.body,
   ```
   with:
   ```typescript
   body: stat.body,
   ```
2. **`StyleAuditPanel.ts:16`** — `BODY_PREVIEW_LENGTH` becomes unused; remove the constant.
   *Check:* `grep -n BODY_PREVIEW_LENGTH packages/lib/src/typescript/StyleAuditPanel.ts` returns nothing.
3. No column-width change needed: the `body` column's `minWidth: 420` ([`StyleAuditPanel.ts:254`](packages/lib/src/typescript/StyleAuditPanel.ts#L254)) already governs the visible preview width. Longer bodies now simply ellipsize past where 160 characters would have cut off — a paint-time difference only, since `Text.truncate` never touches the underlying string.

### Files to Modify

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/StyleAuditPanel.ts` |

### Verification

1. `npm run typecheck` — clean.
2. `npm run lint` — clean (confirms removing `BODY_PREVIEW_LENGTH` leaves no unused-constant warning).
3. Manual, in the demo app: `npm run dev`, open the Style Audit panel, click **Refresh**, right-click a `body` cell whose visible text ends in "…" → **Copy**, paste — the pasted text is the complete CSS declaration body, not truncated, even though the cell still displays an ellipsis.
