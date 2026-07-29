# NumberedList

[`NumberedList`](/api/component/list/classes/NumberedList) is an ordered list rendered as an `<ol>` element. Defaults to the [`DECIMAL`](/api/component/list/enumerations/NumberedListItemStyle) numbering style. Items are stacked vertically by a [`VBox`](/layouts/VBox), and the list sizes itself to them.

Every item in one list shares a marker column as wide as that list's widest marker, and each marker is right-aligned inside it. So `9.` and `10.` end at the same x and their labels start at the same x, however much the markers differ in width.

## Usage

```typescript
import { NumberedList, ListItem, NumberedListItemStyle } from '@jimka/typescript-ui/component/list';
const list = NumberedList();
list.setStyle(NumberedListItemStyle.DECIMAL);
list.addComponent(ListItem('intro',  'Introduction'));
list.addComponent(ListItem('body',   'Main argument'));
list.addComponent(ListItem('outro',  'Conclusion'));

panel.addComponent(list);
```

## Numbering styles

[`NumberedListItemStyle`](/api/component/list/enumerations/NumberedListItemStyle). Every member renders. The columns show the marker for items 1, 9, 10, 24, 26 and 27:

| Value | 1 | 9 | 10 | 24 | 26 | 27 |
| --- | --- | --- | --- | --- | --- | --- |
| `NONE` | (no marker) | | | | | |
| `DECIMAL` | `1.` | `9.` | `10.` | `24.` | `26.` | `27.` |
| `DECIMAL_LEADING_ZERO` | `01.` | `09.` | `10.` | `24.` | `26.` | `27.` |
| `LOWER_ALPHA` / `LOWER_LATIN` | `a.` | `i.` | `j.` | `x.` | `z.` | `aa.` |
| `UPPER_ALPHA` / `UPPER_LATIN` | `A.` | `I.` | `J.` | `X.` | `Z.` | `AA.` |
| `LOWER_GREEK` | `α.` | `ι.` | `κ.` | `ω.` | `αβ.` | `αγ.` |
| `UPPER_GREEK` | `Α.` | `Ι.` | `Κ.` | `Ω.` | `ΑΒ.` | `ΑΓ.` |
| `LOWER_ROMAN` | `i.` | `ix.` | `x.` | `xxiv.` | `xxvi.` | `xxvii.` |
| `UPPER_ROMAN` | `I.` | `IX.` | `X.` | `XXIV.` | `XXVI.` | `XXVII.` |

Three things that table encodes:

- **`LOWER_ALPHA` and `LOWER_LATIN` are aliases**, as are `UPPER_ALPHA` and `UPPER_LATIN`. CSS defines each pair as one counter style over one symbol set, and this framework follows that. Both members stay on the enum.
- **The alphabetic styles keep counting past their alphabet.** After `z` comes `aa`, then `ab` — not a wrap back to `a`. `LOWER_GREEK` counts over the 24-letter alphabet, using `σ` and no final sigma `ς`, so after `ω` comes `αα`.
- **Roman numbering covers items 1–3999** and renders decimal above that, which is the range CSS gives its predefined roman counter styles.

`UPPER_GREEK` renders uppercase Greek. No browser ever drew it that way: `upper-greek` is not a predefined CSS counter style, so while these members were handed to the browser as `list-style-type` it fell back to decimal.

## See also

- [API: NumberedList](/api/component/list/classes/NumberedList)
- [API: NumberedListItemStyle](/api/component/list/enumerations/NumberedListItemStyle)
- [`BulletedList`](/components/BulletedList) — unordered counterpart
- [`ListItem`](/components/ListItem) — child component
