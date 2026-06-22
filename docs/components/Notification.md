# Notification

[`Notification`](/api/overlay/classes/Notification) shows a toast in the bottom-right corner of the viewport that auto-dismisses after a configurable duration. Multiple toasts stack upward; each has a manual × dismiss button.

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

- **Severity badge** — every toast leads with an SVG glyph that matches its severity (`info`, `success`, `warning`, `error`). The badge is tinted with the severity's border-colour token so it pulls together with the rest of the toast.
- **Hover-pause is global** — hovering *any* toast pauses *every* visible toast's timer. The timers resume only when the pointer leaves the last hovered toast. New toasts shown during the paused window start paused too.
- **Two-line clamp** — long messages are clamped to two lines with a trailing ellipsis (`-webkit-line-clamp: 2`). The fixed 64px toast height stays predictable; the full message is reachable via the detail dialog (below).
- **Double-click detail** — double-clicking the toast opens a modal dialog showing the full un-truncated message. The dialog's title bar is tinted with the severity's colours and carries the same badge glyph.
- **Stacking** — multiple toasts stack upward from the bottom-right corner.
- **Entrance + exit animation** — toasts slide in from the right and fade in over 200ms when they appear, and slide back out + fade over 200ms when dismissed.
- **Manual dismiss** — every toast renders a × button (labelled "Dismiss notification" for assistive tech). The stack collapses upward once the exit transition completes. Both entrance and exit honour `prefers-reduced-motion: reduce`.
- **Screen-reader announcement** — each toast is a live region so assistive tech announces it on appearance. `error` and `warning` toasts use `role="alert"` / `aria-live="assertive"` (interrupting); `info` and `success` use `role="status"` / `aria-live="polite"`. The decorative severity badge is `aria-hidden`, so only the message text is announced.
- **Pause-on-modal** — opening the detail dialog calls [`Notification.pauseAll()`](/api/overlay/classes/Notification#pauseall) on the way in and [`Notification.resumeAll()`](/api/overlay/classes/Notification#resumeall) on the way out. The pair is refcounted, so it composes with the hover-pause refcount and with nested consumer-driven pause/resume calls. Resumed timers are clamped to a minimum of 8 seconds whenever the *last* release was a modal one, so the user has time to read the remaining toasts.

## Pausing toasts during your own modal flow

`Notification.pauseAll()` and `Notification.resumeAll()` are public, so consumer code can pause the entire notification stack while a custom modal is open:

```typescript
import { Notification, Dialog } from '@jimka/typescript-ui/core';

Notification.pauseAll();
await Dialog.show({ title: 'Review changes', message: '…' });
Notification.resumeAll();
```

The library only pauses notifications for the built-in double-click detail dialog; arbitrary `Dialog.show` callers opt in through this pair.

## Theming

Each severity has its own background and border tokens — see the `notification.*` token group in [Theming](/concepts/theming#theme-keys). You can also customise the drop shadow via `notification.shadow`.

## See also

- [API: Notification](/api/overlay/classes/Notification)
- [API: NotificationType](/api/overlay/type-aliases/NotificationType)
