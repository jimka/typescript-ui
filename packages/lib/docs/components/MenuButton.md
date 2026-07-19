# MenuButton

[`MenuButton`](/api/component/button/classes/MenuButton) is a [`Button`](/components/Button) whose click toggles a rebuild-mode dropdown [`Menu`](/components/Menu) anchored under it. It owns the rect-read / toggle / per-open-rebuild boilerplate a dropdown-triggering button otherwise repeats, so a plain trigger button needs only its `menuItems`.

## Usage

```typescript
import { MenuButton } from '@jimka/typescript-ui/component/button';

const exportBtn = MenuButton({
    glyph:     'file-export',
    menuItems: [
        { text: 'Export as CSV',  action: () => exportCsv()  },
        { text: 'Export as JSON', action: () => exportJson() },
    ],
});

toolbar.addComponent(exportBtn);
```

Clicking the button opens the dropdown; selecting a row runs that item's `action` and closes the menu. Pressing the button again while the dropdown is open toggles it shut.

## Menu items

`menuItems` accepts a fixed array of [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig) — the same row descriptor [`Menu`](/components/Menu) context menus use — or a **provider function**, re-invoked on every open, for content that changes between opens (e.g. relative timestamps or a live record count):

```typescript
MenuButton({ glyph: 'clock-rotate-left', menuItems: () => buildRecentItems() });
```

Replace the configured items or provider at runtime with `setMenuItems(items)` and read them back with `getMenuItems()`.

A provider that resolves to an **empty array opens nothing** — the click is a no-op beyond the button's own `"action"` event still firing, so a button with nothing to offer is simply inert. If the emptiness itself is worth explaining, return a single disabled placeholder row instead (`{ text: 'Nothing to show', enabled: false }`), as [`NotificationHistoryButton`](/components/NotificationHistoryButton) does for an empty history.

## Placement

The menu opens under the button's bottom-left corner and **flips above it** when the room below is short — so a `MenuButton` placed near the bottom of the viewport (e.g. in a bottom [`StatusBar`](/components/StatusBar)) never opens its dropdown underneath the pointer or off-screen.

## See also

- [API: MenuButton](/api/component/button/classes/MenuButton)
- [`Button`](/components/Button) — base class
- [`Menu`](/components/Menu) — the dropdown panel and its item descriptors
- [`SplitButton`](/components/SplitButton) — a button with a *separate* primary action and a trailing dropdown chevron
- [`NotificationHistoryButton`](/components/NotificationHistoryButton) — a ready-made `MenuButton` subclass
