# TablePanel

[`TablePanel`](/api/classes/TablePanel) is a composite that combines a [`Table`](/components/Table) with an add / remove / sync toolbar. The toolbar is docked to the north region; the table fills the centre.

This is the convenience component for CRUD UIs that don't need a custom toolbar layout.

## Usage

```typescript
import { TablePanel } from '@jimka/typescript-ui/component/table';
const panel = new TablePanel(store);
container.addComponent(panel);
```

The toolbar exposes four actions out of the box:

- **Add** — calls `store.add({})` to insert a new record. The new row appears with the `table.row.new` background tint until committed.
- **Remove** — calls `store.remove(record)` for the selected row.
- **Sync** — calls `store.sync()` to push pending changes to the proxy.
- **Reject** — calls `store.reject()` to revert dirty rows, drop new ones, and restore pending removals.

## Customising the toolbar

For fine-grained control over the toolbar buttons, build a layout yourself with a north-region [`HBox`](/api/classes/HBox) of `Button`s and a centre-region [`Table`](/components/Table). `TablePanel` is intended for the common case where you just want CRUD wired up.

## Pagination

When the store is paginated (via `setPageSize`), drop a
[`PaginationBar`](/components/PaginationBar) into the south region:

```typescript
import { PaginationBar } from '@jimka/typescript-ui/component/display';
import { TablePanel } from '@jimka/typescript-ui/component/table';
store.setPageSize(25);

const panel = new TablePanel(store);
panel.setPaginationBar(new PaginationBar(store));
```

`setPaginationBar(bar)` replaces any previously attached bar and disposes
its store listeners.

## Exporting

`TablePanel` delegates [`Table`](/components/Table)'s export methods so callers
don't have to drill through `getTable()`:

```typescript
panel.setExportMenuEnabled(true);                    // adds CSV/JSON entries to the column menu
panel.exportCSV();                                   // visible columns → table-export.csv
panel.exportJSON({ filename: 'people.json' });       // custom filename
panel.exportCSV({ includeHidden: true });            // every resolved column
```

See [Table › Exporting](/components/Table#exporting) for the formatting and
escaping rules.

## See also

- [API: TablePanel](/api/classes/TablePanel)
- [`Table`](/components/Table) — the underlying component
- [`PaginationBar`](/components/PaginationBar) — pagination navigation
- [Store › Add and remove records](/data/store#add-and-remove-records)
- [Store › Server-side pagination](/data/store#server-side-pagination)
