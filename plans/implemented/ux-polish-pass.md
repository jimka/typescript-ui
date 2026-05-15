# UX Polish Pass — Glyph Gaps, Vertical Centering, Notification UX, Dismiss Animations — Implementation Plan

## Overview

A second-pass UX cleanup after the original Glyph adoption landed. Three groups of work, kept in a single plan because the registry-expansion step is shared and the smaller fixes are too small to track independently:

1. **Glyph adoption gaps** — sites that should already use a `Glyph` but don't, plus a default title icon for windows. Affects [NumberSpinner.ts](../src/typescript/lib/component/input/NumberSpinner.ts), [SpinButton.ts](../src/typescript/lib/component/input/SpinButton.ts), [PaginationBar.ts](../src/typescript/lib/component/display/PaginationBar.ts), [TablePanel.ts](../src/typescript/lib/component/table/TablePanel.ts), [Notification.ts](../src/typescript/lib/core/Notification.ts), [Dialog.ts](../src/typescript/lib/core/Dialog.ts), [Window.ts](../src/typescript/lib/core/Window.ts), and [MenuBarPanel.ts](../src/typescript/MenuBarPanel.ts).
2. **Vertical text centering** — a recurring symptom across [MenuBarButton.ts:188-196](../src/typescript/lib/component/menubar/MenuBarButton.ts#L188-L196) and [Dialog.ts:127-148](../src/typescript/lib/core/Dialog.ts#L127-L148) where text sits at the top of a fixed-height inline box. The "View" menu clip in [MenuBarPanel.ts:69](../src/typescript/MenuBarPanel.ts#L69) is a parallel preferred-size bug.
3. **Notification UX + dismiss animations** — clamp + ellipsis on overflow, double-click → detail dialog, pause-while-modal-open, slide-right-fade dismiss for notifications, fade-only dismiss for dialogs.

The `ProgressSpinner` question is resolved as a non-goal — current CSS-keyframes implementation stays.

---

## Architecture Decisions

### Registry expansion — one batch, no per-call-site registration

Every new glyph needed by this pass is added to [Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts) in a single pass at the start. New entries are SVG where the icon must scale crisply (toolbar buttons, notification badges) and Unicode where the prior code already used a character and a stylistic upgrade is not required (`▲`/`▼` in `SpinButton`). The SVG paths are sourced from Font Awesome Free (CC BY 4.0), which the existing `times` entry already comes from — the licence header at the top of `Glyphs.ts` already covers this and the [NOTICE](../NOTICE) file is the audit trail.

New entries:

| Name              | Kind | Purpose / call site                                                  |
|-------------------|------|----------------------------------------------------------------------|
| `chevron-up`      | svg  | `SpinButton` up arrow (replaces `▲`)                                 |
| `chevron-down`    | svg  | `SpinButton` down arrow (replaces `▼`)                               |
| `plus`            | svg  | `TablePanel` add row toolbar button (replaces `"+"`)                 |
| `minus`           | svg  | `TablePanel` remove row toolbar button (replaces `"−"`)              |
| `sync`            | svg  | `TablePanel` sync toolbar button                                     |
| `ban`             | svg  | `TablePanel` reject toolbar button                                   |
| `angle-left`      | svg  | `PaginationBar` previous-page                                        |
| `angle-right`     | svg  | `PaginationBar` next-page                                            |
| `angles-left`     | svg  | `PaginationBar` first-page                                           |
| `angles-right`    | svg  | `PaginationBar` last-page                                            |
| `info-circle`     | svg  | `Notification` `info` badge, `MenuBarPanel` `Help` icon              |
| `check-circle`    | svg  | `Notification` `success` badge                                       |
| `triangle-exclamation` | svg | `Notification` `warning` badge                                  |
| `circle-exclamation` | svg | `Notification` `error` badge                                      |
| `window`          | svg  | Default `WindowHeader` title icon                                    |
| `file`            | svg  | `MenuBarPanel` `File` menu                                           |
| `pen-to-square`   | svg  | `MenuBarPanel` `Edit` menu                                           |
| `eye`             | svg  | `MenuBarPanel` `View` menu                                           |

`MenuBarPanel.ts` lives in the **demo** tree, not in the library, so the `File`/`Edit`/`View`/`Help` glyphs are not strictly required by the library's public surface. Add them anyway: the curated registry is small enough that a handful of common menu icons are worth carrying so demos and downstream consumers don't reinvent them.

### Vertical centring uses `line-height = container height`, encapsulated in `Text`

Every existing site that gets text right (`MenuItem`, `SpinButton`'s text, `Dialog`'s close icon) sets `setElementCSSRule("lineHeight", H + "px")` where `H` is the container height. Sites that get it wrong (`MenuBarButton._text`, `Dialog.titleText`) simply forget to. The plan adds a single helper on `Text` and migrates the two broken sites to it:

```typescript
class Text extends Component {
    /**
     * Sets line-height equal to the given pixel height, so a single-line text
     * sits vertically centred in a fixed-height inline box. Pass `null` to
     * revert to the theme's line-height multiplier.
     */
    centerInHeight(px: number | null): this;
}
```

Rationale for putting it on `Text` rather than on `Component`: only `Text` has the visual concept of a baseline that needs centring. The helper is a one-liner over `setLineHeight`, but giving it a name makes the call sites self-documenting and lets future sites discover it from autocomplete. Sites that already set `lineHeight` explicitly (`MenuItem`, `SpinButton`, `Dialog.closeIcon`) can migrate opportunistically; this plan only migrates the broken ones.

### `MenuBarButton` preferred width comes from the measured `Text`, not `length * 7`

[MenuBarButton.ts:206](../src/typescript/lib/component/menubar/MenuBarButton.ts#L206) hard-codes `label.length * 7 + HORIZONTAL_PAD * 2`. "V" and "w" are wider than 7px at the theme's 12px font size, so "View" (4 chars → 48px) lands just short, the inner `Text` element receives `width: 28px`, and the rendered glyph spills over the right padding — but the inner Text in `MenuBarButton` also has `whiteSpace: nowrap`, so the spill is what the user sees as a clipped end.

The inner `_text: Text` already auto-measures itself ([Text.ts:231-253](../src/typescript/lib/component/input/Text.ts#L231-L253)). `recomputePreferredSize` should read `_text.getPreferredSize()` and add `HORIZONTAL_PAD * 2` (plus glyph width when present). The seven-px estimate goes away.

### Notification text wraps with a line cap

[Notification.ts:76-79](../src/typescript/lib/core/Notification.ts#L76-L79) already sets `whiteSpace: normal` and `wordBreak: break-word`, so the text wraps — but the notification height is fixed at 64px and `overflow: hidden` clips anything past two lines. Use `-webkit-line-clamp` on the message `Text` with a cap of 2 lines, plus `display: -webkit-box` and `-webkit-box-orient: vertical`, so the third+ lines are truncated with an automatic ellipsis. Webkit-prefixed line clamping is now the cross-browser standard (Chrome, Edge, Safari, Firefox 68+) — see the documentation footnote in `Notification.ts` itself. Full content is reachable via the new double-click detail dialog (next decision).

### Notification double-click opens a `Dialog`-based detail view

A double-click on the notification body opens a modal dialog through the existing [`Dialog.show`](../src/typescript/lib/core/Dialog.ts) API. The dialog shows:

- The notification's full (un-truncated) message text.
- A header glyph matching the notification type (info/success/warning/error).
- A header colour tint that matches the notification's border colour (re-using the `--ts-ui-notification-<type>-border` token in the title bar's background or text colour — see the Theme Tokens section).

No new dialog subclass is introduced — the existing `Dialog.show` already supports a `contentComponent` and a `title`. A small private helper on `Notification` constructs the config and calls `Dialog.show`. Pop into the new title-glyph slot already introduced by [glyph-adoption.md](implemented/glyph-adoption.md) so the dialog header carries the same icon as the notification badge.

### "Modal open" pauses every active notification timer

`Notification` keeps a static `activeNotifications` array. Add a static `modalOpen` flag and two static helpers `pauseAll()` / `resumeAll()`. When any notification opens its detail dialog, it calls `pauseAll()`; the dialog's resolution path calls `resumeAll()`. `resumeAll()` bumps the remaining duration of each timer to `Math.max(remaining, MIN_RESUMED_MS)` (8000ms) so the user has time to read other notifications after dismissing the dialog. The existing pause-on-hover logic continues to work — `pauseTimer`/`resumeTimer` already exist and are idempotent.

This deliberately scopes "what counts as a modal" to the detail dialog. A `Dialog.show` opened by user code does **not** pause notifications — the framework has no way to know the user wants that behaviour, and tying it to `Dialog` lifecycle would couple two otherwise-independent subsystems. If a future use case wants notification-pause for arbitrary dialogs, expose a public `Notification.pauseAll()`/`resumeAll()` API (already added internally) and let the caller wrap their `Dialog.show`.

### Dismiss animations: notifications slide-right + fade; dialogs fade-only

Both animations run via CSS transitions on `transform` + `opacity` against the existing element, with DOM removal scheduled in a `transitionend` listener (with a fallback `setTimeout` matching the duration in case the transition is interrupted by a tab switch).

- **Notification dismissal**: 200ms `transform: translateX(100%)` + `opacity: 0`. The element keeps its fixed position; the translate keeps the spinning notification from overlapping its neighbour by also restacking immediately. Restack runs on `transitionend`.
- **Dialog dismissal**: 150ms `opacity: 0` + `transform: scale(0.97)`. The backdrop fades in the same window.

No animation on appearance for this pass (out of scope — only dismissal was called out). Notifications already snap into place; dialogs already snap centred. Adding entrance animations is a separate cosmetic decision.

`prefers-reduced-motion: reduce` skips the transition and removes the element synchronously — match what the rest of the library already does for accessibility. Confirm during implementation that the existing codebase does honour this; if not, this plan adds it locally for these two sites and leaves the broader question of a framework-wide motion-respect policy for a follow-up.

### Coloured notification dialog header

The detail-dialog title bar normally renders with `--ts-ui-body-bg`. For the notification detail dialog only, paint the title bar's background or text colour using the type-specific notification token. This requires no new theme token: it reuses `--ts-ui-notification-<type>-bg` for a subtle tint and `--ts-ui-notification-<type>-border` for the title-text foreground colour. Pass these as inline overrides on the constructed dialog rather than mutating the shared `DialogTitleBar` class — keeps the styling local to the notification-detail call site.

### `ProgressSpinner` is **not** converted to a Glyph

Confirmed non-goal. Reasoning:

- The CSS-keyframes-on-a-bordered-`<div>` implementation is already minimal and theme-aware.
- The overlay path ([ProgressSpinner.ts:173-193](../src/typescript/lib/component/display/ProgressSpinner.ts#L173-L193)) does work the glyph registry doesn't model — semi-transparent backdrop, target-matching size.
- The registry is a static-icon registry; mixing in animated entries would force every glyph site to consider whether its glyph might animate.

---

## Public API (TypeScript Signatures)

### `Text` — `src/typescript/lib/component/input/Text.ts`

```typescript
class Text extends Component {
    /**
     * Sets line-height equal to the given pixel height, so a single-line text
     * sits vertically centred in a fixed-height inline box. Pass `null` to
     * revert to the theme's line-height multiplier.
     */
    centerInHeight(px: number | null): this;
    // ...existing methods unchanged
}
```

### `Notification` — `src/typescript/lib/core/Notification.ts`

```typescript
class Notification extends Component {
    /** Pauses the auto-dismiss timer of every currently visible notification. */
    static pauseAll(): void;

    /**
     * Resumes paused timers. Each timer is restarted with at least
     * `MIN_RESUMED_MS` (8000ms) of remaining duration, so the user has time
     * to read the stack after a modal dismissal.
     */
    static resumeAll(): void;
    // ...existing static show() unchanged
}
```

No new public construction-time options. Double-click-to-detail and dismiss animation are internal.

### `Window` / `WindowHeader`

No signature changes. `Window` opts the default-icon in via its `WindowHeader` construction — when `options.glyph` is `undefined`, `WindowHeader` defaults to `"window"` (a sentinel registry entry, see registry expansion). When `options.glyph` is explicitly `null`, no glyph renders.

```typescript
// behaviour change only — same signature
constructor(text: string, options?: WindowHeaderOptions);
```

### Dialog and PaginationBar and TablePanel

No public API additions. Internal toolbar / pagination buttons are migrated from text-only labels to `Button({ glyph: "..." })` via the existing options bag introduced by [glyph-adoption.md](implemented/glyph-adoption.md).

The Dialog close button stops being a `Text("×")` and becomes a `Button({ glyph: "times" })` — the `Button` class already paints a glyph and already supports click. The bespoke `Text`-based close icon is removed.

---

## Theme Tokens

No new theme tokens are introduced.

- Notification type colours (`--ts-ui-notification-<type>-bg` / `-border`) already exist and are reused for the detail-dialog header tint and the badge `Glyph` colour.
- Animation timings live as constants in the consuming files; if they need to be themeable later, add tokens at that point.
- Coloured glyphs follow `currentColor`; foreground tinting at notification badge sites is done by setting `setForegroundColor("var(--ts-ui-notification-<type>-border)")` on the badge `Glyph`, no token change required.

---

## Internal Structure

### Notification layout after this pass

```
Notification (320×64, fixed)
├─ Glyph (badge, 20×20, foreground = --ts-ui-notification-<type>-border)
├─ Text  (message, line-clamp:2, ellipsis)
└─ Glyph (times close, 20×20)
```

The existing `messageText.setElementCSSRule("whiteSpace", "normal")` stays. New CSS rules on the message:

```
display:         -webkit-box
-webkit-box-orient: vertical
-webkit-line-clamp: 2
overflow:        hidden
text-overflow:   ellipsis
```

### Detail dialog construction

```typescript
private openDetail(): void {
    Notification.pauseAll();

    const content = new Text(this.fullMessage);
    content.setElementCSSRule("whiteSpace", "pre-wrap");
    content.setPadding(new Insets(16, 16, 16, 16));

    Dialog.show({
        title:            this.titleForType(),    // "Information", "Success", ...
        contentComponent: content,
        buttons:          [{ text: 'Close', result: 'close', primary: true }],
        // tint via post-construction inline styles on the returned dialog's
        // title bar — see Step 10.
    }).then(() => {
        Notification.resumeAll();
    });
}
```

Note: `Dialog.show` returns a promise but constructs and shows the dialog synchronously. The plan exposes `Dialog.show` as the public API but accesses the constructed dialog's title bar internally inside `Notification` only — done by replacing the `Dialog.show` call with `new Dialog(config)` + manual `show()` so the caller has the instance to tint. Equivalent ergonomics, exposes the same promise.

---

## Ordered Implementation Steps

Each step compiles and renders correctly on its own, so the plan can be reviewed (and reverted) at any step boundary.

### Step 1 — Expand the Glyph registry

[Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts):

- Add the new entries listed in the Architecture Decisions table.
- Source SVG paths from Font Awesome Free's Solid set. Note in the file header (already there for `times`) that the new icons come from the same set.
- For each new SVG entry, capture `viewBox` and the `<path d="...">` string verbatim into a registry entry.

Verify:

```
npm run typecheck
```

Then in a one-off scratch render: `new Glyph("plus")`, `new Glyph("sync")`, etc. — each renders without throwing.

### Step 2 — Add `Text#centerInHeight`

[Text.ts](../src/typescript/lib/component/input/Text.ts):

```typescript
centerInHeight(px: number | null): this {
    if (px === null) {
        return this.setLineHeight("--ts-ui-line-height");
    }
    return this.setLineHeight(px);
}
```

One-line wrapper; the existing `setLineHeight` already handles both number-px and CSS-var forms.

Verify: typecheck passes.

### Step 3 — Fix MenuBarButton vertical centring + measured preferred width

[MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts):

**3a — Centering.** In the constructor after `this._text = new Text(text);`, add:

```typescript
this._text.centerInHeight(28);
```

Mirrors what [MenuItem.ts:175](../src/typescript/lib/component/container/MenuItem.ts#L175) already does. The constant `28` matches the button's existing fixed height (`setPreferredSize(width, 28)`).

**3b — Preferred width.** Replace `recomputePreferredSize`:

```typescript
private recomputePreferredSize(): void {
    const textWidth = this._text.getPreferredSize()?.width ?? this._label.length * 7;
    let width       = textWidth + HORIZONTAL_PAD * 2;

    if (this._glyph) {
        const glyphSize = this._glyph.getPreferredSize() ?? { width: 16, height: 16 };
        width += glyphSize.width + GLYPH_TEXT_GAP;
    }

    this.setPreferredSize(width, 28);
}
```

The `length * 7` fallback covers the rare case where the off-screen probe has not run yet at construction time; in practice `Text` measures itself during its own constructor before `MenuBarButton` reads from it, so the fallback rarely fires.

Verify: in the dev server, open the MenuBar demo. `View` is no longer clipped. Every menu label is vertically centred in its 28px box.

### Step 4 — Fix Dialog title-bar vertical centring + glyph close button

[Dialog.ts](../src/typescript/lib/core/Dialog.ts) `DialogTitleBar`:

**4a — Centering.** Add `this.titleText.centerInHeight(TITLE_HEIGHT - 8);` after the title text is constructed (matching the height it gets at layout time).

**4b — Close glyph.** Replace the `Text("×")`-based close icon with a `Button` rendering the existing `times` glyph:

```typescript
this.closeButton = new Button(undefined, { glyph: "times" });
this.closeButton.setBorder();
this.closeButton.setBackgroundImage(null);
this.closeButton.setShadow(null);
this.closeButton.setPressedShadow(null);
this.closeButton.setPreferredSize(CLOSE_SIZE, CLOSE_SIZE);
this.addComponent(this.closeButton);
Event.addListener(this.closeButton, "click", onClose);
```

Removes the bespoke `Text("×")` + manual cursor/lineHeight CSS. The doLayout method now positions `closeButton` instead of `closeIcon`.

Verify: dialog title text is vertically centred; close button renders the SVG times glyph; clicking it still fires `onClose`. The existing demo dialogs (Misc panel) all still work.

### Step 5 — Migrate NumberSpinner `▲`/`▼` to `chevron-up`/`chevron-down`

Two paths:

**Option A (recommended):** `SpinButton` continues to receive a symbol but the symbol becomes a glyph name. Update [SpinButton.ts:37](../src/typescript/lib/component/input/SpinButton.ts#L37) so the constructor takes a glyph name (`"chevron-up" | "chevron-down"`) instead of a `"▲" | "▼"` character, and renders a `Glyph` child instead of relying on Button's text. Update [NumberSpinner.ts:70-71](../src/typescript/lib/component/input/NumberSpinner.ts#L70-L71) callers to pass the glyph name.

**Option B (simpler if A's surface is too noisy):** keep `SpinButton`'s public constructor signature, change its internal `super(symbol)` to `super(undefined, { glyph: symbolToGlyphName(symbol) })` so the Button slot's glyph slot is used and the text slot is empty. Either way the rendered control swaps Unicode arrows for SVG glyphs.

Pick during implementation by reading `SpinButton.ts` end-to-end. Both honour the existing `setFontSize(9)`/`setLineHeight(9)` calls, which become no-ops since the glyph slot is used instead of the text slot. Remove those lines if Option A is chosen.

Verify: the NumberSpinner up/down arrows are crisp SVG; click + click-and-hold still increment/decrement.

### Step 6 — Add glyphs to TablePanel toolbar buttons

[TablePanel.ts:40-54](../src/typescript/lib/component/table/TablePanel.ts#L40-L54):

```typescript
const addBtn   = new Button(undefined, { glyph: "plus"  });
const removeBtn = new Button(undefined, { glyph: "minus" });
this.syncBtn   = new Button(undefined, { glyph: "sync"  });
this.rejectBtn = new Button(undefined, { glyph: "ban"   });
```

Drop the text labels (`"+"`, `"−"`, `"Sync"`, `"Reject"`) entirely — the glyph carries the meaning. Add `Tooltip.attach(addBtn, "Add row")` for each so screen readers and hover-discovery still work; if `Tooltip.attach` is not yet wired here, check [Tooltip.ts](../src/typescript/lib/core/Tooltip.ts) for the API. The buttons need to remain narrow — `Button` defaults aside, set `setPreferredSize(28, 28)` if the glyph-only width comes out wider than wanted.

Verify: the paginated-table demo (`Show window with paginated table!`) shows a toolbar with `+ − sync ban` glyphs, hover tooltips describe them, and clicking each still does what it did before.

### Step 7 — Add glyphs to PaginationBar buttons

[PaginationBar.ts:75-79](../src/typescript/lib/component/display/PaginationBar.ts#L75-L79):

```typescript
this.firstBtn = new Button(undefined, { glyph: "angles-left"  });
this.prevBtn  = new Button(undefined, { glyph: "angle-left"   });
this.nextBtn  = new Button(undefined, { glyph: "angle-right"  });
this.lastBtn  = new Button(undefined, { glyph: "angles-right" });
```

Verify: the paginated-table demo shows glyph pagination buttons instead of `<< < > >>`. Disabled states render at correct opacity.

### Step 8 — Default `Window` title icon

[WindowHeader.ts:65](../src/typescript/lib/component/container/WindowHeader.ts#L65) currently only sets the close button glyph. Extend the constructor so when `options?.glyph` is `undefined` (not explicitly `null`), the title icon defaults to `"window"`:

```typescript
const defaultGlyph: string | null = options?.glyph === undefined
    ? "window"
    : options.glyph;
if (defaultGlyph) {
    this.setGlyph(defaultGlyph);
}
```

Watch out: `options.glyph` could be explicitly `null` in caller code (meaning "no icon"). The triple-check `=== undefined` distinguishes that case from `not supplied`. The existing `applyOptions` path also passes `options.glyph` through, so make sure the default does not fight `applyOptions` when both run — easiest is to set `_titleGlyph` directly in the constructor before calling `applyOptions`, then let `applyOptions` skip the call when `options.glyph === undefined`.

Verify: every `new Window("…")` (no options) renders a window glyph west of the title. Passing `{ glyph: null }` renders no icon; passing `{ glyph: "file" }` renders the file glyph.

### Step 9 — Notification badge glyph + wrap-with-ellipsis

[Notification.ts](../src/typescript/lib/core/Notification.ts):

**9a — Badge glyph.** In the constructor, before adding `messageText`, construct a leading badge:

```typescript
const badgeName: Record<NotificationType, string> = {
    info:    "info-circle",
    success: "check-circle",
    warning: "triangle-exclamation",
    error:   "circle-exclamation",
};
const badge = new Glyph(badgeName[type]);
badge.setForegroundColor(`var(--ts-ui-notification-${type}-border)`);
badge.setPreferredSize(20, 20);
this.badge = badge;
this.addComponent(badge);
```

Adjust `doLayout` to lay badge at `(H_PADDING, V_PADDING + 2)` with size 20×20, and bump the message's `x` to `H_PADDING + 20 + 8` to leave room.

**9b — Line clamp.** Replace the existing `whiteSpace: normal` / `wordBreak: break-word` calls with the line-clamp rule block (see Internal Structure). Two lines fit comfortably in 64 - 2×10 = 44px at the theme's 14px line-height; if line-height changes, the box can show 2 or 3 lines depending — the clamp still bites at 2.

Verify: dev server. Show short / medium / long notifications. Short ones look the same as today. Long ones show two lines with an ellipsis at the end of the second.

### Step 10 — Notification double-click → typed detail dialog

[Notification.ts](../src/typescript/lib/core/Notification.ts):

Add a private field `fullMessage: string` (set in the constructor from `message`) so the detail dialog renders the full content even when the badge-tinted line-clamp eats the visible copy.

Wire double-click in the constructor:

```typescript
Event.addListener(this, "dblclick", () => this.openDetail());
```

Implement `openDetail()`:

```typescript
private openDetail(): void {
    Notification.pauseAll();

    const titleByType: Record<NotificationType, string> = {
        info: "Information", success: "Success", warning: "Warning", error: "Error",
    };
    const headerGlyph = (new Notification as any).badgeName[this.type]; // see Step 9
    const content = new Text(this.fullMessage);
    content.setElementCSSRule("whiteSpace", "pre-wrap");
    content.setPadding(new Insets(16, 16, 16, 16));

    const dialog = new (_Dialog)({
        title:            titleByType[this.type],
        contentComponent: content,
        buttons:          [{ text: 'Close', result: 'close', primary: true }],
    });

    // Tint the title bar in this type's colours.
    const titleEl = dialog.getTitleBar().getElement(true);
    titleEl.style.backgroundColor = `var(--ts-ui-notification-${this.type}-bg)`;
    dialog.getTitleBar().getText()
        .setForegroundColor(`var(--ts-ui-notification-${this.type}-border)`);
    dialog.getTitleBar().setGlyph(headerGlyph);   // add this slot in 10b

    dialog.show().then(() => Notification.resumeAll());
}
```

**10a** — Expose `Dialog.getTitleBar(): DialogTitleBar` and `DialogTitleBar.getText()` so the notification path can tint without poking at private fields. Keep `DialogTitleBar` itself unexported.

**10b** — Add an optional title glyph to `DialogTitleBar` (mirroring the `WindowHeader` pattern): `setGlyph(name: string | null)` on the title bar that mounts a `Glyph` to the left of the title text. Use it from the notification detail dialog only; existing callers that don't call `setGlyph` see no change.

**10c** — Add static `Notification.pauseAll()` / `resumeAll()`. Implement on top of the existing per-instance `pauseTimer`/`resumeTimer`. `resumeAll` clamps remaining to `Math.max(remaining, 8000)` before restarting each timer.

Verify: in the dev server, fire `Notification — show all types`. Double-click one — a tinted dialog opens with the matching glyph in the title and the full message in the body. While the dialog is open, none of the other notifications dismiss. Close the dialog. Each remaining notification restarts with at least 8 seconds left.

### Step 11 — Notification slide-right + fade dismiss

[Notification.ts](../src/typescript/lib/core/Notification.ts) — rewrite `dismiss()`:

```typescript
private dismiss(): void {
    if (this.dismissTimer !== null) {
        clearTimeout(this.dismissTimer);
        this.dismissTimer = null;
    }

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el      = this.getElement();

    if (!el || reduced) {
        this.finishDismiss();
        return;
    }

    el.style.transition = "transform 200ms ease-out, opacity 200ms ease-out";
    el.style.transform  = "translateX(100%)";
    el.style.opacity    = "0";

    let done = false;
    const finish = (): void => {
        if (done) return;
        done = true;
        this.finishDismiss();
    };
    el.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 240);   // fallback if transition is interrupted
}

private finishDismiss(): void {
    Notification.activeNotifications = Notification.activeNotifications.filter(n => n !== this);
    this.removeElement();
    Notification.restack();
}
```

Verify: hover over a notification (still pauses timer); let one auto-dismiss. The notification slides out right and fades in 200ms, then the stack collapses upward. Repeated quick clicks on the close icon do not double-fire (the `done` guard prevents it). Set `prefers-reduced-motion: reduce` in devtools and confirm the transition is skipped.

### Step 12 — Dialog fade dismiss

[Dialog.ts](../src/typescript/lib/core/Dialog.ts) — rewrite `hide(result)`:

```typescript
hide(result: DialogResult): this {
    document.removeEventListener('keydown', this.boundKeyHandler, true);
    window.removeEventListener('resize', this.boundResizeHandler);

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el      = this.getElement();
    const bdEl    = this.backdrop.getElement();

    const finalize = (): void => {
        this.backdrop.destroy();
        this.removeElement();
        this.destructor();

        instanceCounter = Math.max(0, instanceCounter - 1);
        if (this.previousFocus && 'focus' in this.previousFocus) {
            (this.previousFocus as HTMLElement).focus();
        }
        if (this.resolvePromise) {
            this.resolvePromise(result);
            this.resolvePromise = null;
        }
    };

    if (!el || reduced) {
        finalize();
        return this;
    }

    el.style.transition   = "opacity 150ms ease-out, transform 150ms ease-out";
    el.style.opacity      = "0";
    el.style.transform    = "scale(0.97)";
    if (bdEl) {
        bdEl.style.transition = "opacity 150ms ease-out";
        bdEl.style.opacity    = "0";
    }

    let done = false;
    const guard = (): void => { if (done) return; done = true; finalize(); };
    el.addEventListener("transitionend", guard, { once: true });
    setTimeout(guard, 180);

    return this;
}
```

The `destructor()` and `removeElement()` calls move to `finalize` so the dialog is not freed until the transition completes.

Verify: dialogs close with a 150ms fade + tiny scale-down. Backdrop fades in lockstep. Test all three dialog buttons (Confirm, Cancel, Close), the Escape key path, the backdrop-click path, and `prefers-reduced-motion: reduce` (instant close).

### Step 13 — MenuBar demo: add menu glyphs

[MenuBarPanel.ts:30-87](../src/typescript/MenuBarPanel.ts#L30-L87):

`MenuBar.setMenus` accepts a `MenuConfig[]`. Each top-level menu config has a `label`. Today the `MenuBarButton` for each is constructed inside [MenuBar.ts:147](../src/typescript/lib/component/menubar/MenuBar.ts#L147) without a glyph option. Extend `MenuConfig` (in [MenuItem.ts](../src/typescript/lib/component/container/MenuItem.ts) where the type lives) with an optional `glyph?: string;` field, and forward it in `MenuBar.setMenus` to the `new MenuBarButton(..., { glyph: menu.glyph })` constructor call.

Then in `MenuBarPanel.ts`, add `glyph` entries:

```typescript
{ label: "File", glyph: "file",          items: [...] },
{ label: "Edit", glyph: "pen-to-square", items: [...] },
{ label: "View", glyph: "eye",           items: [...] },
{ label: "Help", glyph: "info-circle",   items: [...] },
```

Verify: each menu button shows the glyph to the left of the label. "View" still does not clip (Step 3b's measured-width fix already covered this). Hover/click/keyboard navigation still work.

### Step 14 — Refresh the knowledge graph

```
graphify update . --directed
```

The new symbols (`centerInHeight`, `pauseAll`, `resumeAll`, the `glyph` field on `MenuConfig`) and the registry additions all show up in the next graph build.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/display/Glyphs.ts` (registry additions) |
| Modify | `src/typescript/lib/component/input/Text.ts` (`centerInHeight`) |
| Modify | `src/typescript/lib/component/menubar/MenuBarButton.ts` (centring + measured width) |
| Modify | `src/typescript/lib/component/menubar/MenuBar.ts` (forward `glyph` from `MenuConfig`) |
| Modify | `src/typescript/lib/component/container/MenuItem.ts` (`MenuConfig.glyph?: string`) |
| Modify | `src/typescript/lib/core/Dialog.ts` (close-glyph button, title centring, getTitleBar, fade dismiss) |
| Modify | `src/typescript/lib/component/container/WindowHeader.ts` (optional title-bar glyph in `DialogTitleBar` mirror) — only if `DialogTitleBar` upgrades borrow from this file |
| Modify | `src/typescript/lib/core/Window.ts` / `src/typescript/lib/component/container/WindowHeader.ts` (default `"window"` glyph) |
| Modify | `src/typescript/lib/component/input/NumberSpinner.ts` (`chevron-up`/`chevron-down` swap) |
| Modify | `src/typescript/lib/component/input/SpinButton.ts` (glyph instead of text symbol) |
| Modify | `src/typescript/lib/component/table/TablePanel.ts` (toolbar glyphs) |
| Modify | `src/typescript/lib/component/display/PaginationBar.ts` (paging glyphs) |
| Modify | `src/typescript/lib/core/Notification.ts` (badge, line-clamp, double-click, pauseAll/resumeAll, slide-fade) |
| Modify | `src/typescript/MenuBarPanel.ts` (menu glyphs in the demo) |
| Modify | `NOTICE` (mention new Font Awesome icons sourced) |
| Create | none |
| Delete | none |

---

## Verification

1. **Type check:**
   ```
   npm run typecheck
   ```

2. **Library build:**
   ```
   npm run build:lib
   ```

3. **Docs build is clean:**
   ```
   npm run docs:build
   ```
   Zero errors, zero new link warnings.

4. **Dev-server smoke walk:**
   ```
   npm run dev
   ```
   - **Misc panel** — `Show window with paginated table!` opens a window whose toolbar shows `plus / minus / sync / ban` glyphs and whose pagination bar shows `angles-left / angle-left / angle-right / angles-right`. Window title bar has the default `window` glyph.
   - **Misc panel** — fire each notification type. Each shows a coloured badge matching its severity. The long-message variant truncates to two lines with `…`. Double-click → a tinted modal opens with the matching title glyph and the full message; the other notifications stop counting down while it is open. Close the modal — each remaining notification has at least 8s on its timer.
   - **Misc panel** — any modal dialog (Confirm, the custom one, the notification detail) closes with a 150ms fade + slight scale-down. Backdrop fades alongside.
   - **NumberSpinner** anywhere — up/down arrows are crisp SVG, not Unicode chars; click + click-hold still increment/decrement.
   - **MenuBar demo** — each top-level button has a leading glyph. The "View" button is no longer clipped at the end. Every menu label sits vertically centred in its 28px box. Dialog title bars likewise vertically centre their title.
   - **Reduced-motion** — set `prefers-reduced-motion: reduce` in devtools, re-fire notifications and dialogs, confirm both dismiss instantly.

5. **Grep invariants:**
   - `grep -rn '"▲"\|"▼"' src/typescript/lib` — zero matches (`SpinButton` migrated).
   - `grep -rn '"+"\|"−"\|"<<"\|">>"' src/typescript/lib/component/table src/typescript/lib/component/display/PaginationBar.ts` — zero matches for the migrated buttons.
   - `grep -rn 'new Text("×")\|setText("×")' src/typescript/lib` — zero matches.

6. **Theme integration:** toggle `--ts-ui-text-color`, `--ts-ui-notification-info-border`, etc. Glyphs follow the override.

7. **Refresh the knowledge graph:**
   ```
   graphify update . --directed
   ```

---

## Documentation Impact

Public API additions:

- `Text#centerInHeight` — same bucket as `Text`, JSDoc with a short usage example. No cross-bucket linking concerns.
- `Notification.pauseAll` / `Notification.resumeAll` — `core` bucket. JSDoc; not @internal, since downstream code may legitimately want to pause notifications during their own modal flow.
- `MenuConfig.glyph` — `component/container` bucket (where `MenuConfig` lives) and used from `component/menubar` (which already cross-references `MenuConfig`). Update both the `MenuConfig` JSDoc and any mention of `setMenus` to note the new field.
- `Dialog#getTitleBar` (new public accessor) — `core` bucket. Internal-leaning but exposed because the notification path needs it. JSDoc should call out that `DialogTitleBar` itself is not exported and the return value is opaque from consumer code (callers use the few public methods on it).
- `DialogTitleBar#setGlyph` / `DialogTitleBar#getText` (newly public on a non-exported class) — only reachable via `Dialog#getTitleBar`. Document the public methods on the title bar so they show up via the accessor's return type.

No symbol renames; no removals; per-subpath barrels don't change.

Sidebar / `docs/.vitepress/config.mts` — no new pages. `docs/core/index.md` may want a one-liner on `Notification.pauseAll`/`resumeAll` if the page enumerates static methods; check during implementation.

---

## Potential Challenges

- **`getElement()` may return `null`** in some lifecycle states. Both transition paths guard against that (`if (!el || reduced) ...`); make sure the dialog backdrop element guard is parallel.
- **`transitionend` not firing** when the user navigates tabs or the document becomes hidden during the 200ms window. The fallback `setTimeout` is sized to be 40ms longer than the transition for slack; the `done` guard prevents double-cleanup.
- **Notification stack restack during transition.** If two notifications dismiss within the same 200ms window, the restack runs twice. Each runs against the live `activeNotifications` array which is mutated in `finishDismiss`, so the second restack still does the right thing — but verify visually that the stack doesn't jitter; if it does, debounce restack to one frame.
- **Default `"window"` glyph clashing with existing demos** that pass `{ glyph: null }` deliberately. The `=== undefined` check is the distinguishing line; cover it in the tests.
- **`Dialog.getTitleBar` widening the API surface.** The alternative is a `Dialog.tintHeader(bg, fg, glyph)` convenience that wraps the same calls. Either is fine — the accessor is more flexible at the cost of exposing one extra internal class; the convenience is narrower but pins the API to one specific use case. Pick during implementation, default to the accessor.
- **Notification double-click vs. close-glyph click.** A click on the close glyph during a partial double-click attempt could dismiss the notification before `dblclick` resolves. The close glyph's click handler should `event.stopPropagation()` so it never bubbles into the notification's `dblclick` listener. Browsers fire `dblclick` only on the same node sequence as the constituent `click` events; this is safe.

---

## Critical Files

- [Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts) — registry expansion entry point; the rest of the plan depends on these names existing.
- [Text.ts](../src/typescript/lib/component/input/Text.ts) — `centerInHeight` lives here; understand the existing `setLineHeight` paths first.
- [MenuItem.ts](../src/typescript/lib/component/container/MenuItem.ts) — the reference implementation for vertical centring (`lineHeight: H + "px"`) and for the right way to lay out a multi-region menu row.
- [Notification.ts](../src/typescript/lib/core/Notification.ts) — touched in multiple steps; read end-to-end before starting Step 9.
- [Dialog.ts](../src/typescript/lib/core/Dialog.ts) — the close-button, title-centring, fade-dismiss, and `getTitleBar` changes all live here; the file already has an internal `DialogTitleBar` you'll be modifying.
- [glyph-adoption.md](implemented/glyph-adoption.md) — the prior plan whose `Button({ glyph: "..." })` slot is the foundation for half of this plan's button migrations.

---

## Non-Goals

- **No entrance animations.** Only dismissal was raised. Adding fade-in on notification arrival and dialog open is a separate, purely-cosmetic decision.
- **No ProgressSpinner conversion.** Confirmed above. The component stays as-is.
- **No re-platforming of `MenuBarButton` onto `Button`.** They diverged for a reason (the flat hover look without ridge border / shadow) and that's still true.
- **No `Tooltip` work beyond hooking it into the new icon-only toolbar buttons.** Hover tooltips already exist; this plan uses them, not extends them.
- **No theme-token additions.** Existing notification + dialog tokens are reused.
- **No deprecation of `Text("×")` patterns elsewhere in the codebase.** This plan migrates only the two close-icon sites it touches. A library-wide sweep for `Text("×")`/`Text("▶")` etc. is a follow-up worth doing once but not part of this scope.
- **No vertical-centring helper on `Component`.** Limited to `Text`. The MenuItem / SpinButton / Dialog migrations to the helper can happen opportunistically; only the two known-broken sites are migrated here.
- **No "modal pauses notifications" hook for arbitrary `Dialog.show`.** Only the notification detail dialog pauses notifications. `Notification.pauseAll()` / `resumeAll()` are public so consumer code can wire it themselves.
