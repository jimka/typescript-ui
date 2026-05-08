# BulletedList

[`BulletedList`](/api/classes/BulletedList) is an unordered list rendered as a `<ul>` element. Defaults to the [`DISC`](/api/enumerations/BulletedListItemStyle) bullet style.

## Usage

```typescript
import { BulletedList, ListItem, BulletedListItemStyle } from '@jimka/typescript-ui';

const list = new BulletedList();
list.setItemStyle(BulletedListItemStyle.SQUARE);
list.addItem(new ListItem('apple',  'Apple'));
list.addItem(new ListItem('banana', 'Banana'));
list.addItem(new ListItem('cherry', 'Cherry'));

panel.addComponent(list);
```

## Bullet styles

[`BulletedListItemStyle`](/api/enumerations/BulletedListItemStyle):

| Value | Bullet glyph |
| --- | --- |
| `NONE` | (no bullet) |
| `DISC` | • |
| `CIRCLE` | ○ |
| `SQUARE` | ▪ |

## See also

- [API: BulletedList](/api/classes/BulletedList)
- [API: BulletedListItemStyle](/api/enumerations/BulletedListItemStyle)
- [`NumberedList`](/components/NumberedList) — ordered counterpart
- [`ListItem`](/components/ListItem) — child component
