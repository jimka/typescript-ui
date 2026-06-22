---
touches-shared: [src/typescript/lib/data/AbstractStore.ts]
---

# Proxy Reader/Writer Abstraction + Remote Sort/Filter + Load Concurrency + WebStorageProxy — Implementation Plan

## Overview

This plan reworks the data-layer transport so response parsing and request serialization become pluggable, wires remote sort/filter through to the proxy, hardens `load()` against overlapping requests, and adds a `localStorage`/`sessionStorage`-backed proxy. It lives entirely under [`src/typescript/lib/data/`](../src/typescript/lib/data) — primarily the `proxy/` subtree plus the minimal `AbstractStore.load()` plumbing the remote-query and concurrency work require.

Four gaps drive it: `AjaxProxy` hardcodes envelope parsing ([AjaxProxy.ts:82-145](../src/typescript/lib/data/proxy/AjaxProxy.ts#L82)) and body serialization ([AjaxProxy.ts:169](../src/typescript/lib/data/proxy/AjaxProxy.ts#L169)); remote sort is half-wired and remote filter is broken (`load()` only builds `{page, pageSize}` at [AbstractStore.ts:163-165](../src/typescript/lib/data/AbstractStore.ts#L163) and `read()` never serializes sorters/filters); `load()` has no stale-response guard ([AbstractStore.ts:155-176](../src/typescript/lib/data/AbstractStore.ts#L155)); and only `MemoryProxy`/`AjaxProxy` exist.

Scope is strictly the proxy/loading layer. Sync error handling/events, collection/aggregation, validation, and associations are **out** (other plans).

---

## Architecture Decisions

### Reader/Writer are plain interfaces, not classes — `AjaxProxy` owns them

A `Reader` parses a raw server response into a normalized envelope; a `Writer` serializes a record (or batch) into a request body. Both are small single-method shapes, so they ship as **interfaces** with a concrete default `JsonReader` / `JsonWriter` rather than an abstract-class hierarchy — no inheritance is needed and the options-bag style favors passing an instance. They are configured **only on `AjaxProxy`** (`reader?`, `writer?` in `AjaxProxyOptions`); `MemoryProxy` and `WebStorageProxy` work on in-process objects and never serialize, so they gain no reader/writer. This keeps the abstraction where the transport actually varies and avoids polluting the base `Proxy` with HTTP-only concepts.

The default `JsonReader` reproduces today's exact behavior — root-key unwrapping, the paginated `{ data, total }` envelope, and the top-level-array fallback — so every existing `AjaxProxy` caller and the current tests keep passing unchanged. The default `JsonWriter` reproduces `JSON.stringify(record.getData())`.

### `Reader` returns one normalized envelope for both paginated and unpaginated reads

`AjaxProxy.read()` currently has two parse branches (paginated envelope vs. top-level array). The `Reader.read()` contract collapses these into a single return shape `{ records: any[]; total?: number; success?: boolean; message?: string }`. `AjaxProxy.read()` calls the reader once, stores `total` into `_lastTotalCount`, and returns `records`. `success`/`message` are parsed and carried on the envelope now (cheap, and the shape the prompt specifies) but **not acted on** — surfacing them as sync errors/events is plan #3's job. This is flagged so the implementer does not add error-throwing on `success: false` here.

### Remote sort/filter is opt-in per store; client-side stays the default

Two new store configs, `remoteSort?: boolean` and `remoteFilter?: boolean` (default `false`), gate whether active sorters/filters are serialized into `ReadParams` and reloaded from the proxy, versus applied locally by `applyView()`. The existing client-side path ([AbstractStore.ts:853-896](../src/typescript/lib/data/AbstractStore.ts#L853)) is untouched and remains the default. When a flag is on, the corresponding descriptors ride along in `ReadParams`; `applyView()` still runs but is a near no-op for that axis because the server already returned the right page/order (the local sort/filter is harmless on an already-correct page, and is what keeps the non-paginated remote case coherent). The split is documented in JSDoc on `remoteSort`/`remoteFilter` and on `read()`.

### `ReadParams` carries descriptors, not a serialized string

`ReadParams` gains `sorters?: SortDescriptor[]` and `filters?: FilterDescriptor[]` (the existing serializable types). The proxy — not the store — decides wire format: `AjaxProxy.read()` appends `sort=<json>` / `filter=<json>` to the query string via `JSON.stringify` (the descriptors are already structured-clone-safe, see [FilterDescriptor.ts:1-22](../src/typescript/lib/data/FilterDescriptor.ts#L10)). Keeping descriptors in `ReadParams` lets a custom proxy choose its own encoding without the store presuming HTTP query syntax.

### Filter side effects become symmetric with sort

Today `sort()` resets to page 1 and reloads when paginated ([AbstractStore.ts:690-702](../src/typescript/lib/data/AbstractStore.ts#L690)) but `filter()`/`filterBy()` do not — only `clearFilter()` does ([AbstractStore.ts:780-795](../src/typescript/lib/data/AbstractStore.ts#L780)). The reload trigger is reframed: a sort/filter mutation resets page + reloads when its remote flag is on (`remoteSort`/`remoteFilter`), independent of pagination. To preserve current behavior exactly, **`remoteSort` defaults follow the existing paginated trigger**: see _Architecture Decisions → Backward-compatible reload trigger_ below.

### Backward-compatible reload trigger — keep the `_pageSize != null` behavior

The current code reloads on `sort()`/`clearFilter()` whenever `_pageSize != null`. To avoid a silent behavior change for existing paginated stores that never set `remoteSort`, the reload predicate becomes: **reload if the remote flag is on, OR if `_pageSize != null`** (the legacy trigger). `remoteSort`/`remoteFilter` additionally cause the descriptors to be *serialized into `ReadParams`*; without them, a paginated reload still happens (preserving today's behavior) but sends only `{page, pageSize}` (today's bug, now an explicit documented choice rather than an accident). This makes the new flags purely additive: turning `remoteFilter` on is what finally fixes the "filter while paginated doesn't reload" gap, and turning `remoteSort` on is what finally sends the order to the server. Document this clearly in `sort()`, `filter()`, `filterBy()`, `clearFilter()` JSDoc.

### Load concurrency via a monotonic request-sequence id + AbortController

`load()` increments a private `_loadSeq` and captures the value before awaiting; after the await it ignores the response (no `ingestRaw`, no events) if `_loadSeq` has moved on — so a stale in-flight response can never clobber a newer one. Separately, `AjaxProxy.read()` accepts an `AbortSignal` (threaded through `ReadParams.signal`) so a superseded HTTP request is actually cancelled, not just ignored. The store owns one `AbortController` per load; starting a new load aborts the previous controller. The sequence guard is the correctness mechanism (works for every proxy); the AbortController is the efficiency mechanism (HTTP only). An aborted `fetch` rejects with `AbortError`, which the sequence guard turns into a silent no-op rather than a thrown load error.

### `WebStorageProxy` mirrors `MemoryProxy`, persisting to a keyed JSON blob

`WebStorageProxy` stores the whole record array under one storage key as a JSON string, re-reading/re-writing it on each CRUD op (matching `MemoryProxy`'s array semantics but persistent). `storage: 'local' | 'session'` (default `'local'`) selects `localStorage`/`sessionStorage`. CRUD is keyed by primary key exactly as `MemoryProxy` does ([MemoryProxy.ts:94-134](../src/typescript/lib/data/proxy/MemoryProxy.ts#L94)). New records with no primary-key value get a generated id (see _Internal Structure_). It follows the options-bag + `// eslint-disable-next-line local/forward-super-options` pattern ([AjaxProxy.ts:52-54](../src/typescript/lib/data/proxy/AjaxProxy.ts#L52)).

---

## Public API (TypeScript Signatures)

New file `proxy/Reader.ts`:

```ts
/** Normalized result of parsing a raw server response. @category Data */
export interface ReadResult {
    records : any[];
    total?  : number;
    success?: boolean;
    message?: string;
}

/** Parses a raw server response into a {@link ReadResult}. @category Data */
export interface Reader {
    /** @param raw - The parsed JSON body from the server. @param paginated - Whether the read requested pagination. */
    read(raw: any, paginated: boolean): ReadResult;
}

/** Default JSON reader: root-unwrap, `{data,total}` envelope when paginated, top-level array otherwise. @category Data */
export interface JsonReaderOptions {
    root?      : string;
    rootProperty?: string;   // envelope key holding the array; default 'data'
    totalProperty?: string;  // envelope key holding the count; default 'total'
}
export class JsonReader implements Reader { constructor(options?: JsonReaderOptions); read(raw: any, paginated: boolean): ReadResult; }
```

New file `proxy/Writer.ts`:

```ts
/** Serializes a record (or batch) into a request body string. @category Data */
export interface Writer {
    writeRecord(record: ModelRecord): string;
    writeRecords(records: ModelRecord[]): string;
}

/** Default writer: `JSON.stringify(record.getData())`; batch is a JSON array of data objects. @category Data */
export class JsonWriter implements Writer { writeRecord(record: ModelRecord): string; writeRecords(records: ModelRecord[]): string; }
```

Extended `proxy/Proxy.ts`:

```ts
export interface ReadParams {
    page?    : number;
    pageSize?: number;
    sorters? : SortDescriptor[];     // imported from AbstractStore
    filters? : FilterDescriptor[];   // imported from FilterDescriptor
    signal?  : AbortSignal;
}
```

Extended `proxy/AjaxProxy.ts`:

```ts
export interface AjaxProxyOptions {
    url: string;
    root?: string;
    method?: 'GET' | 'POST';
    createMethod?: 'POST' | 'PUT';
    updateMethod?: 'PUT' | 'PATCH';
    headers?: Record<string, string>;
    reader?: Reader;   // default: new JsonReader({ root })
    writer?: Writer;   // default: new JsonWriter()
}
```

New file `proxy/WebStorageProxy.ts`:

```ts
/** @category Data */
export interface WebStorageProxyOptions {
    key: string;                       // storage key under which the array is persisted
    storage?: 'local' | 'session';     // default 'local'
    data?: any[];                      // seed written only if the key is absent
}
/** @deprecated Use {@link WebStorageProxyOptions}. */
export type WebStorageProxyConfig = WebStorageProxyOptions;

/** @category Data */
export class WebStorageProxy extends Proxy {
    constructor(options: WebStorageProxyOptions);
    read(params?: ReadParams): Promise<any[]>;
    create(record: ModelRecord): Promise<Record<string, any>>;
    update(record: ModelRecord): Promise<Record<string, any>>;
    destroy(record: ModelRecord): Promise<void>;
}
```

Extended `AbstractStore.ts` — new options + accessor:

```ts
export interface AbstractStoreOptions {
    // …existing fields…
    remoteSort?:   boolean;   // default false
    remoteFilter?: boolean;   // default false
}

// new public accessor mirroring getActiveSorters() (AbstractStore.ts:710)
getActiveFilters(): FilterDescriptor[];
```

---

## Internal Structure

### `AbstractStore.load()` concurrency guard (replaces AbstractStore.ts:155-176)

```
private _loadSeq: number = 0;
private _loadAbort: AbortController | undefined = undefined;

async load(): Promise<void> {
    if (!this.proxy) { throw new Error(...); }

    const seq = ++this._loadSeq;                 // claim this load
    this._loadAbort?.abort();                    // cancel any in-flight HTTP read
    const controller = new AbortController();
    this._loadAbort = controller;

    this.setLoading(true);
    try {
        const params = this.buildReadParams(controller.signal);   // page/size + remote sort/filter
        const raw = await this.proxy.read(params);

        if (seq !== this._loadSeq) { return; }   // superseded — ignore stale response

        this.ingestRaw(raw);
        this._totalCount = this.proxy.getLastTotalCount();
        this.emit('load', { records: this._records });
    } catch (err) {
        if ((err as Error).name === 'AbortError' || seq !== this._loadSeq) { return; }
        throw err;
    } finally {
        if (seq === this._loadSeq) { this.setLoading(false); }   // don't clear loading for a superseded load
    }
}
```

`buildReadParams(signal)` is a new `private` helper: starts from the existing `{page, pageSize}` shape (only when `_pageSize != null`), adds `sorters` when `remoteSort` and `_activeSorters.length > 0`, adds `filters` when `remoteFilter` and `_activeFilters.length > 0`, and always sets `signal`. Returns `undefined` only when *nothing* applies (preserving the unpaginated no-arg `read()` call so `MemoryProxy` keeps ignoring params).

### `WebStorageProxy` id generation

New records lacking a primary-key value get `Date.now()`-based monotonic ids is **insufficient** (collisions on fast successive creates). Use a counter seeded from the max existing numeric pk plus a per-call increment, or `crypto.randomUUID()` when the pk field is non-numeric. Keep it simple: read current array, compute `maxId = max(existing numeric pks, 0)`, assign `maxId + 1`. Document the "why" per CODE_CONVENTIONS magic-number rule (it mirrors `MemoryProxy`'s lack of id-gen, made persistent). Only assign when the record's `getId()` is `undefined`.

### Query-string serialization in `AjaxProxy.read()`

After the existing `page`/`pageSize` `URLSearchParams` block, append `sort` and `filter` keys when present:
`search.set('sort', JSON.stringify(params.sorters))` and `search.set('filter', JSON.stringify(params.filters))`. Pass `signal: params?.signal` into the `fetch(...)` options object. Replace the inline envelope parsing (AjaxProxy.ts:113-144) with `const result = this._reader.read(json, paginated); this._lastTotalCount = result.total; return result.records;`. Replace `JSON.stringify(record.getData())` in `create`/`update` with `this._writer.writeRecord(record)`.

---

## Ordered Implementation Steps

1. **`proxy/Reader.ts`** — add `ReadResult`, `Reader`, `JsonReaderOptions`, `JsonReader`. `JsonReader.read()` reproduces the current `AjaxProxy` parse exactly: when `paginated`, unwrap `root`, then read `rootProperty` (default `data`) as the array and `totalProperty` (default `total`) as the count, throwing the same messages on bad shapes; otherwise unwrap `root` to an array or fall back to a top-level array. → verify: logic matches [AjaxProxy.ts:113-144](../src/typescript/lib/data/proxy/AjaxProxy.ts#L113).
2. **`proxy/Writer.ts`** — add `Writer`, `JsonWriter` (`JSON.stringify(record.getData())`; batch maps `getData()` over the array).
3. **`proxy/Proxy.ts`** — extend `ReadParams` with `sorters`, `filters`, `signal`. Import `SortDescriptor` from `~/data/AbstractStore.js` and `FilterDescriptor` from `~/data/FilterDescriptor.js`. → verify: no circular-import break (`SortDescriptor` is a type-only import; `AbstractStore` already imports `ReadParams`, so use `import type`).
4. **`proxy/AjaxProxy.ts`** — add `reader`/`writer` options + backing fields (default `new JsonReader({ root: options.root })`, `new JsonWriter()`); route `read()` through the reader, append `sort`/`filter`/`signal`, route `create`/`update` bodies through the writer. → verify: existing `AjaxProxy.test.ts` passes unchanged.
5. **`proxy/WebStorageProxy.ts`** — new proxy per _Public API_ + _Internal Structure_; CRUD mirrors [MemoryProxy.ts](../src/typescript/lib/data/proxy/MemoryProxy.ts), reading/writing the JSON blob each op; seed `data` only when key absent.
6. **`AbstractStore.ts`** — add `_loadSeq`, `_loadAbort`, `remoteSort`/`remoteFilter` state + `applyOptions` wiring; rewrite `load()` with the guard; add private `buildReadParams(signal)`; add public `getActiveFilters()`; make `filter()`/`filterBy()` reset page + reload when `remoteFilter` (or legacy `_pageSize != null`); update the `sort()`/`clearFilter()` reload predicate to also honor `remoteSort`/`remoteFilter`. → verify: paginated stores with no remote flags behave as before (page reload still fires).
7. **`index.ts`** — export `WebStorageProxy` (+ `WebStorageProxyOptions`/`Config`), `Reader`/`JsonReader`/`ReadResult`/`JsonReaderOptions`, `Writer`/`JsonWriter`. Re-export `getActiveFilters` is automatic (method on exported class).
8. **Regression checkpoints** — `grep -rn 'JSON.stringify(record.getData())' src/` → expect zero matches after step 4; `grep -rn 'envelope.data' src/` → expect zero (moved into `JsonReader`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/data/proxy/Reader.ts` |
| Create | `src/typescript/lib/data/proxy/Writer.ts` |
| Create | `src/typescript/lib/data/proxy/WebStorageProxy.ts` |
| Modify | `src/typescript/lib/data/proxy/Proxy.ts` (extend `ReadParams`) |
| Modify | `src/typescript/lib/data/proxy/AjaxProxy.ts` (reader/writer, query serialization, signal) |
| Modify | `src/typescript/lib/data/AbstractStore.ts` (load guard, remote sort/filter, `getActiveFilters`) |
| Modify | `src/typescript/lib/data/index.ts` (new exports) |
| Modify | `docs/data/proxy.md` (WebStorageProxy + Reader/Writer sections) |
| Modify | `docs/data/index.md` (catalog mention) |
| Create | `tests/unit/data/proxy/WebStorageProxy.test.ts` |
| Modify | `tests/unit/data/proxy/AjaxProxy.test.ts` (reader/writer + remote sort/filter query) |

---

## Verification

- **Typecheck:** `npm run build` (or `tsc --noEmit`) — 0 errors. Watch for the `Proxy.ts`↔`AbstractStore.ts` type cycle; resolve with `import type`.
- **Unit tests:** `npm test`. Existing `AjaxProxy.test.ts` and `MemoryProxy.test.ts` pass unmodified except the additive cases. New cases: `JsonReader` parity (paginated + unpaginated + root), `JsonWriter` body, `AjaxProxy.read()` appends `sort=`/`filter=` only with the flags, `signal` is threaded; `WebStorageProxy` CRUD round-trips through a mocked `localStorage`; a stale-load test where two `load()` calls overlap and only the newer one's records land.
- **Grep invariants:** the two checkpoints in step 8.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice is the lone allowed warning). Confirm `WebStorageProxy`, `Reader`, `JsonReader`, `Writer`, `JsonWriter` land under `docs/api/data/`.
- **Manual smoke:** no dedicated demo screen exists for proxies; exercise via the data demo / any paginated table — confirm a paginated remote store with `remoteSort: true` re-fetches on header sort and `remoteFilter: true` re-fetches on filter.

---

## Documentation Impact

- **Barrel:** all new symbols re-export from `src/typescript/lib/data/index.ts` (the data subpath barrel — there is no root barrel). Each new class/interface needs `@category Data`.
- **Curated page:** `docs/data/proxy.md` gains a `## WebStorageProxy` section (mirroring the existing MemoryProxy/AjaxProxy sections) and a `## Reader & Writer` section showing how to pass a custom `reader`/`writer` to `AjaxProxy`. Add `WebStorageProxy` to the bullet list at the top ("Three proxies ship…").
- **Catalog:** `docs/data/index.md` line 24 — extend the Proxy bullet to mention `WebStorageProxy`.
- **Sidebar:** no new page file, so `docs/.vitepress/config.mts` needs no new entry (Proxy page already linked at line 184).
- **Cross-bucket JSDoc:** all new references stay within the `data` bucket, so `{@link …}` resolves; no cross-bucket markdown links needed.
- **No renames/removals** — additive only; `AjaxProxyOptions`/`MemoryProxyOptions` deprecated aliases are untouched.

---

## Potential Challenges

- **`Proxy.ts` importing `SortDescriptor` from `AbstractStore.ts` risks a circular import.** Mitigation: `import type` only (erased at compile time); `AbstractStore` already depends on `Proxy`, and a type-only edge does not create a runtime cycle.
- **Aborted fetch surfaces as a thrown `AbortError`.** Mitigation: the `load()` catch swallows `AbortError` and any superseded-sequence error, re-throwing only genuine failures.
- **`localStorage` may be unavailable (private mode / SSR / quota).** Mitigation: `WebStorageProxy` reads/writes through `window[...]Storage`; a `QuotaExceededError` on write propagates as a rejected promise (do not silently swallow) — this is the proxy's transport error, consistent with `AjaxProxy` throwing on non-OK. Note in JSDoc, do not add elaborate fallback (out of scope).
- **Behavior drift for existing paginated stores.** Mitigation: the reload-trigger predicate keeps the legacy `_pageSize != null` branch, so turning on no flags reproduces today's behavior exactly (including its existing limitation that order isn't serialized).
- **Worker path multi-sort degradation is unrelated** ([AbstractStore.ts:911-945](../src/typescript/lib/data/AbstractStore.ts#L911)) — remote sort/filter does not touch the worker path; when a remote flag is on the worker still runs over the already-correct page, which is harmless.

---

## Critical Files

- [`src/typescript/lib/data/proxy/Proxy.ts`](../src/typescript/lib/data/proxy/Proxy.ts) — `ReadParams`, the abstract CRUD contract, `getLastTotalCount`.
- [`src/typescript/lib/data/proxy/AjaxProxy.ts`](../src/typescript/lib/data/proxy/AjaxProxy.ts) — the envelope/serialization logic being extracted; the `forward-super-options` pattern at lines 52-54.
- [`src/typescript/lib/data/proxy/MemoryProxy.ts`](../src/typescript/lib/data/proxy/MemoryProxy.ts) — the shape `WebStorageProxy` mirrors (options bag, pk-keyed CRUD).
- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) — `load()`, `applyOptions`, `sort()`/`filter()`/`clearFilter()`, `getActiveSorters()`, `applyView()`.
- [`src/typescript/lib/data/FilterDescriptor.ts`](../src/typescript/lib/data/FilterDescriptor.ts) — the serializable filter algebra carried in `ReadParams`.
- [`src/typescript/lib/data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) — `getData()`, `getId()`, `getModel()` used by the writer and `WebStorageProxy`.
- [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts) — the export surface.

---

## Non-Goals

- **Sync error handling / events** (acting on `ReadResult.success`/`message`, retry, error events) — plan #3. The reader parses these fields but the proxy/store do not react to them.
- **Collection / aggregation** (grouping, summaries) — plan #4.
- **Validation and associations** — separate plans; `WebStorageProxy` persists raw data without validating it.
- **Reader/Writer on non-Ajax proxies** — `MemoryProxy`/`WebStorageProxy` operate on in-process objects; serialization there would be dead configurability.
- **IndexedDB / async storage** — `WebStorageProxy` targets synchronous Web Storage only.
- **Cursor/keyset pagination or server-driven page metadata beyond `total`** — the existing `{page, pageSize, total}` model is unchanged.
