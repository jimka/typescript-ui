# 21 table-cells-renderers — render-work review

**Summary**

The pooled cell is the best-behaved hot-path component I have read in this
campaign. Per rebind it writes **exactly one thing**: the renderer's text. Every
other per-record surface — `.rangeSelected`, `.readOnly`, `.requiredEmpty`,
`.focused`, the group-colour base background, `aria-colindex` — is guarded and
reaches the sink zero times when nothing changed; no cell materialises a
per-instance stylesheet rule at all; a settled pass runs zero `Cell.doLayout`
and zero `getMinSize`/`getMaxSize` on any cell. Three things still cost:

1. **F21.1 — the one unguarded write is unguarded on the worst path.**
   `Text.setText` has no same-value guard, so every renderer rewrites
   `textContent` on every rebind. `Body.onStoreChange` blanks `_boundIndices`,
   so **one `notifyRecordChanged` — i.e. one committed cell edit — rebinds the
   whole visible window**: 200 `textContent` writes, **200 of them writing the
   string already there** (P21.11). MEDIUM-HIGH, per committed edit / per store
   refresh / per poll tick.
2. **F21.2 — the `Cell`'s content-clamp opt-out stops at the cell boundary.**
   `Cell.clampsToContentSize() === false` gives **0** `getMinSize`/`getMaxSize`
   on 105 cells per frame (P21.3/P21.14). One level down, `CellRenderer` and its
   `Text` still clamp to content: **1,710 size-hint calls per width-changing
   frame**, ~1,140 of them (2/3) charged directly to `clampWidth`/`clampHeight`
   (P21.14/P21.17). HIGH, hot path 1.
3. **F21.3 — the temporal renderers build a fresh `Intl.DateTimeFormat` per
   value.** `temporalDisplayText` passes an options object to
   `toLocaleTimeString`/`toLocaleString`, which defeats the engine's cached-
   formatter path: **42–48 µs/call vs 0.65–0.87 µs for a cached formatter —
   a 55–66× factor** (P21.12). Per rebound temporal cell, per sampled row on
   auto-size, and per exported row on CSV/TSV/JSON export.
4. **F21.4 — `docs/concepts/performance.md`'s column-window paragraph is stale
   and wrong in four places.** Cells are cached per type key
   (`Row._cellCache`, landed 2026-08-17, after that paragraph was written),
   nothing about a cell's rule is deleted because a cell **has** no rule, and
   the second traverse of the same column range costs **0 element creations vs
   72** (P21.7). A per-type pool would remove the cost — and already does.
5. **Correction to slice 14**: `CellRenderer.doLayout:120` does **not** drive a
   changing `Text.setLineHeight(px)` per frame. Row height is theme-derived and
   constant across a resize, so the guard at `Text.setLineHeight:1173`
   short-circuits all 72 calls: **0 rule ops on a width-changing frame**
   (P21.4).

---

## Findings

### F21.1 A rebind writes `textContent` unconditionally, and one record change rebinds every visible cell

- **Category**: B (unchanged-value write), G
- **Impact**: MEDIUM-HIGH — 200 redundant `textContent` writes per
  `notifyRecordChanged` on a 21-row × 5-column pool; ~560 on a 21-row ×
  14-column one; ~1,100 on a full-screen 40-row × 14-column table. Fires on
  every committed cell edit, every store refresh, and every poll tick of a
  live-data table. Not per frame — but it lands in one task, so the whole batch
  dirties the `<tbody>` subtree once for zero visible change, immediately after
  `applyBounds` correctly decided to skip every cell.
- **Where**:
  - `cell/renderer/String.ts:80-85`, `Number.ts:108-113`, `Date.ts:38-43`,
    `Time.ts:41-46`, `DateTime.ts:40-45`, `Combo.ts:79-92`, `Link.ts:101-105` —
    every `setValue` ends in an unconditional `this._text.setText(this._display)`.
  - `component/input/Text.ts:828-845` — `setText` has no same-value guard;
    line 843 `DOM.sink.apply(element, { text: text.valueOf() })`.
  - `cell/Cell.ts:739-743` (`Cell.setValue`) — also unguarded, forwards straight
    through.
  - `component/table/Body.ts:483` (`onStoreChange` → `_boundIndices.fill(-1)`),
    `:1434` (`wasRebound`), `component/table/Row.ts:283-295` (`setData`),
    `:867-873` (`bindCell`).
- **Hot path**:
  - user commits an edit → `Cell.commitEdit:689` → `emit("commit")`
  - → `Row.commitCellValue:783` → `record.set(...)` → `_onCellCommit`
  - → `store.notifyRecordChanged` → `Body.onStoreChange:482`
  - → `:483` `this._boundIndices.fill(-1)` — **every** pool slot now reports `wasRebound`
  - → `renderWindow` → `Body.bindAndPositionRows:1434` `wasRebound === true` for all 21 slots
  - → `Row.setData:283` → per cell `bindCell:867` → `Cell.setValue:739`
  - → `StringRenderer.setValue:80` → `Text.setText:828`
  - → `DOM.sink.apply(el, { text })` — one write per text-bearing cell, value identical.
- **Evidence**: probe P21.11 wraps `DOM.sink.apply` and compares every `text`
  patch against the last text written to that same handle.
  `{thirtyScrollTicks: {textWrites: 150, redundant: 0},
    oneRecordChange: {textWrites: 200, redundant: 200},
    tenResizeFrames: {textWrites: 0, redundant: 0}}`.
  P21.1: `Row.setData(sameRecord)` over all 21 pooled rows → 72 sink ops, **all
  72 `apply {text}`**, 0 class writes, 0 rule ops. P21.13: one row's `setData`
  costs 5 sink ops whether the values changed or not.
  The scroll and resize paths are already clean — 0 redundant writes on 30
  scroll ticks, 0 text writes at all on 10 resize frames. This is purely the
  store-refresh cascade.
