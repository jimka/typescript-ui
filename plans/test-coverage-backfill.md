# Test Coverage Backfill — Implementation Plan

## Overview

Several large, complex source areas ship with no dedicated automated coverage. This plan adds focused, contract-driven test suites for the ones that are **not** being changed by any sibling refactor plan, so the tests act as a standing safety net rather than being folded into a fix. Every suite asserts the **intended contract** (signatures, JSDoc semantics, caller usage) — never whatever the code happens to emit today.

The framework runs tests offline under the `node` environment against a **modelled DOM seam** ([tests/setup/node-setup.ts](tests/setup/node-setup.ts) installs the baseline; [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) supplies viewport + font metrics). Pure logic and geometry that flows through `doLayout` are exercisable offline; live UI events (real `keydown`/`click` dispatch through the window capture handler), drag, focus side-effects, CSS transitions/animations, and rendered visual output are the **manual-verify boundary**. Each suite below marks which behaviours fall on each side.

Targets are ranked by **value × ease**. The store sub-APIs and `RovingTabIndex` are pure logic with the highest ROI; the geometry/animation-dominated targets (`Rail`, the calendar dropdowns) are largely manual-verify and are explicitly deferred in [`## Non-Goals`](#non-goals), with only their small pure-logic islands optionally covered.

Files cited (verified at write time): [data/AbstractStore.ts](src/typescript/lib/data/AbstractStore.ts) (pagination `:474`–`:591`, `hasPendingChanges` `:1007`, `numericValues` `:1562`, aggregation `:1590`–`:1675`, grouping `:1691`–`:1752`), [core/RovingTabIndex.ts](src/typescript/lib/core/RovingTabIndex.ts), [core/Aria.ts](src/typescript/lib/core/Aria.ts), [layout/Accordion.ts](src/typescript/lib/layout/Accordion.ts) (`getPreferredSize` `:919`, `getMinSize` `:983`, `openSection` `:740`, `computeShrinkRatio` `:1323`, `computeFill` `:1409`, `doLayout` `:1162`), [component/input/ComboBox.ts](src/typescript/lib/component/input/ComboBox.ts) (`setStore` `:1123`, `setValue` `:1014`, `getValue` `:1029`, `handleKey` forwarding via `_dropdown` `:194`), [component/container/TabBar.ts](src/typescript/lib/component/container/TabBar.ts), [overlay/Rail.ts](src/typescript/lib/overlay/Rail.ts).

---

## Architecture Decisions

### Contract-first, not snapshot — no golden output

Each `it` encodes a behaviour derived from the method signature and its JSDoc, phrased so it would still be correct if the implementation were rewritten. No test asserts a pixel value merely because the current code produces it; where a geometry number appears it is *derived* from the inputs (header height × count + spacing, shrink-ratio formula, etc.) so the assertion pins the **rule**, not the sample.

### Reuse the established harness verbatim

New suites copy the exact bootstrap the neighbouring passing suites use: `installTestDOM(CONFIG)` + `afterEach(() => DOM.reset())` with the shared `CONFIG`/`fontMetrics` block ([tests/component/layout/VBox.test.ts](tests/component/layout/VBox.test.ts) is the layout template; [tests/unit/data/MemoryStore.test.ts](tests/unit/data/MemoryStore.test.ts) the store template; [tests/component/input/TimePickerDropdown.test.ts](tests/component/input/TimePickerDropdown.test.ts) the dropdown template). Pure-logic store/`RovingTabIndex`/`Aria` suites need no viewport beyond the node-setup baseline. Private/protected internals are reached with the documented `any`-cast escape (as `TimePickerDropdown.test.ts` already does) — only where a public accessor genuinely doesn't exist.

### Offline geometry is layout output, not rendered pixels

A layout manager's contract is the **numbers it assigns** (`child.getX()/getY()/getWidth()/getHeight()`) and the **sizes it reports** (`getPreferredSize`/`getMinSize`), both readable offline after `host.doLayout()`. That is what the Accordion suite asserts. What it does **not** touch: the CSS height *transition*, `Animation.afterTransition` completion, hover-driven tool reveal, and real focus movement — those are manual-verify.

### Overlap with sibling refactor plans → characterize current stable contract

`ComboBox`, the calendar dropdowns, and the Accordion manager sit adjacent to in-flight plans (input-field-fixes-and-scaffolding-consolidation, core-component-lifecycle-and-size-fixes). These suites deliberately assert only the **stable public contract** (store binding, pending-value survival, selection round-trips, shrink/fill math from the documented formulae) — the parts a refactor is expected to preserve — not internal wiring a refactor may legitimately rework. Where a behaviour could plausibly change under a sibling plan, it is called out inline so the implementer can down-grade it to a characterization note rather than a hard regression gate. No suite here touches `table/Body.ts`/`tree/Tree.ts` virtual scroll, the store `removeAll`/`load`/`insert`/dirty correctness paths, Component size-negotiation internals, or the boolean/picker input refactor surface — those carry their own tests in their owning plans.

---

## Ordered Implementation Steps

Ordered by ROI; each step is an independent test file and can land alone.

1. **`tests/unit/data/AbstractStore.aggregation.test.ts`** — `sum`/`average`/`min`/`max`/`collect` over a `MemoryStore`. Cover empty view, all-null field, mixed numeric/non-numeric, negatives, and post-filter view. → verify: `npx vitest run tests/unit/data/AbstractStore.aggregation.test.ts`.
2. **`tests/unit/data/AbstractStore.grouping.test.ts`** — `setGroupField`/`getGroupField`/`getGroupString`/`getGroups` including the `groupchange`-only (no `datachanged`) contract and the null-value `''` bucket. → verify: run the file.
3. **`tests/unit/data/AbstractStore.pagination.test.ts`** — `getTotalPages`/`nextPage`/`prevPage`/`goToPage` navigation, clamping, and the `hasPendingChanges` → `pagechangeblocked` guard. Uses a `RecordingProxy` (copy from [tests/unit/data/Store.test.ts](tests/unit/data/Store.test.ts)) so `void this.load()` resolves. → verify: run the file.
4. **`tests/core/RovingTabIndex.test.ts`** — `add`/`remove`/`moveTo`/`moveNext`/`movePrev` tabindex bookkeeping and active-index math, asserted via each item's `getAria().getTabIndex()`. → verify: run the file.
5. **`tests/core/Aria.test.ts`** — typed setter/getter round-trips, null-clears, boolean/`mixed` serialisation, `valueMin`/`valueMax` null-delete, and `applyToElement` flush. → verify: run the file.
6. **`tests/component/layout/Accordion.manager.test.ts`** — `getPreferredSize`/`getMinSize`, `openSection`/`closeSection`/`expandAll`/`collapseAll` + `singleOpen` coordination, `sectiontoggle` emissions, shrink-ratio and fill-weight geometry via `doLayout`, X-only overflow. → verify: run the file.
7. **`tests/component/input/ComboBox.test.ts`** — items/value/selection round-trips, pending-value survival across `setItems`/`setStore`, store binding + `getSelectedRecord`, and `handleKey` reducer forwarding to the inner list. → verify: run the file.
8. **`tests/component/container/TabBar.edgecases.test.ts`** — width-mode/side/orientation/align/scrollable/compact/reorderable setter contracts, `setActiveVisual` vs `setActiveEntry`, `setEntryContentId`/`getEntryButtonId`, and unknown-id defaults not already covered by [TabBar.test.ts](tests/component/container/TabBar.test.ts). → verify: run the file.
9. **`tests/overlay/Rail.test.ts`** *(small)* — pre-mount state contract only: `setEdge`/`setThickness`/`setOrientation`/`isCollapsed`/`setCollapsed`/`toggleCollapsed` round-trips and the "no-op when already in state" guards. Genie/edge geometry deferred (see Non-Goals). → verify: run the file.

Final checkpoint: `npx vitest run` (whole suite green) and `npx tsc -p tsconfig.test.json --noEmit` (test files typecheck).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `tests/unit/data/AbstractStore.aggregation.test.ts` |
| Create | `tests/unit/data/AbstractStore.grouping.test.ts` |
| Create | `tests/unit/data/AbstractStore.pagination.test.ts` |
| Create | `tests/core/RovingTabIndex.test.ts` |
| Create | `tests/core/Aria.test.ts` |
| Create | `tests/component/layout/Accordion.manager.test.ts` |
| Create | `tests/component/input/ComboBox.test.ts` |
| Create | `tests/component/container/TabBar.edgecases.test.ts` |
| Create | `tests/overlay/Rail.test.ts` |

No source files are modified. If a source bug surfaces while writing a contract test (the test encodes intended behaviour and fails), **leave the test red with a `// contract: …` note and flag it in the report** — do not patch source in this plan (source fixes belong to the owning plan or a new bug ticket).

---

## Expected Behaviour

These enumerations **are** the test cases. Unless marked *(manual-verify)*, each is unit-testable offline.

### 1. Store aggregation (`AbstractStore.aggregation.test.ts`)

Setup: `MemoryStore` over a model with a numeric `score` field; `loadData` a sample; some rows with `null`/non-numeric score for edge cases.

- `sum('score')` returns the total of numeric values.
- `sum` over an empty view returns `0`.
- `sum` over an all-null field returns `0` (nulls skipped, never coerced to `0`).
- `average('score')` returns mean of numeric values.
- `average` over empty/all-null view returns `0` (not `NaN`).
- `average` skips null rows — the divisor is the count of numeric values, not the row count.
- `min('score')` / `max('score')` return the extreme numeric values.
- `min`/`max` over empty/all-null view return `undefined`.
- `min`/`max` handle negative values correctly.
- Non-numeric string values that don't coerce to a finite number are skipped by `sum`/`average`/`min`/`max` (per `numericValues`); a numeric string (`"5"`) **is** counted (coerced via `Number`).
- All aggregates operate over the **filtered** view: after `filter(...)` narrows the view, the aggregate reflects only visible rows.
- `collect('field')` returns distinct values in first-encounter (view) order; duplicates removed by strict `===`; distinct object references stay distinct; empty view → `[]`.

### 2. Store grouping (`AbstractStore.grouping.test.ts`)

- `getGroupField()` defaults to `null`; `setGroupField('cat')` then `getGroupField()` returns `'cat'`.
- `setGroupField` fires `groupchange` with `{ groupField }` **only on a real change** (setting the same field again does not re-emit).
- `setGroupField` does **not** fire `datachanged` and does **not** rebuild the view (grouping is a pure read) — assert a `datachanged` spy is not called.
- `setGroupField(null)` disables grouping and emits `groupchange` with `null`.
- `getGroupString(record)` returns `String(record.get(groupField))`; returns `''` when no group field is set; returns `''` when the record's group value is `null`/`undefined`.
- `getGroups()` with no group field puts every record under the single `''` key.
- `getGroups()` buckets by group key; groups appear in first-encounter order; records within a group keep view order.
- `getGroups()` operates over the filtered view (filtered-out records absent from all buckets).

### 3. Store pagination (`AbstractStore.pagination.test.ts`)

Setup: `MemoryStore`/`Store` with a `RecordingProxy` (resolves `[]`) and `pageSize`. To drive `_totalCount`, either construct with a proxy whose read resolves a total or set it through the documented load path; where `_totalCount` cannot be set through a public API, assert the `undefined`-total branch and mark the known-total branch *(needs total wired via a paginated load)*.

- `getPage()` defaults to `1` even when pagination is disabled.
- `getTotalPages()` returns `undefined` when `pageSize` or `totalCount` is missing.
- `getTotalPages()` = `max(1, ceil(totalCount / pageSize))` when both known.
- `nextPage()` is a no-op when `pageSize` is unset (page unchanged, no `pagechanged`).
- `nextPage()` on the last page (page ≥ totalPages) is a no-op.
- `nextPage()` from a valid page increments `_page`, emits `pagechanged` with `{ page, pageSize }`, and triggers a reload (proxy `read` called).
- `prevPage()` is a no-op on page 1; otherwise decrements and emits `pagechanged`.
- `goToPage(n)` clamps to `[1, totalPages]` when total known; clamps low to `1`; a no-op (`target === page`) neither emits nor reloads.
- `goToPage` is a no-op when `pageSize` unset.
- **Dirty guard:** when `hasPendingChanges()` is true (a dirty or new record, or a queued removal), `nextPage`/`prevPage`/`goToPage` emit `pagechangeblocked` with `{ from, to }`, do **not** change `_page`, and do **not** reload.
- After discarding pending changes the guard releases and navigation proceeds.

### 4. `RovingTabIndex` (`RovingTabIndex.test.ts`)

Setup: plain `Component` instances added to a group; read state via `component.getAria().getTabIndex()`. `focus()` is a live DOM side-effect — assert the **tabindex bookkeeping and active-index**, not that focus actually moved *(the focus() call itself is manual-verify)*.

- First `add` gives the item `tabindex=0`; every subsequent `add` gives `tabindex=-1`.
- `getActiveIndex()` starts at `0`; `getItems()` returns items in add order.
- `moveTo(i)` sets the previous active item to `-1` and the new item to `0`, and updates `getActiveIndex()`.
- `moveTo` clamps out-of-range indices into `[0, length-1]`.
- `moveTo(current)` (same index) leaves tabindices consistent (still exactly one `0`).
- `moveNext()` advances and **wraps** from last back to first; `movePrev()` retreats and wraps from first to last.
- `moveNext`/`movePrev`/`moveTo` on an empty group are no-ops (no throw).
- `remove` of a non-active item before the active index decrements `_activeIndex` so the same item stays active.
- `remove` of a non-active item after the active index leaves `_activeIndex` unchanged.
- `remove` of the active item moves active to `max(0, idx-1)`.
- `remove` of the last remaining item resets `_activeIndex` to `0`.
- `remove` of an item not in the group is a no-op.
- Invariant across every operation: exactly one managed item has `tabindex=0` (when the group is non-empty).

### 5. `Aria` (`Aria.test.ts`)

Setup: `new Aria(new Component())` (or `component.getAria()`). Assert getter round-trips against the cached state; add one `applyToElement` flush check.

- `setRole`/`getRole` round-trip; `getRole` defaults `null`.
- `setTabIndex(0|-1)` round-trips via `getTabIndex`; `setTabIndex(null)` clears (getter → `null`, attribute removed).
- Boolean attributes (`setSelected`/`setHidden`/`setMultiselectable`/`setExpanded`/`setDisabled`/`setPressed`/`setReadOnly`) round-trip and default `null`.
- `setChecked(true|false)` → boolean; `setChecked('mixed')` → `'mixed'` string preserved by `getChecked`.
- `setValueMin(n)`/`setValueMax(n)` round-trip; `setValueMin(null)`/`setValueMax(null)` delete the attribute (getter → `null`).
- Numeric attributes (`setRowIndex`/`setColIndex`/`setLevel`/`setSetSize`/`setPosInSet`/`setValueNow`) round-trip and are stored as their number.
- Enum attributes reject nothing at runtime but round-trip the given value (`setSort('ascending')`, `setLive('polite')`, `setOrientation('vertical')`, `setHasPopup('menu')`, `setAutoComplete('list')`).
- `setLabel`/`getLabel` round-trip; `clearLabel()` returns getter to `null`.
- `applyToElement(handle)` flushes all cached attributes onto the element — construct a `Component`, set a few aria attributes, materialise the element, and assert the attributes are present via the DOM source read (`role`, `tabindex`, and one `aria-*`). *(This is the one seam-touching case; the rest are pure cache round-trips.)*

### 6. Accordion layout manager (`Accordion.manager.test.ts`)

Setup: mirror the VBox template — a `Container` hosting a `new Accordion()`, `getElement(true)`, `setWidth`/`setHeight`, `clearInsets()`. Children added with `AccordionConstraints(label, initiallyOpen, glyph?, fillWeight via a set field)`. Give children explicit `setPreferredSize`/`setMinSize` so shrink/fill math is deterministic. Read results via `child.getY()/getHeight()` and the section wrappers, plus `getPreferredSize()`/`getMinSize()` directly on the manager.

**Sizing reports (offline):**
- `getPreferredSize()` = perimeter + Σ(displayed header heights) + inter-section spacing between displayed sections + Σ(open sections' preferred heights); width = max open-section preferred width + horizontal perimeter.
- `getPreferredSize()` reads `initiallyOpen` from the child constraint **before** the first `doLayout` (open-state populated lazily), and the live `_openState` after.
- A **non-displayed** section contributes neither header nor content to `getPreferredSize`/`getMinSize`.
- `getMinSize()` mirrors preferred but uses each open section's `getMinSize().height` (headers always counted; open content floored at its own min, not `0`).
- A closed section contributes only its header height to both reports.

**Open/close coordination (offline state + events):**
- `openSection(i)` sets `isSectionOpen(i)` true and emits `sectiontoggle(i, true)`.
- `closeSection(i)` sets it false and emits `sectiontoggle(i, false)`.
- In `singleOpen` mode, `openSection(i)` closes every other open section, emitting `sectiontoggle(j, false)` for each and `sectiontoggle(i, true)` for the target.
- `expandAll()` in multi-open opens all; in `singleOpen` opens only section `0`.
- `collapseAll()` closes all sections (each emits `sectiontoggle(_, false)`).
- `openSection`/`closeSection` with an out-of-range index is a no-op (no emit, no throw).
- `isSectionOpen(outOfRange)` returns `false`.

**Shrink-ratio geometry (offline, via `doLayout` + child heights):**
- When open sections' preferred heights **fit** the container (`preferred ≤ budget`), ratio is `0` — every open section renders at preferred height.
- When they overflow but fit at combined min (`min ≤ budget < preferred`), each open section shrinks proportionally toward its min by `(preferred − budget)/(preferred − min)`; assert a laid-out open child's height equals `pref − ratio·(pref − min)`.
- When they overflow even at combined min (`budget < min`), ratio is `0` — sections fall back to preferred and the host clips (no shrink past min).

**Fill-weight distribution (offline):**
- With leftover height (open sections underflow) and one section carrying `fillWeight > 0`, that section absorbs the entire leftover regardless of position.
- Equal `fillWeight` on two open sections splits the leftover in proportion (equal → halves).
- With no weighted section but `setFillHeight(true)`, the whole leftover goes to the **bottommost** open section.
- On overflow (leftover ≤ 0) the fill map is empty — shrink and fill never both apply.

**X-only overflow (offline):**
- When the host marks X as overflowing, `doLayout` inflates the working width to the total min width so sections lay out wider than the container (horizontal scroll); vertical overflow is never honoured this way (height animates instead). *(The actual scrollbar/transition is manual-verify; the assigned child width is offline.)*

**Manual-verify (documented, not automated):** the height CSS transition, `Animation.afterTransition` reflow-on-shrink-complete, hover-driven header tool reveal, real header keyboard focus movement (`onHeaderKeyDown` calls `.focus()`), chevron rendering.

### 7. `ComboBox` (`ComboBox.test.ts`)

Setup: `new ComboBox({...})` under `installTestDOM`; drive through the public surface. The inner list/dropdown are delegated to — assert ComboBox's own contract, not the list's internals.

- `setItems([...])` then `getItems()` returns the items (defensive copy); `getSelectedIndex()`/`getValue()` reflect auto-selection of the first item when nothing was selected.
- String specs are auto-keyed by position; `{ key, label }` specs keep the explicit key — `getValue()` returns that key.
- `addItem` appends and preserves existing selection where applicable.
- `setSelectedIndex(i)` updates `getSelectedIndex()`/`getValue()`/`getSelectedRecord`; with `fireEvent=true` (default) a `change` fires on the ComboBox, with `false` it does not.
- **Pending value:** `setValue('k')` before any items land is cached; `getValue()` returns the pending value until a real selection resolves; after `setItems` containing key `'k'`, the selection resolves to that item and `getValue()` returns `'k'` from the live list.
- `setValue` for a key not present leaves the pending value in place (list clears its selection but `getValue` surfaces the pending value) until a matching item arrives.
- **Store binding:** `setStore(store, displayField)` populates options from the store; `getStore()` returns it; `getSelectedRecord()` returns the `ModelRecord` for the selection (or `undefined` when unbound/nothing selected).
- Rebinding via `setStore` detaches the previous store's listeners (a `datachanged` on the old store no longer refreshes) and attaches to the new one — assert by mutating each store and checking option refresh.
- A store `load`/`add`/`remove`/`datachanged` after binding refreshes the options and re-applies the pending value.
- `valueField`/`glyphField` forwarding: options carry the value-field key and glyph.
- **Keyboard reducer forwarding:** calling `dropdown.handleKey(evt)` (the method `ComboBox.onKeyDown` forwards to) mutates the inner list's selection — construct a `KeyboardEvent`-shaped object and assert the list selection advances. *(The DOM `keydown` → `onKeyDown` → `handleKey` route through the window capture handler is manual-verify; the reducer forwarding at the `handleKey` boundary is offline.)*

**Manual-verify:** dropdown open/close animation and `openDropdown` positioning, caret/label `doLayout` geometry and `getBaseline`, dropdown width math (`setDropdownMinWidth`/`showAt` sizing) — geometry that only reads true under a real anchor + layer mount.

*Overlap note:* if input-field-fixes-and-scaffolding-consolidation reworks ComboBox internals, keep the store-binding/pending-value/selection cases as characterization and drop any that assert reworked wiring.

### 8. `TabBar` edge cases (`TabBar.edgecases.test.ts`)

Setup: reuse [TabBar.test.ts](tests/component/container/TabBar.test.ts)'s `threeEntryBar`/`installTestDOM` helpers. Cover only what the existing 10 cases don't.

- Width-mode contract: `setWidthMode(mode)`/`getWidthMode`, `setFixedWidth(px)`/`getFixedWidth`, `setMaxWidth(px|null)`/`getMaxWidth` round-trip and default sensibly.
- Layout-flag setters round-trip: `setSide`/`getSide`, `setOrientation`/`getOrientation`, `setAlign`/`getAlign`, `setTextAlign`/`getTextAlign`, `setScrollable`/`isScrollable`, `setCompact`/`isCompact`, `setReorderable`/`isReorderable`, `setUnderBorderFullWidth`/`isUnderBorderFullWidth`.
- `setActiveVisual(id)` vs `setActiveEntry(id)`: `setActiveVisual` moves the visual/selection state without changing `getActiveEntryId()`'s committed active entry (assert the documented distinction) — *if the two prove indistinguishable through the public surface, mark this a characterization note.*
- `setEntryContentId(id, contentId)` then the entry reports the content id; `getEntryButtonId(id)` returns the per-entry button id.
- `isEntryCloseable(id)`/`getEntryName(id)` documented defaults for an **unknown** id (already partially covered — extend only the closeable/content-id combinations not present).
- `addTool`/`removeTool` and `setLeadingWidget(w)`/`getLeadingWidget()`/`setLeadingWidget(null)` round-trip.

**Manual-verify:** overflow arrow paging, `ScrollStrip` scroll-to-entry geometry, drag-reorder gesture and the reorder indicator, tear-off/dock gestures — all require real pointer events and measured overflow.

### 9. `Rail` state contract (`Rail.test.ts`, small)

- `setEdge`/`getEdge`, `setThickness`/`getThickness`, `setOrientation`/`getOrientation` round-trip from constructor options and via setter.
- `isCollapsed()` defaults `false`; `setCollapsed(true)` then `isCollapsed()` true; `toggleCollapsed()` flips it.
- `setCollapsed(current)` is a no-op (the animation path is guarded by `_mounted`, so pre-mount it only mutates state) — assert no throw and state unchanged.
- `registerDrawer`/`registerWindow` return `this` and don't throw for a minimal registration (bookkeeping only). *Assert the chainable/no-throw contract; the drawer/window layout effects are manual-verify.*

**Manual-verify (deferred, see Non-Goals):** edge positioning geometry, collapse cross-axis animation, minimize-genie window geometry, handle layout, drawer reveal.

---

## Verification

- **Per-file:** `npx vitest run tests/<path>` green for each new file.
- **Full suite:** `npx vitest run` — all 152 existing + new files green.
- **Typecheck:** `npx tsc -p tsconfig.test.json --noEmit` clean.
- **Coverage sanity (optional):** `npx vitest run --coverage` shows non-zero line coverage newly attributed to `RovingTabIndex.ts`, `Aria.ts`, the `AbstractStore` aggregation/grouping/pagination ranges, `Accordion.ts`, and `ComboBox.ts`.
- **Manual smoke (the documented manual-verify items):** exercise the app (`npm run dev`, per project memory: app on http://localhost:8015) — open an Accordion demo and toggle sections to confirm shrink/fill motion; open a ComboBox and drive it by keyboard; collapse a Rail. These substitute for the un-automatable transitions/gestures listed per suite.

---

## Non-Goals

- **`Rail`/`RailHandle`/`TabWindow` geometry and the minimize-genie animation** — deferred beyond the small pre-mount state suite. The substance of these files is edge positioning, collapse cross-axis tweening, handle layout, and window-registration genie geometry, all of which read true only under a real mount with measured geometry and CSS animation. Automating them offline would assert modelled-DOM artefacts, not the real contract; they belong to live/manual verification (or a future geometry-oracle harness). Rationale: value×ease is low — high effort, brittle, low signal.
- **The calendar dropdowns (`AbstractCalendarDropdown` + `DatePickerDropdown`/`DateTimePickerDropdown`)** — deferred. Their mass is DOM grid rendering, day-cell click/keyboard interaction, month navigation animation, and `showAt`/`hideAnimated` positioning — all manual-verify. The pure date-math islands (`CalendarDayCell` `getDate`/`setSelected`/`isSelected`/`setDisabled`/`isDisabled`, and min/max in-range disabling) are small and mostly buried behind module-private helpers (`dayStart`/`dayEnd`) and protected fields; the ROI of prying them open with `any` casts is low. `TimePickerDropdown` already has a layout suite; the date calendars are left to manual verification and any owning refactor plan. *(If a cheap win emerges, a `CalendarDayCell` state round-trip suite is the only piece worth pulling forward.)*
- **Source changes.** This plan only adds tests. A contract test that goes red against a real source bug is left red with a `// contract:` note and reported, not fixed here.
- **Areas owned by sibling plans** — `table/Body.ts`/`tree/Tree.ts` virtual scroll, store `removeAll`/`load`/`insert`/dirty correctness, Component size-negotiation, boolean/picker input refactors. Their tests ship with their plans.
- **Full ComboBox/TabBar geometry** (dropdown width math, overflow paging, drag-reorder) — manual-verify, enumerated per-suite above, not automated.

---

## Potential Challenges

- **Wiring `_totalCount` for pagination** — it is set only through a paginated proxy load, not a public setter; the known-total `getTotalPages`/clamp cases may need a proxy whose `read` reports a total, or must be marked *(needs total wired)*. Mitigation: assert the `undefined`-total branch unconditionally and drive the known-total branch through the load path if reachable, else document.
- **Making a record dirty for the pagination guard** — use a store-owned record's field setter so `isDirty()`/`isNew()` flips; confirm the exact API from `ModelRecord` before asserting. Mitigation: mirror [tests/unit/data/AbstractStore.sync.test.ts](tests/unit/data/AbstractStore.sync.test.ts)'s dirty-record setup.
- **Accordion deterministic geometry** — shrink/fill assertions require children with explicit preferred/min sizes and a cleared-inset host; without them `getPreferredSize` falls back to the 100px content default and results drift. Mitigation: set explicit sizes and `clearInsets()`, exactly as the VBox suite does.
- **`sectiontoggle` emit ordering under `singleOpen`** — the "close others then open target" sequence emits multiple events; assert the set and the target-last ordering, not incidental interleaving.
- **`ComboBox` change-target** — `change` fires on the ComboBox (not the inner list) via `Event.fireEvent(this, "change")`; subscribe through `Event.addListener(combo, "change", …)` / the public `on` surface, not the list.
- **Distinguishing `setActiveVisual` from `setActiveEntry`** — if the public surface can't observe the difference, down-grade that case to a characterization note rather than inventing an internal probe.

---

## Critical Files

- [tests/component/layout/VBox.test.ts](tests/component/layout/VBox.test.ts) — the layout-manager host+`doLayout` geometry template (`hostVBox`, `installTestDOM`, `clearInsets`).
- [tests/unit/data/MemoryStore.test.ts](tests/unit/data/MemoryStore.test.ts) + [tests/unit/data/Store.test.ts](tests/unit/data/Store.test.ts) — store setup, `loadData`, and the `RecordingProxy` pattern.
- [tests/unit/data/AbstractStore.sync.test.ts](tests/unit/data/AbstractStore.sync.test.ts) — dirty-record setup for the pagination guard.
- [tests/component/input/TimePickerDropdown.test.ts](tests/component/input/TimePickerDropdown.test.ts) — the dropdown-layout + `any`-cast-into-private template.
- [tests/component/container/TabBar.test.ts](tests/component/container/TabBar.test.ts) — the existing TabBar helpers and the cases to avoid duplicating.
- [tests/setup/node-setup.ts](tests/setup/node-setup.ts) + [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) — the modelled-DOM seam every suite runs under.
- Source under test: [data/AbstractStore.ts](src/typescript/lib/data/AbstractStore.ts), [core/RovingTabIndex.ts](src/typescript/lib/core/RovingTabIndex.ts), [core/Aria.ts](src/typescript/lib/core/Aria.ts), [layout/Accordion.ts](src/typescript/lib/layout/Accordion.ts) + [layout/AccordionConstraints.ts](src/typescript/lib/layout/AccordionConstraints.ts), [component/input/ComboBox.ts](src/typescript/lib/component/input/ComboBox.ts), [component/container/TabBar.ts](src/typescript/lib/component/container/TabBar.ts), [overlay/Rail.ts](src/typescript/lib/overlay/Rail.ts).
