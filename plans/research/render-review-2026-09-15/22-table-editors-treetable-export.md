# 22 table-editors-treetable-export — render-work review

**Summary**

The cell-editor pool works: a steady-state editor open costs **8 sink ops and
zero stylesheet-rule writes** (probe E2/X4), a close costs 5 and releases
cleanly (E3), and an open editor adds **nothing** to a settled pass or a scroll
tick beyond the base body's own cost (E5). `TreeBody` likewise adds **zero**
per-pass DOM work: its settled pass is byte-for-byte the flat `Body`'s — 105
sink ops, 0 rule ops, 0 forced reads (T1 vs T2). Everything expensive in this
slice sits on discrete interactions, and one of it is a correctness bug.

1. **F22.1 — an open editor survives its pool row being rebound and then
   commits onto the wrong record.** A vertical scroll rebinds the slot; the
   editor stays open holding the user's text; the next blur/Enter writes it to
   the record the slot now holds and leaves the edited record untouched (probe
   C1: `WROTE_TO_WRONG_RECORD: true`). `commitEditsOutsideWindow` guards the
   *column* axis only. Data corruption, HIGH, hot path 2.
2. **F22.2 — one committed cell edit on a `TreeTable` runs two full O(N) index
   rebuilds, two full flattens, two whole-window rebinds and 36 drag-and-drop
   re-registrations** (D4, T6). 0.63 ms per rebuild+flatten at 4,000 records in
   Node with no DOM (A2), synchronous inside the commit. HIGH.
3. **F22.3 — a collapse re-mints one `Glyph` per visible branch row and never
   disposes the replaced one.** `collapseAll` on a 200-root tree: **36
   stylesheet-rule mutations**, 18 `createElement` + 72 `createElementNS`, and
   18 leaked `Glyph`s with their `#id` rules (D8, T5). Rule mutation is the
   most expensive write in the target engine. HIGH, hot path 5.
4. **F22.4 — `TreeBody` inherits `Body`'s missing resize-settle relay.**
   `deferRowLayoutWhileResizing` is called **0 times** across a five-frame
   width burst; 54 cell `doLayout` per frame (T9, D6). Confirms slice 19's
   F19.4 for the subclass. HIGH, hot path 1.
5. **F22.5 — `TreeBody.getVisibleRecords()` allocates a fresh N-element array
   on every call**, and the base calls it 6–10× per keystroke: **24,000 record
   copies per ArrowDown and 32,000–40,000 per Tab/Enter** on a 4,000-row
   expanded tree (D1, D2, D7). The memo is free — `_flatRows` only changes in
   `flatten()`. HIGH, hot path 4.

Health-audit 2026-08-29 lists **nothing** for this slice (grepped for
`TreeTable`/`TreeBody`/`CellEditor`/`TableExporter`/`TablePanel`: 0 hits).

---

## Findings

### F22.1 An open cell editor survives a pool-row rebind and commits onto the wrong record

- **Category**: H (function/implementation mismatch — the editor lifecycle's
  own contract is not upheld); correctness, not performance
- **Impact**: HIGH — silent data corruption. Reachable by wheel, keyboard
  reveal, scrollbar drag, or any store event that moves rows, while a cell
  editor is open. Hot path 2.
