# MenuItem

[`MenuItem`](/api/classes/MenuItem) is a single row inside a [`MenuPanel`](/components/MenuPanel). Renders a four-zone layout: icon | text | shortcut | chevron. Hovering opens an attached submenu after a 150 ms delay.

You usually pass [`MenuItemConfig`](/api/interfaces/MenuItemConfig) objects to [`MenuBar`](/components/MenuBar) instead of constructing `MenuItem`s directly.

## Config shape

[`MenuItemConfig`](/api/interfaces/MenuItemConfig):

| Field | Purpose |
| --- | --- |
| `text` | Display label. |
| `action` | Called on click or Enter. Ignored when `submenu` is set. |
| `enabled` | Defaults to `true`. Disabled items are dimmed and non-interactive. |
| `shortcut` | Hint string displayed on the right. |
| `icon` | Glyph displayed on the left. |
| `submenu` | Nested [`MenuConfig`](/api/interfaces/MenuConfig); opens a submenu instead of firing `action`. |
| `separator` | When `true`, render as a horizontal rule and ignore other fields. |

## Layout

```
[ icon ] [ text ······························ ] [ shortcut ] [ ▶ ]
```

The chevron only appears for items with a `submenu`.

## Notes

- The `shortcut` text is purely visual; it does not register a keyboard handler. Wire the binding yourself.
- Use `setFocused(true)` to apply the keyboard focus style programmatically; this is what `MenuPanel` does during arrow-key navigation.

## See also

- [API: MenuItem](/api/classes/MenuItem)
- [API: MenuItemConfig](/api/interfaces/MenuItemConfig)
- [`MenuPanel`](/components/MenuPanel) — primary consumer
