# MenuBarButton

[`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) is a flat label-style button that opens a [`Menu`](/components/Menu). Used internally by [`MenuBar`](/components/MenuBar) — you'd reach for it directly only when assembling a custom menu strip.

Extends [`Button`](/components/Button) and declares its own flat resting chrome — no border, border radius, shadow, or gradient background. Pressing a menu-bar entry shows no visual change, and hovering shows only the menubar highlight tint. The text/glyph setters (`setText`, `setGlyph`, `clearGlyph`, `getGlyph`) are inherited from `Button` unchanged. Because each `MenuBarButton` auto-sizes to `content + insets`, the inherited horizontal `anchor` setting is moot — content fills the inner rect exactly. The `insets` (10px each side by default, also overridable) instead control the visible gap between adjacent menubar entries. Active state (open dropdown) is indicated by a persistent background fill via `setActive`.

## Usage

```typescript
import { Menu } from '@jimka/typescript-ui/overlay';

import { MenuBarButton } from '@jimka/typescript-ui/component/menubar';
const filePanel = Menu(
    [{ text: 'Save', shortcut: 'Ctrl+S', action: () => save() }],
    () => button.close()
);

const button = MenuBarButton(
    'File',
    () => filePanel.open(button.getElement()!),
    () => filePanel.close()
);

bar.addComponent(button);
```

The constructor takes the label plus `onOpen` / `onClose` callbacks that the bar wires up to its dropdown management.

## See also

- [API: MenuBarButton](/api/component/menubar/classes/MenuBarButton)
- [`MenuBar`](/components/MenuBar) — primary consumer
- [`Menu`](/components/Menu) — dropdown panel
