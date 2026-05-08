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
import {
    AbstractModel, AbstractStore, AjaxProxy,
} from '@jimka/typescript-ui';

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
import { TablePanel, Body } from '@jimka/typescript-ui';

const panel = new TablePanel(store);
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
import {
    Component, BorderLayout, Placement,
    HBox, Button, Table, Event, Notification,
} from '@jimka/typescript-ui';

const root = new Component();
root.setLayoutManager(new BorderLayout());

const toolbar = new Component();
toolbar.setLayoutManager(new HBox());

const addBtn  = new Button('Add');
const exportBtn = new Button('Export CSV');
const syncBtn = new Button('Sync');

Event.addListener(addBtn,    'click', () => store.add({}));
Event.addListener(exportBtn, 'click', () => exportCSV(store));
Event.addListener(syncBtn,   'click', async () => {
    await store.sync();
    Notification.show('Saved.', 'success');
});

toolbar.addComponent(addBtn);
toolbar.addComponent(exportBtn);
toolbar.addComponent(syncBtn);

root.addComponent(toolbar,        { region: Placement.NORTH  });
root.addComponent(new Table(store), { region: Placement.CENTER });
```

## Constraining columns

Use a [`ColumnSpec`](/api/interfaces/ColumnSpec) to control widths and order:

```typescript
const table = new Table(store, {
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
