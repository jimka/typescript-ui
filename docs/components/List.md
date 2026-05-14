# List

[`List`](/api/classes/List) is a single-selection scrollable list box backed by a `<select>` element. It extends [`ComboBox`](/components/ComboBox) but displays all options simultaneously by sizing the select to fit its item count.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { Option } from '@jimka/typescript-ui/component/input';
import { List } from '@jimka/typescript-ui/component/list';
const fruits = new List();
fruits.addItem(new Option('apple',  'Apple'));
fruits.addItem(new Option('banana', 'Banana'));
fruits.addItem(new Option('cherry', 'Cherry'));
fruits.setPreferredSize(180, 120);

Event.addListener(fruits, 'change', () => {
    console.log('selected:', fruits.getValue());
});

panel.addComponent(fruits);
```

## Store-backed lists

Like [`ComboBox`](/components/ComboBox), `List` accepts a [`Store`](/data/store):

```typescript
list.setStore(myStore);
list.setDisplayField('name');
list.setValueField('id');
```

The list refreshes automatically on store events.

## See also

- [API: List](/api/classes/List)
- [`MultiSelectList`](/components/MultiSelectList) — multi-selection variant
- [`ComboBox`](/components/ComboBox) — drop-down version
