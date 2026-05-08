# Option

[`Option`](/api/classes/Option) is an item backed by an `<option>` element for use inside a [`ComboBox`](/components/ComboBox) or [`List`](/components/List). It suppresses framework positioning styles so the browser renders the option natively.

## Usage

```typescript
import { ComboBox, Option } from '@jimka/typescript-ui';

const role = new ComboBox();
role.addItem(new Option('admin', 'Admin'));
role.addItem(new Option('user',  'User'));
role.addItem(new Option('guest', 'Guest'));
```

The constructor takes `(key, value)`:

- **key** — programmatic identifier; what `comboBox.getValue()` returns.
- **value** — display text shown in the dropdown.

## Common methods

| Method | Purpose |
| --- | --- |
| `getKey()` / `setKey(key)` | Programmatic value. |
| `getValue()` / `setValue(value)` | Display text. |

## Notes

- `Option` is not the same as [`ListItem`](/components/ListItem). Use `Option` for `ComboBox` / `List` items; use `ListItem` for `BulletedList` / `NumberedList` items.
- For store-backed combo boxes, you don't construct `Option` instances yourself — call [`comboBox.setStore`](/components/ComboBox#backed-by-a-store) instead.

## See also

- [API: Option](/api/classes/Option)
- [`ComboBox`](/components/ComboBox), [`List`](/components/List) — typical consumers
- [`ListItem`](/components/ListItem) — for `BulletedList` / `NumberedList`
