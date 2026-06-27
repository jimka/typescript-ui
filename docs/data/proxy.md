# Proxy

A [`Proxy`](/api/data/classes/Proxy) is the transport layer of the data stack. Stores ask the proxy to fetch records; the proxy returns raw data which the store turns into [records](/data/record).

Three proxies ship with the package:

- [`MemoryProxy`](/api/data/classes/MemoryProxy) — serves an in-memory array.
- [`AjaxProxy`](/api/data/classes/AjaxProxy) — fetches JSON from an HTTP endpoint.
- [`WebStorageProxy`](/api/data/classes/WebStorageProxy) — persists an array to `localStorage` / `sessionStorage`.

## MemoryProxy

Use this when you have data already in JavaScript (test fixtures, static lists, embedded JSON). For convenience, you can usually skip it and use [`MemoryStore`](/api/data/classes/MemoryStore) directly.

```typescript
import { MemoryProxy, Store } from '@jimka/typescript-ui/data';
const proxy = new MemoryProxy({
    data: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
    ],
});

const store = new Store(PersonModel, proxy);
await store.load();
```

See [`MemoryProxyOptions`](/api/data/interfaces/MemoryProxyOptions) for the full options. The legacy alias `MemoryProxyConfig` remains as a deprecated type re-export.

## AjaxProxy

Fetches JSON over HTTP via the browser's `fetch` API. For convenience, you can usually skip the proxy and use [`AjaxStore`](/api/data/classes/AjaxStore) directly, which constructs the proxy from the same config.

```typescript
import { AjaxProxy, Store } from '@jimka/typescript-ui/data';
const proxy = new AjaxProxy({
    url:    '/api/people',
    root:   'data',         // extract response.data instead of using the whole body
    method: 'GET',          // default
});

const store = new Store(PersonModel, proxy);
await store.load();
```

| Option | Purpose |
| --- | --- |
| `url`    | Endpoint URL |
| `method` | HTTP method (default `GET`) |
| `root`   | JSON path to the records array (e.g. `'data'` for `{ data: [...] }`) |

See [`AjaxProxyOptions`](/api/data/interfaces/AjaxProxyOptions) for the complete option list. The legacy alias `AjaxProxyConfig` remains as a deprecated type re-export.

### Server-side pagination

When the [`Store`](/data/store) has had `setPageSize(n)` called on it, the
store's `load()` forwards a [`ReadParams`](/api/data/interfaces/ReadParams) object to
`proxy.read()`. `AjaxProxy` appends `page` and `pageSize` as query-string
parameters and expects an envelope response:

```json
{ "data": [...], "total": 1234 }
```

Stores that never call `setPageSize` are unaffected — `read()` is still called
with no arguments and the response shape is the legacy top-level array (or
`json[root]`).

```typescript
const store = new Store(PersonModel, new AjaxProxy({ url: '/api/people' }));
store.setPageSize(25);
await store.load();
// → GET /api/people?page=1&pageSize=25
// → response: { data: [...], total: 1234 }
```

