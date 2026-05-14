# Store

A [`Store`](/api/classes/Store) holds an ordered collection of [records](/data/record), pulled in by a [proxy](/data/proxy) and shaped by a [model](/data/model).

## Load from memory

[`MemoryStore`](/api/classes/MemoryStore) is a convenience subclass that wires a [`MemoryProxy`](/api/classes/MemoryProxy) internally:

```typescript
import { MemoryStore } from '@jimka/typescript-ui/data';
const store = new MemoryStore(PersonModel, [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob',   age: 25 },
]);

store.on('load', () => {
    console.log(store.getCount());            // 2
    console.log(store.getAt(0)?.get('name')); // 'Alice'
});

await store.load();
```

Or pass a single [`MemoryStoreOptions`](/api/interfaces/MemoryStoreOptions) bag — useful when you also want pagination defaults, initial sorters/filters, or to register listeners declaratively:

```typescript
const store = new MemoryStore({
    model    : PersonModel,
    data     : initialPeople,
    pageSize : 25,
    sorters  : [{ field: 'name', dir: 'asc' }],
    autoLoad : true,
    listeners: { load: () => console.log('store loaded') },
});
```

## Load from a REST endpoint

[`AjaxStore`](/api/classes/AjaxStore) is a convenience subclass that wires an [`AjaxProxy`](/api/classes/AjaxProxy) internally — pass the proxy config straight to the store:

```typescript
import { AjaxStore } from '@jimka/typescript-ui/data';
const store = new AjaxStore(PersonModel, {
    url:  '/api/people',
    root: 'data',     // extracts response.data array
});

await store.load();
```

If you prefer to wire the proxy yourself (for example to share one `AjaxProxy` instance across stores), use [`Store`](/api/classes/Store) directly:

```typescript
import { AjaxProxy, Store } from '@jimka/typescript-ui/data';
const proxy = new AjaxProxy({ url: '/api/people', root: 'data' });
const store = new Store(PersonModel, proxy);

await store.load();
```

The same `Store` constructor accepts a [`StoreOptions`](/api/interfaces/StoreOptions) bag if you want to set pagination, sorters, filters, or `autoLoad` declaratively:

```typescript
const store = new Store({
    model    : PersonModel,
    proxy    : new AjaxProxy({ url: '/api/people', root: 'data' }),
    pageSize : 50,
    autoLoad : true,
});
```

See [Proxy](/data/proxy) for the full set of [`AjaxProxy`](/api/classes/AjaxProxy) options.

## Typed subclasses

Extend [`AbstractStore`](/api/classes/AbstractStore) to bake in the model and proxy, and add domain-specific methods. Combine with an `AbstractModel` subclass to keep the schema self-contained:

```typescript
import { AbstractModel, AbstractStore, AjaxProxy } from '@jimka/typescript-ui/data';
class PersonModel extends AbstractModel {
    readonly fields = [
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'age',  type: 'number', defaultValue: 0 },
    ];
}

class PersonStore extends AbstractStore {
    readonly model = new PersonModel();
    readonly proxy = new AjaxProxy({ url: '/api/people' });

    findByName(name: string) {
        return this.find('name', name);
    }
}

const personStore = new PersonStore();
await personStore.load();
personStore.findByName('Alice');
```

## Sort and filter

```typescript
store.sort('age', 'asc');

store.filter('age', 25);                  // exact match
store.filterBy(r => r.get('age') > 20);   // custom predicate
store.clearFilter();
```

Multiple `filter` / `filterBy` calls **stack** — every active predicate must pass for a record to be visible. `clearFilter()` removes all active predicates at once.

### Multi-column sort

`sort()` is overloaded: pass a [`SortDescriptor[]`](/api/interfaces/SortDescriptor) to apply a stable multi-column sort. The first descriptor is the primary key; ties are broken by the next one, and so on.

```typescript
store.sort([
    { field: 'lastName',  dir: 'asc'  },
    { field: 'firstName', dir: 'asc'  },
    { field: 'age',       dir: 'desc' },
]);

store.getActiveSorters();   // → SortDescriptor[] in priority order
store.sort([]);             // clear all sorters (also: store.clearSort())
```

`Table` headers compose multi-column sort interactively when the user shift-clicks. The store fires the dedicated `'sortchanged'` event whenever the active sorter list is replaced, alongside the broader `'datachanged'` notification.

The legacy `getActiveSorter()` accessor still works (returns the primary sorter mapped to `{ property, direction }`) but is **deprecated** in favour of `getActiveSorters()`.

## Add and remove records

```typescript
const [newPerson] = store.add({ id: 3, name: 'Carol', age: 28 });

store.on('datachanged', () => console.log('store changed'));

store.remove(newPerson);
```

`store.add` returns the array of newly-created records (so it works with bulk inserts too).

## Server-side pagination

Opt in by calling `setPageSize(n)`. From that point onward `load()` forwards a
[`ReadParams`](/api/interfaces/ReadParams) object to the proxy, and the store
tracks the current page and total count returned by the server. Stores that
never call `setPageSize` keep the legacy single-fetch behaviour.

```typescript
const store = new Store(PersonModel, new AjaxProxy({ url: '/api/people' }));
store.setPageSize(25);
await store.load();

store.getPage();         // 1
store.getTotalCount();   // e.g. 1234, from the server's { data, total } envelope
store.getTotalPages();   // 50

store.nextPage();        // re-fetches page 2
store.goToPage(10);
```

`sort()` and `clearFilter()` reset to page 1 and re-fetch in paginated mode so
the proxy receives fresh results. Pair the store with a
[`PaginationBar`](/components/PaginationBar) for ready-made navigation UI.

### Pending changes block page navigation

A page change reloads `allRecords` from the proxy, which would silently
discard any in-memory edits that have not been synced. To prevent that,
`nextPage` / `prevPage` / `goToPage` no-op and emit `'pagechangeblocked'`
when `hasPendingChanges()` is true. `PaginationBar` greys out its nav
buttons in that state.

The user can resolve the block in two ways:

- **Sync** — `store.sync()` pushes the changes to the proxy.
- **Reject** — `store.reject()` reverts dirty records, drops new ones, and
  restores pending removals.

`TablePanel`'s built-in toolbar exposes both as buttons.

## Events

| Event | Fired when |
| --- | --- |
| `load`              | `load()` resolves |
| `datachanged`       | Any record is added, removed, or moved (sorted) |
| `update`            | A record's fields change (commit or rollback) |
| `sortchanged`       | The active multi-column sort list changed (replaced or cleared) |
| `pagechanged`       | Page or page size changes via the pagination API |
| `pagechangeblocked` | Page navigation was blocked because the store has pending changes |

The full event surface is typed as [`StoreEvent`](/api/type-aliases/StoreEvent).

## See also

- [Model](/data/model) — the schema you pass to a store.
- [Proxy](/data/proxy) — the transport layer.
- [Record](/data/record) — what `getAt` / `find` returns.
- [`StoreWorker`](/api/classes/Store) — offload heavy sort / filter to a Web Worker (advanced).
