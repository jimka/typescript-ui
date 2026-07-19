# Data binding

The framework's data layer is a three-piece system:

- A [`Model`](/api/data/classes/Model) defines the shape of a record (its fields and types).
- A [`Proxy`](/api/data/classes/Proxy) handles transport — load records from memory, an HTTP endpoint, or a custom source.
- A [`Store`](/api/data/classes/Store) orchestrates loading, sorting, filtering, and event notification.

A [`ModelRecord`](/api/data/classes/ModelRecord) is a single row produced by a store. A [`Binding`](/api/core/classes/Binding) wires a record to UI components for two-way edit / commit / reject.

The pages in this section walk each piece in detail:

- [Model](/data/model) — defining schemas, field mapping.
- [Store](/data/store) — loading, sorting, filtering, events.
- [Proxy](/data/proxy) — `MemoryProxy`, `AjaxProxy`, custom proxies.
- [Record](/data/record) — getting / setting fields, dirty state, commit / reject.
- [Binding](/data/binding) — two-way binding to form components.

## Why a data layer?

The framework's [`Table`](/api/component/table/classes/Table), [`Tree`](/api/component/tree/classes/Tree), [`ComboBox`](/api/component/input/classes/ComboBox), and [`List`](/api/component/list/classes/List) components all consume stores. Sharing one store across multiple components keeps everything in sync — sorting the table re-orders the list, committing an edit in a form clears the dirty flag in the table.

For form-based editing, [`Binding`](/api/core/classes/Binding) gives you two-way sync between a single record and a set of input components, with explicit `commit()` / `reject()` semantics — no implicit auto-save.

## Quickest tour

```typescript
import { Binding } from '@jimka/typescript-ui/core';
import { Model, MemoryStore } from '@jimka/typescript-ui/data';
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

## Charts

The [charting family](/components/) binds to a [`Store`](/api/data/classes/Store) the same way [`ComboBox`](/components/ComboBox) and [`List`](/components/List) do: pass the store plus the record fields the chart should read. A [`LineChart`](/components/LineChart) or [`BarChart`](/components/BarChart) reads each point's `x`/`y` from `xField`/`yField`, and an optional `seriesField` splits the records into one series per distinct value. The chart subscribes to the store's `load` / `add` / `remove` / `datachange` events and rebuilds itself when the data changes — a toggled-off series stays hidden across a refresh (matched by name).

```typescript
import { Model, MemoryStore } from '@jimka/typescript-ui/data';
import { LineChart } from '@jimka/typescript-ui/component/chart';

const SalesModel = new Model([
    { name: 'id',     type: 'number' },
    { name: 'month',  type: 'number' },
    { name: 'sales',  type: 'number' },
    { name: 'region', type: 'string' },
]);

const store = new MemoryStore(SalesModel, [
    { id: 1, month: 1, sales: 30, region: 'North' },
    { id: 2, month: 2, sales: 45, region: 'North' },
    { id: 3, month: 1, sales: 20, region: 'South' },
    { id: 4, month: 2, sales: 28, region: 'South' },
]);

panel.addComponent(LineChart({ store, xField: 'month', yField: 'sales', seriesField: 'region' }));

await store.load(); // the chart repaints from the load event
```

Pass an in-memory `series` array instead of `store` when the data is static — the two are mutually exclusive construction paths.