- **Where**: `component/table/cell/editor/CellEditorPool.ts:291-307`
  (`acquire` — no notion of which record the borrowing cell is bound to);
  `component/table/cell/Cell.ts:681-694` (`commitEdit` — emits `"commit"` with
  no record identity); `component/table/Row.ts:283-296` (`setData` — rebinds
  every cell's renderer without consulting `cell.isEditing()`);
  `component/table/Row.ts:788-801` (`commitCellValue` — writes to
  `this._data`, i.e. whatever the row holds **now**);
  `component/table/Body.ts:1347-1367` (`commitEditsOutsideWindow` — guards the
  column axis and only the column axis).
- **Hot path**:
  - `Cell.startEdit:635` → `pool.acquire(key, cell)` → editor parented, focused
  - user types → `StringEditor.onInput` caches the text on the shared editor
  - wheel / `setScrollY` → `VirtualScroller` → `Body.renderWindow`
  - → `renderWindowPass:1237` → `bindAndPositionRows:1390`
  - → `alignPoolWindow(firstRow)` rotates the pool bookkeeping
  - → `wasRebound` true for the editing slot → `row.setData(records[dataIndex])` (`:1437`)
  - → `Row.setData:283` rebinds every renderer; **the open editor is not consulted and not committed**
  - user blurs / presses Enter → `Cell.commitEdit:681` → `emit("commit", editorValue)`
  - → `Row.commitCellValue:788` → `this._data.set(field, value)` — `_data` is the **new** record.
- **Evidence**: probe C1, 4,000-record table, editor opened on pool row 0,
  `setValue('TYPED')`, then `setScrollY(rowHeight × 40)`:
  `{stillEditingAfterScroll: true, rowRecordAtOpen: "R1",
  rowRecordAfterScroll: "TYPED", rowRebound: true,
  WROTE_TO_WRONG_RECORD: true, editedRecordUntouched: true}`.
  Probe D3 independently shows the same slot transition
  (`reference value 1` → `reference value 43`) with the editor still open and
  still holding the typed text. The asymmetry is explicit in the source:
  `Body.ts:1332-1338`'s comment says the column-window commit "mirrors the
  precedent `Row.setColumnWindow` sets … commit before discarding" — the row
  axis never received the same treatment.
- **Proposed change**: `bindAndPositionRows` already computes `wasRebound` per
  slot (`Body.ts:1432`). Before `row.setData(...)`, commit any cell on that row
  that reports `isEditing()`, exactly as `commitEditsOutsideWindow` does for a
  departing column — or, if committing mid-scroll is undesirable, cancel the
  edit and release the editor. Either is correct; silently rebinding under a
  live editor is not. The re-entrancy the commit causes is already handled:
  `renderWindow`'s `_reconciling` guard (`:1150`) drops the nested pass.
- **Risk / blast radius**: touches `Body.bindAndPositionRows`, which is slice
  19's. `CellEditorPool.styleRuleDisposal.test.ts` and
  `tests/component/table/cell/Cell.test.ts` cover open/commit/cancel but none
  drives a scroll while editing, so nothing pins today's behaviour.
  `TreeBody` inherits the same path unchanged.
- **Proof at implement time**: probe C1 asserting
  `WROTE_TO_WRONG_RECORD === false` and either
  `editedRecordReceivedTheValue === true` (commit-first) or
  `cell.isEditing() === false` after the scroll (cancel-first).

### F22.2 One committed cell edit on a `TreeTable` runs two full index rebuilds, two full flattens and two whole-window rebinds

- **Category**: D (work recomputed with unchanged inputs), G
- **Impact**: HIGH — per committed cell edit, per `notifyRecordChanged`, per
  drag-reparent, per `addRow`. O(total records) twice, synchronously, inside
  the keystroke that commits. This is slice 19's F19.5 multiplied by the tree
  index.
- **Where**: `component/table/TreeBody.ts:493-498` (`onStoreChange` — rebuilds
  and re-flattens unconditionally before delegating), `:910-938`
  (`rebuildIndex` — clears two maps and makes two full passes over
  `store.getRecords()`), `:945-978` (`flatten` — full recursive walk);
  `component/table/Body.ts:460-471` (six store events → one handler),
  `:482-485` (`_boundIndices.fill(-1)` + `renderWindow`).
- **Hot path**:
  - `Cell.commitEdit:681` → `Row.commitCellValue:797` → `record.set(...)`
  - → store fires `'datachange'` → `TreeBody.onStoreChange:493`
  - → `rebuildIndex()` — `_byId.clear()`, `_childIds.clear()`, then **two** loops over all 4,000 records
  - → `flatten()` — full recursive walk of the expanded subtree
  - → `super.onStoreChange()` → `_boundIndices.fill(-1)` → `renderWindow()`
  - → 18 × `Row.setData` + 18 × `installRowDnD` (teardown + 2 `DragManager` registrations each)
  - → `Row.commitCellValue:798` then calls `this._onCellCommit(record)` → `store.notifyRecordChanged` → the **whole sequence a second time**.
- **Evidence**: probe T6, 4,000-record tree, one `notifyRecordChanged`:
  `{rebuildIndexCalls: 2, flattenCalls: 2, rowSetData: 36, installRowDnD: 36,
  sinkOps: 363, emptyApplies: 180, recordsCopied: 400}`. Probe D4 separates the
  two triggers: `record.set()` alone → `{rebuildIndex: 1, flatten: 1}`;
  `notifyRecordChanged` → another `{rebuildIndex: 1, flatten: 1}`. Probe A2
  times the pair at **0.627 ms per call** on a 4,000-record fully-expanded tree
  under Node/V8 with no DOM — 1.25 ms of pure JS per committed edit before any
  DOM work, growing linearly with store size.
- **Proposed change**: two independent steps.
  (a) Key the rebuild on what actually changed: a `'datachange'` that does not
  touch `idField` or `parentField` cannot alter `_byId`/`_childIds` at all, and
  cannot alter `_flatRows` either. Subscribe `TreeBody` to the store's
  `'update'` event (which carries the changed record —
  `Table.onSourceRecordUpdate:1382` already consumes exactly that payload) and
  skip `rebuildIndex`/`flatten` when neither structural field moved.
  (b) Deduplicate the double fire: `Row.commitCellValue` writes the record
  *and* calls `notifyRecordChanged`, so the store emits twice for one edit.
- **Risk / blast radius**: `TreeBody.test.ts` drives expansion through
  `setExpanded`/`expandToDepth`/`collapseAll`, not through store events, so the
  structural-event path stays covered. A reparent genuinely changes
  `parentField` and must keep the full rebuild. This finding shares its seam
  with slice 19's Plan C — the `'update'`-payload routing has to land in both
  `Body.onStoreChange` and this override together.
- **Proof at implement time**: probe T6/D4 asserting
  `rebuildIndexCalls === 0` and `flattenCalls === 0` for a `datachange` on a
  non-structural field (today 2 each), and `rowSetData === 1` (today 36).

### F22.3 Collapsing re-mints a `Glyph` per visible branch row and never disposes the replaced one

- **Category**: C (stylesheet-rule write on an interaction path), G, J (leak)
- **Impact**: HIGH — 30 rule mutations per single collapse, 36 per
  `collapseAll`, each a full-document restyle in WebKitGTK (~195 ms/frame at
  21k nodes per `docs/concepts/performance.md`); plus one permanently leaked
  `Glyph` (5 elements + one `#id` rule) per swap, unbounded over a session.
  Hot path 5.
- **Where**: `component/table/cell/renderer/TreeCell.ts:221-238`
  (`refreshToggle` — `removeComponent(this._toggle)` with no `dispose()`,
  then `new Glyph(...)`), reached from `:176-190` (`setTreeState`), driven from
  `component/table/TreeBody.ts:580-588` (`afterRowBound` → `setTreeState`).
  The disposing precedent is `component/tree/TreeRow.ts:229-231`
  (`this._toggle.dispose()` before the swap) and `:372` — which
  `TreeCell.ts:216-219`'s own comment claims to be "matching".
- **Hot path**:
  - click a toggle / `ArrowLeft` / `collapseAll`
  - → `TreeBody.setExpanded:320` → `flatten()` → `invalidateRowBindings()` → `renderWindow()`
  - → `bindAndPositionRows:1457` → `TreeBody.afterRowBound:580`
  - → `TreeCellRenderer.setTreeState:176` — the triple changed for every branch row in the window
  - → `refreshToggle:221` → `removeComponent(old)` (**not disposed**) → `new Glyph(...)` → `addComponent`
  - → per new `Glyph`: 1 `createElement` + 4 `createElementNS` + 4 `appendChild` + 1 `setId` + 1 `ensureStyleRule` + 1 `setRuleStyles`.
- **Evidence**: probe D8, 200-root tree —
  `collapseAll: {sinkOps: 900, ruleOps: 36, byOp: {createElement: 18,
  createElementNS: 72, appendChild: 72, setId: 18, ensureStyleRule: 18,
  setRuleStyles: 18}}`; `expandAll: {sinkOps: 424, ruleOps: 2}` (the asymmetry
  is real — expanding changes one row's triple, collapsing flips every visible
  branch row's caret). Probe T4, one branch collapse:
  `{sinkOps: 780, ruleOps: 30, createElement: 15, createElementNS: 60}`.
  Probe T5 pins the leak directly:
  `{toggleIdBefore: "a6ddac12-…", toggleIdAfter: "c060acc4-…",
  oldToggleDisposeCalls: 0, oldToggleStillHasElement: true}`.
- **Proposed change**: two levels. The local fix is one line —
  `this._toggle.dispose()` in `refreshToggle` before dropping the reference,
  matching `TreeRow.ts:230`; that removes the leak and the `deleteRule` debt
  but not the churn. The real fix is upstream and already named by slice 18: a
  `Glyph.setName()` that mutates the existing glyph's path data in place would
  take an expand/collapse from 30–36 rule ops to **zero**, here and in `Tree`.
- **Risk / blast radius**: `TreeCellRenderer.test.ts` asserts `getContentX()`
  and toggle presence, not glyph identity, so disposal is unobservable to it.
  `tests/component/dispose-full-teardown.test.ts` would catch a regression the
  other way. The file is slice 21's; the driver is this slice's — see
  Cross-slice notes.
- **Proof at implement time**: probe D8 asserting `ruleOps === 0` for a
  `collapseAll` (today 36), and a disposal test asserting zero orphan `Glyph`
  instances after N expand/collapse cycles.

### F22.4 `TreeBody` never arms the resize-settle relay its base class provides

- **Category**: D, E
- **Impact**: HIGH — hot path 1. 54 cell `doLayout` per width-changing frame
  for the whole duration of a gutter drag, when only the final width is ever
  seen.
- **Where**: `component/table/TreeBody.ts` (no override; inherits
  `component/table/Body.ts:1390-1473`, which never calls the relay);
  `component/shared/VirtualRowView.ts:603-619`
  (`deferRowLayoutWhileResizing`), `:663-692` (`scheduleResizeSettle` /
  `flushResizeSettle`). The only caller in the library is
  `component/tree/Tree.ts:1436`
  (`grep -rn "deferRowLayoutWhileResizing" packages/` → 1 production caller,
  1 definition, 1 test, 1 `.d.ts`).
- **Hot path**: identical to slice 19's F19.4 —
  `Split.flushDrag` → `Table.doLayout` → `layout/Table.commit:422`
  → `Body.renderWindow` → `updateColumnWidthCache:1316` → `invalidateGeom()`
  → `bindAndPositionRows` → `cells[slot].applyBounds(…, changed width)`
  → `Cell.doLayout()` → the cell's `Card` → renderer `doLayout`.
- **Evidence**: probe T9, width 600 → 597 on a `TreeTable`:
  `{sinkOps: 314, emptyApplies: 118, deferRowLayoutWhileResizingCalls: 0,
  cellDoLayout: 54, cells: 105}`. Probe D6, five-frame burst:
  `{sinkOps: 1570, emptyApplies: 650, cellDoLayoutTotal: 270, perFrame: 54,
  deferRowLayoutWhileResizingCalls: 0}`. This **confirms** slice 19's F19.4 for
  the subclass and adds the tree's own extra per-frame charge: 650 of 1,570
  sink ops over the burst carry nothing (slice 19's F19.1 / the
  `InlineStyle.flushDirty` empty-bag bug).
- **Proposed change**: as slice 19's Plan B — call
  `deferRowLayoutWhileResizing(widthsChanged)` from `renderWindowPass`, using
  the `widthsChanged` that `updateColumnWidthCache:1321` already computes. No
  `TreeBody`-specific change is needed; this finding exists to record that the
  tree body pays the same bill and must be included in Plan B's measurement.
- **Risk / blast radius**: as slice 19's F19.4. `TreeBody`'s `afterRowBound`
  runs per rendered row regardless of whether cell layout is withheld, so
  deferring cell layout does not disturb the toggle/indent state.
- **Proof at implement time**: probe D6 asserting `cellDoLayoutTotal === 54`
  across a five-frame burst (today 270).

### F22.5 `TreeBody.getVisibleRecords()` allocates a fresh N-element array per call, and one keystroke makes six to ten of them

- **Category**: D, G (allocation churn)
- **Impact**: HIGH — 24,000 record copies per ArrowDown and 32,000–40,000 per
  Tab / Enter on a 4,000-row expanded tree; one 4,000-element allocation per
  settled layout pass, i.e. per gutter-drag frame. Grows with tree size, which
  virtualisation is supposed to make irrelevant.
- **Where**: `component/table/TreeBody.ts:512-514`
  (`return this._flatRows.map(f => f.record)` — a fresh array and N property
  reads on **every** call), `:945-978` (`flatten` — the only writer of
  `_flatRows`); the callers are all in the base:
  `component/table/Body.ts:1239`, `:1276`, `:2601` (`_updateFocusStyle`),
  `:2634` (`_updateActiveDescendant`), `:2938` + `:2992`
  (`navigateFromEditingCell` + `scrollRecordIntoView`), `:2867`
  (`resolveFocusedCell`).
- **Hot path**:
  - ArrowDown → `Body.onKeyDown:2792` → `navigateFromEditingCell:2937`
  - → `:2938` `getVisibleRecords()` → `_flatRows.map(...)` — allocation 1
  - → `:2989` `scrollRecordIntoView` → `:2992` `getVisibleRecords().indexOf(record)` — allocation 2
  - → `renderWindow()` → `renderWindowPass:1239` — allocation 3
  - → `_updateActiveDescendant:2634` — allocation 4
  - → `_updateFocusStyle:2601` — allocation 5
  - → `openEditingAfterNavigate:2913` → `resolveFocusedCell:2867` — allocation 6.
- **Evidence**: probe D7, 4,000-row fully expanded tree —
  settled pass `{getVisibleRecordsCalls: 1, recordsCopied: 4000}`;
  one ArrowDown `{getVisibleRecordsCalls: 6, recordsCopied: 24000}`.
  Probe D1 (Tab from an open editor, 4,000 records):
  `{getVisibleRecordsCalls: 8, recordsCopied: 32000}`; probe D2 (Enter):
  `{getVisibleRecordsCalls: 10, recordsCopied: 40000}`. Probe A2 times one
  `getVisibleRecords()` at **0.028 ms** at 4,000 rows — 0.17–0.28 ms per
  keystroke in array copying alone, before any DOM.
- **Proposed change**: build the plain-record array once, in `flatten()`, and
  return the cached reference from `getVisibleRecords()`. `_flatRows` has
  exactly one writer, so the invalidation is a single assignment. That alone
  takes the per-pass allocation to zero. Slice 19's F19.2 (threading the
  already-held `records` array through `_updateFocusStyle` /
  `_updateActiveDescendant` / `resolveFocusedCell`) then removes most of the
  remaining calls; the two changes compose and neither depends on the other.
- **Risk / blast radius**: the method's JSDoc already says "do not mutate";
  returning a cached array makes that contract load-bearing, so
  `TreeBody.test.ts:54` (`tb.getFlatRecords().map(...)`) and the base's
  `records[dataIndex]` reads are fine, but any future caller that sorts or
  splices the result in place would break. `getFlatRecords():203` already
  returns `_flatRows` by reference under the same rule, so the precedent is
  established in this very class.
- **Proof at implement time**: probe D7 asserting `recordsCopied === 0` for a
  settled pass (today 4,000) and `<= 4000` for one ArrowDown (today 24,000).

### F22.6 `StringEditor` / `NumberEditor` compose a whole `TextField` where the picker editors extend a bare `<input>` — 5–6× the rule ops for the same job

- **Category**: I (duplication), H
- **Impact**: MEDIUM — first open of a string column costs 10 stylesheet-rule
  mutations and a number column 12, against 2 for a date column; once per
  editor variant per table, so a user tabbing across a mixed row pays a visible
  restyle storm on first traversal. Steady state is free.
- **Where**: `component/table/cell/editor/String.ts:272-314`
  (`CellEditor` + an inner `TextField`, 6 style setters on the inner field, a
  blur re-fire, a keydown re-fire, an input listener);
  `component/table/cell/editor/Number.ts:391-457` (the same, plus a
  `NumberEditorField` subclass); against
  `component/table/cell/editor/TextInputCellEditor.ts:28-43` +
  `component/table/cell/editor/Date.ts:30-46`, where the editor's own element
  **is** the `<input>` and the same six style setters land on one component.
- **Hot path**: `Cell.startEdit:635` → `pool.acquire:291` → factory →
  constructor → 2 elements, 2 `#id` rules, 5 `ensureStyleRule` + 5
  `setRuleStyles`.
- **Evidence**: probe E1, first `startEdit` on a string column:
  `{sinkOps: 39, ruleOps: 10, byOp: {ensureStyleRule: 5, setRuleStyles: 5,
  createElement: 2, setId: 2, apply: 18, …}}`. Probe E7, first open on a date
  column: `{sinkOps: 20, ruleOps: 2, byOp: {createElement: 1, setId: 1,
  ensureStyleRule: 1, setRuleStyles: 1, …}}`. Probe X3, first open of every
  typed editor in one table:
  `{reference: {sinkOps: 31, ruleOps: 2}, amount: {sinkOps: 36, ruleOps: 8},
  posted_at: {sinkOps: 19, ruleOps: 2}, …, totalRuleOps: 12}`. Probe X4 —
  steady state is `{sinkOps: 8, ruleOps: 0}` for all three, so this is purely a
  construction cost. The functional justification for the wrapper is the
  Cut/Copy/Paste context menu, but `TextInputCellEditor.ts:37/110-126` builds
  its own — both families solve that problem independently
  (`editor.test.ts:635` and `:704` pin the composed path, `:425-591` the
  bare-input one).
- **Proposed change**: move `StringEditor` and `NumberEditor` onto
  `TextInputCellEditor` (`setType("text")` / `setInputMode`), keeping the
  right-alignment as `NumberEditorField`'s class-tier `textAlign` already does
  (`Number.ts:392-394`) — that also deletes the blur/keydown re-fire plumbing
  and the `forwardedKeyDetail` dual-shape normaliser's reason to exist. The
  `ComboEditor` legitimately keeps its wrapper (a `ComboBox` is not an
  `<input>`).
- **Risk / blast radius**: `editor.test.ts` pins the re-fire shape explicitly
  (`:175`, `:189` "StringEditor's / NumberEditor's inner `TextField` listener
  returns `{prevent: true}`") and the composed context menu (`:635`, `:704`);
  both would need rewriting against the bare-input path, which
  `CellEditorPool.wireListeners` already serves (`:217`). `StringEditor.focus`
  calls `_textField.select()`; `TextInputCellEditor` has no `select()` yet.
- **Proof at implement time**: probe X3 asserting `totalRuleOps <= 6` for the
  first open of every typed editor in a five-column table (today 12), and E1
  `ruleOps === 2` (today 10).

### F22.7 `Date` / `Time` / `DateTime` cell editors are a hand-rolled second copy of `AbstractPickerField`

- **Category**: I, H
- **Impact**: MEDIUM (code health) — 769 lines across three files of which
  roughly 570 are the same picker-field machinery the library already has
  abstracted, plus a per-file divergence risk (only `DateTimeEditor` overrides
  `retainsFocus`; `DateEditor` and `TimeEditor` do not).
- **Where**: `component/table/cell/editor/Date.ts` (232 lines),
  `Time.ts` (244), `DateTime.ts` (293) — each carrying its own `_value`,
  `_dropdown`, `_animated`, `_text` fields, `destructor`, `isEmpty`,
  `getValue`, `setValue`, `setText`, `getText`, `syncTextFromDom`,
  `setDropdownAnimated`, `isDropdownAnimated`, `ensureDropdown`,
  `openDropdown`, `closeDropdown`, `onInput`, `toInputString`. Against
  `component/input/AbstractPickerField.ts:69-596`, which already declares
  exactly the right seam: `formatValue` / `parseRaw` / `createDropdown` /
  `onDropdownSelected` abstract hooks (`:160-194`) over shared
  `setValue`/`getValue` (`:306-336`), `setDropdownAnimated`/
  `isDropdownAnimated` (`:363-380`), `ensureDropdown`/`openDropdown`/
  `closeDropdown` (`:553-593`) and a `destructor` (`:148`).
- **Evidence**: `diff Date.ts Time.ts` → 100 differing lines out of 476
  total — **~57% of `Date.ts` is byte-identical to `Time.ts`**; `diff Date.ts
  DateTime.ts` → 157; `diff Time.ts DateTime.ts` → 139. The three
  `setText`/`getText`/`syncTextFromDom`/`setDropdownAnimated`/
  `isDropdownAnimated`/`closeDropdown`/`isEmpty`/`getValue`/`destructor`
  bodies are character-for-character identical across all three files.
  `String.ts` vs `Number.ts`: 92 differing lines of 272 — ~50% identical.
- **Proposed change**: add an `AbstractPickerCellEditor<TValue, TDropdown>`
  next to `TextInputCellEditor`, carrying everything but `formatValue`,
  `parseRaw`, `createDropdown` and `onDropdownSelected` — the same four hooks
  `AbstractPickerField` already uses, so the two hierarchies stay
  recognisably parallel. The `retainsFocus` override currently unique to
  `DateTimeEditor:74-78` should move onto the base, which also fixes the
  latent gap in `DateEditor`/`TimeEditor` (a focus move into their dropdown
  relies today on the dropdown's own `pointerdown` `preventDefault`, with no
  `retainsFocus` backstop).
- **Risk / blast radius**: `CellEditorPool.styleRuleDisposal.test.ts:126/151/176`
  pins per-editor dropdown disposal; `editor.test.ts:400/412` pins the native
  `KeyboardEvent` path. Both are behaviour, not structure, and survive.
- **Proof at implement time**: line count of `cell/editor/` before and after;
  the existing editor tests unchanged and green.

### F22.8 Every rebound tree row tears down and re-registers a drag source and a drop target

- **Category**: G (listener and allocation churn)
- **Impact**: MEDIUM — 1 per row per scroll tick (hot path 2), 18 per
  expand/collapse, 36 per committed cell edit (compounding F22.2). Each
  registration also adds/removes a subtree `mousedown` listener, which slice 03
  charges on every `mousedown` anywhere in the document.
- **Where**: `component/table/TreeBody.ts:600-602` (`afterRowBound` →
  `installRowDnD` on `wasRebound`), `:610-656` (`installRowDnD` — a teardown
  plus `DragManager.makeDragSource` + `makeDropTarget` plus four fresh closures
  and a fifth teardown closure), `:692-699` (`teardownRowDnD`);
  `overlay/DragManager.ts:247-252` (`makeDragSource` — `Map.set` +
  `component.addMouseDownSubtreeListener`), `:264-268` (`makeDropTarget`).
  Always armed: `component/table/TreeTable.ts:140-143` calls
  `setReparentHandlers` unconditionally in the constructor, so
  `_reparentHandler` is never `null` and `afterRowBound:590`'s early return is
  unreachable in production.
- **Hot path**:
  - wheel / `setScrollY` → `Body.renderWindow` → `bindAndPositionRows:1457`
  - → `TreeBody.afterRowBound:580` → `:600` `wasRebound` → `installRowDnD:610`
  - → `teardownRowDnD` → `removeMouseDownSubtreeListener` + 2 `Map.delete`
  - → `makeDragSource` → `Map.set` + `addMouseDownSubtreeListener`
  - → `makeDropTarget` → `Map.set`
  - → 5 closures allocated (`dropTargetForRow`, `accepts`, `onDrop`, the pair-teardown, and the source's own).
- **Evidence**: probe T3, one-row vertical scroll tick on a `TreeBody`:
  `{rowSetData: 1, installRowDnD: 1, teardownRowDnD: 1, makeDragSource: 1,
  makeDropTarget: 1}`. Probe D5, one expand, synchronous part:
  `{renderWindow: 1, installRowDnD: 18, makeDragSource: 18, makeDropTarget: 18,
  afterRowBound: 18}`. Probe T6, one `notifyRecordChanged`:
  `{installRowDnD: 36}`.
- **Proposed change**: the registration is per pool `Row`, and a pool row's
  identity is stable across rebinds — `TreeBody.ts:126-131`'s own comment says
  so. Only the `dragData` payload changes, and `DragManager` already supports a
  factory for exactly that case (`overlay/DragManager.ts:296-299`,
  `resolveDragData` — "accepts either a literal or a factory function on every
  drag start so callers can carry per-row state **without re-registering the
  source**"). Register each pool row once, with
  `dragData: () => ({ recordId: row.getData()?.get(this._idField) })`, and
  resolve the drop parent from `row.getData()` at drop time instead of closing
  over the record. That takes the per-rebind cost to zero and removes the
  `_rowDnDTeardowns` map's per-pass `Map.has` as well.
- **Risk / blast radius**: `installRowDnD`'s closures capture `record`; the
  factory form reads it live, which is the correct semantics for a pooled row.
  No test drives the DnD registration count. The empty-area target
  (`:731-760`) is already registered once and is unaffected.
- **Proof at implement time**: probe T3/D5 asserting
  `makeDragSource === 0` and `makeDropTarget === 0` for a scroll tick and for
  an expand (today 1 and 18).

### F22.9 `TreeBody` never releases its `DragManager` registrations on dispose

- **Category**: J (leak), G
- **Impact**: MEDIUM — every disposed `TreeTable` leaves 18–21 pool `Row`s and
  the body itself pinned in `DragManager`'s module-level maps for the life of
  the page, each holding a strong reference to a whole disposed component
  subtree. Relevant to any host that opens and closes tree tables (a `Dock`
  tab, a `Dialog`).
- **Where**: `component/table/TreeBody.ts` — **no `destructor` override**
  (`grep -n "destructor" component/table/TreeBody.ts` → 0 hits), so
  `_rowDnDTeardowns` (`:132`) and `_emptyAreaDropTeardown` (`:135`) are never
  run; `component/table/Body.ts:1098-1104` (the inherited destructor, which
  correctly disposes `_editorPool` and `_cellText`);
  `overlay/DragManager.ts:194-195` (`const dragSources = new Map<…>()`,
  `const dropTargets = new Map<…>()` — module-level, no teardown hook).
- **Evidence**: probe T7, `TreeTable` disposed after one layout:
  `{rowDnDTeardownsRegistered: 18, emptyAreaDropTargetRegistered: true,
  teardownRowDnDCalledOnDispose: 0, rowDnDTeardownsStillHeldAfterDispose: 18,
  emptyAreaTeardownStillHeldAfterDispose: true}`.
- **Proposed change**: add a `TreeBody.destructor` that runs every entry in
  `_rowDnDTeardowns`, clears the map, runs `_emptyAreaDropTeardown`, and calls
  `super.destructor()` — the shape `Body.destructor:1098` and
  `TablePanel.destructor:132` already use for their own non-child resources.
- **Risk / blast radius**: none — the teardown closures are idempotent
  (`tearDownDropTarget` is a `Map.delete`; `tearDownDragSource` removes a
  listener that may already be gone). `tests/component/dispose-full-teardown.test.ts`
  is the natural home for the regression test.
- **Proof at implement time**: probe T7 asserting
  `rowDnDTeardownsStillHeldAfterDispose === 0`.

### F22.10 `CellEditorPool.register` drops a cached editor without disposing it

- **Category**: J (leak), H (the class's own JSDoc asserts the opposite)
- **Impact**: MEDIUM — one leaked `ComboEditor` (with its `ComboBox`, dropdown,
  theme subscription and per-instance stylesheet rules) per combo column per
  view rebind. Reachable from `Table.setDisplayMode` (rotated toggle), which is
  a user-facing control.
- **Where**: `component/table/cell/editor/CellEditorPool.ts:276-281`
  (`register` — `this._editors.delete(key)` with no `dispose()`), against
  `:316-331` (`dispose`'s JSDoc: "a shared editor is acquired into `_editors`
  only on a real edit gesture … held there for the table's whole lifetime …
  **so nothing else ever reaches it**" — `register` reaches it);
  callers: `component/table/Body.ts:854-864` (`registerComboEditors`), reached
  from `:828-832` (`setColumnConfigs`) and `:1001` (`bindViewState`), which
  `component/table/Table.ts:1657` calls from `bindView`, which `:508` and
  `:513` call on every display-mode toggle.
- **Hot path**: user picks "Rotated view" → `Table.setDisplayMode` →
  `bindView:1638` → `Body.bindViewState:990` → `registerComboEditors:854` →
  `pool.register("combo:<field>", …)` → `_editors.delete(key)` — the previously
  acquired `ComboEditor` is orphaned with its element and rules intact.
- **Evidence**: probe P1 (unit, no table):
  `{firstEditorDisposeCalls: 0, newInstanceReturned: true,
  droppedEditorStillHasElement: true, poolNowHolds: 1}`.
- **Proposed change**: `register` should `this._editors.get(key)?.dispose()`
  before the `delete` — three tokens, and it makes `dispose()`'s documented
  invariant true.
- **Risk / blast radius**: `tests/component/table/cell/CellEditorPool.test.ts:75`
  ("register overrides a key and drops any cached editor so the new factory
  runs") asserts the new instance, not the old one's survival. Nothing holds a
  reference to a dropped editor — `Cell.detachEditor:717` removes it from the
  cell before the pool can be re-registered, so disposal cannot race a live
  edit. (An editor dropped *while* a cell is mid-edit would need the same
  commit-first treatment as F22.1; today that combination silently detaches.)
- **Proof at implement time**: probe P1 asserting
  `firstEditorDisposeCalls === 1`.

### F22.11 `TreeTablePanel` is a ~90% verbatim copy of `TablePanel`, bug included

- **Category**: I, J
- **Impact**: MEDIUM (code health); the copied `_spinner` leak is LOW but is
  slice 19's F19.14 duplicated, so a fix there silently misses this file.
- **Where**: `component/table/TreeTablePanel.ts` (277 lines) vs
  `component/table/TablePanel.ts` (248). Mechanically substituting
  `TreeTable`→`Table` and diffing leaves only two substantive differences:
  the spec type, and `addRowUnderSelection:159-174` replacing a bare
  `addRow()`. Everything else — the four-button toolbar, the four
  `Tooltip.attach` calls, the five store subscriptions, `destructor`,
  `refreshSyncButtons`, `setExportMenuEnabled`, the three export forwarders,
  `setPaginationBar`/`getPaginationBar`, and the module-scope
  `Glyph.register(plus, minus, arrows_rotate, ban)` (`:24`) — is identical.
  The undisposed spinner is at `:44` (field), `:122-132` (lazily constructed,
  mounted via `showOverlay`, never through `addComponent`), `:138-147`
  (`destructor` — unsubscribes five store listeners, never touches
  `_spinner`), exactly as slice 19 reports for `TablePanel.ts:38/117-119/132-141`.
- **Evidence**: `diff <(sed 's/TreeTable/Table/g; s/_treeTable/_table/g' TreeTablePanel.ts) TablePanel.ts`
  → 4 substantive hunks, all listed above; the rest is comment wording.
- **Proposed change**: make `TreeTablePanel` extend `TablePanel` with a
  protected `createTable(store, spec)` factory and a protected
  `resolveAddTarget()` hook, or extract the toolbar+store-wiring half into a
  shared base. Either way `TablePanel`'s `_spinner` fix lands in both.
- **Risk / blast radius**: `TablePanel`'s constructor takes `spec?: ColumnSpec`
  while `TreeTablePanel`'s takes a required `TreeTableSpec`; the factory hook
  has to run before `super()`'s `addComponent`, which is the same
  class-field-super trap `TreeTable.ts:117-122` documents and works around with
  a closure — use the same pattern.
- **Proof at implement time**: line count; one disposal test covering both
  panels' spinner.

### F22.12 `TreeBody.onSubtreeClick` walks the whole row pool before every ordinary body click

- **Category**: D, G
- **Impact**: MEDIUM — per click anywhere in the body (hot path 3's neighbour).
  21 `getToggleElement` resolutions and 18 `DOM.source.contains` calls before
  the inherited row-click handler even starts; the worst case (a non-toggle
  click) is also the common case.
- **Where**: `component/table/TreeBody.ts:769-787` (`onSubtreeClick` — an
  unconditional `for … of this.getRowPool()`), `:452-468`
  (`getToggleElement` — `row.getTreeCell()` + `getRenderer()` + an `instanceof`
  + `getToggle()` + `getElement()` per row).
- **Hot path**: any `click` in the body → `Event`'s subtree dispatcher
  (`Body.init:1037`) → `TreeBody.onSubtreeClick:769` → 21 × `getToggleElement`
  → up to 21 × `DOM.source.contains(toggleEl, target)` → `super.onSubtreeClick`
  → the base's own ancestor walk.
- **Evidence**: probe T10, one non-toggle click, 21-row pool:
  `{poolRows: 21, getToggleElementCalls: 21, rowGetTreeCellCalls: 21,
  domContainsCalls: 18}`.
- **Proposed change**: resolve the clicked row first (the base already has
  `locateCellFromTarget`/`resolveClickedColumn` for this, `Body.ts:1596-1625`)
  and test only that row's toggle — one `getToggleElement` and one `contains`
  instead of 21 and 18. Alternatively, mark the toggle element with a data
  attribute at `refreshToggle` time and test the target's ancestors for it,
  which removes the pool walk entirely.
- **Risk / blast radius**: `TreeBody.test.ts` drives expansion through
  `setExpanded`, not through synthesised clicks, so nothing pins the walk.
  `TreeBody.ts:299` ("scrolling the tree column out of the window:
  `getTreeCell()` is null and the render completes") requires the null-tree-cell
  path to stay tolerant.
- **Proof at implement time**: probe T10 asserting
  `getToggleElementCalls <= 1` for a non-toggle click (today 21).

### F22.13 `TextInputCellEditor.init` re-writes three attributes the buffer already flushed

- **Category**: B (unchanged-value write), J (dead state)
- **Impact**: LOW — 3 duplicate attribute applies per bare-input editor
  element creation (once per variant per table), plus three fields that exist
  only to feed the duplicate.
- **Where**: `component/table/cell/editor/TextInputCellEditor.ts:235-253`
  (`init` — three explicit `DOM.sink.apply(el, { setAttr: … })` calls),
  `:30-32` (`_type`, `_inputMode`, `_autoComplete`), `:64-101` (the three
  setters, which each already call `Component.setElementAttribute`).
  `core/Component.ts:1728-1738` documents the buffer: "the value is held by a
  buffer that binds to the element at render and writes through afterwards, so
  a value set while the component is detached survives until the element is
  created (and any later re-render)".
- **Evidence**: probe E7, first `DateEditor` open —
  `attrWrites: {"data-layout": 1, "data-insets": 2, "data-maxSize": 2,
  "type": 2, "inputmode": 2, "autocomplete": 2, "data-minSize": 1}`. Each of
  the three declared attributes reaches the sink twice: once from
  `Component.init`'s buffer flush, once from this override.
- **Proposed change**: delete the `init` override and the three fields; the
  setters' `setElementAttribute` calls already do the whole job.
- **Risk / blast radius**: none found — nothing reads `_type`/`_inputMode`/
  `_autoComplete`
  (`grep -rn "_type\b\|_inputMode\|_autoComplete" packages/lib/src` → the
  three assignments and the three `init` reads only).
- **Proof at implement time**: probe E7 asserting `attrWrites.type === 1`.

### F22.14 Dead option surface across the slice

- **Category**: J
- **Impact**: LOW (code health) — but four of these are published API surface.
- **Where / grep** (all over `packages/lib/src`, `packages/lib/tests`,
  `packages/docs/src`, `packages/create-app`, excluding `dist/`):
  - **`DateEditor` / `TimeEditor` / `DateTimeEditor`'s
    `setDropdownAnimated` + `isDropdownAnimated`** (`Date.ts:129/144`,
    `Time.ts:131/146`, `DateTime.ts:148/163`) — `grep -rn
    "setDropdownAnimated\|isDropdownAnimated"` → **12 hits, all definitions**
    (6 in these three files, 6 in `AbstractPickerField`/`ComboBox`, which have
    real callers). Zero callers for the cell-editor copies. `_animated` is
    therefore permanently `true`, so `ensureDropdown`'s
    `this._dropdown.setAnimated(this._animated)` (`Date.ts:154`,
    `Time.ts:391`, `DateTime.ts:176`) is a constant write. 6 dead methods,
    3 dead fields.
  - **`TreeBody.getIdField` / `getParentField` / `getTreeColumn`**
    (`TreeBody.ts:174/183/193`) — `grep -rn "getIdField()\|getParentField()\|getTreeColumn()"`
    → the only non-definition hits are `data/TreeStore.ts`'s unrelated
    same-named methods and one `TreeStore` test. Zero callers. (`TreeTable`
    reads the spec directly through `getTreeSpec()`.)
  - **`TreeTable.removeRowReparentListener`** (`TreeTable.ts:394-405`) —
    `grep -rn "removeRowReparentListener"` → **1 hit, the definition**. Its
    partner `addRowReparentListener` has 3 (definition + 2 doc references) and
    no caller either; the whole `_rowReparentWrappers` map
    (`TreeTable.ts:100-103`) exists for a listener API nobody uses.
  - **`NumberEditor`'s `AnchorType.NORTHEAST` constraint** (`Number.ts:454-456`)
    — inert. `CellEditor`'s layout manager is `Fit` (`CellEditor.ts:110`) with
    the default `FillType.BOTH`, so `LayoutManager.resolveBounds:397-399` sets
    `width = maxWidth` and `height = maxHeight`, and the anchor switches at
    `:456` and `:479` are gated on `width < maxWidth` / `height < maxHeight`,
    which can never hold. The right-alignment the constraint appears to intend
    is actually delivered by `NumberEditorField.ownClassStyleDefaults.font.textAlign`
    (`Number.ts:392-394`). Probe X5 shows the field placed at
    `{fieldX: 2, fieldWidth: 45}` in a 49-px editor — the content insets, not
    an anchor. Deleting the constraint also removes `Number.ts:376`'s
    `AnchorType` import.
  - **`TreeBody.expandAll`'s roots loop** (`TreeBody.ts:421-432`) — provably
    redundant. Every parent that has children is itself a non-`null` key in
    `_childIds`, so the first loop (`:415-419`) already adds it; a root is no
    exception. Probe A1 on a 3-level tree:
    `{childIdsKeys: [null, 1, 2], firstLoopResult: [1, 2],
    actualExpandedSet: [1, 2], idsContributedOnlyByTheRootsLoop: [],
    rootsLoopIsRedundant: true}`. The comment at `:421-423` misreads its own
    data structure.
  - **`TreeBody.getChildrenOf`** (`:231-233`) — 1 caller, its own
    `isDirectoryRecord` (`:244`). Public, and allocates a fresh `[]` on every
    leaf miss.
- **Proposed change**: delete the six dropdown-animation methods and their
  fields, the three `TreeBody` field-name accessors, the `rowreparent`
  listener pair and its wrapper map (or wire it to something), the
  `NumberEditor` anchor constraint, and `expandAll`'s roots loop.
- **Risk / blast radius**: the accessors and the listener pair appear in the
  generated API docs, so removal is a documented-surface change. The
  `rowreparent` **event** itself (`TreeTable.ts:323`) is documented at
  `docs/components/TreeTable.md:122` and reachable via
  `Event.addListener(tree, "rowreparent", …)`; only the convenience wrappers
  are unused.

### F22.15 `TableExporter` is three things, and its download path is the library's only raw-DOM site outside the seam

- **Category**: H, and a seam gap
- **Impact**: LOW (cold path) — but it is the reason the export tests can only
  assert "one anchor was clicked" instead of asserting the bytes.
- **Where**: `component/table/TableExporter.ts:32` — documented as "Stateless
  helper that converts a column list and a record list into a CSV, JSON, or TSV
  download", but it also owns (a) the clipboard TSV codec
  (`buildRectangularTSV:185`, `parseRectangularTSV:199`), used by
  `component/table/Body.ts:1777` and `:1931` for cell-range copy/paste and by
  no export path, and (b) the shared display-value formatter
  (`formatValue:136`), used by `Body.ts:1769`, `Table.ts:2110`, `:2554`,
  `:2581` and `:2782` — the last being column **auto-sizing**, not export.
  The seam break is `:267-280` (`download`): `new Blob([content], …)` and
  `URL.createObjectURL(blob)` are the **only** two such calls in the whole lib
  (`grep -rn "createObjectURL\|new Blob(" packages/lib/src/typescript/lib` →
  2 hits, both here), against `ARCHITECTURE.md:130`: "`core/DOM.ts` is the
  **only** module that touches *or holds a reference to* the real DOM". The
  `local/no-raw-dom` ESLint rule does not catch it because `Blob`/`URL` are not
  `Element`/`Node` types.
- **Evidence**: `tests/component/table/TableExporter.test.ts:193-247` is
  labelled "(structural smoke)" and asserts only that exactly one anchor click
  happened and that the filename ends `.tsv` — the CSV/JSON/TSV **content**
  produced by `exportCSV`/`exportJSON`/`exportTSV` is never asserted, because
  the payload disappears into an un-mockable `Blob`. `:279`
  `URL.revokeObjectURL(url)` also runs synchronously in the same task as
  `DOM.sink.click(a)`, which is safe in Chromium but is the documented
  failure mode in some WebKit builds; untested either way. **Not verified**
  against a real engine.
- **Proposed change**: add `DOM.sink.downloadText(content, filename, mimeType)`
  next to the existing `writeClipboardText:679` and `click:801` — the seam
  already owns the other two halves of this operation. Then `TableExporter`
  becomes pure, its three export methods become assertable on their return
  value, and `ARCHITECTURE.md:130`'s invariant holds again. Separately, move
  `buildRectangularTSV`/`parseRectangularTSV` to a `clipboardGrid.ts` (their
  only consumer is `Body`'s cell-range copy/paste) and `formatValue` to
  `cell/CellText.ts` (whose `CellTextResolver` it already takes as a
  parameter).
- **Risk / blast radius**: `Body.ts:1777`/`:1931` and five `Table.ts` sites
  import the moved statics; a barrel re-export keeps the public names.
  `TableExporter.test.ts` has 30 cases over the pure helpers, all of which move
  with them unchanged.
- **Proof at implement time**: the export tests assert the CSV/JSON/TSV string
  directly instead of counting anchor clicks.

### F22.16 The Tab / PageUp / PageDown suppression is copy-pasted five times, the keydown re-fire three times

- **Category**: I
- **Impact**: LOW (code health) — but it is exactly the drift surface that
  produced the dual-shape `forwardedKeyDetail` normaliser in the first place.
- **Where**: the literal `keyCode === 9 || keyCode === 33 || keyCode === 34`
  block appears at `cell/editor/String.ts:298`, `cell/editor/Number.ts:434`,
  `cell/editor/Combo.ts:279`, `cell/editor/CellEditorPool.ts:365` and
  `cell/Cell.ts:199` — five copies, each with a four-to-eight-line comment
  explaining the same thing
  (`grep -rn "keyCode === 9 || " packages/lib/src/typescript/lib` → 5 hits).
  The seven-field keydown re-fire literal appears at `String.ts:286-290`,
  `Number.ts:422-426` and `Combo.ts:267-271` — three copies
  (`grep -rn -A1 'fireEvent(this, "keydown"' …` → 3 hits).
- **Proposed change**: one exported `suppressesNativeKey(keyCode): boolean`
  and one `refireKeyDown(component, evnt)` in `cell/editor/CellEditor.ts`,
  next to the `forwardedKeyDetail` normaliser that already lives there
  (`CellEditor.ts:74`). F22.6 removes two of the five copies on its own.
- **Risk / blast radius**: `editor.test.ts:147-246` pins each of the five sites
  independently and would keep passing against a shared helper.

### F22.17 The pool's shared-editor pointer has no ownership guard

- **Category**: H
- **Impact**: LOW — latent; no production path reaches it today because
  `Cell.startEdit:636` refuses to re-enter and `Body.navigateFromEditingCell`
  commits before moving. Recorded because F22.1's fix touches the same
  invariant.
- **Where**: `component/table/cell/editor/CellEditorPool.ts:291-307`
  (`acquire` reassigns `_activeCell` without asking the previous cell to
  commit or detach), `:312-314` (`release` clears `_activeCell`
  unconditionally, regardless of which cell is calling), called from
  `component/table/cell/Cell.ts:730` (`detachEditor` → `this._editorPool?.release()`).
- **Evidence**: probe P2 —
  `{activeAfterA: "A", activeAfterB: "B",
  commitCallsWhenBStoleTheEditor: [], activeAfterAnyCellCallsRelease: null}`.
  Cell B becomes the active cell with no commit of A's edit; then A's own
  `release()` blanks the pointer while B is editing, after which the pool's
  blur and keydown listeners (`:345-370`) reach nobody and B's edit can neither
  commit nor cancel.
- **Proposed change**: have `acquire` commit the outgoing `_activeCell` (it
  already holds the reference and calls `commitEdit()` from its own blur
  listener), and have `release(cell)` take the caller and no-op unless it is
  the active one.
- **Risk / blast radius**: `CellEditorPool.test.ts:54` asserts the
  same-instance-per-key contract, which is unaffected. `Cell.detachEditor`'s
  call site would pass `this`.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `CellEditor<T>` (`cell/editor/CellEditor.ts`, 205 lines) | "Abstract base class for cell editors … in-place editing of a typed value inside a table cell using a Fit layout with theme-driven padding". No doc page; not in `llms.txt` | none of its own (subclass element); one theme subscription per instance | none — only the visible child is laid out (`Card`), and `Cell.doLayout`'s editor realignment early-returns when `contentX <= 0` (probe E6: 0 `getContentBounds`, 0 `getContentX` per settled pass) | fits | F22.17; `getContentX`/`getDisplayText` (`:188`/`:203`) are structural-compat shims for `BooleanCell`, justified in place |
| `CellEditorPool` (167 lines) | "Per-table registry that holds at most one shared editor instance per editor variant" | none | none — not a `Component`; one instance per `Body`, 7 factory closures, 0 sink ops at construction (probe P3) | fits, with two contract holes | F22.10, F22.17 |
| `TextInputCellEditor<T>` (254 lines) | "Base class for cell editors backed by a native `<input>`" — owns `type`/`inputmode`/`autocomplete` and the Cut/Copy/Paste menu | the `<input>` itself; one `Menu` per instance (LayerManager-mounted, disposed at `:50-54`) | none | fits | F22.13 |
| `StringEditor` (116 lines) | "An in-place editor for string cell values" wrapping a `TextField` | 2 elements, 2 `#id` rules; 10 rule ops on first open (E1) | none | over-built (a wrapper where a bare input would do) | F22.6, F22.16 |
| `NumberEditor` (156 lines) | Same, right-aligned, with a numeric parse | 2 elements, 2 `#id` rules; 12 rule ops on first open (D1/X3) | none | over-built | F22.6, F22.14 (dead anchor), F22.16 |
| `BooleanEditor` (193 lines) | "An always-visible checkbox editor … used directly as the renderer in `BooleanCell`" | a `Checkbox` | none; `setValue` is called on every rebind and dispatches `Checkbox`'s synthetic `click`, worked around by `_suppressCommit` (`:132-142`) | fits (the dual renderer/editor role is deliberate and documented) | → slice 15/19 (F19.10) |
| `ComboEditor` (174 lines) | "An in-place editor for constrained-choice (combo-box) cell values" | a `ComboBox` | none | fits | F22.10 (leaked on re-register), F22.16 |
| `DateEditor` (232) / `TimeEditor` (244) / `DateTimeEditor` (293) | "In-place editor for date / time / date-time cell values … pops the same dropdown class the form field uses" | the `<input>`; a lazily-built picker dropdown (LayerManager-mounted, disposed in each `destructor`) | none | over-built (a third hand-rolled copy of `AbstractPickerField`) | F22.7, F22.14; only `DateTimeEditor` overrides `retainsFocus` |
| `TreeBody` (986 lines) | "A virtual-scrolling body for a `TreeTable` … overriding only the visible-record source and a handful of hooks" | inherits `Body`'s `<tbody>`; adds 18–21 `DragManager` drag-source registrations (each a subtree `mousedown` listener) + 1 empty-area drop target | 1 × `getVisibleRecords()` → **one fresh N-element array** (T1: 200 records copied per pass; D7: 4,000); 18 × `afterRowBound` → 18 × `getTreeCell()` + 18 guarded `setTreeState`; **0 stylesheet ops, 0 forced geometry reads, 105 sink ops — identical to the flat `Body`** (T1 vs T2) | over-built (visible-record source + expansion state + DnD + ARIA + keyboard, in one subclass) | F22.2, F22.4, F22.5, F22.8, F22.9, F22.12, F22.14 |
| `TreeTable` (413 lines) | "A data-bound table whose rows form a parent/child hierarchy … the only difference is the body" | none of its own (inherits `Table`'s `<table>`) | zero per-pass work of its own | fits | F22.8 (unconditional `setReparentHandlers`), F22.14 (dead listener pair) |
| `TreeTablePanel` (277 lines) | "A composite panel that combines a `TreeTable` with an add/remove/sync toolbar — the tree counterpart to `TablePanel`" | `Border` + an `HBox` of 4 `Button`s + 4 `Tooltip` registrations | zero per-pass work of its own | mismatch (a copy, not a counterpart) | F22.11 |
| `TreeTableSpec` (44 lines, interface) | "Presentation + hierarchy specification for a `TreeTable`" | none | none | fits — all four fields are read (`TreeTable.ts:114/124-127`, `markTreeColumnUnhideable:158`) and documented (`docs/components/TreeTable.md:50-56`) | — |
| `TableExporter` (281 lines, all static) | "Stateless helper that converts a column list and a record list into a CSV, JSON, or TSV download" | one temporary `<a>` per download, released at `:277` | none | mismatch (three responsibilities; one seam break) | F22.15 |

---

## Redundant, duplicated and dead code

Items not already covered in Findings.

1. **`TreeTablePanel.ts:24` repeats `TablePanel`'s module-scope
   `Glyph.register(plus, minus, arrows_rotate, ban)`**, so importing either
   panel pulls the same four glyph data modules twice into the graph.
   `grep -rn "Glyph.register(plus" packages/lib/src` → 2 hits.
2. **`TreeBody.onKeyDown:819` does a linear `findIndex` over `_flatRows` per
   ArrowLeft / ArrowRight** — O(N) per keypress at 4,000 flat rows, on top of
   the base's own `indexOf` chain (F22.5). `handleArrowLeft:880-886` then walks
   backwards for the parent, another O(N) worst case, when `_byId` +
   `parentField` gives the parent in O(1).
3. **`TreeBody.isDirectoryRecord:243-245` allocates a fresh `[]` per leaf**
   (`getChildrenOf` → `_childIds.get(id) ?? []`). Called per drag hover
   (`resolveDropParentForRow:676`) and from `TreeTablePanel:166`. A
   `hasChildren(id)` returning `(this._childIds.get(id)?.length ?? 0) > 0`
   allocates nothing.
4. **`TreeBody.setExpanded` / `expandToDepth` / `collapseAll` / `expandAll`
   all end in the same three-line `flatten(); invalidateRowBindings();
   renderWindow();`** (`:342-344`, `:380-382`, `:400-402`, `:436-438`) — four
   copies of one refresh sequence.
5. **`CellEditor.ts:112-114`'s inlined `applyPadding`** exists because
   "`CellRenderer` and `CellEditor` stay structurally compatible —
   `BooleanCell` relies on a `CellEditor` doubling as the renderer, which fails
   if both classes declare a private member of the same name". That is a
   TypeScript private-name collision working around a design choice
   (`BooleanCell` passing one object as both renderer and editor), and it also
   forces the two no-op shims at `:188` and `:203`. Three code artefacts for
   one structural compromise; worth revisiting alongside slice 21's
   `BooleanCell`.
6. **`Table.exportCSV/JSON/TSV` (`Table.ts:2046/2060/2074`) are three
   five-line bodies differing only in the `TableExporter` static they call**,
   and `TreeTablePanel:223/232/241` + `TablePanel:190/199/208` each forward
   them again — nine near-identical methods for three formats.
7. **`ExportOptions.includeHidden` is honoured by `Table`, not by
   `TableExporter`** (`Table.ts:2047/2061/2075` → `getExportColumns:2087`),
   yet it is declared on the exporter's own options interface
   (`TableExporter.ts:15`). The exporter never reads it —
   `grep -n "includeHidden" TableExporter.ts` → 1 hit, the declaration. Not a
   bug, but the option's owner and its reader are in different files.

---

## Cross-slice notes

- **→ 19 table-core: F19.4 and F19.2 confirmed for `TreeBody`, F19.5 is much
  worse there.** `deferRowLayoutWhileResizing` is called 0 times on a
  `TreeBody` width burst (probe D6), so Plan B must cover both bodies with one
  change. F19.2's `records`-parameter threading lands on
  `TreeBody.getVisibleRecords`, whose per-call cost is a fresh N-element
  `.map()` rather than a store array copy — memoising it in `flatten()`
  (F22.5) is a separate, independent win that should ship with Plan A.
  **Plan C (targeted rebinding on `'update'`) cannot land without touching
  `TreeBody.onStoreChange:493`**, which today rebuilds the whole parent/child
  index and re-flattens before delegating (F22.2) — narrowing only the base's
  `_boundIndices.fill(-1)` would leave the tree paying two O(N) rebuilds per
  edit anyway.
- **→ 19 table-core: F19.14 (`TablePanel._spinner` never disposed) has a
  twin.** `TreeTablePanel.ts:44/122-132/138-147` is the same bug in a
  near-verbatim copy of the file (F22.11). Fix both or neither.
- **→ 21 table-cells-renderers: `TreeCellRenderer.refreshToggle`
  (`cell/renderer/TreeCell.ts:221-238`) is the single largest rule-write source
  in this slice** — 36 stylesheet mutations and 18 leaked `Glyph`s per
  `collapseAll` (F22.3). The file is slice 21's; the driver
  (`TreeBody.afterRowBound:580`) is this slice's. The one-line disposal fix
  belongs wherever `TreeCell.ts` is edited.
- **→ 18 lists-trees: `Glyph.setName()` would remove F22.3's rule churn
  entirely.** Slice 18 reports "one tree expand = 3 shared-stylesheet
  mutations + 74 DOM ops" for `Tree`; the `TreeTable` equivalent measured here
  is **30–36 rule ops** per collapse because a collapse flips every visible
  branch row's caret at once, not one. That makes the tree table the better
  place to measure a `Glyph.setName()` fix. Note also the divergence:
  `component/tree/TreeRow.ts:229-231` disposes the replaced toggle;
  `cell/renderer/TreeCell.ts:223` does not, despite its own comment claiming to
  match it.
- **→ 15 inputs-text-boolean-slider / 19: the `Checkbox.setSelected` synthetic
  click (F19.10) is triggered from this slice.**
  `cell/editor/Boolean.ts:125-145` wraps its programmatic writes in a
  `_suppressCommit` flag purely to survive it, and its own comment
  (`:45-52`) spells out the failure mode ("every scroll-driven `setValue` would
  commit the bound record back to the store … and re-render both bodies in a
  loop"). If `Checkbox` gains the opt-out slice 19 proposes, `_suppressCommit`
  and its try/finally can go with it.
- **→ 03 core-dom-seam-events: a `TreeTable` adds 18–21 subtree `mousedown`
  registrants.** `DragManager.makeDragSource:250` calls
  `component.addMouseDownSubtreeListener` per pool row (F22.8), on top of
  `Body.init:1037-1044`'s three body-level subtree listeners. Any fix for
  `Event`'s per-event ancestor walk has to count these, and F22.8's
  register-once change reduces the churn but not the count.
- **→ 10 overlay-dock-drag-rail-drawer: `DragManager`'s registries
  (`overlay/DragManager.ts:194-195`) are module-level `Map`s with no
  disposal hook**, so any registrant that forgets its teardown pins a whole
  component subtree for the page's life. `TreeBody` is one such leaker
  (F22.9, probe T7). Consider a `DragManager.releaseComponent(component)` that
  `Component.dispose` can call, so the leak is not one forgotten `destructor`
  away in every future registrant.
- **→ 04 core-panel-scrolling / 01: the empty-patch tax dominates this slice's
  per-frame numbers too.** A `TreeBody` five-frame width burst issues 1,570
  sink ops of which **650 carry nothing** (D6); a settled pass 105 of which 104
  are empty (T1). Same root cause as slice 19's F19.1
  (`InlineStyle.flushDirty`'s missing empty-bag guard). Nothing in this slice
  adds to it.
- **A seam that does not exist: `DOM.sink` has no download.**
  `TableExporter.download:267-280` is the only module in the library holding
  `Blob` and `URL.createObjectURL`, against `ARCHITECTURE.md:130`. The seam
  already has `writeClipboardText:679` and `click:801`; a `downloadText` would
  complete it and make export content testable (F22.15).

### Positives worth protecting

A plan must not regress any of these:

- **The editor pool actually pools.** A steady-state open is 8 sink ops and
  **0 stylesheet-rule ops** (E2, X4); a close is 5 ops, 0 rule ops, and
  releases cleanly (`poolReleaseCalls: 1`, `activeCellAfter: null`) (E3). A
  fresh pool issues 0 sink ops and constructs 0 editors (P3).
- **An open editor costs nothing per frame.** With an editor open, a settled
  pass is 105 sink ops (the same as with none, slice 19's P1) and a scroll tick
  138 (E5); `Cell.alignEditorWithContent` is never even reached on a settled
  pass, because `canSkipUnchangedLayout` skips the cell's `doLayout` (E6: 0
  `getContentBounds`, 0 `getContentX`).
- **`TreeBody`'s settled pass is byte-for-byte the flat `Body`'s.** 105 sink
  ops, 104 empty, `byOp: {apply: 105}` — **zero rule ops, zero non-`apply`
  ops, zero forced geometry reads** (T1 vs T2). The tree structure costs
  nothing per frame; everything it costs is per interaction.
- **`TreeCellRenderer.setTreeState` is properly idempotent.** 18 calls per
  pass, all no-ops on unchanged depth/hasChildren/expanded (T1). This is the
  guard that keeps F22.3's glyph churn confined to real state changes.
- **`Card` undisplays the inactive child with `display:none`**
  (`layout/Card.ts:192-198`, `:22`), so the hidden renderer or editor leaves
  the render tree entirely — not the `visibility:hidden` hazard slice 07 found
  in `Tab.setBarVisible`. The editor/renderer swap is free during ancestor
  resizes.
- **Both dropdown-owning editor families dispose their LayerManager-mounted
  overlays** (`Date.ts:54-58`, `Time.ts:289-293`, `DateTime.ts:58-62`,
  `TextInputCellEditor.ts:50-54`), pinned by
  `CellEditorPool.styleRuleDisposal.test.ts:126/151/176`.
- **`TableExporter`'s pure helpers are genuinely pure and well covered** — 30
  test cases over `escapeCSVField`, `formatValue`, `buildRectangularTSV` and
  `parseRectangularTSV`, including a round-trip.
- **`TreeBody`'s expand state is keyed by record id, not reference**
  (`:102-104`, `:320-322`), so a store sync that replaces records preserves
  expansion. Any rework of `_expanded` must keep that.

---

## Suggested plan grouping

**Plan A — "an open editor must not outlive its row binding"** (F22.1 alone).
A correctness fix, not a performance one, so it gets its own plan, its own test
and its own review. It edits `Body.bindAndPositionRows` (slice 19's file) and
reuses the exact shape `commitEditsOutsideWindow` already has for the column
axis. **Highest priority in this slice**; independent of everything else.

**Plan B — "tree-body interaction economy"** (F22.2, F22.5, F22.8, plus
Redundant #2, #3, #4). One coherent change set: stop `TreeBody` redoing
O(total-records) work on interactions whose inputs did not change. Cache the
flat record array in `flatten()`; gate `rebuildIndex`/`flatten` on structural
fields via the store's `'update'` payload; register per-row drag sources once
with a `dragData` factory. All three are internal to `TreeBody`, share one
probe harness, and are individually measurable as counters (`recordsCopied`
per keypress, `rebuildIndexCalls` per edit, `makeDragSource` per scroll tick).
**Depends on slice 19's Plan C** for the `'update'`-event routing — they should
land together, since Plan C's `Body.onStoreChange` change is what this override
delegates to.

**Plan C — "tree toggle glyph churn"** (F22.3, plus the `TreeCell.ts` disposal
line). Two halves with different risk: the one-line `dispose()` can ride along
with any `TreeCell.ts` edit immediately; the `Glyph.setName()` that removes the
36 rule ops is upstream work shared with slice 18's `Tree` finding and should
be planned there, with the `collapseAll` counter here as its measurement.
Independent of A and B.

**Plan D — "cell-editor consolidation"** (F22.6, F22.7, F22.13, F22.16, plus
Redundant #5 and #6). Pure structural work: move `StringEditor`/`NumberEditor`
onto `TextInputCellEditor`, extract an `AbstractPickerCellEditor` for the three
temporal editors, delete the duplicate `init` attribute writes and the five
copies of the key-suppression block. Measured by first-open rule ops (X3:
12 → ≤ 6) and by line count. Independent of A–C, but should land **after**
Plan A, since Plan A changes when an editor is detached.

**Plan E — "table disposal and registry hygiene"** (F22.9, F22.10, F22.11's
spinner half, plus slice 19's F19.14). Four small leaks that share one test
shape (`dispose-full-teardown.test.ts`) and one idea: a resource mounted
outside the child tree must be released explicitly. Consider adding
`DragManager.releaseComponent` here so F22.9's class of bug cannot recur.
Independent of everything.

**Plan F — "export seam and `TableExporter` split"** (F22.15). Needs a `DOM`
seam addition (`downloadText`), so it is cross-cutting and cold-path; schedule
it only when `core/DOM.ts` is being edited for another reason. Its real payoff
is testability, not frame time.

**Ride along with a neighbour (too small to plan):**
- F22.12 (`onSubtreeClick`'s pool walk) — attach to Plan B, which already
  edits `TreeBody`'s interaction paths.
- F22.14 (the six dead dropdown-animation methods, the three dead `TreeBody`
  accessors, the `rowreparent` listener pair, `NumberEditor`'s inert anchor,
  `expandAll`'s redundant loop) — split between Plan B (`TreeBody` items) and
  Plan D (editor items).
- F22.17 (pool ownership guard) — attach to Plan A, which reworks the same
  invariant.
- F22.4 — **no separate work**; it is slice 19's Plan B, and this slice
  supplies the `TreeBody` measurement it must also satisfy.
- Redundant #1 (`Glyph.register` duplication), #7 (`includeHidden`'s split
  ownership) — attach to Plan E and Plan F respectively.

**Ordering:** A first (correctness). Then B (with slice 19's Plan C) and D in
parallel; C's local half anywhere, its upstream half with slice 18; E anywhere;
F last.

---

*Probes for this report live in
`.worktrees/_probes/22-table-editors-treetable-export/`
(`editors.test.ts`, `tree.test.ts`, `detail.test.ts`, `leaks.test.ts`,
`corrupt.test.ts`, `pool.test.ts`, `expandall.test.ts`, with the raw output in
`results.txt`), run with
`PROBE_DIR=.worktrees/_probes/22-table-editors-treetable-export npx vitest run --config .worktrees/_probes/vitest.probe.config.ts`.
No file in the main tree was modified.*
