# Menu

[`Menu`](/api/overlay/classes/Menu) is the framework's floating menu panel. It operates in one of two modes determined by the constructor:

- **Rebuild mode** — `Menu()` — a right-click context menu. Items are passed per `show(x, y, items)` call and rebuilt on each invocation. Best for menus whose contents depend on what the user clicked.
- **Persistent mode** — `Menu(items, onClose)` — a [`MenuBar`](/components/MenuBar) dropdown. Items are built once in the constructor and reused across `open()` / `close()` cycles. Used internally by `MenuBar`.

The two API surfaces are disjoint. `show()` / `hide()` / `setMenuWidth()` are valid only in rebuild mode; `open()` / `close()` and the focus / submenu helpers are valid only in persistent mode. Calling a method outside its mode throws.

## Rebuild mode (right-click context menu)

```typescript
import { DOM, Event } from '@jimka/typescript-ui/core';
import { Menu } from '@jimka/typescript-ui/overlay';

const menu = Menu();

Event.addListener(myComponent, 'contextmenu', (e: MouseEvent): Event.ListenerResult => {
    menu.show(e.clientX, e.clientY, [
        { text: 'Cut',          action: () => cut()   },
        { text: 'Copy',         action: () => copy()  },
        { separator: true       },
        { text: 'Paste',        action: () => paste(), enabled: clipboardHasData() },
    ]);

    return { prevent: true };
});
```

Reuse one `Menu` instance across the app — `show()` disposes the previous items and rebuilds. The menu closes itself on item click, outside click, or when the browser window loses focus (clicking another application or alt-tabbing); you don't need to call `hide()` — except for an item with `closeOnActivate: false`, which runs its `action` and leaves the menu open. Pass an optional fourth `onClose` argument to `show(x, y, items, onClose)` to be notified once when the menu next closes — useful for reverting an open-state affordance such as a rotated dropdown chevron. An optional fifth `excludeEl` argument names an element exempt from the outside-click-to-close check; pass the trigger that opened the menu so a mousedown on it does not self-close the menu before that trigger's own click can toggle it shut.

For a **left-click dropdown trigger** — a [`SplitButton`](/components/SplitButton) chevron, a [`ToolBar`](/components/ToolBar) overflow button — call `toggleFor(openerEl, anchorRect, items, onClose?)` instead of `show()`. It excludes `openerEl` and remembers it, so pressing the *same* opener again closes the menu (rather than the close-then-reopen flash a bare `show()` would produce), while pressing a *different* opener switches to it. The anchored form opens below `anchorRect` and **flips above it** when the room below is short, right-aligning to it when the left-aligned width would overflow. An empty `items` list opens nothing (still firing `onClose`, so an opener can revert an optimistic open-state affordance), whereas `show()` mounts whatever it is given, including an empty list. Use plain `show()` for right-click context menus, which should reposition — not close — on a repeat trigger. [`MenuButton`](/components/MenuButton) is a ready-made `Button` wrapper around this pattern.

```typescript
trigger.on('click', () => menu.toggleFor(trigger.getElement(true), DOM.source.getViewportRect(trigger), items));
```

## Persistent mode (MenuBar dropdown)

```typescript
import { Menu } from '@jimka/typescript-ui/overlay';

const panel = Menu(
    [
        { text: 'Save',     shortcut: 'Ctrl+S', action: () => save()   },
        { text: 'Save As…', shortcut: 'Ctrl+Shift+S', action: () => saveAs() },
        { separator: true },
        { text: 'Print',    shortcut: 'Ctrl+P', action: () => print()  },
    ],
    () => bar.closeMenu()
);

panel.open(buttonElement);
```

You usually don't construct a persistent-mode `Menu` directly — `MenuBar` does that for each top-level entry.

## Item config

Each entry follows [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig):

