# ComboBox

[`ComboBox`](/api/component/input/classes/ComboBox) is a drop-down selector backed by a styled `<div>` surface and an [`AnimatedDropdown`](/components/AnimatedDropdown) panel. Populate it from a list of string items, or bind it to a data [`Store`](/data/store) so the options track records as they load and change.

It implements [`Bindable<string>`](/api/core/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

## Static items

Pass plain strings via the `items` option (or `addItem` / `setItems`):

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { ComboBox } from '@jimka/typescript-ui/component/input';

const role = ComboBox({ items: ['Admin', 'User', 'Guest'] });

Event.addListener(role, 'change', () => {
    // Plain string items are keyed by position, so `getValue()` returns the
    // selected row index as a string; read `getSelectedIndex()` for the index.
    // When each option needs its own distinct value, use a store (below).
    console.log('selected index:', role.getSelectedIndex());
});

panel.addComponent(role);
```

## Backed by a store

```typescript
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { ComboBox } from '@jimka/typescript-ui/component/input';
const RoleModel = new Model([
    { name: 'id',   type: 'string' },
    { name: 'name', type: 'string' },
]);

const store = new MemoryStore(RoleModel, [
    { id: 'admin', name: 'Admin' },
    { id: 'user',  name: 'User'  },
]);
await store.load();

const role = ComboBox();
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

## Theming

The combo's thin gray border (and its dropdown panel's matching border) is driven by the `input.border` token — see [Theming › Theme keys](/concepts/theming#theme-keys).

The trigger chevron points down when the dropdown is closed and rotates to point up while it is open, animated in step with the dropdown's own fade (and snapping instantly when the dropdown is non-animated).

## See also

- [API: ComboBox](/api/component/input/classes/ComboBox)
- [`List`](/components/List) — same options, displayed as an open list box
- [`AutoCompleteField`](/components/AutoCompleteField) — typeahead variant
- [Data binding](/data/binding)
