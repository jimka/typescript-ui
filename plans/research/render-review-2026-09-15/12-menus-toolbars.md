# 12 menus-toolbars — render-work review

**Summary**

- The headline is negative and worth stating first: **`MenuBar` and `ToolBar` add
  no per-frame work of their own.** One settled `doLayout()` pass over a Loom-shaped
  bar issues **zero stylesheet-rule writes, zero `DOM.source` geometry reads and zero
  non-empty style writes**; the only sink traffic is the already-confirmed
  empty-`InlineStyle` flush (4 per child per pass → ~28 empty `DOM.sink.apply`
  round-trips per resize frame for Loom's 5-child menu bar plus 2-child rail).
  Treat "the menu bar / tool bar is wasteful per resize frame" as refuted (F12.1).
- **`MenuItem` builds a permanently-invisible legacy icon `Text` on every row that
  has no glyph** — 12 of the 51 element creations in a 12-row context menu, each with
  its own instance rule, each left in the render tree by `visibility: hidden` rather
  than `display: none` (F12.2). Per menu open, and per layout pass while open.
- **One 12-row `Menu.show()` costs 873 sink writes and 57 stylesheet-rule
  operations, with 19 live text measurements sandwiched between two batches of
  rule writes in the same task** — the exact read-after-rule-write crossing
  `docs/concepts/performance.md:140` names as the thing that makes every later rule
  write in the task dramatically more expensive (F12.3). 24 rows → 1,497 writes / 105
  rule ops.
- **A fixed-array `MenuBar` builds every dropdown row eagerly at construction**: a
  6×10 bar builds 60 `MenuItem`s and forces 126 `measureText` + 6 `measureTexts`
  calls before first paint, for panels the user may never open (F12.4). The
  provider form already defers this; Loom uses it, so Loom is unaffected.
- **`ToolBar` runs three synchronous `doLayout()` calls from inside its own
  constructor** and re-runs a full synchronous layout on a no-op `setOverflow` (F12.5),
  and installs a lifetime subtree `keydown` listener that makes **every keystroke in the
  document** pay an ancestor walk to `<html>` (F12.7).
- Both 2026-08-29 health-audit items assigned to this slice are **closed**:
  `AbstractBooleanMenuRow` now owns everything `CheckboxMenuRow`/`RadioMenuRow`
  duplicated, and `Menu.open()` routes both axes through the `OverlayPosition`
  primitives (F12.15 records the one residue).

All file paths are relative to `packages/lib/src/typescript/lib/` unless stated.
Probes live in `.worktrees/_probes/12-menus-toolbars/`.

---

## Findings

### F12.1 The always-on chrome's entire per-frame sink traffic is empty patches

- **Category**: B (unchanged-value write), G (allocation/round-trip churn)
- **Impact**: MEDIUM — per frame on hot path 1, ~28 wasted sink round-trips for
  Loom's on-screen chrome; but it is an instance of an already-confirmed
  library-wide defect, not a new one.
- **Where**: `component/menubar/MenuBar.ts` (no `doLayout` override),
  `component/menubar/ToolBar.ts:584-598`; root cause is `core/StyleTarget.ts`'s
  `InlineStyle.flushDirty` missing the empty-bag guard its `StyleRule` sibling has
  (confirmed by slices 01, 03 and 04).
- **Hot path**:
  - `Body` resize / `Split` gutter drag → `doLayout` from the root
  - → `Border`/`HBox` commits the bar's rectangle
  - → `LayoutManager.commitBounds` → `child.doLayout()` (unconditional; the
    `canSkipUnchangedLayout` contract is inert, per slices 01/05)
  - → `HBox`/`VBox.doLayout` → per child `setX`/`setY`/`setWidth`/`setHeight`
    (all four *are* guarded and write nothing on an unchanged pass)
  - → `applyBounds`'s auto-commit re-enable → `InlineStyle.flushDirty` → one
    `DOM.sink.apply` with an **empty** patch, per child, four times per pass.
- **Evidence** (probes `toolbar-pass.test.ts`, `menubar-pass.test.ts`): one settled
  `doLayout()` on
  - `MenuBar` with 5 children → **20 sink writes, `empty=20 nonEmpty=0`**;
  - vertical clip `ToolBar` with 2 buttons → **8 writes, `empty=8 nonEmpty=0`**;
  - `ToolBar({overflow:"menu"})` with 8 buttons → **33 writes, `empty=33 nonEmpty=0`**.
  Zero `setRuleStyles` / `insertRule` / `deleteRule`, zero `getViewportRect` /
  `getScrollMetrics` / `getBorderWidths` in every case. Size reports on the same
  pass: 8 `getPreferredSize` / 10 `getMinSize` / 10 `getMaxSize` for 2 buttons
  (vertical clip); 40/40/40 for 8 buttons (overflow menu).
- **Proposed change**: none in this slice. The fix belongs to `InlineStyle.flushDirty`
  (slice 01/03). What this slice contributes is the multiplier: a `MenuBar` is one of
  the few components guaranteed present on every frame, so its child count is a direct
  multiplier on that defect.
- **Risk / blast radius**: n/a here.
- **Proof at implement time**: re-run `menubar-pass.test.ts` after the
  `flushDirty` guard lands and assert `writes.length === 0` for a settled
  `MenuBar.doLayout()`.

---

### F12.2 Every glyph-less `MenuItem` builds an invisible legacy icon `Text` that stays in the render tree

- **Category**: E (work for invisible content), J (dead option), G
- **Impact**: MEDIUM — one extra `Component` + element + instance stylesheet rule
  per menu row, plus four guarded geometry setters per row per layout pass while
  the menu is open. 24% of a plain context menu's DOM.
- **Where**: `component/container/MenuItem.ts:274-279` (the `else` branch),
  `MenuItem.ts:662-667` (`doLayout` positions it), `MenuItemConfig.icon` at
  `MenuItem.ts:93-100`.
- **Hot path**:
  - `Menu.show()` → `showAnchored` (`overlay/Menu.ts:335-363`) → `new MenuItem(config, …)`
  - → `MenuItem` constructor: `config.glyph` unset → `new Text(config.icon ?? "")`,
    `setPointerEvents("none")`, `setVisible(!!config.icon)` → `.invisible` →
    `visibility: hidden`
  - → `addComponent` → rendered with the rest of the panel: element created,
    instance rule materialised
  - → every subsequent `MenuItem.doLayout` → `setX`/`setY`/`setWidth(20)`/`setHeight(H)`
    on the hidden `Text`.
- **Evidence** (probe `menuitem-icon.test.ts`):
  `new MenuItem({ text: 'Open' }, …)` → `_iconText built = true; visible = false;
  _iconGlyph = false; child count = 2` — half the row's children are the hidden slot.
  A 12-row plain context menu: **51 `createElement` ops, 12 rows carrying a hidden
  icon `Text`**. `item._iconText.isDisplayed() === true` — `setVisible(false)` uses
  `visibility: hidden` (`core/Component.ts:431-440` declares `.invisible` as
  `visible: false`), so the subtree stays in the render tree, the exact hazard the
  briefing's cost model and slice 07's `Tab.setBarVisible` finding name.
  `MenuItemConfig.icon` has **zero** callers anywhere:
  `grep -rn "icon:" packages/lib/src/typescript/lib packages/lib/src/typescript/*.ts /home/jika/typescript/loom/src` returns only unrelated `_icon` fields, `setFavicon`
  and glyph-definition files — no `MenuItemConfig` sets it.
- **Proposed change**: build `_iconText` only when `config.icon` is truthy, matching
  the `_shortcutText` / `_chevronText` conditionals eight lines below; `doLayout`'s
  `else if (this._iconText)` branch already handles the null case. Longer term,
  consider deprecating `MenuItemConfig.icon` outright in favour of `glyph` (the
  JSDoc at `MenuItem.ts:96-99` already says "prefer `glyph`").
- **Risk / blast radius**: `layOutColumns`'s `rows.some(r => r.hasIcon())`
  (`overlay/Menu.ts:245`) already keys on `config.icon || config.glyph`, not on the
  `Text` existing, so the icon column reservation is unaffected.
  `tests/component/content-box-containment.test.ts` constructs bare `MenuItem`s and
  asserts child containment — check whether any case counts children.
- **Proof at implement time**: the probe above — assert `createElement` ops for a
  12-row plain menu drop from 51 to 39, and `_iconText === null` for a glyph-less item.

---

### F12.3 One menu open crosses the read ↔ stylesheet-rule-write boundary three times in a single task

- **Category**: A (forced sync read after a write), C (rule write on an interaction path)
- **Impact**: MEDIUM — per menu open (a very common gesture in the target app:
  every right-click in the file tree, every menu-bar dropdown, every toolbar
  overflow press). Not per frame, so not HIGH, but each crossing is a full-document
  style recalculation in WebKitGTK.
- **Where**: `overlay/Menu.ts:326-425` (`showAnchored`), specifically
  `Menu.ts:365` (`resumeLayout`), `Menu.ts:367` (`layOutColumns`),
  `Menu.ts:241-274` (`layOutColumns` → `titleTextWidth`/`shortcutTextWidth` →
  `Text.getPreferredSize` → `DOM.source.measureText`), `Menu.ts:371-398`
  (`setWidth` / `setMaxSize` / `setX` / `setY` / `applyViewportHeightClamp`),
  `Menu.ts:385` and `Menu.ts:304` (`DOM.source.getViewportSize`).
- **Hot path** (one `contextmenu` event):
  - `Menu.show(x, y, configs)` → `DOM.source.getViewportSize()` — **read**
  - → `showAnchored` → `pauseLayout` → N × `new MenuItem(...)` → `resumeLayout`
  - → `layOutColumns()` → per row `titleTextWidth()` + `shortcutTextWidth()`
    → `Text.getPreferredSize()` → `DOM.source.measureTexts` + `measureText` ×18 — **reads**
  - → `setColumns` per row → `scheduleLayout` ×N (see F12.9)
  - → `setWidth` / `setMaxSize` / `setX` / `setY` / `setZIndex` / per-row rule
    materialisation → 35 `setRuleStyles` — **rule writes**
  - → `LayerManager.mount(el)` → `Panel` scroll metrics → `getScrollMetrics` ×2,
    `getViewportSize`, `isConnected` ×4 — **reads**
  - → 2 further `setRuleStyles` — **rule writes**
- **Evidence** (probes `menu-order.test.ts`, `menu-phase.test.ts`, `menu-open.test.ts`):
  the ordered timeline of one 12-item `show()` is
  `R:getViewportSize | W:ensureStyleRule | W:setRuleStyles | R:measureTexts |
  R:measureText x18 | [64 rule ops] | R:getScrollMetrics x2 | R:getViewportSize |
  R:isConnected x2 | W:setRuleStyles | R:isConnected x2 | W:setRuleStyles`.
  Phase attribution: `layOutColumns` emits 1 `measureTexts` + 18 `measureText` and
  **no** rule write; the 35 `setRuleStyles` and the 2 `getScrollMetrics` all land
  *after* it. Totals: **827–873 sink writes, 33 `ensureStyleRule` + 36 `setRuleStyles`**
  for 12 rows; **1,497 writes / 105 rule ops** for 24 rows (probe `misc.test.ts`,
  `[scale]`).
- **Proposed change**: two independent moves, either of which removes a crossing.
  (a) Hoist the whole text-measurement batch ahead of the first rule write — the
  measurement uses the seam's off-screen probe and the measurement registry, not the
  rows' own elements, so `layOutColumns()` can run *before* `resumeLayout()` rather
  than after it. (b) Defer `LayerManager.mount` + the `Panel` scroll-metric read
  behind the rule writes it currently sits between, or serve the mount-time
  `getViewportSize` from the value `show()` already read at `Menu.ts:304`
  (two `getViewportSize` calls per open read the same value — see slice 03's
  finding that `getViewportSize` forces a document layout for a value `Math.max`
  discards).
- **Risk / blast radius**: `layOutColumns` reads `this.getBorderSize()` at
  `Menu.ts:271`, which needs no element; `setColumns` only stashes numbers and
  schedules. `tests/overlay/Menu.test.ts`'s whole "Menu content-based width" and
  "overlay scrollbar" blocks (≈30 cases) pin the resulting widths, so they are the
  regression net.
- **Proof at implement time**: re-run `menu-order.test.ts` and assert the timeline
  has at most one read→write transition; and `ms` for a right-click open on the
  Loom file tree in a real WebKitGTK Timeline recording.

---

### F12.4 A fixed-array `MenuBar` builds and measures every dropdown row at construction

- **Category**: E (work for content nobody can see), H
- **Impact**: MEDIUM — one-off, first-render / startup, but it is exactly the
  "delays first paint for content the user may never visit" case
  `docs/concepts/performance.md:143` calls out for `Tab`.
- **Where**: `overlay/Menu.ts:202-211` (constructor: fixed array → immediate
  `buildPersistentItems`), `Menu.ts:1017-1058` (`buildPersistentItems`, which ends
  with `layOutColumns()` → text measurement), `component/menubar/MenuBar.ts:180-206`
  (`setMenus` constructs one `Menu` per top-level entry, eagerly).
- **Hot path**:
  - app startup → `MenuBar({ menus })` → `setMenus`
  - → per entry `new Menu(menu.items, onClose)`
  - → `buildPersistentItems` → per item `new MenuItem(...)` (3–5 `Text`/`Glyph`
    children each) → `layOutColumns()` → `Text.getPreferredSize()` →
    `DOM.source.measureTexts` (one forced probe-layout batch per panel).
- **Evidence** (probe `menubar-construct.test.ts`): a 6-menu × 10-item bar builds
  **60 rows eagerly** and forces **126 `measureText` + 6 `measureTexts`** calls at
  construction. The same probe shows the provider form
  (`items: () => [...]`) builds **0 rows and calls the provider 0 times** at
  construction — the deferral mechanism already exists, it is just not the default.
- **Proposed change**: give the fixed-array path the same deferral the provider path
  has: store the array in the constructor and run `buildPersistentItems` on the first
  `open()` (the `_contentFitWidth` cache then fills on that first open and stays
  valid, exactly as the constructor comment at `Menu.ts:606-610` already reasons for
  the non-provider case). No public-API change.
- **Risk / blast radius**: anything reading `_menuItems` before a first open —
  `getFocusedIndex()` (returns `-1` either way), `activateFocused()` (bails on
  `_focusedIndex < 0`), `clearItemHighlights()` (iterates an empty array). The
  `MenuBar` tests at `tests/component/menubar/MenuBar.test.ts:96` already exercise the
  provider path; add the fixed-array mirror.
- **Note**: Loom already uses the provider form for all three of its menus
  (`/home/jika/typescript/loom/src/shell/EditorShell.ts:687-745`), so **Loom does not
  pay this today**. The docs example, the `MenuBar` page and every app following it do.
- **Proof at implement time**: `menubar-construct.test.ts` asserting
  `rows built eagerly === 0` and `measureText === 0` for a fixed-array 6×10 bar.

---

### F12.5 `ToolBar` runs three synchronous `doLayout()` calls from inside its own constructor, and `setOverflow` has no unchanged-value guard

- **Category**: D (avoidable layout pass), H
- **Impact**: MEDIUM — per `ToolBar` construction and per `setOverflow` call;
  violates `ARCHITECTURE.md`'s "Construction must stay JS-only" and the
  `scheduleLayout()`-not-`doLayout()` setter contract.
- **Where**: `component/menubar/ToolBar.ts:219-234` (`applyOptions` dispatches
  `setCompact` / `setOverflowSide` / `setOverflow` unconditionally),
  `ToolBar.ts:344` (`setCompact` → `this.doLayout()`), `ToolBar.ts:371-381`
  (`setOverflow`: writes `_overflowMode` and calls `doLayout()` with **no** guard),
  `ToolBar.ts:475` (`setOverflowSide` → `doLayout()`).
- **Hot path**: `new ToolBar()` → `super()` → `applyOptions` → three setters, each
  reaching `Container.doLayout()` on a component with no element and no parent.
- **Evidence** (probe `toolbar-ctor.test.ts`):
  `[ctor] doLayout calls during 'new ToolBar()' = 3`;
  `[ctor, all options] doLayout calls = 4`;
  `[setOverflow] doLayout calls for 2 no-op setOverflow("clip") = 2`.
  For contrast, `setCompact` (`ToolBar.ts:323-326`), `setOverflowSide`
  (`ToolBar.ts:467-470`) and `setFlat` (`ToolBar.ts:505-508`) all have the
  unchanged-value guard `setOverflow` lacks; `applyOptions`'s
  `?? this.getOverflow()` default-dispatch defeats those guards on the very first
  call because the backing `declare` fields are still `undefined`.
- **Proposed change**: add the missing `if (value === this._overflowMode) return this;`
  guard to `setOverflow`, and replace the three `this.doLayout()` calls with
  `this.scheduleLayout()` so construction stays JS-only and the three coalesce into
  one rAF pass. Seed the `declare` backing fields from `_defaultOptions` before
  `applyOptions` dispatches, so the guards actually bite on the first call.
- **Risk / blast radius**: `setCompact` mutates child insets and expects the parent
  to re-measure; `scheduleLayout` defers that by one frame, which the existing
  `tests/component/menubar/ToolBar.test.ts` compact cases (`:95-113`) assert
  synchronously only through `isCompact()`, not geometry. The `overflow: "menu"`
  reflow (F12.6) already converges over two frames, so a deferred first pass is
  consistent with it.
- **Proof at implement time**: the probe above, asserting 0 `doLayout` calls during
  construction and 0 for a repeated `setOverflow` with the same value.

---

### F12.6 `ToolBar`'s `overflow: "menu"` reflow re-derives the whole fit-set from scratch on every layout pass

- **Category**: D (layout work recomputed with unchanged inputs), G (per-pass allocation)
- **Impact**: MEDIUM when enabled — per frame on hot path 1, ×1 per overflow-mode
  bar. **Not charged in the target app**: Loom's only `ToolBar` is
  `{ orientation: 'vertical' }` with the default `overflow: "clip"`
  (`/home/jika/typescript/loom/src/shell/EditorShell.ts:259`), and
  `ToolBar.doLayout:587` returns early for both. No in-library `ToolBar` uses
  `"menu"` either (`CodeEditorSearchPanel.ts:203,239`,
  `MarkdownDocumentPanel.ts:221`, `CodeEditorPanel.ts:174` all default to clip);
  only `ToolBarPanel.ts:126` and `docs/src/demos/toolbar-basic.ts:31` enable it.
- **Where**: `component/menubar/ToolBar.ts:584-598` (`doLayout` override),
  `ToolBar.ts:611-642` (`_reflowOverflow`), `ToolBar.ts:659-703` (`_computeOverflowed`).
- **Hot path**:
  - resize frame → `ToolBar.doLayout()` → `super.doLayout()` (full HBox pass)
  - → `_reflowOverflow(trigger)` → `this.getComponents().filter(…)` — **a fresh array
    per pass**
  - → `_computeOverflowed(...)` — **a fresh `widthOf` closure and a fresh
    `overflowed` array per pass**; loop 1 calls `child.getPreferredSize()` for every
    child, loop 2 calls it again for every child
  - → per child `overflowed.includes(child)` — O(n²) over the child list
  - → on any change, a **second** full `super.doLayout()` (`ToolBar.ts:640`).
- **Evidence** (probe `toolbar-pass.test.ts`): 8 buttons, everything fits →
  **40 `getPreferredSize` + 40 `getMinSize` + 40 `getMaxSize` per unchanged pass**
  (5/5/5 per button), versus 4/5/5 per button for the same bar in clip mode — the
  overflow path adds one full `Button.computePreferredSize` recursion per child per
  pass even when `total <= inner` returns `[]` immediately. Overflowing (4 hidden):
  32/20/20. `Component.getPreferredSize` (`core/Component.ts:3376-3395`) has no memo,
  and `Button.computePreferredSize` recurses into the content row plus
  `getPerimeterSize()` — confirming slice 05's "size hints have no memo anywhere".
  The settled pass does **not** re-schedule (`bar.scheduleLayout calls on a settled
  pass = 0`), so there is no relayout loop; the cost is pure recomputation.
- **Proposed change**: gate the whole reflow on a change signature — the bar's inner
  width plus the child count plus the summed preferred widths — recomputed once per
  pass and compared against the last committed one, the same clamp-signature shape
  that fixed `ScrollStrip.layoutItems` on `feature/scroll-strip-deferred-resync`.
  Inside the reflow, hoist the two `widthOf` loops into one pass that caches each
  child's width in a reused array, and replace `overflowed.includes(child)` with the
  crossover index it already computes.
- **Risk / blast radius**: **zero behavioural tests exist for the overflow pipeline**
  — `tests/component/menubar/ToolBar.test.ts` covers orientation, compact, child
  registration and keydown only; `tests/component/dispose-full-teardown.test.ts:230`
  is the only place that constructs `{ overflow: 'menu' }`, and only to tear it down.
  Any change here needs new tests first.
- **Proof at implement time**: `toolbar-pass.test.ts` asserting
  `getPreferredSize === 0` for an unchanged pass once the signature gate is in.

---

### F12.7 `ToolBar` installs a lifetime subtree `keydown` listener, so every keystroke in the document pays an ancestor walk

- **Category**: G (listener cost), A (per-event seam traffic)
- **Impact**: MEDIUM — per keystroke on hot path 4. In Loom the rail `ToolBar` is on
  screen for the app's whole life, and the editor is ~15–20 levels deep.
- **Where**: `component/menubar/ToolBar.ts:191-209` (the handler is built and
  registered unconditionally in the constructor, never removed);
  dispatcher at `core/Event.ts:297-345`.
- **Hot path**:
  - any `keydown` anywhere in the document → `Event`'s single window capture handler
  - → exact-target phase (a map lookup — cheap)
  - → `subtreeListenerMap.get("keydown")` is non-empty **because this `ToolBar`
    registered**, so the ancestor walk runs unconditionally
  - → per ancestor: `DOM.source.getId(handle)` + `DOM.source.getParentElement(handle)`,
    each interning the node behind a `WeakRef` + `FinalizationRegistry`
  - → terminates only at `<html>`.
  Slice 03 measured this at 20 `getId` + 20 `getParentElement` seam calls on a
  20-deep chain with zero matches.
- **Evidence**: read of `Event.ts:294-345` — the walk is entered whenever *any*
  subtree listener exists for the type, regardless of whether the target is inside
  any of them. `ToolBar` is not the only registrant for `keydown`
  (`component/container/TabBar.ts` registers one too), so removing it alone does not
  eliminate the walk; it removes one of two, and the walk's cost is shared.
  `grep -rn "addSubtreeListener" packages/lib/src/typescript/lib` gives 34 sites
  across 18 files; `keydown` has exactly two (`ToolBar`, `TabBar`).
- **Proposed change**: register the `keydown` listener lazily — on the first
  `addComponent` that actually joins the roving group (`ToolBar.ts:553-555`) — and
  drop it again when the group empties. A bar with no focusable children (the
  `CodeEditorSearchPanel` rows are the in-library case) then costs nothing. The
  structural fix belongs in `Event`: index subtree listeners so the walk starts only
  when the target has a registered ancestor. → see Cross-slice notes.
- **Risk / blast radius**: `tests/component/menubar/ToolBar.test.ts:148-175` calls
  `_onKeyDown` directly, bypassing registration, so it stays green either way — which
  is itself the problem: nothing currently tests the registration.
- **Proof at implement time**: a probe counting `DOM.source.getParentElement` calls
  for one synthetic `keydown` dispatched at a 20-deep target, with and without a
  childless `ToolBar` mounted.

---

### F12.8 `SplitButton`'s chevron spin is an unguarded stylesheet-rule mutation, and one of the three writes per toggle is identical

- **Category**: C (rule write on an interaction path), B (unchanged-value write)
- **Impact**: MEDIUM — per dropdown open and per close. Each `setTransform` is a
  full-document restyle in the target engine.
- **Where**: `component/button/SplitButton.ts:266-268` (`_setChevronOpen` →
  `Component.setTransform`), `SplitButton.ts:250` (the optimistic spin-up),
  `SplitButton.ts:256` (the `onClose` spin-down); `core/Component.ts:3276-3282`
  (`setTransform` writes `setElementCSSRule("transform", value)` with **no**
  unchanged-value guard — unlike `setBackgroundColor` at `Component.ts:2656-2663`,
  which does have one).
- **Hot path**:
  - chevron click → `Event` subtree dispatch → `_onChevronClick` → `_toggleMenu()`
  - → `DOM.source.getViewportRect(this)` — a live rect read
  - → `_setChevronOpen(true)` → `setTransform("rotate(180deg)")` → `StyleRule` write
    → **full-document restyle**
  - → `menu.toggleFor(...)`; when this is the toggle-shut press, `hide()` →
    `onClose` → `_setChevronOpen(false)` → a second rule write.
- **Evidence** (probe `misc.test.ts`): one open + one toggle-shut produced
  `transform rule writes = ["rotate(180deg)","rotate(180deg)","rotate(0deg)"]` —
  **three rule mutations, the middle one writing the value already in the rule**,
  because the close path spins up optimistically before `toggleFor` discovers it is a
  close. This is the same shape slice 27 found for `Component.setTransform` on
  continuous gestures, on a discrete path.
- **Proposed change**: two independent fixes. (a) Give `Component.setTransform` the
  unchanged-value guard its `_transform` field already makes trivial — that removes
  the identical write here and everywhere else. (b) Move the chevron's rotation to a
  declared style state (a `.open` class toggle) so the spin is a class write, not a
  rule mutation; the CSS transition still runs. Either alone halves the cost; both
  make the toggle-shut free.
- **Risk / blast radius**: `setTransform` has many callers library-wide, so (a) is a
  slice-01/02-owned change; `tests/component/button/SplitButton.test.ts:71` asserts
  the chevron "spins back down" for an empty item list and would pin (b).
- **Proof at implement time**: the probe above, asserting exactly one `transform`
  rule write per open and one per close, none identical.

---

### F12.9 `setColumns` schedules a layout unconditionally on every row, every build

- **Category**: D (setter relayouts on a no-op)
- **Impact**: LOW–MEDIUM — N extra layout roots per menu build, and per re-open for a
  provider-sourced menu.
- **Where**: `component/container/MenuItem.ts:435-441`,
  `component/container/AbstractBooleanMenuRow.ts:165-169`; called from
  `overlay/Menu.ts:267-269` (`layOutColumns`, once per row per build).
- **Hot path**: `Menu.show()` / `Menu.open()` → `layOutColumns()` → per row
  `setColumns(checkZone, iconStart, titleColumn)` → `this.scheduleLayout()` with no
  comparison against the three fields it just wrote.
- **Evidence** (probe `menu-open.test.ts`):
  `[MenuItem.setColumns] scheduleLayout calls for 2 identical writes = 2`. For a
  12-row menu that is 12 scheduled roots per build. They are mostly pruned (the
  `Menu` root is scheduled too, at `Menu.ts:400`), but `buildPersistentItems`
  (`Menu.ts:1017-1058`) has no such root write until `setWidth`, so the ordering is
  not guaranteed.
- **Proposed change**: guard both `setColumns` implementations on all three values
  being unchanged, matching the shape every geometry setter in `Component` already
  uses. This matters most after F12.4: a re-opened provider menu whose columns did
  not change then costs nothing.
- **Risk / blast radius**: `tests/component/container/MenuRow.test.ts:226` and `:546`
  assert the *positioning* effect of `setColumns`, not the scheduling, so both stay
  green.
- **Proof at implement time**: the probe above, asserting 0 for two identical writes.

---

### F12.10 `MenuBar` paints a border through the raw CSS escape hatch, so `getBorderSize()` reports zero

- **Category**: H (function/implementation mismatch), correctness
- **Impact**: LOW — a permanent 1 px content-box error on a component that is always
  on screen; and an `ARCHITECTURE.md` "All attributes and styles go through typed
  setters" violation.
- **Where**: `component/menubar/MenuBar.ts:88-91`
  (`setElementCSSRule("borderBottom", "1px solid var(--ts-ui-menu-bar-border, …)")`),
  and `component/container/MenuSeparator.ts:53-56` (the same shape for `borderTop`).
  `core/Component.ts:3690-3700`: `getBorderSize()` short-circuits to
  `{0,0,0,0}` whenever `this._border` is unset, and only `setBorder` /
  `cacheBorderSpec` populate it.
- **Evidence** (probe `borders.test.ts`):
  `MenuBar.getBorderSize() = {top:0,right:0,bottom:0,left:0}; getBorder() = null`
  while the element paints a 1 px bottom rule.
  `MenuSeparator.getBorderSize() = {0,0,0,0}` likewise.
  Contrast, in the same slice: `ToolBar = {top:0,right:0,bottom:1,left:0}` (via
  `setBorder` at `ToolBar.ts:296`), `Menu(rebuild) = {1,1,1,1}` (via `setBorder` at
  `Menu.ts:929`), `Menu(persistent) = {1,1,1,1}` (via `cacheBorderSpec` at
  `Menu.ts:917`). The correct pattern is used three times in the slice's own files
  and missed twice.
  Consequence: `MenuBar.getInnerSize()` / `getContentBounds()` overstate the usable
  height by 1 px, so its `HBox` stretches every `MenuBarButton` one pixel past the
  content box and `overflow: hidden` clips the bottom row.
- **Proposed change**: `MenuBar` → `this.setBorder({ borderBottom: … })`.
  `MenuSeparator` → `cacheBorderSpec` (the rule is the row's whole visual, so a real
  `setBorder` write is also fine there, and its 9 px `HEIGHT` already budgets for it).
- **Risk / blast radius**: `MenuBar`'s buttons currently get 28 px of a 28 px box;
  after the fix they get 27, which is correct but visibly different by a pixel.
  `MENU_BAR_BUTTON_HEIGHT` (`MenuBarButton.ts:72`) and `MenuBar`'s `minSize`
  (`MenuBar.ts:28`) are explicitly documented as kept in lockstep — the bar's
  `minSize.height` should become `MENU_BAR_BUTTON_HEIGHT + 1`.
- **Proof at implement time**: the probe above, asserting a non-zero `bottom`.

---

### F12.11 `MenuBarButton.computePreferredSize` discards the height half of an un-memoised recursion

- **Category**: D, H
- **Impact**: LOW — 4–5 discarded height computations per bar button per layout pass;
  ~20–25 per frame for Loom's 5-child bar.
- **Where**: `component/menubar/MenuBarButton.ts:174-178`.
- **Hot path**: resize frame → `MenuBar`'s `HBox` → `child.getPreferredSize()`
  (4–5× per child per pass, per slice 05 and the F12.1 probe) →
  `Component.getPreferredSize` (no memo, `Component.ts:3376`) →
  `MenuBarButton.computePreferredSize` → `super.computePreferredSize()`
  (`Button.ts`, which recurses into the whole content row *and* calls
  `getPerimeterSize()` → `getBorderSize()` + `getInsets()` + `getPadding()`) →
  the returned `height` is destructured away and replaced by the constant
  `MENU_BAR_BUTTON_HEIGHT`.
- **Evidence**: read of the two methods; the F12.1 probe shows 4 `getPreferredSize`
  calls per button per settled pass and `Component.getPreferredSize` has no cache.
- **Proposed change**: the real fix is the library-wide size-report memo slices 01/05
  propose. Slice-local, `MenuBarButton` can pin its height via `setPreferredSize`'s
  height component at construction (the height is a constant, not derived), so
  `computePreferredSize` need not be overridden at all.
- **Risk / blast radius**: `tests/component/menubar/MenuBarButton.test.ts` pins the
  28 px height; `MENU_BAR_BUTTON_HEIGHT` is exported and read by `MenuBar.ts:28`.
- **Proof at implement time**: a probe counting `Button.computePreferredSize`
  invocations across one settled `MenuBar.doLayout()`.

---

### F12.12 `ToolBar._positionOverflowTrigger` issues two `moveComponent` calls per `addComponent`

- **Category**: G, D
- **Impact**: LOW — construction only, O(N) in child count, but each `moveComponent`
  detaches and re-attaches a DOM element and re-lays-out both ends.
- **Where**: `component/menubar/ToolBar.ts:421-446` (`_positionOverflowTrigger`),
  called from `ToolBar.ts:569` on **every** `addComponent`.
- **Hot path**: `bar.addComponent(child)` → `_positionOverflowTrigger()` →
  `this.moveComponent(trigger, len-1)` + `this.moveComponent(spacer, len-2)`, each of
  which (per `docs/concepts/component-lifecycle.md:129`) detaches and re-attaches the
  element and re-lays-out source and destination.
- **Evidence** (probe `misc.test.ts`):
  `[toolbar] moveComponent calls for 8 addComponent calls = 16`.
  A no-op when the trigger does not exist (clip mode), so Loom is unaffected.
- **Proposed change**: `insertComponent(child, index)` ahead of the trailing
  `[spacer, trigger]` pair instead of appending then re-sorting; or defer the
  re-pin to the next layout pass (a dirty flag consumed in `doLayout`).
- **Risk / blast radius**: nothing tests the trigger's position.
- **Proof at implement time**: the probe above, asserting 0 moves for 8 adds.

---

### F12.13 `ToolBar._onKeyDown` throws on a childless, focused bar

- **Category**: J (guard for a state that *is* reachable — the inverse), correctness
- **Impact**: LOW — a narrow but real crash.
- **Where**: `component/menubar/ToolBar.ts:198-206` dereferences
  `this._rovingTabIndex`, which is only created in `addComponent`
  (`ToolBar.ts:542-544`); the bar sets its own `tabIndex` to 0 at `ToolBar.ts:189`,
  so it is focusable with no children.
- **Evidence** (probe `toolbar-keys.test.ts`):
  `[toolbar keys] childless ArrowRight threw = "Cannot read properties of undefined
  (reading 'moveNext')"; bar tabIndex = 0`. `SpatialNavigation.claimsKey`
  (`core/SpatialNavigation.ts`) is modifier-gated, so a bare ArrowRight is never
  claimed and the guard at `ToolBar.ts:192` does not cover this.
- **Proposed change**: create the `RovingTabIndex` in the constructor (it is a plain
  object, no DOM), or guard the handler on `this._rovingTabIndex === undefined`.
  Folds naturally into F12.7's lazy registration.
- **Risk / blast radius**: none.

---

### F12.14 Unused option surface

- **Category**: J
- **Impact**: LOW — code health, and one live per-row cost (already reported as F12.2).

| Surface | Where | Grep | Count outside the declaration |
|---|---|---|---|
| `ToolBarOptions.overflowSide`, `setOverflowSide`, `getOverflowSide`, and the `"start"` branch of `_positionOverflowTrigger` | `ToolBar.ts:48-53, 428-445, 467-487` | `grep -rn "overflowSide" packages loom/src` | **0** (10 hits: 8 in `ToolBar.ts`, 2 in `dist/*.d.ts`). No demo, no doc demo, no test, no app. `overflow: "menu"` itself has 0 in-library consumers, so this is dead behind dead. |
| `MenuItemOptions` (`text`/`enabled`/`focused`) and `MenuItem`'s 5th `options` constructor parameter, plus the whole `MenuItem.applyOptions` body | `MenuItem.ts:29-33, 228, 362-379` | `grep -rn "new MenuItem(" packages loom/src` | **0 production callers pass it.** One test passes `{ border: … }` (a `ComponentOptions` field) at `tests/component/content-box-containment.test.ts:481`; none of the three `MenuItemOptions` fields is ever set. |
| `MenuRow.setMenuCloseHandler` / the protected `MenuRow.closeMenu()` | `MenuRow.ts:222-224, 246-248` | `grep -rn "setMenuCloseHandler\|closeMenu()"` | `Menu` *injects* the closure for every factory row (`Menu.ts:343`, `Menu.ts:1032`) — one allocation per factory row per build — but **no shipped `MenuRow` subclass ever calls `closeMenu()`**; its own JSDoc says so. |
| `Menu.setMenuWidth` | `Menu.ts:534-540` | `grep -rn "setMenuWidth"` | **0 production callers**; 3 hits, all in `tests/overlay/Menu.test.ts`. |
| `MenuItemConfig.icon` | `MenuItem.ts:93-100` | see F12.2 | **0**, yet it costs a `Text` per row (F12.2). |
| Theme tokens `--ts-ui-toolbar-padding`, `--ts-ui-toolbar-gap` | published by `core/Theme.ts:1187-1188`, documented in `docs/components/ToolBar.md`'s Theming table | `grep -rn "toolbar-gap\|toolbar-padding" packages` | **read by nothing.** `ToolBar.applyOrientation:277-279` deliberately defaults spacing to 0 ("the bar no longer drives a gap"); insets come from the hard-coded `0`/`4` in `setCompact`. Both tokens are advertised and inert. |

- **Proposed change**: delete `overflowSide` and its spacer branch (or wire it into
  the docs demo if it is meant to ship); delete `MenuItemOptions` and `MenuItem`'s
  5th parameter and `applyOptions` override; either use `closeMenu()` in a shipped
  row or drop the injection; either honour `--ts-ui-toolbar-gap`/`-padding` or remove
  them from `Theme.ts` and the doc page.

---

### F12.15 Both 2026-08-29 health-audit items for this slice are closed; one residue remains

- **Category**: I (duplication — resolved), H (residue)
- **Impact**: LOW — informational, plus one small inconsistency.
- **Audit Priority-2 #2, "`RadioMenuRow` is a ~105-line uncredited copy of
  `CheckboxMenuRow`": CLOSED.** `component/container/AbstractBooleanMenuRow.ts`
  (297 lines) now owns the disabled dimming, hover/click wiring,
  `getContentWidth`/`setColumns`/`doLayout`, and the `"action"` `ListenerBag`, via the
  abstract `getControl()` accessor the audit itself proposed
  (`AbstractBooleanMenuRow.ts:278`). `CheckboxMenuRow.ts` is 75 lines and
  `RadioMenuRow.ts` 79, each contributing only its control and its
  `applyActivation()`. The audit's dependent Priority-1 #12 (keyboard Enter dropping
  the `"action"` callback) is fixed too: `activate()` calls `applyActivation()` then
  `emit("action")` (`AbstractBooleanMenuRow.ts:132-139`), pinned by
  `tests/component/container/MenuRow.test.ts` cases A1–A6 and R1–R14 and by
  `tests/overlay/Menu.test.ts:734` ("A9. activateFocused notifies a factory-built
  CheckboxMenuRow's action listener"). The audit's dead-export note
  (`CheckboxMenuRowEvent`/`RadioMenuRowEvent`) is also resolved — the single
  `AbstractBooleanMenuRowEvent` is used in the `on`/`off`/`emit` signatures.
- **Audit Priority-2 #6, "`Menu.open()`'s horizontal placement hand-rolls the
  primitives": CLOSED.** `Menu.open()` now routes the top-level case through
  `positionAnchoredFlexible` (`Menu.ts:662-666`, which composes
  `positionFlexibleAnchored` vertically with `positionAligned` horizontally) and the
  submenu case through `positionAdjacent` (`Menu.ts:646`) plus `placeVertically` →
  `positionFlexibleAnchored` (`Menu.ts:985`). Both flip; neither clamps.
  `tests/overlay/Menu.test.ts:1438-1512` ("Menu open() — horizontal placement") pins
  all four cases.
- **Residue**: `open()` still wraps the primitives' output in `Math.max(0, …)`
  (`Menu.ts:649-650`, `Menu.ts:671-672`) where `showAnchored` applies the placement
  verbatim (`Menu.ts:396-397`). The primitives already guarantee a `>= margin`
  result for an in-viewport anchor, so the clamp is vestigial and leaves one class
  with two final-clamp policies depending on entry point — the smaller version of
  exactly what the audit flagged. Drop it, or apply it on both paths.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `overlay/Menu` | Floating menu panel in rebuild (context) or persistent (`MenuBar` dropdown) mode | Own `<div>` + `#id` rule + `.persistent` state rule; hosts one `Panel`; mounted to `documentElement` via `LayerManager`, detached when closed | **None while closed** (detached, no viewport listener). While open, `Fit` → the item `Panel`. Per *open*: 873 sink writes / 57 rule ops (12 rows), 19 text measurements, 2 `getScrollMetrics`, 2 `getViewportSize` | fits, but open-path is heavy | F12.3, F12.4, F12.9, F12.14, F12.15 |
| `container/MenuItem` | One row: check ǀ icon ǀ text ǀ shortcut ǀ chevron | Own element + rule; 2–5 child `Text`/`Glyph` | `doLayout` writes 4 guarded geometry setters per present label (no-ops when unchanged); calls `shortcutTextWidth()` → `Text.getPreferredSize()` per pass; `menuIconPx()` → `ThemeManager.getResolvedScale()` per pass when a glyph is present | over-built (the always-present hidden icon slot; the dead options bag) | F12.2, F12.9, F12.14 |
| `container/MenuRow` | Abstract row contract `Menu` drives | Own element | None (no `doLayout`) | fits | F12.14 (`closeMenu`) |
| `container/AbstractBooleanMenuRow` | Shared mechanics for control-hosting rows | Own element; hosts the subclass control | `doLayout` reads `control.getPreferredSize()` then writes 4 guarded setters | fits — this is the audit fix | F12.9 |
| `container/CheckboxMenuRow` | Row hosting a real `Checkbox` | Own element + the `Checkbox` | via the base | fits | — |
| `container/RadioMenuRow` | Row hosting a real `RadioButton` | Own element + the `RadioButton` | via the base | fits | — |
| `container/MenuSeparator` | 9 px rule between groups | Own element + rule (`borderTop` + `margin` written raw) | None | mismatch (raw border bypasses `getBorderSize`; `margin` on an absolutely positioned component) | F12.10, Redundant §3 |
| `menubar/MenuBar` | Persistent horizontal bar of top-level dropdowns | Own element + rule (`borderBottom` written raw); N `MenuBarButton` children; owns N detached `Menu` panels | **Zero** rule writes / geometry reads; 4 empty sink applies per child per pass; viewport `keydown` listener only while a menu is open | fits, with one border defect | F12.1, F12.4, F12.10 |
| `menubar/MenuBarButton` | Flat `Button` that opens a `MenuBar` dropdown | Inherits `Button`'s `<button>` + content row | `computePreferredSize` runs 4–5× per pass, discarding the height half | over-built (the override) | F12.1, F12.11 |
| `menubar/ToolBar` | Strip of related controls, with optional overflow menu | `Container` element + rule; optional lazily-built trigger `Button`, `Menu`, flex `Spacer` | Clip mode: nothing beyond `HBox`/`VBox`. Menu mode: a full fit-set remeasure, 3 arrays + 1 closure, 2 `getPreferredSize` per child | over-built (overflow machinery with no library consumer; constructor-time synchronous layout; dead `overflowSide`) | F12.1, F12.5, F12.6, F12.7, F12.12, F12.13, F12.14 |
| `menubar/ToolBarSeparator` | 1 px divider rule | Own element + rule | None | fits (doc says 9 px, code says 1 px) | Redundant §4 |
| `menubar/index` | Barrel | — | — | fits | — |
| `button/MenuButton` | `Button` that toggles a rebuild-mode `Menu` | Inherits `Button` | None | fits | — |
| `button/PopupButton` | `Button` that toggles a `PopupPanel` | Inherits `Button` | None | fits | — |
| `button/SplitButton` | `Button` with a trailing dropdown chevron | Inherits `Button`; adds a `Glyph` to the content row; registers a subtree `click` on that glyph | None per pass; 3 `transform` rule mutations per open+close | over-built (rule-based transform; cross-component listener) | F12.8, Cross-slice |
| `shared/buildClipboardMenuItems` | Builds Cut/Copy/Paste rows | None | None | fits — pure, allocation-only, 3 in-library callers | — |
| `shared/buildSelectionCopyMenuItems` | Builds a Copy row for a read-only surface | None | None; reads `getDocumentSelection` + `contains` ×2 + `getDocumentSelectionText` per **menu open**, not per frame | fits | — |

---

## Redundant, duplicated and dead code

Items not already covered in Findings.

1. **`MenuRow`'s preferred-size seed is written twice for every built-in row.**
   `MenuRow.ts:56` does `setPreferredSize({width: 0, height: MenuRow.HEIGHT})`;
   `MenuItem.ts:242` immediately repeats it with `MenuItem.HEIGHT`, which is
   *defined as* `MenuRow.HEIGHT` (`MenuItem.ts:166`). The second write is a
   same-value no-op. `MenuSeparator.ts:52` legitimately overrides it with 9.
   Grep: `grep -rn "setPreferredSize" packages/lib/src/typescript/lib/component/container/Menu*.ts` → 3 hits, 1 redundant.

2. **Listener wiring uses anonymous arrow-function fields where the framework
   already binds `this`.** `Event.ts:285,328,365` invoke listeners as
   `entry.listener.apply(component, [evnt])`, so a bare method reference works —
   `AbstractBooleanMenuRow.ts:267-269` proves it (`this.handleMouseOver` passed
   unbound). `MenuItem.ts:310-343` (3 fields), `MenuBarButton.ts:160-161` (2),
   `ToolBar.ts:191-207` (1), `SplitButton.ts:119`, `MenuButton.ts:56`,
   `PopupButton.ts:59-60` all allocate a closure per instance instead. Beyond the
   allocation (3 closures per menu row per build), `ARCHITECTURE.md`'s "Listeners
   must reference a named function" rule names exactly this shape as forbidden.
   Grep: `grep -rn "= () =>\|= (e" packages/lib/src/typescript/lib/component/menubar packages/lib/src/typescript/lib/component/container/MenuItem.ts` → 6 sites in this slice.

3. **`MenuSeparator` nudges itself with a CSS `margin` on an absolutely positioned
   component.** `MenuSeparator.ts:57` writes `margin: 4px 0` through
   `setElementCSSRule`. Every framework `Component` is `position: absolute` with its
   rectangle written by the parent (`ARCHITECTURE.md`, *Positioning is always
   absolute*), so this shifts the rendered box off the rectangle the `VBox` committed
   — and `ARCHITECTURE.md`'s *No cosmetic insets or padding* forbids the pattern
   outright. The 9 px `HEIGHT` already reserves the space; the margin makes the
   painted rule sit 4 px below where layout thinks it is.

4. **Doc drift** (4 items, all in `packages/lib/docs/components/`):
   - `ToolBarSeparator.md`: "Fixed pixel thickness: 9 px (see
     `ToolBarSeparator.THICKNESS`)" — the constant is **1**
     (`ToolBarSeparator.ts:47`).
   - `ToolBar.md`: "`compact` … the bar's own panel insets shrink to `(2, 2, 2, 2)`"
     and "between `(4, 4, 4, 4)` and `(2, 2, 2, 2)`" — the code uses **0**
     (`ToolBar.ts:334`), which the class JSDoc (`ToolBar.ts:104`) states correctly.
   - `ToolBar.md` Theming table: lists 5 custom properties "ToolBar reads"; two of
     them are read by nothing (F12.14).
   - `MenuSeparator.md`: "Width is computed by `Menu.doLayout()`" — `Menu` has no
     `doLayout` override; the width comes from the item `Panel`'s stretching `VBox`.
   Also a stale in-code comment: `ToolBar.ts:403` says the spacer "is only parented
   while the side is `"right"`" — the value is `"end"`.

