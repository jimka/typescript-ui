# Record

A [`ModelRecord`](/api/classes/ModelRecord) is a single row managed by a [store](/data/store). Records track which fields you have changed since the last commit and let you roll back unsaved edits.

## Get a record

Stores expose several lookup methods:

```typescript
store.getAt(0);                  // by index
store.find('id', 1);             // by field value
store.findBy(r => r.get('age') > 20);   // by predicate
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

## Dirty tracking

A record is **dirty** when at least one of its fields has been modified since the last `commit()`. The framework uses this state in two places:

- The [`Table`](/api/classes/Table) component tints dirty rows differently (token: `table.row.dirty` — see [Theming](/concepts/theming)).
- A [`Binding`](/api/classes/Binding) calls its `onChange` listeners whenever the dirty state changes.

```typescript
record.isDirty();                 // any field dirty?
record.isFieldDirty('name');      // this specific field?
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

## See also

- [Store](/data/store) — find / iterate / mutate records.
- [Binding](/data/binding) — wire a record to form fields with two-way sync.
