---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Table.ts
---

# Table Column-Resize Layout Scheduling — Implementation Plan

## Overview

A column-resize drag runs a full table layout pass on every pointer move. [`Table.onColumnResize`](packages/lib/src/typescript/lib/component/table/Table.ts#L1344) computes the new width array from the pointer travel and ends with a bare `this.doLayout()` at [Table.ts:1402](packages/lib/src/typescript/lib/component/table/Table.ts#L1402). That call is synchronous and unconditional: it runs inside the `mousemove` dispatch, and [`layout/Table.doLayout`](packages/lib/src/typescript/lib/layout/Table.ts#L90) then re-positions and re-lays-out every header cell ([layout/Table.ts:238](packages/lib/src/typescript/lib/layout/Table.ts#L238)), every parent-header cell ([layout/Table.ts:198](packages/lib/src/typescript/lib/layout/Table.ts#L198)) and every footer cell ([layout/Table.ts:287](packages/lib/src/typescript/lib/layout/Table.ts#L287)) whether or not that column's geometry moved.

This plan replaces the one call with `this.scheduleLayout()`, putting the drag on the framework's animation-frame layout queue ([`Component.scheduleLayout`](packages/lib/src/typescript/lib/core/Component.ts#L5300)). Every move inside one frame then collapses into a single pass. It is a one-line source change plus offline tests that pin the coalescing.

Nothing about *what* a pass costs changes here — that is owned by [`plans/table-header-column-virtualization.md`](plans/table-header-column-virtualization.md), which deletes the two header loops. This plan caps how *many* passes a drag can run.

---

## Architecture Decisions

### The per-move pass goes on the animation-frame layout queue

`this.doLayout()` at [Table.ts:1402](packages/lib/src/typescript/lib/component/table/Table.ts#L1402) becomes `this.scheduleLayout()`. That statement is the entire behaviour change; the only other source edit is two sentences of JSDoc on the same method.

The precedent is [`Slider`](packages/lib/src/typescript/lib/component/input/Slider.ts#L558): its `pointermove` handler calls `setValue`, which reaches [`applyValue`](packages/lib/src/typescript/lib/component/input/Slider.ts#L671) and ends in `this.scheduleLayout()`. Slider's thumb is repositioned entirely by the coalesced pass, so a framework drag whose only visual feedback is a queued layout is already established.[^drag-precedent]

### The drag arithmetic needs no layout between moves

`onColumnResize` reads only state that a layout pass does not produce, so consecutive moves compute the same widths whether or not a pass ran between them.[^state-only]

The three inputs are `this._columnWidths` (written by the previous move), `this._dragLastClientX` (written by the previous move), and [`getAvailableColumnWidth()`](packages/lib/src/typescript/lib/component/table/Table.ts#L510), which derives from the table's own committed width — a value the table's parent sets, not the table's own layout.

The one thing a pass *could* change is `_columnWidths` itself, via [`rescaleWidths`](packages/lib/src/typescript/lib/layout/Table.ts#L366). A pass cannot change it right after a drag move: the drag holds the total at `max(available, target)`, which is exactly the width `rescaleWidths` is asked to rescale toward, so `rescaleWidths`'s equal-totals early return at [layout/Table.ts:384](packages/lib/src/typescript/lib/layout/Table.ts#L384) fires every time.

| After a move | Total | `_columnWidthTarget` | `targetWidth` | `rescaleWidths` |
|---|---|---|---|---|
| Table still fits | `available` | `0` | `available` | equal totals → returns input |
| Drag grew the table | `newTotal > available` | `newTotal` | `newTotal` | equal totals → returns input |
| Drag gave growth back | `available` | `0` | `available` | equal totals → returns input |

### The cursor keeps up because the flush lands in the same frame

Chrome dispatches `mousemove` immediately before the animation-frame callbacks of the frame it belongs to. An animation frame requested from inside the handler — which is what [`ensureFlushScheduled`](packages/lib/src/typescript/lib/core/Component.ts#L173) does — therefore runs later in that same frame, and the column edge moves on the same paint as today.[^same-frame]

Three cases, of which only the third is a visible change:

| Move arrives | Flush runs | What the user sees |
|---|---|---|
| Chrome's frame-aligned input dispatch (every real drag) | same frame | unchanged |
| Outside a frame (a synthetic event from a timer or a test) | next frame | edge lags by up to one frame |
| While the startup font gate (defined below) is held | deferred, retried each frame until the gate opens | edge does not move, then jumps to its final width |

The startup font gate is a one-shot hold on the framework's *first* layout flush ([`FirstLayoutGate`](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts#L50)), released when the web font activates or after `FIRST_LAYOUT_HOLD_MS` (50 ms) of free main thread, whichever comes first. A drag cannot realistically start inside that window — it needs a rendered header to press on — and the widths are still accumulated correctly throughout, so the pass that runs when the gate opens shows the right result. No guard is added for it.[^font-gate]

### Coalescing does not disturb the body's width-change check, and that check is left alone

[`Body.updateColumnWidthCache`](packages/lib/src/typescript/lib/component/table/Body.ts#L780) decides whether to throw away the per-row cell-geometry cache by comparing the incoming widths against `_lastColumnWidths` with [`columnWidthsEqual`](packages/lib/src/typescript/lib/component/table/Body.ts#L82). `_lastColumnWidths` holds *the same array instance* the table holds, so a width change applied by mutating that array in place would compare the array against itself and never invalidate.

No such mutation exists. `onColumnResize` builds a fresh array (`const out = widths.slice()` at [Table.ts:1390](packages/lib/src/typescript/lib/component/table/Table.ts#L1390)) and assigns it wholesale ([Table.ts:1396](packages/lib/src/typescript/lib/component/table/Table.ts#L1396)); `distributeDragChain` writes only into `out` ([DragChain.ts:68](packages/lib/src/typescript/lib/core/DragChain.ts#L68)); `initializeWidths`, `rescaleWidths` and `absorbSlackIntoGreedy` each return a new array or the input untouched. Coalescing does not change this — several moves between flushes each replace the array, and the flush still sees an instance whose contents differ from the cached one.[^aliasing]

The aliasing stays as it is. A test pins the invalidation firing across a coalesced multi-move drag, so a future in-place mutation is caught by a failure rather than by a silent stale cache.

### This plan does not touch the per-column loops

[`plans/table-header-column-virtualization.md`](plans/table-header-column-virtualization.md) replaces the two header `forEach` loops in `layout/Table.doLayout` with a single `header.renderColumnWindow(...)` call, and gives the body plan's column window to the header. That plan owns everything inside a pass. This plan owns only the count of passes, and edits one statement in `component/table/Table.ts` that neither queued plan mentions.[^plan-relationship]

The two are complementary, not alternatives: virtualization makes a pass cheap, coalescing stops a drag from queueing more passes than the display can show. Either order of merging works, and no step here conflicts with either queued plan.

---

## Implementation

The whole source change, at the tail of `onColumnResize`:

```typescript
        this._columnWidthTarget = newTotal > available + WIDTH_TARGET_EPSILON_PX ? newTotal : 0;

        this.scheduleLayout();
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — in `onColumnResize`, replace the final `this.doLayout();` ([Table.ts:1402](packages/lib/src/typescript/lib/component/table/Table.ts#L1402)) with `this.scheduleLayout();`.
   Check: `grep -n 'this.doLayout()' packages/lib/src/typescript/lib/component/table/Table.ts` — expect four matches (lines 604, 1155, 1431, 1838), none inside `onColumnResize`.

2. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — add two sentences to `onColumnResize`'s JSDoc: the pass is queued onto the animation-frame layout queue so all of a frame's moves collapse into one, and the drag arithmetic reads only state, so no pass is needed between moves. Do not restate the reasoning from `## Architecture Decisions`.
   Check: `npm run docs:api` — zero warnings (the method is private, so the generated output should not change at all).

3. **`packages/lib/tests/component/table/ColumnResize.test.ts`** — add a frame-driving harness at the top of the file, copied from [`tests/core/AfterNextLayout.test.ts:33`](packages/lib/tests/core/AfterNextLayout.test.ts#L33): a `frames` array, a `beforeEach` that replaces `DOM.sink.requestAnimationFrame` with a capture, a `flushFrame()` that invokes and clears the captured callbacks, and an `afterEach` that calls `flushFrame()` before `vi.restoreAllMocks()` so the module-level frame handle resets.
   The existing `beforeEach(() => installTestDOM(CONFIG))` and `afterEach(() => DOM.reset())` at [ColumnResize.test.ts:32](packages/lib/tests/component/table/ColumnResize.test.ts#L32) stay; the new hooks run alongside them, with `installTestDOM` first and `DOM.reset()` last.
   Check: `npm test -- ColumnResize` — every existing case still passes, with no edit to any of their bodies.

4. **`packages/lib/tests/component/table/ColumnResize.test.ts`** — add a `describe('Table column resize — layout coalescing')` block with the three cases from `## Expected Behaviour` (cases 30, 31, 32). Each builds its table with the existing `makeTable()` helper, then calls `flushFrame()` **before** installing any spy, so frames the fixture queued (`setWidth` and the child wiring both schedule one) are drained first.
   Check: `npm test -- ColumnResize` — the three new cases pass.

5. **`packages/lib/tests/component/table/ColumnResize.test.ts`** — add case 33, the width-change invalidation across a coalesced drag, per `## Expected Behaviour`.
   Check: `npm test -- ColumnResize` — passes.

6. Run the full gate: `npm run typecheck`, `npm test`, `npm run lint`.

7. Manual verification per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/tests/component/table/ColumnResize.test.ts` |

---

## Expected Behaviour

Cases 1–13 and 21–23 already exist in `ColumnResize.test.ts` and must stay green **with no edit to their bodies** — they assert `getColumnWidths()` / `getColumnWidthTarget()`, which are written by the drag itself, not by the layout pass. Case 3 ("two frames chain the same way as one") is the load-bearing one: it would fail if an intervening layout pass were needed for the arithmetic to be right.

New cases, all unit-testable offline:

- **30. No layout runs during the moves.** Build the fixture table, `flushFrame()`, then `vi.spyOn(table, 'doLayout')`. Call `onColumnResizeStart(0, 1000)` and fifty `onColumnResize(0, 1000 + i)` for `i` in `1..50`. The spy has not been called.
- **31. One layout runs for the whole burst.** Repeat case 30's setup and its fifty moves, then call `flushFrame()`. The spy has been called exactly once.
- **32. A dead-zone move schedules nothing.** Reuse existing case 10's setup: `makeTable(specWithAMax(250))`, `onColumnResizeStart(0, 1000)`, `onColumnResize(0, 1200)` — which pins column A at its 250 `maxWidth`, leaving the left chain (column 0 alone) with no room to grow. Then `flushFrame()` and `vi.spyOn(table, 'scheduleLayout')`. One more move further right, `onColumnResize(0, 1100)`, leaves the spy uncalled and the widths at `[250, 100, 100, 50]` — the existing dead-zone early return at [Table.ts:1378](packages/lib/src/typescript/lib/component/table/Table.ts#L1378) returns before the schedule.
- **33. A coalesced burst still invalidates the body's geometry cache.** Build the fixture, `flushFrame()`, then read `(table.getBody() as any)._lastColumnWidths` and keep the array *instance*. Run three moves and `flushFrame()`. Afterwards `(table.getBody() as any)._lastColumnWidths` is a different instance from the one captured, and its contents equal `table.getColumnWidths()`. This is what fails if a future change starts mutating the width array in place.

Manual only (the offline harness has no real pointer input and no frame clock):

- **34. The edge tracks the cursor.** Dragging a column edge in a real browser looks the same as before the change — no perceptible lag between pointer and edge, no stepping.
- **35. A wide table drags smoothly.** On the 45-column table the drag is not slower than before. It should be the same or better; a regression here means the flush is landing a frame late.

---

## Verification

**Layout counts are the meaningful measurement; wall-clock through the DevTools MCP is not.** Timings taken through that channel in this environment run roughly 60× inflated against the user's real Chrome, so any absolute millisecond figure from it is noise. Assert on counts and ratios.

Automated:

- `npm test -- ColumnResize` — every pre-existing case unchanged and green; cases 30–33 green.
- `npm test` — full suite.
- `npm run typecheck`.
- `npm run lint`.
- `grep -rn 'this.doLayout()' packages/lib/src/typescript/lib/component/table/Table.ts` — expect four matches, none between lines 1344 and 1403.
- `npm run docs:api` — zero warnings.

Manual, in the demo app (`npm run dev`, http://localhost:8015, MiscPanel):

- "Show window with wide table (45 columns)!" — drag a column edge left and right across the full width. The edge stays under the cursor (case 34), the neighbouring columns chain nearest-first as before, and the drag is no slower than on master (case 35).
- Same window, drag the last column's right edge outward until the horizontal scrollbar appears, then back. The table grows and shrinks as one and the scrollbar tracks it — this exercises the `_columnWidthTarget` path across a coalesced flush.
- "Show window with table (column spec)!" — drag an edge, then sort and toggle a column from the header menu. The widths survive; those paths still lay out synchronously and are untouched.

Optional, only if a browser-side count is wanted: temporarily wrap `flushPendingLayouts` and `Component.doLayout` in `core/Component.ts` with a `globalThis.__layoutStats` counter, drag, read the counter, and revert. This instrumentation is **not** part of the change — cases 30 and 31 already assert the same property deterministically and offline.

---

## Documentation Impact

None. `onColumnResize` is private, no exported signature changes, and `grep -rn 'column resize' packages/lib/docs/` finds nothing that describes the scheduling. [`packages/lib/docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md) mentions the resize handle only as a `HeaderCell` feature.

---

## Potential Challenges

- **The fixture queues frames of its own.** `makeTable()` calls `getElement(true)`, `setWidth`, `setHeight` and `doLayout()`, several of which schedule a layout. Every new case must `flushFrame()` after building the table and before installing its spy, or the first assertion counts the fixture's frame.
- **A leaked pending frame breaks the *next* test.** The module-level frame handle in `core/Component.ts` only resets when a flush actually runs, so a test that schedules and never flushes stops the following test from capturing its frame. The `afterEach` in step 3 calls `flushFrame()` for exactly this reason — copy it, do not skip it.
- **`scheduleLayout` honours `pauseLayout()` and `doLayout()` does not.** A table that a consumer paused mid-drag now stops updating until `resumeLayout()`, which runs a pass of its own and catches the widths up. No framework code pauses a table, so this is a latent difference rather than an observable one.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) — `onColumnResizeStart` (1305), `onColumnResize` (1344), `getAvailableColumnWidth` (510), `getColumnWidths` / `setColumnWidths` (475 / 486). The only source file that changes.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — the queue: `pendingLayouts` (166), `ensureFlushScheduled` (173), `flushPendingLayouts` (179), `scheduleLayout` (5300), `flushLayout` (5377).
- [`packages/lib/src/typescript/lib/component/input/Slider.ts`](packages/lib/src/typescript/lib/component/input/Slider.ts) — the precedent: `pointermove` wiring (558) and `applyValue` (671).
- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) — what a pass does; `rescaleWidths` (366) and its early return (384) are why intermediate passes are unnecessary. Read; do not edit.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `columnWidthsEqual` (82), `_lastColumnWidths` (121), `updateColumnWidthCache` (780). Read for case 33; do not edit.
- [`packages/lib/src/typescript/lib/core/FirstLayoutGate.ts`](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts) — the startup hold on the first flush.
- [`packages/lib/tests/core/AfterNextLayout.test.ts`](packages/lib/tests/core/AfterNextLayout.test.ts) — the frame-capture harness to copy (33–53).
- [`packages/lib/tests/component/table/ColumnResize.test.ts`](packages/lib/tests/component/table/ColumnResize.test.ts) — the fixture and the private-drag cast (63–83).
- [`plans/table-header-column-virtualization.md`](plans/table-header-column-virtualization.md) — read to confirm no overlap before editing.

---

## Non-Goals

- **The per-column geometry diff.** The three per-column loops in `layout/Table.doLayout` re-lay-out every cell whether or not it moved. `plans/table-header-column-virtualization.md` deletes the parent-row and column-row loops outright, so a diff added to either would be thrown away and would conflict. The footer loop ([layout/Table.ts:287](packages/lib/src/typescript/lib/layout/Table.ts#L287)) is covered by neither plan and stays as it is — report it, do not fix it here.
- **A defensive copy in `Body.updateColumnWidthCache`.** The array aliasing is real but no code mutates the array in place, so `columnWidthsEqual` works today. Case 33 guards it. Adding a `.slice()` would edit a file both queued plans modify, for no behaviour change.
- **Other drag paths.** [`Split.onDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L974) lays out only the two affected panes and [`Accordion.onGutterDrag`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1840) calls its own `layoutSections`; neither runs a full container pass, so neither has this problem. The table's own scrollbar-thumb drag reaches `Body.renderWindow` directly, never `doLayout`. All out of scope.
- **The table's other `doLayout()` calls.** `setColumnVisible` (604), `bindView` (1155), `resetColumns` (1431) and `maybeResampleColumnWidths` (1838) are each driven by a menu click, a mode switch or a store event — one call per gesture, nothing to coalesce.
- **Any throttle, debounce or timer.** The animation-frame queue the framework already owns is the whole mechanism.

---

## Notes

[^drag-precedent]: Two other framework drags were checked first and neither is the right model. [`Split.onDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L974) sets the two panes' sizes and calls `lhs.doLayout()` / `rhs.doLayout()`; [`Accordion.onGutterDrag`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1840) writes the section heights and calls its own `layoutSections`. Both do a *scoped* synchronous pass over exactly the components that moved, which is cheap and needs no queue. `Table.onColumnResize` is the outlier: it runs the whole container pass. Hand-writing a scoped equivalent for the table is the header/footer geometry-diff work the virtualization plan owns, so the remaining option is the queue — and `Slider` establishes that a pointer drag repainted only by the queue is an accepted framework shape. The queue is also what `Split` and `Accordion` themselves use for every non-drag state change (`Split.ts:791`, `Accordion.ts:492`).

[^state-only]: Traced by reading `onColumnResize` end to end. It reads `this._dragEdgeIndex`, `this._columnWidths`, `this._dragLastClientX`, `this.getColumns()`, each column's `getMinWidth()` / `getMaxWidth()`, and `this.getAvailableColumnWidth()`. Of these only `getAvailableColumnWidth()` touches geometry, and it reads `getInnerSize()` — the table's own committed width, written by the table's *parent* layout, minus the scrollbar-track reservation. The table laying itself out does not change it. So a deferred pass cannot change any input to the next move.

[^same-frame]: Chrome delivers continuous input (`mousemove`, `pointermove`) frame-aligned: hardware moves that arrive within one frame are coalesced into a single dispatch, and that dispatch happens in the frame's begin-frame step, before the animation-frame callbacks run. Requesting a frame from inside the handler therefore schedules a callback for the current frame, not the next one. Two consequences worth stating plainly. First, the steady-state saving on a fast table is close to zero — one dispatch per frame was already one pass per frame. Second, the saving is largest exactly where it matters: when a pass overruns the frame budget, input dispatch stops being one-per-frame, and the queue caps the work at one pass per frame instead of letting the drag fall further behind with each move. Coalescing here is backpressure, not a constant-factor win. A previously measured "3000 layouts down to 2" for a 50-tick drag came from a driver firing all fifty moves inside one task; that ratio is a property of the driver and will not reproduce against a real pointer.

[^font-gate]: The gate is armed once per process by the theme manager when it starts the web-font load, and only then ([`holdFirstLayout`](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts#L41)). Its deadline is anchored at the first *held frame*, not at arming, so the 50 ms is a budget of free main-thread time rather than wall-clock spanning startup. A held flush leaves both queues intact and re-arms the frame ([Component.ts:186](packages/lib/src/typescript/lib/core/Component.ts#L186)), so no scheduled work is lost — a drag inside the window accumulates its widths and settles correctly when the gate opens. Today's synchronous `doLayout()` bypasses the gate, but only partly: `Body.renderWindow` checks the gate itself ([Body.ts:707](packages/lib/src/typescript/lib/component/table/Body.ts#L707)), so a drag inside the window already moves the header without the rows following. Trading a half-updated drag for a delayed one, in a window a user cannot realistically reach, is not worth a guard.

[^aliasing]: Checked on master for every writer of the width array. `Table.setColumnWidths` ([Table.ts:486](packages/lib/src/typescript/lib/component/table/Table.ts#L486)) assigns the reference it is given; `layout/Table.doLayout` passes that same reference to `body.renderWindow` ([layout/Table.ts:311](packages/lib/src/typescript/lib/layout/Table.ts#L311)); `Body.updateColumnWidthCache` stores it ([Body.ts:789](packages/lib/src/typescript/lib/component/table/Body.ts#L789)). So `Body._lastColumnWidths` and `Table._columnWidths` are the same object between passes — the trap is real in principle. It is not live, because every producer returns a new array: `out = widths.slice()` in the drag, `.map(...)` in `initializeWidths` and `rescaleWidths`, `[...widths]` in `absorbSlackIntoGreedy`, and the early-return branches hand back the input unchanged (in which case the contents are unchanged too, and a self-comparison is the correct answer). Coalescing changes nothing here: several moves between two flushes each allocate and assign a fresh array, so the flush compares two distinct instances with distinct contents, exactly as one move per flush did.

[^plan-relationship]: `plans/table-header-column-virtualization.md` lists `component/table/Table.ts` in its `touches-shared`, but its own steps touch only the two call sites that move onto new `TableHeader` methods, plus `Header.ts`, `cell/Header.ts`, `layout/Table.ts`, `Body.ts` and the barrel. `plans/table-column-virtualization.md` touches `Body.ts`, `Row.ts` and `cell/Cell.ts`. Neither mentions `onColumnResize`, `onColumnResizeStart`, or `ColumnResize.test.ts`. The one shared file is `component/table/Table.ts`, in a different method, so the edits merge cleanly in either order — hence `touches-shared` on that one path and no `depends-on`. Adding a dependency would serialize three plans behind each other for no reason.
