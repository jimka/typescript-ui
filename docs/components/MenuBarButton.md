# MenuBarButton

[`MenuBarButton`](/api/classes/MenuBarButton) is a flat label-style button that opens a [`MenuPanel`](/components/MenuPanel). Used internally by [`MenuBar`](/components/MenuBar) — you'd reach for it directly only when assembling a custom menu strip.

Has no [`Button`](/components/Button) inheritance to avoid the ridge border and shadow of the standard button style. Active state (open dropdown) is indicated by a persistent background fill.

## Usage

```typescript
import { MenuBarButton, MenuPanel } from '@jika/typescript-ui';

const filePanel = new MenuPanel(
    [{ text: 'Save', shortcut: 'Ctrl+S', action: () => save() }],
    () => button.close()
);

const button = new MenuBarButton(
    'File',
    () => filePanel.open(button.getElement()!),
    () => filePanel.close()
);

bar.addComponent(button);
```

The constructor takes the label plus `onOpen` / `onClose` callbacks that the bar wires up to its dropdown management.

## See also

- [API: MenuBarButton](/api/classes/MenuBarButton)
- [`MenuBar`](/components/MenuBar) — primary consumer
- [`MenuPanel`](/components/MenuPanel) — dropdown panel
