# MenuSeparator

[`MenuSeparator`](/api/component/container/classes/MenuSeparator) is a horizontal divider rule used inside a [`Menu`](/components/Menu) to visually group menu items.

You usually don't construct it directly — set `separator: true` on a [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig) entry instead.

## Usage

```typescript
import { MenuBar } from '@jimka/typescript-ui/component/menubar';
const bar = MenuBar([
    { label: 'File', items: [
        { text: 'New' },
        { text: 'Open' },
        { separator: true },         // ← inserts a MenuSeparator
        { text: 'Quit' },
    ]},
]);
```

## Theming

`MenuSeparator` reads its border colour from one of two CSS-variable families chosen via the optional `cssVarPrefix` constructor argument (`'menu-bar'` or `'context-menu'`). `Menu` selects the right family for its mode automatically.

## Notes

- Fixed pixel height: 9 px (see `MenuSeparator.HEIGHT`).
- Width is computed by `Menu.doLayout()`; `MenuSeparator` does not size itself.

## See also

- [API: MenuSeparator](/api/component/container/classes/MenuSeparator)
- [`Menu`](/components/Menu)
