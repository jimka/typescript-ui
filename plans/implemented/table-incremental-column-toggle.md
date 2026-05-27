---
touches-shared: [src/typescript/lib/component/table/Body.ts, src/typescript/lib/component/table/Row.ts, src/typescript/lib/component/table/Header.ts]
---

# Table Incremental Column Toggle — Implementation Plan

## Overview

Toggling a column's visibility on a [`Table`](../src/typescript/lib/component/table/Table.ts) — and consequently a [`TreeTable`](../src/typescript/lib/component/table/TreeTable.ts) — currently destroys and rebuilds the entire row pool. `Body.setHiddenColumns` ([Body.ts:306-312](../src/typescript/lib/component/table/Body.ts#L306-L312)) calls `clearRowPool` ([Body.ts:325-347](../src/typescript/lib/component/table/Body.ts#L325-L347)) which detaches every pool row and zeroes the parallel `_boundIndices` / `_rowGeom` / `_cellGeom` / `_rowDisplayed` arrays. The next `renderWindow` re-grows the pool through `growRowPool` ([Body.ts:578-617](../src/typescript/lib/component/table/Body.ts#L578-L617)) — one `new Row(...)` per slot — and each `Row` constructor's switch ([Row.ts:64-89](../src/typescript/lib/component/table/Row.ts#L64-L89)) re-creates one typed cell per visible field. For `TreeBody` the tree cell additionally re-runs `Cell.wrapRenderer` ([Cell.ts:287-299](../src/typescript/lib/component/table/cell/Cell.ts#L287-L299)) and `TreeBody.afterRowBound` ([TreeBody.ts:405-420](../src/typescript/lib/component/table/TreeBody.ts#L405-L420)) drives a fresh `Glyph` toggle per row through `TreeCellRenderer.refreshToggle` ([renderer/TreeCell.ts:195-213](../src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L195-L213)).

[`Header`](../src/typescript/lib/component/table/Header.ts) has the same shape: `setHiddenColumns` ([Header.ts:107-114](../src/typescript/lib/component/table/Header.ts#L107-L114)) calls `rebuildCells` ([Header.ts:274-309](../src/typescript/lib/component/table/Header.ts#L274-L309)) which `removeAllComponents` and rebuilds every `HeaderCell` from scratch, losing the per-cell sort indicator, resize handle, tooltip, and theme listener.

This plan replaces both with an in-place sync. `Body.setHiddenColumns` keeps the pool and asks each pool row to diff its cells against the new visible-field list. `Header.rebuildCells` becomes an in-place reconciler on the column row at child index 1. The parent-header row at child index 0 — `Header.rebuildParentCells` ([Header.ts:324-385](../src/typescript/lib/component/table/Header.ts#L324-L385)) — stays destroy-and-rebuild because its cell count is a function of contiguous-group runs and changes shape unpredictably on a toggle.

`Table.setColumnVisible` ([Table.ts:265-291](../src/typescript/lib/component/table/Table.ts#L265-L291)) is **not** modified — it keeps calling `_header.setHiddenColumns` and `_body.setHiddenColumns` followed by `doLayout()`. The downstream second `renderWindow` from `layout/Table.doLayout` ([layout/Table.ts:255](../src/typescript/lib/layout/Table.ts#L255)) becomes effectively a no-op pass: same pool, same bound indices, same `_rowGeom` cells whose `(x, w, h)` change drives the existing `cellChanged` branch in `bindAndPositionRows` ([Body.ts:635-700](../src/typescript/lib/component/table/Body.ts#L635-L700)).

---

## Architecture Decisions

### Method name on `Row` — `syncCells(model, hiddenColumns, columnConfigs, treeFieldName?)`

The new entry point on `Row` carries the same four parameters the constructor's cell-building branch consumes (`model`, `hiddenColumns`, `columnConfigs`, and the optional tree-column hint). Naming it `syncCells` keeps the semantic narrow: it touches only `Row`'s `Cell` children, never the row's `data` binding or visual state. The existing `setData` (Row.ts:157-170) keeps its current contract — rebind values, do not touch the cell set. The two are complementary: column-toggle calls `syncCells` then leaves the renderWindow to call `setData` on the next bind.

Rejected names: `rebuildCells` (false advertising — the method preserves cells whenever possible) and `setVisibleFields` (would hide the side effect that newly-created cells need their commit callback wired and editor pool attached).

### Identity key for the diff — the field name

Every cell is added to the row with `{ data: field }` ([Row.ts:124-126](../src/typescript/lib/component/table/Row.ts#L124-L126)) so the layout-constraint backing carries the `Field` instance. The new sync reads that constraint via `Row.getLayoutConstraints(cell)` to map each existing cell back to its field name, then computes the diff against the new visible-field name list. Field-name keying matches how `Header.sortColumns` ([Header.ts:190-207](../src/typescript/lib/component/table/Header.ts#L190-L207)) already pulls `Field` instances back off layout constraints, so the contract is consistent across the two siblings.

### Edit state during a hide — commit before discarding

A cell in edit mode (`cell.isEditing()` — [Cell.ts:141-143](../src/typescript/lib/component/table/cell/Cell.ts#L141-L143)) whose column is being hidden gets `commitEdit()` called before its component is removed from the row. Rationale: cancelling silently discards user keystrokes (surprising); refusing the hide makes the column menu unresponsive when an editor is open (also surprising); committing matches the existing blur-commits-edit contract ([Cell.ts:58](../src/typescript/lib/component/table/cell/Cell.ts#L58)) — closing the column is conceptually a sibling of losing focus. The commit fires `_onCommit`, which routes back through the `Row` constructor's commit wiring ([Row.ts:96-102](../src/typescript/lib/component/table/Row.ts#L96-L102)) — already idempotent, already records the new value on the model record. Then `cancelEdit` is unnecessary because a committed cell is no longer editing; `removeComponent` proceeds normally.

The shared editor pool (`CellEditorPool`) is correctly returned to the pool by `Cell.detachEditor` ([Cell.ts:234-249](../src/typescript/lib/component/table/cell/Cell.ts#L234-L249)) inside `commitEdit`, so no editor leaks.

### Re-apply `groupColor` and the commit callback on every sync — even on cells that survive

The simplest correct policy is: at the end of `syncCells`, walk the final ordered cell list and re-apply (a) the `_onCommit` callback closed over the new field reference and (b) the `groupColor` background from the `ColumnConfig`. Re-applying on survivors costs one setter call per cell — a property assignment plus, for `setBackgroundColor`, a single DOM style write the framework already de-dupes. Re-applying unconditionally avoids a fork in the code between "new cell" and "surviving cell" branches, and matches the existing constructor's behaviour (every cell gets a commit wire and a tinted background up front).

Rejected: skipping the re-apply on survivors and only writing on new cells. Would require remembering on the cell whether `groupColor` was previously set, and would break if a `setColumnConfigs` call had changed the group's tint without a hide/show round-trip in between.

### Tree-column cell — `wrapRenderer` only on **newly created** tree-column cells

A surviving tree-column cell already has its `TreeCellRenderer` from the previous lifetime — re-wrapping it would chain `TreeCellRenderer` around `TreeCellRenderer`, double-indenting every row and registering an extra theme listener per toggle. So `syncCells` checks `treeFieldName !== undefined && field.getName() === treeFieldName && cellIsNew` before calling `wrapRenderer`. The `_treeCell` field is set on both branches (new and survivor) by looking up the cell at the tree column after the diff settles.

This is the load-bearing distinction from the constructor, which always wraps because the cell is always brand-new. The TreeBody.createRow path ([TreeBody.ts:362-371](../src/typescript/lib/component/table/TreeBody.ts#L362-L371)) is unchanged — it still passes `treeFieldName` to the `Row` constructor — but the new `syncCells` call from `Body.setHiddenColumns` needs the same hint, so the body has to thread it through. See "Threading `treeFieldName` through `Body`" below.

In plain `Table`, no column is the tree column. The constructor blocks hiding only the tree column on `TreeTable` ([TreeTable.ts:223-231](../src/typescript/lib/component/table/TreeTable.ts#L223-L231)), so on a plain `Table` any column can be toggled freely. The sync handles both with the same single code path: `treeFieldName === undefined` skips the wrap step entirely, matching the constructor.

### Threading `treeFieldName` through `Body`

`Body` already has the right shape to do this: `createRow` is a protected subclassing seam, and `TreeBody.createRow` already passes `this._treeColumn` to the `Row` constructor. The cleanest extension is a second protected hook — `getTreeFieldName(): string | undefined` — that the base returns `undefined` from and `TreeBody` overrides to return `this._treeColumn`. `Body.setHiddenColumns` reads it once and forwards it into each row's `syncCells` call. No public API surface change.

Rejected alternative: have `Body.setHiddenColumns` call `createRow().getTreeCell()?.getRendererTreeFieldName?.()` to recover the hint from one of the existing pool rows. Allocates a throwaway `Row`, leaks abstraction, and breaks when the pool is empty (first hide before any render — currently called from `Table`'s constructor at [Table.ts:142](../src/typescript/lib/component/table/Table.ts#L142) before any layout has run).

### Geometry cache: invalidate per-row, not per-cell

`Body._cellGeom[i]` is a parallel array indexed by pool slot then by cell position ([Body.ts:57](../src/typescript/lib/component/table/Body.ts#L57)). When the visible-cell count changes, every slot's cell-geom entry is wrong (stale indices, possibly stale `(x, w, h)`). `syncCells` cannot fix this — it lives on `Row`, not `Body`. `Body.setHiddenColumns` therefore zeroes `_cellGeom[i]` to an empty array for every slot after the sync, and likewise zeroes `_rowGeom[i]` (the row's stored width changes when the visible-column total changes). The existing `bindAndPositionRows` then re-applies geometry on the next pass via its `!prevCell` branch.

`_boundIndices` is **not** invalidated. The pool's record bindings survive — same record, just a different cell list — and skipping rebind keeps the perf win in `setData` (no text re-measurement on cells that already hold the right value). `updateRowVisualState`, `computeRowAria`, and `afterRowBound` similarly stay untouched on this pass; the next layout-driven `renderWindow` runs `bindAndPositionRows` which is already idempotent under unchanged `boundIndices` for everything except the geometry the cleared `_rowGeom` / `_cellGeom` arrays drive.

### `Header.rebuildCells` becomes incremental — but only the column row at index 1

The same diff strategy applies. The cells already carry `{ data: field }` ([Header.ts:304](../src/typescript/lib/component/table/Header.ts#L304)), so the field-name keying is symmetric with the body. Cells that survive keep their sort indicator, resize-handle wiring, tooltip, theme listener (the one registered in [Cell.ts:51](../src/typescript/lib/component/table/cell/Cell.ts#L51)), and their `setColumnFocused` state. Newly-shown cells go through the existing `wireCell` ([Header.ts:393-397](../src/typescript/lib/component/table/Header.ts#L393-L397)) and `setBackgroundColor` paths verbatim.

`wireCell` registers callbacks via setters (`setOnSortClick`, `setOnResizeDrag`, `setOnContextMenu`) that overwrite, not chain — so reapplying it on every sync (the same simplifying policy as `groupColor` on the body) is safe, but the load-bearing call is the `_onResizeCallback` index it captures. The new wireCell call for each cell must pass the cell's **new** position in the visible-column list. Existing cells whose visible-index changed (e.g. hiding a middle column shifts everyone right of it left by one) get re-wired with the new index. This is one assignment per cell — cheap.

After the in-place cell sync, `syncSortIndicators` ([Header.ts:452-473](../src/typescript/lib/component/table/Header.ts#L452-L473)) runs as today. It already walks the surviving cells by index against the visible-fields list and writes sort state without any structural assumption.

### Parent-header row stays destroy-and-rebuild

`Header.rebuildParentCells` produces N cells where N is the number of contiguous-group runs in the visible columns. Hiding the middle column of a three-column run splits it into two runs (`+1` cells); hiding the rightmost column of a two-column run collapses it to one (`-1` cells); hiding an ungrouped column adjacent to a grouped run never changes the run topology of the group itself. The cells are typed (`ParentHeaderCell`), carry `data: { spanFrom, spanTo }` layout constraints whose values shift on every visible-cell change, and have a tooltip composed from the field-name list. The incremental work to diff this against the previous state is comparable to a full rebuild, and parent rows hold a maximum of `visibleCols.length` cells (small N). Keep `rebuildParentCells` as-is; only `rebuildCells` is changed.

### Listener-leak invariant for `Cell` and `CellRenderer`

`Cell`'s constructor registers a `ThemeManager.onThemeChange` listener ([Cell.ts:51](../src/typescript/lib/component/table/cell/Cell.ts#L51)). `CellRenderer`'s constructor registers another ([CellRenderer.ts:33](../src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L33)). `CellEditor`'s constructor registers a third (renderer's mirror). Today, every pool row's cells re-register all three listeners on every column toggle, because the old cells are dropped on the floor (no `ThemeManager.offThemeChange` exists — see [`ThemeManager` source](../src/typescript/lib/core/Theme.ts) and grep `offThemeChange` returns no results). The new in-place sync makes surviving cells retain their **existing** listener registrations; only newly-shown cells register one. Hide → show on the same column re-creates the cell and registers a new listener, but the old listener is left on the manager — same one-listener-per-hide-show-cycle leak that already exists for cells dropped on a model swap; this plan does not widen the leak, and the verification step exercises the "100 hide/show cycles, listener count grows by O(cells-newly-created) only" invariant.

A defensive `ThemeManager.offThemeChange` API is out of scope here (see `## Non-Goals`).

---

## Public API (TypeScript Signatures)

### `Row` (additions)

```typescript
class Row extends Component {
    // existing fields and methods unchanged

    /**
     * Rebuilds this row's cell set in place to match `model`'s currently-
     * visible fields. Cells whose field is still visible are preserved
     * (along with their renderer, editor, theme listener, sort state,
     * group tint, etc.); cells whose field is now hidden are committed
     * (if editing) and removed; cells for newly-visible fields are
     * constructed via the same typed switch as the constructor.
     *
     * The child order is re-sorted to match the visible-field display
     * order. The tree column's cell, if any, is wrapped in a
     * TreeCellRenderer only on first creation — surviving tree cells
     * keep the renderer they already have.
     *
     * @param model - The model whose visible fields drive the cell list.
     * @param hiddenColumns - The set of field names to exclude.
     * @param columnConfigs - Per-field configs (carries `showSeconds`,
     *   `groupColor`, etc.).
     * @param treeFieldName - Optional. Field name of the column that
     *   carries the tree-cell renderer; matches the constructor's
     *   parameter of the same name.
     *
     * @returns This row, for method chaining.
     */
    syncCells(
        model: AbstractModel,
        hiddenColumns: Set<string>,
        columnConfigs: Map<string, ColumnConfig>,
        treeFieldName?: string,
    ): this;
}
```

### `Body` (additions / signature change is internal)

```typescript
class Body extends Component {
    // existing fields and methods unchanged

    /**
     * Returns the field name of the column carrying a TreeCellRenderer,
     * or undefined when no column is the tree column. Subclassing seam —
     * TreeBody overrides this to return its `_treeColumn`; the base
     * returns undefined. Forwarded into Row.syncCells from
     * setHiddenColumns. Not for consumer use.
     */
    protected getTreeFieldName(): string | undefined;
}
```

`TreeBody.getTreeFieldName(): string` overrides to return `this._treeColumn`. No other public surface moves.

### `Header` (no signature change)

`rebuildCells` stays private; the method body is rewritten in place. The two call sites (`setHiddenColumns` and `setModel`) keep their identical call signature.

---

## Implementation

### `Row.syncCells` body shape

```typescript
syncCells(
    model: AbstractModel,
    hiddenColumns: Set<string>,
    columnConfigs: Map<string, ColumnConfig>,
    treeFieldName?: string,
): this {
    if (!this._model || this._model !== model) {
        this._model = model;
    }

    const targetFields = model.getFields()
                              .filter(f => !hiddenColumns.has(f.getName()))
                              .sort((f1, f2) => f1.getOrder() - f2.getOrder());

    const targetNames = targetFields.map(f => f.getName());
    const existing    = this.getComponents() as Cell<any>[];

    // Map current cells by their field name (read from layout constraints).
    const byName = new Map<string, Cell<any>>();

    for (const cell of existing) {
        const lc    = this.getLayoutConstraints(cell);
        const field = lc?.data as Field | undefined;

        if (field) {
            byName.set(field.getName(), cell);
        }
    }

    // Remove cells whose field is no longer visible. Commit before discard
    // so an in-flight edit doesn't lose its keystrokes.
    for (const cell of existing.slice()) {
        const lc    = this.getLayoutConstraints(cell);
        const field = lc?.data as Field | undefined;

        if (!field || hiddenColumns.has(field.getName())) {
            if (cell.isEditing()) {
                cell.commitEdit();
            }

            this.removeComponent(cell);
        }
    }

    // Walk target fields in display order. Build any missing cell; insert
    // / re-order each to match the new index. Re-apply the commit wire
    // and the group tint on every cell (new and surviving).
    this._treeCell = null;

    for (let i = 0; i < targetFields.length; i++) {
        const field = targetFields[i];
        let   cell  = byName.get(field.getName());
        const isNew = !cell;

        if (!cell) {
            cell = Row.createCellForField(field, columnConfigs);
            cell.setValue(this._data ? this._data.get(field.getName()) : undefined);
        }

        // Re-wire commit so the closure captures the current field
        // reference and the current `_onCellCommit`. Identical to the
        // constructor body.
        cell.setOnCommit((newValue) => {
            if (this._data) {
                this._data.set(field.getName(), newValue);
                this._onCellCommit?.(this._data);
            }
            this.updateVisualState();
        });

        const groupColor = columnConfigs.get(field.getName())?.groupColor;

        if (groupColor) {
            cell.setBackgroundColor(groupColor);
        }

        if (isNew && treeFieldName !== undefined && field.getName() === treeFieldName) {
            cell.wrapRenderer((delegate: CellRenderer<any>) => new TreeCellRenderer(delegate));
        }

        if (treeFieldName !== undefined && field.getName() === treeFieldName) {
            this._treeCell = cell;
        }

        if (isNew) {
            this.addComponent(cell, { data: field });
        }
    }

    // Re-order child array to match the new field-display order. Mirrors
    // Header.sortColumns' constraint-based ordering — the same Field
    // payload that's already on the layout constraints.
    this.sortComponents((c1, c2) => {
        const f1 = (this.getLayoutConstraints(c1)?.data as Field).getOrder();
        const f2 = (this.getLayoutConstraints(c2)?.data as Field).getOrder();

        return f1 - f2;
    });

    this._fieldNames = targetNames;

    return this;
}
```

A static helper `Row.createCellForField(field, columnConfigs)` extracts the existing constructor switch ([Row.ts:64-93](../src/typescript/lib/component/table/Row.ts#L64-L93)) into a single utility the constructor and `syncCells` share. The switch already factors cleanly — no behaviour change, just a relocation.

DOM-order note: `sortComponents` reorders the `_components` array but does not reorder the DOM children. The body's `bindAndPositionRows` positions cells by computed `x` based on `_lastColumnWidths`, so visual order is correct regardless of DOM order. The pre-existing constructor path also relies on this: a `Row` constructor that creates cells in field-order does ordered DOM appends, but `bindAndPositionRows` doesn't depend on it. Verified by reading the existing `bindAndPositionRows` body ([Body.ts:635-700](../src/typescript/lib/component/table/Body.ts#L635-L700)).

### `Body.setHiddenColumns` body shape

```typescript
setHiddenColumns(hidden: Set<string>): this {
    this._hiddenColumns = new Set(hidden);

    const treeFieldName = this.getTreeFieldName();

    for (let i = 0; i < this._rowPool.length; i++) {
        this._rowPool[i].syncCells(
            this._store.model,
            this._hiddenColumns,
            this._columnConfigs,
            treeFieldName,
        );

        // Newly-shown cells need their editor pool wired (parallels the
        // setEditorPool loop in growRowPool).
        for (const cell of this._rowPool[i].getComponents() as Cell<any>[]) {
            cell.setEditorPool(this._editorPool);
        }

        // Geometry-cache invalidation per slot — the column count and
        // per-cell (x, w, h) tuple have all changed.
        this._rowGeom[i]  = null;
        this._cellGeom[i] = [];
    }

    this.renderWindow();

    return this;
}
```

`setEditorPool` is idempotent ([Cell.ts:86-90](../src/typescript/lib/component/table/cell/Cell.ts#L86-L90)) so the inner loop is safe to run on every cell including survivors. The `renderWindow()` at the end keeps the existing fan-out: in the same call chain that `Table.setColumnVisible` makes today, this is followed immediately by `doLayout()` which itself triggers a second `renderWindow` from the layout manager — both passes are cheap because the bound indices are intact.

`setColumnConfigs` ([Body.ts:314-320](../src/typescript/lib/component/table/Body.ts#L314-L320)) gets the same treatment: replace the `clearRowPool()` + `renderWindow()` with the same loop, then `renderWindow()`. The diff is identical except for what changed (column config rather than visibility). Same call to `syncCells` re-applies the new group tints from the new config map.

### `Header.rebuildCells` rewrite

```typescript
private rebuildCells(): void {
    const row = this.getComponents()[1] as Row;

    const targetFields = this._model.getFields()
                                   .slice()
                                   .filter(f => !this._hiddenColumns.has(f.getName()))
                                   .sort((a, b) => a.getOrder() - b.getOrder());

    const columnMap = new Map(this._columns.map(c => [c.getField().getName(), c]));
    const existing  = row.getComponents() as HeaderCell[];

    // Map by field name from layout constraints (mirrors Row.syncCells).
    const byName = new Map<string, HeaderCell>();

    for (const cell of existing) {
        const lc    = row.getLayoutConstraints(cell);
        const field = lc?.data as Field | undefined;

        if (field) {
            byName.set(field.getName(), cell);
        }
    }

    // Remove cells that should no longer be visible.
    for (const cell of existing.slice()) {
        const lc    = row.getLayoutConstraints(cell);
        const field = lc?.data as Field | undefined;

        if (!field || this._hiddenColumns.has(field.getName())) {
            row.removeComponent(cell);
        }
    }

    // Add missing cells; re-wire and re-tint every (new + surviving) cell.
    for (let i = 0; i < targetFields.length; i++) {
        const field = targetFields[i];
        const col   = columnMap.get(field.getName());
        let   cell  = byName.get(field.getName());

        if (!cell) {
            const glyph = col?.getHeaderGlyph() ?? null;

            cell = new HeaderCell(field.getName(), field.getName(), glyph);
            cell.setTooltip(field.getDescription());

            row.addComponent(cell, { data: field });
        }

        const groupColor = col?.getGroupColor();

        if (groupColor) {
            cell.setBackgroundColor(groupColor);
        }

        // Re-wire — captures the new visible-column index.
        this.wireCell(cell, i);
    }

    // Re-order children to match new visible-field order.
    row.sortComponents((c1, c2) => {
        const f1 = (row.getLayoutConstraints(c1)?.data as Field).getOrder();
        const f2 = (row.getLayoutConstraints(c2)?.data as Field).getOrder();

        return f1 - f2;
    });

    this.syncSortIndicators();
}
```

Cells whose group tint was removed (a `groupColor` previously set, now absent) do **not** get their background cleared by this code. This is intentional and consistent with how the constructor behaves: the original `rebuildCells` body only writes `cell.setBackgroundColor(groupColor)` when truthy, never clears. If a future plan needs "ungrouping clears the tint," it's a separate concern — out of scope here.

---

## Ordered Implementation Steps

1. **Extract `Row.createCellForField` static helper** — move the switch from [Row.ts:64-93](../src/typescript/lib/component/table/Row.ts#L64-L93) into a private static method that returns the typed `Cell<any>`. Update the constructor to call it. Run `npm run typecheck` — expect zero errors and unchanged behaviour.

2. **Add `Body.getTreeFieldName(): string | undefined`** — protected method on `Body` returning `undefined`; protected override on `TreeBody` returning `this._treeColumn`. No call sites yet. `npm run typecheck` — expect zero errors.

3. **Add `Row.syncCells`** with the body shown in `## Implementation`. Wire it to the existing fields by setting `this._fieldNames` and `this._treeCell` as part of the sync. No call sites yet. `npm run typecheck`.

4. **Rewrite `Body.setHiddenColumns`** — replace the `clearRowPool` + `renderWindow` pair with the per-slot loop calling `Row.syncCells` plus `_rowGeom[i] = null` + `_cellGeom[i] = []`, then `renderWindow()`. Same for `Body.setColumnConfigs`. `npm run typecheck`.

5. **Rewrite `Header.rebuildCells`** — replace the `removeAllComponents` + full-rebuild loop with the in-place diff above. Keep `rebuildParentCells` exactly as is. `npm run typecheck`.

6. **Run the perf & correctness manual smoke** — hide + show each of 5 columns on the `MiscPanel` slow table, watch the row pool retain its instances (via DevTools "Components" panel / element-id check); verify the focus ring survives, the selected row stays selected, in-flight edits commit on hide.

7. **TreeTable smoke** — same hide/show pattern on a 5-column TreeTable, watching the tree column's `caret-down` / `caret-right` toggle remain visually identical across cycles. Confirm the tree column never gets double-wrapped (cell DOM tree has exactly one `TreeCellRenderer` per row).

8. **Listener-leak invariant check** — run the hide/show cycle on a non-tree-column 100 times in a loop. Snapshot `ThemeManager`'s subscriber count before and after. Expected delta: small constant (the once-per-hide-show new-cell allocations), not 100 × pool-size × 3.

9. **`npm run docs:build`** — expect 0 errors and 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/Row.ts` |
| Modify | `src/typescript/lib/component/table/Body.ts` |
| Modify | `src/typescript/lib/component/table/TreeBody.ts` |
| Modify | `src/typescript/lib/component/table/Header.ts` |

No file is created or deleted. Public surface is one new protected hook on `Body` + one new public method on `Row` — neither needs a docs page.

---

## Verification

- `npm run typecheck` — zero errors.
- `npm run docs:build` — zero errors, zero link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **`grep -n 'clearRowPool' src/typescript/lib/component/table/Body.ts`** — after this change `setHiddenColumns` and `setColumnConfigs` no longer call `clearRowPool`, and the existing theme-change listener / `setStore` path already invalidates geometry + bound indices without dropping the pool (see [Body.ts:84-89](../src/typescript/lib/component/table/Body.ts#L84-L89) and `onStoreChange`). That leaves `clearRowPool` with **zero callers** — remove the method along with the rewrite.
- **Manual smoke (Table)** — open the table demo panel; right-click the header → toggle each column off then back on; confirm:
  - The selected row stays highlighted and the focus ring stays on its column (`_focusedColIndex` clamps via the existing `ArrowLeft/Right` handler if needed but does not need explicit reset).
  - Cell text re-appears correctly (no blank cells after show).
  - The column resize handles still drag.
  - A column whose `groupColor` is set keeps its tint after hide → show.
- **Manual smoke (TreeTable)** — repeat on a 5-column TreeTable. The tree column cannot be hidden (constructor blocks it — [TreeTable.ts:223-231](../src/typescript/lib/component/table/TreeTable.ts#L223-L231)), so verify:
  - The other four columns toggle without disturbing the tree-cell renderer.
  - Toggle clicks still expand/collapse — the `getToggleElement` walk in `TreeBody.onSubtreeClick` ([TreeBody.ts:429-447](../src/typescript/lib/component/table/TreeBody.ts#L429-L447)) keeps finding the same `Glyph` instance after a sibling-column toggle.
  - `aria-level` / `aria-expanded` / `aria-setsize` / `aria-posinset` still read the correct values (DOM inspector spot check).
- **Edit-state smoke** — double-click a cell to start edit, type a new value, then right-click the header and hide that column. The pending value must land on the bound `ModelRecord` (verify via store inspector or by re-showing the column and reading the cell back).
- **Listener-leak invariant** — run:
  ```
  const counterBefore = countThemeChangeListeners(); // helper using ThemeManager internals
  for (let i = 0; i < 100; i++) {
      table.setColumnVisible("age", false);
      table.setColumnVisible("age", true);
  }
  const counterAfter = countThemeChangeListeners();
  ```
  Expected `counterAfter - counterBefore` is bounded by `2 × poolSize × 3` (the 100 hide cycles drop cells; the 100 show cycles create them; three listeners per cell — `Cell`, `CellRenderer`, `CellEditor`). The **delta must not scale** with the cycle count beyond the per-cell-creation bound. Today the delta would scale with `100 × poolSize × 3`.

Demo screen: the `MiscPanel` slow table (per the project perf-benchmark note) plus a `TreeTable` demo if one exists; otherwise the smoke runs on a hand-built 5-column TreeTable in a scratch panel.

---

## Documentation Impact

No consumer-visible API moves (the new `Body.getTreeFieldName` is `protected`; `Row.syncCells` is a public method but `Row` is not a class consumers typically construct — it's owned by `Body`). No new `@category` page. No `docs/` page updates required beyond a rerun of `npm run docs:build` to confirm clean output.

---

## Potential Challenges

- **`Row._fieldNames` invariant.** `setData` ([Row.ts:163-164](../src/typescript/lib/component/table/Row.ts#L163-L164)) walks `_fieldNames` in lockstep with `getComponents()`. The sync must keep these two ordered the same — `_fieldNames` is assigned at the end of `syncCells` from `targetNames`, and `sortComponents` reorders the cell array to match. Mitigation: an assertion in `setData` during development that `cells.length === names.length`, removed before the merge.
- **The constructor still calls the old switch, the new sync uses a static helper.** Mitigation: the extraction step (Step 1) is land-and-test before the sync is written. Diff of the constructor body is a one-line method call against six lines of inlined switch; the test suite confirms behaviour is unchanged.
- **First-call semantics — empty pool.** `Body.setHiddenColumns` is called from [Table.ts:142](../src/typescript/lib/component/table/Table.ts#L142) *before* the body is laid out for the first time, when `_rowPool` is empty. The new loop becomes a no-op in that case, and `renderWindow` runs as it does today (no rows to iterate). Same outcome, no defensive guard needed.
- **Sort indicator state after a hide.** `syncSortIndicators` walks the visible-field list against the cells — if a sorted column is hidden, its sort entry simply doesn't get rendered (the store keeps the sort, the column-row simply has no cell to mark). Re-showing the column re-creates the cell and `syncSortIndicators` re-applies the indicator. Verify by sorting on a column, hiding it, re-showing it.
- **The `setHeader` link from Body to Header is one-way.** The body's `_updateFocusStyle` ([Body.ts:936-986](../src/typescript/lib/component/table/Body.ts#L936-L986)) reads `_header.getColumns()` on every focus update; after the in-place sync the header still returns the same `Row` reference, just with mutated cell list — no need to refresh the link.

---

## Critical Files

- [`src/typescript/lib/component/table/Body.ts`](../src/typescript/lib/component/table/Body.ts) — the body whose `setHiddenColumns`, `setColumnConfigs`, `clearRowPool`, and `growRowPool` are the target.
- [`src/typescript/lib/component/table/Row.ts`](../src/typescript/lib/component/table/Row.ts) — the row whose constructor switch becomes the static helper, where `syncCells` lands.
- [`src/typescript/lib/component/table/Header.ts`](../src/typescript/lib/component/table/Header.ts) — sibling symmetric improvement to `rebuildCells`.
- [`src/typescript/lib/component/table/TreeBody.ts`](../src/typescript/lib/component/table/TreeBody.ts) — overrides `getTreeFieldName`.
- [`src/typescript/lib/component/table/cell/Cell.ts`](../src/typescript/lib/component/table/cell/Cell.ts) — `wrapRenderer`, `isEditing`, `commitEdit`, `setEditorPool` contracts the sync depends on.
- [`src/typescript/lib/component/table/cell/renderer/TreeCell.ts`](../src/typescript/lib/component/table/cell/renderer/TreeCell.ts) — confirms tree renderer's lifecycle (delegated child, depth state, fresh `Glyph` on `setTreeState`).
- [`src/typescript/lib/component/table/Table.ts`](../src/typescript/lib/component/table/Table.ts) — `setColumnVisible` call site; the in-place plan does not touch it.
- [`src/typescript/lib/layout/Table.ts`](../src/typescript/lib/layout/Table.ts) — the second `renderWindow` in `doLayout` (which becomes effectively free after this change).
- [`plans/implemented/table-parent-headers.md`](implemented/table-parent-headers.md) — the most recent table-internals plan; tone reference.

---

## Non-Goals

- **No `Table.setColumnVisible` change.** It keeps calling `_header.setHiddenColumns`, `_body.setHiddenColumns`, then `doLayout`. The plan changes *what those calls do* internally, not *when they happen*.
- **No `Header.rebuildParentCells` rewrite.** Group runs change cardinality on toggle; the destroy-and-rebuild path is the simplest correct approach for a small N. Listed under `## Architecture Decisions`.
- **No `TreeTable` public-API change.** No `TreeTableSpec` field, no method addition, no removal. The constructor's "tree column cannot be hidden" guard ([TreeTable.ts:223-231](../src/typescript/lib/component/table/TreeTable.ts#L223-L231)) stays.
- **No store-event refresh shape change.** `Body.bindStore` and `onStoreChange` ([Body.ts:120-145](../src/typescript/lib/component/table/Body.ts#L120-L145)) are untouched.
- **No layout-manager change.** `layout/Table.doLayout` keeps firing the second `renderWindow`. The geometry-cache invalidation in `setHiddenColumns` makes that pass do real cell-positioning work, but at the same cost as the existing column-resize path which is already a benchmark-target hot path.
- **No `ThemeManager.offThemeChange` API.** A real fix for cell theme-listener leaks needs a coordinated `Component.dispose` story, which is out of scope here. The new in-place sync narrows the leak by keeping survivors' listeners alive, but a fully leak-free hide does not exist until the `dispose` story lands.
- **No theme token additions.** No `## Theme Tokens` section.
