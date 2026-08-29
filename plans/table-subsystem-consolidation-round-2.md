---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/component/table/Header.ts
  - packages/lib/src/typescript/lib/component/table/Row.ts
  - packages/lib/src/typescript/lib/component/table/Table.ts
  - packages/lib/src/typescript/lib/component/table/cell/Cell.ts
  - packages/lib/src/typescript/lib/layout/Table.ts
  - packages/lib/src/typescript/lib/core/Util.ts
---

# Table Subsystem Consolidation, Round 2 — Implementation Plan

## Overview

A fresh-context audit of the Table subsystem's growth since 2026-07-05 (column virtualization, column filters, cell editing, export, quick search) found one real performance defect and one large block of copy-pasted algorithm, plus a set of smaller duplications and stale doc claims. They cluster in four files — [`Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts), [`Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts), [`Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts), [`Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) — so they ship as one plan in three phases.

**Phase 1** removes a per-pooled-row `O(N)` store query from the scroll path. [`Body.updateCellRangeVisualState:1715`](packages/lib/src/typescript/lib/component/table/Body.ts#L1715) and [`Body.updateRowVisualState:2257`](packages/lib/src/typescript/lib/component/table/Body.ts#L2257) each call `getVisibleRecords()` — a full array copy, plus a full `.filter()` when quick search or a row-visibility predicate is active — once per pooled row per render tick, even though the caller that drives them already holds the records array and even says so in its own doc: *"passed in so this helper doesn't re-query"* ([`bindAndPositionRows:1384`](packages/lib/src/typescript/lib/component/table/Body.ts#L1384)). The fix threads the array through.

**Phase 2** collapses `Header.ts`'s two near-identical windowed-cell reconcilers — the column row's ([`:813`](packages/lib/src/typescript/lib/component/table/Header.ts#L813), [`:980`](packages/lib/src/typescript/lib/component/table/Header.ts#L980)) and the filter row's ([`:1424`](packages/lib/src/typescript/lib/component/table/Header.ts#L1424), [`:1570`](packages/lib/src/typescript/lib/component/table/Header.ts#L1570)) — onto one hook-parameterised implementation, which also removes the full-path/slide-path duplication inside each row.

**Phase 3** is bounded cleanup: one framework-rule violation, several small duplications, and three doc corrections.

Nothing here changes rendered output or any public signature except one new `Util` helper.

---

## Architecture Decisions

### The visible-records array is threaded, not cached

`getVisibleRecords()` stays the single derivation point; the fix is that every per-pool-slot helper takes the array its caller already computed instead of asking for a fresh one.[^why-thread] `Body.getCellRangeBounds` gains an optional `records` parameter defaulting to `this.getVisibleRecords()`, so its cold callers — clipboard copy and context-menu copy — are untouched.

`TreeBody.getVisibleRecords` ([`TreeBody.ts:511`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L511)) has the same `O(N)` shape — `this._flatRows.map(f => f.record)` — but needs no change of its own: `TreeBody` does not override `bindAndPositionRows` or any of the helpers being fixed, so it inherits the reduction.[^treebody]

### The rectangular-range bounds are computed once per pass, not once per row

`getCellRangeBounds` runs two full `indexOf` scans over the visible records. It is currently called from inside `updateCellRangeVisualState`, i.e. once per pooled row. It moves up to the two callers that drive that loop — [`bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L1396) and [`refreshCellRangeHighlight`](packages/lib/src/typescript/lib/component/table/Body.ts#L1691) — and is passed down.[^bounds-hoist]

### One windowed-row reconciler, parameterised by two hooks

The column row and the filter row get one shared **full-path** method and one shared **slide-path** method on `TableHeader`. The slide path is the fast route taken when the window moves sideways by fewer columns than it is wide: it repoints the cells at the departing edge onto the entering columns and leaves every survivor untouched. Both are driven by a `WindowedRowHooks<TCell>` bag with two members: `create(field)` builds, parents and wires a fresh cell; `apply(cell, col, retargeted)` writes every per-column property. Everything else — the previous-window guard, the `byName` index, the two-pass recycle-else-build, the leftover discard, and the `slotOf` reorder — is written once.

The one-algorithm-plus-caller-hooks shape mirrors [`component/shared/reduceModifierSelection.ts`](packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts), the same audit series' precedent for "one algorithm, caller-supplied accessors for the parts that genuinely differ", and continues the extraction work [`plans/implemented/data-view-virtualization-consolidation.md`](plans/implemented/data-view-virtualization-consolidation.md) did for the virtual-scroll machinery. The shared code stays as **private methods on `TableHeader`** rather than a module under `component/shared/`, because both consumers are that one class.[^private-not-shared]

### `retargeted` is one flag, OR'd by the shared code

The column row writes a cell's ARIA column index only when the cell was actually repointed (or the whole cell set is being rebuilt); the filter row writes it always. Rather than two hooks, the shared full path passes `retargeted.has(col) || dirty` and the slide path passes `true`; each row's `apply` decides what to do with it.

| Row | Path | Value the shared code passes | What `apply` does with it |
|---|---|---|---|
| Column | full, cell kept its own field, `_columnsDirty` false | `false` | skips `setColIndex` |
| Column | full, cell recycled onto a new column | `true` | writes `setColIndex(col + 1)` |
| Column | full, `_columnsDirty` true (field/config change) | `true` for every cell | writes `setColIndex` for every cell |
| Column | slide | `true` | writes `setColIndex` |
| Filter | any | any | ignores it; always writes `setColIndex` |

### The column-lookup map is built once per reconcile, after the early-out

Both hook bags need a field-name → `Column` lookup. The map is built eagerly inside the hook builder, and the hook builder is called only after the "window unchanged and not dirty" early return — so a scroll tick that changes nothing still pays nothing.[^column-map]

### `Table.computeGroupRuns` and `Header.rebuildParentCells` stay mirrored

The two group-run scans are not merged; `rebuildParentCells` gets a cross-reference comment naming the intended divergence, matching the one `computeGroupRuns` already carries in the other direction.[^group-runs]

### The header/body window-width doc is corrected, not the code

The body windows its columns against its own full width; the header windows against the table's available column width, which excludes the 12px vertical-scrollbar band — so a 600px-wide table windows the body against 600 and the header against 588. Both sides add the same two-column buffer, which covers that difference in every realistic column width. Both are also correct as they stand: the body legitimately paints rows under the overlay scrollbar, while the header reserves that band for its column-menu button. The class doc that implies the two windows match is what changes.[^window-width]

---

## Public API

One new exported function. No component signature changes anywhere in this plan.

```typescript
// core/Util.ts — added to the Util namespace, next to Util.clamp
export namespace Util {
    /**
     * Builds the inclusive integer range `[a, b]` as an array.
     * Returns an empty array when `b < a`.
     */
    export function range(a: number, b: number): number[];
}
```

---

## Internal Structure

### Phase 1 — `Body.ts` private signatures

```typescript
// records defaults to the live query, so the clipboard callers are unchanged.
private getCellRangeBounds(
    anchor : { record: ModelRecord, col: number } | null,
    focus  : { record: ModelRecord, col: number } | null,
    records: ModelRecord[] = this.getVisibleRecords(),
): CellRangeBounds | null;

private refreshCellRangeHighlight(records: ModelRecord[]): void;
private widenRangeDragIfMultiCell(records: ModelRecord[]): void;
private updateRowVisualState(i: number, records: ModelRecord[]): void;
private updateCellRangeVisualState(i: number, records: ModelRecord[], bounds: CellRangeBounds | null): void;
```

`isCellWithinBounds` is left alone — it has one caller, on the context-menu click path.

### Phase 2 — `Header.ts` shared reconciler

```typescript
/**
 * The two behaviours that differ between the column row and the filter row.
 */
interface WindowedRowHooks<TCell extends Cell<any>> {
    /** Builds a cell for `field`, parents it on the row with `{ data: field }`, wires it, returns it. */
    create(field: Field): TCell;
    /** Writes every per-column property onto `cell` for visible column `col`. */
    apply(cell: TCell, col: number, retargeted: boolean): void;
}

// Both on TableHeader.
private reconcileWindowedRow<TCell extends Cell<any>>(
    row: Row, firstCol: number, lastCol: number, dirty: boolean, hooks: WindowedRowHooks<TCell>,
): void;

private reconcileWindowedRowSlide<TCell extends Cell<any>>(
    row: Row, firstCol: number, lastCol: number, delta: number, hooks: WindowedRowHooks<TCell>,
): TCell[];   // the cells repointed at a new column

private columnRowHooks(row: Row): WindowedRowHooks<HeaderCell>;
private filterRowHooks(row: Row): WindowedRowHooks<FilterCell>;
```

`reconcileColumnCells` and `reconcileFilterCells` keep their existing signatures and keep owning everything that is genuinely theirs: the `_lastEnteredCells` reset, the `hasFilterRow()` disposal branch, the previous-window guard, the slide-vs-full decision, and the post-pass writes to `_windowFirst` / `_filterWindowFirst` / `_columnsDirty` / `_filterCellsDirty`. The shared methods write none of that state.

### Phase 3 — new row-metrics module

```typescript
// component/table/RowMetrics.ts — new file, not barrel-exported
/** Height in pixels of one table row: the shared px line box plus top+bottom cell padding. */
export function tableRowHeight(): number;
```

---

## Ordered Implementation Steps

### Phase 1 — remove the per-row store re-query

1. **`Body.ts` — `getCellRangeBounds` ([:1643](packages/lib/src/typescript/lib/component/table/Body.ts#L1643))**: add the third parameter `records: ModelRecord[] = this.getVisibleRecords()`, delete the `const records = this.getVisibleRecords();` line in the body, and add a `@param records` line to the JSDoc saying it defaults to a live query.

2. **`Body.ts` — `updateCellRangeVisualState` ([:1708](packages/lib/src/typescript/lib/component/table/Body.ts#L1708))**: change the signature to `(i: number, records: ModelRecord[], bounds: CellRangeBounds | null)`. Delete the `this.getVisibleRecords()[dataIdx]` line and the `getCellRangeBounds` call; keep the guard as `if (!records[dataIdx]) { return; }`. Update the JSDoc's `@param` list.

3. **`Body.ts` — `refreshCellRangeHighlight` ([:1691](packages/lib/src/typescript/lib/component/table/Body.ts#L1691))**: take `records: ModelRecord[]`, compute `const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus, records);` once, and pass `records` + `bounds` into each `updateCellRangeVisualState` call.

4. **`Body.ts` — `widenRangeDragIfMultiCell` ([:1924](packages/lib/src/typescript/lib/component/table/Body.ts#L1924))**: take `records: ModelRecord[]` and forward it to `getCellRangeBounds`.

5. **`Body.ts` — `onCellMouseDown` ([:1831](packages/lib/src/typescript/lib/component/table/Body.ts#L1831)) and `onCellDragMove` ([:1868](packages/lib/src/typescript/lib/component/table/Body.ts#L1868))**: in each, after the early returns, add `const records = this.getVisibleRecords();` and pass it to both `refreshCellRangeHighlight(records)` and `widenRangeDragIfMultiCell(records)`.

6. **`Body.ts` — `updateRowVisualState` ([:2251](packages/lib/src/typescript/lib/component/table/Body.ts#L2251))**: take `records: ModelRecord[]` and read `const record = records[dataIdx];` instead of querying. Keep both guards (`dataIdx === -1` and `!record`).

7. **`Body.ts` — the three selection sweeps**: in `onRowClick` ([:1544](packages/lib/src/typescript/lib/component/table/Body.ts#L1544)) pass the `records` local it already holds; in `selectRecord` ([:2000](packages/lib/src/typescript/lib/component/table/Body.ts#L2000)) and `setSelectedRecords` ([:2044](packages/lib/src/typescript/lib/component/table/Body.ts#L2044)) add one `const records = this.getVisibleRecords();` above the `forEach` and pass it in.

8. **`Body.ts` — `onRowClick` `"cellclick"` emit ([:1585](packages/lib/src/typescript/lib/component/table/Body.ts#L1585))**: replace `this.getVisibleRecords().indexOf(record)` with `records.indexOf(record)`, reusing the local from [:1532](packages/lib/src/typescript/lib/component/table/Body.ts#L1532).

9. **`Body.ts` — `bindAndPositionRows` ([:1396](packages/lib/src/typescript/lib/component/table/Body.ts#L1396))**: immediately after `this.alignPoolWindow(firstRow);`, add
   `const rangeBounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus, records);`
   then change the two in-loop calls to `this.updateRowVisualState(i, records)` and `this.updateCellRangeVisualState(i, records, rangeBounds)`.

10. **Check**: `grep -n "getVisibleRecords" packages/lib/src/typescript/lib/component/table/Body.ts` — no hit may fall inside `updateRowVisualState`, `updateCellRangeVisualState`, `refreshCellRangeHighlight`, or `widenRangeDragIfMultiCell`.

11. **Test**: add `packages/lib/tests/component/table/VisibleRecordQueryEconomy.test.ts` covering the *query economy* and *cell-range drag economy* cases in `## Expected Behaviour`, modelled on [`ScrollRebindLayoutEconomy.test.ts`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts) (same `installTestDOM` config, same captured-animation-frame helper). Add the *behaviour preserved* cases to [`Body.test.ts`](packages/lib/tests/component/table/Body.test.ts), beside its existing range-selection cases. Run `npm test`.

### Phase 2 — one windowed-row reconciler

12. **`Header.ts`**: add the module-local `WindowedRowHooks<TCell extends Cell<any>>` interface, above `TableHeader`, next to the existing module-local helpers.

13. **`Header.ts`**: add `private reconcileWindowedRow<TCell extends Cell<any>>(row, firstCol, lastCol, dirty, hooks): void` — the constraint is load-bearing, see `## Potential Challenges` — transcribing the algorithm from today's `reconcileColumnCells` body ([:836-956](packages/lib/src/typescript/lib/component/table/Header.ts#L836)) with three substitutions: `HeaderCell` → `TCell`, the pass-2 build branch → `hooks.create(field)`, the pass-3 body → `hooks.apply(cell, col, retargeted.has(col) || dirty)`. It reads `this._visibleFields` directly. It must not touch `_windowFirst`, `_columnsDirty`, `_filterWindowFirst`, or `_filterCellsDirty`.

14. **`Header.ts`**: add `private reconcileWindowedRowSlide<TCell extends Cell<any>>(row, firstCol, lastCol, delta, hooks): TCell[]`, transcribing from today's `reconcileColumnWindowSlide` ([:980-1030](packages/lib/src/typescript/lib/component/table/Header.ts#L980)) with the per-column block replaced by `row.setLayoutConstraints(cell, { data: this._visibleFields[col] }); hooks.apply(cell, col, true);`. Returns `enteringCells`.

15. **`Header.ts`**: add `private columnRowHooks(row: Row): WindowedRowHooks<HeaderCell>`. Build `const columnMap = new Map(this._columns.map(c => [c.getField().getName(), c]));` at the top. `create` does `new HeaderCell(field.getName(), field.getName(), null)`, `row.addComponent(cell, { data: field })`, `this.wireCell(cell)`, return. `apply` carries today's pass-3 body ([:912-932](packages/lib/src/typescript/lib/component/table/Header.ts#L912)) with the ARIA write gated on the `retargeted` argument.

16. **`Header.ts`**: add `private filterRowHooks(row: Row): WindowedRowHooks<FilterCell>`. Same `columnMap`, plus a local `operatorsFor(field)` returning `column?.isFilterable() ? columnFilterOperators(field.getType()) : []`. `create` does `new FilterCell(field.getName(), operatorsFor(field))`, `row.addComponent(cell, { data: field })`, `this.wireFilterCell(cell)`, return. `apply` carries today's pass-3 body ([:1523-1535](packages/lib/src/typescript/lib/component/table/Header.ts#L1523)) verbatim, ARIA write included and ungated.

17. **`Header.ts` — rewrite `reconcileColumnCells` ([:813](packages/lib/src/typescript/lib/component/table/Header.ts#L813))** to: reset `_lastEnteredCells`; compute `prevFirst` / `prevWidth` / `prevLast`; early-return `false` on the unchanged-and-clean guard; `const hooks = this.columnRowHooks(row);`; on the slide condition call `reconcileWindowedRowSlide` and assign its result to `this._lastEnteredCells`; otherwise call `reconcileWindowedRow(row, firstCol, lastCol, this._columnsDirty, hooks)`; then set `_windowFirst = firstCol`, `_columnsDirty = false`, return `true`. Keep the existing JSDoc, updating the three-pass description to point at the shared method.

18. **`Header.ts` — rewrite `reconcileFilterCells` ([:1424](packages/lib/src/typescript/lib/component/table/Header.ts#L1424))** the same way, keeping the `hasFilterRow()` disposal branch ([:1427-1440](packages/lib/src/typescript/lib/component/table/Header.ts#L1427)) unchanged at the top and discarding the slide path's return value.

19. **`Header.ts`**: delete `reconcileColumnWindowSlide` and `reconcileFilterWindowSlide`.

20. **Check**: `grep -n "reconcileColumnWindowSlide\|reconcileFilterWindowSlide" packages/lib/src/typescript/lib/component/table/Header.ts` — expect zero matches. Add the *Phase 2* cases from `## Expected Behaviour` to [`HeaderColumnWindow.test.ts`](packages/lib/tests/component/table/HeaderColumnWindow.test.ts) (column row) and [`ColumnFilterRow.test.ts`](packages/lib/tests/component/table/ColumnFilterRow.test.ts) (filter row), then run `npm test` — every suite in `## Verification` must stay green.

### Phase 3 — cleanups

21. **`core/Util.ts`**: add `range` to the namespace immediately after `clamp` ([:404](packages/lib/src/typescript/lib/core/Util.ts#L404)), with the same JSDoc shape (description, `@param`s, `@returns`, `@remarks` for the empty case):
    ```typescript
    export function range(a: number, b: number): number[] {
        return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
    }
    ```
    The `Math.max(0, …)` guard is new relative to the three copies being replaced.[^range-guard]

22. **Delete the three local `range` helpers** ([`Body.ts:238-241`](packages/lib/src/typescript/lib/component/table/Body.ts#L238), [`Row.ts:58-61`](packages/lib/src/typescript/lib/component/table/Row.ts#L58), [`Header.ts:86-89`](packages/lib/src/typescript/lib/component/table/Header.ts#L86)) and rewrite every remaining call site to `Util.range(...)`. `Body.ts` already imports `Util`; add `import { Util } from "~/core/Util.js";` to `Row.ts` and `Header.ts`. Note that Phase 2 already reduced `Header.ts`'s call sites from four to two, so re-read the file rather than working from a remembered count.
    **Check**: `grep -rn "^function range(" packages/lib/src/typescript/lib/component/table/` — expect zero matches, and `grep -rn "[^.A-Za-z]range(" packages/lib/src/typescript/lib/component/table/` — also zero, since every surviving call site is now prefixed `Util.`.

23. **Create `packages/lib/src/typescript/lib/component/table/RowMetrics.ts`** exporting `tableRowHeight()`, importing only `ThemeManager` and `Util`. Keep the body identical to today's, so the grep below stays meaningful:
    ```typescript
    export function tableRowHeight(): number {
        const theme      = ThemeManager.getTheme();
        const lineHeight = Util.lineHeightPx();
        const padding    = theme.table.cell.padding ?? 2;

        return lineHeight + 2 * padding;
    }
    ```
    Move the `@remarks` from [`Body.computeRowHeight:391-400`](packages/lib/src/typescript/lib/component/table/Body.ts#L391) onto it (why `theme.table.cell.height` is ignored) and mark the function `@internal`.

24. **`Body.ts`**: delete `computeRowHeight` ([:401](packages/lib/src/typescript/lib/component/table/Body.ts#L401)) and call `tableRowHeight()` at its two call sites — the constructor ([:355](packages/lib/src/typescript/lib/component/table/Body.ts#L355)) and `onThemeReflow` ([:380](packages/lib/src/typescript/lib/component/table/Body.ts#L380)).

25. **`layout/Table.ts`**: in the header block ([:198-204](packages/lib/src/typescript/lib/layout/Table.ts#L198)) and the footer block ([:250-255](packages/lib/src/typescript/lib/layout/Table.ts#L250)), replace the `theme` / `lineHeight` / `padding` / `columnHeight` derivation with `const columnHeight = tableRowHeight();`, trimming each block's surrounding comment to one sentence pointing at `RowMetrics`. Both `const theme = ThemeManager.getTheme();` locals become unused — delete them, then delete the now-unused `ThemeManager` import ([:9](packages/lib/src/typescript/lib/layout/Table.ts#L9)). The `Util` import stays (still used at [:219](packages/lib/src/typescript/lib/layout/Table.ts#L219), [:473](packages/lib/src/typescript/lib/layout/Table.ts#L473), [:598](packages/lib/src/typescript/lib/layout/Table.ts#L598)).
    **Check**: `grep -rn "lineHeight + 2 \* padding" packages/lib/src/typescript/lib/` — expect exactly one match, in `RowMetrics.ts`.

26. **`cell/Cell.ts`**: add a private arrow-function field beside the other private fields —
    ```typescript
    // Internal cell-editor wiring: listens on a privately-owned child; see
    // the cell-editor carve-out in ARCHITECTURE.md. An arrow field rather
    // than a plain method: `Event` invokes a listener with `this` bound to
    // the component it was registered on, which here is the renderer.
    private _onRendererDoubleClick = (): void => { this.startEdit(); };
    ```
    and use it at [`setActiveRenderer:762`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L762): `Event.addListener(renderer, 'dblclick', this._onRendererDoubleClick);`. Follows [`ResizeHandle._onMouseDown:228`](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L228). Leave the constructor's site at [:170](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L170) untouched (see `## Non-Goals`).

27. **`Table.ts`**: add `private buildExportMenuItems(): MenuItemConfig[]` next to `buildColumnMenuItems` ([:1765](packages/lib/src/typescript/lib/component/table/Table.ts#L1765)), returning the three literals from [:1673-1675](packages/lib/src/typescript/lib/component/table/Table.ts#L1673). Call it from both branches of `showColumnMenu`: `this._columnContextMenu.show(x, y, this.buildExportMenuItems())` in the rotated branch, and `items.push({ separator: true }, ...this.buildExportMenuItems())` in the normal branch.

28. **`Row.ts`**: add `private resolveEnteringCell(field: Field, key: string): Cell<any>` carrying the cache-restore-else-construct tiers from [:579-599](packages/lib/src/typescript/lib/component/table/Row.ts#L579). Call it from the full path's pass 2 (replacing the `else if (cached …) { … } else { … }` chain, keeping the `pool` branch ahead of it) and from the slide path ([:727-747](packages/lib/src/typescript/lib/component/table/Row.ts#L727)). Replace the acknowledgement comment at [:710-712](packages/lib/src/typescript/lib/component/table/Row.ts#L710) with one sentence naming the shared helper.

29. **`Body.ts` — same-class field derivation**: in `renderWindowPass`, replace the inline `fieldCount` derivation ([:1264-1266](packages/lib/src/typescript/lib/component/table/Body.ts#L1264)) with `const fieldCount = this.computeVisibleFields().length;`.

30. **`Body.ts` — named background constant**: add `const TABLE_BODY_BG = "var(--ts-ui-input-bg, rgb(255, 255, 255))";` above `_defaultTableBodyOptions` ([:260](packages/lib/src/typescript/lib/component/table/Body.ts#L260)) with a one-line comment matching [`Footer.FOOTER_BG:13`](packages/lib/src/typescript/lib/component/table/Footer.ts#L13); use it in the defaults bag and at the constructor's `setBackgroundColor` ([:348](packages/lib/src/typescript/lib/component/table/Body.ts#L348)).

31. **`Body.ts` — dead doc link**: rewrite the `@remarks` on `on` ([:2071-2075](packages/lib/src/typescript/lib/component/table/Body.ts#L2071)) to drop the `PinnedTable` reference: `"verticalscroll"` has no consumer inside the library today and exists so a host rendering two bodies side by side can mirror one body's `scrollY` into the other; the `"horizontalscroll"` sentence stays as-is.
    **Check**: `grep -rn "PinnedTable" packages/lib/src/` — expect zero matches.

32. **`Header.ts` — window-width doc**: rewrite the class doc's second sentence ([:208-211](packages/lib/src/typescript/lib/component/table/Header.ts#L208)) to state that the header uses the same `computeColumnWindow` as the body but against the table's available column width — which excludes the vertical-scrollbar band the body's own width includes — so the two windows are near-identical rather than equal, with the shared buffer covering the difference.

33. **`Header.ts` — group-run cross-reference**: extend `rebuildParentCells`'s JSDoc ([:1032-1045](packages/lib/src/typescript/lib/component/table/Header.ts#L1032)) with a paragraph naming `Table.computeGroupRuns` and the one intended divergence (a run here continues across a shared `null` group key so adjacent ungrouped columns merge into one blank spanning cell; `computeGroupRuns` breaks the run on `null` and emits nothing for it).

34. **Test**: add the *Phase 3* cases from `## Expected Behaviour` — the `Util.range` cases to [`tests/unit/core/Util.test.ts`](packages/lib/tests/unit/core/Util.test.ts) (a new `describe('Util.range', …)` beside `Util.clamp`); the export-menu case to [`ColumnVisibilityMenu.test.ts`](packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts), reusing its existing `capturedMenuItems` helper; the row-height agreement case to [`Table.test.ts`](packages/lib/tests/component/table/Table.test.ts).

35. **Full verification pass** (see `## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/table/RowMetrics.ts` |
| Create | `packages/lib/tests/component/table/VisibleRecordQueryEconomy.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Util.ts` |
| Modify | `packages/lib/tests/unit/core/Util.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/table/Table.test.ts` |
| Modify | `packages/lib/tests/component/table/HeaderColumnWindow.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilterRow.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts` |

---

## Expected Behaviour

### Phase 1 — query economy (unit-testable)

Set-up for every case: a `Table` over a `MemoryStore` of 400 records, realized and laid out, then scrolled once so nothing measured is first-time work. Spy with `vi.spyOn(body as any, 'getVisibleRecords')`.

| Scenario | Assertion |
|---|---|
| Scroll down one row | call count ≤ 2 |
| Scroll down a full page (every pool slot rebinds) | **same** call count as the one-row tick |
| Either of the above with `table.setQuickSearch("…")` active | same call count as without it |
| Grow the pool (make the table taller), then repeat both | call counts unchanged — they must not scale with pool size |

The "same count for a one-row tick and a page jump" assertion is the load-bearing one: it is what proves the cost left the per-row loop. The `≤ 2` cap covers the render pass itself plus `_updateFocusStyle`'s anchor lookup when a row is selected.

### Phase 1 — cell-range drag economy (unit-testable)

Drive `onCellMouseDown` / `onCellDragMove` directly with synthetic events, as [`Body.test.ts:714`](packages/lib/tests/component/table/Body.test.ts#L714) already does.

- A `mousedown` on a data cell makes exactly one `getVisibleRecords()` call.
- A `mousemove` resolving to a **different** cell makes exactly one call.
- A `mousemove` resolving to the **same** cell as the current focus makes **zero** calls (the existing early return).
- A `mousemove` resolving to no cell at all makes zero calls.

### Phase 1 — behaviour preserved (unit-testable)

- Selecting a row tints exactly that row; selecting another moves the tint.
- A drag from cell (1,1) to (3,0) marks exactly that rectangle `.rangeSelected` and leaves every cell outside it unmarked.
- Scrolling a range-selected block out of view and back restores the highlight on the rebound rows.
- A pool slot whose bound index is past the end of the visible records — the store shrank between the bind and the paint — paints nothing and does not throw.
- A separator row is still skipped by the range highlight.

### Phase 2 — reconciler behaviour (unit-testable)

Column row:

- First render: one `HeaderCell` per column in the window, in slot order, each showing its column's header text and carrying `aria-colindex = col + 1`.
- Hiding a column (sets `_columnsDirty`): the cell set is rebuilt, leftover cells are removed and disposed, and every surviving cell's `aria-colindex` is rewritten.
- Scroll right by exactly one column (slide path): only the one entering cell is repointed. Spying on a survivor's `setHeaderText` shows zero calls for that tick.
- Scroll left by one column: same, on the other edge.
- A tick whose window and dirty flag are both unchanged: `reconcileColumnCells` returns `false` and `syncSortIndicators` is not called.
- After any path, `getColumns()[s]` is the cell for column `_windowFirst + s`.

Filter row — the same six cases hold against `getFilterRow()`, with `setColumnLabel` standing in for `setHeaderText` and no `syncSortIndicators` analogue, plus:

- `hasFilterRow()` false: every filter cell is removed and disposed and the row stays empty; a second call with nothing to do returns `false`.
- A non-filterable column's filter cell renders with an empty operator list.
- An entering filter cell shows the stored `ColumnFilterState` for its new column, or a single blank clause on the column's first operator when there is no stored state.
- Typing into a filter cell, scrolling it out of the window and back, shows the same filter text (the state lives on the header, not the cell).

### Phase 3 (unit-testable except where noted)

- `Util.range(2, 4)` → `[2, 3, 4]`; `Util.range(3, 3)` → `[3]`; `Util.range(3, 2)` → `[]`; `Util.range(-1, 1)` → `[-1, 0, 1]`.
- `tableRowHeight()` equals `Util.lineHeightPx() + 2 * ThemeManager.getTheme().table.cell.padding`, and the header row height, footer row height and body row height of a laid-out table are all equal to it.
- `showColumnMenu` lists the three export entries — CSV then JSON then TSV, glyphs `file-csv` / `file-code` / `file-lines` — in both the rotated branch and the normal branch, and the normal branch still precedes them with a separator.
- `renderWindowPass`'s `fieldCount` still equals the number of non-hidden model fields, so the effective-widths array keeps its length (covered by the existing `ColumnWidths.test.ts` / `ColumnWindow.test.ts`).
- Double-clicking a `DynamicCell`'s swapped-in renderer still starts an edit — **manual verification**; the offline harness drives handlers directly rather than dispatching real DOM double-clicks.

---

## Verification

1. `npm run typecheck` — clean.
2. `npm test` — the whole suite green. The table suites that must not regress: `Body.test.ts`, `Table.test.ts`, `ColumnWindow.test.ts`, `ColumnWindowSlide.test.ts`, `ColumnWidths.test.ts`, `HeaderColumnWindow.test.ts`, `HeaderThemeReflow.test.ts`, `ColumnFilterRow.test.ts`, `ColumnVisibilityMenu.test.ts`, `HeaderParentCellMerge.test.ts`, `HeaderMenuButton.test.ts`, `RowCellCache.test.ts`, `RowVisibility.test.ts`, `QuickSearch.test.ts`, `RotatedView.test.ts`, `RotatedGroupSeparators.test.ts`, `TreeBody.test.ts`, `ScrollRebindLayoutEconomy.test.ts`, `BindViewRenderEconomy.test.ts`, `CellLayoutSkip.test.ts`, `Table.classStyleDefaults.test.ts`.
3. `npm run lint` — clean, and no new entry in any ESLint baseline.
4. `npm run docs:api` — finishes with **zero** warnings (`Util.range` is new public API; `Body.on`'s remark changed).
5. Grep invariants:
   - `grep -rn "^function range(" packages/lib/src/typescript/lib/component/table/` → zero
   - `grep -rn "reconcileColumnWindowSlide\|reconcileFilterWindowSlide" packages/lib/src/` → zero
   - `grep -rn "PinnedTable" packages/lib/src/` → zero
   - `grep -rn "lineHeight + 2 \* padding" packages/lib/src/` → exactly one (`RowMetrics.ts`)
   - `grep -n "=> this.startEdit()" packages/lib/src/typescript/lib/component/table/cell/Cell.ts` → exactly one (the constructor site, deliberately left)
6. Manual smoke test — `npm run dev`, open `http://localhost:8015`, **Misc** panel:
   - *"Show window with wide table (45 columns)!"* — scroll horizontally and vertically; columns and headers stay aligned, no cell blanks out at either edge. Type in the quick-search field above the table and scroll again while it filters.
   - *"Show window with grouped wide table (25 columns, 4 groups)!"* — parent-header bands stay spanning the right columns while scrolling horizontally.
   - *"Show window with table (column spec)!"* — press *"Toggle filter row"*, type a filter, scroll that column out of the window and back; the text is still there. Right-click a header for the column menu and confirm the three export entries.
   - Drag-select a rectangle of cells across a scroll, then Ctrl/Cmd+C; the copied block matches the highlight.
   - Double-click a cell in the rotated-record demo (`RotatedRecordPanel`) — the editor opens.

---

## Documentation Impact

- **`Util.range`** renders automatically under the already-exported `Util` namespace ([`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts)), a TypeDoc entry point — same route `Util.clamp` took. No barrel or catalog edit.
- **`RowMetrics.ts`** is internal: not added to [`component/table/index.ts`](packages/lib/src/typescript/lib/component/table/index.ts), marked `@internal`.
- **`Body.on`'s `@remarks`** is public JSDoc on a barrel-exported class, so the corrected text ships in the generated API docs. Re-run `npm run docs:api` and confirm the `PinnedTable` link is gone.
- No changelog edit: there is no unreleased changelog page today (the newest is [`0.8.0.md`](packages/lib/docs/reference/changelog/0.8.0.md), matching the current package version), and this plan removes no public symbol and changes no public signature.

---

## Potential Challenges

- **A `Row` type mismatch in the generic reconciler.** `Row.addComponent` narrows its parameter to `Cell<any>` ([`Row.ts:359`](packages/lib/src/typescript/lib/component/table/Row.ts#L359)); constraining `TCell extends Cell<any>` keeps every call assignable, since both `HeaderCell` and `FilterCell` extend `Cell`.
- **Hoisting `rangeBounds` out of the bind loop could observe stale state** if anything inside the loop mutated `_rangeAnchor` / `_rangeFocus` or the store. Nothing does: open edits are committed by `commitEditsOutsideWindow` *before* `bindAndPositionRows` runs, and the loop's remaining work (`setData`, read-only/required tints, ARIA, geometry) only writes to cells.
- **`_columnsDirty` must be read before it is cleared.** The shared full path takes `dirty` as an argument; the caller clears the flag only after the shared call returns. Clearing it first would silently drop the "rewrite every ARIA index" behaviour on a column-set change.
- **Deleting `Body.computeRowHeight` orphans nothing else** — it has exactly two call sites, both listed in step 24. Its `@remarks` must survive the move or the "why `theme.table.cell.height` is ignored" reasoning is lost.
- **`layout/Table.ts` keeps its `Util` import but loses `ThemeManager`.** Removing one and not the other is easy to get backwards; the grep in step 25 plus `npm run lint` catch it.

---

## Critical Files

Read before starting:

- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — Phase 1's whole surface; also the `computeColumnWindow` / `computeColumnWindowSize` helpers both `Body` and `Header` window against.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) — Phase 2's whole surface.
- [`packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts`](packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts) — the precedent Phase 2's hook shape follows: one algorithm, caller-supplied accessors, `@internal`, not barrel-exported.
- [`plans/implemented/data-view-virtualization-consolidation.md`](plans/implemented/data-view-virtualization-consolidation.md) — the prior extraction in this series, and why `renderWindow` was deliberately *not* hoisted.
- [`plans/implemented/shared-clamp-timer-size-sentinel-utils.md`](plans/implemented/shared-clamp-timer-size-sentinel-utils.md) — the precedent for `Util.range`'s placement and JSDoc shape.
- [`packages/lib/src/typescript/lib/core/Util.ts:389-406`](packages/lib/src/typescript/lib/core/Util.ts#L389) — `Util.clamp`, the sibling `Util.range` is modelled on.
- [`packages/lib/src/typescript/lib/component/table/Footer.ts:13`](packages/lib/src/typescript/lib/component/table/Footer.ts#L13) — the `FOOTER_BG` named-constant pattern step 30 mirrors.
- [`packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts:228`](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L228) — the private arrow-field named-handler idiom step 26 follows.
- [`packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts) — the harness the new economy test copies.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Listeners must reference a named function*, and the cell-editor carve-out that covers listening on a privately-owned child but not an inline arrow.

---

## Non-Goals

- **Folding `Row.setColumnWindow`'s reconciler into the shared one.** It looks similar but is a different algorithm: cells carry a per-kind identity key, the recycle has three tiers (in-call free pool, the row's own cell cache, construct), leftovers are *retired* rather than disposed, and it maintains the parallel `_fieldNames` / `_cellKeys` / `_treeCell` arrays. Merging it would relocate complexity across a hook boundary rather than remove it.
- **The other inline-arrow `Event` listeners in the cell subsystem.** About twenty predate this audit window — in [`cell/Cell.ts:158`, `:165`, `:170`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L158), [`cell/Header.ts:246`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L246), and the six editor files under `cell/editor/`. Only the site added in this window ([`Cell.ts:762`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L762)) is fixed here; a sweep is its own change. `Cell.ts:170` in particular is the constructor's twin of the fixed site and is deliberately left as-is.
- **Sharing the visible-field derivation across `Body`, `Row` and `Header`.** [`Body.ts:518-524`](packages/lib/src/typescript/lib/component/table/Body.ts#L518) documents that duplication as deliberately tolerated, and `Header.rebuildParentCells`'s own derivation ([:1055-1057](packages/lib/src/typescript/lib/component/table/Header.ts#L1055)) is over `Column` objects, not `Field`s, so it is not the same expression anyway. Only the same-class redundancy inside `Body` is collapsed (step 29).
- **Merging `Table.computeGroupRuns` with `Header.rebuildParentCells`.** Cross-referenced instead — see the Architecture Decision.
- **Changing which width the body windows its columns against.** The doc is corrected instead — see the Architecture Decision.
- **Deduplicating `Header.positionColumnCells` / `positionFilterCells`.** They are seven lines each and were not part of the audit's findings.
- **Implementing [`plans/table-column-pinning.md`](plans/table-column-pinning.md).** Step 31 only removes the dead link to the component that plan would introduce.
- **Any behaviour or public-signature change.** Every phase is expected to leave rendered output identical.

---

## Notes

[^why-thread]: `AbstractStore.getRecords()` is `this._records.slice()` ([`AbstractStore.ts:631`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L631)) — a full `O(N)` copy on every call — and `Body.getVisibleRecords` adds a full `.filter()` on top whenever a row-visibility predicate is set ([`Body.ts:506-510`](packages/lib/src/typescript/lib/component/table/Body.ts#L506)). `Table.setQuickSearch` installs exactly such a predicate, composed through `composeRowVisible` ([`Table.ts:644`](packages/lib/src/typescript/lib/component/table/Table.ts#L644)). The reviewer measured a 4,000-row table with a 21-slot pool: a one-row scroll tick made 3 calls, a full-rebind page jump made 41, and with quick search active that page jump ran the predicate 164,000 times for a single tick. Caching the array on the component was rejected: it would add an invalidation surface across every store event, sort, filter, quick-search change and row-visibility change, for a value that is already cheap to compute once per pass. Threading it needs no invalidation at all, and the caller doc at [`Body.ts:1384`](packages/lib/src/typescript/lib/component/table/Body.ts#L1384) already claims this is how it works.

[^treebody]: Every call into `getVisibleRecords` on the hot path comes from `Body`'s own methods, which `TreeBody` does not override — it overrides `getVisibleRecords`, `createRow`, `getTreeFieldName`, `computeRowAria`, `afterRowBound`, `onStoreChange`, but not `bindAndPositionRows`, `updateRowVisualState`, `updateCellRangeVisualState` or `refreshCellRangeHighlight`. So the reduction is inherited, and `TreeBody.ts` needs no edit.

[^bounds-hoist]: `getCellRangeBounds` does two `indexOf` scans over the visible records ([`Body.ts:1651-1653`](packages/lib/src/typescript/lib/component/table/Body.ts#L1651)). Called from inside `updateCellRangeVisualState`, that is two scans *plus* one `getVisibleRecords()` per pooled row. During a cell-range drag, `onCellDragMove` runs `refreshCellRangeHighlight` on every mousemove that changes the resolved cell, so the whole thing ran once per pool slot per mousemove. After the change a mousemove costs one `getVisibleRecords()` and four `indexOf` scans total, independent of pool size.

[^private-not-shared]: `component/shared/` holds helpers shared *across* the three data-view families — `VirtualRowView` (table `Body` + `Tree`), `reduceModifierSelection` (both of those plus `MultiSelectList`), `selectionsEqual`. This reconciler has exactly two consumers and both are methods on `TableHeader`, so putting it there would misrepresent its scope and add an import edge for nothing. A private generic method also lets it read `this._visibleFields` directly instead of taking the field list as a parameter. A module-level function under `component/table/` was the alternative; it buys nothing over a private method when the only caller is the same class.

[^column-map]: `reconcileColumnCells` returns early on the common "window unchanged, nothing dirty" tick, which a sub-column horizontal scroll hits constantly. Building the lookup map before that guard would add an `O(columns)` allocation to the hottest path in the header — the exact shape of defect Phase 1 exists to remove. Building it inside the hook builder, called only past the guard, keeps that path free. It is also cheaper than what the slide paths do today, which is a linear `this._columns.find(...)` per entering cell ([`Header.ts:998`](packages/lib/src/typescript/lib/component/table/Header.ts#L998), [`:1586`](packages/lib/src/typescript/lib/component/table/Header.ts#L1586)).

[^group-runs]: The two scans are about ten lines each and diverge in two coupled ways, not one: the continuation test (`nextKey === runKey` in `rebuildParentCells` versus `runKey !== null && nextKey === runKey` in `computeGroupRuns`) and what a finished run emits (a blank spanning `ParentHeaderCell` for an ungrouped run in the header, nothing at all in the rotated view). A shared scan would need a boolean to select between them and would still leave each caller its own emit step — that relocates the divergence into a flag instead of removing it, which is what ARCHITECTURE.md's *Compose before specializing* count rules out. `Table.computeGroupRuns` already documents the relationship in its own JSDoc ([`Table.ts:1465-1482`](packages/lib/src/typescript/lib/component/table/Table.ts#L1465)); the header side gets the matching pointer so a future edit to either is visible from the other.

[^window-width]: `layout/Table.ts` sizes the body to `containerSize.width` ([`:435`](packages/lib/src/typescript/lib/layout/Table.ts#L435) region) and hands the header `availableWidth`, which is `getInnerSize().width - TRACK_WIDTH` ([`Table.ts:792`](packages/lib/src/typescript/lib/component/table/Table.ts#L792), `TRACK_WIDTH = 12`). Both then call the same `computeColumnWindow`. For a 600px-wide table the body windows against 600 and the header against 588 — a 12px difference against a `COLUMN_BUFFER` of two columns on each side, so the header's window is a subset of the body's in every realistic column width and no header cell is ever missing. The asymmetry is deliberate on both sides: the body's overlay scrollbar floats over rows that legitimately extend the full width, while the header reserves that 12px band for its column-menu button. Narrowing the body to `availableWidth` to make the doc literally true would stop rendering the column that paints under the scrollbar — a real regression to fix a wording problem.

[^range-guard]: The three local copies are `Array.from({ length: b - a + 1 }, …)` with no guard. `Array.from` with a negative `length` yields `[]` rather than throwing, so the guard changes no existing call site — every one of them passes `b >= a - 1`. It is added because a shared `Util` export is reachable from code that has not proved that, and because it makes the empty case something the JSDoc can state and a test can pin.
