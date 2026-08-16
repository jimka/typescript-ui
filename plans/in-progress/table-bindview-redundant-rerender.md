---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/component/table/Row.ts
  - packages/lib/src/typescript/lib/component/table/Table.ts
  - packages/lib/src/typescript/lib/component/table/index.ts
---

# Table `bindView` Redundant Re-render — Implementation Plan

## Overview

[`Table.bindView`](packages/lib/src/typescript/lib/component/table/Table.ts#L1577) is the shared re-bind routine behind [`Table.setDisplayMode`](packages/lib/src/typescript/lib/component/table/Table.ts#L466). It pushes the new store, columns, column configs, hidden-column set and four row predicates into the body one setter at a time, then calls `doLayout()`. Three of those setters — [`Body.setColumnConfigs`](packages/lib/src/typescript/lib/component/table/Body.ts#L753), [`Body.setColumns`](packages/lib/src/typescript/lib/component/table/Body.ts#L652) and [`Body.setHiddenColumns`](packages/lib/src/typescript/lib/component/table/Body.ts#L626) — each end with `this.syncPoolCells(); this.renderWindow();`. So one mode switch runs the pooled-row cell reconciliation four times when it needs to run once, and runs seven full render passes when it needs two.

This plan replaces that burst of body setter calls with **one bulk call**, `Body.bindViewState(state)`, that writes every field first and then does a single `syncPoolCells()` plus a single render. The public per-field setters keep their current behaviour for their own standalone callers. The duplicate second `this._body.setStore(store)` at [Table.ts:1604](packages/lib/src/typescript/lib/component/table/Table.ts#L1604) goes away, because the single ordered pass already does the work it was forcing.

The change lands in `Body.ts` (the new bulk method plus two small private extractions), `Table.ts` (`bindView`'s body and its doc comment), `Row.ts` (one stale code comment) and the table barrel (one type export). `TreeBody` inherits the fix with no edit of its own.

---

## Architecture Decisions

### `Table.bindView` pushes body state through one bulk call

`Body` gains a public `bindViewState(state: BodyViewState)` that takes every field `bindView` currently pushes through eight separate calls, writes them all, and then reconciles and renders once. This mirrors [`TableHeader.renderColumnWindow(geometry)`](packages/lib/src/typescript/lib/component/table/Header.ts#L1337), which already takes a bag of related state ([`HeaderColumnGeometry`](packages/lib/src/typescript/lib/component/table/Header.ts#L85)) and does one reconciliation pass for the whole table header.[^precedent]

### The existing per-field setters are left exactly as they are

`Body.setStore`, `setColumns`, `setColumnConfigs`, `setHiddenColumns`, `setRowReadOnly`, `setRowVisible`, `setRowSeparator` and `setRowIndented` keep their current signatures and their current render behaviour. `bindViewState` duplicates the field writes rather than calling them.[^no-setter-change]

### `bindViewState` renders once, through `onStoreChange`

The bulk method ends with `this.onStoreChange()` — the same protected hook `Body.setStore` uses — rather than calling `renderWindow()` directly. [`Body.onStoreChange`](packages/lib/src/typescript/lib/component/table/Body.ts#L432) clears the bound-index cache and renders; `TreeBody` overrides it to rebuild its parent/child index and re-flatten first. Routing through the hook is what keeps a `TreeTable` mode switch correct without a `TreeBody` edit.[^store-change-hook]

### `Row.setColumnFields` keeps its unconditional dirty flag

[`Row.setColumnFields`](packages/lib/src/typescript/lib/component/table/Row.ts#L287) continues to set `_columnsDirty = true` on every call. Callers rely on a forced rebuild even when the visible-field list is unchanged: a column config change swaps a plain cell for a `ComboCell` or a `DynamicCell` without touching the field list at all.[^keep-dirty]

### The second `setStore` call is dropped, not preserved

`bindView` currently calls `this._body.setStore(store)` twice with the same argument. The second call exists to force a second full rebind after the column state has settled, so freshly-built cells receive their read-only, required-empty and ARIA state.[^second-store] Under `bindViewState` the row predicates are installed *before* the only render, and that render reconciles every pooled row's cells (they are dirty), so [`Body.bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L1190) reaches `applyReadOnlyState` on the same pass that builds the cells. The second call has nothing left to force.

### `TreeBody` is covered, and needs no change of its own

[`TreeBody`](packages/lib/src/typescript/lib/component/table/TreeBody.ts) overrides hooks (`onStoreChange`, `getVisibleRecords`, `createRow`, `getTreeFieldName`, `computeRowAria`, `afterRowBound`, `onSubtreeClick`, `onKeyDown`) but overrides none of the setters `bindView` calls, and adds no burst of its own. It inherits `bindViewState` unchanged, and gains one extra saving: its `onStoreChange` override rebuilds the parent/child index and re-flattens the visible subtree, so today's duplicate `setStore` makes a `TreeTable` mode switch do that twice.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/table/Body.ts

/**
 * The complete view state a `Table` re-binds its body to in one step.
 */
export interface BodyViewState {
    store:         AbstractStore;
    columns:       Column[];
    columnConfigs: Map<string, ColumnConfig>;
    hiddenColumns: Set<string>;
    rowReadOnly:   ((record: ModelRecord) => boolean) | null;
    rowVisible:    ((record: ModelRecord) => boolean) | null;
    rowSeparator:  ((record: ModelRecord) => { label: string, color: string | null } | null) | null;
    rowIndented:   ((record: ModelRecord) => boolean) | null;
}

class Body extends VirtualRowView<Row> {
    bindViewState(state: BodyViewState): this;
}
```

`BodyViewState` is barrel-exported as a type from `packages/lib/src/typescript/lib/component/table/index.ts`, beside the existing `BodyEvent` / `CellClickEvent` exports and matching how `HeaderColumnGeometry` is exported from the same barrel.

`bindViewState` is internal framework wiring called by `Table`, exactly like `setRowReadOnly` / `setRowSeparator` / `setRowIndented`. It gets **no** `BodyOptions` field and no `get` counterpart: per ARCHITECTURE.md, the options bag is the consumer's configuration surface, and this is not consumer-facing state.

---

## Internal Structure

### `Body.bindViewState`

```typescript
bindViewState(state: BodyViewState): this {
    this.rebindStore(state.store);

    this._columns       = state.columns;
    this._columnConfigs = state.columnConfigs;
    this._hiddenColumns = this.filterUnhideable(state.hiddenColumns);
    this._rowReadOnly   = state.rowReadOnly;
    this._rowVisible    = state.rowVisible;
    this._rowSeparator  = state.rowSeparator;
    this._rowIndented   = state.rowIndented;

    this.registerComboEditors(state.columnConfigs);
    this.syncPoolCells();
    this.invalidateRowBindings();

    if (this.getElement()) {
        this.onStoreChange();
    }

    return this;
}
```

Four ordering rules the body of this method must obey:

| Rule | Why |
|---|---|
| `this._columns` is assigned **before** `filterUnhideable` runs | The filter looks each hidden name up in `this._columns` to honour `Column.isUnhideable()`. Today's `bindView` already sets columns before hidden columns, so this preserves the current result. |
| `registerComboEditors` runs **before** `syncPoolCells` | Matches `setColumnConfigs`, which registers combo editors and only then re-syncs. A cell built during the sync must find its editor factory already registered. |
| `syncPoolCells` runs **after** every field write | It reads `_store.model`, `_hiddenColumns`, `_columnConfigs` and `getTreeFieldName()` to recompute each row's visible-field list. |
| `invalidateRowBindings` runs unconditionally, `onStoreChange` only with an element | `Body.setStore` guards its `onStoreChange` on `getElement()`, but `Body.setRowVisible` invalidates bindings unconditionally — today's `bindView` therefore always invalidates. Splitting them this way preserves both. |

### Two private extractions in `Body.ts`

`rebindStore(store)` is `setStore`'s body minus its trailing `onStoreChange()` call: unsubscribe the old store's six refresh listeners, assign `_store`, `bindStore(store)`, `invalidateGeom()`. `setStore` then becomes `rebindStore` plus the guarded `onStoreChange()`, byte-for-byte equivalent to today.

`filterUnhideable(hidden)` is the loop at the top of `setHiddenColumns` that strips field names belonging to unhideable columns, returned as a new `Set`. `setHiddenColumns` calls it instead of inlining the loop.

### `Table.bindView`'s new body

```typescript
this._suppressSelectionForward = true;

this._header.setStore(store);
this._header.setModel(store.model);
this._header.setColumns(columns);
this._header.setHiddenColumns(hidden);

this._body.selectRecord(null);
this._header.setColumnConfigs(configs);
this._body.bindViewState({
    store,
    columns,
    columnConfigs: configs,
    hiddenColumns: hidden,
    rowReadOnly,
    rowVisible,
    rowSeparator,
    rowIndented,
});

this._suppressSelectionForward = false;
```

Everything below `_suppressSelectionForward = false` (the width-cache clears, `_widthRefs = null`, the ARIA column count, `this.doLayout()`) is untouched. The four `_header.*` calls keep their current relative order, including `setColumnConfigs` landing after `setColumns` / `setHiddenColumns`.

---

## Ordered Implementation Steps

1. **Write the failing tests first** in a new file `packages/lib/tests/component/table/BindViewRenderEconomy.test.ts`, covering `## Expected Behaviour` cases 1–4. Model the fixtures on `RotatedView.test.ts`'s `CONFIG` / `MODEL` / `makeStore` / `makeTable` helpers, but size the table (`setWidth(600)`, `setHeight(400)`, `doLayout()`) before the switch so the row pool is populated and the layout manager reaches the body. Run them — verify: cases 1 and 2 report 3 syncs (not 1), case 3 reports 7 render passes (not 2), case 4 reports at least 4 reconciliations per pre-existing pool row. If any pre-fix number differs from these, stop and report rather than adjusting the post-fix expectation.

2. **`Body.ts` — extract `private rebindStore(store: AbstractStore): void`** from `setStore` (currently line 848): everything except the `if (this.getElement()) { this.onStoreChange(); }` block and the `return this`. Rewrite `setStore` to call it. Verify: `npm run typecheck`, then `npx vitest run tests/component/table` — unchanged pass/fail set.

3. **`Body.ts` — extract `private filterUnhideable(hidden: Set<string>): Set<string>`** from `setHiddenColumns` (currently line 626) and have `setHiddenColumns` call it. Verify: same test command, unchanged results.

4. **`Body.ts` — add the exported `BodyViewState` interface and the public `bindViewState` method**, exactly as given in `## Public API` and `## Internal Structure`. Place `bindViewState` immediately after `setStore` so the store-swapping methods sit together. JSDoc it with an `@remarks Internal wiring called by {@link Table} — not for consumer use.` line, matching `setRowReadOnly`. Do not `{@link}` any private symbol from it. Verify: `npm run typecheck`.

5. **`packages/lib/src/typescript/lib/component/table/index.ts` — add `BodyViewState`** to the existing `export type { BodyEvent, CellClickEvent } from '~/component/table/Body.js';` line. Verify: `npm run typecheck`.

6. **`Table.ts` — rewrite `bindView`'s body** (currently lines 1587–1606) to the form in `## Internal Structure`. Verify: `grep -n '_body.set' packages/lib/src/typescript/lib/component/table/Table.ts` — expect matches only inside `Table.setStore`, `setColumnVisible`, `resetColumns` and the constructor; none inside `bindView`.

7. **`Table.ts` — rewrite `bindView`'s `@remarks` block** (currently lines 1557–1575). Drop the two paragraphs describing the setter ordering and the second `setStore`; both describe machinery this change removes. Replace with a short note that the body is re-bound in one pass via `Body.bindViewState`, that the single pass installs the row predicates before the only render so freshly-built cells receive their read-only state, and keep the existing sentences about `_suppressSelectionForward` and the width-cache clears.

8. **`Row.ts` — update the stale comment** in `setColumnWindow` (currently lines 357–365). It attributes the "stale for one pass" clamp to `Table.bindView` calling `Body.setStore` before `setColumns`. After step 6 that sequence lives only in [`Table.setStore`](packages/lib/src/typescript/lib/component/table/Table.ts#L675) (line 692 before line 695), so cite that method instead. Leave the clamp itself in place — it is still load-bearing.

9. **Run the new tests** — cases 1–4 must now pass. Then add `## Expected Behaviour` cases 7 and 8 to the same file as behaviour-preservation guards; unlike cases 1–4 these pass both before and after the fix, so run them against the pre-fix code too (`git stash` the source edits, run, unstash) to confirm they are guarding rather than merely agreeing with the new implementation.

10. **Verify the whole change** with the full `## Verification` list.

11. **Add a changelog entry** to `packages/lib/docs/reference/changelog/next.md` under a `## Fixed` heading (create the heading if the page is still the bare stub).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/index.ts` |
| Create | `packages/lib/tests/component/table/BindViewRenderEconomy.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Cases 1–4 are the new failing-first tests. Cases 7 and 8 are new guards that must pass before and after the fix. Cases 5 and 6 are already covered by existing tests that must not be edited, and case 9 is manual.

Cases 1–4 are each written against a table built from `RotatedView.test.ts`'s four-field model, materialised with `getElement(true)`, then sized to 600×400 and laid out so the row pool holds bound rows before the switch. Counters are installed by assigning over the method on the instance — `(body as any).syncPoolCells = …`, `row.setColumnWindow = …` — the white-box style `Body.test.ts` already uses when it pokes `_lastColumnWidths` and `_scroller`.

1. **One pool-cell sync per switch into rotated mode.** `table.setDisplayMode('rotated')` invokes `Body.syncPoolCells` exactly once. *(Unit-testable. Pre-fix: 3.)*

2. **One pool-cell sync per switch back to normal mode.** After a switch to rotated, `table.setDisplayMode('normal')` invokes `Body.syncPoolCells` exactly once. *(Unit-testable. Pre-fix: 3.)*

3. **At most two render passes per switch.** `table.setDisplayMode('rotated')` invokes `Body.renderWindow` at most twice — once from `bindViewState`, once from the trailing `doLayout()`. *(Unit-testable. Pre-fix: 7.)*

4. **At most two cell reconciliations per pooled row per switch.** For every `Row` already in the pool before the call, the number of `Row.setColumnWindow` invocations that return `true` during `table.setDisplayMode('rotated')` is at most 2. *(Unit-testable. Pre-fix: at least 4.)*

5. **Rotated cells are still read-only.** After `selectRecord(records[0])`, `setDisplayMode('rotated')`, sizing and `doLayout()`, every cell of every bound pool row reports `isReadOnly() === true`. *(Unit-testable; already pinned by [`RotatedView.test.ts:538`](packages/lib/tests/component/table/RotatedView.test.ts#L538), which must keep passing unmodified.)*

6. **Standalone setter callers still render immediately.** Calling `Body.setColumns`, `Body.setColumnConfigs`, `Body.setHiddenColumns` or `Body.setStore` on their own — with no following `doLayout()` — still reconciles the pool and re-renders on the spot. *(Unit-testable; already pinned by `Body.test.ts`, `TreeBody.test.ts`, `cell/DynamicCell.test.ts` and `cell/Combo.test.ts`, all of which must keep passing unmodified.)*

7. **Unhideable columns still survive a mode switch.** A column declared unhideable is not removed by the hidden set `bindView` forwards, because `bindViewState` runs the same `filterUnhideable` pass `setHiddenColumns` runs. *(Unit-testable.)*

8. **A `TreeTable` mode switch keeps its flattened row list correct.** After `setDisplayMode('rotated')` and back, `TreeBody.getVisibleRecords()` returns the same depth-flattened list as before the round trip. *(Unit-testable.)*

9. **An open cell edit commits onto the record it was opened on.** If a cell is mid-edit when `setDisplayMode` is called, its value lands on that cell's own record, not on whichever record the pool slot is rebound to. *(Manual verify — the switch happens while a real editor holds focus, which the offline harness cannot stage faithfully. This is a change: today the store is swapped and the rows rebound before the commit runs.[^edit-commit])*

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — full suite green. In particular `packages/lib/tests/component/table/RotatedView.test.ts`, `RotatedGroupSeparators.test.ts`, `RowVisibility.test.ts`, `QuickSearch.test.ts`, `Table.test.ts`, `Body.test.ts`, `TreeBody.test.ts`, `HeaderColumnWindow.test.ts`, `ColumnResize.test.ts`, `ColumnWidths.test.ts`, `cell/DynamicCell.test.ts` and `cell/Combo.test.ts` must pass **unmodified** — they are the regression-risk surface for this change.
- `npm run lint` — clean.
- `npm run docs:api` — zero warnings (the new public method and interface are TypeDoc-visible).
- `grep -n '_body\.set' packages/lib/src/typescript/lib/component/table/Table.ts` — no match inside `bindView`.
- Manual smoke, `npm run dev` → <http://localhost:8015> → the **Rotated** section (`packages/lib/src/typescript/RotatedRecordPanel.ts`, 30 records × 20 fields): toggle the rotate button both ways several times. The grouped-field separators, their tint, the indent on group members, the read-only cells and the prev/next record buttons must all behave as before, and the switch must feel visibly faster.
- Manual perf check, same screen with DevTools open: record a performance trace over one rotate toggle and confirm the cell-construction work appears once, not four times.

---

## Documentation Impact

- **Export surface.** `BodyViewState` joins the type exports on the `Body` line of `packages/lib/src/typescript/lib/component/table/index.ts`. `bindViewState` is a method on the already-exported `Body` class.
- **Generated API docs.** Both appear automatically under `/api/component/table/classes/Body` and `/api/component/table/interfaces/BodyViewState` once `npm run docs:api` runs. There is no hand-written page to update: `packages/lib/docs/components/Body.md` documents the unrelated core `Body` singleton, and the table body has no prose page of its own.
- **`{@link}` discipline.** Per CODE_CONVENTIONS.md, the JSDoc on `bindViewState` and `BodyViewState` may only link symbols that appear in the public API docs. `Table` and `Body` qualify; `syncPoolCells`, `onStoreChange`, `invalidateRowBindings`, `rebindStore` and `filterUnhideable` do not — describe those in prose.
- **Changelog.** One entry in `packages/lib/docs/reference/changelog/next.md`: a table display-mode switch now re-binds the body in a single pass instead of four, cutting the pooled-cell reconciliation and render work proportionally.
- **`packages/lib/llms.txt`** is unchanged — it indexes consumer-facing capabilities, and this adds none.

---

## Potential Challenges

- **`filterUnhideable` reads `this._columns`.** Assigning `_hiddenColumns` before `_columns` would filter against the outgoing column list and could drop or keep the wrong field. The ordering table in `## Internal Structure` is binding.
- **`syncPoolCells` is re-entrancy guarded.** It early-returns when `_reconciling` is set. `bindViewState` is called from `Table`, never from inside a render, so the guard is not tripped — but a future caller inside a render pass would silently skip the sync. Do not call `bindViewState` from a render or layout path.
- **The commit-before-rebind ordering shifts.** `syncPoolCells` starts by committing every open edit. Today that runs after the store swap has already re-rendered and rebound the pool; after this change it runs before any rebind. That order is safer, but the shift is a behaviour change — see `## Expected Behaviour` case 9.
- **`Row.setColumnWindow`'s clamp must stay.** It looks unreachable once `bindView` stops rendering between the store swap and the column resync, but `Table.setStore` still produces exactly that sequence. Delete the clamp and a store swap on a table whose new model has fewer fields will index past the end of the row's field list.
- **Exact pre-fix counts are the red signal.** If step 1's tests report numbers other than 3 / 3 / 7 / ≥4, the mechanism differs from what this plan traced — report rather than relaxing the assertion.

---

## Critical Files

| File | Why read it |
|---|---|
| [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) | The setters being collapsed (626, 652, 753, 848), `syncPoolCells` (805), `onStoreChange` (432), `invalidateRowBindings` (541), `registerComboEditors` (779), `bindAndPositionRows` (1190), `applyReadOnlyState` (1669). |
| [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) | `bindView` (1577) and its `@remarks`; the other body-setter callers at 315/324/329 (constructor), 692–695 (`setStore`), 865 (`setColumnVisible`), 2144 (`resetColumns`) that must keep working. |
| [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts#L1337) | The precedent: `HeaderColumnGeometry` (85) and `renderColumnWindow` (1337) — one state bag, one reconciliation pass. Also `setColumns` (372) / `setHiddenColumns` (346), which write state and leave rendering to the layout pass, and `setModel` (309), the header's field-list diff. |
| [`packages/lib/src/typescript/lib/component/table/Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts#L287) | `setColumnFields` (287) and its `_columnsDirty` write (301); `setColumnWindow` (348) and the comment to update (357–365). |
| [`packages/lib/src/typescript/lib/component/table/TreeBody.ts`](packages/lib/src/typescript/lib/component/table/TreeBody.ts) | Confirms the subclass overrides hooks, not setters — the `onStoreChange` override is the only thing `bindViewState` must route through. |
| [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts#L360) | Where `body.renderWindow(availableWidth, columnWidths)` is called — the second, real-width render pass `bindView`'s trailing `doLayout()` reaches. |
| [`packages/lib/tests/component/table/RotatedView.test.ts`](packages/lib/tests/component/table/RotatedView.test.ts) | Fixture style to copy, and the read-only test at 538 that pins what the dropped `setStore` was protecting. |
| [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts) | The white-box spy/poke style the new test file follows, and the standalone-setter tests that must keep passing. |

---

## Non-Goals

- **`Table.setStore`'s own two-render burst.** [Table.ts:692–695](packages/lib/src/typescript/lib/component/table/Table.ts#L692) calls `_body.setStore` then `_body.setColumns`, producing two render passes where one would do. That is the same defect class in a smaller, different shape: `Table.setStore` pushes only a store and a column list, not the eight fields `BodyViewState` carries, so reusing `bindViewState` there would additionally re-register combo editors and re-filter the hidden set. Out of scope; fix it separately if it profiles.
- **Diff-based dirty tracking in `Row` or `Body`.** Rejected — see `## Architecture Decisions` and the addendum.
- **Deferring the body's render entirely to the layout pass**, the way `TableHeader` does. Rejected.[^defer-fully]
- **Any change to `TreeBody`, `TreeTable` or the header.** They are covered by the `Body`-level fix.

---

## Addendum: Investigation Record

### Pass-by-pass trace of one `setDisplayMode` call

Table sized and laid out, `N` pooled rows, `C` visible columns. Line numbers are in `packages/lib/src/typescript/lib/component/table/Table.ts`.

| # | Line | Call | What it triggers | Reconciles pooled cells? |
|---|---|---|---|---|
| — | 1594 | `_body.selectRecord(null)` | repaints bound rows | no |
| 1 | 1595 | `_body.setStore(store)` | `onStoreChange` → `renderWindow` | **yes** — against the *outgoing* field list, so the clamp in `Row.setColumnWindow` shrinks each row and disposes cells that the next pass rebuilds |
| 2 | 1596 | `_body.setColumnConfigs(configs)` | `syncPoolCells` + `renderWindow` | **yes** — the one pass that is actually needed |
| 3 | 1598 | `_body.setColumns(columns)` | `syncPoolCells` + `renderWindow` | **yes** — model, hidden set, configs and tree field are byte-identical to pass 2 |
| 4 | 1599 | `_body.setHiddenColumns(hidden)` | `syncPoolCells` + `renderWindow` | **yes** — same state again |
| 5 | 1601 | `_body.setRowVisible(rowVisible)` | `invalidateRowBindings` + `renderWindow` | no — full rebind, no cell reconciliation |
| 6 | 1604 | `_body.setStore(store)` | `onStoreChange` → `renderWindow` | no — full rebind, no cell reconciliation |
| 7 | 1620 | `this.doLayout()` | layout → `body.renderWindow(w, widths)` | only when the real widths move the column window |

`setRowReadOnly` (1600), `setRowSeparator` (1602) and `setRowIndented` (1603) render nothing — they only assign a field.

Seven render passes, four of them reconciling cells. The reconciliation is `O(N × C)`: `Row.setColumnWindow` walks the window three times per pass and calls `cellKeyFor` on each pass, which is what the profile saw as ~10,179 `cellKeyFor` calls and ~1,888 cell constructions for one switch. That cost is independent of the store's record count, matching the profiled result that 200 rows and 5,000 rows cost the same.

After the fix: two render passes, one of them reconciling.

### Call-site census

Every production call site of the five methods this change touches or deliberately leaves alone. `setStore` is listed only for the table body; `AbstractChart` / `AbstractSelectableList` / `ComboBox` / `AutoCompleteField` have unrelated `setStore` methods of their own.

| Method | Site | Kind | Affected? |
|---|---|---|---|
| `Body.setColumns` | `Table.ts:315` (constructor) | standalone; body has no element, so the render is a no-op | no |
| | `Table.ts:695` (`setStore`) | burst of 2, ends in `doLayout()` | out of scope (non-goal) |
| | `Table.ts:1598` (`bindView`) | **the burst** | **yes** |
| `Body.setHiddenColumns` | `Table.ts:324` (constructor) | standalone, no element | no |
| | `Table.ts:865` (`setColumnVisible`) | genuine single update, ends in `doLayout()` | no |
| | `Table.ts:1599` (`bindView`) | **the burst** | **yes** |
| | `Table.ts:2144` (`resetColumns`) | genuine single update, ends in `doLayout()` | no |
| `Body.setColumnConfigs` | `Table.ts:329` (constructor) | standalone, no element | no |
| | `Table.ts:1596` (`bindView`) | **the burst** | **yes** |
| `Body.setStore` | `Table.ts:692` (`setStore`) | burst of 2 | out of scope (non-goal) |
| | `Table.ts:1595`, `Table.ts:1604` (`bindView`) | **the burst, twice** | **yes** |
| `Row.setColumnFields` | `Row.ts:86` (constructor) | must force a build | no |
| | `Body.ts:820` (`syncPoolCells`) | the only other caller | no — behaviour kept |

Test call sites that invoke the setters standalone and depend on their immediate render: `Body.test.ts:901`, `:993`, `:1136`, `:1149`, `:1496`, `:1507`; `TreeBody.test.ts:254`, `:315`; `cell/DynamicCell.test.ts:231`, `:376`, `:380`; `cell/Combo.test.ts:264`, `:286`; `HeaderColumnWindow.test.ts:741`. Leaving the setters untouched is what keeps all of these passing unmodified.

`Table.setColumnVisible` and `Table.resetColumns` are the legitimate standalone updates: each changes exactly one thing, so the `syncPoolCells` + `renderWindow` inside the setter it calls is the whole point of the call. Leaving the setters alone is what keeps both correct.

### Why a diff-based fix in `Row` / `Body` is not sufficient on its own

The obvious smaller fix is to make `Row.setColumnFields` skip its dirty flag when nothing changed, leaving `Table.bindView`'s call sequence alone. That fix does not close the gap, for three separate reasons.

**A diff removes at most half the redundancy.** It would suppress passes 3 and 4 (identical state). Pass 1 is untouched: it reconciles because the *column window* shrank against a stale field list, not because a dirty flag was set. And the three render passes it cannot suppress at all — passes 1, 5 and 6 — still run `renderWindowPass` end to end, which re-derives the visible records, re-clamps the scroller, recomputes the column window, and walks every pooled row and every rendered cell to write geometry. Suppressing the dirty flag removes the cell construction, not the passes.

**A diff cannot remove the duplicate `setStore` call.** Pass 6 is a full rebind that no dirty-flag diff can see, and for a `TreeTable` it additionally rebuilds the parent/child index and re-flattens the visible subtree.

**A correct diff is not the obvious one.** Diffing the *inputs* is wrong: `setHiddenColumns` builds a fresh `Set` every call, so a reference comparison always reports a change. Diffing the *derived* `_visibleFields` list is also wrong: [`Body.test.ts:1145`](packages/lib/tests/component/table/Body.test.ts#L1145) pins that adding `values` to a column config must replace that column's cell with a `ComboCell` while the field list is unchanged, and [`cell/DynamicCell.test.ts:361`](packages/lib/tests/component/table/cell/DynamicCell.test.ts#L361) pins the same for toggling `cellType`. A correct diff would have to compare the per-field cell keys `Row.cellKeyFor` derives — which costs a `cellKeyFor` call per column per invocation, on the hot path, to save work the bulk method removes for free.

The codebase does have prior art for a diff-based skip in this subsystem — [`TableHeader.setModel`](packages/lib/src/typescript/lib/component/table/Header.ts#L309) compares the visible field-name lists and skips its rebuild when they match. That precedent is exactly why the trap above matters: the header's cells depend only on the field list, so a field-list diff is complete for it. The body's cells additionally depend on the column configs, so the same diff would be incomplete here.

### Was the duplicate `setStore` genuinely dead?

No — it was load-bearing under the current call order, and it becomes unnecessary only because of how `bindViewState` reorders the writes. `Body.setStore` unsubscribes the old store's six refresh listeners, assigns `_store`, resubscribes, clears the geometry caches, and calls `onStoreChange` — which fills `_boundIndices` with `-1`. That fill is what makes `bindAndPositionRows` treat every slot as rebound, and `applyReadOnlyState` / `computeRowAria` / `applyRequiredEmptyState` only run for a slot that was rebound or whose column window changed. On the first `setStore` the pool's cells still belonged to the outgoing column shape, so the state was applied to cells that pass 2 then threw away; the second call re-applied it to the cells that survived.

`bindViewState` installs `_rowReadOnly` and the other predicates *before* its single render, and that render finds every row dirty — so `Row.setColumnWindow` returns `true`, `windowChanged` is `true`, and `applyReadOnlyState` runs over the freshly-built cells on the same pass. The invariant to preserve, and the reason the ordering table in `## Internal Structure` is binding: **the row predicates must be assigned before `syncPoolCells`, and `syncPoolCells` before the render.**

---

## Notes

[^precedent]: Searched for existing "collapse a burst of state pushes into one render" solutions in this codebase before designing. Three candidates turned up, all in or adjacent to the table subsystem. `TableHeader.renderColumnWindow(geometry?: HeaderColumnGeometry)` is the closest fit and the one this plan mirrors: an exported state-bag interface plus one method that consumes it and reconciles once, called from the layout manager. `Component.setAutoCommitStyle(false) … (true)` is a bracketing batching window, used heavily in `layout/Table.ts` — rejected here because it would need a second flag on `Body` and would leave every setter's `renderWindow` call in place, merely suppressed. `Component.scheduleLayout()`'s rAF coalescing is the framework's general answer to repeated layout requests — rejected because `bindView` must leave the body correct synchronously (every test and `Table.setStore`'s own comment depend on the trailing `doLayout()` having already rendered), and deferring to an animation frame would change that contract.

[^no-setter-change]: Fourteen test call sites across five files call these setters standalone and assert on the result immediately, with no intervening layout — they are listed in the addendum's census. Changing the setters to defer their render would break all of them and would be a public behaviour change for a class exported from the package barrel. Duplicating eight field assignments inside `bindViewState` is the cheaper trade: the shared mechanics that are worth extracting (the store rebind, the unhideable filter, the combo-editor registration, the pool sync) are extracted and reused, and only the plain assignments are written twice.

[^store-change-hook]: The alternative was to split `onStoreChange` into a render-free `refreshRecordIndex()` hook plus the render, so `bindViewState` could rebuild `TreeBody`'s index without rendering at all and leave the single render to the trailing `doLayout()`. That would cut the switch to one render pass instead of two. It was rejected as disproportionate: it rewrites a documented protected subclassing seam and moves `TreeBody`'s override, to remove a pass that reconciles cells only when the real column widths shift the column window — which is ordinary layout work, not the redundancy this plan is fixing.

[^keep-dirty]: Four sites depend on the forced rebuild. `Row`'s constructor (Row.ts:86) calls `setColumnFields` to establish the initial field list, and the first `setColumnWindow` must build from nothing. `Body.syncPoolCells` (Body.ts:820) is reached from `setColumnConfigs`, where the field list can be identical while the required cell class changes — `Body.test.ts:1145` and `cell/DynamicCell.test.ts:361` both pin exactly that. `Row.renderSeparator` (Row.ts:330) sets the flag directly with the comment "forces the next setColumnWindow to rebuild fully". `Row.setColumnWindow`'s own separator-exit branch (Row.ts:353) sets it again after disposing the separator cell. The last two are force-rebuilds with no field-set change at all, which is the shape a naive "only mark dirty when something changed" fix would break.

[^second-store]: The behaviour is documented in `bindView`'s current `@remarks` at Table.ts:1566–1575, which states that `Body`'s per-slot metadata is only re-applied on a slot whose bound index changes, that the first `setStore` consumed that signal before the cells were synced to the new column shape, and that the second call re-triggers the rebind over the fully-synced cells "so e.g. a rotated column's freshly-built `DynamicCell` actually receives `setReadOnly(true)`". `RotatedView.test.ts:538` is the test that pins it.

[^defer-fully]: `TableHeader.setColumns` / `setHiddenColumns` rebuild their cell descriptors and render nothing, leaving the render to `renderColumnWindow` on the layout pass — and every production caller of `bindView`, `Table.setStore`, `Table.setColumnVisible` and `Table.resetColumns` does end in `doLayout()`, so `Body` could follow suit. It is rejected for the same reason the per-field setters are left alone: the body's setters are barrel-exported public API with standalone test callers that assert immediately after the call, and this plan's measured problem is solved without touching them.

[^edit-commit]: `Body.syncPoolCells` opens with `commitEditsOutsideWindow(null)`, which commits every open edit in the pool. Today that call is reached from `setColumnConfigs`, by which point the first `setStore` has already swapped the store and re-rendered, rebinding pool slots to the new store's records. After this change `syncPoolCells` runs before any render, so the commit sees each cell still bound to the record its edit was opened on. This is strictly the safer order, and no existing test covers the case either way.
