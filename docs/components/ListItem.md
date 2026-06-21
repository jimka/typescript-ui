# ListItem

[`ListItem`](/api/component/list/classes/ListItem) is a single list item backed by a `<li>` element. Stores a key/value pair and suppresses framework positioning styles so the browser can render the item natively inside a list.

`ListItem` is used inside [`BulletedList`](/components/BulletedList) and [`NumberedList`](/components/NumberedList).

## Usage

```typescript
import { BulletedList, ListItem } from '@jimka/typescript-ui/component/list';
const list = BulletedList();
list.addItem(ListItem('apple',  'Apple'));
list.addItem(ListItem('banana', 'Banana'));
list.addItem(ListItem('cherry', 'Cherry'));

panel.addComponent(list);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getKey()` | Programmatic key (set once via the constructor). |

## Notes

- `ListItem` is not the same as a [`ComboBox`](/components/ComboBox) / [`List`](/components/List) item. Those accept plain strings or `{ key, label }` pairs through `setItems` / `addItem`; use `ListItem` for items inside a `BulletedList` / `NumberedList`.

## See also

- [API: ListItem](/api/component/list/classes/ListItem)
- [`BulletedList`](/components/BulletedList), [`NumberedList`](/components/NumberedList) — typical containers
