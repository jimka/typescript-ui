# Data layer

The framework's data package gives you a model-store-proxy stack for record-oriented UIs.

```
+----------+        +-------+        +-------+
|  Proxy   |  --->  | Store |  --->  |  UI   |
+----------+        +-------+        +-------+
   transport          state           Table, Tree,
   (HTTP, memory,     loading,        ComboBox, List,
    custom)           sort, filter    Binding
```

- A [`Model`](/api/data/classes/Model) defines the shape of a record (its fields and types).
- A [`Proxy`](/api/data/classes/Proxy) handles transport — load records from memory, an HTTP endpoint, or a custom source.
- A [`Store`](/api/data/classes/Store) orchestrates loading, sorting, filtering, and event notification.
- A [`ModelRecord`](/api/data/classes/ModelRecord) is a single row produced by a store, with dirty tracking and commit / reject semantics.
- An [`Association`](/api/data/classes/Association) lets a model own records of another model, surfaced as a parent-scoped child store.
- A [`Binding`](/api/core/classes/Binding) wires a record to UI components for two-way edit / commit / reject.

## Pages

- [Model](/data/model) — defining schemas, field mapping.
- [Store](/data/store) — loading, sorting, filtering, events, mutations, and the hierarchical `TreeStore`.
- [Proxy](/data/proxy) — `MemoryProxy`, `AjaxProxy`, `WebStorageProxy`, custom `Reader`/`Writer`, remote sort/filter.
- [Record](/data/record) — getting / setting fields, dirty state, commit / reject.
- [Associations](/data/associations) — `hasMany` / `belongsTo`, eager vs lazy loading, cascade sync.
- [Binding](/data/binding) — two-way binding to form components.
