# MenuItem

[`MenuItem`](/api/component/container/classes/MenuItem) is a single row inside a [`Menu`](/components/Menu). Renders a five-zone layout: check | icon | text | shortcut | chevron. The check zone only appears when at least one item in the menu declares `checked`. Hovering opens an attached submenu after a 150 ms delay (persistent-mode menus only).

You usually pass [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig) objects to [`MenuBar`](/components/MenuBar) or `Menu.show(...)` instead of constructing `MenuItem`s directly.

## Config shape

[`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig):

| Field | Purpose |
| --- | --- |
| `text` | Display label. |
| `action` | Called on click or Enter. Ignored when `submenu` is set. |
| `closeOnActivate` | When `false`, the item runs `action` but the menu stays open; pairs with `checked` for a multi-select menu. Defaults to `true`. |
| `enabled` | Defaults to `true`. Disabled items are dimmed and non-interactive. |
| `shortcut` | Hint string displayed on the right. |
| `icon` | Glyph displayed on the left. |
| `checked` | Marks the item as part of a checkable set and whether it's currently checked. When at least one item in the menu sets this (`true` or `false`), every item reserves a leading check column, so icons and titles stay aligned across checked and unchecked rows — see [Checkable items](#checkable-items). |
| `submenu` | Nested [`MenuConfig`](/api/component/container/interfaces/MenuConfig); opens a submenu instead of firing `action` (persistent-mode only). |
| `separator` | When `true`, `Menu` renders a [`MenuSeparator`](/components/MenuSeparator) for the entry and ignores every other field, `row` included. |
| `row` | A zero-argument factory returning a [`MenuRow`](/api/component/container/classes/MenuRow); the menu renders that component instead of a `MenuItem` and ignores every other field. See [Menu's Custom rows section](/components/Menu#custom-rows). |

## Layout

```
[ ✓ ] [ icon ] [ text ······························ ] [ shortcut ] [ ▶ ]
```

The check zone only appears when at least one item in the menu declares `checked`; the chevron only appears for items with a `submenu`.

## Checkable items

Use `checked` for the active choice in a set of mutually-exclusive options (e.g. the current sort direction, or — as [`Table`](/components/Table)'s per-column filter row does — the currently-selected filter operator), rather than hand-prefixing `'✓ '` / `'  '` onto `text`. The title renders with `white-space: nowrap`, which collapses consecutive plain-ASCII spaces to one — a checked row's `'✓ '` prefix and an unchecked row's `'  '` prefix end up different rendered widths, so the label text drifts out of alignment between rows. `checked` avoids this: the checkmark lives in its own reserved column, to the left of any `icon`/`glyph`, so every row's icon and label start at the same x regardless of which item is checked.

```typescript
menuItems: options.map(opt => ({
    text:    opt.label,
    checked: opt.value === current,
    action:  () => select(opt.value),
}))
```

An item that omits `checked` entirely still reserves the column when a sibling item in the same menu declares it — the column is a per-menu decision, not a per-item one.

Pair `checked` with `closeOnActivate: false` to turn a menu into a multi-select control: the user clicks several rows and the panel stays open, since the menu no longer closes on activation. Each activation flips that item's own checkmark automatically, so there's nothing to push back into the config. The panel still closes via an outside click, Escape, or window blur.

```typescript
menuItems: options.map(opt => ({
    text:            opt.label,
    checked:         selected.has(opt.value),
    closeOnActivate: false,
    action:          () => toggle(opt.value),
}))
```

## Theming

`MenuItem` reads its colours from one of two CSS-variable families chosen via the optional `cssVarPrefix` constructor argument (`'menu-bar'` or `'context-menu'`). `Menu` selects the right family for its mode automatically — you only specify it when constructing items by hand.

## Notes

- The `shortcut` text is purely visual; it does not register a keyboard handler. Wire the binding yourself.
- Use `setFocused(true)` to apply the keyboard focus style programmatically; this is what `Menu` does during arrow-key navigation.

## See also

- [API: MenuItem](/api/component/container/classes/MenuItem)
- [API: MenuItemConfig](/api/component/container/interfaces/MenuItemConfig)
- [`Menu`](/components/Menu) — primary consumer
