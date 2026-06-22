# Associations

An association lets a model declare that one record **owns** records of another model — `Department hasMany Employee`, `Employee belongsTo Department`. The children surface as a fully-featured, parent-scoped [`Store`](/api/data/classes/Store) (CRUD, filter, sort, events, aggregation), not a plain array.

Associations are declarative schema, exactly like [fields](/data/model): the [`Association`](/api/data/classes/Association) descriptor holds the accessor, target model, and foreign key; the runtime behaviour (hydrate, lazy-load, cascade) lives in the model, record, and store.

## Declaring associations

Add an `associations` array to a model's options bag. Each entry is an [`AssociationOptions`](/api/data/interfaces/AssociationOptions) object:

```typescript
import { Model } from '@jimka/typescript-ui/data';

const EmployeeModel = new Model({
    fields: [
        { name: 'id',     type: 'number' },
        { name: 'name',   type: 'string' },
        { name: 'deptId', type: 'number' },
    ],
    primaryKey: 'id',
    associations: [
        // Employee belongsTo Department
        { accessor: 'department', kind: 'belongsTo', foreignKey: 'deptId', target: () => DepartmentModel },
    ],
});

const DepartmentModel = new Model({
    fields: [
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
    ],
    primaryKey: 'id',
    associations: [
        // Department hasMany Employee
        { accessor: 'employees', foreignKey: 'deptId', target: () => EmployeeModel },
    ],
});
```

| Option | Purpose |
| --- | --- |
| `accessor` | The name passed to `record.getAssociated(accessor)` (e.g. `'employees'`) |
| `target` | A **thunk** returning the target model — `() => EmployeeModel` |
| `foreignKey` | The child field holding the owner's id (hasMany), or the owner's primary key this record points at (belongsTo) |
| `nestedKey` | Raw-payload key carrying an embedded child array; defaults to `accessor` |
| `kind` | `'hasMany'` (default) or `'belongsTo'` |
| `persist` | Cascade strategy: `'proxy'` (default) or `'nested'` |

### Why `target` is a thunk

`Department` references `Employee` and vice-versa, so a direct `target: EmployeeModel` reference would force a module-initialisation cycle. The thunk defers resolution: [`Association.resolveTarget()`](/api/data/classes/Association#resolvetarget) calls it once and memoises the result, so declaration order never matters.

### Nested keys must not collide with a field mapping

An embedded child array rides in the raw payload under the association's `nestedKey`. If that key equalled a field's `mapping`, the field loop would mis-read the array — so the model throws at schema-resolution time when a `nestedKey` collides with any `field.getMapping()`.

## Accessing children

`record.getAssociated(accessor)` returns the parent-scoped child store. There is **one** typed accessor method, not a generated `record.employees()` per association — a model author who wants the ergonomic form writes a one-line method on a `Model` subclass that calls `getAssociated('employees')`.

```typescript
const dept = departmentStore.getAt(0)!;
const employees = dept.getAssociated('employees');   // a Store

employees.getCount();
employees.add({ name: 'Ada' });
employees.on('add', refreshTable);
```

The store is **cached on the record**: repeated calls for the same accessor return the same instance, so listeners and the row index stay stable.

## Eager vs lazy loading

A hasMany child store is loaded in one of two ways, chosen automatically:

- **Eager** — when the parent payload embedded a child array under the `nestedKey`, those rows seed the child store directly (each child is *committed*, not new) with no second network round-trip:

  ```typescript
  departmentStore.loadData([
      { id: 1, name: 'Sales', employees: [{ id: 10, name: 'Ada' }, { id: 11, name: 'Bob' }] },
  ]);
  // dept.getAssociated('employees') → Store with two committed records
  ```

- **Lazy** — when no array was embedded, the child store carries a `remoteFilter` on the parent foreign key, so its first `load()` serialises `{ type: 'eq', field: foreignKey, value: parentId }` into the read request and fetches only this parent's children. A brand-new, unsynced parent has no id to fetch on, so its child store starts empty and is not auto-loaded; children are added in memory and stamped during cascade sync.

## belongsTo

A `belongsTo` association is the inverse: the record carries a foreign key pointing at its owner. `getAssociated(accessor)` returns an owner-scoped store filtered to the single parent (target primary key === this record's foreign key); `getForeignKeyValue(accessor)` returns the raw foreign-key value without loading.

```typescript
const emp = employeeStore.getAt(0)!;
emp.getForeignKeyValue('department');   // 42 — the deptId, no load
emp.getAssociated('department');        // owner-scoped Store filtered to id 42
```

Setting a child's foreign key does **not** auto-insert it into the owner's hasMany store — the two stores are independent.

## Persistence: cascade sync

Children persist through the **parent store's** `sync()`. After the parent's own creates and updates resolve (so every parent carries its server id), the cascade walks each parent's *materialised* hasMany child stores, stamps the parent foreign key onto each child, and runs the child store's own `sync()` — before the parent's deletes:

```
parent creates → parent updates → [cascade: FK-stamp + child.sync()] → parent deletes
```

This is dependency order: a child create can't be persisted until its parent has a server id, and children sync before the parent is removed. Only associations whose child store was actually accessed are walked, so a loaded-but-untouched parent costs nothing.

Because the cascade reuses each child store's own `sync()`, child [`'exception'`](/api/data/interfaces/StoreExceptionEvent) events, `syncErrorPolicy`, and batch behaviour all apply unchanged — failures surface on the child store's own event surface, not the parent's terminal `'sync'` payload. Set `cascadeSync: false` on the parent store to opt out of the walk.

### New-parent foreign keys

A child added to a brand-new parent can't know its foreign-key value yet — the parent has no server id. The cascade always stamps the FK from the live parent id (via [`getId()`](/api/data/classes/ModelRecord#getid)) before the child store syncs, so the stamp is correct whether the parent was just created or already existed. Until then, each child's stable [`internalId`](/data/record#cloning-and-the-internal-id) keys it in the UI.

### `'nested'` persistence

With `persist: 'nested'`, children serialise *inside the parent's write body* rather than through their own proxy. `ModelRecord.getData()` never carries children, but [`getDataWithNested()`](/api/data/classes/ModelRecord#getdatawithnested) returns the parent data augmented with `{ [nestedKey]: childRecordsData }` for every materialised `'nested'` association — the hook a nested-aware writer reads. The default writer serialises `getData()`, so wiring a writer that consumes `getDataWithNested()` is the integration point for `'nested'` mode; `'proxy'` (the default) needs no writer change.

## See also

- [Model](/data/model#associations) — declaring the `associations` array.
- [Record](/data/record#associations) — `getAssociated` / `getForeignKeyValue`.
- [Store](/data/store) — the child store's full CRUD / filter / sort / event API.
