# TextArea

[`TextArea`](/api/component/input/classes/TextArea) is a multi-line text input backed by a `<textarea>` element. Internal text state stays in sync with the DOM on every input event.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { TextArea } from '@jimka/typescript-ui/component/input';
const notes = new TextArea('Initial text');
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
| `setRows(n)` / `setColumns(n)` | DOM-level row / column hints. |

## See also

- [API: TextArea](/api/component/input/classes/TextArea)
- [`TextField`](/components/TextField) — single-line variant
