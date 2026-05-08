# MultiSelectList

[`MultiSelectList`](/api/classes/MultiSelectList) is a multi-selection list box backed by `<select multiple>`. Extends [`List`](/components/List) with `getValues()` / `setValues()` for reading and writing the multi-selection state.

## Usage

```typescript
import { MultiSelectList, Option, Event } from '@jimka/typescript-ui';

const tags = new MultiSelectList();
tags.addItem(new Option('urgent',     'Urgent'));
tags.addItem(new Option('blocked',    'Blocked'));
tags.addItem(new Option('reviewed',   'Reviewed'));
tags.addItem(new Option('inProgress', 'In progress'));
tags.setPreferredSize(180, 120);

Event.addListener(tags, 'change', () => {
    console.log('selected:', tags.getValues());
});

panel.addComponent(tags);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValues()` | Returns the selected option values as a string array. |
| `setValues(values[])` | Programmatically select the given option values. |

## Binding

Because `MultiSelectList` does not implement [`Bindable`](/api/interfaces/Bindable) directly (its value type is `string[]` rather than a single string), wire it via [explicit accessors](/data/binding#explicit-accessors):

```typescript
new Binding().bind('tags', tagsList, {
    get:    () => tagsList.getValues(),
    set:    (values) => tagsList.setValues(values ?? []),
    listen: (fn) => tagsList.addBindingListener(fn),
});
```

## See also

- [API: MultiSelectList](/api/classes/MultiSelectList)
- [`List`](/components/List) — single-selection variant
- [Data binding › Explicit accessors](/data/binding#explicit-accessors)
