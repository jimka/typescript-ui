---
touches-shared:
    - packages/lib/src/typescript/lib/component/table/Body.ts
    - packages/lib/src/typescript/lib/component/table/cell/Cell.ts
    - packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts
    - packages/lib/tests/component/table/cell/CellEditorPool.test.ts
    - packages/lib/docs/components/TableInternals.md
---

# Cell Editor Record Binding — Implementation Plan

## Overview

A table body keeps a small pool of `Row` components and rebinds them to new records as the user scrolls. A cell editor opened on one of those rows is not consulted when the row is rebound, so the editor stays open over a slot that now shows a different record. The next blur or Enter writes the user's text onto that different record, and the record the user actually edited is left untouched — silent data loss, reproduced by a probe as `WROTE_TO_WRONG_RECORD: true`.

The write lands in [`Row.commitCellValue`](packages/lib/src/typescript/lib/component/table/Row.ts#L788), which sets the field on `this._data` — whatever record the row holds *at commit time*, not the one the edit was opened against. The rebind that moves `_data` out from under the open editor is [`Body.bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L1390)'s `row.setData(records[dataIndex])` at [`:1437`](packages/lib/src/typescript/lib/component/table/Body.ts#L1437).

This plan adds a commit sweep on the row axis, mirroring the one [`Body.commitEditsOutsideWindow`](packages/lib/src/typescript/lib/component/table/Body.ts#L1348) already performs on the column axis, and closes the two remaining holes in [`CellEditorPool`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) through which the single shared editor can be taken away from a cell that is still editing. `TreeBody` inherits every change unaltered — it overrides neither `bindAndPositionRows` nor the pool.

---

## Architecture Decisions

### One rule: the shared editor is committed before anything takes it away

There are three points at which a cell stops owning the editor it opened, and each one commits the open edit first:

| Door | Where | Today |
|---|---|---|
| The cell's row is rebound to a different record | `Body.bindAndPositionRows` | unguarded — this is the data-loss bug |
| Another cell acquires the shared editor | `CellEditorPool.acquire` | unguarded — latent |
| A factory is re-registered over a cached editor | `CellEditorPool.register` | unguarded, and the editor is also never disposed |

The rule is not new. [`Row.retireCell:945-947`](packages/lib/src/typescript/lib/component/table/Row.ts#L945) already commits an in-flight edit before a cell leaves the rendered set, and `Body.commitEditsOutsideWindow` is itself a copy of that rule for the column axis.[^precedent] [`Cell.setReadOnly:432-461`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L432) applies it a third time when a cell turns read-only mid-edit.

### The row sweep fires on record identity, not on `wasRebound`

The sweep commits an open edit only when the row's slot is about to be bound to a **different record object** — `records[firstRow + i] !== row.getData()`. It does not use `wasRebound`, the flag the bind loop computes at [`Body.ts:1434`](packages/lib/src/typescript/lib/component/table/Body.ts#L1434) as `this._boundIndices[i] !== dataIndex`.[^why-not-wasrebound]

| Situation | `wasRebound` | `records[firstRow + i]` vs `row.getData()` | Sweep commits? |
|---|---|---|---|
| Settled re-render, nothing moved | `false` | same record | no |
| Wheel scrolls slot 0 from record 41 to record 81 | `true` | different record | **yes** |
| Unrelated `datachange` (a record outside the window changed) | `true` | same record | no |
| Row's slot falls outside the window and is hidden | not visited | not visited | no |

The last two rows are why `wasRebound` is the wrong trigger. Any store event runs `Body.onStoreChange`, which blanks every entry of `_boundIndices` ([`Body.ts:482-485`](packages/lib/src/typescript/lib/component/table/Body.ts#L482)), so `wasRebound` is `true` for every slot even when no row changes record. A `wasRebound`-triggered sweep would close the user's editor on every unrelated store event.

### The sweep runs once, before the first row is rebound

`commitEditsBeforeRebind` is a single pass over the window, placed in `bindAndPositionRows` immediately after `alignPoolWindow` — the step that rotates the pool's bookkeeping arrays so slot `i` carries data index `firstRow + i` — rather than an inline check next to `row.setData`. Every commit therefore happens before any row in the pass is rebound.[^sweep-placement]

### Two sweeps, one rule — the axes cannot share a call site

The column sweep must run *before* the row window is computed, because committing can change what a filtered store returns; the row sweep must run *after* the pool rotation has settled which slot carries which record. Neither ordering can serve the other, so the row axis gets its own sweep next to the column one rather than an extension of it.[^one-guard]

### The sweep commits; it never cancels

An interrupted edit is saved onto the record it was opened against, not discarded. Every existing commit-before-discard site in the table commits.[^commit-not-cancel]

### `release` names its caller, and `register` disposes what it drops

`CellEditorPool.release()` takes the cell that is releasing and ignores a caller that is not the pool's active cell. `CellEditorPool.register` disposes a cached editor before dropping it, which is what the class's own `dispose()` JSDoc already claims is impossible.[^register-dispose] The identity check mirrors [`Menu.toggleFor:461-489`](packages/lib/src/typescript/lib/overlay/Menu.ts#L461), where a shared panel compares the opener it holds against the one now asking before acting on it.

---

## Public API

`CellEditorPool` is exported from `packages/lib/src/typescript/lib/component/table/index.ts:63`. One signature changes:

```typescript
class CellEditorPool {
    // Changed: was `release(): void`.
    release(cell: Cell<any>): void;

    // Unchanged signatures, changed behaviour (see Internal Structure):
    acquire(key: string, cell: Cell<any>): CellEditor<unknown> | null;
    register(key: string, factory: CellEditorFactory): this;
}
```

The only in-library caller is [`Cell.detachEditor:730`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L730), which passes `this`.

---

## Internal Structure

### `Body.commitEditsBeforeRebind`

New private method, placed directly after `commitEditsOutsideWindow` (which ends at `Body.ts:1367`):

```typescript
private commitEditsBeforeRebind(firstRow: number, windowSize: number, records: ModelRecord[]): void {
    for (let i = 0; i < windowSize; i++) {
        const row = this._rowPool[i];

        if (records[firstRow + i] === row.getData()) {
            continue;
        }

        for (const cell of row.getComponents() as Cell<any>[]) {
            if (cell.isEditing()) {
                cell.commitEdit();
            }
        }
    }
}
```

`commitEditsBeforeRebind` returns nothing: unlike the column sweep, its caller has no state to re-read afterwards.[^no-return]

Call site, inside `bindAndPositionRows` at [`Body.ts:1396`](packages/lib/src/typescript/lib/component/table/Body.ts#L1396):

```typescript
this.alignPoolWindow(firstRow);
this.commitEditsBeforeRebind(firstRow, windowSize, records);
```

### `CellEditorPool` ownership

```typescript
acquire(key: string, cell: Cell<any>): CellEditor<unknown> | null {
    const factory = this._factories.get(key);
    if (!factory) {
        return null;
    }

    this.commitActiveCell(cell);
    // …unchanged lazy construction…
    this._activeCell = cell;

    return editor;
}

release(cell: Cell<any>): void {
    if (this._activeCell !== cell) {
        return;
    }

    this._activeCell = null;
}

register(key: string, factory: CellEditorFactory): this {
    const cached = this._editors.get(key);

    if (cached) {
        this.commitActiveCell(null);
        this._editors.delete(key);
        cached.dispose();
    }

    this._factories.set(key, factory);

    return this;
}

/**
 * Commits whichever cell currently holds the shared editor, unless that cell is
 * `next` (a cell re-acquiring the editor it already holds).
 */
private commitActiveCell(next: Cell<any> | null): void {
    const active = this._activeCell;

    if (!active || active === next) {
        return;
    }

    active.commitEdit();
    this._activeCell = null;
}
```

`commitActiveCell` clears `_activeCell` itself rather than relying on the `release` that `commitEdit` triggers, so the pointer is empty even for a cell whose `commitEdit` short-circuits.

---

## Ordered Implementation Steps

Work test-first: steps 1 and 5 write failing tests, steps 2–3 and 6–7 make them pass.

1. **Add the row-axis regression test.** New file `packages/lib/tests/component/table/EditAcrossRowRebind.test.ts`, modelled on `packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts` (same `installTestDOM` config, the same captured-`requestAnimationFrame` `runFrames()` helper, the same `MemoryStore` + `Model` fixture). Cover Expected Behaviour cases 1–5. Run it: cases 1 and 5 must fail with the edited record untouched, cases 2–4 must already pass.
2. **Add `commitEditsBeforeRebind`** to `packages/lib/src/typescript/lib/component/table/Body.ts`, directly after `commitEditsOutsideWindow` (ends `:1367`), with the body given in `## Internal Structure`. Give it a JSDoc that states the rule, names `commitEditsOutsideWindow` as the column-axis sibling, and records that the trigger is record identity rather than `wasRebound`.
3. **Call it** from `bindAndPositionRows`, on the line after `this.alignPoolWindow(firstRow);` (`:1396`).
4. Run the step 1 test — every case must now pass. Then run the whole table suite: `npx vitest run tests/component/table`.
5. **Add the pool ownership tests** to the existing `packages/lib/tests/component/table/cell/CellEditorPool.test.ts`, covering Expected Behaviour cases 6–9. First replace the shared stub at its line 35 — `const CELL = {} as Cell<any>;` — with one that answers a commit, since `acquire` and `register` now call into it:

   ```typescript
   const CELL = { commitEdit() { return this; } } as unknown as Cell<any>;
   ```

   Cases 6–8 use their own per-test stubs that count `commitEdit` calls. Run the file: cases 6–9 must fail. Case 6 passes a cell to `release`, so `npm run typecheck:test` reports an arity error until step 6 lands — expected.
6. **Change `CellEditorPool`** (`packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts`) per `## Internal Structure`: add the private `commitActiveCell`, give `release` its `cell` parameter and identity check, add the commit-and-dispose to `register`, and add the `commitActiveCell` call to `acquire`. Update the JSDoc on all three public methods; in particular `register`'s `@remarks` must say the cached editor is disposed, and `dispose`'s JSDoc (`:111-119`) must drop the "so nothing else ever reaches it" clause, which `register` now falsifies.
7. **Update the one caller:** `packages/lib/src/typescript/lib/component/table/cell/Cell.ts:730` becomes `this._editorPool?.release(this);`.
8. Checkpoint: `grep -rn '\.release()' packages/lib/src` — expect zero matches (the only argument-less `release()` in `src/` was the one step 7 changed).
9. Run `npm run typecheck && npm run typecheck:test && npx vitest run` from `packages/lib`.
10. **Update the prose doc:** `packages/lib/docs/components/TableInternals.md`, the "Shared editor pool" section (`:63-69`) — add the ownership rule (one cell owns the editor at a time; the pool commits that cell's edit before handing the editor to another cell or dropping it, and the body commits it before rebinding its row).
11. Run `npm run docs:api` from `packages/lib` — it must finish with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` |
| Create | `packages/lib/tests/component/table/EditAcrossRowRebind.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/CellEditorPool.test.ts` |
| Modify | `packages/lib/docs/components/TableInternals.md` |

---

## Expected Behaviour

Cases 1–9 are unit-testable against the offline DOM harness. Cases 10–12 need a real browser and are manual-verify.

**1 — A scroll that rebinds the editing row commits onto the record the edit was opened against.** *(unit)*
4,000-record table, editor opened on pool row 0 over record `R1`, editor value set to `TYPED`, then `setScrollY(rowHeight * 40)`. After the scroll: `cell.isEditing() === false`; `R1.get('reference') === 'TYPED'`; the record the slot now shows still holds its own value.

**2 — A settled re-render leaves an open editor alone.** *(unit)*
With an editor open and its value set, re-render without scrolling or touching the store: the editor is still open and still holds the typed text; no record has changed.

**3 — An unrelated store event leaves an open editor alone.** *(unit)*
With an editor open on the row bound to `R1`, change a record far outside the window (`store.getRecords()[3999].set('amount', 12345)`). Afterwards: `cell.isEditing() === true`; `R1` is untouched. A later `cell.commitEdit()` puts the typed value on `R1`.

**4 — The column axis still commits onto the right record.** *(unit)*
The table must have enough columns to overflow its width horizontally, otherwise the column window never moves and the case is vacuous. With an editor open, scroll the edited column out of the window: the edit is committed onto the record its row is bound to, and `cell.isEditing() === false`.

**5 — `TreeTable` behaves identically to `Table`.** *(unit)*
Case 1 repeated against a `TreeTable`/`TreeBody` over an expanded tree.

**6 — `release` from a cell that no longer owns the editor is a no-op.** *(unit)*
`acquire('string', A)`, then `acquire('string', B)`, then `release(A)`: the pool's active cell is still `B`.

**7 — `acquire` for a second cell commits the first.** *(unit)*
`acquire('string', A)`, then `acquire('string', B)`: `A.commitEdit` was called exactly once, and the pool's active cell is `B`. `acquire('string', A)` twice in a row calls `commitEdit` zero times.

**8 — `register` over a cached key disposes the dropped editor exactly once and commits the active cell.** *(unit)*
`acquire('string', A)`, realise the editor's element, then `register('string', …)`: `dispose` was called once on the dropped editor, `A.commitEdit` was called once, and the next `acquire('string', …)` returns a different instance.

**9 — `register` on a key with no cached editor commits nothing and disposes nothing.** *(unit)*
With cell `A` mid-edit under key `"string"`, `register('combo:owner', …)` on a pool that never acquired `combo:owner`: `A.commitEdit` was not called, and the pool's active cell is still `A`.

**10 — Wheel-scrolling a real table mid-edit saves to the edited row.** *(manual)*
Open a cell editor in a scrollable table, type a new value, scroll with the wheel without pressing Enter. The typed value appears on the row that was edited; the editor closes; no other row's value changed.

**11 — The table stays usable after a scroll-driven commit.** *(manual)*
Continuing from case 10: the wheel keeps scrolling, no editor is left floating over another row, and clicking another cell opens an editor normally.

**12 — A rotated-view toggle mid-edit commits and leaks nothing.** *(manual)*
With a combo cell being edited, switch the table's display mode (`Table.setDisplayMode`). The edit commits onto the record it was opened against, and the dropped `ComboEditor`'s element is gone from the document.

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` — both clean.
- `npx vitest run tests/component/table` — the new `EditAcrossRowRebind.test.ts` and the amended `CellEditorPool.test.ts` pass, and `CellEditorPool.styleRuleDisposal.test.ts`, `Cell.test.ts`, `Body.test.ts`, `TreeBody.test.ts`, `RotatedView.test.ts`, `BindViewRenderEconomy.test.ts` and `ScrollRebindLayoutEconomy.test.ts` still pass.
- `npx vitest run` — full suite green.
- `grep -rn '\.release()' packages/lib/src` — zero matches.
- `npm run docs:api` — zero warnings.
- Manual cases 10–12, driven against the library's own dev server (`npm run dev` from `packages/lib`) on a table screen with more rows than fit the viewport and at least one combo column.

---

## Documentation Impact

- `packages/lib/docs/components/TableInternals.md`, "Shared editor pool" (`:63-69`) — the prose describes the pool handing one editor around; it gains the ownership rule stated in step 10.
- `packages/lib/docs/api/component/table/classes/CellEditorPool.md` is TypeDoc output; `npm run docs:api` regenerates it from the changed JSDoc and the new `release(cell)` signature.
- `packages/lib/docs/recipes/custom-cell.md:130` tells custom-cell authors to register a factory *before* the first edit. That advice stays correct and needs no change.
- `packages/lib/llms.txt` indexes `Table`, not `CellEditorPool`, so it is unaffected.

---

## Potential Challenges

- **A commit inside the render pass re-enters the body.** `cell.commitEdit()` reaches `store.notifyRecordChanged`, which fires `datachange`, which calls `Body.onStoreChange` → `renderWindow()`. The nested call is dropped by the `_reconciling` flag ([`Body.ts:1149-1151`](packages/lib/src/typescript/lib/component/table/Body.ts#L1149)), which is already set for the whole of `renderWindowPass`. Nothing further is needed; do not add a second guard.
- **`onStoreChange` blanks `_boundIndices` mid-pass.** The nested store event clears the bound-index cache while the bind loop is running, so slots already visited rebind again on the next pass. Correct, slightly wasteful, and confined to the one pass in which a commit fired.
- **The record list is a snapshot.** `getVisibleRecords()` hands back a copy and `notifyRecordChanged` does not re-apply the store's view, so a mid-pass commit cannot reorder or resize the `records` array the pass is iterating.
- **The existing pool test's cell stub is a bare `{}`.** `register` now calls `commitEdit()` on whichever cell the pool holds, and that file's register tests acquire with the stub first; step 5 gives the stub a `commitEdit` before step 6 lands, so the suite never sees a `TypeError`.
- **Separator rows.** `Row.renderSeparator` retires its cells through `retireCell`, which already commits, and a separator row's `_data` is still the record the edit belongs to. The sweep sees a record mismatch on those rows and scans their cells, finds nothing editing, and moves on.

---

## Critical Files

| File | Why |
|---|---|
| [`component/table/Body.ts:1237-1307`](packages/lib/src/typescript/lib/component/table/Body.ts#L1237) | `renderWindowPass` — the render pass, and the `commitEditsOutsideWindow` call at `:1275` |
| [`component/table/Body.ts:1348-1367`](packages/lib/src/typescript/lib/component/table/Body.ts#L1348) | `commitEditsOutsideWindow` — the column-axis sweep the new one sits beside |
| [`component/table/Body.ts:1390-1473`](packages/lib/src/typescript/lib/component/table/Body.ts#L1390) | `bindAndPositionRows` — the bind loop and the `row.setData` at `:1437` |
| [`component/table/Row.ts:945-947`](packages/lib/src/typescript/lib/component/table/Row.ts#L945) | `retireCell` — the precedent: commit before discarding what the cell shows |
| [`component/table/Row.ts:283-296`](packages/lib/src/typescript/lib/component/table/Row.ts#L283) | `setData` — the rebind, and `commitCellValue` at `:788-801` — the wrong-record write |
| [`component/table/cell/Cell.ts:681-732`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L681) | `commitEdit` / `cancelEdit` / `detachEditor` — the `release` call site is `:730` |
| [`component/table/cell/editor/CellEditorPool.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) | 167 lines; `register:71`, `acquire:86`, `release:107`, `dispose:120` |
| [`component/shared/VirtualRowView.ts:404-419`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L404) | `alignPoolWindow` — why a slot keeps its data index across a scroll |
| [`overlay/Menu.ts:461-489`](packages/lib/src/typescript/lib/overlay/Menu.ts#L461) | `toggleFor` — the library's other shared-resource ownership check |
| `packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts` | The harness shape the new test copies |

---

## Non-Goals

- **Restoring keyboard focus after a scroll-driven commit.** The column-axis sweep does not restore focus either; matching it keeps one behaviour instead of two. Case 11 checks the table stays usable.
- **Committing an edit on a row whose slot is hidden by `hideExcessPoolRows`.** Such a row keeps its record, so a later commit still lands correctly, and the pool's new `acquire` guard commits it as soon as another cell starts editing.
- **Collapsing `StringEditor` / `NumberEditor` onto `TextInputCellEditor`,** or any other editor consolidation (report 22 F22.6, F22.7, F22.13, F22.16). Separate plan; it should land after this one, because this plan changes when an editor is detached.
- **The other `CellEditorPool`-adjacent leaks** — `TreeBody`'s missing `destructor` (F22.9) and `TablePanel`/`TreeTablePanel`'s undisposed spinner (F22.11, F22.14) need their own plan. They share a test shape and an idea — a resource mounted outside the child tree must be released explicitly — that has nothing to do with editor ownership.

---

## Notes

[^precedent]: `Body.commitEditsOutsideWindow`'s own JSDoc names its source — it "mirrors the precedent `Row.setColumnWindow` sets on a column-set change: commit before discarding". Following that pointer leads to `Row.retireCell:945-947`, which is the root statement of the rule in this subsystem. The row axis is the one place the rule was never applied, which is exactly where the data loss is.

[^why-not-wasrebound]: The 28-slice review's synthesis proposed keying the sweep on `wasRebound`. A probe against the current tree shows that trigger is too broad: with an editor open on pool row 0 and a record 3,999 rows away modified, every visited slot reports `wasRebound: true` while the row's own record is unchanged (`{"slots":[{"di":0,"wasRebound":true},{"di":1,"wasRebound":true},{"di":2,"wasRebound":true}],"rowRecordUnchanged":true,"stillEditing":true}`). The cause is `Body.onStoreChange`, which runs `_boundIndices.fill(-1)` before re-rendering, so `wasRebound` is `true` for the whole pool after *any* store event — `load`, `add`, `remove`, `datachange`, `beforesync`, `sync`. Keying on `wasRebound` would close the user's editor whenever a second view, a background sync, or another cell's commit touched the store. Comparing record objects is both narrower and cheaper: in a settled pass and after a plain store event no row changes record, so no cell is scanned at all.

[^sweep-placement]: `alignPoolWindow` is what makes the identity comparison legal: it rotates the pool bookkeeping so slot `i` carries data index `firstRow + i`, which is the index `records[firstRow + i]` reads. Placing the sweep before the loop rather than inline at `row.setData` keeps the pass in one of two states — no row rebound yet, or all commits done — instead of interleaving commits with rebinds. Putting the check inside `Row.setData` was considered and rejected: `Row` has no view of the pass, while `Body` owns the `_reconciling` re-entrancy guard that makes a commit safe here, and the sweep belongs beside the column sweep it repeats.

[^one-guard]: A single guard covering both axes was considered. It cannot be placed: the column sweep runs at `Body.ts:1275`, before `computeVisibleWindow`, because a commit can change what a filtered store returns and the row count has to be re-read afterwards; the row sweep needs `win.firstRow` and the settled pool rotation, both of which only exist after that point. Serving the row axis from the column sweep's position would mean computing the row window from a record list that a commit may invalidate, then computing it again. Two sweeps applying one rule is the smaller change and reads the same way at both call sites.

[^commit-not-cancel]: Cancelling would discard text the user typed, which is the same class of loss the plan exists to fix, just with a different victim. Every commit-before-discard site in the table commits: `Row.retireCell`, `Body.commitEditsOutsideWindow`, and `Cell.setReadOnly`. The review's own acceptance criterion allowed either outcome (`editedRecordReceivedTheValue === true` **or** `cell.isEditing() === false` after the scroll); the precedent decides it.

[^register-dispose]: `CellEditorPool.dispose`'s JSDoc claims a cached editor is "held there for the table's whole lifetime … so nothing else ever reaches it". `register` reaches it — `this._editors.delete(key)` with no `dispose()` — and is reachable from a user control: `Table.setDisplayMode` → `Body.bindViewState` → `registerComboEditors`, one leaked `ComboEditor` with its `ComboBox`, dropdown, theme subscription and per-instance rules per combo column per toggle. Adding the `dispose()` on its own would be worse than the leak, because the dropped editor can be the one a cell is editing in right now; it is safe only once `register` commits the active cell first, which is why it belongs to this plan rather than to the disposal-hygiene plan the slice report filed it under. The commit is gated on a cached editor actually existing for the key, so a consumer registering a factory at setup time triggers nothing. Tracking which key the active cell borrowed, so the commit could be narrowed further, was rejected as a third field for a case where both in-library callers commit every open edit moments later anyway.

[^no-return]: `commitEditsOutsideWindow` returns a boolean because its caller re-reads `getVisibleRecords()` when a commit fired. `commitEditsBeforeRebind` needs no equivalent: `notifyRecordChanged` emits `update` and `datachange` without re-applying the store's view, and `getVisibleRecords()` returns a copy, so the `records` array the pass is iterating cannot change under it.

---

## Implementation Notes

Deviations this run had to make. The design is unchanged; these are notes on
what the tree actually required.

**Case 12 is an automated test, not a manual browser check.** The plan filed
cases 10–12 as manual-verify "on a table screen with more rows than fit the
viewport and at least one combo column". No such screen exists in the dev app:
`MiscPanel`'s combo-column table ("table (column spec)", the `Role` column) has
no display-mode toggle, and `RotatedRecordPanel`, which has the toggle, has no
combo column — so case 12 cannot be driven from the demo surface at all.
It is pinned instead by a new test in
`packages/lib/tests/component/table/CellEditorPool.styleRuleDisposal.test.ts`,
a file the plan's "Files to Create / Modify" table does not list. Writing it
also corrected the case's trigger: `setDisplayMode('rotated')` binds the
two-field *projection's* column configs, so `registerComboEditors` never sees
the source column's `combo:<field>` key on the way in — the cached editor is
dropped on the way back to `'normal'`. The test therefore toggles both ways,
and it fails on the pre-change tree (`dispose` called 0 times).

**Cases 10 and 11 were verified in a real browser**, against `npm run dev` and
the `Misc.` tab's "Show window with wide table (45 columns)!" (400 records):
an editor opened on row 1, text typed, then wheel-scrolled ~90 rows without
pressing Enter. The editor closed, no editor was left floating over the body,
scrolling back to the top showed the typed value on row 1 with rows 2–5
unchanged, and double-clicking another cell opened an editor normally.

**The column-axis fixture pins its column widths.** Step 1's recipe for case 4
— "enough columns to overflow its width horizontally" — is not sufficient by
itself: a `string` column flexes to share the body width however many columns
there are, so twelve columns still measured 48px each inside a 600px body and
the column window never moved. `makeWideTable` gives each column an explicit
`width`, and the case asserts `_colWindow.firstCol > 0` so it can never go
vacuous again.

**Test-file shape.** Case 1 is two `it`s — the commit landing on the edited
record, and every other record staying untouched. Case 5's tree fixture edits a
plain `note` column rather than the tree column and declares
`appendUnlisted: false` over exactly two columns, so the edited cell sits
inside the column window whatever the measured widths come out at. In
`CellEditorPool.test.ts`, `MarkerEditor` moved to module scope: the new
ownership tests need the same stub the existing register-override tests
declare locally, and two copies of it is worse than one shared one.

**Changelog.** The plan's Documentation Impact does not mention
`docs/reference/changelog/next.md`, but every branch here adds an entry. The
two behaviour fixes went under `## Fixed`; `release(cell)`'s new required
argument went under `## Changed`, since it is a contract change a consumer
calling `release()` directly has to react to.
