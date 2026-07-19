# MenuItem

[`MenuItem`](/api/component/container/classes/MenuItem) is a single row inside a [`Menu`](/components/Menu). Renders a four-zone layout: icon | text | shortcut | chevron. Hovering opens an attached submenu after a 150 ms delay (persistent-mode menus only).

You usually pass [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig) objects to [`MenuBar`](/components/MenuBar) or `Menu.show(...)` instead of constructing `MenuItem`s directly.

## Config shape

[`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig):

| Field | Purpose |
| --- | --- |
| `text` | Display label. |
| `action` | Called on click or Enter. Ignored when `submenu` is set. |
| `enabled` | Defaults to `true`. Disabled items are dimmed and non-interactive. |
| `shortcut` | Hint string displayed on the right. |
| `icon` | Glyph displayed on the left. |
| `submenu` | Nested [`MenuConfig`](/api/component/container/interfaces/MenuConfig); opens a submenu instead of firing `action` (persistent-mode only). |
| `separator` | When `true`, render as a horizontal rule and ignore other fields. |

## Layout

```
[ icon ] [ text ······························ ] [ shortcut ] [ ▶ ]
```

The chevron only appears for items with a `submenu`.

## Theming

`MenuItem` reads its colours from one of two CSS-variable families chosen via the optional `cssVarPrefix` constructor argument (`'menu-bar'` or `'context-menu'`). `Menu` selects the right family for its mode automatically — you only specify it when constructing items by hand.

## Notes

- The `shortcut` text is purely visual; it does not register a keyboard handler. Wire the binding yourself.
- Use `setFocused(true)` to apply the keyboard focus style programmatically; this is what `Menu` does during arrow-key navigation.

## See also

- [API: MenuItem](/api/component/container/classes/MenuItem)
- [API: MenuItemConfig](/api/component/container/interfaces/MenuItemConfig)
- [`Menu`](/components/Menu) — primary consumer
