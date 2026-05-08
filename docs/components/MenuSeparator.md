# MenuSeparator

[`MenuSeparator`](/api/classes/MenuSeparator) is a horizontal divider rule used inside a [`MenuPanel`](/components/MenuPanel) to visually group menu items.

You usually don't construct it directly — set `separator: true` on a [`MenuItemConfig`](/api/interfaces/MenuItemConfig) entry instead.

## Usage

```typescript
import { MenuBar } from '@jimka/typescript-ui';

const bar = new MenuBar([
    { label: 'File', items: [
        { text: 'New' },
        { text: 'Open' },
        { separator: true },         // ← inserts a MenuSeparator
        { text: 'Quit' },
    ]},
]);
```

## Notes

- Fixed pixel height: 9 px (see `MenuSeparator.HEIGHT`).
- Width is computed by `MenuPanel.doLayout()`; `MenuSeparator` does not size itself.

## See also

- [API: MenuSeparator](/api/classes/MenuSeparator)
- [`MenuPanel`](/components/MenuPanel)
- [`ContextMenuSeparator`](/components/ContextMenuSeparator) — equivalent for [`ContextMenu`](/components/ContextMenu)
