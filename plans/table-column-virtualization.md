# Table Column Virtualization — Implementation Plan

## Overview

The table body virtualizes rows but not columns. [`computeVisibleWindow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L267) turns `scrollY` into a `[firstRow, lastRow]` range, and only that range is bound into the recycled row pool. Nothing does the same for `scrollX`: [`Row`](packages/lib/src/typescript/lib/component/table/Row.ts#L45) builds one `Cell` per non-hidden model field, so a 100-column table with a ~20-slot row pool holds ~2000 `<td>` components in the DOM, and every render pass walks all of them three times — [`Body.applyReadOnlyState`](packages/lib/src/typescript/lib/component/table/Body.ts#L1155), [`Body.applyRequiredEmptyState`](packages/lib/src/typescript/lib/component/table/Body.ts#L1205), and the cell-positioning loop inside [`Body.bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L812).

This plan adds a **column window**: a `[firstCol, lastCol]` range derived from `scrollX`, the per-column widths the layout manager already pushes into `Body._lastColumnWidths`, and the body's viewport width. Each pooled `Row` renders only the cells in that range. The feature is always on — there is no option and no threshold, and a table narrow enough to fit gets a window covering every column, so it looks and behaves exactly as it does today.

The work lands in three files: [`Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) (compute the window, drive it, map column indices to rendered slots), [`Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) (one cell-set reconciler that replaces `syncCells`), and [`Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) (one widened setter). `TreeBody` inherits the behaviour without changes.

A rotated table — `Table.setDisplayMode("rotated")`, the psql `\x` style key/value view — also needs no change: rotation is implemented entirely in `Table.ts`, by projecting the selected record into the three-column [`ROTATED_MODEL`](packages/lib/src/typescript/lib/component/table/Table.ts#L38) `MemoryStore` and calling `bindView`, so a rotated body has three columns and its column window always covers all of them.

---

## Architecture Decisions

### The window is a pure function in `Body.ts`, mirroring `resolveClickedColumn`

A module-level exported function `computeColumnWindow(widths, scrollX, viewportWidth)` returns the rendered column range plus the per-column widths and left offsets. It lives beside [`resolveClickedColumn`](packages/lib/src/typescript/lib/component/table/Body.ts#L70) in `Body.ts` — the existing pure, `@internal`, directly-unit-tested helper in the same file — and its shape mirrors [`computeVisibleWindow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L267): a range plus a fixed buffer constant.[^window-on-body]

`COLUMN_BUFFER = 2` is a module-private constant in `Body.ts`, matching how `SCROLL_BUFFER = 2` is module-private in [`VirtualRowView.ts:10`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L10).

### A column is in the window when its span touches the viewport, compared inclusively

Walk the widths left to right, accumulating each column's left offset. A column is *raw-visible* when its right edge is at or after `scrollX` **and** its left edge is at or before `scrollX + viewportWidth`. The window is the raw-visible run widened by `COLUMN_BUFFER` on each side and clamped to `[0, n-1]`.

Inclusive comparison is what makes the zero-width case degrade to "render everything", which is the state every offline test and every pre-layout render sits in.[^inclusive-bounds]

Twenty columns, each 100 px, viewport 250 px, `COLUMN_BUFFER = 2`:

| `scrollX` | Raw-visible columns | `firstCol` | `lastCol` | Rendered |
|---|---|---|---|---|
| 0 | 0–2 | 0 | 4 | 5 |
| 550 | 5–8 | 3 | 10 | 8 |
| 1750 (max) | 17–19 | 15 | 19 | 5 |

Three columns of unknown width (`_lastColumnWidths` still empty, viewport 0):

| Widths | `scrollX` | Viewport | Raw-visible | `firstCol` | `lastCol` |
|---|---|---|---|---|---|
| `[0, 0, 0]` | 0 | 0 | 0–2 | 0 | 2 |

### Cells are recycled across columns, keyed by cell kind

A `Row` renders exactly `lastCol - firstCol + 1` cells. When the window slides, a cell whose column leaves the window is **reused** for a column entering the window if the two columns need the same *kind* of cell; otherwise it is disposed and the entering column gets a freshly built one. The alternative — keeping one cell per column and merely creating it lazily on first entry — was rejected.[^recycle-vs-lazy]

A column's **cell key** is the string that decides reuse. It captures every input [`Row.createCellForField`](packages/lib/src/typescript/lib/component/table/Row.ts#L408) reads, so two columns sharing a key need identical cells. The key form mirrors [`Cell.getEditorKey`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L119), which already keys pooled editors as `combo:<field>`.[^cell-key]

Precedence, highest first — the first matching row wins:

| Condition on the column | Key | Shared across columns? |
|---|---|---|
| It is the tree column | `tree:<field>` | no |
| `ColumnConfig.renderer` is set | `renderer:<field>` | no |
| `ColumnConfig.cellType` is set | `dynamic:<field>` | no |
| `ColumnConfig.values` is non-empty | `combo:<field>` | no |
| Field type is `time` or `datetime` | `<type>:<showSeconds>` | yes |
| Anything else | `<type>` | yes |

Worked example over six columns:

| Column | Field type | Config | Key |
|---|---|---|---|
| `name` | `string` | — | `string` |
| `city` | `string` | — | `string` |
| `qty` | `number` | — | `number` |
| `due` | `datetime` | `showSeconds: true` | `datetime:true` |
| `status` | `string` | `values: […]` | `combo:status` |
| `icon` | `string` | `renderer: () => …` | `renderer:icon` |

### One reconciler replaces `Row.syncCells`

