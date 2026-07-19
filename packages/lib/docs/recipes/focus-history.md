# Focus history navigation

[`FocusHistory`](/api/core/namespaces/FocusHistory) records the chronological trail of focused elements across your app and drives keyboard accelerators that walk it backward and forward — browser back/forward, but for keyboard focus. It's opt-in: nothing starts it automatically, matching the [Keyboard shortcuts](/recipes/keyboard-shortcuts) recipe's stance that accelerators are consumer-installed.

## Goal

Enable focus-history tracking, wire toolbar buttons to `back()`/`forward()` that enable/disable themselves via the `"change"` event, and override the default combo.

## Enable the service

```typescript
import { FocusHistory } from '@jimka/typescript-ui/core';

FocusHistory.enable();
```

Once enabled, every element that receives keyboard focus is recorded. Pressing `Alt+[` re-focuses the previous entry; `Alt+]` re-does it. Both combos are matched on the physical key (`KeyboardEvent.code`), so they work the same regardless of keyboard layout.

## Wire back/forward buttons

Subscribe to `"change"` to keep a toolbar's buttons in sync with what's actually navigable:

```typescript
import { Button } from '@jimka/typescript-ui/component/button';
import { ToolBar } from '@jimka/typescript-ui/component/menubar';

const back = Button('←');
const forward = Button('→');

back.setEnabled(false);
forward.setEnabled(false);

back.on('action', () => FocusHistory.back());
forward.on('action', () => FocusHistory.forward());

FocusHistory.on('change', ({ canGoBack, canGoForward }) => {
    back.setEnabled(canGoBack);
    forward.setEnabled(canGoForward);
});

const toolbar = new ToolBar();
toolbar.addComponent(back);
toolbar.addComponent(forward);
```

Entries whose element has left the DOM are skipped and dropped automatically — a closed dialog's transient focus target, for instance, is pruned the next time `back()`/`forward()` walks past it.

## Override the accelerator

Pass `back`/`forward` combos to `enable()` (or update them later via `configure()`) if `Alt+[` / `Alt+]` collides with something else in your app:

```typescript
FocusHistory.enable({
    back:    { code: 'ArrowLeft',  alt: true, shift: true },
    forward: { code: 'ArrowRight', alt: true, shift: true },
});
```

`maxSize` (default 50) bounds how many trail entries are kept; the oldest are dropped once it's exceeded.

## Modal dialogs

While a modal [`Dialog`](/components/Dialog) is open, the back/forward accelerator is inert — it won't fight the dialog's own focus trap. Non-modal overlays (dropdowns, popovers) don't suppress it.

## See also

- [Keyboard shortcuts](/recipes/keyboard-shortcuts)
- [API: FocusHistory](/api/core/namespaces/FocusHistory)
