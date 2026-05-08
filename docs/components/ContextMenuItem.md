# ContextMenuItem

[`ContextMenuItem`](/api/classes/ContextMenuItem) is a single row inside a [`ContextMenu`](/components/ContextMenu). Displays a text label, highlights on hover, and calls the configured action followed by hiding the parent menu when clicked.

You usually don't construct `ContextMenuItem` directly — pass [`ContextMenuItemConfig`](/api/interfaces/ContextMenuItemConfig) objects to `ContextMenu.show(x, y, items)`.

## Config shape

[`ContextMenuItemConfig`](/api/interfaces/ContextMenuItemConfig):

| Field | Purpose |
| --- | --- |
| `text` | Display label. |
| `action` | Called when the user clicks an enabled item. |
| `enabled` | Defaults to `true`. Disabled items are dimmed and non-clickable. |
| `separator` | When `true`, render as a horizontal rule and ignore other fields. |

## See also

- [API: ContextMenuItem](/api/classes/ContextMenuItem)
- [API: ContextMenuItemConfig](/api/interfaces/ContextMenuItemConfig)
- [`ContextMenu`](/components/ContextMenu) — the parent menu component
- [`MenuItem`](/components/MenuItem) — equivalent for `MenuPanel`
