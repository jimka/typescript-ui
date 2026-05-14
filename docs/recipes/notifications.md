# Toast notifications

Use [`Notification`](/components/Notification) for transient feedback that doesn't interrupt the user.

## Severity ladder

```typescript
import { Notification } from '@jimka/typescript-ui/core';
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

- **Stacking** — multiple toasts stack upward from the bottom-right corner.
- **Hover-pause** — the auto-dismiss timer pauses while the pointer is over the toast and resumes when it leaves.
- **Manual dismiss** — every toast has a × button. Persistent toasts (`duration === 0`) require manual dismiss.

## Anti-patterns

- **Don't block** — for confirmation prompts use [`Dialog`](/recipes/dialog-modal), not a toast.
- **Don't show high-frequency events** — debounce or batch repeated updates so the user isn't overwhelmed.
- **Don't put long content in a toast** — for multi-line text, switch to a dialog or a dedicated panel.

## Theming

Each severity has its own background and border tokens — see [Theming](/concepts/theming#theme-keys), `notification.*` group.

## See also

- [Notification](/components/Notification)
- [Dialog modal](/recipes/dialog-modal) — for confirmations and form prompts
