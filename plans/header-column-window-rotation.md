---
depends-on: [table-column-window-rotation]
---

# Header Column Window Rotation — Implementation Plan

## Overview

An ordinary horizontal scroll on a wide table reconciles the header's column row and filter row from scratch on every tick. [`TableHeader.reconcileColumnCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L713) and [`TableHeader.reconcileFilterCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L1205) each rebuild two `Map`s and re-apply every per-column setter — `setFieldName`, `setHeaderText`, `setTooltip`, `setHeaderGlyph`, `setBaseBackground`, `setRequired` (column row) and `setFieldName`, `setColumnLabel`, `setOperators`, `setNumericOnly`, `setFilterState` (filter row), plus `getAria().setColIndex` on both — to every rendered cell, survivors included, even though an ordinary slide only ever adds or removes columns at the two edges of the window.

`Row.setColumnWindow`'s fast path ([Row.ts:435](packages/lib/src/typescript/lib/component/table/Row.ts#L435), dispatch at [Row.ts:481-489](packages/lib/src/typescript/lib/component/table/Row.ts#L481-L489), body at [Row.ts:652](packages/lib/src/typescript/lib/component/table/Row.ts#L652)) already solved this for the body's data cells in [`table-column-window-rotation.md`](plans/implemented/table-column-window-rotation.md), which explicitly named `TableHeader`'s reconciler as a same-shaped, deliberately deferred follow-on (its own `## Non-Goals`, and the paragraph at [table-column-window-rotation.md:75-78](plans/implemented/table-column-window-rotation.md#L75-L78)). This plan is that follow-on: it gives `reconcileColumnCells` and `reconcileFilterCells` a fast path that touches only the `|delta|` entering and leaving cells on an ordinary same-width slide, leaving every surviving cell untouched.

sqladmin's post-0.7.0 re-measurement (`LIBRARY_NOTES.md`, the "Horizontal scrolling a wide grid layout-thrashes" entry) found that Row's own fix did not close the horizontal/vertical frame-gap gap: horizontal scrolling on `wide.cols_60` at a maximized viewport still shows a Chrome `DOMSize` insight — 63-71% of the page's elements restyled per pass — while vertical scrolling on the same page does not. Its own conclusion narrows the remaining cause to "column-window reconciliation doing something row-window reconciliation does not," which — now that Row has its own fast path — points at exactly the reconciler this plan targets, since it is the only per-tick horizontal-scroll reconciler that never got the equivalent fix.

Header's cells turn out to need a *simpler* fast path than Row's, not the same one, because of a structural difference this plan's investigation surfaced: `HeaderCell` and `FilterCell` are single, generic classes — one `HeaderCell` type serves every column regardless of field type, and likewise for `FilterCell` — unlike `Row`'s per-type `StringCell`/`NumberCell`/etc. Row needs a reuse-key match (or a cache) because a cell built for one field type usually cannot serve a column of a different type. A header or filter cell has no such constraint: any cell can be repointed at any entering column just by re-running its setters. Because an eligible slide's departing-edge cell count always equals its entering-edge cell count exactly, the departing cells themselves are always sufficient to serve the entering columns — no cache, no construction, no disposal.

Only `Header.ts` changes. No public API is added or altered.

---

## Architecture Decisions

### The fast path derives its own slide plan; it does not consume `Body`'s

