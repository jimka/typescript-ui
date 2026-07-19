# Record

A [`ModelRecord`](/api/data/classes/ModelRecord) is a single row managed by a [store](/data/store). Records track which fields you have changed since the last commit and let you roll back unsaved edits.

## Get a record

Stores expose several lookup methods:

```typescript
store.getAt(0);                  // by index
store.find('id', 1);             // first match by field value
store.findAll('age', 25);        // all matches by field value
store.getCount();                // total visible records
```

## Read fields

```typescript
const record = store.getAt(0);
const name = record?.get('name');
const age  = record?.get('age');
```

`get` returns the field's current value, including any uncommitted edits.

## Mutate a record

```typescript
record?.set('age', 31);
console.log(record?.isDirty());  // true
record?.commit();                // clears dirty flag
// record?.reject()              // reverts to last committed snapshot
```

`set` updates the in-memory value and marks the field dirty. The change does **not** propagate to the proxy automatically — you must call `commit()` (or perform whatever save action your app uses) explicitly.

`set` also coerces the value to the field's [type](/data/model#value-coercion), so `record.set('age', '31')` stores the number `31`. Values assigned to a name that is not a model field pass through unchanged.

Mutating a field on a record that belongs to a store also **auto-notifies that store** — every view bound to the same store instance refreshes. This is in-memory propagation only and is unrelated to proxy persistence: as noted above, saving still requires an explicit `commit()` (or your app's save action). A no-op `set` (same value) notifies nobody.

### Batch edits and silent writes

Setting several fields one at a time fires one refresh per `set`. To coalesce them into a single notification, wrap the writes in a record batch:

```typescript
record.beginEdit();
record.set('first', 'Ada');
record.set('last', 'Lovelace');
record.commitEdit();             // one notification carrying both changes
// record.cancelEdit();          // alternative: discard the batch, revert both fields
```

`setMany` is the shorthand for the common case:

```typescript
record.setMany({ first: 'Ada', last: 'Lovelace' });   // one notification
```

Batches nest: a `setMany` (or another `beginEdit`) inside an open batch collapses into the outer one, so only the outermost `commitEdit` fires, diffed against the outermost baseline. `setSilent(field, value)` mutates a field without notifying at all — for framework-internal writes whose surrounding operation already signals the change.

## Inspecting changes

`getChanges()` returns a `{ old, new }` map of every field changed since the last `commit()`; `getModified()` is an alias. Both return an empty object for a clean record.

```typescript
record.set('name', 'Bob');
record.getChanges();             // { name: { old: 'Alice', new: 'Bob' } }
```

The comparison is shallow (the same rule dirty tracking uses), so object / array field values are compared by reference.

## Cloning and the internal id

Every record carries a stable, client-only `internalId` assigned at construction. Unlike `getId()` (the primary-key value, `undefined` until the server replies), the internal id exists immediately, so UI can key unsynced rows on it.

```typescript
record.getInternalId();          // e.g. 7 — unique within the session
const copy = record.clone();     // fresh internalId, marked new + dirty
copy.getInternalId() === record.getInternalId(); // false
```

A clone is a distinct row: it gets its own internal id and is flagged new and dirty so a store treats it as an insert.

## Validation

Field [validators](/data/model#validation) are evaluated on demand — there is no event or cached validity state, so call these after edits:

```typescript
record.isValid();                // false if any field fails
record.getErrors();              // { age: 'Value must be at least 0.' }
record.validateField('age');     // first failing message, or '' when valid
```

`validateField` runs the field's implicit type check first, then its explicit rules, returning the first failing message. `getErrors()` reports one message per invalid field, and `isValid()` is true only when that map is empty.

## Dirty tracking

A record is **dirty** when at least one of its fields has been modified since the last `commit()`. The framework uses this state in two places:

- The [`Table`](/api/component/table/classes/Table) component tints dirty rows differently (token: `table.row.dirty` — see [Theming](/concepts/theming)).
- A [`Binding`](/api/core/classes/Binding) emits its `"change"` event whenever a bound field value changes.

```typescript
record.isDirty();                 // any field dirty?
record.commit();                  // mark everything clean
record.reject();                  // revert to clean snapshot
```

## New vs existing records

`store.add()` creates **new** records. New records render with a different background tint in `Table` (token: `table.row.new`) until you commit them — useful for forms that batch insertions.

```typescript
const [newRecord] = store.add({ id: 3, name: 'Carol' });
console.log(newRecord.isNew());  // true
// (after a successful save…)
newRecord.commit();
console.log(newRecord.isNew());  // false
```

## Associations

When the record's [model declares associations](/data/model#associations), `getAssociated(accessor)` returns the cached, parent-scoped child [`Store`](/data/store):

```typescript
const employees = department.getAssociated('employees');   // a Store
employees.add({ name: 'Ada' });

// belongsTo: read the raw foreign key without loading the owner
employee.getForeignKeyValue('department');                 // 42
```

Repeated calls for the same accessor return the same store instance. `getAssociated` never auto-loads; to fetch children lazily, the association must carry a `proxy` and the parent must already have an id, then call `getAssociated(accessor).load()`. See [Associations](/data/associations) for eager vs lazy loading, cascade sync, and `belongsTo`.

## See also

- [Store](/data/store) — find / iterate / mutate records.
- [Associations](/data/associations) — `getAssociated` and the parent-scoped child store.
- [Binding](/data/binding) — wire a record to form fields with two-way sync.
