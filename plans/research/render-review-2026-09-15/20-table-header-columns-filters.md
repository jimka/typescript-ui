# 20 table-header-columns-filters — render-work review

Paths are relative to `packages/lib/src/typescript/lib/` unless stated.
Probe files: `.worktrees/_probes/20-table-header-columns-filters/{header,resize,mirror}.probe.test.ts`
(`header.probe.test.ts` was already present from an earlier session; `resize` and
`mirror` are mine). Probe labels below (`P1`…`P8c`, `R1`…`R4`, `M1`…`M4`) name the
line each number came from.

## Summary

- **The header's continuous-motion paths are already correct, and that is the
  headline.** A column-resize drag frame costs **zero stylesheet-rule mutations
  and zero forced `DOM.source` reads** (R1, ten frames); an unchanged pass costs
  zero header-cell `doLayout` calls (R2). The only per-frame waste is the
  already-confirmed empty-`InlineStyle`-flush tax: **42 of 68 applies per
  resize frame, 29 of 30 per unchanged pass** on a 20-column header.
- **The one continuous-motion defect is a misplaced compositor hint.**
  `Table.ts:336` promotes the `<thead>`; `Header.setScrollX:1694-1696`
  transforms the three inner `Row`s. M1: **0 transform writes on the promoted
  element, 9 on the three unpromoted rows.** The header band is software-
  repainted per horizontal-scroll tick in WebKitGTK instead of moving a
  composited layer — and `docs/concepts/performance.md` documents the opposite.
- **Every store `filterchange` rebuilds every rendered filter cell's operator
  glyph twice.** 8 rendered cells → **16 `ensureStyleRule` + 16 `setRuleStyles`
  + 16 `deleteStyleRule`, 411 sink applies, 64 `createElementNS`, 48
  `Tooltip.attach`** (P3, P3b). At 20 columns that is 120 stylesheet mutations
  per commit, and the header's *own* debounced filter write comes straight back
  through this path. Per the cost model, one rule mutation ≈ a full-document
  restyle.
- **Every keystroke in a filter input tears down and rebuilds the operator
  button's content row and re-attaches its tooltip twice**, all same-valued:
  1 `_rebuildContentRow`, 2 `_rebuildTooltip`, 2 `recomputePreferredSize`,
  2 `Tooltip.attach` + 2 `Tooltip.detach`, 2 `removeElement`, 2 `insertBefore`
  per character (P2), identical on the second keystroke.
- **A sort click sweeps every rendered header cell twice** (R3: two FULL
  sweeps), writing a byte-identical title through the unguarded `Text.setText`
  to each — 16 `Text.setText` / 32 text applies for 8 cells (P4), 7 of 8 of
  them on cells that were already unsorted.
- The 2026-08-29 audit's Priority-2 item #1 for this file (**two ~150-line
  duplicated windowed reconcilers, plus per-column state duplicated between
  the full and slide paths**) is **closed** — `reconcileWindowedRow<TCell>` /
  `reconcileWindowedRowSlide<TCell>` + `WindowedRowHooks` is exactly the
  extraction it asked for. Nothing to carry forward.

---

## Findings

### F20.1 The horizontal-scroll compositor hint is on an element that never moves

- **Category**: F (will-change misuse), H (stated contract not implemented)
- **Impact**: HIGH — per horizontal-scroll tick, per visible `Table`.
- **Where**: `component/table/Table.ts:336` (`this._header.setWillChange("transform")`);
  `component/table/Header.ts:1694-1696` (`getParentRow().setTranslate(...)`,
  `getComponents()[1].setTranslate(...)`, `getFilterRow().setTranslate(...)`);
  `Header.ts:1675-1686` (the doc comment stating the rows are translated, not
  the header); `packages/lib/docs/concepts/performance.md` §Compositor-layer
  hints ("**Table header** — set once for the Table's lifetime, since the
  header is always the scroll-mirror target").
- **Hot path**:
  - `Body` horizontal scroll → `Body` emits `"horizontalscroll"`
  - `Table.ts:370-372` → `this._header.setScrollX(scrollLeft)`
  - `Header.setScrollX:1694-1696` → `Row.setTranslate(-scrollLeft, 0)` ×3
  - `Component.setTranslate:4647` → inline `transform: translate3d(...)` on each **row** element
  - the `<thead>` element itself is never transformed.
- **Evidence**: probe M1, after three `setScrollX` steps on a 20-column table:
  `header element inline style: {"willChange":"transform","left":"0px","top":"0px","width":"598px","height":"21px"}`;
  each of the three inner rows: `{"left":"0px", …, "transform":"translate3d(-360px,0px,0)"}`;
  `transform writes: header element= 0 inner rows= 9 | header willChange= transform | row willChange= [null,null,null]`.
  `grep -rn "setWillChange" component/table/` returns exactly one hit
  (`Table.ts:336`), so nothing else promotes the rows.
- **Proposed change**: put the hint where the transform lands. Either
  `setWillChange("transform")` on the three `Row` children (three hints per
  table, still far under the per-page threshold), or — better, since it also
  collapses three writes per scroll tick into one — hoist the translate onto a
  single inner wrapper that holds all three rows and promote that one element.
  The header element's own hint should be dropped in either case; it buys a
  permanent backing store for an element that never animates.
- **Risk / blast radius**: `setScrollX`'s three-row shape is load-bearing (the
  header band must stay pinned so its background covers the scrollbar
  reservation band — see the method's own comment and the menu button's role),
  so the wrapper variant is a structural change touching `layout/Table.commit`'s
  row positioning (slice 08). The minimal variant (move the hint to the rows)
  touches two files and no geometry. No test asserts `will-change` on the
  header.
- **Proof at implement time**: a probe asserting `willChange` is set on exactly
  the elements that receive a `transform` write; in the harness, ms/frame on a
  wide-table horizontal scroll (WebKitGTK), comparing the first-tick settle.

---

### F20.2 A store `filterchange` rebuilds every rendered filter cell's operator glyph — twice per cell

- **Category**: C (stylesheet-rule write on a hot path), B (unchanged-value write), I (duplication)
- **Impact**: HIGH — per filter commit, multiplied by the rendered column window
  (8–20 cells on a realistic screen). Every filter the header itself applies
  loops back through this path.
