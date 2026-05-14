# AutoCompleteField

[`AutoCompleteField`](/api/classes/AutoCompleteField) is a text field with type-ahead suggestions. Suggestions can come from a static array or from a data [`Store`](/data/store).

It implements [`Bindable<string>`](/api/interfaces/Bindable).

## Static suggestions

```typescript
import { AutoCompleteField } from '@jimka/typescript-ui/component/input';
const fruit = new AutoCompleteField({
    suggestions: ['Apple', 'Banana', 'Blueberry', 'Cherry', 'Date'],
    placeholder: 'Type a fruit…',
});

fruit.addSelectListener(value => {
    console.log('selected:', value);
});

panel.addComponent(fruit);
```

## Store-backed suggestions

```typescript
import { AutoCompleteField } from '@jimka/typescript-ui/component/input';
const userPicker = new AutoCompleteField({
    store:        userStore,
    displayField: 'name',
    minChars:     2,
    debounceMs:   200,
    matchMode:    'contains',
});
```

## AutoCompleteFieldConfig

See [`AutoCompleteFieldConfig`](/api/interfaces/AutoCompleteFieldConfig) for the full option list. Highlights:

| Option | Default | Purpose |
| --- | --- | --- |
| `suggestions` | — | Static suggestion array. |
| `store` | — | Data store; mutually exclusive with `suggestions`. |
| `displayField` | — | Required when `store` is set; field name used for display text. |
| `minChars` | `1` | Minimum characters typed before suggestions show. |
| `debounceMs` | `200` | Debounce on each keystroke. |
| `maxSuggestions` | `10` | Cap on suggestions shown at once. |
| `placeholder` | — | Empty-state placeholder text. |
| `matchMode` | `'contains'` | How the typed query matches — `'contains'` or `'startsWith'` ([`AutoCompleteMatchMode`](/api/type-aliases/AutoCompleteMatchMode)). |

## See also

- [API: AutoCompleteField](/api/classes/AutoCompleteField)
- [API: AutoCompleteFieldConfig](/api/interfaces/AutoCompleteFieldConfig)
- [`ComboBox`](/components/ComboBox) — non-typeahead drop-down
- [`TextField`](/components/TextField) — plain text input
