# Data binding

The framework's data layer is a three-piece system:

- A [`Model`](/api/classes/Model) defines the shape of a record (its fields and types).
- A [`Proxy`](/api/classes/Proxy) handles transport — load records from memory, an HTTP endpoint, or a custom source.
- A [`Store`](/api/classes/Store) orchestrates loading, sorting, filtering, and event notification.

A [`ModelRecord`](/api/classes/ModelRecord) is a single row produced by a store. A [`Binding`](/api/classes/Binding) wires a record to UI components for two-way edit / commit / reject.

The pages in this section walk each piece in detail:

- [Model](/data/model) — defining schemas, field mapping.
- [Store](/data/store) — loading, sorting, filtering, events.
- [Proxy](/data/proxy) — `MemoryProxy`, `AjaxProxy`, custom proxies.
- [Record](/data/record) — getting / setting fields, dirty state, commit / reject.
- [Binding](/data/binding) — two-way binding to form components.

## Why a data layer?

The framework's [`Table`](/api/classes/Table), [`Tree`](/api/classes/Tree), [`ComboBox`](/api/classes/ComboBox), and [`List`](/api/classes/List) components all consume stores. Sharing one store across multiple components keeps everything in sync — sorting the table re-orders the list, committing an edit in a form clears the dirty flag in the table.

For form-based editing, [`Binding`](/api/classes/Binding) gives you two-way sync between a single record and a set of input components, with explicit `commit()` / `reject()` semantics — no implicit auto-save.

## Quickest tour

```typescript
import { Model, MemoryStore, Binding } from '@jimka/typescript-ui';

const PersonModel = new Model([
    { name: 'id',   type: 'number' },
    { name: 'name', type: 'string' },
    { name: 'age',  type: 'number', defaultValue: 0 },
]);

const store = new MemoryStore(PersonModel, [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob',   age: 25 },
]);

await store.load();

const record = store.getAt(0);
record?.set('age', 31);
console.log(record?.isDirty()); // true
record?.commit();
```
