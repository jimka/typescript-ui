---
depends-on: [table-column-virtualization, table-chained-column-resize]
touches-shared:
  - packages/lib/src/typescript/lib/layout/Table.ts
  - packages/lib/src/typescript/lib/component/table/Table.ts
  - packages/lib/src/typescript/lib/component/table/Body.ts
---

# Table Header Column Virtualization — Implementation Plan

## Overview

The companion plan [`plans/table-column-virtualization.md`](plans/table-column-virtualization.md) windows the table **body**'s columns and names the header as out of scope. This plan windows the header.

Today [`TableHeader`](packages/lib/src/typescript/lib/component/table/Header.ts) builds one `HeaderCell` per visible column in [`rebuildCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L411), plus one `ParentHeaderCell` per group run in [`rebuildParentCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L519) — and `rebuildParentCells` builds a blank spanning cell for every *ungrouped* column, so a 100-column table with no groups builds 100 `HeaderCell` instances **and** 100 `ParentHeaderCell` instances. `HeaderCell` is the framework's heaviest cell: a renderer, a `ResizeHandle`, a `SortPriorityBadge`, an optional `Glyph`, a tooltip attachment, and two stylesheet rules each.

After this plan the header renders only the horizontally-visible column range plus the body plan's `COLUMN_BUFFER` on each side — the same range the body renders — and the parent row builds no cells at all when no visible column declares a group.[^why-now]

Five source files change: [`Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) (window, reconciler, cell geometry), [`cell/Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts) (a re-targetable field name and a real destructor), [`layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) (drops its two per-column loops), and [`component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) plus [`Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) (two call sites that move onto new `TableHeader` methods). The package barrel gains one type re-export.

A rotated table — `Table.setDisplayMode("rotated")` ([Table.ts:30](packages/lib/src/typescript/lib/component/table/Table.ts#L30)) — projects into a three-column model, so its header window always covers every column and nothing about rotation needs special handling.

---

## Architecture Decisions

### `TableHeader` reconciles *and* positions its own cells

`TableHeader` gains `renderColumnWindow(geometry?)`: it computes the column window, reconciles the column row's cells to it, and assigns every rendered cell its x / y / width / height. [`layout/Table.doLayout`](packages/lib/src/typescript/lib/layout/Table.ts#L88) keeps sizing the header band and the two inner rows, and replaces its two per-column `forEach` loops ([layout/Table.ts:191](packages/lib/src/typescript/lib/layout/Table.ts#L191) and [layout/Table.ts:231](packages/lib/src/typescript/lib/layout/Table.ts#L231)) with one call.

The precedent is [`Body.bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L812), which positions the body's cells inside the same pass that reconciles them, and [`Body.renderWindow(bodyWidth?, columnWidths?)`](packages/lib/src/typescript/lib/component/table/Body.ts#L693), which caches its geometry arguments so a scroll-driven pass can re-run with no arguments.[^geometry-ownership]

### The header renders no cells until its first `renderColumnWindow`

`rebuildCells` stops building cells. It recomputes the visible-field list, marks the cell set dirty, and returns; construction happens in `renderColumnWindow`. A `TableHeader` that has never been laid out therefore has zero header cells, exactly as a `Body` that has never called `renderWindow` has zero pooled rows.[^no-eager-build]

