# AjaxStore / AjaxProxy Data-Layer Improvements — Implementation Plan

## Overview

Three related data-layer papercuts logged by the sqladmin demo app, all in the `AjaxProxy` / `AjaxStore` / reader-writer stack, fixed as one plan because they share files (`AjaxProxy.ts`, `index.ts`, `docs/data/proxy.md`):

1. **Dirty-only write mode** — `AjaxProxy.update`/`updateBatch` serialize the *entire* record via [`JsonWriter.writeRecord`](src/typescript/lib/data/proxy/Writer.ts#L55), re-sending unchanged columns. Add an opt-in mode that emits only changed fields (plus the primary key) on updates.
2. **Response-shape-driven envelope detection** — [`JsonReader`](src/typescript/lib/data/proxy/Reader.ts#L103) currently keys the envelope-vs-array parse off whether pagination params were sent (`'auto'` mode), so a store returning a `{rows, totalCount}` envelope on an *unpaginated* read throws `response is not an array`. Add a shape-driven `'detect'` mode and sharpen the failure messages.
3. **Positional constructor drops store options** — [`AjaxStore`](src/typescript/lib/data/AjaxStore.ts#L36)'s positional `(model, proxyOptions)` form has no parameter for store-level options (`pageSize`/`remoteSort`/`remoteFilter`) and skips [`applyOptions`](src/typescript/lib/data/AbstractStore.ts#L245); deprecate that overload, steering callers to the single `AjaxStoreOptions` bag.

The mechanism for #1 and #2 already has a home: [`JsonReaderMode`](src/typescript/lib/data/proxy/Reader.ts#L59) was recently added (commit `0a47a0a4`) with `'auto' | 'envelope' | 'array'`. This plan follows that pattern — a parallel `JsonWriterMode` for #1 and a new `'detect'` member for #2 — rather than reinventing a config surface.

---

## Architecture Decisions

### Dirty-only lives on the `Writer`, gated by operation — mirroring `JsonReaderMode`

The serialization seam is the `Writer`. Give `JsonWriter` a `mode: 'full' | 'dirty'` option (default `'full'`), symmetric with `JsonReaderMode`. Because `writeRecord`/`writeRecords` are used for **both** create and update, the writer must know which op is running: extend the `Writer` interface with an optional `operation?: WriteOperation` (`'create' | 'update'`) argument that `AjaxProxy` passes. Dirty serialization applies **only when `operation === 'update'`**; creates always send the full record.

### Create is never dirty-only — a new record has no committed baseline

`AbstractStore.sync` already splits create from update: [`syncCreates`](src/typescript/lib/data/AbstractStore.ts#L1204) filters `isNew()`, [`syncUpdates`](src/typescript/lib/data/AbstractStore.ts#L1227) filters `isDirty() && !isNew()`. A freshly-added record's `_data` equals its `_original` (both from the seed object), so [`getChanges()`](src/typescript/lib/data/ModelRecord.ts#L745) would return **empty** for it — dirty-only on a create would send nothing. Hence dirty-only is an update-only concept, and the create paths must keep sending `getData()`.

### The dirty update body always carries the primary key

[`updateBatch`](src/typescript/lib/data/proxy/AjaxProxy.ts#L300) PUTs an array to the collection URL with **no id in the URL**, so the server identifies each record from the body. A dirty payload of only-changed-fields would therefore be unidentifiable in a batch. Decision: the dirty body is `{...changedFields, [pk]: pkValue}` — changed fields plus the primary-key field value, always. For single [`update`](src/typescript/lib/data/proxy/AjaxProxy.ts#L232) (id in the URL) the pk in the body is harmless and consistent. This is encapsulated in a new `ModelRecord.getChangedData()`.

### `'detect'` is a new reader mode, not a redefinition of `'auto'`

Commit `0a47a0a4` deliberately kept `'auto'` = "shape follows the request" as the back-compat default and added explicit overrides. Redefining `'auto'` to sniff the shape would flip that one commit later and change existing behaviour (e.g. an unpaginated `{data:[]}` currently throws; sniffing would parse it). Instead add a third member `'detect'`: after the optional `root` unwrap, an **array** parses as an array and a **non-null object** parses as an envelope, independent of `paginated`. `'auto'` and all its tests stay untouched.

### Reach the new modes from the convenience classes via `readMode` / `writeMode` passthroughs

`AjaxStore` is the class that logged #1 and #2, and its whole point is *not* wiring a reader/writer by hand. So the default reader/writer that `AjaxProxy` builds must be configurable through the options bag: add `AjaxProxyOptions.readMode?: JsonReaderMode` and `AjaxProxyOptions.writeMode?: JsonWriterMode`, forwarded to the **default** `JsonReader`/`JsonWriter` only — exactly as `root` is forwarded today ([AjaxProxy.ts:80-81](src/typescript/lib/data/proxy/AjaxProxy.ts#L80)). When a caller supplies a custom `reader`/`writer`, the passthrough is ignored (that object owns its own config).

### Deprecate the positional `AjaxStore` overload rather than "fix" it

The positional form is `(model: Model, proxyOptions: AjaxProxyOptions)` — there is **no** argument that could carry `pageSize`/`remoteSort`/`remoteFilter`, so "apply store options in the positional path" is impossible without adding a third positional bag, which is non-idiomatic and contradicts the repo's options-bag construction convention (`CODE_CONVENTIONS.md`). Split the single constructor signature into two overloads and mark the positional one `@deprecated`, steering callers to `new AjaxStore({ model, proxy, ... })`. No behaviour change, no removal. (`Store`'s positional `(model, proxy)` form is out of scope — it takes a `Proxy` instance and is a documented convenience with no lost options.)

---

## Public API

### `Writer.ts`

```typescript
// New: the op context passed to a writer so it can choose full vs dirty output.
export type WriteOperation = 'create' | 'update';

// New: JsonWriter output mode, symmetric with JsonReaderMode.
export type JsonWriterMode = 'full' | 'dirty';

export interface JsonWriterOptions {
    // Which fields to serialize on an update. 'full' (default) sends the whole
    // record; 'dirty' sends only changed fields plus the primary key. Ignored
    // for create, which always sends the whole record.
    mode?: JsonWriterMode;
}

export interface Writer {
    writeRecord(record: ModelRecord, operation?: WriteOperation): string;
    writeRecords(records: ModelRecord[], operation?: WriteOperation): string;
}

export class JsonWriter implements Writer {
    constructor(options?: JsonWriterOptions);
    writeRecord(record: ModelRecord, operation?: WriteOperation): string;
    writeRecords(records: ModelRecord[], operation?: WriteOperation): string;
}
```

Backing field: `private _mode: JsonWriterMode` (default `'full'`). Private helper `dataFor(record, operation)` returns `this._mode === 'dirty' && operation === 'update' ? record.getChangedData() : record.getData()`.

### `Reader.ts`

```typescript
// 'detect' added; 'auto' | 'envelope' | 'array' unchanged.
export type JsonReaderMode = 'auto' | 'detect' | 'envelope' | 'array';
```

### `ModelRecord.ts`

```typescript
/**
 * Returns the changed-field new values for a dirty-only update body, always
 * including the primary-key field so a batch update (no id in the URL) stays
 * identifiable. Empty of changes only when the record is clean.
 */
getChangedData(): Record<string, any>;
```

### `AjaxProxy.ts`

```typescript
export interface AjaxProxyOptions {
    // ...existing...
    readMode?:  JsonReaderMode;   // forwarded to the default JsonReader only
    writeMode?: JsonWriterMode;   // forwarded to the default JsonWriter only
}
```

### `AjaxStore.ts`

```typescript
/**
 * @deprecated Pass a single {@link AjaxStoreOptions} bag instead. The positional
 * `(model, proxyOptions)` form cannot carry store-level options such as
 * `pageSize` / `remoteSort` / `remoteFilter`, which are silently ignored.
 */
constructor(model: Model, proxyOptions?: AjaxProxyOptions);
constructor(options: AjaxStoreOptions);
// Implementation signature unchanged.
```

`proxyOptions?` stays **optional** on the deprecated overload so the existing `new AjaxStore(MODEL)` runtime-guard test still type-checks.

---

## Internal Structure

### `ModelRecord.getChangedData()`

```typescript
getChangedData(): Record<string, any> {
    const data: Record<string, any> = {};

    for (const [field, change] of Object.entries(this.getChanges())) {
        data[field] = change.new;
    }

    const pkField = this._model.getPrimaryKeyField();

    if (pkField) {
        data[pkField.getName()] = this._data[pkField.getName()];
    }

    return data;
}
```

Uses existing [`getChanges()`](src/typescript/lib/data/ModelRecord.ts#L745) (structural diff vs `_original`) and [`getPrimaryKeyField()`](src/typescript/lib/data/ModelRecord.ts#L551 usage). Place it beside `getData()`.

### `JsonReader` `'detect'` branch

In [`read`](src/typescript/lib/data/proxy/Reader.ts#L140), extend the envelope decision:

```typescript
read(raw: any, paginated: boolean): ReadResult {
    if (this._mode === 'detect') {
        const value = this._root ? raw?.[this._root] : raw;

        return Array.isArray(value) ? this.readArray(raw) : this.readEnvelope(raw);
    }

    const envelope = this._mode === 'envelope' || (this._mode === 'auto' && paginated);

    return envelope ? this.readEnvelope(raw) : this.readArray(raw);
}
```

Note `readArray`/`readEnvelope` each re-apply the `root` unwrap internally, so `detect` passes the original `raw` after only *peeking* at the unwrapped shape.

### Sharper error messages (Reader.ts)

Append the fix hint to the two `'auto'`/`'array'` failure throws so the default experience is actionable:

- [readArray no-root throw](src/typescript/lib/data/proxy/Reader.ts#L194): `AjaxProxy: response is not an array and no root was specified — if the server returns a { data, total } envelope, set mode:'detect' (or mode:'envelope' / a rootProperty), or enable pagination with setPageSize()`.
- [readEnvelope not-an-object throw](src/typescript/lib/data/proxy/Reader.ts#L157): mention `mode:'array'` for a top-level array.

---

## Ordered Implementation Steps

1. **`src/typescript/lib/data/ModelRecord.ts`** — add `getChangedData()` (body above) next to `getData()` (~L489), with a doc comment. Cheap check: `grep -n 'getChangedData' src/typescript/lib/data/ModelRecord.ts`.

2. **`src/typescript/lib/data/proxy/Writer.ts`** — add `WriteOperation`, `JsonWriterMode`, `JsonWriterOptions`; add the optional `operation` param to both `Writer` methods; add `_mode` field, constructor, and the private `dataFor` helper to `JsonWriter`; route both write methods through `dataFor`. Keep the historical full-serialization as the `'full'` default.

3. **`src/typescript/lib/data/proxy/Reader.ts`** — add `'detect'` to `JsonReaderMode`; add the `detect` branch to `read`; sharpen the two failure messages. Do **not** touch `'auto'` semantics.

4. **`src/typescript/lib/data/proxy/AjaxProxy.ts`** —
   - Add `readMode?` / `writeMode?` to `AjaxProxyOptions`.
   - Constructor: `this._reader = options.reader ?? new JsonReader({ root: options.root, mode: options.readMode })` and `this._writer = options.writer ?? new JsonWriter({ mode: options.writeMode })` (undefined `mode` falls back to each class's default).
   - Pass the operation at all four call sites: [`create`](src/typescript/lib/data/proxy/AjaxProxy.ts#L212) → `writeRecord(record, 'create')`; [`update`](src/typescript/lib/data/proxy/AjaxProxy.ts#L236) → `writeRecord(record, 'update')`; [`createBatch`](src/typescript/lib/data/proxy/AjaxProxy.ts#L282) → `writeRecords(records, 'create')`; [`updateBatch`](src/typescript/lib/data/proxy/AjaxProxy.ts#L303) → `writeRecords(records, 'update')`.

5. **`src/typescript/lib/data/AjaxStore.ts`** — split the constructor into two overload signatures (deprecated positional first, bag second) above the unchanged implementation signature; add the `@deprecated` JSDoc. Body unchanged.

6. **`src/typescript/lib/data/index.ts`** — extend the Writer export to `export type { Writer, WriteOperation, JsonWriterMode, JsonWriterOptions } from '~/data/proxy/Writer.js';` (`JsonReaderMode` already exported). Cheap check: `npm run typecheck`.

7. **Docs** (`docs/data/proxy.md`, `docs/data/store.md`) — see Documentation Impact.

8. **Tests** — see Verification.

9. Run `npm run typecheck && npm run lint && npm run test && npm run docs:build` — all clean, docs build with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/data/ModelRecord.ts` (add `getChangedData`) |
| Modify | `src/typescript/lib/data/proxy/Writer.ts` (mode, operation, options) |
| Modify | `src/typescript/lib/data/proxy/Reader.ts` (`'detect'` mode, clearer errors) |
| Modify | `src/typescript/lib/data/proxy/AjaxProxy.ts` (readMode/writeMode, operation passing) |
| Modify | `src/typescript/lib/data/AjaxStore.ts` (deprecate positional overload) |
| Modify | `src/typescript/lib/data/index.ts` (export new writer types) |
| Modify | `docs/data/proxy.md` (dirty write mode, `'detect'` reader mode) |
| Modify | `docs/data/store.md` (prefer the bag form for AjaxStore) |
| Modify | `tests/unit/data/ModelRecord.test.ts` |
| Modify | `tests/unit/data/proxy/Writer.test.ts` |
| Modify | `tests/unit/data/proxy/Reader.test.ts` |
| Modify | `tests/unit/data/proxy/AjaxProxy.test.ts` |
| Modify | `tests/unit/data/AjaxStore.test.ts` |

---

## Expected Behaviour

All unit-testable (vitest; the proxy tests stub `fetch` per the existing pattern in `tests/unit/data/proxy/AjaxProxy.test.ts`).

### `ModelRecord.getChangedData()`
- A record with `id: 3, name: 'Ann'` whose `name` is changed to `'Bob'` (via `set`) returns `{ name: 'Bob', id: 3 }`.
- A clean record (no changes) returns just `{ id: <pk> }` (only the primary key).
- A model with **no** primary key returns only the changed fields, no pk.

### `JsonWriter` dirty mode
- `mode: 'full'` (default): `writeRecord(record)` and `writeRecord(record, 'update')` both equal `JSON.stringify(record.getData())` — unchanged from today.
- `mode: 'dirty'`, `writeRecord(record, 'update')` on a record with one changed field ⇒ `JSON.stringify({ changedField, [pk]: value })`.
- `mode: 'dirty'`, `writeRecord(record, 'create')` ⇒ full `JSON.stringify(record.getData())` (create is never dirty-only).
- `mode: 'dirty'`, `writeRecords(records, 'update')` ⇒ JSON array of each record's `getChangedData()`, in order.
- A custom `Writer` that ignores the `operation` param (e.g. `{ writeRecord: () => 'X', writeRecords: () => '[]' }`) still satisfies the interface and is called unchanged.

### `JsonReader` `'detect'` mode
- `mode: 'detect'`, unpaginated read of `{ rows: [...], totalCount: 5 }` with `rootProperty:'rows'`, `totalProperty:'totalCount'` ⇒ `{ records:[...], total:5 }` (envelope, no page size needed — the note-2 fix).
- `mode: 'detect'`, read of a top-level array ⇒ `{ records: [...] }` (array), regardless of `paginated`.
- `mode: 'detect'` with `root` set: unwraps `root`, then array-vs-object decides the parse.
- `mode: 'auto'` (default) behaviour is **byte-for-byte unchanged**: array when unpaginated, envelope when paginated; `{data:[]}` unpaginated still throws.

### Sharper errors
- Default `JsonReader` (`'auto'`) on an unpaginated object body still throws, but the message now names `mode:'detect'` / `rootProperty` / `setPageSize()`.

### `AjaxProxy` wiring
- `new AjaxProxy({ url, writeMode: 'dirty' })` then `update(record)` PUTs `getChangedData()` to `{url}/{id}`.
- `new AjaxProxy({ url, readMode: 'detect' })` parses an unpaginated envelope without a page size.
- `writeMode`/`readMode` are ignored when a custom `writer`/`reader` is passed.
- Default (no `writeMode`): `create`/`update` bodies are still full `getData()` — existing AjaxProxy tests pass unchanged.

### `AjaxStore` deprecation
- `new AjaxStore(MODEL, { url })` still constructs and works (deprecated, not removed).
- `new AjaxStore({ model, proxy: { url }, remoteSort: true })` applies store options (already works).
- `new AjaxStore(MODEL)` still throws the "requires an AjaxProxyOptions argument" guard **and** type-checks (deprecated overload keeps `proxyOptions?` optional).

---

## Verification

- `npm run typecheck` — clean (validates the overload split and new exported types).
- `npm run lint` — clean (`eslint src`; no `no-deprecated` rule is configured, and no `src/` call site uses the positional `AjaxStore` form, so the new `@deprecated` triggers nothing).
- `npm run test` — includes `typecheck:test`. Update/extend:
  - `tests/unit/data/ModelRecord.test.ts` — `getChangedData` cases above.
  - `tests/unit/data/proxy/Writer.test.ts` — full-vs-dirty × create/update; the existing default-mode assertions must remain green (add a `mode:'dirty'` block).
  - `tests/unit/data/proxy/Reader.test.ts` — add a `mode:'detect'` block (envelope + array + root); assert `'auto'` cases at L102-106 and the throw at L10-13 are **unchanged**.
  - `tests/unit/data/proxy/AjaxProxy.test.ts` — add `writeMode:'dirty'` update/updateBatch body assertions and a `readMode:'detect'` unpaginated-envelope read; existing full-body assertions stay.
  - `tests/unit/data/AjaxStore.test.ts` — keep the positional test (still valid); no new behaviour needed for the deprecation beyond confirming both forms still construct.
- `npm run docs:build` — must finish with **zero warnings** (per `CODE_CONVENTIONS.md`); all new `{@link}`s must point at exported, non-internal symbols.

---

## Documentation Impact

New public API is exported through the `@jimka/typescript-ui/data` barrel ([`src/typescript/lib/data/index.ts`](src/typescript/lib/data/index.ts#L34)): `WriteOperation`, `JsonWriterMode`, `JsonWriterOptions` (new type exports), plus the widened `JsonReaderMode` and the new `AjaxProxyOptions.readMode`/`writeMode`. TypeDoc picks these up automatically.

- **`docs/data/proxy.md`** — under **Reader & Writer** (L164): document `writeMode: 'dirty'` (only-changed-fields-plus-pk on updates; create always full) and `readMode: 'detect'` (shape-driven envelope/array). Add a short note under **Server-side pagination** (L54) that `mode:'detect'` / `readMode:'detect'` lets a store parse an envelope without a page size — the direct answer to note 2.
- **`docs/data/store.md`** — where `AjaxStore` construction is shown, prefer the `new AjaxStore({ model, proxy, ... })` bag form and note the positional `(model, proxyOptions)` form is deprecated because it cannot carry store-level options.
- No renames/removals, so no cross-reference grep sweep is needed.

---

## Potential Challenges

- **Interface widening breaks nothing, but must be verified.** Adding `operation?` to `Writer` is source-compatible (a narrower impl is assignable); confirm with `npm run typecheck` and the existing custom-writer test at `AjaxProxy.test.ts:217`.
- **`detect` + `root` double-unwrap.** `read` peeks at `raw[root]` to choose the branch, then `readArray`/`readEnvelope` unwrap `root` again internally — pass the original `raw`, not the peeked value, to avoid a double unwrap.
- **Dirty batch identity.** If `getChangedData` omitted the pk, batch updates would be unidentifiable server-side; the pk inclusion is load-bearing, not cosmetic — keep it even when the pk itself is unchanged.
- **Overload guard test.** Keep `proxyOptions?` optional on the deprecated overload or `new AjaxStore(MODEL)` (the guard test) stops type-checking.

---

## Critical Files

- [`src/typescript/lib/data/proxy/Reader.ts`](src/typescript/lib/data/proxy/Reader.ts) — the `JsonReaderMode` pattern to mirror; `read`/`readArray`/`readEnvelope`.
- [`src/typescript/lib/data/proxy/Writer.ts`](src/typescript/lib/data/proxy/Writer.ts) — the seam that grows the dirty mode.
- [`src/typescript/lib/data/ModelRecord.ts`](src/typescript/lib/data/ModelRecord.ts) — `getChanges`/`getData`/`getPrimaryKeyField` reuse for `getChangedData`.
- [`src/typescript/lib/data/AbstractStore.ts`](src/typescript/lib/data/AbstractStore.ts) — `syncCreates`/`syncUpdates` confirm the create-vs-update split that makes dirty-only update-only.
- [`src/typescript/lib/data/Store.ts`](src/typescript/lib/data/Store.ts) — the sibling positional/bag constructor (reference for the overload shape; out of scope to change).

---

## Non-Goals

- **App adoption is downstream.** Removing sqladmin's backend coercion (note 1 workaround) and its always-set `pageSize` (note 2 workaround) happens in the app repo after this ships; not part of this plan.
- **No `'auto'` redefinition.** `'auto'` stays pagination-driven for back-compat; shape-driven parsing is the opt-in `'detect'`.
- **`Store` positional form untouched** — it loses no options and is a documented convenience.
- **No third positional bag on `AjaxStore`** — the positional form is deprecated, not extended.
- **No dirty-only on create**, and no change to `getDataWithNested` / nested-association serialization.
