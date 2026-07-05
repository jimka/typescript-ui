# Store Mutation Correctness Fixes — Implementation Plan

## Overview

Seven independent fixes to the data layer, concentrated in [`src/typescript/lib/data/AbstractStore.ts`](src/typescript/lib/data/AbstractStore.ts) and its neighbours [`ModelRecord.ts`](src/typescript/lib/data/ModelRecord.ts), [`TreeStore.ts`](src/typescript/lib/data/TreeStore.ts), [`StoreWorkerClient.ts`](src/typescript/lib/data/StoreWorkerClient.ts), [`StoreWorker.ts`](src/typescript/lib/data/StoreWorker.ts), [`MemoryStore.ts`](src/typescript/lib/data/MemoryStore.ts), and [`AjaxStore.ts`](src/typescript/lib/data/AjaxStore.ts). Four are correctness bugs (a stale id-index after `removeAll`, surviving pending removals across a reload, `add`/`insert` duplication, and a dirty-tracking key-source mismatch in `ModelRecord`); three are hygiene fixes (a leaky base event union, dead worker `sort`/`filter` methods, and two files missing the house import/licence conventions).

The changes are surgical and mutually independent — each can land on its own — but they share a file, so they are planned together. This layer is well unit-tested (offline, no DOM), so every behavioural fix gets an automated red-green test.

---

## Architecture Decisions

### `removeAll()` rebuilds the view like every other mutation

