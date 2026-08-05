# BulletedList

[`BulletedList`](/api/component/list/classes/BulletedList) is an unordered list rendered as a `<ul>` element. Defaults to the [`DISC`](/api/component/list/enumerations/BulletedListItemStyle) bullet style. Items are stacked vertically by a [`VBox`](/layouts/VBox), and the list sizes itself to them. All four bullet styles render; `NONE` collapses the marker slot away, so the item costs no marker width and no gap.

Every item shares one marker column, which for a bulleted list is just the width of the single bullet glyph — one style per list means every marker is the same character.

<!-- demo: bulletedlist-styles -->
> **Live demo** — two `BulletedList`s side by side over the same four items,
> in `SQUARE` and `CIRCLE` styles.
> [Open the BulletedList page](https://jimka.github.io/typescript-ui/components/BulletedList)
<!-- /demo -->

## Usage

```typescript
import { BulletedList, ListItem, BulletedListItemStyle } from '@jimka/typescript-ui/component/list';
const list = BulletedList();
list.setStyle(BulletedListItemStyle.SQUARE);
list.addComponent(ListItem('apple',  'Apple'));
list.addComponent(ListItem('banana', 'Banana'));
list.addComponent(ListItem('cherry', 'Cherry'));

panel.addComponent(list);
```

## Bullet styles

[`BulletedListItemStyle`](/api/component/list/enumerations/BulletedListItemStyle):

| Value | Bullet glyph |
| --- | --- |
| `NONE` | (no bullet) |
| `DISC` | • |
| `CIRCLE` | ◦ |
| `SQUARE` | ▪ |

## See also

- [API: BulletedList](/api/component/list/classes/BulletedList)
- [API: BulletedListItemStyle](/api/component/list/enumerations/BulletedListItemStyle)
- [`NumberedList`](/components/NumberedList) — ordered counterpart
- [`ListItem`](/components/ListItem) — child component
