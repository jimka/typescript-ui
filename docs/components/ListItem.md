# ListItem

[`ListItem`](/api/classes/ListItem) is a single list item backed by a `<li>` element. Stores a key/value pair and suppresses framework positioning styles so the browser can render the item natively inside a list.

`ListItem` is used inside [`BulletedList`](/components/BulletedList) and [`NumberedList`](/components/NumberedList).

## Usage

```typescript
import { BulletedList, ListItem } from '@jimka/typescript-ui';

const list = new BulletedList();
list.addItem(new ListItem('apple',  'Apple'));
list.addItem(new ListItem('banana', 'Banana'));
list.addItem(new ListItem('cherry', 'Cherry'));

panel.addComponent(list);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getKey()` / `setKey(key)` | Programmatic key. |
| `getValue()` / `setValue(value)` | Display text. |

## Notes

- `ListItem` is not the same as [`Option`](/components/Option). Use `Option` for items inside a [`ComboBox`](/components/ComboBox) or [`List`](/components/List); use `ListItem` for items inside a `BulletedList` / `NumberedList`.

## See also

- [API: ListItem](/api/classes/ListItem)
- [`BulletedList`](/components/BulletedList), [`NumberedList`](/components/NumberedList) — typical containers
- [`Option`](/components/Option) — for `ComboBox` / `List` items
