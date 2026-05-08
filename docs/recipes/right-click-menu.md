# Right-click menu

Use a single shared [`ContextMenu`](/components/ContextMenu) instance to handle right-click on any component.

## Goal

Right-clicking a list item opens a menu with Cut / Copy / Paste / Delete. The menu closes automatically when the user picks an item or clicks outside.

## Create a single menu instance

```typescript
import { ContextMenu, Event } from '@jimka/typescript-ui';

const menu = new ContextMenu();
```

Reuse this single instance — `ContextMenu` is designed to be shared across an app, with the items array changing per invocation.

## Wire `contextmenu` on the target component

```typescript
Event.addListener(myList, 'contextmenu', (e: MouseEvent) => {
    e.preventDefault();

    const item = findItemAt(e);  // your own hit-test logic

    menu.show(e.clientX, e.clientY, [
        { text: 'Cut',    action: () => cutItem(item)    },
        { text: 'Copy',   action: () => copyItem(item)   },
        { text: 'Paste',  action: () => pasteItem(item), enabled: clipboard.hasData() },
        { separator: true },
        { text: 'Delete', action: () => deleteItem(item) },
    ]);
});
```

The menu coordinates use `clientX` / `clientY` (viewport-relative).

## Conditional items

Build the items array based on app state. Items can be omitted or have `enabled: false`:

```typescript
function buildMenu(item: Item) {
    const items = [
        { text: 'Open',   action: () => openItem(item)   },
        { text: 'Rename', action: () => renameItem(item) },
    ];
    if (item.canDelete) {
        items.push({ separator: true });
        items.push({ text: 'Delete', action: () => deleteItem(item) });
    }
    return items;
}

Event.addListener(myList, 'contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    const item = findItemAt(e);
    menu.show(e.clientX, e.clientY, buildMenu(item));
});
```

## Notes

- `e.preventDefault()` is required to suppress the browser's native context menu.
- `ContextMenu` is appended to `document.documentElement` so it always layers above the rest of the UI.
- The menu closes itself automatically; you don't need to call `hide` after an `action` runs.

## See also

- [ContextMenu](/components/ContextMenu) — full API
- [ContextMenuItem](/components/ContextMenuItem) — item config shape
- [Toast notifications](/recipes/notifications) — pair with this for "Copied!" feedback