5. **`Menu.getMenuWidth()` is `getWidth()` under another name**
   (`Menu.ts:524-526`), used only by tests (7 hits, all in
   `tests/overlay/Menu.test.ts`). Harmless, but it is public API surface with a
   rebuild-mode-only doc comment and no mode assertion.

---

## Cross-slice notes

- **→ 01 core-component-lifecycle / 03 core-dom-seam-events**: the empty
  `InlineStyle.flushDirty` patch is the *only* per-frame sink traffic this slice
  produces (F12.1). A `MenuBar` is one of the few components guaranteed on screen on
  every frame, so its child count multiplies that defect directly — 20 empty applies
  for Loom's 5-child bar, 8 more for its 2-child rail.
- **→ 02 core-component-styling**: `Component.setTransform` (`Component.ts:3276-3282`)
  is one of the unguarded setters. `SplitButton` writes an identical value through it
  on every dropdown close (F12.8). Add it to the guarded list.
- **→ 03 core-dom-seam-events**: `Event`'s subtree walk is entered for *every* event
  of a type any component subtree-listens to, regardless of whether the target is
  inside one (`Event.ts:294-345`). `ToolBar` is one of two `keydown` registrants
  library-wide (F12.7); `SplitButton` adds a document-wide `click` walk
  (`SplitButton.ts:156`). The structural fix — indexing subtree listeners so the walk
  only starts for a target that actually has a registered ancestor — belongs there,
  not in the individual components.
