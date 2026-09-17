# 16 inputs-combo-spinner-file — render-work review

**Summary**

- Opening a store-backed `ComboBox` builds one row subtree per item with no
  virtualisation and measures every label with its own forced document layout:
  500 items → **21,822 sink writes, 16,249 applies, 1,522 element creations and
  500 `measureText` reflows**, for a panel capped at 200 px that shows nine rows.
  `Util.measureTextWidths` (one reflow for the whole batch) already exists and is
  not used. Hot path 5. (F16.1)
- One arrow keystroke on an open dropdown rewrites **every** row's `class`
  attribute **twice** — measured 8 / 24 / 80 writes for 4 / 12 / 40 items, of
  which `2N − 2` are same-valued. Half of them come from `ComboBox.onRowSelected`
  re-committing a selection the list has already committed. Hot path 4. (F16.2)
- Every visible `ComboBox` writes an invalid inline
  `transform: translate3d(NaNpx,NaNpx,0)` onto its caret glyph **on every layout
  pass, forever**, and leaves `will-change: transform` permanently pinned there —
  1 of the 8 applies a settled pass costs, per combo, per resize frame. Hot path
  1. (F16.3)
- `ComboBox.doLayout` lays its label subtree out **twice per pass** (the unused
  default `Absolute` manager, then the hand-rolled placement), and the first of
  those runs against an unsized box, minting a permanent junk
  `.Text.lhNaNpx { line-height: NaNpx }` shared rule. (F16.4)
- `AutoCompleteField.querySuggestions` **mutates the consumer's shared store on
  every keystroke** — it destroys the application's own filters, leaves its own
  behind, emits 2 `datachange` + 2 `filterchange` per keystroke (every `List` /
  `Table` / chart on that store rebuilds), and reads `getRecords()` on the
  synchronous side of an async rebuild. (F16.5)
- **Correction to slice 14's F14.3, which was assigned to me:**
  `ComboBox.doLayout:922` does **not** drive a changing line height.
  `applySingleLineBox` pins `minSize.height === maxSize.height`, so the combo's
  box height cannot move — eight requested heights (40…17 px) all committed as 22
  and produced **zero** rule ops. A real session mints **one**
  `.ComboBoxLabel.lh<N>px` rule per distinct theme font scale, not one per dragged
  pixel. The selector is `.ComboBoxLabel.*`, not `.Text.*`. (F16.6)

---

## Findings

### F16.1 `ComboBoxDropdown.showAt` builds every row and measures every label one at a time

- **Category**: A (forced sync read on a hot path), E (work for invisible
  content), H (function/implementation mismatch)
- **Impact**: **HIGH** — per dropdown open, linear in item count, unbounded.
  A 500-option store-bound combo (a country/user/table-column picker) is a
  four-figure-millisecond stall in the target engine.
- **Where**:
  - `component/input/ComboBox.ts:273-326` — `showAt`
  - `component/input/ComboBox.ts:275` — `this._list.setItemsArray(items)`
  - `component/input/ComboBox.ts:299` → `:373-384` — `measureWidestLabel`, the
    `for (const item of items) Util.measureTextWidth(item.label)` loop
  - `core/Util.ts:92-94` — `measureTextWidth` → `measureTextSize` →
    `DOM.source.measureText` (one off-screen probe + reflow per call)
  - `core/Util.ts:104-106` — `measureTextWidths`, the batched alternative,
    **unused by this slice**
  - `component/input/ComboBox.ts:286` — `COMBOBOX_DROPDOWN_MAX_HEIGHT_PX = 200`
    caps the panel's height but nothing caps the row count
  - `component/list/AbstractSelectableList.ts:1298-1311` — `setItemsArray` →
    `syncRows`; `:1692-1742` — `syncRows` spawns one `SelectableListRow` (plus a
    renderer plus its `Text`) per item. Not virtualised (slice 18).
  - `component/input/AutoCompleteDropdown.ts:148-181` — the same shape, capped
    only by `maxSuggestions` (default 10)
- **Hot path**:
  1. click / `ArrowDown` on a closed combo → `ComboBox.toggleDropdown` (`:962`)
  2. → `ComboBoxDropdown.showAt(surface, list.getItems(), …)` (`:977`)
  3. → `_list.setItemsArray(items)` (`:275`) → `syncRows` → N row subtrees
  4. → `this.getPerimeterSize()` (`:282`) — `getBorderSize` on a **detached**
     panel, so slice 01's uncached pre-connect estimate runs
  5. → `DOM.source.getElementRect(anchorEl)` (`:287`) — forced layout read
  6. → `measureWidestLabel(items)` (`:299`) — **N forced layouts**
  7. → `DOM.source.getViewportSize()` (`:303`) — forced layout read
  8. → `showAnimated()` (`:310`) — mounts; rule writes as each row materialises
  9. → `placeAnchored(rect)` (`:308`) → `AnchorDropdown.placeAnchored` →
     a **second** `DOM.source.getViewportSize()`
  10. → `this.doLayout()` (`:316`) — the whole row list
  Steps 4–7 are reads landing between rule-write batches in one task — the exact
  shape `docs/concepts/performance.md:140` names and slice 12 measured on
  `Menu.show()`.
- **Evidence**: probe `slice16l.probe.test.ts`, case "open cost by item count":
  ```
  n=8:   total writes   702, applies   505, elements   46, measureText   8
  n=40:  total writes  2042, applies  1529, elements  142, measureText  40
  n=200: total writes  8922, applies  6649, elements  622, measureText 200
  n=500: total writes 21822, applies 16249, elements 1522, measureText 500
  ```
  The first open in the process also costs 36 stylesheet-rule ops
  (`slice16h.probe.test.ts`, `open n=8 rule ops : 36`). And, same file:
  ```
  looped  measureTextWidth x40 source calls: {"measureText":40}
  batched measureTextWidths(40)  source calls: {"measureTextWidths":1}
  same answer: true
  ```
