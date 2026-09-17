# 18 lists-trees — render-work review

**Summary**

- `Tree`'s per-frame resize path is already in good shape: a `doLayout()` with
  unchanged bounds costs **1 DOM write, 0 stylesheet ops and 0 forced geometry
  reads**, and a gutter-drag frame costs **29 writes for 26 pooled rows** with
  zero `layoutChildren` and zero rebinds (the `virtual-row-view-resize-relayout`
  withholding works). The Tree findings below are therefore on *scroll*,
  *expand/collapse* and *data refresh*, not on hot path 1.
- **F18.1 (HIGH)** — one arrow keypress on a 300-item `List` issues **600
  `class` attribute writes, 598 of them same-valued**, then a
  `getScrollMetrics()` read in the same task. Per keystroke, per keyrepeat.
- **F18.2 (HIGH)** — `AbstractSelectableList` is not virtualised. 300 items =
  900 components, 12,286 DOM ops to build, **906 applies per unchanged layout
  pass** (902 of them empty patches) and **901 `left`+`width` writes per resize
  frame**. Any `List` in a resizing pane pays that every frame.
- **F18.3 (HIGH)** — the tree renderers call `Text.measure()` inline inside
  `update()`, so a force-rebind pass does **23 separate `measureText` calls
  (23 forced layouts)** where the framework's own batching would do one
  `measureTexts`. The two *list* renderers already use the lazy pattern that
  gets the batch.
- **F18.4 (HIGH on toggle)** — `Glyph` names are immutable, so every caret
  and icon change destroys and rebuilds a `Glyph`. One expand = **3 shared-
  stylesheet mutations + 74 DOM ops**; one collapse = **5 + 94**; a one-row
  scroll whose icon changes costs 39 DOM ops against 12 when it does not.
- **F18.5/F18.7 (MEDIUM)** — `Text.setText` is unguarded, making
  `AbstractMarkerList` construction O(N²) (50 `addComponent` calls → 1,325
  `setMarker`, 1,375 text patches); and `List`/`MultiSelectList` fire `change`
  and rewrite every row on gestures that change nothing, where `Tree` already
  guards with the shared `selectionsEqual`.

All numbers below come from probes in
`.worktrees/_probes/18-lists-trees/` (`slice18.test.ts`, `slice18b`, `slice18c`,
`slice18d`), run against the lib's own offline DOM
(`PROBE_DIR=.worktrees/_probes/18-lists-trees npx vitest run --config
.worktrees/_probes/vitest.probe.config.ts --disableConsoleIntercept`). Paths are
relative to `packages/lib/src/typescript/lib/` unless stated.

---

## Findings

### F18.1 `SelectableListRow` rewrites the whole `class` attribute on every row, unguarded, on every selection or focus move — then reads geometry

- **Category**: B (unchanged-value write), A (forced sync read after the
  writes), I (a guarded helper already exists and is not used)
- **Impact**: HIGH — per keystroke and per click, multiplied by item count;
  a held arrow key repeats it at key-repeat rate.
- **Where**:
  - `component/list/AbstractSelectableList.ts:505-511` (`setSelected`, no guard)
  - `component/list/AbstractSelectableList.ts:531-536` (`setFocused`, no guard)
  - `component/list/AbstractSelectableList.ts:662-678` (`applyRowClass`, rebuilds
    and rewrites the entire `class` string)
  - `component/list/AbstractSelectableList.ts:1751-1757` (`refreshRowVisualState`
    loops the whole pool calling both)
  - `component/list/AbstractSelectableList.ts:2255-2277` (`scrollIndexIntoView`,
    `DOM.source.getScrollMetrics` at `:2266`)
  - Callers of `refreshRowVisualState`: `:1011`, `:1496`, `:1817`, `:1935`,
    `:2184`, `:2206`
- **Hot path**:
  - keydown on the list root → `handleKeyDown:2019`
  - → `handleNavigationKey:2094` → `moveFocus:2175`
  - → `refreshRowVisualState:2184` → for every row: `setSelected` → `applyRowClass`
  - → for every row: `setFocused` → `applyRowClass`
  - → `Component.setElementAttribute:1728` → `ElementAttributes.set:30`
    (no last-value filter) → `DOM.sink.apply({ setAttr: { class } })`
  - → `updateActiveDescendant:2185` (one more attribute write)
  - → `scrollIndexIntoView:2186` → `DOM.source.getScrollMetrics:2266`
- **Evidence**: probe F — one `moveFocus` on a 300-item list: **603 writes, 600
  of them `class` attribute patches, 1 `getScrollMetrics`**. Probe F2 — of those
  600 writes only 302 distinct `(handle, value)` pairs exist and exactly **2
  rows' class strings actually changed**; the other 598 writes carry the value
  already on the element. Probe S — five `ArrowDown`s clamped at the last row of
  a 100-item list: **1,000 class writes, 0 state changes**. `ElementAttributes.set`
  has no value comparison (`core/ElementAttributes.ts:30-37`), and slice 03
  established that the sink itself filters nothing, so all 600 reach the DOM.
  The `getScrollMetrics` read lands after all of them in the same task.
- **Proposed change**: stop hand-rolling the class string. `Component.setStyleState`
  (`core/Component.ts:6213-6233`) already early-returns on an unchanged state and
  writes a single `addClass`/`removeClass` token — which is exactly what `TreeRow`
  uses for its own `.selected`/`.focused` (`component/tree/Tree.ts:1309-1310`).
  Move `.selected` / `.focused` / `.disabled` to `setStyleState` and delete
  `applyRowClass`; failing that, guard `setSelected`/`setFocused` on their cached
  fields the way `setEnabled:558-561` already does. Separately, serve
  `scrollIndexIntoView`'s `scrollTop`/`clientHeight` from a cache refreshed on
  the panel's own size change, or read it before the visual refresh, so the read
  never trails the writes.
- **Risk / blast radius**: `SelectableListRow` is module-private; consumers are
  `List`, `MultiSelectList`, `ComboBox`'s dropdown and `AutoCompleteDropdown`.
  `applyRowClass`'s own comment records why it re-states `COMPONENT_CLASS` —
  that need disappears entirely under `setStyleState` (see F18.12). Pinned by
  `tests/component/list/SelectableListRow.classStyleDefaults.test.ts` and the
  `.SelectableListRow.selected` / `.focused` / `.disabled` rules registered at
  `AbstractSelectableList.ts:252-308`, which stay as they are.
- **Proof at implement time**: a probe asserting ≤ 4 `setAttr`/`addClass`/
  `removeClass` writes for one `moveFocus` on a 300-item list (today: 600), and
  zero `DOM.source` reads following a write within `moveFocus`.

---

### F18.2 `AbstractSelectableList` is not virtualised — every item is three live components, laid out in full on every pass

