# ListItem

[`ListItem`](/api/component/list/classes/ListItem) is a single list item backed by a `<li>` element. It pairs a marker slot with a label — two [`Text`](/components/Text) children arranged side by side by an [`HBox`](/layouts/HBox) — and stores a key alongside them. Its owning list writes the marker and stacks the item vertically; the item never markers or positions itself.

`ListItem` is used inside [`BulletedList`](/components/BulletedList) and [`NumberedList`](/components/NumberedList).

## Usage

```typescript
import { BulletedList, ListItem } from '@jimka/typescript-ui/component/list';
const list = BulletedList();
list.addComponent(ListItem('apple',  'Apple'));
list.addComponent(ListItem('banana', 'Banana'));
list.addComponent(ListItem('cherry', 'Cherry'));

panel.addComponent(list);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getKey()` | Programmatic key (set once via the constructor). |
| `getText()` / `setText(text)` | Read / write the item's display text. |
| `getMarker()` | The bullet or number currently shown. The owning list writes it — set the list's style rather than calling `setMarker` yourself. |
| `getMarkerWidth()` | The marker's own measured width, before the shared column widens it. The owning list calls this to size the column. |
| `setMarkerColumnWidth(width)` | Widens the marker slot to the list's shared column width. Driven by the owning list on every layout pass. |

## Notes

- `ListItem` is not the same as a [`ComboBox`](/components/ComboBox) / [`List`](/components/List) item. Those accept plain strings or `{ key, label }` pairs through `setItems` / `addItem`; use `ListItem` for items inside a `BulletedList` / `NumberedList`.
- The marker is a real child component, not the browser's `::marker`, so it is measured and positioned like any other content — it cannot be clipped away, and the item's reported width covers the marker, the 4px gap, and the label.
- An item added to, removed from, or reordered within a list makes its list rewrite every marker, so numbering stays contiguous.
- The marker sits in a slot as wide as its list's widest marker, and is right-aligned inside it, so markers share a right edge and labels share a left one down the whole list. The list recomputes that width on every layout pass, so it shrinks again when the widest item goes away.

## See also

- [API: ListItem](/api/component/list/classes/ListItem)
- [`BulletedList`](/components/BulletedList), [`NumberedList`](/components/NumberedList) — typical containers
