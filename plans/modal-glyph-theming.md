# Modal Glyph Theming — Implementation Plan

## Overview

Two related visual deficiencies in the modal dialog's glyph plumbing, fixed in one pass:

1. The `OK`/`Confirm` and `Cancel` buttons that [`Dialog.confirm()`](../src/typescript/lib/core/Dialog.ts#L767) emits already carry the `circle-check` and `xmark` glyphs, but those glyphs render in `currentColor` (the button's text colour). The semantics — confirm vs. cancel — are not visually reinforced. Tint the confirm glyph green and the cancel glyph red via dedicated theme tokens.
2. [`Notification.openDetail()`](../src/typescript/lib/core/Notification.ts#L395) tints the dialog title-bar's background and text colour to match the source notification's severity, then calls [`DialogTitleBar.setGlyph()`](../src/typescript/lib/core/Dialog.ts#L201) — but that helper allocates a fresh `Glyph` and leaves it on `currentColor`. The icon ends up monochrome inside a coloured header. Propagate the source notification's accent colour through to the title-bar glyph so it matches.

Everything routes through theme tokens defined in [`Theme.ts`](../src/typescript/lib/core/Theme.ts) (light + dark) and `themeToVars` at [Theme.ts:827](../src/typescript/lib/core/Theme.ts#L827). No hard-coded hex values, no new glyph rendering machinery — the existing `Glyph#setForegroundColor` (inherited from [`Component.setForegroundColor`](../src/typescript/lib/core/Component.ts#L1017)) is sufficient because `Glyph` SVGs render via `fill="currentColor"` ([Glyph.ts:539](../src/typescript/lib/component/display/Glyph.ts#L539)).

---

## Architecture Decisions

### Tint via the inherited `setForegroundColor`, not a glyph-specific API

`Glyph` SVGs draw with `fill="currentColor"` ([Glyph.ts:539](../src/typescript/lib/component/display/Glyph.ts#L539)) and char-mode glyphs render text in `color`, so the existing `setForegroundColor(value)` on [`Component`](../src/typescript/lib/core/Component.ts#L1017) — already cached in `_options.foregroundColor` ([Component.ts:83](../src/typescript/lib/core/Component.ts#L83), [Component.ts:1022](../src/typescript/lib/core/Component.ts#L1022)) — does exactly what we need. The `Notification` badge at [Notification.ts:130](../src/typescript/lib/core/Notification.ts#L130) already uses this path; we mirror it. No new typed setter on `Glyph`.

### Confirm / cancel accents are first-class theme tokens

Add `theme.dialog.confirm` and `theme.dialog.cancel` as the canonical colour entries, exposed as `--ts-ui-dialog-confirm-color` and `--ts-ui-dialog-cancel-color`. These are *dialog* tokens because the consumer surface is the dialog button row — not generic "success" / "error" semantics (which `theme.notification.success.border` / `theme.notification.error.border` already cover with a different visual contract). Reusing the notification tokens would couple dialog visuals to notification visuals; keep them independent.

### Tint applied inside `DialogButtonRow`, not by the caller

[`DialogButtonRow`](../src/typescript/lib/core/Dialog.ts#L299) already inspects `cfg.primary` and `cfg.glyph` and constructs the `Button`. Add the tint logic in the same loop ([Dialog.ts:319](../src/typescript/lib/core/Dialog.ts#L319)): when `cfg.result === 'confirm'`, set the button's glyph foreground to `var(--ts-ui-dialog-confirm-color)`; when `cfg.result === 'cancel'`, set it to `var(--ts-ui-dialog-cancel-color)`. The `'close'` result keeps `currentColor` — semantically that's "dismiss without choosing", not "reject".

`Button` exposes `getGlyph(): Glyph | null` (see [glyph-adoption.md](implemented/glyph-adoption.md) `Public API` section), so the row reads it back after construction and applies `setForegroundColor` on the glyph instance.

### Notification glyph colour propagates by reusing the existing CSS-var pattern, not a new field

[`Notification.openDetail()`](../src/typescript/lib/core/Notification.ts#L395) already references `--ts-ui-notification-${type}-border` ([Notification.ts:415](../src/typescript/lib/core/Notification.ts#L415)) to tint the title text — that same variable is the right "accent colour" for the source notification's glyph too. Reach into the title bar after `setGlyph`, fetch the just-created `Glyph` via [`DialogTitleBar.getGlyph()`](../src/typescript/lib/core/Dialog.ts#L238), and call `setForegroundColor` with the same `var(--ts-ui-notification-${type}-border)` string. No new `setGlyphColor` API on the title bar — the public surface stays at `setGlyph` + `getGlyph`, and the caller does the one extra mutation.

### No `DialogButtonConfig.glyphColor`

A `glyphColor?` field on `DialogButtonConfig` was considered and rejected. It would let arbitrary callers tint any button's glyph, but every current call site (`DEFAULT_BUTTONS` at [Dialog.ts:373](../src/typescript/lib/core/Dialog.ts#L373), `Dialog.confirm()` at [Dialog.ts:767](../src/typescript/lib/core/Dialog.ts#L767), the notification detail dialog at [Notification.ts:407](../src/typescript/lib/core/Notification.ts#L407)) tints by `result` semantics, not by free-form colour. Driving tint off `result` keeps the API surface unchanged and centralises the colour decision in one place. If a future caller wants a yellow "warn" tint, the right move is to extend `DialogResult` (e.g. `'warn'`) plus a matching token — not to bolt on an escape-hatch colour field.

---

## Public API (TypeScript Signatures)

No new public methods. The two changes are:

1. **Theme schema additions** — new `dialog.confirm` and `dialog.cancel` string fields on the [`Theme`](../src/typescript/lib/core/Theme.ts#L17) interface (light + dark defaults below), surfaced via `themeToVars` as `--ts-ui-dialog-confirm-color` / `--ts-ui-dialog-cancel-color`.
2. **Internal call-site changes** — `DialogButtonRow` and `Notification.openDetail` apply the tints via existing setters.

The exported [`DialogButtonConfig`](../src/typescript/lib/core/Dialog.ts#L35) interface is unchanged.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-dialog-confirm-color` | `rgb(30, 180, 80)` | `rgb(80, 200, 110)` | Foreground colour applied to the leading glyph of any dialog button whose `result` is `'confirm'` (the OK/Confirm affordance). |
| `--ts-ui-dialog-cancel-color`  | `rgb(200, 50, 50)` | `rgb(220, 90, 90)`  | Foreground colour applied to the leading glyph of any dialog button whose `result` is `'cancel'` (the Cancel affordance). |

Both colours are intentionally aligned with the existing `notification.success.border` / `notification.error.border` accents ([Theme.ts:532-534](../src/typescript/lib/core/Theme.ts#L532-L534), [Theme.ts:770-772](../src/typescript/lib/core/Theme.ts#L770-L772)) so the framework reads as one palette. The dark-mode values are lightened by ~30 RGB units along each non-zero channel to keep contrast against the `body.background` ≈ `rgb(30, 30, 30)` of [`DarkTheme`](../src/typescript/lib/core/Theme.ts#L591) on par with the light-mode contrast against white.

Theme blocks to edit:

- **`Theme` interface** ([Theme.ts:265-271](../src/typescript/lib/core/Theme.ts#L265-L271)) — extend the `dialog` block with `confirm: string;` and `cancel: string;`.
- **`DefaultTheme.dialog`** ([Theme.ts:560-564](../src/typescript/lib/core/Theme.ts#L560-L564)) — add the two light-mode values.
- **`DarkTheme.dialog`** ([Theme.ts:798-802](../src/typescript/lib/core/Theme.ts#L798-L802)) — add the two dark-mode values.
- **`themeToVars`** ([Theme.ts:970-972](../src/typescript/lib/core/Theme.ts#L970-L972)) — append the two new `--ts-ui-dialog-*-color` mappings beside the existing `--ts-ui-dialog-*` entries.

---

## Implementation

### `DialogButtonRow` tint dispatch

Inside the existing `for (const cfg of configs)` loop at [Dialog.ts:319](../src/typescript/lib/core/Dialog.ts#L319), after the `Button` is constructed and its `primary` styling applied, tint the glyph based on the result:

```typescript
const btn    = new Button(cfg.text, cfg.glyph !== undefined ? { glyph: cfg.glyph } : undefined);
const result = cfg.result ?? 'cancel';

if (cfg.primary) {
    btn.setBackgroundImage("var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))");
}

if (cfg.glyph !== undefined) {
    const glyph = btn.getGlyph();

    if (glyph !== null) {
        if (result === 'confirm') {
            glyph.setForegroundColor("var(--ts-ui-dialog-confirm-color)");
        } else if (result === 'cancel') {
            glyph.setForegroundColor("var(--ts-ui-dialog-cancel-color)");
        }
    }
}
```

The `'close'` branch falls through unchanged — close buttons keep `currentColor`.

### `Notification.openDetail` glyph propagation

After the existing `titleBar.setGlyph(BADGE_GLYPH[this._type])` at [Notification.ts:416](../src/typescript/lib/core/Notification.ts#L416), reach into the just-created glyph and tint it to match the title text:

```typescript
titleBar.setGlyph(BADGE_GLYPH[this._type]);

const titleGlyph = titleBar.getGlyph();
if (titleGlyph !== null) {
    titleGlyph.setForegroundColor(`var(--ts-ui-notification-${this._type}-border)`);
}
```

`getGlyph()` at [Dialog.ts:238](../src/typescript/lib/core/Dialog.ts#L238) already exposes the title-bar glyph publicly. The null-check guards against a future change to `setGlyph` semantics; today it is always non-null after `setGlyph` returns.

---

## Ordered Implementation Steps

1. **Extend `Theme` interface** ([Theme.ts:265-271](../src/typescript/lib/core/Theme.ts#L265-L271)) — add `confirm: string;` and `cancel: string;` inside the existing `dialog` block. → verify: `npx tsc --noEmit` flags `DefaultTheme` and `DarkTheme` as missing the new fields.
2. **Populate `DefaultTheme.dialog`** ([Theme.ts:560-564](../src/typescript/lib/core/Theme.ts#L560-L564)) with the two light-mode RGB values from the table above.
3. **Populate `DarkTheme.dialog`** ([Theme.ts:798-802](../src/typescript/lib/core/Theme.ts#L798-L802)) with the two dark-mode RGB values.
4. **Wire `themeToVars`** ([Theme.ts:970-972](../src/typescript/lib/core/Theme.ts#L970-L972)) — append `'--ts-ui-dialog-confirm-color': theme.dialog.confirm,` and `'--ts-ui-dialog-cancel-color': theme.dialog.cancel,`. → verify: `npx tsc --noEmit` is clean.
5. **Tint dialog button glyphs** in `DialogButtonRow`'s constructor loop ([Dialog.ts:319-330](../src/typescript/lib/core/Dialog.ts#L319-L330)) per the snippet above. → verify: open `Dialog.confirm("Delete?", "Cannot be undone.")` — Cancel button shows red `xmark`, Confirm button shows green `circle-check`.
6. **Tint the notification detail title-bar glyph** in [`Notification.openDetail`](../src/typescript/lib/core/Notification.ts#L395) after the `setGlyph` call at [Notification.ts:416](../src/typescript/lib/core/Notification.ts#L416). → verify: double-click an `error` notification — header glyph renders in the same red as the title text and the source notification's border.
7. **Theme toggle smoke test** — flip `ThemeManager.setTheme(DarkTheme)` while a confirm dialog is open and while a notification detail dialog is open: both tints should re-resolve through the CSS variable system, no JS reflow needed.
8. **Run `npm run docs:build`** — expect 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
9. **`graphify update .`** to refresh the knowledge graph.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — extend `Theme.dialog`, `DefaultTheme.dialog`, `DarkTheme.dialog`, and `themeToVars` with the two new token entries. |
| Modify | [`src/typescript/lib/core/Dialog.ts`](../src/typescript/lib/core/Dialog.ts) — `DialogButtonRow` constructor loop (lines ~319-330) tints the button glyph by `result`. |
| Modify | [`src/typescript/lib/core/Notification.ts`](../src/typescript/lib/core/Notification.ts) — `openDetail` (after line ~416) tints the title-bar glyph using `--ts-ui-notification-${type}-border`. |

No new files. No deletions.

---

## Verification

- `npx tsc --noEmit` clean.
- `grep -rn '#[0-9a-fA-F]\{3,8\}' src/typescript/lib/core/Dialog.ts src/typescript/lib/core/Notification.ts` — expect zero new hex literals introduced by this change.
- Manual: invoke `Dialog.confirm("Delete record", "This cannot be undone.")` and confirm Cancel/Confirm glyph colours render distinct red / green in both themes.
- Manual: trigger each notification type (`info`, `success`, `warning`, `error`), double-click each, and confirm the modal title-bar glyph matches the same accent the title text uses.
- Manual: open a confirm dialog, switch theme via `ThemeManager.setTheme(DarkTheme)`, and confirm both glyphs re-resolve to their dark-mode token values without re-opening the dialog.
- `npm run docs:build` — 0 errors and 0 link warnings.
- `graphify update .`.

---

## Documentation Impact

No public API surface change (the `Theme` interface gains two string fields under an existing block — consumers who already pass a custom `Theme` object will need to add the two fields, but they're not exported individually). Update:

- [`docs/theme/index.md`](../docs/theme/index.md) (if it enumerates dialog tokens) — add the two new `--ts-ui-dialog-*-color` rows to the dialog token table.

Skip if no curated dialog-tokens page exists; the typedoc-generated entry for `Theme` picks up the new fields automatically via JSDoc on the interface members.

---

## Potential Challenges

- **Char-mode glyphs** — `Glyph` supports both SVG and char registry entries. `circle-check` and `xmark` are SVG ([Notification.ts:14-18](../src/typescript/lib/core/Notification.ts#L14-L18) `Glyph.register` block), so `currentColor` + `setForegroundColor` works. If a future call site supplies a char-mode glyph, the same `color` rule applies — char glyphs render text in `color` natively. No special-casing needed.
- **Button hover state** — `Button` has typed hover-foreground setters (see Community 13 entries in the graph: `setHoverForegroundColor` / `getHoverForegroundColor`). Setting the *glyph's* `foregroundColor` doesn't touch the button's hover rule, so the tint persists on hover (the glyph stays red/green even when the button background hovers). That is the intended behaviour — the glyph's semantic colour shouldn't change on hover.
- **Backwards compatibility for consumer themes** — any external `Theme` object will fail typecheck without the two new fields. Mention in the implementation commit message.

---

## Critical Files

- [`src/typescript/lib/core/Dialog.ts`](../src/typescript/lib/core/Dialog.ts) — `DialogButtonRow` ([line 299](../src/typescript/lib/core/Dialog.ts#L299)), `DialogTitleBar.setGlyph` ([line 201](../src/typescript/lib/core/Dialog.ts#L201)), `DialogTitleBar.getGlyph` ([line 238](../src/typescript/lib/core/Dialog.ts#L238)), `Dialog.confirm` ([line 767](../src/typescript/lib/core/Dialog.ts#L767)).
- [`src/typescript/lib/core/Notification.ts`](../src/typescript/lib/core/Notification.ts) — `openDetail` ([line 395](../src/typescript/lib/core/Notification.ts#L395)), specifically the title-bar tinting block at [lines 412-416](../src/typescript/lib/core/Notification.ts#L412-L416).
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `Theme.dialog` ([line 265](../src/typescript/lib/core/Theme.ts#L265)), `DefaultTheme.dialog` ([line 560](../src/typescript/lib/core/Theme.ts#L560)), `DarkTheme.dialog` ([line 798](../src/typescript/lib/core/Theme.ts#L798)), `themeToVars` ([line 827](../src/typescript/lib/core/Theme.ts#L827)).
- [`src/typescript/lib/component/display/Glyph.ts`](../src/typescript/lib/component/display/Glyph.ts) — `currentColor` rendering at [line 539](../src/typescript/lib/component/display/Glyph.ts#L539); inherits `setForegroundColor` from [`Component`](../src/typescript/lib/core/Component.ts#L1017).
- Prior plans for context: [`plans/implemented/modal-dialog.md`](implemented/modal-dialog.md), [`plans/implemented/glyph-adoption.md`](implemented/glyph-adoption.md), [`plans/implemented/embedded-glyph.md`](implemented/embedded-glyph.md), [`plans/implemented/animated-glyphs.md`](implemented/animated-glyphs.md).

---

## Non-Goals

- **No `DialogButtonConfig.glyphColor` escape hatch.** Tint is driven by `result` semantics only; widening the surface invites inconsistency.
- **No new `Glyph#setTint` / `Glyph#setSeverity` API.** The inherited `setForegroundColor` already does the job and is the existing idiom (`Notification` badge already uses it at [Notification.ts:130](../src/typescript/lib/core/Notification.ts#L130)).
- **No retroactive tinting of the `DialogTitleBar` close-button glyph or the in-row `xmark` close button.** Those are dismiss affordances, not cancel affordances; keeping them on `currentColor` matches existing window-chrome conventions.
- **No new severity tokens for `'warn'` / `'info'` button results.** Out of scope; only `confirm` and `cancel` were requested.
- **No animation on the tinted glyphs.** [`Glyph.setAnimated`](../src/typescript/lib/component/display/Glyph.ts#L380) exists and would compose, but a spinning confirm button is not requested.
