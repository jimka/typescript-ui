# Table Row Visibility — Implementation Plan

## Overview

Add a live, consumer-settable predicate that hides rows in a `Table` without touching the store — the mechanism a consuming app needs to build a client-side "quick search" over an already-loaded, editable grid: type in a search box, non-matching rows disappear instantly, no network round trip, and every add/delete/pending-edit keeps working underneath.

The new surface is `Table.setRowVisible(predicate)` in [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts). It forwards to a matching `Body.setRowVisible(predicate)` in [`packages/lib/src/typescript/lib/component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts), which is where the filtering actually happens: inside `Body.getVisibleRecords()` — [`Body.ts:365-367`](../packages/lib/src/typescript/lib/component/table/Body.ts#L365-L367), the exact seam `TreeBody` already uses to substitute its depth-flattened, expansion-aware row list for the store's raw records ([`TreeBody.ts:504-506`](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L504-L506)). Every internal caller that decides which records render, scroll, or receive keyboard focus already goes through `getVisibleRecords()`, so filtering there composes for free with virtual scrolling, sorting, and selection — no other file needs to change.

Two existing precedents shape the design: `Table.setDisplayMode("rotated")` already neutralizes a source-record predicate (`rowReadOnly`) inside its `bindView` re-bind call when the row model no longer matches ([`Table.ts:388-409`](../packages/lib/src/typescript/lib/component/table/Table.ts#L388-L409)) — `setRowVisible` follows the identical pattern. `TreeBody.setExpanded` already shows the shape a live setter takes when it changes which records are visible without a store event: store the new state, invalidate the row-pool's bound-index cache, force a render ([`TreeBody.ts:318-345`](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L318-L345)).

---

## Architecture Decisions

### Filtering lives inside `Body.getVisibleRecords()`, not a new method

`Body.getVisibleRecords()` is already the documented subclassing seam for "the rows actually rendered are a filtered view of the store's records" ([`Body.ts:352-364`](../packages/lib/src/typescript/lib/component/table/Body.ts#L352-L364)). Every internal consumer — the render pass, click dispatch, keyboard nav, scroll-into-view, focus/active-descendant tracking — already calls it instead of reading the store directly. Filtering there means every one of those call sites picks up row-visibility with no separate wiring.[^why-not-store-filter]

### Every existing rebind trigger already re-applies the predicate

`ColumnSpec.rowReadOnly`'s own doc comment ([`ColumnConfig.ts:290-311`](../packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L290-L311)) lists three triggers that re-consult it: scrolling pulls new records into the window, the store emits `'datachange'`, or columns are hidden/shown. That list is accurate for `rowReadOnly` because its one call site, `applyReadOnlyState`, only runs "once per row whenever that row rebinds *or* its column window changes" ([`Body.ts:1347-1371`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1347-L1371)) — a gated subset of renders.

`_rowVisible` is different: it is read inside `getVisibleRecords()`, which every `renderWindowPass()` calls unconditionally at the top, before any row-level gating exists ([`Body.ts:882-883`](../packages/lib/src/typescript/lib/component/table/Body.ts#L882-L883)). So the predicate is re-applied on every trigger that calls `renderWindow()` at all — a strict superset of `rowReadOnly`'s list:

| Trigger | Hooks through | Also re-applies `rowReadOnly` today? |
| --- | --- | --- |
| Vertical/horizontal scroll tick | `VirtualScroller` → `Body.onScrollerTick()` → `renderWindow()` ([`Body.ts:753`](../packages/lib/src/typescript/lib/component/table/Body.ts#L753)) | Only if the tick also rebinds a row or shifts the column window |
| Store `'load'` / `'add'` / `'remove'` / `'datachange'` / `'beforesync'` / `'sync'` | `Body.bindStore()` ([`Body.ts:325-336`](../packages/lib/src/typescript/lib/component/table/Body.ts#L325-L336)) → `onStoreChange()` → `renderWindow()` | Yes — `'datachange'` is on `rowReadOnly`'s own list |
| Sort / clear sort | `AbstractStore.sort()` / `clearSort()` also fire `'datachange'` ([`AbstractStore.ts:1428-1429,1477-1478`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1428-L1429)) — same path as above | Yes, via `'datachange'` |
| Column show/hide | `Table.setColumnVisible()` / `resetColumns()` → `Body.setHiddenColumns()` ([`Body.ts:537-553`](../packages/lib/src/typescript/lib/component/table/Body.ts#L537-L553)) → `renderWindow()` | Yes — explicitly on `rowReadOnly`'s list |
| Column list/config change (`bindView`, `setStore`) | `Body.setColumns()` / `setColumnConfigs()` ([`Body.ts:563-569,596-603`](../packages/lib/src/typescript/lib/component/table/Body.ts#L563-L569)) → `renderWindow()` | Yes |
| Column resize / any layout pass (incl. a container resize) | `layout/Table.doLayout()` → `body.renderWindow(availableWidth, columnWidths)` ([`layout/Table.ts:305`](../packages/lib/src/typescript/lib/layout/Table.ts#L305)) | Only if that pass also rebinds a row or shifts the column window |
| Keyboard row/column navigation | `Body.onKeyDown()` ([`Body.ts:1592`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1592)) → `renderWindow()` | Only if it also rebinds a row or shifts the column window |
| `setRowVisible(predicate)` itself | `Body.setRowVisible()` → `invalidateRowBindings()` + `renderWindow()` | N/A — `rowReadOnly` has no live setter |

Every row in this table already exists; none of it is new wiring. The consuming app only ever needs to call `setRowVisible` again when the predicate itself changes (e.g. a new search string) — every other row above is already covered by code this plan does not touch.

### `Body` owns the predicate; `Table` mirrors it for the rotated round trip

`Body` gets a new private field `_rowVisible` and the filtering logic. `Table` also keeps its own `_rowVisible` field — not just a pass-through — because unlike `rowReadOnly` (always re-read fresh from `_spec` on every `bindView` call), `setRowVisible`'s value is live and has no spec source: `Table` must remember the last predicate the consumer supplied so it can restore it after a round trip through rotated mode, where it is temporarily neutralized (see below).

### Rotated mode neutralizes the predicate exactly like `rowReadOnly`

`setDisplayMode("rotated")` already hardcodes `rowReadOnly: () => true` in its `bindView` call in place of the spec's predicate, because the rotated projection's rows are one per source *field* of a single displayed record, not one per source record ([`Table.ts:401`](../packages/lib/src/typescript/lib/component/table/Table.ts#L401)) — a predicate written against source records cannot apply. `setRowVisible`'s predicate has the identical problem, so `bindView` gets a new `rowVisible` parameter, hardcoded to `null` on the rotated call and set to `this._rowVisible` on the normal-mode call. `Table.setRowVisible` itself still records the predicate while rotated (so the value survives the round trip) but skips forwarding it to `Body` until back in normal mode.

### `TreeTable` / `TreeBody`: explicitly out of scope, not silently broken

`TreeTable extends Table` and inherits `setRowVisible` unchanged — calling it on a `TreeTable` stores the predicate but has **no rendering effect**, because `TreeBody.getVisibleRecords()` fully overrides the base method and returns `this._flatRows.map(f => f.record)` without ever calling `super.getVisibleRecords()` ([`TreeBody.ts:504-506`](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L504-L506)) — it simply never reads `_rowVisible` at all. This is deliberate, not an oversight: filtering a flat, depth-aware row list by a simple per-record test needs to decide what happens to a hidden record's children — hide them too, re-parent them, or leave them in place — and `TreeTable.md`'s own docs already show this is a real design question for the store's own filter, not a trivial one[^tree-filtering-precedent]. Making row-visibility handle it sensibly is a different algorithm and a different feature; it is not requested here and is declared a non-goal (see `## Non-Goals`). The asymmetry is documented on both `Body.setRowVisible`'s JSDoc and in a new `TreeTable.md` non-goal bullet, mirroring how `setColumnVisible`'s rotated no-op is documented rather than left to be discovered.

### Virtualization, sort, and selection need no other change

- **Virtualization.** `VirtualRowView`'s window/pool-size math (`computeVisibleWindow`, `computePoolTarget`, [`VirtualRowView.ts:263-296`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L263-L296)) takes `totalRows` as a plain parameter — it never reads the store itself. `Body.renderWindowPass` already derives `totalRows` from `records.length` where `records = this.getVisibleRecords()` ([`Body.ts:882-883`](../packages/lib/src/typescript/lib/component/table/Body.ts#L882-L883)), and the same pass hands the (now smaller) `totalHeight` to `scroller.layoutScrollbars` ([`Body.ts:936`](../packages/lib/src/typescript/lib/component/table/Body.ts#L936)) — so the vertical scrollbar shrinks to match the filtered set automatically. This is already proven by `TreeBody`, whose flattened count is routinely smaller than the store's, through the identical code path.
- **Sort.** The store sorts (and applies its own server-side filters, if any) before `getRecords()` returns anything ([`AbstractStore.ts:1821-1850`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1821-L1850)); `Body.getVisibleRecords()` reads that already-sorted array and filters it again on top, every render pass, with no caching. A row that is currently hidden and would sort into a different position if shown needs no special handling: the next render pass simply reads the current sorted array fresh and re-filters it, so the row appears whenever the predicate next admits it, already in the store's current sort position.
- **Selection.** Hiding a row must not affect `getSelectedRecords()`, and it doesn't — nothing in this change touches `_selectedRecords`. The two rendering hooks that resolve the *anchor* record's position — `_updateFocusStyle` and `_updateActiveDescendant` ([`Body.ts:1500-1580`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1500-L1580)) — look up `getVisibleRecords().indexOf(this._anchorRecord)`, which returns `-1` for a hidden anchor; both are array-bounds-safe and never throw. There is a pre-existing, shared-with-`TreeBody` cosmetic quirk here, tracked as a non-goal — see `## Potential Challenges`.

---

## Public API

```typescript
// component/table/Table.ts
class Table extends Component<TableOptions> {
    setRowVisible(predicate: ((record: ModelRecord) => boolean) | null): this;
}

// component/table/Body.ts
class Body extends VirtualRowView<Row> {
    setRowVisible(predicate: ((record: ModelRecord) => boolean) | null): this;
}
```

No new exported types. `predicate` reuses the existing `(record: ModelRecord) => boolean` shape already used by `ColumnSpec.rowReadOnly` and `ColumnConfig.cellReadOnly` ([`ColumnConfig.ts:137,312`](../packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L137)).

Backing fields:

| Class | Field | Setter | Default |
| --- | --- | --- | --- |
| `Table` | `private _rowVisible: ((record: ModelRecord) => boolean) \| null` | `setRowVisible` | `null` |
| `Body` | `private _rowVisible: ((record: ModelRecord) => boolean) \| null` | `setRowVisible` | `null` |

Neither field is a `ComponentOptions`/spec field — `setRowVisible` is a pure runtime setter with no construction-time equivalent, matching `Table.setExportMenuEnabled` (also a live boolean toggle with no options-bag field and no paired getter). No `getRowVisible()` getter is added, for the same reason `setExportMenuEnabled` has none: nothing in the required contract calls for reading the predicate back, and this codebase does not pair every live setter with a getter.

---

## Internal Structure

`Body.getVisibleRecords()` — filtering added to the base default only; `TreeBody`'s override is untouched and therefore unaffected:

```typescript
protected getVisibleRecords(): ModelRecord[] {
    const records = this._store.getRecords();

    return this._rowVisible ? records.filter(this._rowVisible) : records;
}
```

`Body.setRowVisible()` — mirrors `TreeBody.setExpanded`'s shape (store state, invalidate bound indices, force a render), not `Body.setRowReadOnly`'s shape (store only, applied lazily on the next natural rebind) — because nothing else forces a render when only the predicate changes:

```typescript
setRowVisible(predicate: ((record: ModelRecord) => boolean) | null): this {
    this._rowVisible = predicate;
    this.invalidateRowBindings();
    this.renderWindow();

    return this;
}
```

`invalidateRowBindings()` (already `protected` on `Body`, [`Body.ts:452-454`](../packages/lib/src/typescript/lib/component/table/Body.ts#L452-L454)) resets every pool slot's cached data index to `-1`. This is required, not optional: a pool slot's `wasRebound` check compares the new data index to the previous one at the *same slot* ([`Body.ts:1044`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1044)); when the predicate changes, the record now at visible-index `N` is generally a different record than before, even though `N` itself is unchanged, so the stale cache would skip the rebind and leave the old record's cells on screen.

`Table.bindView()` gains a sixth parameter, `rowVisible`, forwarded to the body right next to `rowReadOnly`:

```typescript
private bindView(
    store:       AbstractStore,
    columns:     Column[],
    configs:     Map<string, ColumnConfig>,
    hidden:      Set<string>,
    rowReadOnly: ((record: ModelRecord) => boolean) | null,
    rowVisible:  ((record: ModelRecord) => boolean) | null,
): void {
    // ...unchanged body...
    this._body.setRowReadOnly(rowReadOnly);
    this._body.setRowVisible(rowVisible);
    this._body.setStore(store);
    // ...unchanged tail...
}
```

`Table.setRowVisible()`:

```typescript
setRowVisible(predicate: ((record: ModelRecord) => boolean) | null): this {
    this._rowVisible = predicate;

    if (this._displayMode === "normal") {
        this._body.setRowVisible(predicate);
    }

    return this;
}
```

`setDisplayMode`'s two `bindView` call sites each gain the new argument:

```typescript
// entering "rotated" — hardcoded null, mirrors the existing () => true for rowReadOnly
this.bindView(rotatedStore, this._rotatedColumns, this._rotatedConfigs, new Set(), () => true, null);

// returning to "normal" — restores whatever setRowVisible last set, even if that
// happened while rotated
this.bindView(this._store, this.getSourceColumns(), this._columnConfigs, this.getEffectiveHiddenSet(), this._spec?.rowReadOnly ?? null, this._rowVisible);
```

No change is needed in `Table.setStore()`: it does not call `bindView` and does not currently re-apply `rowReadOnly` either (whatever was last set on `_body` simply carries over onto the new store) — `_rowVisible` follows the same, already-established precedent and needs no new code there.

---

## Ordered Implementation Steps

1. **`Body.ts`** — add `private _rowVisible: ((record: ModelRecord) => boolean) | null = null;` next to the existing `_rowReadOnly` field ([`Body.ts:206`](../packages/lib/src/typescript/lib/component/table/Body.ts#L206)).
2. **`Body.ts`** — add the `setRowVisible()` method directly after `setRowReadOnly()` ([`Body.ts:583-587`](../packages/lib/src/typescript/lib/component/table/Body.ts#L583-L587)), per `## Internal Structure` above, with a full JSDoc matching the style of the surrounding setters (mention: called for every loaded record on every render pass; must be O(1) and pure, same contract as `ColumnSpec.rowReadOnly`; forwarded from `Table.setRowVisible`; has no effect on `TreeBody` — link to the `TreeTable` docs non-goal).
3. **`Body.ts`** — update `getVisibleRecords()` ([`Body.ts:365-367`](../packages/lib/src/typescript/lib/component/table/Body.ts#L365-L367)) to filter through `_rowVisible`, per `## Internal Structure`. Extend its existing doc comment (`Body.ts:352-364`) with one sentence noting the default now also applies `_rowVisible`, and that a subclass overriding this method (i.e. `TreeBody`) opts out of that filtering unless it explicitly composes it.
4. **`TreeBody.ts`** — extend the doc comment on the `getVisibleRecords()` override ([`TreeBody.ts:498-503`](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L498-L503)) with a sentence stating this override does not consult `_rowVisible`, and why (a flat per-record filter can't decide what to do with a hidden parent's children without the parent/child index this method has no access to), cross-referencing the `TreeTable.md` non-goal.
5. **`Table.ts`** — add `private _rowVisible: ((record: ModelRecord) => boolean) | null = null;` near `_displayMode` / `_rotatedRecord` ([`Table.ts:172-173`](../packages/lib/src/typescript/lib/component/table/Table.ts#L172-L173)).
6. **`Table.ts`** — change `bindView`'s signature and body per `## Internal Structure` ([`Table.ts:1123-1160`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1123-L1160)); update its doc comment's `@param` list to describe `rowVisible`.
7. **`Table.ts`** — update both `bindView` call sites inside `setDisplayMode` ([`Table.ts:401`](../packages/lib/src/typescript/lib/component/table/Table.ts#L401) and [`Table.ts:404`](../packages/lib/src/typescript/lib/component/table/Table.ts#L404)) to pass the sixth argument, per `## Internal Structure`.
8. **`Table.ts`** — add the public `setRowVisible()` method directly after `setDisplayMode()` ([`Table.ts:409`](../packages/lib/src/typescript/lib/component/table/Table.ts#L409), before `getStore()`), with a full JSDoc per `## Internal Structure`'s comments plus the guarantees from `## Overview` (display-only; never touches `getStore()`'s records, `getSelectedRecords()`, or pending changes; re-applied automatically on scroll / store events / column show-hide; no effect while rotated, but the predicate survives the round trip).
9. Regression check: `grep -n "this.bindView(" packages/lib/src/typescript/lib/component/table/Table.ts` — expect exactly two matches (the call sites; the method definition itself is `private bindView(`, with no `this.` prefix, so it does not match), both now passing six arguments.
10. **`docs/components/Table.md`** — add a `setRowVisible(predicate)` row to the "Common methods" table ([`Table.md:271-281`](../packages/lib/docs/components/Table.md#L271-L281)); add a short new subsection (after "## Common methods" or folded into it) with a quick-search example; add a bullet to "## Rotated record view" ([`Table.md:159-179`](../packages/lib/docs/components/Table.md#L159-L179)) next to the existing `setColumnVisible` no-op bullet stating `setRowVisible` is neutralized the same way and resumes on return to normal.
11. **`docs/components/TreeTable.md`** — add a bullet to "## Non-goals" ([`TreeTable.md:136-141`](../packages/lib/docs/components/TreeTable.md#L136-L141)) stating `setRowVisible` is inherited but has no effect, and why (per `## Architecture Decisions` above).
12. **New test file** `packages/lib/tests/component/table/RowVisibility.test.ts` — write the cases in `## Expected Behaviour` below, mirroring `RotatedView.test.ts`'s header-comment convention (link to this plan) and its `makeStore` / `makeTable` helper style.
13. Run `npm run typecheck`, `npm run test`, and `npm run docs:api` from `packages/lib` (see `## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeBody.ts` (doc comment only) |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/TreeTable.md` |
| Create | `packages/lib/tests/component/table/RowVisibility.test.ts` |

---

## Expected Behaviour

All records visible by default and clearing:

1. Before any `setRowVisible` call, `Body.getVisibleRecords()` returns every store record, in store order — identical to today's behaviour. **Unit-testable.**
2. `table.setRowVisible(null)` after a predicate was active clears filtering; every loaded record renders again. **Unit-testable.**

Filtering itself:

3. `table.setRowVisible(r => String(r.get('name')).includes('a'))` leaves only matching records in `body.getVisibleRecords()`, in the store's existing order. **Unit-testable.**
4. A predicate matching zero records yields `body.getVisibleRecords().length === 0` and no thrown error; `Body`'s window/pool math (`computeVisibleWindow`) produces a zero-size window. **Unit-testable**, mirroring the existing `Body virtual-scroll — computeVisibleWindow` tests in `Body.test.ts`.

Automatic re-application on existing rebind triggers — each of these changes the store or the column set *without* another `setRowVisible` call, and the active predicate must still apply afterward:

5. `store.add(...)` a record that fails the active predicate: it stays hidden. `store.add(...)` a record that passes: it appears. **Unit-testable.**
6. `store.remove(...)` a currently-hidden record: no visible change, no error. **Unit-testable.**
7. Editing a bound record's field in place (`store.notifyRecordChanged` — mirrors what an in-grid edit fires) so it now fails the predicate: the row disappears on the next render pass. **Unit-testable.**
8. `table.setColumnVisible(field, false)` / `(field, true)` while a predicate is active: hidden rows stay hidden after the column toggle — the toggle must not implicitly clear or bypass `_rowVisible`. **Unit-testable.**

Sort ordering — the predicate applies after the store's own sort, never before:

9. Sort the store (`store.sort(...)`), then activate a predicate: `body.getVisibleRecords()` reflects the sorted order with non-matching records removed, not sorted-then-reinserted or reordered relative to the sort. **Unit-testable.**

Display-only guarantee — hiding a row must not touch the store, the selection, or pending edits:

10. Select a record, then hide it via `setRowVisible`: `body.getSelectedRecords()` / `table.getSelectedRecords()` still return it. **Unit-testable.**
11. Hide a record with a dirty (uncommitted) field: `store.hasPendingChanges()` is unaffected by hiding or un-hiding it, and the dirty value survives (calling `setRowVisible(null)` again shows the still-dirty record). **Unit-testable.**
12. Selecting, then hiding, the anchor record and calling into `Body`'s internal `_updateFocusStyle` / `_updateActiveDescendant` paths (reachable via a keyboard-nav or programmatic-selection call while the row is hidden) throws no error. **Unit-testable** (assert no throw; do not assert a specific DOM outline, since the underlying `_boundIndices.indexOf(-1)` collision this exercises is a pre-existing, out-of-scope quirk — see `## Potential Challenges`).

Rotated mode — the predicate is neutralized while rotated and restored afterward:

13. With a predicate active, `table.setDisplayMode("rotated")`: every projection (`field`/`value`) row renders regardless of the predicate. **Unit-testable**, mirrors `RotatedView.test.ts`'s existing "makes setColumnVisible inert while rotated" test.
14. Return to `"normal"` afterward: the same predicate (unchanged) is back in effect with no new `setRowVisible` call. **Unit-testable**, mirrors `RotatedView.test.ts`'s existing "restores the normal view on a round trip" test.
15. Calling `table.setRowVisible(newPredicate)` *while* rotated: no immediate rendering effect (rotated rows are unaffected); returning to `"normal"` picks up `newPredicate`, not whatever was active before the rotated-mode call. **Unit-testable.**

`TreeTable` non-effect (non-goal):

16. `treeTable.setRowVisible(predicate)`: `treeTable.getBody().getVisibleRecords()` (a `TreeBody`) is unchanged by the call — still the full flattened list, regardless of `predicate`. **Unit-testable**, documents the deliberate non-goal.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — `bindView`'s new parameter and both call sites must type-check; expect zero errors.
- `npm run test` — runs the new `RowVisibility.test.ts` plus the full existing suite (`Body.test.ts`, `Table.test.ts`, `RotatedView.test.ts`, `TreeBody.test.ts`) as a regression check that no existing behaviour changed for the `_rowVisible === null` default case.
- `npm run docs:api` — must finish with zero warnings; the new/edited JSDoc on `Table.setRowVisible` and `Body.setRowVisible` must not `{@link}` anything outside the public docs (per `CODE_CONVENTIONS.md`'s doc-link rule).
- `grep -n "this.bindView(" packages/lib/src/typescript/lib/component/table/Table.ts` — expect exactly two matches (the call sites, not the `private bindView(` definition), both six-argument.
- `grep -n "setRowVisible" packages/lib/docs/components/Table.md packages/lib/docs/components/TreeTable.md` — expect at least one match in each (Common methods row + rotated-mode bullet in `Table.md`; the non-goal bullet in `TreeTable.md`).

No manual smoke test is required beyond the unit suite: the feature adds no new DOM structure, styling, or gesture — only a data-level filter inside an already-offline-testable method. A consuming app's own search-box UI (outside this repo) is where an end-to-end/manual check belongs; see `## Non-Goals`.

---

## Documentation Impact

- `Body` and `Table` are both barrel-exported already (referenced via `{@link Body}` / `{@link Table}` throughout the existing public docs) — no new export or barrel change is needed for the two new methods to appear in the generated API docs once `npm run docs:api` runs.
- `docs/components/Table.md`: add a `setRowVisible(predicate)` row to "## Common methods" ([`Table.md:271-281`](../packages/lib/docs/components/Table.md#L271-L281)); add a short example subsection demonstrating a quick-search box wired to `setRowVisible` on every keystroke; add a bullet to "## Rotated record view" ([`Table.md:179`](../packages/lib/docs/components/Table.md#L179)) next to the existing `setColumnVisible` no-op bullet.
- `docs/components/TreeTable.md`: add a bullet to the existing "## Non-goals" section ([`TreeTable.md:136-141`](../packages/lib/docs/components/TreeTable.md#L136-L141)).
- No changelog update — per this project's release convention, version bumps and changelog entries are handled separately from feature work, by hand, at release time.

---

## Potential Challenges

- **Pre-existing "hidden anchor" focus/ARIA quirk, shared with `TreeBody`.** When the selected/anchor record is filtered out, `_updateFocusStyle` / `_updateActiveDescendant`'s `this._boundIndices.indexOf(anchorIdx)` lookup (`anchorIdx === -1`) can coincidentally match an unrelated, currently-hidden (`display: none`) pool slot rather than "not found," because `-1` is also the sentinel `hideExcessPoolRows` writes for unused slots. *Mitigation:* confirmed non-crashing (bounds-safe) and visually inert, since the matched slot is never displayed; this exact condition is already reachable today by collapsing a `TreeBody` ancestor of a selected descendant, so it predates this feature and is not introduced by it. Left unfixed — see `## Non-Goals`.
- **An open cell editor on a row that gets hidden mid-edit.** `Body`'s row-pool rebind path (`bindAndPositionRows` → `Row.setData` → `Cell.setValue`) does not check `Cell.isEditing()` before rebinding a pool slot to a different record — this is the same path an ordinary vertical scroll already uses, and is not specific to `setRowVisible`. *Mitigation:* no new risk beyond what scrolling already carries; the intended consumer pattern (typing into a separate search field, not the grid's own inline editor) makes the overlap rare in practice. Out of scope to fix here.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts) — `getVisibleRecords()` (the seam), `setRowReadOnly()` (the setter this deliberately does *not* mirror), `invalidateRowBindings()`, `renderWindowPass()`.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) — `setDisplayMode()`, `bindView()`, `setColumnVisible()` (the no-op-in-rotated precedent).
- [`packages/lib/src/typescript/lib/component/table/TreeBody.ts`](../packages/lib/src/typescript/lib/component/table/TreeBody.ts) — `getVisibleRecords()` override, `setExpanded()` (the precedent this plan's `Body.setRowVisible` follows).
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `computeVisibleWindow()`, `computePoolTarget()` (confirms no virtualization change is needed).
- [`packages/lib/src/typescript/lib/component/table/ColumnConfig.ts`](../packages/lib/src/typescript/lib/component/table/ColumnConfig.ts) — `rowReadOnly`'s doc comment (the rebind-trigger list this plan confirms and extends).
- [`packages/lib/tests/component/table/RotatedView.test.ts`](../packages/lib/tests/component/table/RotatedView.test.ts) — the test file whose style/helpers the new `RowVisibility.test.ts` mirrors.

---

## Non-Goals

- **Subtree-aware filtering for `TreeTable` / `TreeBody`.** Naively filtering `TreeBody`'s already-flattened row list by a per-record test would leave a child row referencing a parent no longer in the rendered list; making that behave sensibly (e.g. keep a matching descendant's ancestor chain visible, or drop whole subtrees) needs the same kind of index-aware pass `TreeBody.rebuildIndex()` already does for the store's own filter, and is a different, larger feature with no requester today. `setRowVisible` is inherited by `TreeTable` but is a documented no-op there.
- **Fixing the pre-existing hidden-anchor focus/ARIA quirk** described in `## Potential Challenges`. It predates this feature (already reachable via `TreeBody` collapse) and produces no visible defect.
- **Fixing open-editor-vs-rebind interaction** described in `## Potential Challenges`. Pre-existing, shared with ordinary scrolling, not introduced by this feature.
- **A `getRowVisible()` getter.** Not requested; this codebase does not pair every live setter with a getter (`setExportMenuEnabled` has none either).
- **Updating the interactive docs-app demo panels** with a live search-box example. The consuming app (a separate project) owns the actual search UI; this plan only adds the primitive it needs.
- **A changelog entry or version bump.** Handled separately, by hand, at release time per this project's convention.

---

## Notes

[^why-not-store-filter]: `AbstractStore` already has its own `filter()` / `filterBy()` ([`AbstractStore.ts:1496,1513`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1496)), but it is the wrong mechanism for a display-only, no-network-round-trip quick search: both call `applyFilterChange()` ([`AbstractStore.ts:1526-1542`](../packages/lib/src/typescript/lib/data/AbstractStore.ts#L1526-L1542)), which rebuilds the view via `applyView()` — so `getRecords()` itself changes, meaning the store's own view of "what records exist" would no longer match what is actually loaded; and when `remoteFilter` is enabled, `applyFilterChange` also resets to page 1 and calls `this.load()` — a network round trip on every keystroke, exactly what a client-side quick search needs to avoid. `Body.getVisibleRecords()` filtering on top of (never inside) the store's own view avoids both.

[^tree-filtering-precedent]: `docs/components/TreeTable.md`'s existing "## Filtering" section documents what the store's own `filter()` already has to account for on a tree: "A filter that drops a parent record drops its entire subtree from the flat view... Orphan children whose parent id is filtered out are treated as roots and render at depth 0." That behaviour comes from `TreeBody.rebuildIndex()` walking the parent/child index specifically. A bare `setRowVisible` predicate has no access to that index at all — `TreeBody.getVisibleRecords()` never calls it — so making row-visibility behave sensibly on a tree means writing an equivalent index-aware pass from scratch, not a small tweak to the flat-list filter.
