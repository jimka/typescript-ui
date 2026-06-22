---
depends-on: [data-proxy-reader-writer]
touches-shared: [src/typescript/lib/data/AbstractStore.ts]
---

# Store Sync Robustness + Event Surface Gaps — Implementation Plan

## Overview

This plan hardens [`AbstractStore`](../src/typescript/lib/data/AbstractStore.ts)'s mutation/persistence path and fills the gaps in its event surface. Two problems drive it. First, `sync()` ([AbstractStore.ts:617-652](../src/typescript/lib/data/AbstractStore.ts#L617)) runs an unguarded serial `await` loop — one HTTP round-trip per record (N+1) with no try/catch — so a single failure aborts the rest and leaves partially-committed state with no notification; `load()` ([AbstractStore.ts:155-176](../src/typescript/lib/data/AbstractStore.ts#L155)) likewise only rejects on failure. Second, the `StoreEvent` union ([AbstractStore.ts:29](../src/typescript/lib/data/AbstractStore.ts#L29)) is asymmetric and incomplete: `removeAll()`, filter changes, and `notifyRecordChanged()` all collapse to a payload-less `'datachanged'`, and there is no `'beforeload'` or failure event.

Scope is strictly the store's persistence path (`load`/`sync`) and its event surface. It builds on the `Writer` / proxy-batch concept from [`data-proxy-reader-writer`](./data-proxy-reader-writer.md) for batched sync. It lives entirely in [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts), [`proxy/Proxy.ts`](../src/typescript/lib/data/proxy/Proxy.ts), [`proxy/AjaxProxy.ts`](../src/typescript/lib/data/proxy/AjaxProxy.ts), and the data barrel [`index.ts`](../src/typescript/lib/data/index.ts).

Collection/query/aggregation/grouping/comparator work — and any grouping/aggregation **events** — are owned by the sibling `data-store-collection-and-aggregation` plan and are **out of scope** here.

---

## Architecture Decisions

### Event ownership boundary with the sibling collection/aggregation plan

