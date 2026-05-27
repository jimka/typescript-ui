# TreeTable

[`TreeTable`](/api/component/table/classes/TreeTable) is a data-bound table whose rows form a parent/child hierarchy. One designated column carries the indent + expand/collapse toggle; every other column behaves like a normal [`Table`](/components/Table) cell.

`TreeTable` extends [`Table`](/components/Table), so its public surface — CRUD, sync, column visibility + resize, sort cycling, context menu, exporter — is identical. The only structural difference is the body: a [`TreeBody`](/api/component/table/classes/TreeBody) that walks the visible subtree on every render instead of binding directly to the store's view.

## Hierarchy via `parentField`

Each record names the id of its parent via a model field — usually called `parentId`. Roots have a `null` (or absent) value. The `TreeTableSpec` names the id field, the parent field, and the column that carries the toggle.

```typescript
import { Model, MemoryStore } from '@jimka/typescript-ui/data';
import { TreeTable } from '@jimka/typescript-ui/component/table';

const model = new Model([
    { name: 'id',       type: 'number' },
    { name: 'parentId', type: 'number' },
    { name: 'name',     type: 'string' },
    { name: 'size',     type: 'number' },
]);

const store = new MemoryStore(model, [
    { id: 1, parentId: null, name: 'src',         size: 0   },
    { id: 2, parentId: 1,    name: 'main.ts',     size: 320 },
    { id: 3, parentId: null, name: 'package.json', size: 1100 },
]);

const tree = new TreeTable(store, {
    idField:     'id',
    parentField: 'parentId',
    treeColumn:  'name',
    columns: [
        { field: 'name', minWidth: 200 },
        { field: 'size', maxWidth: 100 },
    ],
});

panel.addComponent(tree);
```

## TreeTableSpec

[`TreeTableSpec`](/api/component/table/interfaces/TreeTableSpec) extends [`ColumnSpec`](/api/component/table/interfaces/ColumnSpec) with three required fields and one optional field:

| Field | Purpose |
| --- | --- |
| `idField` | Model field carrying each record's id. |
| `parentField` | Model field carrying each record's parent id, or `null` for roots. |
| `treeColumn` | Field name of the column whose cell carries the indent + toggle. |
| `indentPx` | Pixels of indentation per depth level. Defaults to `16`. |

Every other `ColumnSpec` field (`columns`, `appendUnlisted`, plus the per-column knobs `minWidth`, `maxWidth`, `hidden`, `showSeconds`, `headerGlyph`, `group`, `groupColor`) works unchanged.

## Expand / collapse

| Method | Purpose |
| --- | --- |
| `setExpanded(record, expanded)` | Expand or collapse a single branch. No-op on leaves. |
| `isExpanded(record)` | Returns `true` only when the record has children AND is expanded. |
| `expandToDepth(depth)` | Expand every branch at depth `<= depth`. Roots are depth 0. |
| `collapseAll()` | Collapse every branch. |
| `expandAll()` | Expand every branch. |

Expand state is keyed by the record's `idField` value (not by `ModelRecord` reference), so a store sync that replaces records preserves expansion.

## Keyboard

Inherits everything from [`Table`](/components/Table) (`ArrowUp` / `ArrowDown` for row nav, `ArrowLeft` / `ArrowRight` for column nav, `Enter` / `Space` to edit, `Home` / `End`, `PageUp` / `PageDown`) and overrides `ArrowLeft` / `ArrowRight` to act on the tree structure when a tree row is focused:

- **`ArrowRight`** — Expand a collapsed branch. If already expanded, move focus to the first child.
- **`ArrowLeft`** — Collapse an expanded branch. If already collapsed (or a leaf at depth > 0), move focus to the parent record.

When the focused row has no tree-specific meaning for the key (e.g. `ArrowLeft` on a leaf at depth 0), the inherited column-navigation behaviour runs.

## ARIA

The root element's role is `treegrid` (not `grid`). Pool rows carry the standard `aria-rowindex` plus `aria-level`, `aria-expanded`, `aria-setsize`, `aria-posinset` from the WAI-ARIA tree pattern.

## Adding child rows

`TreeTable.addRow(defaults, parent?)` extends the inherited `Table.addRow` with an optional second argument. When `parent` is supplied, the record's `parentField` value is set to `parent.get(idField)` before insertion so the new record slots under the given parent on the next render.

```typescript
const parent = tree.getStore().getAt(0);

if (parent) {
    tree.addRow({ name: 'new.ts', size: 0 }, parent);
}
```

## Sort interaction

`TreeBody._flatten()` walks the parent/child index every time the visible-row list rebuilds, which happens after any store event including `'sortchanged'`. Children render immediately under their parent at the current sort point — but if the active sort interleaves records across hierarchy levels (e.g. by name), the parent-child grouping in the flat view follows that order. There is no "freeze parent order under sort" mode; consumers that need stable hierarchy under sort should sort the records by a path-aware key.

## Filtering

A filter that drops a parent record drops its entire subtree from the flat view — the parent is no longer present in the index, so the recursive walk never enters its children. Orphan children whose parent id is filtered out are treated as roots and render at depth 0.

## Non-goals

- **Pinned columns.** Not yet supported on `TreeTable`.
- **Async lazy-load.** The store must already hold every record the user can expand into. A future plan can layer an "on-expand fetch" mode.
- **Animation.** Expand / collapse is instant, matching [`Tree`](/components/Tree).
- **Drag-reorder.** No drag handle on the toggle column.

## Related

- [`Table`](/components/Table) — the flat counterpart whose API `TreeTable` extends.
- [`TreeTablePanel`](/components/TreeTablePanel) — composite toolbar + `TreeTable`.
- [`Tree`](/components/Tree) — non-data-bound tree over `TreeNode` objects.
