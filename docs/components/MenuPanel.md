# MenuPanel

[`MenuPanel`](/api/classes/MenuPanel) is the dropdown panel that opens beneath a [`MenuBarButton`](/components/MenuBarButton). It holds a vertical list of [`MenuItem`](/components/MenuItem) rows and closes itself when an item is clicked or focus moves outside.

Used internally by [`MenuBar`](/components/MenuBar). You usually don't construct one directly.

## Usage

```typescript
import { MenuPanel } from '@jika/typescript-ui';

const panel = new MenuPanel(
    [
        { text: 'Save',     shortcut: 'Ctrl+S', action: () => save()  },
        { text: 'Save As…', shortcut: 'Ctrl+Shift+S', action: () => saveAs() },
        { separator: true },
        { text: 'Print',    shortcut: 'Ctrl+P', action: () => print() },
    ],
    () => bar.closeMenu()
);

panel.open(buttonElement);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `open(anchorEl)` | Position the panel beneath `anchorEl` and show it. |
| `close()` | Hide the panel and notify the parent's `onClose` callback. |

## See also

- [API: MenuPanel](/api/classes/MenuPanel)
- [`MenuBar`](/components/MenuBar) — primary consumer
- [`MenuItem`](/components/MenuItem) — child rows
