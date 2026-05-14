# MenuBar

[`MenuBar`](/api/component/menubar/classes/MenuBar) is the top-of-window menu bar — File, Edit, View, etc. Construct it with a config array describing each top-level entry; the bar handles dropdown panels, keyboard navigation, and submenus internally.

## Usage

```typescript
import { Body } from '@jimka/typescript-ui/core';
import { MenuBar } from '@jimka/typescript-ui/component/menubar';
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

The config is `MenuConfig[]` (see [`MenuConfig`](/api/component/container/interfaces/MenuConfig)).

Each entry has:

- `label` — bar button text.
- `items` — array of [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig) entries.

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

- [API: MenuBar](/api/component/menubar/classes/MenuBar)
- [API: MenuConfig](/api/component/container/interfaces/MenuConfig), [MenuItemConfig](/api/component/container/interfaces/MenuItemConfig)
- [`Menu`](/components/Menu) — the dropdown panel (also handles right-click context menus)