| Field | Purpose |
| --- | --- |
| `text` | Display label. |
| `action` | Called on click or Enter (rebuild mode only auto-calls on click; persistent mode wires it through). |
| `closeOnActivate` | When `false`, the item runs `action` but the menu stays open; pairs with `checked` for a multi-select menu. Defaults to `true`. |
| `enabled` | Defaults to `true`. Disabled items are dimmed and non-interactive. |
| `shortcut` | Hint string displayed on the right (persistent mode renders it). |
| `icon` | Glyph displayed on the left. |
| `submenu` | Nested [`MenuConfig`](/api/component/container/interfaces/MenuConfig) (persistent mode only). |
| `separator` | When `true`, render as a horizontal rule and ignore other fields. |
| `row` | A zero-argument factory returning a [`MenuRow`](/api/component/container/classes/MenuRow); the menu renders that component instead of a `MenuItem` and ignores every other field. See [Custom rows](#custom-rows). |

## Custom rows

Most menus are built entirely from `MenuItemConfig` fields, but an entry can carry a `row: () => MenuRow` factory instead — the menu calls the factory and renders whatever component comes back in place of a `MenuItem`. This is how a menu hosts a real interactive control: a checkbox, a text field, anything else in the framework.

`MenuItem` and `MenuSeparator` both extend the abstract [`MenuRow`](/api/component/container/classes/MenuRow) base class, which `Menu` drives through a fixed set of methods. Every method has a working default, so a custom row overrides only what it needs:

- **The factory runs once per menu build, never a prebuilt instance.** `Menu` disposes its whole item list on every rebuild (`show()`, or a provider-sourced dropdown re-opening), so a row instance built once and reused across shows would be dead after the first one. Return a fresh `new YourRow()` from the factory every time.
- **`isNavigable()` defaults to `false`.** A custom row is left out of the menu's roving arrow-key highlight by default, exactly like a separator — the row is expected to own its own DOM focus and keys. Override it to `true` for a row that behaves like a menu item instead (no embedded focusable control): the highlight then lands on it, and Enter calls its `activate()`.
- **The row opts out of the shared check/icon/title/shortcut column grid by default** and renders across the row's full width. A row that wants to line up with the `MenuItem`s around it overrides `setColumns(checkZone, iconStart, titleColumn)` and positions its content from the injected `iconStart`. Because a row contributing no title/shortcut metrics would otherwise leave the panel too narrow, override `getContentWidth()` to report the row's own natural width — read **before** `setColumns` runs, so it must not depend on the injected columns.
- **Dismissing the menu from inside a custom row** goes through the protected `closeMenu()` helper, backed by a close callback `Menu` injects into every factory-built row right after constructing it — a factory row has no other reference to the menu hosting it.

```typescript
import { CheckboxMenuRow } from '@jimka/typescript-ui/component/container';

menu.show(0, 0, [
    { text: 'Bold',   action: () => toggleBold() },
    { separator: true },
    { row: () => new CheckboxMenuRow({ text: 'Show gridlines', checked: gridlinesOn }) },
]);
```

See [`CheckboxMenuRow`](/components/CheckboxMenuRow) for the full worked example — a menu row hosting a real [`Checkbox`](/components/Checkbox), toggling on click or Enter without closing the panel. [`RadioMenuRow`](/components/RadioMenuRow) is the equivalent for a single-choice group of rows — selecting is one-way, and the caller deselects the siblings.

**Known limitation:** hovering a custom row does not close a sibling item's already-open submenu — only `MenuItem`'s hover wires that signal. A submenu opened from a neighbouring item can stay visible over the panel until a click elsewhere resolves it.

## Notes

- The menu is appended to `document.documentElement` so it always layers above the rest of the UI.
- A menu taller than the room available at its anchor is clamped to that room and scrolls its items vertically, so every item stays reachable however large the list or however little screen space is left. Every rebuild-mode menu grows down-right from its anchor — the trigger's bottom-left corner for `toggleFor()`, the cursor for `show()` — and flips per axis when the room runs short: vertically its bottom ends at the anchor's top; horizontally its right edge aligns with the anchor's right. A cursor is a zero-size anchor, so a context menu opened near the bottom-right of the viewport ends **at** the cursor and never covers it. The clamp tracks the viewport size at open time; a menu open during a window resize keeps its original clamp and re-measures on the next open.
- Rebuild-mode coordinates are in viewport space (`clientX` / `clientY`).
- Submenus work in both modes: `showAnchored` wires up `submenu` on every rebuild-mode item too, not just persistent-mode ones. A submenu panel is built fresh each time it opens.
- Rebuild mode reads the `--ts-ui-context-menu-*` theme tokens; persistent mode reads `--ts-ui-menu-bar-panel-*` tokens. The visual style of each mode therefore matches its host.
- Opens and closes with a 120 ms opacity fade via [`Animation`](/api/core/namespaces/Animation). A fresh `show()` / `open()` during a fade-out cancels the deferred detach, so a quick close-then-reopen keeps the panel mounted. Honours `prefers-reduced-motion: reduce`.

## See also

- [API: Menu](/api/overlay/classes/Menu)
- [API: MenuItemConfig](/api/component/container/interfaces/MenuItemConfig), [MenuConfig](/api/component/container/interfaces/MenuConfig)
- [`MenuItem`](/components/MenuItem) and [`MenuSeparator`](/components/MenuSeparator) — the row components used internally.
- [`MenuBar`](/components/MenuBar) — the primary persistent-mode consumer.
- [`MenuButton`](/components/MenuButton) — a `Button` that wraps rebuild-mode `toggleFor()` for you.
- [Recipe: Right-click menu](/recipes/right-click-menu)