`getById()` reads `_idIndex` ([AbstractStore.ts:664-666](src/typescript/lib/data/AbstractStore.ts#L664)), which is only ever cleared/rebuilt inside `rebuildIdIndex()` ([:1896-1906](src/typescript/lib/data/AbstractStore.ts#L1896)), called from `applyView()` ([:1810-1811](src/typescript/lib/data/AbstractStore.ts#L1810)). Every mutation path — `add`, `insert`, `remove`, `appendRecords`, `reject`, `ingestRaw` — funnels through `applyView()`. `removeAll()` ([:869-883](src/typescript/lib/data/AbstractStore.ts#L869)) is the sole exception: it assigns `_allRecords = []` and `_records = []` directly and never calls `applyView()`, so `_idIndex` retains the removed records and `getById(id)` returns a stale, detached record after a clear.

The fix routes `removeAll()` through `applyView()` like its siblings rather than special-casing an `_idIndex.clear()`. With `_allRecords` empty, `applyView()` runs synchronously (empty array is below `WORKER_THRESHOLD`), clears the id-index, and sets `_records = []` — reproducing the manual assignment while also fixing the index. This keeps `removeAll` consistent with the rest of the class and removes the now-redundant `this._records = []`.

### `load()`/`loadData()` discard pending removals — fix the code, keep the contract

`load()`'s JSDoc promises "Any existing records (including pending removals) are discarded when new data is ingested" ([:304-306](src/typescript/lib/data/AbstractStore.ts#L304)). But `ingestRaw()` ([:598-605](src/typescript/lib/data/AbstractStore.ts#L598)) — the shared ingest path behind both `load()` and `loadData()` ([:429-442](src/typescript/lib/data/AbstractStore.ts#L429)) — only replaces `_allRecords`; it never resets `_pendingRemoved`. That queue is cleared only on `syncDeletes` success ([:1253](src/typescript/lib/data/AbstractStore.ts#L1253), [:1278](src/typescript/lib/data/AbstractStore.ts#L1278)) and in `reject()` ([:1050](src/typescript/lib/data/AbstractStore.ts#L1050)). So a `remove()` on a persisted record, followed by a reload, leaves the delete queued; the next `sync()` sends a `destroy` for a record that is no longer part of the freshly-loaded dataset — silent, out-of-band data loss.

**Decision: the code is wrong; add the reset.** Keeping the JSDoc contract is the safer resolution. A reload replaces the store's contents with a fresh authoritative snapshot; a delete queued against the *previous* snapshot has undefined meaning against the new one (the target record may not even exist in it), and letting it fire risks destroying a server row the user never asked to delete. The alternative — loosening the JSDoc so pending removals survive a reload — codifies exactly that hazard. The reset lives in `ingestRaw()` so both `load()` and `loadData()` are fixed at one site. The queued records were already ownership-released by `remove()` ([:847](src/typescript/lib/data/AbstractStore.ts#L847)), so clearing the array is sufficient — no `setOwnership` call is needed.

### `add`/`insert` share a private `insertAt(index | null, data)`

`add()` ([:771-790](src/typescript/lib/data/AbstractStore.ts#L771)) and `insert()` ([:807-828](src/typescript/lib/data/AbstractStore.ts#L807)) are line-for-line identical — map→`createRecord`→`markAsNew`, `setOwnership(added, true)`, `_snapshotDirty = true`, `applyView()`, `emit('add')`, `emit('datachanged')`, `return added` — differing only in `push(...added)` vs `splice(at, 0, ...added)`. Extract the shared body into a private `insertAt(index: number | null, data)`: `null` appends, a number splices at the clamped position. `add`/`insert` become one-line delegations that keep their existing public JSDoc. This is the sanctioned "extract reusable mechanics" carve-out — one helper deletes a whole duplicated method body.

### `ModelRecord` dirty-tracking unifies on `_data` keys

`applySet` ([:321-322](src/typescript/lib/data/ModelRecord.ts#L321)) and `cancelEdit` ([:292-293](src/typescript/lib/data/ModelRecord.ts#L292)) recompute `_dirty` over `Object.keys(this._original)`, whereas `getChanges` ([:733](src/typescript/lib/data/ModelRecord.ts#L733)) and `commitEdit` ([:256](src/typescript/lib/data/ModelRecord.ts#L256)) iterate `Object.keys(this._data)`. Setting a field that was absent from the original construction data (e.g. `record.set('newField', x)`) adds a key to `_data` but not `_original`, so `isDirty()` returns `false` while `getChanges()` reports the field — the two disagree.

`_data` is always a superset of `_original`: the constructor ([:96-97](src/typescript/lib/data/ModelRecord.ts#L96)) seeds both from the same object, `commit()` resyncs `_original = {...this._data}` ([:511](src/typescript/lib/data/ModelRecord.ts#L511)), `reject()` copies `_data = {...this._original}` ([:526](src/typescript/lib/data/ModelRecord.ts#L526)), `cancelEdit` copies from a snapshot that was itself `{...this._data}`, and only `applySet` ever *adds* a key — always to `_data`. So iterating `_data` keys covers every `_original` key too, and it correctly counts a newly-introduced field as a change (matching `getChanges`). Unify the two dirty-recompute sites on `Object.keys(this._data)`.

Because the recompute expression is now identical at both sites and is the exact logic that just drifted, extract it into a private `recomputeDirty(): void` and call it from both `applySet` and `cancelEdit`, so the two can never diverge again.

### Tree events move off the base `StoreEvent` union onto `TreeStore`

The base `StoreEvent` union bakes in `'expand' | 'collapse' | 'append' | 'removenode'` ([AbstractStore.ts:30](src/typescript/lib/data/AbstractStore.ts#L30)), but only `TreeStore` emits them ([TreeStore.ts:531, 562, 587](src/typescript/lib/data/TreeStore.ts#L531)). `TreeStore.TreeStoreEvent` re-declares the same four ([TreeStore.ts:16](src/typescript/lib/data/TreeStore.ts#L16)), and `onTree` casts `event as StoreEvent` ([TreeStore.ts:654-656](src/typescript/lib/data/TreeStore.ts#L654)) — a cast that only compiles because the base still lists them. This lets a plain non-tree `Store` accept `store.on('expand', …)`, which is meaningless.

Remove the four tree events from the base union. The base's `on`/`off`/`emit`/`_listeners` stay typed to the narrowed `StoreEvent`. `TreeStore` — an emitting subclass that adds events — takes over the full surface by overriding the three forwarders to the widened `StoreEvent | TreeStoreEvent`, each delegating to `super` with an `as StoreEvent` narrowing cast (valid because the union contains `StoreEvent`; the underlying `ListenerBag<StoreEvent>` stores tree keys fine at runtime). `onTree` is kept for backward compatibility (public API, used by tests) but simplified to delegate to the now-widened `on` without a cast. This is a **type-surface fix, not a rename** — no event string changes, and the tense inconsistencies (`sortchanged` vs `filterchange`) are explicitly out of scope (owned by `api-naming-harmonization`).

### Dead worker `sort`/`filter` removed together with their protocol branches and tests

`StoreWorkerClient.sort()` and `.filter()` ([StoreWorkerClient.ts:93-102](src/typescript/lib/data/StoreWorkerClient.ts#L93)) have no production callers — `applyViewOnWorker` uses only `snapshot`, `sortFilter`, and `isAvailable` ([AbstractStore.ts:1813, 1923, 1934](src/typescript/lib/data/AbstractStore.ts#L1813)). The standalone `sort` even drops `fieldType`, so it could not stay in comparator parity with the main thread anyway. Remove both methods, the `"sort"`/`"filter"` arms of the `StoreWorker` `Request` union and message handler ([StoreWorker.ts:20-21, 68-78](src/typescript/lib/data/StoreWorker.ts#L20)) that exist only to serve them, and the three `StoreWorkerClient.test.ts` cases that exercise them ([tests/unit/data/StoreWorkerClient.test.ts:36-37, 99-148](tests/unit/data/StoreWorkerClient.test.ts#L36)). `snapshot`/`sortFilter`/`isAvailable` and all their tests stay.

### `MemoryStore`/`AjaxStore` conform to house import + licence conventions

`MemoryStore.ts` and `AjaxStore.ts` are the only two files under `data/` missing the `// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0` header every sibling carries, and they use double-quoted imports without the `.js` extension ([MemoryStore.ts:1-3](src/typescript/lib/data/MemoryStore.ts#L1), [AjaxStore.ts:1-3](src/typescript/lib/data/AjaxStore.ts#L1)) against the single-quote-with-`.js` house style used by `AbstractStore.ts` and the rest of the barrel. Add the header and rewrite the imports. Pure convention alignment; no behavioural change.

---

## Public API

Base `StoreEvent` narrows (removes four members); `TreeStore` gains overrides that widen its own surface. No new consumer-facing methods.

```typescript
// AbstractStore.ts — tree events removed
export type StoreEvent =
    | 'load' | 'beforeload' | 'datachanged' | 'add' | 'remove' | 'clear'
    | 'beforesync' | 'sync' | 'exception' | 'loadingchanged' | 'pagechanged'
    | 'pagechangeblocked' | 'sortchanged' | 'filterchange' | 'update' | 'groupchange';
```

```typescript
// TreeStore.ts — widened forwarders over the inherited surface
override on(event: StoreEvent | TreeStoreEvent, listener: StoreListener): this;
override off(event: StoreEvent | TreeStoreEvent, listener: StoreListener): this;
protected override emit(event: StoreEvent | TreeStoreEvent, payload: any): void;
onTree(event: TreeStoreEvent, listener: StoreListener): this; // kept; cast removed
```

```typescript
// AbstractStore.ts — new private helper, backing add()/insert()
private insertAt(index: number | null, data: any | any[]): ModelRecord[];
```

```typescript
// ModelRecord.ts — new private helper, backing applySet()/cancelEdit()
private recomputeDirty(): void;
```

---

## Ordered Implementation Steps

1. **`removeAll()` id-index fix** — in [AbstractStore.ts:869-883](src/typescript/lib/data/AbstractStore.ts#L869), drop `this._records = []` and call `this.applyView()` after `this._allRecords = []; this._snapshotDirty = true;`, before the two `emit`s. → verify: new test `getById returns undefined after removeAll` goes red→green.

2. **`ingestRaw()` pending-removal reset** — in [AbstractStore.ts:598-605](src/typescript/lib/data/AbstractStore.ts#L598), add `this._pendingRemoved = [];` (records already released by `remove()`). → verify: new test `load()/loadData() discards queued removals` goes red→green.

3. **Extract `insertAt`** — add the private helper; rewrite `add()` as `return this.insertAt(null, data);` and `insert()` as `return this.insertAt(index, data);`, preserving their JSDoc. → verify: existing add/insert tests stay green; new parity test passes.

4. **`ModelRecord` dirty unification** — add `private recomputeDirty(): void` computing `this._isNew || Object.keys(this._data).some(k => !ModelRecord.isEqual(this._data[k], this._original[k]))`; call it from `applySet` ([:321-322](src/typescript/lib/data/ModelRecord.ts#L321)) and `cancelEdit` ([:292-293](src/typescript/lib/data/ModelRecord.ts#L292)) in place of the inline expressions. → verify: new symmetry test passes; existing `ModelRecord.test.ts` stays green.

5. **Tree-event surface** — remove `'expand' | 'collapse' | 'append' | 'removenode'` from `StoreEvent` ([AbstractStore.ts:30](src/typescript/lib/data/AbstractStore.ts#L30)); in `TreeStore` add the three widened overrides and drop the cast from `onTree`. → verify: `npm run typecheck` passes; `TreeStore.test.ts` (`onTree('expand'/'collapse'/'append')`) stays green.

6. **Worker dead code** — delete `sort`/`filter` from `StoreWorkerClient` ([:93-102](src/typescript/lib/data/StoreWorkerClient.ts#L93)); remove the `"sort"`/`"filter"` `Request` members and collapse the handler branches to the `sortFilter` forms in `StoreWorker.ts` ([:20-21, 68-78](src/typescript/lib/data/StoreWorker.ts#L20)); delete the three `.sort()`/`.filter()` cases in `StoreWorkerClient.test.ts`. → verify: `grep -rn 'StoreWorkerClient\.\(sort\|filter\)(' src/` — expect zero matches; `npm test` green.

7. **Convention alignment** — prepend the SPDX header to `MemoryStore.ts`/`AjaxStore.ts` and rewrite their three imports each to single quotes with `.js`. → verify: `head -1` shows the header; `npm run typecheck` and `vite build` pass.

8. **Full gate** — `npm test` (runs `typecheck:test` then vitest) and `npm run build`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/data/AbstractStore.ts` (removeAll, ingestRaw, add/insert→insertAt, StoreEvent union) |
| Modify | `src/typescript/lib/data/ModelRecord.ts` (recomputeDirty, applySet, cancelEdit) |
| Modify | `src/typescript/lib/data/TreeStore.ts` (on/off/emit overrides, onTree cast removed) |
| Modify | `src/typescript/lib/data/StoreWorkerClient.ts` (remove sort/filter) |
| Modify | `src/typescript/lib/data/StoreWorker.ts` (remove sort/filter Request arms + branches) |
| Modify | `src/typescript/lib/data/MemoryStore.ts` (SPDX header, import style) |
| Modify | `src/typescript/lib/data/AjaxStore.ts` (SPDX header, import style) |
| Modify | `tests/unit/data/MemoryStore.test.ts` (removeAll+getById, load+pending-removal, insert parity) |
| Modify | `tests/unit/data/ModelRecord.test.ts` (dirty/getChanges symmetry) |
| Modify | `tests/unit/data/StoreWorkerClient.test.ts` (drop sort/filter cases) |

---

## Expected Behaviour

All behaviours below are **unit-testable offline** (this layer has no DOM dependency). The type-surface change in item 5 (a plain `Store` rejecting `.on('expand', …)`) is **typecheck-verified**, not runtime-testable.

### `removeAll()` + `getById()`
- After `store.removeAll()`, `getById(id)` returns `undefined` for every id that was present.
- `getCount()` is `0` and `getAll()` is empty after `removeAll()`.
- The `'clear'` and `'datachanged'` events still fire, with the `'clear'` payload's `removed` array carrying every prior record (unchanged from today).
- A record removed by `removeAll()` no longer notifies the store on subsequent `set()` (existing "clears every back-ref on removeAll" test still passes).

### `load()` / `loadData()` discard pending removals
- `remove(persistedRecord)` then `loadData(freshData)` leaves `hasPendingChanges()` === `false` (no queued delete survives).
- After the reload, a `sync()` issues **no** `destroy` for the previously-removed record.
- New/dirty records from before the reload are already dropped by the wholesale `_allRecords` replacement (unchanged); this fix only additionally clears the removal queue.
- `getById` after reload resolves against the new dataset only.

### `insertAt` (via `add` / `insert`)
- `add(obj)` appends to the master list; `insert(i, obj)` splices at `clamp(i, 0, len)`; both return an array of the created `ModelRecord`s marked new (`isNew()` true).
- `insert` with `index < 0` inserts at 0; `index > len` appends — same clamp as today.
- Both fire exactly one `'add'` (payload `{ records }`) followed by one `'datachanged'`.
- Passing a single object vs an array yields, respectively, a one-element vs N-element result; array order is preserved at the insertion point.
- The visible position still reflects any active sort/filter (insertion index is into the master list, not the view).

### `ModelRecord` dirty/`getChanges` symmetry
- `record.set('fieldNotInOriginalData', v)` makes `isDirty()` === `true` **and** `getChanges()` include that field with `{ old: undefined, new: v }` — the two agree.
- Setting a field back to its original value clears it from both `isDirty()` and `getChanges()`.
- A new record (`isNew()`) is dirty regardless of field equality (the `_isNew ||` short-circuit is preserved).
- `cancelEdit()` after mutating a not-in-original field recomputes `isDirty()` consistently with `getChanges()` (both empty once reverted to snapshot).
- `commit()` then re-checking leaves `isDirty()` false and `getChanges()` empty (baseline resynced).

### Tree events (typecheck-verified)
- `treeStore.on('expand', fn)` and `treeStore.onTree('expand', fn)` both compile and both register a working listener that fires on node expand.
- `treeStore.emit('expand', …)` internal path still dispatches (runtime: existing `TreeStore.test.ts` expand/collapse/append assertions pass).
- A plain `Store` (non-tree) `store.on('expand', fn)` is a **compile error** (member no longer in `StoreEvent`).

---

## Verification

- `npm test` — runs `typecheck:test` then vitest; all new and existing data-layer tests green.
- `npm run typecheck` — library typecheck passes (covers the `StoreEvent` narrowing and the `TreeStore` overrides).
- `npm run build` — Vite build succeeds (exercises the `?worker` import after the `StoreWorker` protocol trim).
- `grep -rn 'StoreWorkerClient\.\(sort\|filter\)(' src/` — expect zero matches.
- `grep -c 'expand' <(sed -n '30p' src/typescript/lib/data/AbstractStore.ts)` — expect zero (tree events gone from base union).
- `head -1 src/typescript/lib/data/MemoryStore.ts src/typescript/lib/data/AjaxStore.ts` — both show the SPDX header.
- Test entry points: `tests/unit/data/MemoryStore.test.ts`, `tests/unit/data/ModelRecord.test.ts`, `tests/unit/data/TreeStore.test.ts`, `tests/unit/data/StoreWorkerClient.test.ts`.

---

## Documentation Impact

None of the changes alter a documented public signature in a way that needs a docs page rewrite:

- `load()`'s JSDoc contract ([:304-306](src/typescript/lib/data/AbstractStore.ts#L304)) is now *satisfied* rather than changed — no edit needed, but confirm the wording still reads true after the `ingestRaw` reset.
- The `StoreEvent` narrowing removes four members that were never valid on a non-tree store; if any prose doc enumerates base store events, drop the tree names there. `grep -rln "'expand'\|'collapse'\|'removenode'" docs/` before editing.
- `add`/`insert`/`removeAll`/`getById`/`isDirty`/`getChanges` keep their signatures and JSDoc; run `npm run docs:build` and confirm zero warnings (the `insertAt`/`recomputeDirty` helpers are private and excluded from TypeDoc).

---

## Potential Challenges

- **`emit` override visibility** — the base `emit` is `protected`; `TreeStore`'s override must also be `protected` and its widened param is contravariantly safe under TS's bivariant method checks. Verify with `npm run typecheck`, not by eye.
- **`removeAll` via `applyView` and the worker path** — `applyView()` only offloads to the worker above `WORKER_THRESHOLD`; with `_allRecords` empty it always runs synchronously, so `_records`/`_idIndex` are settled before the `emit`s. No async ordering change.
- **`StoreWorker` branch collapse** — after removing the `"sort"`/`"filter"` `Request` arms, the handler's `msg.type === 'filter' ? … : msg.filter!` and `msg.type === 'sort' ? … : msg.sort!` ternaries simplify to the `sortFilter`-only forms; take care the narrowed union still typechecks (only `snapshot` and `sortFilter` remain).
- **Test coupling** — `StoreWorkerClient.test.ts` asserts `postMessage` payloads for `sort`/`filter`; those exact cases must be deleted (not rewritten to `sortFilter`, which is already covered) so the suite matches the trimmed surface.

---

## Critical Files

- [`src/typescript/lib/data/AbstractStore.ts`](src/typescript/lib/data/AbstractStore.ts) — `applyView`/`rebuildIdIndex`, `ingestRaw`/`loadData`, `add`/`insert`/`remove`/`removeAll`, `on`/`off`/`emit`, `StoreEvent`.
- [`src/typescript/lib/data/ModelRecord.ts`](src/typescript/lib/data/ModelRecord.ts) — `applySet`, `cancelEdit`, `commitEdit`, `getChanges`, `commit`, `reject`, the `_data`/`_original` invariant.
- [`src/typescript/lib/data/TreeStore.ts`](src/typescript/lib/data/TreeStore.ts) — `TreeStoreEvent`, emit sites, `onTree`.
- [`src/typescript/lib/core/ListenerBag.ts`](src/typescript/lib/core/ListenerBag.ts) — the `ListenerBag<TEvent>` the store forwarders wrap.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the typed `on`/`off`/`emit` + `ListenerBag` event-surface rule the `TreeStore` overrides follow.
- [`tests/unit/data/MemoryStore.test.ts`](tests/unit/data/MemoryStore.test.ts) — `makeStore` helper + existing removeAll/reject patterns to mirror.

---

## Non-Goals

- **Store event-name tense harmonization** (`sortchanged` vs `filterchange`, etc.) — owned by `api-naming-harmonization`; this plan changes no event *strings*, only which union lists them.
- **Multi-column sort on the worker path** — the worker protocol accepts a single sorter, so multi-sort degrades to the primary sorter above `WORKER_THRESHOLD` ([AbstractStore.ts:1915-1919](src/typescript/lib/data/AbstractStore.ts#L1915)). This is a documented limitation, not fixed here.
- **Broader untested store surface** (aggregation, grouping, pagination) — owned by the separate `test-coverage-backfill` plan; tests here cover only the four behaviours this plan changes.
- **Removing `onTree`** — flagged as redundant, but it is public API used by tests; it is kept (cast removed), not deleted.
- **`StoreWorkerClient.ts`/`StoreWorker.ts` import style** — those use double quotes *with* `.js`, a separate lint concern outside this plan's convention scope (which targets the two files missing SPDX + `.js`).
