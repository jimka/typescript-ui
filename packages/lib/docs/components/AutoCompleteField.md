# AutoCompleteField

[`AutoCompleteField`](/api/component/input/classes/AutoCompleteField) is a text field with type-ahead suggestions. Suggestions can come from a static array or from a data [`Store`](/data/store).

It implements [`Bindable<string>`](/api/core/interfaces/Bindable).

## Static suggestions

```typescript
import { AutoCompleteField } from '@jimka/typescript-ui/component/input';
const fruit = AutoCompleteField({
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
const userPicker = AutoCompleteField({
    store:        userStore,
    displayField: 'name',
    minChars:     2,
    debounceMs:   200,
    matchMode:    'contains',
});
```

## AutoCompleteFieldConfig

See [`AutoCompleteFieldConfig`](/api/component/input/type-aliases/AutoCompleteFieldConfig) for the full option list. Highlights:

| Option | Default | Purpose |
| --- | --- | --- |
| `suggestions` | — | Static suggestion array. |
| `store` | — | Data store; mutually exclusive with `suggestions`. |
| `displayField` | — | Required when `store` is set; field name used for display text. |
| `minChars` | `1` | Minimum characters typed before suggestions show. |
| `debounceMs` | `200` | Debounce on each keystroke. |
| `maxSuggestions` | `10` | Cap on suggestions shown at once. |
| `placeholder` | — | Empty-state placeholder text. |
| `matchMode` | `'contains'` | How the typed query matches — one of `'contains'`, `'startsWith'`, `'containsCaseSensitive'`, `'startsWithCaseSensitive'` ([`AutoCompleteMatchMode`](/api/component/input/type-aliases/AutoCompleteMatchMode)). The default is case-insensitive; the `*CaseSensitive` variants opt in to case-sensitive matching. |

## Listeners

`AutoCompleteField` extends [`AbstractInput<string>`](/api/component/input/classes/AbstractInput), so it inherits the universal change/binding listener API on top of its own suggestion-pick hook:

| Method | Fires on |
| --- | --- |
| `on("change", fn)` | Every value change — keystroke **and** suggestion pick. |
| `on("binding", fn)` | Same as `on("change", fn)`; used by [`Binding`](/data/binding). |
| `on("select", fn)` | Only when a suggestion is picked from the dropdown. |
| `addSelectListener(fn)` | Retained alias of `on("select", fn)`. |

A suggestion-select fires `on("select", fn)` (and its `addSelectListener` alias) and, through the underlying value change, also fires `on("change", fn)`.

## Notes

- The suggestion dropdown fades in / out over 100 ms via [`Animation`](/api/core/namespaces/Animation). A fresh `show()` during a fade-out cancels the deferred detach, so a fast hide-then-reshow (typical when typing rapidly) doesn't snap. Honours `prefers-reduced-motion: reduce`.

## See also

- [API: AutoCompleteField](/api/component/input/classes/AutoCompleteField)
- [API: AutoCompleteFieldConfig](/api/component/input/type-aliases/AutoCompleteFieldConfig)
- [`ComboBox`](/components/ComboBox) — non-typeahead drop-down
- [`TextField`](/components/TextField) — plain text input
