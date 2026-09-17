# 19 table-core — render-work review

**Summary**

The unchanged-geometry skip works. This slice is the only place in the library
where `applyBounds` + `canSkipUnchangedLayout` actually fire, and a settled
table re-laid out at identical size runs **zero** `Cell.doLayout` and zero
`CellRenderer.doLayout` passes (probe P1/P5/P10/P15). What it does not skip is
everything wrapped *around* that decision:

1. **F19.1 — one empty DOM patch per rendered cell, every pass.** A settled
   14-column table issues **200 sink ops per layout pass, 199 of them carrying
   nothing** (P15); 180 are the trailing `setAutoCommitStyle(true)` of the very
   `applyBounds` calls that just decided to skip. Per frame of a gutter drag,
   per scroll tick, per keypress. HIGH, hot paths 1–4.
2. **F19.2 — `_updateFocusStyle` materialises the whole visible-record list at
   the tail of every render pass.** With a quick search active over 4,000
   records that is **8,000 predicate invocations for one layout pass** (P9,
   P13) — ~480k/s during a gutter drag — and 6 full list materialisations per
   ArrowDown keypress (P16). This is the surviving half of the 2026-08-29
   audit's item 10. HIGH.
3. **F19.3 — the focus sweep's "fallback" is the default.** With nothing
   selected, every pass calls `setStyleState` on **every pooled cell** (105 of
   105, P1/P3; 210 in the wide table) — and the same happens once the selected
   row scrolls out of the pool. HIGH.
4. **F19.4 — `Body` never arms the resize-settle relay its own base class
   provides.** A width-changing frame re-lays out every visible cell *and* its
   renderer (90 + 90 at 5 columns, P4); `deferRowLayoutWhileResizing` is called
   0 times (P11). `Tree`, the other `VirtualRowView` subclass, does arm it.
   HIGH, hot path 1.
5. **F19.5 — one changed record rebinds the whole visible window** (18 of 18
   `Row.setData` for a single `notifyRecordChanged`, P8) — i.e. per committed
   cell edit. MEDIUM-HIGH.

Health-audit item 10 is **half-fixed**: the per-pooled-row `getVisibleRecords()`
call is gone (confirmed at `Body.ts:1716-1725`, pinned by
`VisibleRecordQueryEconomy.test.ts`), the per-pass ones are not. The `range()`
triplication that audit listed is **fixed** — all three sites now call
`Util.range`.

---

## Findings

### F19.1 Every `applyBounds` on a settled cell ends in an empty DOM patch

- **Category**: B (unchanged-value write), D
- **Impact**: HIGH — `rendered rows × rendered columns` per layout pass, per
  scroll tick, per keypress. The largest instance-count multiplier found for
  this shape so far in the campaign.
- **Where**: `component/table/Body.ts:1469` (the cell loop), `:1415` (the
  separator-row cell); `core/Component.ts:3977-3990` (`applyBounds`),
  `:1810-1819` (`setAutoCommitStyle`), `:1822-1829` (`commitElementStyle`).
- **Hot path**:
  - `Split.flushDrag` / window resize → `Table.doLayout`
  - → `layout/Table.doLayout:126` → `calculate` → `commit:287`
  - → `commit:422` `body.renderWindow(availableWidth, columnWidths)`
  - → `Body.renderWindowPass:1237` → `bindAndPositionRows:1390`
  - → per rendered row, per rendered slot: `cells[slot].applyBounds(...)` (`:1469`)
  - → `Component.applyBounds:3978` `setAutoCommitStyle(false)`
  - → `writeBounds` returns `false` (every setter guarded), `canSkipUnchangedLayout()` is `true`, `doLayout()` correctly skipped
  - → `:3986` `setAutoCommitStyle(true)` → `commitElementStyle()` → `InlineStyle.flush()` on an **empty** bag → one `DOM.sink.apply` with nothing in it.
- **Evidence**: probe P15, 14 columns × 140 px in a 600×320 table over 4,000
  records, second `doLayout()` at identical size:
  `{totalSinkOps: 200, emptyApplies: 199, cellApplyBoundsCalls: 180,
  rowApplyBoundsCalls: 0, emptiesMinusApplyBounds: 19}` — the 19 remainder is
  the header's own three `applyBounds` loops (`Header.ts:1628/1646/1670`).
  Corroborated across every scenario: unchanged pass at 5 columns 105 ops /
  104 empty (P1); one-row vertical scroll 111 / 100 (P5); horizontal scroll
  197 / 190 (P10); selection move 223 / 200 (P12); resize frame 372 / 150 (P4).
  The root cause is already reported by slices 01, 03 and 04 independently
  (`InlineStyle.flushDirty` lacks the empty-bag guard its `StyleRule` sibling
  has). This slice supplies the worst multiplier: slice 01 measured 200 empty
  applies over a 201-component tree *once*; here it is 180 **per frame** from
  one component.
- **Proposed change**: the mechanism fix belongs in `InlineStyle.flushDirty`
  (return early on an empty dirty map) — that removes it for every
  `applyBounds`/`setBounds` caller at once. If that is taken elsewhere, the
  local alternative is for `applyBounds` to restore auto-commit without
  flushing when `writeBounds` reported no change and no `doLayout` ran.
- **Risk / blast radius**: the empty-bag guard is a pure no-op removal; nothing
  can observe a patch that sets nothing. `CellLayoutSkip.test.ts` cases 11–15
  pin the *layout* skip, not the flush, so they are unaffected. Every
  `applyBounds`/`setBounds` caller in the library benefits.
- **Proof at implement time**: a probe asserting `emptyApplies === 0` for a
  second `doLayout()` at unchanged size on a realised `Table` — today it is
  199. Then ms/frame on the Loom 2×2 editor-grid horizontal drag with a table
  open.

### F19.2 `_updateFocusStyle` re-materialises the whole visible-record list at the tail of every render pass

- **Category**: D, G (allocation churn); the surviving half of health-audit item 10
- **Impact**: HIGH — O(total records) per frame, per scroll tick and per
  keypress, independent of pool size. Grows with dataset size, which is exactly
  what virtualisation is supposed to make irrelevant.
- **Where**: `component/table/Body.ts:1306` (unconditional call at the end of
  `renderWindowPass`), `:2571-2617` (the method), `:2601`
  (`this.getVisibleRecords().indexOf(this._anchorRecord)`), `:2602`
  (`this._boundIndices.indexOf(anchorIdx)`); `getVisibleRecords` at `:502-506`.
  The same shape again in `_updateActiveDescendant:2634` and
  `resolveFocusedCell:2867`.
- **Hot path**:
  - any of: gutter drag frame → `layout/Table.commit:422` → `Body.renderWindow`;
    wheel/touch → `VirtualScroller` → `Body.onScrollerTick:1056`;
    ArrowUp/Down → `Body.onKeyDown:2850`
  - → `Body.renderWindowPass:1237` (already calls `getVisibleRecords()` at `:1239`, and holds the array)
  - → `:1306` `this._updateFocusStyle()`
  - → `:2601` a **second** `getVisibleRecords()` — `store.getRecords()` (full array copy) plus, when `setRowVisible`/`setQuickSearch` is active, a full `.filter()` over every loaded record
  - → `indexOf` over that array, O(N).
