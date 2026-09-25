# TextField

[`TextField`](/api/component/input/classes/TextField) is a single-line text input backed by an `<input type="text">` element. It implements [`Bindable<string>`](/api/core/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

<!-- demo: textfield-binding -->
> **Live demo** — two `TextField`s bound to one `ModelRecord` via `Binding`,
> with a `Text` below echoing the record's current values as you type.
> [Open the TextField page](https://jimka.github.io/typescript-ui/components/TextField)
<!-- /demo -->

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { TextField } from '@jimka/typescript-ui/component/input';
const nameField = TextField();
nameField.setValue('');
nameField.setPreferredSize({ width: 240, height: 28 });

Event.addListener(nameField, 'input', () => {
    console.log('value:', nameField.getValue());
});

panel.addComponent(nameField);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(text)` | Read / write the field's text. Inherited from [`AbstractInput<string>`](/api/component/input/classes/AbstractInput). |
| `setText(text)` / `getText()` | Alias retained from the abstract base. |
| `on("change", fn)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); fires on every keystroke with the current text value. |
| `on("binding", fn)` | Subscribe to user-driven changes (used by `Binding`). |
| `setEnabled(boolean)` / `setReadOnly(boolean)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); writes the native `disabled` / `readonly` attributes on the underlying `<input>`. |
| `select()` | Select all current text. |
| `copy()` / `cut()` / `paste()` | Inherited from [`TextInput`](/api/component/input/classes/TextInput). Act on the current selection; `cut()`/`paste()` no-op when the field is disabled or read-only. |

Right-clicking the field opens a Cut/Copy/Paste menu (replacing the browser's own, suppressed elsewhere in the framework); Cut and Paste are omitted while the field is disabled or read-only.

## Binding

```typescript
import { Binding } from '@jimka/typescript-ui/core';
const binding = new Binding().bind('name', nameField);
binding.setRecord(store.getAt(0));
```

## Theming

The thin gray border shared with every other text input is driven by the `input.border` token — see [Theming › Theme keys](/concepts/theming#theme-keys).

## Notes

- A plain `TextField` whose parent re-commits it at the rectangle it already holds is not re-laid-out (see [the write is diffed](/concepts/layout-system#the-write-is-diffed)). `setText`, `setPlaceholder` and the read-only and disabled states are element writes, not layout inputs; the theme's single-line box height and `setBorder` both relay a new preferred size, and adding a child, changing insets, padding or a border marks it owed for the next pass that reaches it. The opt-in is `TextField` exactly: [`PasswordField`](/components/PasswordField), [`UsernameField`](/components/UsernameField) and the three internal field subclasses the [`NumberSpinner`](/components/NumberSpinner), the [`AutoCompleteField`](/components/AutoCompleteField) and the table's number cell editor build on keep being laid out on every commit until each overrides the gate itself. [`TextArea`](/components/TextArea) is a sibling rather than a subclass and is likewise unaffected. One change does not announce itself: a custom child that changes its intrinsic size without calling `setPreferredSize` or `notifyIntrinsicSizeChanged`, which should be followed by `field.scheduleLayout()`.

## See also

- [API: TextField](/api/component/input/classes/TextField)
- [`PasswordField`](/components/PasswordField) — masked variant
- [`TextArea`](/components/TextArea) — multi-line variant
- [Data binding](/data/binding) — how to wire fields to a record
