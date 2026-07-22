# PaginationBar

[`PaginationBar`](/api/component/display/classes/PaginationBar) is a horizontal navigation bar
that drives a paginated [`Store`](/api/data/classes/Store) — first / previous /
next / last buttons plus a `Page X of Y` label.

The bar listens to the store's `'pagechange'` and `'load'` events and
keeps button-enabled state in sync automatically.

## Usage

Pair the bar with any store that has had `setPageSize(n)` called on it.
[`AjaxProxy`](/api/data/classes/AjaxProxy) is the typical proxy choice; it
appends `?page=N&pageSize=M` and parses a `{ data, total }` envelope.

```typescript
import { AjaxProxy, Field, Model, Store } from '@jimka/typescript-ui/data';
import { PaginationBar } from '@jimka/typescript-ui/component/display';
import { TablePanel } from '@jimka/typescript-ui/component/table';
const model = new Model({ fields: [
    new Field({ name: 'id',   type: 'number' }),
    new Field({ name: 'name', type: 'string' }),
] });

const store = new Store({
    model,
    proxy: new AjaxProxy({ url: '/api/users' }),
});
store.setPageSize(25);

const panel = TablePanel(store);
panel.setPaginationBar(PaginationBar(store));

void store.load();
```

The bar is a standalone `Component`; it does not require a `TablePanel`.
You can drop it into any container that has its own layout.

## Behaviour

| Action | Result |
| --- | --- |
| `<<` | `store.goToPage(1)` |
| `<`  | `store.prevPage()` |
| `>`  | `store.nextPage()` |
| `>>` | `store.goToPage(totalPages)` |

Buttons disable themselves at the boundaries: `<<` and `<` when on page 1,
`>>` and `>` when on the last known page. If the store has not yet reported
a `total` (e.g. before the first paginated load), `>` stays enabled so the
user can advance into unknown territory; `>>` stays disabled until the
total is known.

### Pending-change guard

When the store has unsynced edits (`store.hasPendingChanges()` is true), all
four nav buttons are disabled — leaving the page would silently discard the
in-flight changes. The buttons re-enable automatically once
[`store.sync()`](/data/store#server-side-pagination) or
[`store.reject()`](/data/store#pending-changes-block-page-navigation) clears
the dirty state.

If you call `nextPage()` / `prevPage()` / `goToPage()` directly while dirty,
the call is a no-op and the store emits `'pagechangeblocked'`.

## Disposal

Call `bar.dispose()` when permanently removing the bar. It detaches its
store listeners and fully tears the bar down:

```typescript
const bar = PaginationBar(store);
panel.setPaginationBar(bar);
// ...later
bar.dispose();
```

`TablePanel.setPaginationBar(newBar)` automatically disposes any previously
attached bar before installing the replacement.

## See also

- [API: PaginationBar](/api/component/display/classes/PaginationBar)
- [Store](/data/store) — `setPageSize`, `nextPage`, `goToPage`, `getTotalPages`
- [Proxy](/data/proxy) — server-side pagination contract
- [TablePanel](/components/TablePanel) — `setPaginationBar(bar)` integration
