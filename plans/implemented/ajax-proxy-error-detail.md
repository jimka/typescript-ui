# AjaxProxy Error Detail — Implementation Plan

## Overview

`AjaxProxy` throws away the backend's error response body on a failed request. Every
`!response.ok` branch throws a bare `new Error('AjaxProxy: … failed with status N')`
([AjaxProxy.ts:106](../src/typescript/lib/data/proxy/AjaxProxy.ts#L106),
[:187](../src/typescript/lib/data/proxy/AjaxProxy.ts#L187),
[:211](../src/typescript/lib/data/proxy/AjaxProxy.ts#L211),
[:233](../src/typescript/lib/data/proxy/AjaxProxy.ts#L233),
[:257](../src/typescript/lib/data/proxy/AjaxProxy.ts#L257),
[:279](../src/typescript/lib/data/proxy/AjaxProxy.ts#L279),
[:300](../src/typescript/lib/data/proxy/AjaxProxy.ts#L300)) — carrying only the HTTP
status. A consumer can never read the server's error detail (e.g. a FastAPI
`{ detail: "duplicate key on email" }` on a 409).

This plan introduces a new exported error class, `AjaxError extends Error`, that carries
the HTTP status, status text, the parsed error body, the failing operation, and the
request URL. A single shared private helper, `throwHttpError`, reads the body (JSON first,
text fallback, never letting a body-read failure mask the original HTTP error) and throws
the `AjaxError`. It replaces every bare `throw new Error(...)` site listed above.

The change is **purely an `AjaxProxy` enhancement**. The thrown value already flows
unmodified through the store: `load()` puts it on the `'exception'` event as
`error: err` ([AbstractStore.ts:346](../src/typescript/lib/data/AbstractStore.ts#L346))
and re-throws; `sync()`'s `recordFailure` puts it on `error`
([AbstractStore.ts:1342](../src/typescript/lib/data/AbstractStore.ts#L1342)) and also on
the `'sync'` payload's `failures`. Because `AjaxError` is still an `Error`, every existing
`catch`/rethrow path keeps working — the change only enriches what is thrown.

---

## Architecture Decisions

### A new `AjaxError` class, exported from the `data` barrel

`AjaxError` extends `Error` so existing `catch (err: Error)` and rethrow paths are
unaffected; it adds typed fields the store consumer can read off the `'exception'` /
`'sync'` payload's `error` without parsing the message string. It is new **public API**:
the store's `StoreExceptionEvent.error` is typed `unknown`
([AbstractStore.ts:53](../src/typescript/lib/data/AbstractStore.ts#L53)), so a consumer
must `instanceof AjaxError`-narrow it — which requires `AjaxError` to be importable from
`@jimka/typescript-ui/data`.

### Field set — `status`, `statusText`, `body`, `operation`, `url`

Chosen by reading the store payload. `StoreExceptionEvent` already carries `operation`
and `records` separately ([AbstractStore.ts:50](../src/typescript/lib/data/AbstractStore.ts#L50)),
but the proxy throw site is the only place that knows the HTTP `status`/`statusText`, the
parsed `body`, and the request `url`. Carrying `operation` on `AjaxError` too makes the
error self-describing when logged in isolation (the proxy already knows which op it is) and
costs nothing. `operation` is typed as the existing public
`StoreOperation = 'read' | 'create' | 'update' | 'destroy'`
([AbstractStore.ts:37](../src/typescript/lib/data/AbstractStore.ts#L37)) — reusing it
keeps the proxy and store vocabularies aligned and avoids inventing a parallel union.
`body: unknown` because the server can return any JSON shape or plain text.

### One shared private helper `throwHttpError(response, operation, url)`

There are seven identical `!response.ok` branches (see Overview). A single private async
helper that reads the body and throws `AjaxError` is the surgical, DRY fix — each call site
becomes a one-liner `await this.throwHttpError(response, 'create', this._url)`. The helper
returns `Promise<never>` (it always throws) so TypeScript narrows correctly after the call
and no `return`/unreachable-code juggling is needed at the call sites. This is exactly the
"reusable mechanics extracted from call-site-specific writes" carve-out in CLAUDE.md §2.

### Body read is best-effort and never masks the HTTP error

The helper attempts `response.json()`; on parse failure (non-JSON body) it falls back to
`response.text()`; if *that* also throws (body already consumed, network drop mid-read), the
helper still throws an `AjaxError` carrying `status`/`statusText`/`url` with `body`
undefined. The original HTTP failure is always reported — a body-read problem only degrades
the detail, it never swallows the error or throws a different error type. A `Response` body
can be read only once; each helper call owns its `response` exclusively (the success path in
every op reads the body only on the `response.ok` branch, which the helper never reaches), so
there is no double-read hazard.

### `message` stays a useful plain-`Error` string

`message` keeps the existing shape — `AjaxProxy: <operation> failed with status <status>` —
so anything that only logs `err.message` (or treats it as a vanilla `Error`) reads the same
as today. The structured fields are additive.

### No callable wrapper

The `callable()` / `export { XCallable as X }` dual-export pattern documented in
`_shared/docs-conventions.md` (§ typedoc-callable-plugin) applies only to **Component**
classes that need to be invocable as factories. `AjaxError` is a plain error class — it is
exported normally (`export class AjaxError`) and re-exported from the barrel as a normal
named export, like `JsonReader`/`JsonWriter`.

### `AbstractStore` is NOT modified

Confirmed by reading both failure paths. `load()` does
`this.emit('exception', { operation: 'read', records: [], error: err }); throw err;`
([AbstractStore.ts:346-348](../src/typescript/lib/data/AbstractStore.ts#L346)) — `err` is
the raw thrown value, untouched. `sync()`'s per-record and batch runners catch into
`recordFailure(operation, records, err, failures)`, which builds
`{ operation, records, error }` and emits it
([AbstractStore.ts:1341-1345](../src/typescript/lib/data/AbstractStore.ts#L1341)). The
store never wraps, stringifies, or re-types the error, so an `AjaxError` arrives at every
`store.on('exception')` / `store.on('sync')` listener as `error` verbatim. **No store
change is needed.**

---

## Public API (TypeScript Signatures)

```ts
// src/typescript/lib/data/proxy/AjaxError.ts

import { StoreOperation } from '~/data/AbstractStore.js';

/**
 * Error thrown by {@link AjaxProxy} when the server responds with a non-OK
 * HTTP status. Carries the parsed error body so downstream code can surface
 * the server's message.
 *
 * @category Data
 */
export class AjaxError extends Error {
    /** The HTTP status code of the failed response (e.g. 409). */
    readonly status: number;
    /** The HTTP status text of the failed response (e.g. "Conflict"). */
    readonly statusText: string;
    /** The parsed error body — JSON when parseable, else the raw text, else undefined. */
    readonly body: unknown;
    /** The proxy operation that failed. */
    readonly operation: StoreOperation;
    /** The request URL that produced the failure. */
    readonly url: string;

    constructor(operation: StoreOperation, url: string, response: Response, body: unknown);
}
```

`StoreOperation` is re-imported from `AbstractStore` (it is already exported there and from
the `data` barrel). `name` is set to `'AjaxError'` in the constructor (so `err.name` and
default `toString()` read correctly even after transpilation/minification — see Potential
Challenges). `message` is set to `` `AjaxProxy: ${operation} failed with status ${status}` ``.

Private helper added to `AjaxProxy`:

```ts
/**
 * Reads the error body off a non-OK response (JSON first, text fallback, both
 * best-effort) and throws an {@link AjaxError}. Always throws.
 */
private async throwHttpError(response: Response, operation: StoreOperation, url: string): Promise<never>;
```

---

## Internal Structure

`throwHttpError` body shape (logic, not final formatting):

```ts
private async throwHttpError(response: Response, operation: StoreOperation, url: string): Promise<never> {
    let body: unknown;

    try {
        body = await response.json();
    } catch {
        // Non-JSON body — fall back to text. A second failure (body already
        // consumed / stream error) leaves body undefined; the HTTP error is
        // still reported below.
        try {
            body = await response.text();
        } catch {
            body = undefined;
        }
    }

    throw new AjaxError(operation, url, response, body);
}
```

Each call site (one example; all seven follow the same shape, passing the op kind and the
URL that op fetched):

```ts
if (!response.ok) {
    await this.throwHttpError(response, 'create', this._url);
}
```

The two id-scoped ops (`update`, `destroy`) pass `` `${this._url}/${record.getId()}` `` as
the URL — the same expression used in their `fetch` call — so `AjaxError.url` matches the
actual request target. `read` passes the computed `url` from `buildReadUrl(params)`. The
batch ops and `create` pass `this._url`.

### Throw-site → operation mapping

| Method | Line | `operation` | `url` argument |
|---|---|---|---|
| `read` | [:105](../src/typescript/lib/data/proxy/AjaxProxy.ts#L105) | `'read'` | `url` (from `buildReadUrl`) |
| `create` | [:186](../src/typescript/lib/data/proxy/AjaxProxy.ts#L186) | `'create'` | `this._url` |
| `update` | [:210](../src/typescript/lib/data/proxy/AjaxProxy.ts#L210) | `'update'` | `` `${this._url}/${record.getId()}` `` |
| `destroy` | [:232](../src/typescript/lib/data/proxy/AjaxProxy.ts#L232) | `'destroy'` | `` `${this._url}/${record.getId()}` `` |
| `createBatch` | [:256](../src/typescript/lib/data/proxy/AjaxProxy.ts#L256) | `'create'` | `this._url` |
| `updateBatch` | [:278](../src/typescript/lib/data/proxy/AjaxProxy.ts#L278) | `'update'` | `this._url` |
| `destroyBatch` | [:299](../src/typescript/lib/data/proxy/AjaxProxy.ts#L299) | `'destroy'` | `this._url` |

Batch ops map to the singular `StoreOperation` (`'create'`/`'update'`/`'destroy'`) because
that is the existing union and matches how the store labels batch failures
([AbstractStore.ts:1181](../src/typescript/lib/data/AbstractStore.ts#L1181) calls
`runBatch('create', …)`).

The success-path return shapes are unchanged: `read` still returns records, `create`/`update`
return the unwrapped object, `destroy`/`destroyBatch` return `void`, the batch creates/updates
return the array from `readBatchResponse`. The helper sits only on the `!response.ok` branch,
so it never interferes with any success shape.

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/data/proxy/AjaxError.ts`** — the `AjaxError` class per
   the signature above. Import `StoreOperation` from `~/data/AbstractStore.js`. Constructor
   sets `super(message)`, `this.name = 'AjaxError'`, and the five readonly fields from the
   `Response` + args. SPDX header on line 1 (match sibling files).
   → verify: `grep -n "export class AjaxError" src/typescript/lib/data/proxy/AjaxError.ts`.

2. **Add the `throwHttpError` private helper to `AjaxProxy`** (place it next to the other
   private helpers, e.g. after `readBatchResponse`). Import `AjaxError` and `StoreOperation`
   at the top of `AjaxProxy.ts`.
   → verify: typecheck.

3. **Replace all seven `throw new Error(...)` branches** with
   `await this.throwHttpError(response, '<op>', <url>)` per the mapping table.
   → verify: `grep -n "throw new Error" src/typescript/lib/data/proxy/AjaxProxy.ts` — expect
   zero matches (the file has no other `throw new Error`).

4. **Re-export from the `data` barrel** — add to
   [src/typescript/lib/data/index.ts](../src/typescript/lib/data/index.ts):
   `export { AjaxError } from '~/data/proxy/AjaxError.js';` near the other proxy exports
   (after line 30).
   → verify: `grep -n "AjaxError" src/typescript/lib/data/index.ts`.

5. **Update the class-level JSDoc `@remarks` of `AjaxProxy`**
   ([:36](../src/typescript/lib/data/proxy/AjaxProxy.ts#L36)) — it currently says the CRUD
   methods "throw an `Error`"; change to note they throw an `{@link AjaxError}` carrying the
   parsed body. Likewise the `read` JSDoc's "An `Error` is thrown" lines
   ([:83](../src/typescript/lib/data/proxy/AjaxProxy.ts#L83),
   [:107 region](../src/typescript/lib/data/proxy/AjaxProxy.ts#L94)). `{@link AjaxError}`
   resolves in-bucket (same `data` subpath), so the link is valid.
   → verify: `npm run docs:build` finishes with 0 warnings.

6. **Docs** — see `## Documentation Impact`.
   → verify: `npm run docs:build`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/data/proxy/AjaxError.ts` |
| Modify | `src/typescript/lib/data/proxy/AjaxProxy.ts` (helper + 7 throw sites + JSDoc + imports) |
| Modify | `src/typescript/lib/data/index.ts` (re-export `AjaxError`) |
| Modify | `docs/data/proxy.md` (error-detail subsection on AjaxProxy) |
| Modify | `docs/data/index.md` (catalog line mentions `AjaxError`) |
| Modify | `docs/.vitepress/config.mts` (only if an `AjaxError` page link is added — not required; see Documentation Impact) |

---

## Expected Behaviour

All `AjaxProxy` cases below are **offline-unit-testable** by mocking the global `fetch`
(no DOM, no real network). The store-flow case is also offline-testable with a mock proxy
or mock `fetch`.

1. **Non-OK response with a JSON body** — `fetch` resolves `{ ok: false, status: 409,
   statusText: 'Conflict', json: () => ({ detail: 'duplicate key on email' }) }`.
   `proxy.create(record)` rejects with an `AjaxError` where `status === 409`,
   `statusText === 'Conflict'`, `body` deep-equals `{ detail: 'duplicate key on email' }`,
   `operation === 'create'`, `url === proxy._url`, and `err instanceof AjaxError` and
   `err instanceof Error` are both true. *(offline)*

2. **Non-OK response with a non-JSON body** — `json()` rejects, `text()` resolves
   `'<html>500</html>'`. The thrown `AjaxError` has `body === '<html>500</html>'` and the
   correct `status`. *(offline)*

3. **Non-OK response whose body read fully fails** — both `json()` and `text()` reject. An
   `AjaxError` is still thrown, carrying `status`/`statusText`/`url`, with `body === undefined`.
   No other error type leaks. *(offline)*

4. **`message` is a plain useful string** — `err.message` equals
   `'AjaxProxy: create failed with status 409'`; `err.name === 'AjaxError'`. *(offline)*

5. **Every op throws `AjaxError`** — `read`, `create`, `update`, `destroy`, `createBatch`,
   `updateBatch`, `destroyBatch` each reject with an `AjaxError` whose `operation` matches the
   mapping table when their `fetch` returns `!ok`. `update`/`destroy` set
   `url === \`${proxy._url}/${id}\``. *(offline)*

6. **Success paths unchanged** — an `ok` response still returns the existing shapes (records /
   unwrapped object / void / array). No `AjaxError` is constructed on success; the body is
   read exactly once on the success branch as before. *(offline)*

7. **`AjaxError` surfaces through the store** — with an `AjaxProxy` (or a proxy stub that
   throws an `AjaxError`), `store.on('exception', e => …)` receives `e.error instanceof
   AjaxError` with the populated fields; `store.load()` rejects with the same `AjaxError`;
   `store.sync()` resolves and `store.on('sync', e => e.failures[0].error)` is the
   `AjaxError`. *(offline — drive via mock `fetch` or a stub proxy)*

---

## Verification

- **Typecheck:** `npm run build` (or the project's `tsc` step) — clean.
- **Grep invariants:**
  - `grep -n "throw new Error" src/typescript/lib/data/proxy/AjaxProxy.ts` → zero matches.
  - `grep -rn "throwHttpError" src/typescript/lib/data/proxy/AjaxProxy.ts` → 7 call sites + 1 definition.
  - `grep -n "AjaxError" src/typescript/lib/data/index.ts` → present.
- **Unit tests** covering `## Expected Behaviour` 1–7 (mock `fetch` for the proxy cases;
  mock `fetch` or a stub proxy for the store-flow case). Author them test-first per the
  `implement` skill.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported
  TypeScript version" notice is the only acceptable warning). Confirm `AjaxError` appears at
  `docs/api/data/classes/AjaxError` after build.
- **No manual/visual step required** — there is no rendering, focus, drag, or geometry in
  this change; everything is exercisable offline. No demo screen applies.

---

## Documentation Impact

`AjaxError` is consumer-visible public API.

- **Barrel:** re-exported from `src/typescript/lib/data/index.ts` (the per-subpath `data`
  barrel — there is no root barrel). With `@category Data` it lands in `docs/api/data/index.md`
  after build automatically.
- **Curated page:** `docs/data/proxy.md` is the page covering proxies (it documents
  `MemoryProxy`/`AjaxProxy`/`WebStorageProxy` and has an `## AjaxProxy` section at
  [proxy.md:30](../docs/data/proxy.md#L30)). Add a short subsection under `## AjaxProxy`
  (e.g. `### Error handling`) showing that a non-OK response throws an `AjaxError` with
  `status`/`statusText`/`body`/`operation`/`url`, and a snippet narrowing it off
  `store.on('exception')`. Cross-link the store side: `docs/data/store.md`'s
  "Sync error handling" section ([store.md:280](../docs/data/store.md#L280)) already documents
  the `'exception'` event's `error` — add one line noting that an `AjaxProxy` populates it
  with an `AjaxError` (markdown link to `/api/data/classes/AjaxError`, since store↔proxy is the
  same `data` bucket but the page-level link form is clearer here).
- **Catalog:** `docs/data/index.md` line 25 lists the proxy classes — append a mention that
  `AjaxProxy` throws `AjaxError` (or add `AjaxError` to the proxy bullet). Optional.
- **Sidebar (`docs/.vitepress/config.mts`):** **no new page** is needed — `AjaxError` is
  documented inside the existing `/data/proxy` page, which is already in the sidebar
  ([config.mts:193](../docs/.vitepress/config.mts#L193)). Adding a dedicated page is out of
  scope; do not add a sidebar entry.
- **JSDoc cross-bucket:** `AjaxError` and `AjaxProxy` are in the same `data` bucket, so
  `{@link AjaxError}` from `AjaxProxy` JSDoc resolves cleanly. `StoreOperation` is also in the
  `data` bucket. No cross-bucket markdown-link form is required for the JSDoc.

---

## Potential Challenges

- **`extends Error` + transpilation prototype break.** Subclassing built-in `Error` can lose
  the prototype chain under older transpile targets, breaking `instanceof`. Mitigation: set
  `this.name = 'AjaxError'` in the constructor; if `instanceof` tests fail in the build's
  target, add `Object.setPrototypeOf(this, AjaxError.prototype)` in the constructor. Verify
  with Expected Behaviour #1's `instanceof` assertion under the actual build output.
- **`Response` body read-once.** A `Response` body can be consumed only once. The helper only
  runs on the `!ok` branch (the success branch never reaches it), so it owns the body
  exclusively — no double-read. The internal text-after-json fallback is safe because a failed
  `json()` does not consume the stream in a way that blocks `text()` for the typical non-JSON
  case; the nested `catch` covers the residual edge where it does.
- **`Promise<never>` return type.** Returning `Promise<never>` from `throwHttpError` keeps the
  call sites as `await this.throwHttpError(...)` with no spurious "not all code paths return"
  errors and correct downstream narrowing.

---

## Critical Files

- [src/typescript/lib/data/proxy/AjaxProxy.ts](../src/typescript/lib/data/proxy/AjaxProxy.ts)
  — the seven throw sites, the success shapes, the existing JSDoc to amend.
- [src/typescript/lib/data/AbstractStore.ts](../src/typescript/lib/data/AbstractStore.ts) —
  `StoreOperation` ([:37](../src/typescript/lib/data/AbstractStore.ts#L37)),
  `StoreExceptionEvent` ([:50](../src/typescript/lib/data/AbstractStore.ts#L50)),
  `load()` exception path ([:346](../src/typescript/lib/data/AbstractStore.ts#L346)),
  `recordFailure` ([:1341](../src/typescript/lib/data/AbstractStore.ts#L1341)). Read only to
  confirm no change is needed — it is **not** modified.
- [src/typescript/lib/data/index.ts](../src/typescript/lib/data/index.ts) — the `data` barrel;
  add the `AjaxError` re-export near the proxy exports.
- [src/typescript/lib/data/proxy/Reader.ts](../src/typescript/lib/data/proxy/Reader.ts) /
  `Writer.ts` — sibling plain-class exports to mirror for export form and SPDX header.
- [docs/data/proxy.md](../docs/data/proxy.md), [docs/data/store.md](../docs/data/store.md),
  [docs/data/index.md](../docs/data/index.md) — doc pages to update.

---

## Non-Goals

- **No configurable error parser.** The body is read JSON-then-text with no hook to customise
  parsing — out of scope.
- **No retry / backoff.** A failed request throws immediately; no retry policy is added.
- **No store changes.** `AbstractStore` already passes the thrown error through verbatim;
  this plan does not touch it.
- **No new `AjaxProxy` options.** Reading the code proves none are needed to carry the error
  detail — the helper derives everything from the `Response` and the call site.
- **No dedicated docs page or sidebar entry for `AjaxError`** — it is documented inside the
  existing `/data/proxy` page.