`TableHeader` computes its own column window independently: `renderColumnWindow` ([Header.ts:1333](packages/lib/src/typescript/lib/component/table/Header.ts#L1333)) calls `computeColumnWindow` against the header's own cached `_scrollX`/`_geometry`, and `setScrollX` ([Header.ts:1454](packages/lib/src/typescript/lib/component/table/Header.ts#L1454)) is driven by a plain `scrollLeft` number forwarded from `Body`'s `"horizontalscroll"` event (wired in [Table.ts:344-346](packages/lib/src/typescript/lib/component/table/Table.ts#L344-L346)) — `Body`'s own `ColumnWindowSlidePlan` ([Body.ts:1116](packages/lib/src/typescript/lib/component/table/Body.ts#L1116)) never reaches `Header` today. This plan keeps it that way: `reconcileColumnCells`/`reconcileFilterCells` derive eligibility and `delta` from their own previous window state (`_windowFirst`/`_filterWindowFirst` and the row's current child count), computed inline, the same way the existing early-return check already does.[^why-not-body-plan]

### Eligibility mirrors `Row`'s, computed against `TableHeader`'s own state

The fast path applies when, for the column row: `!this._columnsDirty`, the new window is the same width as the row's current child count, and `0 < |delta| < width` where `delta = firstCol - this._windowFirst`. The filter row uses the same shape against `!this._filterCellsDirty` and `_filterWindowFirst`. This is the identical derived crossover point `table-column-window-rotation.md` established (below it nothing survives to preserve; at or above it every column changes) — see that plan's "threshold derivation" reasoning, which applies unchanged here.

| Case | Previous window | New window | Fast path? | Why |
|---|---|---|---|---|
| Ordinary one-column right slide | `[3, 10]` (width 8) | `[4, 11]` (width 8) | Yes | Same width, `delta = 1`, overlaps |
| Fast wheel scroll, several columns in one tick | `[3, 10]` | `[6, 13]` | Yes | Same width, `delta = 3 < 8`, overlaps |
| Fling / `scrollTo` far away | `[3, 10]` | `[40, 47]` | No | `delta = 37 ≥ width` — no overlap |
| Viewport resize widens the window | `[3, 10]` (width 8) | `[3, 14]` (width 12) | No | Width changed |
| First render | *(none — 0 rendered cells)* | `[0, 7]` | No | `prevWidth = 0 ≠ 8` |
| Column hide/show, config swap | any | any | No | `_columnsDirty` / `_filterCellsDirty` set, independent of the window math |

### No cache, no reuse key: the departing cells directly serve the entering columns

Because `HeaderCell` and `FilterCell` carry no per-type identity, `Row.cellKey`'s whole reason to exist — matching a cell to a column it can actually render — has no equivalent here. An eligible slide's departing edge and entering edge are always the same size (`|delta|` on both), so the fast path takes the departing cells' array slice directly as the entering cells' array slice: no `_cellCache`, no construction, no `removeComponent`/`addComponent` round trip. Each reused cell keeps its `Component` identity and DOM element throughout; only its layout-constraints `data` and its per-column setters change.[^why-no-cache]

### Entering-column lookups skip the full-list `Map`, on purpose

The existing full path builds `columnMap` from *every* column in `this._columns` because it re-applies state to every column in the window. The fast path only ever needs `|delta|` columns' worth of `Column` lookups (typically 1-3), so it resolves each one with `this._columns.find(...)` instead of building a `Map` sized to the whole column list. This is a genuine, if secondary, saving the fast path adds beyond what `Row`'s precedent needed, because `Row` never had an equivalent full-list `Map` in its own hot path.[^find-vs-map]

### `syncSortIndicators` is scoped to the entering cells; `applyFocusedColumn` is not

`renderColumnWindow` calls both after any reconcile that reports a change. `syncSortIndicators` ([Header.ts:1004](packages/lib/src/typescript/lib/component/table/Header.ts#L1004)) calls `HeaderCell.setSortState`/`clearSortState` on every rendered cell, and both call `_renderTitle()` → `Text.setText()` ([component/input/Text.ts:805](packages/lib/src/typescript/lib/component/input/Text.ts#L805)) unconditionally — no equality guard, a real DOM text write plus `scheduleLayout()` on every call. Left unscoped, this would still touch every surviving cell on every ordinary slide and defeat much of this plan's point. `applyFocusedColumn` ([Header.ts:1501](packages/lib/src/typescript/lib/component/table/Header.ts#L1501)) calls `HeaderCell.setColumnFocused`, which only ever writes through `setShadow`/`clearShadow` ([core/Component.ts:2655-2679](packages/lib/src/typescript/lib/core/Component.ts#L2655-L2679)) — both already idempotent ("a repeat call with the same value writes nothing"). Scoping `applyFocusedColumn` would save a comparison, not a write, so it is left as a full sweep.

`syncSortIndicators` gains an optional `cells?: HeaderCell[]` parameter, defaulting to a full sweep when omitted (mirrors `Body.wireRowCells`'s exact fallback shape from the precedent plan). It is called with the fast path's entering-cell list when the fast path ran, and with no argument otherwise — first render, a jump, a resize, or a column-set change all keep today's full sweep. This is provably safe: a survivor's own field never changes across a slide, and its correct sort/priority state depends only on that field plus `_store.getActiveSorters()`, which is also unchanged mid-slide — so a survivor's indicator cannot be stale after a slide the way an entering cell's inherited indicator can be.[^syncsort-simplification]

---

## Public API

No public API changes. `reconcileColumnCells`, `reconcileFilterCells`, the two new private slide methods, and the widened `syncSortIndicators` are all private members of `TableHeader`.

---

## Internal Structure

### `range()` helper

Added as a module-level function near the top of `Header.ts`, after the existing constants — not exported, mirroring the identical helper already duplicated in `Row.ts` and `Body.ts`:

```typescript
/** Inclusive integer range `[a, b]` as an array, e.g. `range(2, 4)` -> `[2, 3, 4]`. */
function range(a: number, b: number): number[] {
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
```

### New field: `_lastEnteredCells`

Placed next to `_columnsDirty`:

```typescript
// Cells `reconcileColumnCells` repointed at a new column on its last fast-path
// slide, in no particular order. `undefined` means the last reconcile either
// made no change or took the full path, so `renderColumnWindow` must sweep
// every rendered cell instead of scoping to this list. Reset at the top of
// every `reconcileColumnCells` call.
private _lastEnteredCells: HeaderCell[] | undefined = undefined;
```

### `reconcileColumnCells` — eligibility check and dispatch

Restructured so the previous window's width is available to the eligibility check, inserted between the existing early-return and the existing `columnMap`/`byName` construction:

```typescript
private reconcileColumnCells(firstCol: number, lastCol: number): boolean {
    const row = this.getComponents()[1] as Row;

    this._lastEnteredCells = undefined;

    const prevFirst = this._windowFirst;
    const prevWidth = row.getComponents().length;
    const prevLast  = prevFirst + prevWidth - 1;

    if (!this._columnsDirty && firstCol === prevFirst && lastCol === prevLast) {
        return false;
    }

    const width = lastCol - firstCol + 1;
    const delta = firstCol - prevFirst;

    if (!this._columnsDirty && width === prevWidth && delta !== 0 && Math.abs(delta) < width) {
        this._lastEnteredCells = this.reconcileColumnWindowSlide(row, firstCol, lastCol, delta);
        this._windowFirst = firstCol;

        return true;
    }

    // ... existing columnMap / byName / pass 1 / pass 2 / pass 3 / discard /
    // reorder code, unchanged, still ending in `this._windowFirst = firstCol;
    // this._columnsDirty = false; return true;` ...
}
```

### `reconcileColumnWindowSlide` — the fast path

Placed directly after `reconcileColumnCells`:

```typescript
/**
 * Reconciles an ordinary same-width slide: repoints the `|delta|` departing
 * cells directly onto the `|delta|` entering columns and leaves every
 * surviving cell untouched. A header cell carries no per-column type
 * identity — unlike a body `Cell` — so the departing edge is always exactly
 * the right size and shape to serve the entering edge: no cache,
 * construction, or disposal is needed, and no detach/reattach either, since
 * every cell stays a mounted child throughout.
 *
 * @param row - The column row.
 * @param firstCol - The first visible-column index to render, inclusive.
 * @param lastCol - The last visible-column index to render, inclusive.
 * @param delta - `firstCol` minus this header's previous window start.
 *   Positive: window moved right. Negative: moved left. Never zero.
 * @returns The cells repointed at a new column this call, for the caller to
 *   scope `syncSortIndicators` to.
 */
private reconcileColumnWindowSlide(row: Row, firstCol: number, lastCol: number, delta: number): HeaderCell[] {
    const width    = lastCol - firstCol + 1;
    const outCount = Math.abs(delta);

    // Snapshot first — `sortComponents` below reorders the live array, and
    // nothing here may observe that reordering mid-method.
    const cells = [...row.getComponents()] as HeaderCell[];

    const survivorCells = delta > 0 ? cells.slice(outCount) : cells.slice(0, width - outCount);
    const enteringCells = delta > 0 ? cells.slice(0, outCount) : cells.slice(width - outCount);

    const enteringCols = delta > 0
        ? range(lastCol - outCount + 1, lastCol)
        : range(firstCol, firstCol + outCount - 1);

    enteringCols.forEach((col, i) => {
        const cell   = enteringCells[i];
        const field  = this._visibleFields[col];
        const column = this._columns.find(c => c.getField().getName() === field.getName());

        row.setLayoutConstraints(cell, { data: field });

        cell.setFieldName(field.getName());
        cell.setHeaderText(column?.getHeaderText() ?? field.getName());

        const description = field.getDescription();

        if (cell.getTooltip() !== description) {
            cell.setTooltip(description);
        }

        const headerGlyph = column?.getHeaderGlyph() ?? null;

        if (cell.getHeaderGlyph() !== headerGlyph) {
            cell.setHeaderGlyph(headerGlyph);
        }

        cell.setBaseBackground(column?.getGroupColor() ?? null);
        cell.setRequired(column?.isRequired() ?? false);
        cell.getAria().setColIndex(col + 1);
    });

    const slotOf = new Map<HeaderCell, number>();

    survivorCells.forEach((cell, i) => slotOf.set(cell, delta > 0 ? i : i + outCount));
    enteringCells.forEach((cell, i) => slotOf.set(cell, delta > 0 ? width - outCount + i : i));

    row.sortComponents((c1, c2) => (slotOf.get(c1 as HeaderCell) ?? 0) - (slotOf.get(c2 as HeaderCell) ?? 0));

    return enteringCells;
}
```

### `reconcileFilterCells` — eligibility check and dispatch

Same shape, inserted between the existing early-return (inside the `hasFilterRow()` branch) and the existing `columnMap`/`byName` construction; the `!hasFilterRow()` disable branch above it is untouched:

```typescript
private reconcileFilterCells(firstCol: number, lastCol: number): boolean {
    const row = this.getFilterRow();

    if (!this.hasFilterRow()) {
        // ... unchanged ...
    }

    const prevFirst = this._filterWindowFirst;
    const prevWidth = row.getComponents().length;
    const prevLast  = prevFirst + prevWidth - 1;

    if (!this._filterCellsDirty && firstCol === prevFirst && lastCol === prevLast) {
        return false;
    }

    const width = lastCol - firstCol + 1;
    const delta = firstCol - prevFirst;

    if (!this._filterCellsDirty && width === prevWidth && delta !== 0 && Math.abs(delta) < width) {
        this.reconcileFilterWindowSlide(row, firstCol, lastCol, delta);
        this._filterWindowFirst = firstCol;

        return true;
    }

    // ... existing columnMap / byName / pass 1 / pass 2 / pass 3 / discard /
    // reorder code, unchanged ...
}
```

### `reconcileFilterWindowSlide` — the fast path

Placed directly after `reconcileFilterCells`. Same repoint shape as the column row; no return value needed since `reconcileFilterCells` has no downstream scoped sweep to hand it to (see `## Architecture Decisions`):

```typescript
private reconcileFilterWindowSlide(row: Row, firstCol: number, lastCol: number, delta: number): void {
    const width    = lastCol - firstCol + 1;
    const outCount = Math.abs(delta);

    const cells = [...row.getComponents()] as FilterCell[];

    const survivorCells = delta > 0 ? cells.slice(outCount) : cells.slice(0, width - outCount);
    const enteringCells = delta > 0 ? cells.slice(0, outCount) : cells.slice(width - outCount);

    const enteringCols = delta > 0
        ? range(lastCol - outCount + 1, lastCol)
        : range(firstCol, firstCol + outCount - 1);

    enteringCols.forEach((col, i) => {
        const cell      = enteringCells[i];
        const field     = this._visibleFields[col];
        const column    = this._columns.find(c => c.getField().getName() === field.getName());
        const operators = column?.isFilterable() ? columnFilterOperators(field.getType()) : [];

        row.setLayoutConstraints(cell, { data: field });

        cell.setFieldName(field.getName());
        cell.setColumnLabel(column?.getHeaderText() ?? field.getName());
        cell.setOperators(operators);

        const target = this.filterTarget(field.getName());

        cell.setNumericOnly(target !== null && columnFilterTakesNumericOperand(target));
        cell.getAria().setColIndex(col + 1);

        if (operators.length > 0) {
            cell.setFilterState(this.filterState().get(field.getName())
                ?? { clauses: [{ operator: operators[0], text: '' }] });
        }
    });

    const slotOf = new Map<FilterCell, number>();

    survivorCells.forEach((cell, i) => slotOf.set(cell, delta > 0 ? i : i + outCount));
    enteringCells.forEach((cell, i) => slotOf.set(cell, delta > 0 ? width - outCount + i : i));

    row.sortComponents((c1, c2) => (slotOf.get(c1 as FilterCell) ?? 0) - (slotOf.get(c2 as FilterCell) ?? 0));
}
```

### `syncSortIndicators` — scoped variant

Widened signature; body rewritten to read each cell's own field directly instead of indexing `_visibleFields` by slot — this also removes the method's implicit dependency on slot/array-position alignment, which the scoped call (an arbitrary subset, not a prefix) would otherwise violate:

```typescript
private syncSortIndicators(cells?: HeaderCell[]): void {
    const sorters       = this._store.getActiveSorters();
    const fieldToSorter = new Map(sorters.map((s, i) => [s.field, { dir: s.dir, priority: i + 1 }]));
    const showPriority  = sorters.length > 1;

    for (const cell of cells ?? (this.getColumns() as HeaderCell[])) {
        const entry = fieldToSorter.get(cell.getFieldName());

        if (entry) {
            cell.setSortState(entry.dir, showPriority ? entry.priority : null);
        } else {
            cell.clearSortState();
        }
    }
}
```

### `renderColumnWindow` — threading the scope through

```typescript
renderColumnWindow(geometry?: HeaderColumnGeometry): this {
    // ... unchanged geometry / win computation ...

    const changed = this.reconcileColumnCells(win.firstCol, win.lastCol);

    if (changed) {
        this.syncSortIndicators(this._lastEnteredCells);
        this.applyFocusedColumn();
    }

    // ... unchanged positionColumnCells / positionParentCells /
    // reconcileFilterCells / positionFilterCells ...
}
```

---

## Ordered Implementation Steps

All line numbers below are current as of this plan's drafting (`git log -1` = `f5790f38`); re-anchor with `grep -n` before editing if the file has moved on.

1. **`Header.ts` — add the module-level `range()` helper**, placed after the existing constants (near [Header.ts:57](packages/lib/src/typescript/lib/component/table/Header.ts#L57)), per `## Internal Structure`.

2. **`Header.ts` — add `_lastEnteredCells`** as a new private field next to `_columnsDirty` ([Header.ts:134](packages/lib/src/typescript/lib/component/table/Header.ts#L134)).

3. **`Header.ts` — restructure `reconcileColumnCells`'s top** ([Header.ts:713](packages/lib/src/typescript/lib/component/table/Header.ts#L713)): reset `_lastEnteredCells`, compute `prevFirst`/`prevWidth`/`prevLast` ahead of the existing early-return, keep the early-return's condition equivalent, then insert the eligibility check and fast-path dispatch immediately after it and before the existing `columnMap` construction. Per `## Internal Structure`.

4. **`Header.ts` — add `reconcileColumnWindowSlide`**, placed directly after `reconcileColumnCells`, using the full body from `## Internal Structure`.

5. **Checkpoint.** `cd packages/lib && npm run typecheck` — clean.

6. **`Header.ts` — restructure `reconcileFilterCells`'s top** ([Header.ts:1205](packages/lib/src/typescript/lib/component/table/Header.ts#L1205)): keep the existing `!hasFilterRow()` branch untouched, then apply the same restructuring as step 3 to the branch below it, using `_filterCellsDirty`/`_filterWindowFirst`.

7. **`Header.ts` — add `reconcileFilterWindowSlide`**, placed directly after `reconcileFilterCells`, using the full body from `## Internal Structure`.

8. **Checkpoint.** `npm run typecheck` — clean.

9. **`Header.ts` — rewrite `syncSortIndicators`** ([Header.ts:1004](packages/lib/src/typescript/lib/component/table/Header.ts#L1004)) to accept the optional `cells?: HeaderCell[]` parameter and iterate `cell.getFieldName()` directly, per `## Internal Structure`. Leave `applyFocusedColumn` untouched.

10. **`Header.ts` — thread the scope through `renderColumnWindow`** ([Header.ts:1333](packages/lib/src/typescript/lib/component/table/Header.ts#L1333)): change `this.syncSortIndicators();` to `this.syncSortIndicators(this._lastEnteredCells);`. No other line in this method changes.

11. **Checkpoint.** `npm run typecheck` — clean. `grep -n "this.syncSortIndicators(" src/typescript/lib/component/table/Header.ts` — expect exactly two matches: `renderColumnWindow`'s new `(this._lastEnteredCells)` call and `handleSortClick`'s existing no-argument call (unchanged — `handleSortClick` still calls it directly, not through a reconcile, so it correctly keeps the full sweep).

12. **Write the tests** — see `## Expected Behaviour` and `## Verification`.

13. **Update documentation** — see `## Documentation Impact`.

14. **Re-run the full verification** in `## Verification`, including the manual browser re-measurement.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/tests/component/table/HeaderColumnWindow.test.ts` |
| Modify | `packages/lib/docs/components/TableInternals.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Build fixtures the same way the existing suite does — `wideTable(n, spec, model)`, `render20At100(table, scrollX)` — from `HeaderColumnWindow.test.ts`'s own helpers. New cases are numbered continuing from the file's existing 1-37, in a new `describe('Header column window — fast-path slide', ...)` block.

**Column row:**

38. **A one-column right slide repoints the departing header cell onto the entering column with zero `HeaderCell` construction.** Spy on the `HeaderCell` constructor (`vi.spyOn` on the module's exported class, or a `vi.fn()` wrapper installed before the table is built); `render20At100(table, 550)`, clear the spy's call count, then `header(table).setScrollX(650)`. Assert zero constructor calls. (This is the fast-path-specific companion to the existing test 9, which already pins the identity result — this case pins that no construction happened to produce it.)
39. **The same slide calls `setFieldName`/`setHeaderText`/`getAria().setColIndex` exactly once each — not once per rendered cell.** Spy on `HeaderCell.prototype.setFieldName` (and similarly for the other two); assert `mock.calls.length === 1` after the slide in case 38's setup, versus the 8 calls the full path would have made.
40. **A multi-column slide within one tick touches exactly `|delta|` cells, not `width` many.** `render20At100(table, 550)` (window 3-10, width 8), then `setScrollX(950)` — a 4-column slide. Exactly 4 cells are repointed (their `getFieldName()` changes); the other 4 are the exact same objects at the exact same field (`toBe` identity, `getFieldName()` unchanged) — mirrors `table-column-window-rotation.md`'s case 3.
41. **A left slide repoints the cell(s) at the trailing edge, not the leading edge.** From window `[6, 13]`, slide left to `[4, 11]`: the cells that were rendering columns 12-13 are the ones now rendering columns 4-5 (identity `toBe`), and the cells that were rendering columns 6-11 are untouched.

**Filter row** (`setFilterRowVisible(true)` first; build fixtures with at least one filterable column):

42. **A one-column slide repoints the departing filter cell onto the entering column with zero `FilterCell` construction**, mirroring case 38.
43. **The recycled filter cell's field, operators, and numeric-only flag match the entering column, not the departing one** — construct with column 3 filterable-string and column 11 filterable-number, slide, and assert `getFieldName()` reports column 11. `FilterCell` has no public getter for its operator list or numeric-only flag, so assert those via `vi.spyOn(FilterCell.prototype, 'setOperators')` / `vi.spyOn(FilterCell.prototype, 'setNumericOnly')` call-args checks (`columnFilterOperators('number')` and `true`, respectively, for column 11) rather than a direct read.
44. **A column's cached filter text survives a fast-path slide out and back within one session**, because `_filterStates` is keyed by field name, not by cell identity: drive a `"filterchange"` event on column 3's cell with `immediate: true` (so the write isn't debounce-pending), scroll it out of the window (fast-path slide), scroll back so column 3 re-enters (a second fast-path slide, opposite direction) — the re-entering cell's `getFilterState()` still reports the typed clause.

**Scoped post-processing:**

45. **A fast-path slide does not call `setSortState`/`clearSortState` on any surviving cell.** Set an active sort on a column that stays in the window across the slide (a survivor); spy on `HeaderCell.prototype.setSortState` and `.clearSortState`; slide; assert neither was called for that cell.
46. **A fast-path slide that brings in a sorted column shows the arrow on the entering cell.** Sort a column that is currently outside the window but will enter on the next slide (mirrors existing test 14, but specifically through a same-width slide rather than the buffered first-render-to-scrolled transition test 14 already exercises); after the slide, the entering cell's `getSortState()` matches.

**Eligibility / fallback (all reuse the existing full-path assertions, confirming they still apply after this change):**

47. **A viewport resize (window-width change) still takes the full path even though the same tick also scrolled.** Construct a scenario where `renderColumnWindow`'s geometry argument changes column count alongside a scroll offset change; assert the resulting cell set matches full-path semantics (a construction/dispose event fires for any column outside the previous window, per the existing byName-matching tests).
48. **A jump (`|delta| ≥ width`) still reconciles via the full path.** `render20At100(table, 550)` then `setScrollX` to a far offset (`|delta| ≥ 8`); assert the full path's byName-matching behavior still applies (reuse the shape of existing tests 9-13, now at a jump instead of a slide).
49. **A column-set change (`_columnsDirty`) takes the full path even when the numeric window looks like a slide.** After `setColumnVisible` hides a column, the next `renderColumnWindow` call takes the full path regardless of `firstCol`/`lastCol`'s relationship to the previous window — assert via a `HeaderCell` construction/dispose spy showing the full path's leftover-discard behavior, not the fast path's zero-construction behavior.

All cases are unit-testable offline against `installTestDOM`, no manual-only behaviour among them — geometry/layout correctness is already covered by the existing "geometry diffing" suite and is unaffected by this plan (see `## Architecture Decisions`).

---

## Verification

```bash
cd packages/lib
npm run typecheck
npm run test          # includes the new fast-path describe block in HeaderColumnWindow.test.ts
npm run lint
npm run docs:api      # must finish with zero warnings
grep -n "this.syncSortIndicators(" src/typescript/lib/component/table/Header.ts   # expect exactly two matches
```

Existing tests that must keep passing **without modification**, now exercising the fast path (their setups are confirmed same-width, one-column-delta slides by direct computation against `render20At100`'s 20-column/100px/250px-viewport geometry):

- `HeaderColumnWindow.test.ts` → cases 8, 9, 10, 11, 12, 13 (`'Header column window — recycling'`)
- `HeaderColumnWindow.test.ts` → case 27, 27b (`'Header column window — slot order with tied field order'`)
- `HeaderColumnWindow.test.ts` → case 28b, 29 (`'Header column window — geometry diffing'`)

Existing tests that must keep passing **unmodified**, continuing to exercise the **full** path (their setups have a width change or a dirty flag, confirmed by direct computation, so this plan does not change which code they run):

- `HeaderColumnWindow.test.ts` → cases 1-7 (window coverage, slot mapping on first render/large jump)
- `HeaderColumnWindow.test.ts` → cases 14-16 (sort state — `handleSortClick`'s own unscoped `syncSortIndicators()` call is untouched)
- `HeaderColumnWindow.test.ts` → cases 17-26 (column-set changes, parent row, rotated mode, teardown)
- `HeaderColumnWindow.test.ts` → cases 30-37 (width changes, re-renders at identical geometry, glyph mounting)

Manual re-measurement, mirroring the protocol sqladmin's `LIBRARY_NOTES.md` already established for this exact investigation (symlinked `dist/lib` build, `wide.cols_60` demo table, a maximized/large viewport, a Chrome performance trace during a direction-reversing `WheelEvent` burst): confirm the `DOMSize` insight's per-pass "elements affected" percentage drops from the ~63-71% baseline that entry measured, and that the horizontal-burst frame-gap numbers (worst gap, percentage of frames over 100 ms) move closer to the vertical-burst numbers from the same entry, rather than the roughly 3-4x gap it found. A successful result is not "no `DOMSize` insight at all" (the entry's own history shows that can be a viewport-size false negative) — it is a materially smaller affected-element percentage at the *same* maximized viewport size used before, checked against a fresh trace rather than assumed.

---

## Documentation Impact

No consumer-visible export changes.

- [`packages/lib/docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md) — the `TableHeader` paragraph (line 19) currently doesn't describe column recycling at all beyond "builds one `HeaderCell` per column in its current column window." Add a sentence mirroring the `Row` paragraph immediately below it (line 39, already updated by `table-column-window-rotation.md`): a header or filter cell whose column leaves the window is recycled for an entering column (any cell can serve any column, since neither cell type carries per-column type identity), and an ordinary one-direction slide reconciles only the columns actually entering or leaving, not the whole rendered range.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — add a bullet under `## Changed` → `### Components`, in the voice `0.7.0.md`'s own equivalent entry used ([0.7.0.md:131-135](packages/lib/docs/reference/changelog/0.7.0.md#L131-L135)): the table header's column and filter rows now touch only the columns entering or leaving the visible window during an ordinary horizontal scroll, instead of re-deriving every rendered cell's state on every tick; a resize, a column-set change, or a jump larger than the visible window still reconciles the whole window as before. No consumer action is needed.

---

## Potential Challenges

- **Getting the `delta > 0` vs `delta < 0` slice/slot arithmetic backwards would silently swap which edge is retired and which is repointed**, the same risk `table-column-window-rotation.md`'s own Implementation Notes recorded for `Row`. Mitigated by cases 38-41, which pin exact cell identity for both directions, plus the existing geometry-diffing suite (28b, 29) which independently confirms per-column position correctness.
- **`sortComponents` reorders the live child array; nothing before it may hold a reference expecting the old order.** The fast path computes `survivorCells`/`enteringCells`/`enteringCols` from a `[...row.getComponents()]` snapshot taken before any mutation, exactly mirroring the snapshot-first fix `table-column-window-rotation.md`'s Implementation Notes made to `Row.reconcileWindowSlide` after the same hazard surfaced there in review — applying that lesson up front here rather than re-discovering it.
- **A survivor's sort/focus correctness after scoping depends on the "field and store state are both unchanged for a survivor" argument holding in every reachable case**, not just the ordinary slide this plan tests directly. Mitigated by restricting the scoped call to the fast path only (see `## Architecture Decisions`) — every other route (first render, resize, column-set change, jump) keeps today's unscoped full sweep, so the argument only has to hold for the one case this plan actually changes.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) — read `reconcileColumnCells`, `reconcileFilterCells`, `syncSortIndicators`, `applyFocusedColumn`, and `renderColumnWindow` in full before editing; every one of them constrains this change.
- [`packages/lib/src/typescript/lib/component/table/Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) — `setColumnWindow`'s eligibility check ([Row.ts:481-489](packages/lib/src/typescript/lib/component/table/Row.ts#L481-L489)) and `reconcileWindowSlide` ([Row.ts:652](packages/lib/src/typescript/lib/component/table/Row.ts#L652)) are the direct precedent this plan mirrors for the slide-detection shape, though not for the cache mechanics — see `## Architecture Decisions`' "no cache" decision for why.
- [`plans/implemented/table-column-window-rotation.md`](plans/implemented/table-column-window-rotation.md) — the plan this one follows on from; read its `## Architecture Decisions` and `## Implementation Notes` (the latter records two review-caught bugs — the live-array snapshot hazard and a scoping-correctness gap — both directly relevant here).
- [`packages/lib/src/typescript/lib/component/table/cell/Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts) — `HeaderCell`'s constructor and `setFieldName`/`setHeaderText`/`_renderTitle`/`setSortState`/`clearSortState`/`setColumnFocused`, to confirm which setters are idempotent (`setColumnFocused`, via `setShadow`) and which are not (`setHeaderText`/`setSortState`/`clearSortState`, via `Text.setText`).
- [`packages/lib/src/typescript/lib/component/table/cell/Filter.ts`](packages/lib/src/typescript/lib/component/table/cell/Filter.ts) — `FilterCell`'s constructor and `setFieldName`/`setOperators`/`setFilterState`, to confirm the filter row's cells are equally generic (single class, no per-type identity) and that per-column filter *text* persistence lives in `TableHeader._filterStates`, not on the cell.
- [`packages/lib/tests/component/table/HeaderColumnWindow.test.ts`](packages/lib/tests/component/table/HeaderColumnWindow.test.ts) — read the whole file before adding cases; several existing cases (8-13, 27, 27b, 28b, 29) become fast-path coverage automatically and must not be touched.
- `/home/jika/typescript/sqladmin/LIBRARY_NOTES.md` — the "Horizontal scrolling a wide grid layout-thrashes on `getBorderWidths`" entry (and its later corrections/updates) is this plan's evidence trail and its manual-verification protocol; read it before running the re-measurement in `## Verification`.

---

## Non-Goals

- **`Row.createCellForField`'s cold-cache construction cost, and the `insertRule`-on-shared-stylesheet question.** A separate, already-identified contributor to the same broader performance investigation; out of scope here regardless of outcome.
- **Threading `Body`'s `ColumnWindowSlidePlan` through to `Header`.** Considered and rejected — see the "why not Body's plan" footnote. `Header` already computes everything it needs from its own state; wiring Body's plan through `Table`'s `"horizontalscroll"` event would widen a cross-component API for a plan shape (`enteringKeys`, a type-based reuse key) `Header`'s generic cells have no use for.
- **A `_cellCache`-style narrow/widen restore cache for `HeaderCell`/`FilterCell`**, matching `Row`'s. Header currently disposes leftover cells on a narrowing full-path reconcile and has never restored them on a later widen; adding that is a distinct feature (surviving a narrow-then-widen round trip without reconstruction), not a fix for ordinary contiguous-scroll cost, and this plan does not add it.
- **`applyFocusedColumn` scoping.** Already idempotent at the write layer (`setShadow`/`clearShadow`) — see `## Architecture Decisions`. Scoping it would save a per-cell comparison, not a DOM write.
- **The parent-header row (`rebuildParentCells`/`ParentHeaderCell`).** Already outside the per-scroll-tick path — it rebuilds only from `setColumns`/`setHiddenColumns`/`setModel`, never from `renderColumnWindow`/`setScrollX`, and its per-tick positioning (`positionParentCells`) is already O(spans), not O(columns). Nothing here needs changing.
- **Backfilling general filter-row test coverage.** `HeaderColumnWindow.test.ts` has no existing describe block for `reconcileFilterCells`'s ordinary (full-path) recycling behavior. This plan adds only the coverage its own new fast-path code needs (cases 42-44); a full backfill of the pre-existing gap is a separate task.

---

## Notes

[^why-not-body-plan]: `Body`'s `ColumnWindowSlidePlan` exists because `Body` drives many pooled `Row` instances that can each independently lag `Body`'s own tick-to-tick window (a row hidden by a vertical resize keeps its stale `_windowFirst` until it's revealed again) — the plan object is how each row cross-checks its own state against what `Body` actually did last tick. `TableHeader` has no pooling and no analogous staleness: it is a single instance that reconciles synchronously with itself on every call, so its own `_windowFirst`/`_filterWindowFirst` are never behind what it last rendered. There is nothing for an externally-supplied plan to correct that the header's own before/after comparison doesn't already have. Reusing `ColumnWindowSlidePlan`'s actual shape would also be a poor fit even ignoring that: its `enteringKeys: Map<number, string>` field exists purely to save `Row`'s per-column reuse-key computation, and `Header`'s cells have no reuse key to save (see the "no cache" decision) — a `Header`-side consumer of that field would have nothing to do with it.

[^why-no-cache]: A cache tier (mirroring `Row`'s `_cellCache`) would exist to handle a case where the number of cells needing a new column doesn't match the number of cells becoming free — e.g. a widen after a narrow, where more columns need cells than were freed. That mismatch cannot happen in the fast path's own eligibility window: by construction, an eligible slide has exactly `|delta|` departing cells and exactly `|delta|` entering columns (same width, both ends of the same-sized window), so the departing cells are both necessary and sufficient. A cache would add real code (allocation, key computation, retire/restore bookkeeping) to handle a mismatch that provably cannot occur inside this fast path's own guard conditions.

[^find-vs-map]: Building `columnMap` once and doing `width` map lookups costs roughly `O(totalColumns + width)`; doing `|delta|` linear `.find()` calls costs `O(delta × totalColumns)`. For the fast path's own regime (`delta` small, typically 1-3, versus `width` which can be 10-20+), `.find()` wins in the common case and only approaches parity as `delta` grows toward `width` — at which point the eligibility guard is already close to excluding the slide entirely (`delta < width` is required, and the win shrinks as `delta` approaches that bound, the same diminishing-returns shape `table-column-window-rotation.md`'s own "threshold derivation" describes for `Row`'s equivalent boundary). The full path's own `columnMap` is untouched by this reasoning — it still touches every column in the window, where the `Map` remains the right tool.

[^syncsort-simplification]: The rewrite from slot-indexed (`this._visibleFields[this._windowFirst + slot]`) to field-indexed (`cell.getFieldName()`) is safe because `reconcileColumnCells`'s pass 3 (full path) and `reconcileColumnWindowSlide` (fast path) both call `cell.setFieldName(field.getName())` on every cell they touch before `syncSortIndicators` ever runs — a rendered cell's own `getFieldName()` is therefore always authoritative for "which column does this cell actually present," independent of its position in the child array. This was a needed change, not an optional cleanup: the old slot-indexed version assumed `cells[slot]` and `_visibleFields[windowFirst + slot]` refer to the same column, which is exactly the assumption a scoped call (an arbitrary subset of cells, not a `cells[0..k]` prefix) breaks.