- **Category**: D (layout work recomputed with unchanged inputs), E (work for
  content nobody can see — only ~18 of 300 rows are on screen), G (allocation)
- **Impact**: HIGH for a list of a few hundred items in a resizing region;
  none for the 5–20-item lists the dropdowns use.
- **Where**:
  - `component/list/AbstractSelectableList.ts:917-922` (inner `Panel` with
    `ListRowColumn` = a plain `VBox`, `autoScroll: "y"`)
  - `component/list/AbstractSelectableList.ts:1692-1743` (`syncRows` — one
    `SelectableListRow` per item, added with `addComponent`)
  - `component/list/AbstractSelectableList.ts:631-649` (`SelectableListRow.doLayout`
    commits the renderer's rectangle and calls `layoutChildren` every pass)
  - `component/list/renderer/Label.ts:105-115` (the label's five setters per pass)
- **Hot path**:
  - `Split` gutter drag → `Body.doLayout` → … → `List.doLayout`
  - → `Fit` → inner `Panel.doLayout` → `ListRowColumn` (`VBox`) `doLayout`
  - → `LayoutManager.commitBounds:567` calls `child.doLayout()` **for all N rows,
    unconditionally** (the confirmed library-wide finding — no manager uses
    `applyBounds`, and `SelectableListRow` does not override
    `canSkipUnchangedLayout`)
  - → per row: `SelectableListRow.doLayout` → `getContentBounds()` (allocates an
    `Insets` with a UUID per call — slice 28) → 4 renderer setters →
    `LabelListItemRenderer.layoutChildren` → `getContentBounds()` again → 5 label
    setters
- **Evidence**:
  - probe E — building a 300-item `List`: **921 `createElement`, 12,286 sink
    writes**, 12 stylesheet ops.
  - probe G/G2 — one `doLayout()` with nothing changed: **906 applies, of which
    902 are `style{}` (empty patches)**. That is the confirmed
    `InlineStyle.flushDirty` missing-empty-bag-guard (slices 01/03/04) at three
    components per row; the `List` is the largest amplifier of it in the library.
  - probe H2 — width 240 → 200: **901 `style{left,width}` applies**, i.e. every
    row, renderer and label rewrites `left` (unchanged for all of them) alongside
    `width`.
  - probe Q — an unchanged pass issues **0** `getScrollMetrics` /
    `getComputedOverflow` / `getViewportRect` / `measureText` under the modelled
    source. Whether a real `Panel` with `autoScroll:"y"` remeasures here is *not
    verified* offline; slice 04's settled-panel remeasure finding would apply on
    top if it does.
- **Proposed change**: two options, in increasing order of effort.
  1. Cheap: give `SelectableListRow.doLayout` an unchanged-rectangle guard of
     its own (compare the committed `getContentBounds()` against the rectangle
     it last laid the renderer out for and return early), and have it opt into
     `canSkipUnchangedLayout` so it is ready when a manager finally honours it.
     That removes the 900 empty flushes and the 901 `left` rewrites.
  2. Structural: build the row stack on `component/shared/VirtualRowView`, which
     already exists and is shared by `table/Body` and `Tree`, so cost stops
     scaling with item count. The base's hooks are exactly two (`getRowHeight`,
     `createPoolRow`); a list's fixed `ROW_HEIGHT_PX = 22` fits the `Tree` shape
     precisely.
- **Risk / blast radius**: `ComboBox` and `AutoCompleteDropdown` embed a `List`
  and reach into `_rowPool` by index (`getFocusedRowId:1951`,
  `setItemEnabled:1538`), and `ListRowColumn.computeTotalMinSize:754` walks
  `getLaidOutComponents()`; all three assume pool index == item index, which
  virtualisation breaks. Option 1 has none of that exposure.
- **Proof at implement time**: applies per unchanged `List.doLayout()` at 300
  items (today 906), and applies per 1 px width change (today 907).

---

### F18.3 The tree row renderers measure text one string at a time, defeating the framework's own measurement batching

- **Category**: A (N forced layouts where 1 would do), I (the list renderers
  already implement the correct lazy pattern)
- **Impact**: HIGH on data refresh / expand / theme change — one forced layout
  per visible row, on a path the target app runs on every file-tree refresh and
  every search keystroke.
- **Where**:
  - `component/tree/renderer/Label.ts:59-62` — `setText(...)` then `measure()`
  - `component/tree/renderer/IconLabel.ts:108-110` — same
  - contrast `component/list/renderer/Label.ts:72-90` and
    `component/list/renderer/Glyph.ts:111-132`, which set a `_measured = false`
    flag in `update()` and measure lazily in `getContentWidth()`
  - `component/tree/Tree.ts:1493-1500` — the bind loop calls `setRowData` then
    `getContentWidth(INDENT_PX)` per slot
- **Hot path**:
  - `FileTree.refresh()` → `Tree.setNodes:277` → `_boundIndices.fill(-1):289`
    → `renderWindow:291`
  - → `_bindAndMeasure:1463` → per slot `row.setRowData:1494`
  - → `TreeRow.setRowData:264` → `renderer.update(...)`
  - → `Text.setText:828` (writes text) then `Text.measure():566` →
    `calculateSize()` → `DOM.source.measureText` — **immediately**, so only this
    one `Text` is stale and the batch has a single member
- **Evidence**: probe M — a theme reflow that force-rebinds a 26-slot pool:
  **`measureText` 23, `measureTexts` 0**. Probe M2 — 20 `Text`s dirtied *before*
  the first size read: **`measureTexts` 1** (batch size 20). Probe J — a
  `setNodes` handed the identical node array: 23 text patches and 23
  `measureText` calls. `docs/concepts/performance.md` states the rule this
  breaks: "Measuring N strings one at a time costs N forced layouts … use one
  `DOMSource.measureTexts` call rather than a `measureText` loop."
- **Proposed change**: drop `measure()` from both tree renderers' `update()` and
  adopt the list renderers' `_measured` flag, measuring inside
  `getContentWidth()`. `Tree._bindAndMeasure` already calls `setRowData` for the
  whole window before the first `getContentWidth()` in the *same* loop — so the
  loop also has to be split into a bind pass and a measure pass for the batch to
  form. Both changes are local to `Tree.ts:1463-1507` and the two renderer files.
  The `tree-row-toggle-rebind-perf` plan explicitly listed "`update`'s
  unconditional label `setText`/`measure`" as out of its scope, so this does not
  contradict a decision — it picks up what that plan deferred.
- **Risk / blast radius**: `LabelTreeNodeRenderer.layoutChildren:93` reads
  `getContentWidth()` during layout, so the lazy measure must still be reached
  before the first layout of a newly bound row — it is, via `_bindAndMeasure`.
  Pinned by `tests/component/tree/TreeFontReflow.test.ts` (both cases assert the
  post-reflow label width), which must keep passing.
- **Proof at implement time**: a probe asserting `measureTexts === 1` and
  `measureText`-as-a-direct-call `=== 0` for one `onThemeReflow()` on a 26-slot
  tree (today 0 / 23).

---

### F18.4 Every caret and icon change destroys and rebuilds a `Glyph`, paying shared-stylesheet mutations and a full SVG subtree rebuild

- **Category**: C (stylesheet-rule write on an interaction path), G (element and
  handle churn), H (a library gap forcing the pattern)
- **Impact**: HIGH per expand/collapse click; MEDIUM per scroll tick in a tree
  whose icons vary row to row — which is exactly the target app's file explorer.
- **Where**:
  - `component/tree/TreeRow.ts:228-262` — `setRowData` disposes `_toggle` /
    `_spinner` and constructs a fresh `Glyph`/`ProgressSpinner` whenever the
    `hasChildren`/`expanded`/`loading` triple changes
  - `component/tree/renderer/IconLabel.ts:55-67` — `update` disposes `_icon` and
    constructs `new Glyph(next)` whenever the resolved name changes
  - `component/list/renderer/Glyph.ts:92-109` — the same shape for list rows
  - the constraint itself: `component/display/Glyph.ts:282` (`_name` is set once
    in the constructor; there is no name setter), documented in all three call
    sites as "Glyph names are immutable"
- **Hot path (expand)**:
  - click on a caret → `Tree._handleClick:1162` → `_onToggle:806` → `_expand:829`
  - → `_reflattenAndRender:746` → `_flatten` → `renderWindow:1358`
  - → `_bindAndMeasure:1490` → `row.isBoundTo` false for every slot at or after
    the insertion point → `setRowData`
  - → `TreeRow.setRowData:229-232` `this._toggle.dispose()` → `Component.dispose`
    deletes the glyph's `#id` rule → **`deleteStyleRule`**
  - → `:251` `new Glyph(...)` → `getElement(true)` → render → **`ensureStyleRule`
    + `setRuleStyles`**
- **Evidence**: probe P, a 40-branch tree with the plain label renderer (caret
  churn only):
  - expand: `deleteStyleRule` 2, `ensureStyleRule` 1, `setRuleStyles` 1, plus
    `removeElement` 2 / `createElement` 1 / `createElementNS` 4 / `release` 6 —
    **74 sink ops total**
  - collapse: `deleteStyleRule` 1, `ensureStyleRule` 2, `setRuleStyles` 2 —
    **94 sink ops total**
  - probe K2, ten one-row scroll steps with a per-row-changing icon:
    **39.1 sink ops per step** (1 `removeElement`, 3 `release`, 1 `createElement`,
    4 `createElementNS`, 4 `appendChild`, 1 `insertBefore`, 24 applies)
  - probe K, the same scroll where the icon happens to repeat: **12.1 ops/step**
  The briefing's cost model puts any stylesheet mutation at a full-document
  restyle in WebKitGTK, so 3–5 of them on a single caret click is the single most
  expensive thing this slice does per user gesture.
- **Proposed change**: this is a **library gap, not a `Tree` gap** — add
  `Glyph.setName(name)`, rewriting the `<use href>` attribute for an SVG glyph
  and the text node for a char glyph, guarded on the current name. All three call
  sites then become `this._icon.setName(next)` with no component churn, no handle
  release, and no rule delete/insert. The alternative (keeping two carets alive
  and toggling `setDisplayed`) trades the churn for permanently hidden content,
  which the cost model penalises; prefer the setter. A same-name guard on the
  setter also covers slice 04's `Button.setGlyph` finding from the other side.
- **Risk / blast radius**: `Glyph`'s immutability is load-bearing for the sprite
  mount (`ensureGlyphSymbolMounted(this._name)` at `Glyph.ts:707`) and for the
  char-mode `_def` lookup; a setter has to re-run both and re-assert the
  preferred-size inline style written at `Glyph.ts:759-762`. Callers outside this
  slice: `Button.setGlyph`, `cell/renderer/TreeCell.ts`, `AccordionIndicator`.
  `tests/component/tree/Tree.test.ts:97-118` pins the *current* instance-swap
  behaviour by asserting toggle identity changes across an expand — that test
  would need to assert the name instead.
- **Proof at implement time**: stylesheet ops per expand and per collapse on a
  40-branch tree (today 3 and 5, target 0), and sink ops per one-row scroll step
  with a changing icon (today 39, target ≈ 13).

---

### F18.5 `Text.setText` has no unchanged-value guard, and `AbstractMarkerList` renumbering is O(N²)

- **Category**: B (unchanged-value write), D (recomputed with unchanged inputs)
- **Impact**: MEDIUM — construction and data-refresh cost, quadratic in item
  count; not on a per-frame path.
- **Where**:
  - `component/input/Text.ts:828-845` — `setText` always sets
    `_measurementDirty = true` and always issues `DOM.sink.apply({ text })`
    (slice 14 owns this file; reported here because this slice is its heaviest
    caller)
  - `component/list/AbstractMarkerList.ts:225-231` — `renumber()` rewrites
    *every* item's marker
  - `component/list/AbstractMarkerList.ts:252-257` — `insertComponent` calls
    `renumber()`, and `Component.addComponent:6805` routes through
    `insertComponent`, so **every append renumbers the whole list**
  - `component/list/ListItem.ts:553-560` — `setMarker` → `Text.setText` +
    `setDisplayed`
- **Hot path**: `list.addComponent(item)` → `Component.addComponent:6805` →
  `AbstractMarkerList.insertComponent:252` → `renumber:225` → N × `setMarker` →
  N × `Text.setText` → N × `DOM.sink.apply({ text })`.
- **Evidence**: probe I — building a 50-item `NumberedList` with 50
  `addComponent` calls: **1,325 `setMarker` calls** (50·51/2 from renumbering
  plus 50 from the `ListItem` constructors) and **1,375 `{text}` patches**. At
  300 items that is ~45,000 text writes. For a `BulletedList` every one of them
  writes the same character.
- **Proposed change**: two independent halves.
  1. Guard `Text.setText` on the current value — early-return before dirtying
     the measurement and before the sink write. (Cross-slice: 14.)
  2. In `AbstractMarkerList`, skip the renumber for a marker that does not depend
     on position: add a `markersDependOnPosition(): boolean` hook returning
     `false` in `BulletedList` and `true` in `NumberedList`, and have `renumber`
     mark only the appended item in the `false` case. An append to a numbered
     list genuinely only needs to marker the new item, too — the existing items'
     numbers are unchanged.
- **Risk / blast radius**: half 1 is library-wide; anything relying on `setText`
  to force a re-measure after an *external* metrics change would need
  `measure()`, which exists. Half 2 is pinned by
  `tests/component/list/MarkerListLayout.test.ts:140-200` (renumbering after
  remove/insert/move/sort), all of which are position-dependent paths that keep
  the full renumber.
- **Proof at implement time**: `{text}` patches for 50 `addComponent` calls on a
  `NumberedList` (today 1,375) and on a `BulletedList`.

---

### F18.6 `Tree.doLayout` re-renders the window unconditionally, and every render sweeps the whole pool's selection style — twice per selection change

- **Category**: D (avoidable layout pass / work with unchanged inputs)
- **Impact**: MEDIUM — small per tree, but it runs once per frame per tree for
  every resize anywhere in the app (two trees in the target shell), and it is
  the only remaining per-frame work the `Tree` does.
- **Where**:
  - `component/tree/Tree.ts:1570-1585` — `doLayout` calls `renderWindow()`
    unconditionally whenever layout is not paused
  - `component/tree/Tree.ts:1441` — `renderWindow` calls `_updateSelectionStyle()`
    on every pass
  - `component/tree/Tree.ts:1290-1314` — `_updateSelectionStyle` walks
    `_rowPool` (the whole pool, not the window), calling `getElement`, `getNode`,
    two `setStyleState` and one `getAria().setSelected` per row
  - the double sweep: `_selectAtIndex:995` then `renderWindow:997` (which sweeps
    again at `:1441`); same shape at `_extendSelectionTo:1021/1023` and
    `selectNode:402/404`
  - `component/tree/Tree.ts:1500` — `getContentWidth(INDENT_PX)` per window row
    per pass, even when nothing was rebound
- **Hot path**: `Split` gutter drag → `LayoutManager.commitBounds:567` →
  `Tree.doLayout:1570` → `renderWindow:1358` → `clampToContent` →
  `computeVisibleWindow` → `_bindAndMeasure` (26 × `getContentWidth` →
  `Text.getPreferredSize`, each allocating a clamped `Size`) → `_positionRows` →
  `_updateSelectionStyle` (52 `setStyleState`) → `layoutScrollbars`.
- **Evidence**: probe A — one `doLayout()` with unchanged bounds on a 26-slot,
  60-row tree: **1 sink write** (the `VirtualScroller` clip-box style patch,
  slice 04), **0 stylesheet ops, 0 `setRowData`, 0 `layoutChildren`, 0
  `measureText`, 0 `getScrollMetrics`, 0 `getViewportRect`** — but **52
  `setStyleState` calls and 26 `getAria()` calls** (probe L confirms
  `renderWindow` alone accounts for all of them) plus 26 `getContentWidth`
  round-trips. Probe B — 5 drag frames at −1 px each: **145 applies, 0 rule ops,
  0 `layoutChildren`, 0 `setRowData`**, i.e. 29 per frame for 26 rows, which is
  the irreducible cost of resizing them.
- **Proposed change**:
  1. Give `renderWindow` an early-out keyed on the inputs it actually reads —
     height, `scroller.getViewportWidth()`, `scroller.getScrollY()`, the
     `_flatRows` generation, `_maxContentWidth` and the pool length. An
     unchanged tuple means the pass can return before `_bindAndMeasure`.
  2. Restrict `_updateSelectionStyle`'s sweep to the slots `_bindAndMeasure`
     marked rebound (it already produces `reboundFlags`), and let the four
     selection-mutating call sites keep their own explicit whole-pool sweep —
     removing both the per-frame sweep and the double sweep per selection change.
  3. `Tree` is the natural first non-`Cell` candidate for
     `canSkipUnchangedLayout` once a manager honours `applyBounds`; note it for
     slice 01/05's plan rather than doing it here.
- **Risk / blast radius**: `renderWindow` is re-entered from the scroller's
  `onScroll` hook, `init:1556`, `setNodes:291`, `setRendererFactory:674`,
  `_reflattenAndRender:748`, `selectNode:404`, `_selectAtIndex:997`,
  `_extendSelectionTo:1023` and `renderWindowIfDeferred`; the early-out must not
  swallow a pass those need, so the generation counter has to be bumped by
  `_flatten` and by every `_boundIndices.fill(-1)` site.
  `tests/component/tree/ResizeLayoutEconomy.test.ts` pins the withholding
  behaviour and must keep passing.
- **Proof at implement time**: `setStyleState` calls and sink writes per
  unchanged `Tree.doLayout()` (today 52 and 1), and per selection change on a
  26-slot pool (today 104 `setStyleState`).

---

### F18.7 `List` / `MultiSelectList` fire `change` and repaint every row for a gesture that changed nothing — `Tree` already has the guard, in a shared helper

- **Category**: H (behaviour divergence between two sibling controls), B, I
- **Impact**: MEDIUM — a held arrow key at a list boundary, or repeated clicks
  on the selected row, each fire a `change` and rewrite every row.
- **Where**:
  - `component/list/AbstractSelectableList.ts:1803-1831` (`handleRowClick` →
    `notifyUserChange` unconditionally), `:2175-2191` (`moveFocus`), `:2200-2209`
    (`commitFocusedRow`)
  - `component/list/List.ts:149-151` and `component/list/MultiSelectList.ts:243-246`
    (`notifyUserChange` → `fireChange`)
  - the guard that exists and is not used here:
    `component/shared/selectionsEqual.ts:17`, used by
    `component/tree/Tree.ts:952-958` (`_notifySelectionChange`) and by
    `component/table/Body.ts`
- **Hot path**: keydown → `handleNavigationKey:2094` → `next` clamps to the
  current index at the list boundary → `moveFocus:2175` → `reduceSelection`
  (produces the identical set) → `refreshRowVisualState` (N × 2 class writes,
  F18.1) → `notifyUserChange` → `fireChange:1782` → `Event.fireEvent` +
  `notifyChange(getValue())`.
- **Evidence**: probe R — three identical `handleRowClick(1, …)` calls on a
  3-item list: **3 `change` events**. Probe S — five clamped `ArrowDown`s at the
  last row of a 100-item list: **5 `change` events and 1,000 class writes**, with
  the selection never changing. `Tree` deliberately suppresses the equivalent
  (`tests/component/tree/Tree.test.ts:356-437`, "selection event fires only on a
  real change").
- **Proposed change**: snapshot `_selectedSet` before `reduceSelection` and gate
  both `refreshRowVisualState` and `notifyUserChange` on
  `!selectionsEqual(before, this._selectedSet) || focusMoved`. The helper is
  already in `component/shared/` for exactly this.
- **Risk / blast radius**: `ComboBox` and `AutoCompleteField` listen for
  `change` from the embedded list; suppressing a no-op `change` is the same
  contract `Tree` ships, but it is an observable behaviour change and belongs in
  the changelog. `tests/component/list/MultiSelectList.test.ts:288-310` covers
  the dirty-flag interaction and would gain a case.

---

### F18.8 `Tree` hand-rolls the modifier-selection ladder that `component/shared/reduceModifierSelection.ts` exists to share

- **Category**: I (duplication)
- **Impact**: LOW — code health; the two ladders can drift.
- **Where**: `component/tree/Tree.ts:1175-1196` (shift / ctrl / plain branches),
  `:966-975` (`_rangeSelect`), `:1007-1026` (`_extendSelectionTo`) versus
  `component/shared/reduceModifierSelection.ts:60-99`, whose own JSDoc says
  "@internal Shared by `Body` and `MultiSelectList`".
- **Evidence**: grep over `packages/` and `/home/jika/typescript/loom/src`
  (excluding `dist/` and generated api docs) — `reduceModifierSelection` has
  exactly two production call sites, `MultiSelectList.ts:222` and
  `Body.ts:1531`; `Tree` imports `selectionsEqual` from the same directory but
  not this helper.
- **Proposed change**: pass `indexOf = node => this._flatRows.findIndex(...)`
  and `at = i => this._flatRows[i].node` into `reduceModifierSelection` from
  `_handleClick`, deleting `_rangeSelect` and folding `_extendSelectionTo` into
  the shared path. Note the `findIndex` is already O(rows) today
  (`Tree.ts:1015`, `:1065`, `:1173`), so this is not a new cost — but a
  `Map<TreeNode, number>` rebuilt in `_flatten` would remove it from all four
  sites at once.
- **Risk / blast radius**: `Tree` emits `"selection"` through its own
  `_notifySelectionChange` and keeps `_focusNode` separate from `_anchorNode`;
  the helper returns only the new anchor, so the focus assignment stays at the
  call site. Pinned by `tests/component/tree/Tree.test.ts:356-453`.

---

### F18.9 `Tree.setNodes` discards the expanded set, so a refresh costs one full reflatten + render per expanded node replayed

- **Category**: D (avoidable layout passes), H (missing API forces the caller
  into the slow path)
- **Impact**: MEDIUM — on the target app's file-tree refresh and on every
  search-results update.
- **Where**:
  - `component/tree/Tree.ts:277-295` (`setNodes` clears `_expandedNodes` and
    force-rebinds every slot)
  - `component/tree/Tree.ts:829-843` (`_expand` → `_reflattenAndRender` →
    `_flatten` + `renderWindow`, once per call)
  - the caller this is written for: `/home/jika/typescript/loom/src/explorer/FileTree.ts:439`
    (`this.setNodes(this.getNodes())`) and `:421` ("replays the expansion,
    selection, and scroll position `setNodes` [discards]")
- **Hot path**: refresh → `setNodes` (1 flatten + 1 render, every visible row
  force-rebound: N `setText`, N `measureText`, glyph churn per F18.3/F18.4) →
  caller replays K expansions → K × (`_flatten` + `renderWindow`).
- **Evidence**: probe U — replaying 10 expansions on a 30-branch tree:
  **10 `_flatten` calls, 10 `renderWindow` calls, 650 sink writes**. Probe J —
  `setNodes` handed the identical array: 162 writes, 23 text patches, 23
  `measureText`.
- **Proposed change**: either an options argument
  (`setNodes(nodes, { preserveExpansion: true })`) that keeps `_expandedNodes`
  entries whose node objects survive, or a bulk `expandNodes(nodes: TreeNode[])`
  that adds all of them to the set and flattens/renders once. `expandAll:304-318`
  already has exactly that shape (fill the set, then one
  `_reflattenAndRender`), so the mechanism exists.
- **Risk / blast radius**: `setNodes`'s "clears the expanded set (also silently)"
  contract is documented at `docs/components/Tree.md:110` and pinned by
  `tests/component/tree/Tree.test.ts:813` ("setNodes() clears the expanded set
  and emits zero collapse") — so the new behaviour has to be opt-in, not a
  default change.

---

### F18.10 `rowOverflow: "clip"` still measures every visible row and accumulates a content width the render pass discards

- **Category**: J (a cache nothing reads on this branch), D
- **Impact**: LOW — one wasted `getContentWidth` per visible row per pass on
  trees configured for clipping; the target app uses `"scroll"`, so it does not
  pay this.
- **Where**: `component/tree/Tree.ts:1424-1426` — under `"clip"`, `rowWidth` is
  `scroller.getViewportWidth()` and `_maxContentWidth` is never read; yet
  `_bindAndMeasure:1500-1503` computes it unconditionally and `:1409-1411` folds
  it into the running maximum.
- **Evidence**: probe N — a `rowOverflow: "clip"` tree, one `renderWindow`:
  **23 `getContentWidth` calls, `_maxContentWidth` = 32**, and the row width
  taken from the viewport. (The renderer's own `Math.min(getContentWidth(), width)`
  clamp at `renderer/Label.ts:93` still needs a measured width, so the
  *measurement* is not dead — only the accumulation and `_bindAndMeasure`'s max
  tracking are.)
- **Proposed change**: skip the max accumulation under `"clip"` — return early
  from the `maxContentWidth` branch, or pass the mode into `_bindAndMeasure`.
- **Risk / blast radius**: none outside `Tree`; `setRowOverflow:212` does not even
  schedule a layout today (see F18.14), so a mode flip is already caller-driven.

---

### F18.11 Function/implementation gaps: no hover affordance, no page navigation, a documented method that does not exist

- **Category**: H (function vs implementation), J (documented-but-absent)
- **Impact**: LOW — correctness/completeness, not render work. Included because
  the briefing asks explicitly about per-row hover.
- **Where / evidence**:
  - **No per-row `:hover` rule and no pointer listeners anywhere in
    `component/tree/`** — `grep -rn "hover\|mouseover\|mouseout\|mouseenter"
    component/tree/` returns zero hits. So the tree costs nothing per
    `mousemove` (good), but a `Tree` row gives no hover feedback while a
    `List` row does (`AbstractSelectableList.ts:244-250`, a single shared
    `.SelectableListRow:hover` rule registered once at module init — the right
    shape, also zero JS per `mousemove`).
  - **`Tree` has no `PageUp`/`PageDown`** — `Tree._onKeyDown:1053` handles only
    `ArrowDown/Up/Left/Right/Home/End`. The shared base's
    `VirtualRowView.computePageSize:339` exists for exactly this and has one
    consumer, `table/Body.ts:2818` and `:2957`.
  - **`Tree.collapseAll()` is documented but does not exist** —
    `docs/components/Tree.md:98` lists "`expandAll()` / `collapseAll()`";
    `grep -rn "collapseAll" component/tree/` returns zero hits. The name resolves
    only on `Accordion`, `TreeBody` and `TreeStore`.
  - `VirtualRowView.wasRenderDeferred:733` likewise has exactly one consumer
    (`table/Body.ts:1062`).
- **Proposed change**: add `collapseAll()` (one line: clear `_expandedNodes`,
  `_reflattenAndRender`) or delete the docs row; add `PageUp`/`PageDown` to
  `_onKeyDown` using the inherited `computePageSize()`; decide whether a tree row
  wants a hover wash (one shared rule, matching the list's) — that is a design
  call for the maintainer, not a perf one.

---

### F18.12 `applyRowClass` replaces the whole `class` attribute, so it would silently drop framework-owned class tokens

- **Category**: H (hand-rolled where a framework seam exists), latent correctness
- **Impact**: LOW today, but it makes F18.1's fix strictly safer.
- **Where**: `component/list/AbstractSelectableList.ts:662-678` rebuilds the class
  list from `[COMPONENT_CLASS, "SelectableListRow", …]` by hand. The framework
  writes `[COMPONENT_CLASS, ...getStyleClassChain(ctor), ...activeStateTokens,
  ...classTraitTokens, ...valueClassTokens]` at `core/Component.ts:7585`.
- **Evidence**: the two sets coincide *only* because `SelectableListRow` declares
  no `ownClassStyleDefaults`, no `ownStyleTraits` and no value-class token, and
  because nothing currently calls `setVisible`/`setDisplayed` on a row
  (`grep -n "setDisplayed\|setVisible" component/list/AbstractSelectableList.ts
  component/input/ComboBox.ts component/input/AutoCompleteDropdown.ts` → zero
  hits). Any of those changing turns this into a live bug: a `setVisible(false)`
  row would lose its `.invisible` token on the next selection repaint.
  The method's own comment already documents one instance of this trap
  (`COMPONENT_CLASS` being dropped and collapsing every row to `top: auto`).
- **Proposed change**: subsumed by F18.1 — `setStyleState` writes
  `addClass`/`removeClass` patches and never touches tokens it does not own.

---

### F18.13 `Tree.setRowOverflow` / `setExpandTrigger` write an option and schedule nothing

- **Category**: H (a runtime setter that does not take effect until something
  else triggers a layout)
- **Impact**: LOW.
- **Where**: `component/tree/Tree.ts:212-216` and `:237-241` — both assign
  `this._options.<x>` and return, with no `renderWindow()` and no
  `scheduleLayout()`. `getRowOverflow()` is read inside `renderWindow`
  (`:1424`), so a runtime `setRowOverflow("clip")` changes nothing until an
  unrelated pass runs.
- **Evidence**: read of both setters; `grep -n "setRowOverflow\|setExpandTrigger"
  component/tree/Tree.ts` shows the only other reference is `applyOptions:185/189`.
  Every caller found (`FileTree.ts:77-78`, `SearchPanel.ts:169`) passes them at
  construction, where the missing schedule is harmless — which is why it has not
  shown up.
- **Proposed change**: add `this.renderWindow()` (guarded on `getElement()`) to
  `setRowOverflow`, matching `setRendererFactory:673-675`. `setExpandTrigger`
  needs nothing — it is read per gesture.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `VirtualRowView` (`shared/VirtualRowView.ts`) | Shared transform-windowed virtual-scroll base for `Tree` and `table/Body`: row pool, `VirtualScroller` wiring, window/pool/geometry primitives | none of its own; owns the pool rows' handles and the scroller's | `positionRow` writes 4 batched geometry values per row **only when the cached geom differs**; nothing on an unchanged pass | fits — the geometry cache, the pool rotation and the resize withholding all work as documented | F18.11 (`computePageSize`, `wasRenderDeferred` have one consumer each) |
| `Tree` (`tree/Tree.ts`) | Hierarchical data view with collapsible nodes and virtual scrolling | own element + the scroller's containers | unchanged pass: 1 write (the scroller's clip box), 0 rule ops, 0 reads, 52 guarded `setStyleState`, 26 `getContentWidth`. Drag frame: 29 writes for 26 rows | fits for resize; over-eager on render-pass entry and selection sweep | F18.6, F18.9, F18.10, F18.13, F18.8 |
| `TreeRow` (`tree/TreeRow.ts`) | One pooled row: toggle/spinner + renderer, rebound via `setRowData` | own `<div>`, raw-appends toggle/spinner/renderer | none unless rebound or geometry changed; `layoutChildren` writes 4–5 batched values per sub-component | fits; the 2026-08-29 leak is **closed** (`destructor:370`, `setRowData:229-237`, `setRenderer:139`) | F18.4 |
| `TreeNodeRenderer` (abstract) | Owns the row content right of the toggle | subclass element | contract only | fits | — |
| `LabelTreeNodeRenderer` (`tree/renderer/Label.ts`) | Plain text label | own element + raw-appended `Text` | 5 batched label setters per `layoutChildren`; `setLineHeight` is a guarded no-op at a fixed row height | mismatch with its list sibling: measures eagerly | F18.3 |
| `IconLabelTreeNodeRenderer` (`tree/renderer/IconLabel.ts`) | Glyph icon + label, icon resolved per node | own element + raw-appended `Glyph` and `Text` | as above plus 5 icon setters | same eager-measure mismatch; forced into glyph churn | F18.3, F18.4 |
| `TreeNode`, `TreeNodeRenderContext` | Plain data | none | none | fits (no built-in renderer reads `selected`/`hasChildren`/`expanded`/`depth`; they exist for custom renderers) | — |
| `AbstractSelectableList` (`list/AbstractSelectableList.ts`) | Item array, store binding, row pool, selection set, keyboard model, ARIA listbox | own element + inner `Panel` | 906 applies per unchanged pass at 300 items (902 empty); 901 `left`+`width` per resize frame | over-built for large lists (not virtualised); hand-rolls class writes | F18.1, F18.2, F18.7, F18.12 |
| `SelectableListRow` (same file, module-private) | One list row: renderer + selected/focused/enabled/disabled chrome | own `<div>`, raw-appends the renderer | `doLayout` commits the renderer's rectangle + `layoutChildren` on **every** pass | over-built: rewrites the whole class attribute; the 2026-08-29 leak is **closed** (`destructor:618`) | F18.1, F18.2, F18.12 |
| `ListRowColumn` (same file, module-private) | `VBox` that reports the widest row's natural width as the overflow-inflation target, without making it a minimum | none | `computeTotalMinSize` scans rows **only when the host scrolls X** (`:763`) | fits — the gating comment is accurate | — |
| `List` (`list/List.ts`) | Single-selection listbox, `Bindable<string>` | inherited | inherited | fits apart from the unconditional `change` | F18.7 |
| `MultiSelectList` (`list/MultiSelectList.ts`) | Multi-selection listbox | inherited | inherited | fits | F18.7 |
| `ListItemRenderer` (abstract) | Owns a list row's content | subclass element | contract only | fits; the base `getContentWidth() → 0` opt-out is the documented default | — |
| `LabelListItemRenderer` (`list/renderer/Label.ts`) | Text label, lazily measured | own element + raw-appended `Text` | 5 batched label setters per `layoutChildren` | fits — this is the measurement pattern the tree renderers should copy | — |
| `GlyphListItemRenderer` (`list/renderer/Glyph.ts`) | Icon + label, icon from `item.glyph` | own element + `Glyph` + `Text` | as above plus 5 icon setters | fits apart from the glyph churn | F18.4 |
| `AbstractMarkerList` (`list/AbstractMarkerList.ts`) | Bulleted/numbered list: owns each item's marker string and the shared marker column | own `<ul>`/`<ol>`, one shared `.MarkerList` rule | `doLayout` → `syncMarkerColumn`: N `getMarkerWidth` + N guarded `setMarkerColumnWidth` per pass; probe T measured 40/40 and 120 writes (3/item, the empty-flush bug) | over-built: renumbers everything on every append | F18.5 |
| `BulletedList` / `NumberedList` | Concrete marker lists | inherited | inherited | fits; `BulletedList`'s position-independent marker makes the full renumber pure waste | F18.5 |
| `ListItem` (`list/ListItem.ts`) | One `<li>`: marker slot + label, `HBox` | own `<li>` + two registered `Text` children | 2 registered children laid out per pass | fits; `ListItemMarkerText.setMinSize:388` is a good model of a guarded value-class write | — |
| `BulletedListItemStyle` / `NumberedListItemStyle` | CSS keyword enums | none | none | fits | — |
| `selectionsEqual` (`shared/selectionsEqual.ts`) | Membership-only set comparison | none | none | fits | used by `Tree`/`Body`; **not** by `AbstractSelectableList` → F18.7 |
| `reduceModifierSelection` (`shared/reduceModifierSelection.ts`) | The shift/ctrl/plain selection ladder over an arbitrary identity | none | none | fits | **not** used by `Tree` → F18.8 |

---

## Redundant, duplicated and dead code

Items not already covered by a finding above.

1. **`Tree.getRendererFactory()` has no production caller.**
   `grep -rIn "getRendererFactory" packages/ /home/jika/typescript/loom/src`
   (excluding `dist/` and `packages/lib/docs/api/`) → 6 hits: the two
   declarations, `ComboBox.ts:1352` (which calls `AbstractSelectableList`'s, a
   different class), and 3 test assertions in
   `tests/component/tree/Tree.test.ts:233-244` and
   `tests/component/list/renderer.test.ts:191-201`. `AbstractSelectableList.getRendererFactory`
   does have the one real caller.

2. **`TOGGLE_WIDTH = 20` is declared twice**, `component/tree/TreeRow.ts:21` and
   `component/table/cell/renderer/TreeCell.ts:16`, each with a comment telling
   the reader to keep them in lockstep. Carried over from the 2026-08-29 health
   audit's Priority-3 list ("duplicate `TOGGLE_WIDTH` constants in
   `TreeRow.ts`/`cell/renderer/TreeCell.ts`") — **still open**.
   `grep -rn "TOGGLE_WIDTH" packages/lib/src/typescript/lib/` → 13 hits across
   the two files plus one doc comment in `cell/Cell.ts:760`.

3. **The list row height 22 is declared four times.**
   `component/list/AbstractSelectableList.ts:81` (`ROW_HEIGHT_PX`), the same
   file's `.SelectableListRow` rule `lineHeight: "22px"` at `:236`,
   `component/input/ComboBox.ts:114`, and
   `component/input/AutoCompleteDropdown.ts:12` — the last two with "Matches
   `SelectableListRow`'s cached `preferredSize(0, 22)`" comments.
   `grep -rn "22" ` on those four sites confirms four independent literals.

4. **`ICON_WIDTH = 20` and `iconSizePx()` are duplicated verbatim** between
   `component/list/renderer/Glyph.ts:17,25-27` and
   `component/tree/renderer/IconLabel.ts:233,240-242`, including the doc
   comments. Two copies of a four-line function with identical bodies.

5. **`AbstractMarkerList.addComponent:239-243` adds nothing.** It calls
   `super.addComponent(component, constraints)` and returns `this`; the only
   effect is the `ListItem` parameter type narrowing (`insertComponent`,
   `removeComponent` and `sortComponents` each add a real `renumber()` call; this
   one does not need to, because `Component.addComponent:6805` routes through
   `insertComponent`). Keep it only if the type narrowing is the point — say so
   in the JSDoc, which currently reads as if it did work.

6. **`ListItemRenderContext.index` is read by no renderer in the library.**
   `grep -rn "context\.index" packages/lib/src/typescript/` → 0 hits. It is a
   public extension point (and `ComboBox` passes `-1` for its empty collapsed
   state), so this is documentation-worthy rather than removable.

7. **`Tree._scrollIntoView:1034-1036` is a one-line pass-through** to the
   inherited `scrollRowIntoView`, with five call sites inside `Tree`. Either
   call the base directly or keep it — noted only because it adds a hop with no
   behaviour.

8. **Closed since the 2026-08-29 health audit** — reported here so the audit's
   list can be pruned:
   - Finding 1, "`TreeRow` leaks a renderer + `Glyph`/`ProgressSpinner` on every
     re-bind": **fixed**. `TreeRow.destructor:370-376` disposes all three;
     `setRowData:229-237` disposes before rebuilding; `setRenderer:139` disposes
     the outgoing renderer.
   - Finding 2, "`SelectableListRow` leaks its renderer per row; shrink path
     discards rows via detach-only API": **fixed**.
     `SelectableListRow.destructor:618-622` disposes `_renderer`;
     `syncRows:1722-1735` now pairs `removeComponent` with `dispose()` (and
     `Tooltip.detach`).
   - Priority-3 item "`SelectableListRow` has zero importers … exported without
     `callable()`": **fixed** — the class is module-private now
     (`AbstractSelectableList.ts:2280` exports only `AbstractSelectableList`).
   - Priority-3 item "`AbstractSelectableList.getIndex()`": **fixed** —
     `grep -rn "getIndex" component/list/ component/tree/` → 0 hits.

---

## Cross-slice notes

- **→ 01 core-component-lifecycle / 03 core-dom-seam-events:
  `InlineStyle.flushDirty`'s missing empty-bag guard is at its worst here.**
  Probe G2: a 300-item `List` issues **902 empty `style{}` applies on a single
  unchanged layout pass** — three per row (the row's own `commitBounds`
  auto-commit re-enable, the renderer's `setAutoCommitStyle(false/true)` pair in
  `SelectableListRow.doLayout:639-644`, and the label's pair in
  `LabelListItemRenderer.layoutChildren:108-114`). Probe T: 120 for a 40-item
  `NumberedList`. The guard is a one-line fix in `InlineStyle` and this slice is
  the largest single beneficiary.
- **→ 01 core-component-lifecycle: `writeHorizontalGeometry` writes `left`
  alongside `width` even when `left` is unchanged.** Probe H2: a `List` width
  change produced **901 `style{left,width}` applies** where 901 `style{width}`
  would have done; every one of those rows sits at `left: 0` (or a fixed content
  inset) for its whole life.
- **→ 13 button-glyph-image: `Glyph` needs a name setter.** F18.4 is the
  demand-side case for it; slice 04's `Button.setGlyph` finding is the same gap
  seen from the caller side. Three call sites in this slice
  (`TreeRow.setRowData`, `IconLabelTreeNodeRenderer.update`,
  `GlyphListItemRenderer.update`) all carry a comment saying glyph names are
  immutable, and all three pay a component dispose + construct (and a
  `deleteStyleRule` + `ensureStyleRule` pair) because of it.
- **→ 14 text-and-small-display: `Text.setText` (`component/input/Text.ts:828`)
  has no unchanged-value guard** — it dirties the measurement and writes the
  text node every time. Probe I measured **1,375 text patches to build a 50-item
  `NumberedList`**; probe J measured 23 text writes for a `setNodes` handed
  identical labels. This is the single highest-leverage guard for this slice.
- **→ 14 text-and-small-display: the eager-vs-lazy measure split.** The
  framework's `text-measurement-batching` only forms a batch when several `Text`s
  are dirtied *before* the first size read (probe M2: 20 dirtied → 1
  `measureTexts`). Any consumer that calls `setText` then `measure()` in the same
  breath gets N forced layouts (probe M: 23 → 0 batched). Worth stating as a
  rule in `docs/concepts/performance.md`, since the two tree renderers and the
  two list renderers currently disagree about it.
- **→ 04 core-panel-scrolling: `VirtualScroller.layoutScrollbars` writes the
  clip box unconditionally.** `component/container/VirtualScroller.ts:453` issues
  `DOM.sink.apply(this._clipBox, { style: { left, top, width, height } })` on
  every call, with no comparison against the last value. Probe A: that patch is
  **the only DOM write an entirely unchanged `Tree.doLayout()` produces** — so
  guarding it would take the tree's idle-frame cost to literally zero.
- **→ 05 layout-base-box-flow-grid: `ListRowColumn` is a `VBox` subclass that
  commits child bounds through the inherited path**, i.e.
  `LayoutManager.commitBounds:567` calling `child.doLayout()` unconditionally.
  `SelectableListRow` is a strong candidate for `canSkipUnchangedLayout` (300
  identical rectangles per pass) once a manager honours `applyBounds` — worth
  naming in whatever plan takes that up.
- **Seams this slice relies on that hold**: `Component.setStyleState:6213` (early
  return + single class-token patch), `Aria`'s private `setAttribute:791`
  (value-compared), `Component.setTranslate:4647` (guarded, **inline** style, not
  a rule), `Text.setLineHeight:1162` (guarded in pure-numeric mode, so the row
  renderers' per-pass `setLineHeight(box.height)` really is a no-op).
- **Seams that do not hold**: `ElementAttributes.set:30` (no value compare —
  F18.1), `Text.setText:828` (no value compare — F18.5), and
  `Aria.setExpanded:313`'s `null` branch, which calls
  `applyAriaAttribute("aria-expanded", null)` unconditionally even when the
  attribute is already absent — one redundant removal per leaf row per rebind
  (`TreeRow.setRowData:267`).

---

## Suggested plan grouping

**Plan A — "list row state writes"** (F18.1, F18.7, F18.12). One coherent change
to `AbstractSelectableList`: move `.selected`/`.focused`/`.disabled` onto
`Component.setStyleState`, delete `applyRowClass`, gate the visual refresh and
`notifyUserChange` on `selectionsEqual`, and move `scrollIndexIntoView`'s
geometry read off the tail of the write burst. Measurable on its own: class
writes and `DOM.source` reads per keypress on a 300-item list. No dependencies.
Highest payoff-per-line in the slice.

**Plan B — "tree text measurement batching"** (F18.3, plus the `Text.setText`
guard from F18.5 half 1). Split `Tree._bindAndMeasure` into a bind pass and a
measure pass, move the two tree renderers to the list renderers' `_measured`
pattern, and guard `Text.setText`. Depends on nothing in this slice, but the
`setText` guard belongs to slice 14 and should be sequenced with it — either
land the guard in slice 14's plan and have this plan consume it, or carry it
here and say so. Measurable as `measureTexts === 1` per force-rebind pass.

**Plan C — "glyph name setter"** (F18.4). Owned by slice 13
(`component/display/Glyph.ts`); this slice supplies the three call sites and the
numbers. Depends on 13 landing `Glyph.setName`. Measurable as stylesheet ops per
expand/collapse and sink ops per icon-changing scroll step. Should be sequenced
after Plan B so the expand/collapse probe measures one change at a time.

**Plan D — "tree render-pass entry economy"** (F18.6, F18.10, F18.13). One
change set inside `Tree.ts`: an input-signature early-out for `renderWindow`, a
rebound-slots-only selection sweep (removing the double sweep per selection
change), skipping the discarded `_maxContentWidth` accumulation under `"clip"`,
and a `renderWindow()` in `setRowOverflow`. Independent of A–C. Measurable as
sink writes and `setStyleState` calls per unchanged `Tree.doLayout()`.

**Plan E — "marker list renumbering"** (F18.5 half 2, plus items 4–5 of the
dead-code list). Small and self-contained in `AbstractMarkerList` /
`BulletedList` / `NumberedList`. Benefits substantially from Plan B's
`Text.setText` guard but does not require it. Measurable as text patches for N
`addComponent` calls.

**Plan F — "list virtualisation"** (F18.2). The largest change and the one with
the most blast radius (`ComboBox`, `AutoCompleteDropdown` and
`ListRowColumn.computeTotalMinSize` all assume pool index == item index). Split
it: land option 1 (the unchanged-rectangle guard in `SelectableListRow.doLayout`
plus a `canSkipUnchangedLayout` opt-in) inside Plan A, where it is three lines
and measurable with the same probe; keep option 2 (moving onto `VirtualRowView`)
as a separate, later plan gated on whether a real app ever puts hundreds of items
in a `List`. Depends on slices 01/05 for whether `applyBounds` ever becomes live.

**Too small to plan on their own — ride along with a neighbour**: the
`Aria.setExpanded(null)` unconditional removal and the redundant
`Tree._scrollIntoView` hop go with Plan D; the duplicated `TOGGLE_WIDTH`,
`ROW_HEIGHT_PX`, `ICON_WIDTH` and `iconSizePx()` constants go with Plan C (which
already touches every glyph call site); `Tree.collapseAll()` and the `PageUp`/
`PageDown` gap (F18.11) are feature work, not render work, and should be raised
with the maintainer rather than folded into a performance plan.