This plan owns the *persistence and lifecycle* slice of `StoreEvent`: `'beforeload'`, `'exception'`, `'clear'`, `'filterchange'`, and `'update'`. The sibling `data-store-collection-and-aggregation` plan owns the *collection* slice — any `'groupchange'` / aggregation / summary events. Both plans extend the **same** `StoreEvent` union in the **same** file ([AbstractStore.ts:29](../src/typescript/lib/data/AbstractStore.ts#L29)), so the two edits must compose: each adds only its own event-name string literals to the union and its own typed payload interfaces. There is no shared payload type between the two slices, so the only merge surface is the one union line — keep additions on separate literals and the two plans concatenate cleanly. `/implement` should apply whichever lands first, then the second rebases its literals onto the union the first produced.

### `'exception'` is the failure event name; it carries kind + records + error

The prompt offers `'exception'` or `'error'`. We pick **`'exception'`** — it is the established ExtJS-lineage name for store/proxy operation failures and avoids colliding with the DOM `'error'` convention. One event name covers both `load` and `sync` failures; the payload's `operation` field (`'read' | 'create' | 'update' | 'destroy'`) disambiguates. The payload also carries the offending `records` (the batch or single record whose op failed; empty for a `read` failure) and the raw `error`. This keeps a single subscription point for all transport failures rather than per-op events.

### `load()` failure: emit `'exception'`, then re-throw (preserve the promise contract)

`load()` today rejects its returned promise on failure. Callers (`autoLoad`, pagination's fire-and-forget `void this.load()`) rely on that being safe to ignore. We **keep the rejection** — wrapping in try/catch that emits `'exception'` and then re-throws — so existing `await store.load()` call sites still observe the failure, while listeners get the structured event. `'beforeload'` fires before the proxy read; a `read` failure emits `'exception'` with `operation: 'read'` and empty `records`. The concurrency/abort guard from the dependency plan (if it lands first) is orthogonal: a superseded/aborted load is a silent no-op and must **not** emit `'exception'` — guard the emit on the same sequence/abort check the dependency plan introduces. State this dependency explicitly so the implementer wires the emit *inside* the "not superseded" branch.

### `sync()` robustness: per-op try/catch, configurable stop-or-continue, no partial-commit corruption

The core invariant is preserved verbatim: **a record is committed only after its own op succeeds** ([AbstractStore.ts:614-615](../src/typescript/lib/data/AbstractStore.ts#L614) comment). Each create/update/destroy is wrapped so a failure emits `'exception'` (carrying that op's kind + the failed record(s) + the error) instead of throwing out of the loop. A new store option `syncErrorPolicy?: 'stop' | 'continue'` (default `'stop'`) controls what happens after a failure: `'stop'` aborts the remaining sync (already-committed records stay committed — that is correct, not corruption — and the failed/untouched records remain pending for the next `sync()`), `'continue'` records the failure and proceeds to the next record/batch. Either way `sync()` resolves (does **not** reject) and fires `'sync'` at the end with a summary of what failed, so the promise contract becomes "sync always settles; inspect `'exception'`/the `'sync'` payload for failures." Rejecting `sync()` is rejected as a design because the N+1 loop would otherwise strand later ops with no notification — the whole point of the event is to replace the throw.

This is a behavior change for any caller currently relying on `sync()` rejecting; flag it in `## Documentation Impact` and the `sync()` JSDoc. `'beforesync'` still fires first, unchanged.

### Batched persistence builds on the dependency plan's `Writer`; gated on a proxy batch capability

The dependency plan adds a `Writer` with `writeRecords(records)` (batch serialization) to `AjaxProxy`. This plan adds the *store-side* batching: `sync()` groups all creates, all updates, and all deletes and, **when the proxy advertises batch support**, issues one request per group instead of N. The capability is detected via new optional `Proxy` methods `createBatch?`, `updateBatch?`, `destroyBatch?` (default absent → the store falls back to the existing per-record loop). `AjaxProxy` implements them by POST/PUT/DELETE-ing the `writeRecords(...)` body to the collection URL. Per-op commit semantics carry over: on a successful batch every record in that batch is committed from the batch's server response (positional, by primary key); on a batch failure the whole batch's records stay pending and `'exception'` carries the full batch in `records`. Batch is therefore *coarser-grained* than per-record for the commit/rollback boundary — documented as such. Adding the batch methods as **optional** keeps `MemoryProxy`/`WebStorageProxy` (which never serialize) untouched and the change additive.

The batch wire format (single request body shape, response shape) is owned here only at the store↔proxy contract level; the actual JSON serialization is the dependency plan's `JsonWriter.writeRecords`. If the dependency plan has not shipped `writeRecords` at implement time, `/implement` blocks on it (that is what `depends-on` encodes).

### Symmetric events emitted at their natural sites

- `removeAll()` ([AbstractStore.ts:517](../src/typescript/lib/data/AbstractStore.ts#L517)) gains a `'clear'` emit (payload `{ removed: ModelRecord[] }`) before its existing `'datachanged'`, mirroring how `add`/`remove` each fire a specific event *plus* `'datachanged'`. We use `'clear'` rather than overloading `'remove'` because `remove` carries a single `record` and listeners switch on its shape; a bulk clear is semantically distinct.
- `filter()` / `filterBy()` / `clearFilter()` ([AbstractStore.ts:749-795](../src/typescript/lib/data/AbstractStore.ts#L749)) gain a `'filterchange'` emit (payload `{ filters: FilterDescriptor[] }`) alongside `'datachanged'`, making the filter axis symmetric with `'sortchanged'` ([AbstractStore.ts:696](../src/typescript/lib/data/AbstractStore.ts#L696)). This requires a public `getActiveFilters()` accessor to build the payload — **the dependency plan already adds `getActiveFilters()`** ([data-proxy-reader-writer.md Public API](./data-proxy-reader-writer.md)), so this plan consumes it rather than re-declaring it. If the dependency plan has not landed, the accessor is added here as part of the same edit (one-line mirror of `getActiveSorters()`); `/implement` resolves the duplication by ordering this plan after its dependency.
- `notifyRecordChanged(record)` ([AbstractStore.ts:541](../src/typescript/lib/data/AbstractStore.ts#L541)) gains an `'update'` emit (payload `{ record }`) before its existing `'datachanged'`. The `_record` param is currently unused (prefixed `_`); wiring `'update'` finally consumes it, so drop the underscore.

`'datachanged'` is retained everywhere it currently fires — these are additive, specific companions, not replacements, matching the existing `add`/`remove`/`sortchanged` pattern.

### Typed payloads as a discriminated-friendly interface set, not `any`

Per CODE_CONVENTIONS, every new event gets a named payload interface (`StoreExceptionEvent`, `StoreClearEvent`, `StoreFilterChangeEvent`, `StoreUpdateEvent`; `'beforeload'` carries `{}`). They are exported from the data barrel so consumers can type their listeners. `StoreListener<T>` already generic ([AbstractStore.ts:23](../src/typescript/lib/data/AbstractStore.ts#L23)), so no listener-machinery change is needed — only the payload interfaces and the union literals.

---

## Public API (TypeScript Signatures)

Extended `AbstractStore.ts`:

```ts
export type StoreEvent =
    | 'load' | 'beforeload' | 'datachanged' | 'add' | 'remove' | 'clear'
    | 'beforesync' | 'sync' | 'exception'
    | 'loadingchanged' | 'pagechanged' | 'pagechangeblocked'
    | 'sortchanged' | 'filterchange' | 'update';
//  ^ new this plan: 'beforeload', 'clear', 'exception', 'filterchange', 'update'
//  the collection/aggregation plan appends its own ('groupchange', …) to this union.

/** The proxy operation that failed. @category Data */
export type StoreOperation = 'read' | 'create' | 'update' | 'destroy';

/** Payload for the `'exception'` event. @category Data */
export interface StoreExceptionEvent {
    operation: StoreOperation;
    records  : ModelRecord[];   // offending record(s); empty for a read failure
    error    : unknown;
}

/** Payload for the `'clear'` event fired by removeAll(). @category Data */
export interface StoreClearEvent  { removed: ModelRecord[]; }

/** Payload for the `'filterchange'` event. @category Data */
export interface StoreFilterChangeEvent { filters: FilterDescriptor[]; }

/** Payload for the `'update'` event fired by notifyRecordChanged(). @category Data */
export interface StoreUpdateEvent { record: ModelRecord; }

export interface AbstractStoreOptions {
    // …existing fields…
    syncErrorPolicy?: 'stop' | 'continue';   // default 'stop'
}

// sync() contract change: resolves on failure (no longer rejects); failures surface
// via 'exception' events and the 'sync' payload.
sync(): Promise<void>;
```

Extended `proxy/Proxy.ts` — optional batch hooks (absence ⇒ per-record fallback):

```ts
export abstract class Proxy {
    // …existing abstract read/create/update/destroy…

    /** Batch-create; resolves to per-record server data in input order. @category Data */
    createBatch?(records: ModelRecord[]): Promise<Record<string, any>[]>;
    /** Batch-update; resolves to per-record server data in input order. @category Data */
    updateBatch?(records: ModelRecord[]): Promise<Record<string, any>[]>;
    /** Batch-destroy. @category Data */
    destroyBatch?(records: ModelRecord[]): Promise<void>;
}
```

Extended `proxy/AjaxProxy.ts` — implements the three batch hooks, serializing via the dependency plan's `Writer.writeRecords`:

```ts
createBatch(records: ModelRecord[]): Promise<Record<string, any>[]>;
updateBatch(records: ModelRecord[]): Promise<Record<string, any>[]>;
destroyBatch(records: ModelRecord[]): Promise<void>;
```

---

## Internal Structure

### `load()` with `'beforeload'` + `'exception'` (replaces the try/finally body at AbstractStore.ts:155-176)

```
async load(): Promise<void> {
    if (!this.proxy) { throw new Error('Store.load() called but no proxy is configured'); }

    this.emit('beforeload', {});      // before any in-flight guard from the dependency plan
    this.setLoading(true);

    try {
        const params = /* page/size (+ dependency-plan signal/remote params) */;
        const raw    = await this.proxy.read(params);

        // if the dependency plan's sequence guard says this load is superseded, return here
        // WITHOUT emitting 'exception' or 'load' (silent no-op).

        this.ingestRaw(raw);
        this._totalCount = this.proxy.getLastTotalCount();
        this.emit('load', { records: this._records });
    } catch (err) {
        // skip emit/throw for an aborted/superseded load per the dependency plan's guard
        this.emit('exception', { operation: 'read', records: [], error: err });
        throw err;                    // preserve the rejecting contract for awaiters
    } finally {
        this.setLoading(false);
    }
}
```

### `sync()` decomposed (replaces AbstractStore.ts:617-652)

Per CODE_CONVENTIONS "decompose large functions", `sync()` becomes a short orchestrator over three named phase helpers, each handling one op kind with the chosen batch/per-record path and the error policy:

```
async sync(): Promise<void> {
    if (!this.proxy) { return; }

    this.emit('beforesync', {});

    const failures: StoreExceptionEvent[] = [];

    const created = await this.syncCreates(failures);
    if (this.shouldStop(created, failures)) { /* finish early */ }
    else { await this.syncUpdates(failures); … await this.syncDeletes(failures); }

    this.emit('sync', { failures });
    this.emit('datachanged', {});
}
```

- `syncCreates(failures)` collects `_allRecords.filter(r => r.isNew())`. If `this.proxy.createBatch` exists, issue one batch call; else loop `create()` per record (today's path). On success, commit each record from its server data (the existing `for (const [k,v] of …) record.set(k,v); record.commit();` block, applied positionally for batches). On failure, push a `StoreExceptionEvent` and `emit('exception', …)`; obey `syncErrorPolicy`.
- `syncUpdates(failures)` — same shape over `r.isDirty() && !r.isNew()` with `update`/`updateBatch`.
- `syncDeletes(failures)` — over `_pendingRemoved` with `destroy`/`destroyBatch`; only clears `_pendingRemoved` for the records that successfully destroyed (failed ones stay pending — no partial-commit corruption).
- `shouldStop(...)` returns `true` when `syncErrorPolicy === 'stop'` and the just-run phase recorded a failure.

The "commit only after the op succeeds" invariant is preserved in every branch — that is the explicit success criterion to verify.

### `AjaxProxy` batch methods

`createBatch` POSTs `this._writer.writeRecords(records)` to `this._url`; `updateBatch` PUTs to `this._url` (collection-level batch update); `destroyBatch` DELETEs to `this._url` with the batch body. Each parses the response into an array of per-record server objects (unwrapped via `root` when configured) returned in input order. Non-OK → throw (the store's phase helper catches it into `'exception'`). Mirror the existing single-op fetch/throw shape ([AjaxProxy.ts:165-179](../src/typescript/lib/data/proxy/AjaxProxy.ts#L165)).

---

## Ordered Implementation Steps

1. **`AbstractStore.ts` — event types.** Extend the `StoreEvent` union ([line 29](../src/typescript/lib/data/AbstractStore.ts#L29)) with `'beforeload'`, `'clear'`, `'exception'`, `'filterchange'`, `'update'`. Add `StoreOperation`, `StoreExceptionEvent`, `StoreClearEvent`, `StoreFilterChangeEvent`, `StoreUpdateEvent` interfaces with `@category Data` JSDoc. → verify: `tsc --noEmit` clean.
2. **`AbstractStore.ts` — `syncErrorPolicy` option.** Add to `AbstractStoreOptions` ([line 50](../src/typescript/lib/data/AbstractStore.ts#L50)); cache into a backing field via `applyOptions` ([line 112](../src/typescript/lib/data/AbstractStore.ts#L112)). Field touched by no cascade setter (stores construct without `super()` applyOptions trap), so a plain `private _syncErrorPolicy: 'stop' | 'continue' = 'stop'` is fine — confirm AbstractStore is not a `Component` subclass (it is not).
3. **`Proxy.ts` — optional batch hooks.** Add the three optional `createBatch?`/`updateBatch?`/`destroyBatch?` signatures with JSDoc. → verify: no existing proxy breaks (optional).
4. **`AjaxProxy.ts` — batch methods.** Implement the three, serializing via the dependency plan's `Writer` (`this._writer.writeRecords`). → verify: existing `AjaxProxy.test.ts` unchanged; new batch tests pass.
5. **`AbstractStore.ts` — `load()`.** Emit `'beforeload'` before the read; wrap the read in try/catch emitting `'exception'` (`operation: 'read'`) then re-throwing; integrate with the dependency plan's superseded/abort guard so a stale load emits neither `'exception'` nor `'load'`. → verify: a failing-read test sees one `'exception'` and a rejected promise.
6. **`AbstractStore.ts` — `sync()`.** Replace the serial loop with the orchestrator + `syncCreates`/`syncUpdates`/`syncDeletes`/`shouldStop` helpers; batch when the proxy advertises it, per-record otherwise; honor `syncErrorPolicy`; emit `'exception'` per failed op; `sync()` resolves (no throw) and emits `'sync'` with `{ failures }`. Preserve commit-after-success. → verify: failure tests for stop vs continue; partial-commit invariant test.
7. **`AbstractStore.ts` — symmetric events.** `removeAll()` → emit `'clear'` ([line 524](../src/typescript/lib/data/AbstractStore.ts#L524) area); `filter`/`filterBy`/`clearFilter` → emit `'filterchange'` ([lines 749-795](../src/typescript/lib/data/AbstractStore.ts#L749)); `notifyRecordChanged` → emit `'update'` and un-underscore the param ([line 541](../src/typescript/lib/data/AbstractStore.ts#L541)). Use `getActiveFilters()` (from the dependency plan; add it here only if absent). → verify: each site fires the new event plus the existing `'datachanged'`.
8. **`index.ts` — exports.** Add `type` exports for `StoreOperation`, `StoreExceptionEvent`, `StoreClearEvent`, `StoreFilterChangeEvent`, `StoreUpdateEvent` to the existing `AbstractStore.js` `export type { … }` line ([index.ts:10](../src/typescript/lib/data/index.ts#L10)). → verify: `npm run docs:build` resolves the new symbols.
9. **Regression checkpoint.** `grep -n "emit('datachanged'" src/typescript/lib/data/AbstractStore.ts` — every pre-existing `'datachanged'` emit is still present (additive, not replaced).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/data/AbstractStore.ts` (event union + payloads, `syncErrorPolicy`, `load()`/`sync()` rewrite, `'clear'`/`'filterchange'`/`'update'` emits) |
| Modify | `src/typescript/lib/data/proxy/Proxy.ts` (optional batch hooks) |
| Modify | `src/typescript/lib/data/proxy/AjaxProxy.ts` (batch method impls via `Writer`) |
| Modify | `src/typescript/lib/data/index.ts` (export new payload/operation types) |
| Modify | `docs/data/store.md` (event table + sync-error-policy section) |
| Modify | `tests/unit/data/AbstractStore.test.ts` (or sibling) — sync failure / events |
| Modify | `tests/unit/data/proxy/AjaxProxy.test.ts` — batch methods |

(Test file paths assumed under `tests/unit/data/`; the implementer confirms the existing layout before adding.)

---

## Verification

- **Typecheck:** `npm run build` (or `tsc --noEmit`) — 0 errors. Watch the `Proxy.ts` batch hooks referencing `ModelRecord` (already imported there).
- **Unit tests:**
  - `load()` failure emits exactly one `'exception'` (`operation: 'read'`, empty `records`) and still rejects.
  - `'beforeload'` fires before the proxy read resolves.
  - `sync()` with `syncErrorPolicy: 'stop'`: a failing create stops the run, the failing record stays new/pending, no update/destroy runs, `sync()` resolves, `'sync'` payload lists the failure.
  - `sync()` with `syncErrorPolicy: 'continue'`: all phases run; each failure yields an `'exception'`; successful records are committed, failed ones remain pending.
  - **Partial-commit invariant:** a create that succeeds and a later create that fails — the succeeded record is committed, the failed one is not.
  - Batch path: a proxy exposing `createBatch` issues one call; commit applies positionally; a batch failure leaves all batch records pending and `'exception'.records` holds the whole batch.
  - `removeAll()` fires `'clear'` with the removed set; `filter`/`clearFilter` fire `'filterchange'` with the active filters; `notifyRecordChanged(r)` fires `'update'` with `r`.
- **Grep invariant:** step 9 checkpoint (all original `'datachanged'` emits intact).
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone allowed warning); confirm the new payload types land under `docs/api/data/`.
- **Manual smoke:** the data demo / any `TablePanel` toolbar — add + edit + remove records, then sync against a stub proxy that fails one op; confirm an `'exception'` listener fires and the table's pending-changes state is consistent.

---

## Documentation Impact

- **Barrel:** the new types (`StoreOperation`, `StoreExceptionEvent`, `StoreClearEvent`, `StoreFilterChangeEvent`, `StoreUpdateEvent`) re-export from `src/typescript/lib/data/index.ts` (the data subpath barrel — there is no root barrel). Each carries `@category Data`. The `StoreEvent` union and `AbstractStoreOptions` are already exported; the union just grows.
- **Curated page:** `docs/data/store.md` — extend the Events table ([lines 187-194](../docs/data/store.md)) with `beforeload`, `clear`, `filterchange`, `update`, and `exception` rows; add a short "Sync error handling" subsection documenting `syncErrorPolicy` and the new "sync resolves, inspect `'exception'`" contract. Note the batched-sync coarser commit granularity.
- **Catalog/sidebar:** no new page file, so `docs/data/index.md` and `docs/.vitepress/config.mts` need no new entries.
- **Cross-bucket JSDoc:** all new references stay within the `data` bucket, so `{@link …}` resolves; no cross-bucket markdown links needed.
- **Contract change to flag:** `sync()` no longer rejecting is consumer-visible — call it out in `store.md` and the `sync()` JSDoc so existing `try { await store.sync() } catch` sites know to switch to the `'exception'` event / `'sync'` payload.

---

## Potential Challenges

- **Merge order with the sibling collection/aggregation plan on `StoreEvent`.** Mitigation: each plan adds only its own literals; whichever lands second rebases its literals onto the union the first produced (one-line conflict at most).
- **Overlap with the dependency plan's `getActiveFilters()` and `load()` guard.** Mitigation: `depends-on` orders this plan second; consume `getActiveFilters()` and the superseded/abort guard rather than re-introducing them — emit `'exception'`/`'load'` only inside the "not superseded" branch.
- **Batch commit-by-position fragility.** Mitigation: the batch contract specifies server data is returned in input order; if a proxy can't honor that, it simply doesn't implement the batch hook and falls back to per-record (which keys commit to the record it just sent).
- **`sync()` no longer rejecting silently breaks existing `catch` sites.** Mitigation: documented contract change + `'sync'` payload `failures` + `'exception'` events give callers a migration path; flagged in docs and JSDoc.
- **`syncErrorPolicy: 'continue'` could fire many `'exception'` events.** Mitigation: that is intended (one per failed op); the terminal `'sync'` payload aggregates them so a listener can react once at the end instead.

---

## Critical Files

- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) — `StoreEvent`/`AbstractStoreOptions`, `load()`, `sync()`, `removeAll()`, `filter`/`filterBy`/`clearFilter`, `notifyRecordChanged`, `emit`, `getActiveSorters`/`getActiveFilters`.
- [`src/typescript/lib/data/proxy/Proxy.ts`](../src/typescript/lib/data/proxy/Proxy.ts) — the abstract CRUD contract the batch hooks extend.
- [`src/typescript/lib/data/proxy/AjaxProxy.ts`](../src/typescript/lib/data/proxy/AjaxProxy.ts) — single-op fetch/throw shape the batch methods mirror; the `Writer` it gains from the dependency plan.
- [`src/typescript/lib/data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) — `isNew`/`isDirty`/`commit`/`getData`/`getId` used by `sync()` and the writer.
- [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts) — the export surface.
- [`plans/data-proxy-reader-writer.md`](./data-proxy-reader-writer.md) — the `Writer`/`writeRecords`, `getActiveFilters()`, and `load()` concurrency guard this plan builds on.

---

## Non-Goals

- **Collection / query / aggregation / grouping / comparator changes and their events** — owned by `data-store-collection-and-aggregation`. This plan owns no `'groupchange'`/aggregation event.
- **Reader/Writer abstraction, remote sort/filter, load concurrency guard, `WebStorageProxy`** — owned by `data-proxy-reader-writer` (the dependency). This plan consumes its `Writer`/`getActiveFilters()`/load-guard outputs, it does not redefine them.
- **Retry/backoff, optimistic-UI rollback of committed records, transactions** — `'exception'` + `syncErrorPolicy` is the agreed surface; richer recovery is out.
- **Validation and associations** — separate plans.
- **Reworking `'datachanged'`** — it stays as the broad companion notification; the new events are additive specifics, not replacements.
