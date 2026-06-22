---
touches-shared: [src/typescript/lib/data/AbstractStore.ts, src/typescript/lib/data/StoreWorker.ts]
---

# Store Collection API + Aggregation + Grouping + Comparator — Implementation Plan

## Overview

This plan completes the **read / query / collection** side of [`AbstractStore`](../src/typescript/lib/data/AbstractStore.ts#L72) — the foundation a larger data-layer effort builds on. Scope is strictly the access/query/collection/grouping surface plus the sort comparator (and its Web-Worker parity). It does **not** touch sync, persistence, error events, or the load/filter/clear/update event additions — a sibling plan (`data-store-sync-and-events`) owns those, editing a disjoint region of the same file.

Today the collection surface is thin and partly O(n): [`add()`](../src/typescript/lib/data/AbstractStore.ts#L459) only appends, [`getById()`](../src/typescript/lib/data/AbstractStore.ts#L418) is a linear `find` over `_allRecords`, and there is no `insert` / `indexOf` / `getRange` / `first` / `last` / `each` / `contains`. The store has no aggregation (`sum` / `average` / `min` / `max` / `collect`) and no grouping. The sort comparator in [`applyView()`](../src/typescript/lib/data/AbstractStore.ts#L865) and its worker twin [`sortIndices()`](../src/typescript/lib/data/StoreWorker.ts#L27) use raw `<` / `>`, which is locale-naive for strings (`'Ä'` sorts after `'Z'`) and offers no custom-comparator hook.

The work adds: (1) a thin collection API backed by an id→record `Map` index so `getById` is O(1); (2) aggregation methods over the filtered view; (3) single-level grouping with a `groupField` config and a `'groupchange'` event; (4) a locale-aware, type-aware comparator shared by the main thread and the worker, plus a per-sorter custom `sorterFn` that bypasses the worker path (functions cannot cross structured clone).

---

## Architecture Decisions

### Ownership boundary with `data-store-sync-and-events` (shared-file contract)

Both plans edit [`AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) and both widen the [`StoreEvent`](../src/typescript/lib/data/AbstractStore.ts#L29) union. The regions are disjoint:

- **This plan owns:** the Access region ([`getRecords`](../src/typescript/lib/data/AbstractStore.ts#L378)…[`findAll`](../src/typescript/lib/data/AbstractStore.ts#L446)), the new collection / aggregation / grouping methods, the `_idIndex` map and its rebuild hooks, the comparator inside [`applyView()`](../src/typescript/lib/data/AbstractStore.ts#L853) and [`applyViewOnWorker()`](../src/typescript/lib/data/AbstractStore.ts#L911), the `groupField` option, and the **single** new event `'groupchange'`.
- **The sibling owns:** the sync / mutation / event-emission code — `load` / `loadData` / `sync` / `reject` / `removeAll` and any `load` / `filter` / `clear` / `update` / `exception` event additions.

**`StoreEvent` union:** this plan adds **only** `'groupchange'`. The sibling adds its own event names. Whichever lands second appends its literal(s) to the union — the merge is a one-line additive edit, no semantic conflict.

**Shared touch points to coordinate (not owned, but read/extended here):** the id→record index must be rebuilt on every mutation that changes `_allRecords` — `ingestRaw`, `add`, `remove`, `removeAll`, `reject` (sibling-owned methods). Rather than editing each sibling method, this plan funnels the rebuild through **`applyView()`** (already called by every one of those paths) so the index stays a pure function of `_allRecords` with no cross-region edits. See *Id index rebuilds inside applyView*.

### Aggregates operate over the filtered view (`_records`), not `_allRecords`

`sum` / `average` / `min` / `max` / `collect` read `_records` (the filtered, sorted view), mirroring `getCount()` which already counts the view ([`AbstractStore.ts:396`](../src/typescript/lib/data/AbstractStore.ts#L396)). Rationale: aggregates exist to feed UI summaries (a status-bar total, a footer average, a distinct-value filter list) that must agree with what the user sees on screen. An aggregate over `_allRecords` would contradict an active filter — a "Sum: 1,200" under a table showing only rows totalling 300 is a bug, not a feature. Consumers who genuinely want the unfiltered total can read `getAll()` and reduce themselves; the common case is the view, so the view is the default and the only surface added here.

### `count()` is **not** added — `getCount()` already exists

The task lists `count()` "(already partly via `getCount`—decide)". Decision: **do not add `count()`.** [`getCount()`](../src/typescript/lib/data/AbstractStore.ts#L396) already returns `_records.length` (the filtered view), which is exactly the aggregate `count()` would compute. A second alias is redundant API surface that violates the simplicity rule. The aggregation section documents that `getCount()` *is* the count aggregate.

### Single-level grouping; `getGroups()` returns an ordered map keyed by group string

Grouping is intentionally one level deep (the task says "Keep it simple"). `groupField` is a store config (an `AbstractStoreOptions` field with a `setGroupField` setter following the cached-options pattern). [`getGroupString(record)`](#) returns `String(record.get(groupField))` (or `''` when unset/null) — the bucket key. `getGroups()` buckets the **filtered view** (`_records`, consistent with aggregates) into a `Map<string, ModelRecord[]>`, preserving the view's existing order: groups appear in first-encounter order, and records within a group keep view order. Returning a `Map` (not a plain object) keeps key order deterministic and lets non-string-safe keys round-trip as their `String()` form. Setting `groupField` (to a new value) fires `'groupchange'`; grouping does **not** re-run `applyView` (it is a pure read over the existing view), so no `'datachanged'`.

### Comparator: extract one shared `compareValues` used by both threads, keyed by field type

The main-thread comparator and the worker comparator must stay in parity, but they cannot share a runtime import cleanly (the worker is a separate module graph and the main thread holds `ModelRecord` instances while the worker holds plain rows). The parity strategy: a **single exported pure function** `compareValues(av, bv, type?)` in a new leaf module [`src/typescript/lib/data/compareValues.ts`](../src/typescript/lib/data/compareValues.ts), imported by **both** `AbstractStore` and `StoreWorker`. It centralises the null-handling and the type-aware branch so the two call sites can never drift. Logic:

- `null`/`undefined` handling unchanged from today: both null → `0`; one null → that one sorts last regardless of direction (the caller applies direction only to the non-null compare result, matching current behaviour at [`AbstractStore.ts:870-880`](../src/typescript/lib/data/AbstractStore.ts#L870)).
- **string** type (or both operands are strings when type is unknown): `av.localeCompare(bv)`.
- **date** / **datetime** / **time**: compare by `getTime()` when both are `Date`, else fall through to numeric.
- everything else: numeric / native `<` `>` as today.

The field `type` is resolved on the main thread via `this.model.getField(field)?.getType()` ([`Field.getType`](../src/typescript/lib/data/Field.ts#L73), returns [`FieldType`](../src/typescript/lib/data/Field.ts#L8)) and passed into `compareValues`. The worker has no model, so the snapshot dispatch must carry the field type alongside the field name (see *Worker carries field type*).

### Custom `sorterFn` is main-thread-only and **forces the in-process path**

`SortDescriptor` gains an optional `sorterFn?: (a: ModelRecord, b: ModelRecord) => number`. A function cannot survive structured clone, so it can never reach the worker. Design:

- When **any** active sorter carries a `sorterFn`, `applyView()` runs the comparator **in-process**, skipping `applyViewOnWorker()` entirely — even above `WORKER_THRESHOLD`. The threshold guard becomes `this._allRecords.length >= WORKER_THRESHOLD && StoreWorkerClient.isAvailable() && !this.hasCustomSorter()`, where `hasCustomSorter()` is a private predicate scanning `_activeSorters` for a `sorterFn`.
- In the in-process comparator, a sorter with a `sorterFn` calls it directly (its result is `cmp`, with direction applied as today); a sorter without one uses `compareValues`.
- This means a custom sorter on a large dataset loses the worker offload — an explicit, documented trade-off (correctness over offload). The plan does **not** attempt to ship a function id or a registry to the worker; that is out of scope and over-engineered for the stated need.

### No new DOM, theme, or `Component` surface

Everything here is data-layer logic on a plain class (`AbstractStore` is not a `Component`). The DOM-seam, typed-DOM-setter, `callable()`, and theme-token conventions in [ARCHITECTURE.md](../ARCHITECTURE.md) do not apply. The store's existing custom-event surface (`on` / `off` / `emit` over a `ListenerBag`) is the correct channel for `'groupchange'`, matching the framework's "custom events go through `on`/`off`/`emit`" rule.

---

## Public API (TypeScript Signatures)

```typescript
// SortDescriptor gains an optional main-thread-only custom comparator.
export interface SortDescriptor {
    field   : string;
    dir     : 'asc' | 'desc';
    sorterFn?: (a: ModelRecord, b: ModelRecord) => number;   // bypasses worker path
}

// One new event.
export type StoreEvent =
    | 'load' | 'datachanged' | 'add' | 'remove' | 'beforesync' | 'sync'
    | 'loadingchanged' | 'pagechanged' | 'pagechangeblocked' | 'sortchanged'
    | 'groupchange';                                          // ← added by THIS plan

export interface AbstractStoreOptions {
    // …existing fields unchanged…
    groupField?: string;
}

export abstract class AbstractStore {
    // ── Collection API ──
    insert(index: number, data: any | any[]): ModelRecord[];   // creates new records, splices into _allRecords, applyView, emits 'add'+'datachanged'
    indexOf(record: ModelRecord): number;                      // position in the filtered view (_records), or -1
    getRange(start: number, end: number): ModelRecord[];       // inclusive slice of the view, clamped
    first(): ModelRecord | undefined;                          // _records[0]
    last(): ModelRecord | undefined;                           // _records[_records.length - 1]
    each(fn: (record: ModelRecord, index: number) => void): void;  // iterate the view in order
    contains(record: ModelRecord): boolean;                    // membership in the view
    getById(id: any): ModelRecord | undefined;                 // now O(1) via _idIndex

    // ── Aggregation (over the filtered view) ──
    sum(field: string): number;
    average(field: string): number;                            // 0 over an empty/all-null view
    min(field: string): number | undefined;
    max(field: string): number | undefined;
    collect(field: string): any[];                             // distinct values, view order

    // ── Grouping (single level, over the filtered view) ──
    setGroupField(field: string | null): this;                 // fires 'groupchange' on change
    getGroupField(): string | null;
    getGroupString(record: ModelRecord): string;
    getGroups(): Map<string, ModelRecord[]>;
}
```

```typescript
// New leaf module — shared by main thread AND worker, the single parity point.
// src/typescript/lib/data/compareValues.ts
import type { FieldType } from '~/data/Field.js';

/**
 * Type-aware, locale-aware comparison of two raw field values. Returns a
 * negative / zero / positive number (ascending sense). Null/undefined sort
 * last; the caller applies sort direction to a non-zero result.
 */
export function compareValues(av: any, bv: any, type?: FieldType): number;
```

---

## Internal Structure

**Id index (`_idIndex`).** A `private _idIndex: Map<any, ModelRecord> = new Map();` rebuilt by a private `rebuildIdIndex()` that clears the map and, only when `this.model.getPrimaryKeyField()` is set, populates `id → record` from `_allRecords`. Called at the top of `applyView()` (both the in-process and worker branches) so it tracks every `_allRecords` mutation without editing sibling-owned mutation methods. `getById` becomes `return this._idIndex.get(id);` (still returns `undefined` when no primary key, since the map stays empty).

**Comparator dispatch in `applyView()` (in-process branch).** The existing `view.sort(...)` body changes to, per sorter:

```typescript
const cmp = sorter.sorterFn
    ? sorter.sorterFn(a, b)
    : compareValues(a.get(field), b.get(field), this.model.getField(field)?.getType());

if (cmp !== 0) {
    return dir === 'asc' ? cmp : -cmp;
}
```

The null short-circuit moves *into* `compareValues` (it returns `0` / a last-sorting sign for nulls); the loop keeps applying `dir` to the non-zero result, preserving today's "nulls last regardless of direction" semantics.

**Worker carries field type.** `applyViewOnWorker()` already passes `{ field, direction }` to `StoreWorkerClient.sortFilter`. Add the resolved `type` (`this.model.getField(primary.field)?.getType()`) to that payload. `StoreWorker`'s `sort` / `sortFilter` request shapes gain an optional `type?: FieldType`, and `sortIndices` calls `compareValues(av, bv, type)` instead of the inline `<`/`>`. This keeps both threads on the identical comparator. (Multi-sort already degrades to the primary sorter on the worker path — unchanged; this plan only swaps the comparator, not the single-vs-multi behaviour.)

---

## Ordered Implementation Steps

1. **Create [`compareValues.ts`](../src/typescript/lib/data/compareValues.ts)** with the exported pure `compareValues(av, bv, type?)`. Type-imports `FieldType` only (no runtime data-layer import, so the worker bundle stays lean). → verify: `npm run typecheck` clean.

2. **`StoreWorker.ts`:** import `compareValues`; add optional `type?: FieldType` to the `sort` and `sortFilter` request variants ([`StoreWorker.ts:18-21`](../src/typescript/lib/data/StoreWorker.ts#L18)); thread it into `sortIndices` ([`StoreWorker.ts:27`](../src/typescript/lib/data/StoreWorker.ts#L27)) and replace the inline `<`/`>` (and the local null branch) with a `compareValues` call. → verify: worker still returns indices; `npm run typecheck` clean.

3. **`StoreWorkerClient`** (read first — confirm its `sortFilter` signature): forward the new optional `type` through to the worker message. If the client's typed signature must widen, do it minimally. → verify: typecheck.

4. **`AbstractStore.ts` — comparator:** import `compareValues`; rewrite the `applyView()` sort body ([`AbstractStore.ts:864-891`](../src/typescript/lib/data/AbstractStore.ts#L864)) to delegate per-sorter to `sorterFn` or `compareValues`; add private `hasCustomSorter()`; extend the worker-path guard ([`AbstractStore.ts:854`](../src/typescript/lib/data/AbstractStore.ts#L854)) with `&& !this.hasCustomSorter()`; pass the resolved field `type` from `applyViewOnWorker()` ([`AbstractStore.ts:924-928`](../src/typescript/lib/data/AbstractStore.ts#L924)). → verify: sort still works in-process and on worker.

5. **`AbstractStore.ts` — `SortDescriptor`:** add optional `sorterFn` ([`AbstractStore.ts:36`](../src/typescript/lib/data/AbstractStore.ts#L36)). JSDoc it as main-thread-only.

6. **`AbstractStore.ts` — id index:** add `_idIndex` field and `rebuildIdIndex()`; call it at the top of both `applyView` branches; rewrite `getById` ([`AbstractStore.ts:418`](../src/typescript/lib/data/AbstractStore.ts#L418)) to read the map. → verify: `getById` returns the same record as before after load / add / remove.

7. **`AbstractStore.ts` — collection API:** add `insert`, `indexOf`, `getRange`, `first`, `last`, `each`, `contains` in the Access region ([`AbstractStore.ts:371-448`](../src/typescript/lib/data/AbstractStore.ts#L371)). `insert` mirrors `add` ([`AbstractStore.ts:459`](../src/typescript/lib/data/AbstractStore.ts#L459)) but splices at a clamped index and marks records new; the read methods operate on `_records`.

8. **`AbstractStore.ts` — aggregation:** add `sum`, `average`, `min`, `max`, `collect`, each reducing over `_records`. Numeric aggregates coerce via `Number(...)` and skip `null`/`NaN`. Add a short note in `getCount`'s JSDoc that it is the count aggregate (no new method).

9. **`AbstractStore.ts` — grouping:** add `groupField` to `AbstractStoreOptions` ([`AbstractStore.ts:50`](../src/typescript/lib/data/AbstractStore.ts#L50)); forward it in `applyOptions` ([`AbstractStore.ts:112`](../src/typescript/lib/data/AbstractStore.ts#L112)); add `setGroupField`/`getGroupField` (cached-options pattern), `getGroupString`, `getGroups`; add `'groupchange'` to `StoreEvent` ([`AbstractStore.ts:29`](../src/typescript/lib/data/AbstractStore.ts#L29)). `setGroupField` fires `'groupchange'` only on an actual change.

10. **`index.ts`:** no new *type* export is strictly required (`SortDescriptor`/`StoreEvent` already re-exported at [`index.ts:10`](../src/typescript/lib/data/index.ts#L10)). `compareValues` is an internal helper — **do not** export it from the barrel (it is not consumer API). → verify: `grep -n "compareValues" src/typescript/lib/data/index.ts` — expect zero matches.

11. **Docs** (see *Documentation Impact*). → verify: `npm run docs:build` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/data/compareValues.ts` |
| Modify | `src/typescript/lib/data/AbstractStore.ts` (Access/query/collection/grouping/comparator regions; `'groupchange'` only) |
| Modify | `src/typescript/lib/data/StoreWorker.ts` (comparator parity, `type` in request shapes) |
| Modify | `src/typescript/lib/data/StoreWorkerClient.ts` (forward field `type` to worker) |
| Modify | `docs/data/store.md` (collection / aggregation / grouping / comparator sections) |

---

## Verification

- `npm run typecheck` — clean.
- **Comparator parity:** a string-field sort returns identical order for the same dataset whether it runs in-process (< 1000 rows) or on the worker (≥ 1000 rows). Locale check: `['Ä','Z','a']` sorts `['a','Ä','Z']` (locale) not `['Z','Ä','a']` (code-point), on both paths.
- **Custom sorter bypass:** a `SortDescriptor` with a `sorterFn` on a ≥ 1000-row store runs in-process (assert via the order the `sorterFn` produces, and that no snapshot message is dispatched for that sort).
- **`getById` O(1):** returns the correct record after `load`, `add`, `insert`, `remove`; returns `undefined` for a model with no primary key.
- **Aggregates honour the filter:** apply a filter, then `sum`/`average`/`min`/`max`/`collect` reflect only the visible rows; `getCount()` agrees.
- **Grouping:** `getGroups()` buckets the view in first-encounter order; `setGroupField` fires `'groupchange'` once per real change; `getGroupString` returns `''` for a null/unset group value.
- `npm run docs:build` — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- Manual: exercise on the **MiscPanel** demo table store (the project's stress dataset) — sort a string column, group by a field, read a footer sum.

---

## Documentation Impact

- **Barrel:** `SortDescriptor` and `StoreEvent` are already re-exported from [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts#L10); their widening is picked up automatically. No new symbol needs a barrel entry — `compareValues` stays internal (not exported). `AbstractStoreOptions` (already exported) gains `groupField`.
- **Curated page:** extend [`docs/data/store.md`](../docs/data/store.md) with **Collection API**, **Aggregation**, **Grouping**, and a **Sorting** note covering `localeCompare` behaviour and the `sorterFn` worker-bypass caveat. The page is already linked in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts#L184) and catalogued in [`docs/data/index.md`](../docs/data/index.md) — no sidebar/catalog edit needed since no new page is added.
- **`@category Data`:** every new method/type carries the existing `@category Data` tag (inherited file-wide convention). The new `'groupchange'` literal is documented on `StoreEvent`'s JSDoc.
- **Cross-bucket links:** all references stay within the `data` subpath, so `{@link …}` resolves; no markdown-link form needed.

---

## Potential Challenges

- **Region collision with the sibling plan** — both edit `StoreEvent` and `AbstractStore.ts`. Mitigation: the union edit is additive (append a literal); the id-index rebuild funnels through `applyView` so no sibling-owned mutation method is touched. Whichever plan lands second resolves a trivial union-line merge.
- **Worker `type` threading** — `StoreWorkerClient`'s message types must widen in lockstep with `StoreWorker`'s request shapes. Mitigation: read the client before editing (step 3) and change both in one pass; `npm run typecheck` catches a missed field.
- **`compareValues` null direction** — moving the null branch into the shared function must preserve "nulls last regardless of `asc`/`desc`". Mitigation: `compareValues` returns the *ascending-sense* result and the caller applies `dir` only to a non-zero, non-null result, exactly as today; verify with a null-bearing dataset on both threads.
- **Aggregate type coercion** — `sum`/`average` over a non-numeric or mixed column. Mitigation: coerce with `Number(...)`, skip `NaN`, document that aggregates assume numeric fields; `collect` is the type-agnostic distinct-value path.

---

## Critical Files

- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) — the class being extended; comparator at L864-891, worker dispatch at L911-945.
- [`src/typescript/lib/data/StoreWorker.ts`](../src/typescript/lib/data/StoreWorker.ts) — worker comparator parity target.
- `src/typescript/lib/data/StoreWorkerClient.ts` — the main-thread side of the worker protocol (must forward field `type`).
- [`src/typescript/lib/data/Field.ts`](../src/typescript/lib/data/Field.ts) — `FieldType` union (L8) and `getType()` (L73) drive the type-aware compare.
- [`src/typescript/lib/data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) — `get`/`getId`/`getData`, the record surface the collection API operates on.
- [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts) — the data barrel (export surface).
- [`docs/data/store.md`](../docs/data/store.md) — the curated page to extend.

---

## Non-Goals

- **No multi-level / nested grouping** — single level only, per the task's "keep it simple". A group tree is a separate effort.
- **No `count()` method** — `getCount()` already is the count aggregate; a second alias is redundant.
- **No unfiltered-aggregate variants** (`sumAll`, etc.) — consumers reduce `getAll()` themselves for the rare unfiltered case; the view is the documented default.
- **No worker-side custom comparator** — `sorterFn` cannot cross structured clone, so it forces the in-process path; shipping a function registry to the worker is out of scope and over-engineered.
- **No sync / persistence / load-filter-clear-update / exception events** — owned by the sibling `data-store-sync-and-events` plan.
