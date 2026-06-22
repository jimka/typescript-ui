# Store

A [`Store`](/api/data/classes/Store) holds an ordered collection of [records](/data/record), pulled in by a [proxy](/data/proxy) and shaped by a [model](/data/model).

## Load from memory

[`MemoryStore`](/api/data/classes/MemoryStore) is a convenience subclass that wires a [`MemoryProxy`](/api/data/classes/MemoryProxy) internally:

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

Or pass a single [`MemoryStoreOptions`](/api/data/interfaces/MemoryStoreOptions) bag — useful when you also want pagination defaults, initial sorters/filters, or to register listeners declaratively:

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

[`AjaxStore`](/api/data/classes/AjaxStore) is a convenience subclass that wires an [`AjaxProxy`](/api/data/classes/AjaxProxy) internally — pass the proxy config straight to the store:

```typescript
import { AjaxStore } from '@jimka/typescript-ui/data';
const store = new AjaxStore(PersonModel, {
    url:  '/api/people',
    root: 'data',     // extracts response.data array
});

await store.load();
```

If you prefer to wire the proxy yourself (for example to share one `AjaxProxy` instance across stores), use [`Store`](/api/data/classes/Store) directly:

```typescript
import { AjaxProxy, Store } from '@jimka/typescript-ui/data';
const proxy = new AjaxProxy({ url: '/api/people', root: 'data' });
const store = new Store(PersonModel, proxy);

await store.load();
```

The same `Store` constructor accepts a [`StoreOptions`](/api/data/interfaces/StoreOptions) bag if you want to set pagination, sorters, filters, or `autoLoad` declaratively:

```typescript
const store = new Store({
    model    : PersonModel,
    proxy    : new AjaxProxy({ url: '/api/people', root: 'data' }),
    pageSize : 50,
    autoLoad : true,
});
```

See [Proxy](/data/proxy) for the full set of [`AjaxProxy`](/api/data/classes/AjaxProxy) options.

## Typed subclasses

Extend [`AbstractStore`](/api/data/classes/AbstractStore) to bake in the model and proxy, and add domain-specific methods. Combine with an `AbstractModel` subclass to keep the schema self-contained:

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
store.filterBy({ type: 'gt', field: 'age', value: 20 });   // descriptor-based filter
store.clearFilter();
```

Multiple `filter` / `filterBy` calls **stack** — every active predicate must pass for a record to be visible. `clearFilter()` removes all active predicates at once.

### Multi-column sort

`sort()` is overloaded: pass a [`SortDescriptor[]`](/api/data/interfaces/SortDescriptor) to apply a stable multi-column sort. The first descriptor is the primary key; ties are broken by the next one, and so on.

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

### Locale-aware ordering and custom comparators

Sorting is type-aware. String fields compare with `localeCompare`, so accented
letters fall in their expected place (`'Ä'` sorts between `'a'` and `'Z'`, not
after `'Z'` by code point); `date` / `time` / `datetime` fields compare by
timestamp. `null` / `undefined` always sort **last**, regardless of direction.
The same comparator runs whether the sort executes in-process or on the
[`StoreWorker`](/api/data/classes/Store), so a column's order is identical above
and below the worker threshold.

For ordering the built-in comparator can't express, give a [`SortDescriptor`](/api/data/interfaces/SortDescriptor)
a `sorterFn`:

```typescript
store.sort([
    { field: 'priority', dir: 'asc', sorterFn: (a, b) =>
        RANK[a.get('priority')] - RANK[b.get('priority')] },
]);
```

A `sorterFn` is a function, which cannot cross the worker's structured-clone
boundary, so any active custom sorter forces the in-process sort path even for
large datasets — correctness over offload. Keep `sorterFn` for the cases the
type-aware default genuinely can't cover.

## Add and remove records

```typescript
const [newPerson] = store.add({ id: 3, name: 'Carol', age: 28 });

store.on('datachanged', () => console.log('store changed'));

store.remove(newPerson);
```

`store.add` returns the array of newly-created records (so it works with bulk inserts too).

## Collection API

Beyond `getAt` / `getCount` / `find`, the store exposes a thin collection
surface over the **filtered view** (what `getRecords()` returns), plus an O(1)
primary-key lookup:

```typescript
store.getById(42);          // O(1) lookup by primary key (undefined if absent / no key)
store.indexOf(record);      // position in the view, or -1
store.getRange(0, 9);       // inclusive slice [0, 9], clamped to the view
store.first();              // first view record, or undefined
store.last();               // last view record, or undefined
store.contains(record);     // membership in the view
store.each((r, i) => …);    // iterate the view in order

