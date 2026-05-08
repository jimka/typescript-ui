# MenuBar

[`MenuBar`](/api/classes/MenuBar) is the top-of-window menu bar — File, Edit, View, etc. Construct it with a config array describing each top-level entry; the bar handles dropdown panels, keyboard navigation, and submenus internally.

## Usage

```typescript
import { Body, MenuBar } from '@jika/typescript-ui';

const bar = new MenuBar([
    { label: 'File', items: [
        { text: 'New',       shortcut: 'Ctrl+N', action: () => newFile() },
        { text: 'Open…',     shortcut: 'Ctrl+O', action: () => openFile() },
        { separator: true },
        { text: 'Quit', enabled: false },
    ]},
    { label: 'Edit', items: [
        { text: 'Undo', shortcut: 'Ctrl+Z', action: () => undo() },
        { text: 'Redo', shortcut: 'Ctrl+Y', action: () => redo() },
    ]},
]);

Body.getInstance().addComponent(bar);
```

## Config shape

The config is `MenuConfig[]` (see [`MenuConfig`](/api/interfaces/MenuConfig)).

Each entry has:

- `label` — bar button text.
- `items` — array of [`MenuItemConfig`](/api/interfaces/MenuItemConfig) entries.

Each `MenuItemConfig` supports:

| Field | Purpose |
| --- | --- |
| `text` | Display label. |
| `action` | Called when the item is activated (click or Enter). |
| `enabled` | Defaults to `true`. Disabled items are dimmed. |
| `shortcut` | Hint string displayed on the right (e.g. `"Ctrl+S"`). |
| `icon` | Glyph displayed on the left. |
| `submenu` | Nested `MenuConfig`; opens a child panel instead of calling `action`. |
| `separator` | When `true`, render a horizontal rule and ignore other fields. |

## Notes

- The `shortcut` field is purely a visual hint — wire the actual keyboard binding yourself, e.g. via `Event.addListener(window, 'keydown', …)`.
- Nested `submenu` panels open after a 150 ms hover delay — see [`MenuItem`](/components/MenuItem).

## See also

- [API: MenuBar](/api/classes/MenuBar)
- [API: MenuConfig](/api/interfaces/MenuConfig), [MenuItemConfig](/api/interfaces/MenuItemConfig)
- [`MenuPanel`](/components/MenuPanel) — the dropdown panel
- [`ContextMenu`](/components/ContextMenu) — right-click menu (separate component)
