# Right-click menu

Use a single shared [`Menu`](/components/Menu) instance (constructed in rebuild mode) to handle right-click on any component.

## Goal

Right-clicking a list item opens a menu with Cut / Copy / Paste / Delete. The menu closes automatically when the user picks an item or clicks outside.

## Create a single menu instance

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { Menu } from '@jimka/typescript-ui/overlay';

const menu = Menu();
```

Reuse this single instance — `Menu` in rebuild mode is designed to be shared across an app, with the items array changing per invocation.

## Wire `contextmenu` on the target component

`Event.addListener` defaults to primary (left) button only, but a right-click's `contextmenu` event reports a non-primary button — pass `button: "any"` so the listener still fires:

```typescript
Event.addListener(myList, 'contextmenu', { button: "any", handler: (e: MouseEvent): Event.ListenerResult => {
    const item = findItemAt(e);  // your own hit-test logic

    menu.show(e.clientX, e.clientY, [
        { text: 'Cut',    action: () => cutItem(item)    },
        { text: 'Copy',   action: () => copyItem(item)   },
        { text: 'Paste',  action: () => pasteItem(item), enabled: clipboard.hasData() },
        { separator: true },
        { text: 'Delete', action: () => deleteItem(item) },
    ]);

    return { prevent: true };
} });
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

Event.addListener(myList, 'contextmenu', { button: "any", handler: (e: MouseEvent): Event.ListenerResult => {
    const item = findItemAt(e);
    menu.show(e.clientX, e.clientY, buildMenu(item));

    return { prevent: true };
} });
```

## Notes

- [`Body.init`](/components/Body) already suppresses the browser's native context menu page-wide, so returning `{ prevent: true }` here is what keeps this handler correct for an app that opted back in with `nativeContextMenu: true`.
- `Menu` is appended to `document.documentElement` so it always layers above the rest of the UI.
- The menu closes itself automatically; you don't need to call `hide` after an `action` runs.

## See also

- [Menu](/components/Menu) — full API
- [MenuItem](/components/MenuItem) — item config shape
- [Toast notifications](/recipes/notifications) — pair with this for "Copied!" feedback
