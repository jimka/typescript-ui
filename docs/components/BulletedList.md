# BulletedList

[`BulletedList`](/api/component/list/classes/BulletedList) is an unordered list rendered as a `<ul>` element. Defaults to the [`DISC`](/api/component/list/enumerations/BulletedListItemStyle) bullet style.

## Usage

```typescript
import { BulletedList, ListItem, BulletedListItemStyle } from '@jimka/typescript-ui/component/list';
const list = new BulletedList();
list.setItemStyle(BulletedListItemStyle.SQUARE);
list.addItem(new ListItem('apple',  'Apple'));
list.addItem(new ListItem('banana', 'Banana'));
list.addItem(new ListItem('cherry', 'Cherry'));

panel.addComponent(list);
```

## Bullet styles

[`BulletedListItemStyle`](/api/component/list/enumerations/BulletedListItemStyle):

| Value | Bullet glyph |
| --- | --- |
| `NONE` | (no bullet) |
| `DISC` | • |
| `CIRCLE` | ○ |
| `SQUARE` | ▪ |

## See also

- [API: BulletedList](/api/component/list/classes/BulletedList)
- [API: BulletedListItemStyle](/api/component/list/enumerations/BulletedListItemStyle)
- [`NumberedList`](/components/NumberedList) — ordered counterpart
- [`ListItem`](/components/ListItem) — child component
