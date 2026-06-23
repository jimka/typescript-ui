# Record-to-Store Change Propagation (Auto-Notify) — Implementation Plan

## Overview

Make a `ModelRecord.set()` on a **store-owned** record automatically notify its owning store, so sibling views bound to the same store instance refresh on `'datachanged'` without a manual `store.notifyRecordChanged(record)`. The notify is gated by three layers of suppression — record-level edit batches, a store-level batch flag, and an explicit silent path — so bulk loads and framework-driven mutations don't storm the event surface.

The change is confined to the data layer: [`ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) gains an optional back-ref to its owning store, a record-level edit batch (`beginEdit`/`commitEdit`), a silent write (`setSilent`), and `setMany`; [`AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) gains an `@internal` adopt/release pair stamped at the `_allRecords` mutation choke points, a store-level batch (`beginEdit`/`commitEdit`), and an extended `'update'` payload. [`TreeStore.ts`](../src/typescript/lib/data/TreeStore.ts) needs **no** new mutation sites — it grows `_allRecords` only through the inherited `add`/`insert`/`remove`/`removeAll`/`loadData`/`appendRecords`, all of which become adoption choke points in the base.

The ownership-as-gate design makes load-time population silent for free: [`AbstractModel.createRecord`](../src/typescript/lib/data/AbstractModel.ts#L192) populates every field via `set()` (through `convertValue` then field assignment) **before** the store adopts the record, so the back-ref is still unset and `set()` cannot notify. No load-path flag is needed.

---

## Architecture Decisions

### Ownership back-ref is the primary suppression gate

`ModelRecord` carries `private _store: AbstractStore | null = null`, unset at construction. The store stamps it **only** when a record enters `_allRecords` and clears it when the record leaves. `set()` notifies through this ref; an un-adopted record (mid-`createRecord`, a freestanding `new ModelRecord(...)`, a `clone()`) has `_store === null` and stays silent. This is what makes bulk load silent without a load flag — `createRecord` runs every `set()` before adoption.

### Adoption is an `@internal` method pair on `ModelRecord`, called only by `AbstractStore`

The store must write a private field on the record without leaking it onto the public API. The codebase's convention for framework-only surface is a JSDoc `@internal` tag on a real public method (see `Component.getAriaElement` at [Component.ts:3524](../src/typescript/lib/core/Component.ts#L3524) and `TreeBody`'s reparent wiring). TypeScript has no package-private modifier, so follow that convention:

```typescript
/** @internal Framework wiring; set by AbstractStore when it adopts the record. */
adoptedBy(store: AbstractStore): void  // sets this._store = store
/** @internal Framework wiring; cleared by AbstractStore when the record leaves. */
released(): void                        // sets this._store = null
```

Both are excluded from the typedoc API surface by the `@internal` tag (the project already strips `@internal` from docs). The back-ref field stays `private`; only these two methods touch it from outside.

### Default per-`set()` notify, preserving the no-op short-circuit

`set()` keeps its existing early return when `ModelRecord.isEqual(old, converted)` holds, so no-op writes never notify. After a real mutation, `set()` calls a private `notifyStore(changes)` helper that fires **only when** `this._store !== null` **and** not suppressed (record-editing or store-batching, below). The single-field case carries a one-entry `changes` map.

### Record-level batch extends the `'update'` payload with `changes`

