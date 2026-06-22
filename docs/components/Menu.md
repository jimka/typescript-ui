# Menu

[`Menu`](/api/overlay/classes/Menu) is the framework's floating menu panel. It operates in one of two modes determined by the constructor:

- **Rebuild mode** — `Menu()` — a right-click context menu. Items are passed per `show(x, y, items)` call and rebuilt on each invocation. Best for menus whose contents depend on what the user clicked.
- **Persistent mode** — `Menu(items, onClose)` — a [`MenuBar`](/components/MenuBar) dropdown. Items are built once in the constructor and reused across `open()` / `close()` cycles. Used internally by `MenuBar`.

The two API surfaces are disjoint. `show()` / `hide()` / `setMenuWidth()` are valid only in rebuild mode; `open()` / `close()` and the focus / submenu helpers are valid only in persistent mode. Calling a method outside its mode throws.

## Rebuild mode (right-click context menu)

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { Menu } from '@jimka/typescript-ui/overlay';

const menu = Menu();

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

Reuse one `Menu` instance across the app — `show()` disposes the previous items and rebuilds. The menu closes itself on item click, outside click, or when the browser window loses focus (clicking another application or alt-tabbing); you don't need to call `hide()`. Pass an optional fourth `onClose` argument to `show(x, y, items, onClose)` to be notified once when the menu next closes — useful for reverting an open-state affordance such as a rotated dropdown chevron. An optional fifth `excludeEl` argument names an element exempt from the outside-click-to-close check; pass the trigger that opened the menu so a mousedown on it does not self-close the menu before that trigger's own click can toggle it shut.

For a **left-click dropdown trigger** — a [`SplitButton`](/components/SplitButton) chevron, a [`ToolBar`](/components/ToolBar) overflow button — call `toggleFor(openerEl, x, y, items, onClose?)` instead of `show()`. It excludes `openerEl` and remembers it, so pressing the *same* opener again closes the menu (rather than the close-then-reopen flash a bare `show()` would produce), while pressing a *different* opener switches to it. Use plain `show()` for right-click context menus, which should reposition — not close — on a repeat trigger.

```typescript
trigger.on('click', () => menu.toggleFor(trigger.getElement(true), x, y, items));
```

## Persistent mode (MenuBar dropdown)

```typescript
import { Menu } from '@jimka/typescript-ui/overlay';

const panel = Menu(
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

Each entry follows [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig):

| Field | Purpose |
| --- | --- |
| `text` | Display label. |
| `action` | Called on click or Enter (rebuild mode only auto-calls on click; persistent mode wires it through). |
| `enabled` | Defaults to `true`. Disabled items are dimmed and non-interactive. |
| `shortcut` | Hint string displayed on the right (persistent mode renders it). |
| `icon` | Glyph displayed on the left. |
| `submenu` | Nested [`MenuConfig`](/api/component/container/interfaces/MenuConfig) (persistent mode only). |
| `separator` | When `true`, render as a horizontal rule and ignore other fields. |

## Notes

- The menu is appended to `document.documentElement` so it always layers above the rest of the UI.
- A menu taller than the room available at its anchor is clamped to that room and scrolls its items vertically, so every item stays reachable however large the list or however little screen space is left. Rebuild-mode menus grow downward from the cursor; persistent-mode menus grow downward from the anchor, flipping upward when there is more room above. The clamp tracks the viewport size at open time; a menu open during a window resize keeps its original clamp and re-measures on the next open.
- Rebuild-mode coordinates are in viewport space (`clientX` / `clientY`).
- Submenus inside right-click context menus are not in scope — submenu config is honoured only in persistent mode.
- Rebuild mode reads the `--ts-ui-context-menu-*` theme tokens; persistent mode reads `--ts-ui-menu-bar-panel-*` tokens. The visual style of each mode therefore matches its host.
- Opens and closes with a 120 ms opacity fade via [`Animation`](/api/core/classes/Animation). A fresh `show()` / `open()` during a fade-out cancels the deferred detach, so a quick close-then-reopen keeps the panel mounted. Honours `prefers-reduced-motion: reduce`.

## See also

- [API: Menu](/api/overlay/classes/Menu)
- [API: MenuItemConfig](/api/component/container/interfaces/MenuItemConfig), [MenuConfig](/api/component/container/interfaces/MenuConfig)
- [`MenuItem`](/components/MenuItem) and [`MenuSeparator`](/components/MenuSeparator) — the row components used internally.
- [`MenuBar`](/components/MenuBar) — the primary persistent-mode consumer.
- [Recipe: Right-click menu](/recipes/right-click-menu)