- **Proposed change**: guard on the *computed display string*, not the raw
  value, in each renderer's `setValue`: after `this._display = …`, `if
  (this._display === previousDisplay && this._value === next) return this;`.
  Guarding on `_value` alone is wrong — `ComboRenderer.setOptions:122` re-enters
  `setValue(this._value)` precisely to re-resolve an unchanged value against a
  new label map, and a `Date` rebind may hand a fresh object with the same
  instant. Safe against element re-materialisation because `Text.render:1510`
  re-applies `getText()` onto every fresh element, so the DOM can never diverge
  from `_options.text`. The one-line alternative is slice 14's proposed
  same-value guard inside `Text.setText`, which fixes this and every other
  `setText` caller at once; if that lands, this finding needs no local change.
- **Risk / blast radius**: `CellTextResolver.text:80-104` calls
  `setValue` then `getDisplayText()` — unaffected, `_display` is unchanged when
  the guard fires. `renderer.test.ts` pins the `_value`/`_display` contract
  (lines 49-158, 323-358) and `GlyphRenderer`'s existing idempotence (`:283`);
  none of them asserts a DOM write count, so none breaks. `GlyphRenderer` and
  `TreeCellRenderer` already delegate or guard and need no change.
- **Proof at implement time**: re-run P21.11 — `oneRecordChange.redundant`
  should go 200 → 0 while `textWrites` drops to 1 (the edited cell). Then a
  counter on the Loom/SQLAdmin table: `apply {text}` ops per committed edit.

### F21.2 The renderer and its `Text` still clamp to content size, under a `Cell` that does not

- **Category**: D (avoidable layout work / missing opt-in), H
- **Impact**: HIGH — 1,710 size-hint calls per width-changing frame at 105
  cells; ~4,700 at a realistic 294-cell table. Hot path 1 (gutter drag, window
  resize, `Dock` pane resize) — 60× per second of drag. Directly compounds the
  cost slices 01 and 05 found (`clampWidth`/`clampHeight` run two full
  content-size aggregations per axis per commit, 44% of `Component`'s size cost).
- **Where**: `cell/renderer/CellRenderer.ts:16` (no `clampsToContentSize`
  override anywhere in `cell/renderer/*`); `core/Component.ts:4164-4178`
  (`clampWidth`), `:4228-4245` (`clampHeight`), `:4092` (the default `true`);
  `cell/Cell.ts:225-227` (the override that works).
- **Hot path**:
  - `Split.flushDrag` / window resize → `Table.doLayout` → `layout/Table.commit:422`
  - → `Body.renderWindowPass` → `bindAndPositionRows:1469` `cells[slot].applyBounds(x, 0, colW, rowHeight)`
  - → `Component.applyBounds` → `writeBounds` reports a width change → `Cell.doLayout:766`
  - → `Card.doLayout` → `LayoutManager.commitBounds` → `renderer.setWidth/setHeight`
  - → `Component.clampWidth:4165` `this.clampsToContentSize()` is `true` for a `CellRenderer`
  - → `renderer.getMaxSize()` + `renderer.getMinSize()` → `Fit.getMaxSize`/`getMinSize` → recurse into the `Text`
  - → and again for `clampHeight`, and again inside `Fit.resolveBounds`.
- **Evidence**: probe P21.14, one 600→597 width frame, 21 rows / 105 cells /
  105 renderers / 84 `Text`s:
  `{cellGetMinSize: 0, cellGetMaxSize: 0,
    rendererGetMinSize: 270, rendererGetMaxSize: 270, rendererGetPreferredSize: 90,
    textGetMinSize: 432, textGetMaxSize: 432, textGetPreferredSize: 144,
    rowGetMinSize: 36, rowGetMaxSize: 36}` — 1,710 calls, of which the `Cell`
  tier contributes **zero**.
  Probe P21.17 tallies the caller of each by stack frame:
  `rendererGetMinSizeBy: {resolveBounds: 90, clampWidth: 90, clampHeight: 90}`,
  `textGetMinSizeBy: {resolveBounds: 144, clampWidth: 144, clampHeight: 144}` —
  **two of every three calls come from a `clampWidth`/`clampHeight` frame**,
  which is exactly what `clampsToContentSize() === false` short-circuits to a
  plain `_options` lookup.
  P21.15/P21.16 confirm the scroll paths already cost zero here (0 renderer
  `getMinSize`/`getMaxSize` on a vertical scroll tick and on a horizontal
  column-window slide) — this is a resize-only cost.
- **Proposed change**: override `clampsToContentSize()` to return `false` on
  `CellRenderer`, for the same reason `Cell` does: a renderer is force-fitted to
  its cell's content box by the cell's own `Card` manager, from a column width
  the renderer does not influence, and it clips rather than inflating. The
  argument in `Cell.ts:212-224` transfers verbatim one level down.
  `CellEditor extends Component` directly (`cell/editor/CellEditor.ts:98`), not
  `CellRenderer`, so `BooleanEditor`'s 16×16 hard max — the case `Cell`'s own
  JSDoc calls out — is untouched by this change.
- **Risk / blast radius**: every `CellRenderer` subclass, including
  `HeaderCellRenderer` / `ParentHeaderCellRenderer` / `FilterCellRenderer`
  (slice 20) and `TreeCellRenderer`. The behavioural change is that a renderer
  handed less than its content-minimum now clips instead of overflowing — which
  is what the table wants and what `Cell` already does above it. Check
  `ColumnWidths.test.ts` (auto-size derives widths from sampled text, not from a
  live renderer's min, so it should be unaffected) and
  `content-box-containment.test.ts:576-607`, which pins the `TreeCellRenderer`
  delegate rectangle.
- **Proof at implement time**: re-run P21.14 — renderer `getMinSize`/
  `getMaxSize` should drop from 270 each to ~90 each (the `resolveBounds`
  third), and the `Text` figures with them. Then ms/frame on the 2×2
  editor-grid horizontal drag with a table pane open.

### F21.3 The temporal renderers construct a fresh `Intl.DateTimeFormat` on every formatted value

- **Category**: G (allocation churn), H
- **Impact**: MEDIUM on rebind, HIGH on export and auto-size. 42–48 µs per
  formatted value against 0.65–0.87 µs for a cached formatter. A full-window
  rebind of a 21-row pool with two temporal columns = 42 values = **~1.9 ms**
  of formatter construction, on top of F21.1's redundant writes and in the same
  task. A 100,000-row CSV export with one `datetime` column = **~4.8 s** of
  pure formatter construction. `Table.collectCandidates:2566` samples 50 rows
  per auto-size derivation, ~2.4 ms per temporal column.
- **Where**: `data/temporalText.ts:29-36` — `toLocaleTimeString(undefined,
  {...})` and `toLocaleString(undefined, {...})`; called from
  `cell/renderer/Time.ts:43`, `DateTime.ts:42`, and (via the no-options fast
  path, which is fine) `Date.ts:40`. Consumers:
  `cell/CellText.ts:102` (`CellTextResolver.text`), reached from
  `TableExporter.formatValue:157`, `Table.ts:2110/2554/2581/2782`,
  `Body.ts:1769` (clipboard copy of a cell range).
- **Hot path**:
  - `Body.onStoreChange` → `renderWindow` → `Row.setData` → `bindCell`
  - → `TimeCell.setValue` → `TimeRenderer.setValue:41`
  - → `temporalDisplayText('time', showSeconds, value)` (`temporalText.ts:29`)
  - → `Date.prototype.toLocaleTimeString(undefined, options)` — the options-object
    overload allocates and initialises a new `Intl.DateTimeFormat` per call;
    only the zero-argument form hits the engine's cached-formatter path.
  - Separately: `Table.exportCSV:2050` → `TableExporter` → `CellTextResolver.text`
    → the same call, once per record per temporal column, unbounded.
- **Evidence**: probe P21.12, 20,000 calls on node v25.9.0 (ICU, same class of
  implementation as WebKitGTK's):
  `{toLocaleDateString_noOpts_ms: 9.6, toLocaleTimeString_withOpts_ms: 850,
    cachedIntl_time_ms: 12.9, toLocaleString_withOpts_ms: 964.6,
    cachedIntl_datetime_ms: 17.4}`.
  That is 0.48 µs, 42.5 µs, 0.65 µs, 48.2 µs, 0.87 µs per call — the
  options-object path is **66×** the cached path for `time` and **55×** for
  `datetime`. Absolute figures are node-measured; the *ratio* is the
  transferable claim, and it is an engine-independent consequence of
  constructing a formatter per call.
- **Proposed change**: memoise four `Intl.DateTimeFormat` instances at module
  scope in `data/temporalText.ts` (time ± seconds, datetime ± seconds) and call
  `.format(value)`. Keep `toLocaleDateString()` as-is — its no-options form is
  already the fast path. The formatters must be rebuilt if the locale changes;
  the module has no locale input today (it always passes `undefined`), so a
  plain lazy module-level cache is sufficient and matches the current contract.
- **Risk / blast radius**: the output string must stay byte-identical, because
  `renderer.test.ts:220` ("every renderer's display text matches
  `temporalDisplayText` — the guard against the cell and the filter drifting
  apart") and the `contains`/`startsWith` filter path both depend on it.
  `Intl.DateTimeFormat(undefined, opts).format(d)` is specified to produce the
  same string as `d.toLocaleTimeString(undefined, opts)`, so this is a pure
  hoist. `TableExporter.test.ts` and `ColumnFilter.test.ts` pin the text.
- **Proof at implement time**: a probe timing 20,000 `TimeRenderer.setValue`
  calls before and after (today ~850 ms, expected ~15 ms); then wall-clock on a
  100k-row CSV export with a datetime column.

### F21.4 `docs/concepts/performance.md`'s column-window paragraph is stale — the per-type pool it says does not exist has existed since 2026-08-17

- **Category**: H (doc/implementation mismatch); corrects a premise in this
  review's own brief
- **Impact**: LOW as code, but it is the paragraph the brief asked me to
  quantify, and it currently steers consumers toward a non-existent problem
  ("the lever is fewer type transitions between adjacent columns").
- **Where**: `packages/lib/docs/concepts/performance.md`, "CSS rule generation
  cost", the paragraph beginning "**A table's row pool is fixed size; the cells
  inside a row are not.**" Implementation:
  `component/table/Row.ts:129` (`_cellCache`), `:663-696`
  (`resolveEnteringCell` — cache restore before construct), `:948-966`
  (`retireCell` — files the cell under its key, disposes **only** when the slot
  carried no key), `:815-843` (`Row.cellKey`, the type key),
  `:708-777` (`reconcileWindowSlide`). Introduced by commit `517a7594`
  ("Cache a row's displaced cells instead of disposing them", 2026-08-17); the
  doc paragraph is commit `a7e7c454`, 2026-08-03.
- **Evidence**: probe P21.7, a 14-column table whose adjacent columns never
  share a type (string/number/date/boolean rotation), 140 px columns in a 600 px
  viewport, 21 pooled rows, stepping the scroll one column at a time ten times
  and then repeating the identical sweep:
  `{firstTraverse: {sinkOps: 3667, createElement: 72, ruleOps: 0},
    backTraverse:  {sinkOps: 2474, createElement: 0,  ruleOps: 0},
    secondTraverse:{sinkOps: 2474, createElement: 0,  ruleOps: 0},
    cacheAfterFirst: {totalCached: 36}, cacheAfterSecond: {totalCached: 36}}`.
  Probe P21.9 repeats it with every column declaring `values`, so
  `Row.cellKey` produces a field-namespaced `combo:<field>` key and **no two
  columns can share a cell at all** — the pathological case:
  `{firstTraverse: {createElement: 144, ruleOps: 0},
    secondTraverse: {createElement: 0, ruleOps: 0}}`.
  Probe P21.8, a single one-column step: 198 sink ops, **0** element creations,
  **0** rule ops, cold and warm alike.
  Probe P21.6, the whole 14-column table build: 55 `ensureStyleRule` ops, every
  selector class-scoped (`.Cell`, `.StringCell.focused`, `.StringRenderer`, …)
  — **not one `#id` rule**, so a cell has no per-instance rule to delete or
  re-insert in the first place.
  Four specific corrections:
  1. "rebuilds a cell" — only on a cold cache; the second traverse builds none.
  2. "and its stylesheet rule" — a `Cell` materialises no per-instance rule.
  3. "The freed cell's rule is deleted immediately … nothing carries over" —
     `retireCell` caches rather than disposes; 3,667 → 2,474 sink ops (−33%)
     between the first and second traverse of the same range.
  4. "the framework has no per-column cache to warm" — `Row._cellCache` is
     exactly that, keyed by `Row.cellKey`.
- **Proposed change**: rewrite the paragraph to describe what the code does:
  a row keeps a per-type cell cache, so the first traverse across a set of
  column types pays construction once per (row, type) and every later traverse
  pays none; no stylesheet rule is involved in either direction. The brief's
  question "would a per-type pool remove it" is answered: yes, and it is
  already implemented. Note the remaining cost honestly — see F21.9 for the
  cache's growth.
- **Risk / blast radius**: documentation only.
- **Proof at implement time**: none needed; P21.7/P21.8/P21.9 are the proof.

### F21.5 Correction to slice 14 — `CellRenderer.doLayout` does not drive a changing line height

- **Category**: correction (slice 14's `Text.setLineHeight` entry names
  `CellRenderer.doLayout:120` as a per-frame full-document restyle)
- **Impact**: none as reported — the per-frame cost is not there. The real cost
  is one shared rule per distinct row height for the life of the page.
- **Where**: `cell/renderer/CellRenderer.ts:105-124` (`doLayout` →
  `child.setLineHeight(h)` at `:120`); `component/input/Text.ts:1162-1180` (the
  guard at `:1173`); `component/table/RowMetrics.ts:19-25` (`tableRowHeight`);
  `component/table/Body.ts:356`/`:381` (the only two writers of `_rowHeight`).
- **Evidence**: probe P21.4, one 600→597 width frame over 105 cells:
  `{rendererDoLayout: 90, textSetLineHeight: 72, ruleOps: 0, ruleOpDetail: []}`
  — 72 `setLineHeight` calls, **zero** stylesheet-rule operations. The guard at
  `Text.setLineHeight:1173` (`_options.lineHeight === value &&
  _lineHeightCSSVar === null && _lineHeightCSSRule === null`) short-circuits
  every one, because the px argument is `child.getHeight()`, which resolves to
  the row height, which `RowMetrics.tableRowHeight()` derives from the theme
  and which no resize can change. `Component.getHeight:4185` reads the cached
  `_width`/`_height` fields, so the call forces no layout either.
  P21.6 shows exactly two line-height rules for the whole table —
  `.SelectableText.lh20px` and `.NumberRendererText.lh20px` (plus
  `.HeaderCellText.lh20px`) — one per `Text` subclass per distinct pixel value.
- **What is true**: `ensureClassStateRule` (`core/ClassStyleRules.ts:1104-1107`)
  memoises per (ctor, suffix) and never deletes, so each distinct row height
  ever rendered leaves three permanent rules behind. Row heights come from a
  small finite set of themes, so this is bounded at a handful of rules — a leak
  in shape, not in practice, for this slice. Slice 14's unbounded-leak concern
  stands for callers that pass arbitrary pixel values (`ComboBox.doLayout:922`
  is the one to check); it does not apply here.
- **Proposed change**: none for this slice. If slice 14's plan adds a
  same-value guard or a rule-eviction mechanism, this call site is already
  compliant and should be cited as the precedent rather than as an offender.
- **Proof at implement time**: P21.4's `ruleOps: 0` is already the assertion a
  regression test would make.

### F21.6 `Cell`'s `.focused` rule is minted once per concrete cell subclass instead of once for the family

- **Category**: C (stylesheet-rule count), I (duplication)
- **Impact**: LOW-MEDIUM — 5 identical rules observed on a four-type table, up
  to 14 across the built-in cell set (`String`, `Number`, `Date`, `Time`,
  `DateTime`, `Boolean`, `Combo`, `Glyph`, `Default`, `Dynamic`,
  `GroupSeparator`, `Header`, `ParentHeader`, `Filter`). Each shared-sheet rule
  raises the cost of *every* later rule mutation anywhere in the document (the
  cost model's "roughly proportional to the number of rules on the shared
  sheet"), so this is a small tax on every other component's rule writes.
- **Where**: `cell/Cell.ts:165-168` —
  `this.ensureSharedStateRule(".focused", { outline: …, outlineOffset: "-1px" })`
  in the base constructor; `core/Component.ts:6101-6103` forwards to
  `ensureClassStateRule(this.constructor, …)`, and `this.constructor` is the
  **concrete** subclass, not `Cell`.
- **Evidence**: probe P21.6, building a 14-column table with string/number/date/
  boolean columns:
  `focusedRules: ["ensureStyleRule .StringCell.focused",
   "ensureStyleRule .NumberCell.focused", "ensureStyleRule .DateCell.focused",
   "ensureStyleRule .BooleanCell.focused", "ensureStyleRule .HeaderCell.focused"]`
  — five rules, identical declarations. Contrast the three states declared
  through `Cell.ownStyleStates` (`cell/Cell.ts:89-106`), which route through
  `resolveStateLevels(declaringCtor, …)` (`core/ClassStyleRules.ts:857-870`) and
  come out as exactly one rule each: `.Cell.rangeSelected`,
  `.Cell.readOnly:not(.rangeSelected)`,
  `.Cell.requiredEmpty:not(.rangeSelected):not(.readOnly)`.
  The element carries the `Cell` class token (that is why those three rules
  match at all — `getStyleClassChain`, `core/ClassStyleRules.ts:1026-1063`,
  includes every participating ancestor's name), so a single `.Cell.focused`
  would match every subclass.
- **Proposed change**: key the call on the declaring class. Either add a
  `Component` seam that takes an explicit constructor (the machinery already
  accepts one: `ensureClassStateRule(ctor, suffix, declarations)`), or move
  `.focused` into `ownStyleStates` behind a per-spec "unguarded" flag — the
  latter is what `cell/Cell.ts:82-88` explains it cannot do today, because
  `guardedSuffixFor` guards a state against *every* higher-priority entry
  unconditionally, which would suppress a focused cell's whole tint. The
  explicit-constructor seam is the smaller change.
- **Risk / blast radius**: the same shape exists at `TreeRow.ts:94` (slice 18),
  `Button.ts:2279-2281` and `ToggleButton.ts:119/269` (slice 13) — `Button`'s
  subclass set is the larger multiplier. Any fix should be a shared seam, not
  four local edits. Changing the selector from `.StringCell.focused` to
  `.Cell.focused` lowers specificity by nothing (both are two class tokens), so
  the cascade is unaffected.
- **Proof at implement time**: re-run P21.6 — `focusedRules.length` 5 → 1 on
  the same table; and the `DiagnosticsOverlay` stylesheet-rule counter on a
  table with all eight built-in column types.

### F21.7 `applyRequiredEmptyState` runs a consumer predicate over every rendered cell on every pass, including pure resize frames

- **Category**: D, G; cross-slice (the loop is in `Body`, the setter is `Cell`'s)
- **Impact**: MEDIUM — 90 invocations per pass at 105 cells, ~250 at a
  realistic 294-cell table, i.e. ~15,000 consumer-predicate calls per second
  during a gutter drag, for a value that cannot have changed. Same shape as
  slice 19's F19.2, one order of magnitude smaller.
- **Where**: `component/table/Body.ts:1459` (the unconditional call, outside
  the `wasRebound || windowChanged` gate that guards its three siblings on
  `:1445-1453`), `:2497-2510` (`applyRequiredEmptyState`), `:2508`
  (`cells[i].setRequiredEmpty(required && empty)`); `cell/Cell.ts:478-487`
  (the guarded setter).
- **Hot path**:
  - gutter drag frame → `layout/Table.commit:422` → `Body.renderWindowPass`
  - → `bindAndPositionRows:1459` `this.applyRequiredEmptyState(row, records[dataIndex])` — **ungated**
  - → per cell: `this._columnConfigs.get(fieldName)` (Map lookup)
    + `config?.requiredPredicate?.(record)` (**consumer callback**)
    + `record.get(fieldName)` + `TableBody.isEmptyValue(...)`
  - → `Cell.setRequiredEmpty:478` — guard hits, returns, zero DOM writes.
- **Evidence**: probe P21.3, a second `doLayout()` at unchanged size over 105
  cells: `{cellSetRequiredEmpty: 90, cellSetStyleState: 105, sinkOps: 105,
  empties: 104, ruleOps: 0}` — 90 calls, 0 resulting sink ops. P21.2, a
  one-row vertical scroll: `{cellSetRequiredEmpty: 100, cellSetValue: 5,
  cellSetReadOnly: 5, cellSetRangeSelected: 5}` — the three gated sweeps
  correctly scope to the one rebound row's 5 cells; the required-empty sweep
  visits all 100.
  The JSDoc at `Body.ts:2479-2487` justifies the ungated position ("because the
  tint depends on the cell's current value, which changes on in-place edits — a
  commit cascades through `store.notifyRecordChanged` back into a
  `renderWindow` pass"). That justification no longer requires the ungating:
  `Body.onStoreChange:483` blanks `_boundIndices`, so the very cascade the
  comment describes already makes `wasRebound` true for every slot (this is the
  mechanism behind F21.1 and slice 19's F19.5).
- **Proposed change**: move the call inside the existing
  `if (wasRebound || windowChanged)` block at `Body.ts:1453-1455`, next to
  `updateCellRangeVisualState`. No change to `Cell`.
- **Risk / blast radius**: correctness depends on every value change reaching
  the body through a store event that blanks `_boundIndices` — true for
  `datachange`/`sync`/`load` (`Body.ts:455-470` → `onStoreChange:482`). A
  consumer mutating a `ModelRecord` without notifying the store already gets no
  re-render of the value itself, so it cannot reasonably expect the tint to
  update either. If slice 19 narrows `_boundIndices.fill(-1)` (its F19.5), the
  two changes must land together or this gate loses its cover — **name this
  ordering constraint in the plan**.
- **Proof at implement time**: a probe asserting `setRequiredEmpty` calls per
  unchanged `doLayout()` is 0 (today 90), and still ≥ 1 per cell after a
  `notifyRecordChanged`.

### F21.8 Every tint setter re-applies all three states, and `_applyStateTint` is called for a single-flag change

- **Category**: B (in shape — every write is guarded, so nothing reaches the
  sink), H
- **Impact**: LOW — three guarded calls where one is needed, on every
  `setReadOnly` / `setRequiredEmpty` / `setRangeSelected`. Pure JS; zero DOM
  writes. Recorded for completeness because it is on the rebind path and
  multiplies by cell count.
- **Where**: `cell/Cell.ts:563-567` (`_applyStateTint`), called from `:458`,
  `:484`, `:506`.
- **Evidence**: `Component.setStyleState:6213-6216` returns immediately when
  `active === this._activeStates.has(name)`, so two of the three calls are
  always no-ops. P21.2 confirms the net effect: one rebound row produced 3
  class-attribute applies for 5 cells across all four state surfaces.
- **Proposed change**: have each setter toggle only its own state
  (`this.setStyleState(".readOnly", value)` etc.). The method's own doc already
  says priority is resolved by the generated CSS guard suffixes, not by call
  order, so there is no ordering dependency to preserve. Too small to plan on
  its own — ride along with F21.6.
- **Risk / blast radius**: `Cell.test.ts:93-190` pins the precedence and the
  idempotence; both are properties of the generated rules, not of this method.

### F21.9 `Row._cellCache` has no eviction and retains a detached cell subtree per (row, column type) forever

- **Category**: G (retention), H
- **Impact**: LOW — memory and handle retention only, no render cost. Included
  because F21.4 removes the cost the docs warned about and this is what
  replaced it, so a plan touching that area should record it rather than
  rediscover it.
- **Where**: `component/table/Row.ts:129` (the map), `:948-966` (`retireCell`,
  the only writer — no size cap), `:663-696` (`resolveEnteringCell`, the only
  reader), `:968-977` (`disposeCellCache`, called only from `setColumnFields`
  at `:386` and `destructor` at `:997`).
- **Evidence**: P21.7 `cacheAfterFirst/{Second}: {totalCached: 36, perRow: 4}`
  after a ten-step traverse of a four-type table — bounded at
  `distinctKeysVisited − windowWidth` per row, so small for a typed table. P21.9,
  every column field-namespaced: `{totalCached: 72}` after the same traverse,
  and it grows with each new column visited. A 100-column table with custom
  renderers and a 21-row pool converges toward ~21 × 95 ≈ 2,000 retained cells,
  each holding a detached element handle, a renderer and a `Text`. They cost no
  layout (`removeElement` → `DOM.sink.removeElement`, out of the render tree)
  and **no stylesheet rules** (P21.6: cells materialise none), which is why this
  is LOW rather than a leak finding.
- **Proposed change**: cap each key's pool (one or two entries is enough —
  `resolveEnteringCell` pops at most one per slide step), disposing the
  overflow. Alternatively evict keys not touched for N window changes.
- **Risk / blast radius**: `RowCellCache.test.ts` and `ColumnWindowSlide.test.ts`
  pin restore-instead-of-rebuild; a cap of ≥ 1 keeps both green.
- **Proof at implement time**: a probe asserting `totalCached` stays bounded
  across a full traverse of a 100-column table.

### F21.10 Unused constructor surface on `Cell`, and a misspelling in it

- **Category**: J (options never passed), H
- **Impact**: LOW — code health.
- **Where**: `cell/Cell.ts:134` — `constructor(tag, renderer, editor?,
  rendererConstraints?, editorContraints?, subclassDefaults?)`.
- **Evidence**: complete grep over `packages/lib/src`, `packages/lib/tests`,
  `packages/docs/src`, `packages/create-app` for `new Cell(`, `new Cell<`,
  `new _Cell`, `super("td"`, `super('td'`, `super("th"`, `super(tag` — 16 call
  sites. **Zero** pass a 5th (`editorContraints`) or 6th (`subclassDefaults`)
  argument. Only `cell/Boolean.ts:24-31` passes a 4th, and it passes `undefined`
  for both the 3rd and the 5th to reach it.
  The 3rd parameter (`editor`, the legacy per-cell editor) is **not** dead: it
  has no caller inside the table (`Row.createCellForField:884-925` never uses
  it), but the docs demo (`src/typescript/ContentBoxPanel.ts:506`) and four test
  files do, so it is live public API. Worth knowing that a cell inside a real
  table therefore always has `_editor === undefined`, making
  `Cell.ts:646` (`if (this._editor)`), `:728` (`if (this._editor !== editor)`)
  and `:845` (`getEditor()`) constant on the production path.
- **Proposed change**: drop `editorContraints` and `subclassDefaults` from the
  signature (or fix the spelling to `editorConstraints` if the parameter is
  meant to stay). Leave the `editor` parameter alone.
- **Risk / blast radius**: both are trailing optional parameters with no
  callers; removal is source-compatible for everything in the repo.

### F21.11 `Body.wireRowCells` allocates three fresh closures per retargeted cell on every column-window change

- **Category**: G; cross-slice (the loop is `Body`'s, the setters are `Cell`'s)
- **Impact**: LOW-MEDIUM — 63 closures per single-column slide step at 21
  pooled rows; ~300 for a page-width horizontal jump. Per horizontal scroll
  tick that moves the window.
- **Where**: `component/table/Body.ts:437-448` (`wireRowCells`), called from
  `:1431`; `cell/Cell.ts:296-344` (`setEditorPool`,
  `setScrollIntoViewHandler`, `setEditEndHandler`, `setNavigateHandler`).
- **Evidence**: read of `Body.ts:439-446` — `setScrollIntoViewHandler(() =>
  this.scrollColumnIntoView(this._focusedColIndex))`,
  `setEditEndHandler(() => {...})` and
  `setNavigateHandler((direction) => this.navigateFromEditingCell(direction))`
  each build a new closure per cell, and none of them closes over anything
  cell-specific — all three read only `Body` state. P21.7's per-traverse
  `addListener: 16 / removeListener: 16` shows the listener side is already
  stable; only these three handler fields churn.
- **Proposed change**: hoist the three to stable bound methods on `Body`
  created once in its constructor, and assign the same references to every
  cell. No signature change — the setters already take a plain function.
- **Risk / blast radius**: `editor.test.ts:311-387` pins the handler behaviour,
  not its identity. Note that `ARCHITECTURE.md`'s "Listeners must reference a
  named function" rule already calls for this shape; `Cell.ts:118-125`
  (`_onRendererDoubleClick`) is the precedent inside this slice, and
  `Cell.ts:209` (`Event.addListener(renderer, 'dblclick', () =>
  this.startEdit())`) is the matching inline-arrow violation that the field was
  introduced to avoid.

### F21.12 Positives to protect

Not a defect list — a regression baseline any plan touching this slice must not
break.

- **A pooled cell materialises zero per-instance (`#id`) stylesheet rules.**
  P21.6: 55 `ensureStyleRule` ops for an entire 14-column, four-type table
  build, every selector class-scoped. This is what makes F21.4's doc paragraph
  wrong and what `setBaseBackground`'s value-class routing
  (`cell/Cell.ts:525-555`) exists to preserve. Pinned by `Cell.test.ts:203`
  ("a rebind toggles shared class tokens, never re-materialising the #id rule")
  and `:389`.
- **The unchanged-geometry skip works end to end.** P21.3: a second
  `doLayout()` at identical size runs 0 `Cell.doLayout` and 0
  `CellRenderer.doLayout` over 105 cells. P21.16: a horizontal column-window
  slide costs 0 cell size-hint calls.
- **Every per-record tint surface is guarded.** `setReadOnly:433`,
  `setRequiredEmpty:479`, `setRangeSelected:501`, `setBaseBackground:528`,
  `Component.setStyleState:6214`, `Aria.setAttribute:792` all early-return on an
  unchanged value. P21.2/P21.3: `ruleOps: 0` and 0 sink ops from all of them on
  both a rebind and an unchanged pass.
- **No rule mutation is reachable on any per-frame or per-scroll path in this
  slice.** P21.2, P21.3, P21.4, P21.7, P21.8, P21.16 all report `ruleOps: 0`.
- **`GlyphRenderer.setValue` is correctly guarded** (`renderer/Glyph.ts:44-47`)
  — which matters because an unguarded call would pay slice 18's `Glyph`
  rebuild cost (74 DOM ops + 3 shared-rule mutations) per rebind. Pinned by
  `renderer.test.ts:283`.
- **`Card` undisplays a `DynamicCell`'s inactive renderers** (`layout/Card.ts:192-197`,
  `setDisplayed(false)`), so the up-to-eight cached variants leave the render
  tree rather than sitting in it as `visibility: hidden`.
- **Alignment is a class default, never a per-rebind write.**
  `NumberRendererText` (`renderer/Number.ts:36-48`) carries `text-align: right`
  on a shared class rule; `DynamicCell`'s left-aligned number row uses a plain
  `SelectableText` because `"left"` already matches `Text`'s own class default
  (`renderer/Number.ts:76-79`). No `setTextAlign` call exists on the rebind path.
- **Correction to slice 19's F19.3 framing.** The focus sweep does call
  `setStyleState` on every pooled cell on every pass when nothing is selected —
  `Body._updateFocusStyle:2584-2591` takes the full-sweep branch because
  `:2594` sets `_previousFocusedCell = null` unconditionally and `:2599`
  returns early when there is no anchor record, so the fast path can never arm.
  But `Component.setStyleState:6213` is guarded, so **all 105 calls produce
  zero DOM writes** (P21.3: `cellSetStyleState: 105`, `sinkOps: 105`,
  `empties: 104`, and the one non-empty op is not from this path). The cost is
  105–294 JS calls and `Set.has` lookups per pass, not 105 class-attribute
  writes. Worth fixing (set `_previousFocusedCell` only when the sweep actually
  cleared something, or keep a `_focusSweepNeeded` flag), but it should be
  rated LOW, not HIGH, and it should not be bundled with a
  DOM-write-reduction plan on the strength of a write count it does not produce.

---

## Entity inventory

| Entity | Stated function | Owns DOM (elements, rules) | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `cell/Cell.ts` — `Cell<T>` | Base table cell; `Card`-toggles a renderer and an editor, carries the four per-record tints | one `<td>`; shared `.Cell`, `.Cell.rangeSelected`, `.Cell.readOnly:not(…)`, `.Cell.requiredEmpty:not(…)`, plus one `.<Subclass>.focused` per concrete class; **no `#id` rule** | settled pass: 0 writes, 0 reads, 0 `doLayout`, 0 `getMinSize`/`getMaxSize`; per `applyBounds`: one empty `InlineStyle` flush (slice 19 F19.1); per rebind: 1 guarded `setReadOnly` + 1 guarded `setRangeSelected` + 1 guarded `setRequiredEmpty` + 1 guarded `setBaseBackground` + 1 guarded `setColIndex` | fits | F21.6, F21.8, F21.10; positives F21.12 |
| `cell/renderer/CellRenderer.ts` | Abstract renderer base: `Fit` layout, theme-driven cell padding, line-height centring | one `<div>`; one `.<Subclass>` class rule | on a laid-out frame: 6 size-hint calls (2 `resolveBounds`, 4 clamp) + 1 guarded `setLineHeight`; 0 rule ops; 0 geometry reads (`getHeight` is cached) | **over-built** (missing clamp opt-out) | **F21.2**, F21.5 |
| `cell/renderer/String.ts` — `StringRenderer` | Render a string through a `SelectableText` | delegates | per rebind: 1 unconditional `apply {text}` | mismatch (unguarded write) | **F21.1** |
| `cell/renderer/Number.ts` — `NumberRenderer`, `NumberRendererText` | Render a number, right-aligned by class default | one extra class rule `.NumberRendererText` | same as `StringRenderer` | fits (alignment handled well) | F21.1 |
| `cell/renderer/Date.ts` / `Time.ts` / `DateTime.ts` | Render a `Date` through `temporalDisplayText` | delegates | per rebind: 1 formatter construction (42–48 µs for time/datetime) + 1 unconditional `apply {text}` | mismatch | **F21.1**, **F21.3** |
| `cell/renderer/Combo.ts` — `ComboRenderer` | Map an option value to its label and render it | delegates | per rebind: 1 Map lookup + 1 unconditional `apply {text}`; `setOptions` rebuilds the whole Map and re-enters `setValue` | fits | F21.1 (guard must be on `_display`, not `_value`) |
| `cell/renderer/Glyph.ts` — `GlyphRenderer` | Render a registry glyph name | creates/destroys a child `Glyph` | per rebind: **guarded**; on change, child swap + `doLayout()` | fits | — (positive) |
| `cell/renderer/Link.ts` — `LinkCellRenderer` | Present a string as a presentational `Link` | delegates to `Link` | per rebind: 1 unconditional `apply {text}` | fits; `color` option has no caller | F21.1; dead-code list |
| `cell/renderer/TreeCell.ts` — `TreeCellRenderer` | Wrap a delegate renderer with indent + expand/collapse toggle | one `<div>`, `Absolute` layout, a `Glyph` toggle rebuilt per `setTreeState` | `doLayout` places 2 children with `setAutoCommitStyle` batching; reads `getPreferredSize()` of the toggle (cached); `setTreeState` is guarded | fits | duplication list (`TOGGLE_WIDTH`); `getDepth()` is test-only |
| `cell/Default.ts`, `String.ts`, `Number.ts`, `Date.ts`, `Time.ts`, `DateTime.ts`, `Combo.ts`, `Glyph.ts` | Typed cells — pick a renderer, declare an editor pool key | nothing beyond `Cell` | none of their own | **over-built** — each re-declares a `setValue` byte-identical to the inherited one; the three temporal cells re-declare an identical `commitEdit` | duplication list |
| `cell/Boolean.ts` — `BooleanCell` | Checkbox cell: the editor doubles as the renderer, commits on toggle | nothing beyond `Cell` | per rebind: `setValue` on the `BooleanEditor` | fits (the `clampsToContentSize` case that motivates `Cell`'s override) | — |
| `cell/Dynamic.ts` — `DynamicCell` | Per-record variant switching over eight built-in cell types | up to 8 renderer children, 7 undisplayed by `Card` | per rebind: `cellType(record)` predicate + guarded `setVisibleComponentId` + `doLayout()` only on a real variant change; for `combo`, `cellValues(record)` + a full `setOptions` Map rebuild | fits | F21.1; inline-arrow listener at `:256` |
| `cell/GroupSeparator.ts` — `GroupSeparatorCell` | Full-width group label row in a rotated table | inherits `DefaultCell`'s; sets its own background + top-divider shadow | constructed per group run, never rebound | fits | `getColor()` + `_color` are dead |
| `cell/CellText.ts` — `buildCellRenderer`, `CellTextResolver` | One authority for "which renderer draws this variant"; an off-screen keyed pool for formatting non-cell values | none (renderers are never parented; `pauseLayout()`ed) | none per pass; per call: one formatter construction for temporal types | fits — the `pauseLayout()` on an unparented renderer (`:93`) is a well-judged detail | **F21.3** (its throughput path) |

---

## Redundant, duplicated and dead code

Items not already covered in Findings.

1. **Seven identical renderer default-option constants.**
   `const _default<X>RendererOptions: Partial<ComponentOptions> = { cursor:
   "text", userSelect: "text" }` appears verbatim at
   `renderer/String.ts:9`, `Number.ts:10`, `Date.ts:10`, `Time.ts:10`,
   `DateTime.ts:10`, `Combo.ts:11`, `Link.ts:23`.
   `grep -c 'cursor: "text", userSelect: "text"' packages/lib/src/typescript/lib/component/table/cell/renderer/*.ts` → 7.
   Consequence beyond tidiness: each produces its own `.StringRenderer` /
   `.NumberRenderer` / `.DateRenderer` / … class rule (visible in P21.6's rule
   list) for the same two declarations. Declaring them once as
   `ownClassStyleDefaults` on a shared text-renderer base collapses seven rules
   into one.

2. **A shared text-renderer base would carry six of the seven renderers.**
   `String`, `Number`, `Date`, `Time`, `DateTime`, `Combo` and `Link` each
   repeat: the `_text` / `_value` / `_display` field triple; the constructor
   block `setText("") ; setPointerEvents("none") ; setAutoMeasure(false) ;
   addComponent(this._text)`; an identical `getValue()`; an identical
   `getDisplayText()`; and a `setValue` differing only in one formatting
   expression. A base with `protected abstract format(value: T): string` and a
   final `setValue` would leave each subclass at its constructor plus one
   `format` method — and would be the single place F21.1's same-value guard
   lands.
   `grep -c 'getDisplayText(): string {' packages/lib/src/typescript/lib/component/table/cell/renderer/*.ts` → 7 (6 identical bodies + `Glyph`'s and `TreeCell`'s variants).

3. **Nine `setValue` overrides that are byte-equivalent to the inherited one.**
   `Default.ts:37`, `String.ts:40`, `Number.ts:40`, `Date.ts:38`, `Time.ts:42`,
   `DateTime.ts:42`, `Boolean.ts:136`, `Combo.ts:54`, `Glyph.ts:31` all read
   `this.getRenderer().setValue(value); return this;`, where `Cell.setValue:739`
   already does `this._renderer.setValue(value); return this;` and
   `getRenderer():751` returns `this._renderer`. The generic parameter already
   narrows the type, so the overrides add nothing. Nine methods deletable.

4. **Three identical `commitEdit` overrides.** `Date.ts:50-62`, `Time.ts:54-66`,
   `DateTime.ts:54-66` — the revert-on-unparseable guard, differing only in the
   editor cast. A `TemporalCell` base (which would also hold the
   `getEditorKey` seconds-suffix logic duplicated at `Time.ts:34` and
   `DateTime.ts:34`) collapses all three.

5. **`TOGGLE_WIDTH` duplicated** — `cell/renderer/TreeCell.ts:16` and
   `component/tree/TreeRow.ts:21`, both `= 20`, each with a comment telling the
   reader to keep them in lockstep. **This is the 2026-08-29 health audit's own
   dead-code item (its "Pre-window dead code" paragraph) and it is still open.**
   `grep -rn 'const TOGGLE_WIDTH' packages/lib/src` → 2.

6. **`DEFAULT_INDENT_PX` duplicated** — exported from
   `cell/renderer/TreeCell.ts:19` (`= 16`, imported by `Row.ts:20` and
   `Table.ts:37`) and re-declared locally at `TreeTable.ts:12` (`= 16`), which
   shadows the importable one. Same shape as item 5, not in the audit.
   `grep -rn 'DEFAULT_INDENT_PX = 16' packages/lib/src` → 2.

7. **`GroupSeparatorCell.getColor()` and its `_color` field are dead.**
   `grep -rn 'getColor' packages/lib/src packages/lib/tests packages/docs/src
   packages/create-app --include=*.ts | grep -v 'getColor(): string' | grep -v
   getColorScheme` → 0 hits. `_color` (`GroupSeparator.ts:20`, assigned at
   `:32`) is read only by that method. The sibling
   `ParentHeaderCell.getColor():285` is equally dead — slice 20's to confirm.

8. **`TreeCellRenderer.getDepth()` has no production caller.**
   `grep -rn 'getDepth()' packages/lib/src/typescript/lib/component/table
   packages/lib/tests/component/table` → 2 hits: the declaration
   (`TreeCell.ts:111`) and one assertion in `TreeCellRenderer.test.ts:90`. The
   host `TreeBody` reads `getToggle()`, not `getDepth()`.

9. **`LinkCellRendererOptions.color` has no caller outside its own test.**
   All 14 `new LinkCellRenderer(` sites across `packages/lib/src`,
   `packages/lib/tests`, `packages/docs/src` and `packages/create-app` pass no
   argument, except `CustomRenderer.test.ts:161`, which exists only to exercise
   the option. Documented public API, so this is "configurability nobody uses"
   rather than something to delete — recorded for the inventory.

10. **`Cell.ts:209` violates the named-function listener rule.**
    `Event.addListener(renderer, 'dblclick', () => this.startEdit())` uses an
    inline arrow, while `Cell.ts:125` defines `_onRendererDoubleClick` as a
    named arrow field for exactly this purpose and `setActiveRenderer:865` uses
    it. The two sites should share the field. Same shape at `Dynamic.ts:256`
    (`checkbox.on("change", (value) => this.emitCommit(value))`), whose own
    comment claims the extraction gives "a stable bound method to call" —
    the wrapping arrow defeats that.

11. **`Cell.setValue` is reachable but never called on the production path for
    a `DynamicCell`.** `Row.bindCell:867-873` routes a `DynamicCell` through
    `bindRecord` and everything else through `setValue`, so `DynamicCell` never
    inherits a `setValue` call. Not a defect; noted because `DynamicCell`
    declares no `setValue` override and a reader may assume one is needed.

---

## Cross-slice notes

- **→ 14 text-and-small-display.** `Text.setText` (`component/input/Text.ts:828`)
  is the single mechanism behind F21.1. My slice supplies the largest
  multiplier found for it so far: **200 identical `textContent` writes per
  `notifyRecordChanged`** (P21.11), rising to ~1,100 on a full-screen wide
  table. If slice 14's same-value guard lands, F21.1 needs no code in this
  slice — but note that the cell renderers run with `setAutoMeasure(false)`, so
  the guard must return **before** the `_measurementDirty = true` write as well
  as before the `apply`, or the saving is only half realised.
- **→ 14 text-and-small-display (correction).** Slice 14's `Text.setLineHeight`
  entry names `CellRenderer.doLayout:120` as a per-frame full-document restyle.
  It is not: probe P21.4 measures 72 `setLineHeight` calls and **0 rule ops**
  on a width-changing frame, because the pixel argument is the theme-derived
  row height and the guard at `Text.setLineHeight:1173` short-circuits. See
  F21.5. The `ComboBox.doLayout:922` half of that entry is untested by me.
- **→ 19 table-core (correction).** Slice 19's F19.3 rates the focus sweep
  HIGH. The sweep does run over every pooled cell every pass, but
  `Component.setStyleState` is guarded, so it produces **zero** DOM writes
  (P21.3: 105 calls, 0 resulting sink ops). It is a JS-call-count finding, not
  a write finding — see F21.12. The fix is still worth making; the impact
  rating should come down.
- **→ 19 table-core.** F21.7 (`applyRequiredEmptyState` ungated at
  `Body.ts:1459`) and F21.11 (`wireRowCells` closure churn at `Body.ts:437-448`)
  are both `Body` edits driving `Cell` setters. They belong with slice 19's
  work, not with a `cell/*` plan.
- **→ 19 table-core (ordering constraint).** F21.7's proposed gate depends on
  `Body.onStoreChange:483` continuing to blank `_boundIndices` on every store
  event. Slice 19's F19.5 proposes narrowing exactly that. **The two must land
  together, or gating the required-empty sweep silently stops clearing a filled
  cell's tint after an edit.** F21.1's guard has no such coupling — it is
  correct under either `_boundIndices` policy.
- **→ 19 table-core.** `Row.setFieldIndent:257-267` (rotated mode only) calls
  `cell.setInsets(new Insets(...))` on every rebind with no unchanged-value
  guard; `Component.setInsets:2531` writes `data-insets` through
  `ElementAttributes.set:30`, which has **no last-value filter** (unlike
  `Aria.setAttribute:792`, which does). One `Insets` allocation plus one
  attribute write per rebound rotated row. Small, but it is the only other
  unguarded write I found on the rebind path.
- **→ 02 core-component-styling.** `Component.ensureSharedStateRule:6101`
  forwards `this.constructor`, so a rule a **base class** constructor ensures is
  minted once per concrete subclass. F21.6 measures 5 identical `.focused`
  rules for the cell family; the same shape is at `TreeRow.ts:94` (slice 18)
  and `Button.ts:2279-2281` / `ToggleButton.ts:119,269` (slice 13), where the
  subclass set is larger. A `Component`-level seam taking an explicit declaring
  constructor fixes all four at once. Note that `ownStyleStates` already
  resolves correctly on the declaring class
  (`ClassStyleRules.ts:857`, `buildResolvedStates:876`) — only the imperative
  `ensureSharedStateRule` escape hatch does not.
- **→ 01 core-component-lifecycle.** `Cell.clampsToContentSize() === false` is
  the concrete counter-measurement for slices 01/05's clamp finding: with it,
  105 cells cost **0** `getMinSize`/`getMaxSize` per frame (P21.3/P21.14);
  without it, the same components one level down cost 1,710 size-hint calls
  (P21.14), two thirds of them from `clampWidth`/`clampHeight` (P21.17). Any
  memoisation plan for size hints should be measured against this slice, where
  both the with- and without-opt-out cases exist side by side in the same tree.
- **→ 20 table-header-columns-filters.** `ParentHeaderCell.getColor():285` is
  dead by the same grep that kills `GroupSeparatorCell.getColor()`.
  `HeaderCellRenderer` and `ParentHeaderCellRenderer` extend `StringRenderer`
  and so inherit every duplication item above and F21.2's missing clamp
  opt-out; a shared text-renderer base has to accommodate their
  `createText()` override (`Header.ts:132`, `ParentHeader.ts:71`), which is the
  existing, well-judged seam for that.
- **Seam that holds.** `Component.applyBounds` + `canSkipUnchangedLayout` do
  what `docs/concepts/layout-system.md` says, and `Cell` is the reason. Nothing
  in this slice contradicts slice 19's account of it.

---

## Suggested plan grouping

**Plan A — "cell renderers stop rewriting text that is already there"**
(F21.1, plus items 1–4 and 9–11 of the duplication list as the vehicle).
Extract a shared text-cell-renderer base carrying the `_text`/`_value`/
`_display` triple, the constructor block, `getValue`, `getDisplayText`, the
class-tier `cursor`/`userSelect` defaults, and a final `setValue` that formats
through an abstract `format()` **and guards on the resulting display string**.
`String`, `Number`, `Date`, `Time`, `DateTime`, `Combo` and `Link` reduce to a
constructor plus `format`. Delete the nine no-op `Cell.setValue` overrides and
fold the three temporal `commitEdit`s into a `TemporalCell` base.
Measured by: P21.11's `oneRecordChange.redundant` 200 → 0, and P21.6's renderer
class-rule count 7 → 1.
*Depends on nothing. Supersedes itself if slice 14's `Text.setText` guard lands
first — in which case keep the refactor, drop the guard.*

**Plan B — "the cell subtree fits its allocation"** (F21.2 alone).
One override on `CellRenderer`. Small, isolated, and the largest per-frame win
in the slice. Measured by: P21.14's renderer/`Text` size-hint counts, and
ms/frame on the 2×2 editor-grid horizontal drag with a table pane open.
*Independent of Plan A. Should be measured before any global size-hint memo
plan from slices 01/05, since it removes two thirds of the traffic that plan
would otherwise cache.*

**Plan C — "temporal formatting stops rebuilding its formatter"** (F21.3).
Four module-level `Intl.DateTimeFormat` instances in `data/temporalText.ts`.
Three lines of behaviour change; the output must stay byte-identical, which
`renderer.test.ts:220` already pins. Measured by: a timing probe on 20,000
`TimeRenderer.setValue` calls (today ~850 ms) and wall-clock on a 100k-row CSV
export.
*Independent. Worth doing on its own — it is the one finding here whose payoff
is measured in seconds rather than milliseconds.*

**Plan D — "shared class-state rules are minted once per declaring class"**
(F21.6, riding F21.8 along).
A `Component` seam, then four call-site updates across slices 13, 18 and 21.
*Cross-slice. Belongs to whoever owns `core/Component.ts`'s styling half
(slice 02); this slice contributes the measurement and one call site.*

**Rides along with slice 19's plans, not with this slice's:**
F21.7 (`applyRequiredEmptyState` gate — **must land with, or after, slice 19's
`_boundIndices` narrowing**), F21.11 (`wireRowCells` closure hoist), and the
`Row.setFieldIndent` insets guard from the cross-slice notes.

**Too small to plan, fold into the nearest neighbour:**
F21.9 (`_cellCache` cap — with any `Row` change), F21.10 (drop the two unused
constructor parameters — with Plan A), duplication items 5 and 6
(`TOGGLE_WIDTH` / `DEFAULT_INDENT_PX`, a shared constants module — with Plan A
or with slice 22's tree-table work), items 7 and 8 (delete
`GroupSeparatorCell.getColor`/`_color` and `TreeCellRenderer.getDepth`).

**Probes** used for this report live in
`.worktrees/_probes/21-table-cells-renderers/` (`cells.test.ts`,
`slide.test.ts`, `rebind.test.ts`, `clamp.test.ts`, `clampsplit.test.ts`);
output at `/tmp/claude-1000/probe-21.txt`. They run against the lib's real
vitest setup and touch nothing in the main tree.
