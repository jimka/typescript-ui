# Menu

[`Menu`](/api/overlay/classes/Menu) is the framework's floating menu panel. It operates in one of two modes determined by the constructor:

- **Rebuild mode** — `Menu()` — a right-click context menu. Items are passed per `show(x, y, items)` call (or `showClearOf(x, y, keepClear, items)`, which keeps a rectangle uncovered) and rebuilt on each invocation. Best for menus whose contents depend on what the user clicked.
- **Persistent mode** — `Menu(items, onClose)` — a [`MenuBar`](/components/MenuBar) dropdown. Items are built once in the constructor and reused across `open()` / `close()` cycles. Used internally by `MenuBar`.

Most of the API belongs to one mode. `show()` / `showClearOf()` / `hide()` / `setMenuWidth()` are valid only in rebuild mode; `open()` / `close()` / `setExcludedElement()` are valid only in persistent mode. Calling a method outside its mode throws. The keyboard-highlight methods — `focusItem`, `focusNext`, `focusPrev`, `activateFocused`, `getFocusedIndex` and `handleKey` — work in both. A context menu opened from the keyboard needs none of them: it takes focus and handles its own keys (see [Keyboard](#keyboard)).

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

**Keeping an area clear.** `showClearOf(x, y, keepClear, items, onClose?, excludeEl?)` opens like `show()` at the pointer, but below or above `keepClear` — a viewport rectangle, such as the text the menu's items will change — so the menu covers neither it nor the pointer. It stays aligned to the pointer horizontally, flips above `keepClear` when the room below is short, and ignores a `keepClear` that has no part on screen (it then opens as `show()` does). The one exception is a `keepClear` that leaves no room: when the room on its roomier side is both less than the menu's height and less than four rows, `showClearOf()` gives it up and places the menu at the pointer exactly as `show()` does, covering the area if it must. Its submenus stay on the menu's side of `keepClear` when they fit there: a menu above the area flips a submenu up against its item instead of letting it grow down over the area, and a submenu too tall for that room is placed as usual. Keyboard focus, `onClose` and `excludeEl` behave as in `show()`.

```typescript
menu.showClearOf(e.clientX, e.clientY, DOM.source.getViewportRect(label), items);
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
| `action` | Called on click, or on Enter / Space when the row is highlighted (`activateFocused` / `handleKey`). |
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
- **`getActiveDescendantId()` returns the row's own id by default.** While a row is highlighted, the menu names this id in its `aria-activedescendant`, which is what a screen reader announces for a menu that holds focus. Override it when the row's accessible name and state live on an inner control: [`CheckboxMenuRow`](/components/CheckboxMenuRow) and [`RadioMenuRow`](/components/RadioMenuRow) return the id of their checkbox or radio button.

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

## Keyboard

A menu is worked from the keyboard in one of two ways, depending on how it was opened.

### Context menus (`show()`)

A context menu has no host control to forward keys to it, so what `show()` (and `showClearOf()`, which takes focus and handles keys exactly as `show()` does) does depends on the user's last press: a key, or a pointer button. A modifier pressed by itself and the auto-repeat of a held key do not count as a key press, so a Control-held right-click is still a mouse open.

**Opened with the mouse** — the last press was a pointer button — the menu takes no focus, highlights no row and handles no key. Focus stays where it was, and `Escape` still closes the menu.

**Opened from the keyboard** — the last press was a key, such as Shift+F10, the ContextMenu key, or `Enter` on a button whose action calls `show()` — the menu takes DOM focus on its panel and highlights its first enabled row (the first row when none is enabled). It then handles these keys itself:

| Key | Effect |
| --- | --- |
| `↓` / `↑` | Highlights the next / previous row, wrapping and skipping separators. Scrolls the row into view. |
| `Home` / `End` | Highlights the first / last row. |
| `Enter` / `Space` | Activates the highlighted row; on a row with a submenu, opens the submenu and moves into it. Once per press: a held key does not repeat. |
| `→` | Opens the highlighted row's submenu and moves into it. |
| `←` | In a submenu, closes it and returns to its parent row. |
| `Tab` / `Shift+Tab` | Closes the whole menu and returns focus; the key then moves focus on as usual. Inside a modal dialog or drawer, focus wraps within it. |
| `Escape` | Closes the whole menu, submenus included. |

A key pressed with `Alt`, `Control` or `Meta` is left alone, so a browser or application chord such as `Alt+←` keeps working while the menu is open.

When the menu closes, focus returns to the element that had it when the menu opened, with its selection or caret as it was. The same `contextmenu` handler serves both the mouse and the keyboard; nothing extra is wired. A [`Tree`](/components/Tree#context-menu), [`List`](/components/List#context-menu), [`MultiSelectList`](/components/MultiSelectList#selection-model), [`Table`](/components/Table#keyboard) or [`TreeTable`](/components/TreeTable#keyboard) holds focus on its own element, not on a row or a cell, so it opens the menu for its current row or cell and under it.

- **Focus returns before a closing row's `action` runs**, so an action that reads the selection, uses the clipboard, or opens a [`Dialog`](/components/Dialog) acts on the element the menu was opened for. An action that moves focus elsewhere keeps it: focus is returned only while it is still inside the menu. A row with `closeOnActivate: false` leaves the menu open and focused.
- **Disabled rows can be highlighted**, so a keyboard user can find them. Activating one does nothing and leaves the menu open.
- **The element the menu was opened from loses focus while the menu is open.** A text field with typed, uncommitted text therefore commits it when the menu opens. A [`Table`](/components/Table) cell editor is the exception: its edit stays open until the menu closes.
- **Any `show()` your code makes while the user's last press was a key takes focus**, however long ago that press was — a menu shown from a timer after the user typed, for example. Use `toggleFor()` for a dropdown whose trigger should keep focus.
- **Inside a modal [`Dialog`](/components/Dialog) or modal [`Drawer`](/components/Drawer), `Tab` closes the menu and focus stays inside the modal.** From a menu opened on the modal's last control, `Tab` goes to its first control, and `Shift+Tab` from one opened on the first control goes to the last.
- **Focus history does not see the menu.** With [focus history](/recipes/focus-history) enabled, the panel is not a stop, opening and closing the menu leaves the trail as it was, and `Alt+[` / `Alt+]` do nothing while any menu is open.
- **A `show()` called from your own `keydown` handler, for the key press being handled, is not guaranteed either way.** The press may not be on record yet when the handler runs, so the menu can open as if from the mouse. Open the menu from `contextmenu`, or from a button's `"action"`, where the press always comes first.

The panel declares `aria-activedescendant` for its highlighted row, so assistive technology follows the highlight.

### Dropdowns driven by a host (`toggleFor()`, `MenuBar`)

A dropdown never takes DOM focus. The control that opened it keeps focus and forwards its keydowns to `handleKey(e)`, which moves a highlight over the rows — the same model as a [`ComboBox`](/components/ComboBox) dropdown. [`SplitButton`](/components/SplitButton) drives its dropdown this way, and [`MenuBar`](/components/MenuBar) drives its panels through the same highlight methods.

| Key | Effect |
| --- | --- |
| `↓` | Highlights the next row, wrapping and skipping separators; from no highlight, the first row. |
| `↑` | Highlights the previous row, wrapping; from no highlight, the last row. |
| `Enter` / `Space` | Activates the highlighted row, if any. |

`handleKey` returns `true` for those four keys, so the host consumes them — `Enter` and `Space` included when no row is highlighted, so the host's own activation does not run. It returns `false` for every other key. `Escape` is one of them: it closes the topmost layer, which is the open menu, without the host's help. Each `toggleFor()` starts with no row highlighted, and `hide()` clears the highlight.

```typescript
const handled = menu.handleKey(e);

if (handled) {
    return { stop: true, prevent: true };
}
```

## Notes

- The menu is appended to `document.documentElement` so it always layers above the rest of the UI.
- A menu taller than the room available at its anchor is clamped to that room and scrolls its items vertically with the framework's own scrollbar widget (not the OS scrollbar), so every item stays reachable however large the list or however little screen space is left. The scrollbar reserves its track width, so no item renders beneath it. Every rebuild-mode menu grows down-right from its anchor — the trigger's bottom-left corner for `toggleFor()`, the cursor for `show()` — and flips per axis when the room runs short: vertically its bottom ends at the anchor's top; horizontally its right edge aligns with the anchor's right. A cursor is a zero-size anchor, so a context menu opened near the bottom-right of the viewport ends **at** the cursor and never covers it. The clamp tracks the viewport size at open time; a menu open during a window resize keeps its original clamp and re-measures on the next open. Persistent-mode `open()`'s horizontal alignment flips the same way `toggleFor()`'s does — aligning with the anchor's right edge near the viewport's right edge — rather than clamping to the viewport edge.
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
