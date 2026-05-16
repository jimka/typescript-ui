# TextField

[`TextField`](/api/component/input/classes/TextField) is a single-line text input backed by an `<input type="text">` element. It implements [`Bindable<string>`](/api/core/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { TextField } from '@jimka/typescript-ui/component/input';
const nameField = TextField();
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
import { Binding } from '@jimka/typescript-ui/core';
const binding = new Binding().bind('name', nameField);
binding.setRecord(store.getAt(0));
```

## See also

- [API: TextField](/api/component/input/classes/TextField)
- [`PasswordField`](/components/PasswordField) — masked variant
- [`TextArea`](/components/TextArea) — multi-line variant
- [Data binding](/data/binding) — how to wire fields to a record
