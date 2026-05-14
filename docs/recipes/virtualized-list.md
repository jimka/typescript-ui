# Virtualized lists

Both [`Table`](/components/Table) and [`Tree`](/components/Tree) render only the rows visible in the viewport plus a small buffer. Use them as-is for datasets up to hundreds of thousands of rows.

## Table — 100k rows

```typescript
import { Body } from '@jimka/typescript-ui/core';
import { Model, MemoryStore } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';
const ItemModel = new Model([
    { name: 'id',    type: 'number' },
    { name: 'name',  type: 'string' },
    { name: 'value', type: 'number' },
]);

// 100,000 records
const data = Array.from({ length: 100_000 }, (_, i) => ({
    id:    i,
    name:  `Item ${i}`,
    value: Math.random() * 1000,
}));

const store = new MemoryStore(ItemModel, data);
await store.load();

const table = Table(store);
Body.getInstance().addComponent(table);
```

The body keeps roughly 50 rows in the DOM at any time (viewport + buffer) regardless of dataset size. Memory usage is constant.

## Why this works

The table [`Body`](/api/component/table/classes/Body):

- Maintains a fixed pool of reusable [`Row`](/api/component/table/classes/Row) components.
- Scrolling is JS-owned via [`VirtualScroller`](/components/VirtualScroller): the rows live inside a transform-positioned container and two custom [`Scrollbar`](/components/Scrollbar) overlays drive both axes. Wheel, touch (with fling momentum), and keyboard nav all funnel through the same entry points.
- Only rows whose data index changed get rebound on scroll — the rest sit at the same DOM position.

[`Tree`](/components/Tree) uses the same approach; it flattens the visible subtree into a linear list and recycles a row pool.

## Sort and filter offload to a Worker

Once the dataset crosses the **1,000-row threshold**, [`AbstractStore`](/data/store) automatically runs sort and filter on a Web Worker so the main thread stays responsive:

```typescript
store.sort('value', 'desc');               // worker handles it
store.filterBy(r => r.get('value') > 500); // worker handles it
```

You don't configure anything — the worker is created lazily on first use.

## When you'd hit a wall

- **Initial data load** is still synchronous in the example above. For server-paginated data, write a custom [`Proxy`](/data/proxy) that fetches pages on demand.
- **Very wide tables** (hundreds of columns) push DOM nodes per visible row into the thousands. Hide unused columns via `setColumnVisible(field, false)` for a meaningful speedup.

## Memory considerations

- Records remain in memory in the store. 100k rows × 5 fields ≈ a few MB — comfortable for in-memory workflows.
- For multi-million-row datasets, a windowed/paginated proxy is the right shape. Ask the server for a window matching the viewport.

## See also

- [Table](/components/Table) and [Table internals](/components/TableInternals)
- [Tree](/components/Tree)
- [Performance](/concepts/performance) (forthcoming)
