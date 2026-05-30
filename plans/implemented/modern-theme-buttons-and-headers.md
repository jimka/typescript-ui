---
touches-shared:
  - src/typescript/lib/core/Theme.ts
---

# Modern Theme — Flat Buttons & Modernized Table Headers — Implementation Plan

## Overview

Introduce an opt-in third theme — `ModernTheme` — alongside the existing [`DefaultTheme`](../src/typescript/lib/core/Theme.ts#L476) (light) and [`DarkTheme`](../src/typescript/lib/core/Theme.ts#L768), activated through the same [`ThemeManager.setTheme`](../src/typescript/lib/core/Theme.ts#L1290) path. `setTheme` already accepts any `Theme` object, so **no new registration mechanism is needed** — the work is a third `Theme` literal plus a barrel export.

The modern theme reuses the existing CSS custom properties; it ships flat, gradient-free button values so the token-driven [`_defaultButtonOptions`](../src/typescript/lib/component/button/Button.ts#L99) render flat with **no per-button L&F code change**. It also gives the table header a flatter fill — headers consume the **button** background token (`--ts-ui-button-bg`, see [Header.ts:49](../src/typescript/lib/component/table/Header.ts#L49)), so flattening the modern button bg flattens headers for free; one small refinement adds a dedicated, optional header background/border token so modern headers can read distinctly from buttons.

This plan also fixes a confirmed pressed-state bug in [`Button`](../src/typescript/lib/component/button/Button.ts#L137): a pressed+hovered button looks unpressed because the normal/hover **gradient `background-image` bleeds through** the `:active` rule (root cause below). The fix is theme-agnostic and is coordinated with the flat modern pressed state.

The sibling plan `modern-tabs-and-combobox.md` will ADD more tokens (tab indicator, combobox arrow) to the same `ModernTheme` block and `themeToVars`. This plan defines `ModernTheme` as a full standalone `Theme` literal so those additions are append-only — see Architecture Decisions.

---

## Architecture Decisions

### `ModernTheme` is a third full `Theme` literal, not a partial overlay

`Theme` is a deep-required interface and [`themeToVars`](../src/typescript/lib/core/Theme.ts#L1054) reads every field unconditionally. A partial/merge overlay would need a deep-merge helper that doesn't exist (Simplicity First forbids inventing one). So `ModernTheme` is authored as a complete `Theme` literal after `DarkTheme`, started by copying `DefaultTheme` and overriding only the buckets that differ (`button`, `table.header`, optionally `border`). The sibling plan then adds its keys to all three literals + `themeToVars` exactly as any token is added today. The two plans collide only textually inside the `ModernTheme` literal and `themeToVars` — standard `touches-shared` territory.

### Flat buttons via tokens only — zero Button.ts L&F change

`_defaultButtonOptions` already pulls `--ts-ui-button-bg / -border / -shadow / -pressed-* / -hover-*` ([Button.ts:103-116](../src/typescript/lib/component/button/Button.ts#L103)). Giving these flat values in `ModernTheme` (solid fill instead of `linear-gradient`, hairline border, `none` shadow) produces the flat look with no code edit. The only `Button.ts` change in this plan is the bug fix, which benefits light/dark/modern alike.

### Bug root cause — the pressed `background-image` is invalid, so the normal gradient bleeds through

Normal and hover backgrounds are gradients applied via `background-image` (`backgroundImage: "var(--ts-ui-button-bg, linear-gradient(...))"`, [Button.ts:106](../src/typescript/lib/component/button/Button.ts#L106); the hover rule sets `backgroundImage` similarly). The `:active` rule sets **both** `backgroundColor: var(--ts-ui-button-pressed-bg, …)` **and** `backgroundImage: var(--ts-ui-button-pressed-bg, none)` ([Button.ts:111-112](../src/typescript/lib/component/button/Button.ts#L111)). In light/dark, `--ts-ui-button-pressed-bg` is a **plain colour** (`rgb(200,200,200)` / `rgb(35,35,35)`, [Theme.ts:490](../src/typescript/lib/core/Theme.ts#L490)/[L782](../src/typescript/lib/core/Theme.ts#L782)). A plain colour is *invalid at computed-value time* as a `background-image`, so the pressed `background-image` declaration is dropped — and because `:active` never sets a valid `background-image`, the element keeps the **normal/hover gradient `background-image`**, which paints **on top of** the pressed `background-color`. Result: a pressed button still shows the normal/hover gradient and reads as unpressed; over a hovered button the effect is total. The `:hover:not(:active)` guard and rule order are *correct* — this is a paint/cascade-of-properties bug, not a selector bug.

**Fix (theme-agnostic, in Theme.ts only):** make the pressed background a value that *is* a valid `background-image` so it overrides the bleed-through — i.e. set `button.pressed.background` to a (subtle) **gradient** in light/dark (e.g. `linear-gradient(rgb(200,200,200), rgb(214,214,214))` light), and strengthen `button.pressed.shadow`'s inset so the depth cue reads. Because both `pressedBackgroundColor` and `pressedBackgroundImage` read the same `--ts-ui-button-pressed-bg` token, a gradient value routes correctly: the color slot becomes invalid (dropped) and the image slot wins — the mirror of how normal bg works (see the `Theme` interface header comment, [Theme.ts:9-13](../src/typescript/lib/core/Theme.ts#L9)). This needs **no `Button.ts` edit**. For modern, `button.pressed.background` is likewise a gradient (a faint one from a darker flat tone) so the flat pressed state also reads as pressed. Alternative considered and rejected: editing `setPressedBackgroundImage` to detect colours — that duplicates the existing color/image auto-routing and touches code unnecessarily.

### Modern headers: flatten via the shared button bg, plus one dedicated header bg token

Headers paint with `var(--ts-ui-button-bg, …)` ([Header.ts:49](../src/typescript/lib/component/table/Header.ts#L49), and the scrollbar cover at [L266](../src/typescript/lib/component/table/Header.ts#L266)), so flattening modern `button.bg` already flattens headers. To let modern headers read as a *distinct* surface (slightly tinted vs. buttons) without a per-instance code change, add ONE token `table.header.background` and switch the two `Header.ts` `--ts-ui-button-bg` references to `var(--ts-ui-table-header-bg, var(--ts-ui-button-bg, …))`. This is a two-line, surgical `Header.ts` edit that preserves the existing fallback chain (light/dark set `table.header.background` to the same gradient, so byte-identical today). The modern divider is refined via the existing `--ts-ui-table-header-border` token. No new setter/option is needed — both sites already write `backgroundImage`/`var(...)` strings.

### No new typed setter / `XOptions` field is required

Buttons route styling through existing setters and `var(--…)` tokens; the header background sites are existing `setBackgroundImage(...)` / inline `style.backgroundImage` writes that just gain a token in their `var()` fallback chain. This plan adds theme tokens and tunes values only — the CODE_CONVENTIONS setter/backing-field/`XOptions` rule is not triggered.

---

## Theme Tokens

Values shown reflect the actual current literals. "Modern" is the flat value. Existing-but-retuned rows are marked **(retune)** for the bug fix.

| CSS Custom Property | Light Default | Dark Default | Modern Value | Purpose |
|---|---|---|---|---|
| `--ts-ui-button-bg` | `linear-gradient(rgb(241,241,241),rgb(200,200,200))` | `linear-gradient(rgb(70,70,70),rgb(50,50,50))` | `rgb(243,244,246)` (solid) | Flat button fill |
| `--ts-ui-button-border` | `rgb(200,200,200)` | `rgb(80,80,80)` | `rgb(214,217,222)` | Flat hairline border |
| `--ts-ui-button-shadow` | `1px 2px 5px 0 rgba(0,0,0,.2)` | `… .5` | `none` | No drop shadow |
| `--ts-ui-button-pressed-bg` **(retune)** | `rgb(200,200,200)` → `linear-gradient(rgb(200,200,200),rgb(214,214,214))` | `rgb(35,35,35)` → `linear-gradient(rgb(35,35,35),rgb(48,48,48))` | `linear-gradient(rgb(206,210,216),rgb(214,217,222))` | Pressed fill that overrides the gradient bleed |
| `--ts-ui-button-pressed-shadow` **(retune)** | `…0.2 inset` → `inset 0 1px 4px rgba(0,0,0,.30)` | `…0.5 inset` → `inset 0 1px 4px rgba(0,0,0,.6)` | `inset 0 1px 3px rgba(0,0,0,.18)` | Stronger pressed depth |
| `--ts-ui-button-hover-bg` | `linear-gradient(rgb(252,252,252),rgb(220,220,220))` | `linear-gradient(rgb(90,90,90),rgb(65,65,65))` | `rgb(234,236,239)` (solid) | Subtle flat hover |
| `--ts-ui-button-hover-shadow` | `1px 3px 6px 0 rgba(0,0,0,.25)` | `… .55` | `none` | No hover shadow |
| `--ts-ui-table-header-bg` (**new key**) | `linear-gradient(rgb(241,241,241),rgb(200,200,200))` | `linear-gradient(rgb(70,70,70),rgb(50,50,50))` | `rgb(248,249,250)` (solid, distinct) | Header surface fill |
| `--ts-ui-table-header-border` | `black` | `#555` | `rgb(226,229,233)` | Flatter, lighter header divider |

Unchanged button tokens (`--ts-ui-button-padding`, `--ts-ui-button-font-size`, `--ts-ui-button-pressed-fg`, `--ts-ui-button-hover-fg`) keep existing values in the modern literal.

**Blocks that get entries:**
- **`Theme` interface** — ONE new field `table.header.background: string` in the `table.header` block ([Theme.ts:185](../src/typescript/lib/core/Theme.ts#L185)). No new `button.*` interface fields (all flat/pressed tokens already exist).
- **`DefaultTheme` (light)** — add `table.header.background: 'linear-gradient(rgb(241,241,241), rgb(200,200,200))'`; **retune** `button.pressed.background` and `button.pressed.shadow` (bug fix).
- **`DarkTheme`** — add `table.header.background` (dark gradient); same `button.pressed` retune.
- **NEW `ModernTheme` block** — full `Theme` literal with all modern values; everything else copied from `DefaultTheme`.
- **`themeToVars`** — ONE new line `'--ts-ui-table-header-bg': theme.table.header.background`, beside the other `--ts-ui-table-header-*` lines ([Theme.ts:1118](../src/typescript/lib/core/Theme.ts#L1118)). All other modern tokens reuse existing `themeToVars` lines.

---

## Public API (TypeScript Signatures)

```ts
// Theme.ts — new exported constant, mirrors DefaultTheme / DarkTheme shape
export const ModernTheme: Theme;

// Theme interface — single new field inside the existing table.header object
interface Theme {
  table: {
    header: {
      background: string;   // NEW — header surface fill
      border:  string;
      font:  { size: string };
      glyph: { gap: string; color: string };
    };
    // …unchanged…
  };
}
```

No setter / backing-field / `XOptions` additions (see Architecture Decisions).

---

## Implementation

### Bug-fix value retune (light/dark, in `DefaultTheme` & `DarkTheme`)

Turn `button.pressed.background` into a gradient so it routes through `background-image` and overrides the normal-gradient bleed-through; deepen the inset:

```ts
// DefaultTheme.button.pressed (light)
pressed: {
  foreground: 'rgb(150, 150, 150)',
  background: 'linear-gradient(rgb(200, 200, 200), rgb(214, 214, 214))', // was 'rgb(200,200,200)' (a colour → invalid as image)
  shadow    : 'inset 0 1px 4px rgba(0, 0, 0, 0.30)',                     // was '1px 2px 5px 0 rgba(0,0,0,0.2) inset'
},
// DarkTheme.button.pressed analogously: linear-gradient(rgb(35,35,35), rgb(48,48,48)) + inset 0 1px 4px rgba(0,0,0,0.6)
```

No `Button.ts` edit: `pressedBackgroundColor`/`pressedBackgroundImage` both read `--ts-ui-button-pressed-bg`; a gradient makes the color slot invalid (dropped) and the image slot win — same auto-routing the interface comment documents.

### `Header.ts` token insertion (two sites)

Change `var(--ts-ui-button-bg, …)` to `var(--ts-ui-table-header-bg, var(--ts-ui-button-bg, …))` at [Header.ts:49](../src/typescript/lib/component/table/Header.ts#L49) and the scrollbar cover [Header.ts:266](../src/typescript/lib/component/table/Header.ts#L266). Light/dark set `table.header.background` to the same gradient → byte-identical today; modern gets a distinct flat fill.

### `ModernTheme` literal

Author after `DarkTheme` (≈ line 766+). Copy `DefaultTheme`, set `colorScheme: 'light'`, override `button` (flat bg/border/shadow/hover/pressed) and `table.header` (flat `background` + light `border`). Leave sibling-plan buckets (`tab`, combobox) at copied `DefaultTheme` values — that plan overrides them.

---

## Ordered Implementation Steps

1. **Add interface field.** In `Theme` (`table.header` block, [Theme.ts:185](../src/typescript/lib/core/Theme.ts#L185)) add `background: string;` with a one-line JSDoc.
2. **Light theme.** In `DefaultTheme.table.header` add `background: '<light gradient>'`; retune `DefaultTheme.button.pressed.background` (→ gradient) and `.shadow` (bug fix).
3. **Dark theme.** Same two edits in `DarkTheme`.
4. **`themeToVars` line** for `--ts-ui-table-header-bg` beside the other table-header vars.
5. **`ModernTheme`** full literal after `DarkTheme`; `export const ModernTheme: Theme`.
6. **Header.ts** — wrap the two `var(--ts-ui-button-bg, …)` sites with the new `--ts-ui-table-header-bg` fallback layer.
7. **Barrel export** — add `ModernTheme` to [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts) next to `DefaultTheme`/`DarkTheme`.
8. **Demo toggle** — make the modern theme selectable (grep `setTheme(` under the demo dir for the existing toggle).
9. **Typecheck:** `npm run build` — `Theme` is required-keyed so a missing `background` fails to compile; expect 0 errors.
10. **Regression grep:** `grep -rn 'ts-ui-table-header-bg' src/` — expect the two `Header.ts` sites plus the `themeToVars` line.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Theme.ts` (interface field, light/dark `pressed` retune + header bg, `themeToVars` line, new `ModernTheme`) |
| Modify | `src/typescript/lib/component/table/Header.ts` (two `--ts-ui-table-header-bg` fallback wraps) |
| Modify | `src/typescript/lib/core/index.ts` (export `ModernTheme`) |
| Modify | demo screen that toggles themes (add modern option) — confirm path via grep |

No change to `Button.ts` (the pressed bug fix is purely token-value) or to `table/cell/Header.ts`.

---

## Verification

- **Typecheck:** `npm run build` — 0 errors.
- **Pressed bug (all three themes):** on the button demo, press-and-hold a button with the cursor over it — it must visibly read as pressed (no normal/hover gradient bleed; inset depth shows) the entire time the mouse is down, in light, dark, and modern.
- **Flat look (modern):** switch to `ModernTheme` — buttons show solid fill, hairline border, no gradient/drop shadow; hover subtle, pressed clearly distinct.
- **Headers:** modern column headers show a flat fill distinct from buttons and a light divider; light/dark headers unchanged (same gradient via the fallback chain).
- **Theme toggle:** cycle light → dark → modern → light; confirm no stale tokens and `colorScheme` flips correctly.
- **Docs:** `npm run docs:build` — 0 errors / 0 link warnings (the typedoc "unsupported TypeScript version" notice is the only acceptable warning).

---

## Documentation Impact

- `ModernTheme` is exported from the **core** subpath barrel (`src/typescript/lib/core/index.ts`) — there is no root barrel.
- Update the curated Theme page under `docs/core/` (covering `DefaultTheme`/`DarkTheme`/`ThemeManager`) to mention `ModernTheme`; add it to that group's catalog `index.md` and the sidebar in `docs/.vitepress/config.mts` if themes are individually listed.
- Add the new `table.header.background` token (and note the `button.pressed.*` retune) to any token-reference table in the Theme docs.
- No renames/removals — no old-name sweep needed.

---

## Potential Challenges

- **`Theme` required-key compile break:** adding `background` forces all three literals to define it — handled in one pass (step 9 catches omissions).
- **Sibling-plan text collision in `ModernTheme`/`themeToVars`:** both plans edit the same literal; keep each plan's additions in distinct buckets (this plan: `button`/`table.header`; sibling: `tab`/combobox) so merges are append-only.
- **Pressed gradient must differ from normal/hover:** the fix relies on the pressed gradient being darker than the hover gradient; verify visually per theme so the cue reads without looking "stuck."
- **Header fallback chain depth:** `var(--ts-ui-table-header-bg, var(--ts-ui-button-bg, <literal>))` is nested two deep — keep the inner literal identical to today's so a theme lacking the new token still renders.

---

## Critical Files

- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `Theme` interface (L17), `DefaultTheme` (L476), `DarkTheme` (L768), `themeToVars` (L1054), `ThemeManager.setTheme` (L1290). Note the bg color/image auto-routing comment (L9-13).
- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — `_defaultButtonOptions` (L99), `pressedStyleRule`/`hoverStyleRule` (L188/L198), `setPressedBackgroundImage` (L745). Read only; not edited.
- [src/typescript/lib/component/table/Header.ts](../src/typescript/lib/component/table/Header.ts) — header bg site (L49) and scrollbar-cover bg (L266) — the two edited lines.
- [src/typescript/lib/core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — `StyleRule` / `insertRule` append order (L233) confirms the bug is property-cascade, not selector order.
- [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts) — core barrel for the `ModernTheme` export.

---

## Non-Goals

- **Tab indicator and combobox arrow tokens** — owned by `modern-tabs-and-combobox.md`; this plan only keeps `ModernTheme` extensible for them.
- **A per-button `flat` option/variant API** — flatness is a theme concern, not per-instance; a setter would violate Simplicity First.
- **Restyling other components for modern** (inputs, menus, windows) — out of scope; modern reuses `DefaultTheme` values there for now.
- **A `table.header.hoverBackground` token / header hover rule** — `HeaderCell` has no hover background rule today; adding one is speculative scope.
- **Theme persistence / `prefers-color-scheme` auto-detection** — not requested.
