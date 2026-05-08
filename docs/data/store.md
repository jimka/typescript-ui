# Store

A [`Store`](/api/classes/Store) holds an ordered collection of [records](/data/record), pulled in by a [proxy](/data/proxy) and shaped by a [model](/data/model).

## Load from memory

[`MemoryStore`](/api/classes/MemoryStore) is a convenience subclass that wires a [`MemoryProxy`](/api/classes/MemoryProxy) internally:

```typescript
import { MemoryStore } from '@jika/typescript-ui';

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

## Load from a REST endpoint

```typescript
import { AjaxProxy, Store } from '@jika/typescript-ui';

const store = new Store(PersonModel, new AjaxProxy({
    url:  '/api/people',
    root: 'data',     // extracts response.data array
}));

await store.load();
```

See [Proxy](/data/proxy) for the full set of [`AjaxProxy`](/api/classes/AjaxProxy) options.

## Typed subclasses

Extend [`AbstractStore`](/api/classes/AbstractStore) to bake in the model and proxy, and add domain-specific methods. Combine with an `AbstractModel` subclass to keep the schema self-contained:

```typescript
import { AbstractModel, AbstractStore, AjaxProxy } from '@jika/typescript-ui';

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

## Add and remove records

```typescript
const [newPerson] = store.add({ id: 3, name: 'Carol', age: 28 });

store.on('datachanged', () => console.log('store changed'));

store.remove(newPerson);
```

`store.add` returns the array of newly-created records (so it works with bulk inserts too).

## Events

| Event | Fired when |
| --- | --- |
| `load`         | `load()` resolves |
| `datachanged`  | Any record is added, removed, or moved (sorted) |
| `update`       | A record's fields change (commit or rollback) |

The full event surface is typed as [`StoreEvent`](/api/type-aliases/StoreEvent).

## See also

- [Model](/data/model) — the schema you pass to a store.
- [Proxy](/data/proxy) — the transport layer.
- [Record](/data/record) — what `getAt` / `find` returns.
- [`StoreWorker`](/api/classes/Store) — offload heavy sort / filter to a Web Worker (advanced).