- **Evidence**: probe P2 (unchanged pass, one row selected):
  `{getVisibleRecords: 2, storeGetRecords: 2}`. Probe P9 — quick search over
  4,000 records, **one unchanged layout pass**:
  `{rowVisiblePredicateCallsPerUnchangedLayoutPass: 8000}`. Probe P13 — same,
  one width-changing resize frame: `{rowVisiblePredicateCalls: 8000}`. At 60 Hz
  that is 480,000 predicate invocations per second of drag. Probe P16 — one
  ArrowDown keypress: `{getVisibleRecordsCalls: 6}` = 24,000 records copied.
  `Table.setQuickSearch`'s own JSDoc (`Table.ts:583-588`) already names this
  cost — "`Body.getVisibleRecords()` re-runs the predicate over the whole store
  on every frame, so formatting per pass is not affordable" — and caches the
  *text*, but the per-pass re-filter itself was left in place.
- **Proposed change**: three independent steps, each measurable on its own.
  (a) Give `_updateFocusStyle` / `_updateActiveDescendant` / `resolveFocusedCell`
  an optional `records` parameter and pass the array `renderWindowPass` already
  holds. (b) Replace `records.indexOf(this._anchorRecord)` with an index
  maintained alongside `_anchorRecord` (every writer of `_anchorRecord` already
  knows the index, or can take it from `reduceModifierSelection`'s own lookup).
  (c) Skip the call entirely when nothing it depends on moved this pass —
  `_colWindow`, `_boundIndices`, `_focusedColIndex`, `_anchorRecord` all
  unchanged.
- **Risk / blast radius**: `_updateFocusStyle` is `protected` and `TreeBody`
  calls it after programmatic navigation, so the parameter must stay optional.
  `VisibleRecordQueryEconomy.test.ts` pins "at most 2 calls per scroll tick" —
  the change takes it to 1, tightening rather than breaking it.
- **Proof at implement time**: re-run probe P9/P13 — predicate invocations per
  unchanged pass should fall from 8,000 to 4,000 (step a) and then to 0 (step
  c); `getVisibleRecords` per scroll tick from 2 to 1.

### F19.3 The focus sweep's full-pool fallback is the path a table takes by default

- **Category**: D, G
- **Impact**: HIGH — one guarded call per pooled cell per render pass, whenever
  nothing is selected or the selected row is off-screen. That is a table's
  state until the user's first click, and again after any scroll away from the
  selection.
- **Where**: `component/table/Body.ts:2583-2591`.
- **Hot path**: same as F19.2, then
  - `:2583` `if (this._previousFocusedCell?.getParentComponent())` — false
  - → `:2586-2590` nested loop over `this._rowPool` × `row.getComponents()`, `cell.setStyleState(".focused", false)` on each.
  `_previousFocusedCell` is `null` in three situations, two of them ordinary:
  no anchor record (`:2597` returns before it can be set); the anchor's pool
  slot is not resident (`:2604` `poolSlotIdx < 0` returns early, leaving it
  `null` for the next pass too); and the genuine field-set-rebuild case the
  comment describes.
- **Evidence**: probe P1 and P3, 5-column table, no selection:
  `cellSetStyleState: 105` per pass over 105 pooled cells — i.e. every cell,
  every pass. Probe P2, same table with one row selected: `cellSetStyleState:
  2`. The 14-column table pools 210 cells (P14), so the sweep is 210/pass
  there. `Component.setStyleState:` (core/Component.ts) is guarded, so no DOM
  write results — the cost is 105–210 method calls + `Set.has` per frame, not
  a paint. It still sits directly on hot paths 1 and 2.
- **Proposed change**: track whether the previous pass actually set `.focused`
  on anything (a boolean set where `:2615` assigns `_previousFocusedCell`, and
  cleared once the sweep runs). When the flag is false there is nothing to
  clear and the sweep is provably redundant. Keep the sweep for the real
  fallback (`_previousFocusedCell` non-null but detached).
- **Risk / blast radius**: the `.focused` token is only ever set at `:2614`, so
  the flag is exhaustive. `Cell.retireCell` (`Row.ts:950`) already clears
  `.focused` on a cell leaving the rendered set, which is the case the comment
  at `:2578-2582` worries about; that path is unaffected.
- **Proof at implement time**: probe asserting `cell.setStyleState` calls per
  unchanged pass on an unselected table === 0 (today 105).

### F19.4 A width-changing frame re-lays out every visible cell and renderer; `Body` never arms the settle relay its own base class provides

- **Category**: D, E
- **Impact**: HIGH — hot path 1. 90 `Cell.doLayout` + 90 `CellRenderer.doLayout`
  per frame at 5 columns; 180 + 180 at the 14-column shape, for the whole
  duration of a gutter drag, when only the final width is ever seen.
- **Where**: `component/table/Body.ts:1390-1473` (`bindAndPositionRows` — no
  call to the base's relay); `component/shared/VirtualRowView.ts:603-619`
  (`deferRowLayoutWhileResizing`), `:663-692` (`scheduleResizeSettle` /
  `flushResizeSettle`); the only caller is `component/tree/Tree.ts:1436`.
- **Hot path**:
  - `Split.flushDrag` → `Table.doLayout` → `layout/Table.commit:294` `container.setColumnWidths(...)` → `:422` `body.renderWindow(w, widths)`
  - → `Body.updateColumnWidthCache:1316` → widths differ → `:1328` `invalidateGeom()` (every `_rowGeom[i] = null`)
  - → `renderWindowPass` → `bindAndPositionRows`
  - → `positionRow` writes translate/width/height for all 18 rows
  - → `cells[slot].applyBounds(x, 0, colW, rowHeight)` with a **changed** width → `writeBounds` true → `Cell.doLayout()` → the cell's `Card` layout → `CellRenderer.doLayout()`.
- **Evidence**: probe P4, width 600 → 597 on a 5-column table:
  `{sinkOps: 372, emptyApplies: 150, cellDoLayout: 90, rendererDoLayout: 90}`.
  Probe P11, a five-frame width burst:
  `{deferRowLayoutWhileResizingCalls: 0, …}` — `Body` never calls the relay on
  any frame. (P11's own `cellDoLayout` is 0 only because its columns are pinned
  at `minWidth: 140` and so never rescale; P4 is the representative number for
  flexible columns, which is the default shape.) The
  `virtual-row-view-resize-relayout` plan put this machinery on the *shared*
  base class; only `Tree` opted in, so `Body` carries three dead fields
  (`_rowLayoutOwed`, `_rowWidthMoved`, `_resizeSettleHandle`) plus two dead
  methods for its entire lifetime.
- **Proposed change**: call `deferRowLayoutWhileResizing(widthsChanged)` from
  `renderWindowPass` — `updateColumnWidthCache` already computes
  `widthsChanged` at `:1321` and currently only uses it to invalidate geometry.
  When it returns `true`, still run `positionRow` (the row translate/size is
  cheap and must track the drag) but withhold the per-cell `applyBounds` width
  write, exactly as `Tree._positionRows:1522` does; the settle frame's
  `invalidateGeom() + renderWindow()` catches the cells up once the burst goes
  quiet.
- **Risk / blast radius**: `CellLayoutSkip.test.ts` case 12 ("a body-width
  change re-lays-out only the columns whose width changed") drives a single
  synchronous width change with no frame burst, so it takes the
  `_resizeSettleHandle === null` branch and still relays out immediately —
  matching `ResizeLayoutEconomy.test.ts`'s note that a multi-change burst needs
  a capturing `requestAnimationFrame`. `Header.renderColumnWindow` positions
  its own cells from the same widths and would need the same treatment or the
  header and body visibly disagree mid-drag (→ slice 20).
- **Proof at implement time**: cell `doLayout` calls per frame across a
  five-frame burst — today 90 on each of five frames, target 90 once on the
  settle frame. Then ms/frame on a Loom gutter drag with a table pane open.

### F19.5 One changed record rebinds the entire visible window

- **Category**: D
- **Impact**: MEDIUM-HIGH — per committed cell edit, per
  `store.notifyRecordChanged`, per any `datachange`. Every rebind re-runs each
  cell's renderer `setValue` (and, for a boolean column, dispatches a synthetic
  DOM click — see F19.10).
- **Where**: `component/table/Body.ts:482-485` (`onStoreChange` →
  `_boundIndices.fill(-1)` → `renderWindow()`), subscribed at `:460-471`;
  driven from `Row.commitCellValue:797` → `Body.createRow:545`
  `store.notifyRecordChanged(record)`.
- **Hot path**:
  - user types in a cell, blurs → `Cell.commitEdit` → `Row.commitCellValue:788`
  - → `this._data.set(...)`, then `this._onCellCommit(record)` → `store.notifyRecordChanged`
  - → store fires `'update'` then `'datachange'`
  - → `Body.onStoreChange:482` → `_boundIndices.fill(-1)` → **every** slot's cached data index is destroyed
  - → `renderWindowPass` → `bindAndPositionRows` → `wasRebound` true for all 18 → `row.setData(...)` × 18, `updateRowVisualState` × 18, `applyReadOnlyState` (full row) × 18, `computeRowAria` × 18.
- **Evidence**: probe P8, `notifyRecordChanged(records[1])` on a 21-slot pool:
  `{rowSetData: 18, sinkOps: 163, emptyApplies: 90, renderWindowCalls: 1}`.
  18 is the whole visible window.
- **Proposed change**: `AbstractStore`'s `'update'` event already carries the
  changed record — `Table.onSourceRecordUpdate:1382` consumes exactly that
  payload. Subscribe `Body` to `'update'` too and invalidate only the slot
  whose `_boundIndices` entry maps to that record, leaving the blanket
  `fill(-1)` for the events that really do reshape the list (`load`, `add`,
  `remove`, `sync`, `beforesync`).
- **Risk / blast radius**: `datachange` is also fired for batch commits with no
  per-record identity — those must keep the blanket path, so the narrow path
  must be keyed on `'update'` arriving, not on `'datachange'`. `TreeBody`
  overrides `onStoreChange` to rebuild its flat index first and must keep doing
  so for structural events.
- **Proof at implement time**: probe asserting `Row.setData` calls === 1 for a
  single-record `notifyRecordChanged` (today 18).

### F19.6 `applyRequiredEmptyState` sweeps every rendered cell every pass, including on tables with no required column

- **Category**: D, H
- **Impact**: MEDIUM — 90 iterations per pass at 5 columns, 180 at 14, on hot
  paths 1 and 2. Each iteration does a `Map.get`, an optional predicate call,
  a `record.get(fieldName)` and a guarded setter call.
- **Where**: `component/table/Body.ts:1459` (unconditional, outside the
  `wasRebound || windowChanged` gates around it), `:2497-2510`.
- **Hot path**: `renderWindowPass` → `bindAndPositionRows:1459`
  `this.applyRequiredEmptyState(row, records[dataIndex])` → per cell:
  `_columnConfigs.get(fieldName)`, `config?.requiredPredicate?.(record)`,
  `record.get(fieldName)`, `cells[i].setRequiredEmpty(...)`.
- **Evidence**: probe P1, 5-column table with no `required` column declared
  anywhere: `setRequiredEmpty: 90` per unchanged pass. The method's JSDoc
  (`:2477-2487`) correctly explains why it cannot be gated on `wasRebound`
  (the tint tracks the cell's *value*, which changes on in-place edits), but
  that argument only applies to a table that has a required column at all.
- **Proposed change**: derive a `_hasRequiredColumns` boolean whenever
  `_columnConfigs` is assigned (`setColumnConfigs:828`, `bindViewState:994`)
  and return immediately when it is false. Separately, the value-dependence
  argument names one trigger — a commit cascading back through
  `notifyRecordChanged` — so the sweep could additionally be gated on
  `wasRebound || windowChanged || <a commit landed this pass>`, which
  `commitEditsOutsideWindow:1275` already reports.
- **Risk / blast radius**: `Cell.setRequiredEmpty` is idempotent, so skipping
  identical calls is unobservable. Tests covering the required tint set
  `required: true` on a column and so take the non-skipped path.
- **Proof at implement time**: probe asserting `setRequiredEmpty` calls per
  pass === 0 on a spec with no `required`/`requiredPredicate` (today 90).

### F19.7 `Table.getColumns()` rebuilds two `Set`s and a filtered array on every call, and the layout pass makes three of them

- **Category**: D, I
- **Impact**: MEDIUM — per layout pass (hot path 1) and per raw mousemove
  during a column-resize drag (hot path 3).
- **Where**: `component/table/Table.ts:450-452` (`getColumns`), `:463-467`
  (`getSourceColumns`), `:1245-1256` (`getEffectiveHiddenSet` — `new
  Set(resolvedColumns.map(...))` + `new Set(_hiddenColumns)` + a walk over
  every model field). Callers on the pass: `layout/Table.ts:167` **and
  `:168`** — two separate calls on adjacent lines, the second used only for
  `.length` — and `component/table/Table.ts:783` inside `setColumnWidths`,
  which the layout manager invokes unconditionally at `layout/Table.ts:294`.
  Also `Table.onColumnResize:2173`, per pointer move.
- **Hot path**: `Table.doLayout` → `layout/Table.calculate:167` `getColumns()`
  → `:168` `getColumns().length` → `commit:294` `setColumnWidths` → `:783`
  `getColumns()`.
- **Evidence**: probe P1, one unchanged layout pass: `tableGetColumns: 3`.
- **Proposed change**: `layout/Table.ts:168` should read `columns.length` from
  the value just fetched — a one-line fix with no behaviour change. Beyond
  that, memoise the effective-hidden set / visible-column list on `Table`,
  invalidated at the four sites that can change it (`setColumnVisible:842`,
  `resetColumns:2245`, `setStore:704`, `bindView:1638`) — the same discipline
  the file already applies to `_widthRefs`.
- **Risk / blast radius**: `getColumns()` is public API and `TreeTable`
  inherits it; a memo must be invalidated by anything mutating
  `_hiddenColumns` (only `setColumnVisible` and `resetColumns` do) or
  `_resolvedColumns` (only `setStore` and the constructor) or `_displayMode`.
- **Proof at implement time**: `getColumns` calls per layout pass === 1.

### F19.8 `Table.setColumnWidths` rewrites the whole saved-width map on every layout pass

- **Category**: B, D
- **Impact**: LOW-MEDIUM — per frame, N map writes plus one `getColumns()`.
- **Where**: `component/table/Table.ts:780-794`, called unconditionally from
  `layout/Table.ts:294`.
- **Hot path**: `layout/Table.commit:287` → `:294`
  `container.setColumnWidths(geometry.columnWidths)` → `:783` `getColumns()`
  (see F19.7) → `:785-791` `widths.forEach(... _savedColumnWidths.set(...))`.
  `rescaleWidths:492-494` returns the **identical array object** when the flex
  total has not moved, so on a settled frame every one of those map writes
  stores the value already there.
- **Evidence**: read of `layout/Table.ts:176-182` and `:492-494` plus probe P1
  `tableSetColumnWidths: 1` per pass (× N columns inside).
- **Proposed change**: early-return when the incoming array is the same object
  reference `_columnWidths` already holds — `rescaleWidths` guarantees that
  identity on a no-change pass, and `initializeWidths` always returns a fresh
  array.
- **Risk / blast radius**: `ColumnWidths.test.ts:740` calls `setColumnWidths`
  directly with a fresh array, so it keeps the write path.
- **Proof at implement time**: `_savedColumnWidths.set` calls per settled frame
  === 0.

### F19.9 The rendered column window is twice the number of columns that fit

- **Category**: E (work for content nobody can see)
- **Impact**: MEDIUM — doubles the instance count that F19.1, F19.3 and F19.6
  all multiply by, and doubles the `<td>` count in the render tree, which the
  target engine charges on every ancestor resize.
- **Where**: `component/table/Body.ts:106` (`COLUMN_BUFFER = 2`), `:140-165`
  (`computeColumnWindowSize`), `:224-226`.
- **Evidence**: probe P14 — 14 columns of 140 px in a 600 px viewport:
  `{firstCol: 0, lastCol: 9, renderedColumns: 10, columnsThatActuallyFit: 5,
  cellsPooled: 210, poolRows: 21}`. The arithmetic is `widest(5) + 1 +
  2 × COLUMN_BUFFER(4) = 10`. So 180 of the 210 pooled cells are positioned
  every pass and roughly half of them are off-screen at any offset.
- **Proposed change**: this is a deliberate design (the doc comment explains
  the fixed-slot-count choice, and it is correct), so the lever is the buffer
  constant, not the mechanism: `COLUMN_BUFFER = 1` gives 8 slots instead of 10,
  a 20% cut in every per-pass per-cell cost. The column-slide fast path
  (`Row.reconcileWindowSlide:708`) already makes a one-column entry cheap, so a
  smaller buffer costs little. Worth measuring rather than assuming.
- **Risk / blast radius**: `ColumnWindow.test.ts:17` pins
  `computeColumnWindowSize(lefts, 250) === 8`, and `ColumnWindowSlide.test.ts`
  and `HeaderColumnWindow.test.ts` assume specific window widths — all would
  need their expectations adjusted. `Header` derives its own window from the
  same helper, so the two stay in step automatically.
- **Proof at implement time**: pooled cell count and empty-apply count per pass
  at a fixed table shape; then a wheel-scroll frame-time comparison at
  `COLUMN_BUFFER` 1 vs 2.

### F19.10 Rebinding a boolean cell dispatches a synthetic DOM click through `Event`'s subtree routing

- **Category**: G (listener/event churn)
- **Impact**: MEDIUM — once per rebound row whose boolean value differs, per
  scroll tick and per `datachange` (which rebinds the whole window, F19.5).
- **Where**: `component/table/Row.ts:871` (`cell.setValue(...)`) →
  `component/table/cell/Boolean.ts:137` → `cell/editor/Boolean.ts:138` →
  `component/input/Checkbox.ts:451` `Event.fireEvent(this, "click")`; caught
  and discarded at `component/table/Body.ts:1496`
  (`if (!(e instanceof MouseEvent)) return;`).
- **Hot path**: scroll tick → `bindAndPositionRows:1437` `row.setData(...)` →
  `Row.setData:290` → `bindCell:871` → … → `Checkbox.setSelected` fires a
  `CustomEvent("click")` → `Event`'s window-level dispatcher walks the target's
  ancestor chain (slice 03's finding) → `Body.onSubtreeClick` rejects it.
- **Evidence**: probe P1's first run threw
  `ReferenceError: MouseEvent is not defined` with the stack
  `Row.setData → Row.bindCell → BooleanCell.setValue → BooleanEditor.setValue →
  Checkbox.setSelected → Event.fireEvent → RecordingDOMSink.dispatchEvent →
  Body.onSubtreeClick` — i.e. the dispatch demonstrably happens on a plain
  rebind, not only on a user toggle. `Body`'s own comment at `:1488-1495`
  documents the symptom ("a flurry of synthetic clicks bubbles up here") and
  works around it rather than removing it.
- **Proposed change**: upstream. Either `Checkbox.setSelected` gains a
  no-synthetic-click programmatic path (the comment at `:445-450` says the
  synthetic click exists for legacy `on("action")` consumers, which a pooled
  table cell is not), or `BooleanEditor.setValue` writes the checkbox state
  through a path that does not emit. Then `Body.onSubtreeClick:1496`'s filter
  becomes belt-and-braces rather than load-bearing.
- **Risk / blast radius**: `Checkbox` is slice 15's; `BooleanCell`/
  `BooleanEditor` slice 21/22. `CheckboxMenuRow`/`RadioMenuRow` depend on this
  synthetic click (health audit Priority 1 #12), so the change must be additive
  (an opt-out), not a removal.
- **Proof at implement time**: a probe counting `DOM.sink.dispatchEvent` calls
  during a one-row scroll tick on a table with a boolean column.

### F19.11 One store event fans out to four independent listeners, one of which discards every column width

- **Category**: D, I
- **Impact**: MEDIUM — per committed cell edit on an `autoSizeColumns` table.
- **Where**: `component/table/Body.ts:460-471` (six store events →
  `onStoreChange`), `component/table/Table.ts:1267-1281` (four →
  `onSourceStoreChange`, one → `onSourceRecordUpdate`), `:1312-1322` (five →
  `setDirty(store.hasPendingChanges())`), `component/table/TablePanel.ts:97-103`
  (five → `refreshSyncButtons` → `hasPendingChanges()` again).
- **Hot path**: one `datachange` on a `TablePanel`-hosted table runs:
  `Body.onStoreChange` (full-window rebind, F19.5) + `Table.onSourceStoreChange`
  → `maybeResampleColumnWidths:2804` → `_columnWidths = []` +
  `_savedColumnWidths = new Map()` + `scheduleLayout()` + `Table`'s dirty relay
  (`hasPendingChanges()`) + `TablePanel.refreshSyncButtons`
  (`hasPendingChanges()` a second time). The next frame's
  `layout/Table.calculate:178` then sees `columnWidths.length !== columnCount`
  and runs `initializeWidths` → `getIntrinsicColumnWidths:2310` →
  `measureHeaders` + `measureContent` → `collectCandidates:2566` (a
  `SAMPLE_ROWS = 50` × N-column store scan) and two batched
  `Util.measureTextWidths` calls — two forced text-measurement layouts per
  committed edit.
- **Evidence**: read of the four subscription sites; `maybeResampleColumnWidths`
  is correctly rAF-coalesced (`scheduleLayout`, not a synchronous pass), so the
  cost is one full re-derivation per frame in which any edit lands, not one per
  edit within a frame.
- **Proposed change**: `maybeResampleColumnWidths` already knows the trigger
  set is `load/add/remove/datachange`; a `datachange` that carries no
  structural change cannot alter the *sample* enough to matter unless the
  edited value is longer than the current widest candidate — which
  `_sampledCandidates` (`Table.ts:282`) already records. Gate the re-derive on
  the edited record's text actually exceeding a cached candidate, using the
  `'update'` event's record payload the file already subscribes to at `:1280`.
  Independently, collapse the two `hasPendingChanges()` calls (`TablePanel`
  could read `Table`'s already-computed dirty flag).
- **Risk / blast radius**: only affects tables declaring `autoSizeColumns:
  true`; `ColumnAutoSizeCoalescing.test.ts` pins the coalescing behaviour.
- **Proof at implement time**: `Util.measureTextWidths` calls per committed
  cell edit on an auto-sized table.

### F19.12 The cell-range drag writes on every raw mousemove and is not frame-coalesced

- **Category**: B, G
- **Impact**: LOW-MEDIUM — per raw pointer event during a cell-range drag
  (hot path 3). Bounded by drag duration, not by frame count.
- **Where**: `component/table/Body.ts:2111-2134` (`onCellDragMove`), `:2112-2114`
  (`DOM.sink.clearDocumentSelection()` before any change test), `:2116-2117`
  (`intern` + `locateCellFromTarget`), `:1596-1625` (`locateCellFromTarget` —
  a `_rowPool.find` per DOM ancestor level), `:93-103`
  (`resolveClickedColumn` — `DOM.source.contains` for up to
  `renderedColumns` cells).
- **Hot path**: `mousemove` (viewport listener armed at `:2096`) →
  `onCellDragMove` → unconditional `clearDocumentSelection()` → `intern` →
  `locateCellFromTarget` (≈ 4 ancestor levels × 21 pool rows = ~84
  `getElement()` comparisons) → `resolveClickedColumn` (up to 10
  `DOM.source.contains` calls) → on a changed cell,
  `refreshCellRangeHighlight` → `getVisibleRecords()` + a sweep over every
  bound slot.
- **Evidence**: read of the path. `widenRangeDragIfMultiCell:2186` already
  calls `clearDocumentSelection()` once at the moment the drag widens, so the
  per-move repeat at `:2113` is a re-assertion. There is no rAF coalescing
  here, unlike `DragManager` after `dragmanager-pointer-coalescing`, and unlike
  `Table.onColumnResize:2236` which correctly routes through `scheduleLayout()`.
  `VisibleRecordQueryEconomy.test.ts:219/229` already pins that a move
  resolving to the same cell costs zero `getVisibleRecords()` — the remaining
  per-move cost is the resolution work and the selection clear ahead of that
  early return.
- **Proposed change**: move `clearDocumentSelection()` behind the
  changed-cell test at `:2124-2126` (the `selectstart` suppressor installed at
  `:2187` is what actually prevents a new selection forming; the clear only
  needs to run when something could have been added). Coalesce the whole
  handler onto a rAF the way `DragManager` does. Cache the row→element map
  once per render pass instead of scanning `_rowPool` per ancestor level.
- **Risk / blast radius**: `Body.test.ts` and `CellTextSelection.test.ts` cover
  the drag gesture; coalescing changes event-to-repaint ordering, so those
  tests would need frame draining.
- **Proof at implement time**: sink ops and `locateCellFromTarget` calls for a
  20-mousemove drag that crosses two cells.

### F19.13 Dead surface in `Row` and `Body`

- **Category**: J
- **Impact**: LOW (code health) — but `Row.addColumn` is published API surface
  in the generated docs.
- **Where / grep**:
  - `Row.addColumn` (`component/table/Row.ts:341-345`) — `grep -rn "\.addColumn(" packages/lib/src packages/lib/tests packages/docs/src packages/create-app` → **0 hits**. Zero callers anywhere, including its own class.
  - `Body.setRowIndented` (`component/table/Body.ts:788-792`) — `grep -rn "\.setRowIndented("` over the same roots → **0 hits**. Its own JSDoc admits "currently has no production caller; kept as a standalone setter for symmetry"; `bindViewState:999` writes the field directly.
  - `Body.setRowSeparator` (`:766-770`) — same grep → **7 hits, all in `packages/lib/tests/component/table/Body.test.ts`**. Test-only production surface; same JSDoc admission.
  - `Body`'s `"verticalscroll"` event (`:38`, `:1067`, `:2335`) — `grep -rn "verticalscroll"` excluding `Body.ts` → **1 hit**, `packages/lib/tests/core/FirstLayoutGate.test.ts:389`. No library or app consumer; the JSDoc at `:2324-2326` states it exists speculatively for a hypothetical side-by-side host.
  - `Row.addComponent` (`:355-359`) — an override that narrows the parameter type to `Cell<any>` and otherwise only calls `super`. It adds a compile-time constraint that `renderSeparator:426` then satisfies with a `GroupSeparatorCell` and nothing else needs.
- **Proposed change**: delete `Row.addColumn` and `Body.setRowIndented`; keep
  `setRowSeparator` only if `Body.test.ts` is not rewritten to drive it through
  `bindViewState` (which is how production does it). Keep `"verticalscroll"`
  or delete it with `table-column-pinning` in mind — that plan's design would
  finally give it a consumer (see Cross-slice notes).
- **Risk / blast radius**: `addColumn` and `setRowIndented` appear in the
  generated API docs, so removal is a documented-surface change.

### F19.14 `TablePanel`'s loading spinner is never disposed

- **Category**: J, G
- **Impact**: LOW — one leaked component with a theme subscription per
  `TablePanel` that ever saw a `loadingchange`.
- **Where**: `component/table/TablePanel.ts:38` (`_spinner` field), `:117-119`
  (lazily constructed), `:132-141` (`destructor` — unsubscribes the five store
  listeners, never touches `_spinner`).
- **Evidence**: `_spinner` is assigned with `new ProgressSpinner(24)` and
  mounted via `showOverlay(this._table)`, never through `addComponent`, so the
  base destructor's recursion over `_components` cannot reach it — the exact
  case `docs/concepts/performance.md` § "Disposing Text components" describes
  and that this same file already handles correctly for its store listeners
  and that `Body.destructor:1098-1104` handles correctly for `_editorPool` and
  `_cellText`.
- **Proposed change**: `this._spinner?.dispose()` in `TablePanel.destructor`.
- **Proof at implement time**: a disposal test asserting zero live
  `ProgressSpinner` after `panel.dispose()` following a load cycle — the shape
  `dispose-full-teardown.test.ts` already uses.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `Table` (`Table.ts`, 2821 lines) | "A data-bound table component rendered as an HTML `<table>`" — composes header/body/footer over an `AbstractStore`, owns column resolution, widths, the column menu, rotated mode, export, quick search | `<table>` element; class-tier rule only (no per-instance rule). The column menu and dialog are `LayerManager`-mounted, not children | No `doLayout` of its own — `layout/Table` drives it. Per pass it answers `getColumns()` ×3 (2 `Set` + 1 filter allocation each), `getAvailableColumnWidth()` (1 `getInnerSize`), `getColumnWidths()`, `getColumnWidthTarget()`, `getColumnMinWidth()` per flex column, and takes `setColumnWidths()` (N map writes). Zero DOM writes of its own | over-built (five concerns: composition, width policy, rotated projection, menus/dialog, export/quick-search) | F19.7, F19.8, F19.11 |
| `Body` (`Body.ts`, 3042 lines) | "Virtual-scrolling body for the Table component" — the library's canonical virtual list per `docs/concepts/performance.md` | `<tbody>`; the `VirtualScroller`'s rows container and two `Scrollbar` overlays (raw-appended, not children); three subtree listeners (`click`, `mousedown`, `contextmenu`) for its lifetime; no viewport listener at rest | 1–2 `getVisibleRecords()` (each a full store array copy + optional full filter); 2 `computeVisibleFields()` (filter + sort allocation); 1 `computeColumnWindow` (2 array allocations); `commitEditsOutsideWindow` = `isEditing()` per rendered cell; `applyRequiredEmptyState` per rendered cell; 1 `applyBounds` per rendered cell → 180 empty `DOM.sink.apply` at the 14-column shape; 0 stylesheet ops; 0 forced geometry reads | over-built (virtual list + selection + cell-range clipboard + keyboard nav + editing navigation + ARIA, in one class) | F19.1–F19.6, F19.9, F19.12, F19.13 |
| `Row` (`Row.ts`, 1008 lines) | "A single data row in the table, rendered as a `<tr>`" — creates one typed cell per column in the body's window, owns the per-row cell cache and the slide fast path | `<tr>`; four `ownStyleStates` class-tier rules (`.selected`/`.new`/`.dirty`/`.stripe`), shared, not per instance | `setColumnWindow` returns `false` on an unchanged window with no reconciliation (probe: 18 no-op calls per pass). `doLayout()` is a **no-op** — the `Body` positions its cells directly. `positionRow` (in the base) writes translate/x/width/height only when the cached geometry differs | fits | F19.10, F19.13; `setStyleState`-based tinting is a positive |
| `RowMetrics.tableRowHeight` (25 lines) | "Height in pixels of one table row … shared by `Body`'s pooled rows and `layout/Table`'s header and footer row height" | none | Called 3× per pass in `layout/Table.calculate` (`:197`, `:242`) plus `Body._rowHeight` reads. Each call does a `ThemeManager.getTheme()` + `Util.lineHeightPx()` | fits (the health audit's "row-height formula in three places" is resolved — all three now call this one function) | — |
| `TablePanel` (248 lines) | "A composite panel that combines a `Table` with an add/remove/sync toolbar" | `Border` container + an `HBox` toolbar of four `Button`s | Zero per-pass work of its own | fits | F19.14, F19.11 |
| `computeColumnWindow` / `computeColumnWindowSize` (module functions, `Body.ts:140`/`:188`) | Derive the fixed-width rendered column range for a scroll offset | none (pure) | 2 array allocations per pass; `computeColumnWindowSize` is O(n) over columns with a sliding window | fits (pure, well-tested, also cited as precedent by `DiagramResidency.ts:32`) | F19.9 |
| `resolveClickedColumn` (`Body.ts:93`) | Map a click target to a rendered cell index | none | per pointer event only; up to `renderedColumns` `DOM.source.contains` calls | fits | F19.12 |

---

## Redundant, duplicated and dead code

Items not already covered in Findings.

1. **`computeVisibleFields` is the third copy of one filter+sort.**
   `Body.computeVisibleFields:522-526`, `Row.setColumnFields:390-392` and
   `Header.computeVisibleFields` all write
   `model.getFields().filter(f => !hidden.has(f.getName())).sort((a,b) => a.getOrder() - b.getOrder())`.
   `grep -rn "getFields()" packages/lib/src/typescript/lib/component/table/` →
   the three sites plus four `.filter(f => !this._hiddenColumns.has(...))`
   repeats inside `Body` alone (`:524`, `:2754-2755`, `:2945-2946`). The
   `Body` copy's own comment explicitly declines to extract ("two lines needed
   here only once per tick"), which was true when it was written; it is now
   called twice per tick (`:1209` and `:1260`) and the visible-column *count*
   is re-derived by a fourth and fifth inline filter in `onKeyDown:2754` and
   `navigateFromEditingCell:2945`. One memoised `getVisibleFields()` on `Body`,
   invalidated where `_hiddenColumns`/the model change, removes five
   allocations per pass and two per arrow keypress.
2. **`range()` triplication is fixed.** The 2026-08-29 audit's Priority 2 #9
   listed `range()` as "triplicated verbatim in `Body.ts`/`Row.ts`/`Header.ts`".
   All three now call `Util.range` (`Util.ts:419`) —
   `Body.ts:1213-1214`, `Row.ts:724/732-733`, `Header.ts:941-942`. Closed.
3. **Health-audit item 10 is half-fixed.** `updateCellRangeVisualState`
   (`Body.ts:1716-1738`) now takes `records` as a parameter and uses
   `records[dataIdx]` for its guard; `updateRowVisualState:2519` likewise.
   `VisibleRecordQueryEconomy.test.ts` pins the result. The per-*pass* calls
   the audit did not separate out remain — see F19.2.
4. **`Table.getSelectedRecords()` / `Body.getSelectedRecords()` allocate a
   fresh array per call** (`Body.ts:2274-2276`, spread of a `Set`), and
   `notifySelectionChange:2386-2392` calls it on every selection change after
   already allocating a `before` snapshot `Set` at each of four call sites
   (`:1529`, `:2240`, `:2286`, plus `onRowClick`). Three allocations per
   selection gesture. LOW.
5. **`Body.isFieldClearable:1803-1823` re-derives `Row.createCellForField`'s
   type precedence by hand.** Its own JSDoc says so ("the same test that
   decides…"), but it is a second switch over the same `FieldType` union with
   the same `renderer`/`cellType`/`values` precedence. A drift risk: adding a
   new cell type requires editing both. The shared key already exists —
   `Row.cellKey:822` was widened from `private` to `static` for exactly this
   kind of reuse.
6. **`Body.setStore:924-937` and `Body.bindViewState:990-1010` duplicate the
   rebind+render sequence**, differing only in which fields are written first.
   `bindViewState` is the newer, complete one; `setStore` is a two-field subset
   of it.
7. **`layout/Table.ts:167-168` calls `container.getColumns()` twice on adjacent
   lines**, the second only to read `.length`. See F19.7.
8. **Stale line references in `plans/table-column-pinning.md`.** The plan cites
   `Body.ts:65` for `_selectedRecords` (now `:313`), `:817` for `selectRecord`
   (now `:2239`), and `:433` for `setScrollY` (now `VirtualRowView.ts:196`),
   and `Table.ts:121-136`/`:155-163` for the constructor and scroll mirror (now
   `:302-393` and `:370-372`). It also proposes adding
   `Body.setSelectedRecords(records: ModelRecord[])` as new work — **that
   method already exists** at `Body.ts:2285-2302`. See Cross-slice notes.

---

## Cross-slice notes

- **→ 01 core-component-lifecycle / 03 core-dom-seam-events / 04
  core-panel-scrolling: `InlineStyle.flushDirty`'s missing empty-bag guard.**
  Three slices reported it independently; this slice supplies the worst
  multiplier in the library — 180 empty applies **per frame** from one
  component (F19.1). If that fix is scheduled, table-core is the place to
  measure it.
- **→ 01 / 05: the `canSkipUnchangedLayout` contract does work, and `Cell`
  shows the shape.** Confirming and extending the earlier finding: there are
  **7** `applyBounds` call sites, not eight —
  `layout/Table.ts:389` (the header menu button) and `:405` (footer cells),
  `component/table/Body.ts:1415` and `:1469`, and
  `component/table/Header.ts:1628`, `:1646`, `:1670`. Of those, only the five
  that target `Cell` subclasses get the skip; `layout/Table.ts:389` hands a
  `Button`, which does not override the gate, so that call is `setBounds` plus
  an unconditional `doLayout` (its own comment says as much). Two things make
  the skip pay off here and would have to be replicated for any other
  component adopting it:
  1. **The host caches its own geometry decisions.** `VirtualRowView.positionRow:530`
     and `Body._colWindow`/`_lastColumnWidths` mean the arguments handed to
     `applyBounds` are stable across passes. A manager that recomputes a
     rectangle from live reads would never produce an unchanged one.
  2. **`Cell.clampsToContentSize()` returns `false`** (`cell/Cell.ts:225-227`).
     This is the direct answer to slice 01/05's finding that 44% of a pass's
     cost is `clampWidth`/`clampHeight` running two content-size aggregations
     per axis: probe P1 records **0 `getMinSize` and 0 `getMaxSize` calls
     across 90 `applyBounds` calls**. Any component that is force-sized by its
     parent — which is most of them under `Fit`, `Border`, `Split`, `Tab` —
     could opt out the same way, and the per-axis clamp cost disappears with
     it. That is a bigger lever than the skip itself.
  The honest limit on the skip: it removes the child's `doLayout()` and nothing
  else. The write path (four guarded setters), the auto-commit toggle and its
  empty flush all still run. `applyBounds` on a settled cell is not free — it
  is one wasted DOM patch (F19.1) plus four guarded setter calls.
- **→ 20 table-header-columns-filters:** `Body._updateFocusStyle:2595` calls
  `TableHeader.setFocusedColumn` **unconditionally at the end of every render
  pass** (probe P1: `headerSetFocusedColumn: 1` per pass), and
  `setFocusedColumn` has no same-value guard — it always runs
  `applyFocusedColumn()`, a loop over every rendered header cell calling
  `setColumnFocused`. Adding a `if (colIndex === this._focusedCol) return;`
  guard there removes a per-frame loop. Also: any settle-relay work for the
  body (F19.4) must be mirrored in `Header.renderColumnWindow` or the two
  disagree mid-drag.
- **→ 22 table-editors-treetable-export:** `TreeBody` overrides
  `onStoreChange`, `computeRowAria`, `afterRowBound`, `getVisibleRecords` and
  `createRow`, so every finding here that changes one of those seams (F19.2's
  `records` parameter, F19.5's targeted invalidation) lands on `TreeBody` too.
  `TreeBody.getVisibleRecords` returns a depth-flattened list it rebuilds
  itself, so F19.2's cost profile there is different and should be measured
  separately.
- **→ 21 table-cells-renderers / 15 inputs:** F19.10 — `Checkbox.setSelected`
  fires a synthetic `CustomEvent("click")` on every programmatic value change,
  which a pooled `BooleanCell` triggers on every rebind. The fix is upstream.
  Note `CheckboxMenuRow`/`RadioMenuRow` depend on that synthetic click (health
  audit Priority 1 #12), so it must become opt-out rather than being removed.
- **→ 04 core-panel-scrolling:** `Body` calls `setOverflow("hidden")` in its
  constructor (`Body.ts:348`) and delegates all scrolling to `VirtualScroller`,
  so slice 04's "a settled overlay `Panel` handed its own unchanged rectangle
  still runs the full live remeasure" finding does **not** apply here — the
  table body is not a `Panel` and issues no `getScrollMetrics()`. Probe P1/P11
  record zero non-`apply` sink ops on an unchanged pass, confirming no forced
  read. That is a positive to protect.
- **→ 03 core-dom-seam-events:** `Body.init:1037-1044` installs three subtree
  listeners (`click`, `mousedown`, `contextmenu`) for the body's lifetime. None
  is `mousemove`, so slice 03's per-`mousemove` ancestor-walk hazard does not
  bite, but every `mousedown` anywhere in the document now walks the target's
  ancestor chain in any app containing a `Table`. `SplitGutter` is no longer
  the only component registering a subtree pointer listener in a Loom shell.
- **Open plan `plans/table-column-pinning.md` — three notes.**
  (1) It proposes adding `Body.setSelectedRecords(records)`; that method
  already exists (`Body.ts:2285`), so that step is done.
  (2) Its line references into `Body.ts` and `Table.ts` are all stale (see
  Redundant #8) — the files have roughly doubled since it was drafted, and the
  `Header`/`Body` column-window reconcilers, the cell cache, the slide fast
  path, cell-range selection and rotated mode all post-date it.
  (3) **Performance warning:** `PinnedTable` owns two full `Table` instances
  over one store, so every per-pass cost in this report **doubles** under
  pinning — two `Body.renderWindowPass` runs, two `_updateFocusStyle` calls
  (two full `getVisibleRecords()` materialisations, F19.2), two empty-apply
  fans (F19.1), two `applyRequiredEmptyState` sweeps. Its own claim that the
  right body "has `overflow-y: auto` (today's default)" contradicts
  `Body.ts:348`'s `setOverflow("hidden")` and needs re-verification. This plan
  should land **after** F19.1–F19.4, not before.
- **Open plan `plans/table-cell-alignment-override.md` — not this slice.**
  Despite the name, it is entirely about the Markdown table dialect
  (`markdownAttributes.ts`, `markdownTableExtension.ts`,
  `markdownTableTransformer.ts`, `MarkdownEditor.ts`) — slices 24 and 25. It
  touches no file in `component/table/`. It is also gated on two unmerged
  branches (`table-column-alignment-context-menu`,
  `markdown-rich-formatting-extension`) per its own front-matter.

### Positives worth protecting

A plan must not regress any of these:

- **The unchanged-geometry skip genuinely fires.** Zero `Cell.doLayout` and
  zero `CellRenderer.doLayout` on an unchanged layout pass (P1), a one-row
  vertical scroll (P5), and a horizontal scroll that does not move the column
  window (P10). Pinned by `CellLayoutSkip.test.ts` and
  `ScrollRebindLayoutEconomy.test.ts`.
- **`Cell.clampsToContentSize() === false`** — 0 `getMinSize` / 0 `getMaxSize`
  across 90 `applyBounds` calls (P1).
- **Zero stylesheet mutations on every per-frame path.** Probe P1, P5, P10 and
  P11 record `byOp: {apply: N}` only — no `insertRule`, `deleteRule`,
  `ensureStyleRule` or `setRuleStyles`. Probe P12 (five successive selection
  moves): `ruleOps: 0` on every move. Row tinting goes through
  `Component.setStyleState` class tokens against shared `ownStyleStates` rules
  (`Row.ts:83-103`), and `Cell.setBaseBackground` deliberately routes through
  `cacheStyleValue` + a shared value-class rule rather than materialising an
  `#id` rule per recycle. Given that a rule mutation costs ~195 ms/frame in the
  target engine, this is the single most valuable property in the slice.
- **Every per-rebind cell setter is guarded** — `setRequiredEmpty`,
  `setRangeSelected`, `setReadOnly`, `setBaseBackground` all short-circuit on
  an unchanged value, and `Aria.setAttribute` does too. Slice 18's unguarded
  `setSelected`/`setFocused` class-attribute rewrite has **no counterpart
  here**: `Body.updateRowVisualState:2538` uses `setStyleState`, which is the
  precedent slice 18 asked for.
- **Scroll rebinding is minimal.** A one-row vertical tick calls
  `Row.setData` exactly once (P5), not once per pool slot;
  `alignPoolWindow` rotates the bookkeeping arrays so only the entering row
  rebinds.
- **The column-window slide fast path works.** `Row.reconcileWindowSlide:708`
  touches only the `|delta|` entering and departing cells; the per-row cache
  (`_cellCache`) makes a narrow-then-widen cycle allocate nothing.
- **`Body` issues no forced geometry read on any hot path.** No
  `getBoundingClientRect`, no `offset*`/`client*`, no `getComputedStyle`
  anywhere in the render pass. Zero non-`apply` sink ops on an unchanged pass.
- **`onColumnResize:2236` and `maybeResampleColumnWidths:2812` are correctly
  rAF-coalesced** via `scheduleLayout()` rather than running synchronously.
- **No viewport listener at rest.** `Body` arms `mousemove`/`mouseup`/
  `selectstart` viewport listeners only for the duration of a cell-range drag
  and removes them on `mouseup` (`:2143-2148`), so slice 03's
  `getViewportSize()` per-`resize`-listener cost is not multiplied here.

---

## Suggested plan grouping

**Plan A — "table per-pass write and query economy"** (F19.1 body-side, F19.2,
F19.3, F19.6, F19.7, F19.8). One coherent change set: stop the render pass
doing work whose inputs did not move. All six are internal to
`Body.renderWindowPass` / `_updateFocusStyle` / `Table.getColumns` /
`Table.setColumnWidths`, share one probe harness, and are individually
measurable as counters (`getVisibleRecords` per tick, `setStyleState` per pass,
`setRequiredEmpty` per pass, `getColumns` per pass). Depends on nothing.
Biggest single win: F19.2 removes an O(total-records) term from the frame.
**F19.1's real fix belongs to the `InlineStyle.flushDirty` plan** (slices
01/03/04) — this plan should cite it and supply the measurement, not
re-implement it locally.

**Plan B — "table body resize-settle relay"** (F19.4 alone). Its own plan: it
changes when cells are laid out, not whether, so it needs its own before/after
frame-time measurement and its own test-harness frame capture. Must be
coordinated with slice 20's `Header.renderColumnWindow`, which positions header
cells from the same width array — either both defer or neither, or the header
and body visibly disagree during a drag. Depends on Plan A only for the shared
probe harness, not semantically.

**Plan C — "targeted row rebinding on a single-record change"** (F19.5, F19.11).
Both key on routing the store's `'update'` payload rather than treating every
`datachange` as a full reshape. `Table.onSourceRecordUpdate:1382` already
consumes exactly that payload, so the seam exists. Touches `TreeBody`'s
`onStoreChange` override, so it needs slice 22's input. Independent of A and B.

**Plan D — "column-buffer tuning"** (F19.9 alone). One constant plus test
expectations, but it needs a real measurement to justify — it is a
render-fidelity-vs-cost trade, not a bug fix. Should run **after** Plan A, so
the measurement shows the buffer's true marginal cost rather than being masked
by per-cell waste Plan A removes. Shared with slice 20 (`Header` derives its
window from the same helper).

**Plan E — "cell-range drag coalescing"** (F19.12). Follows the merged
`dragmanager-pointer-coalescing` precedent exactly; small, self-contained,
belongs with any other pointer-coalescing work rather than on its own.

**Ride along with a neighbour (too small to plan):**
- F19.13 (dead `Row.addColumn`, `Body.setRowIndented`, and the decision on
  `setRowSeparator` / `"verticalscroll"`) and Redundant #1 (the fifth copy of
  the visible-fields filter), #4, #5, #6, #7 — attach to Plan A, which is
  already editing all of those files.
- F19.14 (`TablePanel._spinner` disposal) — attach to any disposal/teardown
  plan, or to Plan C, which touches `TablePanel`'s store listeners.
- F19.10 (the synthetic click on boolean rebind) — belongs to whichever plan
  takes `Checkbox.setSelected` (slice 15); this slice supplies the evidence
  and the multiplier, not the fix.

**Ordering:** A → B → C can run in parallel after A's harness lands; D after A;
E anywhere. `plans/table-column-pinning.md` should be re-based on the current
`Body.ts`/`Table.ts` and scheduled after A and B, since it doubles every
per-frame cost those two remove.

---

*Probes for this report live in
`.worktrees/_probes/19-table-core/` (`pass.test.ts`, `pass2.test.ts`,
`pass3.test.ts`, `pass4.test.ts`), run with
`PROBE_DIR=.worktrees/_probes/19-table-core npx vitest run --config .worktrees/_probes/vitest.probe.config.ts`.
No file in the main tree was modified.*