[`Row.syncCells`](packages/lib/src/typescript/lib/component/table/Row.ts#L261) today reconciles the cell set against the visible-field list, matching survivors by field name. The new `Row.setColumnWindow(firstCol, lastCol)` does the same match by field name **first**, then hands any column still without a cell a leftover cell of the same key, then builds what is left. Column-set changes (hide/show, config swap) and window slides therefore run through one method, and a hide/show still preserves each surviving cell's renderer, editor, theme listener and tint exactly as `syncCells` does.

The two-pass order matters: matching every column by name before any key-recycling starts is what stops a recycle from stealing a cell that a later column wants by name.

Reconciling the window `[0..2]` → `[1..3]` over `name`/`city`/`qty`/`due`:

| Column | In old window | In new window | Action |
|---|---|---|---|
| `name` (`string`) | yes | no | left over; no entering column wants `string` → removed and disposed |
| `city` (`string`) | yes | yes | matched by name — untouched |
| `qty` (`number`) | yes | yes | matched by name — untouched |
| `due` (`datetime:true`) | no | yes | no leftover with key `datetime:true` → built new |

The same slide where all four columns are plain `string`:

| Column | In old window | In new window | Action |
|---|---|---|---|
| `a` (`string`) | yes | no | left over |
| `b`, `c` (`string`) | yes | yes | matched by name — untouched |
| `d` (`string`) | no | yes | recycles `a`'s cell — rebind value, rewrite `aria-colindex` to 4 |

### A cell that leaves the row is disposed, not just removed

[`Component.removeComponent`](packages/lib/src/typescript/lib/core/Component.ts#L4977) detaches the element but leaves the component's per-instance stylesheet rule in the shared sheet. Every cell the reconciler drops is therefore followed by `cell.dispose()`.[^dispose-on-discard]

### Focus, click, and ARIA are column-index based; a slot converts by adding the window start

`Body._focusedColIndex` is already a column index. Every site that currently reads `row.getComponents()[this._focusedColIndex]` converts through the row: `slot = _focusedColIndex - row.getColumnWindowStart()`, valid only when `slot` is inside the rendered range.[^focus-by-index]

`row.getFieldNames()` stays index-aligned with `row.getComponents()`, but both now describe the rendered window rather than every visible column. `getColumnWindowStart()` is the one extra piece a caller needs to recover a column index.

| Reading | Meaning |
|---|---|
| `row.getComponents()[s]` | the cell rendering column `row.getColumnWindowStart() + s` |
| `row.getFieldNames()[s]` | that column's model field name |
| `resolveClickedColumn(cells, target)` | a **slot**, not a column index |

`aria-colindex` is written by the reconciler, for every rendered cell on every reconcile, instead of by the geometry loop's `if (!prevCell)` branch at [Body.ts:854](packages/lib/src/typescript/lib/component/table/Body.ts#L854) — that branch writes the index once and never again, which becomes wrong the moment a cell is reused for a different column. The reconciler exits early when nothing changed, so a plain vertical scroll writes no ARIA at all. `aria-colcount` needs no change: [`Table`](packages/lib/src/typescript/lib/component/table/Table.ts#L243) already sets it from `getColumns().length`, which is independent of what is rendered.

### Keyboard column navigation scrolls the target column in and re-renders

`ArrowLeft` / `ArrowRight` in [`Body.onKeyDown`](packages/lib/src/typescript/lib/component/table/Body.ts#L1386) move `_focusedColIndex`, then call `scrollColumnIntoView(_focusedColIndex)` and `renderWindow()` before refreshing the focus ring and active descendant. That mirrors the row-navigation tail in the same method, which already runs `selectRecord` → `scrollRecordIntoView` → `renderWindow` → `_updateActiveDescendant`. `Enter` / `Space` does the same before resolving the cell to edit.

### An edit is committed before its column leaves the window

`Body` commits any open edit whose column falls outside the new window, as a pre-pass that runs the moment the window is known and before any pool row is bound. That follows the precedent `syncCells` sets today: it commits an in-flight edit before discarding the cell that holds it. The pre-pass reports whether it committed anything, and on `true` the pass re-reads the record list — a commit can change what a filtered or sorted store returns.

Because [`Cell.commitEdit`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L433) emits `"commit"` while the cell still reports `isEditing()`, and that emit cascades through `store.notifyRecordChanged` back into `renderWindow`, both `renderWindow` and `syncPoolCells` are guarded by a single `_reconciling` flag that makes a nested call a no-op.[^reentrancy]

### The commit listener is wired once and resolves its field live

A recycled cell presents a different field than the one it was built for, so its `"commit"` listener cannot close over a field name. Each cell gets one listener at construction that resolves the cell's current field from the row at emit time. This is the pattern [`Header.rebuildCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L456) already documents — *"Wire exactly once, at creation… resolve the cell's visible-column index live at emit time"*.[^wire-once]

### The tree column is windowed like every other column

`TreeBody` needs no change. The tree column's key is `tree:<field>`, so its cell is never recycled to or from another column, and `Row.getTreeCell()` returns `null` while the tree column sits outside the window — which every `TreeBody` call site already guards for.[^tree-column]

### Relationship to the neighbouring plans

None of [`table-column-pinning.md`](plans/table-column-pinning.md), [`table-chained-column-resize.md`](plans/table-chained-column-resize.md) or [`scrollbar-leak-and-layout-guards.md`](plans/scrollbar-leak-and-layout-guards.md) orders before or after this plan, and none of the three edits `Body.ts`, `Row.ts` or `Cell.ts`. The per-type column-width policy that used to sit alongside them has already shipped, as [`plans/implemented/table-generated-column-widths.md`](plans/implemented/table-generated-column-widths.md). One plan does order after this one: the companion `plans/table-header-column-virtualization.md` consumes the `computeColumnWindow` exported here, so this plan lands first — that constraint belongs in the header plan's frontmatter, not in this one's. No `depends-on` or `touches-shared` frontmatter is set here.[^plan-neighbours]

---

## Public API

New exports from `component/table/Body.ts`:

```typescript
/**
 * The horizontally-visible column range plus the geometry every rendered
 * cell is placed from. `firstCol` / `lastCol` are inclusive visible-column
 * indices; `lastCol` is `-1` when there are no columns.
 *
 * @internal
 */
export interface ColumnWindow {
    firstCol: number;
    lastCol : number;
    /** Effective width per visible column, index-aligned with visible-column order. */
    widths  : number[];
    /** Left offset per visible column — the running sum of `widths`. */
    lefts   : number[];
}

/**
 * Computes the column window for a horizontal scroll offset and viewport width.
 *
 * @internal
 */
export function computeColumnWindow(
    widths       : number[],
    scrollX      : number,
    viewportWidth: number,
): ColumnWindow;
```

Changed on `Body` (all `private` unless noted):

```typescript
// protected — signature changed: `fallback: number` is dropped (folded into
// `columns.widths`) and the column window is passed through.
protected bindAndPositionRows(
    firstRow  : number,
    windowSize: number,
    rowWidth  : number,
    records   : ModelRecord[],
    columns   : ColumnWindow,
): void;

// Both are framework-managed bookkeeping, so per ARCHITECTURE.md's third
// DOM-write rule neither gets a `BodyOptions` field or a public setter.
private _colWindow  : ColumnWindow;   // last applied window
private _reconciling: boolean;        // re-entrancy guard

// The body of today's `renderWindow`, below its two early returns. The public
// `renderWindow(bodyWidth?, columnWidths?)` keeps its signature.
private renderWindowPass(): void;

/** @returns `true` when at least one open edit was committed. */
private commitEditsOutsideWindow(keep: ColumnWindow | null): boolean;

private wireRowCells(row: Row): void;
```

Changed on `Row`:

```typescript
/**
 * Records the visible-field list, per-field configs and tree column this row
 * renders from. Builds no cells — `setColumnWindow` owns cell construction.
 * Replaces `syncCells`, whose parameter list it matches.
 */
setColumnFields(
    model        : AbstractModel,
    hiddenColumns: Set<string>,
    columnConfigs: Map<string, ColumnConfig>,
    treeFieldName?: string,
): this;

/**
 * Reconciles the rendered cells to exactly the visible columns
 * `[firstCol, lastCol]`. Returns `true` when the rendered set changed.
 */
setColumnWindow(firstCol: number, lastCol: number): boolean;

/** The visible-column index of the first rendered cell. */
getColumnWindowStart(): number;

/** Field name per *rendered* slot, index-aligned with `getComponents()`. */
getFieldNames(): string[];
```

Removed from `Row`: `syncCells(...)`.

Changed on `Cell`:

```typescript
/** `null` restores the theme default (`var(--ts-ui-table-cell-bg, transparent)`). */
setBaseBackground(color: string | null): this;
```

---

## Internal Structure

### `Row` private state

```typescript
private _visibleFields: Field[]                    = [];   // all non-hidden fields, display order
private _columnConfigs: Map<string, ColumnConfig>  = new Map();
private _treeFieldName: string | undefined;
private _windowFirst  : number                     = 0;    // visible-column index of slot 0
private _cellKeys     : string[]                   = [];   // cell key per rendered slot
private _fieldNames   : string[]                   = [];   // field name per rendered slot
private _columnsDirty : boolean                    = false;
```

The rendered columns are always a contiguous run, so slot `s` holds column `_windowFirst + s` and no per-slot column array is needed.

### `Row.setColumnWindow`

```
if (!_columnsDirty && firstCol === _windowFirst
                   && lastCol  === _windowFirst + getComponents().length - 1) return false;

// One entry per currently-rendered slot, so a survivor's old key is at hand.
byName ← Map(_fieldNames[s] → { cell: getComponents()[s], key: _cellKeys[s] })
assigned   ← array of length (lastCol - firstCol + 1), all undefined
retargeted ← empty Set of column indices

// Pass 1 — keep a cell for its own field, if its key still matches.
for col in firstCol..lastCol:
    field = _visibleFields[col]; key = cellKey(col)
    entry = byName.get(field.getName())
    if entry and entry.key === key:
        assigned[col - firstCol] = entry.cell
        byName.delete(field.getName())

free ← remaining entries of byName, grouped by entry.key

// Pass 2 — recycle a leftover with the same key, else build. `retargeted`
// collects the columns whose cell did not already hold that field.
for col in firstCol..lastCol where assigned[col - firstCol] is undefined:
    field = _visibleFields[col]; key = cellKey(col)
    cell  = free[key]?.pop()
    if cell:
        setLayoutConstraints(cell, { data: field })     // still a child; no DOM move
    else:
        cell = createCellForField(field, _columnConfigs)
        if col is the tree column: cell.wrapRenderer(d => new TreeCellRenderer(d))
        cell.on("commit", v => this.commitCellValue(cell, v))    // wired once, ever
        addComponent(cell, { data: field })
    assigned[col - firstCol] = cell
    retargeted.add(col)

// Pass 3 — per-column state that a shift can invalidate even for a survivor.
for col in firstCol..lastCol:
    cell = assigned[col - firstCol]; field = _visibleFields[col]
    cell.getAria().setColIndex(col + 1)
    cell.setBaseBackground(_columnConfigs.get(field.getName())?.groupColor ?? null)
    if col in retargeted: bindCell(cell, _data, field.getName())

// Discard whatever is still free.
for cell in remaining free:
    if cell.isEditing(): cell.commitEdit()
    removeComponent(cell); cell.dispose()

sortComponents(by constraint Field order)        // mirrors syncCells
_windowFirst = firstCol
_fieldNames  = names of _visibleFields[firstCol..lastCol]
_cellKeys    = keys  of _visibleFields[firstCol..lastCol]
_treeCell    = the assigned cell for the tree column, or null
_columnsDirty = false
return true
```

`commitCellValue(cell, value)` reads the cell's current `Field` from `getLayoutConstraints(cell)?.data`, writes it onto `_data`, calls `_onCellCommit`, and calls `updateVisualState()` — the body of today's per-cell closure, with the field resolved live.

### `Body.renderWindow` ordering

`renderWindow` keeps its public signature and its two existing early returns. What moves is the *body* below those returns, into a new `renderWindowPass()`; the guard wraps that call. Three points in the order are load-bearing, and each is called out where it applies.

**Public `renderWindow(bodyWidth?, columnWidths?)` — six steps, all of them existing code except step 2 and step 5's wrapper:**

1. `this.updateColumnWidthCache(bodyWidth, columnWidths)` — **first, before the guard and before both early returns**, exactly as on master today ([Body.ts:700](packages/lib/src/typescript/lib/component/table/Body.ts#L700)). Column widths reach this body from the parent table layout and from nowhere else, so a pass that step 4 defers would otherwise replay against the zero-width cache the body starts with. This is the font-activation layout gate's ordering; it must survive the rename.
2. `if (this._reconciling) { return; }` — **before** step 4, not after: `deferRenderWhileFirstLayoutHeld()` writes the `_renderResumed` flag that step 6 reads, so a nested call must not reach it.
3. `const element = this.getElement(); if (!element || !this._scroller) { return; }` — unchanged.
4. `if (this.deferRenderWhileFirstLayoutHeld()) { return; }` ([VirtualRowView.ts:434](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L434)) — unchanged.
5. `this._reconciling = true; try { this.renderWindowPass(); } finally { this._reconciling = false; }`. The guard is taken *after* every early return, so no return path can strand it; the `finally` covers a throw from inside the pass.
6. `this.finishResumedRender();` ([VirtualRowView.ts:475](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L475)) — last, and **outside** the guard. It applies any held scroll offset, and applying one re-enters `renderWindow` through the scroller's `onScroll` hook; that nested pass has to run, so `_reconciling` must already be clear.

**`renderWindowPass()` — today's body with the column work inserted:**

1. Capture `prevScrollX` / `prevScrollY`.
2. `records`, `totalRows`, `totalHeight`, `totalColumnWidth`, `totalContentWidth`, `clampToContent(totalContentWidth, totalHeight)`, `rowWidth` — unchanged.
3. Build `effectiveWidths[i] = _lastColumnWidths[i] ?? fallback` for each visible column, using today's `fallback` derivation.
4. `_colWindow = computeColumnWindow(effectiveWidths, scroller.getScrollX(), this.getWidth() || 0)`.
5. `if (this.commitEditsOutsideWindow(this._colWindow))` — on `true`, re-read `records = this.getVisibleRecords()` and recompute `totalRows` / `totalHeight`, so the row window, the ARIA row count and `layoutScrollbars` below all see the post-commit list. `clampToContent` is not re-run; `layoutScrollbars` at step 7 applies the final clamp with the fresh height.
6. Row window (`computeVisibleWindow`, `computePoolTarget`, `growRowPool`).
7. `bindAndPositionRows(firstRow, windowSize, rowWidth, records, _colWindow)`, then `hideExcessPoolRows`, ARIA row count, `layoutScrollbars`, scroll-event emits, `_updateFocusStyle` — unchanged apart from the new `columns` argument.

### `Body.bindAndPositionRows` per-slot body

```
row           = _rowPool[i]
windowChanged = row.setColumnWindow(columns.firstCol, columns.lastCol)

if windowChanged:
    wireRowCells(row)          // setEditorPool + setScrollIntoViewHandler on every cell
    _cellGeom[i] = []          // slot → column mapping changed; drop the cached geometry

dataIndex  = firstRow + i
wasRebound = _boundIndices[i] !== dataIndex

if wasRebound:
    row.setData(...); _boundIndices[i] = dataIndex; row.setStripe(...)
    updateRowVisualState(i); computeRowAria(row, dataIndex)

if wasRebound or windowChanged:
    applyReadOnlyState(row, records[dataIndex])

afterRowBound(row, dataIndex, wasRebound)
applyRequiredEmptyState(row, records[dataIndex])
positionRow(i, dataIndex * rowHeight, rowWidth)

x = columns.lefts[columns.firstCol] ?? 0
for slot in 0..row.getComponents().length - 1:
    colW = columns.widths[columns.firstCol + slot] ?? 0
    … existing geometry-cache compare, setX/setY/setWidth/setHeight, doLayout …
    x += colW
```

`setColumnWindow` runs first so `afterRowBound` — which `TreeBody` overrides to read `row.getTreeCell()` — sees the reconciled cell set.

---

## Ordered Implementation Steps

1. **`Cell.ts`** — widen `setBaseBackground(color: string | null)`; a `null` argument stores the existing default literal `'var(--ts-ui-table-cell-bg, transparent)'`. Check: `npm run typecheck`.

2. **`Row.ts` — state and inputs.** Add the private fields listed under *Internal Structure*. Add `setColumnFields(model, hiddenColumns, columnConfigs, treeFieldName?)`, which filters `model.getFields()` by `hiddenColumns`, sorts by `Field.getOrder()`, stores the result in `_visibleFields`, stores the configs and tree field name, and sets `_columnsDirty = true`. Add `getColumnWindowStart()`.

3. **`Row.ts` — cell key.** Add `private static cellKey(field, config, isTreeColumn): string` implementing the precedence table in `## Architecture Decisions`. Check: it returns `combo:status` for a `values` column and `datetime:true` for a `datetime` column with `showSeconds: true`.

4. **`Row.ts` — reconciler.** Add `setColumnWindow(firstCol, lastCol): boolean` per the pseudo-code, and `private commitCellValue(cell, value)`. Delete `syncCells`. Replace the constructor's cell-building loop with a call to `setColumnFields` when a `model` was supplied, so construction builds no cells. `Row.setData` and `Row.getTreeCell` need no change — both already read the windowed `_fieldNames` / `_treeCell` the reconciler maintains. `Header` and `Footer` need no change either: both construct `new Row()` with no `model` ([Header.ts:75](packages/lib/src/typescript/lib/component/table/Header.ts#L75) for the parent row and a second for the column row, [Footer.ts:31](packages/lib/src/typescript/lib/component/table/Footer.ts#L31)), and the loop being replaced already sits inside the constructor's `if (this._model)` guard, so those rows build no cells today and build none after the change. Check: `grep -rn 'syncCells' packages/lib/src` — every remaining match must be in `Body.ts` (the call in `syncPoolCells` and a `{@link Row.syncCells}` JSDoc reference in `getTreeFieldName`'s remarks), both cleared in step 6.

5. **`Body.ts` — window helper.** Add `COLUMN_BUFFER = 2`, `export interface ColumnWindow`, and `export function computeColumnWindow(widths, scrollX, viewportWidth)`. Initialise `_colWindow` to `{ firstCol: 0, lastCol: -1, widths: [], lefts: [] }`.

6. **`Body.ts` — pool wiring.** Extract the editor-pool / scroll-into-view loop shared by `createPoolRow` and `syncPoolCells` into `private wireRowCells(row: Row)`. Point `syncPoolCells` at `row.setColumnFields(...)` instead of `row.syncCells(...)`, and have `createPoolRow` call `row.setColumnWindow(this._colWindow.firstCol, this._colWindow.lastCol)` followed by `wireRowCells(row)` so a freshly-pooled row arrives already windowed. Repoint the `{@link Row.syncCells}` JSDoc reference in `getTreeFieldName`'s remarks at `Row.setColumnFields`. Check: `grep -rn 'syncCells' packages/lib/src` — expect zero matches; `npm run typecheck` clean.

7. **`Body.ts` — re-entrancy guard.** Add `_reconciling`. Move everything in `renderWindow` *below* its two early returns into a new `private renderWindowPass(): void`, and leave in the public `renderWindow(bodyWidth?, columnWidths?)`, in this order: the existing `updateColumnWidthCache(bodyWidth, columnWidths)` call, then `if (this._reconciling) { return; }`, then the existing `element` / `_scroller` return, then the existing `deferRenderWhileFirstLayoutHeld()` return, then `_reconciling = true` / `try { this.renderWindowPass(); } finally { this._reconciling = false; }`, then the existing `finishResumedRender()` call. Three things must survive the move: `updateColumnWidthCache` stays the very first statement, both gate calls stay, and `finishResumedRender()` stays last and outside the `try`. Apply the same guard to `syncPoolCells`. Check: `grep -n 'deferRenderWhileFirstLayoutHeld\|finishResumedRender\|updateColumnWidthCache' packages/lib/src/typescript/lib/component/table/Body.ts` — three matches, all inside the public `renderWindow`.

8. **`Body.ts` — commit pre-pass.** Add `private commitEditsOutsideWindow(keep: ColumnWindow | null): boolean`: walk `_rowPool`, and for each rendered slot whose column is outside `keep` (or for every slot when `keep` is `null`) call `commitEdit()` if the cell reports `isEditing()`; return whether any commit ran. Call it from `renderWindowPass` at step 5 of the pass ordering above, re-reading `records` / `totalRows` / `totalHeight` when it returns `true`, and from the top of `syncPoolCells` with `null` (ignoring the result).

9. **`Body.ts` — render pass.** Reorder `renderWindowPass` per *Internal Structure*, build `effectiveWidths`, assign `_colWindow`, and pass it into `bindAndPositionRows`. Drop the `fallback` parameter from `bindAndPositionRows`. `renderWindowPass` takes no parameters: the width cache is written by the public `renderWindow` before the guard, so the pass reads `_lastBodyWidth` / `_lastColumnWidths` as it does today.

10. **`Body.ts` — bind loop.** Rewrite the per-slot body per *Internal Structure*: `setColumnWindow` first, `_cellGeom[i] = []` and `wireRowCells` on change, `applyReadOnlyState` gated on `wasRebound || windowChanged`, geometry `x` seeded from `columns.lefts[firstCol]`, widths read at `firstCol + slot`. Delete the `if (!prevCell) cell.getAria().setColIndex(ci + 1)` branch — the reconciler owns `aria-colindex` now.

11. **`Body.ts` — slot mapping at the focus sites.** In `_updateFocusStyle`, `_updateActiveDescendant`, and the `Enter` / `Space` branch of `onKeyDown`, replace `cells[this._focusedColIndex]` with a lookup through `slot = this._focusedColIndex - row.getColumnWindowStart()`, guarded by `slot >= 0 && slot < cells.length`. In `onRowClick`, treat `resolveClickedColumn`'s result as a slot: `columnIndex = slot + row.getColumnWindowStart()`, and read the field name at `row.getFieldNames()[slot]`.

12. **`Body.ts` — keyboard column navigation.** In the `ArrowLeft` / `ArrowRight` branch of `onKeyDown`, after clamping `_focusedColIndex`, call `this.scrollColumnIntoView(this._focusedColIndex)` then `this.renderWindow()` before `_updateActiveDescendant()` and `_updateFocusStyle()`. In the `Enter` / `Space` branch, place the same two calls ahead of the slot lookup added in step 11, so it resolves against a window that already contains the focused column.

13. **Tests.** Add `packages/lib/tests/component/table/ColumnWindow.test.ts` covering `computeColumnWindow` directly. Extend `Body.test.ts` with the rendered-set, sliding, per-cell-state, column-set-change, editing and keyboard cases; `Table.test.ts` with the export and `aria-colcount` cases; `TreeBody.test.ts` with the tree-column cases. Check: `npm test`.

14. **Docs.** Update the `Body` and `Row` sections of [`packages/lib/docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md). Check: `npm run docs:api` finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Create | `packages/lib/tests/component/table/ColumnWindow.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/table/Table.test.ts` |
| Modify | `packages/lib/tests/component/table/TreeBody.test.ts` |
| Modify | `packages/lib/docs/components/TableInternals.md` |

---

## Expected Behaviour

### Unit-testable offline

The offline harness answers `getWidth()` / `getHeight()` from committed state, `_scroller.setScrollX` clamps and fires the render, `cell.startEdit()` runs, and `cell.getAria().getColIndex()` reads back — so every case below is a real red-green cycle.

**`computeColumnWindow` (pure).**

1. Twenty 100 px columns, viewport 250, `scrollX` 0 → `{ firstCol: 0, lastCol: 4 }`.
2. Same table, `scrollX` 550 → `{ firstCol: 3, lastCol: 10 }`.
3. Same table, `scrollX` 1750 → `{ firstCol: 15, lastCol: 19 }` — `lastCol` clamps to the final index.
4. Widths `[0, 0, 0]`, `scrollX` 0, viewport 0 → `{ firstCol: 0, lastCol: 2 }` — every column renders when no width is known.
5. Widths `[]` → `{ firstCol: 0, lastCol: -1 }`, and `lefts` / `widths` are empty.
6. `lefts` is the running sum of `widths`: `[100, 50, 200]` → `lefts` `[0, 100, 150]`.

**Rendered cell set.**

7. A body over twenty 100 px columns at viewport width 300, scrolled to 0, renders 6 cells per pool row — raw-visible columns 0–3 plus `COLUMN_BUFFER` on the right, with the left buffer clamped at 0 — not 20.
8. A body whose columns all fit the viewport renders every column, and `row.getColumnWindowStart()` is `0` — the no-regression case.
9. `row.getFieldNames().length === row.getComponents().length`, and for every slot index `s`, `row.getFieldNames()[s]` is the name of visible column `row.getColumnWindowStart() + s`.

**Sliding the window.**

10. `_scroller.setScrollX` far enough to cross a column boundary advances `row.getColumnWindowStart()` and leaves the rendered cell count unchanged.
11. Over a table whose columns are all `string`, a one-column slide reuses the departing cell for the entering column — the same `Cell` instance is present before and after, at the new slot.
12. Over a table where the entering column is `number` and the departing one is `string`, the entering column's cell is a fresh `NumberCell` (`getEditorKey() === 'number'`). The departing cell is gone from `row.getComponents()` and was disposed — assert `departed.getComponents().length === 0`, since `Component.destructor` clears the child array while a bare `removeComponent` leaves the renderer attached.
13. After any slide, `cell.getAria().getColIndex()` equals its column index plus one for every rendered cell.

**Per-cell state on entry.**

14. A column configured `readOnly: true` that scrolls into the window has `isReadOnly() === true` on its cell without the row rebinding.
15. A column configured `required: true` whose bound value is empty shows the required outline as soon as it scrolls into the window.
16. A recycled cell entering a column with no `groupColor` loses the previous column's group tint.

**Column-set changes.**

17. `setHiddenColumns` hiding a middle column leaves the surviving columns' `Cell` instances unchanged (matched by field name), and the rendered set drops the hidden field.
18. `setColumnConfigs` that adds `values` to a column replaces that column's cell with a `ComboCell`.

**Editing.**

19. `startEdit()` on a cell, then a `setScrollX` that pushes its column out of the window: the cell reports `isEditing() === false` and the record holds the edited value.
20. The same sequence does not recurse — `renderWindow` completes and the pool is intact.

**Export and ARIA count.**

21. `Table.exportCSV` on a wide table scrolled to the far right emits every column, not just the windowed ones.
22. `aria-colcount` on the table equals the full column count regardless of scroll position.

**Keyboard.**

23. `ArrowRight` past the right edge of the viewport advances `_scroller.getScrollX()` and leaves the newly-focused column inside the rendered set.
24. `ArrowLeft` at column 0 clamps and does not scroll.

**Tree.**

25. `TreeBody` with the tree column scrolled out of the window: `row.getTreeCell()` is `null` and the render completes.
26. Scrolling the tree column back in restores a cell whose renderer is a `TreeCellRenderer`.

### Manual verification

These need a browser — geometry against real layout, focus, and paint are outside the offline harness.

- Open the demo app (`npm run dev`, `http://localhost:8015`) and use **"Show window with wide table (45 columns)!"** in `MiscPanel`. Wheel-scroll horizontally at speed: no blank columns, no flicker at boundaries, header cells stay aligned with the body columns beneath them.
- Arrow across the right viewport edge: the body scrolls and the focus ring lands on the newly-focused cell, with the header's column indicator following.
- Double-click a cell near the right edge to open its editor, then wheel-scroll horizontally: the edit commits and the value lands on the record.
- Open a `ComboCell` editor and scroll: the dropdown stays anchored to its cell or closes cleanly — it never floats detached.
- With DevTools open, confirm the wide table stays responsive and that the shared stylesheet's rule count does not grow across repeated left-right scroll cycles.
- `TreeTable`: scroll the tree column off and back; the indent and expand/collapse toggle return at the right depth, and toggling still works.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean; the `local/no-raw-dom` rule must stay at its empty baseline.
- `npm test` — the new `ColumnWindow.test.ts` plus the added cases pass. Every *existing* case under `packages/lib/tests/component/table/` must stay green with no edit to its body: `RotatedView.test.ts`, `CustomRenderer.test.ts` and the `cell/` suite all index `row.getComponents()` directly, and they exercise narrow tables whose windows cover every column. A failure there means the zero-width case in `computeColumnWindow` is not rendering every column.
- `grep -rn 'syncCells' packages/lib/src packages/lib/tests` — expect zero matches.
- `Body.test.ts`'s existing `growRowPool` case asserts a freshly-pooled row carries 3 cells. It calls `growRowPool` directly, after a `renderWindow(300, [100, 100, 100])` that leaves `_colWindow` covering all three columns — so it stays green only if `createPoolRow` applies `_colWindow` (step 6). A `0` there means the pool row was left unwindowed.
- `grep -rn 'setColIndex' packages/lib/src/typescript/lib/component/table/Body.ts` — expect zero matches; the reconciler in `Row.ts` owns it.
- `npm run docs:api` — zero warnings.
- Manual smoke tests as listed under `## Expected Behaviour`.

---

## Documentation Impact

`Row` is exported as `TableRow` and `Body` as `TableBody` from `@jimka/typescript-ui/component/table`, so both changes are consumer-visible.

- [`packages/lib/docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md): the **Body** bullet list gains a line stating that only the horizontally-visible column range is rendered per row; the **Row** paragraph, which currently says Row "creates one typed cell per model field", is corrected to say it creates one cell per column in the body's current column window.
- `Row.syncCells` is removed and `Row.setColumnFields` / `setColumnWindow` / `getColumnWindowStart` are added. None is referenced from any hand-written doc page (`grep -rn 'syncCells' packages/lib/docs --include=*.md` outside `docs/api` returns nothing), so only the generated API pages change.
- `Cell.setBaseBackground`'s JSDoc gains the `null` case.
- No entry in [`packages/lib/llms.txt`](packages/lib/llms.txt) changes — the capability index lists components, and no component is added or removed.

---

## Potential Challenges

- **A commit fired mid-render no longer cascades into its own render pass.** [`applyRequiredEmptyState`](packages/lib/src/typescript/lib/component/table/Body.ts#L1205) documents that it relies on a commit cascading back through `store.notifyRecordChanged` into `renderWindow` to clear a filled cell's tint. The `_reconciling` guard drops that nested pass — but the outer pass runs `applyRequiredEmptyState` itself afterwards, so the tint still clears. A commit fired from outside a render (the normal blur or `Enter` path) cascades exactly as before. Keep the pre-pass at step 5 of the `renderWindowPass` ordering so this stays true.
- **The `_reconciling` guard must not swallow the font gate's resumed pass.** `finishResumedRender` applies a held scroll offset, and that re-enters `renderWindow`. The guard is released before that call (step 6 of the public ordering), so the re-entry runs. Moving `finishResumedRender()` inside the `try` would silently drop it and leave the body rendered at the pre-scroll offset.
- **`setReadOnly(true)` can commit an open edit** ([Cell.ts:256](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L256)) from inside `applyReadOnlyState`, which now also runs on a window change. The same `_reconciling` guard covers it.
- **A horizontal scroll used to be nearly free.** `renderWindow` currently short-circuits on the `_cellGeom` cache when only `scrollX` moved. Crossing a column boundary now reconciles the cell set on every pool row. `COLUMN_BUFFER` and the `setColumnWindow` early-out keep that to at most one reconciliation per boundary crossed; measure with the 45-column demo before accepting the cost.
- **Slot order and DOM order diverge.** `sortComponents` reorders only the children array, not the DOM — as it already does in `syncCells` and `Header.rebuildCells`. Cells are absolutely positioned, so paint is unaffected, but do not assume DOM child order matches column order.
- **`Header` and `Footer` build bare `Row` instances** ([Header.ts:75](packages/lib/src/typescript/lib/component/table/Header.ts#L75), [Footer.ts:31](packages/lib/src/typescript/lib/component/table/Footer.ts#L31)) with no model and add cells through `addComponent`. They never call `setColumnFields` or `setColumnWindow`, so their rows keep an empty `_visibleFields` and are untouched — verify by running `RotatedView.test.ts`, which asserts against header cells.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `resolveClickedColumn` (the precedent for the new pure helper), `renderWindow`, `bindAndPositionRows`, `syncPoolCells`, `applyReadOnlyState`, `applyRequiredEmptyState`, `_updateFocusStyle`, `_updateActiveDescendant`, `onKeyDown`, `scrollColumnIntoView`.
- [`packages/lib/src/typescript/lib/component/table/Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) — `syncCells` (the reconciler being replaced) and `createCellForField` (the cell-kind switch the cell key encodes).
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `SCROLL_BUFFER`, `computeVisibleWindow`, `computePoolTarget`: the shape the column window mirrors.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts#L411) — `rebuildCells` (411) / `wireCell` (595): the wire-once, resolve-live listener precedent.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) — `getEditorKey`, `startEdit`, `commitEdit`, `detachEditor`, `setBaseBackground`, `setReadOnly`.
- [`packages/lib/src/typescript/lib/component/table/TreeBody.ts`](packages/lib/src/typescript/lib/component/table/TreeBody.ts) — `afterRowBound`, `getToggleElement`, `onSubtreeClick`: the three tree-cell call sites that must keep working when `getTreeCell()` returns `null`.
- [`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L232) — `setScrollX` and its `_onScroll` call, the path that makes a horizontal scroll re-render.
- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts#L304) — the only caller that passes `bodyWidth` / `columnWidths` into `renderWindow`.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L434) — `deferRenderWhileFirstLayoutHeld` (434) and `finishResumedRender` (475): the startup font gate `renderWindow` is wrapped around, whose ordering the guard must not disturb.
- [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts) — the white-box offline pattern the new tests extend.
- [`packages/lib/src/typescript/lib/component/table/TableExporter.ts`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L41) — confirmed to read `Column[]` plus `ModelRecord[]` only; it never touches a live cell, so export is unaffected.

---

## Non-Goals

- **The header is not virtualized here.** [`Header.rebuildCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L411) still builds one `HeaderCell` per visible column. A header is a single row, so it costs *n* cells rather than *rows × n*; windowing it needs its own resize-handle and sort-state bookkeeping, so it is handled by the companion plan `plans/table-header-column-virtualization.md`, which consumes the `computeColumnWindow` this plan exports.
- **The standalone `Tree`** ([`component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts)) is untouched. It is the other `VirtualRowView` subclass, but its rows hold a single cell — there is no column axis to window.
- **`Tab` key navigation** is not added. `Body.onKeyDown` does not handle `Tab` today, and adding it is the scope of `plans/framework-focus-traversal.md`.
- **Column pinning / freezing** is not introduced here. Pinned columns are `plans/table-column-pinning.md`'s subject; nothing in this plan pins a column into the window unconditionally.
- **No option, threshold, or opt-out.** Column virtualization is always on, so there is one code path to reason about and to test.

---

## Notes

[^window-on-body]: Hoisting the column window onto `VirtualRowView` next to `computeVisibleWindow` was considered and rejected: the base class's other subclass is `Tree`, whose rows hold one cell, so a column helper there would be dead code for half its consumers. `Body` is the only class that owns `_lastColumnWidths`, so the helper belongs in `Body.ts`. Making it a module-level pure function rather than a private method is what `resolveClickedColumn` already does in the same file — it keeps the arithmetic unit-testable without constructing a `Body`, a store, and a DOM.

[^inclusive-bounds]: The natural half-open form (`right > scrollX && left < scrollX + viewportWidth`) excludes a zero-width column, and zero-width columns are the norm in two situations that must keep working: any render before the layout manager has supplied widths (`_lastColumnWidths` is `[]`), and the whole offline test suite, which materialises a `Body` without running `layout/Table.doLayout`. Under the inclusive form every column collapses to the point `x = 0`, satisfies both bounds, and renders — which is exactly today's behaviour. The cost on a real table is at most one extra column at each edge, which the `COLUMN_BUFFER` padding would have added anyway.

[^recycle-vs-lazy]: The rejected alternative keeps cells bound to their column for life and merely defers construction until the column first enters the window. It is simpler, but it only defers the cost: a user who scrolls a 100-column table from end to end ends up with all ~2000 cells resident, so neither the DOM node count nor the memory is bounded. Recycling bounds both permanently at `pool × windowColumns` (~20 × 14). The rebuild cost recycling pays is smaller than it looks, because the rendered range is contiguous: a one-column slide leaves every column but one matched by name, so at most one cell per row is re-targeted per boundary crossed — and on the stress case (a wide table of same-typed columns) that one cell is recycled rather than rebuilt, so a full-width horizontal scroll constructs nothing at all.

[^cell-key]: The key must capture every constructor input `createCellForField` reads, not just the class: `TimeCell` and `DateTimeCell` take `showSeconds`, `ComboCell` takes the column's option list, `DynamicCell` takes the field name plus the whole config, and a `renderer` config supplies a per-column factory. Folding all of those into one string means the reuse test is a single equality check on the hot path. The existing `wantsCombo` / `wantsDynamic` comparison in `syncCells` ([Row.ts:317](packages/lib/src/typescript/lib/component/table/Row.ts#L317)) is the same idea at lower resolution — it only had to detect a config swap on a fixed field, whereas recycling moves a cell between fields and so needs the finer key.

[^dispose-on-discard]: `removeComponent` calls `unwireChild`, which detaches the element but never runs the destructor — by design, since a removed child may be re-parented. The consequence is that the component's per-instance stylesheet rule survives. `syncCells` already leaks this way, but only on a hide/show, which is rare. Column virtualization discards cells on scroll, so the same omission would grow the shared sheet continuously. `Component.dispose()` is public and idempotent, so the fix is one call per discarded cell. It also fixes the pre-existing hide/show leak, since both paths now run through the one reconciler.

[^reentrancy]: `Cell.commitEdit` sets the renderer value and emits `"commit"` *before* `detachEditor` clears `_activeEditor`, so the cell still answers `isEditing() === true` for the duration of the emit. `Row`'s commit handler calls `store.notifyRecordChanged`, which fires `datachange`, which routes into `Body.onStoreChange` and back into `renderWindow`. Without a guard, a nested `renderWindow` would run its own commit pre-pass, find the same cell still editing, and commit it again — unbounded recursion. The same trap and the same class of fix are documented on `Cell.setReadOnly` ([Cell.ts:243](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L243)), which flips its flag before committing so the re-entrant call short-circuits. Dropping the nested render rather than queueing it is safe because both guarded methods commit before they read the state they render from: `renderWindowPass` re-reads `getVisibleRecords()` whenever the pre-pass committed anything, and `syncPoolCells` is always followed by an unguarded `renderWindow()` from its caller. Two placement details follow from the startup font gate that wraps `renderWindow`. The `_reconciling` early return sits *above* `deferRenderWhileFirstLayoutHeld()` because that method rewrites `_renderResumed` from `_renderDeferred`, and a nested call reaching it would clear the flag the outer pass's `finishResumedRender()` still has to read. `finishResumedRender()` sits *below* the `finally` because it calls `applyPendingScroll()`, whose whole purpose is to re-enter `renderWindow` at the applied offset — a re-entry the guard would otherwise swallow. A nested call still caches any widths it carries, because `updateColumnWidthCache` runs before the guard check; only the render is dropped, and the next pass picks the fresh widths up.

[^wire-once]: `ListenerBag.add` appends, so re-registering a `"commit"` listener on a surviving cell stacks duplicates. Today's `syncCells` does exactly that — it calls `cell.on("commit", …)` for every target field, new or surviving ([Row.ts:335](packages/lib/src/typescript/lib/component/table/Row.ts#L335)) — which is harmless only because the duplicate writes the same value twice. Under recycling it would be worse: the stale closure captures the field name the cell was *built* for, so a recycled cell would write its new value onto its old field. Wiring once at construction and resolving the field from the row's layout constraints at emit time removes both problems.

[^tree-column]: Pinning the tree column into the window unconditionally was considered and rejected. It would break the contiguity the whole design rests on — every slot-to-column conversion is `firstCol + slot`, and a pinned column would need a special first slot plus a second mapping. It is also not what the tree column does today: it scrolls off the left edge like any other column. Freezing it is the column-pinning feature's job. `TreeBody`'s three tree-cell call sites already null-guard: `afterRowBound` tests `if (treeCell && flat)`, `getToggleElement` returns `null` early, and `onSubtreeClick` falls through to the inherited row handler when no toggle matches.

[^focus-by-index]: `_focusedColIndex` is already a column index rather than a cell reference, so the focus model needs no restructuring — only the three sites that dereference it against `row.getComponents()` do. `resolveClickedColumn` is the one place where the direction reverses: it scans the rendered cells and so returns a slot, which `onRowClick` must convert before assigning it to `_focusedColIndex` or putting it in the `"cellclick"` payload's `columnIndex`. The payload's documented contract — "the visible-column order the body exposes" — is preserved by that conversion, so consumers see no change.

[^plan-neighbours]: Four neighbours, checked one at a time.
    **`table-column-pinning.md`** (unimplemented) composes two ordinary `Table` instances rather than editing `Body`, and explicitly leaves their virtual scrolling untouched; the pinned child's columns fit its frame by construction, so its column window covers all of them and pinning is unaffected either way.
    **`table-chained-column-resize.md`** is not merely planned — it is in progress on `feature/table-chained-column-resize`, with a live worktree at `.worktrees/table-chained-column-resize`, so the implementer will find that code on a branch rather than in `plans/`. `git diff --stat master...feature/table-chained-column-resize` confirms its library edits are `component/table/Table.ts`, `layout/Table.ts` and a new `core/DragChain.ts`, plus `tests/component/table/ColumnResize.test.ts`; it touches none of `Body.ts`, `Row.ts`, `Header.ts` or `VirtualRowView.ts`. It does interact in one direction worth knowing about: it lets the total column width exceed the container, which produces more horizontal scroll extent and therefore makes the column window matter more — a reinforcement, not a conflict.
    **`table-generated-column-widths.md`** has shipped, as commit `4b2e99e7`, and now sits in `plans/implemented/`. It replaced `Table.defaultColumnWidth` with a per-type width policy behind two new public seams, `Table.getColumnMinWidth` and `Table.getIntrinsicColumnWidths`. The widths still reach this plan through the unchanged `Body.renderWindow(bodyWidth?, columnWidths?)` signature ([Body.ts:693](packages/lib/src/typescript/lib/component/table/Body.ts#L693)), fed from the single call site in [`layout/Table.ts:304`](packages/lib/src/typescript/lib/layout/Table.ts#L304), so nothing in this plan changes. One cost is worth naming rather than discovering: `getIntrinsicColumnWidths` builds a policy, a header string and a content sample for *every* column, not for the windowed ones, so a wide table still pays an O(columns) derivation. It is bounded, though — the text measurement is batched through `Util.measureTextWidths` into at most three reflows regardless of column count, and the derivation runs once at open plus once on the first store event that finds records. Column virtualization neither helps nor hurts it, and this plan does not try to window it.
    **`scrollbar-leak-and-layout-guards.md`** (unimplemented) shares two files with this plan's *reading* list but not its editing list: it adds `VirtualScroller.dispose()` and a `this._scroller?.dispose()` line to `VirtualRowView.destructor()`, while this plan modifies only `Body.ts`, `Row.ts` and `Cell.ts`. Its Bug 1 is the same failure this plan's dispose-on-discard decision avoids — a component attached with a raw `DOM.sink.appendChild` and held in a private field never reaches the destructor's child recursion, so its per-instance stylesheet rules survive teardown — but the owners are different (its scrollbars and gutters, this plan's discarded cells), so the two do not conflict and neither ordering is forced. That plan branches from `feature/docs-component-demo-set` rather than `master`, which affects only its own merge order; this plan branches from `master` and is unaffected.
