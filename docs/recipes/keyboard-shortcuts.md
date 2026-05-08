# Keyboard shortcuts in MenuBar

[`MenuBar`](/components/MenuBar) displays a `shortcut` hint next to each menu item, but the framework does **not** automatically wire that hint to a key handler. You provide the handler yourself.

## Goal

Wire `Ctrl+N`, `Ctrl+O`, `Ctrl+S` to menu actions, with the hints visible in the menu and a single keyboard handler at the document level.

## Centralise the action map

Pulling the actions into a small map lets you reference them from both the menu config and the key handler:

```typescript
const actions = {
    new:  () => newDoc(),
    open: () => openDoc(),
    save: () => save(),
};
```

## Build the menu

```typescript
import { Body, MenuBar } from '@jimka/typescript-ui';

const bar = new MenuBar([
    { label: 'File', items: [
        { text: 'New',  shortcut: 'Ctrl+N', action: actions.new  },
        { text: 'Open', shortcut: 'Ctrl+O', action: actions.open },
        { separator: true },
        { text: 'Save', shortcut: 'Ctrl+S', action: actions.save },
    ]},
]);

Body.getInstance().addComponent(bar);
```

## Wire the keyboard handler

Use a single `keydown` listener at the document level. Match the modifier set explicitly so combinations like `Ctrl+Shift+N` don't accidentally trigger `Ctrl+N`:

```typescript
function onlyCtrl(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!onlyCtrl(e)) return;

    switch (e.key.toLowerCase()) {
        case 'n': e.preventDefault(); actions.new();  break;
        case 'o': e.preventDefault(); actions.open(); break;
        case 's': e.preventDefault(); actions.save(); break;
    }
});
```

`metaKey` covers macOS `⌘`. The `e.preventDefault()` call stops the browser's default behaviour (e.g. `Ctrl+S` opening the page-save dialog).

## Larger apps

For more than a handful of shortcuts, consider:

- A registry that the menu config and the key handler both read from — keeps shortcut text and key handler in lockstep.
- Scope-aware bindings — e.g. only fire `Ctrl+S` when a particular panel has focus.

The framework intentionally stays out of this; the `shortcut` field is just a label.

## See also

- [MenuBar](/components/MenuBar)
- [API: MenuItemConfig](/api/interfaces/MenuItemConfig)
