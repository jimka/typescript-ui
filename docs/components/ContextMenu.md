# ContextMenu

[`ContextMenu`](/api/classes/ContextMenu) is a floating right-click menu appended to `document.documentElement`. Call `show(x, y, items)` to display it at viewport coordinates. The menu closes automatically when an item is clicked or when the user clicks outside.

The same `ContextMenu` instance can be reused across multiple invocations.

## Usage

```typescript
import { ContextMenu, Event } from '@jimka/typescript-ui';

const menu = new ContextMenu();

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

## Items

Each entry in the `items` array follows [`ContextMenuItemConfig`](/api/interfaces/ContextMenuItemConfig):

| Field | Purpose |
| --- | --- |
| `text` | Display text in the menu row. |
| `action` | Called when the user clicks an enabled item. |
| `enabled` | Defaults to `true`. Disabled items are dimmed and non-clickable. |
| `separator` | When `true`, render as a horizontal rule and ignore other fields. |

## Notes

- The menu is positioned in viewport coordinates (`clientX`, `clientY`), so pass mouse-event values directly.
- The menu is shared infrastructure — only one `ContextMenu` is open at a time. Reusing a single instance per app is the typical pattern.

## See also

- [API: ContextMenu](/api/classes/ContextMenu)
- [API: ContextMenuItemConfig](/api/interfaces/ContextMenuItemConfig)
- [`ContextMenuItem`](/api/classes/ContextMenuItem) and [`ContextMenuSeparator`](/api/classes/ContextMenuSeparator) — the row components used internally.
