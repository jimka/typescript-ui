# ComboBox

[`ComboBox`](/api/classes/ComboBox) is a drop-down selector backed by a `<select>` element. Populate it from an explicit list of [`Option`](/api/classes/Option) items, or bind it to a data [`Store`](/data/store) so the options track records as they load and change.

It implements [`Bindable<string>`](/api/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

## Static items

```typescript
import { ComboBox, Option, Event } from '@jimka/typescript-ui';

const role = new ComboBox();
role.addItem(new Option('admin', 'Admin'));
role.addItem(new Option('user',  'User'));
role.addItem(new Option('guest', 'Guest'));

Event.addListener(role, 'change', () => {
    console.log('selected:', role.getValue());
});

panel.addComponent(role);
```

## Backed by a store

```typescript
import { ComboBox, MemoryStore, Model } from '@jimka/typescript-ui';

const RoleModel = new Model([
    { name: 'id',   type: 'string' },
    { name: 'name', type: 'string' },
]);

const store = new MemoryStore(RoleModel, [
    { id: 'admin', name: 'Admin' },
    { id: 'user',  name: 'User'  },
]);
await store.load();

const role = new ComboBox();
role.setStore(store);
role.setValueField('id');
role.setDisplayField('name');
```

The combo refreshes automatically on store `datachanged` events.

## Common methods

| Method | Purpose |
| --- | --- |
| `addItem(option)` | Append a static `Option`. |
| `setItems(options[])` | Replace the option list. |
| `getValue()` / `setValue(value)` | Read / write the selected option's value. |
| `getSelectedIndex()` / `setSelectedIndex(i)` | Index-based selection. |
| `setStore(store)` / `setDisplayField(name)` / `setValueField(name)` | Bind to a data store. |
| `getSelectedRecord()` | When backed by a store, returns the currently selected `ModelRecord`. |

## See also

- [API: ComboBox](/api/classes/ComboBox)
- [`List`](/components/List) — same options, displayed as an open list box
- [`AutoCompleteField`](/components/AutoCompleteField) — typeahead variant
- [Data binding](/data/binding)