- **→ 03 core-dom-seam-events**: `Menu.show()` reads `DOM.source.getViewportSize()`
  twice per open (`Menu.ts:304` and `Menu.ts:385`) for a value that cannot change in
  between; `Menu.open()` reads it once (`Menu.ts:630`). Two of the 30 call sites
  slice 03 counted.
- **→ 04 core-panel-scrolling**: every `Menu` contains a `Panel`
  (`Menu.ts:193-198`, `autoScroll: "y"`), so it inherits the settled-panel
  remeasure. The probe shows 2 `getScrollMetrics` per open, landing right after 35
  rule writes (F12.3).
- **→ 05 layout-base-box-flow-grid**: `MenuBar`'s `HBox` and `ToolBar`'s `HBox`/`VBox`
  query each child's `getPreferredSize` 4–5× and `getMinSize`/`getMaxSize` 5× per
  settled pass with no memo, confirming slice 05's finding on a second tree shape.
  Numbers in F12.1 and F12.6.
- **→ 11 overlay-popups-layers-animation**: `core/OverlayPosition.ts` is this slice's
  main dependency and is clean — `positionAdjacent` / `positionAligned` /
  `positionFlexibleAnchored` / `positionAnchoredFlexible` are pure, take the viewport
  as a parameter, and allocate one small object each. The audit's unused-export note
  for `AnchorAxis` / `AnchorOptions` / `FlexiblePlacement` (`OverlayPosition.ts:12,20,140`)
  is that slice's to close; note that `AnchorOptions` and `FlexiblePlacement` are *not*
  exported today (only the interfaces' consumers are), so only `positionAnchored`
  itself may now be unused — this slice does not call it.
- **→ 13 button-glyph-image**: every `Button` — and so every `MenuBarButton` and every
  toolbar child — keeps subtree `pointerdown` / `pointerover` / `pointerout`
  listeners for the app's life (`Button.ts:851-853`). The handlers themselves
  early-return unless a press is in flight (`Button.ts:606-648`), so the per-mousemove
  cost over the menu bar and the tool bar is entirely `Event`'s ancestor walk, not
  `Button`'s own work. Hover appearance is pure CSS (`:hover` via `ownStyleStates`),
  so **hovering the menu bar or tool bar writes nothing**.
- **→ 28 focus-navigation-forms-primitives**: both `MenuBar`
  (`MenuBar.ts:31`) and `ToolBar` (`ToolBar.ts:95`) declare
  `navigationTarget: true`, so both are in `SpatialNavigation`'s candidate set and
  charged by its ~1,500-computed-style arrow-key sweep.
- **Seam contract that does not hold for this slice**: `getBorderSize()` silently
  returns zero for a component whose border was written through
  `setElementCSSRule` rather than `setBorder` / `cacheBorderSpec`
  (`Component.ts:3690-3693`). Two components in this slice hit it (F12.10). A cheap
  library-wide guard would be for `setElementCSSRule` to reject the `border*` keys
  the way the `local/no-raw-dom` rule rejects raw DOM.

---

## Suggested plan grouping

**Plan A — "menu row diet" (biggest slice-local payoff, self-contained).**
F12.2 (drop the always-built invisible icon `Text`) + F12.9 (guard `setColumns`) +
Redundant §1 (the duplicated preferred-size seed) + the `MenuItemConfig.icon` and
`MenuItemOptions` deletions from F12.14. One coherent change set inside
`MenuItem.ts` / `MenuRow.ts`, measurable on its own as element creations and rule
ops per menu open. No dependency on other slices.

**Plan B — "menu open is one write phase".**
F12.3 (hoist the text-measurement batch ahead of the first rule write; stop reading
the viewport twice) + F12.4 (defer a fixed-array persistent menu's build to first
open) + the F12.15 residue (`Math.max(0, …)` asymmetry). Depends on Plan A only in
that A reduces the per-row constant B is measuring; run A first so B's numbers are
clean. The scroll-metric half of F12.3 depends on slice 04's settled-panel remeasure
work.

**Plan C — "ToolBar setter and lifecycle hygiene".**
F12.5 (no synchronous layout from the constructor; guard `setOverflow`) +
F12.12 (stop the `moveComponent` churn) + F12.13 (the childless-bar crash) +
F12.7's lazy listener registration + the `overflowSide` deletion from F12.14. All
inside `ToolBar.ts`; independent of A and B. **Write the missing overflow tests
first** — the pipeline currently has none.

**Plan D — "ToolBar overflow reflow gate".**
F12.6 alone, behind Plan C (which supplies the tests and the constructor cleanup).
Worth planning separately because it is the only finding here with a per-frame
profile, and because the right answer may be to *remove* the feature rather than
optimise it: it has zero consumers in the library, zero in the target app, and zero
tests. Decide that before optimising.

**Rides along with a neighbour:**
- F12.8 (chevron transform) → fold the `setTransform` guard into slice 02's
  "guards are inconsistent across `Component`'s typed setters" plan; the `.open`
  class-state variant can ride with slice 13's `Button` work.
- F12.1 → nothing to do in this slice; it is slice 01/03's `flushDirty` guard.
- F12.10 + Redundant §3 (`MenuBar` / `MenuSeparator` raw border and margin writes)
  → one small "typed-setter conformance" change, best grouped with whatever plan
  touches `Component.setElementCSSRule`'s call-site discipline.
- F12.11 → subsumed by slices 01/05's size-report memo; the `MenuBarButton`-local
  fix is two lines and can ride with Plan A.
- Redundant §2 (arrow-function listener fields) and §4 (doc drift) → too small to
  plan; attach §2 to whichever plan touches each file, and §4 to the next docs pass.
