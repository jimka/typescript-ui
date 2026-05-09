# Proxy

A [`Proxy`](/api/classes/Proxy) is the transport layer of the data stack. Stores ask the proxy to fetch records; the proxy returns raw data which the store turns into [records](/data/record).

Two proxies ship with the package:

- [`MemoryProxy`](/api/classes/MemoryProxy) — serves an in-memory array.
- [`AjaxProxy`](/api/classes/AjaxProxy) — fetches JSON from an HTTP endpoint.

## MemoryProxy

Use this when you have data already in JavaScript (test fixtures, static lists, embedded JSON). For convenience, you can usually skip it and use [`MemoryStore`](/api/classes/MemoryStore) directly.

```typescript
import { MemoryProxy, Store } from '@jimka/typescript-ui';

const proxy = new MemoryProxy({
    data: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
    ],
});

const store = new Store(PersonModel, proxy);
await store.load();
```

See [`MemoryProxyConfig`](/api/interfaces/MemoryProxyConfig) for the full options.

## AjaxProxy

Fetches JSON over HTTP via the browser's `fetch` API. For convenience, you can usually skip the proxy and use [`AjaxStore`](/api/classes/AjaxStore) directly, which constructs the proxy from the same config.

```typescript
import { AjaxProxy, Store } from '@jimka/typescript-ui';

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

See [`AjaxProxyConfig`](/api/interfaces/AjaxProxyConfig) for the complete option list.

### Server-side pagination

When the [`Store`](/data/store) has had `setPageSize(n)` called on it, the
store's `load()` forwards a [`ReadParams`](/api/interfaces/ReadParams) object to
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
[`getLastTotalCount()`](/api/classes/Proxy#getlasttotalcount).

## Custom proxies

Subclass [`Proxy`](/api/classes/Proxy) and implement `load()`. This is the path for GraphQL, WebSocket, IndexedDB, or any other transport.

```typescript
import { Proxy } from '@jimka/typescript-ui';

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
