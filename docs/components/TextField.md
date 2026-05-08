# TextField

[`TextField`](/api/classes/TextField) is a single-line text input backed by an `<input type="text">` element. It implements [`Bindable<string>`](/api/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

## Usage

```typescript
import { TextField, Event } from '@jika/typescript-ui';

const nameField = new TextField();
nameField.setValue('');
nameField.setPreferredSize(240, 28);

Event.addListener(nameField, 'input', () => {
    console.log('value:', nameField.getValue());
});

panel.addComponent(nameField);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(text)` | Read / write the field's text. |
| `setText(text)` / `getText()` | Alias retained from the abstract base. |
| `addBindingListener(fn)` | Subscribe to user-driven changes (used by `Binding`). |
| `select()` | Select all current text. |

## Binding

```typescript
import { Binding } from '@jika/typescript-ui';

const binding = new Binding().bind('name', nameField);
binding.setRecord(store.getAt(0));
```

## See also

- [API: TextField](/api/classes/TextField)
- [`PasswordField`](/components/PasswordField) — masked variant
- [`TextArea`](/components/TextArea) — multi-line variant
- [Data binding](/data/binding) — how to wire fields to a record