- **Proposed change**: three independent steps, in payoff order.
  (a) `measureWidestLabel` calls `Util.measureTextWidths(items.map(i => i.label))`
  once — 500 forced layouts → 1, a one-line swap with a proven-identical answer.
  (b) Cache the widest-label width on the dropdown, keyed on the item array
  identity + the theme generation, so a re-open measures nothing (see F16.7).
  (c) Cap what `setItemsArray` builds. The panel can only show
  `floor(200 / 22) = 9` rows; everything past the scroll viewport is category-E
  work. Either give `AbstractSelectableList` the `VirtualRowView` treatment
  (slice 18's finding, shared fix) or have `ComboBoxDropdown` refuse to build
  more than a windowed slice. This is the largest single number in the slice and
  the one that needs a decision from slice 18's owner, not from here.
- **Risk / blast radius**: `measureWidestLabel` is private to
  `ComboBoxDropdown`; no test pins its per-item call count.
  `tests/component/input/ComboBox.test.ts` pins items/selection semantics, not
  widths. (c) changes `AbstractSelectableList`'s contract and must be planned
  with slice 18.
- **Proof at implement time**: `measureText` count per open under `n=500` (500 →
  0 or 1); total applies per open at `n=500`; wall-clock open latency on a
  500-row store-bound combo in the WebKitGTK harness.

---

### F16.2 One keystroke on an open dropdown rewrites every row's class attribute twice

- **Category**: B (unchanged-value write), D (avoidable work), I (duplication of
  a commit the list already made)
- **Impact**: **HIGH** on hot path 4 — `2N` attribute writes per keypress. A user
  holding ArrowDown through a 40-item combo at a 30 Hz key repeat issues ~2,400
  class-attribute writes per second, ~2,300 of them same-valued.
- **Where**:
  - `component/input/ComboBox.ts:1069-1075` — `onRowSelected` → `setSelectedIndex(index, true)`
  - `component/input/ComboBox.ts:1186-1199` — `setSelectedIndex` → `:1190`
    `this._dropdown.getList().setSelectedIndex(idx, false)` — **re-commits the
    selection the list just committed**
  - `component/list/AbstractSelectableList.ts:1484-1502` — `setSelectedIndex`,
    no unchanged-index guard, ends in `refreshRowVisualState()`
  - `component/list/AbstractSelectableList.ts:1751-1757` — `refreshRowVisualState`
    calls `row.setSelected(...)` **and** `row.setFocused(...)` on every pooled row
  - `component/list/AbstractSelectableList.ts:505-511`, `:531-535` — both
    unguarded, both end in `applyRowClass()`
  - `component/list/AbstractSelectableList.ts:661-677` — `applyRowClass` writes
    the whole `class` attribute
  - `component/list/AbstractSelectableList.ts:2175-2190` — `moveFocus`, the
    list's **own** `refreshRowVisualState()` for the same keystroke
- **Hot path**:
  1. `ArrowDown` → `ComboBox.onKeyDown` (`:1024`) → `_dropdown.handleKey` (`:248`)
  2. → `_list.handleKey` → `moveFocus` → `refreshRowVisualState()` — **pass 1**,
     `2N` class writes
  3. → `notifyUserChange` → `fireChange` → the list's `action` event
  4. → `ComboBoxDropdown`'s listener (`:226`) → `ComboBox.onRowSelected(idx, true)`
  5. → `ComboBox.setSelectedIndex(idx, true)` → `list.setSelectedIndex(idx, false)`
  6. → `refreshRowVisualState()` — **pass 2**, `2N` more class writes, every one
     of them writing the value the row already holds
  7. → `refreshLabel()` → one `text` write on the collapsed label
- **Evidence**: probe `slice16j.probe.test.ts`, "ONE ArrowDown call trace":
  ```
  list.moveFocus(1,,)
  list.refreshRowVisualState()
  onRowSelected(1,true)
  setSelectedIndex(1,true)
  list.setSelectedIndex(1,false)
  list.refreshRowVisualState()      <- the redundant second pass
  refreshLabel()
  ```
  and probe `slice16k.probe.test.ts`, the write log for a 4-item list, where the
  eight writes after `dispatchEvent "change"` are all same-valued:
  ```
  n=4:  total writes 12, class-attr writes  8, of which plain (no selected/focused)  5
  n=12: total writes 28, class-attr writes 24, of which plain 21
  n=40: total writes 84, class-attr writes 80, of which plain 77
  ```
  `Enter` has the identical shape plus `closeDropdown()`.
- **Proposed change**: two halves, either alone helps.
  (a) In `ComboBox.setSelectedIndex`, skip the inner-list write when
  `list.getSelectedIndex() === idx` — that removes pass 2 entirely and leaves
  `refreshLabel` + `notifyChange`, which are the only things `onRowSelected`
  actually needs. Cheap and local to this slice.
  (b) Guard `SelectableListRow.setSelected`/`setFocused` on the cached value, or
  route `applyRowClass` through `Component.setStyleState` (guarded; `TreeRow`
  already does — slice 18's precedent). That removes the `2N − 2` same-valued
  writes in pass 1 too. Belongs to slice 18.
- **Risk / blast radius**: `tests/component/input/ComboBoxDropdownClose.test.ts`
  pins keep-open-on-arrow / close-on-Enter, which (a) does not touch.
  `tests/component/input/ComboBox.test.ts:78-115` pins that `setSelectedIndex`
  fires `change`/`action` by default — (a) must keep the `notifyChange` call
  outside the new guard, since a keystroke that lands on the already-selected row
  still has to fire.
- **Proof at implement time**: a probe asserting class-attribute writes per
  `ArrowDown` is `N`, not `2N`, at `n=4/12/40`; `DiagnosticsOverlay` layout-pass
  rate while holding ArrowDown.

---

### F16.3 Every ComboBox writes an invalid NaN transform on its caret glyph every layout pass, and pins `will-change` forever

- **Category**: B (an unchanged-value write that can never dedupe), F
  (`will-change` misuse), D
- **Impact**: **HIGH** on hot path 1 by multiplication — 1 real inline write per
  settled pass per visible `ComboBox`, plus one permanently promoted compositor
  layer per combo. `docs/concepts/performance.md:86` says the hint is ignored past
  ~50–100 elements per page, so a form full of combos silently burns the page's
  whole `will-change` budget on caret chevrons that never move.
- **Where**:
  - `component/input/ComboBox.ts:658-680` — `ComboBoxCaret`: `addComponent(this._glyph)`
    with **no layout manager**, so the default `Absolute` runs
  - `layout/Absolute.ts:56-57` — `const x = component.getX();` — the child's own,
    never-assigned coordinate goes straight into the placement with no `?? 0`
  - `layout/LayoutManager.ts:551` — `positionUnchanged = x === component.getX() + component.getTranslateX()`
    — never true once NaN is in play
  - `layout/LayoutManager.ts:555-558` — the fast path: `setWillChange("transform")`
    then `setTranslate(x - getX(), y - getY())` → `NaN`
  - `core/Component.ts:4648` — `setTranslate`'s guard `this._translateX === x`
    cannot fire for `NaN`
  - `core/Component.ts:4658` — `"translate3d(" + Math.round(NaN) + "px,…"`
- **Hot path**: `Split` gutter drag → pane `doLayout` → … → `ComboBox.doLayout`
  → `super.doLayout()` → `Absolute` over `[_label, _caret]` → `ComboBoxCaret.doLayout`
  → `Absolute` over `[_glyph]` → `commitBounds(glyph, NaN, NaN, 14, 14)` → fast
  path → `setTranslate(NaN, NaN)` → `DOM.sink.apply(glyph, { style: { transform: "translate3d(NaNpx,NaNpx,0)" } })`.
- **Evidence**: probe `slice16f.probe.test.ts`, settled passes 1 and 2 of a
  mounted `ComboBox`, identical:
  ```
  ComboBox settled pass 2 applies (8):
     handle5 => EMPTY
     handle6 => EMPTY
     ComboBoxLabel#… => EMPTY
     ComboBoxCaretGlyph#… => {"style":{"transform":"translate3d(NaNpx,NaNpx,0)"}}
     ComboBoxCaret#… => EMPTY
     handle5 => EMPTY
     handle6 => EMPTY
     ComboBox#… => EMPTY
  ```
  and `slice16g.probe.test.ts`:
  ```
  glyph  x/y/w/h : [null,null,14,14]      (JSON renders undefined/NaN as null)
  glyph  translate: [null,null] isNaN: true
  willChange writes over the whole run: ["{\"style\":{\"willChange\":\"transform\",\"transform\":\"translate3d(NaNpx,NaNpx,0)\"}}"]
  transform writes over 10 settled passes: 10
  total applies over 10 settled passes    : 80
  ```
  One `willChange: "transform"` write and no clearing write: the promotion is
  permanent.
- **Proposed change**: fix it in this slice and report the cause upstream.
  Locally: give `ComboBoxCaret` a `Fit()` layout manager — the class's own comment
  already says "the glyph fills the box so it centres trivially", but nothing
  places it today. Upstream (→ slice 05): `Absolute.doLayout` must coalesce
  `getX()`/`getY()` to `0`; and (→ slice 01) `Component.setTranslate`'s guard
  should reject a non-finite argument rather than writing `NaNpx`.
- **Risk / blast radius**: `Fit` on `ComboBoxCaret` changes the glyph from
  "unpositioned" to "fills the caret box"; the caret is already `min == max ==
  glyphMd` square and the glyph's `preferredSize` is that same square, so the
  rendered result should be identical. `tests/component/input/ComboBox.test.ts`
  does not assert caret geometry. Worth a visual check of the chevron.
- **Proof at implement time**: a probe asserting zero `transform` writes across 10
  settled `ComboBox` passes; `DiagnosticsOverlay` node/layer counts unchanged;
  ms/frame on a gutter drag over a form of 20 combos.

---

### F16.4 `ComboBox.doLayout` lays its label subtree out twice per pass, and the first run mints a permanent `.Text.lhNaNpx` rule

- **Category**: D (avoidable layout pass), C (stylesheet-rule write), J (a rule
  that is pure garbage and is never deleted)
- **Impact**: **MEDIUM-HIGH** — the double pass is per frame per visible combo;
  the junk rule is once per process plus two class-attribute writes per combo at
  first render. A permanently-inserted rule is charged on every later
  full-document restyle in the target engine.
- **Where**:
  - `component/input/ComboBox.ts:897-932` — `doLayout`; `:898` `super.doLayout()`
    runs the **unused** default `Absolute` over `_label` and `_caret` with their
    previous (or unset) bounds, **before** `:916-929` assign the real ones
  - `component/input/ComboBox.ts:924` — `this._label.doLayout()`, the explicit
    second pass
  - `component/input/ComboBox.ts:591-610` — `ComboBoxLabel.doLayout`; `:594`
    `getContentBounds()` returns `{ width: NaN, height: NaN }` on the first run
    (the object is non-null, so the `!box` guard does not catch it)
  - `component/list/renderer/Label.ts:104` — `const box = this.getContentBounds() ?? { … }`
    — the `??` fallback only catches a `null` **object**, not null/NaN members
  - `component/list/renderer/Label.ts:113` — `this._label.setLineHeight(box.height)`
  - `component/input/Text.ts:1173` — the numeric guard `this._options.lineHeight === value`
    is false for `NaN` by definition, so the value tier is entered
  - `component/input/Text.ts:1200` — `setValueStyleState("lh", "NaNpx", { font: { lineHeight: "NaNpx" } })`
  - `core/ClassStyleRules.ts` `_stateBags` — permanent, no delete path
  - `component/input/ComboBox.ts:926-929` — the caret's new bounds are written by
    setters that `scheduleLayout()`, with no matching explicit `_caret.doLayout()`;
    the caret's subtree therefore settles one frame late (an extra layout root)
- **Hot path**: any `doLayout` on a `ComboBox`. The NaN branch is the first pass
  after the element exists, per combo.
- **Evidence**: probe `slice16d.probe.test.ts` traces every `layoutChildren`:
  ```
  --- element ---
     renderer.layoutChildren(w,h)=NaN,NaN contentBounds={"x":0,"y":0,"width":null,"height":null}
     Text null                      (JSON.stringify(NaN) === "null")
     renderer.layoutChildren(w,h)=168,16
     Text 16
  --- pass 1 ---
     renderer.layoutChildren(w,h)=168,16
     Text 16
     renderer.layoutChildren(w,h)=168,16     <- twice, every pass
     Text 16
  --- pass 2 ---
  ```
  probe `slice16e.probe.test.ts` gives the stack for the NaN call
  (`Label.ts:113` ← `ComboBox.ts:607` ← `Absolute.commitBounds` ←
  `ComboBox.doLayout` `Component.ts:7240` ← `ComboBox.ts:898`), and
  `slice16c.probe.test.ts` shows the resulting rule and class tokens:
  ```
  FIRST combo rule ops: [ …,"ensureStyleRule .Text.lhNaNpx","setRuleStyles .Text.lhNaNpx",
                          "ensureStyleRule .ComboBoxLabel.lh16px", …,"ensureStyleRule .Text.lh16px", …]
  lh-class tokens on the label: [{"addClass":["lhNaNpx"]},{"addClass":["lh16px"]},
                                 {"removeClass":["lhNaNpx"],"addClass":["lh16px"]}]
  ```
- **Proposed change**:
  (a) Move `super.doLayout()` to the **end** of `ComboBox.doLayout`, after the
  children's bounds are assigned, and drop the explicit `this._label.doLayout()`
  at `:924` — one traversal instead of two, and the caret gets its own recursion
  in the same pass instead of scheduling a second layout root. (`Absolute` then
  places both children at coordinates they already carry, which is what it is
  for.) If the pass must stay explicit, at minimum guard `ComboBoxLabel.doLayout`
  and `LabelListItemRenderer.layoutChildren` on a finite box.
  (b) Fix the fallback at `Label.ts:104` to test the members, not the object.
  (c) → slice 14: `Text.setLineHeight` should reject a non-finite numeric argument
  before reaching `setValueStyleState`, so no caller can mint a junk rule.
- **Risk / blast radius**: `ComboBoxLabel.doLayout` and
  `LabelListItemRenderer.layoutChildren` are also driven by `SelectableListRow.doLayout`
  (`AbstractSelectableList.ts:630-650`) — the same NaN shape is reachable for a
  list row that lays out before it is sized, so (b) and (c) are shared with slice
  18. `tests/component/content-box-containment.test.ts` pins that label children
  land inside the content box; reordering `super.doLayout()` must keep that.
- **Proof at implement time**: a probe asserting exactly one
  `LabelListItemRenderer.layoutChildren` call per `ComboBox.doLayout`, and zero
  `ensureStyleRule` selectors matching `/NaN/` over a full construct-and-mount.

---

### F16.5 `AutoCompleteField.querySuggestions` mutates the caller's shared store on every keystroke

- **Category**: H (function/implementation mismatch), D/E by fan-out, plus a
  correctness defect
- **Impact**: **HIGH** — per debounced keystroke. Every component bound to the
  same store re-renders twice; with `remoteFilter` or server paging it also fires
  a network `load()`; above the 1,000-row worker threshold the answer read back is
  the previous query's.
- **Where**:
  - `component/input/AutoCompleteField.ts:629-651` — the store branch of
    `querySuggestions`
  - `:636` `store.clearFilter()` — **removes every filter on the store**, including
    ones the application set
  - `:637-642` `store.filterBy({ … })` — adds the field's own filter under a fresh
    `Symbol()` key, and never removes it
  - `:644` `store.getRecords()` — read synchronously, on the same tick
  - `data/AbstractStore.ts:1634-1638` — `clearFilter` → `applyFilterChange`
  - `data/AbstractStore.ts:1517-1521` — `filterBy` → `applyFilterChange`
  - `data/AbstractStore.ts:1607-1623` — `applyFilterChange`: `applyView().then(() => { emit('filterchange'); emit('datachange'); if (reload) void this.load(); })`
  - `data/AbstractStore.ts:1905-1908` — `applyView` routes to
    `applyViewOnWorker()` at `_allRecords.length >= WORKER_THRESHOLD` (1000)
- **Hot path**: keystroke → `onInput` (`:492`) → debounce (default 200 ms) →
  `querySuggestions` → the two store mutations → 4 store events → every bound
  `List` (not virtualised, slice 18: 300 items = 900 components) / `Table` /
  `ComboBox` / chart rebuilds, twice.
- **Evidence**: probe `slice16l.probe.test.ts`, "AutoCompleteField mutates the
  caller's store":
  ```
  app filter active, rows: Apple,Banana
  suggestions returned SYNCHRONOUSLY : [["Banana"]]
  store rows AFTER the promises settle: Banana
  store datachange emits caused by ONE keystroke : 2
  store filterchange emits caused by ONE keystroke: 2
  the application-set filter survived?           : [{"type":"contains","field":"name","value":"an","caseSensitive":false}]
  ```
  The application's `neq name=Cherry` filter is gone and the field's own filter is
  left installed on the store. The stale-read half of the claim is **not verified
  by probe** — with a small `MemoryStore` the local view is rebuilt before the
  promise, so today's answer is correct; the async path is read from
  `AbstractStore.ts:1905`, which is reached only above 1,000 records.
- **Proposed change**: stop writing to the store. Filter in-process over
  `store.getAll()` using the already-exported `matchesFilter`
  (`data/FilterDescriptor.ts:91`) with the descriptor `querySuggestions` already
  builds — same predicate, no store mutation, no events, no network, and the read
  is genuinely synchronous. If a remote-filtering store is wanted later it needs
  its own opt-in API (a `queryFor(descriptor)` that returns a promise without
  touching the shared view), not a hijack of the shared filter set.
- **Risk / blast radius**: `tests/component/input/AutoCompleteField.test.ts`
  covers `matches()` and the static-suggestion path only; no test exercises the
  store branch, so nothing pins the current behaviour. `filterBy` /`clearFilter`
  have no other callers in the library (`AbstractStore.filterBy` — 2 callers, both
  in this file; `clearFilter` — 5 callers, all in this file per codegraph's blast
  radius), so the change is contained.
- **Proof at implement time**: the probe above, asserting `0` `datachange` /
  `filterchange` emits and an unchanged `getActiveFilters()` after a query; plus a
  1,500-record store case asserting the suggestions match the typed query.

---

### F16.6 Correction: `ComboBox.doLayout:922` does not drive a changing line height (slice 14 F14.3, assigned)

- **Category**: correction; C where it does apply
- **Impact**: **LOW as a per-frame cost** — the premise does not hold. The
  mechanism's real unbounded case in this slice is the NaN rule of F16.4.
- **Where**:
  - `component/input/AbstractInput.ts:299-314` — `applySingleLineBox` writes
    `height: h` into **preferred, max and min**; `:338-343` `pinSingleLineBoxHeight`
  - `component/input/ComboBox.ts:884-889` — `updateHeight`, called from the
    constructor (`:798`) and on theme change only (`:799`)
  - `component/input/ComboBox.ts:922` — `this._label.setLineHeight(box.height)`
  - `component/input/ComboBox.ts:521-545` — `ComboBoxLabel.setLineHeight`, which
    is **not** `Text.setLineHeight`: it is a hand-rolled copy of it on a plain
    `Component`, and the selector it mints is `.ComboBoxLabel.lh<N>px`
  - `component/list/renderer/Label.ts:113` — the renderer's own `Text` gets the
    *same* `box.height`, minting `.Text.lh<N>px` in parallel
- **Evidence**: probe `slice16a.probe.test.ts`, "applySingleLineBox pins
  min==max height":
  ```
  combo getMinSize : {"width":0,"height":22}
  combo getMaxSize : {"width":9007199254740991,"height":22}
  requested heights: [40,60,80,120,160,200,31,17]
  committed heights: [22,22,22,22,22,22,22,22]
  rule ops over the stretch: []
  ```
  `Component.clampHeight` refuses every attempt to stretch the box, so
  `box.height` at `:922` is constant for the life of a theme. A gutter drag over a
  `ComboBox` produces **zero** line-height rule ops. Confirmed independently by
  `slice16f.probe.test.ts`: three consecutive settled passes issue 0 rule ops.
  The library's own test pins the only axis that does vary —
  `tests/component/input/ComboBox.test.ts:490` row 8, "the same laid-out ComboBox
  under a different theme font size resolves a different line-height token".
- **How many distinct values a real session produces**: **one per distinct
  resolved single-line box**, i.e. one per theme font-scale step (times any
  instance with non-default insets/padding/border). A Loom session that never
  changes font size mints exactly one `.ComboBoxLabel.lh<N>px` and one
  `.Text.lh<N>px`; sweeping a ten-step font-size control mints ten of each. Not
  per frame, not per pixel. The unbounded case slice 14 predicted does exist in
  this slice, but it comes from F16.4's NaN, not from a drag.
- **Where the fix is**: the `:922` call is **redundant**, not merely cheap. The
  collapsed control's visible text lives in the renderer's own `Text`, which
  `LabelListItemRenderer.layoutChildren` already pins to the identical
  `box.height` one frame later in the same pass. `ComboBoxLabel`'s own doc comment
  concedes this: *"Retained because `ComboBox.doLayout` still drives it; the hosted
  label renderer also matches its own line-height to the box in `layoutChildren`,
  so the collapsed line stays centred either way."* Deleting `ComboBox.ts:922`
  together with `ComboBoxLabel.setLineHeight` / `getLineHeight` / `_lineHeight` /
  `_lineHeightOnInstanceLayer` / the `init()` token catch-up (`:565-583`) removes
  ~60 lines, one whole duplicated implementation of `Text.setLineHeight`, and one
  entire family of shared rules.
- **Risk / blast radius**: `tests/component/input/ComboBox.test.ts` rows 1-8
  (`:379-500`) pin `ComboBoxLabel.setLineHeight`'s sharing semantics row by row and
  would all be deleted with it. They exercise the method directly, not through
  `doLayout`, so removing only the `:922` call leaves them green — the two steps
  can land separately. `tests/component/input/TextLineHeightValueClassSharing.test.ts`
  covers `Text`'s copy and is unaffected. Verify visually that a collapsed combo's
  label is still vertically centred (the renderer's `Text` should carry it).
- **Proof at implement time**: a probe asserting zero `ensureStyleRule` selectors
  matching `/\.ComboBoxLabel\.lh/` over a construct-mount-layout cycle, and a
  screenshot diff of a collapsed combo.

---

### F16.7 Re-opening an unchanged dropdown rebuilds and re-measures everything

- **Category**: D, B, E
- **Impact**: **MEDIUM** — per open, on a gesture users repeat.
- **Where**:
  - `component/input/ComboBox.ts:977` — `showAt(surface, list.getItems(), list.getSelectedIndex())`
    round-trips the list's own state back into itself; the comment at `:975-976`
    calls this "harmless"
  - `component/input/ComboBox.ts:274-277` — `showAt` → `setItemsArray` →
    `AbstractSelectableList.ts:1300-1303` clears `_selectedSet`, `_anchorIndex`
    and `_focusedIndex`, then `syncRows()` re-runs `updateItem` + `setIndex` +
    `setSelected(false)` + `setFocused(false)` on every pooled row
  - `component/input/ComboBox.ts:276` — `setSelectedIndex(selectedIndex, false)`
    then puts the selection back, running `refreshRowVisualState()` over every row
    a second time
  - `component/input/ComboBox.ts:299` — the labels are measured again from scratch
- **Evidence**: probe `slice16h.probe.test.ts`, "RE-open an already-built 12-item
  dropdown with unchanged items":
  ```
  REopen n=12 sink ops : {"apply":205,"appendChild":1,"clearTimeout":1,"setRuleStyles":1,"addListener":2,"setTimeout":1}
  REopen n=12 class writes: 52
  REopen n=12 src calls: {"getThemeVar":28,"isConnected":62,"getElementRect":1,"measureText":12,"getViewportSize":2,…}
  ```
  and `per REOPEN : refreshRowVisualState = 1  syncRows = 1` — the full pool
  reconciliation runs against an identical item array.
- **Proposed change**: have `toggleDropdown` call a no-argument `showAt` overload
  that skips `setItemsArray` when the item array is reference-identical to what the
  list already holds, and cache `measureWidestLabel`'s answer on the same key. The
  selection round-trip then disappears with it.
- **Risk / blast radius**: `ComboBox.setItems`/`addItem`/`setStore` already push
  into the list directly (`:1221`, `:1239`, `:1271`), so the dropdown never needs
  `showAt` to carry items at all — the parameter is a leftover from before the
  list owned the state. `_ComboBoxDropdown` is exported, so `showAt`'s signature is
  public surface; keep it and add the fast path inside.
- **Proof at implement time**: applies and `measureText` per re-open with unchanged
  items (205 → single digits, 12 → 0).

---

### F16.8 `FileDropZone.setActive` swaps chrome through stylesheet-rule mutations instead of a declared state class

- **Category**: C (stylesheet-rule write on a pointer path), B (`setBorder` has no
  unchanged-value guard — slice 08), H
- **Impact**: **MEDIUM** — 2 rule mutations per zone-boundary crossing during an
  OS file drag. Each is a full-document restyle (~195 ms/frame at 21k nodes per the
  briefing's cost model), landing in the middle of a live drag.
- **Where**:
  - `component/input/FileDropZone.ts:145-148` — `setActive` → `setBorder(...)` +
    `setBackgroundColor(...)`
  - `component/input/FileDropZone.ts:155-161`, `:177-183`, `:191-206` — the three
    callers (`dragenter` at depth 1, `dragleave` at depth 0, `drop`)
  - `component/input/FileDropZone.ts:88` — a fourth call in the constructor, so
    the resting pair is written imperatively per instance rather than as a class
    default
- **Evidence**: probe `slice16i.probe.test.ts`:
  ```
  20 dragovers sink ops : {}
  one dragenter ops     : {"setRuleStyles":2}
  one dragleave ops     : {"setRuleStyles":2}
  5 enter/leave pairs ops: {"setRuleStyles":20}
  ```
- **Proposed change**: declare the active look as a `.dragactive` entry in
  `protected static readonly ownStyleStates` and make `setActive` a
  `this.setStyleState(".dragactive", active)` call — `Component.setStyleState` is
  guarded, the rule is shared per class rather than written per instance, and one
  class-attribute write replaces two stylesheet mutations. Move the resting pair
  into `ownClassStyleDefaults` at the same time (`FileDropZone` declares none
  today, so its chrome is per-instance `#id` writes).
- **Risk / blast radius**: nothing else calls `setActive`; there is no
  `FileDropZone` test file. The four `--ts-ui-filedropzone-*` tokens documented on
  the component page must keep resolving — they can be referenced from the class
  rule exactly as they are today.
- **Proof at implement time**: `setRuleStyles` count per dragenter/dragleave (2 →
  0) with a class-attribute write in their place.
- **Positive to protect**: `onDragOver` is deliberately empty and the probe
  confirms **20 `dragover` events cost zero sink ops**. Keep it that way — the only
  remaining per-`dragover` cost is `Event`'s own subtree walk (see Cross-slice).

---

### F16.9 `SpinButton`'s documented 1-px glyph nudge is dead — the layout commit clears it

- **Category**: J (unreachable effect), H (a cosmetic offset ARCHITECTURE forbids,
  which does not even take effect)
- **Impact**: **LOW** — no render cost, but a documented behaviour that never
  happens and a 10-line comment defending it.
- **Where**:
  - `component/input/SpinButton.ts:131-142` — the comment ("The 1 px upward
    translate compensates for sub-pixel rounding in the Button's centring math")
    and `:142` `this.getGlyph()?.setTranslate(0, -1)`
  - `layout/LayoutManager.ts:561` — `commitBounds`'s non-fast path calls
    `component.setTranslate(0, 0)` on every child it places, which is what the
    glyph gets once `Button`'s content-row `Fit` lays it out
- **Evidence**: probe `slice16i.probe.test.ts`:
  ```
  SpinButtonUp glyph translate after settling: [0,0]
  ```
- **Proposed change**: delete the `setTranslate(0, -1)` call and the half of the
  comment that defends it. If the optical offset is genuinely wanted, it has to
  come from the glyph's own box (an inset or a half-pixel-aware centring rule in
  `Button`), not from a transform a layout commit owns — and per ARCHITECTURE.md
  §"No cosmetic insets or padding" the right move is to trace the rounding to
  `Button`'s centring math instead.
- **Risk / blast radius**: `tests/component/input/SpinButton.test.ts` asserts
  preferred-size stability, not the translate. Nothing pins it.
- **Proof at implement time**: the probe above, asserting the translate is `[0,0]`
  both before and after (i.e. no visual change), plus a screenshot of a
  `NumberSpinner`.

---

### F16.10 `NumberSpinner` rewrites the native input value on every auto-repeat tick while clamped

- **Category**: B
- **Impact**: **LOW-MEDIUM** — up to 25 writes/second while a spin button is held
  at its bound (the `AutoRepeat` floor is 40 ms). A `.value` write on a focused
  `<input>` also resets the caret, so the behaviour is visible, not just wasteful.
- **Where**:
  - `component/input/NumberSpinner.ts:440-457` — `applyValue`; `:446-450` the
    `next === this.getValue()` branch **still** calls
    `this._input.setText(this.formatValue(next))` before returning
  - `component/input/SpinButton.ts:144-149` — `AutoRepeat({ floor: 40 })` → `emit("tick")`
  - `component/input/NumberSpinner.ts:208-209` — the tick handlers
- **Evidence**: probe `slice16i.probe.test.ts`:
  ```
  clamped ticks x10 value : 0
  clamped ticks x10 ops   : {"setValue":10}
  moving ticks x10 value  : 10
  moving ticks x10 ops    : {"setValue":10,"apply":10}
  ```
  Ten ticks against the clamp produce ten identical native value writes and
  nothing else.
- **Proposed change**: guard the re-format on the displayed text actually
  differing — `applyValue`'s early-return branch exists to snap a typed,
  out-of-range string back to the canonical form, which only matters when the
  input's text is not already that string. Read `this._input.getText()` (cached,
  no DOM read) and skip when equal. Alternatively give `TextInput.setText` the
  same-value guard `Text.setText` is also missing (slice 14 F14.1) — that fixes
  both at once and is the better home.
- **Risk / blast radius**: `tests/component/input/NumberSpinner.test.ts:169`
  ("cutting from the inner `_input` … leaving the committed value unchanged until
  blur") depends on the input's text and the committed value diverging, which is
  exactly the case the guard must keep working — compare against the input's live
  text, not against the committed value.
- **Proof at implement time**: a probe asserting zero `setValue` ops for ten ticks
  at the clamp and ten for ten moving ticks.

---

### F16.11 `AutoCompleteField` leaks two timers past disposal

- **Category**: G (listener/timer churn), correctness
- **Impact**: **LOW-MEDIUM** — a use-after-free throw, not a per-frame cost. A
  field disposed mid-typing (a closed dialog, a torn-down form) fires a debounce
  callback up to 200 ms later and a blur callback up to 150 ms later, both against
  a disposed dropdown whose handles have been released — and `HandleRegistry.resolve`
  throws by design on a released handle (`core/DOM.ts:239`).
- **Where**:
  - `component/input/AutoCompleteField.ts:126` — `_debounceTimer`
  - `component/input/AutoCompleteField.ts:506-509` — armed in `onInput`, cleared
    only by the next `onInput`
  - `component/input/AutoCompleteField.ts:567-578` — `onBlur`'s 150 ms
    `setTimeout`, whose id is not even stored
  - `component/input/AutoCompleteField.ts:714-718` — `destructor` disposes
    `_dropdown` and nothing else
  - Both use the bare global `setTimeout`, not `DOM.sink.setTimeout` — so
    `DOM.reset()` cannot disarm them either (`docs/concepts/dom-seams.md:71`
    describes exactly this case for `Animation`)
- **Evidence**: source read. Not reproduced by probe.
- **Proposed change**: store both ids, clear both in `destructor` before
  `super.destructor()`, and route them through `DOM.sink.setTimeout` /
  `clearTimeout` per the seam's stated rule for "a deferred callback that will
  write to an element".
- **Risk / blast radius**: `tests/component/input/AutoCompleteField.test.ts:206`
  advances the debounce timer with fake timers and must keep working; clearing on
  destructor only does not affect it.
- **Proof at implement time**: a probe that types, disposes, then advances timers,
  asserting no throw.

---

### F16.12 Two `getViewportSize()` forced reads per dropdown open, for one clamp

- **Category**: A
- **Impact**: **LOW** per open, but it compounds slice 03's finding that
  `getViewportSize()` forces a document layout for a value `Math.max` discards.
- **Where**: `component/input/ComboBox.ts:303` (the `Math.min(…, vp.width)` cap)
  and `core/AnimatedDropdown.ts:343` (`placeAnchored`'s own read), both in the same
  task, both after `setItemsArray`'s writes.
- **Proposed change**: `showAt` should pass the width it wants to `placeAnchored`
  and let the single read inside it do the clamp, or read the viewport once at the
  top of `showAt` and thread it through. `AutoCompleteDropdown.show` reads it once
  (only via `placeAnchored`) and is the shape to copy.
- **Risk / blast radius**: `placeAnchored` has four callers (slice 17 owns three).
  Changing its signature is a cross-slice change; reading once in `showAt` and
  dropping `:303`'s own read is local.
- **Proof at implement time**: `getViewportSize` count per open (2 → 1).

---

### F16.13 `HiddenFileInput.init()`'s attribute replay is dead code by its own admission

- **Category**: J
- **Impact**: **LOW** — 1–3 extra `DOM.sink.apply` calls per `FileField` at first
  render.
- **Where**: `component/input/FileField.ts:150-182`. The JSDoc states it outright:
  *"`setElementAttribute` now caches into the base class's `_elementAttributes` map
  and replays it from `Component.init()`, so this replay is redundant — kept
  anyway, matching the same replay TextInput's `init()` performs."*
- **Evidence**: the doc comment, plus `core/DOM.ts`'s `ElementAttributes` buffer
  contract in ARCHITECTURE.md §"CSS writes go through `StyleRule` / `InlineStyle`".
  I did not probe that the base replay covers all three attributes.
- **Proposed change**: delete the override; `_multiple` and `_accept` then have no
  readers at all and go with it (`_type` is still read by `getType()`). If
  `TextInput`'s copy is also redundant it should go in the same change — one plan,
  two sites.
- **Risk / blast radius**: `tests/component/input/HiddenFileInput.classStyleDefaults.test.ts`
  covers class defaults, not the attribute replay.
- **Proof at implement time**: assert the rendered element still carries
  `type`/`multiple`/`accept` after `getElement(true)` with the override removed.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `ComboBox` (`ComboBox.ts:723`) | Drop-down selector over a styled `<div>` plus an `AnimatedDropdown` panel | own `<div>`; no rules of its own beyond the shared `.ComboBox` + `INPUT_CHROME_TRAIT` | **8 applies, 0 rule ops, 0 geometry reads** — 7 empty, 1 the NaN transform; lays the label subtree out twice | over-built (`super.doLayout()` runs a manager it does not use) | F16.3, F16.4, F16.6 |
| `ComboBoxDropdown` (`:143`) | Overlay chrome + width math around one `List` | own `<div>`, `.ComboBoxDropdown` + `.ComboBoxDropdown .List:focus::after` | none when closed (detached); per open: N element builds, N `measureText`, 2 `getViewportSize`, 1 `getElementRect`, 36 rule ops on first open | mismatch (does the list's job on every open) | F16.1, F16.7, F16.12 |
| `ComboBoxLabel` (`:439`) | Host the collapsed control's one `ListItemRenderer` | own `<span>`, `.ComboBoxLabel` + one `.ComboBoxLabel.lh<N>px` per line box | 1 empty apply; `doLayout` runs twice per parent pass | over-built — `setLineHeight`/`getLineHeight`/`_lineHeightOnInstanceLayer` duplicate `Text.setLineHeight` for a value the renderer's own `Text` already writes | F16.4, F16.6 |
| `ComboBoxCaret` (`:658`) | Fixed square box reserving the chevron column | own `<span>`, `.ComboBoxCaret` | 1 empty apply; no layout manager, so its glyph child is never positioned | mismatch | F16.3 |
| `ComboBoxCaretGlyph` (`:643`) | The chevron, sharing `GLYPH_MD_INK_TRAIT` | `Glyph`'s SVG | **1 real `transform` write per pass, value `NaNpx`; `will-change: transform` pinned permanently** | mismatch | F16.3 |
| `AutoCompleteField` (`AutoCompleteField.ts:122`) | Typeahead text field over a `TextField` + dropdown | own `<div>`, `.AutoCompleteField` focus-within ring | 4 setter writes on the inner field, all guarded; 0 reads | mismatch — the store branch writes to the consumer's store | F16.5, F16.11 |
| `AutoCompleteTextField` (`:41`) | Borderless inner field | inherits `TextField`'s | inherited | fits | — |
| `AutoCompleteDropdown` (`AutoCompleteDropdown.ts:65`) | Overlay chrome around one `List` for suggestions | own `<div>`, its class rule + `.AutoCompleteDropdown .List:focus::after` | per show: rebuild + 1 `getElementRect` + 1 `getViewportSize`; capped at `maxSuggestions` (10) so the cost is bounded | fits, but duplicates `ComboBoxDropdown` almost line for line | see Duplication |
| `NumberSpinner` (`NumberSpinner.ts:168`) | Numeric field + up/down spin column | own `<div>`, `.NumberSpinner` + `.NumberSpinner .TextField:focus` + focus-within ring | **11 applies, all empty; 0 rule ops, 0 geometry reads** | fits | F16.10 |
| `NumberSpinnerField` (`:100`) | Right-aligned chromeless inner field | inherits `TextField`'s | inherited | fits | — |
| `SpinButtonUp` / `SpinButtonDown` (`:129`, `:149`) | The two halves, each with its own divider border | inherit `SpinButton`'s | inherited | fits — a clean use of the class tier | — |
| `SpinButton` (`SpinButton.ts:66`) | Arrow button with an accelerating hold-repeat | inherits `Button`'s; `.SpinButton` + `.SpinButton.pressed` | 0 of its own | fits, with one dead line | F16.9 |
| `FileField` (`FileField.ts:220`) | Trigger button + filename label over a hidden `<input type=file>` | own `<div>` | none of its own (`HBox`) | fits; constructor does not forward `subclassDefaults` (ARCHITECTURE §"Constructors forward `subclassDefaults`") | F16.13 |
| `HiddenFileInput` (`:31`) | Typed wrapper for the native file input's behavioural attributes | own `<input>`, `display:none` via `setDisplayed(false)` — correctly out of the render tree | 0 | fits; `init()` override is dead | F16.13 |
| `FileDropZone` (`FileDropZone.ts:47`) | Bordered OS-file drop surface composing a `FileField` | own `<div>` | 0 per pass; **0 per `dragover`**; 2 rule mutations per boundary crossing | over-built on the state swap only | F16.8 |
| `PickerInput` (`PickerInput.ts:33`) | Chromeless `<input>` shared by the picker fields | inherits `TextInput`'s; `.PickerInput` | 0 of its own | fits — a textbook `ownClassStyleDefaults` declaration | — |
| `PickerButton` (`PickerButton.ts:59`) | Chromeless glyph trigger for the picker fields | inherits `Button`'s; `.PickerButton` + two state rules | 0 of its own | fits | — |

**Positives to protect** (a plan must not regress these):

- A settled, closed `ComboBox` costs **8 applies, 0 stylesheet-rule ops and 0
  geometry reads** per layout pass; a settled `NumberSpinner` costs **11 applies,
  all empty, 0 rule ops, 0 reads** (probe `slice16a`/`slice16f`, three identical
  passes each). Neither registers a viewport listener; neither reads geometry in
  `doLayout`. The empty applies are slice 01/03/04's known `InlineStyle.flushDirty`
  bug, not this slice's.
- 20 consecutive `dragover` events on a `FileDropZone` cost **zero** sink ops.
- Construction is JS-only: `new ComboBox({items})` creates no element and no rule;
  the eagerly-built dropdown costs three JS instances and mounts nothing until the
  first show, exactly as its comment claims (`ComboBox.ts:769-775`).
- `FileDropZone` is the only file in the slice that registers its `Event`
  listeners as named method references, per ARCHITECTURE.md §"Listeners must
  reference a named function". `Event` invokes them with the component as `this`
  (`core/Event.ts:285`), so the pattern is correct and should be the template for
  the rest of the slice.
- `Text.setLineHeight`'s same-value guard works: after the first pass the second
  `layoutChildren` of each frame writes nothing (probe `slice16d`).

---

## Redundant, duplicated and dead code

1. **`ComboBoxDropdown.showAt` and `AutoCompleteDropdown.show` are the same method.**
   `ComboBox.ts:273-326` vs `AutoCompleteDropdown.ts:148-181`: both do
   `pauseLayout` → `setItemsArray` → `resumeLayout` → `getPerimeterSize` →
   `getElementRect(anchor)` → `setWidth`/`setHeight` → `placeAnchored` →
   `setAnchorElement` → `showAnimated` → `doLayout`, with the same two comment
   blocks copied verbatim ("The inner List already exposes `role=listbox`…",
   "VBox-backed list positions rows via framework setters that no-op…"). They
   differ only in the width math and in `AutoCompleteDropdown` calling
   `getElement(true)` first. Their `_defaultXxxDropdownOptions` bags are identical
   apart from `durationMs`, and each publishes its own
   `.X .List:focus::after { content: none }` rule (`ComboBox.ts:420-426`,
   `AutoCompleteDropdown.ts:44-50`). An `AbstractListDropdown` carrying
   `showList(anchor, items, selectedIndex, sizing)` would absorb both, and slice 17's
   `TimePickerDropdown` is a third caller of the same `placeAnchored` +
   `showAnimated` tail.
   `grep -rn "pauseLayout();" packages/lib/src/typescript/lib/component/input/ | wc -l` → 5.
2. **`ComboBoxLabel.doLayout` is a verbatim copy of `SelectableListRow.doLayout`.**
   `ComboBox.ts:591-610` vs `AbstractSelectableList.ts:630-650` — identical body
   (`getContentBounds`, `setAutoCommitStyle(false)`, four setters,
   `setAutoCommitStyle(true)`, `layoutChildren`), identical doc comment ("Only
   writes setters (no geometry reads)"). One `RendererHost` base, or a
   `ListItemRenderer.fill(box)` helper, removes one of them — and both copies carry
   the NaN bug of F16.4, so fixing one currently leaves the other.
3. **`ComboBoxLabel.setLineHeight` re-implements `Text.setLineHeight` on a
   non-`Text`.** `ComboBox.ts:521-545` vs `Text.ts:1162-1213`: the same numeric /
   string mode split, the same "clear the instance layer before pointing at the
   shared rule" dance, the same `setValueStyleState("lh", …)` call. See F16.6 —
   the whole method is removable.
4. **The 2026-08-29 audit's "six copies of an identical `updateHeight()` body" is
   substantially closed.** The shared `Util.singleLineBoxHeight`
   (`core/Util.ts:238-248`) and `AbstractInput.applySingleLineBox`
   (`AbstractInput.ts:299-314`) extractions happened; `PasswordField` and
   `UsernameField` now inherit `TextField`'s. What remains is **four** three-line
   forwarders that differ only in the default-width argument:
   `ComboBox.ts:884`, `NumberSpinner.ts:285` (the one variant, reading
   `this._input.getPadding()`), `AbstractPickerField.ts:292`, `TextField.ts:75`.
   Residue, not a finding — a `protected defaultFieldWidth(): number` hook on
   `AbstractInput` would collapse all four, and it should ride along with whatever
   plan next touches `AbstractInput`.
5. **The 2026-08-29 audit's item 4, "`ComboBoxLabel` leaks its renderer", is
   CLOSED.** `ComboBox.ts:617-621` now has a `destructor()` that disposes
   `_renderer` before `super.destructor()`, and `ComboBox.destructor` (`:1311-1316`)
   disposes `_dropdown`. `SelectableListRow` (`AbstractSelectableList.ts:619`) and
   `LabelListItemRenderer` got the same treatment. No action.
6. **`ComboBoxDropdown.getMinWidth()` has no callers.** `ComboBox.ts:348-350`.
   `grep -rn --include=*.ts "getMinWidth" packages/ /home/jika/typescript/loom/src | grep -v docs/api` → 9 hits,
   all `Column.getMinWidth` in `component/table/*` except the definition itself.
   `setMinWidth` is called (from `ComboBox.setDropdownMinWidth`), the getter is not;
   `ComboBox.getDropdownMinWidth` answers from `_options` instead (`:1456`).
7. **`HiddenFileInput._multiple` and `_accept`** are written by their setters and
   read only by the dead `init()` replay of F16.13; `getType()` has no caller on
   this class (the 53 `getType()` hits across `packages/` are `data/Field`,
   `markdown` nodes and `TextInput`).
8. **Eleven inline-arrow `Event` registrations**, against ARCHITECTURE.md
   §"Listeners must reference a named function" ("Never pass an inline arrow
   function or function expression"): `ComboBox.ts:801,802`;
   `AutoCompleteField.ts:163,164,165`; `NumberSpinner.ts:211,212`;
   `SpinButton.ts:151,152,153`; `FileField.ts:257`. Each allocates a fresh closure
   that `Event`'s same-reference dedup cannot match and `removeListener` cannot
   target (the failure mode slice 11 measured on `Tooltip.attach`). `FileDropZone.ts:91-94`
   is the only correct site in the slice.
9. **Six cross-component `Event` registrations**, against ARCHITECTURE.md §"A
   component must not listen to another component's events through `Event`":
   `AutoCompleteField.ts:163,164,165` (on `this._textField`),
   `NumberSpinner.ts:211,212` (on `this._input`), `FileField.ts:257` (on
   `this._input`). None carries the cell-editor carve-out comment. The carve-out
   text names the intended fix — widen typed `on("blur"|"keydown"|"input")`
   shorthands onto `TextField` — and says it is deferred because "`TextField` /
   `ComboBox` are input components owned by a separate in-flight plan". Recorded
   here as known debt for whoever owns that plan, not as new work.
10. **`SpinButton` keeps two viewport listeners armed for its whole life**
    (`SpinButton.ts:152-153`, `mouseup` and `mouseleave`), when the hold-repeat
    gesture needs them only between `mousedown` and release. Two `NumberSpinner`s
    in a form = eight permanent registrations. `onMouseUp` early-returns when the
    repeat is not running, so the cost is `Event`'s dispatch, not DOM work — LOW,
    and it should ride along with any `Event`-registration cleanup.

---

## Cross-slice notes

- **→ 05 layout-base-box-flow-grid**: `Absolute.doLayout` (`layout/Absolute.ts:56-57`)
  feeds the child's raw `getX()` / `getY()` into `commitBounds` with no `?? 0`.
  For a child whose position was never assigned, `LayoutManager.commitBounds:551`'s
  `positionUnchanged` test can then never be true, so **every** such child is
  committed down the `setWillChange("transform")` + `setTranslate` fast path, for
  ever, with a non-finite delta. This is the root cause of F16.3. Any container
  that adds a child and lets the default manager place it is exposed.
- **→ 01 core-component-lifecycle**: `Component.setTranslate`'s guard
  (`Component.ts:4648`) compares with `===`, which cannot reject `NaN`; the write
  at `:4658` then emits `translate3d(NaNpx,NaNpx,0)`. A `Number.isFinite` check
  would turn a silent per-frame junk write into a caught bug. Also confirmed for
  this slice: `getBorderSize`'s pre-connect estimate is uncached — a settled
  `NumberSpinner` pass costs 82 `isConnected` + `getThemeVar` source calls offline
  because nothing is document-connected in the harness; in production the cache at
  `Component.ts:3690` makes this one-off, but it is live for
  `ComboBoxDropdown.showAt:282`, which reads `getPerimeterSize()` while the panel
  is still detached.
- **→ 14 text-and-small-display**: two corrections and one addition.
  (a) F14.3's named caller `ComboBox.doLayout:922` does **not** drive a changing
  line height — `applySingleLineBox` pins `min == max` height and a stretch commits
  zero rule ops (F16.6). (b) The rule it mints is `.ComboBoxLabel.lh<N>px`, from
  `ComboBoxLabel.setLineHeight` (a copy of `Text.setLineHeight` on a plain
  `Component`), not `.Text.lh<N>px` from `Text` — though `.Text.lh<N>px` **is** also
  minted, by the renderer's own label. (c) The unbounded case that *does* exist is
  `Text.setLineHeight(NaN)`: the `:1173` guard cannot fire for `NaN`, so
  `setValueStyleState` inserts a permanent `.Text.lhNaNpx { line-height: NaNpx }`.
  `Text.setLineHeight` should reject a non-finite numeric argument.
- **→ 18 lists-trees**: `ComboBox` and `AutoCompleteField` inherit slice 18's two
  confirmed list findings in full. `AbstractSelectableList` not being virtualised
  is what makes a 500-item combo cost 21,822 writes to show nine rows (F16.1), and
  the unguarded `SelectableListRow.setSelected` / `setFocused` is half of the
  `2N`-class-writes-per-keystroke number (F16.2). Also: `LabelListItemRenderer.layoutChildren`
  (`component/list/renderer/Label.ts:104`) guards on `getContentBounds() ?? {…}`,
  which cannot catch a returned box whose members are NaN — the same defect is
  reachable from `SelectableListRow.doLayout`, not just from `ComboBoxLabel`.
- **→ 03 core-dom-seam-events**: add `FileDropZone` to the registrant list for the
  per-event ancestor walk. It installs **four** subtree listeners
  (`dragenter`/`dragover`/`dragleave`/`drop`, `FileDropZone.ts:91-94`); `dragover`
  fires continuously for the whole duration of any OS drag anywhere in the
  document, so one `FileDropZone` on a page makes every `dragover` pay
  `Event`'s `getId` + `getParentElement` climb to `<html>`. Its own handler is
  empty, so the walk is the entire cost. Slice 08's blocker note applies: fixing
  `SplitGutter` and `Accordion` alone will not remove the walk.
- **→ 03 core-dom-seam-events**: `AutoCompleteField.ts:506` and `:568` use the bare
  global `setTimeout`, not `DOM.sink.setTimeout`, for callbacks that write to
  elements — the case `docs/concepts/dom-seams.md:71` says must ride the seam so
  `DOM.reset()` can disarm it.
- **Seam contract that does not hold**: `Component.getContentBounds()` is
  documented (`Component.ts:3650`) as returning "the content rectangle in pixels,
  **or null** if the element is not yet in the DOM". It can instead return a
  non-null object whose `width`/`height` are `NaN`, because `getInnerSize()`
  returns an object of nullish members rather than `null`. Every caller in the
  library guards with `if (!box)` or `?? fallback`, and every one of them is
  therefore wrong for this case. This is the mechanism behind both F16.3 and F16.4.
- **→ 17 inputs-pickers-calendar**: `AbstractCalendarDropdown.showAt`
  (`:688-718`) orders its work differently from both dropdowns in this slice —
  `setWidth`/`setHeight` → `doLayout()` → `placeAnchored` → `showAnimated`, i.e. it
  lays out **before** mounting, which is slice 09's "laying out detached is
  expensive" hazard. `ComboBoxDropdown` mounts first and lays out after. Worth
  reconciling when the dropdown base class of Duplication item 1 is designed.

---

## Suggested plan grouping

**Plan A — "combo-caret-and-label-layout"** (self-contained, measurable alone).
F16.3 + F16.4 + F16.6. One coherent change to `ComboBox.doLayout` and its two
child components: give `ComboBoxCaret` a `Fit`, move `super.doLayout()` to the end
and drop the explicit `_label.doLayout()`, delete `ComboBox.ts:922` and
`ComboBoxLabel.setLineHeight`/`getLineHeight`/`_lineHeightOnInstanceLayer`/the
`init()` catch-up, and fix `LabelListItemRenderer.layoutChildren`'s box guard.
Removes the per-pass NaN transform, the permanent `will-change` pin, one of the
two label traversals, and two families of shared rules. Measured by: applies per
settled `ComboBox` pass (8 → ~4, none real), `layoutChildren` calls per pass
(2 → 1), `ensureStyleRule` selectors matching `/NaN|ComboBoxLabel\.lh/` (2 → 0).
Depends on nothing. Deleting the seven `ComboBox.test.ts` line-height rows is part
of it.

**Plan B — "combo-dropdown-open-cost"**. F16.1(a,b) + F16.7 + F16.12. Batch the
label measurement through `Util.measureTextWidths`, cache the result on the item
array identity, add the unchanged-items fast path to `showAt`, and collapse the
two `getViewportSize()` reads to one. All inside `ComboBoxDropdown`. Measured by:
`measureText` per open (N → 0/1), applies per re-open (205 → single digits),
`getViewportSize` per open (2 → 1). Independent of Plan A.

**Plan C — "autocomplete-store-query"**. F16.5 + F16.11. Stop mutating the
consumer's store: filter in-process with `matchesFilter`, and clear both timers in
`destructor` through the DOM seam. Correctness-led, with a real render-fan-out
payoff (2 `datachange` + 2 `filterchange` per keystroke → 0). Independent.
Needs a note in its Architecture Decisions about the deliberately dropped
remote-filter capability.

**Plan D — "filedropzone-state-class"**. F16.8 alone. Move the active look into
`ownStyleStates` + `setStyleState` and the resting look into
`ownClassStyleDefaults`. Small, fully local, measured by `setRuleStyles` per
dragenter (2 → 0). Could ride along with any other `ownStyleStates` migration.

**Rides along, too small to plan on their own**: F16.9 (delete the dead
`setTranslate(0,-1)` — attach to any `SpinButton`/`Button` touch), F16.13 (delete
`HiddenFileInput.init` — attach to whatever next touches `TextInput`'s twin
replay), Duplication items 4 (the four `updateHeight` forwarders — attach to the
next `AbstractInput` change), 8/9/10 (the `Event`-registration convention debt —
attach to the input-surface plan the cell-editor carve-out already names).

**Blocked on other slices**: F16.1(c), the 491-invisible-rows-out-of-500 half of
the dropdown-open cost, needs slice 18's virtualisation decision for
`AbstractSelectableList` — it is the single biggest number in this slice and
cannot be fixed from here. F16.2(b) (guarding the row setters) is likewise slice
18's; F16.2(a) (dropping the redundant re-commit) is local and should land in
Plan A or B regardless. F16.3's upstream half (`Absolute` coalescing `getX()`,
`setTranslate` rejecting non-finite, `getContentBounds` honouring its documented
`null` contract) belongs to slices 05 and 01; Plan A's local `Fit` fix works
without it but leaves the class of bug alive everywhere else.
