# Menu

[`Menu`](/api/classes/Menu) is the framework's floating menu panel. It operates in one of two modes determined by the constructor:

- **Rebuild mode** — `new Menu()` — a right-click context menu. Items are passed per `show(x, y, items)` call and rebuilt on each invocation. Best for menus whose contents depend on what the user clicked.
- **Persistent mode** — `new Menu(items, onClose)` — a [`MenuBar`](/components/MenuBar) dropdown. Items are built once in the constructor and reused across `open()` / `close()` cycles. Used internally by `MenuBar`.

The two API surfaces are disjoint. `show()` / `hide()` / `setMenuWidth()` are valid only in rebuild mode; `open()` / `close()` and the focus / submenu helpers are valid only in persistent mode. Calling a method outside its mode throws.

## Rebuild mode (right-click context menu)

```typescript
import { Menu, Event } from '@jimka/typescript-ui/core';
const menu = new Menu();

Event.addListener(myComponent, 'contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    menu.show(e.clientX, e.clientY, [
        { text: 'Cut',          action: () => cut()   },
        { text: 'Copy',         action: () => copy()  },
        { separator: true       },
        { text: 'Paste',        action: () => paste(), enabled: clipboardHasData() },
    ]);
});
```

Reuse one `Menu` instance across the app — `show()` disposes the previous items and rebuilds. The menu closes itself on item click or outside click; you don't need to call `hide()`.

## Persistent mode (MenuBar dropdown)

```typescript
import { Menu } from '@jimka/typescript-ui/core';
const panel = new Menu(
    [
        { text: 'Save',     shortcut: 'Ctrl+S', action: () => save()   },
        { text: 'Save As…', shortcut: 'Ctrl+Shift+S', action: () => saveAs() },
        { separator: true },
        { text: 'Print',    shortcut: 'Ctrl+P', action: () => print()  },
    ],
    () => bar.closeMenu()
);

panel.open(buttonElement);
```

You usually don't construct a persistent-mode `Menu` directly — `MenuBar` does that for each top-level entry.

## Item config

Each entry follows [`MenuItemConfig`](/api/interfaces/MenuItemConfig):

| Field | Purpose |
| --- | --- |
| `text` | Display label. |
| `action` | Called on click or Enter (rebuild mode only auto-calls on click; persistent mode wires it through). |
| `enabled` | Defaults to `true`. Disabled items are dimmed and non-interactive. |
| `shortcut` | Hint string displayed on the right (persistent mode renders it). |
| `icon` | Glyph displayed on the left. |
| `submenu` | Nested [`MenuConfig`](/api/interfaces/MenuConfig) (persistent mode only). |
| `separator` | When `true`, render as a horizontal rule and ignore other fields. |

## Notes

- The menu is appended to `document.documentElement` so it always layers above the rest of the UI.
- Rebuild-mode coordinates are in viewport space (`clientX` / `clientY`).
- Submenus inside right-click context menus are not in scope — submenu config is honoured only in persistent mode.
- Rebuild mode reads the `--ts-ui-context-menu-*` theme tokens; persistent mode reads `--ts-ui-menu-bar-panel-*` tokens. The visual style of each mode therefore matches its host.

## See also

- [API: Menu](/api/classes/Menu)
- [API: MenuItemConfig](/api/interfaces/MenuItemConfig), [MenuConfig](/api/interfaces/MenuConfig)
- [`MenuItem`](/components/MenuItem) and [`MenuSeparator`](/components/MenuSeparator) — the row components used internally.
- [`MenuBar`](/components/MenuBar) — the primary persistent-mode consumer.
- [Recipe: Right-click menu](/recipes/right-click-menu)
