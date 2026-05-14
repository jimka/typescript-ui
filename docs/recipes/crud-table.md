# CRUD with a Table

Wire a [`Table`](/components/Table) to a REST endpoint with add / remove / sync support.

## Goal

A scrollable, editable table of people. The user can:

- Load existing records from `GET /api/people`
- Add new rows (sent as `POST /api/people`)
- Remove rows (sent as `DELETE /api/people/:id`)
- Edit cells in place; commit edits back to the server

## Define the model and store

```typescript
import { AbstractModel, AbstractStore, AjaxProxy } from '@jimka/typescript-ui/data';
class PersonModel extends AbstractModel {
    readonly fields = [
        { name: 'id',    type: 'number'  },
        { name: 'name',  type: 'string'  },
        { name: 'email', type: 'string'  },
        { name: 'age',   type: 'number'  },
    ];
}

class PersonStore extends AbstractStore {
    readonly model = new PersonModel();
    readonly proxy = new AjaxProxy({
        url:  '/api/people',
        root: 'data',  // expects { data: [...] }
    });
}

const store = new PersonStore();
await store.load();
```

## Drop in a TablePanel

[`TablePanel`](/components/TablePanel) gives you the toolbar (Add / Remove / Sync) for free:

```typescript
import { Body } from '@jimka/typescript-ui/core';
import { TablePanel } from '@jimka/typescript-ui/component/table';
const panel = TablePanel(store);
Body.getInstance().addComponent(panel);
```

That's it for the full CRUD path. Let's break down what happens:

- **Add** — calls `store.add({})`. The new row gets the `table.row.new` background tint until `store.sync()` confirms it server-side.
- **Edit** — double-click any cell; the in-place editor commits on blur or Enter. Modified rows show the `table.row.dirty` tint.
- **Remove** — selects a row, then calls `store.remove(record)`.
- **Sync** — calls `store.sync()` which talks to the proxy: `POST` for new records, `PUT`/`PATCH` for dirty ones, `DELETE` for removed ones.

## Custom toolbar

If you need different buttons (e.g. an Export action), drop the `TablePanel` and lay it out yourself:

```typescript
import { Component, Event, Notification } from '@jimka/typescript-ui/core';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Border as BorderLayout, HBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
import { Table } from '@jimka/typescript-ui/component/table';
const addBtn    = Button('Add');
const exportBtn = Button('Export CSV');
const syncBtn   = Button('Sync');

Event.addListener(addBtn,    'click', () => store.add({}));
Event.addListener(exportBtn, 'click', () => exportCSV(store));
Event.addListener(syncBtn,   'click', async () => {
    await store.sync();
    Notification.show('Saved.', 'success');
});

const root = Component({
    layoutManager: BorderLayout(),
    components: [
        {
            component: Component({
                layoutManager: HBox(),
                components: [addBtn, exportBtn, syncBtn]
            }),
            constraints: { region: Placement.NORTH }
        },
        {
            component: Table(store),
            constraints: { region: Placement.CENTER }
        }
    ]
});
```

## Constraining columns

Use a [`ColumnSpec`](/api/interfaces/ColumnSpec) to control widths and order:

```typescript
const table = Table(store, {
    columns: [
        { field: 'name',  minWidth: 160 },
        { field: 'email', minWidth: 220 },
        { field: 'age',   maxWidth: 80  },
    ],
    appendUnlisted: false,  // hide the id column
});
```

## See also

- [Table](/components/Table) and [TablePanel](/components/TablePanel)
- [Data layer](/data/) — model, store, proxy, record
- [Bind a record to a form](/recipes/bind-form) — for detail / edit panels