Every path that changes the visible column set already ends in a layout pass, so nothing observes the empty state: [`Table.setColumnVisible`](packages/lib/src/typescript/lib/component/table/Table.ts#L557), [`Table.resetColumns`](packages/lib/src/typescript/lib/component/table/Table.ts#L1349) and [`Table.bindView`](packages/lib/src/typescript/lib/component/table/Table.ts#L1107) each call `this.doLayout()` as their last statement.

### The window comes from the body plan's `computeColumnWindow`

`TableHeader` imports `computeColumnWindow` and the `ColumnWindow` type from `~/component/table/Body.js` — the body plan exports both from that module. No second implementation, no second buffer constant.[^import-direction]

The widths handed to it are **padded to the visible-column count**, filling any missing entry with `0`:

```
effectiveWidths[i] = geometry.columnWidths[i] ?? 0,  for i in 0 .. visibleFields.length - 1
```

Padding matters because `computeColumnWindow` derives the column count from the array it is given: handing it a short array would silently render fewer columns, and handing it an empty one would render none. A zero-width column satisfies `computeColumnWindow`'s inclusive bounds, so a padded entry always renders. A width array that has fallen behind the column list therefore degrades to "render every column" — the pre-virtualization behaviour — instead of blanking the header.

| Visible columns | Supplied `columnWidths` | Padded widths | Viewport | `scrollX` | Window |
|---|---|---|---|---|---|
| 4 | `[]` | `[0, 0, 0, 0]` | 0 | 0 | 0–3 — all four |
| 4 | `[150, 150]` | `[150, 150, 0, 0]` | 600 | 0 | 0–3 — all four |
| 4 | `[150, 150, 150, 150]` | unchanged | 600 | 0 | 0–3 — all four |
| 20 | `[100 × 20]` | unchanged | 250 | 550 | 3–10 |

### `getColumns()` returns rendered cells; `getColumnWindowStart()` converts a slot to a column

[`TableHeader.getColumns()`](packages/lib/src/typescript/lib/component/table/Header.ts#L243) keeps its signature but now returns only the rendered cells. A **slot** is a position in that array; a **column index** is a position in the visible-column list. The new `getColumnWindowStart()` converts between them:

```
column = getColumnWindowStart() + slot
slot   = column - getColumnWindowStart()
```

Twenty 100 px columns, viewport 250, `scrollX` 550 — the window is 3–10, so `getColumnWindowStart()` is `3` and eight cells are rendered:

| Slot | Column | `lefts[column]` | `aria-colindex` written |
|---|---|---|---|
| 0 | 3 | 300 | 4 |
| 1 | 4 | 400 | 5 |
| 6 | 9 | 900 | 10 |
| 7 | 10 | 1000 | 11 |

Every site that produced or consumed a column index through `getColumns()` converts:

| Site | Today | After |
|---|---|---|
| [`wireCell`'s resize emits](packages/lib/src/typescript/lib/component/table/Header.ts#L597) | `getColumns().indexOf(cell)` → `2` | `columnIndexOf(cell)` → `5` |
| [`syncSortIndicators`](packages/lib/src/typescript/lib/component/table/Header.ts#L666) | `visibleFields[slot]` | `visibleFields[windowStart + slot]` |
| [`layout/Table.ts:113`](packages/lib/src/typescript/lib/layout/Table.ts#L113) | `container.getHeader().getColumns().length` | `container.getColumns().length` |
| [`Body._updateFocusStyle`](packages/lib/src/typescript/lib/component/table/Body.ts#L1299) | loops header cells by index | delegates to `header.setFocusedColumn(...)` |

The `layout/Table.ts:113` row is the one that must not be missed: that value feeds the `columnWidths.length !== columnCount` test at [layout/Table.ts:118](packages/lib/src/typescript/lib/layout/Table.ts#L118), so leaving it reading rendered cells would re-derive every column width on every window slide.[^column-count]

### Header cells are recycled across columns, with no cell key

A header cell whose column leaves the window is reused for a column entering it. Every rendered cell is a `HeaderCell`, so — unlike the body's `Cell` reconciler — there is no cell kind to key on and any leftover cell can serve any entering column.[^recycle-not-rebuild]

The reconciler runs three passes:

1. Give each column in the window the cell that already holds its field, matched by field name.
2. Hand each still-unassigned column a leftover cell, re-targeting it.
3. Re-apply every piece of per-column state to every rendered cell.

Matching by name before any recycling is what stops a recycle from stealing a cell another column wants by name.

Window `3–10` sliding to `4–11`:

| Column | In old window | In new window | Action |
|---|---|---|---|
| 3 | yes | no | left over |
| 4–10 | yes | yes | matched by field name — cell untouched |
| 11 | no | yes | recycles column 3's cell |

Hiding the `city` column from a rendered set of `name` / `city` / `qty`, with `due` sliding in behind it:

| Column | Before | After | Action |
|---|---|---|---|
| `name` | rendered | rendered | matched by field name — cell untouched |
| `city` | rendered | hidden | left over |
| `qty` | rendered | rendered | matched by field name — cell untouched |
| `due` | not rendered | rendered | recycles `city`'s cell |

### Every per-column property is re-applied on every reconcile

Pass 3 writes all of the following on each rendered cell, whether or not it was re-targeted, so a recycled cell can never show a trace of its previous column:

| Property | Written with | Value |
|---|---|---|
| Field identity | `setFieldName` (new) | `field.getName()` |
| Label | `setHeaderText` | `column.getHeaderText() ?? field.getName()` |
| Tooltip | `setTooltip`, only when `getTooltip()` differs | `field.getDescription()` |
| Header glyph | `setHeaderGlyph`, only when `getHeaderGlyph()` differs | `column.getHeaderGlyph() ?? null` |
| Group tint | `setBaseBackground` | `column.getGroupColor() ?? null` |
| Required marker | `setRequired` | `column.isRequired() ?? false` |
| Column index | `getAria().setColIndex` | `column index + 1` |

Sort direction and the multi-sort priority badge are not written here — `syncSortIndicators` already owns both and runs after every reconcile that changed the rendered set. The column-focus underline is likewise owned by `setFocusedColumn` below.

The tooltip and glyph writes are guarded by an equality check because both tear down and rebuild real state.[^guarded-writes] The group tint moves from `setBackgroundColor` to `setBaseBackground(color | null)` — the widened setter the body plan adds to `Cell` — because a recycled cell must be able to *lose* a tint, which the current `if (groupColor)` write cannot express.

### Listeners stay wired once and resolve the column index live

`wireCell` keeps being called exactly once per cell, at construction, and its resize / sort / context closures keep resolving the cell's position at emit time. Only the resolution changes: `getColumns().indexOf(cell)` becomes a private `columnIndexOf(cell)` that adds the window start.

This is the rule [Header.ts:456](packages/lib/src/typescript/lib/component/table/Header.ts#L456) already states — re-wiring a surviving cell stacks duplicate listeners on its `ListenerBag`, so a single drag would emit `columnresize` several times with mismatched indices. Recycling makes it stricter: a re-wired listener would also close over the field the cell was *built* for.

### `TableHeader` owns the horizontal-scroll mirror and the focused-column indicator

Two loops move out of other classes and onto `TableHeader`, because both have to re-run whenever the window slides:

- `setScrollX(scrollLeft)` records the offset, translates the two inner rows, and re-renders the window. The `"horizontalscroll"` listener in [`Table.ts:254`](packages/lib/src/typescript/lib/component/table/Table.ts#L254) calls it instead of writing the translates itself.
- `setFocusedColumn(colIndex | null)` records the focused column and paints the underline on the rendered cell holding it, clearing every other. [`Body._updateFocusStyle`](packages/lib/src/typescript/lib/component/table/Body.ts#L1284) calls it instead of looping header cells.

Ownership matters for ordering: [`Body.onScrollerTick`](packages/lib/src/typescript/lib/component/table/Body.ts#L633) emits `"horizontalscroll"` *after* `renderWindow` has already run `_updateFocusStyle`, so a header that slid in response to the emit would keep a stale underline unless it re-applies its own.[^focus-ordering]

### The parent (group) row is not windowed — it builds nothing when there are no groups

`rebuildParentCells` gains one early return: when [`hasParentRow()`](packages/lib/src/typescript/lib/component/table/Header.ts#L268) is `false`, the parent row is cleared and no cells are built. The rendered parent cells are otherwise unchanged — every group run still gets its cell, at its full span.[^parent-not-windowed]

| Visible columns' groups | Parent cells built |
|---|---|
| no column declares a group | 0 |
| `A A A B B` | 2 |
| `A A null B` | 3 — an ungrouped column never merges with its neighbours |

### Parent-cell geometry is a prefix-sum lookup, not a per-span loop

A parent cell is positioned from the window's `lefts` and `widths` arrays in constant time:

```
x     = lefts[spanFrom]
width = lefts[spanTo] + widths[spanTo] - x
```

Widths `[100, 60, 60, 200, 90]` give `lefts` `[0, 100, 160, 220, 420]`:

| Parent cell | `spanFrom` | `spanTo` | x | width |
|---|---|---|---|---|
| `Identity` | 0 | 1 | 0 | 160 |
| `Detail` | 2 | 3 | 160 | 260 |
| blank | 4 | 4 | 420 | 90 |

This replaces the two nested accumulation loops at [layout/Table.ts:197-205](packages/lib/src/typescript/lib/layout/Table.ts#L197), whose combined cost is quadratic in the column count when most columns are ungrouped.

### What stays O(columns)

Per-cell work — component setters, `doLayout`, DOM writes — becomes O(window size) for the column row and O(group runs) for the parent row. Two O(columns) numeric passes remain per layout: the padded `effectiveWidths` array and `computeColumnWindow`'s running sum of `lefts`. Both are plain arithmetic over a number array with no component or DOM contact, and neither is worth eliminating.

### Ordering against the two plans this one follows

This plan lands after both [`table-column-virtualization.md`](plans/table-column-virtualization.md) (whose `computeColumnWindow` and widened `Cell.setBaseBackground` it consumes) and [`table-chained-column-resize.md`](plans/table-chained-column-resize.md), which is **in flight** on the live worktree `.worktrees/table-chained-column-resize` and rewrites `component/table/Table.ts` and `layout/Table.ts`.

The conflict is concrete: the chained-resize branch rewrites [layout/Table.ts:114](packages/lib/src/typescript/lib/layout/Table.ts#L114) (`availableWidth` becomes `container.getAvailableColumnWidth()`) and line 122, and this plan rewrites line 113 in the same hunk. Merge the chained-resize branch first, then apply this plan on top: keep that branch's `getAvailableColumnWidth()` call and change only the `columnCount` line.[^conflict]

---

## Public API

New and changed exports from `component/table/Header.ts`:

```typescript
/**
 * The geometry the table layout supplies to the header on each pass. Cached
 * by `renderColumnWindow` so a scroll-driven pass can re-run with no argument.
 *
 * @category Components
 */
export interface HeaderColumnGeometry {
    /** Width per visible column, in display order. May be shorter than the column list. */
    columnWidths   : number[];
    /** The width the columns are windowed against — the table's available column width. */
    viewportWidth  : number;
    /** Height of the column-header row, in pixels. */
    columnHeight   : number;
    /** Height of the parent-header row, in pixels; `0` when it is collapsed. */
    parentRowHeight: number;
}
```

```typescript
class TableHeader extends Component {

    /**
     * Reconciles the rendered header cells to the horizontally-visible column
     * range and positions every rendered cell in both rows.
     *
     * @param geometry - Replaces the cached geometry when supplied; the cached
     *   value is reused when omitted.
     */
    renderColumnWindow(geometry?: HeaderColumnGeometry): this;

    /**
     * Mirrors the body's horizontal scroll offset onto the header's two inner
     * rows and re-renders the column window.
     */
    setScrollX(scrollLeft: number): this;

    /** The horizontal scroll offset last applied. */
    getScrollX(): number;

    /** The visible-column index of the first rendered header cell. */
    getColumnWindowStart(): number;

    /**
     * Paints the column-focus underline on the rendered cell for `colIndex`
     * and clears it everywhere else. `null` clears every cell.
     */
    setFocusedColumn(colIndex: number | null): this;

    /**
     * The rendered header cells, in slot order. A slot maps to a visible-column
     * index by adding `getColumnWindowStart()`.
     */
    getColumns(): Component[];
}
```

New on `component/table/cell/Header.ts`:

```typescript
class HeaderCell extends DefaultCell {

    /** Re-targets this cell at another column's model field. */
    setFieldName(name: string): this;

    /** The model field name this cell currently reports on sort and context-menu events. */
    getFieldName(): string;

    /**
     * Destroys the three children this cell appends to its own element rather
     * than through `addComponent`, then defers to the base destructor.
     */
    protected destructor(): void;
}
```

Consumed from `component/table/Body.ts`, both added by the body plan:

```typescript
export interface ColumnWindow { firstCol: number; lastCol: number; widths: number[]; lefts: number[]; }
export function computeColumnWindow(widths: number[], scrollX: number, viewportWidth: number): ColumnWindow;
```

Consumed from `component/table/cell/Cell.ts`, widened by the body plan:

```typescript
setBaseBackground(color: string | null): this;
```

No `TableHeader` option or `HeaderCell` option is added: the window, the scroll offset and the focused column are framework-managed bookkeeping, which ARCHITECTURE.md's third DOM-write rule keeps off the options bag.

---

## Internal Structure

### `TableHeader` private state

```typescript
private _visibleFields: Field[]              = [];   // non-hidden fields, display order
private _windowFirst  : number               = 0;    // visible-column index of slot 0
private _scrollX      : number               = 0;
private _focusedCol   : number | null        = null;
private _columnsDirty : boolean              = true;
private _geometry     : HeaderColumnGeometry = { columnWidths: [], viewportWidth: 0, columnHeight: 0, parentRowHeight: 0 };
```

The rendered columns are always a contiguous run, so slot `s` holds visible column `_windowFirst + s` and no per-slot column array is needed.

### `TableHeader.renderColumnWindow`

```
if (geometry) _geometry = geometry
g       = _geometry
widths  = _visibleFields.map((_, i) => g.columnWidths[i] ?? 0)
win     = computeColumnWindow(widths, _scrollX, g.viewportWidth)
changed = reconcileColumnCells(win.firstCol, win.lastCol)

if (changed):
    syncSortIndicators()
    applyFocusedColumn()

positionColumnCells(win, g.columnHeight)
positionParentCells(win, g.parentRowHeight)
```

### `TableHeader.reconcileColumnCells(firstCol, lastCol): boolean`

```
row = getComponents()[1]

if (!_columnsDirty && firstCol === _windowFirst
                   && lastCol  === _windowFirst + row.getComponents().length - 1) return false

columnMap ← Map(field name → Column) over _columns
byName    ← Map(field name → cell) over row.getComponents(), read from each cell's
            layout constraints' `data` Field — the same lookup rebuildCells uses today
assigned  ← array of length (lastCol - firstCol + 1), all undefined

// Pass 1 — keep a cell for its own field.
for col in firstCol..lastCol:
    name = _visibleFields[col].getName()
    cell = byName.get(name)
    if cell:
        assigned[col - firstCol] = cell
        byName.delete(name)

free ← remaining values of byName

// Pass 2 — recycle a leftover, else build.
for col in firstCol..lastCol where assigned[col - firstCol] is undefined:
    field = _visibleFields[col]
    cell  = free.pop()
    if cell:
        row.setLayoutConstraints(cell, { data: field })   // still a child; no DOM move
    else:
        cell = new HeaderCell(field.getName(), field.getName(), null)
        row.addComponent(cell, { data: field })
        wireCell(cell)                                    // wired once, ever
    assigned[col - firstCol] = cell

// Pass 3 — per-column state, on every rendered cell.
for col in firstCol..lastCol:
    cell   = assigned[col - firstCol]
    field  = _visibleFields[col]
    column = columnMap.get(field.getName())

    cell.setFieldName(field.getName())
    cell.setHeaderText(column?.getHeaderText() ?? field.getName())
    if (cell.getTooltip() !== field.getDescription()):
        cell.setTooltip(field.getDescription())
    if (cell.getHeaderGlyph() !== (column?.getHeaderGlyph() ?? null)):
        cell.setHeaderGlyph(column?.getHeaderGlyph() ?? null)
    cell.setBaseBackground(column?.getGroupColor() ?? null)
    cell.setRequired(column?.isRequired() ?? false)
    cell.getAria().setColIndex(col + 1)

// Discard what is left over.
for cell in free:
    row.removeComponent(cell)
    cell.dispose()

row.sortComponents(by constraint Field.getOrder())        // unchanged from rebuildCells
_windowFirst  = firstCol
_columnsDirty = false
return true
```

### `TableHeader.positionColumnCells` / `positionParentCells`

```
positionColumnCells(win, columnHeight):
    cells = getColumns()
    for slot in 0 .. cells.length - 1:
        col  = win.firstCol + slot
        cell = cells[slot]
        cell.setAutoCommitStyle(false)
        cell.setX(win.lefts[col] ?? 0)
        cell.setY(0)
        cell.setWidth(win.widths[col] ?? 0)
        cell.setHeight(columnHeight)
        cell.setAutoCommitStyle(true)
        cell.doLayout()

positionParentCells(win, parentRowHeight):
    row = getParentRow()
    for cell in row.getComponents():
        span = row.getLayoutConstraints(cell)?.data as { spanFrom, spanTo }
        from = span?.spanFrom ?? 0
        to   = span?.spanTo   ?? 0
        x    = win.lefts[from] ?? 0
        w    = (win.lefts[to] ?? 0) + (win.widths[to] ?? 0) - x
        cell.setAutoCommitStyle(false)
        cell.setX(x); cell.setY(0); cell.setWidth(w); cell.setHeight(parentRowHeight)
        cell.setAutoCommitStyle(true)
        cell.doLayout()
```

The `setAutoCommitStyle(false)` / `setAutoCommitStyle(true)` bracketing is carried over verbatim from the loops in `layout/Table.doLayout` that these two methods replace.

### `HeaderCell.destructor`

```typescript
protected destructor(): void {
    this._resizeHandle.dispose();
    this._priorityBadge.dispose();
    this._headerGlyphInstance?.dispose();

    super.destructor();
}
```

---

## Ordered Implementation Steps

1. **`cell/Header.ts` — re-targetable field name.** Add `setFieldName(name: string): this` (writes `_fieldName`) and `getFieldName(): string`. `_fieldName` stays a plain field: `HeaderCell` takes no options bag, so no setter runs during the `super()` cascade and the `declare` rule does not apply. Check: `npm run typecheck`.

2. **`cell/Header.ts` — destructor.** Add the `protected destructor()` above, ending with `super.destructor()`. Check: `grep -n 'appendChild' packages/lib/src/typescript/lib/component/table/cell/Header.ts` — three matches (`_resizeHandle`, `_priorityBadge`, the glyph), one per component the destructor now disposes.

3. **`Header.ts` — visible-field cache.** Add the private state listed under *Internal Structure*. Extract the field-list derivation that [`rebuildCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L414) and [`syncSortIndicators`](packages/lib/src/typescript/lib/component/table/Header.ts#L657) each spell out into one private `computeVisibleFields(model): Field[]`, and have `rebuildCells` store its result in `_visibleFields`. Leave [`setModel`](packages/lib/src/typescript/lib/component/table/Header.ts#L115)'s local `toNames` comparison alone — it compares the *old* model's field list against the new one's, which the cache cannot answer. Check: `grep -c 'getOrder() - b.getOrder()' packages/lib/src/typescript/lib/component/table/Header.ts` — down from 3 to 1, the remaining match being inside `setModel`.

4. **`Header.ts` — parent row builds nothing without groups.** In `rebuildParentCells`, after the existing `row.removeAllComponents()`, add `if (!this.hasParentRow()) { return; }`. Check: a table whose columns declare no `group` leaves `header.getParentRow().getComponents()` empty — which is what [Header.ts:249](packages/lib/src/typescript/lib/component/table/Header.ts#L249) and [Header.ts:70](packages/lib/src/typescript/lib/component/table/Header.ts#L70) already document.

5. **`Header.ts` — reconciler.** Add `private reconcileColumnCells(firstCol, lastCol): boolean` per the pseudo-code; the cell construction, the `wireCell` call and the `sortComponents` tail all move out of `rebuildCells` into it. Reduce `rebuildCells` to: recompute `_visibleFields`, set `_columnsDirty = true`, call `syncSortIndicators()`. It builds no cells and calls no reconcile. Rewrite its JSDoc ([Header.ts:400-410](packages/lib/src/typescript/lib/component/table/Header.ts#L400)) accordingly — it currently describes the cell reconciliation that has moved. Check: `grep -n 'new HeaderCell' packages/lib/src/typescript/lib/component/table/Header.ts` — exactly one match, inside `reconcileColumnCells`.

6. **`Header.ts` — window and geometry.** Add `export interface HeaderColumnGeometry`, `renderColumnWindow(geometry?)`, `private positionColumnCells(win, columnHeight)` and `private positionParentCells(win, parentRowHeight)` per *Internal Structure*, importing `computeColumnWindow` and `ColumnWindow` from `~/component/table/Body.js`. Add `getColumnWindowStart()`. Re-export the new interface from [`component/table/index.ts`](packages/lib/src/typescript/lib/component/table/index.ts#L15) with `export type { HeaderColumnGeometry } from '~/component/table/Header.js';`, beside the existing `TableHeaderEvent` line, so the public `renderColumnWindow` signature does not reference an undocumented type. Check: `npm run typecheck` — a circular-import error here means the body plan's `import type { TableHeader }` at [Body.ts:21](packages/lib/src/typescript/lib/component/table/Body.ts#L21) was widened to a value import; it must stay type-only.

7. **`Header.ts` — slot-to-column conversions.** Add `private columnIndexOf(cell: HeaderCell): number` returning `-1` when the cell is not rendered and `_windowFirst + slot` otherwise. Point both `wireCell` resize closures at it. Rewrite `syncSortIndicators`'s loop to read `this._visibleFields[this._windowFirst + slot]`. Check: `grep -n 'getColumns().indexOf' packages/lib/src/typescript/lib/component/table/Header.ts` — one match, inside `columnIndexOf`.

8. **`Header.ts` — scroll and focus.** Add `setScrollX(scrollLeft)` / `getScrollX()` and `setFocusedColumn(colIndex | null)` / `private applyFocusedColumn()`. `setScrollX` early-returns when the offset is unchanged, then writes both row translates and calls `renderColumnWindow()`.

9. **`component/table/Table.ts` — scroll listener.** Replace the two `setTranslate` calls in the `"horizontalscroll"` listener at [Table.ts:254](packages/lib/src/typescript/lib/component/table/Table.ts#L254) with `this._header.setScrollX(scrollLeft);`, and move the comment above it that explains why the inner rows translate (rather than the header element) onto `TableHeader.setScrollX`. Check: `grep -n 'setTranslate' packages/lib/src/typescript/lib/component/table/Table.ts` — zero matches.

10. **`Body.ts` — focus delegation.** Replace the header-cell block at [Body.ts:1299-1317](packages/lib/src/typescript/lib/component/table/Body.ts#L1299) with a single `this._header?.setFocusedColumn(this._anchorRecord ? this._focusedColIndex : null);`, placed before the `if (!this._anchorRecord) { return; }` guard so both the clear and the set paths keep firing. Remove the now-unused `HeaderCell` type import if nothing else in the file uses it. Check: `grep -n 'setColumnFocused' packages/lib/src/typescript/lib/component/table/Body.ts` — zero matches.

11. **`layout/Table.ts` — column count.** Change line 113 to `const columnCount = container.getColumns().length;`. Leave the `availableWidth` line as the chained-resize branch left it. Check: `grep -n 'getHeader().getColumns()' packages/lib/src/typescript/lib/layout/Table.ts` — zero matches.

12. **`layout/Table.ts` — hand the header its geometry.** Delete the `if (hasParentRow) { … }` parent-cell block ([lines 188-215](packages/lib/src/typescript/lib/layout/Table.ts#L188)) and the `headerColumns.forEach` block ([lines 228-241](packages/lib/src/typescript/lib/layout/Table.ts#L231)), including the header block's now-unused `headerColumns` and `x` locals — the footer block keeps its own `x`. In their place, after the column row's own sizing and before the scrollbar-cover block, call:

    ```typescript
    header.renderColumnWindow({
        columnWidths,
        viewportWidth: availableWidth,
        columnHeight,
        parentRowHeight,
    });
    ```

    Keep the `hasParentRow` / `parentRowHeight` derivation — the row height still depends on it. Check: `npm run typecheck`; `grep -c 'forEach' packages/lib/src/typescript/lib/layout/Table.ts` — down by two.

13. **Tests.** Add `packages/lib/tests/component/table/HeaderColumnWindow.test.ts` covering the offline cases in `## Expected Behaviour`. Extend `Table.test.ts` with the `columnCount` regression and `RotatedView.test.ts` with the rotated-window case. Check: `npm test`.

14. **Docs.** Update the `TableHeader`, `HeaderCell` and `ParentHeaderCell` entries in [`packages/lib/docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md). Check: `npm run docs:api` finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/index.ts` |
| Create | `packages/lib/tests/component/table/HeaderColumnWindow.test.ts` |
| Modify | `packages/lib/tests/component/table/Table.test.ts` |
| Modify | `packages/lib/tests/component/table/RotatedView.test.ts` |
| Modify | `packages/lib/docs/components/TableInternals.md` |

---

## Expected Behaviour

### Unit-testable offline

The offline harness lays a table out (`ColumnWidths.test.ts` already drives `table.doLayout()` against modelled sizes), and `setX` / `setWidth` write cached component state that `getX()` / `getWidth()` read straight back — so all of the following are real red-green cycles.

**Window coverage.**

1. A four-column table that has never been laid out renders zero header cells; after `setWidth(600)` / `setHeight(400)` / `doLayout()` it renders all four, and `getColumnWindowStart()` is `0`.
2. A table whose columns all fit the viewport renders one header cell per visible column — the no-regression case.
3. A twenty-column table, 100 px each, laid out at a 250 px available width and scrolled to `scrollX` 550 renders 8 header cells with `getColumnWindowStart() === 3`.
4. `header.getColumns().length` never exceeds the visible-column count at any scroll offset.

**Slot-to-column mapping.**

5. For every rendered slot `s`, the cell's `getFieldName()` is the name of visible column `getColumnWindowStart() + s`.
6. For every rendered slot `s`, `cell.getAria().getColIndex()` equals `getColumnWindowStart() + s + 1`.
7. `columnresize` emitted from the cell at slot 2 of a window starting at 3 carries column index `5` — drive it via the cell's protected `emit`, as the suite's other white-box cases do.

**Recycling.**

8. Scrolling one column to the right keeps the rendered cell count unchanged and advances `getColumnWindowStart()` by one.
9. The `HeaderCell` instance that rendered the departing column is, after that slide, the instance rendering the entering column.
10. The recycled cell's label, `getFieldName()`, and tooltip are the entering column's, not the departing column's.
11. A cell recycled into a column with no `groupColor` shows no group tint; a cell recycled into a column with one shows it.
12. A cell recycled into a column with no `headerGlyph` reports `getHeaderGlyph() === null`; into one with a glyph, that glyph's name.
13. A cell recycled into a column whose config sets `required: true` shows the ` *` suffix; into one without, it does not.

**Sort state.**

14. Sorting a column that is outside the window, then scrolling it in, shows the arrow on its cell.
15. A two-column multi-sort shows the priority badge on whichever of the two columns is inside the window, with the right priority number.
16. Clicking a rendered header cell after a slide sorts the column that cell renders, not the column at its slot index.

**Column-set changes.**

17. `setColumnVisible(name, false)` on a middle column leaves the surviving columns' `HeaderCell` instances unchanged and drops the hidden field from the rendered set.
18. `setColumnVisible(name, true)` restores the column and its header cell.
19. After any hide or show, `layout/Table`'s width array length still equals `table.getColumns().length` — the `columnCount` regression.

**Parent row.**

20. A table whose columns declare no `group` has zero cells on `getParentRow()`.
21. A table with column groups `A A A B B` has two parent cells, spanning columns 0–2 and 3–4.
22. A parent cell's `getX()` equals the sum of the widths left of its `spanFrom`, and its `getWidth()` equals the sum of the widths across its span — over widths `[100, 60, 60, 200, 90]`, a cell spanning 2–3 reports `getX() === 160` and `getWidth() === 260`.
23. A parent cell whose span starts left of the window is still present and still reports its full-span geometry.

**Rotated mode.**

24. A rotated table renders a header cell for every projected column at every scroll offset, and `getColumnWindowStart()` is `0`.

**Teardown.**

25. Disposing a `HeaderCell` leaves it with no rendered `ResizeHandle`, `SortPriorityBadge` or glyph element — assert through the recording sink's writes rather than `not.toThrow()`.

### Manual verification

These need a browser: real horizontal scrolling, drag, hover, focus and paint are outside the offline harness.

- Open the demo app (`npm run dev`, `http://localhost:8015`) and use **"Show window with wide table (45 columns)!"** in `MiscPanel`. Wheel-scroll horizontally at speed: header cells stay aligned with the body columns beneath them, no blank gaps appear at either edge, and no cell flickers at a boundary.
- Drag a column's right edge near the middle of the viewport: the chained resize behaves as it does on `master`, the handle stays glued to the cursor, and the dragged column keeps its own header cell for the whole drag.
- Drag a column's right edge while scrolled far right: the widths that change are the ones under the cursor, not the ones at the same slot positions.
- Click and shift-click header cells after scrolling right: the sort applies to the clicked column, and the arrow and priority badge land on that cell.
- Arrow-key across the right viewport edge in the body: the body scrolls and the header's focus underline follows onto the newly-focused column.
- Hover a header cell with a `description` on its field after a scroll: the tooltip shows that column's text.
- Right-click both a column header and a parent header after a scroll: the column-toggle menu opens, and toggling a column off updates both rows.
- Confirm the scrollbar-cover band at the header's right edge stays opaque and continuous with the header gradient at every scroll offset.
- With DevTools open, scroll left-and-right repeatedly and confirm the shared stylesheet's rule count stays flat.
- `TreeTable`: repeat the wheel-scroll and resize checks — it shares this header verbatim.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean; the `local/no-raw-dom` rule stays at its empty baseline.
- `npm test` — the new `HeaderColumnWindow.test.ts` passes, and every existing case under `packages/lib/tests/component/table/` stays green with no edit to its body except the two files listed in `## Files to Create / Modify / Delete`. `RotatedView.test.ts` reads header cells through `_header.getComponents()[1].getComponents()` after a `doLayout()`, so a failure there means `layout/Table.doLayout` is not reaching `renderColumnWindow` — the header is left with no cells at all.
- `grep -rn 'getHeader().getColumns()' packages/lib/src` — expect zero matches.
- `grep -n 'setColumnFocused' packages/lib/src/typescript/lib/component/table/Body.ts` — expect zero matches; `TableHeader.applyFocusedColumn` is the only caller now.
- `grep -rn 'setTranslate' packages/lib/src/typescript/lib/component/table/` — expect two matches, both inside `TableHeader.setScrollX`.
- `grep -n 'new HeaderCell' packages/lib/src/typescript/lib/component/table/Header.ts` — expect one match.
- `npm run docs:api` — zero warnings.
- Manual smoke tests as listed under `## Expected Behaviour`.

---

## Documentation Impact

`TableHeader` and `HeaderCell` are both exported from `@jimka/typescript-ui/component/table` ([index.ts:14](packages/lib/src/typescript/lib/component/table/index.ts#L14), [index.ts:26](packages/lib/src/typescript/lib/component/table/index.ts#L26)), so the new methods are consumer-visible.

- [`packages/lib/docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md): the `TableHeader` paragraph currently says the header "builds one `HeaderCell` per visible field from the model". Correct it to say it builds one cell per column in its current column window, and add that the parent row builds no cells when no visible column declares a group. The `ParentHeaderCell` paragraph's `spanFrom` / `spanTo` sentence is still accurate but now names `TableHeader` rather than the layout manager as the reader of those indices.
- New `TableHeader` JSDoc: `renderColumnWindow`, `setScrollX`, `getScrollX`, `getColumnWindowStart`, `setFocusedColumn`, and the `HeaderColumnGeometry` interface, which is re-exported from [`component/table/index.ts`](packages/lib/src/typescript/lib/component/table/index.ts#L15) beside `TableHeaderEvent`. `getColumns()`' JSDoc changes meaning and must say so.
- New `HeaderCell` JSDoc: `setFieldName`, `getFieldName`.
- Per CODE_CONVENTIONS.md, none of this JSDoc may `{@link}` `computeColumnWindow` or `ColumnWindow` — both are `@internal` and excluded from the generated docs. Describe them in prose.
- No entry in [`packages/lib/llms.txt`](packages/lib/llms.txt) changes: no component is added or removed.

---

## Potential Challenges

- **A cell recycled mid-resize-drag would misreport its column.** The drag's `mousemove` listeners live on the dragged cell, and its emits resolve the column index live. Field-name-first matching keeps a column that stays inside the window on its own cell, and a resize drag cannot push the dragged column out of the window (the pointer is over it and `scrollX` does not move), so the cell survives the drag. Verify with the two resize checks under manual verification.
- **The chained-resize branch is unmerged.** Its `layout/Table.ts` hunk overlaps line 113. Merge that branch before starting; if the merge has not happened, stop rather than reimplementing its `getAvailableColumnWidth()` seam.
- **`ParentHeaderCell` instances are still discarded without disposal.** `rebuildParentCells` calls `row.removeAllComponents()`, which detaches without running any destructor, so each rebuild leaves the previous cells' per-instance stylesheet rules on the shared sheet. This plan does not change how often that runs — and the no-group early return makes it run over fewer cells — so the pre-existing leak is left alone. Do not fix it here.
- **`Body._updateFocusStyle` still clears the per-cell outline on every pooled body cell.** That loop is the body's own and is untouched; only the header block moves. Leaving the body loop in place is what keeps the change surgical.
- **Slot order and DOM order diverge.** `sortComponents` reorders the children array, not the DOM — as `rebuildCells` already does today. Header cells are absolutely positioned, so paint is unaffected, but do not assume DOM child order matches column order.
- **A recycled cell's `_isDragging` flag survives re-targeting.** It is cleared by a `setTimeout` after the drag's synthetic click, so a cell recycled inside that window would swallow one sort click. Both the drag and the recycle require the cell to be under the pointer, which the previous bullet rules out; no extra reset is added.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) — `rebuildCells` (411), `rebuildParentCells` (519), `wireCell` (595), `syncSortIndicators` (655), `getColumns` (243), `hasParentRow` (268), `getScrollbarCover` (282).
- [`packages/lib/src/typescript/lib/component/table/cell/Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts) — the constructor (104), the raw `appendChild` sites (173-174, 255), `setHeaderGlyph` (207), `setTooltip` (431), `setColumnFocused` (513).
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `renderWindow` (693) and `bindAndPositionRows`: the reconcile-then-position precedent this plan mirrors; `onScrollerTick` (633) and `_updateFocusStyle` (1284): the ordering the header's own focus re-apply exists for; `import type { TableHeader }` (21): the import that must stay type-only.
- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) — `doLayout` (88): the header band sizing that stays, and the two per-column loops (191, 231) that move.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) — the header event wiring (211-213), the `"horizontalscroll"` listener (254), `onColumnResize` (1284): the consumer of the column index `wireCell` emits.
- [`plans/table-column-virtualization.md`](plans/table-column-virtualization.md) — the source of `computeColumnWindow`, `ColumnWindow`, `COLUMN_BUFFER`, and the widened `Cell.setBaseBackground`.
- [`plans/table-chained-column-resize.md`](plans/table-chained-column-resize.md) — the in-flight work this plan merges on top of.
- [`packages/lib/tests/component/table/RotatedView.test.ts`](packages/lib/tests/component/table/RotatedView.test.ts) — the only existing test that reads header cells; the offline pattern the new suite extends.
- [`packages/lib/tests/component/table/ColumnWidths.test.ts`](packages/lib/tests/component/table/ColumnWidths.test.ts) — the pattern for laying a table out offline and asserting derived geometry.

---

## Non-Goals

- **The footer is not windowed.** `FooterRow`'s inner row is never given cells by anything in the library, so the `footerColumns.forEach` loop at [layout/Table.ts:280](packages/lib/src/typescript/lib/layout/Table.ts#L280) is already a no-op. Leave it.
- **The parent row is not windowed.** It builds one cell per group run, and this plan reduces it to zero cells in the common ungrouped case. Windowing it as well is rejected.
- **`ParentHeaderCell` disposal is not fixed.** The leak is pre-existing and untouched by this change.
- **Column pinning is not introduced.** Nothing here pins a column into the header window; that is [`plans/table-column-pinning.md`](plans/table-column-pinning.md)'s subject.
- **No option, threshold, or opt-out.** Header column virtualization is always on, so there is one code path to reason about and to test.
- **The body's column window is not re-derived here.** The header computes its own window from its own cached geometry; the two agree because the layout manager hands both the same widths and the same available width.

---

## Notes

[^why-now]: The header used to be a rounding error next to the body and stops being one the moment the body plan lands. Counting constructed cells for an ungrouped 100-column table with a 20-slot row pool: today the body builds 20 × 100 = 2000 cells and the header builds 100 `HeaderCell` plus 100 `ParentHeaderCell`, so the header is 200 of 2200 — 9%. After the body plan the body builds roughly 20 × 14 = 280 (its window is the visible columns plus `COLUMN_BUFFER = 2` on each side), the header still builds 200, and the header is 200 of 480 — 42%. After this plan the header builds about 14 and the total is under 300. The 100 parent cells are the half of that figure most easily missed: `rebuildParentCells` emits a blank spanning cell for every ungrouped column, so a table with no groups at all still pays for a full second row of cells, none of which the layout manager ever positions (it skips the parent-cell pass when `hasParentRow()` is false). Two comments in `Header.ts` — the constructor's at line 70 and `getParentRow`'s at line 249 — already assert that no cells are produced in that case, so the early return in step 4 makes the code match its own documentation. The measurement that motivates all of this is the standing finding that a wide table's multi-second open is per-cell and linear in the column count.

[^geometry-ownership]: Three placements were considered. Leaving geometry in `layout/Table.doLayout` and having `TableHeader` only reconcile fails on the scroll path: a horizontal scroll runs no layout pass, so the cells the slide just built or re-targeted would keep the previous column's x and width until the next unrelated layout. Making the scroll path call `container.doLayout()` instead would re-derive every column width and re-position the body and footer on every scroll frame, which is strictly more work than the loops this plan is trying to remove. Moving reconciliation into the layout manager instead would put cell construction inside a `LayoutManager`, which no manager in the framework does. Giving both jobs to `TableHeader` matches what `Body` already does — `bindAndPositionRows` reconciles a row's cells and positions them in the same pass — and lets one method serve the layout path and the scroll path.

[^no-eager-build]: Keeping the eager build in `rebuildCells` would defeat the plan. `TableHeader`'s constructor calls `rebuildCells` before any width exists, and `Table`'s constructor then calls `setColumns` and `setHiddenColumns`, each of which calls it again — so a 100-column table would construct 100 `HeaderCell` instances at open and the first layout would immediately dispose ~86 of them. That is worse than today on both counts. The alternative of capping the pre-layout window at some default column count was rejected as an unmotivated magic number. Building nothing is also the behaviour the sibling already has: a `Body` renders no rows at all until `renderWindow` runs, and the framework has no problem with that because every code path that changes a table's column set ends in `doLayout()`.

[^recycle-not-rebuild]: Discarding a departing cell and constructing a fresh one for the entering column was considered and rejected. Constructing a `HeaderCell` is the expensive operation this plan exists to avoid — a renderer, a `ResizeHandle`, a `SortPriorityBadge`, an `:active` style rule and the component's own per-instance rule — and building one per column boundary crossed would pay that cost repeatedly on a scroll rather than once at open. It would also churn the shared stylesheet: `HeaderCell` attaches its resize handle, priority badge and glyph with raw `DOM.sink.appendChild` while holding them in private fields, so `Component.destructor`'s recursion over `_components` never reaches them and their per-instance rules survive disposal. That is the exact bug class behind this repo's long-running stylesheet-rule leak, and it is why step 2 adds a real `HeaderCell.destructor` regardless — the reconciler does dispose cells when a column is hidden or the viewport narrows, just not on every scroll. Recycling is also simpler here than in the body: the body's reconciler needs a cell key because a column may need a `ComboCell`, a `DynamicCell` or a typed value cell, whereas every header cell is a `HeaderCell` and any leftover fits any entering column. The re-targeting cost is one setter per property, and the two expensive ones are guarded.

[^guarded-writes]: `setHeaderGlyph` unconditionally removes the mounted `Glyph`'s element, constructs a new `Glyph`, and recomputes the renderer's left inset; `setTooltip` tears down and reinstalls three hover listeners through `Tooltip.attachToElement`. Running either on every rendered cell on every reconcile would undo much of what recycling saves. The guard sits at the `TableHeader` call site rather than inside the setters because `HeaderCell.init` deliberately calls `setHeaderGlyph(this._headerGlyph)` with the value already in the field, to mount the glyph once the element exists — an equality early-return inside the setter would turn that into a no-op and the glyph would never appear.

[^focus-ordering]: `Body.onScrollerTick` calls `renderWindow()` — which ends by calling `_updateFocusStyle()` — and only then emits `"horizontalscroll"`. The header's window therefore slides *after* the body has finished painting focus. If the underline were still written by a loop in `Body`, a recycled cell entering the focused column would arrive unpainted and the cell that left it would keep the underline. Having `TableHeader` cache the focused column and re-apply it at the end of every reconcile removes the ordering dependency in both directions. The same argument applies to the sort arrow, which is why `syncSortIndicators` is also re-run on a changed window.

[^parent-not-windowed]: Windowing the parent row was considered. The rule would have been an intersection test — build a parent cell when `spanTo >= firstCol && spanFrom <= lastCol`, and keep its full-span geometry so the header's `overflow: hidden` clips it rather than the cell being truncated:

    | Window | Span | Built? |
    |---|---|---|
    | 10–24 | 0–4 | no |
    | 10–24 | 3–12 | yes — clipped at the left edge |
    | 10–24 | 14–18 | yes |
    | 10–24 | 20–40 | yes — clipped at the right edge |
    | 10–24 | 41–60 | no |

    It was rejected on cost. `ParentHeaderCell` is far lighter than `HeaderCell` — no resize handle, no priority badge, no glyph, no sort state — and after the no-group early return the common wide table has *zero* parent cells rather than one per column. What remains is one cell per group run, which on any table where "group" means anything is a small fraction of the column count. Windowing it would need its own reconciler keyed on group-run identity (rebuilding on each slide would churn cells that this plan's `removeAllComponents` path does not even dispose), for a saving that only materialises on a table with as many groups as columns. The worst remaining case is a partly-grouped wide table, where each ungrouped column still costs one blank cell; merging adjacent blank spans would fix that but would also drop the per-column dividers the blank cells exist to paint, which is a visual change and out of scope.

[^import-direction]: `Header.ts` gains a value import from `Body.ts`. That direction is safe because `Body.ts`'s only reference to `Header.ts` is `import type { TableHeader }` at line 21, which TypeScript erases — so at runtime there is no edge from `Body.ts` back to `Header.ts` and no cycle. The body plan's own footnote explains why `computeColumnWindow` lives in `Body.ts` rather than on `VirtualRowView`; that decision stands and is not revisited here. If a future change needs `Body.ts` to import `TableHeader` as a value, both helpers move to a shared module and both importers follow — but nothing in this plan requires that.

[^column-count]: `layout/Table.doLayout` derives `columnCount` from `container.getHeader().getColumns().length` and compares it against `container.getColumnWidths().length` to decide between deriving fresh widths and rescaling the existing ones. Once the header renders a window, that count is the window size, so every slide would look like a column-count change and re-run `initializeWidths` — which measures header text and samples store content for every column. Swapping in `container.getColumns().length` is exact rather than approximate: `Table.getEffectiveHiddenSet` adds every model field missing from `_resolvedColumns` to the hidden set it passes to the header, so the header's visible-field list and `Table.getColumns()` already enumerate the same columns, in both normal and rotated mode.

[^conflict]: `git diff --stat master...feature/table-chained-column-resize` shows that branch editing `component/table/Table.ts` (~177 lines), `layout/Table.ts` (13 lines), `layout/Accordion.ts`, and adding `core/DragChain.ts` and `tests/component/table/ColumnResize.test.ts`. Its `layout/Table.ts` hunk replaces the `availableWidth` line and the `rescaleWidths` call and carries the `columnCount` line as unchanged context, which is the line this plan rewrites — so applying the two in either order requires a manual merge of that one hunk, and applying this plan first would leave the branch's diff no longer applying. Its `component/table/Table.ts` edits are in the field declarations, `bindView`, `setColumnVisible` and the two resize handlers; none of them touch the `"horizontalscroll"` listener this plan rewrites, so that file should merge cleanly. The interaction is otherwise favourable: chained resize lets the total column width exceed the container, which produces more horizontal scroll extent and makes the header window matter more. One contract must be preserved across the merge — that branch's `onColumnResize` indexes `this._columnWidths` and `this.getColumns()` with the index the header emits, so the header must keep emitting a true visible-column index, which is what `columnIndexOf` guarantees.
