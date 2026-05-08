# TablePanel

[`TablePanel`](/api/classes/TablePanel) is a composite that combines a [`Table`](/components/Table) with an add / remove / sync toolbar. The toolbar is docked to the north region; the table fills the centre.

This is the convenience component for CRUD UIs that don't need a custom toolbar layout.

## Usage

```typescript
import { TablePanel } from '@jimka/typescript-ui';

const panel = new TablePanel(store);
container.addComponent(panel);
```

The toolbar exposes three actions out of the box:

- **Add** — calls `store.add({})` to insert a new record. The new row appears with the `table.row.new` background tint until committed.
- **Remove** — calls `store.remove(record)` for the selected row.
- **Sync** — calls `store.sync()` to push pending changes to the proxy.

## Customising the toolbar

For fine-grained control over the toolbar buttons, build a layout yourself with a north-region [`HBox`](/api/classes/HBox) of `Button`s and a centre-region [`Table`](/components/Table). `TablePanel` is intended for the common case where you just want CRUD wired up.

## See also

- [API: TablePanel](/api/classes/TablePanel)
- [`Table`](/components/Table) — the underlying component
- [Store › Add and remove records](/data/store#add-and-remove-records)
