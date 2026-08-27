---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Table.ts
---

# Table auto-size column re-sampling on data change — Implementation Plan

## Overview

A table configured with `autoSizeColumns: true` samples its store once and then
freezes its column widths forever. The sample happens inside
[`collectCandidates`](packages/lib/src/typescript/lib/component/table/Table.ts#L2462),
which sets `_autoWidthsSampled = true` the first time it reads a non-empty
store; from then on
[`maybeResampleColumnWidths`](packages/lib/src/typescript/lib/component/table/Table.ts#L2700)
returns immediately on every later `load` / `add` / `remove` / `datachange`
event. Rows added after the first load can be too wide for their column, and
rows removed or edited down leave dead whitespace.

This plan removes the one-shot guard so any data change re-derives the widths,
coalesces the resulting layout passes onto the existing animation-frame layout
queue, and adds a per-column pin so a column the user drag-resized keeps the
width the user chose instead of being overwritten by the next sample.

Everything lives in
[`component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts).
The layout manager
([`layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts)) is not
touched.

---

## Architecture Decisions

### The `'update'` event needs no new wiring

An in-cell edit already reaches the resample path. `AbstractStore.notifyRecordChanged`
([AbstractStore.ts:940](packages/lib/src/typescript/lib/data/AbstractStore.ts#L940))
emits `'update'` **and then** `'datachange'`, and `'datachange'` is already
bound to `onSourceStoreChange`. Removing the one-shot guard is by itself enough
to make an edit re-sample; do not add a second trigger in
`onSourceRecordUpdate`.[^update-already-fires]

### Coalesce with `scheduleLayout()`, the framework's existing rAF layout queue

`maybeResampleColumnWidths` calls `this.scheduleLayout()` instead of
`this.doLayout()`. `Component.scheduleLayout`
([Component.ts:6665](packages/lib/src/typescript/lib/core/Component.ts#L6665))
adds the component to a module-level queue drained once per animation frame, so
a burst of store events collapses into one layout pass. No new debounce
primitive is introduced.[^scheduleLayout-precedent]

The per-event work left on the synchronous path is a count check, two field
assignments and a `Set.add` — the expensive part (`collectCandidates`, the
batched text measurements) runs once, inside the frame's single layout pass.

### Keep the empty-`_columnWidths` trigger as the re-measure seam

The resample keeps signalling "re-derive" by assigning `this._columnWidths = []`.
The layout manager re-runs `initializeWidths` whenever the stored width array's
length does not match the visible column count
([layout/Table.ts:178](packages/lib/src/typescript/lib/layout/Table.ts#L178)),
and four existing call sites already drive it that way: `setStore`,
`selectRecord`, `onSourceStoreChange`, and `maybeResampleColumnWidths`
itself.[^no-new-seam]

### A drag-resized column is pinned; every other column re-samples

A new private `Map<string, number>` records the width of every column a resize
drag actually moved, keyed by field name.
`getIntrinsicColumnWidths` returns a pinned width verbatim, ahead of a declared
`width` and ahead of the sampled policy width. Only `resetColumns` and
`setStore` clear the map.[^pin-rule]

Precedence for one column, highest first:

| Column state | Width returned by `getIntrinsicColumnWidths` |
|---|---|
| A drag moved this column's edge | the width the drag left it at, verbatim — no clamp |
| Declares `width: 120` | `120`, clamped to `[minWidth ?? policy.min, maxWidth ?? 400]` |
| `string`/`auto`, auto-size on, sample found | widest sampled text + `CELL_CHROME_PX`, clamped |
| `string`/`auto`, auto-size on, nothing to measure | `null` — stays flex |

Worked example. Four `string` columns start at `[200, 150, 100, 50]`; the user
drags column A's right edge 80px right, which grows A and shrinks C (B is
already at its 100px floor). Then a row with very long `d` text is added:

| Column | Before drag | After drag | Pinned? | After the add's re-sample |
|---|---|---|---|---|
| A | 200 | 280 | yes | 280 — the dragged width |
| B | 150 | 100 | yes | 100 — the dragged width |
| C | 100 | 70 | yes | 70 — the dragged width |
| D | 50 | 50 | no | re-sampled: grows to fit the new row |

### Shrinking is allowed through the same coalesced path

A re-sample recomputes every unpinned column from scratch, so removing or
editing away the longest value narrows the column again. There is no
growth-only ratchet and no separate immediate-grow path.[^shrink-symmetry]

### An empty store still leaves the widths alone

`maybeResampleColumnWidths` keeps its `this._store.getCount() === 0` early
return. Removing the last row leaves the columns at their current widths rather
than collapsing them all to the flex fallback.[^empty-store]

---

## Internal Structure

New field, declared next to `_savedColumnWidths`
([Table.ts:234](packages/lib/src/typescript/lib/component/table/Table.ts#L234)):

```typescript
// Widths the user set by dragging a column edge, keyed by field name. A
// pinned column is exempt from the data-driven re-sample: getIntrinsicColumnWidths
// returns its entry verbatim. Framework-managed bookkeeping, never
// consumer-configurable, so per ARCHITECTURE.md it gets no TableOptions field
// and no public setter. Cleared only by resetColumns and setStore.
private _pinnedColumnWidths: Map<string, number> = new Map();
```

New private accessor, placed next to `getIntrinsicColumnWidths`:

```typescript
private pinnedWidth(col: Column): number | null
```

It returns `null` while `this._displayMode === "rotated"`, so the rotated
projection's `field` / `value` / `filler` columns can neither write nor read a
pin — a source model may legitimately hold a field named `value`, and the two
namespaces must not cross.

---

## Ordered Implementation Steps

1. **Add the pin map.** In
   [Table.ts:234](packages/lib/src/typescript/lib/component/table/Table.ts#L234),
   declare `_pinnedColumnWidths` as shown in `## Internal Structure`, directly
   after `_savedColumnWidths`.

2. **Record pins from the drag.** In `onColumnResize`
   ([Table.ts:2098](packages/lib/src/typescript/lib/component/table/Table.ts#L2098)),
   after the two `distributeDragChain` calls and before
   `this._columnWidths = out;`, add:

   ```typescript
   // A column the drag actually moved is now user-set: the data-driven
   // re-sample must not overwrite it. `out` starts as a copy of `widths`, so
   // an untouched entry is bit-identical and needs no epsilon.
   if (this._displayMode !== "rotated") {
       out.forEach((w, i) => {
           if (w !== widths[i]) {
               this._pinnedColumnWidths.set(columns[i].getField().getName(), w);
           }
       });
   }
   ```

   `columns` is already in scope at
   [Table.ts:2104](packages/lib/src/typescript/lib/component/table/Table.ts#L2104).

3. **Add `pinnedWidth`.** Insert the private accessor immediately after
   `getIntrinsicColumnWidths`:

   ```typescript
   /**
    * Returns the width the user drag-resized this column to, or `null` when
    * the column has never been dragged. Always `null` in rotated mode: the
    * projection's field names live in their own namespace and must never
    * match a pin recorded against a source column of the same name.
    */
   private pinnedWidth(col: Column): number | null {
       if (this._displayMode === "rotated") {
           return null;
       }

       return this._pinnedColumnWidths.get(col.getField().getName()) ?? null;
   }
   ```

4. **Honour the pin in `getIntrinsicColumnWidths`.** In the `columns.map`
   callback at
   [Table.ts:2232](packages/lib/src/typescript/lib/component/table/Table.ts#L2232),
   return the pin first:

   ```typescript
   return columns.map((col, i) => {
       const pinned = this.pinnedWidth(col);

       if (pinned !== null) {
           return pinned;   // the drag already clamped it; re-clamping would
                            // snap a >AUTO_WIDTH_CAP_PX drag back to the cap
       }

       const policy = this.columnWidthPolicy(col, headerPx[i], contentPx[i]);
       const raw    = col.getWidth() ?? policy.preferred;

       if (raw === null) {
           return null;
       }

       return this.clampColumnWidth(raw, col, policy);
   });
   ```

   Update the method's `@returns` doc to state that a drag-resized column
   returns its dragged width verbatim, ahead of a declared `width`.

5. **Clear the pins where manual widths are already discarded.** Add
   `this._pinnedColumnWidths = new Map();` to `resetColumns`
   ([Table.ts:2168](packages/lib/src/typescript/lib/component/table/Table.ts#L2168),
   beside the `_savedColumnWidths` reset) and to `setStore`
   ([Table.ts:697](packages/lib/src/typescript/lib/component/table/Table.ts#L697),
   beside the same reset). Add nowhere else — in particular **not** in
   `maybeResampleColumnWidths`.

6. **Rewrite `maybeResampleColumnWidths`**
   ([Table.ts:2700](packages/lib/src/typescript/lib/component/table/Table.ts#L2700))
   to exactly:

   ```typescript
   /**
    * Re-derives column widths whenever the source store's `'load'` / `'add'` /
    * `'remove'` / `'datachange'` events report data (an in-cell edit arrives as
    * the `'datachange'` that `AbstractStore.notifyRecordChanged` fires right
    * after its `'update'`). Clearing `_columnWidths` is what makes the layout
    * manager re-run `initializeWidths`; columns the user drag-resized keep
    * their width through `_pinnedColumnWidths`.
    *
    * A no-op when auto-size is off (rotated mode included) or the store is
    * empty. The pass is queued onto the animation-frame layout queue rather
    * than run synchronously, so a burst of adds, removes or edits collapses
    * into one layout — mirroring `onColumnResize`.
    */
   private maybeResampleColumnWidths(): void {
       if (!this.isAutoSizeColumns() || this._store.getCount() === 0) {
           return;
       }

       this._columnWidths      = [];
       this._savedColumnWidths = new Map();

       this.scheduleLayout();
   }
   ```

   Three things are deliberately gone: the `_autoWidthsSampled` term of the
   guard, the `_columnWidthTarget = 0` reset,[^keep-target] and the
   `_widthRefs = null` reset.[^keep-widthrefs]

7. **Delete `_autoWidthsSampled`.** Three sites remain after step 6: the field
   declaration at
   [Table.ts:266](packages/lib/src/typescript/lib/component/table/Table.ts#L266),
   the `this._autoWidthsSampled = false;` line in `setStore`
   ([Table.ts:699](packages/lib/src/typescript/lib/component/table/Table.ts#L699)),
   and the `if (rows > 0) { … }` block at the end of `collectCandidates`
   ([Table.ts:2485-2487](packages/lib/src/typescript/lib/component/table/Table.ts#L2485)).
   Delete all three; `collectCandidates` ends with `this._sampledCandidates = best;`.

   Check: `grep -rn '_autoWidthsSampled' packages/lib/src packages/lib/tests`
   — expect zero matches.

8. **Update the two stale doc comments in `Table.ts`.**
   - `onSourceStoreChange`
     ([Table.ts:1287-1288](packages/lib/src/typescript/lib/component/table/Table.ts#L1287)):
     "the hook for the one-shot auto-size re-derive" → "the hook for the
     auto-size re-derive".
   - `ensureWidthReferences`
     ([Table.ts:2628-2631](packages/lib/src/typescript/lib/component/table/Table.ts#L2628)):
     drop `maybeResampleColumnWidths` from the list of sites that clear
     `_widthRefs`, leaving `setStore`, `bindView`, `setColumnVisible` and
     `resetColumns` — every site that can change the visible column set.

   Leave `setColumnWidths`' doc alone: `_savedColumnWidths` still means "last
   committed width", and the new pin map is what means "width the user chose".

9. **Correct the `preserveWidth` JSDoc** in
   [ColumnConfig.ts:90-94](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L90).
   "The column is still sized normally on first render (or after a model swap)"
   now also covers a data-driven re-sample. Rewrite that clause as: "The column
   is still sized normally on first render, after a model swap, and on every
   data-driven re-sample under `autoSizeColumns`". Drag-pinning is what exempts
   a column from the re-sample, not this flag.

10. **Tests** — see `## Verification` for the file and the cases.

11. **Docs** — `docs/components/Table.md` and the changelog; see
    `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `packages/lib/tests/component/table/ColumnWidths.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases assume a spec with `autoSizeColumns: true` and a `string` column,
unless stated otherwise. Cases 1-8 are unit-testable offline; case 9 is
manual-only.

The offline `requestAnimationFrame` records its callback and never fires it
(`tests/dom/TestDOM.ts:662`), so a test that wants the queued pass to run must
call `table.flushLayout()`, or capture and replay frames the way
`ColumnResize.test.ts:34-56` does.

1. **A later load re-derives.** Table sized and laid out over a store holding
   `'x'.repeat(30)`. Then `store.loadData([{ name: 'y'.repeat(200) }])` and
   `table.flushLayout()`. The committed width grows. *(This replaces existing
   case 22, "re-derivation happens once", which asserts the opposite and must
   be rewritten rather than kept.)*

2. **An add widens.** `store.add([{ name: 'z'.repeat(200) }])` on a table whose
   existing rows are short, then `flushLayout()`. The column is wider than
   before the add.

3. **A remove narrows.** Store holds one long row and several short ones.
   Remove the long row, `flushLayout()`. The column is narrower than before the
   remove.

4. **An edit re-derives, with no `'update'` wiring of its own.** Set a
   store-owned record's field to a much longer string (which fires `'update'`
   then `'datachange'`), `flushLayout()`. The column is wider. Assert the same
   result via `store.notifyRecordChanged(record)` directly.

5. **A burst coalesces into one pass.** With `DOM.sink.requestAnimationFrame`
   spied (the `ColumnResize.test.ts` pattern), perform five store mutations in
   one tick. Exactly one frame is captured, and a `doLayout` spy fires once
   after that frame is replayed — not five times.

6. **A dragged column survives the next re-sample.** Drive
   `onColumnResizeStart` / `onColumnResize` through the private handlers to move
   column A's edge, then add a row with long content in every column and
   `flushLayout()`. A's width is exactly what the drag left it at; a column the
   drag never moved has been re-derived.

7. **`resetColumns` releases the pin.** After case 6, call the private
   `resetColumns()`. A's width is the freshly derived one, not the dragged one.

8. **Untouched paths.**
   - `autoSizeColumns` unset: a later load leaves `getColumnWidths()` unchanged.
   - A column with a `renderer`, and a column with `values`, are still never
     sampled (`samplesRecordText` is unchanged) — their widths do not move when
     rows change.
   - A column with a declared `width` still reports that width after a
     re-sample.
   - Rotated mode: with `setDisplayMode('rotated')`, a store change leaves the
     three projection columns inside their declared `[minWidth, maxWidth]`
     bounds exactly as case 25 asserts today.
   - Removing every record (store count reaches 0) leaves the widths unchanged.
   - `expectNoSelfReschedule(table)` from `tests/helpers/layoutStability.ts`
     passes on a settled auto-size table — the re-sample must not re-arm itself
     from inside a layout pass.

9. **Manual.** In the dev app (`npm run dev`, localhost:8015), the MiscPanel
   wide-table demo builds a `TablePanel` over a 45-field model with
   `autoSizeColumns: true` and gives it add/remove toolbar buttons
   (`packages/lib/src/typescript/MiscPanel.ts:380`). Add a row, type a long
   value into a `string` cell and commit it, and remove the row again. Columns
   must resize to match, with no flicker and no per-keystroke jitter. Then drag
   a column edge, add another row, and confirm the dragged column does not move.

---

## Verification

- `npm run typecheck` (or the workspace's `tsc` task) — clean.
- `grep -rn '_autoWidthsSampled' packages/lib/src packages/lib/tests` — zero matches.
- New and amended cases live in
  `packages/lib/tests/component/table/ColumnWidths.test.ts`, extending its
  existing numbered-case style and its local font-metrics fixture. Add a new
  `describe('Auto-size re-sampling on data change')` block for cases 1-8, and
  amend two existing cases in place: rewrite case 22 (see `## Expected
  Behaviour` case 1), and insert `table.flushLayout();` after the `loadData`
  call in case 23 so its assertion still observes the now-queued pass.
  Drive drags through the private `onColumnResizeStart` / `onColumnResize`
  handlers exactly as `ColumnResize.test.ts:86-106` does.
- `npx vitest run packages/lib/tests/component/table/` — the whole table suite,
  since `ColumnWidths`, `ColumnResize`, `PreserveWidth` and `RotatedView` all
  exercise the paths this plan touches.
- `npm run docs:api` — zero warnings (JSDoc edits in steps 4, 8, 9).
- Manual smoke test per `## Expected Behaviour` case 9.

---

## Documentation Impact

No exported symbol is added, removed or renamed, so no barrel, catalog or
sidebar entry changes.

- `packages/lib/docs/components/Table.md:89-94` — the "first rule that applies
  wins" paragraph gains the drag pin as the new top rule.
- `packages/lib/docs/components/Table.md:473-475` — "The derivation runs on
  first layout, a store swap, a reset, and once more after data first arrives"
  is now wrong. Replace with: it runs on first layout, a store swap, a reset,
  and on every source-store data change (load, add, remove, in-cell edit),
  coalesced to at most one pass per animation frame; a column the user
  drag-resized keeps its width.
- `packages/lib/docs/components/Table.md:54` — the `preserveWidth` row's "Does
  not affect first render or a user drag-resize" gains "or a data-driven
  re-sample", matching the JSDoc edit in step 9.
- `packages/lib/docs/reference/changelog/next.md` — add a Components entry
  under the existing non-breaking section describing the re-sample and the
  drag pin.

---

## Potential Challenges

- **A sort or filter now changes widths.** `applyView` emits `'datachange'`, so
  re-ordering the store re-samples the first 50 rows by their new positions and
  a column's width can shift on a sort click. This is inherent to sampling by
  position and is accepted; a consumer who needs a stable width has `width`,
  `minWidth`/`maxWidth`, or a user drag.
- **`getColumnWidths()` reads `[]` for up to one frame** after a store change,
  because the resample clears it synchronously and the layout runs on the next
  frame. Every internal reader degrades safely: `onColumnResizeStart` bails on
  its range check, and `setColumnVisible` falls through to
  `getIntrinsicColumnWidths()`, which is the correct fresh derivation anyway.
- **An edit committed mid-render re-arms a frame.** `Body.createRow` passes
  `record => this._store.notifyRecordChanged(record)` as its commit callback
  ([Body.ts:549](packages/lib/src/typescript/lib/component/table/Body.ts#L549)),
  so a commit during `renderWindow` fires `'datachange'` inside a layout pass
  and schedules another. It terminates — the committed edit is consumed — and
  deferring to the next frame is strictly safer than today's synchronous
  re-entrant `doLayout()`. The `expectNoSelfReschedule` case in
  `## Expected Behaviour` case 8 guards the loop-free property.
- **Existing cases 21 and 23 assume a synchronous re-derive.** Case 21 queries
  `getIntrinsicColumnWidths()` (a pure query, unaffected). Case 23 reads
  `getColumnWidths()` straight after `loadData` and will need a
  `table.flushLayout()` inserted before the assertion.

---

## Critical Files

| File | Why |
|---|---|
| [`component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) | Everything this plan changes. Read `collectCandidates`, `getIntrinsicColumnWidths`, `onColumnResize`, `resetColumns`, `setColumnVisible`, `maybeResampleColumnWidths`. |
| [`layout/Table.ts:143-182`](packages/lib/src/typescript/lib/layout/Table.ts#L143) | The count-mismatch branch that turns `_columnWidths = []` into a re-measure. Not modified — read to confirm the seam. |
| [`core/Component.ts:170-248, 6665`](packages/lib/src/typescript/lib/core/Component.ts#L170) | The rAF layout queue and `scheduleLayout`, the coalescing precedent this plan reuses. |
| [`data/AbstractStore.ts:940`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L940) | `notifyRecordChanged` — proof that `'update'` always co-fires `'datachange'`. |
| [`tests/component/table/ColumnWidths.test.ts`](packages/lib/tests/component/table/ColumnWidths.test.ts) | The suite to extend; case 22 is the one that inverts. |
| [`tests/component/table/ColumnResize.test.ts:34-106`](packages/lib/tests/component/table/ColumnResize.test.ts#L34) | The frame-capture harness and the private-drag driver the new coalescing and pin cases reuse. |

---

## Non-Goals

- **Changing what is sampled.** `SAMPLE_ROWS` (50), `WIDEST_CANDIDATES` (3) and
  the `store.getAt`-by-position sampling stay exactly as they are. Only the
  trigger changes.
- **A per-column "exclude from autosize" config flag.** A drag already pins a
  column, and `width` already overrides the sample; a third opt-out is not
  requested.
- **Changing `preserveWidth` semantics.** It stays a container-resize flag; only
  its JSDoc and doc-table wording are corrected.
- **Rotated mode.** `isAutoSizeColumns()` returns `false` while rotated, and the
  pin is suppressed there too, so the projection's behaviour is unchanged.
- **Tables without `autoSizeColumns`.** Also gated off by `isAutoSizeColumns()`.
- **Animating a width change.** Columns snap to the new width, as they do on
  every other derivation today.

---

## Notes

[^update-already-fires]: `emit('update', …)` appears exactly once in
    `AbstractStore.ts`, at line 941 inside `notifyRecordChanged`, immediately
    followed by `emit('datachange', {})` on line 942 — the same synchronous
    call. `bindSourceStore` already registers `onSourceStoreChange` for
    `'datachange'`
    ([Table.ts:1258](packages/lib/src/typescript/lib/component/table/Table.ts#L1258)),
    so an edit reaches `maybeResampleColumnWidths` today and is stopped only by
    the `_autoWidthsSampled` guard. Adding a second
    `this.maybeResampleColumnWidths()` call in `onSourceRecordUpdate` would fire
    the same trigger twice per edit. It would be harmless — the frame queue
    collapses the pair — but it is dead work and a misleading second wiring, so
    `onSourceRecordUpdate` keeps doing only its quick-search cache eviction.

[^scheduleLayout-precedent]: `onColumnResize` in this same file already ends in
    `this.scheduleLayout()`
    ([Table.ts:2156](packages/lib/src/typescript/lib/component/table/Table.ts#L2156))
    with a comment stating the reason verbatim: "queued onto the animation-frame
    layout queue rather than run synchronously, so every move dispatched within
    one frame collapses into a single pass". A search for other candidates found
    no separate debounce or quiet-period timer anywhere in
    `packages/lib/src/typescript/lib` — the rAF queue in `Component.ts` (plus its
    sibling `pendingVisibility` queue) is the only batching primitive the
    framework has, and it is the right granularity here because the work being
    coalesced *is* a layout pass. A quiet-period `setTimeout` was considered and
    rejected: it would add a second scheduling clock the offline harness does not
    drain the same way, and it would leave the widths visibly stale for the
    duration of the timer.

[^no-new-seam]: An explicit `_columnWidthsStale` flag read by
    `layout/Table.calculate` would make `getColumnWidths()` truthful during the
    one-frame gap, but it adds a second re-measure mechanism next to the
    count-mismatch one that `setStore`, `selectRecord`, `onSourceStoreChange`
    and `setColumnVisible` all already use, and it puts a Table-specific flag
    into the layout manager. Per the repo's pattern-conformance rule, precedent
    wins. The gap's only consequence is listed in `## Potential Challenges`.

[^pin-rule]: Two other rules were considered. **Grow-only past the user's
    width** (a re-sample may widen a dragged column but never narrow it) keeps a
    column readable but silently overrides a deliberate narrowing, and it is
    exactly the ratchet behaviour that produces permanent dead whitespace.
    **Whole-table opt-out** (any drag freezes every column) is simpler but
    over-broad: a user who nudges one column loses auto-sizing on the other
    forty. Per-column pinning is the narrowest rule that satisfies "a manual
    resize is not silently clobbered".

    The pin is recorded for every column the drag *moved*, not only the one
    whose edge was grabbed, because `distributeDragChain` spreads the travel
    across the chain — the user watched those columns take their new widths and
    stopped dragging when they looked right, so all of them are user-set.

    `_savedColumnWidths` cannot serve as the pin map: `setColumnWidths` mirrors
    *every* committed width into it on *every* layout pass
    ([Table.ts:763-777](packages/lib/src/typescript/lib/component/table/Table.ts#L763)),
    so it means "last committed width", not "width the user chose". A separate
    map is required.

    The pinned width is returned without passing through `clampColumnWidth`.
    That clamp caps an unconstrained column at `AUTO_WIDTH_CAP_PX` (400), while
    the drag path caps at `col.getMaxWidth() ?? Number.POSITIVE_INFINITY`
    ([Table.ts:2106](packages/lib/src/typescript/lib/component/table/Table.ts#L2106)).
    Re-clamping would snap any column the user dragged past 400px back to 400 on
    the next data change. The drag already enforced the column's real
    `[minWidth, maxWidth]` envelope, so the value needs no second clamp.

[^shrink-symmetry]: A grow-immediately/shrink-lazily split was considered and
    rejected on two grounds. Mechanically, `initializeWidths` recomputes the
    whole array from `getIntrinsicColumnWidths`; a grow-only variant would need
    a per-column high-water mark that nothing ever releases, so a column widened
    by an outlier that has since been deleted would stay wide for the table's
    lifetime — which is the dead-whitespace half of the reported bug. And
    behaviourally, the two directions are already coalesced onto the same frame,
    so neither is "immediate" in a way the other is not; adding a second timing
    class would buy nothing but a second thing to reason about. A user who wants
    a specific width drags the column, which now pins it.

[^keep-target]: `_columnWidthTarget` records the total width a resize drag grew
    the table to, so the layout manager does not rescale a horizontally-scrolling
    table back to its container width. It is only ever set above zero by
    `onColumnResize`
    ([Table.ts:2154](packages/lib/src/typescript/lib/component/table/Table.ts#L2154));
    `setColumnVisible` merely keeps an already-non-zero value in step. A non-zero
    target therefore implies a drag happened, which is precisely the state this
    plan promises not to clobber — so zeroing it on every data change would undo
    the user's drag-grown table on the next added row. Dropping the reset is
    behaviour-neutral in every other case, because the value is already zero.
    `setStore` still resets it, as it should: a new store means new columns.

[^keep-widthrefs]: `_widthRefs` caches the widest digit glyph and the formatted
    reference date per `(temporal type, showSeconds)` pair. Both are derived from
    the *visible column set* and the font, never from the data, which is why
    `ensureWidthReferences`' own comment lists only column-set-changing sites as
    the ones that must clear it. Every such site — `setStore`, `bindView`,
    `setColumnVisible`, `resetColumns` — clears it itself. Clearing it in
    `maybeResampleColumnWidths` was harmless when that method ran once per store;
    now that it runs on every data change it would force a redundant batched
    text measurement per change. Dropping it is a direct consequence of this
    plan's change to the method's frequency, not unrelated cleanup.

[^empty-store]: With `getCount() === 0`, `collectCandidates` produces an empty
    candidate map and every `string`/`auto` column falls back to its `values`
    labels, its `maxContentLength` probe, or `null` (flex). Removing the last row
    of a table would therefore collapse every content-sized column at once, and
    re-adding a row would expand them again — a visible jolt on a path where the
    user has no data to look at anyway. Keeping the existing early return leaves
    an emptied table looking exactly as it did with its last row in place.

## Implementation Notes

**Case 5 needed two corrections past the plan's literal wording, and ended up
in its own file instead of alongside cases 1-4/6-8 in `ColumnWidths.test.ts`.**

First: "exactly one frame is captured" does not hold. A `store.add()` also
schedules a frame on `Component.ts`'s separate `pendingVisibility` queue
(effective-visibility recompute for the new row), which shares the same
`DOM.sink.requestAnimationFrame` sink as the layout queue this plan coalesces
onto. Spying on that sink counts frames from two independent queues, not
one — draining both is required, and the assertion that matters is that the
*layout* queue's frame produces exactly one `doLayout()` call, not the raw
frame count.

Second, and the reason this case now lives in its own file,
`ColumnAutoSizeCoalescing.test.ts`: the coalescing claim can only be proven by
genuinely capturing and replaying the real `requestAnimationFrame` callback
(`Component.flushLayout()`'s synchronous escape hatch bypasses the queue
entirely and would pass even if every mutation ran its own `doLayout()` —
verified by temporarily reverting `scheduleLayout()` to `doLayout()` in
`maybeResampleColumnWidths` and confirming a spy-based version of this test
still failed against the flushLayout-based one, which stayed green). Genuine
capture-and-replay depends on `Component.ts`'s module-level `rafHandle`
singleton being `null` when the test starts. `ColumnWidths.test.ts` already
has dozens of pre-existing cases that call `scheduleLayout()` (any
autoSizeColumns table reacting to a store event) and settle via
`flushLayout()` without ever draining a captured frame; the offline
`requestAnimationFrame` (`tests/dom/TestDOM.ts`) permanently drops whatever
callback it's given, so the first such case to run in that file leaves
`rafHandle` non-null for the rest of the file's lifetime — confirmed
empirically: even scoping the run to only the new `describe` block's own
cases 1-4 (which also settle via `flushLayout()`) was enough to reproduce the
same poisoning before case 5 ever ran. `DOM.reset()` does not touch this
singleton, and no public API resets it outside of a genuine frame replay.
Case 5 is therefore isolated into its own file with a file-wide
`beforeEach`/`afterEach` rAF spy-and-drain, mirroring `ColumnResize.test.ts`'s
own "layout coalescing" cases (30/31) exactly — the same technique that file
already uses to test the identical class of claim for the drag path. Cases
1-4 and 6-8 stay in `ColumnWidths.test.ts` as the plan specifies; only case 5
needed the isolated environment.
