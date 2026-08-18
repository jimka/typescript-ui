# Table Column Window Rotation — Implementation Plan

## Overview

Horizontal scrolling on a wide table is much more expensive per frame than vertical scrolling, because the column-window reconciler redoes full work on every tick instead of just the part that changed.

Vertical scroll is cheap because [`VirtualRowView.alignPoolWindow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L377) rotates the row pool's bookkeeping arrays by the scroll delta, so a pooled `Row` object's data identity travels with it across a scroll step — only the row that actually entered the window gets rebound.

Horizontal scroll has no equivalent. [`Body.bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L1281) calls `row.setColumnWindow(firstCol, lastCol)` for every pooled row on every tick, and [`Row.setColumnWindow`](packages/lib/src/typescript/lib/component/table/Row.ts#L370) has a cheap early return only when the window is *exactly* unchanged. The moment the window slides by even one column, every row falls through to a full three-pass reconciliation that rebuilds two `Map`s and calls the private `cellKeyFor` up to three times per rendered column — for every row in the pool, every tick, even though only the one or two columns at the window's edge actually changed.

This plan makes an ordinary small-delta horizontal slide cheap, the same way `alignPoolWindow` made an ordinary vertical slide cheap: rotate each row's own per-slot bookkeeping, touch only the columns that entered or left, and fall back to today's full reconciliation for every case that isn't a plain slide (first render, resize, a field-set change, or a jump too large to overlap the previous window).

This is a follow-on to the already-shipped [`row-cell-cache`](packages/lib/plans/implemented/row-cell-cache.md) plan, which gave `Row` a persistent `_cellCache` so a cell displaced with nowhere to go is parked and restored later instead of destroyed. This plan reuses that cache and `Row`'s existing `retireCell` unchanged — it does not touch the cache's own eviction, disposal, or edit-commit-on-retire behaviour.

The changes touch two files: [`Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) (the reconciler gains a fast path) and [`Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) (computes the per-tick plan once and scopes two of its own per-row sweeps to the cells that actually changed). `TableHeader`'s own column reconciler is investigated and deliberately left out of scope — see `## Non-Goals`.

---

## Architecture Decisions

### The fast path mirrors `alignPoolWindow`'s rotation, adapted for a resizeable slot set

`alignPoolWindow` rotates fixed-length arrays because the row pool's size never changes — only *which* row occupies which slot moves. A row's rendered column set is not fixed-length in the same sense: the columns leaving one edge are retired and different columns are built or restored at the other edge. The fast path therefore keeps the vertical fix's core idea — touch only the slots that changed, not the whole window — but its concrete mechanism is "retire the departing edge, rotate the survivors down, resolve the entering edge," not a literal array rotation of untouched elements.[^why-not-literal-rotation]

### Body computes one plan per tick; each row decides independently whether it qualifies

`Body.renderWindowPass` now snapshots its own previous `_colWindow` before recomputing the new one, and derives a `ColumnWindowSlidePlan` describing the slide (or `undefined` when this tick isn't an ordinary slide). This plan is handed to every pooled row's `setColumnWindow` call as a new optional third argument.

A row does not blindly trust that the plan applies to it. A row that was hidden (pool slot beyond the vertical window) across one or more horizontal scroll ticks does not get `setColumnWindow` called at all while hidden, so its own column window can be more stale than Body's tick-to-tick delta suggests. Each row's `setColumnWindow` re-derives its own delta from its own `_windowFirst` and compares it against the plan's `prevFirstCol`; a mismatch means this row is not in sync with the plan, and it falls back to full reconciliation exactly as it does today. This makes the fast path opt-in per row, with the full path as a safety net that never regresses on a stale row.[^stale-row-precision]

### Eligibility requires equal width and an overlapping window — not an arbitrary column-count cutoff

The fast path applies when, for a given row, **all** of the following hold:

- `Body` supplied a plan (this tick's own previous-vs-new window is a width-preserving move — see below).
- The row's own `_columnsDirty` flag is clear (no pending field/config change).
- The row's own previous window matches the plan's `prevFirstCol`/`prevLastCol` exactly (the row was in sync last tick).
- The new window has the same width as the previous one.
- `0 < |delta| < width` — the two windows overlap by at least one column.

The last condition is derived, not chosen by feel: when `|delta| >= width`, the previous and new windows share no column, so there is nothing to preserve — every rendered cell would be retired and every slot rebuilt regardless of which algorithm runs. The full path already degrades correctly in that case (its `byName` lookup simply finds nothing to match), and running the rotation machinery on top would add work for zero benefit. Requiring overlap is therefore the exact crossover point past which the fast path can never win, not an approximated threshold.[^threshold-derivation]

A window-width change (resize, split-gutter drag, a column-width change that shifts how many columns fit) always takes the full path, because the fast path's per-slot rotation assumes a fixed number of slots — there is no meaningful "shift" when the slot count itself changed.

| Case | Previous window | New window | Fast path? | Why |
|---|---|---|---|---|
| Ordinary one-column right slide | `[3, 10]` (width 8) | `[4, 11]` (width 8) | Yes | Same width, `delta = 1`, overlaps |
| Fast wheel scroll, several columns in one tick | `[3, 10]` | `[6, 13]` | Yes | Same width, `delta = 3 < 8`, overlaps |
| Fling / `scrollTo` far away | `[3, 10]` | `[40, 47]` | No | `delta = 37 >= width` — no overlap |
| Window resize widens the viewport | `[3, 10]` (width 8) | `[3, 14]` (width 12) | No | Width changed |
| First render | *(none — `lastCol === -1`)* | `[0, 7]` | No | No previous window to diff against |
| Column hide/show, config swap | any | any | No | `_columnsDirty` is set by `setColumnFields`, independent of the window math |
| A specific row was hidden through several horizontal ticks, now revealed | row's own `_windowFirst` stale by several ticks | current tick's window | No (for that row only) | Row's own previous window doesn't match the plan's `prevFirstCol` |

### The per-tick plan hoists only what is identical across every row: the entering columns' reuse keys

Every row in a `Body` shares the same model, hidden-column set, and column configs, so [`Row.cellKeyFor`](packages/lib/src/typescript/lib/component/table/Row.ts#L615)'s result for a given column index is identical across every row in the pool — the fast path's whole point is to stop recomputing that per row. `Body` now calls the (widened-visibility) `Row.cellKey` directly to precompute the reuse key for each of the `|delta|` entering columns once per tick, and every eligible row reads it from the plan instead of calling its own `cellKeyFor`. A row whose entering columns fall outside what the plan covers (should not happen, given the eligibility check, but kept as a safety net) falls back to computing its own key.[^cellkey-visibility]

### Retiring through the existing `_cellCache`, not a separate in-call free list

The full reconciler tries three sources for an unmatched column, in order: cells displaced *this same call* (`free`), then the persistent `_cellCache`, then construction. The fast path simplifies this to two tiers: it retires the departing edge's cells into `_cellCache` *before* resolving the entering edge, so an entering column whose key matches something the same call just retired finds it via the ordinary cache lookup — no separate in-call map is built.

This costs a `removeComponent`/`addComponent` round-trip instead of the cheaper `setLayoutConstraints` re-tag a same-call `free` hit would use, but only for the `|delta|` entering columns, where `|delta|` is typically 1–3. That is a negligible constant-factor cost against the win of skipping the `free`/`byName` `Map` construction and the repeated `cellKeyFor` calls for every surviving column, which is what dominated the old per-tick cost.[^why-two-tier]

### A survivor gets zero writes; the entering edge gets exactly what pass 3 already does

A cell that keeps its own column across a slide needs no update at all: its ARIA `colIndex` is keyed to its column, not its slot, so it's unchanged; its group tint depends on the column's config, also unchanged; its bound value is untouched since the row's record didn't change. The existing full path re-applies all three to every rendered cell regardless (a documented, deliberate choice from `table-column-virtualization.md`, further protected by idempotence guards from `table-scroll-recycling-cost.md`) — the fast path instead applies them only to the newly-entering cells, which is strictly less work with an identical outcome for survivors.

### `Row` reports which cells actually changed, so `Body` can scope its own per-row sweeps

`Body.wireRowCells` and `Body.applyReadOnlyState` today re-run over every cell in a row whenever `setColumnWindow` reports any change, mirroring what vertical scroll used to do before `alignPoolWindow`'s `wasRebound` flag scoped rebinding to just the entering row. `Row` gains `getRetargetedCells()`, populated by *both* the full path's existing pass 3 and the new fast path, listing exactly the cells that were built, recycled, or restored on the last `setColumnWindow` call. `Body` reads this list right after a `setColumnWindow` call that reported `true`, and passes it to `wireRowCells`/`applyReadOnlyState` so they touch only those cells — correct under either reconciliation path, since "retargeted" means the same thing regardless of which algorithm produced it.[^scoping-full-path-too]

`applyRequiredEmptyState` is deliberately left unscoped — see `## Non-Goals`.

### `TableHeader`'s own reconciler is out of scope

[`Header.reconcileColumnCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L717) has the same three-pass shape as `Row.setColumnWindow` and the same `Map`-per-call cost. It runs once per tick, not once per pooled row — a `Body` with 30 rows in its pool pays this cost 30 times per tick where the header pays it once. Its absolute contribution to per-tick cost is bounded by that factor and is not the target this plan investigated. Applying the same rotation shape to the header is a reasonable, self-contained follow-on, deliberately left out of this plan — see `## Non-Goals`.

---

## Public API

New exports from `Row.ts` (internal — not re-exported from the `component/table` barrel, matching how `ColumnWindow` is exported from `Body.ts` today and imported directly by `Header.ts` rather than through the barrel):

```typescript
/**
 * Per-tick reconciliation aid Body computes once per render pass and hands to
 * every pooled row's setColumnWindow call. Present only when this tick's
 * column-window change is an ordinary same-width slide that overlaps the
 * previous window; undefined for a resize, a field-set change, a jump larger
 * than the window, or the first render.
 */
export interface ColumnWindowSlidePlan {
    /** The visible-column window this row must have been showing last tick to qualify for the fast path. */
    prevFirstCol: number;
    prevLastCol: number;
    /** newFirstCol - prevFirstCol. Positive: window moved right. Negative: moved left. Never zero. */
    delta: number;
    /** cellKeyFor-equivalent key for each column newly entering the window this tick, keyed by absolute visible-column index. Covers exactly the |delta| entering columns. */
    enteringKeys: Map<number, string>;
}

/** One cell Row.setColumnWindow built, recycled, or restored on its last call, paired with the field it now presents. */
export interface RetargetedCell {
    cell: Cell<any>;
    fieldName: string;
}
```

Changed signatures on `Row`:

```typescript
// Row.ts — widened, backward compatible (existing 2-arg call sites keep taking the full path).
setColumnWindow(firstCol: number, lastCol: number, plan?: ColumnWindowSlidePlan): boolean

// Row.ts — new public accessor, "not for consumer use" (read by Body only).
getRetargetedCells(): RetargetedCell[]

// Row.ts — visibility widened from `private static` to `static` so Body can reuse the
// same precedence logic instead of duplicating it. Logic and signature unchanged.
static cellKey(field: Field, config: ColumnConfig | undefined, isTreeColumn: boolean): string
```

Changed signatures on `Body` (both private, no consumer-visible change):

```typescript
// Body.ts
private wireRowCells(row: Row, cells?: Cell<any>[]): void
private applyReadOnlyState(row: Row, record: ModelRecord, retargeted?: RetargetedCell[]): void
```

---

## Internal Structure

### `Row._lastRetargeted` and the pass-3 hookup (full path, minimally touched)

```typescript
// New field, alongside _cellKeys / _fieldNames.
private _lastRetargeted: RetargetedCell[] = [];
```

`setColumnWindow` resets it as its very first statement (so a no-op call reports an empty list), before the existing separator/clamp/early-return logic:

```typescript
setColumnWindow(firstCol: number, lastCol: number, plan?: ColumnWindowSlidePlan): boolean {
    this._lastRetargeted = [];

    if (this._separatorMode) { /* ... unchanged ... */ }
    // ... unchanged clamp + early-return ...
```

The existing full-path pass 3 gains one line, at the point it already knows a cell was retargeted:

```typescript
    for (let col = firstCol; col <= lastCol; col++) {
        const cell  = assigned[col - firstCol]!;
        const field = this._visibleFields[col];

        cell.getAria().setColIndex(col + 1);
        cell.setBaseBackground(this._columnConfigs.get(field.getName())?.groupColor ?? null);

        if (retargeted.has(col)) {
            this.bindCell(cell, this._data, field.getName());
            this._lastRetargeted.push({ cell, fieldName: field.getName() });   // new
        }
    }
```

`getRetargetedCells()` is a one-line accessor:

```typescript
getRetargetedCells(): RetargetedCell[] {
    return this._lastRetargeted;
}
```

### Eligibility check and dispatch

Inserted into `setColumnWindow` right after the existing early-return check (`if (!this._columnsDirty && firstCol === this._windowFirst && lastCol === currentLastCol) return false;`), before the existing `byName` map construction:

```typescript
    const width = lastCol - firstCol + 1;

    if (plan
        && !this._columnsDirty
        && this._windowFirst === plan.prevFirstCol
        && currentLastCol === plan.prevLastCol
        && width === (plan.prevLastCol - plan.prevFirstCol + 1)
    ) {
        this.reconcileWindowSlide(firstCol, lastCol, plan);
        return true;
    }

    // ... existing full-path byName/free/pass1/pass2/pass3 code, unchanged ...
```

### `reconcileWindowSlide` — the fast path

```typescript
/**
 * Reconciles an ordinary same-width slide: retires the |delta| departing
 * cells into the cell cache, resolves the |delta| entering columns (cache
 * restore, else construct), and leaves every surviving cell untouched.
 * Only called when setColumnWindow has already confirmed this row's own
 * previous window matches `plan`.
 */
private reconcileWindowSlide(firstCol: number, lastCol: number, plan: ColumnWindowSlidePlan): void {
    const shift = plan.delta;
    const width = lastCol - firstCol + 1;
    const outCount = Math.abs(shift);

    const cells = this.getComponents() as Cell<any>[];

    // 1. Snapshot the survivors' field names / keys before any mutation.
    //    (shift > 0: outgoing = old slots [0, outCount); shift < 0: outgoing = old slots [width-outCount, width).)
    const survivorFieldNames = shift > 0 ? this._fieldNames.slice(outCount) : this._fieldNames.slice(0, width - outCount);
    const survivorKeys       = shift > 0 ? this._cellKeys.slice(outCount)   : this._cellKeys.slice(0, width - outCount);
    const survivorCells      = shift > 0 ? cells.slice(outCount)            : cells.slice(0, width - outCount);

    // 2. Retire the departing edge into the cell cache (always keyed — never disposed here).
    const outgoingSlots = shift > 0 ? range(0, outCount - 1) : range(width - outCount, width - 1);
    for (const slot of outgoingSlots) {
        this.retireCell(cells[slot], this._cellKeys[slot]);
    }

    // 3. Resolve the entering columns: cache restore, else construct. Mirrors the full
    //    path's pass-2 cache tier exactly (see row-cell-cache.md), minus the in-call
    //    free tier — a same-call cache hit already covers a departing/entering key match.
    const enteringCols = shift > 0
        ? range(lastCol - outCount + 1, lastCol)
        : range(firstCol, firstCol + outCount - 1);

    const enteringCells: Cell<any>[] = [];
    const enteringFieldNames: string[] = [];
    const enteringKeys: string[] = [];

    for (const col of enteringCols) {
        const field = this._visibleFields[col];
        const key   = plan.enteringKeys.get(col) ?? this.cellKeyFor(field);
        const cached = this._cellCache.get(key);
        let cell: Cell<any>;

        if (cached && cached.length > 0) {
            cell = cached.pop()!;
            if (cached.length === 0) this._cellCache.delete(key);
            this.addComponent(cell, { data: field });
            cell.invalidateLayout();
        } else {
            cell = Row.createCellForField(field, this._columnConfigs);
            if (this._treeFieldName !== undefined && field.getName() === this._treeFieldName) {
                cell.wrapRenderer((delegate) => new TreeCellRenderer(delegate));
            }
            const builtCell = cell;
            cell.on("commit", (newValue) => this.commitCellValue(builtCell, newValue));
            this.addComponent(cell, { data: field });
        }

        cell.getAria().setColIndex(col + 1);
        cell.setBaseBackground(this._columnConfigs.get(field.getName())?.groupColor ?? null);
        this.bindCell(cell, this._data, field.getName());

        enteringCells.push(cell);
        enteringFieldNames.push(field.getName());
        enteringKeys.push(key);
        this._lastRetargeted.push({ cell, fieldName: field.getName() });
    }

    // 4. Fix _components into correct slot order. A plain sortComponents over this row's
    //    (small) width is far cheaper than the full path's Map-heavy reconciliation, and
    //    reuses the exact mechanism the full path already relies on for the same purpose —
    //    see the Architecture Decisions' "why not literal rotation" reasoning.
    const slotOf = new Map<Cell<any>, number>();
    survivorCells.forEach((cell, i) => slotOf.set(cell, shift > 0 ? i : i + outCount));
    enteringCells.forEach((cell, i) => slotOf.set(cell, shift > 0 ? width - outCount + i : i));
    this.sortComponents((c1, c2) => (slotOf.get(c1 as Cell<any>) ?? 0) - (slotOf.get(c2 as Cell<any>) ?? 0));

    // 5. Rebuild the parallel bookkeeping arrays and _treeCell.
    this._fieldNames = shift > 0 ? [...survivorFieldNames, ...enteringFieldNames] : [...enteringFieldNames, ...survivorFieldNames];
    this._cellKeys   = shift > 0 ? [...survivorKeys, ...enteringKeys]             : [...enteringKeys, ...survivorKeys];
    this._windowFirst = firstCol;

    if (this._treeFieldName !== undefined) {
        const treeSlot = this._fieldNames.indexOf(this._treeFieldName);
        this._treeCell = treeSlot === -1 ? null : (this.getComponents()[treeSlot] as Cell<any>);
    }

    this._columnsDirty = false;
}
```

`range(a, b)` is a small local helper (`Array.from({ length: b - a + 1 }, (_, i) => a + i)`) — add it as a module-level function in `Row.ts`, not exported.

### `Body`'s per-tick plan computation

```typescript
// Body.ts — mirrors Row.setColumnFields' own filter+sort, and Header.computeVisibleFields's
// identical one. Not extracted to a shared helper: it is two lines, needed here only once per
// tick (not once per row), and the codebase already has this exact duplication between Row and
// Header without a shared utility.
private computeVisibleFields(): Field[] {
    return this._store.model.getFields()
               .filter(f => !this._hiddenColumns.has(f.getName()))
               .sort((f1, f2) => f1.getOrder() - f2.getOrder());
}

/**
 * Derives this tick's slide plan from the previous and new column windows, or undefined
 * when this tick isn't an ordinary same-width overlapping slide (see the eligibility table
 * in the plan's Architecture Decisions).
 */
private computeColumnWindowSlidePlan(prev: ColumnWindow, next: ColumnWindow): ColumnWindowSlidePlan | undefined {
    if (prev.lastCol === -1 || next.lastCol === -1) {
        return undefined;
    }

    const prevWidth = prev.lastCol - prev.firstCol + 1;
    const nextWidth = next.lastCol - next.firstCol + 1;

    if (prevWidth !== nextWidth) {
        return undefined;
    }

    const delta = next.firstCol - prev.firstCol;

    if (delta === 0 || Math.abs(delta) >= nextWidth) {
        return undefined;
    }

    const visibleFields = this.computeVisibleFields();
    const treeFieldName = this.getTreeFieldName();
    const enteringKeys  = new Map<number, string>();
    const enteringRange = delta > 0
        ? range(next.lastCol - delta + 1, next.lastCol)
        : range(next.firstCol, next.firstCol - delta - 1);

    for (const col of enteringRange) {
        const field = visibleFields[col];

        if (!field) {
            return undefined;   // defensive; should not happen given effectiveWidths sizing
        }

        const config = this._columnConfigs.get(field.getName());
        enteringKeys.set(col, Row.cellKey(field, config, field.getName() === treeFieldName));
    }

    return { prevFirstCol: prev.firstCol, prevLastCol: prev.lastCol, delta, enteringKeys };
}
```

Add the same small `range()` helper as a module-level function in `Body.ts` (not exported; duplicated rather than shared across files, matching this codebase's existing tolerance for small single-purpose helpers per file — see `columnWidthsEqual` and `escapeTsvField` already living privately in `Body.ts`).

`renderWindowPass` snapshots the previous window before overwriting it, and threads the plan through:

```typescript
    const prevColWindow = this._colWindow;

    this._colWindow = computeColumnWindow(effectiveWidths, scroller.getScrollX(), this.getWidth() || 0);

    const slidePlan = this.computeColumnWindowSlidePlan(prevColWindow, this._colWindow);

    // ... unchanged commitEditsOutsideWindow / window-size computation ...

    this.bindAndPositionRows(win.firstRow, win.windowSize, rowWidth, records, this._colWindow, slidePlan);
```

### `bindAndPositionRows`'s scoping

```typescript
protected bindAndPositionRows(
    firstRow: number, windowSize: number, rowWidth: number, records: ModelRecord[],
    columns: ColumnWindow, slidePlan?: ColumnWindowSlidePlan,
): void {
    // ... unchanged rowHeight / alignPoolWindow / separator branch ...

        const windowChanged = row.setColumnWindow(columns.firstCol, columns.lastCol, slidePlan);
        const retargeted    = windowChanged ? row.getRetargetedCells() : undefined;

        if (windowChanged) {
            this.wireRowCells(row, retargeted!.map(r => r.cell));
        }

        const wasRebound = this._boundIndices[i] !== dataIndex;

        if (wasRebound) {
            row.setData(records[dataIndex]);
            // ... unchanged ...
        }

        if (wasRebound) {
            this.applyReadOnlyState(row, records[dataIndex]);          // full row — the record changed
            row.setFieldIndent(this._rowIndented?.(records[dataIndex]) ?? false);
        } else if (windowChanged) {
            this.applyReadOnlyState(row, records[dataIndex], retargeted);   // scoped
            row.setFieldIndent(this._rowIndented?.(records[dataIndex]) ?? false);
        }

    // ... unchanged afterRowBound / applyRequiredEmptyState / positionRow / cell positioning loop ...
}
```

`wireRowCells` and `applyReadOnlyState` both fall back to the full row when called with no scope argument (used by `createPoolRow` and `syncPoolCells`, both unchanged):

```typescript
private wireRowCells(row: Row, cells?: Cell<any>[]): void {
    for (const cell of cells ?? (row.getComponents() as Cell<any>[])) {
        cell.setEditorPool(this._editorPool);
        cell.setScrollIntoViewHandler(() => this.scrollColumnIntoView(this._focusedColIndex));
    }
}

private applyReadOnlyState(row: Row, record: ModelRecord, retargeted?: RetargetedCell[]): void {
    const rowOverride = this._rowReadOnly?.(record) === true;
    const entries = retargeted ?? row.getComponents().map((cell, i) => ({ cell: cell as Cell<any>, fieldName: row.getFieldNames()[i] }));

    for (const { cell, fieldName } of entries) {
        const config     = this._columnConfigs.get(fieldName);
        const colStatic  = config?.readOnly === true;
        const cellPredOk = config?.cellReadOnly?.(record) === true;

        cell.setReadOnly(colStatic || rowOverride || cellPredOk);
    }
}
```

---

## Ordered Implementation Steps

All `Row.ts` line numbers below are current as of this plan's drafting (`git log -1` = `b0cc618c`); re-anchor with `grep -n` before editing if the file has moved on.

1. **`Row.ts` — add the two new interfaces** (`ColumnWindowSlidePlan`, `RetargetedCell`) near the top of the file, after the existing imports, per `## Public API`. Add the local `range()` helper as a module-level function (not exported).

2. **`Row.ts` — add `_lastRetargeted`** as a new private field next to `_cellCache` (around [Row.ts:64](packages/lib/src/typescript/lib/component/table/Row.ts#L64)), typed `RetargetedCell[]`, initialized `[]`.

3. **`Row.ts` — widen `cellKey`'s visibility** from `private static` to `static` ([Row.ts:585](packages/lib/src/typescript/lib/component/table/Row.ts#L585)). No signature or logic change. Add a one-line remark that it is package-internal (not re-exported from the barrel) and read by `Body` for the per-tick slide plan.

4. **`Row.ts` — add `getRetargetedCells()`**, a one-line public accessor returning `this._lastRetargeted`, placed near `getFieldNames()` ([Row.ts:140](packages/lib/src/typescript/lib/component/table/Row.ts#L140)), documented "not for consumer use" in the same style as `getColumnWindowStart`/`getFieldNames`.

5. **`Row.ts` — widen `setColumnWindow`'s signature** to accept the optional third `plan?: ColumnWindowSlidePlan` parameter ([Row.ts:370](packages/lib/src/typescript/lib/component/table/Row.ts#L370)). Add `this._lastRetargeted = [];` as the method's first statement, before the existing `_separatorMode` check.

6. **`Row.ts` — insert the eligibility check and fast-path dispatch**, immediately after the existing early-return (`if (!this._columnsDirty && firstCol === this._windowFirst && lastCol === currentLastCol) return false;`) and before the existing `byName` map construction. Per `## Internal Structure`'s "Eligibility check and dispatch" snippet.

7. **`Row.ts` — add the one-line `_lastRetargeted.push(...)`** inside the existing full-path pass 3 loop, inside the `if (retargeted.has(col))` branch, per `## Internal Structure`.

8. **`Row.ts` — add the `reconcileWindowSlide` private method**, placed after `setColumnWindow` and before `commitCellValue`, using the full body from `## Internal Structure`.

9. **Checkpoint.** `cd packages/lib && npm run typecheck` — clean. `grep -n "private static cellKey" src/typescript/lib/component/table/Row.ts` — expect zero matches (confirms the visibility widen landed).

10. **`Body.ts` — add `computeVisibleFields()`** as a new private method, placed near `getVisibleRecords()` ([Body.ts:452](packages/lib/src/typescript/lib/component/table/Body.ts#L452)). Add `import type { Field } from "~/data/Field.js";` to the top of the file.

11. **`Body.ts` — add the module-level `range()` helper** near the existing small helpers `columnWidthsEqual`/`escapeTsvField` ([Body.ts:170](packages/lib/src/typescript/lib/component/table/Body.ts#L170)), and **add `computeColumnWindowSlidePlan`** as a new private method placed near `renderWindowPass` ([Body.ts:1134](packages/lib/src/typescript/lib/component/table/Body.ts#L1134)). Add `import type { ColumnWindowSlidePlan, RetargetedCell } from "~/component/table/Row.js";` to the top of the file.

12. **`Body.ts` — thread the plan through `renderWindowPass`**: snapshot `prevColWindow` before reassigning `this._colWindow`, compute `slidePlan`, and pass it as the new trailing argument to `bindAndPositionRows`. Per `## Internal Structure`.

13. **`Body.ts` — widen `bindAndPositionRows`'s signature** to accept the trailing `slidePlan?: ColumnWindowSlidePlan` parameter ([Body.ts:1281](packages/lib/src/typescript/lib/component/table/Body.ts#L1281)), forward it into `row.setColumnWindow(...)`, capture `row.getRetargetedCells()` when `windowChanged`, and rewrite the `wireRowCells` call plus the `wasRebound`/`windowChanged` branch per `## Internal Structure`. Do not change the separator branch, `afterRowBound`, `applyRequiredEmptyState`, `positionRow`, or the cell-positioning loop.

14. **`Body.ts` — widen `wireRowCells`'s signature** ([Body.ts:429](packages/lib/src/typescript/lib/component/table/Body.ts#L429)) to accept an optional `cells?: Cell<any>[]`, falling back to `row.getComponents()` when omitted. Its two other call sites (`createPoolRow`, `syncPoolCells`) are unchanged — they keep calling it with one argument, which keeps their existing full-row behaviour.

15. **`Body.ts` — widen `applyReadOnlyState`'s signature** ([Body.ts:1760](packages/lib/src/typescript/lib/component/table/Body.ts#L1760)) to accept an optional `retargeted?: RetargetedCell[]`, per `## Internal Structure`.

16. **Checkpoint.** `npm run typecheck` — clean. `grep -n "wireRowCells(row)" src/typescript/lib/component/table/Body.ts` — expect exactly two matches (`createPoolRow`, `syncPoolCells`), confirming `bindAndPositionRows`'s call site was updated to pass a scope.

17. **Write the tests** — see `## Expected Behaviour` and `## Verification` for the full list and file placement.

18. **Update documentation** — see `## Documentation Impact`.

19. **Re-run the full verification** in `## Verification`, including the manual browser check.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Create | `packages/lib/tests/component/table/ColumnWindowSlide.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/docs/components/TableInternals.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Build fixtures the same way the existing "Column window" suites do: a `Model` with columns `c0..cN-1`, string type by default with per-index overrides, 100px-friendly widths (mirrors `wideModel`/`wideBody`/`tallWideBody` in `Body.test.ts`).

**Row-level correctness, unit-testable offline** (bare `Row`, hand-built `ColumnWindowSlidePlan` objects — mirrors `RowCellCache.test.ts`'s setup style — new file `ColumnWindowSlide.test.ts`):

1. **A one-column right slide with a same-key entering column reuses the departing cell.** `setColumnWindow(0, 5)`, then `setColumnWindow(1, 6, plan)` with `plan = { prevFirstCol: 0, prevLastCol: 5, delta: 1, enteringKeys: Map([[6, 'string']]) }`. The cell now at the last slot is the exact object that was at slot 0 before.
2. **A one-column right slide with a different-key entering column builds fresh and caches the departing one** (mirrors the existing full-path test of the same name). Column 6 is `number`-typed; after the slide, the new last-slot cell `isInstanceOf(NumberCell)`, and the departing `string` cell is in `_cellCache.get('string')`, not disposed.
3. **A multi-column slide within one tick retires and builds exactly `|delta|` cells**, not `width` many. `setColumnWindow(0, 9)` (width 10), then slide by 3: exactly 3 cells retired, exactly 3 resolved (built or cache-restored), the other 7 are the exact same objects as before (`toBe` identity), with no `getAria().setColIndex` write observable via a spy on the 7 survivors.
4. **`getFieldNames()` / `getComponents()` stay index-aligned after a fast-path slide**, including when no field declares `order` (mirrors the existing tied-order full-path test, now pinning the same invariant under `reconcileWindowSlide`'s `sortComponents` call).
5. **`_treeCell` becomes `null` when the tree column is on the departing edge**, and resolves to the correct cell when the tree column is on the entering edge, across a fast-path slide.
6. **A cell restored from `_cellCache` during a fast-path slide is layout-dirty** (mirrors `RowCellCache.test.ts` case 5) — `cell.isLayoutDirty()` is `true` after the restore.
7. **An entering read-only/required/group-tint column is correct immediately**, without the row rebinding, under a fast-path slide specifically (the existing "per-cell state on entry" tests in `Body.test.ts` happen to exercise a width-changing transition, so they do not cover the fast path — write dedicated same-width-slide versions of all three cases).
8. **A cell mid-edit on the departing edge commits before being retired**, exactly as the full path already guarantees — reuse the same edit-then-slide setup as `RowCellCache.test.ts` case 7, but drive it through a fast-path-eligible slide.
9. **Eligibility rejects a mismatched plan.** Calling `setColumnWindow` with a `plan` whose `prevFirstCol`/`prevLastCol` don't match the row's actual current window falls back to full reconciliation (assert via a `cellKeyFor` spy: call count is proportional to `width`, not zero) — pins the "stale row" safety net from `## Architecture Decisions`.
10. **`_columnsDirty` disqualifies the fast path even when the window otherwise looks like a slide.** After `setColumnFields`, the next `setColumnWindow` call with a well-formed same-width-slide `plan` still runs full reconciliation.

**Body-level integration and complexity characterization** (new describe blocks appended to the existing `Body.test.ts`, reusing its `wideBody`/`tallWideBody` helpers):

11. **A one-column slide calls `cellKeyFor` zero times across the whole pool.** Build a `tallWideBody`-scale pool (many rows), spy on `Row.prototype['cellKeyFor']` (private, accessed via cast — same idiom as the existing `countCellLayouts` helper), render, then scroll by exactly one column. Assert `cellKeyForSpy.mock.calls.length === 0` — down from `pool.length × width` calls (up to 3× that, per column, in the pre-fix algorithm). This is this plan's direct analogue of the row-pool fix's `Body.test.ts` call-count assertion.
12. **A one-column slide constructs and disposes at most `poolSize` cells, not `poolSize × width`.** Same pool; spy on `Row['createCellForField']` (private static, cast) and count objects that leave `_cellCache` permanently (via `dispose`); assert the totals scale with pool size alone for a fixed delta of 1, not with `width`.
13. **`computeColumnWindowSlidePlan` returns `undefined` for each fallback case in the eligibility table**: first render, a resize that changes window width, a jump where `|delta| >= width`, and a `delta === 0` no-op tick. Test each directly against the private method (cast), constructing `ColumnWindow` values by hand.
14. **A big horizontal jump (e.g. `scrollTo` to the far right) still reconciles correctly** via the full path — reuse the existing full-path assertions (byName matching, fresh construction for a type mismatch) against a jump where `|delta| >= width`, confirming the fallback path's behavior is unchanged by this plan.
15. **A window resize (viewport width change) takes the full path even though a scroll also happened in the same tick** — construct a scenario where `_lastBodyWidth`/`_lastColumnWidths` change alongside `scrollX`, and assert `computeColumnWindowSlidePlan` returns `undefined`.
16. **The existing `Body.test.ts` "Column window — sliding" tests keep passing unmodified**, now exercising the fast path (their setups are same-width, one-column slides — see `## Verification` for exactly which ones). No changes needed to these tests themselves; they are regression coverage for the fast path's behavioral parity with the full path.

**Manual verification** (needs a browser — `npm run dev` in `packages/lib`, http://localhost:8015):

17. Open the Misc panel's *"Show window with wide table (45 columns)!"* demo. Using the same direct-`VirtualScroller.setScrollX` technique `table-scroll-recycling-cost.md` established (bypassing `SmoothScroller`'s easing loop, which does not correspond 1:1 with a dispatched event), patch `Row.prototype['cellKeyFor']` and `Row['createCellForField']` to count calls, then step `scrollX` by one column's width repeatedly. Confirm the call counts per tick are bounded by a small constant (not by pool size × window width), consistent with cases 11–12 above.
18. Grouped wide table demo (25 columns, 4 groups) — narrow, scroll horizontally, then widen. Cell values, alignment, group tint, and read-only tint are all correct throughout, matching `row-cell-cache.md`'s own manual cases 13–17.
19. Start editing a cell near the window's departing edge, then scroll one column so its column leaves. The edit commits to the record (same check as `RowCellCache.test.ts` case 7, now exercised live through the fast path).
20. Open the rotated grouped view (`Body.setRowSeparator`) and scroll through it. Separator rows still flip to data rows and back correctly — a flip forces `_columnsDirty`, so it always takes the full path; confirm nothing about the fast path leaks into that transition.

---

## Verification

```bash
cd packages/lib
npm run typecheck
npm run test          # includes the new ColumnWindowSlide.test.ts and the new Body.test.ts describe blocks
npm run lint
npm run docs:api      # must finish with zero warnings
grep -n "private static cellKey" src/typescript/lib/component/table/Row.ts   # expect zero matches
grep -n "wireRowCells(row)" src/typescript/lib/component/table/Body.ts       # expect exactly two matches
```

Existing tests that must keep passing **without modification**, now exercising the fast path (confirmed same-width, one-column-delta slides by direct computation in `## Architecture Decisions`' derivation):

- `Body.test.ts` → `'Column window — sliding'` → `'a one-column slide over same-typed columns reuses the departing cell for the entering column'`
- `Body.test.ts` → `'Column window — sliding'` → `'a one-column slide where the entering column is a different type builds a fresh cell and caches the departing one'`
- `Body.test.ts` → `'Column window — sliding'` → `'after any slide, aria colIndex equals the column index + 1 for every rendered cell'`
- `Body.test.ts` → `'Column window — geometry diffing'` → `'lays out only the cells that changed column when the window slides'` (this test's own assertion — a survivor is never laid out again — holds even more directly under the fast path, since a survivor is never touched at all)

Existing tests that must keep passing **unmodified** and continue to exercise the **full** path (their setups have width changes, confirmed by direct computation, so this plan does not change which code they run):

- `Body.test.ts` → `'Column window — per-cell state on entry'` (all three cases)
- `Body.test.ts` → `'Column window — column-set changes'` (both cases — routes through `syncPoolCells`, not `bindAndPositionRows`'s scroll path)
- `RowCellCache.test.ts` (all cases — bare-`Row` calls never pass a `plan`, so they always exercise the unchanged full path plus the existing cache)
- `RotatedGroupSeparators.test.ts`, `RotatedView.test.ts` — separator transitions always force `_columnsDirty`

Manual smoke tests: cases 17–20 above, at http://localhost:8015 via `npm run dev`.

---

## Documentation Impact

No consumer-visible export changes — `ColumnWindowSlidePlan`, `RetargetedCell`, and the widened `Row.cellKey` are all internal, matching how `ColumnWindow` is handled today (module-exported for cross-file internal use, not re-exported from the `component/table` barrel).

- [`packages/lib/docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md) — the `Row` paragraph (around line 39) currently describes column recycling as always matching-or-recycling-or-restoring across the *whole* rendered window. Add one sentence: an ordinary one-direction horizontal scroll reconciles only the columns actually entering or leaving, not the whole window, with the same recycle/restore/build precedence.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — add a bullet under `## Changed` → `### Components`, in the existing voice: horizontal scrolling on a wide table now touches only the columns entering or leaving the visible window, instead of re-deriving every rendered column's cell assignment on every tick; a resize, a column-set change, or a jump larger than the visible window still reconciles the whole window as before. No consumer action is needed.

---

## Potential Challenges

- **A row that silently drifts out of sync with `Body`'s own previous-window bookkeeping would take the full path forever, quietly losing the optimization without breaking anything.** Mitigated: the eligibility check compares the row's *own* `_windowFirst` against the plan, not a global flag, so a single stale row falls back safely and independently — see the "stale row" footnote and test case 9.
- **Getting the `shift > 0` vs `shift < 0` slot-index arithmetic backwards in `reconcileWindowSlide` would silently swap which edge is retired and which is built**, likely surfacing as a cell rendering the wrong column's value at the wrong x-position. Mitigated by test cases 1–4, which pin exact cell identity and position for both directions, and by the geometry-diffing test suite already covering position-per-column correctness independent of this change.
- **A cell restored from `_cellCache` during the fast path must be marked layout-dirty**, exactly as the row-cell-cache plan already established for the full path's restore branch — the fast path's restore branch (`cell.invalidateLayout()`) mirrors it line-for-line; test case 6 pins it.
- **Widening `Row.cellKey`'s visibility could tempt a future caller to reach into `Row` internals from elsewhere.** Mitigated by keeping it a plain, documented "internal, not for consumer use" static method rather than exporting it from the barrel — the same posture the codebase already takes for other cross-file-internal symbols like `ColumnWindow`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `alignPoolWindow` ([L377](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L377)) and `rotateLeft` ([L13](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L13)) are the direct precedent this plan mirrors for "rotate bookkeeping instead of rebinding everything."
- [`packages/lib/src/typescript/lib/component/table/Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) — read `setColumnWindow`, `cellKeyFor`, `cellKey`, `retireCell`, `_cellCache`, `renderSeparator`, and `setColumnFields` in full before editing; every one of them constrains the fast path.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `renderWindowPass`, `bindAndPositionRows`, `wireRowCells`, `applyReadOnlyState`, `applyRequiredEmptyState`, `syncPoolCells`, `computeColumnWindow`, `ColumnWindow`.
- [`packages/lib/plans/implemented/row-cell-cache.md`](packages/lib/plans/implemented/row-cell-cache.md) — the cache and `retireCell` this plan reuses unchanged; read its Architecture Decisions before touching `_cellCache`.
- [`packages/lib/plans/table-column-virtualization.md`](packages/lib/plans/table-column-virtualization.md) *(if present under `plans/implemented/`)* — establishes `cellKeyFor`'s precedence table and the "re-apply every per-column property on every reconcile" invariant this plan narrows the scope of, not the invariant itself.
- [`packages/lib/plans/table-scroll-recycling-cost.md`](packages/lib/plans/table-scroll-recycling-cost.md) — prior investigation into this same code path; establishes that `setBaseBackground`/`setShadow` are already idempotent, which is part of why skipping them for survivors changes nothing observable.
- [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts) — read the full `'Column window — sliding'`, `'Column window — per-cell state on entry'`, and `'Column window — geometry diffing'` describe blocks before writing new tests; several existing cases become fast-path coverage automatically.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) — `reconcileColumnCells` ([L717](packages/lib/src/typescript/lib/component/table/Header.ts#L717)) has the same shape; read it to confirm the out-of-scope call in `## Non-Goals`, not to change it.

---

## Non-Goals

- **`TableHeader`'s own column reconciler.** Same three-pass shape, but runs once per tick rather than once per pooled row — its absolute cost is bounded by the pool-size factor that makes the body's version the actual bottleneck. A follow-on plan can apply the same rotation shape there if it turns out to matter in practice.
- **A shared cross-row/cross-column cell pool** (AG-Grid-style 2D virtualization, pooling cells across rows as well as columns). Discussed and explicitly deferred as a much larger structural change with DOM-nesting and accessibility implications, independent of this plan.
- **Scoping `applyRequiredEmptyState`.** It already runs over every cell on every render by design (its value depends on the cell's live value, which can change from an in-place edit without any window change), and `Cell.setRequiredEmpty` is already idempotent — an unchanged cell costs one comparison, not a write. Scoping it down would save comparison cost only, not the `Map`/`cellKeyFor` churn this plan targets, and the investigation's own fix-direction list names only `wireRowCells` and `applyReadOnlyState`/`setFieldIndent`.
- **Changing `Row.cellKey`'s precedence rules**, `_cellCache`'s eviction policy, or `retireCell`'s commit-before-retire behaviour. All reused exactly as shipped by `row-cell-cache.md`.
- **An in-call "free" recycling tier for the fast path's entering columns**, distinct from `_cellCache`. Considered and rejected — see the "why two-tier" footnote — the cost difference is negligible at the fast path's scale (`|delta|` typically 1–3) and a third tier would add real implementation risk for a marginal win.
- **A literal `push(...splice(...))` rotation of `Row`'s cell array**, avoiding `sortComponents` entirely. Considered and rejected — see the "why not literal rotation" footnote — the entering edge's insertion position depends on slide direction in a way that a single uniform code path (retire → resolve → sort) avoids having to special-case correctly.

---

## Notes

[^why-not-literal-rotation]: `alignPoolWindow`'s `rotateLeft` works because `_rowPool`/`_boundIndices`/`_rowGeom`/`_rowDisplayed` are all fixed-length arrays where every slot always holds *some* row — a rotation just changes which row is at which slot, with no slot ever needing to be freshly populated from scratch. A row's rendered cell set is different: the two or three departing columns are genuinely gone (retired into the cache or, in principle, disposed) and the entering columns are genuinely new state that has to be resolved (cache restore or construction) and bound (ARIA index, tint, value) before it can occupy a slot. A literal element-swap rotation has nothing to swap the entering slots *with* — they have to be built. The fix in this plan is conceptually "rotate what can be rotated (skip re-deriving the survivors' state), and do real work only for the edge that changed" — the same goal `alignPoolWindow` has, expressed in the two-array-rotation-plus-detach/rebuild shape the resizable case forces.

[^stale-row-precision]: Concretely: `bindAndPositionRows` calls `row.setColumnWindow` for every pool slot `i < windowSize`, on every tick, regardless of whether that slot's data rebinds. A row's column window only stops tracking `Body`'s tick-to-tick window while that row's slot sits at `i >= windowSize` (hidden by `hideExcessPoolRows`, e.g. after a vertical resize shrinks the visible row count). Such a row's `_windowFirst` can be many ticks behind by the time it's revealed, so its own delta relative to the *current* tick's window can be arbitrarily large even when `Body`'s own tick-to-tick delta was one column. Comparing the row's own state to the plan's `prevFirstCol`/`prevLastCol` (rather than trusting a body-wide "this tick is a slide" boolean) is what makes each row's fast-path decision correct independent of its own history.

[^threshold-derivation]: If `|delta| >= width`, the previous window `[prevFirst, prevFirst+width-1]` and the new window `[prevFirst+delta, prevFirst+delta+width-1]` share no index — every column in the new window is one the row's current cells cannot possibly already present. In that regime, `reconcileWindowSlide`'s "retire the departing edge, resolve the entering edge" split degenerates to "retire everything, resolve everything" while *also* paying the overhead of computing which edge is which — strictly more work than the full path's `byName` lookup simply failing to match anything and falling straight to construction. There is therefore no `|delta|` value at or above `width` where the fast path could win, which is why the cutoff is derived from the overlap condition itself rather than picked as a fraction of `width` or a fixed column count.

[^cellkey-visibility]: `Row.cellKey`'s three parameters (`field`, `config`, `isTreeColumn`) are all values `Body` can already derive independently — it already owns `_columnConfigs` and `getTreeFieldName()`, and can compute the same visible-field list `Row.setColumnFields` computes (see `computeVisibleFields`). The only reason `Body` could not call this before is that the method was `private`. Widening it to `static` (not `private static`) is the smallest change that lets `Body` reuse the exact precedence logic instead of duplicating the five-branch `tree:` / `renderer:` / `dynamic:` / `combo:` / type-based rule table — a duplication that would silently drift the moment one side of it changed.

[^why-two-tier]: A true three-tier design (in-call free, then persistent cache, then construct) would need a small `Map<string, Cell<any>[]>` built from the `|delta|` departing cells before resolving the entering ones, exactly mirroring the full path's `free` map but sized to `|delta|` instead of `width`. This was considered and rejected for the first version of this fix: routing the departing cells through the existing `_cellCache` first (a call to the already-shipped `retireCell`), then resolving entering columns through the existing cache-lookup tier, produces the identical *outcome* (a same-key departing cell is available to an entering column in the same tick) at the cost of a `removeComponent`+`addComponent` round-trip instead of a single `setLayoutConstraints` call — for `|delta|` cells, typically 1–3. That constant-factor cost is negligible next to the `Map` allocation and repeated `cellKeyFor` calls the fast path already eliminates for every surviving column, and reusing `_cellCache` directly means the fast path introduces no new data structure at all.

[^scoping-full-path-too]: This is a genuine, low-risk improvement to the existing full path, not just new fast-path plumbing: when the full path runs for a case with partial overlap (e.g. a moderate resize where most columns survive), `retargeted` already correctly names only the columns that were actually built or recycled — the full path's own `retargeted: Set<number>` already tracks exactly this. `wireRowCells`/`applyReadOnlyState` scoping down to it costs nothing extra and is correct regardless of which reconciliation algorithm populated the list, because "a cell was rebuilt or recycled this call" means the same thing either way, and a survivor's read-only status cannot have changed when its own record and column are both unchanged (the only case this scoping applies to — a genuine `wasRebound` still runs the full-row path).
