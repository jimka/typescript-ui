# NotificationHistoryButton

[`NotificationHistoryButton`](/api/overlay/classes/NotificationHistoryButton) opens a menu of recent [`Notification`](/api/overlay/classes/Notification) toasts so the user can review — and re-open — notifications that have already auto-dismissed. Every `Notification.show()` call this session is recorded automatically; the button surfaces that history.

## Usage

```typescript
import { NotificationHistoryButton } from '@jimka/typescript-ui/overlay';

toolbar.addComponent(new NotificationHistoryButton());
```

`NotificationHistoryButton` extends [`MenuButton`](/components/MenuButton), so it opens below its bottom-left corner and **flips above the button** when the room below is short — the case for one placed in a bottom [`StatusBar`](/components/StatusBar). It seeds itself with a clock glyph and the history-items provider; pass any [`MenuButtonOptions`](/api/component/button/interfaces/MenuButtonOptions) to customise it (a consumer-supplied `glyph` overrides the default):

```typescript
new NotificationHistoryButton({ glyph: 'bell', description: 'History' });
```

## Behavior

- **Opens a menu of recent notifications** — clicking the button toggles a menu anchored under its bottom-left corner. A second click, an outside click, or `Escape` dismisses it.
- **Chronological, latest at the bottom** — history is listed oldest-first, and the menu opens **scrolled to the bottom** so the most recent entries are visible immediately. Each row shows the notification's **colour-coded severity badge** (matching the toast's), its **message**, and a **relative time** (`just now`, `5m ago`, `2h ago`, `3d ago`).
- **Re-open a past notification** — activating a row opens that notification's full, un-truncated message in the same modal detail dialog a live toast opens on double-click. It does **not** re-show a toast and does **not** add a new history entry, so browsing has no effect on the history.
- **Rebuilt on every open** — the menu is regenerated each time it opens, so relative times and newly-shown notifications are always current.
- **Empty state** — with no notifications yet, the menu shows a single disabled `No notifications yet` row.
- **Bounded history** — the most recent 50 notifications are retained; older entries are evicted. History is in-session only (not persisted across reloads).

## Reading the history programmatically

[`Notification.getHistory()`](/api/overlay/classes/Notification#gethistory) returns the retained records (oldest first) as a read-only copy:

```typescript
import { Notification } from '@jimka/typescript-ui/overlay';

for (const record of Notification.getHistory()) {
    console.log(record.timestamp, record.type, record.message);
}
```

Each entry is a [`NotificationRecord`](/api/overlay/interfaces/NotificationRecord) — `{ message, type, timestamp }`.

## See also

- [API: NotificationHistoryButton](/api/overlay/classes/NotificationHistoryButton)
- [Notification](/components/Notification) — the toasts this button reviews
- [Toast notifications](/recipes/notifications) — recipe
