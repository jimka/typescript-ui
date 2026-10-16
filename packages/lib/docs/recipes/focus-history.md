# Focus history navigation

[`FocusHistory`](/api/core/namespaces/FocusHistory) records the places keyboard focus has been across your app, in order, and drives keyboard accelerators that walk that trail backward and forward — browser back/forward, but for keyboard focus. A menu or a dialog is not a place: see [What is recorded](#what-is-recorded). It's opt-in: nothing starts it automatically, matching the [Keyboard shortcuts](/recipes/keyboard-shortcuts) recipe's stance that accelerators are consumer-installed.

## Goal

Enable focus-history tracking, wire toolbar buttons to `back()`/`forward()` that enable/disable themselves via the `"change"` event, and override the default combo.

## Enable the service

```typescript
import { FocusHistory } from '@jimka/typescript-ui/core';

FocusHistory.enable();
```

Once enabled, the service records each place keyboard focus lands on; [What is recorded](#what-is-recorded) says which elements count. Each entry of the trail is a *stop*. Pressing `Alt+[` re-focuses the previous stop; `Alt+]` re-does it. Both combos are matched on the physical key (`KeyboardEvent.code`), so they work the same regardless of keyboard layout.

## What is recorded

A focus move is recorded when it lands on a place that stays:

| Focus lands on | Recorded |
| --- | --- |
| A control of the page | yes |
| A control of a [`Window`](/components/Window) or a non-modal [`Drawer`](/components/Drawer) | yes |
| A control of a [`Popover`](/components/Popover) built with `dismissOn: "manual"` | yes |
| A context [`Menu`](/components/Menu), a menu bar's panel, or a dropdown such as a [`ComboBox`](/components/ComboBox)'s list | no |
| A control of a [`PopupPanel`](/components/PopupPanel), or of a `Popover` that an outside click or focus move closes | no |
| A control of a [`Dialog`](/components/Dialog) or a modal `Drawer`, or anything else focused while one is open | no |
| A control inside a table cell, such as a cell editor | no |

A window records itself as a stop when it takes focus, as it is shown, raised, pressed or restored, and closing it with focus inside returns focus to the element it took focus from.

A menu, a dropdown, a popover and a dialog are gone once closed, so a stop inside one would lead nowhere. A [`Table`](/components/Table) holds focus on its own element for all of its cells, and that element is a stop; what is left out is a control inside a cell.

If nothing has focus when `enable()` runs, the trail starts empty.

## Wire back/forward buttons

Subscribe to `"change"` to keep a toolbar's buttons in sync with what's actually navigable:

```typescript
import { Button } from '@jimka/typescript-ui/component/button';
import { ToolBar } from '@jimka/typescript-ui/component/menubar';

const back = Button('←');
const forward = Button('→');

back.on('action', () => FocusHistory.back());
forward.on('action', () => FocusHistory.forward());

FocusHistory.on('change', ({ canGoBack, canGoForward }) => {
    back.setEnabled(canGoBack);
    forward.setEnabled(canGoForward);
});

// "change" is not fired on subscribing: read the starting state once.
back.setEnabled(FocusHistory.canGoBack());
forward.setEnabled(FocusHistory.canGoForward());

const toolbar = new ToolBar();
toolbar.addComponent(back);
toolbar.addComponent(forward);
```

Stops whose element has left the DOM are skipped and dropped automatically — a control of a window that has since been closed, for instance, is pruned the next time `back()`/`forward()` walks past it. A stop that is hidden or disabled is passed over and kept, so it works again once the control is back: the field of a minimised window, say.

When focus has left the current stop — it is in a table cell's editor, or the focused control was removed — `back()` returns to that stop first, and only the next call goes to the stop before it.

`canGoBack` and `canGoForward` say what `back()` and `forward()` would do from where focus is now, so a button wired this way is enabled when its click has somewhere to go.

| Trail (`*` marks the current stop) | Focus is on | `canGoBack` | `canGoForward` |
| --- | --- | --- | --- |
| `[A*]` | `A` | `false` | `false` |
| `[A*]` | a table cell's editor, a control of a popup, or nothing because the focused control was removed | `true` (`back()` returns to `A`) | `false` |
| `[A, B*]` | `B` | `true` | `false` |
| `[A*, B]` | `A` | `false` | `true` |
| any trail | anything, while a dialog or a modal drawer is open | `false` | `false` |

`"change"` fires when either value changes, and only then. A focus move that records nothing fires it when it changes what `back()` would do. A recorded move that changes neither value does not.

A stop that is still in the document counts even when it cannot take focus right now — it is hidden in a minimised window, or disabled — so `back()` can return `false` after `canGoBack` was `true`. A stop that leaves the document changes the flags with no event of its own: the two functions are right whenever they are called, and `"change"` catches up at the next focus move, the next `back()` / `forward()` call, or the next dialog or modal drawer that opens or closes. While the service is disabled the two functions keep answering, a focus move fires no `"change"`, and `enable()` fires it if a value changed in between.

## Override the accelerator

Pass `back`/`forward` combos to `enable()` (or update them later via `configure()`) if `Alt+[` / `Alt+]` collides with something else in your app:

```typescript
FocusHistory.enable({
    back:    { code: 'ArrowLeft',  alt: true, shift: true },
    forward: { code: 'ArrowRight', alt: true, shift: true },
});
```

`maxSize` (default 50) bounds how many trail entries are kept; the oldest are dropped once it's exceeded.

## Menus, dropdowns, popovers and dialogs

Opening and closing a menu, a dropdown, a dialog, a modal drawer, or a popover that an outside click or focus move closes leaves the trail as it was, forward part included. The control that opened it is the current stop before and after.

| While open | `Alt+[` / `Alt+]` | `back()` / `forward()` | `canGoBack` / `canGoForward` |
| --- | --- | --- | --- |
| A context menu, a menu bar's panel, a dropdown, a popup panel, a popover that an outside click or focus move closes | do nothing; the key is left to your application | walk the trail | as with nothing open |
| A dialog or a modal drawer, with or without a menu or a dropdown open inside it | do nothing; the key is left to your application | return `false` and move nothing | both `false` |
| A window, a non-modal drawer, a `dismissOn: "manual"` popover | walk the trail | walk the trail | as with nothing open |

The functions are not held back by a menu or a dropdown so that a toolbar button wired to `back()` still works when its click is what closes one. The flags follow the functions, so that button stays enabled. While a dialog or a modal drawer is open the trail is out of reach: its stops are controls of the application behind the modal.

## See also

- [Keyboard shortcuts](/recipes/keyboard-shortcuts)
- [API: FocusHistory](/api/core/namespaces/FocusHistory)