`StoreUpdateEvent` ([AbstractStore.ts:80](../src/typescript/lib/data/AbstractStore.ts#L80)) gains an optional `changes?: Record<string, FieldChange>`. `beginEdit()` sets a record flag and snapshots `{ ...this._data }`; while the flag is set, `set()` updates `_data` + dirty but does **not** notify. `commitEdit()` clears the flag, diffs current `_data` against the snapshot into a `Record<string, FieldChange>` (reusing the same `isEqual` comparison `getChanges` uses), and fires **one** `notifyStore(changes)` — but only when the diff is non-empty (an all-no-op batch stays silent). Extending the existing event rather than adding a new one keeps every current `'update'` listener working: `changes` is optional and the single-`set()` path also populates it, so listeners that want field-level granularity get it uniformly.

`cancelEdit()` (discard the batch, revert `_data` to the snapshot) is **in scope** — it is the natural complement to `beginEdit`, mirrors the existing `reject()` semantics at batch granularity, and is cheap given the snapshot already exists. It clears the flag, restores `_data` from the snapshot, recomputes the dirty flag, and fires nothing.

### Store-level batch is a flag on `AbstractStore`, coalescing to one `'datachanged'`

`AbstractStore.beginEdit()` sets `private _batching: boolean`. Each record's `set()` reaches the flag through its back-ref (`this._store?.isBatching()`) and suppresses its own notify when set. `AbstractStore.commitEdit()` clears the flag and fires **one** `'datachanged'`. It deliberately emits **only** `'datachanged'`, not per-record `'update'`s: the store batch is the "many records changed, refresh the whole view once" path, and views bind their refresh to `'datachanged'` ([Body.bindStore](../src/typescript/lib/component/table/Body.ts#L135)); replaying N `'update'`s would defeat the coalescing the batch exists to provide. A consumer that needs per-record granularity uses the record-level batch instead. The record's effective notify rule is: **notify iff `_store !== null` AND NOT (record-editing OR store-batching)**.

### Silent path is `setSilent(field, value)`

A dedicated method, not a boolean option on `set()`. `setSilent` performs the identical convert + equality-gate + `_data`/dirty update as `set()` but never calls `notifyStore`. A separate method (vs. a `{ silent }` options arg) reads clearly at the framework call sites, keeps `set()`'s hot signature unchanged, and matches the convention of distinct verbs elsewhere (`commit`/`reject`). The shared body is extracted into a private `applySet(field, value): boolean` returning whether a real change occurred, so `set` and `setSilent` differ only in the trailing notify.

### Framework-internal `set()` call sites that must switch to `setSilent`

Audited the data-layer internal `set()` sites against the new auto-notify:

- **`AbstractStore.stampForeignKeys`** ([AbstractStore.ts:1058](../src/typescript/lib/data/AbstractStore.ts#L1058)) — `record.set(fk, parentId)` on live, store-owned child records mid-cascade-sync. Sync already emits its own `'sync'`/`'datachanged'`; an auto-notify here would double-fire per child. **Must use `setSilent`.**
- **`AbstractStore.commitFromServerData`** ([AbstractStore.ts:1222](../src/typescript/lib/data/AbstractStore.ts#L1222)) — writes each server field onto an owned record, then `record.commit()`. This runs inside `sync()`, which fires its own `'sync'`/`'datachanged'` at the end. Auto-notify here would fire one `'update'` per server field per record. **Must use `setSilent`.**
- `TreeStore` — no direct `record.set()` calls; its mutations route through inherited base methods. No change needed.

`ModelRecord.clone()` ([ModelRecord.ts:533](../src/typescript/lib/data/ModelRecord.ts#L533)) constructs a fresh, un-adopted record and writes `_dirty` directly (not via `set`), so it is already silent and the clone's `_store` is `null` — correct, a clone belongs to no store until added.

### Adoption choke points in `_allRecords`

Every site that mutates `_allRecords` must stamp or clear the ref. Enumerated:

| Site | Action |
|---|---|
| `ingestRaw` ([AbstractStore.ts:568](../src/typescript/lib/data/AbstractStore.ts#L568)) | replaces `_allRecords`; **release** old set, **adopt** new set |
| `add` ([AbstractStore.ts:738](../src/typescript/lib/data/AbstractStore.ts#L738)) | **adopt** each added record |
| `insert` ([AbstractStore.ts:773](../src/typescript/lib/data/AbstractStore.ts#L773)) | **adopt** each inserted record |
| `remove` ([AbstractStore.ts:805](../src/typescript/lib/data/AbstractStore.ts#L805)) | **release** the removed record |
| `removeAll` ([AbstractStore.ts:833](../src/typescript/lib/data/AbstractStore.ts#L833)) | **release** every removed record |
| `appendRecords` ([AbstractStore.ts:860](../src/typescript/lib/data/AbstractStore.ts#L860)) | **adopt** each appended record |
| `reject` ([AbstractStore.ts:919](../src/typescript/lib/data/AbstractStore.ts#L919)) | survivors stay adopted; pending-removed records pushed **back** into `_allRecords` must be **re-adopted**; dropped new records must be **released** |

`reject` is the subtle one: it rebuilds `_allRecords` from survivors + restored pending-removals and drops new records. Released-then-restored pending records were already released by `remove`, so they must be re-adopted on restore; the dropped new records (filtered out) must be released so a held reference stops notifying. The cleanest implementation is a single private `setOwnership(records, owned)` helper plus a "release the leaving set, adopt the staying set" discipline applied at each site.

### Re-entrancy is unchanged

The store-batch and record-batch flags are plain booleans flipped around synchronous regions; no `set()` inside `commitEdit` re-enters a batch. The existing table re-entrancy guard (Cell `setReadOnly` → `notifyRecordChanged` → `applyReadOnlyState`, [Cell.ts:202](../src/typescript/lib/component/table/cell/Cell.ts#L202)) is unaffected because that path calls `notifyRecordChanged` directly, not `set()`.

---

## Public API (TypeScript Signatures)

### `ModelRecord` ([ModelRecord.ts](../src/typescript/lib/data/ModelRecord.ts))

```typescript
class ModelRecord {
    // Back-ref to the owning store; unset until adopted. private, declare-safe (never set in a super() cascade).
    private _store: AbstractStore | null;
    // Record-level edit-batch state.
    private _editing: boolean;
    private _editSnapshot: Record<string, any> | null;

    /** @internal Framework wiring; set by AbstractStore when it adopts this record into _allRecords. */
    adoptedBy(store: AbstractStore): void;
    /** @internal Framework wiring; cleared by AbstractStore when this record leaves _allRecords. */
    released(): void;

    set(field: string, value: any): this;            // now auto-notifies the owning store (gated)
    setSilent(field: string, value: any): this;      // never notifies
    setMany(values: Record<string, any>): this;      // sets all, notifies once

    beginEdit(): this;                               // start a record-level batch (suppresses notify)
    commitEdit(): this;                              // end batch, fire one notify carrying the batched changes
    cancelEdit(): this;                              // end batch, revert _data to the snapshot, fire nothing

    private applySet(field: string, value: any): boolean;  // shared convert+gate+store; returns "changed"
    private notifyStore(changes: Record<string, FieldChange>): void;  // fires iff owned and not suppressed
}
```

`setMany` opens an implicit record batch: it `beginEdit()`s, loops `set()` (so each write accumulates into the snapshot diff without firing), then `commitEdit()`s for the single coalesced notify — reusing the batch machinery rather than duplicating the diff logic.

### `AbstractStore` ([AbstractStore.ts](../src/typescript/lib/data/AbstractStore.ts))

```typescript
interface StoreUpdateEvent {
    record: ModelRecord;
    changes?: Record<string, FieldChange>;   // NEW: field-level diff carried by both the single-set and batch paths
}

abstract class AbstractStore {
    private _batching: boolean;

    /** @internal Reads the store-batch flag; consulted by an owned record's set() through its back-ref. */
    isBatching(): boolean;

    beginEdit(): this;     // enter store-level batch; owned records suppress their own notify
    commitEdit(): this;    // exit batch, fire ONE 'datachanged'

    /** @internal Adopt/release one record into/out of _allRecords ownership. */
    private setOwnership(records: ModelRecord[], owned: boolean): void;

    // Existing, unchanged public surface:
    notifyRecordChanged(record: ModelRecord): void;   // kept for the standalone/manual case
}
```

`FieldChange` is already exported from `ModelRecord.ts` and re-exported by the data barrel ([data/index.ts:9](../src/typescript/lib/data/index.ts#L9)); `StoreUpdateEvent`'s new field reuses it.

`isBatching` is tagged `@internal` (record-internal plumbing), but is a normal public method so `ModelRecord` can call it across the class boundary — the back-ref is an `AbstractStore`, and a record consulting its owner's batch flag is the same shape as `getAssociated` already reaching into store internals.

---

## Internal Structure

`set` / `setSilent` share `applySet`:

```typescript
private applySet(field: string, value: any): boolean {
    const modelField = this._model.getField(field);
    const converted = modelField ? modelField.convertValue(value, this._data) : value;

    if (ModelRecord.isEqual(this._data[field], converted)) {
        return false;
    }

    const old = this._data[field];

    this._data[field] = converted;
    this._dirty = this._isNew || Object.keys(this._original)
                                      .some(k => !ModelRecord.isEqual(this._data[k], this._original[k]));

    return true;
}

set(field: string, value: any): this {
    const old = this._data[field];

    if (this.applySet(field, value)) {
        this.notifyStore({ [field]: { old, new: this._data[field] } });
    }

    return this;
}

private notifyStore(changes: Record<string, FieldChange>): void {
    if (this._store === null || this._editing || this._store.isBatching()) {
        return;
    }

    this._store.notifyRecordChanged(this, changes);   // notifyRecordChanged gains an optional changes arg
}
```

`notifyRecordChanged` extends to forward `changes` into the `'update'` payload while keeping its single-arg public call working:

```typescript
notifyRecordChanged(record: ModelRecord, changes?: Record<string, FieldChange>): void {
    this.emit('update', { record, changes });
    this.emit('datachanged', {});
}
```

`commitEdit` diffs the snapshot:

```typescript
commitEdit(): this {
    if (!this._editing) {
        return this;
    }

    this._editing = false;

    const snapshot = this._editSnapshot ?? {};
    const changes: Record<string, FieldChange> = {};

    for (const key of Object.keys(this._data)) {
        if (!ModelRecord.isEqual(this._data[key], snapshot[key])) {
            changes[key] = { old: snapshot[key], new: this._data[key] };
        }
    }

    this._editSnapshot = null;

    if (Object.keys(changes).length > 0) {
        this.notifyStore(changes);
    }

    return this;
}
```

(`old` capture in `set` reads the pre-mutation value before `applySet` overwrites `_data[field]`; the snippet above shows the ordering — capture `old`, then `applySet`, then build the change map from `old`/new.)

---

## Ordered Implementation Steps

1. **`ModelRecord.ts` — back-ref + adoption.** Add `private _store: AbstractStore | null = null;` (import of `AbstractStore` already present). Add `@internal adoptedBy(store)` / `released()` setting the field. → verify: `npm run typecheck` clean.

2. **`ModelRecord.ts` — refactor `set` onto `applySet`.** Extract the convert/equality/`_data`/dirty body into `private applySet(field, value): boolean`; have `set` capture `old`, call `applySet`, and call `notifyStore` on a real change. Add `setSilent` calling only `applySet`. → verify: existing `ModelRecord.test.ts` still green (dirty-tracking and conversion unchanged).

3. **`ModelRecord.ts` — record batch + setMany + cancelEdit.** Add `_editing`/`_editSnapshot`, `beginEdit`/`commitEdit`/`cancelEdit`, and `setMany` (begin → loop `set` → commit). Add `private notifyStore(changes)` enforcing the owned-and-not-suppressed rule. → verify: typecheck.

4. **`AbstractStore.ts` — payload + notify signature.** Extend `StoreUpdateEvent` with `changes?`. Add the optional `changes` param to `notifyRecordChanged` and forward it into the `'update'` emit. → verify: typecheck; existing sync test's `'update'` observers unaffected.

5. **`AbstractStore.ts` — store batch.** Add `private _batching`, `@internal isBatching()`, `beginEdit()`/`commitEdit()` (commit fires one `'datachanged'`). → verify: typecheck.

6. **`AbstractStore.ts` — adoption choke points.** Add `private setOwnership(records, owned)`. Wire it at `ingestRaw`, `add`, `insert`, `remove`, `removeAll`, `appendRecords`, `reject` per the table in Architecture Decisions. → verify: typecheck; `grep -n '_allRecords' src/typescript/lib/data/AbstractStore.ts` — confirm every assignment/`push`/`splice`/`filter`-replacement site has a paired `setOwnership`.

7. **`AbstractStore.ts` — silent internal writes.** Switch `stampForeignKeys` and `commitFromServerData` from `record.set(...)` to `record.setSilent(...)`. → verify: `AbstractStore.sync.test.ts` still green (no new `'update'` storms during sync).

8. **Add tests** in `tests/unit/data/` per Verification. → verify: `npm run test` green.

9. **Regression sweep.** `grep -rn '\.set(' src/typescript/lib/data/` — confirm no remaining data-layer internal `set()` on an owned record that should be silent. Run full `npm run typecheck && npm run test`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/data/ModelRecord.ts` |
| Modify | `src/typescript/lib/data/AbstractStore.ts` |
| Modify | `tests/unit/data/ModelRecord.test.ts` (record-batch, setSilent, setMany, cancelEdit cases) |
| Modify | `tests/unit/data/MemoryStore.test.ts` (auto-notify, store-batch, back-ref-clear cases) |

`TreeStore.ts` is intentionally **not** modified — it grows `_allRecords` only through inherited base methods, which become the adoption choke points.

---

## Verification

The store test harness registers `vi.fn()` spies via `store.on(event, spy)` (see [MemoryStore.test.ts:44](../tests/unit/data/MemoryStore.test.ts#L44)) and asserts call counts; the record harness builds bare `new ModelRecord(model, data)` and a `Model` ([ModelRecord.test.ts:5](../tests/unit/data/ModelRecord.test.ts#L5)). Match both.

**Store-bound tests** (`MemoryStore.test.ts`, owned records via `loadData`/`add`):

1. **Auto-notify on owned `set()`** — `loadData(SAMPLE)`, register `update` + `datachanged` spies, `store.getAt(0)!.set('name', 'Zed')`; expect both fired once and the `'update'` payload's `changes` to equal `{ name: { old: 'Alice', new: 'Zed' } }`.
2. **Silence during bulk load** — register `update`/`datachanged` spies **before** `loadData(SAMPLE)`; expect `update` never fired and `datachanged` fired exactly once (the `'load'`-path `emit('load')`/`'datachanged'` of `loadData`, *not* per-field). Confirms `createRecord`'s pre-adoption `set()`s are silent.
3. **No-op `set()` stays silent** — owned record `set('name', <same value>)`; expect zero `update`.
4. **Store-level batch coalesces** — `store.beginEdit()`, `set` two fields on two records, `store.commitEdit()`; expect zero `update` and exactly one `datachanged` (from `commitEdit`).
5. **`setSilent` fires nothing** — owned record `setSilent('name', 'Q')`; expect zero `update`/`datachanged` and `record.get('name') === 'Q'`, `record.isDirty() === true`.
6. **Back-ref cleared on `remove`** — capture `store.getAt(0)`, `store.remove(record)`, register spies, then `record.set('name', 'Gone')`; expect zero `update` (post-removal `set()` is silent) and the value still applied to the detached record.
7. **`removeAll` clears refs** — same shape over `removeAll()`.

**Record-level tests** (`ModelRecord.test.ts`, need an owned record — construct a `MemoryStore`, `loadData([{...}])`, take `getAt(0)`, or assert on the no-store-no-throw path for the bare-record cases):

8. **`beginEdit`/`commitEdit` single fire with batched changes** — owned record, `beginEdit()`, `set` two fields, `commitEdit()`; expect one `update` whose `changes` carries both fields' `{ old, new }`.
9. **`cancelEdit` reverts and fires nothing** — `beginEdit()`, `set('name','X')`, `cancelEdit()`; expect value reverted to the snapshot, zero `update`, `isDirty()` recomputed (false if it was clean before the batch).
10. **`setMany` single fire** — owned record `setMany({ name: 'A', score: 1 })`; expect exactly one `update` carrying both fields in `changes`.
11. **Un-adopted record never throws** — bare `new ModelRecord(...)` (no store), `set('name','x')`; expect no throw and dirty-tracking unchanged (guards the `_store === null` branch).

**Invariants / build:**

- `grep -n '_allRecords' src/typescript/lib/data/AbstractStore.ts` — every mutation site paired with `setOwnership`.
- `npm run typecheck` clean; `npm run test` green.
- `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning); confirms the `@internal` methods are stripped from the API surface.

---

## Documentation Impact

The new consumer-facing surface is `ModelRecord.beginEdit`/`commitEdit`/`cancelEdit`/`setSilent`/`setMany` and `AbstractStore.beginEdit`/`commitEdit`, plus the auto-notify behaviour change and the `StoreUpdateEvent.changes` field. `adoptedBy`/`released`/`isBatching` are `@internal` and stay out of docs.

- The data barrel ([data/index.ts](../src/typescript/lib/data/index.ts)) already exports `ModelRecord`, `AbstractStore`, `FieldChange`, and `StoreUpdateEvent`; no new exports needed — the new members ride the existing class/interface exports.
- Update [`docs/data/store.md`](../docs/data/store.md): document that mutating an owned record's field now auto-refreshes bound views, the batch escape hatches, and `setSilent`. It currently instructs consumers to call `notifyRecordChanged` manually — reframe that as the standalone/manual fallback now that auto-notify is the default.
- Update [`docs/components/Table.md`](../docs/components/Table.md) and [`ColumnConfig.ts`](../src/typescript/lib/component/table/ColumnConfig.ts) JSDoc (lines 61/69/139/147) where they instruct "call `store.notifyRecordChanged(record)`" after an off-band edit — soften to "auto-notified when the record is store-owned; call `notifyRecordChanged` only for an unowned record or to force a refresh."
- Check the docs catalog `index.md` under `docs/data/` and the sidebar in `docs/.vitepress/config.mts` — no new pages, so likely no sidebar change; verify the store page still resolves.

---

## Potential Challenges

- **Table edit path double-fire (out of data-layer scope).** `Row` ([Row.ts:74](../src/typescript/lib/component/table/Row.ts#L74), [Row.ts:319](../src/typescript/lib/component/table/Row.ts#L319)) does `record.set(field, value)` then fires `onCommit` → `Body`'s `notifyRecordChanged` ([Body.ts:196](../src/typescript/lib/component/table/Body.ts#L196)). Once `set()` auto-notifies an owned record, this becomes **two** `'update'`/`'datachanged'` pairs per cell commit. This is a component-layer concern outside the surgical data-layer change; flag it for a **follow-up** (drop the explicit `notifyRecordChanged` from `Body.createRow`/`Row`'s commit, since the record is store-owned and now self-notifies). Mitigation for this plan: do not touch `Row`/`Body`; document the redundancy in the step-9 sweep and the Non-Goals so `/implement` doesn't silently "fix" it and break the re-entrancy guard. The double-fire is benign (idempotent refresh), just wasteful.
- **`reject` re-adoption correctness.** Records that were `remove()`d (released) then restored by `reject()` must be re-adopted, while dropped new records must be released. Mitigation: the explicit ownership table above + the back-ref-clear test (#6/#7) extended with a reject case.
- **`AbstractStore` import cycle.** `ModelRecord.ts` already imports `AbstractStore` ([ModelRecord.ts:4](../src/typescript/lib/data/ModelRecord.ts#L4)) and `AbstractStore.ts` imports `ModelRecord` — the cycle already exists and resolves; the new typed back-ref adds no new edge. Mitigation: none needed; confirmed both imports are present today.
- **`old` capture ordering in `set`.** `applySet` overwrites `_data[field]` before `set` builds the change map. Mitigation: capture `old` in `set` *before* calling `applySet` (shown in Internal Structure).

---

## Critical Files

- [`src/typescript/lib/data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) — the `set()`/`getChanges()`/`clone()`/`reject()` surface being extended.
- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) — all `_allRecords` mutation sites, `notifyRecordChanged`, `stampForeignKeys`, `commitFromServerData`, the `StoreUpdateEvent` payload.
- [`src/typescript/lib/data/AbstractModel.ts`](../src/typescript/lib/data/AbstractModel.ts#L192) — `createRecord`, the pre-adoption population that makes load silent.
- [`src/typescript/lib/data/TreeStore.ts`](../src/typescript/lib/data/TreeStore.ts) — confirms no new mutation sites (inherits all `_allRecords` growth).
- [`tests/unit/data/MemoryStore.test.ts`](../tests/unit/data/MemoryStore.test.ts) and [`tests/unit/data/ModelRecord.test.ts`](../tests/unit/data/ModelRecord.test.ts) — the harness shape to match.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) Event-handling section — the `'update'`/`'datachanged'` custom-event surface to reuse, not extend with a new event.

---

## Non-Goals

- **Reworking the table cell-commit path.** `Row`/`Body` keep their explicit `notifyRecordChanged` call; the resulting benign double-fire on owned-record cell edits is left for a separate component-layer follow-up (see Potential Challenges). Touching it here risks the Cell `setReadOnly` re-entrancy guard.
- **Cross-store / association propagation.** A record notifies only its own owning store via the back-ref. Parent/child association stores do not cross-notify; the existing cascade-sync path is unchanged.
- **Nested/deep field-value change detection beyond the existing `isEqual`.** The batch diff reuses `ModelRecord.isEqual` exactly as `getChanges` does today — no new equality semantics.
- **A store-level `'update'` replay during a store batch.** The store batch coalesces to a single `'datachanged'` only, by design (see Architecture Decisions); per-record granularity is the record batch's job.
- **`autoNotify` opt-out config.** Auto-notify is unconditional for owned records; suppression is per-call (`setSilent`) or per-region (`beginEdit`/`commitEdit`), not a store-construction flag.
