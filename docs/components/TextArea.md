# TextArea

[`TextArea`](/api/component/input/classes/TextArea) is a multi-line text input backed by a `<textarea>` element. Internal text state stays in sync with the DOM on every input event.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { TextArea } from '@jimka/typescript-ui/component/input';
const notes = TextArea('Initial text');
notes.setPreferredSize(360, 120);

Event.addListener(notes, 'input', () => {
    console.log('text:', notes.getText());
});

panel.addComponent(notes);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getText()` / `setText(text)` | Read / write the text content. |
| `getValue()` / `setValue(text)` | Aliases inherited from [`AbstractInput<string>`](/api/component/input/classes/AbstractInput); satisfy the [`Bindable<string>`](/api/core/interfaces/Bindable) contract. |
| `on("change", fn)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); fires on every keystroke with the current text value. |
| `setEnabled(boolean)` / `setReadOnly(boolean)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); writes the native `disabled` / `readonly` attributes on the underlying `<textarea>`. |
| `setRows(n)` / `setColumns(n)` | DOM-level row / column hints. |

## See also

- [API: TextArea](/api/component/input/classes/TextArea)
- [`TextField`](/components/TextField) — single-line variant
