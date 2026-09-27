---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/data/AbstractStore.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Table body visible-records memo and required-column guard — Implementation Plan

## Overview

Two independent pieces of repeated work in the table body are removed. Both were measured on the QA app's `table-rows` panel, and for both the measurement shows **a real reduction in work with no change in frame time** — the standing rule set on 2026-09-26 says such a change still ships unless it costs considerable code complexity ([`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md:896`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L896)). Neither part claims a render-time improvement, and the record does not support one.[^flat-clock]

**Part one.** [`Body.getVisibleRecords`](packages/lib/src/typescript/lib/component/table/Body.ts#L502) calls `this._store.getRecords()`, which is `return this._records.slice()` ([`data/AbstractStore.ts:653`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L653)). Every call therefore copies the whole view, even when no row filter is set. Measured: six calls per keyboard-navigation unit and two per update unit, each driving one `getRecords` — about 60,000 element copies per unit at 10,000 rows. `AbstractStore` gains an `@internal` counter that is bumped whenever it replaces its view, and `Body` keeps one copy of the view beside the counter's value, re-copying only when the two stop matching.

**Part two.** [`Body.applyRequiredEmptyState`](packages/lib/src/typescript/lib/component/table/Body.ts#L2498) runs once per rendered row from [`:1464`](packages/lib/src/typescript/lib/component/table/Body.ts#L1464) and walks every cell of that row doing a `_columnConfigs` lookup, an optional `requiredPredicate` call, a `record.get` and a `setRequiredEmpty`. Whether *any* column asks for the required-empty outline is a property of the column configuration, not of the record, so `Body` keeps a flag recomputed at each column-config write and skips the whole loop while it is false. Measured: about 107 skippable calls per unit, roughly 1,300 cell iterations.

Both parts change `component/table/Body.ts`; part one also changes `data/AbstractStore.ts`. No consumer-facing signature changes. Line numbers are as of `master` at `6db01b15`.

---

## Architecture Decisions

### Both reductions ship as one plan, in two commits

One plan, because both parts edit the same class, rest on the same standing rule, and are verified on the same surface with the same test files; two code commits, because they are independent functionality.[^one-plan]

### The memo is keyed on a store-side view generation

`AbstractStore` gains a private counter bumped every time it replaces `_records`, readable through an `@internal` `getViewGeneration()`. `Body` stashes that number beside its copy of the view and re-copies when the number moves. This is the device [`Util.textMetricsGeneration()`](packages/lib/src/typescript/lib/core/Util.ts#L304) already gives `Text`, and the shape [`size-hint-per-pass-memo`](plans/implemented/size-hint-per-pass-memo.md) ships library-wide.[^why-generation]

The counter is exactly as sharp as the record array's own identity, because **`_records` is only ever replaced, never mutated in place**: the only two assignments are [`applyViewInProcess`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1964) (`this._records = view`, where `view` always starts life as `this._allRecords.slice()`) and the worker path's [`.then`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L2072) (`indices.map(...)`). Every `push` / `splice` in the file is on `_allRecords`, which is a different array and is never aliased to `_records`.[^no-in-place]

Both assignments move into one private `setRecordView(view)` that assigns and bumps, so a third assignment cannot be added without the bump.

Worked cases; every row starts from a store counter of 4 and a body stash of 4, and shows the state at the moment of the read:

| Moment | Store counter | Body's stash | Result |
|---|---|---|---|
| A keyboard unit's second, third, … `getVisibleRecords()` | 4 | 4 | **served from the copy** |
| `store.add(record)` (below the worker threshold) | 5 | 4 | re-copied, stash becomes 5 |
| `store.setFilter(...)` resolving in process | 5 | 4 | re-copied, stash becomes 5 |
| An in-cell edit — `notifyRecordChanged`, no view rebuild | 4 | 4 | served from the copy; the records themselves carry the new values |
| `store.add(record)` above the worker threshold, before the worker answers | 4 | 4 | served from the copy — the store's own view has not changed yet either |
| `body.setStore(otherStore)`, where the new store also reports 4 | 4 | **−1** | re-copied: `rebindStore` resets the stash |

### Only the store's view is memoised; a row filter still re-runs on every call

The memo covers `getRecords()`'s copy. When [`_rowVisible`](packages/lib/src/typescript/lib/component/table/Body.ts#L296) is set, `getVisibleRecords` still runs `.filter(this._rowVisible)` over the memoised copy on every call, exactly as today.

This is a correctness requirement, not a scoping choice. A row filter's answer depends on the *contents* of a record, and an in-cell edit changes a record's contents without replacing the store's view — `notifyRecordChanged` emits `'update'` and `'datachange'` and never calls `applyView()`. [`Table.setRowVisible`](packages/lib/src/typescript/lib/component/table/Table.ts#L552) documents that the predicate is re-applied on a store `'datachange'`, and [`renderWindowPass`](packages/lib/src/typescript/lib/component/table/Body.ts#L1235) depends on a *mid-pass* re-evaluation after `commitEditsOutsideWindow` commits an edit. Memoising the filtered result on array identity would break both.[^filtered-stale]

What the filtered case would add if it were memoised is recorded as a non-goal and a footnote; it needs the surface [`plans/table-row-filter-panel.md`](plans/table-row-filter-panel.md) adds before anyone can price it.[^filtered-cost]

### `getVisibleRecords` hands out a shared array, and says so

With the memo in place, two unfiltered calls return the **same array instance**. `getVisibleRecords` is a `protected` subclassing seam, so its JSDoc gains the same "do not mutate the returned array" wording [`getColumnConfigs`](packages/lib/src/typescript/lib/component/table/Body.ts#L649) and [`getRowPool`](packages/lib/src/typescript/lib/component/table/Body.ts#L665) already carry. No library call site mutates it.[^no-mutation]

### The required-column flag is recomputed at each column-config write, and clears the outline when it falls to false

`Body` gains `_anyColumnRequired`, recomputed from `_columnConfigs` at both of its write sites — [`setColumnConfigs`](packages/lib/src/typescript/lib/component/table/Body.ts#L828) and [`bindViewState`](packages/lib/src/typescript/lib/component/table/Body.ts#L990). While it is false, `applyRequiredEmptyState` returns immediately.

A config change that drops the last `required` column would otherwise strand an outline: `syncPoolCells` marks a row's column fields dirty but builds no cells, so a cell that keeps its column keeps its `.requiredEmpty` state. So the recompute also clears every pooled cell's required-empty state whenever the new flag is false. `Cell.setRequiredEmpty` has an equality guard ([`cell/Cell.ts:478`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L478)), so that sweep costs one comparison per cell when no cell was outlined.[^clear-sweep]

Treating "does any column ask for this" as fixed between config writes matches what the library already does one layer up: [`Column`](packages/lib/src/typescript/lib/component/table/Column.ts#L58) caches `required` at construction and the header's asterisk reads that cached value ([`Header.ts:1015`](packages/lib/src/typescript/lib/component/table/Header.ts#L1015)), so mutating a `ColumnConfig` object in place after construction never reached the header either.[^static-required]

| `_columnConfigs` holds | `_anyColumnRequired` | `applyRequiredEmptyState` |
|---|---|---|
| nothing (the no-spec default) | `false` | returns at once |
| `{ field: "a" }`, `{ field: "b" }` | `false` | returns at once |
| `{ field: "a", required: false }` | `false` | returns at once |
| `{ field: "a", required: true }` | `true` | full per-cell loop |
| `{ field: "a", requiredPredicate: r => false }` | `true` | full per-cell loop |

---

## Public API

One new member, `@internal`, on `AbstractStore` — `typedoc.json` sets `excludeInternal`, so it renders on no page:

```ts
class AbstractStore {
    /** @internal */
    getViewGeneration(): number;
}
```

Everything else added by this plan is `private`.

---

## Internal Structure

### `data/AbstractStore.ts`

New field beside `_records` at [`:177`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L177):

```ts
// Bumped once every time the filtered/sorted view is replaced. A caller that
// stashed this value beside its own copy of the view can tell, without holding
// a store subscription, whether that copy is still current. Mirrors the
// counter `Util.textMetricsGeneration()` gives `Text`.
private _viewGeneration: number = 0;
```

The single assignment point, private, placed beside `applyViewInProcess`:

```ts
/**
 * Replaces the filtered/sorted view and bumps the view generation.
 *
 * @param view - The newly built view; becomes `_records` verbatim.
 *
 * @remarks The only place `_records` is assigned, so no rebuild can land
 * without the generation moving. Bumping for a rebuild that happens to
 * produce an equal view costs a caller one re-copy and is never wrong.
 */
private setRecordView(view: ModelRecord[]): void {
    this._records = view;
    this._viewGeneration++;
}
```

The reader, placed next to `getRecords()`:

```ts
/**
 * Returns a counter bumped once every time this store rebuilds its
 * filtered/sorted view.
 *
 * @returns The current view generation.
 *
 * @internal Framework wiring; stashed by a view that caches the result of
 *   `getRecords()` so it can tell whether its copy is still current.
 */
getViewGeneration(): number {
    return this._viewGeneration;
}
```

### `component/table/Body.ts`

New fields in the field block at [`:291-296`](packages/lib/src/typescript/lib/component/table/Body.ts#L291):

```ts
// The store's view as `getRecords()` last copied it, together with the store's
// view generation at that moment. `-1` is a generation no store reports, so the
// first read — and the first read after a store swap — always re-copies.
// Framework-managed bookkeeping: no `BodyOptions` field, no public setter.
private _storeView          : ModelRecord[] = [];
private _storeViewGeneration: number        = -1;
// Whether any column config carries `required` or a `requiredPredicate`.
// Recomputed at every `_columnConfigs` write by `refreshRequiredColumnFlag`.
private _anyColumnRequired  : boolean       = false;
```

The memo and the rewritten seam:

```ts
/**
 * Returns the store's filtered/sorted view, re-copied only when the store
 * has rebuilt it since the last call.
 *
 * @returns The store's view. Do not mutate — the same array is served to
 *   every caller until the store rebuilds its view.
 */
private getStoreView(): ModelRecord[] {
    const generation = this._store.getViewGeneration();

    if (this._storeViewGeneration !== generation) {
        this._storeView           = this._store.getRecords();
        this._storeViewGeneration = generation;
    }

    return this._storeView;
}

protected getVisibleRecords(): ModelRecord[] {
    const records = this.getStoreView();

    return this._rowVisible ? records.filter(this._rowVisible) : records;
}
```

The required-column flag:

```ts
/**
 * Recomputes {@link _anyColumnRequired} from the current `_columnConfigs`
 * and, when nothing is required any more, clears every pooled cell's
 * required-empty state once.
 *
 * @remarks Called from both `_columnConfigs` write sites. The clearing sweep
 * is what makes {@link applyRequiredEmptyState}'s early return safe: a cell
 * that keeps its column across a config change also keeps its
 * `.requiredEmpty` state, and the skipped loop would never clear it.
 */
private refreshRequiredColumnFlag(): void {
    let anyRequired = false;

    for (const config of this._columnConfigs.values()) {
        if (config.required === true || config.requiredPredicate !== undefined) {
            anyRequired = true;
            break;
        }
    }

    this._anyColumnRequired = anyRequired;

    if (anyRequired) {
        return;
    }

    for (const row of this._rowPool) {
        for (const cell of row.getComponents() as Cell<any>[]) {
            cell.setRequiredEmpty(false);
        }
    }
}
```

The guard, as the first statement of `applyRequiredEmptyState`:

```ts
if (!this._anyColumnRequired) {
    return;
}
```

---

## Ordered Implementation Steps

1. **`data/AbstractStore.ts` — add the counter.** Declare `private _viewGeneration: number = 0;` beside `_records` at `:177`. Add the private `setRecordView(view)` from `## Internal Structure` immediately above `applyViewInProcess` (`:1943`).
2. **`data/AbstractStore.ts` — route both assignments through it.** Replace `this._records = view;` at `:1964` with `this.setRecordView(view);`, and `this._records = indices.map(i => this._allRecords[i]);` at `:2072` with `this.setRecordView(indices.map(i => this._allRecords[i]));`.
   Check: `grep -n 'this\._records = ' packages/lib/src/typescript/lib/data/AbstractStore.ts` — expect exactly one match, inside `setRecordView`.
3. **`data/AbstractStore.ts` — add the reader.** Add `getViewGeneration()` from `## Internal Structure` directly after `getRecords()` (`:652-654`), with the `@internal` tag.
4. **`packages/lib/src/typescript/lib/component/table/Body.ts` — add the memo fields.** Add `_storeView` and `_storeViewGeneration` from `## Internal Structure` to the field block after `_rowVisible` (`:296`) — not `_anyColumnRequired`, which step 8 adds. Plain initializers are correct here: no `Body` setter reachable from `applyOptions` writes either field, so the `declare` rule in `CODE_CONVENTIONS.md` does not apply.
5. **`Body.ts` — add `getStoreView()` and rewrite `getVisibleRecords`.** Insert `getStoreView()` immediately above `getVisibleRecords` (`:502`) and replace the method body with the two lines from `## Internal Structure`. Extend the existing JSDoc's `@returns` to say the array must not be mutated, and add a `@remarks` sentence saying the store's view is re-copied only when the store rebuilds it, while a row filter still re-runs on every call.
   Check: `grep -n '_store.getRecords()' packages/lib/src/typescript/lib/component/table/Body.ts` — expect zero matches.
6. **`Body.ts` — reset the stash on a store swap.** In `rebindStore` (`:948-954`), after `this._store = store;`, add `this._storeViewGeneration = -1;` with a one-line comment saying two stores can report the same generation, so the stash cannot survive a swap.
7. **Commit part one.** One code commit covering steps 1–6.
8. **`Body.ts` — add the required-column flag.** Add `_anyColumnRequired` to the field block beside the two memo fields, and `refreshRequiredColumnFlag()` from `## Internal Structure` immediately above `applyRequiredEmptyState` (`:2498`).
9. **`Body.ts` — call it at both config-write sites.** In `setColumnConfigs` (`:828`), add `this.refreshRequiredColumnFlag();` on the line after `this._columnConfigs = configs;`. In `bindViewState` (`:990`), add the same call on the line after `this._columnConfigs = state.columnConfigs;`.
   Check: `grep -n '_columnConfigs = ' packages/lib/src/typescript/lib/component/table/Body.ts` — expect two matches (the two write sites; the field declaration does not match this pattern), and each one's next line is the new call.
10. **`Body.ts` — add the guard.** Make the early return from `## Internal Structure` the first statement of `applyRequiredEmptyState`, and add one sentence to that method's existing JSDoc saying the loop is skipped entirely while no column carries `required` or a `requiredPredicate`.
11. **Commit part two.** One code commit covering steps 8–10.
12. **Tests.** Add the part-one cases to `packages/lib/tests/component/table/VisibleRecordQueryEconomy.test.ts` and the part-two cases to the `Body required-empty cell outline resolution` describe block in `packages/lib/tests/component/table/Body.test.ts`, per `## Expected Behaviour`.
13. **Changelog.** Add two bullets under `## Changed` → `### Components` in `packages/lib/docs/reference/changelog/next.md`, per `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/data/AbstractStore.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/tests/component/table/VisibleRecordQueryEconomy.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

Two plans are drafting against this repo at the same time. `field-internals-unchanged-commit-opt-in` changes `component/table/Row.ts`, which this plan does not touch. `table-column-resize-outline-mode` changes the table's column-resize path and may reach `component/table/Body.ts`; if both land, whichever goes second re-reads `Body.ts`'s field block and `applyRequiredEmptyState`'s line numbers. All three plans add bullets to `packages/lib/docs/reference/changelog/next.md`, which conflicts textually and not semantically.

---

## Expected Behaviour

All cases below are unit-testable offline. The two manual checks are named at the end of `## Verification`.

**Part one — the store-view memo.**

1. Two `getVisibleRecords()` calls with no store activity between them return the **same array instance** and make at most one `store.getRecords()` call.
2. A keyboard navigation tick, and a one-row scroll tick, each make at most one `store.getRecords()` call regardless of pool size — the existing `VisibleRecordQueryEconomy` tests already pin the `getVisibleRecords()` counts, and the new assertion is on `getRecords`.
3. After `store.add({...})` on a store below the worker threshold, the next `getVisibleRecords()` includes the new record.
4. After `store.setFilter(...)` resolves, the next `getVisibleRecords()` reflects the filter.
5. After `store.removeAll()`, the next `getVisibleRecords()` is empty.
6. With a row filter set through `Table.setRowVisible`, two consecutive `getVisibleRecords()` calls return **different array instances**, and still make at most one `store.getRecords()` call between them.
7. With a row filter that tests a field, editing that field through `record.set(...)` changes the next `getVisibleRecords()` result — the predicate re-runs even though the store's view was not rebuilt. This is the case the design exists to keep working.
8. `body.setStore(otherStore)` where both stores have been loaded and report the same generation: the next `getVisibleRecords()` returns the *new* store's records.
9. Two bodies over one store each serve their own copy, and neither is disturbed by the other's reads.

**Part two — the required-column guard.**

10. With no column config at all, no cell is ever given a required-empty outline, and `applyRequiredEmptyState` performs no `_columnConfigs` lookup. (Assert on the outline; assert the skip with `vi.spyOn` on the config map instance's own `get`, which the loop is the only caller of per rendered cell.)
11. With configs present but none carrying `required` or `requiredPredicate`, the same holds.
12. A config carrying `required: true` still outlines an empty cell in that column, and stops outlining once the value is filled — the four existing cases in `Body.test.ts`'s `Body required-empty cell outline resolution` block must keep passing unchanged.
13. A config carrying only `requiredPredicate` still outlines the cells of records the predicate matches and no others.
14. `required: false` written explicitly behaves as absent: no outline, loop skipped.
15. A `requiredPredicate` that returns `false` for every record still runs the loop — the flag asks whether a predicate is carried, not what it answers — and paints no outline.
16. **Config swap, tint cleared:** set a config map with `required: true`, render so a cell is outlined, then call `setColumnConfigs` with a map carrying nothing required. That cell's outline is gone immediately after the `setColumnConfigs` call, and stays gone after a further render.
17. **Config swap, tint appears:** the reverse — an empty map, then a map with `required: true` — outlines the empty cell on the next render.
18. The same two swap cases through `bindViewState` rather than `setColumnConfigs`.

---

## Verification

1. `npm run typecheck` and `npm run typecheck:test` — clean.
2. `npm test` — the full suite, including the new cases and the four existing required-empty cases.
3. `npm run lint` — no new findings.
4. Grep invariants:
   - `grep -n 'this\._records = ' packages/lib/src/typescript/lib/data/AbstractStore.ts` — one match, inside `setRecordView`.
   - `grep -n '_store.getRecords()' packages/lib/src/typescript/lib/component/table/Body.ts` — zero matches.
   - `grep -rn '_viewGeneration++' packages/lib/src/typescript/lib/` — one match, inside `setRecordView`.
5. `npm run docs:api` — no *new* warnings. `master` emits 14; that count must not grow. Do not write a zero-warning bar into this step.
6. **Manual, in the library's demo app** (`npm run dev`, the table demo): scroll a large table, sort a column, apply a column filter, type in the quick search, and edit a cell. Rows, order and the quick-search result must be correct at each step. The offline harness models no painting, which is why this is by hand.
7. **Manual, the required-empty outline**: in the demo's table, confirm a required column's empty cell still shows its outline and loses it once filled.

**Performance is not part of this plan's acceptance.** The recorded in-engine readings are work `−27.3%` on the keyboard phase and `−14.3%` on the update phase for the memo, and about 107 skipped calls per unit for the guard, both with frame time flat at 900 and 10,000 rows (`00-post-campaign-agenda.md:848`, `:944`, `:963`). An in-engine A/B is the user's to run and opens a window, so no step here does. If one is run, a flat clock at equal geometry is a **pass**, per the standing rule.

---

## Documentation Impact

`getViewGeneration()` is `@internal` and `typedoc.json` sets `excludeInternal`, so it renders on no page; everything else added is `private`. `scripts/llms/check-coverage.mjs` tracks concrete classes only, so `llms.txt` needs no entry. No barrel or export changes.

Two bullets go under `## Changed` → `### Components` in `packages/lib/docs/reference/changelog/next.md`:

- **A table body copies the store's view once per rebuild instead of once per query.** Says that the copy is refreshed whenever the store rebuilds its filtered/sorted view, that a row filter and a quick search still re-run on every render pass, and that a `Body` subclass reading the `protected` `getVisibleRecords()` now receives a shared array it must not mutate.
- **A table skips its required-empty pass when no column asks for it.** Says that a column carrying `required` or `requiredPredicate` is unaffected, and that changing a `ColumnConfig` object in place after construction is not picked up — pass a new config map to `Table`'s spec path instead. Note that the header's asterisk already behaved this way.

---

## Potential Challenges

- **Two stores can report the same generation.** Both start at `0`, so a swapped-in store is not detectable from the number alone; step 6's reset in `rebindStore` is what covers it, and `rebindStore` is the only place `_store` is assigned outside the constructor.
- **The clearing sweep must run at the config write, not at the next render.** Put `refreshRequiredColumnFlag()` on the line after the assignment at both sites; a version that defers the sweep to `renderWindow` cannot work, because the guard it protects is what stops the render from running the loop.
- **The flag must be recomputed even when the new map is empty.** `bindViewState`'s rotated-view path passes a map built from a different spec; recompute unconditionally rather than gating on the map being non-empty.
- **`getVisibleRecords`'s two JSDoc claims are not the same claim.** The store's view is served from a copy; the row filter is not. Write both sentences, so a later reader does not read the memo as covering the predicate.
- **Do not memoise `TreeBody.getVisibleRecords`.** It overrides the method, never calls `super`, and derives from `_flatRows`; it is out of scope and its invalidation rules are different.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) | Both parts live here: `getVisibleRecords` (`:502`), `renderWindowPass`'s post-commit re-read (`:1235`), the `applyRequiredEmptyState` call (`:1464`), `setColumnConfigs` (`:828`), `bindViewState` (`:990`), `rebindStore` (`:948`), `applyRequiredEmptyState` (`:2498`) |
| [`packages/lib/src/typescript/lib/data/AbstractStore.ts`](packages/lib/src/typescript/lib/data/AbstractStore.ts) | `getRecords` (`:652`), the two `_records` assignments (`:1964`, `:2072`), `notifyRecordChanged` (`:961`), and `isBatching` (`:1012`) as the `@internal`-public precedent |
| [`plans/implemented/size-hint-per-pass-memo.md`](plans/implemented/size-hint-per-pass-memo.md) | The precedent this plan's memo mirrors: a generation counter bumped by every write that could change the answer, stashed beside the cached value |
| [`packages/lib/src/typescript/lib/core/Util.ts`](packages/lib/src/typescript/lib/core/Util.ts) | `textMetricsGeneration()` (`:304`) — the original of that device, with the JSDoc wording to mirror |
| [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) | `setRowVisible`'s documented re-application contract (`:521-556`) and `buildColumnConfigs` (`:1227`), which stores the consumer's own config objects by reference |
| [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) | `setRequiredEmpty`'s equality guard (`:478`) — what makes the clearing sweep free |
| [`packages/lib/src/typescript/lib/component/table/Column.ts`](packages/lib/src/typescript/lib/component/table/Column.ts) | `_required` cached at construction (`:58`) — the precedent for treating `required` as fixed between config writes |
| [`packages/lib/tests/component/table/VisibleRecordQueryEconomy.test.ts`](packages/lib/tests/component/table/VisibleRecordQueryEconomy.test.ts) | Where part one's tests go; it already builds a laid-out 400-row table and counts `getVisibleRecords` calls |
| [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts) | `Body required-empty cell outline resolution` (`:2090-2168`) — where part two's tests go, with the `getShadow()` assertion style to reuse |
| [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md) | The measurements (`:848`), the standing rule (`:896`) and the corrections that reopened both parts (`:944`, `:951`, `:963`) |

---

## Non-Goals

- **Memoising the row-filter result.** It needs an invalidation signal for record-content changes that this plan deliberately does not build; the case is unmeasured and `plans/table-row-filter-panel.md` adds the surface.[^filtered-cost]
- **`TreeBody.getVisibleRecords`.** A separate derivation over `_flatRows`, and the recorded measurement shows no effect on the `treetable-rows` panel.
- **`g21.focus-sweep`.** The third part of the same ablation reads `unreached` in every phase — `_updateFocusStyle`'s pool-wide sweep never runs on the panel — so there is nothing to price.
- **The other `store.getRecords()` callers.** `Table`'s export, rotated-view and quick-search paths (`Table.ts:1362`, `:2054`, `:2068`, `:2082`, `:2504`) each run once per user action, not per render pass.
- **Touching the QA app.** `g21.render-pass` stays registered; shipped candidates keep their ablations (`g08`, `g18` and `g28` all did), and no panel or README cell changes.
- **Claiming or measuring a frame-time improvement.** See `## Verification`.

---

## Notes

[^flat-clock]: "Work with a flat clock" means the change removes real computation while the measured frame time does not move outside the run-to-run bracket. The agenda's 2026-09-26 entries state the rule: render time is the primary priority, reduced work is secondary, and "a work reduction with a flat clock is still worth shipping unless it costs considerable code complexity" (`00-post-campaign-agenda.md:896-905`). That entry also re-opened both parts of this plan after they had been closed on "the counters moved, the clock did not" (`:848-894`), which the user judged an insufficient reason on its own. The same entry records why counters and time diverged here: `work=1&seam=1` counts framework bookkeeping, priced at three to five microseconds a call on WebKitGTK, while the one candidate that did move time (G23, `Intl.DateTimeFormat` construction) barely moved a counter.

[^one-plan]: The alternative — a plan each — was rejected. Both parts edit `component/table/Body.ts`, so two plans would declare the same `touches-shared` file and create a merge dependency between two branches for no design reason, in a repo whose workflow stacks feature branches. They also share their whole justification (the standing rule), their measurement (`g21.render-pass` on `table-rows`), their verification surface and, for part two, the test file part one's changes have to keep passing. Splitting would duplicate all of that. What splitting would genuinely buy — one reviewable unit per piece of functionality — the commit structure already gives, which is why the steps produce two code commits rather than one.

[^why-generation]: Two other keys were considered. Keying a `WeakMap` on the store's `_records` array identity is what the QA ablation does (`packages/qa/src/harness/ablations.ts:1728`), and the key itself is sound, for the reason the body gives — but `_records` is private, so the library would have to expose the live array to reach it, which leaks a mutable array the store owns and would ripple a `readonly` return type through about ten `Body` signatures. Invalidating from `Body.onStoreChange` instead needs no store change at all, and was rejected because it is not sound: `appendRecords` (`AbstractStore.ts:938`) rebuilds the view and emits nothing, so a later scroll would serve a stale copy where today it would pick the new records up. The counter is sharp where the event list is not, and is the device the library already uses in `Util.textMetricsGeneration()` and `size-hint-per-pass-memo`.

[^no-in-place]: Checked exhaustively against `data/AbstractStore.ts` at `6db01b15`. Of every `_records` reference in the file, exactly two are assignments (`:1964`, `:2072`); every other is a read (`slice`, `length`, index, `indexOf`, `forEach`, `includes`, `find`, `filter`, `for…of`) or a comment. No `push`, `splice`, `sort`, `reverse`, `fill`, `pop`, `shift`, `unshift` or `copyWithin` is ever applied to it. The in-place mutations in the file — `:854`, `:858`, `:887`, `:913`, `:939` — are all on `_allRecords`, and `_records` can never alias it: `applyViewInProcess` starts from `this._allRecords.slice()` (`:1944`) and the worker path builds a fresh `map`. Every `_allRecords` mutation is followed by `applyView()`, so a mutation of the master list always produces a *new* `_records`. `getRecords()` is not overridden by `MemoryStore`, `Store`, `AjaxStore` or `TreeStore`.

[^filtered-stale]: The failing case, concretely. `Table.setRowVisible`'s JSDoc (`Table.ts:529-533`) promises the predicate is re-applied on a store `'datachange'`, and `AbstractStore.notifyRecordChanged` (`:961`) emits `'datachange'` without calling `applyView()` — so an in-cell edit leaves the store's view array identical and its generation unmoved. A memo keyed on that identity would keep showing a row whose edited value no longer matches the filter. `ColumnConfig.requiredPredicate`'s own JSDoc names the same trigger for the same reason. Worse, `renderWindowPass` depends on the re-evaluation *within one pass*: after `commitEditsOutsideWindow` commits an edit it re-reads `getVisibleRecords()` and the row count, with the comment "A commit can change what a filtered/sorted store returns" (`Body.ts:1231-1238`). The commit reaches `Row.commitCellValue` → `record.set` and `store.notifyRecordChanged`, neither of which rebuilds the view. Leaving the filter unmemoised keeps both behaviours exactly as they are, at the cost of the predicate sweep this plan does not claim to remove. A memo that covered the filter would need a second, record-level invalidation signal — which is buildable, and is what a later plan would have to justify and measure.

[^filtered-cost]: What the filtered case costs today, from the agenda (`:973-980`): with `_rowVisible` set, each `getVisibleRecords()` call runs n predicate invocations on top of the slice — at 10,000 rows and six calls per keyboard unit, about 60,000 predicate calls per unit, every result but the last discarded. That has never been measured, because no QA panel sets a body row filter: `table-rows`' own filter mode calls `store.setFilter`, which is store-level. `Table.setRowVisible` is public API, so the case is reachable by applications and the candidate is real. This plan removes the slice underneath that sweep and nothing else, and its acceptance does not depend on the unmeasured figure either way.

[^no-mutation]: Checked at every call site. `getVisibleRecords()`'s result is read through `length`, index, `indexOf`, `filter`, `map` and `forEach` at `Body.ts:1198`, `:1235`, `:1529`, `:1646`, `:1679`, `:1755`, `:1881`, `:1933`, `:2090`, `:2131`, `:2250`, `:2296`, `:2401`, `:2602`, `:2635`, `:2712`, `:2868`, `:2939`, `:2993`, and passed onward to `commitEditsBeforeRebind`, `bindAndPositionRows`, `refreshCellRangeHighlight`, `updateCellRangeVisualState`, `widenRangeDragIfMultiCell`, `updateRowVisualState` and `skipSeparators`. No site applies a mutating array method to it. Note that a memo and an exposed live array share this hazard equally — both hand the same object to successive callers — which is why the JSDoc note is the fix rather than a defensive copy that would reinstate the cost.

[^clear-sweep]: Two cheaper-looking variants are wrong or not cheaper. Sweeping only when the flag *falls* from true to false needs a previous-value comparison and is no simpler than sweeping whenever the new flag is false, which is a no-op through `Cell.setRequiredEmpty`'s equality guard when no cell was outlined. Relying on a rebind to clear the outline does not work: `syncPoolCells` (`Body.ts:880`) reconciles the cell set only on the *next* `renderWindow`, via `Row.setColumnWindow`, and a cell that keeps its column is neither rebuilt nor reset — it carries `_requiredEmpty` and replays it from `applyStyle` (`cell/Cell.ts:566`). The QA ablation (`skipUnrequiredEmptyState`, `ablations.ts:1785`) has no sweep at all, which is why it cannot ship as written. The sweep's cost is bounded by the pool, which is the visible window plus a margin — tens of rows — and it runs only when a column configuration is written.

[^static-required]: `Table.buildColumnConfigs` (`Table.ts:1227-1235`) stores the consumer's own `ColumnConfig` objects by reference, so a consumer holding one could in principle flip `required` in place and, today, the body's per-render loop would pick it up on the next pass. That is not a supported path and the library is already inconsistent with it: `Column`'s constructor copies `config?.required ?? false` into `_required` (`Column.ts:58`), `isRequired()` returns the copy, and `Header` paints the asterisk from it (`Header.ts:1015`) — so an in-place flip already changes the cell outlines without changing the header. `Table._columnConfigs` is only ever assigned a freshly built map (`Table.ts:357`), and `Body.getColumnConfigs()` (`:649`) is `protected` and documented "do not mutate". Making the body agree with the header is the right direction, and the changelog says so.

---

## Implementation Notes

Implemented on `feature/table-body-visible-records-memo`, branched from
`feature/table-cell-date-formatter-memo` (`1eba8882`) as phase 4 of a
nine-phase batch. Suite baseline on that start point: **514 files, 8588 passed,
2 todo, 0 failed**. After this branch: **514 files, 8609 passed, 2 todo, 0
failed** — 21 new cases: 11 for part one in
`VisibleRecordQueryEconomy.test.ts`, one more for part one's worker path in
`AbstractStore.workerView.test.ts`, and 9 for part two. `npm run
typecheck` and `npm run lint` are clean, as is `typecheck:test` — which has no
root alias and runs either as `npm -w packages/lib run typecheck:test` or as the
first half of `npm test`. And
`npm run docs:api` finishes with **0 errors and 14 warnings**, the count
`master` already emits.

The design shipped as planned. Both parts are the plan's own, unchanged: the
memo covers only `getRecords()`'s copy and leaves the row-visibility predicate
re-running on every call, and the required-column flag is recomputed at both
`_columnConfigs` write sites with a clearing sweep when it falls false. Nine
things diverged or needed correcting; three of the nine — sections 2, 4 and 5 —
are prescribed assertions or coverage claims that could not have caught a
regression.

### 1. Verification step 4's second grep cannot pass, as written

`## Ordered Implementation Steps` step 5 and `## Verification` step 4 both
prescribe `grep -n '_store.getRecords()' …/Body.ts` — **zero matches**. That
invariant is unsatisfiable, because the plan's own `getStoreView()` in
`## Internal Structure` is built around `this._storeView = this._store.getRecords();`.
The invariant the step means is **exactly one** match, inside `getStoreView`,
and that is what was checked. `grep -n 'this\._records = '` on `AbstractStore.ts`
(one match, inside `setRecordView`) and `grep -rn '_viewGeneration++'` (one
match, same method) both pass as written.

### 2. Case 10's prescribed skip assertion rests on a false premise

The plan directs: "assert the skip with `vi.spyOn` on the config map instance's
own `get`, which the loop is the only caller of per rendered cell." It is not.
`applyReadOnlyState` → `isRecordFieldReadOnly` (`Body.ts:2458`) calls
`this._columnConfigs.get(fieldName)` once per cell too, on every rebind.
Measured before the guard existed, on a two-record × two-column body with **no
column config map at all**: `Map.prototype.get` was called **8** times per
render and `Cell.setRequiredEmpty` **4**. So the prescribed spy sees 4 calls
after the guard lands, not 0 — an `expect(…).toBe(0)` on it would have gone red
against a correct implementation, and any "fewer `get`s" form is confounded by a
second caller that the guard does not and must not touch.

Replaced with a spy on `Cell.prototype.setRequiredEmpty`, which
`applyRequiredEmptyState`'s loop is the only caller of **on a render pass** — so
its call count is an exact witness for "the loop ran", reading 4 before the guard
and 0 after. The clearing sweep this branch adds to `refreshRequiredColumnFlag`
is its one other caller, which is why the test helper spies across a plain
re-render and never across a config write, where the sweep would be counted too.
Cases 11, 14, 15 and 16 use the same witness. This is the defect class the batch
has now hit five times, and it is the second to be a wrong assertion rather than
a merely weak one.

### 3. Every prescribed assertion was mutation-tested

Each of the 21 new cases, and 2 of the 4 pre-existing required-empty cases, was
proved able to fail by mutating the implementation and confirming the test went
red, then restoring. No new assertion survived every mutation.

Part one (11 cases, all in `VisibleRecordQueryEconomy.test.ts`):

| Mutation | Cases it turns red |
|---|---|
| `getStoreView`'s generation guard removed (always re-copy) | same-instance, row-filter-fresh-array, two-bodies, scroll-tick, keyboard-tick |
| Guard changed to copy once and never invalidate | add, store filter, `removeAll`, sort |
| `setRecordView` stops bumping the generation | add, store filter, `removeAll`, sort |
| The **worker** path bypasses `setRecordView` | the worker-view generation case |
| `rebindStore`'s stash reset removed | store swap at equal generation |
| **Memo moved to cover the post-filter result** (what the QA ablation did) | row-filter-fresh-array, in-place-edit-re-evaluation |

The last row is the one that matters: it reproduces the ablation's unsound
design inside the library and shows the two cases that catch it, which is the
evidence that `## Architecture Decisions`' "only the store's view is memoised"
is a correctness requirement and not a scoping preference. The keyboard-tick
case is the other one worth singling out; section 4 records why it had to be
written at all.

Part two (9 cases, in `Body.test.ts`):

| Mutation | Cases it turns red |
|---|---|
| The `_anyColumnRequired` guard removed | all 3 skip cases, both clear-on-swap cases |
| The clearing sweep removed, guard kept | both clear-on-swap cases |
| The guard's test inverted | 11 of the block's 13 cases |
| Flag ignores `requiredPredicate` | predicate-answers-false, predicate-only map |
| Flag treats `required: false` as required | explicit-`required: false` |
| `setColumnConfigs` stops recomputing the flag | 7 cases, 2 of them pre-existing |
| `bindViewState` stops recomputing the flag | both `bindViewState` cases |
| `required && empty` weakened to `required` | pre-existing "once its value is filled" |

### 4. Case 2's keyboard half was not covered by the tests it names

`## Expected Behaviour` case 2 requires that a keyboard-navigation tick make at
most one `store.getRecords()` call, and justifies asserting only on `getRecords`
by saying "the existing `VisibleRecordQueryEconomy` tests already pin the
`getVisibleRecords()` counts". They do not. That file's two `describe` blocks
cover a scroll tick and a cell-range drag; it contains no keyboard case at all.
Taking the claim at face value would have left the plan's headline phase — six
queries a unit, against two on `update` — with no coverage of either count.

A keyboard-tick case was added, and it pins both numbers rather than one: the
tick must still ask for the visible records more than once (`asks > 1`, so the
case cannot pass by the body having stopped asking) while copying the store's
view zero times. Under the always-re-copy mutation it reads **6** copies, which
reproduces offline the "six calls per keyboard-navigation unit" the agenda
measured in-engine.

### 5. The worker-built view had no prescribed case, and needed one

`## Expected Behaviour` covers a store above the worker threshold only *before*
the worker answers — the worked-cases table's "`store.add(record)` above the
worker threshold, before the worker answers" row — and never after. But the
worker's `.then` is the **second** `setRecordView` call site
(`AbstractStore.ts:2104`) and the only one reached at or above
`WORKER_THRESHOLD = 1000`, which is to say it is the production path at the
10,000-row scale this plan's measurement comes from. Every part-one case in
`VisibleRecordQueryEconomy.test.ts` uses a six-record in-process store, so
reverting that one line to a bare `this._records = …` would have left the whole
suite green; only the `## Verification` grep would have caught it, and a grep is
not a test.

One case was added to the existing
`tests/unit/data/AbstractStore.workerView.test.ts`, whose worker stub already
exists for exactly this path: the generation must hold while the worker is
pending and move once its view lands. Under the revert mutation it reads
`expected 0 to be greater than 0`.

### 6. The recorded −4.2% / −21.5% is a looser upper bound than the agenda says

`## Verification` says performance is not part of acceptance and quotes the
work-only figures; the agenda's later cell (`00-post-campaign-agenda.md:1257`)
records `key` **−0.75 ms, −4.2%** and `passes` **−21.5%** at n=10,000 under
`rowfilter=title`, and notes the shippable memo banks "the slice half of this".
Even that understates the gap. The `g21.visible-memo` arm cached the post-filter
result, so under a row filter it removed **n predicate invocations per call** as
well as the n-element slice — and at n=10,000 the predicate sweep is the larger
of the two by construction, which is precisely why that cell was the first to
show a clock effect at all while every unfiltered cell read flat. What this
branch removes is the slice only. The honest statement is that the banked
fraction of −4.2% is unquantified and could be small; the plan's own claim —
real work removed, clock not claimed — is what this branch stands on. Nothing
here was re-measured: the standing instruction for this run forbids any command
that opens a window, which every in-engine A/B does.

### 7. Both manual verification steps were not performed

`## Verification` steps 6 and 7 call for the library's demo app (`npm run dev`)
— a real browser window, which this run is forbidden from opening. What covers
them offline instead:

- Step 6 (scroll, sort, column filter, quick search, cell edit over a large
  table). The store-view invalidation paths are each pinned by a case: `add`,
  `setFilter`, `sort`, `removeAll`, a store swap at an equal generation, the
  in-place-edit case that proves the row predicate still re-runs when the store
  rebuilt nothing, and — in `tests/unit/data/AbstractStore.workerView.test.ts` —
  the worker-built view, which is the production path at or above the
  1,000-record threshold and so the one that matters at the scale this plan was
  measured at (section 5). The quick search is **not** a store-level filter —
  `Table.setQuickSearch` composes through `applyRowVisible` into
  `Body.setRowVisible` (`Table.ts:611`), never `store.setFilter` — so what covers
  it is the row-predicate half: the two row-filter cases, and the file's
  pre-existing "an active quick search does not change either call count" case.
  That is also why leaving the predicate unmemoised is what keeps the quick
  search correct, as `QuickSearchState.cache`'s own JSDoc (`Table.ts:133-139`)
  already assumes. The scroll-tick and keyboard-tick cases drive a realized
  400-row `Table`. What remains genuinely unverified is painting, which no
  offline harness models.
- Step 7 (a required column's empty cell still shows its outline and loses it
  once filled). The four pre-existing cases in `Body required-empty cell outline
  resolution` assert exactly that through `Cell.getShadow()`. Two of the four
  were shown able to fail: "outlines a statically required column's cell" under
  the stopped-recomputing-the-flag mutation, and "does not outline once its value
  is filled" under `required && empty` weakened to `required`. The other two are
  negative assertions predating this branch that no mutation of this branch's own
  code turns red; establishing their coverage is not this plan's to do. The nine
  new cases add the swap-in-both-directions and skip cases the plan asked for.

### 8. No demo surface was added

Work Instructions step 7 asks for a demo of the new feature. Both parts are
invisible internal optimisations: no new consumer-facing API, no behaviour a
demo could show that the existing table demo does not already show. The one
member added, `AbstractStore.getViewGeneration()`, is `@internal`. Nothing was
added to the demo surface.

### 9. Four texts corrected beyond the plan's own edit list

The audit round found that inserting `setRecordView` and
`refreshRequiredColumnFlag` "immediately above" their neighbours, as steps 1 and
8 word it, had been read as *above the declaration* rather than *above the
declaration's JSDoc* — which left `applyViewInProcess` and
`applyRequiredEmptyState` undocumented and orphaned both of their doc blocks,
including the sentence step 10 adds. Both are now genuinely above the
neighbouring doc comment. The audit also found `Body`'s class-level JSDoc
claiming the body reflects store state "without maintaining a duplicate data
array", which part one makes false; that sentence now says the body's one copy
is the one `getRecords()` hands back, refreshed per view rebuild.

The fourth is in the changelog rather than the source. `## Documentation Impact`
prescribes telling a consumer to "pass a new config map to `Table`'s spec path
instead", but `Table` builds its column configs only from the `spec` its
constructor is given (`Table.ts:355-358`) and exposes no later spec setter — so
that instruction cannot be followed as written. The bullet now says what is
actually available: build the table again, or drive `Body.setColumnConfigs` with
a new map. None of the four is in the plan's edit list.

### Incidental

`plans/in-progress/` did not exist on the start point, so the in-progress `git
mv` needed the directory created first.
