# Notification

[`Notification`](/api/classes/Notification) shows a toast in the bottom-right corner of the viewport that auto-dismisses after a configurable duration. Multiple toasts stack upward; each has a manual × dismiss button.

## Usage

```typescript
import { Notification } from '@jimka/typescript-ui/core';
Notification.show('Record saved.', 'success');
Notification.show('Connection lost.', 'error', 0);   // 0 = persistent
Notification.show('Heads up.',      'warning', 6000); // 6 seconds
```

The static signature is:

```typescript
Notification.show(
    message: string,
    type:    'info' | 'success' | 'warning' | 'error',
    duration?: number  // ms, default 3000; 0 = persistent
): void
```

## Behavior

- **Hover-pause** — the auto-dismiss timer pauses while the pointer is over the toast, and resumes when it leaves.
- **Stacking** — multiple toasts stack upward from the bottom-right corner.
- **Manual dismiss** — every toast renders a × button.

## Theming

Each severity has its own background and border tokens — see the `notification.*` token group in [Theming](/concepts/theming#theme-keys). You can also customise the drop shadow via `notification.shadow`.

## See also

- [API: Notification](/api/classes/Notification)
- [API: NotificationType](/api/type-aliases/NotificationType)
