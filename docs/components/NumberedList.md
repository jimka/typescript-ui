# NumberedList

[`NumberedList`](/api/classes/NumberedList) is an ordered list rendered as an `<ol>` element. Defaults to the [`DECIMAL`](/api/enumerations/NumberedListItemStyle) numbering style.

## Usage

```typescript
import { NumberedList, ListItem, NumberedListItemStyle } from '@jimka/typescript-ui/component/list';
const list = new NumberedList();
list.setItemStyle(NumberedListItemStyle.UPPER_ROMAN);
list.addItem(new ListItem('intro',  'Introduction'));
list.addItem(new ListItem('body',   'Main argument'));
list.addItem(new ListItem('outro',  'Conclusion'));

panel.addComponent(list);
```

## Numbering styles

[`NumberedListItemStyle`](/api/enumerations/NumberedListItemStyle):

| Value | Example |
| --- | --- |
| `DECIMAL` | 1, 2, 3 |
| `DECIMAL_LEADING_ZERO` | 01, 02, 03 |
| `LOWER_ALPHA` / `UPPER_ALPHA` | a, b, c / A, B, C |
| `LOWER_GREEK` | α, β, γ |
| `LOWER_LATIN` / `UPPER_LATIN` | a, b, c / A, B, C |
| `LOWER_ROMAN` / `UPPER_ROMAN` | i, ii, iii / I, II, III |
| `NONE` | (no numbering) |

## See also

- [API: NumberedList](/api/classes/NumberedList)
- [API: NumberedListItemStyle](/api/enumerations/NumberedListItemStyle)
- [`BulletedList`](/components/BulletedList) — unordered counterpart
- [`ListItem`](/components/ListItem) — child component