If `root` is configured, the envelope is read from `json[root]` first, then
`.data` and `.total` are extracted. The total count is exposed on the store
via `getTotalCount()` and `getTotalPages()`, and on the proxy itself via
[`getLastTotalCount()`](/api/data/classes/Proxy#getlasttotalcount).

### Remote sort & filter

By default a store sorts and filters its records client-side. Set
`remoteSort: true` and/or `remoteFilter: true` on the store to instead send the
active sorters/filters to the proxy and reload. `AjaxProxy` serializes them as
`sort=<json>` / `filter=<json>` query parameters.

```typescript
const store = new Store({
    model: PersonModel,
    proxy: new AjaxProxy({ url: '/api/people' }),
    remoteSort:   true,
    remoteFilter: true,
});
store.setPageSize(25);
await store.load();

await store.sort('name', 'asc');
// → GET /api/people?page=1&pageSize=25&sort=[{"field":"name","dir":"asc"}]
```

With the flags off, a paginated store still reloads on sort/filter (the legacy
behaviour) but sends only `{page, pageSize}`; turning the flags on is what
actually conveys the order/filter to the server.

### Overlapping loads

Each `load()` claims a monotonic sequence id and aborts the previous in-flight
read. A response whose load has been superseded is discarded — so a slow earlier
fetch can never overwrite a newer result — and the aborted HTTP request is
cancelled rather than merely ignored.

### Error handling

When the server responds with a non-OK status, every CRUD method (and its batch
variant) throws an [`AjaxError`](/api/data/classes/AjaxError). It extends `Error`
— so existing `catch`/rethrow paths and `err.message` logging keep working — and
adds the HTTP `status`, `statusText`, the parsed error `body` (JSON when
parseable, else the raw text, else `undefined`), the failing `operation`, and the
request `url`. The body is read best-effort; a body-read failure degrades the
detail but never masks the HTTP error.

The thrown error flows unchanged through the store, arriving on the `'exception'`
event (and the `'sync'` payload's `failures`) as `error`. Narrow it to recover
the server's message:

```typescript
import { AjaxError } from '@jimka/typescript-ui/data';

store.on('exception', ({ error }) => {
    if (error instanceof AjaxError) {
        // e.g. a FastAPI { detail: "duplicate key on email" } on a 409
        console.error(error.status, error.body);
    }
});
```

## WebStorageProxy

Persists its record array to the browser's `localStorage` (default) or
`sessionStorage` under a single JSON-encoded key. CRUD is keyed by primary key,
mirroring [`MemoryProxy`](/api/data/classes/MemoryProxy) but surviving page
reloads.

```typescript
import { WebStorageProxy, Store } from '@jimka/typescript-ui/data';
const proxy = new WebStorageProxy({
    key:     'people',     // storage key holding the array
    storage: 'local',      // 'local' (default) or 'session'
    data:    [{ id: 1, name: 'Alice' }],  // seed written only if the key is absent
});

const store = new Store({ model: PersonModel, proxy });
await store.load();
```

New records with no primary-key value are assigned a generated numeric id (one
past the largest existing numeric key). A `QuotaExceededError` from a full store
propagates as a rejected promise rather than being swallowed. See
[`WebStorageProxyOptions`](/api/data/interfaces/WebStorageProxyOptions); the
legacy alias `WebStorageProxyConfig` remains as a deprecated type re-export.

## Reader & Writer

`AjaxProxy` delegates response parsing to a [`Reader`](/api/data/interfaces/Reader)
and request serialization to a [`Writer`](/api/data/interfaces/Writer). The
defaults — [`JsonReader`](/api/data/classes/JsonReader) and
[`JsonWriter`](/api/data/classes/JsonWriter) — reproduce the standard
`{ data, total }` / top-level-array parsing and `JSON.stringify(record.getData())`
body. Pass your own to adapt a different envelope or wire format without
subclassing the proxy.

```typescript
const proxy = new AjaxProxy({
    url:    '/api/people',
    reader: new JsonReader({ rootProperty: 'items', totalProperty: 'count' }),
});
```

A custom reader returns a normalized
[`ReadResult`](/api/data/interfaces/ReadResult) (`{ records, total?, success?,
message? }`); a custom writer returns the request-body string for a record or
batch.

## Custom proxies

Subclass [`Proxy`](/api/data/classes/Proxy) and implement `load()`. This is the path for GraphQL, WebSocket, IndexedDB, or any other transport.

```typescript
import { Proxy } from '@jimka/typescript-ui/data';
class GraphQLProxy extends Proxy {
    constructor(private query: string) { super(); }

    async load() {
        const res = await fetch('/graphql', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ query: this.query }),
        });
        const json = await res.json();
        return json.data.results;
    }
}
```

Pass the custom proxy to a `Store` like any built-in proxy.

## See also

- [Store](/data/store) — uses a proxy under the hood.
- [Model](/data/model) — defines the shape the proxy's data must match.
