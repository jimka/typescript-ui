# TreeTablePanel

[`TreeTablePanel`](/api/component/table/classes/TreeTablePanel) is the tree counterpart to [`TablePanel`](/components/TablePanel): a [`TreeTable`](/components/TreeTable) plus an add / remove / sync toolbar.

The toolbar is docked to the north region; the tree table fills the centre. The constructor takes the same `(store, spec)` pair as `TreeTable`.

<!-- demo: treetablepanel-toolbar -->
> **Live demo** — a `TreeTablePanel` over a file/folder hierarchy, showing
> its toolbar with rows that expand and collapse.
> [Open the TreeTablePanel page](https://jimka.github.io/typescript-ui/components/TreeTablePanel)
<!-- /demo -->

## Usage

```typescript
import { Model, MemoryStore } from '@jimka/typescript-ui/data';
import { TreeTablePanel, TreeTableSpec } from '@jimka/typescript-ui/component/table';

const model = new Model([
    { name: 'id',       type: 'number' },
    { name: 'parentId', type: 'number' },
    { name: 'name',     type: 'string' },
]);

const store = new MemoryStore(model);

const spec: TreeTableSpec = {
    idField:     'id',
    parentField: 'parentId',
    treeColumn:  'name',
    columns: [{ field: 'name', minWidth: 200 }],
};

const panel = new TreeTablePanel(store, spec);
container.addComponent(panel);
```

The toolbar exposes the same four actions as [`TablePanel`](/components/TablePanel):

- **Add** — inserts a record under the current selection. When the selected row is a directory the new record becomes its child; when the selected row is a leaf the new record slots under the leaf's parent (so it lands next to it under the same directory); with no selection the record lands at root. Use `panel.getTreeTable().addRow({ ... }, parentRecord)` directly to override the selection-aware target.
- **Remove** — calls `store.remove(record)` for the selected row.
- **Sync** — calls `store.sync()` to push pending changes to the proxy.
- **Reject** — calls `store.reject()` to revert dirty rows, drop new ones, and restore pending removals.

## Accessing the tree

`panel.getTreeTable()` returns the inner [`TreeTable`](/components/TreeTable). Use it for expand/collapse calls and to add child rows:

```typescript
const tree = panel.getTreeTable();

tree.expandToDepth(1);
tree.addRow({ name: 'README.md' }, tree.getSelectedRecord());
```

## Pagination

When the store is paginated, attach a [`PaginationBar`](/components/PaginationBar) the same way as on [`TablePanel`](/components/TablePanel):

```typescript
import { PaginationBar } from '@jimka/typescript-ui/component/display';
store.setPageSize(25);

const panel = new TreeTablePanel(store, spec);
panel.setPaginationBar(new PaginationBar(store));
```

Note that pagination over a tree is a niche scenario — the visible-row count depends on which branches are expanded, not on the underlying record count.

## Exporting

`TreeTablePanel` delegates the inner table's export methods:

```typescript
panel.setExportMenuEnabled(true);
panel.exportCSV();
panel.exportJSON({ filename: 'tree.json' });
panel.exportCSV({ includeHidden: true });
panel.exportTSV();
```

Export serialises the **store records**, not the flattened visible-row list — so collapsed branches still appear in the output, in store order.

## See also

- [API: TreeTablePanel](/api/component/table/classes/TreeTablePanel)
- [TreeTable](/components/TreeTable) — the inner component this panel wraps.
- [TablePanel](/components/TablePanel) — the flat counterpart.
