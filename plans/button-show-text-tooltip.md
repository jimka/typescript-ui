# Button `showText` — Tooltip & Accessible Name for Glyph-Only Buttons — Implementation Plan

## Overview

Add a `showText?: boolean` (default `true`) option to the library `Button` so a glyph-only button can carry its title for the **hover tooltip** and the **accessible name** without rendering it on the button face. Today a glyph-only button is built with `{ glyph }` and *no* `text`, so `Button`'s tooltip machinery — which composes `{title}\n\n{description}` and attaches it via `Tooltip.attach` ([`Button.ts:893`](../src/typescript/lib/component/button/Button.ts#L893)) — has nothing to attach, and consumers fall back to a manual `getAria().setLabel(...)` that gives a screen-reader name but **no** hover tooltip.

`showText` is the title-side twin of the existing `showDescription` ([`Button.ts:65`](../src/typescript/lib/component/button/Button.ts#L65), resolver [`Button.ts:926`](../src/typescript/lib/component/button/Button.ts#L926), runtime setter [`Button.ts:2283`](../src/typescript/lib/component/button/Button.ts#L2283)): the title `Text` (`_text`) stays alive and keeps driving `_rebuildTooltip`, but `_rebuildContentRow` ([`Button.ts:1009`](../src/typescript/lib/component/button/Button.ts#L1009)) does not parent it onto the face. Additionally, when the title is hidden `Button` reflects it into its own `aria-label` so the accessible name survives, letting consumers drop the manual call.

The change is confined to `Button.ts` + its test in this repo, and to the two module-private `glyphButton` helpers in the consumer app (`sqladmin`, branch `feature/query-panels`).

---

## Architecture Decisions

### `showText` mirrors `showDescription` exactly

`showDescription` is the proven template: a pure-written options-bag flag (no setter dispatch in `applyOptions` — [`Button.ts:563`](../src/typescript/lib/component/button/Button.ts#L563)), a private resolver `_isShowDescription()` holding the `?? true` default ([`Button.ts:926`](../src/typescript/lib/component/button/Button.ts#L926)), consumed live by `_rebuildContentRow`, plus a runtime `setShowDescription` / `isShowDescription` pair that re-runs `_rebuildContentRow()` + `recomputePreferredSize()` ([`Button.ts:2283`](../src/typescript/lib/component/button/Button.ts#L2283)–[`2299`](../src/typescript/lib/component/button/Button.ts#L2299)). `showText` adopts the same shape verbatim. (The task brief names the accessor `getShowText`, but the real code uses the boolean `is*` convention — `isShowDescription`, `isFlat`, `isChromeless` — so the runtime reader is **`isShowText`**, matching the existing surface.)

The default lives **only** in the resolver (`?? true`), not in `_defaultButtonOptions` — exactly like `showDescription`. So the "[Class-level defaults must survive the getter](ARCHITECTURE.md)" folding-getter trap does **not** apply, and no row is needed in [`tests/component/default-options-fallback.test.ts`](../tests/component/default-options-fallback.test.ts) (it carries no `showDescription` row either).

### Keep `_text` alive but detached from the face

`_text` is created unconditionally in the constructor ([`Button.ts:423`](../src/typescript/lib/component/button/Button.ts#L423)) and is never nulled — `setText` only mutates its inner string. So `_rebuildTooltip` ([`Button.ts:893`](../src/typescript/lib/component/button/Button.ts#L893)) can always read `this._text.getText()`. The single behavioural change is in `_rebuildContentRow`: when `showText` is false, treat the title as **absent for layout** (do not add `_text` to the row) while leaving the instance intact — the precise mirror of how a hidden description is dropped from the row but kept alive for the tooltip (`renderDesc` gate at [`Button.ts:1021`](../src/typescript/lib/component/button/Button.ts#L1021)). This keeps `_text`'s identity stable for `getText()`, `getBaseline()`, and the writing-mode forwarders.

### Reflect title → `aria-label` only when the title is hidden

`Button` does not set `role` or `aria-label` today (the native `<button>` tag supplies the role, and the rendered text node is the accessible name). When `showText` is true the on-face label already *is* the accessible name, so writing an `aria-label` would be redundant and could fight a future `aria-labelledby`. Reflect **only when the title is hidden**: in `_rebuildContentRow`, when `showText` is false and the title is non-empty, call `this.getAria().setLabel(title)`; otherwise clear it. This is the minimal change that makes the title recoverable by assistive tech exactly when it leaves the DOM, and it is what lets app consumers drop their manual `getAria().setLabel(...)`.

`Aria.setLabel` takes a non-null `string` and routes through `Aria`'s private `setAttribute` → `Component.applyAriaAttribute("aria-label", value)` ([`Aria.ts:715`](../src/typescript/lib/core/Aria.ts#L715), [`Component.ts` `applyAriaAttribute`](../src/typescript/lib/core/Component.ts)). There is **no** `clearLabel`/null path today, and the runtime toggle `setShowText(true)` must be able to remove a previously-reflected label. The fix is local and follows the typed-setter rule: add a `clearLabel()` to `Aria` that calls `this._attributes.delete("label")` and `this._component.applyAriaAttribute("aria-label", null)` (the `applyAriaAttribute` null branch already removes the attribute — [`Component.ts:3589`](../src/typescript/lib/core/Component.ts#L3589)). `Button` calls `getAria().clearLabel()` in the non-hidden branch. This keeps all ARIA writes behind `getAria()` per the "[All attributes and styles go through typed setters](ARCHITECTURE.md)" rule — Button never touches `aria-label` directly.

### Reuse `description` + `showDescription:false` for secondary tooltip lines

A glyph button that wants a shortcut hint on a second tooltip line (e.g. `Run (Ctrl+Enter)`) uses the **existing** `description` + `showDescription:false` pair — no new mechanism. With both `showText:false` and `showDescription:false`, the face stays glyph-only while `_rebuildTooltip` composes `{title}\n\n{description}`.

### Setter cascade-safety (the `super()` trap)

`showText` rides the **options bag** (`this._options.showText`), not a private class field, so the "[Fields written during the `super()` cascade must use `declare`](CODE_CONVENTIONS.md)" trap does not apply — identical to `showDescription`, `descriptionUnderGlyph`, `anchor`, and `fill`, which are all pure-written into `_options` in `applyOptions` and read back through a `?? default` resolver. The runtime `setShowText` is a normal post-construction setter; it must not call `getElement(true)` and does no construction-time DOM work (it only re-runs `_rebuildContentRow` + `recomputePreferredSize`, exactly like `setShowDescription`).

---

## Public API

```typescript
export interface ButtonOptions extends ComponentOptions {
    // …existing fields…

    /**
     * When `false`, the title is *not* rendered on the button face — the
     * button shows only its glyph — but the title still drives the hover
     * tooltip AND is reflected into `aria-label` as the accessible name.
     * Default `true`. The title is always stored; only its on-button render
     * is suppressed. Runtime counterpart: `setShowText`.
     */
    showText?: boolean;
}
```

```typescript
// Runtime setter / reader — mirror setShowDescription / isShowDescription.
setShowText(value: boolean): this;   // writes this._options.showText; re-runs _rebuildContentRow() + recomputePreferredSize()
isShowText(): boolean;               // delegates to private _isShowText()
```

```typescript
// Private resolver — single home of the `true` default (mirror _isShowDescription).
private _isShowText(): boolean;      // return this._options.showText ?? true;
```

Backing store: the `_options.showText` bag field (no private `_showText` field — the value is stored verbatim, no normalisation, so the options bag is the cache per the typed-setter rules).

New `Aria` method (supporting):

```typescript
// core/Aria.ts — null/clear companion to setLabel.
clearLabel(): this;                  // deletes the cached label and removes aria-label from the element
```

---

## Internal Structure

**`applyOptions` ([`Button.ts:530`](../src/typescript/lib/component/button/Button.ts#L530)):** add one pure write beside the `showDescription` line ([`Button.ts:563`](../src/typescript/lib/component/button/Button.ts#L563)):

```typescript
if (options.showText !== undefined) this._options.showText = options.showText;
```

**`_rebuildContentRow` ([`Button.ts:1009`](../src/typescript/lib/component/button/Button.ts#L1009)):** the method already gates description rendering on `renderDesc`. Add a title gate. The minimal correct shape:

- Compute `const renderText = this._isShowText();` near the `renderDesc` computation ([`Button.ts:1021`](../src/typescript/lib/component/button/Button.ts#L1021)).
- In each topology branch, the title child `this._text` is added **only when `renderText`**. When `!renderText`, the row holds just `[glyph?]` (and, when the description is shown, the description). A glyph-only-no-text row already collapses spacing to 0 — extend the `hasText` logic in the no-description branch ([`Button.ts:1081`](../src/typescript/lib/component/button/Button.ts#L1081)) so a hidden title behaves like an empty title (treat `renderText && hasText` as the "has visible text" predicate for spacing and the optical-centre offset at [`Button.ts:1096`](../src/typescript/lib/component/button/Button.ts#L1096)).
- After re-parenting, reflect the accessible name: when `!renderText` and the title string is non-empty, `this.getAria().setLabel(title)`; else `this.getAria().clearLabel()`. (`title` = `this._text.getText().valueOf()`.)

**`setText` ([`Button.ts:674`](../src/typescript/lib/component/button/Button.ts#L674)):** currently calls `recomputePreferredSize()` + `_rebuildTooltip()` but **not** `_rebuildContentRow()` (the title string change does not re-parent anything). With `showText:false`, a later `setText` must refresh the reflected `aria-label`. Add a `_rebuildContentRow()` call to `setText` **only when the title is hidden** (`if (!this._isShowText()) this._rebuildContentRow();`) so the aria-label tracks the new string; when shown, the existing behaviour is unchanged (the visible `Text` node already reflects the new string and is the accessible name). Keep this surgical — do not unconditionally rebuild the row on every `setText`, which would be a behaviour change for the common visible-title path.

`_rebuildContentRow` is already idempotent (it empties every container then re-adds — [`Button.ts:1009`](../src/typescript/lib/component/button/Button.ts#L1009) docblock), so the extra call is safe.

---

## Ordered Implementation Steps

Library is **test-first** (the `implement` skill runs red→green); the app adoption follows once the library symbol exists.

1. **`tests/component/button/Button.test.ts`** — add a `describe('Button showText', …)` block with failing tests for the offline behaviours in `## Expected Behaviour` (default `true`; option round-trip via `isShowText`; runtime `setShowText` toggle; `_text` not parented when hidden; tooltip composed + `Tooltip.attach` called when `showText:false` with a title; `aria-label` set from title when hidden and cleared when shown). → verify: tests fail (symbol absent).
2. **`src/typescript/lib/core/Aria.ts`** — add `clearLabel()` beside `setLabel` ([`Aria.ts:715`](../src/typescript/lib/core/Aria.ts#L715)). → verify: `npm run typecheck`.
3. **`src/typescript/lib/component/button/Button.ts`** — add the `showText` option doc + field to `ButtonOptions` (beside `showDescription`, [`Button.ts:65`](../src/typescript/lib/component/button/Button.ts#L65)); add `_isShowText()` resolver (beside [`Button.ts:926`](../src/typescript/lib/component/button/Button.ts#L926)); add the pure write in `applyOptions` ([`Button.ts:563`](../src/typescript/lib/component/button/Button.ts#L563)); gate the title in `_rebuildContentRow` + the aria reflect/clear; add the hidden-title `_rebuildContentRow()` call in `setText`; add `setShowText` / `isShowText` (beside [`Button.ts:2283`](../src/typescript/lib/component/button/Button.ts#L2283)). → verify: `npm test` green, `npm run lint`.
4. **`docs/components/Button.md`** — add a "Showing the title in the tooltip only" subsection next to the existing "Showing the description in the tooltip only" ([`docs/components/Button.md:43`](../docs/components/Button.md)); note the accessible-name reflection. → verify: `npm run docs:build` finishes with zero warnings.
5. **App (`sqladmin`, branch `feature/query-panels`)** — once the library change is present in the main tree (`@jimka/typescript-ui` resolves `file:../../typescript-ui`), update `glyphButton` in [`frontend/src/dock/QueryPanel.ts:222`](../../sqladmin/.worktrees/query-panels/frontend/src/dock/QueryPanel.ts) and [`frontend/src/dock/TableWorkPanel.ts:162`](../../sqladmin/.worktrees/query-panels/frontend/src/dock/TableWorkPanel.ts): construct `Button({ glyph, text: label, showText: false, foregroundColor: color, compact: true })` and **delete** the `button.getAria().setLabel(label)` line. → verify (grep checkpoint): `grep -rn "getAria().setLabel" frontend/src` → **zero matches**; `grep -rn "showText" frontend/src` → two matches.
6. **App build** — `cd frontend && npm run typecheck && npm run build`. → verify: clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/button/Button.ts` (option, resolver, `applyOptions`, `_rebuildContentRow`, `setText`, `setShowText`/`isShowText`) |
| Modify | `src/typescript/lib/core/Aria.ts` (`clearLabel`) |
| Modify | `tests/component/button/Button.test.ts` (showText tests) |
| Modify | `docs/components/Button.md` (tooltip-only-title section) |
| Modify | `/home/jika/typescript/sqladmin/.worktrees/query-panels/frontend/src/dock/QueryPanel.ts` (`glyphButton`) |
| Modify | `/home/jika/typescript/sqladmin/.worktrees/query-panels/frontend/src/dock/TableWorkPanel.ts` (`glyphButton`) |
| Create | `plans/button-show-text-tooltip.md` (this file) |

No deletions of files; the only line removed is the per-helper `getAria().setLabel(...)` in the two app helpers.

---

## Expected Behaviour

### Offline unit-testable (assert in `Button.test.ts`)

1. **Default is `true`** — `new Button({ text: 'Save' }).isShowText()` is `true`.
2. **Option round-trips** — `new Button({ text: 'Save', showText: false }).isShowText()` is `false`.
3. **Runtime toggle** — `setShowText(false)` then `isShowText()` is `false`; `setShowText(true)` restores `true`. Chainable (returns `this`).
4. **Title not parented on the face when hidden** — with `showText:false`, the title `Text` is not a descendant of the content row. Assert via the row's child set: `_text` (the title) is absent. The `_content` tree is reachable through the documented `protected _content` seam (or assert that the glyph is the row's only laid-out child). The `Text` instance itself stays alive — `getText()` still returns the title string.
5. **Tooltip composed + attached when `showText:false` with a title** — after `new Button({ text: 'Save', showText: false })`, `Tooltip` has an attachment for the button keyed by `btn.getId()` whose `.text` is `'Save'`. Assert via the private map the existing Tooltip tests already reach: `(Tooltip as any).attachments.get(btn.getId()).text === 'Save'`. With a description too (`description`, `showDescription:false`), `.text` is `'Save\n\nThis action cannot be undone'`.
6. **`aria-label` reflects the title when hidden** — `new Button({ text: 'Run', showText: false }).getAria().getLabel()` is `'Run'`. (`Aria.getLabel` reads the cached `_attributes` map, so this holds offline regardless of render — [`Aria.ts:726`](../src/typescript/lib/core/Aria.ts#L726).)
7. **`aria-label` cleared when shown** — `new Button({ text: 'Run' }).getAria().getLabel()` is `null` (no reflection when the title is visible); and `setShowText(false)` then `setShowText(true)` leaves `getAria().getLabel()` `null` (round-trips through `clearLabel`).
8. **Hidden title tracks `setText`** — with `showText:false`, `setText('Refresh')` updates both the tooltip text (`attachments…​.text === 'Refresh'`) and `getAria().getLabel() === 'Refresh'`.
9. **No reflection / no tooltip with empty title** — `new Button({ glyph: 'play', showText: false })` (no `text`) sets neither an `aria-label` (`getLabel()` is `null`) nor a tooltip attachment.

### Live / manual (not exercisable by the offline harness)

10. **Hover tooltip actually appears** — hovering a `showText:false` glyph button shows the title (and any description line) after the 500ms delay. The offline source models no live event delivery (see the note at [`Button.test.ts:126`](../tests/component/button/Button.test.ts#L126)), so the *display* is manual-verify; only the *attachment* (behaviour 5) is unit-testable.
11. **Glyph stays optically centred** — the glyph-only face with a hidden title centres identically to a genuinely text-less glyph button (no stray spacing or vertical drift). Visual; verify in the running app toolbar.

---

## Verification

- **Library typecheck:** `npm run typecheck`.
- **Library tests:** `npm test` (covers behaviours 1–9 above).
- **Library lint:** `npm run lint` — the new ARIA write must go through `getAria()`, no raw `setAttribute`.
- **Library docs:** `npm run docs:build` — must finish with **zero** TypeDoc warnings (no `{@link}` to private/internal symbols).
- **App grep checkpoint:** `grep -rn "getAria().setLabel" frontend/src` → zero; `grep -rn "showText" frontend/src` → two.
- **App typecheck/build:** `cd frontend && npm run typecheck && npm run build`.
- **Manual hover smoke (behaviours 10–11):** run the app (`npm run dev`, port per project notes), hover the QueryPanel "Run"/"Clear" and TableWorkPanel "Add/Delete/Save/Refresh" toolbar buttons — each shows its label as a tooltip; the icons stay centred.

---

## Documentation Impact

`Button` is a public exported symbol (callable, re-exported from the package entry [`src/typescript/lib/component/button/index.ts`](../src/typescript/lib/component/button/index.ts) as `Button` + `ButtonOptions`). The new `showText` option and the `setShowText` / `isShowText` setters are consumer-visible, so:

- **JSDoc:** the `showText` field in `ButtonOptions` and the two new methods need doc-comments in the house style (the existing `showDescription` field doc + `setShowDescription`/`isShowDescription` comments are the template). Per [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md), the JSDoc may only `{@link}` symbols that appear in the public API docs — describe `_rebuildContentRow` / `_rebuildTooltip` mechanics in prose, never link them.
- **Doc page:** [`docs/components/Button.md`](../docs/components/Button.md) gets a "Showing the title in the tooltip only" subsection mirroring the existing "Showing the description in the tooltip only" block, plus a sentence in the "Tooltip" section noting that a hidden title still drives the tooltip and is reflected into `aria-label`. No catalog/sidebar change (the page already exists).
- **`Aria.clearLabel`** is a new public method on the `Aria` accessor — add a doc-comment matching `setLabel`'s; it surfaces on the Aria API page.
- Run `npm run docs:build` after the JSDoc edits — zero warnings is the gate.

No renames or removals, so no `grep -rln OldName docs/` sweep is needed.

---

## Critical Files

- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — the change site; study `showDescription` end-to-end (option [`:65`](../src/typescript/lib/component/button/Button.ts#L65), resolver [`:926`](../src/typescript/lib/component/button/Button.ts#L926), `applyOptions` pure write [`:563`](../src/typescript/lib/component/button/Button.ts#L563), setter/reader [`:2283`](../src/typescript/lib/component/button/Button.ts#L2283)), `_rebuildContentRow` [`:1009`](../src/typescript/lib/component/button/Button.ts#L1009), `_rebuildTooltip` [`:893`](../src/typescript/lib/component/button/Button.ts#L893), `setText` [`:674`](../src/typescript/lib/component/button/Button.ts#L674).
- [`src/typescript/lib/core/Aria.ts`](../src/typescript/lib/core/Aria.ts) — `setLabel`/`getLabel` ([`:715`](../src/typescript/lib/core/Aria.ts#L715)), the private `setAttribute`, where `clearLabel` goes.
- [`src/typescript/lib/overlay/Tooltip.ts`](../src/typescript/lib/overlay/Tooltip.ts) — `attach`/`detach` ([`:304`](../src/typescript/lib/overlay/Tooltip.ts#L304)/[`:352`](../src/typescript/lib/overlay/Tooltip.ts#L352)) and the private `attachments` map keyed by `getId()` (the offline assertion hook).
- [`tests/component/button/Button.test.ts`](../tests/component/button/Button.test.ts) — test patterns: `installTestDOM` / `RecordingDOMSink` / `countWrites`, and the existing description tests as templates.
- [`docs/components/Button.md`](../docs/components/Button.md) — the doc page and its existing tooltip/description sections.
- App helpers: `frontend/src/dock/QueryPanel.ts` (`glyphButton`, line 222) and `frontend/src/dock/TableWorkPanel.ts` (`glyphButton`, line 162) in the `sqladmin` `feature/query-panels` worktree.

---

## Non-Goals

- **A separate `tooltip` override option (label ≠ tooltip).** Out of scope. Today the tooltip is always derived from `text` (+ `description`); a distinct override string for the case where the visible/accessible name and the tooltip body should differ is a possible future addition, but this plan keeps the tooltip strictly title-derived.
- **Reflecting the title into `aria-label` when the title is visible.** Deliberately not done — the rendered text node is already the accessible name, and an always-on `aria-label` would be redundant and could conflict with a future `aria-labelledby` wiring.
- **Changing the `getShowText` name.** The brief said `getShowText`; the codebase's boolean convention is `is*`, so the reader is `isShowText` to match `isShowDescription`/`isFlat`/`isChromeless`. Not a naming experiment — consistency with the existing surface.
- **Touching other glyph-only `Button` sites in the app beyond the two `glyphButton` helpers.** A repo-wide grep found glyph-only `Button({ glyph … })` construction *only* inside those two helpers, and `getAria().setLabel` *only* in those two helpers; `shell/ActivityBar.ts` has none. No other adoption sites exist.
