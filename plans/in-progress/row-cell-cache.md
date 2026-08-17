---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Row.ts
---

# Per-row cell cache — Implementation Plan

## Overview

A table row rebuilds its cells from scratch after the column window narrows and widens again. [`Row.setColumnWindow`](packages/lib/src/typescript/lib/component/table/Row.ts#L348) reconciles a row's rendered cells to the column range the body asks for. It already recycles a displaced cell onto an entering column *within a single call* — but a cell that is displaced and has no entering column to move to is destroyed outright ([Row.ts:472-481](packages/lib/src/typescript/lib/component/table/Row.ts#L472)). Narrowing is the case where almost every displaced cell hits that branch, because far more columns leave than enter.

This plan keeps those cells instead. `Row` gains a private, per-instance cache of detached cells keyed the same way the in-call recycler is keyed, the reconciler consults it before constructing anything, and `Row` gains a `destructor()` override that disposes whatever the cache still holds.

No source file other than [`Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) changes. No other class needs to know the cache exists: a cached cell is detached with the same [`removeComponent`](packages/lib/src/typescript/lib/core/Component.ts#L5299) call the disposal path already makes, so every `Body` sweep that walks `row.getComponents()` keeps seeing exactly the rendered set.[^body-untouched]

---

## Architecture Decisions

### The cache lives on `Row`, one per row instance

Each `Row` holds its own `Map` of detached cells. No cache is shared between rows and none lives on `Body` or `Table`.[^per-row]

This mirrors [`CellEditorPool`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L42): a private `Map` keyed by a reuse key, populated lazily, never a registered child of anything, and disposed by its owner's `destructor()`.

### The cache holds many cells per key, unlike `CellEditorPool`

`CellEditorPool._editors` is a `Map<string, CellEditor>` — one instance per key, because only one cell can be edited at a time. This cache is a `Map<string, Cell<any>[]>`, because one narrowing pass can displace several cells that share a key.[^many-per-key]

### Keys come from `cellKeyFor`, unchanged

A cached cell is filed under [`this.cellKeyFor(field)`](packages/lib/src/typescript/lib/component/table/Row.ts#L588) — the same type/renderer-compatibility signature the in-call `free` map already uses. `Row.cellKey`'s precedence rules are not touched.

### In-call leftovers beat the cache, and the cache beats construction

When a column needs a cell, the reconciler tries three sources in order: a cell displaced in *this* call (`free`), then the persistent cache, then a fresh build.[^free-first]

| Situation | `free` has the key | Cache has the key | Source | Work on the row |
|---|---|---|---|---|
| Scroll right one column, `string` → `string` | yes | – | `free` | `setLayoutConstraints` — already a child |
| Widen after a narrow; the column re-enters | no | yes | cache | `addComponent` + `invalidateLayout` |
| A column type this row has never rendered | no | no | build | construct, wire `"commit"`, `addComponent` |
| A column leaves and nothing enters | – | – | – | commit any edit, `removeComponent`, file under its key |

### A cell restored from the cache is marked layout-dirty

Every cell taken out of the cache gets [`invalidateLayout()`](packages/lib/src/typescript/lib/core/Component.ts#L5660) before the body positions it, so the positioning pass cannot skip its `doLayout()`.

`Cell` opts into the unchanged-geometry layout skip ([Cell.ts:142](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L142)), and a cell restored onto the column it left arrives at byte-identical geometry. Without that mark, a layout fitted to conditions that changed while the cell sat in the cache survives the round trip.[^dirty-on-restore]

### Cached cells are detached children, not hidden ones

A cell enters the cache through `removeComponent`, exactly as the disposal path detaches it today. It is never left parented-but-hidden.[^must-detach]

### `setColumnFields` empties the cache

[`Row.setColumnFields`](packages/lib/src/typescript/lib/component/table/Row.ts#L287) disposes every cached cell and clears the map before recording the new field list. The field set, the per-field configs, or the whole model may all have changed, so a cell filed under a key derived from the old configuration must not be handed to the new one.[^clear-on-field-change]

### `renderSeparator` files its cells in the cache instead of disposing them

[`Row.renderSeparator`](packages/lib/src/typescript/lib/component/table/Row.ts#L321) currently calls `disposeAllComponents()`. It instead retires each cell through the same helper the reconciler uses, so a rotated-mode row flipping between separator and data rendering reuses its cells the same way a narrow/widen cycle does.[^separator]

A component in a slot with no recorded key — the previous `GroupSeparatorCell`, when `renderSeparator` is called on a row that is already a separator — is disposed, because it has no key to file it under.

### `Row` gains a `destructor()` override

Cached cells are not in `_components`, so [`Component.destructor`](packages/lib/src/typescript/lib/core/Component.ts#L768)'s child recursion cannot reach them. `Row.destructor()` disposes the cache, then calls `super.destructor()`.

This is the established shape for a pool its owner has to reach explicitly: [`Body.destructor()`](packages/lib/src/typescript/lib/component/table/Body.ts#L1048) does it for `_editorPool`, and [`VirtualRowView.destructor()`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L133) does it for `_rowPool`.

### No cap, no eviction policy

The cache has no size limit and nothing is ever evicted from it except by a restore, by `setColumnFields`, or by teardown. It is bounded by construction: for one row, **attached cells plus cached cells never exceed the number of visible fields**.[^bound]

| Step | Rendered window | Attached | Cached | Total |
|---|---|---|---|---|
| First render, 6 columns | 0–5 | 6 | 0 | 6 |
| Narrow | 0–1 | 2 | 4 | 6 |
| Widen | 0–5 | 6 | 0 | 6 |
| Narrow further | 0–0 | 1 | 5 | 6 |

The memory this costs is real and is stated in `## Potential Challenges` — a self-bounding cache is not a free one.

---

## Internal Structure

New private state on `Row` ([Row.ts:38-67](packages/lib/src/typescript/lib/component/table/Row.ts#L38), alongside `_cellKeys` and `_fieldNames`):

```typescript
// Cells detached from the rendered set that no entering column could take,
// filed by `cellKeyFor` key so a later widen restores them instead of
// rebuilding. Framework-managed bookkeeping — not a consumer surface, so it
// stays off any options bag. A plain initializer is correct here: no setter
// `applyOptions` dispatches writes this field, so the `declare` rule in
// CODE_CONVENTIONS.md does not apply.
private _cellCache: Map<string, Cell<any>[]> = new Map();
```

The two new private methods:

```typescript
/**
 * Retires `cell` out of the rendered set: commits an in-flight edit, detaches
 * it, and either files it in the cache under `key` or disposes it when the
 * slot carried no key.
 */
private retireCell(cell: Cell<any>, key: string | undefined): void;

/** Disposes every cached cell and empties the cache. */
private disposeCellCache(): void;
```

`retireCell` runs the commit **before** `removeComponent`, matching the order the current disposal loop uses. The table's typed cells borrow one shared editor instance from `CellEditorPool` for the duration of an edit; a cell parked mid-edit would keep that editor parented to a detached cell, so the pool could never lend it out again.

---

## Ordered Implementation Steps

Steps 1-10 all edit [`packages/lib/src/typescript/lib/component/table/Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) and nothing else. `Cell` is already imported there, so no import changes.

1. **Add the `_cellCache` field.** Declare it next to `_cellKeys` / `_fieldNames` ([Row.ts:54-57](packages/lib/src/typescript/lib/component/table/Row.ts#L54)) with the comment from `## Internal Structure`.

2. **Add `retireCell(cell, key)`.** Body, in this order: `if (cell.isEditing()) cell.commitEdit();` → `this.removeComponent(cell);` → when `key === undefined`, `cell.dispose()` and return → otherwise push onto `this._cellCache.get(key)`, creating a one-element array when the key is absent. Mirror the array-or-create shape the `free` map already uses at [Row.ts:409-417](packages/lib/src/typescript/lib/component/table/Row.ts#L409).

3. **Add `disposeCellCache()`.** Loop every array in `_cellCache`, call `dispose()` on each cell, then `this._cellCache.clear()`. Mirror [`CellEditorPool.dispose`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L120).

4. **Add the `destructor()` override.** `protected destructor(): void { this.disposeCellCache(); super.destructor(); }`, placed after `doLayout` at [Row.ts:667](packages/lib/src/typescript/lib/component/table/Row.ts#L667). Document why the base recursion cannot reach the cache, mirroring the wording of [`Body.destructor`](packages/lib/src/typescript/lib/component/table/Body.ts#L1048).

5. **Consult the cache in pass 2.** Replace [Row.ts:429-447](packages/lib/src/typescript/lib/component/table/Row.ts#L429) — from `const pool = free.get(key);` down to the closing brace of the build branch — with:

   ```typescript
   const pool   = free.get(key);
   const cached = this._cellCache.get(key);
   let cell: Cell<any>;

   if (pool && pool.length > 0) {
       cell = pool.pop()!;

       this.setLayoutConstraints(cell, { data: field });
   } else if (cached && cached.length > 0) {
       cell = cached.pop()!;

       if (cached.length === 0) {
           this._cellCache.delete(key);
       }

       this.addComponent(cell, { data: field });
       cell.invalidateLayout();
   } else {
       // unchanged build branch: createCellForField, the tree wrap, the
       // `on("commit")` wiring, and addComponent — all exactly as today.
   }
   ```

   The restored cell must **not** be re-wrapped with `TreeCellRenderer` and must **not** get a second `on("commit")` listener — both were wired when it was first built and both are still attached. Leave `assigned[slot] = cell;` and `retargeted.add(col);` after the whole chain, unchanged, so pass 3 rebinds the restored cell's value.

6. **Replace the disposal loop with retirement.** At [Row.ts:472-481](packages/lib/src/typescript/lib/component/table/Row.ts#L472), iterate `free`'s entries rather than its values so the key is in hand:

   ```typescript
   for (const [key, pool] of free) {
       for (const cell of pool) {
           this.retireCell(cell, key);
       }
   }
   ```

   Update the comment above it: cells are now parked for reuse, and only a keyless slot is disposed.

7. **Retire from `renderSeparator` too.** Replace `this.disposeAllComponents();` at [Row.ts:322](packages/lib/src/typescript/lib/component/table/Row.ts#L322) with a snapshot-then-retire loop. It must run **before** the `this._cellKeys = [];` assignment further down the method ([Row.ts:329](packages/lib/src/typescript/lib/component/table/Row.ts#L329)), because it reads those keys:

   ```typescript
   const cells = [...this.getComponents()] as Cell<any>[];

   for (let s = 0; s < cells.length; s++) {
       this.retireCell(cells[s], this._cellKeys[s]);
   }
   ```

   The snapshot is required — `retireCell` calls `removeComponent`, which splices the live array `getComponents()` returns.

8. **Clear the cache in `setColumnFields`.** Add `this.disposeCellCache();` as the first statement of [`setColumnFields`](packages/lib/src/typescript/lib/component/table/Row.ts#L287), with a one-line comment stating that the field list or the configs behind the keys may have changed.

9. **Update the JSDoc on `setColumnWindow` and `renderSeparator`.** `setColumnWindow`'s summary at [Row.ts:336-347](packages/lib/src/typescript/lib/component/table/Row.ts#L336) says unclaimed cells are "committed (if editing), removed, and disposed" — it must now say they are parked in the row's cell cache and that the cache is consulted before a fresh cell is built. Do not `{@link}` any of the new private members from this public JSDoc (see [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Don't `{@link}` internal symbols from public JSDoc*) — describe the behaviour in prose.

10. **Checkpoint.** `grep -n "disposeAllComponents" packages/lib/src/typescript/lib/component/table/Row.ts` — expect exactly one match, the `_separatorMode` guard at [Row.ts:350](packages/lib/src/typescript/lib/component/table/Row.ts#L350). `grep -n "\.dispose()" packages/lib/src/typescript/lib/component/table/Row.ts` — expect exactly two, one in `retireCell` and one in `disposeCellCache`.

11. **Write the tests** in a new `packages/lib/tests/component/table/RowCellCache.test.ts`, covering every unit-testable case in `## Expected Behaviour`. Follow [`CustomRenderer.test.ts`](packages/lib/tests/component/table/CustomRenderer.test.ts#L25) for the `installTestDOM` + bare-`Row` setup and [`CellEditorPool.styleRuleDisposal.test.ts`](packages/lib/tests/component/table/CellEditorPool.styleRuleDisposal.test.ts#L34) for the `_ruleCacheKeys()` leak-diff shape.

12. **Update the docs.** See `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Create | `packages/lib/tests/component/table/RowCellCache.test.ts` |
| Modify | `packages/lib/docs/components/TableInternals.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Build the fixtures from a `Model` with six columns in declared order — columns 0-2 `string`, columns 3-5 `number` — so the key-matching cases have something to fail on. Read the cache through a cast, the idiom the existing table tests already use for private state: `const cache = (row as any)._cellCache as Map<string, unknown[]>;` and size it as the sum of its arrays' lengths.

**Unit-testable** (offline, `installTestDOM`, a bare `Row` as in `CustomRenderer.test.ts`):

1. **A narrow-then-widen cycle returns the same cell instances.** `setColumnWindow(0, 5)`; capture the six cells. `setColumnWindow(0, 1)`; `setColumnWindow(0, 5)`. All six original instances are in `getComponents()` again, and no instance in `getComponents()` is new.
2. **Retired cells leave the rendered set.** After `setColumnWindow(0, 1)`, `getComponents().length === 2` and `getFieldNames().length === 2`.
3. **The cache respects keys.** `setColumnWindow(0, 5)`, then `setColumnWindow(0, 2)` (only the string columns render; three number cells go to the cache), then `setColumnWindow(3, 5)`. The three rendered cells are the three original `NumberCell` instances, not the cached string cells.
4. **Total live cells never exceed the field count.** Across `setColumnWindow(0,5)` → `(0,1)` → `(0,5)` → `(0,0)` → `(0,5)`, `getComponents().length` plus the cache size is `6` at every step.
5. **A restored cell is layout-dirty.** Render the row first (`row.getElement(true)`), then `setColumnWindow(0, 5)` and call `applyBounds(0, 0, 100, 20)` on each cell so every one reports `isLayoutDirty() === false`. Narrow to `(0, 1)`, widen to `(0, 5)`: every restored cell reports `isLayoutDirty() === true`. (Rendering first is what makes this non-vacuous — an unrendered component is dirty by default.)
6. **The unchanged-window early return still holds.** `setColumnWindow(0, 5)` after a narrow returns `true`; calling it a second time returns `false`.
7. **A cell mid-edit is committed before it is cached.** Wire the column-5 cell to a `CellEditorPool` (`cell.setEditorPool(new CellEditorPool())` — a bare `Row` has no pool, so `startEdit` would otherwise be a no-op), start an edit, set a new value on the editor, then `setColumnWindow(0, 1)`. The new value has landed on the bound record and no cached cell reports `isEditing()`.
8. **`setColumnFields` empties the cache.** Narrow to `(0, 1)`, call `setColumnFields` with the same model and an empty hidden set, then assert the cache map is empty.
9. **A separator flip round-trips through the cache.** `setColumnWindow(0, 5)`, capture the cells, `renderSeparator("g", null)` — `getComponents()` now holds one cell and the cache holds six — then `setColumnWindow(0, 5)`: the same six instances are rendered again.
10. **`renderSeparator` disposes a slot with no key.** On a row that has never been windowed, call `renderSeparator("g", null)` twice. The cache is empty after both calls — the first retires nothing, and the second retires only the previous `GroupSeparatorCell`, which has no recorded key.
11. **Teardown leaves no stylesheet rules.** Build a `Table` over the six-column model, narrow its body's rows, `dispose()` the table, and diff `_ruleCacheKeys()` against a warm-up baseline — expect `[]`.
12. **A row disposed twice does not throw.** Narrow the row so the cache is non-empty, then `row.dispose(); row.dispose();`.

**Manual verification** (needs a browser — `npm run dev`, http://localhost:8015):

13. Open the grouped-wide table from [`MiscPanel.ts:432`](packages/lib/src/typescript/MiscPanel.ts#L432) ("Show window with grouped wide table (25 columns, 4 groups)!"). With a `MutationObserver` counting removed nodes, minimize and restore the window. The 80 `<td>` removals and 263 total node removals measured before this change should drop to zero.
14. Narrow and widen the window horizontally (the larger win — every in-window pooled row narrows its column window, not just the five that survive a minimize). Cells reappear with correct values, alignment, group tint, and read-only tint.
15. Switch theme while a table is narrowed, then widen it. Restored cells pick up the new padding and border rather than keeping the old fit.
16. Start editing a cell near the right edge, then narrow the window until its column leaves. The edit commits to the record.
17. Open the rotated grouped view and scroll through it. Separator rows still flip to data rows and back with correct content.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` — the new `RowCellCache.test.ts` passes, and the existing table suites stay green. Pay particular attention to `BindViewRenderEconomy.test.ts`, `RotatedGroupSeparators.test.ts`, `RotatedView.test.ts`, `CustomRenderer.test.ts`, `cell/DynamicCell.test.ts`, and `cell/Combo.test.ts` — all drive `setColumnWindow` or `setColumnFields` directly.
- `npm run lint` — clean.
- `npm run docs:api` — finishes with zero warnings.
- Grep invariants from step 10.
- Manual cases 13-17 above.

---

## Documentation Impact

No exported symbol is added, removed, or renamed, so no typedoc or barrel change is needed. `Row.destructor` is `protected` and the cache is `private`; both are excluded from the API docs.

- [`packages/lib/docs/components/TableInternals.md`](packages/lib/docs/components/TableInternals.md) — the `Row` paragraph (line 39) ends by describing in-call recycling as the whole story. Extend that sentence: a displaced cell with no entering column to take it is now kept in a per-row cache and restored when its column comes back, so narrowing and re-widening a table costs no cell construction.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — add a bullet under `## Changed` → `### Components`, in the existing voice: narrowing a table (a window minimize, a horizontal resize, a split-gutter drag) and widening it again no longer destroys and rebuilds the cells that left the view; state the memory trade plainly, and that no consumer action is needed.

---

## Potential Challenges

- **Retained memory.** The row pool is high-water-marked — [`growRowPool`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L327) only ever grows it — so the worst case is `pooled rows × visible fields` cells held alive: for a once-maximized 25-column table with ~30 pooled rows, roughly 750 `Cell` instances, each holding a detached DOM node, a renderer, and possibly a per-instance `StyleRule`. Nothing mitigates this beyond the per-row bound; it is the price of the feature and the changelog states it.
- **Detached DOM subtrees.** A cached cell's `<td>` stays alive but out of the document. DevTools reports these as detached nodes, which is expected, not a leak — `Row.destructor()` releases them.
- **Cached cells are invisible to `Body`'s per-row sweeps** — `wireRowCells`, `applyReadOnlyState`, `commitEditsOutsideWindow`, `onThemeReflow` all walk `row.getComponents()`. Mitigated: a restore only ever happens on a pass where `setColumnWindow` returned `true`, and [`bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L1306) re-runs `wireRowCells` and `applyReadOnlyState` on exactly that condition; `applyRequiredEmptyState` and pass 3's `setBaseBackground` run on every pass regardless.
- **Double-wiring on restore.** A restored cell already carries its `on("commit")` listener and, on the tree column, its `TreeCellRenderer` wrapper. Mitigated by keeping both inside the build branch only — step 5 says so explicitly, and case 1's identity assertions catch a stray rebuild.
- **Stale keys after a config swap.** Mitigated by `setColumnFields` disposing the cache; the cost is that hiding a column and showing it again rebuilds rather than restores, which is a user gesture rather than a per-frame tween.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) — the only source file that changes. Read `setColumnWindow`, `renderSeparator`, `setColumnFields`, `cellKey`, `cellKeyFor`, and `createCellForField` in full.
- [`packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — the precedent this design mirrors: a private key-addressed map, lazily populated, disposed by its owner.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `_rowPool`, `growRowPool`, `hideExcessPoolRows`, and the `destructor()` override that disposes a pool the base recursion cannot reach.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `bindAndPositionRows`, `renderWindowPass`, `syncPoolCells`, `wireRowCells`, `onThemeReflow`, `destructor`. Nothing here changes, but every one of them constrains what the cache may do.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) — `canSkipUnchangedLayout`, `isEditing`, `commitEdit`, `detachEditor`.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `removeComponent` / `unwireChild` / `removeElement` (what detaching actually does), `insertComponent` (what re-attaching does), `applyBounds`, `invalidateLayout`, `destructor`.
- [`plans/implemented/layout-calc-commit-split-first-step.md`](plans/implemented/layout-calc-commit-split-first-step.md) — the plan that introduced `canSkipUnchangedLayout`; its skip table is what the layout-dirty decision answers to.
- [`plans/implemented/table-column-virtualization.md`](plans/implemented/table-column-virtualization.md) — the plan that introduced `setColumnWindow`'s three passes and the `cellKey` precedence.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md).

---

## Non-Goals

- **A cache shared across rows, or one owned by `Body` / `Table`.** Per-row is sufficient for every scenario this targets and needs no cross-row identity bookkeeping.[^per-row]
- **Header cells.** [`Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts#L1214) runs its own column reconciler with its own `removeComponent` + `dispose()` sites, and destroys header cells on the same narrowing passes. Caching those is a separate change against a separate reconciler.
- **Skipping reconciliation for hidden rows.** Already the behaviour: `bindAndPositionRows` loops only `i < windowSize`, and [`hideExcessPoolRows`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L436) touches only slots at or beyond `windowSize`. A hidden row keeps the column window it had and is never reconciled while hidden.[^hidden-rows]
- **Shrinking the row pool, or an LRU / size cap on the cache.** The per-row bound makes an eviction policy unnecessary; adding one would be speculative machinery.
- **Opting `Cell` into [`Component.release()`](packages/lib/src/typescript/lib/core/Component.ts#L1086).** That mechanism drops a live component's element and rebuilds it lazily — a different trade (less memory, more work on restore) than this cache makes, and one that would undo the main saving.[^no-release]
- **Changing `Row.cellKey`'s precedence rules**, which decide when two columns may share a cell at all.

---

## Notes

[^body-untouched]: `Body` reaches into a row's cells through `row.getComponents()` in five places — `wireRowCells` ([Body.ts:429](packages/lib/src/typescript/lib/component/table/Body.ts#L429)), `commitEditsOutsideWindow` ([Body.ts:1243](packages/lib/src/typescript/lib/component/table/Body.ts#L1243)), `applyReadOnlyState` ([Body.ts:1760](packages/lib/src/typescript/lib/component/table/Body.ts#L1760)), `applyRequiredEmptyState` ([Body.ts:1810](packages/lib/src/typescript/lib/component/table/Body.ts#L1810)), and `onThemeReflow` ([Body.ts:364](packages/lib/src/typescript/lib/component/table/Body.ts#L364)) — plus the per-slot `applyBounds` loop at [Body.ts:1342](packages/lib/src/typescript/lib/component/table/Body.ts#L1342), which indexes `getComponents()` in lockstep with `getFieldNames()`. All six keep working unchanged precisely because a cached cell is not a child. The one sweep whose miss matters is `onThemeReflow`, and the layout-dirty decision covers it.

[^per-row]: Two facts make per-row the right scope. First, pooled rows are never destroyed while the table lives: `hideExcessPoolRows` only calls `setDisplayed(false)` and clears the slot's bound index, and `growRowPool` only ever grows `_rowPool`. So the row instance that narrowed is the same instance that widens again, and a cache on that instance serves the whole scenario. Second, a per-row cache is bounded by that row's own field count (see the bound footnote), whereas a body-level cache pools cells from every row and needs a policy to decide how many of each key to keep — machinery with no corresponding benefit, since a cell restored from a shared cache would still have to be attached to exactly one row.

[^many-per-key]: A single narrowing pass from a 25-column window down to a 2-column one displaces roughly a dozen `string`-keyed cells at once. `CellEditorPool`'s one-per-key `Map` would keep the first and force the rest to be disposed, which is the behaviour this plan exists to remove. An array per key is the smallest change that carries the case, and it matches the shape `setColumnWindow`'s in-call `free` map ([Row.ts:407-417](packages/lib/src/typescript/lib/component/table/Row.ts#L407)) already uses for the same reason.

[^free-first]: A cell in `free` is still a registered child of the row, so claiming it costs one `setLayoutConstraints` call. A cell in the cache costs an `addComponent`, which re-inserts its DOM node, schedules a layout, and notifies the parent's preferred-size hook. Both are far cheaper than construction, but `free` is cheaper than the cache, so it goes first. Draining `free` first also keeps the cache from growing on a pass that had a perfectly good in-call match available.

[^dirty-on-restore]: `applyBounds` skips `doLayout()` when the rectangle is unchanged, the component opted into the skip, it is not dirty, and it has an element ([Component.ts:3398](packages/lib/src/typescript/lib/core/Component.ts#L3398)). A cached cell keeps its element handle — `removeComponent` → `unwireChild` → `removeElement` detaches the node but leaves `_element` cached, which is what makes `addComponent` re-insert the *same* node rather than build a new one — so all four conditions can hold on restore. The concrete failure: a theme change while the cell sits in the cache. `Body.onThemeReflow` marks each pooled row's *attached* cells dirty and cannot see the cached ones, so a cell restored onto its old column at its old geometry would keep a layout fitted to the previous theme's padding and border. Marking every restored cell dirty costs one `doLayout()` per restore, against a construction it avoids entirely.

[^must-detach]: `setColumnWindow`'s unchanged-window early return derives the current last column as `this._windowFirst + this.getComponents().length - 1` ([Row.ts:373](packages/lib/src/typescript/lib/component/table/Row.ts#L373)). A cached cell left in `_components` would inflate that length and make the guard compute a window the row is not actually rendering. The same slot-index alignment underpins `getFieldNames()`, `Body`'s per-slot `applyBounds` loop, `applyReadOnlyState`, and `applyRequiredEmptyState`. Hiding a cell with `setDisplayed(false)` would keep it in `getComponents()` and break all of them; only `removeComponent` gets it out of the way.

[^clear-on-field-change]: `setColumnFields` is reached from `Body.syncPoolCells` ([Body.ts:846](packages/lib/src/typescript/lib/component/table/Body.ts#L846)), which runs on a hidden-column change, a column-config change, and a store swap. A store swap replaces the model outright, so cached cells belong to fields that may no longer exist. A config change can leave a key's *string* identical while changing what it means — `renderer:price` still reads `renderer:price` after the renderer factory is replaced. Clearing is the conservative call, and it costs nothing in the scenarios this plan targets, none of which touch the field list. Note that `renderSeparator` also sets `_columnsDirty` but deliberately does *not* clear the cache: the field list is unchanged there, which is exactly why the separator flip can reuse its cells.

[^separator]: A rotated table's grouped view flips the same pooled row between a single `GroupSeparatorCell` and a full set of field cells as the user scrolls, driven from `Body.bindAndPositionRows` ([Body.ts:1291-1304](packages/lib/src/typescript/lib/component/table/Body.ts#L1291)). Today every flip destroys the row's field cells and the flip back rebuilds them, which is the same waste on the same row instance that a narrow/widen cycle causes — so it routes through the same helper rather than being left as the one path that still disposes. `renderSeparator` gains one behaviour it did not have: an in-flight edit is committed before its cell is retired. That is required, not incidental — a cell parked mid-edit holds the shared pool editor as a child of a detached component, and the pool could never lend it out again.

[^bound]: A cell is created only when neither `free` nor the cache can supply its key, so the number of cells that ever exist under key `K` is at most the largest number of columns with key `K` that a single window has held — which is at most the number of visible fields with key `K`. Every column has exactly one key, so summing over keys gives: total cells for a row ≤ total visible fields. Attached and cached are disjoint halves of that total. The bound is re-established whenever `setColumnFields` changes the field list, because it empties the cache.

[^hidden-rows]: This also explains the measured numbers. During a window minimize the visible height falls toward zero, so `computeVisibleWindow` ([VirtualRowView.ts:271](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L271)) collapses to about five rows — `SCROLL_BUFFER` on each side plus the rounding. Only those five rows run `setColumnWindow`, which is why one minimize of the 25-column grouped-wide table destroyed 80 body cells rather than the pool's full complement. A horizontal narrow is the larger case: the row window stays full height, so every in-window pooled row narrows its column window, and the cells saved scale with the pool rather than with five.

[^no-release]: `Component.release()` shipped as a base seam with no component opting in (see `plans/implemented/component-element-release.md` and the 0.5.0 changelog). It detaches the element *and* drops the handle, so a released cell rebuilds its DOM on the next `getElement(true)`. That is the opposite trade from this cache, whose whole saving comes from the element surviving the round trip. The two are not alternatives to weigh here — releasing cached cells would be a follow-on memory optimization that gives back most of the speed this plan buys.
