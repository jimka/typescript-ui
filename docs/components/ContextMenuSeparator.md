# ContextMenuSeparator

[`ContextMenuSeparator`](/api/classes/ContextMenuSeparator) is a horizontal divider rule used inside a [`ContextMenu`](/components/ContextMenu) to visually group items.

You usually don't construct it directly — set `separator: true` on a [`ContextMenuItemConfig`](/api/interfaces/ContextMenuItemConfig) entry instead.

## Usage

```typescript
menu.show(x, y, [
    { text: 'Cut',          action: () => cut()   },
    { text: 'Copy',         action: () => copy()  },
    { separator: true       },                        // ← inserts a ContextMenuSeparator
    { text: 'Paste',        action: () => paste() },
]);
```

## See also

- [API: ContextMenuSeparator](/api/classes/ContextMenuSeparator)
- [`ContextMenu`](/components/ContextMenu)
- [`MenuSeparator`](/components/MenuSeparator) — equivalent for `MenuBar` panels
