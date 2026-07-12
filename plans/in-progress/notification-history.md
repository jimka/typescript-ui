# Notification History — Implementation Plan

## Overview

Toasts shown via `Notification.show()` ([src/typescript/lib/overlay/Notification.ts:214](src/typescript/lib/overlay/Notification.ts#L214)) auto-dismiss and vanish with no way to review them. This feature adds (1) an automatic, bounded in-session record of every `Notification.show()` call, (2) a trigger button that opens a menu listing recent notifications newest-first, and (3) opening any past notification's full detail in the same modal dialog that double-clicking a live toast opens.

Storage is a private static ring buffer added directly to `Notification`, exposed through a new static read accessor and a new `NotificationRecord` record type. The browse UI is a new `NotificationHistoryButton` — a `Button` subclass placed in `overlay/` (alongside `Notification`) that owns a rebuild-mode `Menu` ([src/typescript/lib/overlay/Menu.ts:67](src/typescript/lib/overlay/Menu.ts#L67)) anchored beneath it, mirroring how `SplitButton` anchors its dropdown ([src/typescript/lib/component/button/SplitButton.ts:215](src/typescript/lib/component/button/SplitButton.ts#L215)).

---

## Architecture Decisions

### History lives as a private static ring buffer on `Notification`, not a separate module

`Notification.show()` is the single capture point, so storage must be co-located with it regardless. A bounded array plus one read accessor does not justify a second class: adding a `NotificationHistory` module would only relocate a five-line concern across a seam and add a second exported symbol to document. Recording a short log of what it displayed is within `Notification`'s remit — it is not presentation state riding on a data `Model` (the case the "keep presentation state out of Models" rule guards), so no convention pushes it out. *Rejected: a standalone `NotificationHistory` static class — more surface, no complexity removed.*

### Capture is unconditional inside `show()`; the history menu never records

Every `Notification.show()` call appends exactly one record. Clicking a history row does **not** re-show a toast — it opens the same modal detail dialog that double-clicking a live toast opens (see the next decision), so browsing history has no side effect on history itself. This keeps a clean invariant: "history = everything ever shown this session, one entry per `show()`."

### Clicking a history row opens the detail dialog, reusing `Notification`'s existing detail view

Double-clicking a live toast already opens a modal dialog with the full message via the private `openDetail()` ([Notification.ts:429](src/typescript/lib/overlay/Notification.ts#L429)). Rather than duplicate that dialog, extract its body into a new `static showDetail(message, type)` on `Notification`; the instance `openDetail()` becomes a one-line delegate, and the history button's row action calls `Notification.showDetail(record.message, record.type)`. One source of truth for the detail dialog; no re-show and no new record; and the notification stack is paused while the dialog is open exactly as it is for a live toast (the extracted body keeps the `pauseAll()`/`resumeAll()` bracket).

### The record captures the full (un-truncated) message

`show(message, …)` receives the full text; the two-line clamp is display-only (`_fullMessage` at [Notification.ts:98](src/typescript/lib/overlay/Notification.ts#L98) already preserves it). The record stores `message` verbatim so a re-show reproduces the original toast exactly.

### Cap is a fixed 50 entries, evicting oldest

A ring buffer bounded at 50 keeps memory trivial and the menu scrollable but not endless. Oldest-out (`push` then `shift` when over cap) matches "recent notifications". 50 is a documented magic constant.

### The browse surface is a rebuild-mode `Menu`, not a `Popover` or `List`

A `Menu` gives activatable rows with a leading glyph, a title, a right-aligned hint, keyboard navigation, outside-click/Escape dismissal, and height-clamped scrolling — all already built. Each history entry maps cleanly to one `MenuItemConfig`: `glyph` = the severity badge, `text` = the message, `shortcut` = the relative time, `action` = re-show. `Popover` would require hand-building a `List` and row chrome for no gain. *Rejected: `Popover` + `List` — reimplements what `Menu` already provides.*

### `NotificationHistoryButton` extends `Button` and lives in `overlay/`

It is a coordinator (trigger + owned menu + history read + re-show wiring), directly analogous to `SplitButton` — so a small `Button` subclass is the right shape, not a composition (which would add a wrapper element around a `Button` for nothing). It is placed in `overlay/` rather than `component/button/` to avoid an import cycle: it imports `Notification` (in `overlay`), and `Notification` imports `Button` (in `component/button`); putting the new button in `component/button` and re-exporting it from that barrel would make the button barrel pull in `overlay`, which pulls the button barrel back. `overlay/` already depends on `component/button` one-way, so the file sits cleanly there. Its `Button` base is imported by the callable name per convention.

### Relative-time formatting is a module-private helper, not a new exported util

No relative-time formatter exists in the library (confirmed: no `Intl.RelativeTimeFormat`, `timeAgo`, or similar). The need is single-use (one call site), so a small module-private `formatRelativeTime(timestampMs, nowMs)` lives in `NotificationHistoryButton.ts`. Simplicity-first: do not export a general util that only one component uses.

### `Date.now()` is used directly for timestamps

ARCHITECTURE.md defines no time seam (the DOM seam covers DOM reads/writes only); `Notification` already calls `Date.now()` for its timers ([Notification.ts:381](src/typescript/lib/overlay/Notification.ts#L381)). The Date-usage restriction applies to workflow scripts, not library source, so `Date.now()` in both the record timestamp and the relative-time helper is correct.

---

## Public API

New record type, exported from the `overlay` barrel (same bucket as `Notification`):

```typescript
/**
 * A single captured notification, retained in Notification.getHistory().
 * @category Core
 */
export interface NotificationRecord {
    /** The full (un-truncated) message text passed to Notification.show(). */
    readonly message: string;
    /** The severity type the toast was shown with. */
    readonly type: NotificationType;
    /** Epoch milliseconds (Date.now()) when the toast was shown. */
    readonly timestamp: number;
}
```

New static accessor on `Notification`:

```typescript
/**
 * Returns the in-session notification history, oldest first, capped at the
 * most recent 50 entries. The returned array is a defensive copy.
 */
static getHistory(): readonly NotificationRecord[]
```

New static method on `Notification` (extracted from the existing private `openDetail()` so the history button can reuse it; must be non-private because it is called from `NotificationHistoryButton`):

```typescript
/**
 * Opens the modal detail dialog for a message/type pair — the same dialog a
 * live toast opens on double-click. Pauses active notification timers while
 * the dialog is open. Does not itself record a history entry.
 */
static showDetail(message: string, type: NotificationType): void
```

New component (in `overlay/NotificationHistoryButton.ts`), exported callable-wrapped from the `overlay` barrel:

```typescript
export interface NotificationHistoryButtonOptions extends ButtonOptions {}

class NotificationHistoryButton extends Button<NotificationHistoryButtonOptions> {
    constructor(options?: NotificationHistoryButtonOptions);
}
// exported as: _NotificationHistoryButton (raw) and NotificationHistoryButton (callable)
```

Behaviour of the constructor: defaults `glyph` to `"clock-rotate-left"` (folded so a consumer-supplied `glyph` still wins), sets an ARIA label `"Notification history"`, and wires its own `"action"` listener to toggle an owned rebuild-mode `Menu`. Backing state: `private _menu: Menu | null = null` (lazily created), `private readonly _boundToggleMenu: () => void`. No new options field beyond `ButtonOptions`; the empty-extension interface exists for the class generic + `callable()` typing, matching `SplitButtonOptions`.

---

## Internal Structure

### Ring buffer + capture (in `Notification.ts`)

```typescript
private static readonly HISTORY_CAP: number = 50;   // most-recent entries retained
private static history: NotificationRecord[] = [];  // oldest-first

// appended near the top of show(), before constructing the toast:
private static record(message: string, type: NotificationType): void {
    Notification.history.push({ message, type, timestamp: Date.now() });
    if (Notification.history.length > Notification.HISTORY_CAP) {
        Notification.history.shift();
    }
}

static getHistory(): readonly NotificationRecord[] {
    return [...Notification.history];
}
```

`show()` calls `Notification.record(message, type)` as its first statement (before `new Notification(...)`), so every code path that displays a toast is captured exactly once.

### Detail dialog extraction (in `Notification.ts`)

Move the body of the private instance `openDetail()` ([Notification.ts:429](src/typescript/lib/overlay/Notification.ts#L429)) into a new static method, parameterising the two instance reads (`this._fullMessage` → `message`, `this._type` → `type`):

```typescript
static showDetail(message: string, type: NotificationType): void {
    Notification.pauseAll();
    // ... existing dialog-building body, verbatim except:
    //   this._fullMessage -> message
    //   this._type        -> type
    dialog.show().then(() => Notification.resumeAll());
}

private openDetail(): void {
    Notification.showDetail(this._fullMessage, this._type);
}
```

`DETAIL_TITLE` and `BADGE_GLYPH` are already module-scoped, so the moved body still resolves them. Live-toast double-click behaviour is unchanged (it now routes through `showDetail`).

### Menu config construction (in `NotificationHistoryButton.ts`)

```typescript
private buildItems(): MenuItemConfig[] {
    const history = Notification.getHistory();
    if (history.length === 0) {
        return [{ text: "No notifications yet", enabled: false }];
    }
    const now = Date.now();
    // Newest first: reverse the oldest-first history.
    return history.slice().reverse().map(record => ({
        glyph:    BADGE_GLYPH[record.type],           // shared with Notification (see step 2)
        text:     record.message,
        shortcut: formatRelativeTime(record.timestamp, now),
        action:   () => Notification.showDetail(record.message, record.type),
    }));
}
```

`BADGE_GLYPH` (the `NotificationType → registry-glyph-name` map) currently lives module-private in `Notification.ts` ([Notification.ts:30](src/typescript/lib/overlay/Notification.ts#L30)). Export it so the button reuses one source of truth (step 2) rather than duplicating the mapping.

### Relative-time helper (module-private in `NotificationHistoryButton.ts`)

```typescript
const MINUTE_MS = 60_000;
const HOUR_MS   = 3_600_000;
const DAY_MS    = 86_400_000;

function formatRelativeTime(timestampMs: number, nowMs: number): string {
    const delta = Math.max(0, nowMs - timestampMs);
    if (delta < MINUTE_MS) return "just now";
    if (delta < HOUR_MS)   return `${Math.floor(delta / MINUTE_MS)}m ago`;
    if (delta < DAY_MS)    return `${Math.floor(delta / HOUR_MS)}h ago`;
    return `${Math.floor(delta / DAY_MS)}d ago`;
}
```

### Menu anchoring (in `NotificationHistoryButton.ts`) — mirrors `SplitButton._toggleMenu`

```typescript
private toggleMenu(): void {
    const el = this.getElement();
    if (!el) return;                       // unattached: no anchor rect yet

    const rect = DOM.source.getViewportRect(this);
    this._menu ??= new Menu();             // rebuild-mode context menu
    this._menu.toggleFor(el, rect.left, rect.bottom, this.buildItems());
}
```

`Menu.toggleFor(openerEl, x, y, configs)` opens the menu below the button's bottom-left, excludes the button from outside-click dismissal, and closes on a second press of the same button ([Menu.ts:285](src/typescript/lib/overlay/Menu.ts#L285)). Items are rebuilt on every open, so relative times and new entries are always current. An item's `action` runs then the menu auto-hides (rebuild-mode `show()` wraps each action with `this.hide()` at [Menu.ts:206](src/typescript/lib/overlay/Menu.ts#L206)), so clicking a row opens the detail dialog and closes the menu. (The dialog sits in the `Dialog` band above the menu's `Dropdown` band, so it is unaffected by the menu closing.)

---

## Ordered Implementation Steps

1. **Add the record type + ring buffer to `Notification.ts`.** Above the `Notification` class, add the exported `NotificationRecord` interface (see *Public API*). Inside the class add the `HISTORY_CAP` constant, the `private static history: NotificationRecord[] = []` field, the `private static record(...)` method, and the `static getHistory()` accessor (see *Internal Structure*). → verify: `npx tsc --noEmit` clean.

2. **Export `BADGE_GLYPH` from `Notification.ts`.** Change `const BADGE_GLYPH` ([Notification.ts:30](src/typescript/lib/overlay/Notification.ts#L30)) to `export const BADGE_GLYPH`. This is the shared severity-glyph map the button reuses. → verify: `grep -n "export const BADGE_GLYPH" src/typescript/lib/overlay/Notification.ts`.

3. **Capture in `show()`, and extract `showDetail`.** (a) Make `Notification.record(message, type)` the first statement of `static show(...)` ([Notification.ts:214](src/typescript/lib/overlay/Notification.ts#L214)), before `const n = new Notification(...)`. (b) Extract the body of the private `openDetail()` ([Notification.ts:429](src/typescript/lib/overlay/Notification.ts#L429)) into a new `static showDetail(message: string, type: NotificationType): void`, replacing `this._fullMessage` → `message` and `this._type` → `type`; leave `openDetail()` as the one-line delegate `Notification.showDetail(this._fullMessage, this._type)` (see *Internal Structure*). → verify: `npx tsc --noEmit` clean; double-clicking a live toast still opens its detail dialog.

4. **Create `src/typescript/lib/overlay/NotificationHistoryButton.ts`.** Add the SPDX header. Import `Button` and `ButtonOptions` from `~/component/button/Button.js`, `Menu` from `~/overlay/Menu.js`, `MenuItemConfig` from `~/component/container/MenuItem.js`, `Notification` and `BADGE_GLYPH` from `~/overlay/Notification.js`, `Glyph` from `~/component/display/Glyph.js`, `clock_rotate_left` from `~/glyphs/solid/clock_rotate_left.js`, `DOM` from `~/core/DOM.js`, and `callable` from `~/core/Callable.js`. Call `Glyph.register(clock_rotate_left)` at module top (mirrors [Notification.ts:21](src/typescript/lib/overlay/Notification.ts#L21)). Define the `MINUTE_MS`/`HOUR_MS`/`DAY_MS` constants and `formatRelativeTime`, the empty `NotificationHistoryButtonOptions extends ButtonOptions` interface, and the `NotificationHistoryButton extends Button<NotificationHistoryButtonOptions>` class with `buildItems`, `toggleMenu`, and a named `_boundToggleMenu` field (see *Internal Structure*). In the constructor, call `super({ glyph: "clock-rotate-left", ...options })` so a consumer `glyph` overrides the default, set `this.getAria().setLabel("Notification history")`, and wire `this.on("action", this._boundToggleMenu)`. Wrap with `callable()` and export as `_NotificationHistoryButton` (raw) + `NotificationHistoryButton` (callable) per the `callable()` convention. Add a class JSDoc with `@category Components` and a usage `@example`. → verify: `npx tsc --noEmit` clean.

5. **Export from the overlay barrel.** In `src/typescript/lib/overlay/index.ts`, after the `Notification` exports ([overlay/index.ts near the `Notification` line]), add `export { NotificationHistoryButton } from '~/overlay/NotificationHistoryButton.js';`, `export type { NotificationHistoryButtonOptions } from '~/overlay/NotificationHistoryButton.js';`, and add `NotificationRecord` to the existing `export type { NotificationType } from '~/overlay/Notification.js';` line. → verify: `grep -n "NotificationHistoryButton\|NotificationRecord" src/typescript/lib/overlay/index.ts`.

6. **Wire the demo.** In `src/typescript/MiscPanel.ts`, add `NotificationHistoryButton` to the import from the overlay barrel (near the `Notification` import at line 21), and after `buttonNotificationStack` is added to `leftColumn` ([MiscPanel.ts:1013](src/typescript/MiscPanel.ts#L1013)) add `leftColumn.addComponent(new NotificationHistoryButton());`. → verify: `npx tsc --noEmit` clean; app boots.

7. **Add the doc page.** Create `docs/components/NotificationHistoryButton.md` following the shape of `docs/components/Notification.md` — intro linking `[\`NotificationHistoryButton\`](/api/overlay/classes/NotificationHistoryButton)`, a `## Usage` block, and a `## Behavior` list (opens a menu of recent notifications newest-first; each row shows the severity badge, message, and relative time; clicking a row opens the full message in a modal detail dialog — the same dialog a live toast opens on double-click — and does not re-show or re-record; empty state; 50-entry cap). Cross-link `Notification` as `[\`Notification\`](/api/overlay/classes/Notification)` (different symbol, same bucket — a bare `{@link}` is fine, but the existing pages use the markdown API-link form).

8. **Register the doc page in the sidebar + catalog.** In `docs/.vitepress/config.mts`, add `{ text: 'NotificationHistoryButton', link: '/components/NotificationHistoryButton' }` to the Core components group (after the `Notification` entry, [config.mts:75](docs/.vitepress/config.mts#L75)). Add a matching row to the components catalog in `docs/components/index.md`.

9. **Add the llms.txt manifest entry.** In `scripts/llms/manifest.data.mjs`, add `{ task: "Browse / re-show past notifications", symbol: "NotificationHistoryButton" }` to the `Overlays` group ([manifest.data.mjs:97](scripts/llms/manifest.data.mjs#L97), after the `Notification` entry). Do **not** hand-edit `llms.txt` — it is generated. Regenerate per the docs build. → verify: after build, `grep -n "NotificationHistoryButton" llms.txt`.

10. **Extend the notifications recipe (optional but recommended).** Add a short "Reviewing past notifications" section to `docs/recipes/notifications.md` showing `new NotificationHistoryButton()` placed in a toolbar.

11. **Register the default-options-fallback row.** Because the button defaults `glyph`, add a row for `NotificationHistoryButton`'s `glyph` default to `tests/component/default-options-fallback.test.ts` per the ARCHITECTURE.md "Class-level defaults must survive the getter" registry rule. Confirm the default is applied via the always-dispatch-through-`super()` form (the constructor passes `glyph` into `super(...)`, so `Button`'s own `applyOptions` handles it — verify `new NotificationHistoryButton().getGlyph()` returns `"clock-rotate-left"`).

12. **Full verification pass.** `npx tsc --noEmit`; `npm test`; `npm run docs:build` (0 errors, 0 link warnings). Manual smoke per *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/overlay/NotificationHistoryButton.ts` |
| Create | `docs/components/NotificationHistoryButton.md` |
| Modify | `src/typescript/lib/overlay/Notification.ts` (record type, ring buffer, `getHistory`, capture in `show`, export `BADGE_GLYPH`) |
| Modify | `src/typescript/lib/overlay/index.ts` (barrel exports) |
| Modify | `src/typescript/MiscPanel.ts` (demo button) |
| Modify | `docs/.vitepress/config.mts` (sidebar) |
| Modify | `docs/components/index.md` (catalog) |
| Modify | `scripts/llms/manifest.data.mjs` (manifest entry) |
| Modify | `docs/recipes/notifications.md` (recipe section) |
| Modify | `tests/component/default-options-fallback.test.ts` (glyph-default row) |

---

## Expected Behaviour

Unit-testable (offline harness):

- **Capture appends one record per `show()`.** After `Notification.show("a", "success")`, `Notification.getHistory()` has length 1 with `{ message: "a", type: "success" }` and a `timestamp` close to `Date.now()`.
- **Ordering is oldest-first in storage.** Two shows `"a"` then `"b"` yield `getHistory()[0].message === "a"`, `[1].message === "b"`.
- **Full message is captured, not the clamped display text.** A long multi-line message is stored verbatim in `record.message`.
- **Cap evicts oldest.** After 51 shows, `getHistory().length === 50` and the first message is the 2nd shown (index-1), not the 1st.
- **`getHistory()` returns a copy.** Mutating the returned array does not change subsequent `getHistory()` results.
- **Browsing does not record.** Building the menu (`buildItems()`) and, conceptually, clicking a row (which calls `Notification.showDetail`, not `Notification.show`) leave `getHistory().length` unchanged — only `show()` appends. Assert `showDetail` is not routed through `record()` (e.g. call `Notification.showDetail("x", "info")` if the offline harness can construct the dialog, then assert history length unchanged; otherwise cover the "menu action calls `showDetail`" wiring via the `buildItems()` field-mapping test and verify the no-record property manually).
- **`formatRelativeTime` boundaries** (export the helper for the test *or* test through the built menu configs): 0ms → `"just now"`; 59s → `"just now"`; 60s → `"1m ago"`; 90min → `"1h ago"`; 25h → `"1d ago"`. *(If keeping the helper module-private per the decision, cover it via `buildItems()` output instead of exporting it.)*
- **`buildItems()` empty state.** With empty history, `buildItems()` returns exactly one item `{ text: "No notifications yet", enabled: false }`.
- **`buildItems()` newest-first.** With history `["a","b"]`, `buildItems()[0].text === "b"`.
- **`buildItems()` maps fields.** Each item's `glyph === BADGE_GLYPH[type]`, `text === message`, `shortcut` is a relative-time string, and `action` is a function.
- **Default glyph.** `new NotificationHistoryButton().getGlyph() === "clock-rotate-left"`; `new NotificationHistoryButton({ glyph: "bell" }).getGlyph() === "bell"`.

Manual-verify (UI / events / geometry — not exercisable offline):

- Clicking the button opens a menu anchored under its bottom-left; a second click closes it; an outside click / Escape dismisses it.
- Menu rows show badge glyph + message + right-aligned relative time; long messages ellipsize; an over-tall list scrolls.
- Clicking a row opens the modal detail dialog with the full message and severity-tinted title (identical to double-clicking a live toast), closes the menu, and adds no new history entry.
- Double-clicking a live toast still opens its detail dialog (the `openDetail` → `showDetail` refactor is behaviour-preserving).
- Menu content reflects newly-shown toasts each time it is reopened (relative times update).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — clean.
- **Unit tests:** `npm test` — the *Expected Behaviour* unit cases pass (history capture/ordering/cap/copy, `buildItems` mapping/empty/order, default glyph). Add them under `tests/` mirroring existing overlay/component test locations.
- **Grep invariants:** `grep -n "export const BADGE_GLYPH" src/typescript/lib/overlay/Notification.ts`; `grep -n "NotificationHistoryButton" src/typescript/lib/overlay/index.ts`; after docs build `grep -n "NotificationHistoryButton" llms.txt`.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (only the "unsupported TypeScript version" notice is acceptable). Confirm `docs/api/overlay/classes/NotificationHistoryButton.md` is generated (callable-plugin promotion) rather than landing under `variables/`.
- **Manual smoke:** run the app (`npm run dev`, http://localhost:8015), open the MiscPanel demo, click the notification buttons, then click the history button and verify the manual-verify behaviours above.

---

## Documentation Impact

- **New exported symbols:** `NotificationHistoryButton` (+ `NotificationHistoryButtonOptions`) and `NotificationRecord`, all re-exported from the `overlay` barrel (`src/typescript/lib/overlay/index.ts`). `NotificationHistoryButton` carries `@category Components`; `NotificationRecord` carries `@category Core` (matching `NotificationType`).
- **New public method on an existing class:** `Notification.getHistory()` and `Notification.showDetail()` gain JSDoc and appear on the existing `Notification` API page automatically — no new page, but the `docs/components/Notification.md` "Behavior" prose should mention that history is captured and that `showDetail` opens the detail dialog.
- **Doc page:** `docs/components/NotificationHistoryButton.md`, linked in `docs/.vitepress/config.mts` (Core group, after `Notification`) and listed in `docs/components/index.md`.
- **Manifest:** new `Overlays` entry in `scripts/llms/manifest.data.mjs` (never edit `llms.txt` directly — it is generated from the manifest + TypeDoc model).
- **Recipe:** a "Reviewing past notifications" section in `docs/recipes/notifications.md`.
- **JSDoc link forms:** `NotificationHistoryButton` referencing `Notification` / `NotificationType` / `NotificationRecord` is same-bucket (`overlay`) so `{@link Notification}` resolves; the existing pages use the markdown API-link form for consistency. Do not `{@link}` the module-private `BADGE_GLYPH`, `formatRelativeTime`, or the `Menu` internals from public JSDoc — describe them in prose (per CODE_CONVENTIONS.md "Don't `{@link}` internal symbols").
- **Callable-plugin contract:** export form must be `export { NotificationHistoryButtonCallable as NotificationHistoryButton }` with `const NotificationHistoryButtonCallable = callable(NotificationHistoryButton)` over a real `class`, so the API page is promoted to `classes/`.

---

## Potential Challenges

- **Import cycle if the button is placed in `component/button`.** Mitigation: the file lives in `overlay/` (see decision), so the button barrel never pulls in `overlay`.
- **`BADGE_GLYPH` duplication.** Mitigation: export the existing map from `Notification.ts` and import it; do not redefine the `type → glyph` mapping.
- **Glyph not registered.** The button must `Glyph.register(clock_rotate_left)` at module load, exactly as `Notification.ts` registers its badge glyphs, or the trigger renders blank.
- **Default-glyph getter trap.** Mitigation: pass `glyph` through `super(options)` so `Button.applyOptions` dispatches it (always-dispatch path), and add the default-resolution registry row — otherwise `getHistory`-style default-drop is invisible to offline tests.
- **Anchor rect on an unattached button.** Mitigation: `toggleMenu` early-returns when `getElement()` is null (mirrors `SplitButton`), so the menu only opens once the button is in the DOM.

---

## Critical Files

- [src/typescript/lib/overlay/Notification.ts](src/typescript/lib/overlay/Notification.ts) — capture point (`show`), `BADGE_GLYPH`, `_fullMessage`, glyph-registration pattern, `Date.now()` precedent.
- [src/typescript/lib/component/button/SplitButton.ts](src/typescript/lib/component/button/SplitButton.ts) — the toggle-a-rebuild-mode-`Menu`-anchored-under-a-button pattern (`_toggleMenu`, `DOM.source.getViewportRect(this)`, `toggleFor`), and the `callable()` + options-interface shape for a `Button` subclass.
- [src/typescript/lib/overlay/Menu.ts](src/typescript/lib/overlay/Menu.ts) — `toggleFor` / `show` semantics, auto-hide-on-action, height clamp/scroll.
- [src/typescript/lib/component/container/MenuItem.ts](src/typescript/lib/component/container/MenuItem.ts) — `MenuItemConfig` fields (`text`, `glyph`, `shortcut`, `action`, `enabled`).
- [src/typescript/lib/component/button/Button.ts](src/typescript/lib/component/button/Button.ts) — `ButtonOptions`, generic `Button<TOptions>`, `glyph` option, `getGlyph`.
- [src/typescript/lib/overlay/index.ts](src/typescript/lib/overlay/index.ts) — export surface to extend.
- [scripts/llms/manifest.data.mjs](scripts/llms/manifest.data.mjs) — the only hand-edited manifest seam.
- [tests/component/default-options-fallback.test.ts](tests/component/default-options-fallback.test.ts) — the default-resolution registry the glyph default must join.

---

## Non-Goals

- **Cross-session persistence** (localStorage / server). History is in-session only; out of scope and unrequested.
- **A change/`on("historychange")` event.** The menu rebuilds its items on each open, so it always reflects current state without a subscription surface.
- **Clearing / deleting history entries.** No delete UI was requested; the ring buffer's cap is the only eviction.
- **Configurable cap or a `historyLimit` option.** Fixed at 50 per the simplicity rule; add configurability only if a consumer need arises.
