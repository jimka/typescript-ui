# Toast notifications

Use [`Notification`](/components/Notification) for transient feedback that doesn't interrupt the user.

## Severity ladder

```typescript
import { Notification } from '@jimka/typescript-ui/overlay';

Notification.show('Saved.',                'success');             // 3 s default
Notification.show('Cache rebuilt.',        'info');                // 3 s
Notification.show('Disk almost full.',     'warning', 6000);       // 6 s
Notification.show('Connection lost.',      'error', 0);            // persistent until dismissed
```

| Severity | Use for |
| --- | --- |
| `'success'` | Background actions that completed normally — saves, sync, copy to clipboard. |
| `'info'` | Neutral status messages. |
| `'warning'` | Non-blocking issues the user should notice but isn't required to act on. |
| `'error'` | Failures. Use `0` duration so it stays visible until acknowledged. |

## After an async action

```typescript
async function saveRecord(record: ModelRecord) {
    try {
        await api.save(record);
        record.commit();
        Notification.show('Record saved.', 'success');
    } catch (err) {
        Notification.show(`Save failed: ${(err as Error).message}`, 'error', 0);
    }
}
```

## Pair with a context-menu action

```typescript
menu.show(x, y, [
    { text: 'Copy link', action: () => {
        navigator.clipboard.writeText(url);
        Notification.show('Link copied.', 'success');
    }},
]);
```

## Behaviour notes

- **Severity badge** — every toast leads with an SVG glyph tinted with the severity's border-colour token.
- **Stacking** — multiple toasts stack upward from the bottom-right corner.
- **Hover-pause is global** — hovering *any* toast freezes *every* visible toast's timer until the pointer leaves the last one. New toasts shown during the paused window start paused too.
- **Two-line clamp** — long messages are clamped to two lines with a trailing ellipsis. Double-click the toast to open a modal dialog with the full content.
- **Entrance + exit animation** — toasts slide in from the right and fade in over 200ms when they appear, and slide out + fade over 200ms on dismiss.
- **Manual dismiss** — every toast has a × button. Persistent toasts (`duration === 0`) require manual dismiss. `prefers-reduced-motion: reduce` skips both the entrance and exit animations.

## Pausing toasts during your own modal flow

`Notification.pauseAll()` and `Notification.resumeAll()` pause every active toast timer. Use them when you open a custom modal that should also hold the notification stack in place — the framework only wires this in automatically for the built-in double-click detail dialog.

```typescript
import { Notification, Dialog } from '@jimka/typescript-ui/overlay';


Notification.pauseAll();
await Dialog.show({ title: 'Confirm', message: 'Discard the in-progress draft?' });
Notification.resumeAll();
```

`resumeAll` restarts each timer with at least 8 seconds remaining, so the user has time to read the stack after the modal closes.

## Reviewing past notifications

Toasts auto-dismiss, so a user who glances away misses them. Drop a [`NotificationHistoryButton`](/components/NotificationHistoryButton) into a toolbar to give them a way back: it opens a menu of the notifications shown this session (newest first, with severity badge and relative time), and activating a row re-opens that notification's full message in a modal detail dialog.

```typescript
import { NotificationHistoryButton } from '@jimka/typescript-ui/overlay';

toolbar.addComponent(new NotificationHistoryButton());
```

Capture is automatic — every `Notification.show()` is recorded, so nothing else is needed. To read the history programmatically, use [`Notification.getHistory()`](/api/overlay/classes/Notification#gethistory), which returns the retained records (oldest first) as a read-only copy. History is in-session only and bounded to the most recent 50 entries.

## Anti-patterns

- **Don't block** — for confirmation prompts use [`Dialog`](/recipes/dialog-modal), not a toast.
- **Don't show high-frequency events** — debounce or batch repeated updates so the user isn't overwhelmed.
- **Don't put long content in a toast** — for multi-line text, switch to a dialog or a dedicated panel.

## Theming

Each severity has its own background and border tokens — see [Theming](/concepts/theming#theme-keys), `notification.*` group.

## See also

- [Notification](/components/Notification)
- [NotificationHistoryButton](/components/NotificationHistoryButton) — review and re-open past notifications
- [Dialog modal](/recipes/dialog-modal) — for confirmations and form prompts