store.insert(0, { id: 3, name: 'Carol' });   // like add(), but splice at an index
```

`getById` is backed by an id→record index that the store rebuilds on every view
recompute, so it stays correct after `load` / `add` / `insert` / `remove` without
a linear scan. It returns `undefined` when the model defines no primary key.

## Aggregation

`sum` / `average` / `min` / `max` / `collect` reduce over the **filtered view**,
so they always agree with the rows on screen — apply a filter and the totals
follow:

```typescript
store.sum('amount');        // total of the numeric field
store.average('amount');    // mean (0 over an empty / all-null view)
store.min('amount');        // smallest value, or undefined when none
store.max('amount');        // largest value, or undefined when none
store.collect('category');  // distinct values, in first-encounter (view) order
```

The numeric aggregates coerce each value with `Number(...)` and **skip**
`null` / `undefined` and anything that isn't a finite number, so an absent cell
never distorts a sum or average. `collect` is the type-agnostic companion —
handy for building a distinct-value filter list. There is no separate `count()`
method: `getCount()` already returns the view's row count, which is the count
aggregate.

For an **unfiltered** total, reduce `getAll()` yourself; the aggregates above
intentionally track the view.

## Grouping

Set a single group field to bucket the view by a column's value:

```typescript
store.setGroupField('department');   // fires 'groupchange'
store.getGroupField();               // 'department'

const groups = store.getGroups();    // Map<string, ModelRecord[]>
for (const [key, records] of groups) {
    console.log(key, records.length);
}

store.getGroupString(record);        // the bucket key for one record
```

`getGroups()` buckets the filtered view into a `Map`, preserving order: groups
appear in first-encounter order and records keep their view order within each
group. Keys are the `String()` form of the group value, with `''` standing in
for a null / unset value. Grouping is a pure read over the existing view, so
`setGroupField` fires only `'groupchange'` (once, on an actual change) and does
**not** rebuild the view or fire `'datachanged'`. Grouping is intentionally one
level deep.

## Server-side pagination

Opt in by calling `setPageSize(n)`. From that point onward `load()` forwards a
[`ReadParams`](/api/data/interfaces/ReadParams) object to the proxy, and the store
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

## Sync error handling

`sync()` persists new, dirty, and removed records in three phases — creates,
then updates, then deletes — and **always resolves**: a transport failure no
longer rejects the promise. Instead each failed operation emits an
[`'exception'`](/api/data/interfaces/StoreExceptionEvent) event carrying the
operation kind, the offending record(s), and the raw error, and the terminal
`'sync'` event reports the full list of failures so a listener can react once
at the end.

```typescript
store.on('exception', e => console.warn(`${e.operation} failed`, e.records, e.error));
store.on('sync', e => {
    if (e.failures.length > 0) { showRetryBanner(e.failures); }
});

await store.sync();   // settles even when an op failed
```

A record is committed only after **its own** operation succeeds, so a failure
never leaves a record looking persisted when it isn't. The `syncErrorPolicy`
option chooses what happens after the first failure:

- `'stop'` (default) — abort the rest of the run. Already-committed records stay
  committed; the failed record and every untouched record remain pending for the
  next `sync()`.
- `'continue'` — record the failure and proceed, so an independent sibling record
  still commits. Expect one `'exception'` per failed op; use the `'sync'`
  payload's `failures` to react to them collectively.

```typescript
const store = new Store({ model: PersonModel, proxy, syncErrorPolicy: 'continue' });
```

::: warning Contract change
`sync()` previously rejected on a transport failure. It now resolves in every
case; existing `try { await store.sync() } catch { … }` sites must switch to the
`'exception'` event or the `'sync'` payload's `failures`.
:::

When the proxy advertises batch hooks (`createBatch` / `updateBatch` /
`destroyBatch`, as `AjaxProxy` does), each phase issues a single request for the
whole group instead of one per record. Batching makes the commit/rollback
boundary coarser: a batch either commits every record from its server response
(positionally, in input order) or, on failure, leaves the **whole** batch pending
with all of its records carried on the `'exception'` event.

## Events

| Event | Fired when |
| --- | --- |
| `beforeload`        | `load()` is about to read through the proxy |
| `load`              | `load()` resolves |
| `exception`         | A `load()` read or a `sync()` create/update/destroy failed |
| `datachanged`       | Any record is added, removed, moved (sorted), or has its fields committed / rolled back |
| `clear`             | `removeAll()` cleared the store (carries the removed records) |
| `update`            | `notifyRecordChanged(record)` reported an external edit |
| `sortchanged`       | The active multi-column sort list changed (replaced or cleared) |
| `filterchange`      | The active filter list changed (added or cleared) |
| `groupchange`       | The active group field changed via `setGroupField` |
| `beforesync` / `sync` | `sync()` starts / settles (the `'sync'` payload lists any failures) |
| `pagechanged`       | Page or page size changes via the pagination API |
| `pagechangeblocked` | Page navigation was blocked because the store has pending changes |

The full event surface is typed as [`StoreEvent`](/api/data/type-aliases/StoreEvent).

## See also

- [Model](/data/model) — the schema you pass to a store.
- [Proxy](/data/proxy) — the transport layer.
- [Record](/data/record) — what `getAt` / `find` returns.
- [`StoreWorker`](/api/data/classes/Store) — offload heavy sort / filter to a Web Worker (advanced).