- **Where**:
  - `Header.ts:1464-1487` — `onStoreFilterChange` sets `_filterCellsDirty = true` then calls `renderColumnWindow()`
  - `Header.ts:1546-1550` — `reconcileFilterCells` takes the **full** path because `_filterCellsDirty` is set
  - `Header.ts:879-884` — `reconcileWindowedRow` pass 3 calls `hooks.apply` for *every* rendered cell
  - `Header.ts:1051-1069` — `filterRowHooks.apply` calls `cell.setOperators(operators)` (`:1058`) **and** `cell.setFilterState(...)` (`:1066`)
  - `cell/Filter.ts:265-292` — `setOperators` → `applyOperatorFace` + `applyOperandAvailability` + `syncBadge`
  - `cell/Filter.ts:336-353` — `setFilterState` → `applyOperatorFace` + `applyOperandAvailability` + `syncBadge` **again**, then `this.doLayout()`
  - `cell/Filter.ts:180-186` — `applyOperatorFace` → `Button.setGlyph` (no same-name guard) + `Button.setText`
  - `component/button/Button.ts:1789-1819` — `setGlyph` always mints a fresh `ButtonIconGlyph`, rebuilds the content row, disposes the outgoing glyph (deleting its rules) and recomputes preferred size, whether or not the name changed (slice 13's finding).
- **Hot path** (per commit): `store.setFilter` → `'filterchange'` →
  `Header.onStoreFilterChange` → `renderColumnWindow` → `reconcileFilterCells`
  (full) → `reconcileWindowedRow` → `filterRowHooks.apply` × N cells →
  2 × `applyOperatorFace` → 2 × `Button.setGlyph` → 2 × (`ensureStyleRule` +
  `setRuleStyles` + `deleteStyleRule`).
- **Evidence**:
  - P3, external `store.setFilter` on a 20-column table with **8** rendered filter cells:
    `setOperators= 8 setFilterState= 8 FilterCell.doLayout= 8 Button.setGlyph= 16 Button.setText= 32 Tooltip.attach= 48`
    and sink ops `{"apply":411, "apply.style":115, "removeElement":80, "apply.setAttr":216, "createElement":16, "createElementNS":64, "appendChild":64, "setId":16, "apply.addClass":16, "ensureStyleRule":16, "setRuleStyles":16, "insertBefore":64, "deleteStyleRule":16, "release":48, "apply.text":48, "setValue":8}`.
  - P3b, the header's **own** 200 ms debounce firing after typing: byte-identical
    counts — the write the header makes comes straight back to it.
  - R3b, 20 rendered cells, forced reconcile: `applyOperatorFace= 40
    applyOperandAvailability= 40 syncBadge= 40` — two of each per cell.
  - The operator lists are module-level constants (`ColumnFilter.ts:63-75`), so
    `operatorsFor(field)` returns the *same array reference* on every pass: an
    identity guard is sufficient and exact.
- **Proposed change**, in order of payoff:
  1. `FilterCell.setOperators` early-returns when `operators === this._operators`
     (reference identity is exact here) — kills half the work outright.
  2. `applyOperatorFace` early-returns when the operator it is handed is the one
     already on the button face (cache the last written operator alongside
     `_clauses[0].operator`). This removes the second `setGlyph` on the
     `setFilterState` leg and every same-operator rewrite.
  3. `onStoreFilterChange` should not mark the **whole row** dirty. It only ever
     *drops* cached entries (`Header.ts:1467-1481`); re-applying state to the
     cells whose entry it actually deleted is the minimal repair, so replace the
     `_filterCellsDirty = true` + `renderColumnWindow()` pair with a targeted
     `setFilterState` on the affected cells.
  4. Upstream: a same-name guard on `Button.setGlyph` (slice 13 already
     proposes this; this slice is a second caller that needs it).
- **Risk / blast radius**: `HeaderColumnWindow.test.ts:1030-1038` spies
  `FilterCell.prototype.setOperators` and asserts `toHaveBeenLastCalledWith` —
  an identity guard that suppresses the last call would break it; the assertion
  needs re-pointing at the rendered face instead. `ColumnFilterRow.test.ts`'s
  "recycling and external sync" block (tests 29–31, and "31. store.clearFilter()
  … blanks the rendered inputs on the next render pass") pins the observable
  end state and must keep passing. `ColumnFilterRow.test.ts:1562` pins
  `setOperators([])` still clearing a stale clause list — an identity guard must
  not swallow the empty-array case on a cell that already had `[]`.
- **Proof at implement time**: a probe asserting `ensureStyleRule +
  setRuleStyles + deleteStyleRule === 0` for a `store.setFilter` that changes no
  column's offered operators; `Button.setGlyph` call count per commit.

---

### F20.3 One filter keystroke rebuilds the operator button's content row and re-attaches its tooltip twice

- **Category**: B (unchanged-value write), G (listener/allocation churn)
- **Impact**: HIGH per event — this is hot path 4 (typing), and it fires on
  every character.
- **Where**:
  - `cell/Filter.ts:130-134` — the constructor's `getInput().on("change", …)` handler calls `syncBadge()` then `fireFilterChange(false)`
  - `cell/Filter.ts:720-746` — `syncBadge` writes `opButton.setText(...)` (`:738`) and `opButton.clearDescription()` (`:743`) **unconditionally**
  - `component/button/Button.ts:1167-1179` — `setText` has no same-value guard: `_text.setText(...)` + `recomputePreferredSize()` + `_rebuildTooltip()` + `_reflectAccessibleName()`
  - `component/button/Button.ts:1407-1413` — `clearDescription` has no guard: `_rebuildContentRow()` + `_rebuildTooltip()` + `recomputePreferredSize()` even when `_description` was already `null`
  - `component/button/Button.ts:1599-1607` — `_rebuildContentRow` empties up to four containers and re-adds every child
  - `component/input/Text.ts:828-846` — `Text.setText` has no same-value guard (slice 14)
- **Hot path**: native `input` → `TextInput.onInput` (`component/input/TextInput.ts:143`)
  → `AbstractInput` fires `"change"` → `FilterCell`'s handler → `syncBadge` →
  `Button.setText` (same string) + `Button.clearDescription` (already null).
  In the overwhelmingly common single-clause case `count` is 0 or 1, so
  `multi` is `false` and the written title is
  `columnFilterOperatorLabel(_clauses[0].operator)` — a constant for the whole
  typing session.
- **Evidence**: P2, one keystroke into a filter input —
  `_rebuildContentRow= 1 _rebuildTooltip= 2 recomputePreferredSize= 2
  Tooltip.attach= 2 Tooltip.detach= 2 Button.setText= 1 clearDescription= 1
  Text.setText= 1`, sink ops
  `{"setValue":2,"apply":5,"apply.text":2,"apply.removeAttr":1,"removeElement":2,"apply.setAttr":2,"insertBefore":2}`.
  The second keystroke reports identical counts, so nothing about this is a
  first-call cost. (`Tooltip.attach` is non-idempotent per slice 11; here it
  runs twice per character.)
- **Proposed change**: guard both writes at the `syncBadge` call site — keep the
  last-written title and description on the cell and only call
  `opButton.setText` / `setDescription` / `clearDescription` when the composed
  value actually changed. The comment at `cell/Filter.ts:731-737` explains why
  the title is written unconditionally (`removeClause` can drop the effective
  count from 2 to 1 without going through `applyOperatorFace`); a cached
  last-written string satisfies that requirement exactly while dropping the
  no-op case. Upstream same-value guards on `Button.setText` /
  `Button.clearDescription` / `Text.setText` would fix this and several other
  slices at once.
- **Risk / blast radius**: `ColumnFilterRow.test.ts`'s "a 2+ clause column
  states the actual conditions on the badge and the operator button, not just a
  count" and the three badge-count tests pin the *values*, not the call counts,
  so a guard is safe for them. `ColumnFilterRow.test.ts:1310`'s comment
  explicitly notes `syncBadge` is the path that must run — it must still run,
  just write nothing when nothing changed.
- **Proof at implement time**: a probe typing five characters and asserting
  `_rebuildContentRow === 0` and `Tooltip.attach === 0` across all five.

---

### F20.4 A sort click sweeps every rendered header cell twice and rewrites each identical title

- **Category**: I (duplication), B (unchanged-value write)
- **Impact**: MEDIUM–HIGH — per sort click and per programmatic sort,
  multiplied by the rendered column window.
- **Where**:
  - `Header.ts:1286` — `handleSortClick` ends with `this.syncSortIndicators()`
  - `Header.ts:1329-1331` — `onStoreSortChange` (subscribed at `Header.ts:327`) calls `this.syncSortIndicators()` for the same store event
  - `Header.ts:1302-1317` — `syncSortIndicators` loops every rendered cell
  - `cell/Header.ts:418-427` — `clearSortState` → `_renderTitle()` + `setSort('none')` + `_priorityBadge.clearPriority()`, all unguarded
  - `cell/Header.ts:477-484` — `_renderTitle` → `getRenderer().getText().setText(...)`, unguarded upstream
  - `cell/SortPriorityBadge.ts:143-155` — `setPriority` writes `text` through the sink unconditionally
- **Hot path**: click → `HeaderCell.onSortHeaderClick` → `emit("sortclick")` →
  `Header.handleSortClick` → `store.sort(...)` → `'sortchange'` →
  `onStoreSortChange` → `syncSortIndicators()` **(sweep 1)** → return to
  `handleSortClick` → `syncSortIndicators()` **(sweep 2)**.
- **Evidence**: R3, one sort click on a 20-column table:
  `syncSortIndicators calls= 2, call args (undefined = full sweep): ["FULL","FULL"]`.
  P4, 8 rendered cells: synchronously `setSortState= 1 clearSortState= 7
  Text.setText= 8 ops={"apply":17,"apply.text":16,"apply.setAttr":1}`; after the
  store settles the counts double to `setSortState= 2 clearSortState= 14
  Text.setText= 16 ops={"apply":36,"apply.text":32,…}`. Seven of the eight cells
  per sweep were already unsorted and receive a byte-identical title.
- **Proposed change**: two independent halves.
  1. Drop the trailing `syncSortIndicators()` in `handleSortClick` — the
     `'sortchange'` subscription added later already covers the click path
     (`onStoreSortChange`'s own doc comment says as much). **Not verified**: for
     a store whose sort round-trips through the worker (>1k rows) or a remote
     proxy, confirm `getActiveSorters()` is updated and `'sortchange'` emitted
     synchronously before making this the sole path; if it is not, keep both and
     make the second one cheap via (2).
  2. Give `setSortState`/`clearSortState` an unchanged-state guard (compare
     against `_sortState`) so a cell whose sort state did not change writes
     nothing. This is the cheap fix that makes the duplicate sweep harmless
     regardless of (1), and it also covers the `renderColumnWindow` sweep.
- **Risk / blast radius**: `HeaderColumnWindow.test.ts:1317-1321` pins that an
  unchanged scroll calls neither reconciler nor `syncSortIndicators` — a guard
  inside the cell does not affect it. `cell/Header.test.ts` pins the composed
  label text, not the call count.
- **Proof at implement time**: a probe asserting `apply.text === 1` (not 32) for
  one sort click on a 20-column header, and `syncSortIndicators` called once.

---

### F20.5 The column-focus underline is a per-instance stylesheet-rule write; clearing one costs two

- **Category**: C (stylesheet-rule write on a pointer/key path)
- **Impact**: MEDIUM — 4 full-document restyles per column move, on hot path 4
  (keyboard navigation in the body).
- **Where**: `cell/Header.ts:680-690` — `setColumnFocused` → `setShadow(...)` /
  `clearShadow()`; `core/Component.ts:3098` / `:3115` route both into the
  instance style layer, and because `HeaderCell.ownStyleStates` declares
  `:active` with a `shadow` (`cell/Header.ts:173-181`), `shadow` is in the
  resting-isolation key set, so the write lands on the guarded `#id:not(…)`
  rule. `Header.ts:1734-1739` (`applyFocusedColumn`) is the sweeping caller;
  `Header.ts:1720` (`setFocusedColumn`) is driven by `Body._updateFocusStyle`.
- **Hot path**: arrow key in the body → `Body._updateFocusStyle` →
  `Header.setFocusedColumn(n)` → `applyFocusedColumn` → per rendered cell
  `setColumnFocused(bool)` → for the two cells that changed:
  `clearShadow()` (2 rule rows) on the old, `setShadow(...)` (1 rule row +
  `ensureStyleRule`) on the new.
- **Evidence**: P5 —
  `focus 2: {"ensureStyleRule":1,"setRuleStyles":1} | move to 3:
  {"setRuleStyles":3,"ensureStyleRule":1} | repeat 3: {} | clear:
  {"setRuleStyles":2}`. The recorded rule rows show the guarded selector
  `#<id>:not(.rangeSelected):not(.readOnly):not(.requiredEmpty):not(:active)`
  receiving `boxShadow = "inset 0 -2px 0 0 var(--ts-ui-focus-ring, …)"`, then
  `null`, then `"none"` — `clearShadow` issues two rows
  (`writeStyle({shadow:null})` + `writeGuardedCSSRule("boxShadow", "none")`).
- **Proposed change**: make the underline a **declared toggle state** rather
  than a per-instance resting write. Append `{ selector: ".columnFocused",
  extract: () => ({ shadow: "inset 0 -2px 0 0 var(--ts-ui-focus-ring, …)" }) }`
  to `HeaderCell.ownStyleStates` (ahead of `:active`, so `:active` keeps
  winning while pressed) and have `setColumnFocused` call
  `this.setStyleState(".columnFocused", focused)` — a guarded class-token
  toggle, zero stylesheet mutations, one shared `.HeaderCell.columnFocused`
  rule for every table on the page. This is the precedent slice 18 cites
  (`TreeRow` already uses `setStyleState`) and it also removes the reason
  `setColumnFocused` needed the `:active` isolation comment at
  `cell/Header.ts:145-181`.
- **Risk / blast radius**: the `:active` isolation reasoning in that comment
  must be re-checked — with `shadow` no longer written to the resting `#id`
  tier from this path, the `:active` entry's guard ordering is what decides
  which wins while a focused column is pressed. `HeaderCell` also inherits
  `Cell`'s three declared states, so the new entry changes every state's
  generated `:not()` guard suffix; `TableHeader.classStyleDefaults.test.ts` and
  `PooledTintMetaClasses.test.ts` are the tests most likely to move.
  `applyFocusedColumn` is already guarded end-to-end (P5's "repeat 3: {}"), so
  this is a cost reduction, not a correctness fix.
- **Proof at implement time**: a probe asserting zero `setRuleStyles` /
  `ensureStyleRule` / `deleteStyleRule` for a `setFocusedColumn(a) →
  setFocusedColumn(b) → setFocusedColumn(null)` sequence.

---

### F20.6 `rebuildParentCells` disposes and rebuilds the entire parent row for any column-set change

- **Category**: D (avoidable work), H (function/implementation mismatch)
- **Impact**: MEDIUM — per column toggle, per model swap, per hidden-set change,
  per `setColumns`. Scales with group count, not with what changed.
- **Where**: `Header.ts:1141-1144` — `rebuildParentCells` opens with
  `row.disposeAllComponents()`, then rebuilds one `ParentHeaderCell` per
  contiguous group run from scratch. Callers: `Header.ts:425-426` (`setModel`),
  `Header.ts:459-460` (`setHiddenColumns`), `Header.ts:475-476` (`setColumns`), and the
  constructor (`Header.ts:358-359`).
- **Hot path**: column-menu toggle → `Table.setColumnVisible` →
  `Header.setHiddenColumns` → `rebuildParentCells` → dispose N cells (each
  disposing its `Text`, its listeners and its per-instance rules) → construct N
  fresh ones.
- **Evidence**: P7, toggling one of ten columns in a two-group table:
  `parent cells before= 2 after= 2 surviving parent instances= 0 surviving
  header cells= 9 / 9 rebuildParentCells calls= 1`, sink ops
  `{"apply":140,"apply.text":49,"removeElement":14,"release":11,"removeListener":12,"createElement":6,"setId":6,"apply.style":52,"apply.setAttr":25,"apply.addClass":8,"appendChild":4,"addListener":8,…}`.
  The contrast is the point: the column row's own reconciler kept **all nine**
  header cells across the same operation; the parent row kept **none of two**.
- **Proposed change**: reconcile the parent row the way the column row is
  already reconciled. The run computation (`Header.ts:1146-1182`) produces a
  list of `{ key, color, spanFrom, spanTo }`; diff that against the existing
  cells' stored constraints and only create/dispose on a run-count change,
  re-targeting surviving cells via `setTooltip` + a `setGroup(key, color)`
  setter and a fresh `data` constraint. A same-runs change (the common case: a
  toggle inside one group) then costs a constraints rewrite per cell and
  nothing else.
- **Risk / blast radius**: `HeaderParentCellMerge.test.ts` pins the run-merging
  rules (including the "adjacent ungrouped columns share one blank span" case)
  and must keep passing unchanged. `ParentHeaderCell` currently has no
  re-target setter — its `_text`/`_color` are constructor-only, so this needs
  one added (mirroring `HeaderCell.setHeaderText` / `setBaseBackground`).
  Nothing outside `Header.ts` constructs a `ParentHeaderCell`.
- **Proof at implement time**: re-run P7 and assert surviving parent instances
  equals the run count when the run shape is unchanged, and that
  `createElement`/`removeElement` drop to 0 in that case.

---

### F20.7 `setRequired` has no unchanged-value guard, so every full reconcile rewrites every cell's title

- **Category**: B (unchanged-value write)
- **Impact**: MEDIUM — per full column-row reconcile (a column-set change, a
  model swap, or any pass whose window *width* changes), multiplied by the
  rendered window.
- **Where**: `cell/Header.ts:438-443` — `setRequired` assigns and calls
  `_renderTitle()` with no comparison; `Header.ts:1014` calls it for every
  rendered cell on every full reconcile. `setHeaderText` right above it
  (`cell/Header.ts:459-468`) **is** guarded — the inconsistency is within one
  class.
- **Hot path**: `renderColumnWindow` → `reconcileColumnCells` (full path) →
  `reconcileWindowedRow` pass 3 → `columnRowHooks.apply` → `cell.setRequired(…)`
  → `_renderTitle()` → `Text.setText(same string)` → sink text write +
  `Text.scheduleLayout()` on the parent.
- **Evidence**: P8, forced full reconcile of 8 rendered cells with nothing
  changed: `setRequired= 8 Text.setText= 16 ops=
  {"apply":32,"apply.text":24,"apply.style":8}` — 24 identical text writes.
- **Proposed change**: `if (this._required === value) return this;` at the top
  of `setRequired`, matching `setHeaderText`'s existing shape. The upstream
  `Text.setText` same-value guard (slice 14) would cover the rest.
- **Risk / blast radius**: `cell/Header.test.ts:37-79` exercises
  `setRequired(true)`/`setRequired(false)` transitions only, never a repeat of
  the same value. Zero other callers (`grep -rn "setRequired(" packages/ | grep
  -v node_modules` → 3 production sites, all in this slice or its tests).
- **Proof at implement time**: re-run P8 and assert `apply.text === 0` on a
  forced reconcile with unchanged columns.

---

### F20.8 Every rendered header cell and filter cell carries a permanently-invisible badge in the render tree

- **Category**: E (work for invisible content)
- **Impact**: MEDIUM — 1 extra `<span>` per rendered header cell plus 1 per
  rendered filter cell, charged on every ancestor resize (~the briefing's
  "hidden content still costs" rule), for content that is hidden in the normal
  case (single-column sort, single-clause filter).
- **Where**: `cell/SortPriorityBadge.ts:93` and `cell/FilterClauseBadge.ts:103`
  — both constructors end with `this.setVisible(this._shouldShow(...))`, and
  `setPriority`/`setCount` keep using `setVisible`. `Component.setVisible:2215`
  routes to the shared `.invisible` class (`visibility: hidden`), which leaves
  the element in the render tree; `setDisplayed` (`:2304`) routes to
  `.undisplayed` (`display: none`), which does not.
- **Hot path**: any ancestor resize — a `Split` gutter drag, a window resize —
  re-lays-out the header band; every hidden badge span is still styled and
  laid out by the engine.
- **Evidence**: M4 / R3d on a 20-column table with the filter row on:
  `20 rendered header cells; invisible-but-displayed priority badges = 20`;
  `SortPriorityBadge isVisible= false isDisplayed= true | FilterClauseBadge
  isVisible= false isDisplayed= true`.
- **Proposed change**: swap `setVisible` for `setDisplayed` in both badges'
  constructor and setter. The badges are absolutely positioned overlays
  side-loaded with a raw `appendChild` outside the cell's `Card` layout
  (`cell/Header.ts:254-255`, `cell/Filter.ts:793`), so they occupy no layout
  slot and `display:none` changes nothing observable. This is the same swap
  the merged `undisplay-inactive-tab-pages` work made elsewhere, and the same
  shape slice 07 flags for `Tab.setBarVisible`.
- **Risk / blast radius**: `SortPriorityBadge.test.ts:71-72` asserts
  `new SortPriorityBadge({ priority: 3 }).isVisible() === true` and
  `{ priority: 1 }` → `false`; those assertions would move to `isDisplayed()`.
  `StyleAudit.regression.test.ts:149-152` instantiates both badges.
- **Proof at implement time**: the element-count / render-tree probe in
  `tests/dom/countElements.test.ts`'s style, plus ms/frame on a gutter drag
  beside a wide table in the harness.

---

### F20.9 The `FooterRow` is constructed, mounted and unreachable

- **Category**: J (dead code), E (invisible content in the render tree)
- **Impact**: LOW–MEDIUM — 2 components and 2 live elements per `Table`,
  permanently; 132 lines of unreachable source.
- **Where**: `component/table/Table.ts:321` sets `this._footerVisible = false`;
  `grep -rn "_footerVisible" packages/lib/src` returns exactly three hits — the
  declaration (`:223`), that one assignment, and the `isFooterVisible()` getter
  (`:985`). There is no `setFooterVisible`. `Table.ts:346-347` constructs the
  `FooterRow` and adds it as a child; `layout/Table.ts:240` skips it whenever
  `isFooterVisible()` is false, i.e. always. `component/table/Footer.ts` (whole
  file) is therefore never exercised — its own `setHeight` comment already says
  so: *"Nothing displays a footer today — there is no footer-visibility
  setter."*
- **Evidence**: M2 — `footer: isFooterVisible= false isDisplayed= true
  hasElement= true innerRowHasElement= true footer inline style= {} | is it in
  the parent child list= true`. The empty inline style confirms it never
  receives bounds, and `isDisplayed() === true` confirms it stays in the
  render tree.
- **Proposed change**: either finish it (add `setFooterVisible` and a
  population path) or remove it. If neither is wanted now, the cheap
  intermediate is `this._footer.setDisplayed(false)` at construction so the two
  elements leave the render tree while the API surface stays. Deciding which
  belongs to the `Table` owner, not to this review.
- **Risk / blast radius**: `FooterRow` is exported from
  `component/table/index.ts:31` and documented in
  `docs/components/TableInternals.md`, so removal is a public-API change.
  `FooterRow.classStyleDefaults.test.ts` and `Table.classStyleDefaults.test.ts`
  pin its class-tier rule. `layout/Table.ts:185/:240/:297` reads it.
- **Proof at implement time**: element count per `Table` before/after.

---

### F20.10 The menu button is re-laid-out on every layout pass and flushes an empty style patch

- **Category**: D (avoidable layout pass)
- **Impact**: LOW per table per frame; listed because it is one of the few real
  (non-empty-flush) costs left on the unchanged-pass path.
- **Where**: `layout/Table.ts:389` calls `menuButton.applyBounds(...)`;
  `Button` does not override `canSkipUnchangedLayout`, which defaults to
  `false` (`core/Component.ts:4000`), so `applyBounds` always recurses into
  `doLayout()`. `Header.ts:700-703` (`getMenuButton`) is the owning accessor.
- **Hot path**: every `Table` layout pass (so every resize frame) →
  `layout/Table.commit` → `menuButton.applyBounds` → `Button.doLayout` → its
  `Fit` manager over the glyph.
- **Evidence**: P1 on an unchanged pass — `menuButton.doLayout= 1`, and the only
  apply landing on the button's element is `{"style":{}}` (an empty patch).
- **Proposed change**: the button's rectangle is fully determined by
  `headerBox` and the fixed `TRACK_WIDTH`, so an unchanged pass has nothing to
  re-fit. Either use `setBounds` + an explicit `doLayout()` only when the
  rectangle changed, or opt `Button` into `canSkipUnchangedLayout` (which is a
  slice-13 decision, not this slice's). The comment at `layout/Table.ts:376-388`
  explains why `applyBounds` rather than `setBounds` was chosen — the cascade is
  needed on the frames where the rectangle *does* change, which `applyBounds`
  would still provide once the gate is opened.
- **Risk / blast radius**: `HeaderMenuButton.test.ts` and
  `HeaderMenuButtonChromeHoisting.test.ts` pin the button's placement and glyph
  size; the cited comment warns that without the cascade the glyph is never
  placed at all, so any change must keep the first-pass cascade.
- **Proof at implement time**: a probe asserting `menuButton.doLayout === 0`
  over ten identical `table.doLayout()` calls.

---

### F20.11 `ResizeHandle`'s `dragend` event has no listener anywhere

- **Category**: J (dead code)
- **Impact**: LOW (code health).
- **Where**: `cell/ResizeHandle.ts:15` (`ResizeHandleEvent` union), `:160`
  (`on("dragend", …)` overload), `:192` (`emit` overload), `:212-214`
  (`dragEnd()` → `emit("dragend")`). The one caller,
  `cell/Header.ts:659` (`onResizeDragStop` → `this._resizeHandle.dragEnd()`),
  fires into an empty bag: `HeaderCell`'s constructor
  (`cell/Header.ts:221-226`) registers only `dragstart` and `dragmove`.
- **Evidence**: `grep -rn '"dragend"' packages/ | grep -v node_modules | grep
  -v dist` → 4 hits, all inside `ResizeHandle.ts` itself (type, overload,
  overload, emit). Zero registrations. Nothing outside `cell/Header.ts:221`
  constructs a `ResizeHandle` (`grep -rn "new ResizeHandle" packages/lib/src` →
  1 hit; the other hits are tests).
- **Proposed change**: delete `dragEnd()`, the `"dragend"` union member and its
  two overloads, and the `dragEnd()` call in `onResizeDragStop`.
- **Risk / blast radius**: `ResizeHandle` is exported from the table barrel, so
  this narrows a public event union. No test registers `dragend`.

---

### F20.12 The two badges' construction options have no production caller

- **Category**: J (options never honoured in practice)
- **Impact**: LOW (code health).
- **Where**: `cell/SortPriorityBadge.ts:15` (`SortPriorityBadgeOptions.priority`),
  `:74` (`declare private _priority`), `:93` / `:103-111` (the `applyOptions` override
  and `this._priority ??= null` that exist only to support it); the identical
  shape in `cell/FilterClauseBadge.ts:15`, `:78`, `:103` / `:113-121`.
- **Evidence**: `grep -rn "SortPriorityBadge(\|FilterClauseBadge(" packages/ |
  grep -v node_modules | grep -v dist` → 20 hits. The two production sites
  (`cell/Header.ts:227`, `cell/Filter.ts:112`) both construct with **no
  arguments**. The only site passing `priority`/`count` is
  `SortPriorityBadge.test.ts:71-72`. The `count` option has no caller at all,
  test included.
- **Proposed change**: drop both option fields, the two `applyOptions`
  overrides, and the `??= null` seeding; make `_priority`/`_count` plain
  `= null` fields (they are only `declare`d because `applyOptions` can write
  them during the `super()` cascade — remove the option and the `declare` rule
  no longer applies). Adjust the one test.
- **Risk / blast radius**: both options are on exported interfaces; removal is
  a public-API narrowing. `default-options-fallback.test.ts:341-344` and
  `:602-605` construct both classes with *inherited* Component options only, so
  they are unaffected.

---

### F20.13 `ResizeHandle` writes `zIndex` inline on top of its own shared class rule

- **Category**: B (unchanged-value write), I (duplication)
- **Impact**: LOW — once per handle at construction, i.e. once per rendered
  header cell.
- **Where**: `cell/ResizeHandle.ts:63-79` — the shared `.ResizeHandle` class
  rule already declares `zIndex: "1"`; `cell/ResizeHandle.ts:117`
  (`this.setZIndex(1)` in the constructor) writes the same value again as a
  per-instance style.
- **Evidence**: P6 — `handle inline zIndex writes: 2`. The class rule's own doc
  comment (`:55-62`) states it exists so "per-instance setters only carry
  per-instance state"; `zIndex` is not per-instance state.
- **Proposed change**: delete the `setZIndex(1)` call.
- **Risk / blast radius**: `ResizeHandle.classStyleDefaults.test.ts:62`
  constructs one; check whether it asserts the inline z-index.

---

### F20.14 `HeaderCell.setTooltip("")` still installs four native listeners

- **Category**: G (listener churn)
- **Impact**: LOW.
- **Where**: `cell/Header.ts:556-566` (`setTooltip` → `attachTooltip`
  unconditionally when an element exists) and `:578-584` (`attachTooltip` →
  `Tooltip.attachToElement`). `overlay/Tooltip.ts:574-577` installs
  `mouseover` / `mousemove` / `mouseout` / `mousedown` on the element
  regardless of whether the text is empty. `init` (`cell/Header.ts:257`) is
  guarded by `if (this._tooltipText)`; `setTooltip` is not. The same shape
  exists in `cell/ParentHeader.ts:252-258`.
- **Evidence**: read of both methods; `init`'s guard is the precedent the
  setter is missing. Not separately probed.
- **Proposed change**: detach rather than attach when `text` is empty.
- **Risk / blast radius**: `columnRowHooks.apply` (`Header.ts:1003-1004`)
  already guards on `cell.getTooltip() !== description`, so this only bites a
  field whose description is cleared to `""` after having had one.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `TableHeader` (`Header.ts`) | `<thead>` band: three windowed rows + the column-menu button; reconciles the rendered cell set to the horizontal column window and positions all three rows' cells | 1 `<thead>`; no per-instance rule beyond its class tier | Per pass: 1 `Array#map` (widths) + 1 `new Array(n)` (lefts) in `computeColumnWindow`; 1 `hasParentRow` (1 array alloc) + **2** `hasFilterRow`; N `applyBounds` per row. 0 rule writes, 0 `DOM.source` reads (R1/R2). | fits | F20.1, F20.2, F20.4, F20.6, F20.10 |
| `Column` | Resolved per-column presentation descriptor built by `Column.resolve` | none | none | fits (see dead-code note on its two mutators) | — |
| `ColumnConfig` / `ColumnSpec` | Consumer-facing per-column and table-wide config interfaces | none | none | fits | — |
| `ColumnFilter.ts` | Pure operator/descriptor logic: operator sets, labels, glyph names, `buildColumnFilter`, state equality | none | none — no component, no DOM, no import of `core/` | fits (a positive: the whole filter model is DOM-free) | — |
| `FooterRow` (`Footer.ts`) | `<tfoot>` band with one `Row`, width/height delegated | 1 `<tfoot>` + 1 `Row` element, both live | none (never given bounds) | **dead** | F20.9 |
| `HeaderCell` (`cell/Header.ts`) | Sortable `<th>` with title, optional glyph, resize handle, priority badge, tooltip, context menu | 1 `<th>`; `#id` rule materialised **only** when column-focused; 3 side-loaded children | 0 on an unchanged pass (`canSkipUnchangedLayout` → `true`); on a changed rect, its `Card` layout + renderer fit | fits | F20.4, F20.5, F20.7, F20.14 |
| `ParentHeaderCell` (`cell/ParentHeader.ts`) | Blank-or-labelled `<th>` spanning a contiguous group run; context menu + tooltip | 1 `<th>` | 1 `applyBounds` per cell per pass (spans read from constraints) | fits, but not re-targetable | F20.6, F20.14 |
| `ResizeHandle` (`cell/ResizeHandle.ts`) | 5 px right-edge drag target; owns mousedown/click, forwards drag events | 1 `<div>`, styled by one shared `.ResizeHandle` class rule; **0** per-instance declarations (P6) | none — never laid out (absolute, sized by the class rule) | fits | F20.11, F20.13 |
| `SortPriorityBadge` (`cell/SortPriorityBadge.ts`) | Corner numeral for multi-sort priority ≥ 2 | 1 `<span>`, one shared class rule, **0** `#id` declarations (P6) | none | over-built (unused option), hidden the wrong way | F20.8, F20.12 |
| `FilterClauseBadge` (`cell/FilterClauseBadge.ts`) | Corner numeral for ≥ 2 effective filter clauses, plus `aria-label` | 1 `<span>`, one shared class rule, **0** `#id` declarations (P6) | none | over-built (unused option), hidden the wrong way | F20.8, F20.12 |
| `FilterCell` (`cell/Filter.ts`) | `<th>` hosting one column's filter input + operator picker, clause list, badge, clauses popover | 1 `<th>`; side-loaded badge; lazily-created `Popover` | 0 on an unchanged pass (R2b: `FilterCell.doLayout = 0` over 10 passes) | fits, but its setters re-apply unconditionally | F20.2, F20.3 |
| `FilterCellRenderer` / `FilterOperatorButton` (`cell/renderer/Filter.ts`) | `HBox` of a `TextField` + a glyph-only `MenuButton`, with a click-veto predicate for the 2+-clause case | none of its own beyond the `CellRenderer` box | 0 on an unchanged pass | fits | — (its button is the victim in F20.2 / F20.3) |
| `TableHeaderMenuButton` (private, `Header.ts:128`) | Column-options trigger filling the vertical-scrollbar reservation band | `Button` chrome; a shared `table-header-menu-glyph` trait rule | 1 `doLayout` per table pass + 1 empty style flush (P1) | fits | F20.10 |

---

## Redundant, duplicated and dead code

Items not already covered by a finding above.

1. **The 2026-08-29 audit's Priority-2 item #1 is CLOSED.** It reported
   *"`Header.ts` has two ~150-line duplicated windowed-cell reconcilers …
   within the column row alone, per-column state application is also duplicated
   between its full and slide paths."* Both halves are fixed in the current
   file: `reconcileWindowedRow<TCell>` (`Header.ts:824-901`) and
   `reconcileWindowedRowSlide<TCell>` (`Header.ts:927-958`) are the single
   generic algorithm the audit asked for, parameterised by
   `WindowedRowHooks<TCell>` (`Header.ts:209-214`); `reconcileColumnCells`
   (`:1090`) and `reconcileFilterCells` (`:1516`) are now ~30 lines each of
   bookkeeping around them, and **both** the full and slide paths route
   per-column state through the same `hooks.apply`. Nothing to carry forward.
   *What a shared reconciler looks like, for the record:* it already exists —
   the only asymmetry left is that the column row tracks `_lastEnteredCells`
   for `syncSortIndicators` scoping while the filter row does not, which is a
   deliberate difference (the filter row has no equivalent downstream
   consumer), documented in `filterRowHooks`'s own doc comment (`Header.ts:1036-1043`).

2. **The audit's item #9 `range()` triplication is CLOSED.** All three sites now
   call `Util.range`: `Header.ts:941-942`, `Row.ts:724/732-733`,
   `Body.ts:1213-1214`. `grep -n "function range" component/table/*.ts` → 0
   hits; the single definition is `core/Util.ts:419`.

3. **`Column.setHeaderGlyph` / `Column.clearHeaderGlyph` have no production
   caller, and mutating a `Column` has no rendering effect.** `grep -rn
   "\.setHeaderGlyph(\|\.clearHeaderGlyph(" packages/ | grep -v node_modules |
   grep -v dist` → 12 hits: `Column.ts:188` (`clearHeaderGlyph` delegating to
   its own setter), `Header.ts:1010` and `cell/Header.ts:262` (those are
   `HeaderCell.setHeaderGlyph`, a different method), and 8 test lines. The
   class's own JSDoc says it is *"created internally by `Column.resolve` — not
   constructed directly by application code"*, and nothing re-reads a mutated
   `Column` until someone calls `TableHeader.setColumns` again — so the two
   mutators are a write-only API. Candidates for removal, or for a documented
   "call `table.setColumns` after mutating" contract.

4. **`TableHeader.getModel()` has zero callers.** `grep -rn "getHeader()\.getModel\|header\.getModel()" packages/ | grep -v node_modules | grep -v dist`
   → 0 hits; the wider `\.getModel()` grep across `component/` finds only
   `ModelRecord.getModel()` uses in `data/`. `Header.ts:379-381`.

5. **`renderColumnWindow` re-derives the column window the body just derived.**
   `Header.renderColumnWindow:1566-1573` builds its own `widths` array and calls
   `computeColumnWindow`, while `Body.renderWindow` does the same against the
   body's own (very slightly different) viewport width — two O(N) passes and
   four array allocations per frame for one table. The two windows are
   deliberately *not* equal (the header's width excludes the scrollbar band —
   see the class doc above `Header.ts:235`), so this is not straightforwardly
   shareable; noting it as a known, accepted duplication rather than proposing a
   change. M3c confirms 1 `Array#map` + `computeColumnWindow`'s own
   `new Array(n)` per header pass. Below the reporting floor on its own.

6. **`hasFilterRow()` is evaluated twice per layout pass** (M3b:
   `hasParentRow= 1 hasFilterRow= 2`) — once by `layout/Table.calculate` for the
   row height, once by `reconcileFilterCells`. Each call filters the column list
   (`Header.ts:623-630`). One array allocation per pass at 20 columns; noted for
   completeness, not worth a plan of its own.

7. **The `PARENT_HEADER_CELL_TEXT_FONT_SIZE_VAR` / `_RULE` constants in
   `cell/ParentHeader.ts:18-23` are a deliberate verbatim copy** of
   `cell/Header.ts:85-90`'s pair, with a comment saying so. Two string literals;
   leaving as-is is defensible, but a shared `table/cell/headerFont.ts` would
   remove the drift risk if either file is touched for another reason.

---

## Cross-slice notes

- **→ 19 table-core**: `component/table/Table.ts:336`'s
  `setWillChange("transform")` is the write half of F20.1; the transform half
  lives in my slice. Whoever plans F20.1 needs both files.
  `Table.ts:321`'s `_footerVisible = false` (F20.9) is also that slice's.
- **→ 19 table-core**: `Table.onColumnResize:2167-2236` is well-behaved and
  should be protected — it does pure arithmetic and ends at `scheduleLayout()`,
  so raw mousemoves coalesce to one pass per frame, and it **early-returns
  before scheduling** when the drag is in the dead zone. That is the fix slice
  06 wants ported into `Split` (and slice 08 found `Accordion` already has);
  the table is a third precedent.
- **→ 19 table-core, agreeing**: that slice's finding that `Table.getColumns()`
  re-derives the resolved+filtered column list per raw pointer move
  (`Table.ts:2173`) sits on the same raw-mousemove leg my slice feeds. The
  header's own share of that leg is small and needs no plan of its own:
  `HeaderCell.onResizeDrag` → `ResizeHandle.dragMove` →
  `HeaderCell.emit("resizedrag")` → the `wireCell` closure
  (`Header.ts:1223`) → `columnIndexOf:1234` → `getColumns().indexOf(cell)`.
  `Component.getComponents()` returns the live array (`core/Component.ts:7035`,
  no copy), so that is one linear scan over the rendered window per move and
  zero allocations. Wiring at creation rather than per reconcile
  (`Header.ts:1220-1224`) is the right call and should be protected — the
  method's own doc explains that re-wiring a survivor would stack duplicate
  listeners and make one drag emit `columnresize` several times.
- **→ 08 layout-accordion-table-serialization**: `layout/Table.commit:389`'s
  `menuButton.applyBounds(...)` is the site in F20.10, and `layout/Table.ts:240`
  is the `isFooterVisible()` gate in F20.9.
- **→ 13 button-glyph-image**: this slice is a second heavy per-event caller of
  the unguarded `Button.setGlyph` (16 calls / 48 stylesheet ops per filter
  commit, P3), alongside `ScrollStrip.layoutArrows` and
  `VideoPlayer.syncFromState`. It is also a per-keystroke caller of the
  unguarded `Button.setText` and `Button.clearDescription` (P2). A same-value
  guard on those three would fix F20.2 and F20.3 without touching this slice.
- **→ 14 text-and-small-display**: `Text.setText`'s missing same-value guard is
  what turns F20.4 and F20.7 from bookkeeping into DOM writes — 32 identical
  text applies per sort click at 8 columns.
- **→ 11 overlay-popups-layers-animation**: `Tooltip.attach`'s
  non-idempotence lands here 2× per filter keystroke (P2) and 48× per filter
  commit (P3). `Tooltip.attachToElement` (the element-keyed variant the header
  cells use) installs a native `mousemove` listener per attached element
  (`overlay/Tooltip.ts:574-577`) — a rendered header is up to 20 more resting
  `mousemove` registrations on top of the count slice 11 gives for buttons.
- **→ 01 / 03 / 04, the `InlineStyle.flushDirty` empty-bag guard**: confirmed
  and quantified for this slice. Per unchanged pass on a 20-column header:
  **29 of 30 applies are empty** (R2). With the filter row on: **49 of 50**
  (R2b). Per column-resize drag frame: **42 of 68** (R1). Per sub-column
  horizontal scroll with no window change: **16 of 19** (R4). This is the
  single largest remaining per-frame item in the slice and it is entirely
  upstream.
- **→ 01 core-component-lifecycle**: `Cell.canSkipUnchangedLayout` →
  `true` (`cell/Cell.ts:256`) is doing real work here — R2 measured **0**
  `HeaderCell.doLayout` calls over 10 identical passes on a 20-column header.
  Together with slice 08's `layout/Table` correction, the "no built-in manager
  uses `applyBounds`" claim is now wrong in three places: `layout/Table`,
  `TableHeader.positionColumnCells/positionParentCells/positionFilterCells`
  (`Header.ts:1622/1640/1659`), and `layout/Table.commit`'s menu-button call.
- **Contract that does hold**: the header reads no live geometry during layout.
  R1 and R2 spied `getViewportRect`, `getElementRect`, `getScrollMetrics`,
  `getOffsetSize`, `getBorderWidths`, `getComputedOverflow`, `measureText`,
  `measureTexts`, `getScrollLeft/Top`, `getThemeVariable`, `getViewportSize` and
  recorded **zero** calls per resize frame and per unchanged pass. The one
  `DOM.source` read in the whole slice is `getViewportRect(this._menuButton)` in
  `Header.onMenuButtonAction:714` — once per menu open, a cold path.
- **Open plan `plans/table-column-pinning.md`**: it adds `ColumnConfig.pinned`
  and `Column.isPinned()` (two of my files) and composes two `Table` instances.
  Nothing in it adds per-frame header work, and it does not contradict any
  finding here. Two interactions worth flagging to whoever implements it:
  (a) it doubles every per-`Table` cost in this report — including the
  never-shown `FooterRow` (F20.9), the misplaced `will-change` (F20.1), and the
  per-pass menu-button layout (F20.10) — so landing F20.1/F20.9 first is
  cheaper than fixing them twice; (b) its "single unified column context menu"
  routes both child headers' `columncontextmenu` up to `PinnedTable`, which is
  compatible with the existing event surface (`Header.ts:511-518`) as written.
  I did not verify the plan's own line-number references.

### Positives to protect (a plan must not regress these)

1. **A column-resize drag frame writes no stylesheet rule and forces no layout
   read.** R1, ten frames: `rule ops per frame across 10 frames = [0,0,0,0,0,0,0,0,0,0]`,
   `frame 3 source reads = {}`. Contrast slice 06's `Split`/`Border`, where an
   unchanged pass mutates the shared sheet 18 times.
2. **An unchanged pass re-lays out no header cell.** R2: 0 `HeaderCell.doLayout`
   over 10 identical passes; R2b: 0 `FilterCell.doLayout`.
3. **A sub-column horizontal scroll that does not move the window reconciles
   nothing.** R4: 19 applies, all style, **16 of them empty**; both reconcilers
   early-return. This is pinned by
   `HeaderColumnWindow.test.ts:1317` and `ColumnFilterRow.test.ts`'s
   "a scroll that leaves the filter window unchanged calls neither shared
   reconciler".
4. **Header hover and press cost zero JS and zero rule writes.**
   `grep -n "mouseover\|mouseout" component/table/Header.ts component/table/cell/*.ts`
   finds **no** hover listener anywhere in the slice — the header adds nothing
   to the per-`mousemove` ancestor walk slice 03 and slice 08 are tracking.
   `HeaderCell`'s pressed look is the browser-driven `:active` pseudo-class
   declared in `ownStyleStates` (`cell/Header.ts:173-181`), so it is one shared
   class-tier rule and nothing runs on mousedown.
5. **The three side-loaded overlays materialise zero per-instance stylesheet
   declarations.** P6: `SortPriorityBadge #id: [] | FilterClauseBadge #id: [] |
   ResizeHandle #id: []`. Their static geometry lives in one shared class rule
   each (`ensureSortBadgeClassRule`, `ensureFilterClauseBadgeClassRule`,
   `ensureResizeHandleClassRule`). This is the pattern F20.5 wants extended to
   the focus underline.
6. **The setters that are guarded, and must stay guarded**:
   `HeaderCell.setHeaderText` (`cell/Header.ts:459`),
   `Cell.setBaseBackground` (`cell/Cell.ts:525`, guarded and routed through a
   shared value-class rule rather than `#id`), `FilterCell.setFieldName`'s
   popover-close condition (`cell/Filter.ts:230`), and the column-row hooks'
   own explicit guards on `setTooltip` and `setHeaderGlyph`
   (`Header.ts:1003-1010`) — the last one matters because
   `HeaderCell.setHeaderGlyph` disposes and rebuilds a `Glyph` and calls
   `this.doLayout()` synchronously.
7. **`ColumnFilter.ts` is a pure module** — no `core/` import, no DOM, no
   component. Keep it that way; it is why the filter model can be unit-tested
   and worker-serialised.

---

## Suggested plan grouping

**Plan A — "Filter-row write economy"** (F20.2, F20.3). One coherent change
set: guard `FilterCell.setOperators` on operator-list identity, cache the last
operator written to the button face in `applyOperatorFace`, guard `syncBadge`'s
title/description writes on their composed values, and narrow
`Header.onStoreFilterChange` from "mark the whole row dirty" to "re-apply state
to the cells whose cached entry was dropped". Biggest single win in the slice
(48 → ~0 stylesheet ops per filter commit at 8 columns; 120 → ~0 at 20) and it
is measurable on its own. Depends on nothing; **benefits from** but does not
require slice 13's `Button.setGlyph`/`setText` guards — if those land first,
half of Plan A becomes a no-op and the plan should be re-scoped to the
`onStoreFilterChange` narrowing plus the double-`applyOperatorFace` removal.

**Plan B — "Header scroll-mirror promotion"** (F20.1). Small and independent:
move `will-change: transform` from the `<thead>` to the elements that actually
receive the transform (or hoist the translate onto one promoted wrapper).
Touches `component/table/Table.ts` (slice 19) and
`component/table/Header.ts`. Must be measured in the real WebKitGTK harness —
this is a compositing change and the offline sink cannot show the gain. Land it
before `table-column-pinning`, which would otherwise duplicate the defect.

**Plan C — "Header state-write economy"** (F20.4, F20.5, F20.7). Three
same-shaped fixes: an unchanged-state guard on
`setSortState`/`clearSortState`, the sort-sweep de-duplication, an unchanged-value
guard on `setRequired`, and the `.columnFocused` declared-state conversion.
They share a test surface (`cell/Header.test.ts`,
`TableHeader.classStyleDefaults.test.ts`, `HeaderColumnWindow.test.ts`) so they
are cheaper together than apart. The focus-underline conversion is the riskiest
piece (it changes every declared state's guard suffix on `HeaderCell`) — if the
plan needs to be split, split *that* out and keep the three guards together.

**Plan D — "Parent-row reconciliation"** (F20.6). Needs a new re-target setter
on `ParentHeaderCell`, so it is a genuine design step rather than a guard.
Independent of A–C. Worth doing before `table-column-pinning`, whose unified
column menu will make column toggles more common.

**Plan E — "Header render-tree trim"** (F20.8, F20.9). Two `setVisible` →
`setDisplayed` swaps plus a decision on the `FooterRow`. Small, but it needs an
owner decision on the footer (finish / remove / hide) and it narrows a public
API if removal is chosen, so it should not be bundled into a perf plan.

**Ride-alongs — too small to plan on their own.** F20.10 (menu-button
per-pass layout) should ride with whichever slice-08 plan touches
`layout/Table.commit`, or with slice 13 if `Button.canSkipUnchangedLayout` is
taken up there. F20.11 (`dragend`), F20.12 (badge options), F20.13
(`ResizeHandle` z-index), F20.14 (empty-text tooltip) and the dead-code items
3–4 in the section above are a single "slice-20 dead surface" cleanup commit
with no measurable perf component — attach them to Plan E, which is already
touching the same files and already narrowing public API.

**Ordering.** B and D are independent of everything. A should follow slice 13's
`Button` guards if those are being done anyway; otherwise A stands alone and is
the highest-value item. C is independent but its focus-underline half should
wait for slice 02's `StyleTarget` last-written-value work if that lands, since
the two interact on the same rule-write path. Nothing in this slice depends on
slice 01's `Component.setSize` guard, and nothing here relies on a no-op setter
still doing work — the `ProgressSpinner`-style hidden coupling slice 14 warns
about does not exist in this slice.
