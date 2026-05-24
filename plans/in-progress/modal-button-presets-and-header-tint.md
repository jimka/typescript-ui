---
depends-on: [modal-glyph-theming]
touches-shared: [src/typescript/lib/core/Dialog.ts, src/typescript/lib/core/Notification.ts, src/typescript/lib/core/Theme.ts, src/typescript/lib/core/index.ts]
---

# Modal Button Presets & Auto-Tinted Headers — Implementation Plan

## Overview

Two complementary follow-ups to the just-shipped [modal-glyph-theming](implemented/modal-glyph-theming.md) work:

1. **Promote inline button literals to canonical presets.** Today, [`DEFAULT_BUTTONS`](../src/typescript/lib/core/Dialog.ts#L385), [`Dialog.confirm()`](../src/typescript/lib/core/Dialog.ts#L779), and [`Notification.openDetail()`](../src/typescript/lib/core/Notification.ts#L407) each spell out `{text, result, glyph}` inline. The glyph string (`"circle-check"`, `"xmark"`) is silently re-typed at every site — drift-prone. Extract one canonical `DialogButtons` namespace exporting `Confirm` / `Cancel` / `Close` presets so the glyph is owned by the button identity, never by the call site.

2. **Auto-tint the dialog title bar by button shape.** A dialog whose only button is `result: 'confirm'` is informational — tint the header blue and add a leading `circle-info` glyph. A dialog with both `'confirm'` and `'cancel'` buttons is an affirmative-action prompt — tint the header green. Other shapes (close-only, custom) keep the neutral `--ts-ui-body-bg` header. The decision runs once in the [`Dialog`](../src/typescript/lib/core/Dialog.ts#L410) constructor against the resolved button list.

Both changes layer cleanly on top of modal-glyph-theming: the per-button glyph tint (confirm → green, cancel → red) inside [`DialogButtonRow`](../src/typescript/lib/core/Dialog.ts#L319-L337) is unchanged. The notification severity-header in [`Notification.openDetail`](../src/typescript/lib/core/Notification.ts#L412-L422) is unchanged in *behaviour* but switches to the new `DialogButtons.Close` preset for its buttons literal.

---

## Architecture Decisions

### Preset shape — `DialogButtons` namespace, not flat exports

Three flat exports (`ConfirmButton`, `CancelButton`, `CloseButton`) would pollute the root `core` barrel with generic-sounding identifiers that collide with what consumer code is likely to name its own helpers. An `as const` namespace `DialogButtons` keeps all three discoverable as a single concept (`DialogButtons.Confirm`, `DialogButtons.Cancel`, `DialogButtons.Close`), preserves room for future presets (`DialogButtons.Discard`, `DialogButtons.Apply`) without further barrel churn, and reads more clearly at call sites: `[{...DialogButtons.Cancel, primary: true}, DialogButtons.Confirm]` is self-documenting.

The user's brief explicitly framed these as a "list" callers can reference, which matches the namespace shape.

### Presets carry identity, not context — `primary` stays out

Each preset hardcodes `{text, result, glyph}` because those three are intrinsic to the button's identity: a Confirm button is always labeled "Confirm", always emits `'confirm'`, always carries `circle-check`. The `primary` flag is *contextual* — Cancel becomes primary when paired with Confirm so the safer dismiss action is default-focused; Confirm becomes primary when it's alone. Pushing `primary` into the preset would force callers to override it (or to define `ConfirmPrimary` / `ConfirmSecondary` siblings — schema bloat). Spread overrides at the call site stay terse: `{...DialogButtons.Cancel, primary: true}`.

### Header variant computed from the resolved button list, not from a config flag

Adding `DialogConfig.type?: 'info' | 'affirm' | 'plain'` was considered and rejected. The user's first constraint was "never decide glyph on the text on buttons" — the dual is "never decide header style on a flag the caller has to remember to set, when the buttons already encode the semantic." Every call site that uses `DialogButtons.Confirm` alone signals "informational" by that act; every call site pairing `Confirm` + `Cancel` signals "affirmative action" by that act. A flag would be redundant *and* a third place for inconsistency to creep in.

The computation is a 3-line `private computeHeaderVariant(buttons): 'info' | 'affirm' | 'plain'` on `Dialog` that inspects `buttons.map(b => b.result ?? 'cancel')` and runs once in the constructor.

### Auto-tint sets background/text/glyph via the existing `DialogTitleBar` surface

`DialogTitleBar` already exposes [`setBackgroundColor`](../src/typescript/lib/core/Component.ts#L1017) (inherited), [`getTitleText()`](../src/typescript/lib/core/Dialog.ts#L185), [`setGlyph()`](../src/typescript/lib/core/Dialog.ts#L201), and [`getGlyph()`](../src/typescript/lib/core/Dialog.ts#L238). The Notification severity-header override at [Notification.ts:412-422](../src/typescript/lib/core/Notification.ts#L412-L422) uses exactly these four calls. The auto-tint is the same shape, applied from inside the `Dialog` constructor instead of a downstream caller. No new constructor parameter and no new `DialogTitleBar` API.

### Close-only buckets to `'plain'` so Notification.openDetail's override still wins

`Notification.openDetail` passes `[{ ...DialogButtons.Close, primary: true }]`. The resolved result set is `{'close'}` — that misses both branches (`{confirm}` alone and `{confirm,cancel}`) so the variant resolves to `'plain'`. Dialog leaves the header at `--ts-ui-body-bg`. Then Notification's existing post-construction `setBackgroundColor` / `setForegroundColor` / `setGlyph` calls run and paint the severity colors. Construction-then-override is the natural ordering — overrides simply replace whatever the constructor wrote.

### New header tokens are `dialog.info.*` and `dialog.affirm.*`, not a rename of the existing tokens

The existing `dialog.confirm` / `dialog.cancel` tokens (added in modal-glyph-theming, [Theme.ts:566-567](../src/typescript/lib/core/Theme.ts#L566-L567)) are *glyph tint colors* applied to the leading glyph of any button with the matching `result`. The new tokens are *header backgrounds and text colors*. They are different surfaces with different intensities (header bg is a low-opacity wash; glyph tint is a saturated foreground).

Renaming the existing tokens to `dialog.confirmGlyph` / `dialog.cancelGlyph` to free up the namespace was considered and rejected: it forces a public-API churn one merge after they were introduced, and `confirm`-vs-`affirm` is a clear enough split. The CSS-var spelling also disambiguates: `--ts-ui-dialog-confirm-color` (glyph) vs `--ts-ui-dialog-affirm-bg` / `--ts-ui-dialog-affirm-fg` (header).

The `affirm` name (rather than `confirm`) for the green header avoids the lexical collision with the existing `confirm` token entirely.

---

## Public API (TypeScript Signatures)

### `DialogButtons` namespace (new export from `~/core/Dialog.js`)

```typescript
/**
 * Canonical dialog button presets. Spread into the `buttons` array
 * of a `DialogConfig` to inherit the standard text / result / glyph
 * mapping; override `primary` per call site.
 *
 * @category Core
 * @example
 * ```typescript
 * Dialog.show({
 *     title:   'Confirm deletion',
 *     message: 'This cannot be undone.',
 *     buttons: [
 *         { ...DialogButtons.Cancel, primary: true },
 *         DialogButtons.Confirm,
 *     ],
 * });
 * ```
 */
export const DialogButtons = {
    Confirm: { text: 'Confirm', result: 'confirm', glyph: 'circle-check' },
    Cancel:  { text: 'Cancel',  result: 'cancel',  glyph: 'xmark'        },
    Close:   { text: 'Close',   result: 'close',   glyph: 'xmark'        },
} as const satisfies Record<string, DialogButtonConfig>;
```

The `as const satisfies …` form gives compile-time immutability (callers cannot mutate the preset in place) while still flowing through `DialogButtonConfig`'s structural type. Spread-with-override at call sites widens the literal types as expected.

### Re-exported from `~/core/index.js`

```typescript
export { Dialog, DialogTitleBar, DialogButtons } from '~/core/Dialog.js';
```

### `DialogConfig` and `DialogButtonConfig` are unchanged.

No new fields. No new `type` enum.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-dialog-info-bg` | `rgba(30, 100, 200, 0.15)` | `rgba(30, 100, 200, 0.25)` | Background of the title bar of an informational dialog (single `confirm` button). |
| `--ts-ui-dialog-info-fg` | `rgb(30, 100, 200)` | `rgb(60, 130, 220)` | Foreground for the title text *and* the leading `circle-info` glyph of an informational dialog. |
| `--ts-ui-dialog-affirm-bg` | `rgba(30, 180, 80, 0.15)` | `rgba(80, 200, 110, 0.25)` | Background of the title bar of an affirmative-action dialog (both `confirm` and `cancel` buttons). |
| `--ts-ui-dialog-affirm-fg` | `rgb(30, 180, 80)` | `rgb(80, 200, 110)` | Foreground for the title text of an affirmative-action dialog. |

The hue choices are deliberately aligned with the existing palette: `info` echoes `notification.info.border` ([Theme.ts:524](../src/typescript/lib/core/Theme.ts#L524) light, [Theme.ts:773](../src/typescript/lib/core/Theme.ts#L773) dark); `affirm` echoes `notification.success.border` ([Theme.ts:525](../src/typescript/lib/core/Theme.ts#L525) light, [Theme.ts:774](../src/typescript/lib/core/Theme.ts#L774) dark) and the existing `dialog.confirm` glyph tint. One palette, three surfaces (notification fill, dialog header, dialog glyph tint).

Background opacities are higher than `notification.{info,success}.background` (0.15/0.25 vs 0.2) for a single reason: the dialog header sits adjacent to an opaque white/grey content area whose contrast amplifies the band; the notification fill bleeds into the toast's full bezel. The values are eyeballed for "visible accent, not loud band" in both themes — re-tune if 0.15 reads too thin in light mode against `--ts-ui-body-bg = rgb(255,255,255)`.

Theme blocks to edit:

- **`Theme` interface** ([Theme.ts:265-273](../src/typescript/lib/core/Theme.ts#L265-L273)) — extend the `dialog` block with two new nested objects:
  ```typescript
  info:   { background: string; foreground: string };
  affirm: { background: string; foreground: string };
  ```
- **`DefaultTheme.dialog`** ([Theme.ts:562-568](../src/typescript/lib/core/Theme.ts#L562-L568)) — add the light-mode values.
- **`DarkTheme.dialog`** ([Theme.ts:802-808](../src/typescript/lib/core/Theme.ts#L802-L808)) — add the dark-mode values.
- **`themeToVars`** ([Theme.ts:976-980](../src/typescript/lib/core/Theme.ts#L976-L980)) — append the four `--ts-ui-dialog-{info,affirm}-{bg,fg}` mappings beside the existing `--ts-ui-dialog-*-color` entries.

---

## Implementation

### `DialogButtons` registration & glyph import

`Dialog.ts` already registers `xmark` and `circle_check` ([Dialog.ts:18-21](../src/typescript/lib/core/Dialog.ts#L18-L21)). Add `circle_info` so the info variant doesn't depend on `Notification.ts` having been imported first:

```typescript
import { xmark }        from "~/glyphs/solid/xmark.js";
import { circle_check } from "~/glyphs/solid/circle_check.js";
import { circle_info }  from "~/glyphs/solid/circle_info.js";

Glyph.register(xmark, circle_check, circle_info);
```

Place `export const DialogButtons = { … } as const satisfies …` directly above [`DEFAULT_BUTTONS`](../src/typescript/lib/core/Dialog.ts#L385) so the const-of-presets-then-singleton-default reads top-to-bottom.

### Refactored `DEFAULT_BUTTONS` and `Dialog.confirm()`

```typescript
const DEFAULT_BUTTONS: DialogButtonConfig[] = [
    { ...DialogButtons.Confirm, primary: true },
];

// Inside Dialog.confirm:
const result = await Dialog.show({
    title,
    message,
    buttons: [
        { ...DialogButtons.Cancel, primary: true },
        DialogButtons.Confirm,
    ],
});
```

### `Notification.openDetail` refactor

[Notification.ts:407](../src/typescript/lib/core/Notification.ts#L407) becomes:

```typescript
const dialog = new _Dialog({
    title:            DETAIL_TITLE[this._type],
    contentComponent: content,
    buttons:          [{ ...DialogButtons.Close, primary: true }],
    width:            420,
    height:           220,
});
```

This requires `import { DialogButtons } from "~/core/Dialog.js";` in Notification.ts. The post-construction severity overrides at [Notification.ts:413-422](../src/typescript/lib/core/Notification.ts#L413-L422) stay verbatim — they win over the constructor-time `'plain'` variant (which leaves the header at `--ts-ui-body-bg`).

### Header variant detection in the `Dialog` constructor

Add a private helper:

```typescript
private computeHeaderVariant(buttons: DialogButtonConfig[]): 'info' | 'affirm' | 'plain' {
    const results = new Set(buttons.map(b => b.result ?? 'cancel'));

    if (results.size === 1 && results.has('confirm')) {
        return 'info';
    }

    if (results.has('confirm') && results.has('cancel')) {
        return 'affirm';
    }

    return 'plain';
}
```

Call it once in the constructor after `this._titleBar` is constructed and `buttons` is resolved (currently around [Dialog.ts:459](../src/typescript/lib/core/Dialog.ts#L459)):

```typescript
this._titleBar = new DialogTitleBar(config.title, () => this.hide('close'));
this.addComponent(this._titleBar, { placement: Placement.NORTH });

this.applyHeaderVariant(this.computeHeaderVariant(buttons));
```

The `applyHeaderVariant` helper centralises the four-call mutation so the constructor stays readable:

```typescript
private applyHeaderVariant(variant: 'info' | 'affirm' | 'plain'): void {
    if (variant === 'plain') {
        return;
    }

    const bgVar = variant === 'info' ? 'var(--ts-ui-dialog-info-bg)' : 'var(--ts-ui-dialog-affirm-bg)';
    const fgVar = variant === 'info' ? 'var(--ts-ui-dialog-info-fg)' : 'var(--ts-ui-dialog-affirm-fg)';

    this._titleBar.setBackgroundColor(bgVar);
    this._titleBar.getTitleText().setForegroundColor(fgVar);

    if (variant === 'info') {
        this._titleBar.setGlyph('circle-info');

        const headerGlyph = this._titleBar.getGlyph();

        if (headerGlyph !== null) {
            headerGlyph.setForegroundColor(fgVar);
        }
    }
}
```

The close button inside the title bar is intentionally untouched — keep the close-glyph rule from [modal-glyph-theming.md](implemented/modal-glyph-theming.md) `## Non-Goals`: "dismiss affordances stay on currentColor."

---

## Ordered Implementation Steps

1. **Extend `Theme` interface** ([Theme.ts:265-273](../src/typescript/lib/core/Theme.ts#L265-L273)) — add the two nested `info` / `affirm` blocks inside `dialog`. → verify: `npx tsc --noEmit` flags `DefaultTheme` and `DarkTheme` as missing the new fields.
2. **Populate `DefaultTheme.dialog`** ([Theme.ts:562-568](../src/typescript/lib/core/Theme.ts#L562-L568)) with the light-mode values from the table.
3. **Populate `DarkTheme.dialog`** ([Theme.ts:802-808](../src/typescript/lib/core/Theme.ts#L802-L808)) with the dark-mode values.
4. **Extend `themeToVars`** ([Theme.ts:976-980](../src/typescript/lib/core/Theme.ts#L976-L980)) with the four `--ts-ui-dialog-{info,affirm}-{bg,fg}` mappings. → verify: `npx tsc --noEmit` clean.
5. **Register `circle_info` in Dialog.ts** ([Dialog.ts:18-21](../src/typescript/lib/core/Dialog.ts#L18-L21)) — add the import and append to the `Glyph.register(...)` call.
6. **Declare `DialogButtons`** in Dialog.ts (above `DEFAULT_BUTTONS` at [Dialog.ts:385](../src/typescript/lib/core/Dialog.ts#L385)) using the `as const satisfies Record<string, DialogButtonConfig>` form.
7. **Refactor `DEFAULT_BUTTONS`** to `[{...DialogButtons.Confirm, primary: true}]`.
8. **Refactor `Dialog.confirm()`** ([Dialog.ts:779-790](../src/typescript/lib/core/Dialog.ts#L779-L790)) to spread `DialogButtons.Cancel` and reference `DialogButtons.Confirm`.
9. **Add `computeHeaderVariant` + `applyHeaderVariant`** as private methods on `Dialog`. Place them next to [`computeContentHeight`](../src/typescript/lib/core/Dialog.ts#L496) so the constructor's helper cluster stays together.
10. **Invoke `applyHeaderVariant` in the constructor** after the title bar is added (immediately after [Dialog.ts:460](../src/typescript/lib/core/Dialog.ts#L460)). → verify: `npx tsc --noEmit` clean; open `Dialog.show({title:'Info',message:'…'})` and observe blue header + info glyph; open `Dialog.confirm('…','…')` and observe green header.
11. **Refactor `Notification.openDetail`** ([Notification.ts:407](../src/typescript/lib/core/Notification.ts#L407)) to spread `DialogButtons.Close`. Add the `import { DialogButtons }` line beside the existing `import { _Dialog }` ([Notification.ts:13](../src/typescript/lib/core/Notification.ts#L13)). → verify: double-click a notification of each severity — header still renders in the severity colour and not the new auto-tint.
12. **Re-export `DialogButtons` from `core/index.ts`** ([index.ts:31](../src/typescript/lib/core/index.ts#L31)) by appending it to the existing `Dialog, DialogTitleBar` re-export.
13. **Sweep for residual inline `{text:…, result:…, glyph:…}` literals**: `grep -rn "result:\s*'\(confirm\|cancel\|close\)'" src/typescript/lib/ | grep -v Dialog.ts | grep -v _DialogButtons` — expect zero hits outside the preset definition itself.
14. **Theme toggle smoke test** — flip `ThemeManager.setTheme(DarkTheme)` with both an info and an affirm dialog open: header bg + text + leading glyph all re-resolve via CSS vars without JS reflow.
15. **Run `npm run docs:build`** — expect 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — extend `Theme.dialog`, `DefaultTheme.dialog`, `DarkTheme.dialog`, and `themeToVars` with the four new info/affirm tokens. |
| Modify | [`src/typescript/lib/core/Dialog.ts`](../src/typescript/lib/core/Dialog.ts) — register `circle_info`, declare `DialogButtons`, refactor `DEFAULT_BUTTONS` and `Dialog.confirm`, add `computeHeaderVariant` + `applyHeaderVariant`. |
| Modify | [`src/typescript/lib/core/Notification.ts`](../src/typescript/lib/core/Notification.ts) — import `DialogButtons` and spread `DialogButtons.Close` in `openDetail`. |
| Modify | [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — re-export `DialogButtons` from the Dialog line. |

No new files. No deletions.

---

## Verification

- `npx tsc --noEmit` clean.
- `grep -rn "result:\s*'\(confirm\|cancel\|close\)'" src/typescript/lib/ | grep -v "Dialog.ts"` — only the preset definition emits the literal; every other site references `DialogButtons.X` (zero hits expected outside Dialog.ts).
- `grep -rn '#[0-9a-fA-F]\{3,8\}' src/typescript/lib/core/Theme.ts | grep -E 'dialog.*(info|affirm)' || true` — expect zero hex literals; all new tokens are `rgb()` / `rgba()` form, matching the file convention.
- **Manual — informational dialog**: open `Dialog.show({title:'Information',message:'…'})` from MiscPanel's "Dialog — OK only" button ([MiscPanel.ts:573-580](../src/typescript/MiscPanel.ts#L573-L580)). Confirm blue title bar + leading info glyph + OK button with green check.
- **Manual — affirmative dialog**: open `Dialog.confirm(…)` from MiscPanel's "Dialog — confirm/cancel" button ([MiscPanel.ts:562-571](../src/typescript/MiscPanel.ts#L562-L571)). Confirm green title bar + Cancel (red xmark, primary) + Confirm (green check). No leading title glyph.
- **Manual — close-only / backdrop dialog**: MiscPanel's "Dialog — close on backdrop click" button ([MiscPanel.ts:582-592](../src/typescript/MiscPanel.ts#L582-L592)) currently uses default buttons (Confirm only) — it will get the blue info treatment, which is correct given its result set.
- **Manual — notification detail dialog**: trigger each `info` / `success` / `warning` / `error` notification, double-click each, confirm the modal still shows the severity-coloured header (the construction-time auto-tint is `'plain'` and Notification's override paints over it).
- **Manual — theme toggle**: open one info dialog and one affirm dialog, call `ThemeManager.setTheme(DarkTheme)`. Header bg, text, and (info-only) leading glyph all re-resolve to dark-mode values via the CSS-var system without reopening.
- `npm run docs:build` — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is acceptable).

---

## Documentation Impact

`DialogButtons` is a new exported symbol from `core/Dialog.ts`. Required:

- **Re-export** from [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — already in the steps above. Verify it lands in `docs/api/core/index.md` after `npm run docs:build`.
- **`@category Core`** on the `DialogButtons` declaration so typedoc bins it with the other core variables.
- **JSDoc** on the const itself (purpose + `@example`) and on each of the three preset fields (one-line purpose: "Standard Confirm button — emits `'confirm'`, carries the `circle-check` glyph.").
- **Curated dialog page** — if one exists under `docs/core/dialog.md` (check at implementation time), append a short "## Button presets" section showing the spread-with-override pattern. Skip if no such page exists; typedoc's auto-generated `variables/DialogButtons` page picks up the JSDoc example.

The two new `Theme.dialog.{info,affirm}` interface fields are picked up automatically by typedoc from the JSDoc on the interface members ([Theme.ts:265-273](../src/typescript/lib/core/Theme.ts#L265-L273) — add inline JSDoc on the new nested objects). Consumers passing a custom `Theme` object will fail typecheck without them — flag in the implementation commit message.

No cross-bucket `{@link}` migrations needed — all symbols stay inside `core`.

---

## Potential Challenges

- **Notification.ts now imports `DialogButtons` alongside `_Dialog`** — both come from `~/core/Dialog.js`, so the import order is unchanged and no circular-import risk arises (Dialog.ts does not import Notification.ts).
- **`as const satisfies` plus spread** — TypeScript's `as const` makes property types literal (`result: 'confirm'`) and properties `readonly`. Spreading into a new object literal (`{...DialogButtons.Cancel, primary: true}`) produces a writable object with the literal types preserved on the spread fields and `primary: boolean` added. Assignability to `DialogButtonConfig` (whose fields are not readonly) holds because TS structural typing treats `readonly` as a supertype constraint, not a subtype mismatch. If a future change makes `DialogButtonConfig` fields readonly, the spread pattern still works.
- **Construction-then-override ordering for Notification** — relies on `Component` setters being idempotent and overwriting cached state. They are (modal-glyph-theming verified this for the `setForegroundColor` cascade). The auto-tint sets `'plain'` → nothing happens, so there's actually nothing to overwrite in the Notification case.
- **Existing dialog tokens are one-merge-old** — `dialog.confirm` / `dialog.cancel` were just added in modal-glyph-theming. Renaming them would create churn; keeping them and adding orthogonal `dialog.info` / `dialog.affirm` is the surgical move. Document the four-axis naming convention in the JSDoc on the `Theme.dialog` block so the distinction is visible at the point of definition.
- **`MiscPanel.ts:582-592`** (close-on-backdrop dialog) inherits the new blue/info treatment because it omits `buttons` and defaults to `[Confirm]`. This is correct under the new rules and the demo intent — "informational dialog with backdrop dismissal" — but flag in the implementation walkthrough so reviewers don't read it as a regression.

---

## Critical Files

- [`src/typescript/lib/core/Dialog.ts`](../src/typescript/lib/core/Dialog.ts) — `DialogTitleBar` ([line 134](../src/typescript/lib/core/Dialog.ts#L134)), `DialogButtonRow` ([line 299](../src/typescript/lib/core/Dialog.ts#L299)), `DEFAULT_BUTTONS` ([line 385](../src/typescript/lib/core/Dialog.ts#L385)), `Dialog` constructor ([line 429](../src/typescript/lib/core/Dialog.ts#L429)), `Dialog.confirm` ([line 779](../src/typescript/lib/core/Dialog.ts#L779)).
- [`src/typescript/lib/core/Notification.ts`](../src/typescript/lib/core/Notification.ts) — `openDetail` ([line 395](../src/typescript/lib/core/Notification.ts#L395)), specifically the buttons literal ([line 407](../src/typescript/lib/core/Notification.ts#L407)) and the severity override block ([lines 412-422](../src/typescript/lib/core/Notification.ts#L412-L422)).
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `Theme.dialog` ([line 265](../src/typescript/lib/core/Theme.ts#L265)), `DefaultTheme.dialog` ([line 562](../src/typescript/lib/core/Theme.ts#L562)), `DarkTheme.dialog` ([line 802](../src/typescript/lib/core/Theme.ts#L802)), `themeToVars` ([line 976](../src/typescript/lib/core/Theme.ts#L976)).
- [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — Dialog re-export ([line 31](../src/typescript/lib/core/index.ts#L31)).
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts) — demo call sites for verification ([line 562-592](../src/typescript/MiscPanel.ts#L562-L592)).
- Prior plans for context: [`plans/implemented/modal-glyph-theming.md`](implemented/modal-glyph-theming.md), [`plans/implemented/modal-dialog.md`](implemented/modal-dialog.md).

---

## Non-Goals

- **No `DialogConfig.type` field.** The variant is derived from the button shape; an explicit field is the third place inconsistency could creep in.
- **No new `'warn'` / `'danger'` variants.** Only `'info'` (single `confirm`) and `'affirm'` (`confirm` + `cancel`) are requested. If a future caller needs a yellow-header warning prompt, the right next move is to extend `DialogResult` and add a fourth variant — not to wedge it into this auto-tint.
- **No retroactive tinting of the title bar's close-button glyph or the in-row close button.** Carries forward from modal-glyph-theming: dismiss affordances stay on currentColor.
- **No renaming of the existing `dialog.confirm` / `dialog.cancel` theme tokens.** They were just merged; orthogonal `dialog.info` / `dialog.affirm` is the surgical addition.
- **No `Discard` / `Apply` / `Save` presets in this round.** `DialogButtons.{Confirm, Cancel, Close}` covers every current call site; future presets are added on demand.
- **No animation on the header tint or the leading info glyph.** Matches the prior plan's static-tint posture.
